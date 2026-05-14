use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

const LOCAL_WRITE_PORT: u16 = 17642;
const HUB_PROTOCOL_VERSION: u8 = 1;
const PAIRING_WINDOW_SECONDS: u64 = 120;

#[derive(Serialize)]
struct HubHealth {
    repo_root: String,
    noos_home: String,
    adapters: Vec<AdapterHealth>,
}

#[derive(Serialize)]
struct AdapterHealth {
    id: String,
    name: String,
    kind: String,
    status: String,
    summary: String,
    checks: Vec<AdapterCheck>,
    actions: Vec<AdapterAction>,
}

#[derive(Serialize)]
struct AdapterCheck {
    label: String,
    status: String,
    detail: Option<String>,
}

#[derive(Serialize)]
struct AdapterAction {
    id: String,
    label: String,
    requires_user_action: bool,
}

#[derive(Deserialize)]
struct HandoffWriteRequest {
    filename: String,
    content: String,
    source: Option<HandoffSource>,
}

#[derive(Deserialize)]
struct HandoffSource {
    app: Option<String>,
    url: Option<String>,
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
}

#[derive(Serialize, Deserialize)]
struct ShuttleTokenFile {
    version: u8,
    token: String,
    created_at_epoch: u64,
}

#[derive(Serialize, Deserialize)]
struct PairingWindowFile {
    enabled_until_epoch: u64,
}

#[tauri::command]
fn get_hub_health() -> Result<HubHealth, String> {
    let repo_root = repo_root();
    let noos_home = noos_home();

    Ok(HubHealth {
        repo_root: repo_root.display().to_string(),
        noos_home: noos_home.display().to_string(),
        adapters: vec![
            workspace_adapter(&repo_root),
            vault_adapter(&noos_home),
            inbox_adapter(&noos_home),
            codex_adapter(&noos_home),
            claude_adapter(&repo_root),
            browser_adapter(&repo_root, &noos_home),
            github_adapter(&repo_root),
        ],
    })
}

#[tauri::command]
fn run_hub_action(action: String) -> Result<String, String> {
    let repo_root = repo_root();
    match action.as_str() {
        "doctor" => run_script(&repo_root, &["scripts/noos-doctor.sh"]),
        "install-consumers" => run_script(&repo_root, &["scripts/noos-install.sh", "consumers"]),
        "install-workspace" => run_script(&repo_root, &["scripts/noos-install.sh", "workspace"]),
        "create-inbox" => run_script(&repo_root, &["scripts/noos-install.sh", "inbox"]),
        "create-vault" => run_script(&repo_root, &["scripts/noos-install.sh", "vault"]),
        "connect-browser-shuttle" => connect_browser_shuttle(),
        "import-browser-vault" => run_script(&repo_root, &["scripts/noos-import-browser-vault.sh"]),
        "sync-handoffs-git" => run_script(&repo_root, &["scripts/noos-sync-handoffs-git.sh"]),
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
        _ => Err(format!("Unknown action: {action}")),
    }
}

fn main() {
    start_local_write_server();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_hub_health, run_hub_action])
        .run(tauri::generate_context!())
        .expect("error while running NOOS Hub");
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
                &HandoffWriteResponse {
                    ok: false,
                    backend: "hub_local".to_string(),
                    location: None,
                    error_code: Some("request_too_large".to_string()),
                    message: "Request is too large.".to_string(),
                },
            );
        }
    }

    let Some(end) = header_end else {
        return write_json_response(
            &mut stream,
            400,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("bad_request".to_string()),
                message: "Missing HTTP headers.".to_string(),
            },
        );
    };

    let headers = String::from_utf8_lossy(&buffer[..end]);
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or_default();
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    let method = parts.first().copied().unwrap_or_default();
    let path = parts.get(1).copied().unwrap_or_default();
    let origin = header_value(&headers, "origin").unwrap_or_default();

    if method == "OPTIONS" {
        return write_options_response(&mut stream);
    }

    if !origin.is_empty() && !is_allowed_local_write_origin(&origin) {
        return write_json_response(
            &mut stream,
            403,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("origin_not_allowed".to_string()),
                message: "Origin is not allowed.".to_string(),
            },
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
                vault_path: noos_home()
                    .join("vault/handoffs/active")
                    .display()
                    .to_string(),
                paired: read_shuttle_token().is_some(),
            },
        );
    }

    if method == "GET" && path == "/pair" {
        if !is_allowed_pairing_origin(&origin) {
            return write_json_response(
                &mut stream,
                403,
                &HandoffWriteResponse {
                    ok: false,
                    backend: "hub_local".to_string(),
                    location: None,
                    error_code: Some("origin_not_allowed".to_string()),
                    message: "Pairing origin is not allowed.".to_string(),
                },
            );
        }

        return write_pairing_response(&mut stream);
    }

    if method != "POST" || path != "/v1/handoffs" {
        return write_json_response(
            &mut stream,
            404,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("not_found".to_string()),
                message: "Endpoint not found.".to_string(),
            },
        );
    }

    if !is_authorized_handoff_write(&headers) {
        return write_json_response(
            &mut stream,
            401,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("unauthorized".to_string()),
                message: "Browser Shuttle is not paired with NOOS Hub.".to_string(),
            },
        );
    }

    let body_start = end + 4;
    let body_end = body_start + content_length;
    let body = &buffer[body_start..body_end.min(buffer.len())];
    let request: HandoffWriteRequest =
        serde_json::from_slice(body).map_err(|error| error.to_string())?;
    let response = write_handoff_to_local_vault(request);
    let status = if response.ok { 200 } else { 400 };
    write_json_response(&mut stream, status, &response)
}

