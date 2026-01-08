from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
import csv
import io
import traceback

from .db import (
    get_att_conn,
    derive_ticket_number_from_qr,
    lookup_attendee,
    mark_attendance,
    attendance_stats,
    export_attendance_rows
)

app = FastAPI(title="GDG On Campus MIT ACSC Attendance API", version="1.0.0")

# Explicit CORS origins for dev (avoid wildcard issues on some setups / proxies)
DEV_ORIGINS = [
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1",
    "http://127.0.0.1:5173",
    "http://0.0.0.0",
    "http://0.0.0.0:5173"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=DEV_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

att_conn = get_att_conn()

class ScanRequest(BaseModel):
    raw_qr: str

@app.get("/api/ping")
def ping():
    return {"msg": "pong"}

@app.post("/api/scan")
async def scan(req: ScanRequest, request: Request):
    raw = (req.raw_qr or '').strip()
    origin = request.headers.get('origin')
    print(f"[SCAN] origin={origin} raw_len={len(raw)} snippet={raw[:50]}")
    try:
        ticket_number = derive_ticket_number_from_qr(raw)
    except Exception as e:
        print('[SCAN][ERROR] derive_ticket_number_from_qr failed', e)
        traceback.print_exc()
        return {"status": "ERROR", "error": "derive_failed", "raw_qr": raw}
    if not ticket_number:
        return {"status": "INVALID_FORMAT", "raw_qr": raw}
    try:
        attendee = lookup_attendee(ticket_number)
    except Exception as e:
        print('[SCAN][ERROR] lookup_attendee failed', e)
        traceback.print_exc()
        return {"status": "ERROR", "error": "lookup_failed", "ticket_number": ticket_number, "raw_qr": raw}
    if not attendee:
        return {"status": "NOT_FOUND", "ticket_number": ticket_number, "raw_qr": raw}
    full_name = f"{attendee['first_name']} {attendee['last_name']}".strip()
    try:
        inserted, ts = mark_attendance(ticket_number, raw, full_name, att_conn)
    except Exception as e:
        print('[SCAN][ERROR] mark_attendance failed', e)
        traceback.print_exc()
        return {"status": "ERROR", "error": "attendance_failed", "ticket_number": ticket_number, "raw_qr": raw}
    status = "OK" if inserted else "DUPLICATE"
    return {
        "status": status,
        "ticket_number": ticket_number,
        "attendee": {"name": full_name},
        "first_scan_time_utc": ts,
        "raw_qr": raw,
    }

@app.get("/api/attendee/{ticket_number}")
def get_attendee(ticket_number: str):
    attendee = lookup_attendee(ticket_number)
    if not attendee:
        raise HTTPException(status_code=404, detail="Not found")
    return attendee

@app.get("/api/stats")
def stats():
    return attendance_stats(att_conn)

@app.get("/api/attendance/export")
def export_attendance():
    rows = export_attendance_rows(att_conn)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["ticket_number", "attendee_name", "scan_time_utc", "raw_qr"])
    for r in rows:
        writer.writerow(r)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=attendance_export.csv"
    })