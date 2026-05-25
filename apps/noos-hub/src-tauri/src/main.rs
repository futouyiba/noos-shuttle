use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LOCAL_WRITE_PORT: u16 = 17642;
const HUB_PROTOCOL_VERSION: u8 = 1;
const HUB_HEALTH_CACHE_TTL_SECS: u64 = 5;
const LOCAL_WRITE_IO_TIMEOUT_SECS: u64 = 5;
const SLEEP_GUARD_CHECK_INTERVAL_SECS: u64 = 60;
const SLEEP_GUARD_EXIT_AFTER_GAP_SECS: u64 = 10 * 60;
const SLEEP_RECOVERY_MAX_ATTEMPTS: u8 = 3;
const LOCAL_WRITE_RECOVERY_PROBE_TIMEOUT_MS: u64 = 1_500;
const SLEEP_RECOVERY_CPU_LIMIT_PERCENT: f32 = 75.0;

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
fn get_hub_health() -> Result<HubHealth, String> {
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
fn run_hub_action(action: String) -> Result<String, String> {
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

fn main() {
    start_local_write_server();
    start_sleep_resume_guard();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_hub_health,
            run_hub_action,
            get_sleep_recovery_status,
            mark_sleep_suspended,
            recover_from_sleep,
            simulate_sleep_resume
        ])
        .run(tauri::generate_context!())
        .expect("error while running NOOS Hub");
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
        && (path == "/v1/vault/recent" || path == "/v1/vault/object" || path == "/v1/vault/browse")
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
            .map(|lookup_key| vault_object_payload(&noos_home(), lookup_key))
            .unwrap_or_else(|| json!({ "ok": false, "error_code": "missing_lookup_key", "message": "Missing key query parameter." }));
        let status = if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            200
        } else {
            404
        };
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
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid index path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_string_pretty(&default_value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn update_vault_indexes(noos_home: &Path, object: VaultIndexObject) -> Result<(), String> {
    let index_dir = noos_home.join("vault/index");
    fs::create_dir_all(&index_dir).map_err(|error| error.to_string())?;

    let mut keys = read_json_object(&index_dir.join("keys.json"));
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
    write_json_file(&index_dir.join("keys.json"), &keys)?;

    let mut objects = read_json_object(&index_dir.join("objects.json"));
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
    write_json_file(&index_dir.join("objects.json"), &objects)?;

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

fn vault_object_payload(noos_home: &Path, lookup_key: &str) -> Value {
    let Some(indexed) = find_indexed_object_by_key(noos_home, lookup_key)
        .or_else(|| find_unindexed_vault_object_by_key(noos_home, lookup_key))
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
    if !is_inside_path(&path_buf, &noos_home.join("vault")) {
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

fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid index path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_string_pretty(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
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
        vec![action("install-workspace", "初始化 Workspace", false)],
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
            action("browser-dev-profile", "启动 NOOS 浏览器", false),
            action("browser-manual-unpacked", "日常 Chrome 安装向导", true),
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

    let output = Command::new("bash")
        .arg("scripts/noos-project-runtime.sh")
        .arg(path.as_os_str())
        .current_dir(repo_root)
        .output()
        .map_err(|error| error.to_string())?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if output.status.success() {
        Ok(text)
    } else {
        Err(text)
    }
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
    let output = Command::new("bash")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|error| error.to_string())?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        Ok(text)
    } else {
        Err(text)
    }
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
}
