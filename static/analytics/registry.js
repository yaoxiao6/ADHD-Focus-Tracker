// Analysis registry. To add an analysis, create analytics/<name>.jsx that calls
//
//   FT.registerAnalysis({
//     id: "unique-id",
//     title: "Shown as card heading",
//     wide: false,              // optional: span the full row
//     Component: ({ ctx }) => <div>...</div>,
//   });
//
// and add a <script> tag for it in index.html. `ctx` contains:
//   day:      {date, range:[from,to]}         the selected local day
//   week:     [{label, date, range}] x 7     Mon..Sun containing that day
//   sessions: [{id, task_id, start_ts, end_ts, running}]  covering the week (open one ends at `now`)
//   tasks:    all tasks incl. archived (each has tag_ids);  taskById: {id: task}
//   tags:     all tags;  tagById: {id: tag}
//   buckets:  FT.agg.buildBuckets(tasks, tags): group-by-tag helper (see aggregate.js)
//   now, firstTs (first session ever, epoch secs)
(function (FT) {
  FT.analyses = [];
  FT.registerAnalysis = (a) => FT.analyses.push(a);
})(window.FT);
