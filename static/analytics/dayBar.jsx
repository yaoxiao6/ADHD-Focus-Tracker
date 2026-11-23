FT.registerAnalysis({
  id: "day-bar",
  title: "Time per tag (day)",
  Component: ({ ctx }) => {
    const rows = FT.agg.rankBuckets(FT.agg.sumByBucket(ctx.sessions, ...ctx.day.range, ctx.buckets), ctx.buckets);
    if (!rows.length) return <FT.Empty />;
    return (
      <FT.ChartCanvas
        config={{
          type: "bar",
          data: {
            labels: rows.map((r) => r.bucket.name),
            datasets: [{
              data: rows.map((r) => +(r.secs / 3600).toFixed(4)),
              backgroundColor: rows.map((r) => r.bucket.color),
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
