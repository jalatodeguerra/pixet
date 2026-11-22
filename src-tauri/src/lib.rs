use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub schema_version: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTransfer {
    pub document: pixet_core::Document,
    pub cels: HashMap<String, String>,
    #[serde(default)]
    pub tiles: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptionsDto {
    pub format: pixet_core::ExportFormat,
    pub pack: pixet_core::PackMode,
    pub trim: bool,
    pub extrude: u32,
    pub padding: u32,
    pub sheet_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResultDto {
    pub png_path: String,
    pub metadata_path: String,
    pub sheet_width: u32,
    pub sheet_height: u32,
    pub frame_count: usize,
}

fn transfer_to_project(payload: ProjectTransfer) -> Result<pixet_core::ProjectData, String> {
    let mut cels = HashMap::with_capacity(payload.cels.len());
    for (key, b64) in payload.cels {
        let raw = BASE64
            .decode(b64)
            .map_err(|e| format!("Invalid base64 cel `{key}`: {e}"))?;
        cels.insert(key, raw);
    }
    let mut tiles = Vec::with_capacity(payload.tiles.len());
    for (idx, b64) in payload.tiles.into_iter().enumerate() {
        let raw = BASE64
            .decode(b64)
            .map_err(|e| format!("Invalid base64 tile #{}: {e}", idx + 1))?;
        tiles.push(raw);
    }
    Ok(pixet_core::ProjectData {
        document: payload.document,
        cels,
        tiles,
    })
}

fn project_to_transfer(project: pixet_core::ProjectData) -> ProjectTransfer {
    let mut cels = HashMap::with_capacity(project.cels.len());
    for (key, raw) in project.cels {
        cels.insert(key, BASE64.encode(raw));
    }
    let tiles = project.tiles.into_iter().map(|raw| BASE64.encode(raw)).collect();
    ProjectTransfer {
        document: project.document,
        cels,
        tiles,
    }
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: pixet_core::SCHEMA_VERSION,
    }
}

#[tauri::command]
fn save_project(path: String, payload: ProjectTransfer) -> Result<(), String> {
    let project = transfer_to_project(payload)?;
    pixet_core::save_pixet(path, &project).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_project(path: String) -> Result<ProjectTransfer, String> {
    let project = pixet_core::load_pixet(path).map_err(|e| e.to_string())?;
    Ok(project_to_transfer(project))
}

#[tauri::command]
fn import_aseprite(path: String) -> Result<ProjectTransfer, String> {
    let project = pixet_core::load_aseprite(path).map_err(|e| e.to_string())?;
    Ok(project_to_transfer(project))
}

#[tauri::command]
fn export_spritesheet(
    out_dir: String,
    payload: ProjectTransfer,
    options: ExportOptionsDto,
) -> Result<ExportResultDto, String> {
    let project = transfer_to_project(payload)?;
    let opts = pixet_core::ExportOptions {
        format: options.format,
        pack: options.pack,
        trim: options.trim,
        extrude: options.extrude,
        padding: options.padding,
        sheet_name: options.sheet_name,
    };
    let res = pixet_core::export_project(&project, out_dir, &opts).map_err(|e| e.to_string())?;
    Ok(ExportResultDto {
        png_path: res.png_path.to_string_lossy().into_owned(),
        metadata_path: res.metadata_path.to_string_lossy().into_owned(),
        sheet_width: res.sheet_width,
        sheet_height: res.sheet_height,
        frame_count: res.frame_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            save_project,
            open_project,
            import_aseprite,
            export_spritesheet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
