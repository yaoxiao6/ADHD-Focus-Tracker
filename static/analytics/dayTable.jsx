FT.registerAnalysis({
  id: "day-table",
  title: "Exact totals by tag (day)",
  wide: true,
  Component: ({ ctx }) => {
    const [from, to] = ctx.day.range;
    const rows = FT.agg.rankBuckets(FT.agg.sumByBucket(ctx.sessions, from, to, ctx.buckets), ctx.buckets);
    if (!rows.length) return <FT.Empty />;
    // Count each second once, even when a task carries several tags.
    const byTask = FT.agg.sumByTask(ctx.sessions, from, to);
    const focus = Object.entries(byTask)
      .filter(([id]) => !(ctx.taskById[id] || {}).is_system)
      .reduce((a, [, s]) => a + s, 0);
    return (
      <table className="totals">
        <thead><tr><th>Tag</th><th>Time</th><th>h:m:s</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bucket.key}>
              <td><span className="dot" style={{ background: r.bucket.color }} />{r.bucket.name}</td>
              <td>{FT.human(r.secs)}</td>
              <td className="mono">{FT.hms(r.secs)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total focus (excl. Relax, no double counting)</td><td>{FT.human(focus)}</td><td className="mono">{FT.hms(focus)}</td></tr>
        </tfoot>
      </table>
    );
  },
});
