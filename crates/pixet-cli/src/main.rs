use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Parser)]
#[command(
    name = "pixet",
    version,
    about = "Headless CLI for inspecting and exporting .pixet pixel-art projects"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Inspect metadata for a .pixet project file
    Info {
        /// Path to the .pixet project file
        file: PathBuf,
    },
    /// Export a .pixet project to spritesheets or game engine assets
    Export {
        /// Path to the .pixet project file
        file: PathBuf,
        /// Target export format
        #[arg(long, value_enum, default_value_t = CliExportFormat::Json)]
        format: CliExportFormat,
        /// Output directory
        #[arg(long, default_value = "./export")]
        out: PathBuf,
        /// Packing algorithm
        #[arg(long, value_enum, default_value_t = CliPackMode::Tight)]
        pack: CliPackMode,
        /// Trim transparent whitespace around frames
        #[arg(long, default_value_t = false)]
        trim: bool,
        /// Edge extrusion pixels around each frame
        #[arg(long, default_value_t = 0)]
        extrude: u32,
        /// Padding pixels between packed frames
        #[arg(long, default_value_t = 1)]
        padding: u32,
        /// Base output filename (defaults to project stem)
        #[arg(long)]
        name: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliExportFormat {
    Json,
    Godot,
    GodotTileset,
    Tiled,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum CliPackMode {
    Grid,
    Tight,
}

fn load_input_project(file: &PathBuf) -> Result<pixet_core::ProjectData, String> {
    let ext = file
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    let res = match ext.as_deref() {
        Some("ase" | "aseprite") => pixet_core::load_aseprite(file),
        _ => pixet_core::load_pixet(file),
    };
    res.map_err(|e| format!("Failed to load `{}`: {e}", file.display()))
}

fn run() -> Result<(), String> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Info { file } => {
            let project = load_input_project(&file)?;
            let doc = &project.document;
            println!("Project:      {}", doc.name);
            println!("Schema:       v{}", doc.schema_version);
            println!("Dimensions:   {}x{} px", doc.size.width, doc.size.height);
            println!("Color Mode:   {:?}", doc.color_mode);
            println!("Layers:       {}", doc.layers.len());
            println!("Frames:       {}", doc.frames.len());
            println!("Cels stored:  {}", project.cels.len());
            if let Some(ts) = &doc.tileset {
                println!(
                    "Tileset:      {} ({}x{}, {} tiles, {:?})",
                    ts.name, ts.tile_width, ts.tile_height, project.tiles.len(), doc.tile_projection
                );
            }
            if doc.tags.is_empty() {
                println!("Tags:         (none)");
            } else {
                let tag_list: Vec<String> = doc
                    .tags
                    .iter()
                    .map(|t| format!("{} ({}..{})", t.name, t.from_frame + 1, t.to_frame + 1))
                    .collect();
                println!("Tags:         {}", tag_list.join(", "));
            }
            Ok(())
        }
        Commands::Export {
            file,
            format,
            out,
            pack,
            trim,
            extrude,
            padding,
            name,
        } => {
            let project = load_input_project(&file)?;

            let sheet_name = name.unwrap_or_else(|| {
                file.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("spritesheet")
                    .to_string()
            });

            let opts = pixet_core::ExportOptions {
                format: match format {
                    CliExportFormat::Json => pixet_core::ExportFormat::Json,
                    CliExportFormat::Godot => pixet_core::ExportFormat::Godot,
                    CliExportFormat::GodotTileset => pixet_core::ExportFormat::GodotTileset,
                    CliExportFormat::Tiled => pixet_core::ExportFormat::Tiled,
                },
                pack: match pack {
                    CliPackMode::Grid => pixet_core::PackMode::Grid,
                    CliPackMode::Tight => pixet_core::PackMode::Tight,
                },
                trim,
                extrude,
                padding,
                sheet_name,
            };

            let res = pixet_core::export_project(&project, &out, &opts)
                .map_err(|e| format!("Export failed: {e}"))?;

            println!(
                "Exported {} frames ({}x{} sheet):",
                res.frame_count, res.sheet_width, res.sheet_height
            );
            println!("  PNG:      {}", res.png_path.display());
            println!("  Metadata: {}", res.metadata_path.display());
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::FAILURE
        }
    }
}
