import { invoke } from "@tauri-apps/api/core";

type Direction = "all" | "inbound" | "outbound";
type SortKey = "sent" | "received" | "total";

type ProcessTraffic = {
  pid: number;
  name: string;
  // The backend can send a short label, emoji, icon name, or leave this blank.
  // The frontend still chooses a stable badge style from the process name.
  icon: string;
  user: string;
  protocol: "TCP" | "UDP";
  received: number;
  sent: number;
  history: number[];
};

type ConnectionTraffic = {
  remote: string;
  flag: string;
  port: number;
  protocol: "TCP" | "UDP";
  processName: string;
  pid: number;
  user: string;
  received: number;
  sent: number;
  state: "ESTABLISHED" | "LISTEN" | "CLOSE_WAIT";
};

type HistoryBucket = {
  label: string;
  received: number;
  sent: number;
};

type EventLogItem = {
  id: number;
  time: string;
  tone: "orange" | "blue" | "green";
  html: string;
};

type MonitorSnapshot = {
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

type FilterState = {
  timeRange: string;
  interfaceName: string;
  processQuery: string;
  user: string;
  protocol: string;
  direction: Direction;
  minRate: number;
  processSort: SortKey;
  connectionSort: SortKey;
  historyRange: string;
  refreshMs: number;
  alertThreshold: number;
  paused: boolean;
};

const USE_MOCK_DATA = true;
const maxTrafficPoints = 34;
const trafficHistory = {
  received: Array.from({ length: maxTrafficPoints }, () => randomBetween(2, 13)),
  sent: Array.from({ length: maxTrafficPoints }, () => randomBetween(1, 9)),
};

const state: FilterState = {
  timeRange: "live",
  interfaceName: "eth0",
  processQuery: "",
  user: "all",
  protocol: "all",
  direction: "all",
  minRate: 0,
  processSort: "sent",
  connectionSort: "total",
  historyRange: "24h",
  refreshMs: 1000,
  alertThreshold: 18,
  paused: false,
};

let latestSnapshot: MonitorSnapshot | null = null;
let tick = 0;
let eventId = 4;
let timerId = 0;
let uptimeStartedAt = performance.now();
let pausedAccumulated = 0;
let pausedAt: number | null = null;

const events: EventLogItem[] = [
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
  {
    remote: "142.250.72.14",
    flag: "US",
    port: 443,
    protocol: "TCP",
    processName: "firefox",
    pid: 1532,
    user: "alice",
    state: "ESTABLISHED",
  },
  {
    remote: "8.8.8.8",
    flag: "GL",
    port: 53,
    protocol: "UDP",
    processName: "systemd-resolve",
    pid: 876,
    user: "system",
    state: "ESTABLISHED",
  },
  {
    remote: "151.101.1.69",
    flag: "DE",
    port: 22,
    protocol: "TCP",
    processName: "ssh",
    pid: 2451,
    user: "bob",
    state: "ESTABLISHED",
  },
  {
    remote: "archive.ubuntu.com",
    flag: "GL",
    port: 80,
    protocol: "TCP",
    processName: "apt-get",
    pid: 4120,
    user: "root",
    state: "ESTABLISHED",
  },
  {
    remote: "registry-1.docker.io",
    flag: "US",
    port: 443,
    protocol: "TCP",
    processName: "docker",
    pid: 5211,
    user: "alice",
    state: "CLOSE_WAIT",
  },
  {
    remote: "10.0.2.2",
    flag: "LAN",
    port: 5173,
    protocol: "TCP",
    processName: "node-vite",
    pid: 7188,
    user: "alice",
    state: "LISTEN",
  },
];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found");
}

