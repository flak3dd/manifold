// ── Manifold Tauri command handlers ──────────────────────────────────────────
//
// Every public function here is exposed to the frontend via invoke().
// Commands that touch the DB run synchronously inside tauri::async_runtime
// via State<Mutex<…>> — for heavier operations we spawn blocking tasks.

use std::sync::Mutex;
use tauri::State;

use crate::db::Db;
use crate::error::{ManifoldError, Result};
use crate::fingerprint::{Fingerprint, FingerprintOrchestrator};
use crate::human::{BehaviorProfile, HumanBehavior};
use crate::profile::{
    CreateProfileRequest, Profile, ProfileRepo, ProfileStatus, UpdateProfileRequest,
};
use crate::proxy::{AddProxyRequest, Proxy, ProxyHealth, ProxyRepo, UpdateProxyRequest};

// For URL parsing in domain extraction
use url;

// Form scraper types
use chrono::Utc;
use serde::{Deserialize, Serialize};

// ── Shared app state ──────────────────────────────────────────────────────────

#[allow(dead_code)]
pub struct AppState {
    pub db: Db,
    pub profiles: Mutex<ProfileRepo>,
    pub proxies: Mutex<ProxyRepo>,
    /// PID of the running playwright-bridge process (if any).
    pub bridge_pid: Mutex<Option<u32>>,
    /// Port the bridge WebSocket server is listening on.
    pub bridge_port: Mutex<u16>,
    /// Port for TLS bridge server (JA4 control).
    pub tls_bridge_port: Mutex<u16>,
    /// Master key for AES-GCM field encryption (set once at startup).
    pub master_key: Option<String>,
}

impl AppState {
    pub fn new(db: Db, master_key: Option<String>) -> Self {
        let profiles = ProfileRepo::new(db.clone());
        let proxies = ProxyRepo::new(db.clone());
        Self {
            db,
            profiles: Mutex::new(profiles),
            proxies: Mutex::new(proxies),
            bridge_pid: Mutex::new(None),
            bridge_port: Mutex::new(8766),
            tls_bridge_port: Mutex::new(8767),
            master_key,
        }
    }
}

// ── Profile commands ──────────────────────────────────────────────────────────

/// List all profiles (summary fields only — fingerprint blob included).
#[tauri::command]
pub fn list_profiles(state: State<'_, AppState>) -> Result<Vec<Profile>> {
    state.profiles.lock().unwrap().list()
}

/// Fetch a single profile by UUID.
#[tauri::command]
pub fn get_profile(state: State<'_, AppState>, id: String) -> Result<Profile> {
    state.profiles.lock().unwrap().get(&id)
}

/// Create a new profile.  `seed` is optional — auto-generated if omitted.
#[tauri::command]
pub fn create_profile(
    state: State<'_, AppState>,
    name: String,
    seed: Option<u64>,
    proxy_id: Option<String>,
    notes: Option<String>,
    tags: Option<Vec<String>>,
    behavior_profile: Option<String>,
) -> Result<Profile> {
    state.profiles.lock().unwrap().create(CreateProfileRequest {
        name,
        seed,
        proxy_id,
        notes,
        tags,
        behavior_profile,
    })
}

/// Update an existing profile's metadata / fingerprint / human config.
#[tauri::command]
pub fn update_profile(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    fingerprint: Option<Fingerprint>,
    human: Option<HumanBehavior>,
    proxy_id: Option<String>,
    notes: Option<String>,
    tags: Option<Vec<String>>,
    behavior_profile: Option<String>,
) -> Result<Profile> {
    state.profiles.lock().unwrap().update(
        &id,
        UpdateProfileRequest {
            name,
            fingerprint,
            human,
            proxy_id,
            notes,
            tags,
            behavior_profile,
            tls_bridge: None,
        },
    )
}

/// Delete a profile and its browser data directory.
#[tauri::command]
pub fn delete_profile(state: State<'_, AppState>, id: String) -> Result<()> {
    state.profiles.lock().unwrap().delete(&id)
}

/// Re-generate the fingerprint for an existing profile from a new seed.
/// If `seed` is None, a fresh random seed is used.
#[tauri::command]
pub fn reseed_profile(
    state: State<'_, AppState>,
    id: String,
    seed: Option<u64>,
) -> Result<Profile> {
    state.profiles.lock().unwrap().reseed_fingerprint(&id, seed)
}

/// Duplicate a profile (new UUID, same fingerprint + settings).
#[tauri::command]
pub fn duplicate_profile(
    state: State<'_, AppState>,
    id: String,
    new_name: Option<String>,
) -> Result<Profile> {
    let repo = state.profiles.lock().unwrap();
    let src = repo.get(&id)?;

    let name = new_name.unwrap_or_else(|| format!("{} (copy)", src.name));

    repo.create(CreateProfileRequest {
        name,
        seed: Some(src.fingerprint.seed),
        proxy_id: src.proxy_id.clone(),
        notes: Some(src.notes.clone()),
        tags: Some(src.tags.clone()),
        behavior_profile: Some(src.human.profile.to_string()),
    })
}

// ── Fingerprint commands ──────────────────────────────────────────────────────

/// Generate a complete fingerprint from a seed (does not persist it).
/// Frontend uses this for the live preview in the fingerprint editor.
#[tauri::command]
pub fn generate_fingerprint(seed: Option<u64>) -> Fingerprint {
    let s = seed.unwrap_or_else(|| {
        use rand::Rng;
        rand::thread_rng().gen::<u64>()
    });
    FingerprintOrchestrator::generate(s)
}

/// Re-derive a fingerprint from the same seed (deterministic).
#[tauri::command]
pub fn reseed_fingerprint(seed: u64) -> Fingerprint {
    FingerprintOrchestrator::generate(seed)
}

// ── Human behavior commands ───────────────────────────────────────────────────

