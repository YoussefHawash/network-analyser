import type { ConnectionTraffic, ProcessTraffic, SortKey } from "./types";

export function formatRate(value: number) {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} MB/s`;
  return `${value.toFixed(1)} KB/s`;
}

export function formatBytes(valueInMb: number) {
  if (valueInMb >= 1024) return `${(valueInMb / 1024).toFixed(2)} GB`;
  return `${valueInMb.toFixed(1)} MB`;
}

export function formatUptime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function totalRate(p: ProcessTraffic) {
  return p.received + p.sent;
}

export function sortableProcessValue(p: ProcessTraffic, key: SortKey) {
  if (key === "received") return p.received;
  if (key === "sent") return p.sent;
  return totalRate(p);
}

export function sortableConnectionValue(c: ConnectionTraffic, key: SortKey) {
  if (key === "received") return c.received;
  if (key === "sent") return c.sent;
  return c.received + c.sent;
}

export function processIconLabel(p: ProcessTraffic) {
  return (p.icon || p.name.slice(0, 1) || "?").slice(0, 2).toUpperCase();
}

export function processIconClass(name: string) {
  const n = name.toLowerCase();
  if (n.includes("firefox")) return "app-firefox";
  if (n.includes("ssh")) return "app-terminal";
  if (n.includes("curl")) return "app-curl";
  if (n.includes("apt")) return "app-package";
  if (n.includes("docker")) return "app-docker";
  if (n.includes("resolve") || n.includes("systemd")) return "app-system";
  if (n.includes("python")) return "app-python";
  if (n.includes("node") || n.includes("vite")) return "app-node";
  return "app-generic";
}

export function nowTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
