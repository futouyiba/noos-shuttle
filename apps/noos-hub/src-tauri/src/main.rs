use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const LOCAL_WRITE_PORT: u16 = 17642;
const HUB_PROTOCOL_VERSION: u8 = 1;
const HUB_HEALTH_CACHE_TTL_SECS: u64 = 5;
const LOCAL_WRITE_IO_TIMEOUT_SECS: u64 = 5;
const SLEEP_GUARD_CHECK_INTERVAL_SECS: u64 = 60;
const SLEEP_GUARD_EXIT_AFTER_GAP_SECS: u64 = 10 * 60;
const SLEEP_RECOVERY_MAX_ATTEMPTS: u8 = 3;
const LOCAL_WRITE_RECOVERY_PROBE_TIMEOUT_MS: u64 = 1_500;
const SLEEP_RECOVERY_CPU_LIMIT_PERCENT: f32 = 75.0;
const MENU_CHECK_UPDATE_ID: &str = "noos_check_update";
const EVENT_CHECK_UPDATE: &str = "noos://check-update";

#[derive(Clone, Serialize)]
struct HubHealth {
    repo_root: String,
    noos_home: String,
    local_write: LocalWriteSummary,
    vault_stats: VaultStats,
    recent_files: RecentVaultFiles,
    adapters: Vec<AdapterHealth>,
}

#[derive(Clone, Serialize)]
struct LocalWriteSummary {
    endpoint: String,
    paired: bool,
}

#[derive(Clone, Serialize)]
struct VaultStats {
    handoffs_active: usize,
    crystals_active: usize,
    browser_handoffs: usize,
    browser_crystals: usize,
}

#[derive(Clone, Serialize)]
struct RecentVaultFiles {
    handoffs: Vec<VaultFileSummary>,
    crystals: Vec<VaultFileSummary>,
}

#[derive(Clone, Serialize)]
struct VaultFileSummary {
    name: String,
    path: String,
    modified_epoch: u64,
    title: Option<String>,
    key: Option<String>,
    source_url: Option<String>,
}

#[derive(Clone, Serialize)]
struct AdapterHealth {
    id: String,
    name: String,
    kind: String,
    status: String,
    summary: String,
    checks: Vec<AdapterCheck>,
    actions: Vec<AdapterAction>,
}

#[derive(Clone, Serialize)]
struct AdapterCheck {
    label: String,
    status: String,
    detail: Option<String>,
}

#[derive(Clone, Serialize)]
struct AdapterAction {
    id: String,
    label: String,
    requires_user_action: bool,
}

#[derive(Deserialize)]
struct HandoffWriteRequest {
    kind: Option<String>,
    filename: String,
    content: String,
    source: Option<HandoffSource>,
}

#[derive(Clone, Deserialize)]
struct HandoffSource {
    app: Option<String>,
    url: Option<String>,
    conversation_id: Option<String>,
    captured_at: Option<String>,
}

#[derive(Deserialize)]
struct IngestWriteRequest {
    protocol_version: Option<u8>,
    request_id: Option<String>,
    idempotency_key: Option<String>,
    object_type: Option<String>,
    source: Option<HandoffSource>,
    suggested: Option<IngestSuggested>,
    content: Option<IngestContent>,
}

#[derive(Deserialize)]
struct IngestSuggested {
    lookup_key: Option<String>,
    key: Option<String>,
    filename: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
struct IngestContent {
    media_type: Option<String>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct HubActionRequest {
    command: String,
    url: Option<String>,
    title: Option<String>,
    wiki_project_path: Option<String>,
    category_path: Option<String>,
    source_key: Option<String>,
    mode: Option<String>,
    destination_kind: Option<String>,
    folder_token: Option<String>,
    folder_name: Option<String>,
    force: Option<bool>,
}

#[derive(Serialize)]
struct HubActionResponse {
    ok: bool,
    status: String,
    message: String,
    error_code: Option<String>,
    source_path: Option<String>,
    wiki_project_path: Option<String>,
    document_url: Option<String>,
    folder_name: Option<String>,
    changed: Option<bool>,
}

struct VaultMarkdownSource {
    lookup_key: String,
    title: Option<String>,
    path: PathBuf,
    content: String,
}

struct FeishuExportPackage {
    markdown: String,
    resources: Vec<ExportedResource>,
    export_mode: String,
    temp_root: Option<PathBuf>,
}

struct ExportedResource {
    source_path: PathBuf,
    original_relative_path: String,
    relative_path: String,
}

struct LibrarySourceMetadata {
    source_id: String,
    source_app: String,
    source_url: String,
    title: String,
    category_path: String,
    source_path: PathBuf,
    asset_root: String,
    export_mode: String,
    content_hash: String,
    resource_count: usize,
    last_exported_at: String,
    wiki_status: String,
}

#[derive(Serialize)]
struct LocalWriteHealth {
    ok: bool,
    app: String,
    protocol_version: u8,
    port: u16,
    vault_path: String,
    paired: bool,
}

#[derive(Serialize)]
struct HandoffWriteResponse {
    ok: bool,
    backend: String,
    location: Option<String>,
    error_code: Option<String>,
    message: String,
    object_type: Option<String>,
    object_id: Option<String>,
    lookup_key: Option<String>,
    key: Option<String>,
    status: Option<String>,
    path: Option<String>,
    source: Option<Value>,
    created_at: Option<String>,
    canonical_url: Option<String>,
    content_hash: Option<String>,
    duplicate_of: Option<String>,
    warnings: Vec<String>,
    next_actions: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct ShuttleTokenFile {
    version: u8,
    token: String,
    created_at_epoch: u64,
}

#[derive(Clone)]
struct CachedHubHealth {
    health: HubHealth,
    cached_at_epoch: u64,
}

static HUB_HEALTH_CACHE: OnceLock<Mutex<Option<CachedHubHealth>>> = OnceLock::new();
static SLEEP_RECOVERY_STATUS: OnceLock<Mutex<SleepRecoveryStatus>> = OnceLock::new();
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SleepRecoveryState {
    Running,
    Suspended,
    Resumed,
    Recovering,
    Healthy,
    Degraded,
    Relaunching,
}

#[derive(Clone, Serialize)]
struct SleepRecoveryStatus {
    state: SleepRecoveryState,
    last_reason: String,
    last_resume_epoch: Option<u64>,
    last_gap_secs: Option<u64>,
    attempts: u8,
    local_write_healthy: bool,
    relaunch_recommended: bool,
    message: String,
}

#[tauri::command]
fn get_hub_health(force: Option<bool>) -> Result<HubHealth, String> {
    if force.unwrap_or(false) {
        invalidate_hub_health_cache();
    }
    cached_hub_health()
}

#[tauri::command]
fn get_sleep_recovery_status() -> Result<SleepRecoveryStatus, String> {
    Ok(current_sleep_recovery_status())
}

#[tauri::command]
fn mark_sleep_suspended() -> Result<SleepRecoveryStatus, String> {
    let suspended = SleepRecoveryStatus {
        state: SleepRecoveryState::Suspended,
        last_reason: "frontend tauri suspended event".to_string(),
        last_resume_epoch: None,
        last_gap_secs: None,
        attempts: 0,
        local_write_healthy: false,
        relaunch_recommended: false,
        message: "System suspended; NOOS Hub will recover after resume.".to_string(),
    };
    set_sleep_recovery_status(suspended.clone());
    Ok(suspended)
}

#[tauri::command]
fn recover_from_sleep(
    reason: String,
    gap_secs: Option<u64>,
) -> Result<SleepRecoveryStatus, String> {
    Ok(recover_local_write_after_sleep(&reason, gap_secs))
}

#[tauri::command]
fn simulate_sleep_resume(gap_secs: Option<u64>) -> Result<SleepRecoveryStatus, String> {
    Ok(recover_local_write_after_sleep(
        "manual sleep/resume recovery simulation",
        gap_secs.or(Some(sleep_resume_gap_threshold_secs() + 1)),
    ))
}

fn cached_hub_health() -> Result<HubHealth, String> {
    let now = now_epoch();
    let cache = HUB_HEALTH_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.as_ref() {
            if now.saturating_sub(cached.cached_at_epoch) <= HUB_HEALTH_CACHE_TTL_SECS {
                return Ok(cached.health.clone());
            }
        }
    }

    let health = compute_hub_health();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CachedHubHealth {
            health: health.clone(),
            cached_at_epoch: now,
        });
    }
    Ok(health)
}

fn invalidate_hub_health_cache() {
    if let Some(cache) = HUB_HEALTH_CACHE.get() {
        if let Ok(mut guard) = cache.lock() {
            *guard = None;
        }
    }
}

fn compute_hub_health() -> HubHealth {
    let repo_root = repo_root();
    let noos_home = noos_home();

    HubHealth {
        repo_root: repo_root.display().to_string(),
        noos_home: noos_home.display().to_string(),
        local_write: local_write_summary(),
        vault_stats: vault_stats(&noos_home),
        recent_files: recent_vault_files(&noos_home),
        adapters: vec![
            workspace_adapter(&repo_root),
            vault_adapter(&noos_home),
            inbox_adapter(&noos_home),
            codex_adapter(&noos_home),
            claude_adapter(&repo_root),
            browser_adapter(&repo_root, &noos_home),
            github_adapter(&repo_root),
        ],
    }
}

#[tauri::command]
fn run_hub_action(app: tauri::AppHandle, action: String) -> Result<String, String> {
    invalidate_hub_health_cache();
    let repo_root = repo_root();
    let noos_home = noos_home();
    let result = match action.as_str() {
        "doctor" => run_script(&repo_root, &["scripts/noos-doctor.sh"]),
        "install-consumers" => run_script(&repo_root, &["scripts/noos-install.sh", "consumers"]),
        "install-workspace" => run_script(&repo_root, &["scripts/noos-install.sh", "workspace"]),
        "create-inbox" => run_script(&repo_root, &["scripts/noos-install.sh", "inbox"]),
        "create-vault" => run_script(&repo_root, &["scripts/noos-install.sh", "vault"]),
        "reset-browser-connection" => reset_browser_connection(),
        "import-browser-vault" => run_script(&repo_root, &["scripts/noos-import-browser-vault.sh"]),
        "sync-handoffs-git" => run_script(&repo_root, &["scripts/noos-sync-handoffs-git.sh"]),
        "open-vault" => open_path(&noos_home.join("vault")),
        "open-handoff-vault" => open_path(&noos_home.join("vault/handoffs/active")),
        "open-crystal-vault" => open_path(&noos_home.join("vault/crystals/active")),
        "open-browser-mirror" => open_path(&home_dir().join("Downloads/NOOS/vault")),
        "open-runtime-current" => open_path(&repo_root.join(".noos/runtime/current")),
        "open-bundled-shuttle-extension" => open_bundled_shuttle_extension(&app, &repo_root),
        "browser-dev-profile" => run_script(
            &repo_root,
            &[
                "scripts/noos-install.sh",
                "browser",
                "--mode",
                "dev-profile",
            ],
        ),
        "browser-manual-unpacked" => run_script(
            &repo_root,
            &[
                "scripts/noos-install.sh",
                "browser",
                "--mode",
                "manual-unpacked",
            ],
        ),
        _ if action.starts_with("open-vault-file:") => {
            let path = action.trim_start_matches("open-vault-file:");
            open_vault_file(&noos_home, path)
        }
        _ if action.starts_with("project-runtime:") => {
            let path = action.trim_start_matches("project-runtime:");
            project_runtime_from_vault_file(&repo_root, &noos_home, path)
        }
        _ => Err(format!("Unknown action: {action}")),
    };
    invalidate_hub_health_cache();
    result
}

#[tauri::command]
fn browse_vault(
    folder: Option<String>,
    query: Option<String>,
) -> Result<serde_json::Value, String> {
    Ok(vault_browse_payload(
        &noos_home(),
        folder.as_deref(),
        query.as_deref(),
    ))
}

#[tauri::command]
fn get_vault_object(
    key: String,
    path: Option<String>,
    folder: Option<String>,
) -> Result<serde_json::Value, String> {
    let payload = vault_object_payload(&noos_home(), &key, path.as_deref(), folder.as_deref());
    if payload.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(payload)
    } else {
        Err(payload
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Object not found")
            .to_string())
    }
}

