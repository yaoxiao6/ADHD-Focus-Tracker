// <ChartCanvas config={...}/>: thin React wrapper around Chart.js.
(function (FT) {
  const { useRef, useEffect } = React;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  FT.chartTheme = () => ({
    text: cssVar("--muted"),
    grid: cssVar("--grid"),
    surface: cssVar("--surface"),
  });

  FT.ChartCanvas = function ChartCanvas({ config, height = 280 }) {
    const ref = useRef(null);
    useEffect(() => {
      const t = FT.chartTheme();
      Chart.defaults.color = t.text;
      Chart.defaults.borderColor = t.grid;
      Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      const chart = new Chart(ref.current, {
        ...config,
        options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options },
      });
      return () => chart.destroy();
    }, [JSON.stringify(config.data), config.type]);
    return <div style={{ position: "relative", height }}><canvas ref={ref} /></div>;
  };

  FT.Empty = ({ children }) => <div className="empty">{children || "No data for this period."}</div>;
})(window.FT);
