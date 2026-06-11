use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

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
                    let project_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("gemini");
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

    // 4. Codex Sessions (~/.codex/sessions/YYYY/MM/DD/*.jsonl)
    let codex_sessions_dir = home.join(".codex").join("sessions");
    if codex_sessions_dir.exists() {
        scan_dir_for_sessions(&codex_sessions_dir, "codex", &mut sessions, true);
    }

    // 5. Cursor chat stores (~/.cursor/chats/<workspace>/<agent>/store.db)
    let cursor_chats_dir = home.join(".cursor").join("chats");
    if cursor_chats_dir.exists() {
        scan_cursor_chat_stores(&cursor_chats_dir, &mut sessions);
    }

    // 6. TokenScope dogfood fixtures (repo-local, visible in the app for demos)
    if let Ok(cwd) = std::env::current_dir() {
        let dogfood_candidates = [
            cwd.join("dogfood").join("sessions"),
            cwd.join("..").join("dogfood").join("sessions"),
        ];
        for dogfood_sessions_dir in dogfood_candidates {
            if dogfood_sessions_dir.exists() {
                scan_dir_for_sessions(
                    &dogfood_sessions_dir,
                    "tokenscope-dogfood",
                    &mut sessions,
                    true,
                );
            }
        }
    }

    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
    // Remove duplicates by path
    sessions.dedup_by(|a, b| a.path == b.path);

    Ok(sessions)
}

fn scan_dir_for_sessions(
    dir: &Path,
    project_name: &str,
    sessions: &mut Vec<SessionFile>,
    recursive: bool,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && recursive {
                scan_dir_for_sessions(&path, project_name, sessions, true);
            } else if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str());
                if ext == Some("jsonl") || ext == Some("json") {
                    let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if is_ignored_file(filename) {
                        continue;
                    }
                    if project_name == "codex" && !codex_has_visible_user_turn(&path) {
                        continue;
                    }

                    if let Some(s) = get_session_file(&path, project_name) {
                        sessions.push(s);
                    }
                }
            }
        }
    }
}

fn is_ignored_file(name: &str) -> bool {
    let ignored = [
        "logs.json",
        "projects.json",
        "settings.json",
        "state.json",
        "hud-state.json",
        "oauth_creds.json",
    ];
    ignored.contains(&name)
}

fn get_session_file(path: &PathBuf, project_name: &str) -> Option<SessionFile> {
    let metadata = fs::metadata(path).ok()?;
    // Only include files that have some content (min 50 bytes to skip empty/header only)
    if metadata.len() < 50 {
        return None;
    }

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let project = if session_id.contains("dogfood-bad") {
        "dogfood-bad".to_string()
    } else if session_id.contains("dogfood-good") {
        "dogfood-good".to_string()
    } else if session_id.contains("dogfood") {
        "tokenscope-dogfood".to_string()
    } else if project_name == "codex" {
        infer_codex_project(path).unwrap_or_else(|| project_name.to_string())
    } else {
        project_name.to_string()
    };

    Some(SessionFile {
        session_id,
        project,
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified,
    })
}

fn scan_cursor_chat_stores(dir: &Path, sessions: &mut Vec<SessionFile>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_cursor_chat_stores(&path, sessions);
            } else if path.file_name().and_then(|n| n.to_str()) == Some("store.db") {
                if let Some(s) = get_cursor_session_file(&path) {
                    sessions.push(s);
                }
            }
        }
    }
}

fn get_cursor_session_file(path: &PathBuf) -> Option<SessionFile> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() < 50 {
        return None;
    }

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let agent_id = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("cursor")
        .to_string();
    let workspace_id = path
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("cursor");
    let project = cursor_project_name(workspace_id);

    Some(SessionFile {
        session_id: agent_id,
        project,
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified,
    })
}