#[tauri::command]
fn read_config() -> Result<serde_json::Value, String> {
    let config_path = noos_home().join("config.json");
    if config_path.exists() {
        let text = fs::read_to_string(&config_path).map_err(|e| format!("无法读取配置: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("配置 JSON 无效: {e}"))
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
fn write_config(key: String, value: serde_json::Value) -> Result<(), String> {
    let config_path = noos_home().join("config.json");
    let mut config = read_config_for_write(&config_path)?;

    // Write nested keys like "github.default_account"
    let parts: Vec<&str> = key.split('.').collect();
    let mut cursor = &mut config;
    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            cursor[part] = value.clone();
        } else {
            if cursor.get(part).is_none() || !cursor[part].is_object() {
                cursor[part] = serde_json::json!({});
            }
            cursor = cursor.get_mut(part).unwrap();
        }
    }

    write_json_file(&config_path, &config).map_err(|e| format!("无法写入配置: {e}"))?;

    invalidate_hub_health_cache();
    Ok(())
}

fn read_config_for_write(config_path: &Path) -> Result<Value, String> {
    if !config_path.exists() {
        return Ok(json!({}));
    }

    let text = fs::read_to_string(config_path).map_err(|e| format!("无法读取配置: {e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("配置 JSON 无效: {e}"))?;
    if !value.is_object() {
        return Err("配置 JSON 必须是对象。".to_string());
    }
    Ok(value)
}

fn main() {
    start_local_write_server();
    start_sleep_resume_guard();
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            install_app_menu(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == MENU_CHECK_UPDATE_ID {
                let _ = app.emit(EVENT_CHECK_UPDATE, ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_hub_health,
            run_hub_action,
            get_sleep_recovery_status,
            mark_sleep_suspended,
            recover_from_sleep,
            simulate_sleep_resume,
            browse_vault,
            get_vault_object,
            read_config,
            write_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running NOOS Hub");
}

fn install_app_menu(app: &mut tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    use tauri::menu::PredefinedMenuItem;
    use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind};
    #[cfg(not(target_os = "macos"))]
    use tauri::menu::{Submenu, HELP_SUBMENU_ID};

    let menu = Menu::default(app.handle())?;
    let check_update = MenuItemBuilder::with_id(MENU_CHECK_UPDATE_ID, "Check for Updates...")
        .build(app.handle())?;

    #[cfg(target_os = "macos")]
    {
        let separator = PredefinedMenuItem::separator(app.handle())?;
        if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
            app_menu.insert_items(&[&check_update, &separator], 2)?;
        } else {
            menu.append_items(&[&check_update])?;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(MenuItemKind::Submenu(help_menu)) = menu.get(HELP_SUBMENU_ID) {
            help_menu.append_items(&[&check_update])?;
        } else {
            let help_menu = Submenu::with_id_and_items(
                app.handle(),
                HELP_SUBMENU_ID,
                "Help",
                true,
                &[&check_update],
            )?;
            menu.append_items(&[&help_menu])?;
        }
    }

    app.set_menu(menu)?;
    Ok(())
}

fn start_sleep_resume_guard() {
    if env::var("NOOS_HUB_DISABLE_SLEEP_GUARD").is_ok() {
        return;
    }

    thread::spawn(|| {
        let mut previous_epoch = now_epoch();
        loop {
            thread::sleep(Duration::from_secs(SLEEP_GUARD_CHECK_INTERVAL_SECS));
            let current_epoch = now_epoch();
            let gap = current_epoch.saturating_sub(previous_epoch);
            previous_epoch = current_epoch;
            if gap > sleep_resume_gap_threshold_secs() {
                eprintln!(
                    "NOOS Hub detected a long system sleep/resume gap ({gap}s); starting recovery."
                );
                let status = recover_local_write_after_sleep("backend wall-clock gap", Some(gap));
                eprintln!("NOOS Hub sleep/resume recovery: {}", status.message);
                if status.relaunch_recommended
                    && env::var("NOOS_HUB_AUTO_RELAUNCH_AFTER_SLEEP").is_ok()
                {
                    relaunch_hub_process();
                }
            }
        }
    });
}

fn sleep_resume_gap_threshold_secs() -> u64 {
    env::var("NOOS_HUB_SLEEP_GAP_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(SLEEP_GUARD_EXIT_AFTER_GAP_SECS)
}

fn current_sleep_recovery_status() -> SleepRecoveryStatus {
    let status = SLEEP_RECOVERY_STATUS.get_or_init(|| {
        Mutex::new(SleepRecoveryStatus {
            state: SleepRecoveryState::Running,
            last_reason: "startup".to_string(),
            last_resume_epoch: None,
            last_gap_secs: None,
            attempts: 0,
            local_write_healthy: true,
            relaunch_recommended: false,
            message: "NOOS Hub is running.".to_string(),
        })
    });
    status
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| SleepRecoveryStatus {
            state: SleepRecoveryState::Degraded,
            last_reason: "status lock poisoned".to_string(),
            last_resume_epoch: Some(now_epoch()),
            last_gap_secs: None,
            attempts: 0,
            local_write_healthy: false,
            relaunch_recommended: true,
            message: "Sleep recovery status is unavailable; relaunch is recommended.".to_string(),
        })
}

fn set_sleep_recovery_status(next: SleepRecoveryStatus) {
    let status = SLEEP_RECOVERY_STATUS.get_or_init(|| Mutex::new(next.clone()));
    if let Ok(mut guard) = status.lock() {
        *guard = next;
    }
}

fn recover_local_write_after_sleep(reason: &str, gap_secs: Option<u64>) -> SleepRecoveryStatus {
    recover_local_write_after_sleep_with_probes(
        reason,
        gap_secs,
        local_write_health_probe,
        sleep_recovery_cpu_abnormal,
        start_local_write_server,
        true,
    )
}

fn recover_local_write_after_sleep_with_probes(
    reason: &str,
    gap_secs: Option<u64>,
    mut local_write_healthy: impl FnMut() -> bool,
    mut cpu_abnormal: impl FnMut() -> bool,
    mut restart_local_write: impl FnMut(),
    sleep_between_attempts: bool,
) -> SleepRecoveryStatus {
    set_sleep_recovery_status(SleepRecoveryStatus {
        state: SleepRecoveryState::Resumed,
        last_reason: reason.to_string(),
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: gap_secs,
        attempts: 0,
        local_write_healthy: false,
        relaunch_recommended: false,
        message: "System resumed; preparing NOOS Hub recovery.".to_string(),
    });
    invalidate_hub_health_cache();

    for attempt in 1..=SLEEP_RECOVERY_MAX_ATTEMPTS {
        set_sleep_recovery_status(SleepRecoveryStatus {
            state: SleepRecoveryState::Recovering,
            last_reason: reason.to_string(),
            last_resume_epoch: Some(now_epoch()),
            last_gap_secs: gap_secs,
            attempts: attempt,
            local_write_healthy: false,
            relaunch_recommended: false,
            message: format!("Checking local write service after wake, attempt {attempt}."),
        });

        if local_write_healthy() {
            if cpu_abnormal() {
                let degraded = SleepRecoveryStatus {
                    state: SleepRecoveryState::Relaunching,
                    last_reason: reason.to_string(),
                    last_resume_epoch: Some(now_epoch()),
                    last_gap_secs: gap_secs,
                    attempts: attempt,
                    local_write_healthy: true,
                    relaunch_recommended: true,
                    message: "NOOS Hub local write service recovered after wake, but process CPU remains abnormal; relaunch is recommended.".to_string(),
                };
                set_sleep_recovery_status(degraded.clone());
                invalidate_hub_health_cache();
                return degraded;
            }

            let healthy = SleepRecoveryStatus {
                state: SleepRecoveryState::Healthy,
                last_reason: reason.to_string(),
                last_resume_epoch: Some(now_epoch()),
                last_gap_secs: gap_secs,
                attempts: attempt,
                local_write_healthy: true,
                relaunch_recommended: false,
                message: "NOOS Hub recovered after wake; local write service is healthy."
                    .to_string(),
            };
            set_sleep_recovery_status(healthy.clone());
            invalidate_hub_health_cache();
            return healthy;
        }

        restart_local_write();
        if sleep_between_attempts {
            thread::sleep(Duration::from_millis(250 * u64::from(attempt)));
        }
    }

    let degraded = SleepRecoveryStatus {
        state: SleepRecoveryState::Relaunching,
        last_reason: reason.to_string(),
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: gap_secs,
        attempts: SLEEP_RECOVERY_MAX_ATTEMPTS,
        local_write_healthy: false,
        relaunch_recommended: true,
        message: "NOOS Hub could not recover the local write service after wake; relaunch is recommended.".to_string(),
    };
    set_sleep_recovery_status(degraded.clone());
    invalidate_hub_health_cache();
    degraded
}

fn local_write_health_probe() -> bool {
    let Ok(address) = format!("127.0.0.1:{LOCAL_WRITE_PORT}").parse::<SocketAddr>() else {
        return false;
    };
    let timeout = Duration::from_millis(LOCAL_WRITE_RECOVERY_PROBE_TIMEOUT_MS);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }
    let mut response = [0_u8; 256];
    let Ok(read) = stream.read(&mut response) else {
        return false;
    };
    String::from_utf8_lossy(&response[..read]).starts_with("HTTP/1.1 200")
}

fn sleep_recovery_cpu_abnormal() -> bool {
    let Some(cpu_percent) = current_process_cpu_percent() else {
        return false;
    };
    cpu_percent_exceeds_limit(cpu_percent, sleep_recovery_cpu_limit_percent())
}

fn cpu_percent_exceeds_limit(cpu_percent: f32, limit_percent: f32) -> bool {
    cpu_percent > limit_percent
}

fn sleep_recovery_cpu_limit_percent() -> f32 {
    env::var("NOOS_HUB_SLEEP_CPU_LIMIT")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or(SLEEP_RECOVERY_CPU_LIMIT_PERCENT)
}

fn current_process_cpu_percent() -> Option<f32> {
    let pid = std::process::id().to_string();
    let output = Command::new("ps")
        .args(["-p", &pid, "-o", "%cpu="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

fn relaunch_hub_process() {
    let Ok(current_exe) = env::current_exe() else {
        eprintln!("NOOS Hub relaunch requested but current executable could not be resolved.");
        return;
    };
    match Command::new(current_exe).spawn() {
        Ok(_) => {
            eprintln!("NOOS Hub spawned a replacement process after failed sleep recovery.");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("NOOS Hub failed to spawn replacement process: {error}");
        }
    }
}

fn start_local_write_server() {
    thread::spawn(|| {
        let address = format!("127.0.0.1:{LOCAL_WRITE_PORT}");
        let listener = match TcpListener::bind(&address) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("NOOS Hub local write server unavailable on {address}: {error}");
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    thread::spawn(|| {
                        if let Err(error) = handle_local_write_request(stream) {
                            eprintln!("NOOS Hub local write request failed: {error}");
                        }
                    });
                }
                Err(error) => eprintln!("NOOS Hub local write connection failed: {error}"),
            }
        }
    });
}

fn handle_local_write_request(mut stream: TcpStream) -> Result<(), String> {
    let timeout = Some(Duration::from_secs(LOCAL_WRITE_IO_TIMEOUT_SECS));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                let headers = String::from_utf8_lossy(&buffer[..end]);
                content_length = parse_content_length(&headers);
            }
        }
        if let Some(end) = header_end {
            if buffer.len() >= end + 4 + content_length {
                break;
            }
        }
        if buffer.len() > 2_000_000 {
            return write_json_response(
                &mut stream,
                413,
                &write_error("request_too_large", "Request is too large."),
            );
        }
    }

    let Some(end) = header_end else {
        return write_json_response(
            &mut stream,
            400,
            &write_error("bad_request", "Missing HTTP headers."),
        );
    };

    let headers = String::from_utf8_lossy(&buffer[..end]);
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or_default();
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    let method = parts.first().copied().unwrap_or_default();
    let raw_path = parts.get(1).copied().unwrap_or_default();
    let path = request_path(raw_path);
    let origin = header_value(&headers, "origin").unwrap_or_default();

    if method == "OPTIONS" {
        return write_options_response(&mut stream);
    }

    if !origin.is_empty() && !is_allowed_local_write_origin(&origin) {
        return write_json_response(
            &mut stream,
            403,
            &write_error("origin_not_allowed", "Origin is not allowed."),
        );
    }

    if method == "GET" && path == "/health" {
        return write_json_response(
            &mut stream,
            200,
            &LocalWriteHealth {
                ok: true,
                app: "NOOS Hub".to_string(),
                protocol_version: HUB_PROTOCOL_VERSION,
                port: LOCAL_WRITE_PORT,
                vault_path: noos_home().join("vault").display().to_string(),
                paired: read_shuttle_token().is_some(),
            },
        );
    }

    if method == "GET" && path == "/pair" {
        if !is_allowed_browser_connection_origin(&origin) {
            return write_json_response(
                &mut stream,
                403,
                &write_error(
                    "origin_not_allowed",
                    "Browser connection origin is not allowed.",
                ),
            );
        }

        return write_browser_token_response(&mut stream);
    }

    if method == "GET"
        && (path == "/v1/vault/recent"
            || path == "/v1/vault/object"
            || path == "/v1/vault/browse"
            || path == "/v1/wiki/default-target")
    {
        if !is_authorized_handoff_write(&headers) {
            return write_json_response(
                &mut stream,
                401,
                &write_error(
                    "unauthorized",
                    "Browser Shuttle is not connected to NOOS Hub.",
                ),
            );
        }

        if path == "/v1/vault/recent" {
            return write_json_response(&mut stream, 200, &vault_recent_payload(&noos_home()));
        }

        if path == "/v1/wiki/default-target" {
            return write_json_response(&mut stream, 200, &wiki_target_payload());
        }

        if path == "/v1/vault/browse" {
            let folder = query_value(raw_path, "folder");
            let query = query_value(raw_path, "q");
            return write_json_response(
                &mut stream,
                200,
                &vault_browse_payload(&noos_home(), folder.as_deref(), query.as_deref()),
            );
        }

        let key = query_value(raw_path, "key").or_else(|| query_value(raw_path, "lookup_key"));
        let response = key
            .as_deref()
            .map(|lookup_key| vault_object_payload(&noos_home(), lookup_key, None, None))
            .unwrap_or_else(|| json!({ "ok": false, "error_code": "missing_lookup_key", "message": "Missing key query parameter." }));
        let status = if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            200
        } else {
            404
        };
        return write_json_response(&mut stream, status, &response);
    }

    if method == "POST" && path == "/v1/actions" {
        if !is_authorized_handoff_write(&headers) {
            return write_json_response(
                &mut stream,
                401,
                &write_error(
                    "unauthorized",
                    "Browser Shuttle is not connected to NOOS Hub.",
                ),
            );
        }

        let body_start = end + 4;
        let body_end = body_start + content_length;
        let body = &buffer[body_start..body_end.min(buffer.len())];
        let request: HubActionRequest =
            serde_json::from_slice(body).map_err(|error| error.to_string())?;
        let response = run_browser_hub_action(request);
        let status = if response.ok { 200 } else { 400 };
        return write_json_response(&mut stream, status, &response);
    }

    let is_ingest = method == "POST"
        && matches!(
            path,
            "/v1/ingest" | "/v1/handoffs" | "/v1/crystals" | "/v1/results" | "/v1/artifacts"
        );
    if !is_ingest {
        return write_json_response(
            &mut stream,
            404,
            &write_error("not_found", "Endpoint not found."),
        );
    }

    if !is_authorized_handoff_write(&headers) {
        return write_json_response(
            &mut stream,
            401,
            &write_error(
                "unauthorized",
                "Browser Shuttle is not connected to NOOS Hub.",
            ),
        );
    }

    let body_start = end + 4;
    let body_end = body_start + content_length;
    let body = &buffer[body_start..body_end.min(buffer.len())];
    let request_body: Value = serde_json::from_slice(body).map_err(|error| error.to_string())?;
    let response = if is_ingest_payload(&request_body) || path != "/v1/handoffs" {
        let mut request: IngestWriteRequest =
            serde_json::from_value(request_body).map_err(|error| error.to_string())?;
        if request.object_type.is_none() {
            request.object_type = Some(object_type_from_endpoint(path).to_string());
        }
        write_ingest_object_to_local_vault(request)
    } else {
        let request: HandoffWriteRequest =
            serde_json::from_value(request_body).map_err(|error| error.to_string())?;
        write_artifact_to_local_vault(request)
    };
    let status = if response.ok { 200 } else { 400 };
    write_json_response(&mut stream, status, &response)
}

fn wiki_target_payload() -> Value {
    let project_path = configured_default_wiki_project_path();
    let category_state = project_path
        .as_ref()
        .map(|path| wiki_category_state(path))
        .unwrap_or_else(|| (None, Vec::new()));
    json!({
        "ok": true,
        "project_path": project_path.as_ref().map(|path| path.display().to_string()),
        "current_category_path": category_state.0,
        "recent_category_paths": category_state.1,
        "message": if project_path.is_some() { "Default Wiki project loaded." } else { "No default Wiki project configured." },
    })
}

fn run_browser_hub_action(request: HubActionRequest) -> HubActionResponse {
    match request.command.as_str() {
        "feishu.exportMd" | "feishu.syncMarkdown" => export_feishu_md(request, false),
        "feishu.exportMdAndOrganize" | "feishu.syncMarkdownAndOrganize" => {
            export_feishu_md(request, true)
        }
        "feishu.publishMarkdown" => publish_feishu_markdown(request),
        "wiki.setFeishuCategory" => set_feishu_category(request),
        "wiki.organizeSource" => organize_wiki_source(request),
        "wiki.openFeishuSourceFolder" => open_feishu_source_folder(request),
        "wiki.openProjectFolder" => open_wiki_project_folder(request),
        _ => hub_action_error(
            "export_failed",
            "Unknown Hub action command.",
            None,
            request.wiki_project_path,
        ),
    }
}

fn set_feishu_category(request: HubActionRequest) -> HubActionResponse {
    let Some(wiki_project_path) = resolve_wiki_project_path(request.wiki_project_path.as_deref())
    else {
        return hub_action_error(
            "config_write_failed",
            "No default Wiki project configured in NOOS Hub.",
            None,
            request.wiki_project_path,
        );
    };
    let category_path = match sanitize_category_path(request.category_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return hub_action_error(
                "missing_category_path",
                &error,
                None,
                Some(wiki_project_path.display().to_string()),
            );
        }
    };

    if let Err(error) = remember_wiki_category_path(&wiki_project_path, &category_path) {
        return hub_action_error(
            "config_write_failed",
            &error,
            None,
            Some(wiki_project_path.display().to_string()),
        );
    }

    HubActionResponse {
        ok: true,
        status: "category_changed".to_string(),
        message: format!("Document library category set to {category_path}."),
        error_code: None,
        source_path: None,
        wiki_project_path: Some(wiki_project_path.display().to_string()),
        document_url: None,
        folder_name: None,
        changed: Some(true),
    }
}