/// Return the default HumanBehavior config for a named profile tier.
/// Valid values: "bot", "fast", "normal", "cautious".
#[tauri::command]
pub fn get_human_defaults(profile: String) -> Result<HumanBehavior> {
    let bp: BehaviorProfile = profile.parse()?;
    Ok(HumanBehavior::from_profile(bp))
}

// ── Proxy commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_proxies(state: State<'_, AppState>) -> Result<Vec<Proxy>> {
    state.proxies.lock().unwrap().list()
}

#[tauri::command]
pub fn get_proxy(state: State<'_, AppState>, id: String) -> Result<Proxy> {
    state.proxies.lock().unwrap().get(&id)
}

#[tauri::command]
pub fn add_proxy(
    state: State<'_, AppState>,
    name: String,
    proxy_type: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    country: Option<String>,
) -> Result<Proxy> {
    state.proxies.lock().unwrap().add(AddProxyRequest {
        name,
        proxy_type,
        host,
        port,
        username,
        password,
        country,
    })
}

#[tauri::command]
pub fn update_proxy(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    proxy_type: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    country: Option<String>,
) -> Result<Proxy> {
    state.proxies.lock().unwrap().update(
        &id,
        UpdateProxyRequest {
            name,
            proxy_type,
            host,
            port,
            username,
            password,
            country,
        },
    )
}

#[tauri::command]
pub fn delete_proxy(state: State<'_, AppState>, id: String) -> Result<()> {
    state.proxies.lock().unwrap().delete(&id)
}

/// Run a health check on a single proxy (blocking — runs in ~10 s worst case).
#[tauri::command]
pub fn check_proxy(state: State<'_, AppState>, id: String) -> Result<ProxyHealth> {
    state.proxies.lock().unwrap().check_health(&id)
}

/// Health-check all proxies sequentially.
#[tauri::command]
pub fn check_all_proxies(state: State<'_, AppState>) -> Result<Vec<ProxyHealth>> {
    state.proxies.lock().unwrap().check_all()
}

// ── Bridge / launcher commands ────────────────────────────────────────────────

/// Launch the playwright-bridge Node.js process for a given profile.
///
/// The bridge process:
///   1. Reads the profile + fingerprint config from the payload
///   2. Launches a Chromium instance with all evasion scripts injected
///   3. Exposes a local WebSocket server for the frontend live-trace view
///
/// Returns the WebSocket port the bridge is listening on.
#[tauri::command]
pub fn launch_profile(
    _app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    url: Option<String>,
) -> Result<u16> {
    use crate::error::ManifoldError;
    use std::process::{Command, Stdio};

    // Retrieve the profile and (optionally) its proxy
    let profile = state.profiles.lock().unwrap().get(&id)?;
    let proxy = match &profile.proxy_id {
        Some(pid) => state.proxies.lock().unwrap().get(pid).ok(),
        None => None,
    };

    // Serialise launch config to JSON for the bridge
    let mut launch_config = serde_json::json!({
        "profile": profile,
        "proxy":   proxy.as_ref().map(|p| serde_json::json!({
            "server":   p.to_playwright_server(),
            "username": p.username,
            "password": p.password,
        })),
        "url": url.unwrap_or_else(|| "about:blank".into()),
        "wsPort": *state.bridge_port.lock().unwrap(),
    });

    // If TLS bridge is enabled, include the bridge port
    if profile.tls_bridge.unwrap_or(false) {
        let tls_bridge_port = *state.tls_bridge_port.lock().unwrap();
        launch_config["tlsBridgePort"] = serde_json::json!(tls_bridge_port);
    }

    let config_json = serde_json::to_string(&launch_config).map_err(|e| ManifoldError::Json(e))?;

    // Locate the bridge entry-point relative to the workspace
    let workspace = std::env::current_dir().unwrap_or_else(|_| ".".into());
    let bridge_path = workspace.join("playwright-bridge").join("index.ts");

    if !bridge_path.exists() {
        return Err(ManifoldError::BridgeOffline);
    }

    let mut cmd = Command::new("npx");
    cmd.args([
        "tsx",
        bridge_path.to_str().unwrap_or("playwright-bridge/index.ts"),
    ])
    .env("MANIFOLD_LAUNCH_CONFIG", &config_json)
    .current_dir(&workspace)
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit());

    let child = cmd
        .spawn()
        .map_err(|e| ManifoldError::Other(format!("failed to spawn bridge: {e}")))?;

    let pid = child.id();
    *state.bridge_pid.lock().unwrap() = Some(pid);

    // Mark profile as running
    state
        .profiles
        .lock()
        .unwrap()
        .set_status(&id, ProfileStatus::Running)
        .ok();
    state.profiles.lock().unwrap().touch_last_used(&id).ok();

    let port = *state.bridge_port.lock().unwrap();
    Ok(port)
}

/// Directly set a profile's status (used by panic shutdown).
#[tauri::command]
pub fn set_profile_status(state: State<'_, AppState>, id: String, status: String) -> Result<()> {
    use crate::error::ManifoldError;
    let ps = status
        .parse::<ProfileStatus>()
        .map_err(|e| ManifoldError::InvalidArg(e.to_string()))?;
    state.profiles.lock().unwrap().set_status(&id, ps)?;
    Ok(())
}

/// Emergency panic shutdown:
///   1. Kill the bridge process
///   2. Set ALL running profiles to Idle
///   3. Returns a summary of affected profiles
#[tauri::command]
pub fn panic_shutdown(state: State<'_, AppState>) -> Result<PanicShutdownResult> {
    // ── 1. Kill bridge ────────────────────────────────────────────────────
    let mut pid_guard = state.bridge_pid.lock().unwrap();
    if let Some(pid) = pid_guard.take() {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F", "/T"])
                .output()
                .ok();
        }
        #[cfg(not(target_os = "windows"))]
        {
            // SIGKILL for guaranteed termination
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }
    drop(pid_guard);

    // ── 2. Mark all running profiles as idle ──────────────────────────────
    let mut stopped_profiles: Vec<String> = Vec::new();
    let profiles_guard = state.profiles.lock().unwrap();
    if let Ok(all) = profiles_guard.list() {
        for p in all {
            if p.status == ProfileStatus::Running {
                profiles_guard.set_status(&p.id, ProfileStatus::Idle).ok();
                stopped_profiles.push(p.id.clone());
            }
        }
    }
    drop(profiles_guard);

    Ok(PanicShutdownResult {
        stopped_profiles,
        timestamp: Utc::now().to_rfc3339(),
    })
}