fn cursor_project_name(workspace_id: &str) -> String {
    let home = match dirs_next() {
        Ok(home) => home,
        Err(_) => return "cursor".to_string(),
    };
    let workspace_json = home
        .join(".cursor")
        .join("chats")
        .join(workspace_id)
        .join("workspace.json");

    let Ok(content) = fs::read_to_string(workspace_json) else {
        return "cursor".to_string();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return "cursor".to_string();
    };

    value["folder"]
        .as_str()
        .or_else(|| value["workspace"]["folder"].as_str())
        .or_else(|| value["uri"].as_str())
        .and_then(|folder| {
            let trimmed = folder.strip_prefix("file://").unwrap_or(folder);
            Path::new(trimmed).file_name().and_then(|n| n.to_str())
        })
        .unwrap_or("cursor")
        .to_string()
}

fn codex_has_visible_user_turn(path: &PathBuf) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    content.lines().any(|line| {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            return false;
        };
        let payload = &value["payload"];
        if value["type"] != "response_item"
            || payload["type"] != "message"
            || payload["role"] != "user"
        {
            return false;
        }
        let Some(items) = payload["content"].as_array() else {
            return false;
        };
        items.iter().any(|item| {
            let text = item["text"].as_str().unwrap_or("").trim();
            !text.is_empty()
                && !text.starts_with("<user_shell_command>")
                && !text.starts_with("<environment_context>")
                && !text.starts_with("<permissions instructions>")
                && !text.starts_with("<skills_instructions>")
                && !text.starts_with("Continue working toward the active thread goal.")
        })
    })
}

fn infer_codex_project(path: &PathBuf) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let first = content.lines().next()?;
    let value = serde_json::from_str::<serde_json::Value>(first).ok()?;
    let cwd = value["payload"]["cwd"].as_str()?;
    Path::new(cwd)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

#[tauri::command]
fn read_session(path: String) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }

    if is_cursor_store_db(&p) {
        let content = read_cursor_store_as_jsonl(&p)?;
        return Ok(ReadResult { content, path });
    }

    let content = fs::read_to_string(&p).map_err(|e| format!("Cannot read {}: {}", path, e))?;

    Ok(ReadResult { content, path })
}

fn is_cursor_store_db(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()) == Some("store.db")
        && path.to_string_lossy().contains("/.cursor/chats/")
}

fn read_cursor_store_as_jsonl(path: &Path) -> Result<String, String> {
    let mut lines = Vec::new();

    if let Ok(meta) = read_cursor_meta(path) {
        lines.push(
            serde_json::json!({
                "type": "cursor_meta",
                "payload": meta,
            })
            .to_string(),
        );
    }

    let batch_size = 10;
    let mut offset = 0;

    loop {
        let sql = format!(
            "select id, hex(data) from blobs limit {} offset {}",
            batch_size, offset
        );
        let stdout = run_sqlite_query(path, &sql)?;
        let mut batch_count = 0;
        for row in stdout.lines() {
            if row.trim().is_empty() {
                continue;
            }
            batch_count += 1;

            let Some((id, hex)) = row.split_once('|') else {
                continue;
            };
            let Ok(bytes) = decode_hex(hex.trim()) else {
                continue;
            };
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };
            let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) else {
                continue;
            };
            if !payload.get("role").is_some() {
                continue;
            }

            lines.push(
                serde_json::json!({
                    "type": "cursor_message",
                    "id": id,
                    "payload": payload,
                })
                .to_string(),
            );
        }

        if batch_count == 0 {
            break;
        }
        if batch_count < batch_size {
            break;
        }
        offset += batch_size;
    }

    if lines.len() <= 1 {
        return Err("Cursor store did not contain readable message blobs".to_string());
    }

    Ok(lines.join("\n"))
}

fn read_cursor_meta(path: &Path) -> Result<serde_json::Value, String> {
    let raw = run_sqlite_query(path, "select value from meta where key = '0' limit 1")?
        .trim()
        .to_string();
    if raw.is_empty() {
        return Err("Cursor metadata missing".to_string());
    }

    let decoded = if raw.chars().all(|c| c.is_ascii_hexdigit()) {
        decode_hex(&raw)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or(raw)
    } else {
        raw
    };

    serde_json::from_str::<serde_json::Value>(&decoded).map_err(|e| e.to_string())
}