fn export_feishu_md(request: HubActionRequest, organize: bool) -> HubActionResponse {
    let Some(url) = request.url.as_deref() else {
        return hub_action_error(
            "export_failed",
            "Missing Feishu document URL.",
            None,
            request.wiki_project_path,
        );
    };
    let Some(wiki_project_path) = resolve_wiki_project_path(request.wiki_project_path.as_deref())
    else {
        return hub_action_error(
            "export_failed",
            "No default Wiki project configured in NOOS Hub.",
            None,
            request.wiki_project_path,
        );
    };
    let category_path = match sanitize_category_path(request.category_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return hub_action_error(
                "missing_category_path",
                &error,
                None,
                Some(wiki_project_path.display().to_string()),
            );
        }
    };

    let token = feishu_token_from_url(url).unwrap_or_else(|| stable_hash_hex(url));
    let source_id = feishu_source_id(&token);
    let title = request
        .title
        .as_deref()
        .unwrap_or("Untitled Feishu Document");
    let source_path = feishu_source_path(&wiki_project_path, &category_path, &token, Some(title));
    let existing_source_path = existing_feishu_source_path(
        &wiki_project_path,
        &source_id,
        url,
        Some(title),
        Some(&category_path),
    )
    .unwrap_or_else(|| source_path.clone());
    let exported = match export_feishu_package(url, &source_id) {
        Ok(package) => package,
        Err(error) => {
            let code = if looks_like_feishu_auth_error(&error) {
                "needs_auth"
            } else {
                "export_failed"
            };
            return hub_action_error(
                code,
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
    };
    let asset_root = format!(".assets/{source_id}");
    let asset_target = source_path
        .parent()
        .unwrap_or_else(|| wiki_project_path.as_path())
        .join(&asset_root);
    let normalized_markdown =
        normalize_exported_markdown_resources(&exported.markdown, &exported.resources, &asset_root);

    let previous = fs::read_to_string(&existing_source_path).unwrap_or_default();
    let changed = feishu_source_body(&previous) != normalized_markdown.trim();
    let last_exported_at = now_iso_utc();
    let library_metadata = LibrarySourceMetadata {
        source_id: source_id.clone(),
        source_app: "feishu".to_string(),
        source_url: url.to_string(),
        title: title.to_string(),
        category_path: category_path.clone(),
        source_path: source_path.clone(),
        asset_root: asset_root.clone(),
        export_mode: exported.export_mode.clone(),
        content_hash: format!("sha256ish:{}", stable_hash_hex(normalized_markdown.trim())),
        resource_count: exported.resources.len(),
        last_exported_at: last_exported_at.clone(),
        wiki_status: if organize { "pending" } else { "not_ingested" }.to_string(),
    };
    let markdown = build_feishu_source_markdown(
        &normalized_markdown,
        url,
        title,
        &token,
        &source_id,
        &category_path,
        &asset_root,
        &exported.export_mode,
        &last_exported_at,
    );
    let source_location_changed = existing_source_path != source_path;
    let metadata_matches = feishu_source_metadata_matches(
        &previous,
        &source_id,
        &category_path,
        &asset_root,
        &exported.export_mode,
    );
    if !changed {
        if let Err(error) = migrate_feishu_source_path(&existing_source_path, &source_path) {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "export_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        if let Err(error) = migrate_library_assets(&existing_source_path, &asset_target, &source_id)
        {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "export_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        if let Err(error) = write_exported_resources(&exported.resources, &asset_target) {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "export_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        if source_location_changed || !metadata_matches {
            if let Err(error) = write_feishu_source(&source_path, &markdown) {
                cleanup_feishu_export_package(&exported);
                return hub_action_error(
                    "export_failed",
                    &error,
                    Some(source_path.display().to_string()),
                    Some(wiki_project_path.display().to_string()),
                );
            }
        }
        if let Err(error) = update_knowledge_library(&wiki_project_path, &library_metadata) {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "index_write_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        if let Err(error) = remember_wiki_category_path(&wiki_project_path, &category_path) {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "config_write_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        if organize {
            if let Err(error) = queue_wiki_organize_by_touch(&source_path) {
                cleanup_feishu_export_package(&exported);
                return hub_action_error(
                    "organize_failed",
                    &error,
                    Some(source_path.display().to_string()),
                    Some(wiki_project_path.display().to_string()),
                );
            }
        }
        cleanup_feishu_export_package(&exported);
        return HubActionResponse {
            ok: true,
            status: if organize { "queued" } else { "unchanged" }.to_string(),
            message: if organize {
                "Feishu package is unchanged and Wiki organization queued.".to_string()
            } else {
                "Feishu package source is unchanged.".to_string()
            },
            error_code: None,
            source_path: Some(source_path.display().to_string()),
            wiki_project_path: Some(wiki_project_path.display().to_string()),
            document_url: None,
            folder_name: None,
            changed: Some(organize),
        };
    }

    if let Err(error) = migrate_feishu_source_path(&existing_source_path, &source_path) {
        cleanup_feishu_export_package(&exported);
        return hub_action_error(
            "export_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    if let Err(error) = write_exported_resources(&exported.resources, &asset_target) {
        cleanup_feishu_export_package(&exported);
        return hub_action_error(
            "export_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    if let Err(error) = write_feishu_source(&source_path, &markdown) {
        cleanup_feishu_export_package(&exported);
        return hub_action_error(
            "export_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    if let Err(error) = update_knowledge_library(&wiki_project_path, &library_metadata) {
        cleanup_feishu_export_package(&exported);
        return hub_action_error(
            "index_write_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    if let Err(error) = remember_wiki_category_path(&wiki_project_path, &category_path) {
        cleanup_feishu_export_package(&exported);
        return hub_action_error(
            "config_write_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }

    if organize {
        if let Err(error) = queue_wiki_organize_by_touch(&source_path) {
            cleanup_feishu_export_package(&exported);
            return hub_action_error(
                "organize_failed",
                &error,
                Some(source_path.display().to_string()),
                Some(wiki_project_path.display().to_string()),
            );
        }
        cleanup_feishu_export_package(&exported);
        return HubActionResponse {
            ok: true,
            status: "queued".to_string(),
            message: "Feishu package exported and Wiki organization queued.".to_string(),
            error_code: None,
            source_path: Some(source_path.display().to_string()),
            wiki_project_path: Some(wiki_project_path.display().to_string()),
            document_url: None,
            folder_name: None,
            changed: Some(true),
        };
    }

    cleanup_feishu_export_package(&exported);
    HubActionResponse {
        ok: true,
        status: "exported".to_string(),
        message: "Feishu package exported to the document library.".to_string(),
        error_code: None,
        source_path: Some(source_path.display().to_string()),
        wiki_project_path: Some(wiki_project_path.display().to_string()),
        document_url: None,
        folder_name: None,
        changed: Some(true),
    }
}

fn publish_feishu_markdown(request: HubActionRequest) -> HubActionResponse {
    let Some(source_key) = request
        .source_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    else {
        return hub_action_error(
            "source_not_found",
            "Missing NOOS Markdown source key.",
            None,
            request.wiki_project_path,
        );
    };
    let source = match read_vault_markdown_source(source_key) {
        Ok(source) => source,
        Err((code, message)) => {
            return hub_action_error(&code, &message, None, request.wiki_project_path);
        }
    };
    let title = source
        .title
        .clone()
        .unwrap_or_else(|| "NOOS Markdown".to_string());
    let markdown = match prepare_feishu_publish_markdown(&source.content, &title) {
        Ok(markdown) => markdown,
        Err(message) => {
            return hub_action_error(
                "invalid_markdown",
                &message,
                Some(source.path.display().to_string()),
                request.wiki_project_path,
            );
        }
    };
    let mode = request.mode.as_deref().unwrap_or("create");
    if mode == "overwrite" {
        let Some(url) = request
            .url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        else {
            return hub_action_error(
                "overwrite_failed",
                "Missing current Feishu document URL.",
                Some(source.path.display().to_string()),
                request.wiki_project_path,
            );
        };
        match overwrite_feishu_document(url, &markdown) {
            Ok(document_url) => HubActionResponse {
                ok: true,
                status: "overwritten".to_string(),
                message: "Current Feishu document overwritten from NOOS Markdown.".to_string(),
                error_code: None,
                source_path: Some(source.path.display().to_string()),
                wiki_project_path: None,
                document_url: Some(document_url.unwrap_or_else(|| url.to_string())),
                folder_name: request.folder_name,
                changed: Some(true),
            },
            Err(error) => hub_action_error(
                if looks_like_feishu_auth_error(&error) {
                    "needs_auth"
                } else {
                    "overwrite_failed"
                },
                &error,
                Some(source.path.display().to_string()),
                request.wiki_project_path,
            ),
        }
    } else {
        let destination = request.destination_kind.as_deref().unwrap_or("drive_root");
        match create_feishu_document(&markdown, destination, request.folder_token.as_deref()) {
            Ok(document_url) => HubActionResponse {
                ok: true,
                status: "published".to_string(),
                message: format!(
                    "NOOS Markdown published as a Feishu document: {}",
                    source.lookup_key
                ),
                error_code: None,
                source_path: Some(source.path.display().to_string()),
                wiki_project_path: None,
                document_url,
                folder_name: request.folder_name,
                changed: Some(true),
            },
            Err(error) => hub_action_error(
                if looks_like_feishu_auth_error(&error) {
                    "needs_auth"
                } else {
                    "publish_failed"
                },
                &error,
                Some(source.path.display().to_string()),
                request.wiki_project_path,
            ),
        }
    }
}

fn organize_wiki_source(request: HubActionRequest) -> HubActionResponse {
    let Some(url) = request.url.as_deref() else {
        return hub_action_error(
            "organize_failed",
            "Missing Feishu document URL.",
            None,
            request.wiki_project_path,
        );
    };
    let Some(wiki_project_path) = resolve_wiki_project_path(request.wiki_project_path.as_deref())
    else {
        return hub_action_error(
            "organize_failed",
            "No default Wiki project configured in NOOS Hub.",
            None,
            request.wiki_project_path,
        );
    };
    let token = feishu_token_from_url(url).unwrap_or_else(|| stable_hash_hex(url));
    let source_id = feishu_source_id(&token);
    let category_path = request
        .category_path
        .as_deref()
        .and_then(|path| sanitize_category_path(Some(path)).ok())
        .or_else(|| wiki_category_state(&wiki_project_path).0);
    let source_path = existing_feishu_source_path(
        &wiki_project_path,
        &source_id,
        url,
        request.title.as_deref(),
        category_path.as_deref(),
    )
    .unwrap_or_else(|| {
        feishu_source_path(
            &wiki_project_path,
            category_path.as_deref().unwrap_or(""),
            &token,
            request.title.as_deref(),
        )
    });
    if !source_path.exists() {
        return hub_action_error(
            "export_failed",
            "No exported MD source exists for this Feishu document yet.",
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    if let Err(error) = queue_wiki_organize_by_touch(&source_path) {
        return hub_action_error(
            "organize_failed",
            &error,
            Some(source_path.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }

    HubActionResponse {
        ok: true,
        status: "queued".to_string(),
        message: "Wiki organization queued for the exported Feishu source.".to_string(),
        error_code: None,
        source_path: Some(source_path.display().to_string()),
        wiki_project_path: Some(wiki_project_path.display().to_string()),
        document_url: None,
        folder_name: None,
        changed: request.force,
    }
}

fn open_feishu_source_folder(request: HubActionRequest) -> HubActionResponse {
    let Some(wiki_project_path) = resolve_wiki_project_path(request.wiki_project_path.as_deref())
    else {
        return hub_action_error(
            "open_failed",
            "No default Wiki project configured in NOOS Hub.",
            None,
            request.wiki_project_path,
        );
    };
    let category_path = request
        .category_path
        .as_deref()
        .and_then(|path| sanitize_category_path(Some(path)).ok())
        .or_else(|| wiki_category_state(&wiki_project_path).0)
        .unwrap_or_default();
    let source_folder = library_source_folder(&wiki_project_path, &category_path);
    if let Err(error) = fs::create_dir_all(&source_folder) {
        return hub_action_error(
            "open_failed",
            &error.to_string(),
            Some(source_folder.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        );
    }
    match open_existing_path(&source_folder) {
        Ok(message) => HubActionResponse {
            ok: true,
            status: "opened".to_string(),
            message,
            error_code: None,
            source_path: Some(source_folder.display().to_string()),
            wiki_project_path: Some(wiki_project_path.display().to_string()),
            document_url: None,
            folder_name: None,
            changed: None,
        },
        Err(error) => hub_action_error(
            "open_failed",
            &error,
            Some(source_folder.display().to_string()),
            Some(wiki_project_path.display().to_string()),
        ),
    }
}

fn open_wiki_project_folder(request: HubActionRequest) -> HubActionResponse {
    let Some(wiki_project_path) = resolve_wiki_project_path(request.wiki_project_path.as_deref())
    else {
        return hub_action_error(
            "open_failed",
            "No default Wiki project configured in NOOS Hub.",
            None,
            request.wiki_project_path,
        );
    };
    if !wiki_project_path.exists() {
        return hub_action_error(
            "open_failed",
            "Wiki project directory does not exist.",
            None,
            Some(wiki_project_path.display().to_string()),
        );
    }
    match open_existing_path(&wiki_project_path) {
        Ok(message) => HubActionResponse {
            ok: true,
            status: "opened".to_string(),
            message,
            error_code: None,
            source_path: None,
            wiki_project_path: Some(wiki_project_path.display().to_string()),
            document_url: None,
            folder_name: None,
            changed: None,
        },
        Err(error) => hub_action_error(
            "open_failed",
            &error,
            None,
            Some(wiki_project_path.display().to_string()),
        ),
    }
}

fn hub_action_error(
    code: &str,
    message: &str,
    source_path: Option<String>,
    wiki_project_path: Option<String>,
) -> HubActionResponse {
    HubActionResponse {
        ok: false,
        status: code.to_string(),
        message: message.to_string(),
        error_code: Some(code.to_string()),
        source_path,
        wiki_project_path,
        document_url: None,
        folder_name: None,
        changed: None,
    }
}

fn resolve_wiki_project_path(explicit_path: Option<&str>) -> Option<PathBuf> {
    explicit_path
        .filter(|path| !path.trim().is_empty())
        .map(expand_user_path)
        .or_else(configured_default_wiki_project_path)
}

fn configured_default_wiki_project_path() -> Option<PathBuf> {
    configured_default_wiki_project_path_from(&noos_home())
}

fn configured_default_wiki_project_path_from(noos_home: &Path) -> Option<PathBuf> {
    let config = read_json_object(&noos_home.join("config.json"));
    string_config_value(&config, &["default_wiki_project"])
        .or_else(|| string_config_value(&config, &["defaultWikiProject"]))
        .or_else(|| string_config_value(&config, &["llm_wiki", "default_project"]))
        .or_else(|| string_config_value(&config, &["llmWiki", "defaultProject"]))
        .or_else(|| string_config_value(&config, &["wiki", "default_project"]))
        .or_else(|| string_config_value(&config, &["wiki", "project_path"]))
        .map(|path| expand_user_path(&path))
}

fn wiki_category_state(wiki_project_path: &Path) -> (Option<String>, Vec<String>) {
    wiki_category_state_from(&noos_home(), wiki_project_path)
}

fn wiki_category_state_from(
    noos_home: &Path,
    wiki_project_path: &Path,
) -> (Option<String>, Vec<String>) {
    let config = read_json_object(&noos_home.join("config.json"));
    let key = wiki_project_key(wiki_project_path);
    let project_state = config
        .get("wiki")
        .and_then(|wiki| wiki.get("category_paths"))
        .and_then(|paths| paths.get(&key));
    let current = project_state
        .and_then(|state| state.get("last_category_path"))
        .and_then(Value::as_str)
        .and_then(sanitize_config_category_path)
        .or_else(|| {
            config
                .get("feishu")
                .and_then(|feishu| feishu.get("last_category_path"))
                .and_then(Value::as_str)
                .and_then(sanitize_config_category_path)
        });
    let recent = project_state
        .and_then(|state| state.get("recent_category_paths"))
        .and_then(Value::as_array)
        .map(|items| {
            let mut recent = Vec::new();
            for path in items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(sanitize_config_category_path)
            {
                if !recent.contains(&path) {
                    recent.push(path);
                }
            }
            recent
        })
        .unwrap_or_default();
    (current, recent)
}

fn sanitize_config_category_path(path: &str) -> Option<String> {
    sanitize_category_path(Some(path)).ok()
}

fn remember_wiki_category_path(
    wiki_project_path: &Path,
    category_path: &str,
) -> Result<(), String> {
    let config_path = noos_home().join("config.json");
    let mut config = read_config_for_write(&config_path)?;
    let key = wiki_project_key(wiki_project_path);
    let mut recent = wiki_category_state(wiki_project_path).1;
    recent.retain(|path| path != category_path);
    recent.insert(0, category_path.to_string());
    recent.truncate(10);

    if !config.get("wiki").map(Value::is_object).unwrap_or(false) {
        config["wiki"] = json!({});
    }
    if !config["wiki"]
        .get("category_paths")
        .map(Value::is_object)
        .unwrap_or(false)
    {
        config["wiki"]["category_paths"] = json!({});
    }
    config["wiki"]["category_paths"][key.as_str()] = json!({
        "last_category_path": category_path,
        "recent_category_paths": recent,
    });
    write_json_file(&config_path, &config)
}

fn wiki_project_key(wiki_project_path: &Path) -> String {
    stable_hash_hex(&wiki_project_path.display().to_string())
}

fn string_config_value(config: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = config;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn expand_user_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        return home_dir().join(stripped);
    }
    PathBuf::from(path)
}

fn feishu_source_path(
    wiki_project_path: &Path,
    category_path: &str,
    token: &str,
    title: Option<&str>,
) -> PathBuf {
    let filename = format!(
        "{}--{}.md",
        source_title_slug(title.unwrap_or("untitled")),
        source_id_short_slug(token)
    );
    library_source_folder(wiki_project_path, category_path).join(filename)
}

fn existing_feishu_source_path(
    wiki_project_path: &Path,
    source_id: &str,
    url: &str,
    title: Option<&str>,
    category_path: Option<&str>,
) -> Option<PathBuf> {
    if let Some(path) = source_path_from_source_map(wiki_project_path, source_id) {
        if path.exists() {
            return Some(path);
        }
    }

    let id = feishu_token_from_url(url).unwrap_or_else(|| stable_hash_hex(url));
    if let Some(category_path) = category_path {
        let target = feishu_source_path(wiki_project_path, category_path, &id, title);
        if target.exists() {
            return Some(target);
        }
    }

    let folder = legacy_feishu_source_folder(wiki_project_path);
    let legacy = folder.join(format!("feishu-{}.md", source_id_slug(&id)));
    if legacy.exists() {
        return Some(legacy);
    }

    let suffix = format!("--{}.md", source_id_short_slug(&id));
    fs::read_dir(&folder)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("feishu-") && name.ends_with(&suffix))
                .unwrap_or(false)
        })
}

fn library_source_folder(wiki_project_path: &Path, category_path: &str) -> PathBuf {
    let base = wiki_project_path.join("raw").join("sources");
    if category_path.trim().is_empty() {
        base
    } else {
        base.join(category_path)
    }
}

fn migrate_feishu_source_path(existing_path: &Path, target_path: &Path) -> Result<(), String> {
    if existing_path == target_path || !existing_path.exists() {
        return Ok(());
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if target_path.exists() {
        fs::remove_file(existing_path).map_err(|error| error.to_string())?;
        return Ok(());
    }
    fs::rename(existing_path, target_path).map_err(|error| error.to_string())
}

fn migrate_library_assets(
    existing_source_path: &Path,
    target_asset_path: &Path,
    source_id: &str,
) -> Result<(), String> {
    let Some(existing_parent) = existing_source_path.parent() else {
        return Ok(());
    };
    let existing_asset_path = existing_parent.join(".assets").join(source_id);
    if existing_asset_path == target_asset_path
        || !existing_asset_path.exists()
        || target_asset_path.exists()
    {
        return Ok(());
    }
    if let Some(parent) = target_asset_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(existing_asset_path, target_asset_path).map_err(|error| error.to_string())
}

fn legacy_feishu_source_folder(wiki_project_path: &Path) -> PathBuf {
    wiki_project_path.join("raw").join("sources").join("feishu")
}

fn sanitize_category_path(path: Option<&str>) -> Result<String, String> {
    let raw = path.unwrap_or("").trim();
    if raw.is_empty() {
        return Err("Choose a document library category before exporting.".to_string());
    }
    if raw.starts_with('/') || raw.starts_with('\\') || raw.contains(':') {
        return Err("Category path must be relative.".to_string());
    }

    let mut parts = Vec::new();
    for part in raw.split(['/', '\\']) {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." {
            return Err("Category path contains an invalid segment.".to_string());
        }
        if part.starts_with('.') {
            return Err("Category path cannot contain hidden directory segments.".to_string());
        }
        if part
            .chars()
            .any(|character| character.is_control() || character == ':')
        {
            return Err("Category path contains unsupported characters.".to_string());
        }
        parts.push(source_title_slug(part));
    }

    if parts.is_empty() {
        Err("Choose a document library category before exporting.".to_string())
    } else {
        Ok(parts.join("/"))
    }
}

fn feishu_source_id(token: &str) -> String {
    format!("feishu_docx_{}", source_id_slug(token))
}

fn feishu_token_from_url(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or(url);
    for marker in ["/docx/", "/wiki/", "/sheets/", "/base/", "/bitable/"] {
        if let Some(rest) = path.split(marker).nth(1) {
            let token = rest
                .split(['/', '#', '?'])
                .next()
                .unwrap_or_default()
                .trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn source_id_slug(value: &str) -> String {
    let slug: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(80)
        .collect();
    if slug.is_empty() {
        stable_hash_hex(value)
    } else {
        slug
    }
}

fn source_id_short_slug(value: &str) -> String {
    source_id_slug(value).chars().take(12).collect()
}

fn source_title_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in value.chars() {
        let next = if character.is_ascii_alphanumeric() {
            Some(character.to_ascii_lowercase())
        } else if character == '-' || character == '_' || is_cjk_unified_ideograph(character) {
            Some(character)
        } else if character.is_whitespace() || character.is_ascii_punctuation() {
            Some('-')
        } else {
            Some('-')
        };

        if let Some(character) = next {
            if character == '-' {
                if previous_dash {
                    continue;
                }
                previous_dash = true;
            } else {
                previous_dash = false;
            }
            slug.push(character);
        }
        if slug.chars().count() >= 80 {
            break;
        }
    }

    let slug = slug.trim_matches(['-', '_']).to_string();
    if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

fn is_cjk_unified_ideograph(character: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&character)
        || ('\u{3400}'..='\u{4dbf}').contains(&character)
        || ('\u{f900}'..='\u{faff}').contains(&character)
}

fn export_feishu_markdown(url: &str) -> Result<String, String> {
    let attempts: Vec<Vec<String>> = vec![
        vec![
            "export".to_string(),
            url.to_string(),
            "--stdout".to_string(),
        ],
        vec![
            "export".to_string(),
            "--url".to_string(),
            url.to_string(),
            "--stdout".to_string(),
        ],
    ];
    let commands = feishu_docx_command_candidates();
    for args in attempts {
        for command in &commands {
            let output = Command::new(command).args(&args).output();
            let Ok(output) = output else {
                continue;
            };
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() && !stdout.is_empty() {
                return Ok(stdout);
            }
            if looks_like_feishu_auth_error(&stderr) {
                return Err(stderr);
            }
        }
    }

    Err("Feishu MD export failed. Install/configure feishu-docx or complete Feishu authorization in NOOS Hub.".to_string())
}

fn export_feishu_package(url: &str, source_id: &str) -> Result<FeishuExportPackage, String> {
    let temp_root = env::temp_dir().join(format!(
        "noos-feishu-export-{}-{}",
        std::process::id(),
        TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let package_attempts = feishu_package_export_attempts(url, &temp_root, source_id);
    let commands = feishu_docx_command_candidates();
    let mut last_error = String::new();
    for args in package_attempts {
        for command in &commands {
            if temp_root.exists() {
                fs::remove_dir_all(&temp_root).map_err(|error| error.to_string())?;
            }
            fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
            let output = Command::new(command).args(&args).output();
            let Ok(output) = output else {
                continue;
            };
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                match normalize_feishu_export_dir(&temp_root, source_id) {
                    Ok(package) => {
                        return Ok(package);
                    }
                    Err(error) => {
                        last_error = error;
                    }
                }
            } else if looks_like_feishu_auth_error(&stderr) {
                let _ = fs::remove_dir_all(&temp_root);
                return Err(stderr);
            } else {
                last_error = if stderr.is_empty() { stdout } else { stderr };
            }
        }
    }
    let _ = fs::remove_dir_all(&temp_root);

    match export_feishu_markdown(url) {
        Ok(markdown) => Ok(FeishuExportPackage {
            markdown,
            resources: Vec::new(),
            export_mode: "stdout".to_string(),
            temp_root: None,
        }),
        Err(error) => {
            if last_error.is_empty() {
                Err(error)
            } else {
                Err(format!("{last_error}\n{error}"))
            }
        }
    }
}

fn feishu_package_export_attempts(
    url: &str,
    output_dir: &Path,
    stable_name: &str,
) -> Vec<Vec<String>> {
    let base = vec![
        "export".to_string(),
        url.to_string(),
        "-o".to_string(),
        output_dir.display().to_string(),
        "-n".to_string(),
        stable_name.to_string(),
        "--table".to_string(),
        "md".to_string(),
    ];
    let mut with_board_metadata = base.clone();
    with_board_metadata.push("--export-board-metadata".to_string());
    vec![with_board_metadata, base]
}

fn normalize_feishu_export_dir(
    root: &Path,
    source_id: &str,
) -> Result<FeishuExportPackage, String> {
    let files = collect_files_recursive(root)?;
    let main_markdown = select_main_markdown(root, &files, source_id)
        .ok_or_else(|| "Feishu package export did not produce a Markdown file.".to_string())?;
    let markdown = fs::read_to_string(&main_markdown).map_err(|error| error.to_string())?;
    let resources = files
        .into_iter()
        .filter(|path| path != &main_markdown)
        .filter_map(|source_path| {
            let original_relative_path = source_path
                .strip_prefix(root)
                .ok()
                .and_then(|path| normalize_path_for_markdown(path).ok())?;
            let relative_path = original_relative_path
                .strip_prefix(&format!("{source_id}/"))
                .unwrap_or(original_relative_path.as_str())
                .to_string();
            Some(ExportedResource {
                source_path,
                original_relative_path,
                relative_path,
            })
        })
        .collect();
    Ok(FeishuExportPackage {
        markdown,
        resources,
        export_mode: "package".to_string(),
        temp_root: Some(root.to_path_buf()),
    })
}

fn collect_files_recursive(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_files_recursive(&path)?);
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(files)
}

fn select_main_markdown(root: &Path, files: &[PathBuf], source_id: &str) -> Option<PathBuf> {
    let expected = root.join(format!("{source_id}.md"));
    if expected.exists() {
        return Some(expected);
    }
    let mut candidates: Vec<PathBuf> = files
        .iter()
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    candidates.sort_by_key(|path| {
        let depth = path
            .strip_prefix(root)
            .ok()
            .map(|rel| rel.components().count())
            .unwrap_or(usize::MAX);
        let size = fs::metadata(path).ok().map(|meta| meta.len()).unwrap_or(0);
        (depth, std::cmp::Reverse(size))
    });
    candidates.into_iter().next()
}

fn normalize_path_for_markdown(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                parts.push(part.to_string_lossy().replace('\\', "/"));
            }
            _ => return Err("Invalid exported resource path.".to_string()),
        }
    }
    Ok(parts.join("/"))
}

fn normalize_exported_markdown_resources(
    markdown: &str,
    resources: &[ExportedResource],
    asset_root: &str,
) -> String {
    let mut normalized = markdown.to_string();
    for resource in resources {
        for from in [
            resource.original_relative_path.as_str(),
            resource.relative_path.as_str(),
        ] {
            let to = format!(
                "{}/{}",
                asset_root.trim_end_matches('/'),
                resource.relative_path
            );
            for prefix in ["", "./"] {
                normalized = normalized.replace(&format!("]({prefix}{from})"), &format!("]({to})"));
                normalized = normalized
                    .replace(&format!("src=\"{prefix}{from}\""), &format!("src=\"{to}\""));
                normalized =
                    normalized.replace(&format!("src='{prefix}{from}'"), &format!("src='{to}'"));
            }
        }
    }
    normalized
}

fn write_exported_resources(
    resources: &[ExportedResource],
    asset_target: &Path,
) -> Result<(), String> {
    if asset_target.exists() {
        fs::remove_dir_all(asset_target).map_err(|error| error.to_string())?;
    }
    if resources.is_empty() {
        return Ok(());
    }
    for resource in resources {
        let target = asset_target.join(&resource.relative_path);
        let parent = target
            .parent()
            .ok_or_else(|| "Invalid asset target path.".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        fs::copy(&resource.source_path, &target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn cleanup_feishu_export_package(package: &FeishuExportPackage) {
    if let Some(temp_root) = package.temp_root.as_ref() {
        let _ = fs::remove_dir_all(temp_root);
    }
}

fn source_path_from_source_map(wiki_project_path: &Path, source_id: &str) -> Option<PathBuf> {
    let map = read_json_object(&knowledge_source_map_path(wiki_project_path));
    let sources = map.get("sources")?.as_array()?;
    let source = sources.iter().find(|source| {
        source
            .get("source_id")
            .and_then(Value::as_str)
            .map(|value| value == source_id)
            .unwrap_or(false)
    })?;
    let source_path = source.get("source_path")?.as_str()?;
    let relative_path = sanitize_source_map_source_path(source_path)?;
    let path = wiki_project_path.join(relative_path);
    if library_source_path_allowed_for_wiki(&path, wiki_project_path) {
        Some(path)
    } else {
        None
    }
}

fn sanitize_source_map_source_path(source_path: &str) -> Option<PathBuf> {
    let source_path = source_path.trim();
    if source_path.is_empty() {
        return None;
    }
    let path = Path::new(source_path);
    if path.is_absolute() {
        return None;
    }

    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => {
                let segment_text = segment.to_str()?;
                if segment_text
                    .chars()
                    .any(|character| character.is_control() || character == ':')
                {
                    return None;
                }
                relative.push(segment);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    let raw_sources = Path::new("raw").join("sources");
    let is_markdown = relative
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !relative.starts_with(&raw_sources) || !is_markdown {
        return None;
    }
    Some(relative)
}

fn update_knowledge_library(
    wiki_project_path: &Path,
    metadata: &LibrarySourceMetadata,
) -> Result<(), String> {
    let library_dir = wiki_project_path.join("knowledge-library");
    fs::create_dir_all(library_dir.join("canon")).map_err(|error| error.to_string())?;

    let source_path = relative_path_string(wiki_project_path, &metadata.source_path);
    let content = fs::read_to_string(&metadata.source_path).unwrap_or_default();
    let body = feishu_source_body(&content);
    let headings = extract_markdown_headings(body, 8);
    let summary = summarize_markdown_body(body);
    let resource_summary = resource_summary(metadata.resource_count, body);

    let mut source_map = read_json_object(&knowledge_source_map_path(wiki_project_path));
    let mut sources = source_map
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let existing = sources
        .iter()
        .find(|source| {
            source
                .get("source_id")
                .and_then(Value::as_str)
                .map(|value| value == metadata.source_id)
                .unwrap_or(false)
        })
        .cloned();
    sources.retain(|source| {
        source
            .get("source_id")
            .and_then(Value::as_str)
            .map(|value| value != metadata.source_id)
            .unwrap_or(true)
    });
    let wiki_refs = existing
        .as_ref()
        .and_then(|source| source.get("wiki_refs"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let wiki_status = if wiki_refs
        .as_array()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
    {
        "ingested"
    } else {
        metadata.wiki_status.as_str()
    };

    sources.push(json!({
        "source_id": metadata.source_id.clone(),
        "source_app": metadata.source_app.clone(),
        "source_url": metadata.source_url.clone(),
        "category_path": metadata.category_path.clone(),
        "title": metadata.title.clone(),
        "source_path": source_path,
        "asset_root": metadata.asset_root.clone(),
        "content_hash": metadata.content_hash.clone(),
        "resource_count": metadata.resource_count,
        "resource_summary": resource_summary,
        "summary": summary,
        "headings": headings,
        "open_when": open_when_for_source(&metadata.category_path, &metadata.title, metadata.resource_count),
        "wiki_refs": wiki_refs,
        "wiki_status": wiki_status,
        "last_exported_at": metadata.last_exported_at.clone(),
        "export_mode": metadata.export_mode.clone(),
    }));
    sources.sort_by(|a, b| {
        let a_key = format!(
            "{}\u{0}{}",
            a.get("category_path").and_then(Value::as_str).unwrap_or(""),
            a.get("title").and_then(Value::as_str).unwrap_or("")
        );
        let b_key = format!(
            "{}\u{0}{}",
            b.get("category_path").and_then(Value::as_str).unwrap_or(""),
            b.get("title").and_then(Value::as_str).unwrap_or("")
        );
        a_key.cmp(&b_key)
    });

    source_map = json!({
        "schema": "noos/knowledge-source-map@0.1",
        "updated_at": metadata.last_exported_at,
        "sources": sources,
    });
    write_json_file(&knowledge_source_map_path(wiki_project_path), &source_map)?;

    let manifest = json!({
        "schema": "noos/knowledge-library-manifest@0.1",
        "updated_at": metadata.last_exported_at,
        "source_count": source_map.get("sources").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        "main": "index.md",
        "abstracts": "abstracts.md",
        "source_map": "source-map.json",
        "sources": source_map.get("sources").cloned().unwrap_or_else(|| json!([])),
    });
    write_json_file(&library_dir.join("manifest.json"), &manifest)?;
    write_bytes_atomic(
        &library_dir.join("index.md"),
        render_knowledge_index(&source_map).as_bytes(),
    )?;
    write_bytes_atomic(
        &library_dir.join("abstracts.md"),
        render_knowledge_abstracts(&source_map).as_bytes(),
    )?;
    Ok(())
}

fn knowledge_source_map_path(wiki_project_path: &Path) -> PathBuf {
    wiki_project_path
        .join("knowledge-library")
        .join("source-map.json")
}

fn relative_path_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .and_then(|path| normalize_path_for_markdown(path).ok())
        .unwrap_or_else(|| path.display().to_string())
}

fn extract_markdown_headings(markdown: &str, limit: usize) -> Vec<String> {
    markdown
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with('#') {
                return None;
            }
            let level = trimmed
                .chars()
                .take_while(|character| *character == '#')
                .count();
            if !(1..=3).contains(&level)
                || !trimmed
                    .chars()
                    .nth(level)
                    .map(|c| c.is_whitespace())
                    .unwrap_or(false)
            {
                return None;
            }
            Some(trimmed[level..].trim().to_string())
        })
        .filter(|heading| !heading.is_empty())
        .take(limit)
        .collect()
}

fn summarize_markdown_body(markdown: &str) -> String {
    markdown
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with('#')
                && !line.starts_with("![")
                && !line.starts_with('|')
                && !line.starts_with("```")
        })
        .next()
        .map(|line| truncate_chars(line, 180))
        .unwrap_or_else(|| "No prose summary detected; open the source for details.".to_string())
}

fn resource_summary(resource_count: usize, markdown: &str) -> String {
    let image_count = markdown.matches("![").count();
    let table_lines = markdown
        .lines()
        .filter(|line| line.trim_start().starts_with('|'))
        .count();
    format!("{resource_count} exported files; {image_count} image references; {table_lines} table-like lines.")
}

fn open_when_for_source(category_path: &str, title: &str, resource_count: usize) -> Vec<String> {
    let mut reasons = vec![
        format!("Need details from `{title}`."),
        format!("Working in category `{category_path}`."),
    ];
    if resource_count > 0 {
        reasons.push("Need exact labels, diagrams, tables, or exported attachments.".to_string());
    }
    reasons
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut output = String::new();
    for character in value.chars().take(limit) {
        output.push(character);
    }
    if value.chars().count() > limit {
        output.push('…');
    }
    output
}

fn render_knowledge_index(source_map: &Value) -> String {
    let mut lines = vec![
        "# Knowledge Library".to_string(),
        String::new(),
        "Start here before opening raw sources. Use categories to choose a narrow reading path, then open `abstracts.md` for source-level routing.".to_string(),
        String::new(),
        "## Categories".to_string(),
        String::new(),
    ];
    let mut current_category = String::new();
    let sources = source_map
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if sources.is_empty() {
        lines.push("- No exported sources yet.".to_string());
    }
    for source in sources {
        let category = source
            .get("category_path")
            .and_then(Value::as_str)
            .unwrap_or("uncategorized");
        if category != current_category {
            if !current_category.is_empty() {
                lines.push(String::new());
            }
            lines.push(format!("### {category}"));
            current_category = category.to_string();
        }
        let title = source
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled");
        let path = source
            .get("source_path")
            .and_then(Value::as_str)
            .unwrap_or("");
        let source_id = source
            .get("source_id")
            .and_then(Value::as_str)
            .unwrap_or("");
        lines.push(format!("- [{title}](../{path}) — `{source_id}`"));
    }
    lines.push(String::new());
    lines.push("## Reading Protocol".to_string());
    lines.push(String::new());
    lines.push("1. Read this index first.".to_string());
    lines.push("2. Open `abstracts.md` only for matching categories or source ids.".to_string());
    lines.push(
        "3. Open raw source files only when the abstract says they are relevant.".to_string(),
    );
    lines.push("4. Open assets only when exact visual/table details matter.".to_string());
    lines.push(String::new());
    lines.join("\n")
}

fn render_knowledge_abstracts(source_map: &Value) -> String {
    let mut lines = vec![
        "# Knowledge Abstracts".to_string(),
        String::new(),
        "Use this as the routing layer before opening long source documents.".to_string(),
        String::new(),
    ];
    let sources = source_map
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if sources.is_empty() {
        lines.push("No exported sources yet.".to_string());
        lines.push(String::new());
        return lines.join("\n");
    }
    for source in sources {
        let title = source
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Untitled");
        lines.push(format!("## {title}"));
        lines.push(String::new());
        for key in [
            "source_id",
            "category_path",
            "source_path",
            "wiki_status",
            "export_mode",
        ] {
            if let Some(value) = source.get(key).and_then(Value::as_str) {
                lines.push(format!("- `{key}`: `{value}`"));
            }
        }
        if let Some(summary) = source.get("summary").and_then(Value::as_str) {
            lines.push(format!("- Summary: {summary}"));
        }
        if let Some(resource_summary) = source.get("resource_summary").and_then(Value::as_str) {
            lines.push(format!("- Resources: {resource_summary}"));
        }
        if let Some(headings) = source.get("headings").and_then(Value::as_array) {
            let heading_text = headings
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("; ");
            if !heading_text.is_empty() {
                lines.push(format!("- Headings: {heading_text}"));
            }
        }
        if let Some(open_when) = source.get("open_when").and_then(Value::as_array) {
            let reasons = open_when
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join("; ");
            if !reasons.is_empty() {
                lines.push(format!("- Open when: {reasons}"));
            }
        }
        lines.push(String::new());
    }
    lines.join("\n")
}

fn read_vault_markdown_source(lookup_key: &str) -> Result<VaultMarkdownSource, (String, String)> {
    read_vault_markdown_source_from(&noos_home(), lookup_key)
}

fn read_vault_markdown_source_from(
    noos_home: &Path,
    lookup_key: &str,
) -> Result<VaultMarkdownSource, (String, String)> {
    let Some(indexed) = find_indexed_object_by_key(noos_home, lookup_key)
        .or_else(|| find_unindexed_vault_object_by_key(noos_home, lookup_key))
        .or_else(|| find_library_source_by_key(noos_home, lookup_key))
    else {
        return Err((
            "source_not_found".to_string(),
            "NOOS Markdown source was not found.".to_string(),
        ));
    };
    let Some(path) = indexed.get("path").and_then(Value::as_str) else {
        return Err((
            "source_not_found".to_string(),
            "NOOS Markdown source has no local path.".to_string(),
        ));
    };
    let path_buf = PathBuf::from(path);
    if !object_path_allowed(noos_home, &indexed, &path_buf) {
        return Err((
            "source_not_found".to_string(),
            "NOOS Markdown source path is outside the allowed source roots.".to_string(),
        ));
    }
    if path_buf
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("md"))
        .unwrap_or(true)
    {
        return Err((
            "invalid_markdown".to_string(),
            "NOOS source is not a Markdown file.".to_string(),
        ));
    }
    let content = fs::read_to_string(&path_buf).map_err(|error| {
        (
            "source_not_found".to_string(),
            format!("NOOS Markdown source could not be read: {error}"),
        )
    })?;
    Ok(VaultMarkdownSource {
        lookup_key: lookup_key.to_string(),
        title: indexed
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| extract_frontmatter_value(&content, "title"))
            .or_else(|| extract_heading_title(&content)),
        path: path_buf,
        content,
    })
}

fn prepare_feishu_publish_markdown(content: &str, fallback_title: &str) -> Result<String, String> {
    let body = strip_flattened_noos_frontmatter(strip_yaml_frontmatter(content)).trim();
    if body.is_empty() {
        return Err("NOOS Markdown source is empty.".to_string());
    }
    if body.starts_with("# ") {
        return Ok(body.to_string());
    }
    let title = fallback_title.trim();
    let title = if title.is_empty() {
        "NOOS Markdown"
    } else {
        title
    };
    Ok(format!("# {title}\n\n{body}"))
}

fn strip_yaml_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---\n") {
        return trimmed;
    }
    let rest = &trimmed[4..];
    if let Some(index) = rest.find("\n---") {
        return &rest[index + 4..];
    }
    trimmed
}

fn strip_flattened_noos_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start();
    let first_line = trimmed.lines().next().unwrap_or_default().trim();
    let normalized = first_line.trim_start_matches('#').trim_start();
    let starts_with_noos_metadata =
        normalized.starts_with("type: noos_") || normalized.starts_with("type: library_source");
    if !starts_with_noos_metadata {
        return trimmed;
    }
    if let Some(index) = trimmed.find("\r\n\r\n") {
        return &trimmed[index + 4..];
    }
    if let Some(index) = trimmed.find("\n\n") {
        return &trimmed[index + 2..];
    }
    ""
}

fn create_feishu_document(
    markdown: &str,
    destination_kind: &str,
    folder_token: Option<&str>,
) -> Result<Option<String>, String> {
    let mut args = vec![
        "docs".to_string(),
        "+create".to_string(),
        "--api-version".to_string(),
        "v2".to_string(),
        "--doc-format".to_string(),
        "markdown".to_string(),
    ];
    if destination_kind == "drive_folder" {
        if let Some(token) = folder_token.filter(|token| !token.trim().is_empty()) {
            args.push("--parent-token".to_string());
            args.push(token.to_string());
        } else {
            args.push("--parent-position".to_string());
            args.push("my_library".to_string());
        }
    } else {
        args.push("--parent-position".to_string());
        args.push("my_library".to_string());
    }
    args.push("--content".to_string());
    args.push("-".to_string());

    let payload = run_lark_cli_json_with_stdin(&args, markdown)?;
    Ok(json_path_string(&payload, &["data", "document", "url"]))
}

fn overwrite_feishu_document(url: &str, markdown: &str) -> Result<Option<String>, String> {
    let args = vec![
        "docs".to_string(),
        "+update".to_string(),
        "--api-version".to_string(),
        "v2".to_string(),
        "--doc".to_string(),
        url.to_string(),
        "--command".to_string(),
        "overwrite".to_string(),
        "--doc-format".to_string(),
        "markdown".to_string(),
        "--content".to_string(),
        "-".to_string(),
    ];
    let payload = run_lark_cli_json_with_stdin(&args, markdown)?;
    Ok(json_path_string(&payload, &["data", "document", "url"]).or_else(|| Some(url.to_string())))
}

fn run_lark_cli_json_with_stdin(args: &[String], stdin_content: &str) -> Result<Value, String> {
    let mut child = Command::new("lark-cli")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("lark-cli could not be started: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(stdin_content.as_bytes())
            .map_err(|error| format!("lark-cli stdin write failed: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("lark-cli failed: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        let message = if stderr.is_empty() { stdout } else { stderr };
        return Err(if message.is_empty() {
            "lark-cli returned an error.".to_string()
        } else {
            message
        });
    }
    if stdout.is_empty() {
        return Ok(json!({ "ok": true }));
    }
    serde_json::from_str(&stdout).map_err(|_| stdout)
}

fn json_path_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut cursor = value;
    for key in path {
        cursor = cursor.get(*key)?;
    }
    cursor.as_str().map(str::to_string)
}

fn feishu_docx_command_candidates() -> Vec<PathBuf> {
    let mut commands = Vec::new();
    if let Ok(configured) = env::var("NOOS_FEISHU_DOCX") {
        push_command_candidate(&mut commands, PathBuf::from(configured));
    }
    push_command_candidate(&mut commands, PathBuf::from("feishu-docx"));
    push_command_candidate(
        &mut commands,
        PathBuf::from("/opt/homebrew/bin/feishu-docx"),
    );
    push_command_candidate(&mut commands, PathBuf::from("/usr/local/bin/feishu-docx"));
    let home = home_dir();
    push_command_candidate(&mut commands, home.join(".local/bin/feishu-docx"));
    push_command_candidate(
        &mut commands,
        home.join(".local/pipx/venvs/feishu-docx/bin/feishu-docx"),
    );
    commands
}

fn push_command_candidate(commands: &mut Vec<PathBuf>, path: PathBuf) {
    if path.as_os_str().is_empty() || commands.iter().any(|candidate| candidate == &path) {
        return;
    }
    commands.push(path);
}

fn looks_like_feishu_auth_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("auth")
        || lower.contains("login")
        || lower.contains("token")
        || lower.contains("credential")
        || lower.contains("permission")
        || lower.contains("unauthorized")
        || lower.contains("app_id")
        || lower.contains("app secret")
        || lower.contains("tenant")
}

fn build_feishu_source_markdown(
    exported_markdown: &str,
    url: &str,
    title: &str,
    token: &str,
    source_id: &str,
    category_path: &str,
    asset_root: &str,
    export_mode: &str,
    last_exported_at: &str,
) -> String {
    let body = exported_markdown.trim();
    format!(
        "---\ntype: library_source\nsource_id: {}\nsource_app: feishu\nsource_url: {}\nfeishu_token: {}\ntitle: {}\ncategory_path: {}\nasset_root: {}\nexport_mode: {}\nlast_exported_at: {}\nexporter_version: noos-hub-v2\n---\n\n{}\n",
        json_string(source_id),
        json_string(url),
        json_string(token),
        json_string(title),
        json_string(category_path),
        json_string(asset_root),
        json_string(export_mode),
        json_string(last_exported_at),
        body
    )
}

fn feishu_source_metadata_matches(
    markdown: &str,
    source_id: &str,
    category_path: &str,
    asset_root: &str,
    export_mode: &str,
) -> bool {
    markdown.contains("type: library_source")
        && markdown.contains(&format!("source_id: {}", json_string(source_id)))
        && markdown.contains(&format!("category_path: {}", json_string(category_path)))
        && markdown.contains(&format!("asset_root: {}", json_string(asset_root)))
        && markdown.contains(&format!("export_mode: {}", json_string(export_mode)))
}

fn feishu_source_body(markdown: &str) -> &str {
    let trimmed = markdown.trim();
    if !trimmed.starts_with("---\n") {
        return trimmed;
    }
    let rest = &trimmed[4..];
    if let Some(index) = rest.find("\n---") {
        return rest[index + 4..].trim();
    }
    trimmed
}

fn write_feishu_source(source_path: &Path, markdown: &str) -> Result<(), String> {
    let parent = source_path
        .parent()
        .ok_or_else(|| "Invalid Feishu source path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp_path = source_path.with_extension("md.tmp");
    fs::write(&temp_path, markdown).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, source_path).map_err(|error| error.to_string())
}

fn queue_wiki_organize_by_touch(source_path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(source_path).map_err(|error| error.to_string())?;
    fs::write(source_path, content).map_err(|error| error.to_string())
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn write_artifact_to_local_vault(request: HandoffWriteRequest) -> HandoffWriteResponse {
    let artifact_kind = artifact_kind(request.kind.as_deref());
    let object_type = match artifact_kind {
        "crystal" => "crystal",
        "result" => "result",
        _ => "handoff",
    };
    let ingest = IngestWriteRequest {
        protocol_version: Some(HUB_PROTOCOL_VERSION),
        request_id: None,
        idempotency_key: None,
        object_type: Some(object_type.to_string()),
        source: request.source,
        suggested: Some(IngestSuggested {
            lookup_key: None,
            key: None,
            filename: Some(request.filename),
            status: Some("active".to_string()),
        }),
        content: Some(IngestContent {
            media_type: Some("text/markdown".to_string()),
            text: Some(request.content),
        }),
    };
    write_ingest_object_to_local_vault(ingest)
}

fn write_ingest_object_to_local_vault(request: IngestWriteRequest) -> HandoffWriteResponse {
    let protocol_version = request.protocol_version.unwrap_or(HUB_PROTOCOL_VERSION);
    if protocol_version > HUB_PROTOCOL_VERSION {
        return write_error(
            "unsupported_protocol_version",
            "NOOS Hub does not support this ingest protocol version.",
        );
    }

    let object_type = normalize_object_type(request.object_type.as_deref());
    let Some(content) = request.content else {
        return write_error("bad_request", "Missing ingest content.");
    };
    let media_type = content
        .media_type
        .unwrap_or_else(|| "text/markdown".to_string());
    if media_type != "text/markdown" {
        return write_error(
            "unsupported_media_type",
            "Only text/markdown ingest is supported in v0.",
        );
    }
    let Some(mut markdown) = content.text else {
        return write_error("bad_request", "Missing markdown text.");
    };

    if !is_valid_noos_artifact(&markdown, object_type) {
        return write_error(
            "invalid_artifact",
            "Content does not contain the expected NOOS markers.",
        );
    }

    if object_type != "context_pack_file" {
        if let Some(source) = &request.source {
            append_source_comment(&mut markdown, source);
        }
    }

    let noos_home = noos_home();
    if let Err(error) = ensure_vault_layout(&noos_home) {
        return write_error("vault_unavailable", &error);
    }

    let lookup_key = derive_object_key(
        object_type,
        request
            .suggested
            .as_ref()
            .and_then(|suggested| suggested.lookup_key.as_deref().or(suggested.key.as_deref())),
        request
            .suggested
            .as_ref()
            .and_then(|suggested| suggested.filename.as_deref()),
        &markdown,
    );
    let object_id = request
        .idempotency_key
        .as_ref()
        .map(|value| format!("noos_obj_{}", stable_hash_hex(value)))
        .unwrap_or_else(|| {
            format!(
                "noos_obj_{}",
                stable_hash_hex(&format!("{object_type}:{markdown}"))
            )
        });
    let content_hash = format!("sha256ish:{}", stable_hash_hex(&markdown));
    let status = request
        .suggested
        .as_ref()
        .and_then(|suggested| suggested.status.as_deref())
        .unwrap_or_else(|| default_status_for_object(object_type))
        .to_string();
    let source = source_metadata(request.source.as_ref());
    let created_at = extract_frontmatter_value(&markdown, "created_at")
        .or_else(|| {
            request
                .source
                .as_ref()
                .and_then(|source| source.captured_at.clone())
        })
        .unwrap_or_else(now_iso_utc);
    if let Some(existing) = existing_indexed_object(&noos_home, &object_id) {
        return existing_receipt(&object_id, existing);
    }

    let vault = noos_home.join(object_vault_path(object_type, &status));
    if let Err(error) = fs::create_dir_all(&vault) {
        return write_error("vault_unavailable", &error.to_string());
    }

    let target = if object_type == "context_pack_file" {
        match request
            .suggested
            .as_ref()
            .and_then(|suggested| suggested.filename.as_deref())
            .and_then(sanitize_relative_path)
        {
            Some(relative_path) => vault.join(relative_path),
            None => {
                return write_error("invalid_path", "Context pack file path is invalid.");
            }
        }
    } else {
        let filename = sanitize_filename(&format!("{lookup_key}.md"));
        unique_target_path(&vault, &filename)
    };
    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return write_error("vault_unavailable", &error.to_string());
        }
    }
    let temp = target.with_extension("tmp");
    if let Err(error) =
        fs::write(&temp, markdown.as_bytes()).and_then(|_| fs::rename(&temp, &target))
    {
        let _ = fs::remove_file(&temp);
        return write_error("write_failed", &error.to_string());
    }

    if let Err(error) = update_vault_indexes(
        &noos_home,
        VaultIndexObject {
            object_type,
            object_id: object_id.clone(),
            lookup_key: lookup_key.clone(),
            status: status.clone(),
            path: target.display().to_string(),
            title: extract_frontmatter_value(&markdown, "title")
                .or_else(|| extract_heading_title(&markdown)),
            source: source.clone(),
            source_url: extract_frontmatter_value(&markdown, "source_url").or_else(|| {
                request
                    .source
                    .as_ref()
                    .and_then(|source| source.url.clone())
            }),
            created_at: created_at.clone(),
            content_hash: content_hash.clone(),
            request_id: request.request_id,
            idempotency_key: request.idempotency_key,
        },
    ) {
        return write_error("index_write_failed", &error);
    }

    HandoffWriteResponse {
        ok: true,
        backend: "hub_local".to_string(),
        location: Some(target.display().to_string()),
        error_code: None,
        message: format!("Saved to local NOOS Vault: {}", target.display()),
        object_type: Some(object_type.to_string()),
        object_id: Some(object_id),
        lookup_key: Some(lookup_key.clone()),
        key: Some(lookup_key.clone()),
        status: Some(status),
        path: Some(target.display().to_string()),
        source: Some(source),
        created_at: Some(created_at),
        canonical_url: Some(format!("noos://object/{lookup_key}")),
        content_hash: Some(content_hash),
        duplicate_of: None,
        warnings: Vec::new(),
        next_actions: vec![
            "open_hub".to_string(),
            "copy_key".to_string(),
            "send_to_chatgpt".to_string(),
        ],
    }
}

struct VaultIndexObject {
    object_type: &'static str,
    object_id: String,
    lookup_key: String,
    status: String,
    path: String,
    title: Option<String>,
    source: Value,
    source_url: Option<String>,
    created_at: String,
    content_hash: String,
    request_id: Option<String>,
    idempotency_key: Option<String>,
}

fn write_error(code: &str, message: &str) -> HandoffWriteResponse {
    HandoffWriteResponse {
        ok: false,
        backend: "hub_local".to_string(),
        location: None,
        error_code: Some(code.to_string()),
        message: message.to_string(),
        object_type: None,
        object_id: None,
        lookup_key: None,
        key: None,
        status: None,
        path: None,
        source: None,
        created_at: None,
        canonical_url: None,
        content_hash: None,
        duplicate_of: None,
        warnings: Vec::new(),
        next_actions: vec![
            "copy".to_string(),
            "download".to_string(),
            "retry".to_string(),
        ],
    }
}

fn ensure_vault_layout(noos_home: &Path) -> Result<(), String> {
    let directories = [
        "inbox",
        "outbox",
        "logs",
        "cache",
        "runtime",
        "vault/wiki",
        "vault/handoffs/active",
        "vault/handoffs/done",
        "vault/handoffs/archived",
        "vault/crystals/active",
        "vault/crystals/curated",
        "vault/crystals/archived",
        "vault/results/inbox",
        "vault/results/accepted",
        "vault/results/archived",
        "vault/artifacts/files",
        "vault/artifacts/sidecars",
        "vault/artifacts/thumbs",
        "vault/briefs/active",
        "vault/briefs/archived",
        "vault/packs/context/active",
        "vault/packs/context/archived",
        "vault/packs/prompt/active",
        "vault/packs/prompt/sent",
        "vault/packs/prompt/archived",
        "vault/threads/active",
        "vault/threads/archived",
        "vault/runtime/projections/current",
        "vault/runtime/projections/history",
        "vault/index",
        "vault/inbox",
        "vault/outbox",
        "vault/tmp",
        "vault/logs",
        "vault/references/raw",
        "vault/references/briefs",
        "vault/references/patterns",
        "vault/references/anti-patterns",
        "vault/references/flows",
        "vault/references/assets",
        "vault/skills/installed",
        "vault/skills/local",
        "vault/skills/archived",
        "vault/sync/git",
        "vault/sync/exports",
        "vault/sync/imports",
        "vault/policies",
    ];

    for directory in directories {
        fs::create_dir_all(noos_home.join(directory)).map_err(|error| error.to_string())?;
    }

    ensure_json_file(&noos_home.join("vault/index/keys.json"), json!({}))?;
    ensure_json_file(&noos_home.join("vault/index/objects.json"), json!({}))?;
    ensure_json_file(
        &noos_home.join("vault/index/graph.json"),
        json!({ "edges": [] }),
    )?;
    ensure_json_file(&noos_home.join("vault/index/backlinks.json"), json!({}))?;
    Ok(())
}

fn ensure_json_file(path: &Path, default_value: Value) -> Result<(), String> {
    if path.exists() {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read JSON file {}: {error}", path.display()))?;
        serde_json::from_str::<Value>(&text)
            .map_err(|error| format!("Invalid JSON file {}: {error}", path.display()))?;
        return Ok(());
    }
    write_json_file(path, &default_value)
}

fn update_vault_indexes(noos_home: &Path, object: VaultIndexObject) -> Result<(), String> {
    let index_dir = noos_home.join("vault/index");
    fs::create_dir_all(&index_dir).map_err(|error| error.to_string())?;

    let keys_path = index_dir.join("keys.json");
    let objects_path = index_dir.join("objects.json");
    let mut keys = read_json_object_strict(&keys_path)?;
    let mut objects = read_json_object_strict(&objects_path)?;

    keys[&object.lookup_key] = json!({
        "object_id": object.object_id.clone(),
        "lookup_key": object.lookup_key.clone(),
        "key": object.lookup_key.clone(),
        "type": object.object_type,
        "object_type": object.object_type,
        "status": object.status.clone(),
        "path": object.path.clone(),
        "source": object.source.clone(),
        "created_at": object.created_at.clone(),
        "updated_at_epoch": now_epoch(),
        "aliases": []
    });

    objects[&object.object_id] = json!({
        "object_id": object.object_id.clone(),
        "lookup_key": object.lookup_key.clone(),
        "key": object.lookup_key.clone(),
        "type": object.object_type,
        "object_type": object.object_type,
        "status": object.status.clone(),
        "path": object.path.clone(),
        "title": object.title,
        "source": object.source,
        "source_url": object.source_url,
        "created_at": object.created_at,
        "content_hash": object.content_hash,
        "request_id": object.request_id,
        "idempotency_key": object.idempotency_key,
        "updated_at_epoch": now_epoch()
    });
    write_json_file(&objects_path, &objects)?;
    write_json_file(&keys_path, &keys)?;

    let graph_path = index_dir.join("graph.json");
    if !graph_path.exists() {
        write_json_file(&graph_path, &json!({ "edges": [] }))?;
    }
    let backlinks_path = index_dir.join("backlinks.json");
    if !backlinks_path.exists() {
        write_json_file(&backlinks_path, &json!({}))?;
    }
    Ok(())
}

fn existing_indexed_object(noos_home: &Path, object_id: &str) -> Option<Value> {
    let objects = read_json_object(&noos_home.join("vault/index/objects.json"));
    let existing = objects.get(object_id)?.clone();
    let path = existing.get("path").and_then(Value::as_str)?;
    if Path::new(path).is_file() {
        Some(existing)
    } else {
        None
    }
}

fn existing_receipt(object_id: &str, existing: Value) -> HandoffWriteResponse {
    let path = existing
        .get("path")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let lookup_key = existing
        .get("lookup_key")
        .and_then(Value::as_str)
        .or_else(|| existing.get("key").and_then(Value::as_str))
        .map(|value| value.to_string());

    HandoffWriteResponse {
        ok: true,
        backend: "hub_local".to_string(),
        location: path.clone(),
        error_code: None,
        message: format!(
            "NOOS object already saved: {}",
            path.as_deref().unwrap_or("indexed object")
        ),
        object_type: existing
            .get("type")
            .and_then(Value::as_str)
            .or_else(|| existing.get("object_type").and_then(Value::as_str))
            .map(|value| value.to_string()),
        object_id: Some(object_id.to_string()),
        lookup_key: lookup_key.clone(),
        key: lookup_key.clone(),
        status: existing
            .get("status")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        path,
        source: existing.get("source").cloned(),
        created_at: existing
            .get("created_at")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        canonical_url: lookup_key.map(|value| format!("noos://object/{value}")),
        content_hash: existing
            .get("content_hash")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        duplicate_of: Some(object_id.to_string()),
        warnings: Vec::new(),
        next_actions: vec![
            "open_hub".to_string(),
            "copy_key".to_string(),
            "send_to_chatgpt".to_string(),
        ],
    }
}

fn vault_recent_payload(noos_home: &Path) -> Value {
    let mut objects = Vec::new();
    objects.extend(
        recent_markdown_files(&noos_home.join("vault/handoffs/active"), 16)
            .into_iter()
            .map(|file| vault_file_summary_json("handoff", file)),
    );
    objects.extend(
        recent_markdown_files(&noos_home.join("vault/crystals/active"), 16)
            .into_iter()
            .map(|file| vault_file_summary_json("crystal", file)),
    );
    objects.extend(
        recent_markdown_files(&noos_home.join("vault/results/inbox"), 8)
            .into_iter()
            .map(|file| vault_file_summary_json("result", file)),
    );
    objects.extend(collect_library_source_objects(noos_home));

    objects.sort_by(|left, right| {
        let left_epoch = left
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_epoch = right
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_epoch.cmp(&left_epoch)
    });
    objects.truncate(40);

    json!({
        "ok": true,
        "objects": objects
    })
}

fn vault_browse_payload(noos_home: &Path, folder: Option<&str>, query: Option<&str>) -> Value {
    let selected_folder = folder.unwrap_or("latest");
    let normalized_query = query
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut objects = collect_vault_folder_objects(noos_home, selected_folder);

    if !normalized_query.is_empty() {
        objects.retain(|object| vault_object_matches_query(object, &normalized_query));
    }

    objects.sort_by(|left, right| {
        let left_epoch = left
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_epoch = right
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_epoch.cmp(&left_epoch)
    });
    objects.truncate(100);

    json!({
        "ok": true,
        "folder": selected_folder,
        "query": query.unwrap_or_default(),
        "folders": vault_virtual_folders(),
        "objects": objects
    })
}

fn vault_virtual_folders() -> Value {
    json!([
        { "id": "latest", "label": "Latest", "kind": "system" },
        { "id": "handoffs", "label": "Handoffs", "kind": "group" },
        { "id": "handoffs/active", "label": "Active Handoffs", "kind": "folder" },
        { "id": "handoffs/done", "label": "Done Handoffs", "kind": "folder" },
        { "id": "handoffs/archived", "label": "Archived Handoffs", "kind": "folder" },
        { "id": "crystals", "label": "Crystals", "kind": "group" },
        { "id": "crystals/active", "label": "Active Crystals", "kind": "folder" },
        { "id": "crystals/curated", "label": "Curated Crystals", "kind": "folder" },
        { "id": "crystals/archived", "label": "Archived Crystals", "kind": "folder" },
        { "id": "results", "label": "Results", "kind": "group" },
        { "id": "results/inbox", "label": "Result Inbox", "kind": "folder" },
        { "id": "results/accepted", "label": "Accepted Results", "kind": "folder" },
        { "id": "results/archived", "label": "Archived Results", "kind": "folder" },
        { "id": "library_sources", "label": "Library Sources", "kind": "folder" },
        { "id": "artifacts", "label": "Artifacts", "kind": "folder" }
    ])
}

fn collect_vault_folder_objects(noos_home: &Path, folder: &str) -> Vec<Value> {
    let mut specs: Vec<(&str, PathBuf, &str)> = Vec::new();
    match folder {
        "handoffs" => {
            specs.push((
                "handoff",
                noos_home.join("vault/handoffs/active"),
                "handoffs/active",
            ));
            specs.push((
                "handoff",
                noos_home.join("vault/handoffs/done"),
                "handoffs/done",
            ));
            specs.push((
                "handoff",
                noos_home.join("vault/handoffs/archived"),
                "handoffs/archived",
            ));
        }
        "handoffs/done" => specs.push((
            "handoff",
            noos_home.join("vault/handoffs/done"),
            "handoffs/done",
        )),
        "handoffs/archived" => specs.push((
            "handoff",
            noos_home.join("vault/handoffs/archived"),
            "handoffs/archived",
        )),
        "crystals" => {
            specs.push((
                "crystal",
                noos_home.join("vault/crystals/active"),
                "crystals/active",
            ));
            specs.push((
                "crystal",
                noos_home.join("vault/crystals/curated"),
                "crystals/curated",
            ));
            specs.push((
                "crystal",
                noos_home.join("vault/crystals/archived"),
                "crystals/archived",
            ));
        }
        "crystals/curated" => specs.push((
            "crystal",
            noos_home.join("vault/crystals/curated"),
            "crystals/curated",
        )),
        "crystals/archived" => specs.push((
            "crystal",
            noos_home.join("vault/crystals/archived"),
            "crystals/archived",
        )),
        "results" => {
            specs.push((
                "result",
                noos_home.join("vault/results/inbox"),
                "results/inbox",
            ));
            specs.push((
                "result",
                noos_home.join("vault/results/accepted"),
                "results/accepted",
            ));
            specs.push((
                "result",
                noos_home.join("vault/results/archived"),
                "results/archived",
            ));
        }
        "results/accepted" => specs.push((
            "result",
            noos_home.join("vault/results/accepted"),
            "results/accepted",
        )),
        "results/archived" => specs.push((
            "result",
            noos_home.join("vault/results/archived"),
            "results/archived",
        )),
        "artifacts" => specs.push((
            "artifact",
            noos_home.join("vault/artifacts/sidecars"),
            "artifacts",
        )),
        "library_sources" => return collect_library_source_objects(noos_home),
        "handoffs/active" => specs.push((
            "handoff",
            noos_home.join("vault/handoffs/active"),
            "handoffs/active",
        )),
        "crystals/active" => specs.push((
            "crystal",
            noos_home.join("vault/crystals/active"),
            "crystals/active",
        )),
        "results/inbox" => specs.push((
            "result",
            noos_home.join("vault/results/inbox"),
            "results/inbox",
        )),
        _ => {
            specs.push((
                "handoff",
                noos_home.join("vault/handoffs/active"),
                "handoffs/active",
            ));
            specs.push((
                "crystal",
                noos_home.join("vault/crystals/active"),
                "crystals/active",
            ));
            specs.push((
                "result",
                noos_home.join("vault/results/inbox"),
                "results/inbox",
            ));
            return specs
                .into_iter()
                .flat_map(|(object_type, directory, virtual_folder)| {
                    recent_markdown_files(&directory, usize::MAX)
                        .into_iter()
                        .map(move |file| {
                            let mut value = vault_file_summary_json(object_type, file);
                            if let Some(map) = value.as_object_mut() {
                                map.insert("folder".to_string(), json!(virtual_folder));
                            }
                            value
                        })
                })
                .chain(collect_library_source_objects(noos_home))
                .collect();
        }
    }

    specs
        .into_iter()
        .flat_map(|(object_type, directory, virtual_folder)| {
            recent_markdown_files(&directory, usize::MAX)
                .into_iter()
                .map(move |file| {
                    let mut value = vault_file_summary_json(object_type, file);
                    if let Some(map) = value.as_object_mut() {
                        map.insert("folder".to_string(), json!(virtual_folder));
                    }
                    value
                })
        })
        .collect()
}

fn vault_object_matches_query(object: &Value, query: &str) -> bool {
    [
        "lookup_key",
        "key",
        "title",
        "name",
        "path",
        "source_url",
        "object_type",
        "folder",
    ]
    .iter()
    .filter_map(|field| object.get(field).and_then(Value::as_str))
    .any(|value| value.to_ascii_lowercase().contains(query))
}

fn vault_file_summary_json(object_type: &str, file: VaultFileSummary) -> Value {
    let lookup_key = file.key.unwrap_or_else(|| {
        file.name
            .strip_suffix(".md")
            .unwrap_or(&file.name)
            .to_string()
    });
    json!({
        "object_type": object_type,
        "type": object_type,
        "lookup_key": lookup_key,
        "key": lookup_key,
        "title": file.title.unwrap_or_else(|| file.name.clone()),
        "name": file.name,
        "path": file.path,
        "source_url": file.source_url,
        "modified_epoch": file.modified_epoch
    })
}

fn collect_library_source_objects(noos_home: &Path) -> Vec<Value> {
    let Some(wiki_project_path) = configured_default_wiki_project_path_from(noos_home) else {
        return Vec::new();
    };
    let source_map = read_json_object(&knowledge_source_map_path(&wiki_project_path));
    let Some(sources) = source_map.get("sources").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut objects = sources
        .iter()
        .filter_map(|source| library_source_object_from_map_entry(&wiki_project_path, source))
        .collect::<Vec<_>>();
    objects.sort_by(|left, right| {
        let left_epoch = left
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let right_epoch = right
            .get("modified_epoch")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        right_epoch.cmp(&left_epoch)
    });
    objects
}

fn library_source_object_from_map_entry(wiki_project_path: &Path, source: &Value) -> Option<Value> {
    let source_path = source.get("source_path")?.as_str()?;
    let relative_path = sanitize_source_map_source_path(source_path)?;
    let path = wiki_project_path.join(relative_path);
    let is_markdown = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false);
    if !is_markdown
        || !path.is_file()
        || !library_source_path_allowed_for_wiki(&path, wiki_project_path)
    {
        return None;
    }

    let metadata = path.metadata().ok()?;
    let modified_epoch = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    let lookup_key = source
        .get("source_id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| name.strip_suffix(".md").unwrap_or(&name).to_string());
    let title = source
        .get("title")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| name.clone());

    Some(json!({
        "object_type": "library_source",
        "type": "library_source",
        "lookup_key": lookup_key,
        "key": lookup_key,
        "title": title,
        "name": name,
        "path": path.display().to_string(),
        "source_url": source.get("source_url").cloned().unwrap_or(Value::Null),
        "category_path": source.get("category_path").cloned().unwrap_or(Value::Null),
        "source_id": source.get("source_id").cloned().unwrap_or(Value::Null),
        "folder": "library_sources",
        "modified_epoch": modified_epoch
    }))
}

fn library_source_path_allowed(noos_home: &Path, path: &Path) -> bool {
    configured_default_wiki_project_path_from(noos_home)
        .map(|wiki_project_path| library_source_path_allowed_for_wiki(path, &wiki_project_path))
        .unwrap_or(false)
}

fn library_source_path_allowed_for_wiki(path: &Path, wiki_project_path: &Path) -> bool {
    is_inside_path(path, &wiki_project_path.join("raw").join("sources"))
}

fn vault_object_payload(
    noos_home: &Path,
    lookup_key: &str,
    path: Option<&str>,
    folder: Option<&str>,
) -> Value {
    if let Some(path) = path.filter(|value| !value.trim().is_empty()) {
        return vault_object_payload_from_path(noos_home, lookup_key, path, folder);
    }

    let Some(indexed) = find_indexed_object_by_key(noos_home, lookup_key)
        .or_else(|| find_unindexed_vault_object_by_key(noos_home, lookup_key))
        .or_else(|| find_library_source_by_key(noos_home, lookup_key))
    else {
        return json!({
            "ok": false,
            "error_code": "not_found",
            "message": "NOOS object was not found."
        });
    };
    let Some(path) = indexed.get("path").and_then(Value::as_str) else {
        return json!({
            "ok": false,
            "error_code": "missing_path",
            "message": "NOOS object index entry has no path."
        });
    };
    let path_buf = PathBuf::from(path);
    if !object_path_allowed(noos_home, &indexed, &path_buf) {
        return json!({
            "ok": false,
            "error_code": "path_not_allowed",
            "message": "NOOS object path is outside the local Vault."
        });
    }
    let Ok(content) = fs::read_to_string(&path_buf) else {
        return json!({
            "ok": false,
            "error_code": "read_failed",
            "message": "NOOS object content could not be read."
        });
    };

    json!({
        "ok": true,
        "object": {
            "object_id": indexed.get("object_id"),
            "lookup_key": indexed.get("lookup_key").or_else(|| indexed.get("key")),
            "key": indexed.get("key").or_else(|| indexed.get("lookup_key")),
            "type": indexed.get("type").or_else(|| indexed.get("object_type")),
            "object_type": indexed.get("object_type").or_else(|| indexed.get("type")),
            "title": indexed.get("title"),
            "path": indexed.get("path"),
            "source": indexed.get("source"),
            "source_url": indexed.get("source_url"),
            "created_at": indexed.get("created_at"),
            "content": content,
            "media_type": "text/markdown"
        }
    })
}

fn vault_object_payload_from_path(
    noos_home: &Path,
    lookup_key: &str,
    raw_path: &str,
    folder: Option<&str>,
) -> Value {
    let path = PathBuf::from(raw_path);
    let object_type = object_type_from_vault_location(folder, &path);
    let allowed = if object_type == "library_source" {
        library_source_path_allowed(noos_home, &path)
    } else {
        is_inside_path(&path, &noos_home.join("vault"))
    };
    if !allowed {
        return json!({
            "ok": false,
            "error_code": "path_not_allowed",
            "message": "NOOS object path is outside the local Vault."
        });
    }
    if !path.is_file() {
        return json!({
            "ok": false,
            "error_code": "not_found",
            "message": "NOOS object was not found."
        });
    }
    let Ok(content) = fs::read_to_string(&path) else {
        return json!({
            "ok": false,
            "error_code": "read_failed",
            "message": "NOOS object content could not be read."
        });
    };

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let fallback_key = name.strip_suffix(".md").unwrap_or(&name);
    let key = if lookup_key.trim().is_empty() {
        fallback_key
    } else {
        lookup_key
    };

    json!({
        "ok": true,
        "object": {
            "object_id": format!("path:{}", path.display()),
            "lookup_key": key,
            "key": key,
            "type": object_type,
            "object_type": object_type,
            "title": extract_frontmatter_value(&content, "title").or_else(|| extract_heading_title(&content)),
            "path": path.display().to_string(),
            "source": null,
            "source_url": extract_frontmatter_value(&content, "source_url"),
            "created_at": null,
            "content": content,
            "media_type": "text/markdown"
        }
    })
}

fn object_type_from_vault_location(folder: Option<&str>, path: &Path) -> &'static str {
    if let Some(folder) = folder {
        if folder == "library_sources" {
            return "library_source";
        }
        if folder.starts_with("crystals") {
            return "crystal";
        }
        if folder.starts_with("results") {
            return "result";
        }
        if folder.starts_with("artifacts") {
            return "artifact";
        }
        if folder.starts_with("handoffs") {
            return "handoff";
        }
    }

    let path_text = path.to_string_lossy();
    if path_text.contains("/vault/crystals/") {
        "crystal"
    } else if path_text.contains("/vault/results/") {
        "result"
    } else if path_text.contains("/vault/artifacts/") {
        "artifact"
    } else if path_text.contains("/raw/sources/") {
        "library_source"
    } else {
        "handoff"
    }
}

fn find_unindexed_vault_object_by_key(noos_home: &Path, lookup_key: &str) -> Option<Value> {
    let roots = [
        ("handoff", noos_home.join("vault/handoffs/active")),
        ("crystal", noos_home.join("vault/crystals/active")),
        ("result", noos_home.join("vault/results/inbox")),
    ];

    roots.into_iter().find_map(|(object_type, root)| {
        recent_markdown_files(&root, usize::MAX)
            .into_iter()
            .find_map(|file| {
                let stem = file.name.strip_suffix(".md").unwrap_or(&file.name);
                let key = file.key.clone().unwrap_or_else(|| stem.to_string());
                if lookup_key != key && lookup_key != stem && lookup_key != file.name {
                    return None;
                }

                Some(json!({
                    "object_id": format!("unindexed:{}", file.path),
                    "lookup_key": key,
                    "key": key,
                    "type": object_type,
                    "object_type": object_type,
                    "title": file.title,
                    "path": file.path,
                    "source_url": file.source_url,
                    "created_at": null
                }))
            })
    })
}

fn find_library_source_by_key(noos_home: &Path, lookup_key: &str) -> Option<Value> {
    collect_library_source_objects(noos_home)
        .into_iter()
        .find(|object| {
            let key = object
                .get("lookup_key")
                .and_then(Value::as_str)
                .or_else(|| object.get("key").and_then(Value::as_str));
            let path_matches = object
                .get("path")
                .and_then(Value::as_str)
                .map(|path| path == lookup_key)
                .unwrap_or(false);
            key.map(|value| value == lookup_key).unwrap_or(false) || path_matches
        })
}

fn find_indexed_object_by_key(noos_home: &Path, lookup_key: &str) -> Option<Value> {
    let keys = read_json_object(&noos_home.join("vault/index/keys.json"));
    if let Some(entry) = keys.get(lookup_key) {
        if let Some(object_id) = entry.get("object_id").and_then(Value::as_str) {
            let objects = read_json_object(&noos_home.join("vault/index/objects.json"));
            if let Some(object) = objects.get(object_id) {
                return Some(object.clone());
            }
        }
        return Some(entry.clone());
    }

    let objects = read_json_object(&noos_home.join("vault/index/objects.json"));
    objects.as_object()?.values().find_map(|object| {
        let matches = object
            .get("lookup_key")
            .and_then(Value::as_str)
            .or_else(|| object.get("key").and_then(Value::as_str))
            .map(|value| value == lookup_key)
            .unwrap_or(false);
        if matches {
            Some(object.clone())
        } else {
            None
        }
    })
}

fn object_path_allowed(noos_home: &Path, object: &Value, path: &Path) -> bool {
    let object_type = object
        .get("object_type")
        .and_then(Value::as_str)
        .or_else(|| object.get("type").and_then(Value::as_str))
        .unwrap_or_default();
    if object_type == "library_source" {
        library_source_path_allowed(noos_home, path)
    } else {
        is_inside_path(path, &noos_home.join("vault"))
    }
}

fn is_inside_path(path: &Path, root: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    path.starts_with(root)
}

fn read_json_object(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(|value: &Value| value.is_object())
        .unwrap_or_else(|| json!({}))
}

fn read_json_object_strict(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read JSON object {}: {error}", path.display()))?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Invalid JSON object {}: {error}", path.display()))?;
    if value.is_object() {
        Ok(value)
    } else {
        Err(format!("Expected JSON object in {}.", path.display()))
    }
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize JSON for {}: {error}", path.display()))?;
    write_bytes_atomic(path, text.as_bytes())
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid index path.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let temp = atomic_temp_path(path);
    if let Err(error) = fs::write(&temp, bytes).and_then(|_| fs::rename(&temp, path)) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "Failed to atomically write {}: {error}",
            path.display()
        ));
    }
    Ok(())
}

