// Pure aggregation helpers. Input sessions: {task_id, start_ts, end_ts} (epoch seconds).
// Every analysis should build on these so day boundaries are handled one way.
(function (FT) {
  // Clip sessions to [from, to); drops pieces of zero length.
  function clip(sessions, from, to) {
    const out = [];
    for (const s of sessions) {
      const a = Math.max(s.start_ts, from), b = Math.min(s.end_ts, to);
      if (b > a) out.push({ ...s, start_ts: a, end_ts: b, secs: b - a });
    }
    return out;
  }

  // {task_id: seconds} within [from, to).
  function sumByTask(sessions, from, to) {
    const out = {};
    for (const s of clip(sessions, from, to)) out[s.task_id] = (out[s.task_id] || 0) + s.secs;
    return out;
  }

  // days: [{range:[from,to]}] -> array of {task_id: seconds}, one per day.
  function sumByTaskPerDay(sessions, days) {
    return days.map((d) => sumByTask(sessions, d.range[0], d.range[1]));
  }

  // Sorted [{task, secs}] for a totals map; Relax first, then by time desc.
  function rankTotals(totals, taskById) {
    return Object.entries(totals)
      .map(([id, secs]) => ({ task: taskById[id], secs }))
      .filter((r) => r.task)
      .sort((a, b) => (b.task.is_system - a.task.is_system) || (b.secs - a.secs));
  }

  FT.agg = { clip, sumByTask, sumByTaskPerDay, rankTotals };
})(window.FT);
