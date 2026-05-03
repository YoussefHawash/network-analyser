#[derive(serde::Serialize, Clone)]
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

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTraffic {
    pub pid: u32,
    pub name: String,
    pub user: String,
    pub flag: String,
    pub protocol: String,
    pub received: f64,
    pub sent: f64,
    pub history: Vec<f64>,
    pub threads: Vec<ThreadInfo>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub tid: u32,
    pub name: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTraffic {
    pub remote: String,
    pub flag: String,
    pub port: u16,
    #[serde(skip)]
    pub local_port: u16,
    pub protocol: String,
    pub process_name: String,
    pub pid: u32,
    pub user: String,
    pub received: f64,
    pub sent: f64,
    pub state: String,
}

#[derive(serde::Serialize, Clone)]
pub struct HistoryBucket {
    pub label: String,
    pub received: f64,
    pub sent: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Protocol {
    Unknown,
    IPv4,
    IPv6,
    ARP,
    TCP,
    UDP,
    ICMPv4,
    ICMPv6,
}

#[derive(Debug)]
pub struct ParsedPacket {
    pub net_proto: Protocol,
    pub transport_proto: Protocol,
    pub remote: [u8; 16],
    pub remote_port: Option<u16>,
    pub local_port: Option<u16>,
    pub size: u16,
    pub outbound: bool,
    pub is_ipv6: bool,
}
