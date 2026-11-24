import sqlite3
import unittest

import db


class DBTest(unittest.TestCase):
    def setUp(self):
        self.c = db.connect(":memory:")

    def open_count(self):
        return self.c.execute("SELECT COUNT(*) FROM sessions WHERE end_ts IS NULL").fetchone()[0]

    def test_relax_seeded_and_running(self):
        r = db.running(self.c)
        self.assertEqual(r["task_id"], db.relax_id(self.c))
        self.assertEqual(self.open_count(), 1)

    def test_switch_keeps_exactly_one_running_and_contiguous(self):
        t0 = db.running(self.c)["start_ts"]
        a = db.create_task(self.c, "A", "#f00")
        b = db.create_task(self.c, "B", "#0f0")
        db.switch_to(self.c, a["id"], t0 + 10)
        db.switch_to(self.c, b["id"], t0 + 25)
        db.switch_to(self.c, b["id"], t0 + 30)  # no-op
        db.stop_all(self.c, t0 + 40)
        self.assertEqual(self.open_count(), 1)
        rows = self.c.execute("SELECT task_id, start_ts, end_ts FROM sessions ORDER BY id").fetchall()
        for prev, nxt in zip(rows, rows[1:]):
            self.assertEqual(prev["end_ts"], nxt["start_ts"])
        tot = db.totals_in_range(self.c, t0, t0 + 50, ts=t0 + 50)
        self.assertEqual(tot[a["id"]], 15)
        self.assertEqual(tot[b["id"]], 15)
        self.assertEqual(tot[db.relax_id(self.c)], 20)

    def test_index_rejects_second_open_session(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.c.execute("INSERT INTO sessions (task_id, start_ts) VALUES (1, 0)")

    def test_midnight_clipping(self):
        a = db.create_task(self.c, "A", "#f00")
        midnight = 1_000_000
        self.c.execute("DELETE FROM sessions")
        self.c.execute("INSERT INTO sessions (task_id, start_ts, end_ts) VALUES (?, ?, ?)",
                       (a["id"], midnight - 600, midnight + 900))
        self.c.execute("INSERT INTO sessions (task_id, start_ts) VALUES (?, ?)",
                       (db.relax_id(self.c), midnight + 900))
        day1 = db.totals_in_range(self.c, midnight - 86400, midnight, ts=midnight + 1000)
        day2 = db.totals_in_range(self.c, midnight, midnight + 86400, ts=midnight + 1000)
        self.assertEqual(day1[a["id"]], 600)
        self.assertEqual(day2[a["id"]], 900)
        self.assertEqual(day2[db.relax_id(self.c)], 100)

    def test_archive_running_task_switches_to_relax(self):
        a = db.create_task(self.c, "A", "#f00")
        t = db.running(self.c)["start_ts"]
        db.switch_to(self.c, a["id"], t + 5)
        db.archive_task(self.c, a["id"], t + 9)
        self.assertEqual(db.running(self.c)["task_id"], db.relax_id(self.c))
        self.assertNotIn(a["id"], [x["id"] for x in db.list_tasks(self.c)])
        self.assertIn(a["id"], [x["id"] for x in db.list_tasks(self.c, include_archived=True)])
        with self.assertRaises(db.DBError):
            db.switch_to(self.c, a["id"])
        # name can be reused after archiving
        db.create_task(self.c, "A", "#f00")

    def test_relax_protected(self):
        with self.assertRaises(db.DBError):
            db.archive_task(self.c, db.relax_id(self.c))
        with self.assertRaises(db.DBError):
            db.update_task(self.c, db.relax_id(self.c), name="Chill")

    def test_duplicate_name(self):
        db.create_task(self.c, "A", "#f00")
        with self.assertRaises(db.DBError):
            db.create_task(self.c, "A", "#0f0")

    def test_tags_crud_and_assignment(self):
        a = db.create_task(self.c, "A", "#f00")
        t1 = db.create_tag(self.c, "Research", "#111")
        t2 = db.create_tag(self.c, "Coding", "#222")
        with self.assertRaises(db.DBError):
            db.create_tag(self.c, "research", "#333")  # case-insensitive unique
        db.set_task_tags(self.c, a["id"], [t2["id"], t1["id"], t1["id"]])
        self.assertEqual(db.get_task(self.c, a["id"])["tag_ids"], sorted([t1["id"], t2["id"]]))
        db.update_tag(self.c, t1["id"], name="Reading")
        self.assertEqual(db.get_tag(self.c, t1["id"])["name"], "Reading")
        db.delete_tag(self.c, t2["id"])
        self.assertEqual(db.get_task(self.c, a["id"])["tag_ids"], [t1["id"]])
        listed = {t["id"]: t for t in db.list_tasks(self.c)}
        self.assertEqual(listed[a["id"]]["tag_ids"], [t1["id"]])
        with self.assertRaises(db.DBError):
            db.set_task_tags(self.c, db.relax_id(self.c), [t1["id"]])
        with self.assertRaises(db.DBError):
            db.set_task_tags(self.c, a["id"], [9999])

    # ---------- history editing ----------

    def timeline(self):
        """[(task_name, start, end|None)] ordered; asserts invariants."""
        rows = self.c.execute(
            "SELECT t.name, s.start_ts, s.end_ts FROM sessions s JOIN tasks t ON t.id=s.task_id ORDER BY s.start_ts"
        ).fetchall()
        self.assertEqual(self.open_count(), 1)
        self.assertIsNone(rows[-1][2], "open session must be last")
        for p, n in zip(rows, rows[1:]):
            self.assertLessEqual(p[2], n[1], "overlap")
            self.assertLess(p[1], p[2], "zero/negative length")
        return [tuple(r) for r in rows]

    def seed(self, *segments):
        """segments: (task_id, start, end|None) contiguous; replaces all sessions."""
        self.c.execute("DELETE FROM sessions")
        for tid, s, e in segments:
            self.c.execute("INSERT INTO sessions (task_id, start_ts, end_ts) VALUES (?,?,?)", (tid, s, e))

    def setup_tasks(self):
        self.R = db.relax_id(self.c)
        self.W = db.create_task(self.c, "Work", "#f00")["id"]
        self.G = db.create_task(self.c, "Go out", "#0f0")["id"]

    def test_forgot_to_switch_story(self):
        # Work running since 9:00 (t=900); out 10-12; now 12:30 (t=1250).
        self.setup_tasks()
        self.seed((self.R, 0, 900), (self.W, 900, None))
        db.paint(self.c, self.G, 1000, 1200, ts=1250)
        self.assertEqual(self.timeline(), [
            ("Relax", 0, 900), ("Work", 900, 1000), ("Go out", 1000, 1200), ("Work", 1200, None)])
        tot = db.totals_in_range(self.c, 0, 2000, ts=1250)
        self.assertEqual(tot[self.W], 100 + 50)
        self.assertEqual(tot[self.G], 200)

    def test_paint_over_edges_and_multiple_blocks(self):
        self.setup_tasks()
        self.seed((self.R, 0, 100), (self.W, 100, 200), (self.G, 200, 300), (self.R, 300, None))
        db.paint(self.c, self.W, 150, 250, ts=1000)  # extend Work into Go out
        self.assertEqual(self.timeline(), [
            ("Relax", 0, 100), ("Work", 100, 250), ("Go out", 250, 300), ("Relax", 300, None)])
        db.paint(self.c, self.G, 50, 350, ts=1000)   # swallow several blocks
        self.assertEqual(self.timeline(), [("Relax", 0, 50), ("Go out", 50, 350), ("Relax", 350, None)])

    def test_delete_block_merges_relax(self):
        self.setup_tasks()
        self.seed((self.R, 0, 100), (self.W, 100, 200), (self.R, 200, None))
        db.paint(self.c, self.R, 100, 200, ts=500)
        self.assertEqual(self.timeline(), [("Relax", 0, None)])

    def test_paint_to_now_becomes_running(self):
        self.setup_tasks()
        self.seed((self.R, 0, 100), (self.W, 100, None))
        db.paint(self.c, self.G, 150, 99999, ts=300)  # end clamped to now
        self.assertEqual(self.timeline(), [("Relax", 0, 100), ("Work", 100, 150), ("Go out", 150, None)])
        self.assertEqual(db.running(self.c)["task_id"], self.G)

    def test_paint_rejections(self):
        self.setup_tasks()
        self.seed((self.R, 0, None))
        with self.assertRaises(db.DBError):
            db.paint(self.c, self.W, 600, 700, ts=500)   # future
        with self.assertRaises(db.DBError):
            db.paint(self.c, self.W, 200, 200, ts=500)   # zero length
        db.archive_task(self.c, self.G, 10)
        with self.assertRaises(db.DBError):
            db.paint(self.c, self.G, 100, 200, ts=500)   # archived
        self.timeline()

    def test_paint_before_first_session_leaves_gap(self):
        self.setup_tasks()
        self.seed((self.R, 1000, None))
        db.paint(self.c, self.W, 100, 200, ts=2000)
        self.assertEqual(self.timeline(), [("Work", 100, 200), ("Relax", 1000, None)])

    def test_restore_roundtrip_undo(self):
        self.setup_tasks()
        self.seed((self.R, 0, 900), (self.W, 900, None))
        before = [dict(task_id=self.R, start_ts=500, end_ts=900), dict(task_id=self.W, start_ts=900, end_ts=None)]
        db.paint(self.c, self.G, 600, 1200, ts=1200)   # Go out now running
        self.assertEqual(db.running(self.c)["task_id"], self.G)
        db.restore(self.c, 500, 1200, before, ts=1300)  # undo, a bit later
        self.assertEqual(self.timeline(), [("Relax", 0, 900), ("Work", 900, None)])

    def test_restore_move_block(self):
        self.setup_tasks()
        self.seed((self.R, 0, 100), (self.W, 100, 200), (self.R, 200, None))
        db.restore(self.c, 100, 400, [
            dict(task_id=self.R, start_ts=100, end_ts=250),
            dict(task_id=self.W, start_ts=250, end_ts=350),
            dict(task_id=self.R, start_ts=350, end_ts=400)], ts=1000)
        self.assertEqual(self.timeline(), [("Relax", 0, 250), ("Work", 250, 350), ("Relax", 350, None)])
        with self.assertRaises(db.DBError):
            db.restore(self.c, 0, 100, [dict(task_id=self.W, start_ts=50, end_ts=150)], ts=1000)

    def test_switch_after_edit_still_works(self):
        self.setup_tasks()
        self.seed((self.R, 0, 100), (self.W, 100, None))
        db.paint(self.c, self.G, 150, 200, ts=300)
        db.switch_to(self.c, self.G, 400)
        self.assertEqual(self.timeline()[-2:], [("Work", 200, 400), ("Go out", 400, None)])

    def test_migration_idempotent(self):
        db.migrate(self.c)
        db.ensure_relax(self.c)
        self.assertEqual(self.open_count(), 1)


if __name__ == "__main__":
    unittest.main()
