use crate::types::{
    ConnectionTraffic, HistoryBucket, MonitorSnapshot, ParsedPacket, ProcessTraffic, Protocol,
};
use etherparse::{NetHeaders, PacketHeaders, TransportHeader};
use maxminddb::{geoip2, Reader};
use pcap::{Active, Capture, Device};
use std::collections::{HashMap, VecDeque};
use std::io::{Error, ErrorKind, Result};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const HISTORY_LEN: usize = 60;
const PID_REFRESH: Duration = Duration::from_secs(1);
const REOPEN_BACKOFF: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct Monitor {
    state: Arc<Mutex<State>>,
}

#[derive(Hash, PartialEq, Eq, Clone)]
struct ConnKey {
    remote: IpAddr,
    port: u16,
    protocol: String,
}

struct State {
    interface: String,
    available_interfaces: Vec<String>,
    started: Instant,

    received_total: u64,
    sent_total: u64,

    last_sample: Instant,
    last_received: u64,
    last_sent: u64,
    received_rate: f64,
    sent_rate: f64,

    connections: HashMap<ConnKey, ConnectionTraffic>,
    history: VecDeque<HistoryBucket>,

    geoip: Option<Reader<Vec<u8>>>,
    pid_cache: PidCache,
}

struct PortEntry {
    pid: u32,
    state: String,
    user: String,
}

struct PidCache {
    last_refresh: Instant,
    by_port: HashMap<(String, u16), PortEntry>,
}

impl Monitor {
    pub fn start(interface: &str) -> Result<Self> {
        let available_interfaces = list_interfaces();
        let geoip = Reader::open_readfile("GeoLite2-Country.mmdb").ok();

        let state = Arc::new(Mutex::new(State {
            interface: interface.to_string(),
            available_interfaces,
            started: Instant::now(),
            received_total: 0,
            sent_total: 0,
            last_sample: Instant::now(),
            last_received: 0,
            last_sent: 0,
            received_rate: 0.0,
            sent_rate: 0.0,
            connections: HashMap::new(),
            history: VecDeque::with_capacity(HISTORY_LEN),
            geoip,
            pid_cache: PidCache {
                last_refresh: Instant::now()
                    .checked_sub(PID_REFRESH + Duration::from_secs(1))
                    .unwrap_or_else(Instant::now),
                by_port: HashMap::new(),
            },
        }));

        let thread_state = state.clone();
        let iface = interface.to_string();
        thread::Builder::new()
            .name("net-capture".into())
            .spawn(move || capture_loop(iface, thread_state))
            .map_err(|e| Error::new(ErrorKind::Other, e))?;

        Ok(Self { state })
    }

    pub fn snapshot(&self) -> MonitorSnapshot {
        let mut state = self.state.lock().expect("monitor state poisoned");
        state.tick();
        state.build_snapshot()
    }
}

impl State {
    fn tick(&mut self) {
        let now = Instant::now();
        let dt = now.duration_since(self.last_sample).as_secs_f64();
        if dt >= 0.05 {
            let dr = self.received_total.saturating_sub(self.last_received) as f64;
            let ds = self.sent_total.saturating_sub(self.last_sent) as f64;
            self.received_rate = dr / dt;
            self.sent_rate = ds / dt;

            self.history.push_back(HistoryBucket {
                label: format!("{}s", self.started.elapsed().as_secs()),
                received: dr,
                sent: ds,
            });
            while self.history.len() > HISTORY_LEN {
                self.history.pop_front();
            }

            self.last_sample = now;
            self.last_received = self.received_total;
            self.last_sent = self.sent_total;
        }

        if now.duration_since(self.pid_cache.last_refresh) >= PID_REFRESH {
            self.pid_cache.by_port = build_port_pid_map();
            self.pid_cache.last_refresh = now;

            for conn in self.connections.values_mut() {
                let entry = self
                    .pid_cache
                    .by_port
                    .get(&(conn.protocol.clone(), conn.local_port));
                if conn.pid == 0 {
                    if let Some(e) = entry {
                        conn.pid = e.pid;
                    }
                }
                if conn.pid != 0 && conn.process_name.is_empty() {
                    if let Some(name) = read_process_name(conn.pid) {
                        conn.process_name = name;
                    }
                }
                if conn.state.is_empty() {
                    if let Some(e) = entry {
                        conn.state = e.state.clone();
                    }
                }
                if conn.user.is_empty() {
                    if let Some(e) = entry {
                        conn.user = e.user.clone();
                    }
                }
            }
        }
    }

