import type {
  ConnectionTraffic,
  HistoryBucket,
  MonitorSnapshot,
  ProcessTraffic,
} from "./types";

const baseProcesses: Array<Omit<ProcessTraffic, "received" | "sent" | "history">> = [
  { pid: 1532, name: "firefox", icon: "F", user: "alice", protocol: "TCP" },
  { pid: 2451, name: "ssh", icon: "S", user: "bob", protocol: "TCP" },
  { pid: 3102, name: "curl", icon: "C", user: "root", protocol: "TCP" },
  { pid: 4120, name: "apt-get", icon: "A", user: "root", protocol: "TCP" },
  { pid: 5211, name: "docker", icon: "D", user: "alice", protocol: "TCP" },
  { pid: 876, name: "systemd-resolve", icon: "R", user: "system", protocol: "UDP" },
  { pid: 6642, name: "python-api", icon: "P", user: "bob", protocol: "TCP" },
  { pid: 7188, name: "node-vite", icon: "N", user: "alice", protocol: "TCP" },
];

const baseConnections: Array<Omit<ConnectionTraffic, "received" | "sent">> = [
  { remote: "142.250.72.14", flag: "US", port: 443, protocol: "TCP", processName: "firefox", pid: 1532, user: "alice", state: "ESTABLISHED" },
  { remote: "8.8.8.8", flag: "GL", port: 53, protocol: "UDP", processName: "systemd-resolve", pid: 876, user: "system", state: "ESTABLISHED" },
  { remote: "151.101.1.69", flag: "DE", port: 22, protocol: "TCP", processName: "ssh", pid: 2451, user: "bob", state: "ESTABLISHED" },
  { remote: "archive.ubuntu.com", flag: "GL", port: 80, protocol: "TCP", processName: "apt-get", pid: 4120, user: "root", state: "ESTABLISHED" },
  { remote: "registry-1.docker.io", flag: "US", port: 443, protocol: "TCP", processName: "docker", pid: 5211, user: "alice", state: "CLOSE_WAIT" },
  { remote: "10.0.2.2", flag: "LAN", port: 5173, protocol: "TCP", processName: "node-vite", pid: 7188, user: "alice", state: "LISTEN" },
];

export type MockOptions = {
  tick: number;
  interfaceName: string;
  historyRange: string;
  uptimeSeconds: number;
};

export function generateMockSnapshot(opts: MockOptions): MonitorSnapshot {
  const { tick, interfaceName, historyRange, uptimeSeconds } = opts;
  const interfaceFactor = interfaceName === "wlan0" ? 0.72 : interfaceName === "lo" ? 0.22 : 1;
  const activeCount = 5 + (tick % 4);

  const processes: ProcessTraffic[] = baseProcesses.slice(0, activeCount).map((process, i) => {
    const wave = Math.sin((tick + i) * 0.46) + Math.cos((tick + i * 2) * 0.21);
    const received = Math.max(0.1, (randomBetween(0.25, 7.8) + wave * 1.25) * interfaceFactor);
    const sent = Math.max(0.1, (randomBetween(0.15, 6.4) + Math.abs(wave) * 0.95) * interfaceFactor);
    return {
      ...process,
      received,
      sent,
      history: Array.from({ length: 7 }, (_, p) => {
        const value = received + sent + Math.sin((tick + p + i) * 0.8) * 2 + randomBetween(-1, 1);
        return Math.max(0.2, value);
      }),
    };
  });

  const processByName = new Map(processes.map((p) => [p.name, p]));
  const connections: ConnectionTraffic[] = baseConnections
    .filter((c) => processByName.has(c.processName))
    .map((c, i) => {
      const proc = processByName.get(c.processName);
      const share = 0.55 + ((tick + i) % 4) * 0.1;
      return {
        ...c,
        received: Math.max(0.05, (proc?.received ?? 1) * share + randomBetween(-0.25, 0.3)),
        sent: Math.max(0.05, (proc?.sent ?? 1) * share + randomBetween(-0.2, 0.35)),
      };
    });

  const receivedRate = processes.reduce((s, p) => s + p.received, 0);
  const sentRate = processes.reduce((s, p) => s + p.sent, 0);

  return {
    interfaceName,
    receivedRate,
    sentRate,
    receivedToday: 0.85 + tick * 0.018 + receivedRate / 120,
    sentToday: 0.56 + tick * 0.014 + sentRate / 140,
    uptimeSeconds,
    processes,
    connections,
    history: generateHistoryBuckets(tick, historyRange),
  };
}

function generateHistoryBuckets(tick: number, range: string): HistoryBucket[] {
  const count = range === "24h" ? 12 : range === "7d" ? 7 : 10;
  const multiplier = range === "24h" ? 1 : range === "7d" ? 8 : 26;

  return Array.from({ length: count }, (_, i) => {
    const received = (70 + Math.sin((tick + i) * 0.8) * 45 + randomBetween(0, 130)) * multiplier;
    const sent = (35 + Math.cos((tick + i) * 0.58) * 25 + randomBetween(0, 75)) * multiplier;
    const label =
      range === "24h" ? `${String(i * 2).padStart(2, "0")}:00`
      : range === "7d" ? `D${i + 1}`
      : `W${i + 1}`;
    return { label, received: Math.max(1, received), sent: Math.max(1, sent) };
  });
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}