app.innerHTML = `
  <div class="app-shell">
    <header class="titlebar">
      <div class="titlebar-logo">NM</div>
      <div class="titlebar-info">
        <h1>Linux Network Monitor &amp; Controller</h1>
        <p>Real-time Traffic &middot; Process Correlation &middot; System Insights</p>
      </div>
      <div class="titlebar-right">
        <div id="status-dot" class="status-dot"><div class="dot"></div><span id="monitor-status">Monitoring Active</span></div>
      </div>
    </header>

    <main class="main">
      <aside class="sidebar">
        <section class="control-center" aria-label="Monitor controls">
          <div class="sidebar-heading">
            <div class="sidebar-section">Options</div>
            <div class="sidebar-note">All values for the single dashboard page</div>
          </div>

          <div class="control-block">
            <div class="control-row">
              <label class="control-label" for="time-range">Time Range</label>
              <select id="time-range" class="control-select">
                <option value="live">Live (Real-time)</option>
                <option value="1h">Last 1 Hour</option>
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
              </select>
            </div>
            <div class="control-row">
              <label class="control-label" for="interface-select">Interface</label>
              <select id="interface-select" class="control-select">
                <option value="eth0">eth0</option>
                <option value="wlan0">wlan0</option>
                <option value="docker0">docker0</option>
                <option value="lo">lo</option>
              </select>
            </div>
          </div>

          <div class="control-block">
            <div class="control-row">
              <label class="control-label" for="process-filter">Process or PID</label>
              <input id="process-filter" class="control-input" type="text" placeholder="firefox, ssh, 1532" />
            </div>
            <div class="control-grid">
              <div class="control-row">
                <label class="control-label" for="user-filter">User</label>
                <select id="user-filter" class="control-select">
                  <option value="all">All Users</option>
                  <option value="alice">alice</option>
                  <option value="bob">bob</option>
                  <option value="root">root</option>
                  <option value="system">system</option>
                </select>
              </div>
              <div class="control-row">
                <label class="control-label" for="protocol-filter">Protocol</label>
                <select id="protocol-filter" class="control-select">
                  <option value="all">All</option>
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                </select>
              </div>
            </div>
            <div class="control-row">
              <label class="control-label">Traffic Direction</label>
              <div class="segmented" id="direction-buttons">
                <button type="button" class="active" data-direction="all">All</button>
                <button type="button" data-direction="inbound">&darr; In</button>
                <button type="button" data-direction="outbound">&uarr; Out</button>
              </div>
            </div>
            <div class="control-row">
              <label class="control-label" for="min-rate">Minimum Rate</label>
              <input id="min-rate" class="control-input" type="number" min="0" step="0.5" value="0" />
            </div>
          </div>

          <div class="control-block">
            <div class="control-row">
              <label class="control-label" for="history-range">History</label>
              <select id="history-range" class="control-select">
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>
            </div>
          </div>

          <div class="control-block">
            <div class="control-row">
              <label class="control-label" for="refresh-ms">Refresh</label>
              <select id="refresh-ms" class="control-select">
                <option value="500">500 ms</option>
                <option value="1000" selected>1 sec</option>
                <option value="2000">2 sec</option>
              </select>
            </div>
            <div class="control-row">
              <label class="control-label" for="alert-threshold">Alert KB/s</label>
              <input id="alert-threshold" class="control-input" type="number" min="1" step="1" value="18" />
            </div>
            <div class="filter-actions">
              <button id="pause-button" class="btn-primary" type="button">Pause</button>
              <button id="reset-button" class="btn-secondary" type="button">Reset</button>
            </div>
          </div>
        </section>

        <section class="sidebar-status">
          <div class="sidebar-section">System Status</div>
          <div class="stat-row">
            <span class="stat-label"><span class="arrow-down">&darr;</span> Total RX Rate</span>
            <span id="side-rx" class="stat-val arrow-down">0 KB/s</span>
          </div>
          <div class="stat-row">
            <span class="stat-label"><span class="arrow-up">&uarr;</span> Total TX Rate</span>
            <span id="side-tx" class="stat-val arrow-up">0 KB/s</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Active Processes</span>
            <span id="side-processes" class="stat-val">0</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Monitoring Uptime</span>
            <span id="side-uptime" class="stat-val">00:00:00</span>
          </div>
        </section>
      </aside>

      <section class="content">
        <div class="stat-cards">
          <article class="stat-card">
            <div class="stat-card-icon ic-blue">&darr;</div>
            <div class="stat-card-info">
              <div class="stat-card-label">Total Received</div>
              <div id="card-rx" class="stat-card-value v-blue">0 KB/s</div>
              <div id="card-rx-sub" class="stat-card-sub">0 MB today</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-card-icon ic-purple">&uarr;</div>
            <div class="stat-card-info">
              <div class="stat-card-label">Total Sent</div>
              <div id="card-tx" class="stat-card-value v-purple">0 KB/s</div>
              <div id="card-tx-sub" class="stat-card-sub">0 MB today</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-card-icon ic-green">&#8862;</div>
            <div class="stat-card-info">
              <div class="stat-card-label">Active Processes</div>
              <div id="card-processes" class="stat-card-value v-green">0</div>
              <div id="card-users" class="stat-card-sub">0 users</div>
            </div>
          </article>
          <article class="stat-card">
            <div class="stat-card-icon ic-orange">&#8853;</div>
            <div class="stat-card-info">
              <div class="stat-card-label">Active Connections</div>
              <div id="card-connections" class="stat-card-value v-orange">0</div>
              <div id="card-hosts" class="stat-card-sub">0 remote hosts</div>
            </div>
          </article>
        </div>

        <div class="mid-row">
          <section class="panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Real-Time Traffic Flow</div>
                <div class="panel-subtitle">Bandwidth (KB/s)</div>
              </div>
              <div class="legend">
                <div class="legend-item"><div class="legend-line" style="background:#3fb950"></div> Inbound</div>
                <div class="legend-item"><div class="legend-line" style="background:#a78bfa"></div> Outbound</div>
              </div>
            </div>
            <div class="canvas-wrap">
              <canvas id="traffic-chart" width="520" height="190"></canvas>
            </div>
          </section>

          <section class="panel table-panel process-panel" id="process-panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Process Network Usage</div>
                <div class="panel-subtitle">Rows are rendered from the latest process array</div>
              </div>
              <div class="panel-tools">
                <span class="sort-label">Sort by:</span>
                <select id="process-sort" class="sort-select">
                  <option value="sent">Sent</option>
                  <option value="received">Received</option>
                  <option value="total">Total</option>
                </select>
                <button id="process-density" class="icon-btn" type="button" title="Toggle compact rows" aria-pressed="false">&#8801;</button>
              </div>
            </div>
            <div class="table-wrap table-scroll process-scroll">
              <table class="process-table">
                <colgroup>
                  <col class="col-pid" />
                  <col class="col-process" />
                  <col class="col-user" />
                  <col class="col-proto" />
                  <col class="col-rate" />
                  <col class="col-rate" />
                  <col class="col-rate" />
                  <col class="col-trend" />
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
                <tbody id="process-body"></tbody>
              </table>
            </div>
            <div id="process-footer" class="table-footer">Showing 0 active processes</div>
          </section>
        </div>

        <div class="bottom-row">
          <section class="panel table-panel connection-panel" id="connection-panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Connections / Remote Hosts</div>
                <div class="panel-subtitle">IP, port, protocol, bandwidth, process, and user mapping</div>
              </div>
              <div class="panel-tools">
                <span class="sort-label">Sort by:</span>
                <select id="connection-sort" class="sort-select">
                  <option value="total">Total</option>
                  <option value="received">Received</option>
                  <option value="sent">Sent</option>
                </select>
                <button id="connection-density" class="icon-btn" type="button" title="Toggle compact rows" aria-pressed="false">&#8801;</button>
              </div>
            </div>
            <div class="table-wrap table-scroll connection-scroll">
              <table class="connection-table">
                <colgroup>
                  <col class="col-remote" />
                  <col class="col-port" />
                  <col class="col-proto" />
                  <col class="col-process" />
                  <col class="col-user" />
                  <col class="col-state" />
                  <col class="col-rate" />
                  <col class="col-rate" />
                  <col class="col-rate" />
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
                <tbody id="connection-body"></tbody>
              </table>
            </div>
          </section>

          <section class="panel" id="history-panel">
            <div class="panel-header">
              <div>
                <div class="panel-title">Interface History</div>
                <div id="history-subtitle" class="panel-subtitle">Generated vnStat-style buckets</div>
              </div>
              <div class="legend">
                <div class="legend-item"><div class="legend-line" style="background:#3fb950;height:10px;width:10px;border-radius:2px"></div> Received</div>
                <div class="legend-item"><div class="legend-line" style="background:#a78bfa;height:10px;width:10px;border-radius:2px"></div> Sent</div>
              </div>
            </div>
            <div class="canvas-wrap">
              <canvas id="history-chart" width="420" height="170"></canvas>
            </div>
            <div class="history-axis">
              <span id="axis-a">00:00</span>
              <span id="axis-b">06:00</span>
              <span id="axis-c">12:00</span>
              <span id="axis-d">18:00</span>
              <span id="axis-e">24:00</span>
            </div>
          </section>
        </div>

        <section class="event-panel">
          <div class="panel-header">
            <div class="panel-title">Event Log</div>
            <button id="clear-events" class="clear-btn" type="button">Clear Log</button>
          </div>
          <div id="event-list" class="event-list"></div>
        </section>
      </section>
    </main>
  </div>
`;

