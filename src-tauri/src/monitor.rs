use crate::types::{
    ConnectionTraffic, HistoryBucket, MonitorSnapshot, ParsedPacket, ProcessTraffic, Protocol,
    ThreadInfo,
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

#[derive(Clone)]
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
        let now = Instant::now();
        let state = Arc::new(Mutex::new(State {
            interface: interface.to_string(),
            available_interfaces: list_interfaces(),
            started: now,
            received_total: 0,
            sent_total: 0,
            last_sample: now,
            last_received: 0,
            last_sent: 0,
            received_rate: 0.0,
            sent_rate: 0.0,
            connections: HashMap::new(),
            history: VecDeque::with_capacity(HISTORY_LEN),
            geoip: Reader::open_readfile("GeoLite2-Country.mmdb").ok(),
            pid_cache: PidCache {
                // Force a refresh on the first tick.
                last_refresh: now.checked_sub(PID_REFRESH).unwrap_or(now),
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
                if let Some(e) = entry {
                    if conn.pid == 0 {
                        conn.pid = e.pid;
                    }
                    if conn.state.is_empty() {
                        conn.state = e.state.clone();
                    }
                    if conn.user.is_empty() {
                        conn.user = e.user.clone();
                    }
                }
                if conn.pid != 0 && conn.process_name.is_empty() {
                    if let Some(name) = read_process_name(conn.pid) {
                        conn.process_name = name;
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
                threads: read_process_threads(c.pid),
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
            let port_entry = match self.pid_cache.by_port.get(&cache_key).cloned() {
                Some(e) => Some(e),
                None => {
                    let fresh = lookup_pid_for_port(&proto_str, local_port);
                    if let Some(ref e) = fresh {
                        self.pid_cache.by_port.insert(cache_key, e.clone());
                    }
                    fresh
                }
            };

            let (pid, state, user) = match port_entry {
                Some(e) => (e.pid, e.state, e.user),
                None => (0, String::new(), String::new()),
            };
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
                    state,
                },
            );
        }

        let entry = self
            .connections
            .get_mut(&key)
            .expect("connection inserted above");
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

struct SocketInfo {
    proto: &'static str,
    port: u16,
    state: String,
    uid: u32,
}

const PROC_NET_TABLES: &[(&str, &str)] = &[
    ("/proc/net/tcp", "TCP"),
    ("/proc/net/tcp6", "TCP"),
    ("/proc/net/udp", "UDP"),
    ("/proc/net/udp6", "UDP"),
];

fn read_socket_table<F>(mut on_socket: F)
where
    F: FnMut(u64, SocketInfo),
{
    for &(path, proto) in PROC_NET_TABLES {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in content.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 10 {
                continue;
            }
            let Some(port) = cols[1]
                .split(':')
                .nth(1)
                .and_then(|p| u16::from_str_radix(p, 16).ok())
            else {
                continue;
            };
            let Ok(inode) = cols[9].parse::<u64>() else {
                continue;
            };
            on_socket(
                inode,
                SocketInfo {
                    proto,
                    port,
                    state: cols[3].to_uppercase(),
                    uid: cols[7].parse().unwrap_or(0),
                },
            );
        }
    }
}

fn parse_socket_inode(link: &str) -> Option<u64> {
    link.strip_prefix("socket:[")
        .and_then(|s| s.strip_suffix(']'))
        .and_then(|s| s.parse().ok())
}

fn for_each_proc_socket<F: FnMut(u32, u64)>(mut visit: F) {
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return;
    };
    for entry in procs.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(fds) = std::fs::read_dir(format!("/proc/{pid}/fd")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(link) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let Some(inode) = link.to_str().and_then(parse_socket_inode) else {
                continue;
            };
            visit(pid, inode);
        }
    }
}

fn build_port_pid_map() -> HashMap<(String, u16), PortEntry> {
    let mut by_inode: HashMap<u64, SocketInfo> = HashMap::new();
    read_socket_table(|inode, info| {
        by_inode.insert(inode, info);
    });

    let mut result: HashMap<(String, u16), PortEntry> = HashMap::new();
    for_each_proc_socket(|pid, inode| {
        if let Some(meta) = by_inode.get(&inode) {
            result
                .entry((meta.proto.to_string(), meta.port))
                .or_insert_with(|| PortEntry {
                    pid,
                    state: tcp_state_str(&meta.state).to_string(),
                    user: uid_to_username(meta.uid),
                });
        }
    });
    result
}

fn lookup_pid_for_port(proto: &str, local_port: u16) -> Option<PortEntry> {
    let mut target_inode: Option<u64> = None;
    let mut target_state = String::new();
    let mut target_uid = 0u32;

    read_socket_table(|inode, info| {
        if target_inode.is_some() || info.proto != proto || info.port != local_port {
            return;
        }
        target_inode = Some(inode);
        target_state = info.state;
        target_uid = info.uid;
    });

    let inode = target_inode?;
    let mut found: Option<u32> = None;
    for_each_proc_socket(|pid, candidate| {
        if found.is_none() && candidate == inode {
            found = Some(pid);
        }
    });

    found.map(|pid| PortEntry {
        pid,
        state: tcp_state_str(&target_state).to_string(),
        user: uid_to_username(target_uid),
    })
}

fn read_process_name(pid: u32) -> Option<String> {
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
}

fn read_process_threads(pid: u32) -> Vec<ThreadInfo> {
    if pid == 0 {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(format!("/proc/{pid}/task")) else {
        return Vec::new();
    };
    let mut threads: Vec<ThreadInfo> = entries
        .flatten()
        .filter_map(|e| {
            let tid: u32 = e.file_name().to_string_lossy().parse().ok()?;
            let name = std::fs::read_to_string(format!("/proc/{pid}/task/{tid}/comm"))
                .ok()
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            Some(ThreadInfo { tid, name })
        })
        .collect();
    threads.sort_by_key(|t| t.tid);
    threads
}
