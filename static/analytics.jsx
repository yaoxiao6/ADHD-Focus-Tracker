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

    const shift = (n) => setDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));

    let body = <FT.Empty>Loading…</FT.Empty>;
    if (err) body = <div className="error">{err}</div>;
    else if (data) {
      const taskById = Object.fromEntries(data.tasks.map((t) => [t.id, t]));
      const ctx = { day, week, sessions: data.sessions, tasks: data.tasks, taskById, now: data.now, firstTs: data.first_ts };
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
          <div className="datepick">
            <button onClick={() => shift(-1)}>‹</button>
            <input type="date" value={FT.isoDate(date)} onChange={(e) => e.target.value && setDate(FT.parseIsoDate(e.target.value))} />
            <button onClick={() => shift(1)}>›</button>
            <button onClick={() => setDate(new Date())}>Today</button>
          </div>
          <span className="muted">
            Week {FT.isoDate(week[0].date)} → {FT.isoDate(week[6].date)}
          </span>
        </div>
        {body}
      </div>
    );
  };
})(window.FT);