fn write_handoff_to_local_vault(request: HandoffWriteRequest) -> HandoffWriteResponse {
    if !is_noos_handoff(&request.content) {
        return HandoffWriteResponse {
            ok: false,
            backend: "hub_local".to_string(),
            location: None,
            error_code: Some("invalid_handoff".to_string()),
            message: "Content does not contain NOOS thread markers.".to_string(),
        };
    }

    let vault = noos_home().join("vault/handoffs/active");
    if let Err(error) = fs::create_dir_all(&vault) {
        return HandoffWriteResponse {
            ok: false,
            backend: "hub_local".to_string(),
            location: None,
            error_code: Some("vault_unavailable".to_string()),
            message: error.to_string(),
        };
    }

    let filename = sanitize_filename(&request.filename);
    let target = unique_target_path(&vault, &filename);
    let temp = target.with_extension("tmp");
    let mut content = request.content;
    if let Some(source) = request.source {
        let app = source.app.unwrap_or_default();
        let url = source.url.unwrap_or_default();
        if !app.is_empty() || !url.is_empty() {
            content.push_str("\n\n<!-- NOOS:HUB:SOURCE ");
            content.push_str(&format!("app={} url={}", app, url));
            content.push_str(" -->\n");
        }
    }

    if let Err(error) =
        fs::write(&temp, content.as_bytes()).and_then(|_| fs::rename(&temp, &target))
    {
        let _ = fs::remove_file(&temp);
        return HandoffWriteResponse {
            ok: false,
            backend: "hub_local".to_string(),
            location: None,
            error_code: Some("write_failed".to_string()),
            message: error.to_string(),
        };
    }

    HandoffWriteResponse {
        ok: true,
        backend: "hub_local".to_string(),
        location: Some(target.display().to_string()),
        error_code: None,
        message: format!("Saved to local NOOS Vault: {}", target.display()),
    }
}

fn workspace_adapter(repo_root: &Path) -> AdapterHealth {
    let checks = vec![
        file_check("Project config", repo_root.join(".noos/project.json")),
        dir_check("Active handoffs", repo_root.join(".noos/handoffs/active")),
        dir_check("Done handoffs", repo_root.join(".noos/handoffs/done")),
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
        dir_check(
            "Browser vault mirror",
            home_dir().join("Downloads/NOOS/vault/handoffs/active"),
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
        "NOOS 本机存储中心，包含 Wiki 和 Handoff；浏览器插件先写入本机 vault mirror。",
        checks,
        vec![
            action("create-vault", "创建 NOOS Vault", false),
            action("connect-browser-shuttle", "连接 Browser Shuttle", true),
            action("import-browser-vault", "导入 Browser Mirror", false),
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
        "ChatGPT 网页端生成、捕获和交付 handoff 的扩展。",
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

fn connect_browser_shuttle() -> Result<String, String> {
    let token = ensure_shuttle_token()?;
    let pairing = PairingWindowFile {
        enabled_until_epoch: now_epoch() + PAIRING_WINDOW_SECONDS,
    };
    let path = pairing_window_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid pairing window path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&pairing).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    Ok(format!(
        "Browser Shuttle pairing is open for {PAIRING_WINDOW_SECONDS} seconds.\nEndpoint: http://127.0.0.1:{LOCAL_WRITE_PORT}\nToken file: {}\nToken prefix: {}...",
        shuttle_token_path().display(),
        &token.token.chars().take(8).collect::<String>()
    ))
}

fn write_pairing_response(stream: &mut TcpStream) -> Result<(), String> {
    let Some(pairing) = read_pairing_window() else {
        return write_json_response(
            stream,
            403,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("pairing_closed".to_string()),
                message: "Open NOOS Hub and click Connect Browser Shuttle.".to_string(),
            },
        );
    };

    if pairing.enabled_until_epoch < now_epoch() {
        let _ = fs::remove_file(pairing_window_path());
        return write_json_response(
            stream,
            403,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("pairing_expired".to_string()),
                message: "Browser Shuttle pairing window expired.".to_string(),
            },
        );
    }

    match ensure_shuttle_token() {
        Ok(token) => {
            let _ = fs::remove_file(pairing_window_path());
            write_json_response(stream, 200, &token)
        }
        Err(error) => write_json_response(
            stream,
            500,
            &HandoffWriteResponse {
                ok: false,
                backend: "hub_local".to_string(),
                location: None,
                error_code: Some("pairing_failed".to_string()),
                message: error,
            },
        ),
    }
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

fn read_pairing_window() -> Option<PairingWindowFile> {
    let text = fs::read_to_string(pairing_window_path()).ok()?;
    serde_json::from_str(&text).ok()
}

fn shuttle_token_path() -> PathBuf {
    noos_home().join("runtime/shuttle-token.json")
}

fn pairing_window_path() -> PathBuf {
    noos_home().join("runtime/shuttle-pairing.json")
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

fn is_allowed_local_write_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin == "http://127.0.0.1:1430"
        || origin == "tauri://localhost"
}

fn is_allowed_pairing_origin(origin: &str) -> bool {
    origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://")
}

fn is_noos_handoff(content: &str) -> bool {
    content.contains("<!-- NOOS:THREAD:BEGIN -->") && content.contains("<!-- NOOS:THREAD:END -->")
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
