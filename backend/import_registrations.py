import csv
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BASE_DIR / "data" / "google-gdg-on-campus-mit-arts-commerce-and-science-college-pune-india-presents-build-with-ai-innovyuh-hackathon-2025.csv"
REG_DB = BASE_DIR / "db" / "registrations.db"


def ensure_db():
    REG_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(REG_DB)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE registrations (
            ticket_number TEXT PRIMARY KEY,
            first_name TEXT,
            last_name TEXT
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reg_last_name ON registrations(last_name)")
    conn.commit()
    return conn


def import_csv():
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"CSV not found: {CSV_PATH}")
    conn = ensure_db()
    cur = conn.cursor()
    with CSV_PATH.open(newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        inserted = 0
        skipped = 0
        for row in reader:
            ticket = row.get("Ticket number", "").strip()
            if not ticket:
                skipped += 1
                continue
            first_name = row.get("First Name", "").strip()
            last_name = row.get("Last Name", "").strip()
            try:
                cur.execute(
                    "INSERT OR IGNORE INTO registrations (ticket_number, first_name, last_name) VALUES (?,?,?)",
                    (ticket, first_name, last_name),
                )
                if cur.rowcount > 0:
                    inserted += 1
                else:
                    skipped += 1
            except Exception as ex:
                print(f"Error inserting ticket {ticket}: {ex}")
                skipped += 1
    conn.commit()
    print(f"Done. Inserted={inserted} Skipped={skipped}")


if __name__ == "__main__":
    import_csv()