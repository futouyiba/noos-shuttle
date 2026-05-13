use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_hub_health, run_hub_action])
        .run(tauri::generate_context!())
        .expect("error while running NOOS Hub");
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
    ];
    adapter(
        "noos-vault",
        "NOOS Vault",
        "transport",
        "NOOS 本机存储中心，包含 Wiki 和 Handoff；浏览器插件先写入本机 vault mirror。",
        checks,
        vec![
            action("create-vault", "创建 NOOS Vault", false),
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