fn atomic_temp_path(path: &Path) -> PathBuf {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("noos-json");
    let temp_name = format!(
        ".{filename}.tmp.{}.{}.{}",
        std::process::id(),
        now_epoch(),
        counter
    );
    path.with_file_name(temp_name)
}

fn append_source_comment(content: &mut String, source: &HandoffSource) {
    let app = source.app.clone().unwrap_or_default();
    let url = source.url.clone().unwrap_or_default();
    let conversation_id = source.conversation_id.clone().unwrap_or_default();
    let captured_at = source.captured_at.clone().unwrap_or_default();
    if app.is_empty() && url.is_empty() && conversation_id.is_empty() && captured_at.is_empty() {
        return;
    }

    content.push_str("\n\n<!-- NOOS:HUB:SOURCE ");
    content.push_str(&format!(
        "app={} url={} conversation_id={} captured_at={}",
        app, url, conversation_id, captured_at
    ));
    content.push_str(" -->\n");
}

fn source_metadata(source: Option<&HandoffSource>) -> Value {
    let Some(source) = source else {
        return json!({
            "app": "unknown",
            "url": null,
            "conversation_id": null,
            "captured_at": null
        });
    };

    json!({
        "app": source.app.clone().unwrap_or_else(|| "unknown".to_string()),
        "url": source.url,
        "conversation_id": source.conversation_id,
        "captured_at": source.captured_at
    })
}

