// <FT.DatePicker date={Date} onChange={fn}/>: ‹ [date] › Today
(function (FT) {
  FT.DatePicker = function DatePicker({ date, onChange }) {
    const shift = (n) => onChange(new Date(date.getFullYear(), date.getMonth(), date.getDate() + n));
    return (
      <div className="datepick">
        <button onClick={() => shift(-1)} title="Previous day">‹</button>
        <input type="date" value={FT.isoDate(date)} onChange={(e) => e.target.value && onChange(FT.parseIsoDate(e.target.value))} />
        <button onClick={() => shift(1)} title="Next day">›</button>
        <button onClick={() => onChange(new Date())}>Today</button>
      </div>
    );
  };
})(window.FT);