const elements = {
  interfaceSelect: getSelect("interface-select"),
  timeRange: getSelect("time-range"),
  processFilter: getInput("process-filter"),
  userFilter: getSelect("user-filter"),
  protocolFilter: getSelect("protocol-filter"),
  minRate: getInput("min-rate"),
  processSort: getSelect("process-sort"),
  connectionSort: getSelect("connection-sort"),
  historyRange: getSelect("history-range"),
  refreshMs: getSelect("refresh-ms"),
  alertThreshold: getInput("alert-threshold"),
  pauseButton: getButton("pause-button"),
  resetButton: getButton("reset-button"),
  clearEvents: getButton("clear-events"),
  processDensity: getButton("process-density"),
  connectionDensity: getButton("connection-density"),
  processPanel: byId("process-panel"),
  connectionPanel: byId("connection-panel"),
  statusDot: byId("status-dot"),
  directionButtons: document.querySelectorAll<HTMLButtonElement>("#direction-buttons button"),
  trafficChart: getCanvas("traffic-chart"),
  historyChart: getCanvas("history-chart"),
};

const processRowCache = new Map<number, HTMLTableRowElement>();
const connectionRowCache = new Map<string, HTMLTableRowElement>();

syncControlsFromState();
bindControls();
setupCanvasResize();
startLoop();
refresh();

