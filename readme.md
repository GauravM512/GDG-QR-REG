<!-- filepath: c:\Users\Gaurav\Downloads\QR REG\readme.md -->
# QR Registration & Check‑In System
Unified backend + frontend solution for managing event registrations and performing rapid on‑site check‑ins using browser‑based QR scanning.

## Contents
- Overview
- Features
- Architecture
- Backend (API / Database / Scripts)
- Frontend (Scanning UX)
- Setup (Quick Start)
- Environment Variables
- Data Import (Bulk Registrations)
- API Specification
- Database Schema (Suggested)
- CSV Export Format
- Customization & Extensibility
- Troubleshooting
- Roadmap Ideas
- License

## Overview
Attendees are pre‑registered (imported from a CSV). At the venue, staff open the web app, select a camera, and scan QR codes printed or displayed by attendees. The system validates the QR payload, marks attendance, and shows real‑time status + aggregate count.

## Core Features
Backend
- Fast JSON REST endpoints
- Idempotent check‑in (duplicate detection)
- Stats endpoint (live present count)
- CSV export of attendance
- Bulk import script for registrations

Frontend
- Vanilla JavaScript + ZXing for camera QR decode
- Multi‑camera selection (desktop + mobile)
- Debounced duplicate scan handling (configurable)
- Modal with ticket + name + status styling
- Manual ticket check endpoint support
- Live polling of present count
- One‑click CSV export

Reliability / Safety
- Graceful camera permission errors
- XSS protection via HTML escaping
- Defensive handling of unknown statuses

## Architecture
```
/backend
  app.py                # API (ASGI / FastAPI style assumed)
  db.py                 # Database session + models/helpers
  import_registrations.py # Bulk CSV import into database
  requirements.txt
/frontend
  index.html
  assets/css/styles.css
  assets/js/app.js       # Scanner logic + API calls
  assets/js/zxing.js     # ZXing library bundle (UMD)
```
Data Flow
1. Camera frame -> ZXing decode -> raw QR text.
2. POST /api/scan { raw_qr } -> backend parses -> ticket lookup.
3. If first time: mark present + return status=OK; else status=DUPLICATE.
4. Frontend displays modal; stats poll updates "Present" count.

## Backend
Assumptions:
- Python 3.10+
- FastAPI + Uvicorn
- SQLite

### Suggested Install
```bash
cd backend
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Run Dev Server
```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Data Import
```bash
python import_registrations.py registrations.csv
```
Each CSV row should minimally include: ticket_number, name (add more columns as needed). The script inserts or upserts into the registrations table.

## Frontend
Static assets; use any static server or open file (camera permissions favor http/https). Recommended:
```bash
python -m http.server 5173
```
Configure backend URL (if not localhost:8000) in index.html before app.js:
```html
<script>window.API_BASE_URL = 'https://your-backend.example.com';</script>
```

---
Concise, dependency-light event attendance workflow.