    fn build_snapshot(&self) -> MonitorSnapshot {
        let connections: Vec<ConnectionTraffic> = self.connections.values().cloned().collect();

        let mut by_pid: HashMap<(u32, String, String), ProcessTraffic> = HashMap::new();
        for c in &connections {
            if c.pid == 0 && c.process_name.is_empty() {
                continue;
            }
            let key = (c.pid, c.process_name.clone(), c.protocol.clone());
            let entry = by_pid.entry(key).or_insert_with(|| ProcessTraffic {
                pid: c.pid,
                name: c.process_name.clone(),
                user: c.user.clone(),
                flag: c.flag.clone(),
                protocol: c.protocol.clone(),
                received: 0.0,
                sent: 0.0,
                history: vec![],
            });
            entry.received += c.received;
            entry.sent += c.sent;
            if entry.flag.is_empty() && !c.flag.is_empty() {
                entry.flag = c.flag.clone();
            }
        }

        MonitorSnapshot {
            available_interfaces: self.available_interfaces.clone(),
            interface_name: self.interface.clone(),
            received_rate: self.received_rate,
            sent_rate: self.sent_rate,
            received_today: self.received_total as f64,
            sent_today: self.sent_total as f64,
            uptime_seconds: self.started.elapsed().as_secs(),
            processes: by_pid.into_values().collect(),
            connections,
            history: self.history.iter().cloned().collect(),
        }
    }

    fn record(&mut self, packet: &ParsedPacket) {
        let remote_ip = if packet.is_ipv6 {
            IpAddr::V6(Ipv6Addr::from(packet.remote))
        } else {
            IpAddr::V4(Ipv4Addr::new(
                packet.remote[0],
                packet.remote[1],
                packet.remote[2],
                packet.remote[3],
            ))
        };
        if remote_ip.is_unspecified() {
            return;
        }

        let proto_str = format!("{:?}", packet.transport_proto);
        let remote_port = packet.remote_port.unwrap_or(0);
        let local_port = packet.local_port.unwrap_or(0);
        let key = ConnKey {
            remote: remote_ip,
            port: remote_port,
            protocol: proto_str.clone(),
        };

        if !self.connections.contains_key(&key) {
            let flag = self
                .geoip
                .as_ref()
                .and_then(|r| lookup_country(r, remote_ip))
                .unwrap_or_default();

            let cache_key = (proto_str.clone(), local_port);
            let mut pid = self
                .pid_cache
                .by_port
                .get(&cache_key)
                .map(|e| e.pid)
                .unwrap_or(0);
            let mut conn_state = self
                .pid_cache
                .by_port
                .get(&cache_key)
                .map(|e| e.state.clone())
                .unwrap_or_default();
            let mut user = self
                .pid_cache
                .by_port
                .get(&cache_key)
                .map(|e| e.user.clone())
                .unwrap_or_default();

            if pid == 0 {
                if let Some(fresh) = lookup_pid_for_port(&proto_str, local_port) {
                    pid = fresh.pid;
                    conn_state = fresh.state.clone();
                    user = fresh.user.clone();
                    self.pid_cache.by_port.insert(cache_key, fresh);
                }
            }

            let process_name = if pid != 0 {
                read_process_name(pid).unwrap_or_default()
            } else {
                String::new()
            };
            self.connections.insert(
                key.clone(),
                ConnectionTraffic {
                    remote: remote_ip.to_string(),
                    flag,
                    port: remote_port,
                    local_port,
                    protocol: proto_str,
                    process_name,
                    pid,
                    user,
                    received: 0.0,
                    sent: 0.0,
                    state: conn_state,
                },
            );
        }

        let entry = self.connections.get_mut(&key).expect("just inserted");
        let bytes = packet.size as u64;
        if packet.outbound {
            entry.sent += bytes as f64;
            self.sent_total = self.sent_total.saturating_add(bytes);
        } else {
            entry.received += bytes as f64;
            self.received_total = self.received_total.saturating_add(bytes);
        }
    }
}

