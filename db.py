"""All SQL lives here. Source of truth = the `sessions` log.

Invariant: exactly one session has end_ts IS NULL (the running stopwatch).
Timestamps are UTC epoch seconds.
"""
import sqlite3
import time

RELAX_NAME = "Relax"
RELAX_COLOR = "#8a9a8f"

# Numbered migrations. Append new entries; never edit old ones.
MIGRATIONS = [
    # 1: initial schema
    """
    CREATE TABLE tasks (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL,
        is_system   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        archived_at INTEGER
    );
    CREATE UNIQUE INDEX tasks_active_name ON tasks(name) WHERE archived_at IS NULL;
    CREATE TABLE sessions (
        id       INTEGER PRIMARY KEY,
        task_id  INTEGER NOT NULL REFERENCES tasks(id),
        start_ts INTEGER NOT NULL,
        end_ts   INTEGER
    );
    CREATE INDEX sessions_range ON sessions(start_ts, end_ts);
    CREATE UNIQUE INDEX one_running ON sessions((1)) WHERE end_ts IS NULL;
    """,
]


class DBError(Exception):
    pass


def now():
    return int(time.time())


def connect(path):
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    migrate(conn)
    ensure_relax(conn)
    return conn


def migrate(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)")
    row = conn.execute("SELECT v FROM schema_version").fetchone()
    v = row["v"] if row else 0
    if row is None:
        conn.execute("INSERT INTO schema_version (v) VALUES (0)")
    for i, sql in enumerate(MIGRATIONS[v:], start=v + 1):
        conn.execute("BEGIN")
        try:
            for stmt in sql.split(";"):
                if stmt.strip():
                    conn.execute(stmt)
            conn.execute("UPDATE schema_version SET v = ?", (i,))
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise


def relax_id(conn):
    return conn.execute("SELECT id FROM tasks WHERE is_system = 1").fetchone()["id"]


def ensure_relax(conn, ts=None):
    ts = now() if ts is None else ts
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute("SELECT id FROM tasks WHERE is_system = 1").fetchone()
        if row is None:
            cur = conn.execute(
                "INSERT INTO tasks (name, color, is_system, created_at) VALUES (?, ?, 1, ?)",
                (RELAX_NAME, RELAX_COLOR, ts),
            )
            rid = cur.lastrowid
        else:
            rid = row["id"]
        if conn.execute("SELECT 1 FROM sessions WHERE end_ts IS NULL").fetchone() is None:
            conn.execute("INSERT INTO sessions (task_id, start_ts) VALUES (?, ?)", (rid, ts))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ---------- tasks ----------

def list_tasks(conn, include_archived=False):
    sql = "SELECT * FROM tasks"
    if not include_archived:
        sql += " WHERE archived_at IS NULL"
    sql += " ORDER BY is_system DESC, id"
    return [dict(r) for r in conn.execute(sql)]


def get_task(conn, task_id):
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise DBError("task not found")
    return dict(row)


def create_task(conn, name, color, ts=None):
    name = (name or "").strip()
    if not name:
        raise DBError("name required")
    try:
        cur = conn.execute(
            "INSERT INTO tasks (name, color, created_at) VALUES (?, ?, ?)",
            (name, color or "#4f7cff", now() if ts is None else ts),
        )
    except sqlite3.IntegrityError:
        raise DBError(f"a task named '{name}' already exists")
    return get_task(conn, cur.lastrowid)


def update_task(conn, task_id, name=None, color=None):
    task = get_task(conn, task_id)
    if task["archived_at"] is not None:
        raise DBError("task is archived")
    if name is not None:
        name = name.strip()
        if not name:
            raise DBError("name required")
        if task["is_system"]:
            raise DBError("cannot rename Relax")
    try:
        conn.execute(
            "UPDATE tasks SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?",
            (name, color, task_id),
        )
    except sqlite3.IntegrityError:
        raise DBError(f"a task named '{name}' already exists")
    return get_task(conn, task_id)


def archive_task(conn, task_id, ts=None):
    ts = now() if ts is None else ts
    task = get_task(conn, task_id)
    if task["is_system"]:
        raise DBError("cannot delete Relax")
    if task["archived_at"] is not None:
        return task
    conn.execute("BEGIN IMMEDIATE")
    try:
        running = _running(conn)
        if running["task_id"] == task_id:
            _switch(conn, relax_id(conn), ts)
        conn.execute("UPDATE tasks SET archived_at = ? WHERE id = ?", (ts, task_id))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return get_task(conn, task_id)


# ---------- sessions ----------

def _running(conn):
    return dict(conn.execute("SELECT * FROM sessions WHERE end_ts IS NULL").fetchone())


def running(conn):
    return _running(conn)


def _switch(conn, task_id, ts):
    cur = _running(conn)
    if cur["task_id"] == task_id:
        return cur
    # Never let end < start (e.g. clock went backwards).
    ts = max(ts, cur["start_ts"])
    conn.execute("UPDATE sessions SET end_ts = ? WHERE id = ?", (ts, cur["id"]))
    if ts == cur["start_ts"]:
        # Zero-length session: drop it to keep the log clean.
        conn.execute("DELETE FROM sessions WHERE id = ?", (cur["id"],))
    conn.execute("INSERT INTO sessions (task_id, start_ts) VALUES (?, ?)", (task_id, ts))
    return _running(conn)


def switch_to(conn, task_id, ts=None):
    """Start `task_id`; whatever was running stops at the same second."""
    ts = now() if ts is None else ts
    task = get_task(conn, task_id)
    if task["archived_at"] is not None:
        raise DBError("task is archived")
    conn.execute("BEGIN IMMEDIATE")
    try:
        r = _switch(conn, task_id, ts)
        conn.execute("COMMIT")
        return r
    except Exception:
        conn.execute("ROLLBACK")
        raise


def stop_all(conn, ts=None):
    return switch_to(conn, relax_id(conn), ts)


def sessions_in_range(conn, start, end, ts=None):
    """Sessions overlapping [start, end). The open session gets end_ts = now."""
    ts = now() if ts is None else ts
    rows = conn.execute(
        """SELECT id, task_id, start_ts, COALESCE(end_ts, ?) AS end_ts,
                  end_ts IS NULL AS running
           FROM sessions
           WHERE start_ts < ? AND COALESCE(end_ts, ?) > ?
           ORDER BY start_ts""",
        (ts, end, ts, start),
    )
    return [dict(r) for r in rows]


def totals_in_range(conn, start, end, ts=None):
    """{task_id: seconds} within [start, end), sessions clipped to the range."""
    out = {}
    for s in sessions_in_range(conn, start, end, ts):
        secs = min(s["end_ts"], end) - max(s["start_ts"], start)
        if secs > 0:
            out[s["task_id"]] = out.get(s["task_id"], 0) + secs
    return out


def first_session_ts(conn):
    row = conn.execute("SELECT MIN(start_ts) AS t FROM sessions").fetchone()
    return row["t"]
