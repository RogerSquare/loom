mod commands;
mod error;
mod ollama;

use commands::LoomState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(LoomState::new())
        .invoke_handler(tauri::generate_handler![
            commands::ollama_chat,
            commands::ollama_list_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