fn workspace_adapter(repo_root: &Path) -> AdapterHealth {
    let checks = vec![
        file_check("Project config", repo_root.join(".noos/project.json")),
        dir_check("Active handoffs", repo_root.join(".noos/handoffs/active")),
        dir_check("Done handoffs", repo_root.join(".noos/handoffs/done")),
        dir_check("Active crystals", repo_root.join(".noos/crystals/active")),
        dir_check("Done crystals", repo_root.join(".noos/crystals/done")),
        file_check("AGENTS.md", repo_root.join("AGENTS.md")),
        file_check("CLAUDE.md", repo_root.join("CLAUDE.md")),
    ];
    adapter(
        "workspace",
        "Workspace Kit",
        "workspace",
        "项目级 .noos 工作区和 agent 入口文件。",
        checks,
        vec![action("install-workspace", "补齐 Workspace 目录", false)],
    )
}

fn inbox_adapter(noos_home: &Path) -> AdapterHealth {
    let checks = vec![
        dir_check("NOOS home", noos_home.to_path_buf()),
        dir_check("Local inbox", noos_home.join("inbox")),
        file_check("User config", noos_home.join("config.json")),
    ];
    adapter(
        "local-inbox",
        "Local Inbox",
        "transport",
        "本地 handoff 收件箱，用于 download 和跨工具交换。",
        checks,
        vec![action("create-inbox", "创建 Inbox", false)],
    )
}

