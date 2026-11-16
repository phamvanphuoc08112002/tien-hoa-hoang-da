"""SQLite metadata. PostgreSQL is a separate adapter that refuses to pretend it connected."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path


class SqliteMetadata:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    creature_id TEXT,
                    status TEXT,
                    stage TEXT,
                    batch_id TEXT,
                    created_at TEXT,
                    updated_at TEXT,
                    spec_json TEXT,
                    error TEXT,
                    result_json TEXT
                );
                CREATE TABLE IF NOT EXISTS creatures (
                    id TEXT PRIMARY KEY,
                    species TEXT,
                    archetype TEXT,
                    quality_score REAL,
                    status TEXT,
                    output_dir TEXT,
                    created_at TEXT,
                    metadata_json TEXT
                );
                """
            )
            self._conn.commit()

    def insert_job(self, row: dict) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO jobs (id, creature_id, status, stage, batch_id, created_at, updated_at, spec_json, error, result_json)
                VALUES (:id, :creature_id, :status, :stage, :batch_id, :created_at, :updated_at, :spec_json, :error, :result_json)
                """,
                row,
            )
            self._conn.commit()

    def update_job(self, job_id: str, **fields) -> None:
        if not fields:
            return
        assignments = ", ".join(f"{key} = :{key}" for key in fields)
        fields["id"] = job_id
        with self._lock:
            self._conn.execute(f"UPDATE jobs SET {assignments} WHERE id = :id", fields)
            self._conn.commit()

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def list_jobs(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]

    def upsert_creature(self, row: dict) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO creatures (id, species, archetype, quality_score, status, output_dir, created_at, metadata_json)
                VALUES (:id, :species, :archetype, :quality_score, :status, :output_dir, :created_at, :metadata_json)
                ON CONFLICT(id) DO UPDATE SET
                    quality_score = excluded.quality_score,
                    status = excluded.status,
                    output_dir = excluded.output_dir,
                    metadata_json = excluded.metadata_json
                """,
                row,
            )
            self._conn.commit()

    def list_creatures(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM creatures ORDER BY created_at DESC").fetchall()
        return [dict(row) for row in rows]

    def get_creature(self, creature_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM creatures WHERE id = ?", (creature_id,)).fetchone()
        return dict(row) if row else None


def job_view(row: dict) -> dict:
    result = json.loads(row["result_json"]) if row.get("result_json") else None
    return {
        "id": row["id"],
        "creature_id": row["creature_id"],
        "status": row["status"],
        "stage": row["stage"],
        "batch_id": row["batch_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "error": row["error"],
        "spec": json.loads(row["spec_json"]) if row.get("spec_json") else None,
        "result": result,
    }