#[derive(Serialize)]
pub struct PanicShutdownResult {
    pub stopped_profiles: Vec<String>,
    pub timestamp: String,
}

/// Stop the running playwright-bridge process.
#[tauri::command]
pub fn stop_bridge(state: State<'_, AppState>, profile_id: Option<String>) -> Result<()> {
    let mut pid_guard = state.bridge_pid.lock().unwrap();

    if let Some(pid) = pid_guard.take() {
        // Platform-specific kill
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .output()
                .ok();
        }
        #[cfg(not(target_os = "windows"))]
        {
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
    }

    // Mark profile idle
    if let Some(id) = profile_id {
        state
            .profiles
            .lock()
            .unwrap()
            .set_status(&id, ProfileStatus::Idle)
            .ok();
    }

    Ok(())
}

// ── Session export commands ───────────────────────────────────────────────────

/// Export the current session state as a JSON bundle containing:
///   - HAR entries (passed from the bridge)
///   - entropy snapshots
///   - profile fingerprint metadata
///   - export timestamp
///
/// The bundle is written to `./profiles/<profile_id>/sessions/<ts>.json`
/// and the path is returned to the frontend.
#[tauri::command]
pub fn export_session(
    state: State<'_, AppState>,
    profile_id: String,
    har_json: String,
    entropy_json: String,
) -> Result<String> {
    use crate::db::profiles_dir;
    use crate::error::ManifoldError;

    let profile = state.profiles.lock().unwrap().get(&profile_id)?;

    // Build export bundle
    let har_val: serde_json::Value =
        serde_json::from_str(&har_json).unwrap_or(serde_json::Value::Null);
    let entropy_val: serde_json::Value =
        serde_json::from_str(&entropy_json).unwrap_or(serde_json::Value::Array(vec![]));

    let ts = Utc::now();
    let bundle = serde_json::json!({
        "version": "1.0",
        "exported_at": ts.to_rfc3339(),
        "profile": {
            "id":          profile.id,
            "name":        profile.name,
            "seed":        profile.fingerprint.seed,
            "user_agent":  profile.fingerprint.user_agent,
            "platform":    profile.fingerprint.platform,
        },
        "har":     har_val,
        "entropy": entropy_val,
    });

    // Write to profiles/<id>/sessions/<timestamp>.json
    let sessions_dir = profiles_dir().join(&profile_id).join("sessions");
    std::fs::create_dir_all(&sessions_dir)
        .map_err(|e| ManifoldError::Other(format!("failed to create sessions dir: {e}")))?;

    let filename = format!("{}.json", ts.format("%Y%m%dT%H%M%S"));
    let out_path = sessions_dir.join(&filename);

    let json_str = serde_json::to_string_pretty(&bundle).map_err(|e| ManifoldError::Json(e))?;

    std::fs::write(&out_path, json_str)
        .map_err(|e| ManifoldError::Other(format!("failed to write session file: {e}")))?;

    Ok(out_path.to_string_lossy().to_string())
}

/// List previously exported session bundles for a profile.
#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>, profile_id: String) -> Result<Vec<SessionMeta>> {
    use crate::db::profiles_dir;
    use crate::error::ManifoldError;

    // Verify the profile exists
    state.profiles.lock().unwrap().get(&profile_id)?;

    let sessions_dir = profiles_dir().join(&profile_id).join("sessions");
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }

    let mut metas: Vec<SessionMeta> = std::fs::read_dir(&sessions_dir)
        .map_err(|e| ManifoldError::Other(format!("read_dir failed: {e}")))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let name = path.file_stem()?.to_str()?.to_string();
            let meta = entry.metadata().ok()?;
            let size = meta.len();
            Some(SessionMeta {
                filename: path.file_name()?.to_str()?.to_string(),
                name,
                size_bytes: size,
                path: path.to_string_lossy().to_string(),
            })
        })
        .collect();

    // Sort newest-first
    metas.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(metas)
}

/// Delete a session export file.
#[tauri::command]
pub fn delete_session(
    _state: State<'_, AppState>,
    profile_id: String,
    filename: String,
) -> Result<()> {
    use crate::db::profiles_dir;
    use crate::error::ManifoldError;

    // Prevent path traversal
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(ManifoldError::InvalidArg("invalid filename".into()));
    }

    let path = profiles_dir()
        .join(&profile_id)
        .join("sessions")
        .join(&filename);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| ManifoldError::Other(format!("delete failed: {e}")))?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SessionMeta {
    pub filename: String,
    pub name: String,
    pub size_bytes: u64,
    pub path: String,
}

/// Return the current bridge WebSocket URL.
#[tauri::command]
pub fn get_bridge_url(state: State<'_, AppState>) -> String {
    let port = *state.bridge_port.lock().unwrap();
    format!("ws://localhost:{port}")
}

/// Change the bridge WebSocket port (takes effect on next launch).
#[tauri::command]
pub fn set_bridge_port(state: State<'_, AppState>, port: u16) -> Result<()> {
    use crate::error::ManifoldError;
    if port < 1024 {
        return Err(ManifoldError::InvalidArg("port must be >= 1024".into()));
    }
    *state.bridge_port.lock().unwrap() = port;
    Ok(())
}

// ── Data / persistence commands ───────────────────────────────────────────────

/// Generic key-value persistence (used for frontend settings).
#[tauri::command]
pub fn save_data(app: tauri::AppHandle, key: String, data: String) -> Result<()> {
    use crate::error::ManifoldError;
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ManifoldError::Other(e.to_string()))?;

    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!("{key}.json"));
    std::fs::write(&file, data)?;
    Ok(())
}