fn vault_adapter(noos_home: &Path) -> AdapterHealth {
    let checks = vec![
        dir_check("NOOS vault", noos_home.join("vault")),
        dir_check("Wiki vault", noos_home.join("vault/wiki")),
        dir_check("Handoff vault", noos_home.join("vault/handoffs/active")),
        dir_check("Crystal vault", noos_home.join("vault/crystals/active")),
        dir_check("Context Pack vault", noos_home.join("vault/context-packs")),
        dir_check(
            "Browser handoff mirror",
            home_dir().join("Downloads/NOOS/vault/handoffs/active"),
        ),
        dir_check(
            "Browser crystal mirror",
            home_dir().join("Downloads/NOOS/vault/crystals/active"),
        ),
        check(
            "Hub local write channel",
            "ready",
            Some(format!("http://127.0.0.1:{LOCAL_WRITE_PORT}")),
        ),
        file_check("Browser Shuttle token", shuttle_token_path()),
    ];
    adapter(
        "noos-vault",
        "NOOS Vault",
        "transport",
        "NOOS 本机存储中心，包含 Wiki、Handoff 和 Crystal；浏览器插件优先通过 Hub 直写，必要时回退到 Browser Mirror。",
        checks,
        vec![
            action("create-vault", "创建 NOOS Vault", false),
            action("reset-browser-connection", "重置浏览器连接", true),
            action("import-browser-vault", "导入 Browser Mirror", false),
            action("open-vault", "打开 Vault", false),
        ],
    )
}

fn codex_adapter(noos_home: &Path) -> AdapterHealth {
    let home = env::var("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".codex"));
    let skill = home.join("skills/noos-consume-handoff/SKILL.md");
    let checks = vec![
        file_check("Codex skill", skill),
        file_check("NOOS user config", noos_home.join("config.json")),
    ];
    adapter(
        "codex",
        "Codex",
        "consumer",
        "Codex 消费 NOOS handoff 的用户级 skill。",
        checks,
        vec![action("install-consumers", "安装 Consumer Skills", false)],
    )
}

fn claude_adapter(repo_root: &Path) -> AdapterHealth {
    let claude_home = env::var("CLAUDE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".claude"));
    let checks = vec![
        file_check(
            "Claude Code user skill",
            claude_home.join("skills/noos-consume-handoff/SKILL.md"),
        ),
        file_check(
            "Claude Code project skill",
            repo_root.join(".claude/skills/noos-consume-handoff/SKILL.md"),
        ),
        file_check("CLAUDE.md", repo_root.join("CLAUDE.md")),
    ];
    adapter(
        "claude-code",
        "Claude Code",
        "consumer",
        "Claude Code 消费 NOOS handoff 的用户级和项目级 skill。",
        checks,
        vec![action("install-consumers", "安装 Consumer Skills", false)],
    )
}

fn browser_adapter(repo_root: &Path, noos_home: &Path) -> AdapterHealth {
    let checks = vec![
        file_check("Extension manifest", repo_root.join("dist/manifest.json")),
        file_check("Content script", repo_root.join("dist/assets/content.js")),
        dir_check("NOOS Chrome profile", noos_home.join("chrome-profile")),
    ];
    adapter(
        "browser-extension",
        "Browser Shuttle",
        "capture",
        "ChatGPT 网页端生成、捕获和交付 handoff，并提取可复用 Crystal 的扩展。",
        checks,
        vec![
            action("browser-manual-unpacked", "日常 Chrome 安装向导", true),
            action("browser-dev-profile", "启动 NOOS 浏览器", false),
        ],
    )
}

fn github_adapter(repo_root: &Path) -> AdapterHealth {
    let checks = vec![
        command_check("Git CLI", "git", &["--version"]),
        if command_in_dir_status(repo_root, "git", &["remote", "get-url", "origin"]) {
            check("Git remote", "ready", Some("origin".to_string()))
        } else {
            check(
                "Git remote",
                "needs_action",
                Some("configure origin remote".to_string()),
            )
        },
        file_check(
            "Project GitHub config",
            repo_root.join(".noos/project.json"),
        ),
    ];

    adapter(
        "github",
        "Git Sync",
        "transport",
        "把本机 NOOS Handoff Vault 同步到项目 Git 仓库，供跨机器和远端 agent 消费。",
        checks,
        vec![
            action("sync-handoffs-git", "同步 Handoff 到 Git", true),
            action("doctor", "检查 Git 状态", false),
        ],
    )
}

fn adapter(
    id: &str,
    name: &str,
    kind: &str,
    summary: &str,
    checks: Vec<AdapterCheck>,
    actions: Vec<AdapterAction>,
) -> AdapterHealth {
    let status = aggregate_status(&checks);
    AdapterHealth {
        id: id.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        status,
        summary: summary.to_string(),
        checks,
        actions,
    }
}

fn aggregate_status(checks: &[AdapterCheck]) -> String {
    let missing = checks
        .iter()
        .filter(|item| item.status == "missing")
        .count();
    let needs_action = checks
        .iter()
        .filter(|item| item.status == "needs_action")
        .count();
    let error = checks.iter().any(|item| item.status == "error");

    if error {
        "error".to_string()
    } else if missing == 0 && needs_action == 0 {
        "ready".to_string()
    } else if missing == checks.len() {
        "missing".to_string()
    } else if needs_action > 0 {
        "needs_action".to_string()
    } else {
        "partial".to_string()
    }
}

fn file_check(label: &str, path: PathBuf) -> AdapterCheck {
    if path.is_file() {
        check(label, "ready", Some(path.display().to_string()))
    } else {
        check(label, "missing", Some(path.display().to_string()))
    }
}

fn dir_check(label: &str, path: PathBuf) -> AdapterCheck {
    if path.is_dir() {
        check(label, "ready", Some(path.display().to_string()))
    } else {
        check(label, "missing", Some(path.display().to_string()))
    }
}

fn command_check(label: &str, command: &str, args: &[&str]) -> AdapterCheck {
    if command_status(command, args) {
        check(label, "ready", Some(command.to_string()))
    } else {
        check(label, "missing", Some(command.to_string()))
    }
}

fn command_status(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn command_in_dir_status(directory: &Path, command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .current_dir(directory)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn local_write_summary() -> LocalWriteSummary {
    LocalWriteSummary {
        endpoint: format!("http://127.0.0.1:{LOCAL_WRITE_PORT}"),
        paired: read_shuttle_token().is_some(),
    }
}

fn vault_stats(noos_home: &Path) -> VaultStats {
    VaultStats {
        handoffs_active: count_markdown_files(&noos_home.join("vault/handoffs/active")),
        crystals_active: count_markdown_files(&noos_home.join("vault/crystals/active")),
        browser_handoffs: count_markdown_files(
            &home_dir().join("Downloads/NOOS/vault/handoffs/active"),
        ),
        browser_crystals: count_markdown_files(
            &home_dir().join("Downloads/NOOS/vault/crystals/active"),
        ),
    }
}

fn recent_vault_files(noos_home: &Path) -> RecentVaultFiles {
    RecentVaultFiles {
        handoffs: recent_markdown_files(&noos_home.join("vault/handoffs/active"), 6),
        crystals: recent_markdown_files(&noos_home.join("vault/crystals/active"), 6),
    }
}

fn recent_markdown_files(directory: &Path, limit: usize) -> Vec<VaultFileSummary> {
    let mut files = fs::read_dir(directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let path = entry.path();
                    let is_markdown = path
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| extension.eq_ignore_ascii_case("md"))
                        .unwrap_or(false);
                    if !is_markdown {
                        return None;
                    }

                    let metadata = entry.metadata().ok()?;
                    let modified_epoch = metadata
                        .modified()
                        .ok()
                        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs())
                        .unwrap_or(0);
                    let content = fs::read_to_string(&path).unwrap_or_default();
                    Some(VaultFileSummary {
                        name: path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or_default()
                            .to_string(),
                        path: path.display().to_string(),
                        modified_epoch,
                        title: extract_frontmatter_value(&content, "title")
                            .or_else(|| extract_heading_title(&content)),
                        key: extract_frontmatter_value(&content, "handoff_key")
                            .or_else(|| extract_frontmatter_value(&content, "crystal_key"))
                            .or_else(|| extract_frontmatter_value(&content, "lookup_key"))
                            .or_else(|| extract_frontmatter_value(&content, "filename_slug")),
                        source_url: extract_frontmatter_value(&content, "source_url"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    files.sort_by(|left, right| right.modified_epoch.cmp(&left.modified_epoch));
    files.truncate(limit);
    files
}

fn extract_frontmatter_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (candidate_key, value) = line.split_once(':')?;
        if candidate_key.trim() == key {
            let cleaned = value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        } else {
            None
        }
    })
}

fn extract_heading_title(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let heading = line.trim().strip_prefix("# ")?;
        let title = heading
            .strip_prefix("Thread:")
            .or_else(|| heading.strip_prefix("Crystal:"))
            .or_else(|| heading.strip_prefix("交接："))
            .or_else(|| heading.strip_prefix("结晶："))
            .unwrap_or(heading)
            .trim();
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    })
}

fn count_markdown_files(directory: &Path) -> usize {
    fs::read_dir(directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| extension.eq_ignore_ascii_case("md"))
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

fn open_path(path: &Path) -> Result<String, String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    open_existing_path(path)
}

fn open_existing_path(path: &Path) -> Result<String, String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(path).status()
    } else if cfg!(target_os = "windows") {
        Command::new("explorer").arg(path).status()
    } else {
        Command::new("xdg-open").arg(path).status()
    }
    .map_err(|error| error.to_string())?;

    if status.success() {
        Ok(format!("Opened {}", path.display()))
    } else {
        Err(format!("Failed to open {}", path.display()))
    }
}