function bindControls() {
  elements.interfaceSelect.addEventListener("change", () => {
    state.interfaceName = elements.interfaceSelect.value;
    addEvent("green", `Interface changed to <strong>${state.interfaceName}</strong>`);
    refresh();
  });

  elements.timeRange.addEventListener("change", () => {
    state.timeRange = elements.timeRange.value;
    refresh();
  });

  elements.processFilter.addEventListener("input", () => {
    state.processQuery = elements.processFilter.value.trim().toLowerCase();
    render();
  });

  elements.userFilter.addEventListener("change", () => {
    state.user = elements.userFilter.value;
    render();
  });

  elements.protocolFilter.addEventListener("change", () => {
    state.protocol = elements.protocolFilter.value;
    render();
  });

  elements.minRate.addEventListener("input", () => {
    state.minRate = Number(elements.minRate.value) || 0;
    render();
  });

  elements.processSort.addEventListener("change", () => {
    state.processSort = elements.processSort.value as SortKey;
    render();
  });

  elements.connectionSort.addEventListener("change", () => {
    state.connectionSort = elements.connectionSort.value as SortKey;
    render();
  });

  elements.historyRange.addEventListener("change", () => {
    state.historyRange = elements.historyRange.value;
    refresh();
  });

  elements.refreshMs.addEventListener("change", () => {
    state.refreshMs = Number(elements.refreshMs.value);
    startLoop();
    render();
  });

  elements.alertThreshold.addEventListener("input", () => {
    state.alertThreshold = Number(elements.alertThreshold.value) || 1;
  });

  elements.pauseButton.addEventListener("click", () => {
    setPaused(!state.paused);
  });

  elements.resetButton.addEventListener("click", () => {
    resetControls();
    render();
  });

  elements.clearEvents.addEventListener("click", () => {
    events.length = 0;
    renderEvents();
  });

  elements.processDensity.addEventListener("click", () => {
    const compact = elements.processPanel.classList.toggle("compact");
    elements.processDensity.setAttribute("aria-pressed", String(compact));
  });

  elements.connectionDensity.addEventListener("click", () => {
    const compact = elements.connectionPanel.classList.toggle("compact");
    elements.connectionDensity.setAttribute("aria-pressed", String(compact));
  });

  elements.directionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.direction = button.dataset.direction as Direction;
      elements.directionButtons.forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearInterval(timerId);
      timerId = 0;
    } else if (!state.paused) {
      startLoop();
    }
  });
}

function setPaused(paused: boolean) {
  if (paused === state.paused) {
    return;
  }

  state.paused = paused;

  if (paused) {
    pausedAt = performance.now();
    window.clearInterval(timerId);
    timerId = 0;
  } else {
    if (pausedAt !== null) {
      pausedAccumulated += performance.now() - pausedAt;
      pausedAt = null;
    }
    startLoop();
  }

  elements.pauseButton.textContent = paused ? "Resume" : "Pause";
  elements.pauseButton.classList.toggle("is-paused", paused);
  elements.statusDot.classList.toggle("paused", paused);
  byId("monitor-status").textContent = paused ? "Monitoring Paused" : "Monitoring Active";
  render();
}

function startLoop() {
  window.clearInterval(timerId);
  if (state.paused) {
    timerId = 0;
    return;
  }
  timerId = window.setInterval(refresh, state.refreshMs);
}

function syncControlsFromState() {
  elements.timeRange.value = state.timeRange;
  elements.interfaceSelect.value = state.interfaceName;
  elements.processFilter.value = state.processQuery;
  elements.userFilter.value = state.user;
  elements.protocolFilter.value = state.protocol;
  elements.minRate.value = String(state.minRate);
  elements.processSort.value = state.processSort;
  elements.connectionSort.value = state.connectionSort;
  elements.historyRange.value = state.historyRange;
  elements.refreshMs.value = String(state.refreshMs);
  elements.alertThreshold.value = String(state.alertThreshold);
  elements.directionButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.direction === state.direction);
  });
}

async function refresh() {
  latestSnapshot = await fetchMonitorSnapshot();
  render();
}

async function fetchMonitorSnapshot(): Promise<MonitorSnapshot> {
  if (USE_MOCK_DATA) {
    return generateMockSnapshot();
  }

  // Backend replacement point:
  // Have the Tauri backend expose a get_network_snapshot command returning MonitorSnapshot.
  // Filtering, sorting, direction selection, minimum rate, and table rendering all
  // stay in this frontend, so the backend only has to return fresh raw data.
  return invoke<MonitorSnapshot>("get_network_snapshot", {
    interfaceName: state.interfaceName,
    timeRange: state.timeRange,
    historyRange: state.historyRange,
  });
}

function generateMockSnapshot(): MonitorSnapshot {
  tick += 1;

  const interfaceFactor = state.interfaceName === "wlan0" ? 0.72 : state.interfaceName === "lo" ? 0.22 : 1;
  const activeCount = 5 + (tick % 4);
  const processes = baseProcesses.slice(0, activeCount).map((process, index) => {
    const wave = Math.sin((tick + index) * 0.46) + Math.cos((tick + index * 2) * 0.21);
    const received = Math.max(0.1, (randomBetween(0.25, 7.8) + wave * 1.25) * interfaceFactor);
    const sent = Math.max(0.1, (randomBetween(0.15, 6.4) + Math.abs(wave) * 0.95) * interfaceFactor);

    return {
      ...process,
      received,
      sent,
      history: Array.from({ length: 7 }, (_, point) => {
        const value = received + sent + Math.sin((tick + point + index) * 0.8) * 2 + randomBetween(-1, 1);
        return Math.max(0.2, value);
      }),
    };
  });

  const processByName = new Map(processes.map((process) => [process.name, process]));
  const connections = baseConnections
    .filter((connection) => processByName.has(connection.processName))
    .map((connection, index) => {
      const process = processByName.get(connection.processName);
      const share = 0.55 + ((tick + index) % 4) * 0.1;

      return {
        ...connection,
        received: Math.max(0.05, (process?.received ?? 1) * share + randomBetween(-0.25, 0.3)),
        sent: Math.max(0.05, (process?.sent ?? 1) * share + randomBetween(-0.2, 0.35)),
      };
    });

  const receivedRate = sum(processes.map((process) => process.received));
  const sentRate = sum(processes.map((process) => process.sent));
  trafficHistory.received.push(receivedRate);
  trafficHistory.sent.push(sentRate);
  trafficHistory.received.splice(0, Math.max(0, trafficHistory.received.length - maxTrafficPoints));
  trafficHistory.sent.splice(0, Math.max(0, trafficHistory.sent.length - maxTrafficPoints));

  maybeAddAlert(processes);

  return {
    interfaceName: state.interfaceName,
    receivedRate,
    sentRate,
    receivedToday: 0.85 + tick * 0.018 + receivedRate / 120,
    sentToday: 0.56 + tick * 0.014 + sentRate / 140,
    uptimeSeconds: getUptimeSeconds(),
    processes,
    connections,
    history: generateHistoryBuckets(),
  };
}