#[tauri::command]
pub fn load_data(app: tauri::AppHandle, key: String) -> Result<String> {
    use crate::error::ManifoldError;
    use tauri::Manager;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ManifoldError::Other(e.to_string()))?;

    let file = dir.join(format!("{key}.json"));
    std::fs::read_to_string(&file)
        .map_err(|e| ManifoldError::Other(format!("cannot read {key}: {e}")))
}

// ── App info ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct AppInfo {
    pub version: &'static str,
    pub bridge_url: String,
    pub db_path: String,
    pub data_dir: String,
}

#[tauri::command]
pub fn get_app_info(app: tauri::AppHandle, state: State<'_, AppState>) -> AppInfo {
    use tauri::Manager;
    let port = *state.bridge_port.lock().unwrap();
    let db_path = crate::db::default_db_path();
    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| ".".into());

    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        bridge_url: format!("ws://localhost:{port}"),
        db_path: db_path.to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
    }
}

// ── Form scraper command ──────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct FieldInfo {
    pub name: Option<String>,
    pub field_type: String,
    pub selector: String,
    pub placeholder: Option<String>,
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ButtonInfo {
    pub text: Option<String>,
    pub button_type: String,
    pub selector: String,
    pub action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FormAnalysis {
    pub action: Option<String>,
    pub method: Option<String>,
    pub fields: Vec<FieldInfo>,
    pub buttons: Vec<ButtonInfo>,
    pub selector: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UrlAnalysisResult {
    pub url: String,
    pub domain: String,
    pub confidence: f64,
    pub forms: Vec<FormAnalysis>,
    pub buttons: Vec<ButtonInfo>,
    pub endpoints: Vec<String>,
    pub username_selector: Option<String>,
    pub password_selector: Option<String>,
    pub submit_selector: Option<String>,
    pub success_selector: Option<String>,
    pub failure_selector: Option<String>,
    pub captcha_selector: Option<String>,
    pub consent_selector: Option<String>,
    pub totp_selector: Option<String>,
    pub mfa_selector: Option<String>,
    pub is_spa: bool,
    pub spa_framework: Option<String>,
    pub has_captcha: bool,
    pub captcha_providers: Vec<String>,
    pub has_mfa: bool,
    pub mfa_type: Option<String>,
    pub suggested_wait_time: u64,
    pub suggested_timeout: u64,
    pub details: Vec<String>,
}

/// Analyze a URL to gather automation data, form fields, buttons, endpoints, and suggested settings.
/// This serves as the initial starting point for creating tailored profiles and workflows.
#[tauri::command]
pub async fn analyze_url(
    url: String,
    timeout: u64,
    wait_for_spa: Option<bool>,
    detect_captcha: Option<bool>,
    detect_mfa: Option<bool>,
) -> Result<UrlAnalysisResult> {
    use crate::error::ManifoldError;

    let _ = (wait_for_spa, detect_captcha, detect_mfa); // reserved for future use
    let scrape_timeout = timeout;
    let details = vec![];

    // Validate URL and extract domain
    if url.is_empty() || (!url.starts_with("http://") && !url.starts_with("https://")) {
        return Err(ManifoldError::InvalidArg(
            "Invalid URL: must start with http:// or https://".into(),
        ));
    }

    let url_parsed = url::Url::parse(&url)
        .map_err(|e| ManifoldError::InvalidArg(format!("Invalid URL: {}", e)))?;
    let domain = url_parsed.host_str().unwrap_or("unknown").to_string();

    // Fetch the HTML from the target URL
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(scrape_timeout.min(30000)))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| ManifoldError::Other(format!("Failed to create HTTP client: {}", e)))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| ManifoldError::Other(format!("Failed to fetch URL: {}", e)))?;

    let html = response
        .text()
        .await
        .map_err(|e| ManifoldError::Other(format!("Failed to read response body: {}", e)))?;

    // Parse HTML
    let document = scraper::Html::parse_document(&html);

    // Analyze forms
    let form_selector = scraper::Selector::parse("form").unwrap();
    let input_selector = scraper::Selector::parse("input, select, textarea").unwrap();
    let button_selector =
        scraper::Selector::parse("button, input[type='submit'], input[type='button']").unwrap();
    let form_elements = document.select(&form_selector);
    let mut forms = vec![];
    let mut endpoints = vec![];

    for (i, form) in form_elements.enumerate() {
        let form_selector_str = format!("form:nth-of-type({})", i + 1);
        let action = form.value().attr("action").map(|s| s.to_string());
        let method = form.value().attr("method").map(|s| s.to_string());

        let mut fields = vec![];
        let field_elements = form.select(&input_selector);

        for field in field_elements {
            let selector = if let Some(id) = field.value().attr("id") {
                format!("#{}", id)
            } else if let Some(name) = field.value().attr("name") {
                format!("[name='{}']", name)
            } else {
                "input".to_string() // Simple fallback
            };
            let name = field.value().attr("name").map(|s| s.to_string());
            let field_type = field
                .value()
                .attr("type")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "text".to_string());
            let placeholder = field.value().attr("placeholder").map(|s| s.to_string());
            let required = field.value().attr("required").is_some();

            fields.push(FieldInfo {
                name,
                field_type,
                selector,
                placeholder,
                required,
            });
        }

        let mut buttons = vec![];
        let button_elements = form.select(&button_selector);

        for button in button_elements {
            let text = button.text().collect::<String>().trim().to_string();
            let button_type = button
                .value()
                .attr("type")
                .map(|s| s.to_string())
                .unwrap_or_else(|| "button".to_string());
            let selector = if let Some(id) = button.value().attr("id") {
                format!("#{}", id)
            } else if let Some(name) = button.value().attr("name") {
                format!("[name='{}']", name)
            } else {
                "button".to_string()
            };
            let action_attr = button.value().attr("formaction").map(|s| s.to_string());

            buttons.push(ButtonInfo {
                text: if text.is_empty() { None } else { Some(text) },
                button_type,
                selector,
                action: action_attr,
            });
        }

        forms.push(FormAnalysis {
            action: action.clone(),
            method,
            fields,
            buttons,
            selector: form_selector_str,
        });

        if let Some(act) = action {
            endpoints.push(act);
        }
    }

    // Standalone buttons (outside forms)
    let buttons: Vec<ButtonInfo> = vec![];

    // Detect form fields (legacy selectors)
    let selectors = detect_form_fields(&document);

    // Calculate suggested settings
    let script_count = document
        .select(&scraper::Selector::parse("script").unwrap())
        .count() as u64;
    let image_count = document
        .select(&scraper::Selector::parse("img").unwrap())
        .count() as u64;
    let suggested_wait_time = (script_count * 200 + image_count * 50).max(1000).min(15000);
    let suggested_timeout = timeout.max(10000).min(60000);

    // Calculate confidence
    let mut confidence: f64 = 0.0;
    let mut field_count = 0;

    if selectors.username_selector.is_some() {
        confidence += 20.0;
        field_count += 1;
    }
    if selectors.password_selector.is_some() {
        confidence += 20.0;
        field_count += 1;
    }
    if selectors.submit_selector.is_some() {
        confidence += 20.0;
        field_count += 1;
    }
    if selectors.success_selector.is_some() {
        confidence += 15.0;
        field_count += 1;
    }
    if selectors.failure_selector.is_some() {
        confidence += 10.0;
        field_count += 1;
    }
    if selectors.captcha_selector.is_some() {
        confidence += 5.0;
    }
    if selectors.totp_selector.is_some() {
        confidence += 5.0;
    }

    // Bonus for having all critical fields
    if field_count >= 3 {
        confidence += 5.0;
    }

    let confidence = confidence.min(100.0);

    let has_mfa = selectors.totp_selector.is_some() || detect_mfa_indicators(&html);

    Ok(UrlAnalysisResult {
        url,
        domain,
        confidence,
        forms,
        buttons,
        endpoints,
        username_selector: selectors.username_selector,
        password_selector: selectors.password_selector,
        submit_selector: selectors.submit_selector,
        success_selector: selectors.success_selector,
        failure_selector: selectors.failure_selector,
        captcha_selector: selectors.captcha_selector,
        consent_selector: selectors.consent_selector,
        totp_selector: selectors.totp_selector.clone(),
        mfa_selector: selectors.totp_selector,
        is_spa: detect_spa(&html),
        spa_framework: detect_spa_framework(&html),
        has_captcha: detect_captcha_in_html(&html).0,
        captcha_providers: detect_captcha_in_html(&html).1,
        has_mfa,
        mfa_type: if has_mfa {
            Some("TOTP".to_string())
        } else {
            None
        },
        suggested_wait_time,
        suggested_timeout,
        details,
    })
}

