import type { ReactNode } from "react";
import { formatRate, formatUptime } from "../lib/format";
import type { Direction, EventTone, FilterState, MonitorSnapshot } from "../lib/types";

type Props = {
  filters: FilterState;
  snapshot: MonitorSnapshot | null;
  activeProcessCount: number;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  onLogEvent: (tone: EventTone, html: string) => void;
};

export function Sidebar({ filters, snapshot, activeProcessCount, onChange, onReset, onLogEvent }: Props) {
  const togglePause = () => onChange({ paused: !filters.paused });

  return (
    <aside className="sidebar">
      <section className="control-center" aria-label="Monitor controls">
        <div className="sidebar-heading">
          <div className="sidebar-section">Options</div>
          <div className="sidebar-note">All values for the single dashboard page</div>
        </div>

        <div className="control-block">
          <Row label="Time Range">
            <select
              className="control-select"
              value={filters.timeRange}
              onChange={(e) => onChange({ timeRange: e.target.value })}
            >
              <option value="live">Live (Real-time)</option>
              <option value="1h">Last 1 Hour</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
          </Row>
          <Row label="Interface">
            <select
              className="control-select"
              value={filters.interfaceName}
              onChange={(e) => {
                onChange({ interfaceName: e.target.value });
                onLogEvent("green", `Interface changed to <strong>${e.target.value}</strong>`);
              }}
            >
              <option value="eth0">eth0</option>
              <option value="wlan0">wlan0</option>
              <option value="docker0">docker0</option>
              <option value="lo">lo</option>
            </select>
          </Row>
        </div>

        <div className="control-block">
          <Row label="Process or PID">
            <input
              className="control-input"
              type="text"
              placeholder="firefox, ssh, 1532"
              value={filters.processQuery}
              onChange={(e) => onChange({ processQuery: e.target.value })}
            />
          </Row>
          <div className="control-grid">
            <Row label="User">
              <select
                className="control-select"
                value={filters.user}
                onChange={(e) => onChange({ user: e.target.value })}
              >
                <option value="all">All Users</option>
                <option value="alice">alice</option>
                <option value="bob">bob</option>
                <option value="root">root</option>
                <option value="system">system</option>
              </select>
            </Row>
            <Row label="Protocol">
              <select
                className="control-select"
                value={filters.protocol}
                onChange={(e) => onChange({ protocol: e.target.value })}
              >
                <option value="all">All</option>
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
              </select>
            </Row>
          </div>
          <Row label="Traffic Direction">
            <div className="segmented">
              {(["all", "inbound", "outbound"] as Direction[]).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  className={filters.direction === dir ? "active" : ""}
                  onClick={() => onChange({ direction: dir })}
                >
                  {dir === "all" ? "All" : dir === "inbound" ? "↓ In" : "↑ Out"}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Minimum Rate">
            <input
              className="control-input"
              type="number"
              min={0}
              step={0.5}
              value={filters.minRate}
              onChange={(e) => onChange({ minRate: Number(e.target.value) || 0 })}
            />
          </Row>
        </div>

        <div className="control-block">
          <Row label="History">
            <select
              className="control-select"
              value={filters.historyRange}
              onChange={(e) => onChange({ historyRange: e.target.value })}
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </Row>
        </div>

        <div className="control-block">
          <Row label="Refresh">
            <select
              className="control-select"
              value={filters.refreshMs}
              onChange={(e) => onChange({ refreshMs: Number(e.target.value) })}
            >
              <option value={500}>500 ms</option>
              <option value={1000}>1 sec</option>
              <option value={2000}>2 sec</option>
            </select>
          </Row>
          <Row label="Alert KB/s">
            <input
              className="control-input"
              type="number"
              min={1}
              step={1}
              value={filters.alertThreshold}
              onChange={(e) => onChange({ alertThreshold: Number(e.target.value) || 1 })}
            />
          </Row>
          <div className="filter-actions">
            <button
              type="button"
              className={`btn-primary${filters.paused ? " is-paused" : ""}`}
              onClick={togglePause}
            >
              {filters.paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className="btn-secondary" onClick={onReset}>
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="sidebar-status">
        <div className="sidebar-section">System Status</div>
        <StatRow label={<><span className="arrow-down">↓</span> Total RX Rate</>}
                 value={`↓ ${formatRate(snapshot?.receivedRate ?? 0)}`}
                 valueClass="arrow-down" />
        <StatRow label={<><span className="arrow-up">↑</span> Total TX Rate</>}
                 value={`↑ ${formatRate(snapshot?.sentRate ?? 0)}`}
                 valueClass="arrow-up" />
        <StatRow label="Active Processes" value={String(activeProcessCount)} />
        <StatRow label="Monitoring Uptime" value={formatUptime(snapshot?.uptimeSeconds ?? 0)} />
      </section>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="control-row">
      <label className="control-label">{label}</label>
      {children}
    </div>
  );
}

function StatRow({ label, value, valueClass }: { label: ReactNode; value: string; valueClass?: string }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className={`stat-val${valueClass ? ` ${valueClass}` : ""}`}>{value}</span>
    </div>
  );
}