fn run_sqlite_query(path: &Path, sql: &str) -> Result<String, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("tokenscope-sqlite-{stamp}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let outfile = dir.join("out.txt");

    let command = format!(
        "sqlite3 -readonly {} {} > {}",
        shell_quote(&path.to_string_lossy()),
        shell_quote(sql),
        shell_quote(&outfile.to_string_lossy())
    );

    let status = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .status()
        .map_err(|e| format!("Failed to run sqlite3 for Cursor store: {}", e))?;

    let result = if status.success() {
        fs::read_to_string(&outfile).map_err(|e| e.to_string())
    } else {
        Err("sqlite3 failed for Cursor store".to_string())
    };

    let _ = fs::remove_dir_all(&dir);
    result
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn decode_hex(hex: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err("odd-length hex string".to_string());
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let chars: Vec<char> = hex.chars().collect();
    for i in (0..chars.len()).step_by(2) {
        let high = chars[i]
            .to_digit(16)
            .ok_or_else(|| "invalid hex".to_string())?;
        let low = chars[i + 1]
            .to_digit(16)
            .ok_or_else(|| "invalid hex".to_string())?;
        bytes.push(((high << 4) | low) as u8);
    }
    Ok(bytes)
}

#[tauri::command]
fn read_claude_md() -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let claude_md = home.join(".claude").join("CLAUDE.md");
    if !claude_md.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&claude_md).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_gemini_md() -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    // Priority 1: ~/.gemini/GEMINI.md
    let g1 = home.join(".gemini").join("GEMINI.md");
    if g1.exists() {
        return fs::read_to_string(&g1).map_err(|e| e.to_string());
    }

    // Priority 2: ~/.config/gemini-cli/GEMINI.md
    let g2 = home.join(".config").join("gemini-cli").join("GEMINI.md");
    if g2.exists() {
        return fs::read_to_string(&g2).map_err(|e| e.to_string());
    }

    Ok(String::new())
}

#[tauri::command]
fn read_codex_md() -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let codex_md = home.join(".codex").join("AGENTS.md");
    if !codex_md.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&codex_md).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_config_md(
    provider: String,
    content: String,
    backup_dir: String,
) -> Result<String, String> {
    let home = dirs_next().map_err(|e| e.to_string())?;
    let config_path = match provider.to_lowercase().as_str() {
        "claude" => home.join(".claude").join("CLAUDE.md"),
        "gemini" => {
            let p1 = home.join(".gemini").join("GEMINI.md");
            if p1.exists()
                || !home
                    .join(".config")
                    .join("gemini-cli")
                    .join("GEMINI.md")
                    .exists()
            {
                p1
            } else {
                home.join(".config").join("gemini-cli").join("GEMINI.md")
            }
        }
        "codex" => home.join(".codex").join("AGENTS.md"),
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let filename = config_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("CONFIG.md");
    let original = if config_path.exists() {
        fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    let backup_path_dir = PathBuf::from(&backup_dir);
    fs::create_dir_all(&backup_path_dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
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
            if p1.exists()
                || !home
                    .join(".config")
                    .join("gemini-cli")
                    .join("GEMINI.md")
                    .exists()
            {
                p1
            } else {
                home.join(".config").join("gemini-cli").join("GEMINI.md")
            }
        }
        "codex" => home.join(".codex").join("AGENTS.md"),
        _ => return Err(format!("Unsupported provider: {}", provider)),
    };

    let backup = PathBuf::from(&backup_path);
    if !backup.exists() {
        return Err("Backup not found".into());
    }

    let content = fs::read_to_string(&backup).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

fn dirs_next() -> Result<PathBuf, String> {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map_err(|_| "Cannot determine home directory".to_string())
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
            read_codex_md,
            write_config_md,
            restore_backup,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
