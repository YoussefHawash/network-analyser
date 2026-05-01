import { formatBytes, formatRate } from "../lib/format";
import type { ConnectionTraffic, MonitorSnapshot, ProcessTraffic } from "../lib/types";

type Props = {
  snapshot: MonitorSnapshot | null;
  processes: ProcessTraffic[];
  connections: ConnectionTraffic[];
};

export function StatCards({ snapshot, processes, connections }: Props) {
  const userCount = new Set(processes.map((p) => p.user)).size;
  const hostCount = new Set(connections.map((c) => c.remote)).size;

  return (
    <div className="stat-cards">
      <Card icon="↓" iconClass="ic-blue" valueClass="v-blue"
            label="Total Received"
            value={formatRate(snapshot?.receivedRate ?? 0)}
            sub={`${formatBytes(snapshot?.receivedToday ?? 0)} today`} />
      <Card icon="↑" iconClass="ic-purple" valueClass="v-purple"
            label="Total Sent"
            value={formatRate(snapshot?.sentRate ?? 0)}
            sub={`${formatBytes(snapshot?.sentToday ?? 0)} today`} />
      <Card icon="⊞" iconClass="ic-green" valueClass="v-green"
            label="Active Processes"
            value={String(processes.length)}
            sub={`${userCount} users`} />
      <Card icon="⊕" iconClass="ic-orange" valueClass="v-orange"
            label="Active Connections"
            value={String(connections.length)}
            sub={`${hostCount} remote hosts`} />
    </div>
  );
}

function Card(props: { icon: string; iconClass: string; valueClass: string; label: string; value: string; sub: string }) {
  return (
    <article className="stat-card">
      <div className={`stat-card-icon ${props.iconClass}`}>{props.icon}</div>
      <div className="stat-card-info">
        <div className="stat-card-label">{props.label}</div>
        <div className={`stat-card-value ${props.valueClass}`}>{props.value}</div>
        <div className="stat-card-sub">{props.sub}</div>
      </div>
    </article>
  );
}
