# PG Dissertation Management System

An AI-enabled, cloud-hosted web platform that digitizes the complete postgraduate (PG) dissertation lifecycle — from topic proposal to final certificate — for Presidency University, School of Computer Science and Engineering.

**Project ID:** PRJ_265 | **Category:** Software | **Technologies:** Artificial Intelligence, Cloud Computing

---

## 📌 Problem Statement

PG dissertations are currently tracked through scattered emails, printed review sheets, and manual record-keeping. This makes it hard to:
- Track which stage each student is at
- Ensure guides give timely feedback
- Verify originality before final submission

This project replaces that process with a single, role-based web platform covering topic proposal, guide allocation, milestone tracking, AI-based plagiarism verification, panel review/approval, and final report & certificate generation.

## ✨ Key Features

- **Role-based dashboards** for Student, Guide/Panel, Program Coordinator, and HoD/Admin
- **End-to-end submission workflow** with status tracking (Submitted → Under Review → Revision Needed → Approved)
- **AI-powered plagiarism & similarity detection** (NLP/ML) on every submitted draft
- **Digital review & approval** — guides/panels score and e-approve submissions
- **Real-time notifications** via email/SMS for deadlines and feedback
- **Auto-generated reports & certificates** (PDF)
- **AI-driven analytics dashboard** for batch-wide progress, hosted on the cloud

## 🏗️ Architecture

A 3-tier cloud architecture:

1. **Presentation Layer** — React.js (Student, Guide/Panel, Admin dashboards)
2. **Application Layer** — REST APIs (Auth & RBAC, Submission & Version Control, Review/Approval Workflow Engine, Notifications, Report Generation)
3. **AI & Cloud Data Layer** — AI/NLP plagiarism engine, cloud database (MySQL/PostgreSQL), cloud object storage, Redis cache

See `/docs/architecture-diagram.png` for the full diagram.

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React.js, Tailwind CSS |
| Backend | FastAPI (Python) / Node.js + Express |
| Database | MySQL / PostgreSQL, Redis |
| AI Integration | NLP/ML-based plagiarism & similarity API |
| Notifications | SMTP / Twilio |
| Cloud & DevOps | AWS / Render, Docker, GitHub Actions |

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/<your-username>/pg-dissertation-management-system.git
cd pg-dissertation-management-system

# Install backend dependencies
cd backend && pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend && npm install

# Run locally
npm run dev
```

Configure environment variables (database URL, AI API key, email/SMS credentials) in a `.env` file before running.

## 👥 Team

| Name | Roll Number |
|---|---|
| Preetham S | 20231CSE0272 |
| Yashwanth K | 20231CSE0275 |
| Pramod S R | 20231CSE0254 |

**Guide:** Ms. Priyanka Gour, Assistant Professor, School of CSE
**Program Coordinator:** Ms. Delsy Jyothi | **HoD:** Dr. Nagaraja S R

## 📄 License

This project is developed as part of the CSE7102 Mini Project at Presidency University and is for academic purposes.
