use std::fs;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
pub struct SessionFile {
    pub session_id: String,
    pub project: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified: u64,
}

#[derive(serde::Serialize)]
pub struct ReadResult {
    pub content: String,
    pub path: String,
}

#[tauri::command]
fn list_sessions() -> Result<Vec<SessionFile>, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();

    // 1. Claude Sessions
    let claude_projects_dir = home.join(".claude").join("projects");
    if claude_projects_dir.exists() {
        scan_dir_for_sessions(&claude_projects_dir, "claude", &mut sessions, false);
    }

    // 2. Gemini/OMC Sessions (~/.gemini/tmp)
    let gemini_tmp_dir = home.join(".gemini").join("tmp");
    if gemini_tmp_dir.exists() {
        if let Ok(entries) = fs::read_dir(&gemini_tmp_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let project_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("gemini");
                    scan_dir_for_sessions(&path, project_name, &mut sessions, true);
                }
            }
        }
    }

    // 3. Global OMC Sessions (~/.omc/state/sessions)
    let omc_sessions_dir = home.join(".omc").join("state").join("sessions");
    if omc_sessions_dir.exists() {
        scan_dir_for_sessions(&omc_sessions_dir, "omc-global", &mut sessions, true);
    }

    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
    // Remove duplicates by path
    sessions.dedup_by(|a, b| a.path == b.path);
    
    Ok(sessions)
}

fn scan_dir_for_sessions(dir: &Path, project_name: &str, sessions: &mut Vec<SessionFile>, recursive: bool) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && recursive {
                scan_dir_for_sessions(&path, project_name, sessions, true);
            } else if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str());
                if ext == Some("jsonl") || ext == Some("json") {
                    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if is_ignored_file(filename) { continue; }

                    if let Some(s) = get_session_file(&path, project_name) {
                        sessions.push(s);
                    }
                }
            }
        }
    }
}

fn is_ignored_file(name: &str) -> bool {
    let ignored = ["logs.json", "projects.json", "settings.json", "state.json", "hud-state.json", "oauth_creds.json"];
    ignored.contains(&name)
}

fn get_session_file(path: &PathBuf, project_name: &str) -> Option<SessionFile> {
    let metadata = fs::metadata(path).ok()?;
    // Only include files that have some content (min 50 bytes to skip empty/header only)
    if metadata.len() < 50 { return None; }

    let modified = metadata.modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs()).unwrap_or(0);
    
    let session_id = path.file_stem()
        .and_then(|s| s.to_str()).unwrap_or("unknown").to_string();

    Some(SessionFile {
        session_id,
        project: project_name.to_string(),
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified,
    })
}

#[tauri::command]
fn read_session(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }

    let content = fs::read_to_string(&p)
        .map_err(|e| format!("Cannot read {}: {}", path, e))?;

    Ok(ReadResult { content, path })
}

#[tauri::command]
fn read_claude_md() -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let claude_md = home.join(".claude").join("CLAUDE.md");
    if !claude_md.exists() { return Ok(String::new()); }
    fs::read_to_string(&claude_md).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_gemini_md() -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    // Priority 1: ~/.gemini/GEMINI.md
    let g1 = home.join(".gemini").join("GEMINI.md");
    if g1.exists() { return fs::read_to_string(&g1).map_err(|e| e.to_string()); }
    
    // Priority 2: ~/.config/gemini-cli/GEMINI.md
    let g2 = home.join(".config").join("gemini-cli").join("GEMINI.md");
    if g2.exists() { return fs::read_to_string(&g2).map_err(|e| e.to_string()); }

    Ok(String::new())
}

#[tauri::command]
fn write_config_md(provider: String, content: String, backup_dir: String) -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let config_path = match provider.to_lowercase().as_str() {
        "claude" => home.join(".claude").join("CLAUDE.md"),
        "gemini" => {
            let p1 = home.join(".gemini").join("GEMINI.md");
            if p1.exists() || !home.join(".config").join("gemini-cli").join("GEMINI.md").exists() {
                p1
            } else {
                home.join(".config").join("gemini-cli").join("GEMINI.md")
            }
        },
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let filename = config_path.file_name().and_then(|n| n.to_str()).unwrap_or("CONFIG.md");
    let original = if config_path.exists() {
        fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    let backup_path_dir = PathBuf::from(&backup_dir);
    fs::create_dir_all(&backup_path_dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let backup_path = backup_path_dir.join(format!("{}-{}.bak", filename, ts));

    fs::write(&backup_path, &original).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
fn restore_backup(backup_path: String, provider: String) -> Result<(), String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let config_path = match provider.to_lowercase().as_str() {
        "claude" => home.join(".claude").join("CLAUDE.md"),
        "gemini" => {
            let p1 = home.join(".gemini").join("GEMINI.md");
            if p1.exists() || !home.join(".config").join("gemini-cli").join("GEMINI.md").exists() {
                p1
            } else {
                home.join(".config").join("gemini-cli").join("GEMINI.md")
            }
        },
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };
    
    let backup = PathBuf::from(&backup_path);
    if !backup.exists() { return Err("Backup not found".into()); }

    let content = fs::read_to_string(&backup).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

fn dirs_next() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "Cannot determine home directory".to_string())
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs_next().map(|p| p.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            read_session,
            read_claude_md,
            read_gemini_md,
            write_config_md,
            restore_backup,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
