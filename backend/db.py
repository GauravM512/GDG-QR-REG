import sqlite3
from pathlib import Path
from threading import Lock
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent.parent
REG_DB = BASE_DIR / "db" / "registrations.db"
ATT_DB = BASE_DIR / "db" / "attendance.db"

_att_lock = Lock()

def get_reg_conn():
    if not REG_DB.exists():
        raise FileNotFoundError("registrations.db not found. Run import_registrations.py first.")
    return sqlite3.connect(REG_DB)

def get_att_conn():
    ATT_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ATT_DB, check_same_thread=False)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS attendance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_number TEXT NOT NULL UNIQUE,
            attendee_name TEXT,
            scan_time_utc TEXT NOT NULL,
            raw_qr TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_att_ticket ON attendance_log(ticket_number)")
    conn.commit()
    return conn

def derive_ticket_number_from_qr(raw: str):
    """
    Given a QR like 87189:1700489 -> GOOGA261700489
    Logic:
      split on ':'
      take right side (digits)
      ticket = 'GOOGA26' + right_digits
    """
    if ":" not in raw:
        return None
    left, right = raw.split(":", 1)
    right = right.strip()
    if not right.isdigit():
        return None
    return f"GOOGA26{right}"

def lookup_attendee(ticket_number: str):
    conn = get_reg_conn()
    try:
        cur = conn.cursor()
        cur.execute("SELECT ticket_number, first_name, last_name FROM registrations WHERE ticket_number = ? LIMIT 1", (ticket_number,))
        r = cur.fetchone()
        if not r:
            return None
        return {
            "ticket_number": r[0],
            "first_name": r[1],
            "last_name": r[2]
        }
    finally:
        conn.close()

def mark_attendance(ticket_number: str, raw_qr: str, attendee_name: str, att_conn):
    """
    Insert if not exists. Return (inserted_bool, existing_time_or_new_time)
    """
    with _att_lock:
        cur = att_conn.cursor()
        # Check existing
        cur.execute("SELECT scan_time_utc FROM attendance_log WHERE ticket_number = ?", (ticket_number,))
        row = cur.fetchone()
        if row:
            return False, row[0]
        now = datetime.utcnow().isoformat()
        cur.execute("""
            INSERT INTO attendance_log (ticket_number, attendee_name, scan_time_utc, raw_qr)
            VALUES (?,?,?,?)
        """, (ticket_number, attendee_name, now, raw_qr))
        att_conn.commit()
        return True, now

def attendance_stats(att_conn):
    cur = att_conn.cursor()
    cur.execute("SELECT COUNT(*) FROM attendance_log")
    total = cur.fetchone()[0]
    return {"present_count": total}

def export_attendance_rows(att_conn):
    cur = att_conn.cursor()
    cur.execute("""
        SELECT ticket_number, attendee_name, scan_time_utc, raw_qr
        FROM attendance_log
        ORDER BY scan_time_utc
    """)
    return cur.fetchall()