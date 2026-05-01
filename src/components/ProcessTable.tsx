import { useState } from "react";
import { formatRate, processIconClass, processIconLabel, totalRate } from "../lib/format";
import type { ProcessTraffic, SortKey } from "../lib/types";
import { Sparkline } from "./Sparkline";

type Props = {
  processes: ProcessTraffic[];
  totalProcessCount: number;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
};

export function ProcessTable({ processes, totalProcessCount, sortKey, onSortChange }: Props) {
  const [compact, setCompact] = useState(false);

  return (
    <section className={`panel table-panel process-panel${compact ? " compact" : ""}`}>
      <div className="panel-header">
        <div>
          <div className="panel-title">Process Network Usage</div>
          <div className="panel-subtitle">Rows are rendered from the latest process array</div>
        </div>
        <div className="panel-tools">
          <span className="sort-label">Sort by:</span>
          <select
            className="sort-select"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
          >
            <option value="sent">Sent</option>
            <option value="received">Received</option>
            <option value="total">Total</option>
          </select>
          <button
            type="button"
            className="icon-btn"
            title="Toggle compact rows"
            aria-pressed={compact}
            onClick={() => setCompact((c) => !c)}
          >
            ≡
          </button>
        </div>
      </div>

      <div className="table-wrap table-scroll process-scroll">
        <table className="process-table">
          <colgroup>
            <col className="col-pid" />
            <col className="col-process" />
            <col className="col-user" />
            <col className="col-proto" />
            <col className="col-rate" />
            <col className="col-rate" />
            <col className="col-rate" />
            <col className="col-trend" />
          </colgroup>
          <thead>
            <tr>
              <th>PID</th>
              <th>Process</th>
              <th>User</th>
              <th>Proto</th>
              <th>Received</th>
              <th>Sent</th>
              <th>Total</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8}>
                  <div className="empty-state">No process traffic matches the current filters.</div>
                </td>
              </tr>
            ) : (
              processes.map((p) => <ProcessRow key={p.pid} process={p} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="table-footer">
        Showing {processes.length} of {totalProcessCount} active processes
      </div>
    </section>
  );
}

function ProcessRow({ process }: { process: ProcessTraffic }) {
  const trendColor = process.sent > process.received ? "#388bfd" : "#3fb950";
  return (
    <tr>
      <td className="pid-col">{process.pid}</td>
      <td>
        <div className="proc-name" title={process.name}>
          <span className={`proc-icon ${processIconClass(process.name)}`}>{processIconLabel(process)}</span>
          <span className="proc-label">{process.name}</span>
        </div>
      </td>
      <td className="user-col">{process.user}</td>
      <td><span className="protocol-badge">{process.protocol}</span></td>
      <td className="rx-val">{formatRate(process.received)}</td>
      <td className="tx-val">{formatRate(process.sent)}</td>
      <td className="total-val">{formatRate(totalRate(process))}</td>
      <td className="trend-cell">
        <Sparkline values={process.history} color={trendColor} />
      </td>
    </tr>
  );
}
