(function(){
  "use strict";

  /* ============ THEME ============ */
  var root = document.documentElement;
  document.getElementById('themeToggle').addEventListener('click', function(){
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var current = root.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
    var next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try{ localStorage.setItem('ta-theme', next); }catch(e){}
  });
  try{ var savedTheme = localStorage.getItem('ta-theme'); if(savedTheme) root.setAttribute('data-theme', savedTheme); }catch(e){}

  /* ============ TOAST ============ */
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg){
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }

  var STAGES = ["Submitted", "Under Review", "Revision Needed", "Approved"];
  function slug(s){ return s.replace(/\s+/g,'-'); }
  function initials(name){
    return name.trim().split(/\s+/).map(function(p){return p[0];}).join('').slice(0,2).toUpperCase();
  }
  function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
  function slugPart(s){
    return (s||'').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60) || 'x';
  }
  function accountId(name, inst){ return slugPart(name) + '__' + slugPart(inst); }

  /* ============ FILE UPLOAD HELPERS ============ */
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var FILE_MIME = { pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  }
  function fmtSize(n){
    if(n < 1024) return n + ' B';
    if(n < 1048576) return Math.round(n/1024) + ' KB';
    return (n/1048576).toFixed(1) + ' MB';
  }
  // Checks extension, size and the file's first bytes (%PDF / PK zip header) so a renamed file is rejected.
  async function validateFile(file){
    var name = file.name.toLowerCase();
    var kind = name.slice(-4)==='.pdf' ? 'pdf' : (name.slice(-5)==='.docx' ? 'docx' : null);
    if(!kind) return { error:'Only PDF and DOCX files are accepted.' };
    if(file.size === 0) return { error:'That file is empty.' };
    if(file.size > MAX_FILE_BYTES) return { error:'File is too large — the limit is 25 MB.' };
    var head = new Uint8Array(await file.slice(0,4).arrayBuffer());
    var sig = String.fromCharCode.apply(null, head);
    if(kind==='pdf' && sig!=='%PDF') return { error:'That doesn\'t look like a valid PDF.' };
    if(kind==='docx' && sig!=='PK\u0003\u0004') return { error:'That doesn\'t look like a valid DOCX (older .doc files aren\'t supported).' };
    return { kind:kind };
  }

  // Files are stored in IndexedDB (localStorage is too small for PDFs); chapters only keep small metadata.
  var FileStore = (function(){
    var dbp = null;
    function open(){
      if(dbp) return dbp;
      dbp = new Promise(function(resolve, reject){
        if(!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
        var req = indexedDB.open('thesisatlas-files', 1);
        req.onupgradeneeded = function(){ req.result.createObjectStore('files'); };
        req.onsuccess = function(){ resolve(req.result); };
        req.onerror = function(){ reject(req.error); };
      });
      dbp.catch(function(){ dbp = null; });
      return dbp;
    }
    function tx(mode, fn){
      return open().then(function(db){
        return new Promise(function(resolve, reject){
          var t = db.transaction('files', mode);
          var r = fn(t.objectStore('files'));
          t.oncomplete = function(){ resolve(r && r.result); };
          t.onerror = t.onabort = function(){ reject(t.error); };
        });
      });
    }
    return {
      put: function(id, blob){ return tx('readwrite', function(st){ return st.put(blob, id); }); },
      get: function(id){ return tx('readonly', function(st){ return st.get(id); }); },
      del: function(id){ return tx('readwrite', function(st){ return st.delete(id); }); }
    };
  })();

  // Validates + stores a file, returns the metadata to save on the chapter (or null after showing a toast).
  async function prepareUpload(file, version){
    var v = await validateFile(file);
    if(v.error){ toast(v.error); return null; }
    var id = uid('f');
    try{ await FileStore.put(id, file); }
    catch(e){ toast('Couldn\'t store the file in this browser (storage may be full or blocked).'); return null; }
    return { id:id, name:file.name, size:file.size, kind:v.kind, version:version, uploadedAt:new Date().toISOString() };
  }

  // PDFs open in a new tab; DOCX (or download=true) is saved to disk.
  async function openStoredFile(meta, download){
    var inTab = !download && meta.kind==='pdf';
    var w = inTab ? window.open('about:blank', '_blank') : null;
    var blob = null;
    try{ blob = await FileStore.get(meta.id); }catch(e){}
    if(!blob){
      if(w) w.close();
      toast('This file isn\'t stored in this browser.');
      return;
    }
    var url = URL.createObjectURL(new Blob([blob], { type: FILE_MIME[meta.kind] }));
    if(w){ w.location.href = url; }
    else{
      var a = document.createElement('a');
      a.href = url; a.download = meta.name;
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
  }

  // Local-mode change notifications so dashboards refresh after a save (and across tabs)
  var localSubs = [];
  function notifyLocal(){ localSubs.slice().forEach(function(fn){ try{ fn(); }catch(e){} }); }
  function localSubscribe(run){
    run(); localSubs.push(run);
    var un = function(){ localSubs = localSubs.filter(function(f){ return f!==run; }); };
    Store.activeUnsubs.push(un);
    return un;
  }
  window.addEventListener('storage', function(e){ if(e.key==='ta-students') notifyLocal(); });

  /* ============ CLOUD / LOCAL STORE ============
     Uses the `db` runtime capability (a shared cloud document store for
     this page) when available, so accounts and submissions persist on
     the server and sync live across every open tab/device. If the
     capability isn't available in this view, everything falls back to
     this browser's local storage transparently. */
  var cloudReady = false;
  var dbPromise = (async function(){
    try{
      if(window.claude && typeof window.claude.use === 'function'){
        var db = await window.claude.use('db');
        cloudReady = !!db;
        return db;
      }
    }catch(e){}
    cloudReady = false;
    return null;
  })();

  function lsGetAll(key){ try{ var raw = localStorage.getItem(key); return raw?JSON.parse(raw):{}; }catch(e){ return {}; } }
  function lsSetAll(key, obj){ try{ localStorage.setItem(key, JSON.stringify(obj)); }catch(e){} }

  var Store = {
    activeUnsubs: [],
    clearSubs: function(){
      this.activeUnsubs.forEach(function(u){ try{ u(); }catch(e){} });
      this.activeUnsubs = [];
    },

    findOrCreateStudent: async function(name, inst){
      var id = accountId(name, inst);
      var db = await dbPromise;
      if(db){
        var ref = db.doc('students/'+id);
        var snap = await ref.get();
        if(snap.exists) return Object.assign({id:id}, snap.data());
        var rec = {
          name: name.trim(), institution: inst.trim(), instKey: slugPart(inst),
          chapters: [],
          createdAt: new Date().toISOString()
        };
        await ref.set(rec);
        return Object.assign({id:id}, rec);
      }
      var all = lsGetAll('ta-students');
      if(all[id]) return all[id];
      var recL = {
        id: id, name: name.trim(), institution: inst.trim(), instKey: slugPart(inst),
        chapters: []
      };
      all[id] = recL; lsSetAll('ta-students', all);
      return recL;
    },

    registerAccount: async function(collection, name, inst){
      var id = accountId(name, inst);
      var db = await dbPromise;
      if(db){
        var ref = db.doc(collection+'/'+id);
        var snap = await ref.get();
        if(!snap.exists){
          await ref.set({ name:name.trim(), institution:inst.trim(), instKey:slugPart(inst), createdAt:new Date().toISOString() });
        }
        return;
      }
      var all = lsGetAll('ta-'+collection);
      if(!all[id]) all[id] = { id:id, name:name.trim(), institution:inst.trim() };
      lsSetAll('ta-'+collection, all);
    },

    saveChapters: async function(studentId, chapters){
      var db = await dbPromise;
      if(db){
        await db.doc('students/'+studentId).update({ chapters: chapters });
        return;
      }
      var all = lsGetAll('ta-students');
      if(all[studentId]){ all[studentId].chapters = chapters; lsSetAll('ta-students', all); }
      notifyLocal();
    },

    subscribeStudent: async function(id, cb){
      var db = await dbPromise;
      if(db){
        var un = db.doc('students/'+id).onSnapshot(function(snap){
          if(snap.exists) cb(Object.assign({id:id}, snap.data()));
        }, function(){ /* degrade silently, keep last known state */ });
        Store.activeUnsubs.push(un);
        return un;
      }
      return localSubscribe(function(){ var all = lsGetAll('ta-students'); if(all[id]) cb(all[id]); });
    },

    subscribeInstitution: async function(inst, cb){
      var db = await dbPromise;
      if(db){
        var q = db.collection('students').where('instKey', '==', slugPart(inst));
        var un = q.onSnapshot(function(snap){
          cb(snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); }));
        }, function(){ cb([]); });
        Store.activeUnsubs.push(un);
        return un;
      }
      return localSubscribe(function(){
        var all = lsGetAll('ta-students');
        cb(Object.keys(all).map(function(k){return all[k];}).filter(function(s){ return s.instKey===slugPart(inst); }));
      });
    },

    subscribeAll: async function(cb){
      var db = await dbPromise;
      if(db){
        var un = db.collection('students').onSnapshot(function(snap){
          cb(snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); }));
        }, function(){ cb([]); });
        Store.activeUnsubs.push(un);
        return un;
      }
      return localSubscribe(function(){
        var all = lsGetAll('ta-students');
        cb(Object.keys(all).map(function(k){ return all[k]; }));
      });
    }
  };

  function currentStageOf(student){
    if(!student.chapters || !student.chapters.length) return null;
    var hasRevision = student.chapters.some(function(c){ return c.status==="Revision Needed"; });
    if(hasRevision) return "Revision Needed";
    var order = STAGES;
    var idx = Math.min.apply(null, student.chapters.map(function(c){ return order.indexOf(c.status); }));
    return order[idx];
  }

  /* ============ SESSION (this device only — who you're signed in as) ============ */
  function loadSession(){
    try{ var raw = localStorage.getItem('ta-session'); if(raw) return JSON.parse(raw); }catch(e){}
    return null;
  }
  function saveSession(s){ try{ localStorage.setItem('ta-session', JSON.stringify(s)); }catch(e){} }
  function clearSession(){ try{ localStorage.removeItem('ta-session'); }catch(e){} }

  var session = loadSession();

  /* ============ VIEW ROUTING ============ */
  var views = ['landing','auth','student','guide','hod'];
  function showView(name){
    views.forEach(function(v){ document.getElementById('view-'+v).classList.toggle('hidden', v!==name); });
    window.scrollTo(0,0);
  }

  function renderSessionChip(){
    var chip = document.getElementById('sessionChip');
    if(!session){ chip.classList.add('hidden'); return; }
    chip.classList.remove('hidden');
    document.getElementById('sessionAvatar').textContent = initials(session.name);
    document.getElementById('sessionName').textContent = session.name;
    document.getElementById('sessionRole').textContent = session.role;
  }

  function enterDashboard(){
    renderSessionChip();
    Store.clearSubs();
    if(session.role === 'student'){ showView('student'); startStudent(); }
    else if(session.role === 'guide'){ showView('guide'); startGuide(); }
    else if(session.role === 'hod'){ showView('hod'); startHod(); }
  }

  document.getElementById('logoutBtn').addEventListener('click', function(){
    Store.clearSubs();
    session = null; clearSession(); renderSessionChip(); showView('landing');
  });
  document.getElementById('brandHome').addEventListener('click', function(){
    if(session){ enterDashboard(); } else { showView('landing'); }
  });

  /* ============ LANDING -> AUTH ============ */
  var authRole = 'student';
  var authCopy = {
    student: {title:'Student login', sub:'Enter your details to open your dissertation dashboard.'},
    guide: {title:'Guide login', sub:'Enter your details to open your review queue.'},
    hod: {title:'HoD login', sub:'Enter your details to open department analytics.'}
  };
  function setAuthRole(r){
    authRole = r;
    document.querySelectorAll('#authTabs button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-role')===r); });
    document.getElementById('authTitle').textContent = authCopy[r].title;
    document.getElementById('authSub').textContent = authCopy[r].sub;
  }
  document.querySelectorAll('.role-card').forEach(function(btn){
    btn.addEventListener('click', function(){ setAuthRole(btn.getAttribute('data-role')); showView('auth'); });
  });
  document.querySelectorAll('#authTabs button').forEach(function(btn){
    btn.addEventListener('click', function(){ setAuthRole(btn.getAttribute('data-role')); });
  });
  document.getElementById('authBack').addEventListener('click', function(e){ e.preventDefault(); showView('landing'); });

  document.getElementById('authForm').addEventListener('submit', async function(e){
    e.preventDefault();
    var name = document.getElementById('authName').value.trim();
    var inst = document.getElementById('authInst').value.trim();
    if(!name || !inst) return;

    var submitBtn = document.getElementById('authSubmit');
    submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';

    if(authRole === 'student'){
      var s = await Store.findOrCreateStudent(name, inst);
      session = { role:'student', studentId:s.id, name:s.name, institution:s.institution };
    } else if(authRole === 'guide'){
      await Store.registerAccount('guides', name, inst);
      session = { role:'guide', name:name, institution:inst };
    } else {
      await Store.registerAccount('hods', name, inst);
      session = { role:'hod', name:name, institution:inst };
    }
    saveSession(session);
    document.getElementById('authForm').reset();
    submitBtn.disabled = false; submitBtn.textContent = 'Enter dashboard';
    enterDashboard();
  });

  document.getElementById('seedBtn').addEventListener('click', async function(e){
    e.preventDefault();
    var existing = await new Promise(function(resolve){
      Store.subscribeAll(function(list){ resolve(list); });
    });
    Store.clearSubs();
    if(existing.length > 0){ toast('Sample data already present.'); return; }
    var seed = [
      { name:'Demo Student 1', institution:'Demo Institute A', chapters:['Approved','Approved','Under Review'] },
      { name:'Demo Student 2', institution:'Demo Institute A', chapters:['Approved','Revision Needed'] },
      { name:'Demo Student 3', institution:'Demo Institute B', chapters:['Approved','Approved','Approved','Under Review'] },
      { name:'Demo Student 4', institution:'Demo Institute B', chapters:['Submitted'] }
    ];
    var titles = ['Chapter 1 — Introduction','Chapter 2 — Literature Review','Chapter 3 — Methodology','Chapter 4 — Results'];
    var db = await dbPromise;
    for(var i=0;i<seed.length;i++){
      var sd = seed[i];
      var id = accountId(sd.name, sd.institution);
      var rec = {
        name: sd.name, institution: sd.institution, instKey: slugPart(sd.institution),
        chapters: sd.chapters.map(function(status, idx){ return {id:uid('ch'), title:titles[idx], version:1, status:status, feedback:''}; })
      };
      if(db){ await db.doc('students/'+id).set(rec); }
      else{ var all = lsGetAll('ta-students'); all[id] = Object.assign({id:id}, rec); lsSetAll('ta-students', all); }
    }
    notifyLocal();
    toast('Sample submissions loaded — log in as Guide or HoD to view.');
  });

  /* ============ STUDENT DASHBOARD ============ */
  var studentCache = null;
  function renderStudentFromCache(){
    var s = studentCache;
    if(!s) return;
    document.getElementById('studentGreeting').textContent = 'Signed in as ' + s.name;
    document.getElementById('studentInstBadge').textContent = s.institution;

    var stage = currentStageOf(s);
    var stepsWrap = document.getElementById('pipelineSteps');
    stepsWrap.innerHTML = "";
    var descs = {
      "Submitted":"Draft uploaded, awaiting guide review",
      "Under Review":"Guide is reading and scoring the chapter",
      "Revision Needed":"Changes requested — resubmit when ready",
      "Approved":"Signed off, moves to the next chapter"
    };
    if(!stage){
      var noteEl = document.createElement('div');
      noteEl.className = 'empty-state';
      noteEl.style.padding = '10px 0 18px';
      noteEl.innerHTML = 'No draft uploaded yet — use the form on the right to upload your first chapter.';
      stepsWrap.appendChild(noteEl);
    }
    STAGES.forEach(function(st, idx){
      var stageIdx = STAGES.indexOf(stage);
      var cls = 'pipeline-step' + (idx<stageIdx?' done':(idx===stageIdx?' current':''));
      var el = document.createElement('div'); el.className = cls;
      el.innerHTML = '<span class="step-dot"></span><div><b>'+st+'</b><span>'+descs[st]+'</span></div>';
      stepsWrap.appendChild(el);
    });

    var body = document.getElementById('chaptersBody'); body.innerHTML = "";
    if(s.chapters.length === 0){
      var trE = document.createElement('tr');
      trE.innerHTML = '<td colspan="5" style="text-align:center;color:var(--muted);padding:26px 10px;">No chapters uploaded yet.</td>';
      body.appendChild(trE);
    }
    s.chapters.forEach(function(c){
      var tr = document.createElement('tr');
      var fileCell = c.file
        ? '<button type="button" class="file-btn" data-open="'+esc(c.id)+'" title="'+esc(c.file.name)+'"><span class="ext ext-'+esc(c.file.kind)+'">'+esc(c.file.kind.toUpperCase())+'</span><span class="fname">'+esc(c.file.name)+'</span></button>' +
          '<div class="ver">'+fmtSize(c.file.size)+' · v'+(c.file.version||1)+'</div>'
        : '<span class="ver">No file</span>';
      if(c.status === 'Revision Needed'){
        fileCell += '<label class="link-btn">Upload revised file<input type="file" class="sr-only" accept=".pdf,.docx" data-revise="'+esc(c.id)+'"></label>';
      }
      tr.innerHTML = '<td>'+esc(c.title)+'</td><td class="ver">v'+c.version+'</td>' +
        '<td><span class="status-pill status-'+slug(c.status)+'">'+c.status+'</span></td>' +
        '<td>'+fileCell+'</td>' +
        '<td class="ver">'+esc(c.feedback || '—')+'</td>';
      body.appendChild(tr);
    });
    document.getElementById('chaptersCount').textContent = s.chapters.length + (s.chapters.length===1?' chapter':' chapters');
    updateHeroStatsFromCache();
  }

  function startStudent(){
    studentCache = null;
    Store.subscribeStudent(session.studentId, function(s){ studentCache = s; renderStudentFromCache(); });
  }

  var uploadForm = document.getElementById('uploadForm');
  var fileInput = document.getElementById('uploadFile');
  var dropzone = document.getElementById('dropzone');
  var dzMain = document.getElementById('dzMain');
  var dzSub = document.getElementById('dzSub');
  var uploadBtn = document.getElementById('uploadBtn');

  function updateDropzone(){
    var f = fileInput.files[0];
    dropzone.classList.toggle('has-file', !!f);
    if(f){ dzMain.textContent = f.name; dzSub.textContent = fmtSize(f.size) + ' · click to change'; }
    else{ dzMain.innerHTML = '<b>Choose a PDF or DOCX</b> or drag it here'; dzSub.textContent = 'Up to 25 MB'; }
  }
  fileInput.addEventListener('change', updateDropzone);
  ['dragenter','dragover'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', function(e){
    var files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length){ try{ fileInput.files = files; }catch(err){} updateDropzone(); }
  });

  uploadForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var input = document.getElementById('uploadTitle');
    var title = input.value.trim();
    if(!title || !session || session.role!=='student' || !studentCache) return;
    var file = fileInput.files[0];
    if(!file){ toast('Choose a PDF or DOCX file to upload.'); return; }
    uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
    try{
      var meta = await prepareUpload(file, 1);
      if(!meta) return;
      var newChapters = studentCache.chapters.concat([{ id: uid('ch'), title:title, version:1, status:'Submitted', feedback:'', file:meta }]);
      try{
        await Store.saveChapters(session.studentId, newChapters);
        input.value = ''; fileInput.value = ''; updateDropzone();
        toast('Draft uploaded.');
      }catch(err){
        FileStore.del(meta.id).catch(function(){});
        toast('Could not save the chapter — please try again.');
      }
    } finally {
      uploadBtn.disabled = false; uploadBtn.textContent = 'Upload draft';
    }
  });

  var chaptersBody = document.getElementById('chaptersBody');
  function chapterById(id){
    return studentCache ? studentCache.chapters.filter(function(x){ return x.id===id; })[0] : null;
  }
  chaptersBody.addEventListener('click', function(e){
    var btn = e.target.closest('[data-open]'); if(!btn) return;
    var c = chapterById(btn.getAttribute('data-open'));
    if(c && c.file) openStoredFile(c.file, false);
  });
  // Resubmit a revised file for a chapter the guide sent back
  chaptersBody.addEventListener('change', async function(e){
    var input = e.target.closest('[data-revise]'); if(!input || !studentCache) return;
    var file = input.files[0]; var chId = input.getAttribute('data-revise'); input.value = '';
    if(!file) return;
    var chapters = JSON.parse(JSON.stringify(studentCache.chapters));
    var c = chapters.filter(function(x){ return x.id===chId; })[0];
    if(!c || c.status!=='Revision Needed') return;
    toast('Uploading…');
    var meta = await prepareUpload(file, c.version);
    if(!meta) return;
    if(c.file){ c.history = (c.history||[]).concat([c.file]); }
    c.file = meta; c.status = 'Submitted';
    try{ await Store.saveChapters(session.studentId, chapters); toast('Revised file submitted.'); }
    catch(err){ FileStore.del(meta.id).catch(function(){}); toast('Could not save the revision — please try again.'); }
  });

  /* ============ GUIDE DASHBOARD ============ */
  var reviewingKey = null;
  var guideCache = [];

  function renderGuideFromCache(){
    var items = [];
    guideCache.forEach(function(s){
      (s.chapters||[]).forEach(function(c){
        if(c.status==='Submitted' || c.status==='Under Review') items.push({student:s, chapter:c});
      });
    });
    var list = document.getElementById('queueList'); list.innerHTML = "";
    if(items.length===0){
      list.innerHTML = '<div class="empty-state"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>No submissions yet from your institution.</div>';
    }
    items.forEach(function(item){
      var key = item.student.id+'::'+item.chapter.id;
      var btn = document.createElement('button');
      btn.className = 'queue-item' + (reviewingKey===key?' active':'');
      btn.innerHTML = '<b>'+esc(item.chapter.title)+'</b><span>'+esc(item.student.name)+' · '+item.chapter.status+(item.chapter.file?' · '+esc(item.chapter.file.kind.toUpperCase()):'')+'</span>';
      btn.addEventListener('click', function(){ reviewingKey = key; renderGuideFromCache(); });
      list.appendChild(btn);
    });
    renderReviewPanel();
    updateHeroStatsFromCache();
  }

  function startGuide(){
    document.getElementById('guideGreeting').textContent = 'Signed in as ' + session.name;
    document.getElementById('guideInstBadge').textContent = session.institution;
    guideCache = []; reviewingKey = null;
    Store.subscribeInstitution(session.institution, function(list){ guideCache = list; renderGuideFromCache(); });
  }

  function renderReviewPanel(){
    var card = document.getElementById('reviewCard');
    if(!reviewingKey){
      card.innerHTML = '<div class="empty-state"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>Select a submission from the queue to begin the review.</div>';
      return;
    }
    var parts = reviewingKey.split('::');
    var s = guideCache.filter(function(x){return x.id===parts[0];})[0];
    var c = s ? (s.chapters||[]).filter(function(x){return x.id===parts[1];})[0] : null;
    if(!c){ reviewingKey=null; renderReviewPanel(); return; }

    if(c.status === 'Submitted'){
      c.status = 'Under Review';
      Store.saveChapters(s.id, s.chapters);
    }

    var fileHtml;
    if(c.file){
      fileHtml = '<div class="file-card"><span class="ext ext-'+esc(c.file.kind)+'">'+esc(c.file.kind.toUpperCase())+'</span>' +
        '<div class="file-info"><b>'+esc(c.file.name)+'</b><span>'+fmtSize(c.file.size)+' · version '+(c.file.version||1)+' · uploaded '+esc(new Date(c.file.uploadedAt).toLocaleDateString())+'</span></div>' +
        '<div class="file-actions">' + (c.file.kind==='pdf' ? '<button type="button" class="btn btn-ghost btn-sm" id="openFileBtn">Open</button>' : '') +
        '<button type="button" class="btn btn-ghost btn-sm" id="dlFileBtn">Download</button></div></div>';
    } else {
      fileHtml = '<div class="file-card file-card-empty">No file attached to this submission.</div>';
    }
    if(c.history && c.history.length){
      fileHtml += '<div class="file-history">Earlier versions: ' + c.history.map(function(hh, i){
        return '<button type="button" class="file-btn" data-hist="'+i+'"><span class="ext ext-'+esc(hh.kind)+'">'+esc(hh.kind.toUpperCase())+'</span><span class="fname">v'+(hh.version||1)+' · '+esc(hh.name)+'</span></button>';
      }).join('') + '</div>';
    }

    card.innerHTML =
      '<div class="review-head"><div><h3>'+esc(c.title)+'</h3><p>'+esc(s.name)+' · '+esc(s.institution)+' · version '+c.version+'</p></div>' +
      '<span class="status-pill status-'+slug(c.status)+'">'+c.status+'</span></div>' + fileHtml +
      '<label style="font-size:.82rem;color:var(--muted);font-weight:600;">Feedback for the student</label>' +
      '<textarea id="feedbackInput" placeholder="e.g. Strengthen the related-work comparison in section 2.3...">'+esc(c.feedback||"")+'</textarea>' +
      '<div class="score-row"><label>Score</label><input type="range" id="scoreInput" min="0" max="10" value="7"><span class="score-val" id="scoreVal">7</span></div>' +
      '<div class="review-actions"><button class="btn btn-approve" id="approveBtn">Approve chapter</button><button class="btn btn-revise" id="reviseBtn">Request revision</button></div>';

    var openBtn = document.getElementById('openFileBtn');
    if(openBtn) openBtn.addEventListener('click', function(){ openStoredFile(c.file, false); });
    var dlBtn = document.getElementById('dlFileBtn');
    if(dlBtn) dlBtn.addEventListener('click', function(){ openStoredFile(c.file, true); });
    card.querySelectorAll('[data-hist]').forEach(function(b){
      b.addEventListener('click', function(){ openStoredFile(c.history[+b.getAttribute('data-hist')], true); });
    });

    var scoreInput = document.getElementById('scoreInput');
    document.getElementById('scoreVal').textContent = scoreInput.value;
    scoreInput.addEventListener('input', function(){ document.getElementById('scoreVal').textContent = this.value; });

    document.getElementById('approveBtn').addEventListener('click', async function(){
      c.feedback = document.getElementById('feedbackInput').value.trim() || ('Score '+scoreInput.value+'/10 — approved.');
      c.status = 'Approved';
      await Store.saveChapters(s.id, s.chapters);
      reviewingKey = null; toast('Chapter approved.');
    });
    document.getElementById('reviseBtn').addEventListener('click', async function(){
      var fb = document.getElementById('feedbackInput').value.trim();
      c.feedback = fb || 'Please revise and resubmit.'; c.status = 'Revision Needed'; c.version += 1;
      await Store.saveChapters(s.id, s.chapters);
      reviewingKey = null; toast('Revision requested.');
    });
  }

  /* ============ HOD DASHBOARD ============ */
  var stageChartInst, donutChartInst, hodBarInst, hodDonutInst;
  var hodOwnCache = [], hodAllCache = [];

  function statsFor(list){
    var stageCounts = {}; STAGES.forEach(function(s){ stageCounts[s]=0; });
    var notStarted = 0;
    var approved=0, total=0;
    list.forEach(function(s){
      var stage = currentStageOf(s);
      if(stage){ stageCounts[stage]++; } else { notStarted++; }
      (s.chapters||[]).forEach(function(c){ total++; if(c.status==='Approved') approved++; });
    });
    return {list:list, stageCounts:stageCounts, notStarted:notStarted, approved:approved, total:total};
  }

  function startHod(){
    document.getElementById('hodGreeting').textContent = 'Signed in as ' + session.name;
    document.getElementById('hodInstBadge').textContent = session.institution;
    hodOwnCache = []; hodAllCache = [];
    Store.subscribeInstitution(session.institution, function(list){ hodOwnCache = list; renderHodFromCache(); });
    Store.subscribeAll(function(list){ hodAllCache = list; renderHodFromCache(); });
  }

  function renderHodFromCache(){
    var data = statsFor(hodOwnCache);

    var kpis = [
      {label:'Students', value:data.list.length},
      {label:'Chapters approved', value:data.approved},
      {label:'Awaiting review', value:data.stageCounts['Submitted']+data.stageCounts['Under Review']},
      {label:'Revision requested', value:data.stageCounts['Revision Needed']}
    ];
    var kpiRow = document.getElementById('kpiRow'); kpiRow.innerHTML = "";
    kpis.forEach(function(k){
      var el = document.createElement('div'); el.className='card kpi';
      el.innerHTML = '<span>'+k.label+'</span><b>'+k.value+'</b>';
      kpiRow.appendChild(el);
    });

    var rosterEl = document.getElementById('rosterList');
    if(data.list.length===0){
      rosterEl.innerHTML = '<div class="empty-state">No students from your institution yet.</div>';
    } else {
      rosterEl.innerHTML = "";
      data.list.forEach(function(s){
        var stage = currentStageOf(s) || 'Not started';
        var row = document.createElement('div'); row.className='roster-row';
        row.innerHTML = '<div class="who"><span class="avatar">'+initials(s.name)+'</span><span>'+s.name+'</span></div>'+
          '<span class="status-pill status-'+slug(stage)+'">'+stage+'</span>';
        rosterEl.appendChild(row);
      });
    }

    var ctx1 = document.getElementById('stageChart').getContext('2d');
    var values = STAGES.map(function(s){ return data.stageCounts[s]; });
    if(stageChartInst) stageChartInst.destroy();
    stageChartInst = new Chart(ctx1, { type:'bar', data:{ labels:STAGES, datasets:[{ data:values, backgroundColor:['#0E8074','#A9791F','#B14B3A','#3C8A5C'], borderRadius:6, maxBarThickness:46 }]},
      options:{ plugins:{legend:{display:false}}, scales:{ y:{beginAtZero:true, ticks:{precision:0}} }, responsive:true, maintainAspectRatio:true } });

    var ctx2 = document.getElementById('donutChart').getContext('2d');
    var inProgress = data.total - data.approved;
    if(donutChartInst) donutChartInst.destroy();
    donutChartInst = new Chart(ctx2, { type:'doughnut', data:{ labels:['Approved','In progress'], datasets:[{ data:[data.approved, inProgress], backgroundColor:['#3C8A5C','#C9D2DC'] }]},
      options:{ plugins:{legend:{position:'bottom'}}, responsive:true, maintainAspectRatio:true, cutout:'68%' } });

    var institutions = [];
    hodAllCache.forEach(function(s){ if(institutions.indexOf(s.institution)===-1) institutions.push(s.institution); });
    var barLabels = institutions.length ? institutions : ['—'];
    var barValues = institutions.map(function(i){
      var subset = hodAllCache.filter(function(s){ return s.institution===i; });
      var d = statsFor(subset);
      return subset.length ? Math.round((d.approved/subset.length)*10)/10 : 0;
    });
    var ctx3 = document.getElementById('hodBarChart').getContext('2d');
    if(hodBarInst) hodBarInst.destroy();
    hodBarInst = new Chart(ctx3, { type:'bar', data:{ labels:barLabels, datasets:[{ data:institutions.length?barValues:[0], backgroundColor:'#A9791F', borderRadius:6, maxBarThickness:50 }]},
      options:{ indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}}, responsive:true, maintainAspectRatio:true } });

    var globalStage = {}; STAGES.forEach(function(s){ globalStage[s]=0; });
    hodAllCache.forEach(function(s){ var st = currentStageOf(s); if(st) globalStage[st]++; });
    var ctx4 = document.getElementById('hodDonutChart').getContext('2d');
    if(hodDonutInst) hodDonutInst.destroy();
    hodDonutInst = new Chart(ctx4, { type:'doughnut', data:{ labels:STAGES, datasets:[{ data:STAGES.map(function(s){return globalStage[s];}), backgroundColor:['#0E8074','#A9791F','#B14B3A','#3C8A5C'] }]},
      options:{ plugins:{legend:{position:'bottom'}}, responsive:true, maintainAspectRatio:true, cutout:'62%' } });

    updateHeroStatsFromList(hodAllCache);
  }

  /* ============ HERO STATS (landing page, best-effort one-shot) ============ */
  function updateHeroStatsFromList(list){
    var institutions = [];
    list.forEach(function(s){ if(institutions.indexOf(s.institution)===-1) institutions.push(s.institution); });
    var approved = 0;
    list.forEach(function(s){ (s.chapters||[]).forEach(function(c){ if(c.status==='Approved') approved++; }); });
    document.getElementById('statInstitutions').textContent = institutions.length;
    document.getElementById('statStudents').textContent = list.length;
    document.getElementById('statApproved').textContent = approved;
  }
  function updateHeroStatsFromCache(){
    // cheap incremental refresh while inside student/guide views without a full re-subscribe
  }
  (async function primeHeroStats(){
    var db = await dbPromise;
    if(db){
      var snap = await db.collection('students').get();
      updateHeroStatsFromList(snap.docs.map(function(d){ return d.data(); }));
    } else {
      var all = lsGetAll('ta-students');
      updateHeroStatsFromList(Object.keys(all).map(function(k){ return all[k]; }));
    }
  })();

  /* ============ CLOUD STATUS BADGE ============ */
  (async function showCloudStatus(){
    await dbPromise;
    var badge = document.getElementById('cloudStatus');
    if(!badge) return;
    if(cloudReady){
      badge.textContent = '☁ Cloud sync on';
      badge.title = 'Accounts and submissions are stored server-side and update live for every signed-in viewer.';
    } else {
      badge.textContent = '⚠ Local demo mode';
      badge.title = 'Cloud storage isn\'t available in this view, so data is kept only in this browser.';
    }
  })();

  /* ============ INIT ============ */
  setAuthRole('student');
  if(session){ enterDashboard(); } else { showView('landing'); renderSessionChip(); }

  /* ============ HERO 3D CONSTELLATION ============ */
  (function(){
    var canvas = document.getElementById('hero-canvas');
    var wrap = canvas.parentElement;
    if(!window.THREE) return;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    camera.position.z = 9;
    var renderer = new THREE.WebGLRenderer({ canvas:canvas, alpha:true, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));

    function size(){
      var w = wrap.clientWidth, h = wrap.clientHeight;
      renderer.setSize(w,h,false); camera.aspect = w/h; camera.updateProjectionMatrix();
    }
    size(); window.addEventListener('resize', size);

    var group = new THREE.Group(); scene.add(group);
    var NODE_COUNT = 42; var nodes = [];
    var goldColor = new THREE.Color(0xD9B44A), tealColor = new THREE.Color(0x4FD1C5);
    var sphereGeo = new THREE.IcosahedronGeometry(0.07, 0);
    for(var i=0;i<NODE_COUNT;i++){
      var mat = new THREE.MeshBasicMaterial({ color: i%3===0?goldColor:tealColor, transparent:true, opacity:0.9 });
      var mesh = new THREE.Mesh(sphereGeo, mat);
      var r = 3.2*Math.cbrt(Math.random()), theta=Math.random()*Math.PI*2, phi=Math.acos((Math.random()*2)-1);
      mesh.position.set(r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta)*0.75, r*Math.cos(phi)*0.6);
      group.add(mesh); nodes.push(mesh);
    }
    var positions = []; var THRESH=1.9;
    for(var a=0;a<nodes.length;a++){ for(var b=a+1;b<nodes.length;b++){
      if(nodes[a].position.distanceTo(nodes[b].position)<THRESH){
        positions.push(nodes[a].position.x,nodes[a].position.y,nodes[a].position.z);
        positions.push(nodes[b].position.x,nodes[b].position.y,nodes[b].position.z);
      }
    }}
    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    var lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({color:0x8FA3B8, transparent:true, opacity:0.28}));
    group.add(lines);

    var mouseX=0, mouseY=0;
    wrap.addEventListener('mousemove', function(e){
      var rect = wrap.getBoundingClientRect();
      mouseX = ((e.clientX-rect.left)/rect.width - 0.5);
      mouseY = ((e.clientY-rect.top)/rect.height - 0.5);
    });
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function animate(){
      if(!reduceMotion){ group.rotation.y += 0.0016; group.rotation.x = mouseY*0.25; group.rotation.y += mouseX*0.0006; }
      renderer.render(scene, camera);
      if(!reduceMotion) requestAnimationFrame(animate);
    }
    animate();
    var ro = new ResizeObserver(function(){ size(); });
    ro.observe(wrap);
  })();

})();