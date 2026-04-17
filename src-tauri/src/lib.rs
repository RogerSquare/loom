mod commands;
mod error;
mod ollama;
mod store;

use commands::LoomState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(LoomState::new())
        .invoke_handler(tauri::generate_handler![
            commands::ollama_chat,
            commands::ollama_list_models,
            commands::session_list,
            commands::session_open,
            commands::session_create,
            commands::session_save,
            commands::session_delete,
            commands::turn_append,
            commands::branch_fork,
            commands::branch_fork_from_edit,
            commands::branch_checkout,
            commands::turn_pin,
            commands::turn_annotate,
            commands::session_set_context_limit,
            commands::session_set_tags,
            commands::session_set_model,
            commands::settings_load,
            commands::settings_save,
            commands::prompt_list,
            commands::prompt_save,
            commands::prompt_delete,
            commands::garak_scan,
            commands::garak_cancel,
            commands::ollama_continue_from_prefill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
