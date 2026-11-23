// Timer view: one card per task; exactly one runs (Relax when nothing else does).
(function (FT) {
  const { useState } = React;

  function TaskCard({ task, secs, running, sessionSecs, onStart, onRename, onColor, onArchive }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(task.name);
    const isRelax = !!task.is_system;

    const commit = () => {
      setEditing(false);
      if (name.trim() && name.trim() !== task.name) onRename(name.trim());
      else setName(task.name);
    };

    return (
      <div
        className={"card" + (running ? " running" : "") + (isRelax ? " relax" : "")}
        style={{ "--task": task.color }}
        onClick={() => !running && !editing && onStart()}
        title={running ? "Running" : "Click to start"}
      >
        <div className="card-head">
          <label className="swatch" onClick={(e) => e.stopPropagation()} title="Change color">
            <input type="color" value={task.color} onChange={(e) => onColor(e.target.value)} />
          </label>
          {editing ? (
            <input
              className="rename"
              autoFocus
              value={name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") { setName(task.name); setEditing(false); }
              }}
            />
          ) : (
            <span className="name">{task.name}</span>
          )}
          {!isRelax && !editing && (
            <span className="actions" onClick={(e) => e.stopPropagation()}>
              <button className="icon" title="Rename" onClick={() => setEditing(true)}>✎</button>
              <button
                className="icon"
                title="Delete (history is kept)"
                onClick={() => confirm(`Delete "${task.name}"? Its history stays in analytics.`) && onArchive()}
              >✕</button>
            </span>
          )}
        </div>
        <div className="clock mono">{FT.hms(secs)}</div>
        <div className="sub">
          {running ? <>● running · this session {FT.hms(sessionSecs)}</> : <>today</>}
        </div>
      </div>
    );
  }

  function AddTask({ onAdd, nextColor }) {
    const [name, setName] = useState("");
    const submit = (e) => {
      e.preventDefault();
      if (name.trim()) onAdd(name.trim(), nextColor).then(() => setName(""));
    };
    return (
      <form className="card add" onSubmit={submit}>
        <input placeholder="New task…" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()}>Add</button>
      </form>
    );
  }

  FT.TimerView = function TimerView({ state, elapsed, act }) {
    const { tasks, running, today, now } = state;
    const runningSessionSecs = now - Math.max(running.start_ts, 0) + elapsed;
    const usedColors = new Set(tasks.map((t) => t.color));
    const nextColor = FT.PALETTE.find((c) => !usedColors.has(c)) || FT.PALETTE[tasks.length % FT.PALETTE.length];
    const runningTask = tasks.find((t) => t.id === running.task_id);

    return (
      <div>
        <div className="toolbar">
          <div className="now-playing">
            {runningTask && (
              <>
                <span className="dot" style={{ background: runningTask.color }} />
                <strong>{runningTask.name}</strong>
                <span className="mono muted"> {FT.hms(runningSessionSecs)}</span>
              </>
            )}
          </div>
          <button className="stop" disabled={runningTask && runningTask.is_system} onClick={() => act(FT.api.stop())}>
            ■ Stop all
          </button>
        </div>
        <div className="grid">
          {tasks.map((t) => {
            const isRunning = t.id === running.task_id;
            return (
              <TaskCard
                key={t.id}
                task={t}
                running={isRunning}
                secs={(today[t.id] || 0) + (isRunning ? elapsed : 0)}
                sessionSecs={runningSessionSecs}
                onStart={() => act(FT.api.start(t.id))}
                onRename={(name) => act(FT.api.updateTask(t.id, { name }))}
                onColor={(color) => act(FT.api.updateTask(t.id, { color }))}
                onArchive={() => act(FT.api.archiveTask(t.id))}
              />
            );
          })}
          <AddTask nextColor={nextColor} onAdd={(name, color) => act(FT.api.createTask(name, color))} />
        </div>
      </div>
    );
  };
})(window.FT);
