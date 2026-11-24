"""ADHD Focus Tracker server: static files + JSON API. Python stdlib only.

    python3 server.py [--port 7431] [--db focus.db]
"""
import argparse
import json
import os
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import db

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")

ROUTES = []  # (method, compiled regex, handler)


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn
    return deco


def _int(q, key, default=None):
    try:
        return int(q[key][0])
    except (KeyError, ValueError, IndexError):
        if default is None:
            raise db.DBError(f"query param '{key}' (int) required")
        return default


# ---------- API handlers: (conn, query, body, *groups) -> JSON-able ----------

@route("GET", r"/api/state")
def get_state(conn, q, body):
    t = db.now()
    day_start = _int(q, "day_start", t - t % 86400)
    day_end = _int(q, "day_end", day_start + 86400)
    return {
        "now": t,
        "tasks": db.list_tasks(conn),
        "tags": db.list_tags(conn),
        "running": db.running(conn),
        "today": db.totals_in_range(conn, day_start, day_end, t),
    }


@route("POST", r"/api/tasks")
def create_task(conn, q, body):
    return db.create_task(conn, body.get("name"), body.get("color"))


@route("PATCH", r"/api/tasks/(\d+)")
def update_task(conn, q, body, tid):
    return db.update_task(conn, int(tid), body.get("name"), body.get("color"))


@route("DELETE", r"/api/tasks/(\d+)")
def delete_task(conn, q, body, tid):
    return db.archive_task(conn, int(tid))


@route("PUT", r"/api/tasks/(\d+)/tags")
def set_task_tags(conn, q, body, tid):
    return db.set_task_tags(conn, int(tid), body.get("tag_ids"))


@route("POST", r"/api/tags")
def create_tag(conn, q, body):
    return db.create_tag(conn, body.get("name"), body.get("color"))


@route("PATCH", r"/api/tags/(\d+)")
def update_tag(conn, q, body, tid):
    return db.update_tag(conn, int(tid), body.get("name"), body.get("color"))


@route("DELETE", r"/api/tags/(\d+)")
def delete_tag(conn, q, body, tid):
    return db.delete_tag(conn, int(tid))


@route("POST", r"/api/start/(\d+)")
def start(conn, q, body, tid):
    return db.switch_to(conn, int(tid))


@route("POST", r"/api/stop")
def stop(conn, q, body):
    return db.stop_all(conn)


@route("POST", r"/api/paint")
def paint(conn, q, body):
    try:
        return db.paint(conn, int(body["task_id"]), int(body["start_ts"]), int(body["end_ts"]))
    except (KeyError, TypeError, ValueError):
        raise db.DBError("task_id, start_ts, end_ts (ints) required")


@route("POST", r"/api/restore")
def restore(conn, q, body):
    try:
        return db.restore(conn, int(body["from"]), int(body["to"]), body["sessions"])
    except (KeyError, TypeError, ValueError):
        raise db.DBError("from, to (ints) and sessions required")


@route("GET", r"/api/sessions")
def sessions(conn, q, body):
    return {
        "now": db.now(),
        "first_ts": db.first_session_ts(conn),
        "tasks": db.list_tasks(conn, include_archived=True),
        "tags": db.list_tags(conn),
        "sessions": db.sessions_in_range(conn, _int(q, "from"), _int(q, "to")),
    }


# ---------- plumbing ----------

class Handler(SimpleHTTPRequestHandler):
    conn = None
    lock = threading.Lock()

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or "") and self.command != "GET":
            super().log_message(fmt, *args)

    def end_headers(self):
        # Always serve fresh JS during development/iteration.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _api(self, method):
        url = urlparse(self.path)
        for m, rx, fn in ROUTES:
            match = rx.match(url.path)
            if m == method and match:
                break
        else:
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            with self.lock:
                result = fn(self.conn, parse_qs(url.query), body, *match.groups())
            self._json(200, result)
        except db.DBError as e:
            self._json(400, {"error": str(e)})
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        return super().do_GET()

    def do_POST(self):
        self._api("POST")

    def do_PATCH(self):
        self._api("PATCH")

    def do_DELETE(self):
        self._api("DELETE")

    def do_PUT(self):
        self._api("PUT")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=7431)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--db", default=os.path.join(HERE, "focus.db"))
    a = p.parse_args()
    Handler.conn = db.connect(a.db)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"ADHD Focus Tracker on http://localhost:{a.port}  (db: {a.db})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
