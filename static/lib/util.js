// Shared helpers: API client, time formatting, local-day math.
window.FT = window.FT || {};

(function (FT) {
  async function req(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  FT.api = {
    state: (dayStart, dayEnd) => req("GET", `/api/state?day_start=${dayStart}&day_end=${dayEnd}`),
    createTask: (name, color) => req("POST", "/api/tasks", { name, color }),
    updateTask: (id, patch) => req("PATCH", `/api/tasks/${id}`, patch),
    archiveTask: (id) => req("DELETE", `/api/tasks/${id}`),
    setTaskTags: (id, tagIds) => req("PUT", `/api/tasks/${id}/tags`, { tag_ids: tagIds }),
    createTag: (name, color) => req("POST", "/api/tags", { name, color }),
    updateTag: (id, patch) => req("PATCH", `/api/tags/${id}`, patch),
    deleteTag: (id) => req("DELETE", `/api/tags/${id}`),
    start: (id) => req("POST", `/api/start/${id}`),
    stop: () => req("POST", "/api/stop"),
    sessions: (from, to) => req("GET", `/api/sessions?from=${from}&to=${to}`),
  };

  const pad = (n) => String(n).padStart(2, "0");

  // 3725 -> "01:02:05"
  FT.hms = (secs) => {
    secs = Math.max(0, Math.floor(secs));
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`;
  };

  // 3725 -> "1h 2m 5s"
  FT.human = (secs) => {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const toEpoch = (d) => Math.floor(d.getTime() / 1000);

  // Local-midnight bounds of the day containing `date`: [start, end) epoch seconds.
  FT.dayRange = (date) => {
    const s = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const e = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return [toEpoch(s), toEpoch(e)];
  };

  // Monday-based week containing `date`: array of 7 {label, date, range}.
  FT.weekDays = (date) => {
    const offset = (date.getDay() + 6) % 7; // Mon=0
    const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return names.map((label, i) => {
      const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset + i);
      return { label, date: d, range: FT.dayRange(d) };
    });
  };

  FT.isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  FT.parseIsoDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  FT.PALETTE = ["#4f7cff", "#e8590c", "#2f9e44", "#ae3ec9", "#f59f00", "#1098ad", "#e64980", "#5c7cfa", "#74b816", "#d6336c"];
  FT.UNTRACKED_COLOR = "#d0d4d9";
  FT.UNTAGGED_COLOR = "#a3a9b1";

  // First palette color not already used by `items` (each with .color).
  FT.nextColor = (items) => {
    const used = new Set(items.map((x) => x.color));
    return FT.PALETTE.find((c) => !used.has(c)) || FT.PALETTE[items.length % FT.PALETTE.length];
  };
})(window.FT);
