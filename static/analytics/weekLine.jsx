FT.registerAnalysis({
  id: "week-line",
  title: "This week by day (by tag)",
  wide: true,
  Component: ({ ctx }) => {
    const B = ctx.buckets;
    const perDay = FT.agg.sumByBucketPerDay(ctx.sessions, ctx.week, B);
    const weekTotals = {};
    for (const d of perDay) for (const [k, v] of Object.entries(d)) weekTotals[k] = (weekTotals[k] || 0) + v;
    const series = FT.agg.rankBuckets(weekTotals, B).map((r) => r.bucket);
    if (!series.length) return <FT.Empty />;
    return (
      <FT.ChartCanvas
        height={300}
        config={{
          type: "line",
          data: {
            labels: ctx.week.map((d) => `${d.label} ${d.date.getMonth() + 1}/${d.date.getDate()}`),
            datasets: series.map((b) => ({
              label: b.name,
              data: perDay.map((d) => +((d[b.key] || 0) / 3600).toFixed(4)),
              _secs: perDay.map((d) => d[b.key] || 0),
              borderColor: b.color,
              backgroundColor: b.color,
              borderDash: b.kind !== "tag" ? [6, 4] : undefined,
              borderWidth: 2,
              pointRadius: 3,
              tension: 0.25,
            })),
          },
          options: {
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "bottom" },
              tooltip: {
                callbacks: { label: (c) => `${c.dataset.label}: ${FT.human(c.dataset._secs[c.dataIndex])}` },
              },
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: "hours" } } },
          },
        }}
      />
    );
  },
});
