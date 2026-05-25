mod clip_server;
mod commands;
mod panic_guard;
mod proxy;
mod types;

use panic_guard::run_guarded;
use serde::Serialize;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SLEEP_GUARD_CHECK_INTERVAL_SECS: u64 = 60;
const SLEEP_GUARD_EXIT_AFTER_GAP_SECS: u64 = 10 * 60;

static SLEEP_RECOVERY_STATUS: OnceLock<Mutex<SleepRecoveryStatus>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SleepRecoveryState {
    Running,
    Suspended,
    Resumed,
    Recovering,
    Degraded,
    Relaunching,
    Healthy,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SleepRecoveryStatus {
    state: SleepRecoveryState,
    last_reason: String,
    last_resume_epoch: Option<u64>,
    last_gap_secs: Option<u64>,
    relaunch_recommended: bool,
    message: String,
}

#[tauri::command]
fn clip_server_status() -> String {
    run_guarded("clip_server_status", || {
        Ok(clip_server::get_daemon_status().to_string())
    })
    .unwrap_or_else(|e| format!("error: {e}"))
}

/// Apply a proxy configuration to the process env immediately, so the
/// next outbound HTTP request picks it up without needing the user to
/// restart the app. tauri-plugin-http builds a fresh
/// `reqwest::ClientBuilder` per fetch and reqwest's `auto_sys_proxy`
/// re-reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY each time, so updating
/// these env vars is sufficient to flip the proxy on/off live.
///
/// Returns the same human-readable summary `apply_proxy_env` produces
/// for logging.
#[tauri::command]
fn set_proxy_env(config: proxy::ProxyConfig) -> String {
    let summary = proxy::apply_proxy_env(&config);
    eprintln!("[proxy] live update: {summary}");
    summary
}

#[tauri::command]
fn get_sleep_recovery_status() -> SleepRecoveryStatus {
    current_sleep_recovery_status()
}

#[tauri::command]
fn mark_sleep_suspended() -> SleepRecoveryStatus {
    let status = SleepRecoveryStatus {
        state: SleepRecoveryState::Suspended,
        last_reason: "frontend tauri suspended event".to_string(),
        last_resume_epoch: None,
        last_gap_secs: None,
        relaunch_recommended: false,
        message: "System suspended; LLM Wiki will recover watchers after resume.".to_string(),
    };
    set_sleep_recovery_status(status.clone());
    status
}

#[tauri::command]
fn recover_from_sleep(reason: String, gap_secs: Option<u64>) -> SleepRecoveryStatus {
    recover_after_sleep(&reason, gap_secs)
}

#[tauri::command]
fn mark_sleep_recovery_healthy(reason: String) -> SleepRecoveryStatus {
    let healthy = SleepRecoveryStatus {
        state: SleepRecoveryState::Healthy,
        last_reason: reason,
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: current_sleep_recovery_status().last_gap_secs,
        relaunch_recommended: false,
        message: "LLM Wiki recovered after wake; watchers, import timers, and source tree were refreshed."
            .to_string(),
    };
    set_sleep_recovery_status(healthy.clone());
    healthy
}

#[tauri::command]
fn mark_sleep_recovery_degraded(reason: String) -> SleepRecoveryStatus {
    let auto_relaunch = std::env::var("LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP").is_ok();
    let degraded = SleepRecoveryStatus {
        state: if auto_relaunch {
            SleepRecoveryState::Relaunching
        } else {
            SleepRecoveryState::Degraded
        },
        last_reason: reason,
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: current_sleep_recovery_status().last_gap_secs,
        relaunch_recommended: true,
        message: if auto_relaunch {
            "LLM Wiki recovery after wake was incomplete; launching a replacement process."
                .to_string()
        } else {
            "LLM Wiki recovery after wake was incomplete; relaunch is recommended if watchers do not update."
                .to_string()
        },
    };
    set_sleep_recovery_status(degraded.clone());
    if auto_relaunch {
        relaunch_wiki_process();
    }
    degraded
}

#[tauri::command]
fn simulate_sleep_resume(gap_secs: Option<u64>) -> SleepRecoveryStatus {
    recover_after_sleep(
        "manual sleep/resume recovery simulation",
        gap_secs.or(Some(sleep_resume_gap_threshold_secs() + 1)),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_sleep_resume_guard();
    clip_server::start_clip_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Rust-backed fetch so third-party LLM APIs that reject
        // browser-origin headers via CORS preflight (MiniMax, Volcengine
        // Ark's api/coding/v3, etc.) still work. Requests leave the app
        // from Rust, never the webview.
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Let the PDF extractor find the bundled pdfium dynamic
            // library via Tauri's platform-correct resource path.
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                commands::fs::set_resource_dir_hint(dir);
            }
            // Apply user-configured global HTTP proxy by setting
            // HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars BEFORE
            // any HTTP request is made. tauri-plugin-http's reqwest
            // client reads these on first construction. Lives next
            // to the resource-dir hint so the proxy applies to
            // everything: LLM, embedding, update check, deep
            // research, captioning. See src-tauri/src/proxy.rs.
            if let Ok(dir) = app.path().app_data_dir() {
                let store_path = dir.join("app-state.json");
                eprintln!("[proxy] reading from {}", store_path.display());
                if let Some(cfg) = proxy::read_proxy_config_from_store(&store_path) {
                    let summary = proxy::apply_proxy_env(&cfg);
                    eprintln!("[proxy] {summary}");
                } else {
                    eprintln!("[proxy] no proxyConfig in store, requests go direct");
                }
            } else {
                eprintln!("[proxy] could not resolve app_data_dir");
            }
            // Registry of running `claude` subprocesses, keyed by the
            // frontend-generated stream id. Populated by claude_cli_spawn,
            // drained on process exit or by claude_cli_kill.
            app.manage(commands::claude_cli::ClaudeCliState::default());
            app.manage(commands::codex_cli::CodexCliState::default());
            app.manage(commands::file_sync::FileSyncState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::write_file_atomic,
            commands::fs::list_directory,
            commands::fs::copy_file,
            commands::fs::copy_directory,
            commands::fs::preprocess_file,
            commands::fs::delete_file,
            commands::fs::find_related_wiki_pages,
            commands::fs::create_directory,
            commands::fs::file_exists,
            commands::fs::get_file_modified_time,
            commands::fs::get_file_size,
            commands::fs::get_file_md5,
            commands::fs::read_file_as_base64,
            commands::project::create_project,
            commands::project::open_project,
            commands::project::open_project_folder,
            clip_server_status,
            commands::vectorstore::vector_upsert,
            commands::vectorstore::vector_search,
            commands::vectorstore::vector_delete,
            commands::vectorstore::vector_count,
            commands::vectorstore::vector_upsert_chunks,
            commands::vectorstore::vector_search_chunks,
            commands::vectorstore::vector_delete_page,
            commands::vectorstore::vector_count_chunks,
            commands::vectorstore::vector_legacy_row_count,
            commands::vectorstore::vector_drop_legacy,
            commands::claude_cli::claude_cli_detect,
            commands::claude_cli::claude_cli_spawn,
            commands::claude_cli::claude_cli_kill,
            commands::codex_cli::codex_cli_detect,
            commands::codex_cli::codex_cli_spawn,
            commands::codex_cli::codex_cli_kill,
            commands::extract_images::extract_pdf_images_cmd,
            commands::extract_images::extract_office_images_cmd,
            commands::extract_images::extract_and_save_pdf_images_cmd,
            commands::extract_images::extract_and_save_office_images_cmd,
            commands::file_sync::start_project_file_watcher,
            commands::file_sync::stop_project_file_watcher,
            commands::file_sync::rescan_project_files,
            commands::file_sync::get_file_change_queue,
            commands::file_sync::retry_file_change_task,
            commands::file_sync::ignore_file_change_task,
            set_proxy_env,
            get_sleep_recovery_status,
            mark_sleep_suspended,
            recover_from_sleep,
            mark_sleep_recovery_healthy,
            mark_sleep_recovery_degraded,
            simulate_sleep_resume,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::Manager;
                    api.prevent_close();
                    let win = window.clone();
                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri_plugin_dialog::DialogExt;
                        let confirmed = app
                            .dialog()
                            .message("Are you sure you want to quit LLM Wiki?")
                            .title("Confirm Exit")
                            .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                            .blocking_show();

                        if confirmed {
                            let _ = win.destroy();
                        }
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            let _ = (app, event); // suppress unused warnings on non-macOS
        });
}