fn capture_loop(interface: String, state: Arc<Mutex<State>>) {
    loop {
        match open_capture(&interface) {
            Ok(mut cap) => {
                eprintln!("[net] capturing on {interface}");
                let local_ips = local_ipv4_addresses(&interface);
                while let Ok(packet) = cap.next() {
                    if let Ok(parsed) = parse_packet(packet.data, &local_ips) {
                        if let Ok(mut s) = state.lock() {
                            s.record(&parsed);
                        }
                    }
                }
                eprintln!("[net] capture stream ended on {interface}, reopening...");
            }
            Err(e) => eprintln!("[net] open failed on {interface}: {e}"),
        }
        thread::sleep(REOPEN_BACKOFF);
    }
}

fn open_capture(interface: &str) -> Result<Capture<Active>> {
    Capture::from_device(interface)
        .map_err(|e| Error::new(ErrorKind::Other, e))?
        .promisc(true)
        .snaplen(2048)
        .buffer_size(4 * 1024 * 1024)
        .immediate_mode(true)
        .open()
        .map_err(|e| Error::new(ErrorKind::Other, e))
}

fn list_interfaces() -> Vec<String> {
    Device::list()
        .map(|devs| devs.into_iter().map(|d| d.name).collect())
        .unwrap_or_default()
}

fn local_ipv4_addresses(interface: &str) -> Vec<Ipv4Addr> {
    let Ok(devices) = Device::list() else {
        return Vec::new();
    };
    let Some(device) = devices.into_iter().find(|d| d.name == interface) else {
        return Vec::new();
    };
    device
        .addresses
        .into_iter()
        .filter_map(|a| match a.addr {
            IpAddr::V4(ip) => Some(ip),
            IpAddr::V6(_) => None,
        })
        .collect()
}

fn parse_packet(data: &[u8], local_ips: &[Ipv4Addr]) -> Result<ParsedPacket> {
    let headers = PacketHeaders::from_ethernet_slice(data)
        .map_err(|e| Error::new(ErrorKind::InvalidData, e.to_string()))?;
    let mut net_proto = Protocol::Unknown;
    let mut transport_proto = Protocol::Unknown;
    let mut remote = [0u8; 16];
    let mut size: u16 = 0;
    let mut outbound = false;
    let mut is_ipv6 = false;
    let mut src_port: Option<u16> = None;
    let mut dst_port: Option<u16> = None;

    if let Some(net) = headers.net {
        match net {
            NetHeaders::Ipv4(header, _) => {
                net_proto = Protocol::IPv4;
                size = header.total_len;
                if local_ips.contains(&Ipv4Addr::from(header.source)) {
                    remote[..4].copy_from_slice(&header.destination);
                    outbound = true;
                } else {
                    remote[..4].copy_from_slice(&header.source);
                }
            }
            NetHeaders::Ipv6(header, _) => {
                net_proto = Protocol::IPv6;
                is_ipv6 = true;
                size = header.payload_length.saturating_add(40);
                remote.copy_from_slice(&header.destination);
            }
        }
    }

    if let Some(transport) = headers.transport {
        match transport {
            TransportHeader::Tcp(h) => {
                transport_proto = Protocol::TCP;
                src_port = Some(h.source_port);
                dst_port = Some(h.destination_port);
            }
            TransportHeader::Udp(h) => {
                transport_proto = Protocol::UDP;
                src_port = Some(h.source_port);
                dst_port = Some(h.destination_port);
            }
            TransportHeader::Icmpv4(_) => transport_proto = Protocol::ICMPv4,
            TransportHeader::Icmpv6(_) => transport_proto = Protocol::ICMPv6,
        }
    }

    let (local_port, remote_port) = if outbound {
        (src_port, dst_port)
    } else {
        (dst_port, src_port)
    };

    Ok(ParsedPacket {
        net_proto,
        transport_proto,
        remote,
        remote_port,
        local_port,
        size,
        outbound,
        is_ipv6,
    })
}

fn lookup_country(reader: &Reader<Vec<u8>>, ip: IpAddr) -> Option<String> {
    let record: geoip2::Country = reader.lookup(ip).ok()?;
    record.country?.iso_code.map(|s| s.to_string())
}

fn tcp_state_str(hex: &str) -> &'static str {
    match hex {
        "01" => "ESTABLISHED",
        "02" => "SYN_SENT",
        "03" => "SYN_RECV",
        "04" => "FIN_WAIT1",
        "05" => "FIN_WAIT2",
        "06" => "TIME_WAIT",
        "07" => "CLOSE",
        "08" => "CLOSE_WAIT",
        "09" => "LAST_ACK",
        "0A" => "LISTEN",
        "0B" => "CLOSING",
        _ => "",
    }
}

