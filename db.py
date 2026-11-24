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
    # 2: tags (many-to-many with tasks)
    """
    CREATE TABLE tags (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color      TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE task_tags (
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
    );
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
    tag_map = task_tag_map(conn)
    return [dict(r, tag_ids=tag_map.get(r["id"], [])) for r in conn.execute(sql)]


def get_task(conn, task_id):
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise DBError("task not found")
    tag_ids = [r[0] for r in conn.execute(
        "SELECT tag_id FROM task_tags WHERE task_id = ? ORDER BY tag_id", (task_id,))]
    return dict(row, tag_ids=tag_ids)


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


# ---------- tags ----------
# Tag assignment is current-state, not historical: analytics attribute a task's whole
# history to the tags it has now. Deleting a tag removes it from every task.

def list_tags(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM tags ORDER BY name COLLATE NOCASE")]


def get_tag(conn, tag_id):
    row = conn.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
    if row is None:
        raise DBError("tag not found")
    return dict(row)


def create_tag(conn, name, color, ts=None):
    name = (name or "").strip()
    if not name:
        raise DBError("name required")
    try:
        cur = conn.execute("INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)",
                           (name, color or "#4f7cff", now() if ts is None else ts))
    except sqlite3.IntegrityError:
        raise DBError(f"a tag named '{name}' already exists")
    return get_tag(conn, cur.lastrowid)


def update_tag(conn, tag_id, name=None, color=None):
    get_tag(conn, tag_id)
    if name is not None:
        name = name.strip()
        if not name:
            raise DBError("name required")
    try:
        conn.execute("UPDATE tags SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?",
                     (name, color, tag_id))
    except sqlite3.IntegrityError:
        raise DBError(f"a tag named '{name}' already exists")
    return get_tag(conn, tag_id)


def delete_tag(conn, tag_id):
    tag = get_tag(conn, tag_id)
    conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))  # task_tags cascades
    return tag


def task_tag_map(conn):
    out = {}
    for r in conn.execute("SELECT task_id, tag_id FROM task_tags ORDER BY tag_id"):
        out.setdefault(r["task_id"], []).append(r["tag_id"])
    return out


def set_task_tags(conn, task_id, tag_ids):
    task = get_task(conn, task_id)
    if task["is_system"]:
        raise DBError("Relax cannot have tags")
    if not isinstance(tag_ids, list) or not all(isinstance(t, int) for t in tag_ids):
        raise DBError("tag_ids must be a list of integers")
    tag_ids = sorted(set(tag_ids))
    for t in tag_ids:
        get_tag(conn, t)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM task_tags WHERE task_id = ?", (task_id,))
        conn.executemany("INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)",
                         [(task_id, t) for t in tag_ids])
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


# ---------- history editing ----------
# Every edit is "from a to b I was doing X" (paint) or "put back exactly these sessions"
# (restore, used for move + undo). Both keep the log free of overlaps, keep at most one
# open session, and never touch the future.

def _clear_range(conn, a, b, ts):
    """Remove all coverage of [a, b): delete, trim or split overlapping sessions."""
    rows = conn.execute(
        "SELECT * FROM sessions WHERE start_ts < ? AND COALESCE(end_ts, ?) > ? ORDER BY start_ts",
        (b, ts, a),
    ).fetchall()
    for r in rows:
        s, is_open = r["start_ts"], r["end_ts"] is None
        e = ts if is_open else r["end_ts"]
        if s >= a and e <= b:                     # fully inside
            conn.execute("DELETE FROM sessions WHERE id = ?", (r["id"],))
        elif s < a and e > b:                     # straddles: split in two
            conn.execute("UPDATE sessions SET end_ts = ? WHERE id = ?", (a, r["id"]))
            conn.execute("INSERT INTO sessions (task_id, start_ts, end_ts) VALUES (?, ?, ?)",
                         (r["task_id"], b, None if is_open else e))
        elif s < a:                               # crosses left edge
            conn.execute("UPDATE sessions SET end_ts = ? WHERE id = ?", (a, r["id"]))
        else:                                     # crosses right edge
            conn.execute("UPDATE sessions SET start_ts = ? WHERE id = ?", (b, r["id"]))


def _has_open(conn):
    return conn.execute("SELECT 1 FROM sessions WHERE end_ts IS NULL").fetchone() is not None


def _insert(conn, task_id, a, b, ts):
    """Insert [a, b); if it reaches `now` and nothing else is running, it becomes the running one."""
    if b >= ts and not _has_open(conn):
        conn.execute("INSERT INTO sessions (task_id, start_ts) VALUES (?, ?)", (task_id, a))
    else:
        conn.execute("INSERT INTO sessions (task_id, start_ts, end_ts) VALUES (?, ?, ?)",
                     (task_id, a, min(b, ts)))


def _normalize(conn, a, b, ts):
    """Drop zero-length sessions and merge touching same-task neighbours around [a, b]."""
    conn.execute("DELETE FROM sessions WHERE end_ts IS NOT NULL AND end_ts <= start_ts")
    rows = conn.execute(
        "SELECT * FROM sessions WHERE start_ts <= ? AND COALESCE(end_ts, ?) >= ? ORDER BY start_ts",
        (b, ts, a),
    ).fetchall()
    prev = None
    for r in rows:
        r = dict(r)
        if prev and prev["task_id"] == r["task_id"] and prev["end_ts"] == r["start_ts"]:
            conn.execute("DELETE FROM sessions WHERE id = ?", (r["id"],))
            conn.execute("UPDATE sessions SET end_ts = ? WHERE id = ?", (r["end_ts"], prev["id"]))
            prev["end_ts"] = r["end_ts"]
        else:
            prev = r


def _check_task(conn, task_id):
    task = get_task(conn, task_id)
    if task["archived_at"] is not None:
        raise DBError(f"task '{task['name']}' is archived")
    return task


def _tx(conn, fn):
    conn.execute("BEGIN IMMEDIATE")
    try:
        out = fn()
        if not _has_open(conn):  # should be impossible; refuse to break the invariant
            raise DBError("edit would leave nothing running")
        conn.execute("COMMIT")
        return out
    except Exception:
        conn.execute("ROLLBACK")
        raise


def paint(conn, task_id, a, b, ts=None):
    """Record that [a, b) was spent on task_id, overwriting whatever was there."""
    ts = now() if ts is None else ts
    a, b = int(a), int(b)
    _check_task(conn, task_id)
    if a >= ts:
        raise DBError("cannot edit the future")
    b = min(b, ts)
    if a >= b:
        raise DBError("start must be before end")

    def run():
        _clear_range(conn, a, b, ts)
        _insert(conn, task_id, a, b, ts)
        _normalize(conn, a, b, ts)
        return sessions_in_range(conn, a, b, ts)
    return _tx(conn, run)


def restore(conn, a, b, items, ts=None):
    """Replace [a, b) with `items` [{task_id, start_ts, end_ts}] (all inside the range).

    An item with end_ts None means "still running": the range then extends to now.
    """
    ts = now() if ts is None else ts
    a, b = int(a), int(b)
    if not isinstance(items, list):
        raise DBError("sessions must be a list")
    if a >= ts:
        raise DBError("cannot edit the future")
    items = sorted(items, key=lambda x: int(x["start_ts"]))
    if any(x.get("end_ts") is None for x in items[:-1]):
        raise DBError("only the last session may be open")
    open_last = bool(items) and items[-1].get("end_ts") is None
    b = ts if open_last else min(b, ts)
    last_end = a
    for x in items:
        _check_task(conn, int(x["task_id"]))
        s = int(x["start_ts"])
        e = b if x.get("end_ts") is None else min(int(x["end_ts"]), ts)
        if s < last_end or e > b or s >= e:
            raise DBError("sessions must be ordered, non-overlapping and inside the range")
        last_end = e

    def run():
        _clear_range(conn, a, b, ts)
        for x in items:
            e = b if x.get("end_ts") is None else min(int(x["end_ts"]), ts)
            _insert(conn, int(x["task_id"]), int(x["start_ts"]), e, ts)
        _normalize(conn, a, b, ts)
        return sessions_in_range(conn, a, b, ts)
    return _tx(conn, run)
