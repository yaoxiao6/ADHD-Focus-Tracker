# ADHD Focus Tracker

One stopwatch per task. Exactly one is running at any moment: starting a task stops the
previous one, and **Stop all** switches to the always-on **Relax** stopwatch. Every switch is
logged to a local SQLite file (`focus.db`) with second precision.

## Run

```bash
python3 server.py            # http://localhost:7431
python3 server.py --port 9000 --db ~/focus.db
python3 -m unittest test_db  # tests
```

No dependencies to install. Python stdlib only; React, Chart.js and Babel load from cdnjs.

## Layout

```
server.py              HTTP server: static files + JSON API (add routes with @route)
db.py                  schema, numbered MIGRATIONS, all SQL; enforces the one-running invariant
test_db.py
static/
  index.html           script load order (all modules share window.FT)
  lib/util.js          API client, time formatting, local day/week ranges
  lib/chart.jsx        <FT.ChartCanvas config=.../> Chart.js wrapper
  app.jsx              shell, tabs, 1s tick
  timer.jsx            stopwatch cards + CRUD
  analytics.jsx        date picker; renders every registered analysis
  analytics/aggregate.js   clip / sumByTask / sumByTaskPerDay
  analytics/registry.js    FT.registerAnalysis + ctx documentation
  analytics/*.jsx          one file per chart
```

## Adding an analysis

1. Create `static/analytics/myThing.jsx`:
   ```jsx
   FT.registerAnalysis({
     id: "my-thing",
     title: "Context switches today",
     Component: ({ ctx }) => {
       const n = FT.agg.clip(ctx.sessions, ...ctx.day.range).length;
       return <div className="clock">{n}</div>;
     },
   });
   ```
2. Add `<script type="text/babel" data-presets="react" src="analytics/myThing.jsx"></script>` to `index.html`.

See `registry.js` for everything in `ctx`.

## Data

```sql
tasks(id, name, color, is_system, created_at, archived_at)  -- Relax: is_system=1
sessions(id, task_id, start_ts, end_ts)                      -- end_ts NULL = running (exactly one)
schema_version(v)
```

All timestamps are UTC epoch seconds. Deleting a task sets `archived_at`, so history is kept.
Schema changes go in a new entry at the end of `db.MIGRATIONS`.

Ad-hoc queries:

```bash
sqlite3 focus.db "
SELECT t.name, SUM(COALESCE(s.end_ts, strftime('%s','now')) - s.start_ts) AS secs
FROM sessions s JOIN tasks t ON t.id = s.task_id
WHERE date(s.start_ts, 'unixepoch', 'localtime') = date('now', 'localtime')
GROUP BY t.name ORDER BY secs DESC;"
```

(This query assigns each session to the day it started. The UI splits sessions at midnight.)

```python
import sqlite3, pandas as pd
df = pd.read_sql("SELECT s.*, t.name FROM sessions s JOIN tasks t ON t.id=s.task_id",
                 sqlite3.connect("focus.db"))
```

## Behavior notes

- Time keeps counting through sleep or server downtime. The open session simply continues.
- The server's clock is the authority for timestamps. The page re-syncs on focus and every 60 s,
  so several open tabs stay consistent.