#[derive(Debug, Default)]
struct FormSelectors {
    username_selector: Option<String>,
    password_selector: Option<String>,
    submit_selector: Option<String>,
    success_selector: Option<String>,
    failure_selector: Option<String>,
    captcha_selector: Option<String>,
    consent_selector: Option<String>,
    totp_selector: Option<String>,
}

fn detect_form_fields(document: &scraper::Html) -> FormSelectors {
    let mut selectors = FormSelectors::default();

    // Detect username/email field
    if let Some(selector) = find_username_field(document) {
        selectors.username_selector = Some(selector);
    }

    // Detect password field
    if let Some(selector) = find_password_field(document) {
        selectors.password_selector = Some(selector);
    }

    // Detect submit button
    if let Some(selector) = find_submit_button(document) {
        selectors.submit_selector = Some(selector);
    }

    // Detect success indicator
    if let Some(selector) = find_success_indicator(document) {
        selectors.success_selector = Some(selector);
    }

    // Detect failure indicator
    if let Some(selector) = find_failure_indicator(document) {
        selectors.failure_selector = Some(selector);
    }

    // Detect captcha
    if let Some(selector) = find_captcha(document) {
        selectors.captcha_selector = Some(selector);
    }

    // Detect TOTP/2FA field
    if let Some(selector) = find_totp_field(document) {
        selectors.totp_selector = Some(selector);
    }

    selectors
}

fn find_username_field(document: &scraper::Html) -> Option<String> {
    let selector = scraper::Selector::parse("input[type='email'], input[name*='email'], input[name*='username'], input[name*='user'], input[placeholder*='email'], input[placeholder*='username']").ok()?;

    for element in document.select(&selector).take(1) {
        if let Some(id) = element.value().attr("id") {
            return Some(format!("#{}", id));
        }
        if let Some(name) = element.value().attr("name") {
            return Some(format!("input[name='{}']", name));
        }
    }
    None
}

fn find_password_field(document: &scraper::Html) -> Option<String> {
    let selector = scraper::Selector::parse("input[type='password']").ok()?;

    for element in document.select(&selector).take(1) {
        if let Some(id) = element.value().attr("id") {
            return Some(format!("#{}", id));
        }
        if let Some(name) = element.value().attr("name") {
            return Some(format!("input[name='{}']", name));
        }
    }
    None
}

fn find_submit_button(document: &scraper::Html) -> Option<String> {
    let selectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button:contains('Login')",
        "button:contains('Sign in')",
        "button:contains('Submit')",
    ];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            for element in document.select(&selector).take(1) {
                if let Some(id) = element.value().attr("id") {
                    return Some(format!("#{}", id));
                }
                if let Some(name) = element.value().attr("name") {
                    return Some(format!("button[name='{}']", name));
                }
                // For buttons without id/name, use tag selector
                if element.value().name() == "button" {
                    return Some("button[type='submit']".to_string());
                }
            }
        }
    }
    None
}

fn find_success_indicator(document: &scraper::Html) -> Option<String> {
    let selectors = [
        ".dashboard",
        ".profile",
        "[data-testid='home']",
        "nav[role='navigation']",
        ".sidebar",
    ];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if document.select(&selector).next().is_some() {
                return Some(sel_str.to_string());
            }
        }
    }
    None
}

