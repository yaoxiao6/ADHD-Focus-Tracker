FT.registerAnalysis({
  id: "day-pie",
  title: "24 hours of the day (by tag)",
  Component: ({ ctx }) => {
    const [from, to] = ctx.day.range;
    // split=true so slices add up to exactly 24h even when a task has several tags.
    const rows = FT.agg.rankBuckets(FT.agg.sumByBucket(ctx.sessions, from, to, ctx.buckets, true), ctx.buckets);
    const tracked = rows.reduce((a, r) => a + r.secs, 0);
    const untracked = (to - from) - tracked; // future part of today, or before first use
    const slices = rows.map((r) => ({ label: r.bucket.name, secs: r.secs, color: r.bucket.color }));
    if (untracked > 0.5) slices.push({ label: "Untracked", secs: untracked, color: FT.UNTRACKED_COLOR });
    if (!tracked) return <FT.Empty />;
    const multi = Object.keys(FT.agg.sumByTask(ctx.sessions, from, to))
      .some((id) => ctx.buckets.keysOf(Number(id)).length > 1);
    return (
      <>
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
        {multi && <p className="note">Tasks with several tags are split evenly across them here, so the slices total 24h.</p>}
      </>
    );
  },
});
