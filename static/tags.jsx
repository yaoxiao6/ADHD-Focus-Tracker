// Tag sidebar (CRUD) and the per-card tag picker.
(function (FT) {
  const { useState } = React;

  function TagRow({ tag, count, act }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(tag.name);
    const commit = () => {
      setEditing(false);
      if (name.trim() && name.trim() !== tag.name) act(FT.api.updateTag(tag.id, { name: name.trim() }));
      else setName(tag.name);
    };
    return (
      <li className="tag-row" style={{ "--task": tag.color }}>
        <label className="swatch" title="Change color">
          <input type="color" value={tag.color} onChange={(e) => act(FT.api.updateTag(tag.id, { color: e.target.value }))} />
        </label>
        {editing ? (
          <input
            className="rename" autoFocus value={name}
            onChange={(e) => setName(e.target.value)} onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setName(tag.name); setEditing(false); }
            }}
          />
        ) : (
          <span className="name" onDoubleClick={() => setEditing(true)} title="Double-click to rename">{tag.name}</span>
        )}
        {!editing && <span className="count muted">{count}</span>}
        {!editing && (
          <span className="actions">
            <button className="icon" title="Rename" onClick={() => setEditing(true)}>✎</button>
            <button
              className="icon" title="Delete tag"
              onClick={() => confirm(`Delete tag "${tag.name}"? It is removed from every task, and analytics regroup that time.`) && act(FT.api.deleteTag(tag.id))}
            >✕</button>
          </span>
        )}
      </li>
    );
  }

  FT.TagSidebar = function TagSidebar({ tags, tasks, act }) {
    const [name, setName] = useState("");
    const counts = {};
    for (const t of tasks) for (const id of t.tag_ids || []) counts[id] = (counts[id] || 0) + 1;
    const submit = (e) => {
      e.preventDefault();
      if (name.trim()) act(FT.api.createTag(name.trim(), FT.nextColor(tags))).then(() => setName(""));
    };
    return (
      <aside className="sidebar">
        <h3>Tags</h3>
        <ul className="tag-list">
          {tags.map((g) => <TagRow key={g.id} tag={g} count={counts[g.id] || 0} act={act} />)}
          {!tags.length && <li className="muted small">No tags yet. Analytics group time by tag.</li>}
        </ul>
        <form className="tag-add" onSubmit={submit}>
          <input placeholder="New tag…" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={!name.trim()}>Add</button>
        </form>
      </aside>
    );
  };

  // Chips on a task card plus a "+" popover to toggle tags.
  FT.TagChips = function TagChips({ task, tags, act }) {
    const [open, setOpen] = useState(false);
    const byId = Object.fromEntries(tags.map((g) => [g.id, g]));
    const mine = (task.tag_ids || []).map((id) => byId[id]).filter(Boolean);
    const toggle = (id) => {
      const set = new Set(task.tag_ids || []);
      set.has(id) ? set.delete(id) : set.add(id);
      act(FT.api.setTaskTags(task.id, [...set]));
    };
    return (
      <div className="chips" onClick={(e) => e.stopPropagation()}>
        {mine.map((g) => (
          <span key={g.id} className="chip" style={{ "--chip": g.color }}>{g.name}</span>
        ))}
        <span className="picker">
          <button className="chip add-chip" title="Edit tags" onClick={() => setOpen(!open)}>
            {mine.length ? "±" : "+ tag"}
          </button>
          {open && (
            <>
              <div className="backdrop" onClick={() => setOpen(false)} />
              <div className="popover">
                {tags.length ? tags.map((g) => (
                  <label key={g.id} className="pick-row">
                    <input type="checkbox" checked={(task.tag_ids || []).includes(g.id)} onChange={() => toggle(g.id)} />
                    <span className="dot" style={{ background: g.color }} />
                    {g.name}
                  </label>
                )) : <div className="muted small">Create tags in the left panel first.</div>}
              </div>
            </>
          )}
        </span>
      </div>
    );
  };
})(window.FT);
