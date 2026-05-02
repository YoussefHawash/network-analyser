mod monitor;
mod types;

use monitor::Monitor;
use std::sync::Mutex;
use types::MonitorSnapshot;

struct AppState {
    monitor: Mutex<Option<(String, Monitor)>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            monitor: Mutex::new(None),
        }
    }
}

#[tauri::command]
fn get_network_snapshot(
    state: tauri::State<AppState>,
    interface_name: String,
) -> Result<MonitorSnapshot, String> {
    let mut guard = state.monitor.lock().map_err(|e| e.to_string())?;

    let needs_restart = match guard.as_ref() {
        None => true,
        Some((iface, _)) => iface != &interface_name,
    };

    if needs_restart {
        let target = resolve_interface(&interface_name);
        let new_monitor = Monitor::start(&target).map_err(|e| e.to_string())?;
        *guard = Some((target, new_monitor));
    }

    Ok(guard.as_ref().unwrap().1.snapshot())
}

/// Returns the requested interface if it exists among pcap devices, otherwise
/// falls back to the first available device (or "any" as a last resort).
fn resolve_interface(requested: &str) -> String {
    let devices = match pcap::Device::list() {
        Ok(d) => d,
        Err(_) => return requested.to_string(),
    };
    if devices.iter().any(|d| d.name == requested) {
        return requested.to_string();
    }
    devices
        .into_iter()
        .next()
        .map(|d| d.name)
        .unwrap_or_else(|| "any".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_network_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