fn uid_to_username(uid: u32) -> String {
    let Ok(content) = std::fs::read_to_string("/etc/passwd") else {
        return uid.to_string();
    };
    for line in content.lines() {
        let cols: Vec<&str> = line.splitn(7, ':').collect();
        if cols.len() >= 3 {
            if let Ok(u) = cols[2].parse::<u32>() {
                if u == uid {
                    return cols[0].to_string();
                }
            }
        }
    }
    uid.to_string()
}

fn build_port_pid_map() -> HashMap<(String, u16), PortEntry> {
    struct InodeMeta {
        proto: String,
        port: u16,
        state: String,
        uid: u32,
    }

    let mut inode_to_meta: HashMap<u64, InodeMeta> = HashMap::new();
    for (path, proto) in [
        ("/proc/net/tcp", "TCP"),
        ("/proc/net/tcp6", "TCP"),
        ("/proc/net/udp", "UDP"),
        ("/proc/net/udp6", "UDP"),
    ] {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 10 {
                continue;
            }
            let port = cols[1]
                .split(':')
                .nth(1)
                .and_then(|p| u16::from_str_radix(p, 16).ok());
            let state = cols[3].to_uppercase();
            let uid: u32 = cols[7].parse().unwrap_or(0);
            let inode = cols[9].parse::<u64>().ok();
            if let (Some(p), Some(i)) = (port, inode) {
                inode_to_meta.insert(
                    i,
                    InodeMeta {
                        proto: proto.to_string(),
                        port: p,
                        state,
                        uid,
                    },
                );
            }
        }
    }

    let mut result: HashMap<(String, u16), PortEntry> = HashMap::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return result;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let pid_str = name.to_string_lossy();
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        let fd_dir = format!("/proc/{}/fd", pid);
        let Ok(fds) = std::fs::read_dir(&fd_dir) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(link) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let Some(s) = link.to_str() else { continue };
            let Some(rest) = s.strip_prefix("socket:[") else {
                continue;
            };
            let Some(num) = rest.strip_suffix(']') else {
                continue;
            };
            let Ok(inode) = num.parse::<u64>() else {
                continue;
            };
            if let Some(meta) = inode_to_meta.get(&inode) {
                result
                    .entry((meta.proto.clone(), meta.port))
                    .or_insert_with(|| PortEntry {
                        pid,
                        state: tcp_state_str(&meta.state).to_string(),
                        user: uid_to_username(meta.uid),
                    });
            }
        }
    }
    result
}

fn lookup_pid_for_port(proto: &str, local_port: u16) -> Option<PortEntry> {
    let paths: &[&str] = match proto {
        "TCP" => &["/proc/net/tcp", "/proc/net/tcp6"],
        "UDP" => &["/proc/net/udp", "/proc/net/udp6"],
        _ => return None,
    };

    let mut found_inode: Option<u64> = None;
    let mut found_state = String::new();
    let mut found_uid = 0u32;

    'outer: for path in paths {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 10 {
                continue;
            }
            let port = cols[1]
                .split(':')
                .nth(1)
                .and_then(|p| u16::from_str_radix(p, 16).ok());
            if port == Some(local_port) {
                found_inode = cols[9].parse::<u64>().ok();
                found_state = cols[3].to_uppercase();
                found_uid = cols[7].parse().unwrap_or(0);
                break 'outer;
            }
        }
    }

    let inode = found_inode?;
    let socket_str = format!("socket:[{}]", inode);

    for entry in std::fs::read_dir("/proc").ok()?.flatten() {
        let pid_str = entry.file_name().to_string_lossy().to_string();
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        let fd_dir = format!("/proc/{}/fd", pid);
        let Ok(fds) = std::fs::read_dir(&fd_dir) else {
            continue;
        };
        for fd in fds.flatten() {
            if let Ok(link) = std::fs::read_link(fd.path()) {
                if link.to_str().map_or(false, |s| s == socket_str) {
                    return Some(PortEntry {
                        pid,
                        state: tcp_state_str(&found_state).to_string(),
                        user: uid_to_username(found_uid),
                    });
                }
            }
        }
    }
    None
}

fn read_process_name(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{}/comm", pid))
        .ok()
        .map(|s| s.trim().to_string())
}