fn open_vault_file(noos_home: &Path, raw_path: &str) -> Result<String, String> {
    let path = PathBuf::from(raw_path);
    if !is_inside_path(&path, &noos_home.join("vault")) {
        return Err("Refusing to open a path outside the NOOS Vault.".to_string());
    }
    if !path.is_file() {
        return Err(format!(
            "NOOS Vault file does not exist: {}",
            path.display()
        ));
    }
    open_existing_path(&path)
}

fn open_bundled_shuttle_extension(
    app: &tauri::AppHandle,
    repo_root: &Path,
) -> Result<String, String> {
    let candidates = [
        app.path()
            .resource_dir()
            .ok()
            .map(|path| path.join("noos-shuttle-extension")),
        app.path()
            .resource_dir()
            .ok()
            .map(|path| path.join("resources/noos-shuttle-extension")),
        Some(repo_root.join("apps/noos-hub/src-tauri/resources/noos-shuttle-extension")),
        Some(repo_root.join("dist")),
    ];

    let extension_dir = candidates
        .into_iter()
        .flatten()
        .find(|path| path.join("manifest.json").is_file())
        .ok_or_else(|| {
            "No bundled NOOS Shuttle extension build was found. Rebuild NOOS Hub first.".to_string()
        })?;

    open_existing_path(&extension_dir)?;
    Ok(format!(
        "Opened bundled NOOS Shuttle extension: {}\nLoad this folder from chrome://extensions or edge://extensions with Developer Mode enabled.",
        extension_dir.display()
    ))
}

fn project_runtime_from_vault_file(
    repo_root: &Path,
    noos_home: &Path,
    raw_path: &str,
) -> Result<String, String> {
    let path = PathBuf::from(raw_path);
    if !is_inside_path(&path, &noos_home.join("vault")) {
        return Err("Refusing to project a path outside the NOOS Vault.".to_string());
    }
    if !path.is_file() {
        return Err(format!(
            "NOOS Vault file does not exist: {}",
            path.display()
        ));
    }

    run_script_command(
        repo_root,
        vec![
            OsString::from("scripts/noos-project-runtime.sh"),
            path.as_os_str().to_os_string(),
        ],
    )
}

fn write_browser_token_response(stream: &mut TcpStream) -> Result<(), String> {
    match ensure_shuttle_token() {
        Ok(token) => write_json_response(stream, 200, &token),
        Err(error) => write_json_response(
            stream,
            500,
            &write_error("browser_connection_failed", &error),
        ),
    }
}

fn reset_browser_connection() -> Result<String, String> {
    let path = shuttle_token_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    Ok(format!(
        "Browser connection reset. Browser Shuttle will reconnect automatically on the next Vault save.\nRemoved: {}",
        path.display()
    ))
}

fn is_authorized_handoff_write(headers: &str) -> bool {
    let Some(expected) = read_shuttle_token() else {
        return false;
    };
    let Some(authorization) = header_value(headers, "authorization") else {
        return false;
    };
    authorization == format!("Bearer {}", expected.token)
}

fn ensure_shuttle_token() -> Result<ShuttleTokenFile, String> {
    if let Some(token) = read_shuttle_token() {
        return Ok(token);
    }

    let token = ShuttleTokenFile {
        version: 1,
        token: random_token()?,
        created_at_epoch: now_epoch(),
    };
    let path = shuttle_token_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid shuttle token path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&token).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(token)
}

fn read_shuttle_token() -> Option<ShuttleTokenFile> {
    let text = fs::read_to_string(shuttle_token_path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn shuttle_token_path() -> PathBuf {
    noos_home().join("runtime/shuttle-token.json")
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(headers: &str) -> usize {
    header_value(headers, "content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
}

fn header_value(headers: &str, name: &str) -> Option<String> {
    let target = name.to_ascii_lowercase();
    headers.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case(&target) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn request_path(raw_path: &str) -> &str {
    raw_path.split('?').next().unwrap_or(raw_path)
}

fn query_value(raw_path: &str, key: &str) -> Option<String> {
    let query = raw_path.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (candidate_key, value) = pair.split_once('=')?;
        if candidate_key == key {
            Some(percent_decode(value))
        } else {
            None
        }
    })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn is_allowed_local_write_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin == "http://127.0.0.1:1430"
        || origin == "tauri://localhost"
}

fn is_allowed_browser_connection_origin(origin: &str) -> bool {
    origin.is_empty()
        || origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
}

fn artifact_kind(value: Option<&str>) -> &str {
    match value {
        Some("crystal") => "crystal",
        Some("result") => "result",
        Some("context_pack_file") => "context_pack_file",
        _ => "handoff",
    }
}

fn is_valid_noos_artifact(content: &str, kind: &str) -> bool {
    match kind {
        "context_pack_file" => !content.trim().is_empty(),
        "crystal" => {
            content.contains("<!-- NOOS:CRYSTAL:BEGIN -->")
                && content.contains("<!-- NOOS:CRYSTAL:END -->")
        }
        "result" => content.contains("NOOS:RESULT"),
        "artifact" => !content.trim().is_empty(),
        "brief" | "context_pack" | "prompt_pack" | "reference" | "thread" => {
            content.trim_start().starts_with("---") || content.contains("type: noos_")
        }
        _ => {
            content.contains("<!-- NOOS:THREAD:BEGIN -->")
                && content.contains("<!-- NOOS:THREAD:END -->")
        }
    }
}

fn normalize_object_type(value: Option<&str>) -> &'static str {
    match value.unwrap_or("handoff") {
        "crystal" | "noos_crystal" => "crystal",
        "result" | "noos_result" => "result",
        "artifact" | "noos_artifact" => "artifact",
        "context_pack_file" | "context-pack-file" => "context_pack_file",
        "context_pack" | "context-pack" | "noos_context_pack" => "context_pack",
        "prompt_pack" | "prompt-pack" | "noos_prompt_pack" => "prompt_pack",
        "brief" | "noos_brief" => "brief",
        "reference" | "pattern" | "anti_pattern" | "flow" | "noos_reference" => "reference",
        "thread" | "noos_thread_index" => "thread",
        _ => "handoff",
    }
}

fn is_ingest_payload(value: &Value) -> bool {
    value.get("object_type").is_some()
        || value
            .get("content")
            .map(|content| content.is_object())
            .unwrap_or(false)
        || value.get("protocol_version").is_some()
}

fn object_type_from_endpoint(path: &str) -> &'static str {
    match path {
        "/v1/crystals" => "crystal",
        "/v1/results" => "result",
        "/v1/artifacts" => "artifact",
        _ => "handoff",
    }
}

fn object_vault_path(object_type: &str, status: &str) -> String {
    match object_type {
        "crystal" => format!("vault/crystals/{}", status_dir(status, "active")),
        "result" => format!("vault/results/{}", status_dir(status, "inbox")),
        "artifact" => "vault/artifacts/sidecars".to_string(),
        "context_pack_file" => "vault/context-packs".to_string(),
        "context_pack" => format!("vault/packs/context/{}", status_dir(status, "active")),
        "prompt_pack" => format!("vault/packs/prompt/{}", status_dir(status, "active")),
        "brief" => format!("vault/briefs/{}", status_dir(status, "active")),
        "reference" => "vault/references/briefs".to_string(),
        "thread" => format!("vault/threads/{}", status_dir(status, "active")),
        _ => format!("vault/handoffs/{}", status_dir(status, "active")),
    }
}

fn status_dir(status: &str, fallback: &str) -> String {
    match status {
        "active" | "done" | "archived" | "curated" | "accepted" | "inbox" | "sent" => {
            status.to_string()
        }
        _ => fallback.to_string(),
    }
}

fn default_status_for_object(object_type: &str) -> &'static str {
    match object_type {
        "result" => "inbox",
        _ => "active",
    }
}

fn derive_object_key(
    object_type: &str,
    suggested_key: Option<&str>,
    suggested_filename: Option<&str>,
    content: &str,
) -> String {
    let frontmatter_key = match object_type {
        "crystal" => extract_frontmatter_value(content, "crystal_key"),
        "result" => extract_frontmatter_value(content, "result_key"),
        "artifact" => extract_frontmatter_value(content, "artifact_key"),
        "context_pack" => extract_frontmatter_value(content, "context_key"),
        "prompt_pack" => extract_frontmatter_value(content, "prompt_key"),
        "brief" => extract_frontmatter_value(content, "brief_key"),
        "reference" => extract_frontmatter_value(content, "reference_key"),
        "thread" => extract_frontmatter_value(content, "thread_key"),
        _ => extract_frontmatter_value(content, "handoff_key")
            .or_else(|| extract_frontmatter_value(content, "filename_slug")),
    };
    let title =
        extract_frontmatter_value(content, "title").or_else(|| extract_heading_title(content));
    let filename_stem = suggested_filename
        .and_then(|filename| Path::new(filename).file_stem())
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.to_string());

    let seed = suggested_key
        .map(|value| value.to_string())
        .or(frontmatter_key)
        .or(title)
        .or(filename_stem)
        .unwrap_or_else(|| object_type.to_string());
    let slug = slugify_key(&seed);
    let date = current_date_key();
    let shortcode = stable_hash_hex(content).chars().take(4).collect::<String>();

    if has_date_prefix(&slug) {
        format!("{slug}-{shortcode}")
    } else {
        format!("{date}-{slug}-{shortcode}")
    }
}

fn has_date_prefix(slug: &str) -> bool {
    let bytes = slug.as_bytes();
    bytes.len() > 8 && bytes[0..8].iter().all(u8::is_ascii_digit) && bytes.get(8) == Some(&b'-')
}

fn slugify_key(input: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for character in input.to_ascii_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_dash = false;
        } else if !previous_dash && !slug.is_empty() {
            slug.push('-');
            previous_dash = true;
        }
        if slug.len() >= 80 {
            break;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "noos-object".to_string()
    } else {
        slug
    }
}

fn stable_hash_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn current_date_key() -> String {
    let days = (now_epoch() / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}{month:02}{day:02}")
}

fn now_iso_utc() -> String {
    let epoch = now_epoch();
    let days = (epoch / 86_400) as i64;
    let seconds = epoch % 86_400;
    let hour = seconds / 3_600;
    let minute = (seconds % 3_600) / 60;
    let second = seconds % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

fn sanitize_filename(filename: &str) -> String {
    let mut base = filename
        .replace(['/', '\\', ':'], "-")
        .trim_start_matches('.')
        .trim()
        .to_string();

    if !base.ends_with(".md") || base.len() <= 3 {
        base = "noos-thread.md".to_string();
    }

    base
}

fn sanitize_relative_path(path: &str) -> Option<PathBuf> {
    let parts: Vec<String> = path
        .split(['/', '\\'])
        .filter_map(|part| {
            let clean = part
                .replace(':', "-")
                .trim_start_matches('.')
                .trim()
                .to_string();
            if clean.is_empty() || clean == "." || clean == ".." {
                None
            } else {
                Some(clean)
            }
        })
        .collect();

    if parts.is_empty() {
        return None;
    }

    let mut relative = PathBuf::new();
    for part in parts {
        relative.push(part);
    }
    Some(relative)
}

fn unique_target_path(directory: &Path, filename: &str) -> PathBuf {
    let target = directory.join(filename);
    if !target.exists() {
        return target;
    }

    let stem = filename.strip_suffix(".md").unwrap_or(filename);
    for index in 1..10_000 {
        let candidate = directory.join(format!("{stem}-{index}.md"));
        if !candidate.exists() {
            return candidate;
        }
    }

    directory.join(format!("{stem}-overflow.md"))
}

fn write_options_response(stream: &mut TcpStream) -> Result<(), String> {
    let response = concat!(
        "HTTP/1.1 204 No Content\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n",
        "Access-Control-Allow-Headers: Content-Type, Authorization\r\n",
        "Access-Control-Max-Age: 600\r\n",
        "Content-Length: 0\r\n",
        "\r\n"
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}

fn write_json_response<T: Serialize>(
    stream: &mut TcpStream,
    status: u16,
    value: &T,
) -> Result<(), String> {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        401 => "Unauthorized",
        413 => "Payload Too Large",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = serde_json::to_string(value).map_err(|error| error.to_string())?;
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|error| error.to_string())
}

fn check(label: &str, status: &str, detail: Option<String>) -> AdapterCheck {
    AdapterCheck {
        label: label.to_string(),
        status: status.to_string(),
        detail,
    }
}

fn action(id: &str, label: &str, requires_user_action: bool) -> AdapterAction {
    AdapterAction {
        id: id.to_string(),
        label: label.to_string(),
        requires_user_action,
    }
}

fn run_script(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    run_script_command(repo_root, args.iter().map(OsString::from).collect())
}

fn run_script_command(repo_root: &Path, args: Vec<OsString>) -> Result<String, String> {
    let script_label = args
        .first()
        .map(|arg| arg.to_string_lossy().into_owned())
        .unwrap_or_else(|| "maintenance script".to_string());
    let shell = script_shell().ok_or_else(script_shell_missing_message)?;
    let output = Command::new(&shell)
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| {
            format!(
                "无法启动维护脚本 {script_label}（{}）：{error}",
                shell.display()
            )
        })?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        Ok(text)
    } else {
        Err(enrich_script_failure(text))
    }
}

fn script_shell() -> Option<PathBuf> {
    script_shell_candidates()
        .into_iter()
        .find(|candidate| script_shell_is_usable(candidate))
}

#[cfg(target_os = "windows")]
fn script_shell_candidates() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files\Git\usr\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files\Git\cmd\bash.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\usr\bin\bash.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Git\cmd\bash.exe"),
        PathBuf::from("bash"),
        PathBuf::from("bash.exe"),
    ]
}

#[cfg(not(target_os = "windows"))]
fn script_shell_candidates() -> Vec<PathBuf> {
    vec![PathBuf::from("bash")]
}

