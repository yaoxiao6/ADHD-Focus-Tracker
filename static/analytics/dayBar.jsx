FT.registerAnalysis({
  id: "day-bar",
  title: "Time per task (day)",
  Component: ({ ctx }) => {
    const totals = FT.agg.sumByTask(ctx.sessions, ...ctx.day.range);
    const rows = FT.agg.rankTotals(totals, ctx.taskById);
    if (!rows.length) return <FT.Empty />;
    return (
      <FT.ChartCanvas
        config={{
          type: "bar",
          data: {
            labels: rows.map((r) => r.task.name),
            datasets: [{
              data: rows.map((r) => +(r.secs / 3600).toFixed(4)),
              backgroundColor: rows.map((r) => r.task.color),
              borderRadius: 4,
              maxBarThickness: 48,
            }],
          },
          options: {
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (c) => FT.human(rows[c.dataIndex].secs) } },
            },
            scales: {
              y: { beginAtZero: true, title: { display: true, text: "hours" } },
              x: { grid: { display: false } },
            },
          },
        }}
      />
    );
  },
});
