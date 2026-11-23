FT.registerAnalysis({
  id: "week-line",
  title: "This week by day",
  wide: true,
  Component: ({ ctx }) => {
    const perDay = FT.agg.sumByTaskPerDay(ctx.sessions, ctx.week);
    const ids = [...new Set(perDay.flatMap((d) => Object.keys(d)))]
      .map((id) => ctx.taskById[id])
      .filter(Boolean)
      .sort((a, b) => (b.is_system - a.is_system) || (a.id - b.id));
    if (!ids.length) return <FT.Empty />;
    return (
      <FT.ChartCanvas
        height={300}
        config={{
          type: "line",
          data: {
            labels: ctx.week.map((d) => `${d.label} ${d.date.getMonth() + 1}/${d.date.getDate()}`),
            datasets: ids.map((t) => ({
              label: t.name + (t.archived_at ? " (archived)" : ""),
              data: perDay.map((d) => +((d[t.id] || 0) / 3600).toFixed(4)),
              _secs: perDay.map((d) => d[t.id] || 0),
              borderColor: t.color,
              backgroundColor: t.color,
              borderDash: t.is_system ? [6, 4] : undefined,
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
