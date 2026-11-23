FT.registerAnalysis({
  id: "day-table",
  title: "Exact totals (day)",
  wide: true,
  Component: ({ ctx }) => {
    const rows = FT.agg.rankTotals(FT.agg.sumByTask(ctx.sessions, ...ctx.day.range), ctx.taskById);
    if (!rows.length) return <FT.Empty />;
    const focus = rows.filter((r) => !r.task.is_system).reduce((a, r) => a + r.secs, 0);
    return (
      <table className="totals">
        <thead><tr><th>Task</th><th>Time</th><th>h:m:s</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.task.id}>
              <td><span className="dot" style={{ background: r.task.color }} />{r.task.name}</td>
              <td>{FT.human(r.secs)}</td>
              <td className="mono">{FT.hms(r.secs)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total focus (excl. Relax)</td><td>{FT.human(focus)}</td><td className="mono">{FT.hms(focus)}</td></tr>
        </tfoot>
      </table>
    );
  },
});
