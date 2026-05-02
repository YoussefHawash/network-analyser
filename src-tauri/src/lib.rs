mod monitor;
mod types;

use monitor::Monitor;
use std::sync::Mutex;
use types::MonitorSnapshot;

#[derive(Default)]
struct AppState {
    monitor: Mutex<Option<(String, Monitor)>>,
}

#[tauri::command]
fn get_network_snapshot(
    state: tauri::State<AppState>,
    interface_name: String,
) -> Result<MonitorSnapshot, String> {
    let mut guard = state.monitor.lock().map_err(|e| e.to_string())?;

    let target = resolve_interface(&interface_name);
    let needs_restart = !matches!(guard.as_ref(), Some((iface, _)) if iface == &target);

    if needs_restart {
        let monitor = Monitor::start(&target).map_err(|e| e.to_string())?;
        *guard = Some((target, monitor));
    }

    let (_, monitor) = guard
        .as_ref()
        .expect("monitor was just initialized");
    Ok(monitor.snapshot())
}

/// Returns the requested interface if available, otherwise the first device
/// pcap reports (falling back to "any").
fn resolve_interface(requested: &str) -> String {
    let Ok(devices) = pcap::Device::list() else {
        return requested.to_string();
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
