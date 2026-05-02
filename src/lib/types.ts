export type Direction = "all" | "inbound" | "outbound";
export type SortKey = "sent" | "received" | "total";

export type ProcessTraffic = {
  pid: number;
  name: string;
  user: string;
  flag: string;
  protocol: "TCP" | "UDP";
  received: number;
  sent: number;
  history: number[];
};

export type ConnectionTraffic = {
  remote: string;
  flag: string;
  port: number;
  protocol: "TCP" | "UDP";
  processName: string;
  pid: number;
  user: string;
  received: number;
  sent: number;
  state: string;
};

export type GroupedConnection = {
  remote: string;
  flag: string;
  port: string;
  protocol: string;
  processName: string;
  pid: string;
  user: string;
  state: string;
  received: number;
  sent: number;
};

export type HistoryBucket = {
  label: string;
  received: number;
  sent: number;
};

export type MonitorSnapshot = {
  availableInterfaces: string[];
  interfaceName: string;
  receivedRate: number;
  sentRate: number;
  receivedToday: number;
  sentToday: number;
  uptimeSeconds: number;
  processes: ProcessTraffic[];
  connections: ConnectionTraffic[];
  history: HistoryBucket[];
};

export type FilterState = {
  interfaceName: string;
  processQuery: string;
  user: string;
  protocol: string;
  direction: Direction;
  minRate: number;
  processSort: SortKey;
  connectionSort: SortKey;
  refreshMs: number;
  paused: boolean;
};

export const DEFAULT_FILTERS: FilterState = {
  interfaceName: "eth0",
  processQuery: "",
  user: "all",
  protocol: "all",
  direction: "all",
  minRate: 0,
  processSort: "sent",
  connectionSort: "total",
  refreshMs: 1000,
  paused: false,
};
