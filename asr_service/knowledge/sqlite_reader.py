"""Read-only SQLite access to OpenMeet database."""

import json
import sqlite3
from dataclasses import dataclass


@dataclass
class ProjectInfo:
    id: str
    title: str
    is_folder: bool
    created_at: str


class SQLiteReader:
    """Read-only access to the Rust-managed SQLite database."""

    def __init__(self, db_path: str):
        self._db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        uri = f"file:{self._db_path}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    def get_project(self, project_id: str) -> ProjectInfo | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, title, is_folder, created_at FROM projects WHERE id = ?",
                (project_id,),
            ).fetchone()
            if not row:
                return None
            return ProjectInfo(
                id=row[0], title=row[1], is_folder=bool(row[2]), created_at=row[3]
            )
        finally:
            conn.close()

    def get_all_projects(self) -> list[ProjectInfo]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, title, is_folder, created_at FROM projects WHERE is_folder = 0"
            ).fetchall()
            return [
                ProjectInfo(
                    id=r[0], title=r[1], is_folder=bool(r[2]), created_at=r[3]
                )
                for r in rows
            ]
        finally:
            conn.close()

    def get_segments(self, project_id: str) -> list[dict]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, start_time, end_time, text, speaker, confidence "
                "FROM segments WHERE project_id = ? ORDER BY idx",
                (project_id,),
            ).fetchall()
            return [
                {
                    "id": r[0],
                    "start_time": r[1],
                    "end_time": r[2],
                    "text": r[3],
                    "speaker": r[4],
                    "confidence": r[5],
                }
                for r in rows
            ]
        finally:
            conn.close()

    def get_summary(self, project_id: str) -> dict | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT topic, conclusions, action_items, discussion, raw_markdown "
                "FROM summaries WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            if not row:
                return None
            return {
                "topic": row[0],
                "conclusions": json.loads(row[1]) if row[1] else [],
                "action_items": json.loads(row[2]) if row[2] else [],
                "discussion": json.loads(row[3]) if row[3] else [],
                "raw_markdown": row[4] or "",
            }
        finally:
            conn.close()

    def get_note(self, project_id: str) -> str | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT content FROM notes WHERE project_id = ?",
                (project_id,),
            ).fetchone()
            return row[0] if row else None
        finally:
            conn.close()

    def get_attachments(self, project_id: str) -> list[dict]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, filename, file_path, mime_type FROM attachments WHERE project_id = ?",
                (project_id,),
            ).fetchall()
            return [
                {
                    "id": r[0],
                    "filename": r[1],
                    "file_path": r[2],
                    "mime_type": r[3],
                }
                for r in rows
            ]
        finally:
            conn.close()

    def get_all_action_items(
        self, project_ids: list[str] | None = None
    ) -> list[dict]:
        """Get all action items across projects."""
        conn = self._connect()
        try:
            if project_ids:
                placeholders = ",".join("?" for _ in project_ids)
                rows = conn.execute(
                    f"SELECT s.project_id, s.action_items, p.title "
                    f"FROM summaries s JOIN projects p ON s.project_id = p.id "
                    f"WHERE s.project_id IN ({placeholders})",
                    project_ids,
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT s.project_id, s.action_items, p.title "
                    "FROM summaries s JOIN projects p ON s.project_id = p.id"
                ).fetchall()

            items = []
            for r in rows:
                project_id = r[0]
                action_items = json.loads(r[1]) if r[1] else []
                project_title = r[2]
                for item in action_items:
                    items.append(
                        {**item, "project_id": project_id, "project_title": project_title}
                    )
            return items
        finally:
            conn.close()

    def get_meeting_stats(self, project_ids: list[str] | None = None) -> dict:
        """Get meeting statistics."""
        conn = self._connect()
        try:
            if project_ids:
                placeholders = ",".join("?" for _ in project_ids)
                where = f"WHERE id IN ({placeholders}) AND is_folder = 0"
                params = project_ids
            else:
                where = "WHERE is_folder = 0"
                params = []

            count = conn.execute(
                f"SELECT COUNT(*) FROM projects {where}", params
            ).fetchone()[0]
            total_duration = conn.execute(
                f"SELECT COALESCE(SUM(duration_ms), 0) FROM projects {where}",
                params,
            ).fetchone()[0]

            # Speaker distribution
            if project_ids:
                seg_where = f"WHERE project_id IN ({placeholders})"
            else:
                seg_where = ""
            speakers = conn.execute(
                f"SELECT speaker, COUNT(*) FROM segments {seg_where} GROUP BY speaker",
                params,
            ).fetchall()

            return {
                "meeting_count": count,
                "total_duration_ms": total_duration,
                "speakers": {s[0] or "Unknown": s[1] for s in speakers},
            }
        finally:
            conn.close()

    def get_speaker_segments(
        self, project_ids: list[str] | None = None
    ) -> list[dict]:
        """Get speaker analysis data."""
        conn = self._connect()
        try:
            if project_ids:
                placeholders = ",".join("?" for _ in project_ids)
                rows = conn.execute(
                    f"SELECT speaker, SUM(end_time - start_time) as duration, COUNT(*) as count "
                    f"FROM segments WHERE project_id IN ({placeholders}) GROUP BY speaker",
                    project_ids,
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT speaker, SUM(end_time - start_time) as duration, COUNT(*) as count "
                    "FROM segments GROUP BY speaker"
                ).fetchall()

            return [
                {
                    "speaker": r[0] or "Unknown",
                    "total_duration": r[1] or 0,
                    "segment_count": r[2],
                }
                for r in rows
            ]
        finally:
            conn.close()
