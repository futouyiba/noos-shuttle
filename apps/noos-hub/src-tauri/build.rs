use std::path::PathBuf;
use std::process::Command;

fn git_commit() -> Option<String> {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").ok()?);
    let repo_root = manifest_dir.parent()?.to_path_buf();
    let output = Command::new("git")
        .arg("rev-parse")
        .arg("HEAD")
        .current_dir(&repo_root)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=NOOS_HUB_BUILD_COMMIT");
    let commit = std::env::var("NOOS_HUB_BUILD_COMMIT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(git_commit)
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=NOOS_HUB_BUILD_COMMIT={commit}");
}