function getUptimeSeconds() {
  const liveOffset = pausedAt !== null ? performance.now() - pausedAt : 0;
  const elapsedMs = performance.now() - uptimeStartedAt - pausedAccumulated - liveOffset;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

function maybeAddAlert(processes: ProcessTraffic[]) {
  const loudest = [...processes].sort((a, b) => totalRate(b) - totalRate(a))[0];

  if (loudest && totalRate(loudest) >= state.alertThreshold && tick % 4 === 0) {
    addEvent(
      "orange",
      `<strong>${loudest.name} (PID ${loudest.pid})</strong> crossed alert threshold: <span class="ev-val">${formatRate(
        totalRate(loudest),
      )}</span>`,
    );
  } else if (tick % 9 === 0) {
    addEvent("blue", `<strong>${state.interfaceName}</strong> sample refreshed with ${processes.length} active processes`);
  }
}

function generateHistoryBuckets(): HistoryBucket[] {
  const count = state.historyRange === "24h" ? 12 : state.historyRange === "7d" ? 7 : 10;
  const multiplier = state.historyRange === "24h" ? 1 : state.historyRange === "7d" ? 8 : 26;

  return Array.from({ length: count }, (_, index) => {
    const received = (70 + Math.sin((tick + index) * 0.8) * 45 + randomBetween(0, 130)) * multiplier;
    const sent = (35 + Math.cos((tick + index) * 0.58) * 25 + randomBetween(0, 75)) * multiplier;
    const label =
      state.historyRange === "24h"
        ? `${String(index * 2).padStart(2, "0")}:00`
        : state.historyRange === "7d"
          ? `D${index + 1}`
          : `W${index + 1}`;

    return {
      label,
      received: Math.max(1, received),
      sent: Math.max(1, sent),
    };
  });
}

function render() {
  if (!latestSnapshot) {
    return;
  }

  const filteredProcesses = filterProcesses(latestSnapshot.processes);
  const filteredConnections = filterConnections(latestSnapshot.connections);

  renderCards(latestSnapshot, filteredProcesses, filteredConnections);
  renderSummary();
  renderProcessTable(filteredProcesses, latestSnapshot.processes.length);
  renderConnectionTable(filteredConnections);
  renderEvents();
  drawTrafficChart(elements.trafficChart, trafficHistory.received, trafficHistory.sent);
  drawHistoryChart(elements.historyChart, latestSnapshot.history);
  renderHistoryAxis(latestSnapshot.history);
}

function renderCards(
  snapshot: MonitorSnapshot,
  filteredProcesses: ProcessTraffic[],
  filteredConnections: ConnectionTraffic[],
) {
  byId("card-rx").textContent = formatRate(snapshot.receivedRate);
  byId("card-tx").textContent = formatRate(snapshot.sentRate);
  byId("card-rx-sub").textContent = `${formatBytes(snapshot.receivedToday)} today`;
  byId("card-tx-sub").textContent = `${formatBytes(snapshot.sentToday)} today`;
  byId("card-processes").textContent = String(filteredProcesses.length);
  byId("card-users").textContent = `${new Set(filteredProcesses.map((process) => process.user)).size} users`;
  byId("card-connections").textContent = String(filteredConnections.length);
  byId("card-hosts").textContent = `${new Set(filteredConnections.map((connection) => connection.remote)).size} remote hosts`;

  byId("side-rx").textContent = `\u2193 ${formatRate(snapshot.receivedRate)}`;
  byId("side-tx").textContent = `\u2191 ${formatRate(snapshot.sentRate)}`;
  byId("side-processes").textContent = String(filteredProcesses.length);
  byId("side-uptime").textContent = formatUptime(snapshot.uptimeSeconds);
}

function renderSummary() {
  byId("history-subtitle").textContent = `${elements.historyRange.selectedOptions[0]?.textContent ?? "History"} for ${
    state.interfaceName
  }`;
}

function renderProcessTable(processes: ProcessTraffic[], totalProcesses: number) {
  const body = byId("process-body");

  if (processes.length === 0) {
    processRowCache.clear();
    body.innerHTML = `<tr class="empty-row"><td colspan="8"><div class="empty-state">No process traffic matches the current filters.</div></td></tr>`;
  } else {
    const seen = new Set<number>();
    processes.forEach((process, index) => {
      seen.add(process.pid);
      const row = ensureProcessRow(process);
      updateProcessRow(row, process);
      if (body.children[index] !== row) {
        body.insertBefore(row, body.children[index] ?? null);
      }
    });

    while (body.children.length > processes.length) {
      body.removeChild(body.lastChild as Node);
    }

    for (const [pid] of processRowCache) {
      if (!seen.has(pid)) {
        processRowCache.delete(pid);
      }
    }
  }

  byId("process-footer").textContent = `Showing ${processes.length} of ${totalProcesses} active processes`;
}

function ensureProcessRow(process: ProcessTraffic) {
  const cached = processRowCache.get(process.pid);
  if (cached) {
    return cached;
  }

  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="pid-col"></td>
    <td>
      <div class="proc-name">
        <span class="proc-icon" aria-hidden="true"></span>
        <span class="proc-label"></span>
      </div>
    </td>
    <td class="user-col"></td>
    <td><span class="protocol-badge"></span></td>
    <td class="rx-val"></td>
    <td class="tx-val"></td>
    <td class="total-val"></td>
    <td class="trend-cell"></td>
  `;
  processRowCache.set(process.pid, row);
  return row;
}

function updateProcessRow(row: HTMLTableRowElement, process: ProcessTraffic) {
  const pidCell = row.children[0] as HTMLElement;
  const nameWrap = row.children[1].firstElementChild as HTMLElement;
  const icon = nameWrap.querySelector(".proc-icon") as HTMLElement;
  const label = nameWrap.querySelector(".proc-label") as HTMLElement;
  const user = row.children[2] as HTMLElement;
  const protocol = row.children[3].firstElementChild as HTMLElement;
  const rx = row.children[4] as HTMLElement;
  const tx = row.children[5] as HTMLElement;
  const total = row.children[6] as HTMLElement;
  const trend = row.children[7] as HTMLElement;

  pidCell.textContent = String(process.pid);
  nameWrap.title = process.name;
  const iconClass = `proc-icon ${processIconClass(process.name)}`;
  if (icon.className !== iconClass) {
    icon.className = iconClass;
  }
  icon.textContent = processIconLabel(process);
  label.textContent = process.name;
  user.textContent = process.user;
  protocol.textContent = process.protocol;
  rx.textContent = formatRate(process.received);
  tx.textContent = formatRate(process.sent);
  total.textContent = formatRate(totalRate(process));
  trend.innerHTML = renderSparkline(process.history, process.sent > process.received ? "#388bfd" : "#3fb950");
}

function renderConnectionTable(connections: ConnectionTraffic[]) {
  const body = byId("connection-body");

  if (connections.length === 0) {
    connectionRowCache.clear();
    body.innerHTML = `<tr class="empty-row"><td colspan="9"><div class="empty-state">No active connections match the current filters.</div></td></tr>`;
    return;
  }

  const seen = new Set<string>();
  connections.forEach((connection, index) => {
    const key = connectionKey(connection);
    seen.add(key);
    const row = ensureConnectionRow(key);
    updateConnectionRow(row, connection);
    if (body.children[index] !== row) {
      body.insertBefore(row, body.children[index] ?? null);
    }
  });

  while (body.children.length > connections.length) {
    body.removeChild(body.lastChild as Node);
  }

  for (const [key] of connectionRowCache) {
    if (!seen.has(key)) {
      connectionRowCache.delete(key);
    }
  }
}

function ensureConnectionRow(key: string) {
  const cached = connectionRowCache.get(key);
  if (cached) {
    return cached;
  }

  const row = document.createElement("tr");
  row.innerHTML = `
    <td><span class="flag"></span> <span class="total-val remote-cell"></span></td>
    <td class="port-col"></td>
    <td><span class="protocol-badge"></span></td>
    <td class="proc-col"></td>
    <td class="user-col"></td>
    <td><span class="state-badge"></span></td>
    <td class="rx-val"></td>
    <td class="tx-val"></td>
    <td class="total-val"></td>
  `;
  connectionRowCache.set(key, row);
  return row;
}

function updateConnectionRow(row: HTMLTableRowElement, connection: ConnectionTraffic) {
  const remoteCell = row.children[0] as HTMLElement;
  const flag = remoteCell.querySelector(".flag") as HTMLElement;
  const remote = remoteCell.querySelector(".remote-cell") as HTMLElement;
  const port = row.children[1] as HTMLElement;
  const protocol = row.children[2].firstElementChild as HTMLElement;
  const proc = row.children[3] as HTMLElement;
  const user = row.children[4] as HTMLElement;
  const stateBadge = row.children[5].firstElementChild as HTMLElement;
  const rx = row.children[6] as HTMLElement;
  const tx = row.children[7] as HTMLElement;
  const total = row.children[8] as HTMLElement;

  flag.textContent = connection.flag;
  remote.textContent = connection.remote;
  remote.title = connection.remote;
  port.textContent = String(connection.port);
  protocol.textContent = connection.protocol;
  const procLabel = `${connection.processName} (${connection.pid})`;
  proc.textContent = procLabel;
  proc.title = procLabel;
  user.textContent = connection.user;
  stateBadge.textContent = connection.state;
  stateBadge.classList.toggle("established", connection.state === "ESTABLISHED");
  stateBadge.classList.toggle("listen", connection.state === "LISTEN");
  stateBadge.classList.toggle("close-wait", connection.state === "CLOSE_WAIT");
  rx.textContent = formatRate(connection.received);
  tx.textContent = formatRate(connection.sent);
  total.textContent = formatRate(connection.received + connection.sent);
}

function connectionKey(connection: ConnectionTraffic) {
  return `${connection.pid}|${connection.remote}|${connection.port}|${connection.protocol}`;
}

function renderEvents() {
  const list = byId("event-list");

  if (events.length === 0) {
    list.innerHTML = `<div class="empty-state">No events logged.</div>`;
    return;
  }

  list.innerHTML = events
    .slice(0, 8)
    .map(
      (event) => `
        <div class="event-row">
          <span class="event-time">${event.time}</span>
          <div class="event-dot ed-${event.tone}"></div>
          <span class="event-text">${event.html}</span>
        </div>
      `,
    )
    .join("");
}

function setupCanvasResize() {
  const handle = () => {
    if (latestSnapshot) {
      drawTrafficChart(elements.trafficChart, trafficHistory.received, trafficHistory.sent);
      drawHistoryChart(elements.historyChart, latestSnapshot.history);
    }
  };
  window.addEventListener("resize", handle);
}

function prepareCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.floor(rect.width));
  const cssHeight = Math.max(1, Math.floor(rect.height || canvas.height));
  const targetWidth = Math.round(cssWidth * dpr);
  const targetHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  canvas.style.height = `${cssHeight}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawTrafficChart(canvas: HTMLCanvasElement, received: number[], sent: number[]) {
  const surface = prepareCanvas(canvas);
  if (!surface) {
    return;
  }

  const { ctx, width, height } = surface;
  const maxValue = Math.max(12, ...received, ...sent) * 1.15;
  const padLeft = 34;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 28;
  const graphWidth = width - padLeft - padRight;
  const graphHeight = height - padTop - padBottom;

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height, padLeft, padRight, padTop, padBottom, maxValue, ["60s", "50s", "40s", "30s", "20s", "10s", "0s"]);
  drawLine(ctx, received, "#3fb950", maxValue, padLeft, padTop, graphWidth, graphHeight);
  drawLine(ctx, sent, "#a78bfa", maxValue, padLeft, padTop, graphWidth, graphHeight);
}

function drawHistoryChart(canvas: HTMLCanvasElement, buckets: HistoryBucket[]) {
  const surface = prepareCanvas(canvas);
  if (!surface) {
    return;
  }

  const { ctx, width, height } = surface;
  const padLeft = 34;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 10;
  const graphWidth = width - padLeft - padRight;
  const graphHeight = height - padTop - padBottom;
  const maxValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.received, bucket.sent])) * 1.15;
  const barWidth = (graphWidth / buckets.length) * 0.34;
  const gap = (graphWidth / buckets.length) * 0.12;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 0.5;
  ctx.fillStyle = "#484f58";
  ctx.font = "10px Segoe UI, sans-serif";
  ctx.textAlign = "right";

  for (let step = 0; step <= 5; step += 1) {
    const value = (maxValue / 5) * step;
    const y = padTop + graphHeight - (value / maxValue) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(value)), padLeft - 4, y + 3);
  }

  buckets.forEach((bucket, index) => {
    const centerX = padLeft + (index / buckets.length) * graphWidth + graphWidth / (buckets.length * 2);
    const receivedHeight = (bucket.received / maxValue) * graphHeight;
    const sentHeight = (bucket.sent / maxValue) * graphHeight;

    ctx.fillStyle = "#3fb950cc";
    ctx.fillRect(centerX - barWidth - gap / 2, padTop + graphHeight - receivedHeight, barWidth, receivedHeight);
    ctx.fillStyle = "#a78bfa99";
    ctx.fillRect(centerX + gap / 2, padTop + graphHeight - sentHeight, barWidth, sentHeight);
  });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  padLeft: number,
  padRight: number,
  padTop: number,
  padBottom: number,
  maxValue: number,
  labels: string[],
) {
  const graphHeight = height - padTop - padBottom;
  const graphWidth = width - padLeft - padRight;

  ctx.strokeStyle = "#21262d";
  ctx.lineWidth = 0.5;
  ctx.fillStyle = "#484f58";
  ctx.font = "10px Segoe UI, sans-serif";
  ctx.textAlign = "right";

  for (let step = 0; step <= 6; step += 1) {
    const value = (maxValue / 6) * step;
    const y = padTop + graphHeight - (value / maxValue) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(value)), padLeft - 4, y + 3);
  }

  ctx.textAlign = "center";
  labels.forEach((label, index) => {
    const x = padLeft + (index / (labels.length - 1)) * graphWidth;
    ctx.fillText(label, x, height - 8);
  });
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  maxValue: number,
  padLeft: number,
  padTop: number,
  graphWidth: number,
  graphHeight: number,
) {
  const x = (index: number) => padLeft + (index / (data.length - 1)) * graphWidth;
  const y = (value: number) => padTop + graphHeight - (value / maxValue) * graphHeight;

  ctx.beginPath();
  data.forEach((value, index) => {
    if (index === 0) {
      ctx.moveTo(x(index), y(value));
    } else {
      ctx.lineTo(x(index), y(value));
    }
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(x(data.length - 1), y(0));
  ctx.lineTo(x(0), y(0));
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + graphHeight);
  gradient.addColorStop(0, `${color}40`);
  gradient.addColorStop(1, `${color}05`);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function renderHistoryAxis(buckets: HistoryBucket[]) {
  const labels = buckets.map((bucket) => bucket.label);
  const selected = [0, 0.25, 0.5, 0.75, 1].map((ratio) => labels[Math.min(labels.length - 1, Math.round((labels.length - 1) * ratio))]);
  ["axis-a", "axis-b", "axis-c", "axis-d", "axis-e"].forEach((id, index) => {
    byId(id).textContent = selected[index] ?? "";
  });
}

function filterProcesses(processes: ProcessTraffic[]) {
  return processes
    .filter((process) => matchesSharedFilters(process.name, process.pid, process.user, process.protocol, totalRate(process), process.received, process.sent))
    .sort((a, b) => sortableProcessValue(b, state.processSort) - sortableProcessValue(a, state.processSort));
}

function filterConnections(connections: ConnectionTraffic[]) {
  return connections
    .filter((connection) =>
      matchesSharedFilters(
        connection.processName,
        connection.pid,
        connection.user,
        connection.protocol,
        connection.received + connection.sent,
        connection.received,
        connection.sent,
      ),
    )
    .sort((a, b) => sortableConnectionValue(b, state.connectionSort) - sortableConnectionValue(a, state.connectionSort));
}

function matchesSharedFilters(
  processName: string,
  pid: number,
  user: string,
  protocol: string,
  total: number,
  received: number,
  sent: number,
) {
  const queryMatches = !state.processQuery || processName.toLowerCase().includes(state.processQuery) || String(pid).includes(state.processQuery);
  const userMatches = state.user === "all" || user === state.user;
  const protocolMatches = state.protocol === "all" || protocol === state.protocol;
  const rateMatches = total >= state.minRate;
  const directionMatches =
    state.direction === "all" || (state.direction === "inbound" && received >= sent) || (state.direction === "outbound" && sent >= received);

  return queryMatches && userMatches && protocolMatches && rateMatches && directionMatches;
}

function resetControls() {
  state.timeRange = "live";
  state.interfaceName = "eth0";
  state.processQuery = "";
  state.user = "all";
  state.protocol = "all";
  state.direction = "all";
  state.minRate = 0;
  state.processSort = "sent";
  state.connectionSort = "total";
  state.historyRange = "24h";
  state.refreshMs = 1000;
  state.alertThreshold = 18;

  setPaused(false);
  syncControlsFromState();
  elements.processPanel.classList.remove("compact");
  elements.connectionPanel.classList.remove("compact");
  elements.processDensity.setAttribute("aria-pressed", "false");
  elements.connectionDensity.setAttribute("aria-pressed", "false");
  startLoop();
  addEvent("green", "Controls reset to <strong>live dashboard defaults</strong>");
}

function renderSparkline(values: number[], color: string) {
  const maxValue = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 44;
      const y = 18 - (value / maxValue) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `<svg class="sparkline" width="44" height="18" viewBox="0 0 44 18" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function processIconLabel(process: ProcessTraffic) {
  return (process.icon || process.name.slice(0, 1) || "?").slice(0, 2).toUpperCase();
}

function processIconClass(processName: string) {
  const normalized = processName.toLowerCase();

  if (normalized.includes("firefox")) {
    return "app-firefox";
  }

  if (normalized.includes("ssh")) {
    return "app-terminal";
  }

  if (normalized.includes("curl")) {
    return "app-curl";
  }

  if (normalized.includes("apt")) {
    return "app-package";
  }

  if (normalized.includes("docker")) {
    return "app-docker";
  }

  if (normalized.includes("resolve") || normalized.includes("systemd")) {
    return "app-system";
  }

  if (normalized.includes("python")) {
    return "app-python";
  }

  if (normalized.includes("node") || normalized.includes("vite")) {
    return "app-node";
  }

  return "app-generic";
}

function addEvent(tone: EventLogItem["tone"], html: string) {
  events.unshift({
    id: eventId,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }),
    tone,
    html,
  });
  eventId += 1;
  events.splice(12);
}

function sortableProcessValue(process: ProcessTraffic, key: SortKey) {
  if (key === "received") {
    return process.received;
  }

  if (key === "sent") {
    return process.sent;
  }

  return totalRate(process);
}

function sortableConnectionValue(connection: ConnectionTraffic, key: SortKey) {
  if (key === "received") {
    return connection.received;
  }

  if (key === "sent") {
    return connection.sent;
  }

  return connection.received + connection.sent;
}

function totalRate(process: ProcessTraffic) {
  return process.received + process.sent;
}

function formatRate(value: number) {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} MB/s`;
  }

  return `${value.toFixed(1)} KB/s`;
}

function formatBytes(valueInMb: number) {
  if (valueInMb >= 1024) {
    return `${(valueInMb / 1024).toFixed(2)} GB`;
  }

  return `${valueInMb.toFixed(1)} MB`;
}

function formatUptime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function byId(id: string) {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Element #${id} was not found`);
  }

  return element;
}

function getInput(id: string) {
  return byId(id) as HTMLInputElement;
}

function getSelect(id: string) {
  return byId(id) as HTMLSelectElement;
}

function getButton(id: string) {
  return byId(id) as HTMLButtonElement;
}

function getCanvas(id: string) {
  return byId(id) as HTMLCanvasElement;
}
