#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    pub available_interfaces: Vec<String>,
    pub interface_name: String,
    pub received_rate: f64,
    pub sent_rate: f64,
    pub received_today: f64,
    pub sent_today: f64,
    pub uptime_seconds: u64,
    pub processes: Vec<ProcessTraffic>,
    pub connections: Vec<ConnectionTraffic>,
    pub history: Vec<HistoryBucket>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTraffic {
    pub pid: u32,
    pub name: String,
    pub user: String,
    pub protocol: String,
    pub received: f64,
    pub sent: f64,
    pub history: Vec<f64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTraffic {
    pub remote: String,
    pub flag: String,
    pub port: u16,
    pub protocol: String,
    pub process_name: String,
    pub pid: u32,
    pub user: String,
    pub received: f64,
    pub sent: f64,
    pub state: String,
}

#[derive(serde::Serialize)]
pub struct HistoryBucket {
    pub label: String,
    pub received: f64,
    pub sent: f64,
}