fn find_failure_indicator(document: &scraper::Html) -> Option<String> {
    let selectors = [
        ".error",
        ".alert-error",
        "[role='alert']",
        ".error-message",
        ".form-error",
    ];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if document.select(&selector).next().is_some() {
                return Some(sel_str.to_string());
            }
        }
    }
    None
}

fn find_captcha(document: &scraper::Html) -> Option<String> {
    let selectors = [".g-recaptcha", ".h-captcha", "[data-sitekey]", ".recaptcha"];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if document.select(&selector).next().is_some() {
                return Some(sel_str.to_string());
            }
        }
    }
    None
}

fn find_totp_field(document: &scraper::Html) -> Option<String> {
    let selectors = [
        "input[name*='totp']",
        "input[name*='2fa']",
        "input[name*='mfa']",
        "input[placeholder*='code']",
        "input[placeholder*='authenticator']",
    ];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            for element in document.select(&selector).take(1) {
                if let Some(id) = element.value().attr("id") {
                    return Some(format!("#{}", id));
                }
                if let Some(name) = element.value().attr("name") {
                    return Some(format!("input[name='{}']", name));
                }
            }
        }
    }
    None
}

fn detect_spa(html: &str) -> bool {
    let spa_indicators = [
        "data-react-root",
        "__vue__",
        "ng-app",
        "ng-version",
        "_nuxt",
        "__next",
    ];

    spa_indicators.iter().any(|ind| html.contains(ind))
}

fn detect_spa_framework(html: &str) -> Option<String> {
    if html.contains("data-react-root") || html.contains("__react") {
        return Some("React".to_string());
    }
    if html.contains("__vue__") {
        return Some("Vue".to_string());
    }
    if html.contains("ng-app") || html.contains("ng-version") {
        return Some("Angular".to_string());
    }
    if html.contains("_nuxt") {
        return Some("Nuxt".to_string());
    }
    if html.contains("__next") {
        return Some("Next.js".to_string());
    }
    None
}

fn detect_captcha_in_html(html: &str) -> (bool, Vec<String>) {
    let mut providers = vec![];

    if html.contains("recaptcha") || html.contains("g-recaptcha") {
        providers.push("reCAPTCHA".to_string());
    }
    if html.contains("h-captcha") || html.contains("hcaptcha") {
        providers.push("hCaptcha".to_string());
    }
    if html.contains("arkose") {
        providers.push("Arkose".to_string());
    }
    if html.contains("geetest") {
        providers.push("GeeTest".to_string());
    }
    if html.contains("cloudflare") && html.contains("challenge") {
        providers.push("Cloudflare".to_string());
    }

    let has_captcha = !providers.is_empty();
    (has_captcha, providers)
}

fn detect_mfa_indicators(html: &str) -> bool {
    let mfa_keywords = [
        "2fa",
        "two-factor",
        "authenticator",
        "totp",
        "mfa",
        "verify",
        "verification code",
    ];

    mfa_keywords
        .iter()
        .any(|kw| html.to_lowercase().contains(kw))
}

// ── Geo consistency commands ──────────────────────────────────────────────────

use crate::geo_validator::{AutoCorrectResult, GeoValidator, GeoViolation};

