import { useState } from "react";
import { formatRate } from "../lib/format";
import type { ConnectionTraffic, SortKey } from "../lib/types";

type Props = {
  connections: ConnectionTraffic[];
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
};

export function ConnectionTable({ connections, sortKey, onSortChange }: Props) {
  const [compact, setCompact] = useState(false);

  return (
    <section className={`panel table-panel connection-panel${compact ? " compact" : ""}`}>
      <div className="panel-header">
        <div>
          <div className="panel-title">Connections / Remote Hosts</div>
          <div className="panel-subtitle">IP, port, protocol, bandwidth, process, and user mapping</div>
        </div>
        <div className="panel-tools">
          <span className="sort-label">Sort by:</span>
          <select
            className="sort-select"
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
          >
            <option value="total">Total</option>
            <option value="received">Received</option>
            <option value="sent">Sent</option>
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

      <div className="table-wrap table-scroll connection-scroll">
        <table className="connection-table">
          <colgroup>
            <col className="col-remote" />
            <col className="col-port" />
            <col className="col-proto" />
            <col className="col-process" />
            <col className="col-user" />
            <col className="col-state" />
            <col className="col-rate" />
            <col className="col-rate" />
            <col className="col-rate" />
          </colgroup>
          <thead>
            <tr>
              <th>Remote IP / Host</th>
              <th>Port</th>
              <th>Proto</th>
              <th>Process (PID)</th>
              <th>User</th>
              <th>State</th>
              <th>Received</th>
              <th>Sent</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {connections.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={9}>
                  <div className="empty-state">No active connections match the current filters.</div>
                </td>
              </tr>
            ) : (
              connections.map((c) => <ConnectionRow key={connectionKey(c)} connection={c} />)
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConnectionRow({ connection }: { connection: ConnectionTraffic }) {
  const stateClass =
    connection.state === "ESTABLISHED" ? "established"
    : connection.state === "LISTEN" ? "listen"
    : "close-wait";

  const procLabel = `${connection.processName} (${connection.pid})`;

  return (
    <tr>
      <td>
        <span className="flag">{connection.flag}</span>{" "}
        <span className="total-val remote-cell" title={connection.remote}>{connection.remote}</span>
      </td>
      <td className="port-col">{connection.port}</td>
      <td><span className="protocol-badge">{connection.protocol}</span></td>
      <td className="proc-col" title={procLabel}>{procLabel}</td>
      <td className="user-col">{connection.user}</td>
      <td><span className={`state-badge ${stateClass}`}>{connection.state}</span></td>
      <td className="rx-val">{formatRate(connection.received)}</td>
      <td className="tx-val">{formatRate(connection.sent)}</td>
      <td className="total-val">{formatRate(connection.received + connection.sent)}</td>
    </tr>
  );
}

function connectionKey(c: ConnectionTraffic) {
  return `${c.pid}|${c.remote}|${c.port}|${c.protocol}`;
}
