// History editor: one day as a timeline bar. Drag to create / move / resize session blocks,
// click to edit with exact times, delete = turn into Relax (drawn as empty track).
// All edits go through two server primitives: paint(task, a, b) and restore(from, to, sessions).
(function (FT) {
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const ZOOMS = [24, 12, 6, 2];
  const nowSec = () => Math.floor(Date.now() / 1000);

  // ---- pure helpers ----

  // Overwrite [a, b) in a sorted list of {task_id, start_ts, end_ts} with taskId.
  function applyPaint(items, taskId, a, b) {
    const out = [];
    for (const x of items) {
      if (x.end_ts <= a || x.start_ts >= b) { out.push(x); continue; }
      if (x.start_ts < a) out.push({ ...x, end_ts: a });
      if (x.end_ts > b) out.push({ ...x, start_ts: b });
    }
    out.push({ task_id: taskId, start_ts: a, end_ts: b });
    return out.sort((p, q) => p.start_ts - q.start_ts);
  }

  // Sessions clipped to [from, to) as plain items (running one ends at `now`).
  function snapshot(blocks, from, to) {
    return blocks
      .map((x) => ({ task_id: x.task_id, start_ts: Math.max(x.s, from), end_ts: Math.min(x.e, to) }))
      .filter((x) => x.end_ts > x.start_ts);
  }

  // Server payload: drop empties; a last item that reaches "now" stays running (end_ts null).
  function toPayload(items, now) {
    const xs = items.filter((x) => x.end_ts > x.start_ts).map((x) => ({ ...x }));
    if (xs.length && xs[xs.length - 1].end_ts >= now) xs[xs.length - 1].end_ts = null;
    return xs;
  }

  // ---- editor panel ----

  function Editor({ sel, tasks, relaxId, dayStart, dayEnd, onSave, onDelete, onCancel }) {
    const choices = tasks.filter((t) => !t.archived_at);
    const firstWork = (choices.find((t) => !t.is_system) || choices[0] || {}).id;
    const [taskId, setTaskId] = useState(sel.task_id && sel.task_id !== relaxId ? sel.task_id : (sel.kind === "new" ? firstWork : sel.task_id));
    const [start, setStart] = useState(FT.clock(sel.a));
    const [end, setEnd] = useState(FT.clock(sel.b));
    const save = () => {
      const s = FT.clockToTs(dayStart, start);
      let e = FT.clockToTs(dayStart, end);
      if (e <= s) e += 86400; // e.g. end "00:00:00" = midnight at the end of the day
      onSave(Number(taskId), s, Math.min(e, dayEnd));
    };
    return (
      <div className="hist-editor" onKeyDown={(e) => e.key === "Enter" && save()}>
        <strong>{sel.kind === "new" ? "New session" : "Edit session"}</strong>
        <label>
          Card
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {choices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>From <input type="time" step="1" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>To <input type="time" step="1" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <span className="muted mono">{FT.hms(sel.b - sel.a)}</span>
        <span className="spacer" />
        <button className="primary" onClick={save}>Save</button>
        {sel.kind === "block" && sel.task_id !== relaxId && (
          <button className="danger" onClick={onDelete} title="Turns this time into Relax">Delete</button>
        )}
        <button onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  // ---- main view ----

  FT.HistoryView = function HistoryView({ tasks, reload, refreshKey }) {
    const [date, setDate] = useState(() => new Date());
    const [data, setData] = useState(null);
    const [zoom, setZoom] = useState(() => {
      try { return Number(localStorage.getItem("ft.histZoom")) || 12; } catch { return 12; }
    });
    const [sel, setSel] = useState(null);       // {kind:'block'|'new', id?, task_id?, a, b}
    const [ghost, setGhost] = useState(null);   // {a, b, color}
    const [undo, setUndo] = useState([]);       // [{from, to, sessions}]
    const [busy, setBusy] = useState(false);
    const [rev, setRev] = useState(0);
    const trackRef = useRef(null);
    const scrollRef = useRef(null);
    const drag = useRef(null);

    const [dayStart, dayEnd] = useMemo(() => FT.dayRange(date), [date]);
    const now = nowSec();
    const maxT = Math.min(dayEnd, now);

    useEffect(() => { try { localStorage.setItem("ft.histZoom", zoom); } catch {} }, [zoom]);

    useEffect(() => {
      FT.api.sessions(dayStart, dayEnd).then(setData, (e) => alert(e.message));
    }, [dayStart, dayEnd, refreshKey, rev]);

    useEffect(() => { setSel(null); setUndo([]); }, [dayStart]);

    // Center "now" (today) or 09:00 (other days) when the day or zoom changes.
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const focus = now >= dayStart && now < dayEnd ? now : dayStart + 9 * 3600;
      el.scrollLeft = ((focus - dayStart) / (dayEnd - dayStart)) * el.scrollWidth - el.clientWidth / 2;
    }, [dayStart, zoom, !!data]);

    const taskById = useMemo(() => Object.fromEntries((data ? data.tasks : tasks).map((t) => [t.id, t])), [data, tasks]);
    const relaxId = (tasks.find((t) => t.is_system) || {}).id;

    // Day's sessions clipped to the day; the running one grows to now.
    const blocks = useMemo(() => {
      if (!data) return [];
      return data.sessions.map((x) => ({
        id: x.id, task_id: x.task_id, running: !!x.running,
        s: Math.max(x.start_ts, dayStart),
        e: Math.min(x.running ? Math.max(x.end_ts, now) : x.end_ts, dayEnd),
      })).filter((x) => x.e > x.s);
    }, [data, dayStart, dayEnd, Math.floor(now / 15)]);

    // Untracked = parts of the day with no session (before first use, or the future).
    const gaps = useMemo(() => {
      const out = [];
      let t = dayStart;
      for (const b of blocks) { if (b.s > t) out.push([t, b.s]); t = Math.max(t, b.e); }
      if (t < dayEnd) out.push([t, dayEnd]);
      return out;
    }, [blocks, dayStart, dayEnd]);

    const pct = (ts) => ((ts - dayStart) / (dayEnd - dayStart)) * 100;
    const tsAt = (clientX, exact) => {
      const r = trackRef.current.getBoundingClientRect();
      const t = dayStart + ((clientX - r.left) / r.width) * (dayEnd - dayStart);
      return exact ? Math.round(t) : Math.round(t / 60) * 60;
    };
    const clamp = (t, lo, hi) => Math.max(lo, Math.min(hi, t));

    // ---- edits (each pushes an undo snapshot on success) ----

    const commit = useCallback(async (from, to, call) => {
      const t = nowSec();
      to = Math.min(to, t);
      const live = blocks.map((b) => (b.running ? { ...b, e: t } : b));
      const entry = { from, to, sessions: toPayload(snapshot(live, from, to), t) };
      setBusy(true);
      try {
        await call();
        setUndo((u) => [...u.slice(-49), entry]);
        setSel(null);
      } catch (e) {
        alert(e.message);
      } finally {
        setBusy(false);
        setRev((r) => r + 1);
        reload();
      }
    }, [blocks, reload]);

    const paintRange = (taskId, a, b) => commit(a, b, () => FT.api.paint(taskId, a, b));

    // Replace block [s, e] by taskId over [s2, e2] (covers move, resize, and form edits).
    // A running block whose end wasn't pulled earlier than `origE` keeps running.
    const replaceBlock = (blk, taskId, s2, e2, origE = blk.e) => {
      const t = nowSec();
      const blkE = blk.running ? t : blk.e;
      if (blk.running && e2 >= origE) e2 = t;
      const from = Math.min(blk.s, s2), to = Math.min(Math.max(blkE, e2), t);
      let items = snapshot(blocks.map((b) => (b.running ? { ...b, e: t } : b)), from, to);
      items = applyPaint(items, relaxId, blk.s, Math.min(blkE, to));
      items = applyPaint(items, taskId, s2, Math.min(e2, to));
      return commit(from, to, () => FT.api.restore(from, to, toPayload(items, t)));
    };

    const doUndo = useCallback(async () => {
      const last = undo[undo.length - 1];
      if (!last || busy) return;
      setBusy(true);
      try {
        await FT.api.restore(last.from, last.to, last.sessions);
        setUndo((u) => u.slice(0, -1));
        setSel(null);
      } catch (e) {
        alert("Undo failed: " + e.message);
      } finally {
        setBusy(false);
        setRev((r) => r + 1);
        reload();
      }
    }, [undo, busy, reload]);

    const saveSel = (taskId, s, e) => {
      if (sel.kind === "block") {
        const blk = blocks.find((b) => b.id === sel.id);
        if (blk) return replaceBlock(blk, taskId, s, e, sel.b);
      }
      return paintRange(taskId, s, e);
    };
    const deleteSel = () => {
      if (!sel || sel.kind !== "block") return;
      const blk = blocks.find((b) => b.id === sel.id);
      paintRange(relaxId, sel.a, blk && blk.running ? nowSec() : sel.b); // running → Relax runs from here
    };

    // ---- keyboard ----
    useEffect(() => {
      const onKey = (e) => {
        const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); doUndo(); }
        else if (e.key === "Escape") setSel(null);
        else if ((e.key === "Delete" || e.key === "Backspace") && !typing && sel && sel.kind === "block") { e.preventDefault(); deleteSel(); }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    });

    // ---- pointer interactions ----

    const selectAt = (t) => {
      const blk = blocks.find((b) => t >= b.s && t < b.e);
      if (blk && blk.task_id !== relaxId) return setSel({ kind: "block", id: blk.id, task_id: blk.task_id, a: blk.s, b: blk.e });
      // Empty space: offer to fill the whole Relax stretch / untracked gap (up to now).
      const range = blk ? [blk.s, blk.e] : (gaps.find(([a, b]) => t >= a && t < b) || [t, t]);
      const a = range[0], b = Math.min(range[1], now);
      if (b > a) setSel({ kind: "new", a, b });
      else setSel(null);
    };

    const onPointerDown = (e) => {
      if (e.button !== 0 || busy || !data) return;
      const el = e.target.closest("[data-id]");
      const blk = el && blocks.find((b) => String(b.id) === el.dataset.id);
      const t = tsAt(e.clientX, e.altKey);
      const edge = e.target.dataset.edge;
      drag.current = {
        mode: blk ? (edge ? "resize-" + edge : "move") : "create",
        blk, x0: e.clientX, t0: t, moved: false,
        a: blk ? blk.s : t, b: blk ? blk.e : t,
      };
      trackRef.current.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      const t = tsAt(e.clientX, e.altKey);
      let a, b;
      if (d.mode === "move") {
        const len = d.blk.e - d.blk.s;
        a = clamp(d.blk.s + (t - d.t0), dayStart, maxT - len);
        b = a + len;
      } else if (d.mode === "resize-l") {
        a = clamp(t, dayStart, d.blk.e - 1); b = d.blk.e;
      } else if (d.mode === "resize-r") {
        a = d.blk.s; b = clamp(t, d.blk.s + 1, maxT);
      } else {
        a = clamp(Math.min(d.t0, t), dayStart, maxT); b = clamp(Math.max(d.t0, t), dayStart, maxT);
      }
      d.a = a; d.b = b;
      const color = d.blk ? (taskById[d.blk.task_id] || {}).color : "var(--accent)";
      setGhost({ a, b, color });
    };

    const onPointerUp = (e) => {
      const d = drag.current;
      drag.current = null;
      setGhost(null);
      if (!d) return;
      if (!d.moved) return selectAt(tsAt(e.clientX, true));
      if (d.b <= d.a) return;
      if (d.mode === "create") setSel({ kind: "new", a: d.a, b: d.b });
      else if (d.a !== d.blk.s || d.b !== d.blk.e) replaceBlock(d.blk, d.blk.task_id, d.a, d.b);
    };

    // ---- render ----

    const hours = [];
    for (let h = 0; h <= 24; h++) {
      const t = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate(), h).getTime() / 1000);
      if (t <= dayEnd) hours.push({ h, t });
    }
    const labelEvery = zoom >= 24 ? 2 : 1;
    const minor = [];
    if (zoom <= 6) for (const { t } of hours) for (let q = 1; q < 4; q++) if (t + q * 900 < dayEnd) minor.push(t + q * 900);

    const dayRows = blocks.map((b) => ({ ...b, task: taskById[b.task_id] || { name: "?", color: "#999" } }));

    return (
      <div className="history">
        <div className="toolbar">
          <FT.DatePicker date={date} onChange={setDate} />
          <div className="hist-controls">
            <span className="muted small">Zoom</span>
            <div className="seg">
              {ZOOMS.map((z) => (
                <button key={z} className={z === zoom ? "on" : ""} onClick={() => setZoom(z)}>{z}h</button>
              ))}
            </div>
            <button onClick={doUndo} disabled={!undo.length || busy} title="Undo (⌘Z)">↶ Undo{undo.length ? ` (${undo.length})` : ""}</button>
          </div>
        </div>

        <p className="muted small hint">
          Drag on empty space to add a session · drag a block to move it · drag its edges to resize · click to edit exact times.
          Snaps to 1 min (hold ⌥ Alt for seconds). Empty track = Relax; hatched = untracked / future.
        </p>

        <div className="hist-scroll" ref={scrollRef}>
          <div className="hist-inner" style={{ width: `${(100 * 24) / zoom}%` }}>
            <div className="hist-ticks">
              {hours.map(({ h, t }) => (
                <span key={h} className="tick" style={{ left: pct(t) + "%" }}>
                  {h % labelEvery === 0 && h < 24 && <em>{String(h).padStart(2, "0")}:00</em>}
                </span>
              ))}
              {minor.map((t) => <span key={t} className="tick minor" style={{ left: pct(t) + "%" }} />)}
            </div>
            <div
              className={"hist-track" + (busy ? " busy" : "")}
              ref={trackRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { drag.current = null; setGhost(null); }}
            >
              {hours.map(({ h, t }) => <span key={h} className="grid-line" style={{ left: pct(t) + "%" }} />)}
              {gaps.map(([a, b]) => (
                <div key={a} className="hist-untracked" style={{ left: pct(a) + "%", width: pct(b) - pct(a) + "%" }} />
              ))}
              {dayRows.filter((b) => b.task_id !== relaxId).map((b) => {
                const isSel = sel && sel.kind === "block" && sel.id === b.id;
                return (
                  <div
                    key={b.id} data-id={b.id}
                    className={"hist-block" + (isSel ? " selected" : "") + (b.running ? " running" : "") + (ghost && drag.current && drag.current.blk && drag.current.blk.id === b.id ? " dragging" : "")}
                    style={{ left: pct(b.s) + "%", width: pct(b.e) - pct(b.s) + "%", "--task": b.task.color }}
                    title={`${b.task.name}  ${FT.clock(b.s)} → ${FT.clock(b.e)}  (${FT.human(b.e - b.s)})`}
                  >
                    <span className="hist-handle l" data-edge="l" />
                    <span className="hist-label">{b.task.name} <small>{FT.human(b.e - b.s)}</small></span>
                    <span className="hist-handle r" data-edge="r" />
                  </div>
                );
              })}
              {sel && sel.kind === "new" && !ghost && (
                <div className="hist-ghost pending" style={{ left: pct(sel.a) + "%", width: pct(sel.b) - pct(sel.a) + "%" }} />
              )}
              {ghost && (
                <div className="hist-ghost" style={{ left: pct(ghost.a) + "%", width: pct(ghost.b) - pct(ghost.a) + "%", "--task": ghost.color }}>
                  <span className="hist-tip mono">{FT.clock(ghost.a)} → {FT.clock(ghost.b)} · {FT.human(ghost.b - ghost.a)}</span>
                </div>
              )}
              {now >= dayStart && now < dayEnd && <span className="hist-now" style={{ left: pct(now) + "%" }} />}
            </div>
          </div>
        </div>

        {sel && (
          <Editor
            key={JSON.stringify(sel)}
            sel={sel} tasks={tasks} relaxId={relaxId} dayStart={dayStart} dayEnd={dayEnd}
            onSave={saveSel} onDelete={deleteSel} onCancel={() => setSel(null)}
          />
        )}

        <table className="totals hist-list">
          <thead><tr><th>Card</th><th>From</th><th>To</th><th>Duration</th></tr></thead>
          <tbody>
            {dayRows.map((b) => {
              const isSel = sel && ((sel.kind === "block" && sel.id === b.id) || (sel.kind === "new" && sel.a === b.s && b.task_id === relaxId));
              return (
                <tr
                  key={b.id}
                  className={(b.task_id === relaxId ? "relax-row" : "") + (isSel ? " selected" : "")}
                  onClick={() => selectAt(b.s)}
                >
                  <td><span className="dot" style={{ background: b.task.color }} />{b.task.name}{b.running && <span className="muted"> · running</span>}</td>
                  <td className="mono">{FT.clock(b.s)}</td>
                  <td className="mono">{b.running && b.e >= now ? "now" : FT.clock(b.e)}</td>
                  <td>{FT.human(b.e - b.s)}</td>
                </tr>
              );
            })}
            {!dayRows.length && <tr><td colSpan="4" className="muted">Nothing recorded this day. Drag on the bar to add sessions.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  FT._history = { applyPaint, snapshot, toPayload }; // exposed for tests
})(window.FT);
