// App shell: tabs, server state, 1-second tick.
(function (FT) {
  const { useState, useEffect, useCallback, useRef } = React;

  function App() {
    const [tab, setTab] = useState(() => {
      const fromHash = location.hash.slice(1);
      if (["timer", "history", "analytics"].includes(fromHash)) return fromHash;
      try { return localStorage.getItem("ft.tab") || "timer"; } catch { return "timer"; }
    });
    const [state, setState] = useState(null);
    const [err, setErr] = useState(null);
    const [, setTick] = useState(0);
    const fetchedAt = useRef(0);   // client clock when state arrived
    const dayKey = useRef("");

    const load = useCallback(async () => {
      const [s, e] = FT.dayRange(new Date());
      dayKey.current = String(s);
      try {
        const st = await FT.api.state(s, e);
        fetchedAt.current = Date.now() / 1000;
        setState(st);
        setErr(null);
      } catch (ex) {
        setErr("Can't reach the server. Is `python3 server.py` running?");
      }
    }, []);

    // Wrap a mutating API promise: show errors, then refresh state.
    const act = useCallback((p) => p.then(load, (ex) => { alert(ex.message); load(); }), [load]);

    useEffect(() => {
      load();
      const onFocus = () => document.visibilityState === "visible" && load();
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onFocus);
      const tick = setInterval(() => {
        setTick((t) => t + 1);
        if (String(FT.dayRange(new Date())[0]) !== dayKey.current) load(); // crossed midnight
      }, 1000);
      const resync = setInterval(load, 60000);
      return () => {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onFocus);
        clearInterval(tick);
        clearInterval(resync);
      };
    }, [load]);

    useEffect(() => {
      try { localStorage.setItem("ft.tab", tab); } catch {}
      history.replaceState(null, "", "#" + tab);
    }, [tab]);

    const elapsed = state ? Math.max(0, Math.floor(Date.now() / 1000 - fetchedAt.current)) : 0;

    // Browser tab title shows what's running.
    if (state) {
      const t = state.tasks.find((x) => x.id === state.running.task_id);
      const secs = state.now - state.running.start_ts + elapsed;
      document.title = t ? `${t.is_system ? "☕" : "▶"} ${t.name} ${FT.hms(secs)}` : "ADHD Focus Tracker";
    }

    return (
      <div className="app">
        <header>
          <h1>Focus</h1>
          <nav>
            <button className={tab === "timer" ? "on" : ""} onClick={() => setTab("timer")}>Timer</button>
            <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History</button>
            <button className={tab === "analytics" ? "on" : ""} onClick={() => setTab("analytics")}>Analytics</button>
          </nav>
        </header>
        {err && <div className="error">{err}</div>}
        <div className="layout">
          {state && <FT.TagSidebar tags={state.tags} tasks={state.tasks} act={act} />}
          <main>
            {state && tab === "timer" && <FT.TimerView state={state} elapsed={elapsed} act={act} />}
            {state && tab === "history" && <FT.HistoryView tasks={state.tasks} reload={load} refreshKey={state.now} />}
            {tab === "analytics" && <FT.AnalyticsView refreshKey={state && state.now} />}
          </main>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
})(window.FT);
