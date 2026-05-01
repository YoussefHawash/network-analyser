import { useCallback, useEffect, useRef, useState } from "react";
import { formatRate, nowTimestamp, totalRate } from "../lib/format";
import {
  DEFAULT_FILTERS,
  type EventTone,
  type FilterState,
} from "../lib/types";
import { useMonitor } from "../lib/useMonitor";
import { ConnectionTable } from "./ConnectionTable";
import { EventLog, type EventLogItem } from "./EventLog";
import { HistoryChart } from "./HistoryChart";
import { ProcessTable } from "./ProcessTable";
import { Sidebar } from "./Sidebar";
import { StatCards } from "./StatCards";
import { TitleBar } from "./TitleBar";
import { TrafficChart } from "./TrafficChart";

const INITIAL_EVENTS: EventLogItem[] = [
  {
    id: 1,
    time: "12:32:15",
    tone: "orange",
    html: '<strong>firefox (PID 1532)</strong> high bandwidth usage detected: <span class="ev-val">5.1 KB/s sent</span>',
  },
  {
    id: 2,
    time: "12:30:02",
    tone: "blue",
    html: '<strong>ssh connection established to</strong> <span class="ev-blue">151.101.1.69</span>',
  },
  {
    id: 3,
    time: "12:28:47",
    tone: "green",
    html: "Monitoring started on interface <strong>eth0</strong>",
  },
];

export function App() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<EventLogItem[]>(INITIAL_EVENTS);
  const lastEventSample = useRef<number | null>(null);

  const updateFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const addEvent = useCallback((tone: EventTone, html: string) => {
    setEvents((prev) =>
      [
        { id: (prev[0]?.id ?? 0) + 1, time: nowTimestamp(), tone, html },
        ...prev,
      ].slice(0, 12),
    );
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  const reset = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    addEvent(
      "green",
      "Controls reset to <strong>live dashboard defaults</strong>",
    );
  }, [addEvent]);

  const { snapshot, trafficHistory, filteredProcesses, filteredConnections } =
    useMonitor(filters);

  useEffect(() => {
    if (!snapshot || filters.paused) return;

    const sampleId = snapshot.uptimeSeconds;
    if (sampleId <= 0 || sampleId === lastEventSample.current) return;

    const loudest = snapshot.processes
      .slice()
      .sort((a, b) => totalRate(b) - totalRate(a))[0];

    if (
      loudest &&
      totalRate(loudest) >= filters.alertThreshold &&
      sampleId % 4 === 0
    ) {
      lastEventSample.current = sampleId;
      addEvent(
        "orange",
        `<strong>${loudest.name} (PID ${loudest.pid})</strong> crossed alert threshold: <span class="ev-val">${formatRate(
          totalRate(loudest),
        )}</span>`,
      );
    } else if (sampleId % 9 === 0) {
      lastEventSample.current = sampleId;
      addEvent(
        "blue",
        `<strong>${snapshot.interfaceName}</strong> sample refreshed with ${snapshot.processes.length} active processes`,
      );
    }
  }, [addEvent, filters.alertThreshold, filters.paused, snapshot]);

  return (
    <div className="app-shell">
      <TitleBar paused={filters.paused} />
      <main className="main">
        <Sidebar
          filters={filters}
          snapshot={snapshot}
          activeProcessCount={filteredProcesses.length}
          onChange={updateFilters}
          onReset={reset}
          onLogEvent={addEvent}
        />
        <section className="content">
          <StatCards
            snapshot={snapshot}
            processes={filteredProcesses}
            connections={filteredConnections}
          />

          <div className="mid-row">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Real-Time Traffic Flow</div>
                  <div className="panel-subtitle">Bandwidth (KB/s)</div>
                </div>
                <div className="legend">
                  <div className="legend-item">
                    <div
                      className="legend-line"
                      style={{ background: "#3fb950" }}
                    />{" "}
                    Inbound
                  </div>
                  <div className="legend-item">
                    <div
                      className="legend-line"
                      style={{ background: "#a78bfa" }}
                    />{" "}
                    Outbound
                  </div>
                </div>
              </div>
              <div className="canvas-wrap">
                <TrafficChart history={trafficHistory} />
              </div>
            </section>

            <ProcessTable
              processes={filteredProcesses}
              totalProcessCount={snapshot?.processes.length ?? 0}
              sortKey={filters.processSort}
              onSortChange={(processSort) => updateFilters({ processSort })}
            />
          </div>

          <div className="bottom-row">
            <ConnectionTable
              connections={filteredConnections}
              sortKey={filters.connectionSort}
              onSortChange={(connectionSort) =>
                updateFilters({ connectionSort })
              }
            />

            <section className="panel" id="history-panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Interface History</div>
                  <div className="panel-subtitle">
                    {historyLabel(filters.historyRange)} for{" "}
                    {filters.interfaceName}
                  </div>
                </div>
                <div className="legend">
                  <div className="legend-item">
                    <div
                      className="legend-line"
                      style={{
                        background: "#3fb950",
                        height: 10,
                        width: 10,
                        borderRadius: 2,
                      }}
                    />{" "}
                    Received
                  </div>
                  <div className="legend-item">
                    <div
                      className="legend-line"
                      style={{
                        background: "#a78bfa",
                        height: 10,
                        width: 10,
                        borderRadius: 2,
                      }}
                    />{" "}
                    Sent
                  </div>
                </div>
              </div>
              <div className="canvas-wrap">
                <HistoryChart buckets={snapshot?.history ?? []} />
              </div>
              <HistoryAxis
                labels={(snapshot?.history ?? []).map((b) => b.label)}
              />
            </section>
          </div>

          <EventLog events={events} onClear={clearEvents} />
        </section>
      </main>
    </div>
  );
}

function HistoryAxis({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return (
      <div className="history-axis">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    );
  }
  const ratios = [0, 0.25, 0.5, 0.75, 1];
  const picked = ratios.map(
    (r) =>
      labels[Math.min(labels.length - 1, Math.round((labels.length - 1) * r))],
  );
  return (
    <div className="history-axis">
      {picked.map((label, i) => (
        <span key={i}>{label}</span>
      ))}
    </div>
  );
}

function historyLabel(range: string) {
  if (range === "24h") return "Last 24 Hours";
  if (range === "7d") return "Last 7 Days";
  if (range === "30d") return "Last 30 Days";
  return "History";
}
