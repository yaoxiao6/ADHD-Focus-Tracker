FT.registerAnalysis({
  id: "day-pie",
  title: "24 hours of the day",
  Component: ({ ctx }) => {
    const [from, to] = ctx.day.range;
    const rows = FT.agg.rankTotals(FT.agg.sumByTask(ctx.sessions, from, to), ctx.taskById);
    const tracked = rows.reduce((a, r) => a + r.secs, 0);
    const untracked = (to - from) - tracked; // future part of today, or before first use
    const slices = rows.map((r) => ({ label: r.task.name, secs: r.secs, color: r.task.color }));
    if (untracked > 0) slices.push({ label: "Untracked", secs: untracked, color: FT.UNTRACKED_COLOR });
    if (!tracked) return <FT.Empty />;
    return (
      <FT.ChartCanvas
        config={{
          type: "doughnut",
          data: {
            labels: slices.map((s) => s.label),
            datasets: [{
              data: slices.map((s) => s.secs),
              backgroundColor: slices.map((s) => s.color),
              borderColor: FT.chartTheme().surface,
              borderWidth: 2,
            }],
          },
          options: {
            cutout: "55%",
            plugins: {
              legend: { position: "right" },
              tooltip: {
                callbacks: {
                  label: (c) => {
                    const s = slices[c.dataIndex];
                    return `${s.label}: ${FT.human(s.secs)} (${((100 * s.secs) / (to - from)).toFixed(1)}%)`;
                  },
                },
              },
            },
          },
        }}
      />
    );
  },
});
