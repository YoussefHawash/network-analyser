import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateMockSnapshot } from "./mock";
import { sortableConnectionValue, sortableProcessValue, totalRate } from "./format";
import type {
  ConnectionTraffic,
  FilterState,
  MonitorSnapshot,
  ProcessTraffic,
} from "./types";

const USE_MOCK_DATA = true;
const MAX_TRAFFIC_POINTS = 34;

export type TrafficHistory = { received: number[]; sent: number[] };

export function useMonitor(filters: FilterState) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [trafficHistory, setTrafficHistory] = useState<TrafficHistory>(() => ({
    received: Array.from({ length: MAX_TRAFFIC_POINTS }, () => 2 + Math.random() * 11),
    sent: Array.from({ length: MAX_TRAFFIC_POINTS }, () => 1 + Math.random() * 8),
  }));

  const tickRef = useRef(0);
  const startedAt = useRef(performance.now());
  const pausedAccumulated = useRef(0);
  const pausedAt = useRef<number | null>(null);

  // Track pause edges so uptime stays accurate.
  useEffect(() => {
    if (filters.paused) {
      pausedAt.current = performance.now();
    } else if (pausedAt.current !== null) {
      pausedAccumulated.current += performance.now() - pausedAt.current;
      pausedAt.current = null;
    }
  }, [filters.paused]);

  useEffect(() => {
    if (filters.paused) return;

    let cancelled = false;

    const tick = async () => {
      tickRef.current += 1;
      const uptimeSeconds = getUptimeSeconds(startedAt.current, pausedAccumulated.current, pausedAt.current);
      const next = USE_MOCK_DATA
        ? generateMockSnapshot({
            tick: tickRef.current,
            interfaceName: filters.interfaceName,
            historyRange: filters.historyRange,
            uptimeSeconds,
          })
        : await invoke<MonitorSnapshot>("get_network_snapshot", {
            interfaceName: filters.interfaceName,
            timeRange: filters.timeRange,
            historyRange: filters.historyRange,
          });

      if (cancelled) return;
      setSnapshot(next);
      setTrafficHistory((prev) => pushTrafficPoint(prev, next.receivedRate, next.sentRate));
    };

    tick();
    const id = window.setInterval(tick, filters.refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [filters.paused, filters.refreshMs, filters.interfaceName, filters.timeRange, filters.historyRange]);

  const filteredProcesses = useMemo(
    () => (snapshot ? filterProcesses(snapshot.processes, filters) : []),
    [snapshot, filters],
  );

  const filteredConnections = useMemo(
    () => (snapshot ? filterConnections(snapshot.connections, filters) : []),
    [snapshot, filters],
  );

  return { snapshot, trafficHistory, filteredProcesses, filteredConnections };
}

function pushTrafficPoint(prev: TrafficHistory, rx: number, tx: number): TrafficHistory {
  const received = [...prev.received, rx].slice(-MAX_TRAFFIC_POINTS);
  const sent = [...prev.sent, tx].slice(-MAX_TRAFFIC_POINTS);
  return { received, sent };
}

function getUptimeSeconds(startedAt: number, accumulated: number, pausedAt: number | null) {
  const live = pausedAt !== null ? performance.now() - pausedAt : 0;
  return Math.max(0, Math.floor((performance.now() - startedAt - accumulated - live) / 1000));
}

function filterProcesses(processes: ProcessTraffic[], filters: FilterState) {
  return processes
    .filter((p) =>
      matches(p.name, p.pid, p.user, p.protocol, totalRate(p), p.received, p.sent, filters),
    )
    .sort((a, b) => sortableProcessValue(b, filters.processSort) - sortableProcessValue(a, filters.processSort));
}

function filterConnections(connections: ConnectionTraffic[], filters: FilterState) {
  return connections
    .filter((c) =>
      matches(c.processName, c.pid, c.user, c.protocol, c.received + c.sent, c.received, c.sent, filters),
    )
    .sort((a, b) => sortableConnectionValue(b, filters.connectionSort) - sortableConnectionValue(a, filters.connectionSort));
}

function matches(
  name: string,
  pid: number,
  user: string,
  protocol: string,
  total: number,
  rx: number,
  tx: number,
  f: FilterState,
) {
  const q = f.processQuery.trim().toLowerCase();
  const queryMatches = !q || name.toLowerCase().includes(q) || String(pid).includes(q);
  const userMatches = f.user === "all" || user === f.user;
  const protocolMatches = f.protocol === "all" || protocol === f.protocol;
  const rateMatches = total >= f.minRate;
  const directionMatches =
    f.direction === "all" ||
    (f.direction === "inbound" && rx >= tx) ||
    (f.direction === "outbound" && tx >= rx);
  return queryMatches && userMatches && protocolMatches && rateMatches && directionMatches;
}