fn start_sleep_resume_guard() {
    if std::env::var("LLM_WIKI_DISABLE_SLEEP_GUARD").is_ok() {
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
                    "LLM Wiki detected a long system sleep/resume gap ({gap}s); marking recovery needed."
                );
                let status = recover_after_sleep("backend wall-clock gap", Some(gap));
                eprintln!("LLM Wiki sleep/resume recovery: {}", status.message);
            }
        }
    });
}

fn sleep_resume_gap_threshold_secs() -> u64 {
    std::env::var("LLM_WIKI_SLEEP_GAP_SECS")
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
            relaunch_recommended: false,
            message: "LLM Wiki is running.".to_string(),
        })
    });
    status
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| SleepRecoveryStatus {
            state: SleepRecoveryState::Recovering,
            last_reason: "status lock poisoned".to_string(),
            last_resume_epoch: Some(now_epoch()),
            last_gap_secs: None,
            relaunch_recommended: true,
            message: "Sleep recovery status is unavailable; frontend should restart watchers."
                .to_string(),
        })
}

fn set_sleep_recovery_status(next: SleepRecoveryStatus) {
    let status = SLEEP_RECOVERY_STATUS.get_or_init(|| Mutex::new(next.clone()));
    if let Ok(mut guard) = status.lock() {
        *guard = next;
    }
}

