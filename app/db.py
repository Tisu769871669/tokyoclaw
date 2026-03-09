import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS emails (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT UNIQUE,
                sender TEXT,
                subject TEXT,
                received_at TEXT,
                status TEXT,
                category TEXT,
                priority TEXT,
                summary TEXT,
                reply_draft TEXT,
                needs_human INTEGER,
                processed_at TEXT,
                sent_reply INTEGER DEFAULT 0
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_date TEXT,
                content TEXT,
                created_at TEXT
            )
            '''
        )
        conn.commit()


@contextmanager
def db_conn(db_path: str) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