fn script_shell_is_usable(command: &Path) -> bool {
    Command::new(command)
        .args(["--noprofile", "--norc", "-lc", "printf noos"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map(|output| output.status.success() && output.stdout == b"noos")
        .unwrap_or(false)
}

fn script_shell_missing_message() -> String {
    if cfg!(target_os = "windows") {
        "NOOS Hub 需要可用的 Bash 来运行维护脚本，但没有找到可用环境。Windows 上请安装 Git for Windows，或将 Git Bash 加入 PATH 后重试。".to_string()
    } else {
        "NOOS Hub requires bash to run maintenance scripts, but bash was not found.".to_string()
    }
}

fn enrich_script_failure(text: String) -> String {
    if cfg!(target_os = "windows") && looks_like_wsl_bash_error(&text) {
        format!(
            "{text}\n\n检测到 Windows 的 bash 解析到了 WSL，但当前 WSL 不能启动 /bin/bash。NOOS Hub 在 Windows 上应使用 Git Bash 运行维护脚本；请安装 Git for Windows，或将 Git Bash 放在 PATH 中 WSL bash 之前。"
        )
    } else {
        text
    }
}

fn looks_like_wsl_bash_error(text: &str) -> bool {
    text.contains("WSL") && text.contains("/bin/bash")
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn noos_home() -> PathBuf {
    env::var("NOOS_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".noos"))
}

fn home_dir() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    #[cfg(target_os = "windows")]
    fn script_shell_candidates_prefer_git_bash_before_path_bash() {
        let candidates = script_shell_candidates();

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"))
        );
        assert!(candidates.iter().any(|candidate| candidate == Path::new("bash")));
    }

    #[test]
    fn wsl_bash_failures_are_identified_for_actionable_errors() {
        assert!(looks_like_wsl_bash_error(
            "<3>WSL ERROR: CreateProcessCommon:640: execvpe(/bin/bash) failed"
        ));
        assert!(!looks_like_wsl_bash_error("bash: npm: command not found"));
    }

    #[test]
    fn sleep_recovery_cpu_gate_only_flags_values_above_limit() {
        assert!(!cpu_percent_exceeds_limit(24.9, 25.0));
        assert!(!cpu_percent_exceeds_limit(25.0, 25.0));
        assert!(cpu_percent_exceeds_limit(25.1, 25.0));
    }

    #[test]
    fn sleep_recovery_marks_healthy_when_local_write_recovers() {
        let restarts = Cell::new(0);

        let status = recover_local_write_after_sleep_with_probes(
            "unit test healthy recovery",
            Some(601),
            || true,
            || false,
            || restarts.set(restarts.get() + 1),
            false,
        );

        assert_eq!(status.state, SleepRecoveryState::Healthy);
        assert_eq!(status.attempts, 1);
        assert!(status.local_write_healthy);
        assert!(!status.relaunch_recommended);
        assert_eq!(status.last_gap_secs, Some(601));
        assert_eq!(restarts.get(), 0);
    }

    #[test]
    fn sleep_recovery_recommends_relaunch_when_cpu_remains_abnormal() {
        let restarts = Cell::new(0);

        let status = recover_local_write_after_sleep_with_probes(
            "unit test cpu abnormal",
            Some(602),
            || true,
            || true,
            || restarts.set(restarts.get() + 1),
            false,
        );

        assert_eq!(status.state, SleepRecoveryState::Relaunching);
        assert_eq!(status.attempts, 1);
        assert!(status.local_write_healthy);
        assert!(status.relaunch_recommended);
        assert_eq!(restarts.get(), 0);
    }

    #[test]
    fn sleep_recovery_restarts_and_relaunches_after_exhausted_attempts() {
        let restarts = Cell::new(0);

        let status = recover_local_write_after_sleep_with_probes(
            "unit test exhausted recovery",
            Some(603),
            || false,
            || false,
            || restarts.set(restarts.get() + 1),
            false,
        );

        assert_eq!(status.state, SleepRecoveryState::Relaunching);
        assert_eq!(status.attempts, SLEEP_RECOVERY_MAX_ATTEMPTS);
        assert!(!status.local_write_healthy);
        assert!(status.relaunch_recommended);
        assert_eq!(restarts.get(), u32::from(SLEEP_RECOVERY_MAX_ATTEMPTS));
    }

    #[test]
    fn browser_adapter_prioritizes_manual_chrome_install_guide() {
        let adapter = browser_adapter(Path::new("/tmp/noos-repo"), Path::new("/tmp/noos-home"));
        let action_ids = adapter
            .actions
            .iter()
            .map(|action| action.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            action_ids,
            vec!["browser-manual-unpacked", "browser-dev-profile"]
        );
        assert!(adapter.actions[0].requires_user_action);
    }

    #[test]
    fn workspace_adapter_action_uses_non_destructive_label() {
        let adapter = workspace_adapter(Path::new("/tmp/noos-repo"));

        assert_eq!(adapter.actions[0].id, "install-workspace");
        assert_eq!(adapter.actions[0].label, "补齐 Workspace 目录");
    }

    #[test]
    fn feishu_source_path_includes_title_and_short_token() {
        let wiki = Path::new("/tmp/wiki");
        let url = "https://team.feishu.cn/docx/birldmo6vod3fnx8ajzcfa0hnef";
        let token = feishu_token_from_url(url).unwrap();
        let title = "从博客 User Story 到机制、数值接口：P0 推导示例 v0.6";

        let path = feishu_source_path(wiki, "projects/noos-shuttle/design", &token, Some(title));
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("");

        assert!(path.starts_with("/tmp/wiki/raw/sources/projects/noos-shuttle/design"));
        assert!(filename.starts_with("从博客-user-story-到机制-数值接口-p0-推导示例-v0-6--"));
        assert!(filename.ends_with("--birldmo6vod3.md"));
    }

    #[test]
    fn existing_feishu_source_path_finds_legacy_token_filename() {
        let root = unique_test_dir("feishu-legacy-source");
        let wiki = root.join("wiki");
        let url = "https://team.feishu.cn/docx/birldmo6vod3fnx8ajzcfa0hnef";
        let legacy = wiki
            .join("raw")
            .join("sources")
            .join("feishu")
            .join("feishu-birldmo6vod3fnx8ajzcfa0hnef.md");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, "# legacy").unwrap();

        let token = feishu_token_from_url(url).unwrap();
        let source_id = feishu_source_id(&token);
        let found =
            existing_feishu_source_path(&wiki, &source_id, url, Some("Readable Title"), None);
        assert_eq!(found.as_deref(), Some(legacy.as_path()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sanitize_category_path_rejects_unsafe_segments() {
        assert_eq!(
            sanitize_category_path(Some("Projects / NOOS Shuttle / Design")).unwrap(),
            "projects/noos-shuttle/design"
        );
        assert!(sanitize_category_path(Some("../secrets")).is_err());
        assert!(sanitize_category_path(Some("projects/.hidden")).is_err());
        assert!(sanitize_category_path(Some("/absolute")).is_err());
    }

    #[test]
    fn source_map_lookup_finds_categorized_source() {
        let root = unique_test_dir("source-map-lookup");
        let wiki = root.join("wiki");
        let source = wiki
            .join("raw")
            .join("sources")
            .join("projects")
            .join("demo")
            .join("doc--abc123.md");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "# Demo").unwrap();
        let map = wiki.join("knowledge-library").join("source-map.json");
        fs::create_dir_all(map.parent().unwrap()).unwrap();
        fs::write(
            &map,
            serde_json::to_string(&json!({
                "sources": [{
                    "source_id": "feishu_docx_abc123",
                    "source_path": "raw/sources/projects/demo/doc--abc123.md"
                }]
            }))
            .unwrap(),
        )
        .unwrap();

        let found = source_path_from_source_map(&wiki, "feishu_docx_abc123");
        assert_eq!(found.as_deref(), Some(source.as_path()));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn source_map_lookup_rejects_unsafe_source_paths() {
        let root = unique_test_dir("source-map-unsafe-paths");
        let wiki = root.join("wiki");
        let outside = root.join("outside.md");
        let canon = wiki.join("knowledge-library").join("canon").join("doc.md");
        let map = wiki.join("knowledge-library").join("source-map.json");
        fs::create_dir_all(canon.parent().unwrap()).unwrap();
        fs::write(&outside, "# Outside").unwrap();
        fs::write(&canon, "# Canon").unwrap();

        let cases = [
            ("parent", "raw/sources/../../outside.md".to_string()),
            ("absolute", outside.display().to_string()),
            ("wrong-root", "knowledge-library/canon/doc.md".to_string()),
        ];

        for (source_id, source_path) in cases {
            fs::write(
                &map,
                serde_json::to_string(&json!({
                    "sources": [{
                        "source_id": source_id,
                        "source_path": source_path
                    }]
                }))
                .unwrap(),
            )
            .unwrap();

            assert_eq!(source_path_from_source_map(&wiki, source_id), None);
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn wiki_category_state_discards_unsafe_config_paths() {
        let root = unique_test_dir("wiki-category-state-sanitize");
        let noos_home = root.join("home");
        let wiki = root.join("wiki");
        let key = wiki_project_key(&wiki);
        fs::create_dir_all(&noos_home).unwrap();
        write_json_file(
            &noos_home.join("config.json"),
            &json!({
                "wiki": {
                    "category_paths": {
                        key: {
                            "last_category_path": "../outside",
                            "recent_category_paths": [
                                "Projects / Good",
                                "/absolute",
                                "projects/.hidden",
                                "projects/good"
                            ]
                        }
                    }
                },
                "feishu": {
                    "last_category_path": "Fallback / Good"
                }
            }),
        )
        .unwrap();

        let (current, recent) = wiki_category_state_from(&noos_home, &wiki);

        assert_eq!(current.as_deref(), Some("fallback/good"));
        assert_eq!(recent, vec!["projects/good".to_string()]);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn normalize_feishu_export_dir_detects_main_markdown_and_resources() {
        let root = unique_test_dir("feishu-package-normalize");
        let export = root.join("export");
        fs::create_dir_all(export.join("feishu_docx_abc").join("images")).unwrap();
        fs::write(
            export.join("feishu_docx_abc.md"),
            "# Title\n\n![A](feishu_docx_abc/images/a.png)",
        )
        .unwrap();
        fs::write(
            export.join("feishu_docx_abc").join("images").join("a.png"),
            "png",
        )
        .unwrap();

        let package = normalize_feishu_export_dir(&export, "feishu_docx_abc").unwrap();
        assert_eq!(package.export_mode, "package");
        assert_eq!(package.resources.len(), 1);
        assert_eq!(package.resources[0].relative_path, "images/a.png");
        let normalized = normalize_exported_markdown_resources(
            &package.markdown,
            &package.resources,
            ".assets/feishu_docx_abc",
        );
        assert!(normalized.contains("](.assets/feishu_docx_abc/images/a.png)"));
        assert!(!normalized.contains(".assets/feishu_docx_abc/feishu_docx_abc/"));
        assert_eq!(package.temp_root.as_deref(), Some(export.as_path()));
        let assets = root.join("assets");
        write_exported_resources(&package.resources, &assets).unwrap();
        cleanup_feishu_export_package(&package);
        assert!(assets.join("images").join("a.png").exists());
        assert!(!export.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn feishu_package_export_attempts_try_board_metadata_first() {
        let attempts = feishu_package_export_attempts(
            "https://team.feishu.cn/docx/abc123",
            Path::new("/tmp/noos-export"),
            "feishu_docx_abc123",
        );

        assert_eq!(
            attempts[0],
            vec![
                "export",
                "https://team.feishu.cn/docx/abc123",
                "-o",
                "/tmp/noos-export",
                "-n",
                "feishu_docx_abc123",
                "--table",
                "md",
                "--export-board-metadata",
            ]
        );
        assert_eq!(
            attempts[1],
            vec![
                "export",
                "https://team.feishu.cn/docx/abc123",
                "-o",
                "/tmp/noos-export",
                "-n",
                "feishu_docx_abc123",
                "--table",
                "md",
            ]
        );
    }

    #[test]
    fn feishu_source_metadata_matches_current_library_fields() {
        let markdown = build_feishu_source_markdown(
            "# Title",
            "https://team.feishu.cn/docx/abc123",
            "Title",
            "abc123",
            "feishu_docx_abc123",
            "projects/noos-shuttle/design",
            ".assets/feishu_docx_abc123",
            "package",
            "2026-07-02T00:00:00Z",
        );

        assert!(feishu_source_metadata_matches(
            &markdown,
            "feishu_docx_abc123",
            "projects/noos-shuttle/design",
            ".assets/feishu_docx_abc123",
            "package"
        ));
        assert!(!feishu_source_metadata_matches(
            &markdown,
            "feishu_docx_abc123",
            "projects/noos-shuttle/product",
            ".assets/feishu_docx_abc123",
            "package"
        ));
    }

    #[test]
    fn prepare_feishu_publish_markdown_strips_frontmatter_and_adds_h1() {
        let markdown = "---\ntitle: Source Title\n---\n\n## Section\n\nBody";
        let prepared = prepare_feishu_publish_markdown(markdown, "Source Title").unwrap();

        assert_eq!(prepared, "# Source Title\n\n## Section\n\nBody");
    }

    #[test]
    fn prepare_feishu_publish_markdown_preserves_existing_h1() {
        let markdown = "# Existing Title\n\n## Section\n\nBody";
        let prepared = prepare_feishu_publish_markdown(markdown, "Fallback").unwrap();

        assert_eq!(prepared, markdown);
    }

    #[test]
    fn feishu_docx_command_candidates_include_path_and_homebrew_locations() {
        let commands = feishu_docx_command_candidates();

        assert!(commands.contains(&PathBuf::from("feishu-docx")));
        assert!(commands.contains(&PathBuf::from("/opt/homebrew/bin/feishu-docx")));
        assert!(commands.contains(&PathBuf::from("/usr/local/bin/feishu-docx")));
    }

    #[test]
    fn ensure_json_file_rejects_invalid_existing_json() {
        let root = unique_test_dir("invalid-json-file");
        let path = root.join("index.json");
        fs::write(&path, "{not-json").unwrap();

        let error = ensure_json_file(&path, json!({})).unwrap_err();
        assert!(error.contains("Invalid JSON file"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_json_file_replaces_existing_json_without_tmp_leftovers() {
        let root = unique_test_dir("atomic-json-write");
        let path = root.join("index").join("objects.json");

        write_json_file(&path, &json!({ "first": true })).unwrap();
        write_json_file(&path, &json!({ "second": true })).unwrap();

        let parsed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed["second"], true);
        assert!(fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .all(|entry| !entry.file_name().to_string_lossy().contains(".tmp.")));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_index_update_writes_resolvable_keys_and_objects() {
        let root = unique_test_dir("vault-index-update");
        let noos_home = root.join("home");
        ensure_vault_layout(&noos_home).unwrap();
        let object_path = noos_home.join("vault/handoffs/active/20260701-index-test.md");
        fs::write(&object_path, "# Index Test").unwrap();

        update_vault_indexes(
            &noos_home,
            test_index_object("noos_obj_index_test", "20260701-index-test", &object_path),
        )
        .unwrap();

        let by_key = find_indexed_object_by_key(&noos_home, "20260701-index-test").unwrap();
        assert_eq!(by_key["object_id"], "noos_obj_index_test");
        assert_eq!(
            existing_indexed_object(&noos_home, "noos_obj_index_test")
                .unwrap()
                .get("lookup_key")
                .and_then(Value::as_str),
            Some("20260701-index-test")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_index_update_rejects_corrupt_keys_before_writing_objects() {
        let root = unique_test_dir("vault-index-corrupt");
        let noos_home = root.join("home");
        ensure_vault_layout(&noos_home).unwrap();
        let keys_path = noos_home.join("vault/index/keys.json");
        let objects_path = noos_home.join("vault/index/objects.json");
        fs::write(&keys_path, "{not-json").unwrap();
        let object_path = noos_home.join("vault/handoffs/active/20260701-index-test.md");
        fs::write(&object_path, "# Index Test").unwrap();

        let error = update_vault_indexes(
            &noos_home,
            test_index_object("noos_obj_index_test", "20260701-index-test", &object_path),
        )
        .unwrap_err();

        assert!(error.contains("Invalid JSON object"));
        assert_eq!(fs::read_to_string(objects_path).unwrap(), "{}");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_config_for_write_rejects_invalid_existing_config() {
        let root = unique_test_dir("config-invalid-json");
        let path = root.join("config.json");
        fs::write(&path, "{not-json").unwrap();

        let error = read_config_for_write(&path).unwrap_err();

        assert!(error.contains("配置 JSON 无效"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "{not-json");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_object_payload_reads_unindexed_archive_path() {
        let root = unique_test_dir("vault-object-path");
        let noos_home = root.join("home");
        let object_path = noos_home.join("vault/handoffs/done/archive.md");
        fs::create_dir_all(object_path.parent().unwrap()).unwrap();
        fs::write(&object_path, "---\ntitle: Archived Handoff\n---\n\n# Body").unwrap();
        let path_string = object_path.display().to_string();

        let payload = vault_object_payload(
            &noos_home,
            "archive-key",
            Some(path_string.as_str()),
            Some("handoffs/done"),
        );

        assert_eq!(payload["ok"], true);
        assert_eq!(payload["object"]["object_type"], "handoff");
        assert_eq!(payload["object"]["title"], "Archived Handoff");
        assert!(payload["object"]["content"]
            .as_str()
            .unwrap()
            .contains("# Body"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_browse_payload_includes_library_sources() {
        let root = unique_test_dir("vault-library-source-browse");
        let noos_home = root.join("home");
        let (_wiki, _source_path) = create_library_source_fixture(&root, &noos_home);

        let payload = vault_browse_payload(&noos_home, Some("library_sources"), None);

        assert_eq!(payload["ok"], true);
        let objects = payload["objects"].as_array().unwrap();
        assert_eq!(objects.len(), 1);
        assert_eq!(objects[0]["object_type"], "library_source");
        assert_eq!(objects[0]["lookup_key"], "feishu_docx_abc123");
        assert_eq!(objects[0]["title"], "Library Source Title");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_object_payload_reads_library_source() {
        let root = unique_test_dir("vault-library-source-object");
        let noos_home = root.join("home");
        let (_wiki, source_path) = create_library_source_fixture(&root, &noos_home);

        let payload = vault_object_payload(&noos_home, "feishu_docx_abc123", None, None);

        assert_eq!(payload["ok"], true);
        assert_eq!(payload["object"]["object_type"], "library_source");
        assert_eq!(payload["object"]["path"], source_path.display().to_string());
        assert!(payload["object"]["content"]
            .as_str()
            .unwrap()
            .contains("Library source body."));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn vault_object_payload_from_path_reads_library_source() {
        let root = unique_test_dir("vault-library-source-object-path");
        let noos_home = root.join("home");
        let (_wiki, source_path) = create_library_source_fixture(&root, &noos_home);
        let path_string = source_path.display().to_string();

        let payload = vault_object_payload(
            &noos_home,
            "feishu_docx_abc123",
            Some(path_string.as_str()),
            Some("library_sources"),
        );

        assert_eq!(payload["ok"], true);
        assert_eq!(payload["object"]["object_type"], "library_source");
        assert_eq!(payload["object"]["path"], source_path.display().to_string());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_vault_markdown_source_reads_library_source() {
        let root = unique_test_dir("vault-library-source-read");
        let noos_home = root.join("home");
        let (_wiki, source_path) = create_library_source_fixture(&root, &noos_home);

        let source = read_vault_markdown_source_from(&noos_home, "feishu_docx_abc123").unwrap();

        assert_eq!(source.lookup_key, "feishu_docx_abc123");
        assert_eq!(source.path, source_path);
        assert_eq!(source.title.as_deref(), Some("Library Source Title"));
        assert!(source.content.contains("Library source body."));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepare_feishu_publish_markdown_strips_flattened_noos_metadata() {
        let markdown = "type: noos_thread version: 0.1 handoff_revision: v1 source_app: chatgpt source_url: https://chatgpt.com/c/example target_agent: codex status: active created_at: 2026-05-18 title: 钓鱼玩法场次与经济框算表设计 tags: [fishing-economy] preferred_path: .noos/handoffs/active/example.md\n\n## 正文\n\nBody";
        let prepared =
            prepare_feishu_publish_markdown(markdown, "钓鱼玩法场次与经济框算表设计").unwrap();

        assert!(!prepared.contains("type: noos_thread"));
        assert_eq!(
            prepared,
            "# 钓鱼玩法场次与经济框算表设计\n\n## 正文\n\nBody"
        );
    }

    #[test]
    fn prepare_feishu_publish_markdown_strips_unfenced_noos_metadata_block() {
        let markdown = "type: noos_thread\nversion: 0.1\nsource_app: chatgpt\ntitle: Handoff Title\n\n# Handoff Title\n\nBody";
        let prepared = prepare_feishu_publish_markdown(markdown, "Fallback").unwrap();

        assert!(!prepared.contains("source_app: chatgpt"));
        assert_eq!(prepared, "# Handoff Title\n\nBody");
    }

    fn test_index_object(object_id: &str, lookup_key: &str, path: &Path) -> VaultIndexObject {
        VaultIndexObject {
            object_type: "handoff",
            object_id: object_id.to_string(),
            lookup_key: lookup_key.to_string(),
            status: "active".to_string(),
            path: path.display().to_string(),
            title: Some("Index Test".to_string()),
            source: json!({ "app": "unit-test" }),
            source_url: Some("https://example.test/noos".to_string()),
            created_at: "2026-07-01T00:00:00Z".to_string(),
            content_hash: "sha256ish:test".to_string(),
            request_id: Some("request-test".to_string()),
            idempotency_key: Some("idempotency-test".to_string()),
        }
    }

    fn create_library_source_fixture(root: &Path, noos_home: &Path) -> (PathBuf, PathBuf) {
        let wiki = root.join("wiki");
        let source_path = wiki
            .join("raw")
            .join("sources")
            .join("projects")
            .join("noos-shuttle")
            .join("library-source--abc123.md");
        fs::create_dir_all(source_path.parent().unwrap()).unwrap();
        fs::write(
            &source_path,
            "---\ntype: library_source\nsource_id: feishu_docx_abc123\ntitle: Library Source Title\n---\n\n# Library Source Title\n\nLibrary source body.",
        )
        .unwrap();
        fs::create_dir_all(noos_home).unwrap();
        write_json_file(
            &noos_home.join("config.json"),
            &json!({ "default_wiki_project": wiki.display().to_string() }),
        )
        .unwrap();
        write_json_file(
            &wiki.join("knowledge-library").join("source-map.json"),
            &json!({
                "schema": "noos/knowledge-source-map@0.1",
                "sources": [{
                    "source_id": "feishu_docx_abc123",
                    "source_app": "feishu",
                    "source_url": "https://team.feishu.cn/docx/ABC123",
                    "category_path": "projects/noos-shuttle",
                    "title": "Library Source Title",
                    "source_path": "raw/sources/projects/noos-shuttle/library-source--abc123.md",
                    "last_exported_at": "2026-07-02T00:00:00Z"
                }]
            }),
        )
        .unwrap();
        (wiki, source_path)
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!(
            "noos-hub-{name}-{}-{}",
            std::process::id(),
            now_epoch()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }
}
