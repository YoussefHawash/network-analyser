import { formatRate } from "../lib/format";
import type {
  GroupedConnection,
  MonitorSnapshot,
  ProcessTraffic,
} from "../lib/types";

type Props = {
  snapshot: MonitorSnapshot | null;
  processes: ProcessTraffic[];
  connections: GroupedConnection[];
};

export function StatCards({ snapshot, processes, connections }: Props) {
  const userCount = new Set(processes.map((p) => p.user)).size;
  const hostCount = new Set(connections.map((c) => c.remote)).size;

  return (
    <div className="grid grid-cols-4 gap-2.5">
      <Card
        icon="↓"
        iconClass="bg-app-blueStrong/15"
        valueClass="text-app-blue"
        label="Total Received"
        value={formatRate(snapshot?.receivedRate ?? 0)}
      />
      <Card
        icon="↑"
        iconClass="bg-violet-500/15"
        valueClass="text-app-violet"
        label="Total Sent"
        value={formatRate(snapshot?.sentRate ?? 0)}
      />
      <Card
        icon="⊞"
        iconClass="bg-app-green/15"
        valueClass="text-app-green"
        label="Active Processes"
        value={String(processes.length)}
        sub={`${userCount} ${userCount === 1 ? "user" : "users"}`}
      />
      <Card
        icon="⊕"
        iconClass="bg-app-orange/15"
        valueClass="text-app-orange"
        label="Active Connections"
        value={String(connections.length)}
        sub={`${hostCount} remote ${hostCount === 1 ? "host" : "hosts"}`}
      />
    </div>
  );
}

type CardProps = {
  icon: string;
  iconClass: string;
  valueClass: string;
  label: string;
  value: string;
  sub?: string;
};

function Card({ icon, iconClass, valueClass, label, value, sub }: CardProps) {
  return (
    <article className="flex min-h-[86px] items-center gap-3 rounded-lg border border-app-line bg-app-surface px-4 py-3.5">
      <div
        className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-lg text-lg ${iconClass}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.6px] text-app-muted">
          {label}
        </div>
        <div
          className={`overflow-hidden text-ellipsis whitespace-nowrap text-[22px] font-bold leading-tight tabular-nums ${valueClass}`}
        >
          {value}
        </div>
        {sub && (
          <div className="mt-0.5 text-[11px] text-app-muted">{sub}</div>
        )}
      </div>
    </article>
  );
}
