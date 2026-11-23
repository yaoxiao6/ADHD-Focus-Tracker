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
//   tasks:    all tasks incl. archived;  taskById: {id: task}
//   now, firstTs (first session ever, epoch secs)
(function (FT) {
  FT.analyses = [];
  FT.registerAnalysis = (a) => FT.analyses.push(a);
})(window.FT);
