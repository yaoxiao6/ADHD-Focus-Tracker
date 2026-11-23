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

    def test_migration_idempotent(self):
        db.migrate(self.c)
        db.ensure_relax(self.c)
        self.assertEqual(self.open_count(), 1)


if __name__ == "__main__":
    unittest.main()
