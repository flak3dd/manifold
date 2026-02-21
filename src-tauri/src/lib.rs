// ── Manifold — Tauri application root ────────────────────────────────────────

mod commands;
mod db;
mod error;
mod fingerprint;
mod geo_validator;
mod human;
mod profile;
mod proxy;
mod tls_bridge;

use commands::AppState;
use db::{default_db_path, Db};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Database ──────────────────────────────────────────────────────────────
    // In a production build you'd derive the master key from a user-supplied
    // passphrase or the OS keychain.  For development we skip encryption.
    let master_key: Option<String> = std::env::var("MANIFOLD_MASTER_KEY").ok();

    let db_path = default_db_path();
    let db = Db::open(&db_path, master_key.as_deref()).expect("failed to open Manifold database");

    let app_state = AppState::new(db, master_key);

    // ── Tauri builder ─────────────────────────────────────────────────────────
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // ── Profile ───────────────────────────────────────────────────────
            commands::list_profiles,
            commands::get_profile,
            commands::create_profile,
            commands::update_profile,
            commands::delete_profile,
            commands::reseed_profile,
            commands::duplicate_profile,
            commands::set_profile_status,
            // ── Fingerprint ───────────────────────────────────────────────────
            commands::generate_fingerprint,
            commands::reseed_fingerprint,
            // ── Human behavior ────────────────────────────────────────────────
            commands::get_human_defaults,
            // ── Proxy ─────────────────────────────────────────────────────────
            commands::list_proxies,
            commands::get_proxy,
            commands::add_proxy,
            commands::update_proxy,
            commands::delete_proxy,
            commands::check_proxy,
            commands::check_all_proxies,
            // ── Bridge / launcher ─────────────────────────────────────────────
            commands::launch_profile,
            commands::stop_bridge,
            commands::get_bridge_url,
            commands::set_bridge_port,
            // ── TLS Bridge ────────────────────────────────────────────────────
            commands::launch_tls_bridge,
            // ── Emergency ─────────────────────────────────────────────────────
            commands::panic_shutdown,
            // ── Session export / replay ───────────────────────────────────────
            commands::export_session,
            commands::list_sessions,
            commands::delete_session,
            // ── Data / settings ───────────────────────────────────────────────
            commands::save_data,
            commands::load_data,
            commands::get_app_info,
            // ── Form scraper ──────────────────────────────────────────────────
            commands::scrape_form_selectors,
            // ── Geo consistency ───────────────────────────────────────────────
            commands::validate_geo_consistency,
            commands::auto_correct_geo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Manifold");
}