fn recover_after_sleep(reason: &str, gap_secs: Option<u64>) -> SleepRecoveryStatus {
    set_sleep_recovery_status(SleepRecoveryStatus {
        state: SleepRecoveryState::Resumed,
        last_reason: reason.to_string(),
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: gap_secs,
        relaunch_recommended: false,
        message: "System resumed; preparing LLM Wiki recovery.".to_string(),
    });

    let recovering = SleepRecoveryStatus {
        state: SleepRecoveryState::Recovering,
        last_reason: reason.to_string(),
        last_resume_epoch: Some(now_epoch()),
        last_gap_secs: gap_secs,
        relaunch_recommended: false,
        message: "System resumed; frontend should restart watchers and rescan sources.".to_string(),
    };
    set_sleep_recovery_status(recovering);

    current_sleep_recovery_status()
}

fn relaunch_wiki_process() {
    let Ok(current_exe) = std::env::current_exe() else {
        eprintln!("LLM Wiki relaunch requested but current executable could not be resolved.");
        return;
    };
    match Command::new(current_exe).spawn() {
        Ok(_) => {
            eprintln!("LLM Wiki spawned a replacement process after failed sleep recovery.");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("LLM Wiki failed to spawn replacement process: {error}");
        }
    }
}

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock poisoned")
    }

    #[test]
    fn sleep_recovery_stays_recovering_until_frontend_marks_completion() {
        let _guard = test_lock();
        let status = recover_after_sleep("test resume", Some(601));

        assert_eq!(status.state, SleepRecoveryState::Recovering);
        assert_eq!(status.last_reason, "test resume");
        assert_eq!(status.last_gap_secs, Some(601));
        assert!(!status.relaunch_recommended);
    }

    #[test]
    fn sleep_recovery_frontend_suspended_event_marks_recovery_waiting_for_resume() {
        let _guard = test_lock();
        let status = mark_sleep_suspended();

        assert_eq!(status.state, SleepRecoveryState::Suspended);
        assert_eq!(status.last_reason, "frontend tauri suspended event");
        assert_eq!(status.last_resume_epoch, None);
        assert_eq!(status.last_gap_secs, None);
        assert!(!status.relaunch_recommended);
    }

    #[test]
    fn sleep_recovery_simulation_uses_debug_gap_when_not_supplied() {
        let _guard = test_lock();
        let status = simulate_sleep_resume(None);

        assert_eq!(status.state, SleepRecoveryState::Recovering);
        assert_eq!(status.last_reason, "manual sleep/resume recovery simulation");
        assert_eq!(
            status.last_gap_secs,
            Some(sleep_resume_gap_threshold_secs() + 1)
        );
        assert!(!status.relaunch_recommended);
    }

    #[test]
    fn sleep_recovery_frontend_can_mark_healthy() {
        let _guard = test_lock();
        let _ = recover_after_sleep("test resume before healthy", Some(602));
        let status = mark_sleep_recovery_healthy("frontend complete".to_string());

        assert_eq!(status.state, SleepRecoveryState::Healthy);
        assert_eq!(status.last_reason, "frontend complete");
        assert_eq!(status.last_gap_secs, Some(602));
        assert!(!status.relaunch_recommended);
    }

    #[test]
    fn sleep_recovery_degraded_recommends_relaunch_without_auto_relaunch() {
        let _guard = test_lock();
        let previous = std::env::var("LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP").ok();
        std::env::remove_var("LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP");

        let _ = recover_after_sleep("test resume before degraded", Some(603));
        let status = mark_sleep_recovery_degraded("frontend failed".to_string());

        if let Some(value) = previous {
            std::env::set_var("LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP", value);
        }

        assert_eq!(status.state, SleepRecoveryState::Degraded);
        assert_eq!(status.last_reason, "frontend failed");
        assert_eq!(status.last_gap_secs, Some(603));
        assert!(status.relaunch_recommended);
    }
}
