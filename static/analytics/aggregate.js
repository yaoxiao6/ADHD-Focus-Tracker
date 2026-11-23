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

  // ---- Buckets: what analytics group by (currently tags) ----
  // A bucket is {key, name, color, kind: "tag" | "relax" | "untagged"}.
  // The Relax task -> "relax"; a task with tags -> one bucket per tag; else "untagged".
  function buildBuckets(tasks, tags) {
    const info = {
      relax: { key: "relax", name: "Relax", color: (tasks.find((t) => t.is_system) || {}).color || "#8a9a8f", kind: "relax" },
      untagged: { key: "untagged", name: "Untagged", color: FT.UNTAGGED_COLOR, kind: "untagged" },
    };
    for (const g of tags) info["tag:" + g.id] = { key: "tag:" + g.id, name: g.name, color: g.color, kind: "tag" };
    const byTask = {};
    for (const t of tasks) {
      const keys = t.is_system ? ["relax"]
        : (t.tag_ids || []).map((id) => "tag:" + id).filter((k) => info[k]);
      byTask[t.id] = keys.length ? keys : ["untagged"];
    }
    return {
      info,
      keysOf: (taskId) => byTask[taskId] || ["untagged"],
    };
  }

  // {bucketKey: seconds} within [from, to).
  // split=false: a task with N tags credits its full time to each tag (bars, lines, tables).
  // split=true:  time is divided evenly across its tags, so totals add up (pie charts).
  function sumByBucket(sessions, from, to, B, split = false) {
    const out = {};
    for (const [taskId, secs] of Object.entries(sumByTask(sessions, from, to))) {
      const keys = B.keysOf(Number(taskId));
      const share = split ? secs / keys.length : secs;
      for (const k of keys) out[k] = (out[k] || 0) + share;
    }
    return out;
  }

  // days: [{range:[from,to]}] -> array of {bucketKey: seconds}, one per day.
  function sumByBucketPerDay(sessions, days, B, split = false) {
    return days.map((d) => sumByBucket(sessions, d.range[0], d.range[1], B, split));
  }

  const KIND_ORDER = { relax: 0, tag: 1, untagged: 2 };
  // Sorted [{bucket, secs}]: Relax first, tags by time desc, Untagged last.
  function rankBuckets(totals, B) {
    return Object.entries(totals)
      .map(([k, secs]) => ({ bucket: B.info[k], secs }))
      .filter((r) => r.bucket && r.secs > 0)
      .sort((a, b) => (KIND_ORDER[a.bucket.kind] - KIND_ORDER[b.bucket.kind]) || (b.secs - a.secs));
  }

  FT.agg = { clip, sumByTask, buildBuckets, sumByBucket, sumByBucketPerDay, rankBuckets };
})(window.FT);
