mod types;
use libc::timeval;
use pcap::{Active, Capture, Packet};
use std::fs::{read_dir, read_to_string, File};
use std::io::{BufRead, BufReader, Error, ErrorKind, Result};
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::mpsc;
use std::thread;
use types::{ConnectionTraffic, HistoryBucket, MonitorSnapshot, ProcessTraffic};
#[tauri::command]
fn get_network_snapshot(interface_name: String) -> MonitorSnapshot {
    MonitorSnapshot {
        available_interfaces: list().unwrap_or_default(),
        interface_name,
        received_rate: 24.5,
        sent_rate: 8.2,
        received_today: 1234.56,
        sent_today: 789.01,
        uptime_seconds: 3600,
        processes: vec![
            ProcessTraffic {
                pid: 1234,
                name: "firefox".to_string(),
                user: "user1".to_string(),
                protocol: "TCP".to_string(),
                received: 12.4,
                sent: 3.8,
                history: vec![8.0, 9.0, 10.0, 12.0, 11.0, 13.0, 16.2],
            },
            ProcessTraffic {
                pid: 5678,
                name: "systemd-resolve".to_string(),
                user: "system".to_string(),
                protocol: "UDP".to_string(),
                received: 2.0,
                sent: 1.5,
                history: vec![2.4, 2.8, 3.0, 3.2, 3.5, 3.1, 3.5],
            },
        ],
        connections: vec![
            ConnectionTraffic {
                remote: "142.250.72.14".to_string(),
                flag: "US".to_string(),
                port: 443,
                protocol: "TCP".to_string(),
                process_name: "firefox".to_string(),
                pid: 1234,
                user: "user1".to_string(),
                received: 10.2,
                sent: 2.4,
                state: "ESTABLISHED".to_string(),
            },
            ConnectionTraffic {
                remote: "8.8.8.8".to_string(),
                flag: "GL".to_string(),
                port: 53,
                protocol: "UDP".to_string(),
                process_name: "systemd-resolve".to_string(),
                pid: 5678,
                user: "system".to_string(),
                received: 2.0,
                sent: 1.2,
                state: "ESTABLISHED".to_string(),
            },
        ],
        history: vec![
            HistoryBucket {
                label: "00:00".to_string(),
                received: 120.0,
                sent: 44.0,
            },
            HistoryBucket {
                label: "02:00".to_string(),
                received: 180.0,
                sent: 65.0,
            },
        ],
    }
}
fn read_uptime_seconds() -> io::Result<u64> {
    let content = fs::read_to_string("/proc/uptime")?;

    let first = content
        .split_whitespace()
        .next()
        .unwrap_or("0")
        .parse::<f64>()
        .unwrap_or(0.0);

    Ok(first as u64)
}
fn list() -> Result<Vec<String>> {
    let devices = pcap::Device::list().map_err(|e| Error::new(ErrorKind::Other, e))?;
    Ok(devices.into_iter().map(|d| d.name).collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_network_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
