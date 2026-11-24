// Analytics view: pick a day, load the week's sessions once, render every registered analysis.
(function (FT) {
  const { useState, useEffect, useMemo } = React;

  FT.AnalyticsView = function AnalyticsView({ refreshKey }) {
    const [date, setDate] = useState(() => new Date());
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);

    const week = useMemo(() => FT.weekDays(date), [date]);
    const day = useMemo(() => ({ date, range: FT.dayRange(date) }), [date]);

    useEffect(() => {
      FT.api.sessions(week[0].range[0], week[6].range[1]).then(setData, (e) => setErr(e.message));
    }, [week, refreshKey]);

    let body = <FT.Empty>Loading…</FT.Empty>;
    if (err) body = <div className="error">{err}</div>;
    else if (data) {
      const taskById = Object.fromEntries(data.tasks.map((t) => [t.id, t]));
      const tagById = Object.fromEntries(data.tags.map((t) => [t.id, t]));
      const ctx = {
        day, week, sessions: data.sessions,
        tasks: data.tasks, taskById, tags: data.tags, tagById,
        buckets: FT.agg.buildBuckets(data.tasks, data.tags),
        now: data.now, firstTs: data.first_ts,
      };
      body = (
        <div className="analyses">
          {FT.analyses.map((a) => (
            <section key={a.id} className={"panel" + (a.wide ? " wide" : "")}>
              <h3>{a.title}</h3>
              <a.Component ctx={ctx} />
            </section>
          ))}
        </div>
      );
    }

    return (
      <div>
        <div className="toolbar">
          <FT.DatePicker date={date} onChange={setDate} />
          <span className="muted">
            Week {FT.isoDate(week[0].date)} → {FT.isoDate(week[6].date)}
          </span>
        </div>
        {body}
      </div>
    );
  };
})(window.FT);