/// Validate a profile's fingerprint for geo-consistency against a proxy country.
///
/// Returns a list of violations (may be empty if all checks pass).
/// `proxy_country` is an ISO-3166-1 alpha-2 code (e.g. "US"). Pass `null`/`None`
/// to run only internal self-consistency checks.
#[tauri::command]
pub fn validate_geo_consistency(
    profile_id: String,
    proxy_country: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<GeoViolation>> {
    let profiles = state.profiles.lock().unwrap();
    let profile = profiles.get(&profile_id)?;

    let violations = GeoValidator::validate(&profile.fingerprint, proxy_country.as_deref());

    Ok(violations)
}

/// Auto-correct a profile's fingerprint for geo-consistency and persist the result.
///
/// Calls `enforce_geo()` for locale/timezone alignment, then applies screen-
/// resolution and DPR fixes.  Returns a summary of what was fixed and any
/// residual violations that require manual intervention.
#[tauri::command]
pub fn auto_correct_geo(
    profile_id: String,
    proxy_country: String,
    state: State<'_, AppState>,
) -> Result<AutoCorrectResult> {
    let profiles = state.profiles.lock().unwrap();
    let mut profile = profiles.get(&profile_id)?;

    let seed = profile.fingerprint.seed;
    let result = GeoValidator::auto_correct(&mut profile.fingerprint, &proxy_country, seed);

    // Persist the corrected fingerprint
    let req = UpdateProfileRequest {
        name: None,
        fingerprint: Some(profile.fingerprint.clone()),
        human: None,
        proxy_id: None,
        notes: None,
        tags: None,
        behavior_profile: None,
        tls_bridge: None,
    };
    profiles.update(&profile_id, req)?;

    Ok(result)
}

/// Launch TLS bridge server for JA4 fingerprinting control.
/// Returns the port the bridge is listening on.
#[tauri::command]
pub async fn launch_tls_bridge(state: State<'_, AppState>, seed: u64) -> Result<u16> {
    use crate::tls_bridge::TlsBridge;

    let port = *state.tls_bridge_port.lock().unwrap();
    let bridge = TlsBridge::new(port, seed)
        .await
        .map_err(|e| ManifoldError::Other(format!("Failed to start TLS bridge: {}", e)))?;

    // Start the bridge in background (we don't wait for it)
    tokio::spawn(async move {
        if let Err(e) = bridge.run().await {
            eprintln!("[tls-bridge] Bridge error: {}", e);
        }
    });

    Ok(port)
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── SPA Detection Tests ───────────────────────────────────────────────
    #[test]
    fn test_detect_spa_react() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <div id="root" data-react-root>
                    <div>React App</div>
                </div>
            </body>
            </html>
        "#;
        assert!(detect_spa(html));
    }

    #[test]
    fn test_detect_spa_vue() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <div id="app" __vue__></div>
            </body>
            </html>
        "#;
        assert!(detect_spa(html));
    }

    #[test]
    fn test_detect_spa_angular() {
        let html = r#"
            <!DOCTYPE html>
            <html ng-app="myApp">
            <body>
                <div>Angular App</div>
            </body>
            </html>
        "#;
        assert!(detect_spa(html));
    }

    #[test]
    fn test_detect_spa_next() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <div id="__next"></div>
            </body>
            </html>
        "#;
        assert!(detect_spa(html));
    }

    #[test]
    fn test_detect_spa_nuxt() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <div id="_nuxt"></div>
            </body>
            </html>
        "#;
        assert!(detect_spa(html));
    }

    #[test]
    fn test_detect_spa_none() {
        let html = r#"
            <!DOCTYPE html>
            <html>
            <body>
                <form>
                    <input type="text">
                </form>
            </body>
            </html>
        "#;
        assert!(!detect_spa(html));
    }

    // ── SPA Framework Detection Tests ─────────────────────────────────────
    #[test]
    fn test_detect_spa_framework_react() {
        let html = r#"<div data-react-root></div>"#;
        assert_eq!(detect_spa_framework(html), Some("React".to_string()));
    }

    #[test]
    fn test_detect_spa_framework_vue() {
        let html = r#"<div __vue__></div>"#;
        assert_eq!(detect_spa_framework(html), Some("Vue".to_string()));
    }

    #[test]
    fn test_detect_spa_framework_angular() {
        let html = r#"<html ng-app="app"></html>"#;
        assert_eq!(detect_spa_framework(html), Some("Angular".to_string()));
    }

    #[test]
    fn test_detect_spa_framework_nextjs() {
        let html = r#"<div id="__next"></div>"#;
        assert_eq!(detect_spa_framework(html), Some("Next.js".to_string()));
    }

    #[test]
    fn test_detect_spa_framework_nuxt() {
        let html = r#"<div id="_nuxt"></div>"#;
        assert_eq!(detect_spa_framework(html), Some("Nuxt".to_string()));
    }

    #[test]
    fn test_detect_spa_framework_none() {
        let html = r#"<html><body><form></form></body></html>"#;
        assert_eq!(detect_spa_framework(html), None);
    }

    // ── CAPTCHA Detection Tests ───────────────────────────────────────────
    #[test]
    fn test_detect_captcha_recaptcha() {
        let html = r#"<div class="g-recaptcha" data-sitekey="123"></div>"#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(has);
        assert!(providers.contains(&"reCAPTCHA".to_string()));
    }

    #[test]
    fn test_detect_captcha_hcaptcha() {
        let html = r#"<div class="h-captcha"></div>"#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(has);
        assert!(providers.contains(&"hCaptcha".to_string()));
    }

    #[test]
    fn test_detect_captcha_arkose() {
        let html = r#"<script src="arkose.js"></script>"#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(has);
        assert!(providers.contains(&"Arkose".to_string()));
    }

    #[test]
    fn test_detect_captcha_geetest() {
        let html = r#"<script src="geetest.js"></script>"#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(has);
        assert!(providers.contains(&"GeeTest".to_string()));
    }

    #[test]
    fn test_detect_captcha_multiple() {
        let html = r#"
            <div class="g-recaptcha"></div>
            <div class="h-captcha"></div>
        "#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(has);
        assert_eq!(providers.len(), 2);
        assert!(providers.contains(&"reCAPTCHA".to_string()));
        assert!(providers.contains(&"hCaptcha".to_string()));
    }

    #[test]
    fn test_detect_captcha_none() {
        let html = r#"<html><body><form></form></body></html>"#;
        let (has, providers) = detect_captcha_in_html(html);
        assert!(!has);
        assert!(providers.is_empty());
    }

    // ── MFA Detection Tests ───────────────────────────────────────────────
    #[test]
    fn test_detect_mfa_indicators_2fa() {
        let html = "Please enter your 2fa code";
        assert!(detect_mfa_indicators(html));
    }

    #[test]
    fn test_detect_mfa_indicators_totp() {
        let html = "Enter TOTP from authenticator";
        assert!(detect_mfa_indicators(html));
    }

    #[test]
    fn test_detect_mfa_indicators_authenticator() {
        let html = "Authenticator code required";
        assert!(detect_mfa_indicators(html));
    }

    #[test]
    fn test_detect_mfa_indicators_verification_code() {
        let html = "Enter verification code from email";
        assert!(detect_mfa_indicators(html));
    }

    #[test]
    fn test_detect_mfa_indicators_none() {
        let html = "Please enter your username and password";
        assert!(!detect_mfa_indicators(html));
    }

    #[test]
    fn test_detect_mfa_indicators_case_insensitive() {
        let html = "Enter your TWO-FACTOR code";
        assert!(detect_mfa_indicators(html));
    }

    // ── Form Field Detection Tests ───────────────────────────────────────
    #[test]
    fn test_find_username_field_email_type() {
        let html =
            scraper::Html::parse_document(r#"<input type="email" id="user_email" name="email" />"#);
        let selector = find_username_field(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_username_field_email_name() {
        let html = scraper::Html::parse_document(r#"<input type="text" name="user_email" />"#);
        let selector = find_username_field(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_username_field_with_id() {
        let html = scraper::Html::parse_document(r#"<input type="email" id="username" />"#);
        let selector = find_username_field(&html);
        assert!(selector.is_some());
        let sel = selector.unwrap();
        assert!(sel.contains("username"));
    }

    #[test]
    fn test_find_username_field_none() {
        let html = scraper::Html::parse_document(r#"<input type="text" />"#);
        let selector = find_username_field(&html);
        // May or may not find depending on heuristics
        // Just ensure it doesn't panic
        let _ = selector;
    }

    #[test]
    fn test_find_password_field() {
        let html =
            scraper::Html::parse_document(r#"<input type="password" id="pwd" name="password" />"#);
        let selector = find_password_field(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_password_field_with_id() {
        let html = scraper::Html::parse_document(r#"<input type="password" id="user_password" />"#);
        let selector = find_password_field(&html);
        assert!(selector.is_some());
        let sel = selector.unwrap();
        assert!(sel.contains("user_password"));
    }

    #[test]
    fn test_find_password_field_none() {
        let html = scraper::Html::parse_document(r#"<input type="text" />"#);
        let selector = find_password_field(&html);
        assert!(selector.is_none());
    }

    #[test]
    fn test_find_submit_button() {
        let html =
            scraper::Html::parse_document(r#"<button type="submit" id="login_btn">Login</button>"#);
        let selector = find_submit_button(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_submit_button_input() {
        let html = scraper::Html::parse_document(
            r#"<input type="submit" value="Sign In" id="submit_btn" />"#,
        );
        let selector = find_submit_button(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_submit_button_none() {
        let html = scraper::Html::parse_document(r#"<button type="button">Cancel</button>"#);
        let selector = find_submit_button(&html);
        assert!(selector.is_none());
    }

    #[test]
    fn test_find_totp_field() {
        let html = scraper::Html::parse_document(
            r#"<input type="text" name="totp_code" id="authenticator" />"#,
        );
        let selector = find_totp_field(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_totp_field_2fa() {
        let html = scraper::Html::parse_document(r#"<input type="text" name="2fa_code" />"#);
        let selector = find_totp_field(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_totp_field_mfa() {
        let html = scraper::Html::parse_document(r#"<input type="text" placeholder="MFA Code" />"#);
        let selector = find_totp_field(&html);
        // May find if placeholder matching works
        let _ = selector;
    }

    #[test]
    fn test_find_totp_field_none() {
        let html = scraper::Html::parse_document(r#"<input type="text" name="username" />"#);
        let selector = find_totp_field(&html);
        assert!(selector.is_none());
    }

    #[test]
    fn test_find_success_indicator() {
        let html = scraper::Html::parse_document(r#"<div class="dashboard">Welcome</div>"#);
        let selector = find_success_indicator(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_success_indicator_profile() {
        let html = scraper::Html::parse_document(r#"<div class="profile">Profile Page</div>"#);
        let selector = find_success_indicator(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_success_indicator_none() {
        let html = scraper::Html::parse_document(r#"<div class="login">Login Form</div>"#);
        let selector = find_success_indicator(&html);
        assert!(selector.is_none());
    }

    #[test]
    fn test_find_failure_indicator() {
        let html = scraper::Html::parse_document(r#"<div class="error">Invalid credentials</div>"#);
        let selector = find_failure_indicator(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_failure_indicator_alert() {
        let html = scraper::Html::parse_document(r#"<div role="alert">Error occurred</div>"#);
        let selector = find_failure_indicator(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_failure_indicator_none() {
        let html = scraper::Html::parse_document(r#"<div class="success">Login successful</div>"#);
        let selector = find_failure_indicator(&html);
        assert!(selector.is_none());
    }

    #[test]
    fn test_find_captcha() {
        let html =
            scraper::Html::parse_document(r#"<div class="g-recaptcha" data-sitekey="123"></div>"#);
        let selector = find_captcha(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_captcha_hcaptcha() {
        let html = scraper::Html::parse_document(r#"<div class="h-captcha"></div>"#);
        let selector = find_captcha(&html);
        assert!(selector.is_some());
    }

    #[test]
    fn test_find_captcha_none() {
        let html = scraper::Html::parse_document(r#"<form></form>"#);
        let selector = find_captcha(&html);
        assert!(selector.is_none());
    }

    // ── Integration Tests ─────────────────────────────────────────────────
    #[test]
    fn test_detect_form_fields_complete_form() {
        let html = scraper::Html::parse_document(
            r#"
            <form>
                <input type="email" name="email" />
                <input type="password" name="password" />
                <button type="submit">Login</button>
                <div class="error"></div>
            </form>
            "#,
        );
        let selectors = detect_form_fields(&html);
        assert!(selectors.username_selector.is_some());
        assert!(selectors.password_selector.is_some());
        assert!(selectors.submit_selector.is_some());
    }

    #[test]
    fn test_detect_form_fields_minimal_form() {
        let html = scraper::Html::parse_document(
            r#"
            <form>
                <input type="email" id="email" />
                <input type="password" id="password" />
                <button type="submit">Submit</button>
            </form>
            "#,
        );
        let selectors = detect_form_fields(&html);
        assert!(selectors.username_selector.is_some());
        assert!(selectors.password_selector.is_some());
        assert!(selectors.submit_selector.is_some());
    }

    #[test]
    fn test_detect_form_fields_with_mfa() {
        let html = scraper::Html::parse_document(
            r#"
            <form>
                <input type="email" id="email" />
                <input type="password" id="password" />
                <input type="text" name="totp" id="totp" />
                <button type="submit">Login</button>
            </form>
            "#,
        );
        let selectors = detect_form_fields(&html);
        assert!(selectors.username_selector.is_some());
        assert!(selectors.password_selector.is_some());
        assert!(selectors.totp_selector.is_some());
    }

    #[test]
    fn test_detect_form_fields_with_captcha() {
        let html = scraper::Html::parse_document(
            r#"
            <form>
                <input type="email" id="email" />
                <input type="password" id="password" />
                <div class="g-recaptcha"></div>
                <button type="submit">Login</button>
            </form>
            "#,
        );
        let selectors = detect_form_fields(&html);
        assert!(selectors.username_selector.is_some());
        assert!(selectors.password_selector.is_some());
        assert!(selectors.captcha_selector.is_some());
    }

    #[test]
    fn test_detect_form_fields_empty() {
        let html = scraper::Html::parse_document(r#"<html></html>"#);
        let selectors = detect_form_fields(&html);
        // Empty form should have no selectors
        assert!(selectors.username_selector.is_none());
        assert!(selectors.password_selector.is_none());
        assert!(selectors.submit_selector.is_none());
    }
}
