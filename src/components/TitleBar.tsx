type Props = { paused: boolean };

export function TitleBar({ paused }: Props) {
  return (
    <header className="titlebar">
      <div className="titlebar-logo">NM</div>
      <div className="titlebar-info">
        <h1>Linux Network Monitor &amp; Controller</h1>
        <p>Real-time Traffic · Process Correlation · System Insights</p>
      </div>
      <div className="titlebar-right">
        <div className={`status-dot${paused ? " paused" : ""}`}>
          <div className="dot" />
          <span>{paused ? "Monitoring Paused" : "Monitoring Active"}</span>
        </div>
      </div>
    </header>
  );
}
