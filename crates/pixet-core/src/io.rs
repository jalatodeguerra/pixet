use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use thiserror::Error;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::document::Document;

#[derive(Debug, Error)]
pub enum PixetError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("PNG encoding error: {0}")]
    PngEncoding(#[from] png::EncodingError),
    #[error("PNG decoding error: {0}")]
    PngDecoding(#[from] png::DecodingError),
    #[error("Invalid .pixet project: {0}")]
    InvalidProject(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectData {
    pub document: Document,
    /// Raw RGBA bytes keyed by `"{layer_id}:{frame_index}"`.
    pub cels: HashMap<String, Vec<u8>>,
}

pub fn cel_key(layer_id: &str, frame_index: u32) -> String {
    format!("{layer_id}:{frame_index}")
}

pub fn encode_rgba_png(
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<Vec<u8>, PixetError> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(PixetError::InvalidProject(format!(
            "Expected {expected} RGBA bytes for {width}x{height}, got {}",
            rgba.len()
        )));
    }
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(rgba)?;
    }
    Ok(out)
}

pub fn decode_rgba_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), PixetError> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::ALPHA | png::Transformations::EXPAND);
    let mut reader = decoder.read_info()?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or_else(|| {
        PixetError::InvalidProject("PNG buffer size overflow".to_string())
    })?];
    let info = reader.next_frame(&mut buf)?;
    buf.truncate(info.buffer_size());

    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for chunk in buf.chunks_exact(3) {
                out.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]);
            }
            out
        }
        png::ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for chunk in buf.chunks_exact(2) {
                out.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]);
            }
            out
        }
        png::ColorType::Grayscale => {
            let mut out = Vec::with_capacity((info.width * info.height * 4) as usize);
            for &g in &buf {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            out
        }
        other => {
            return Err(PixetError::InvalidProject(format!(
                "Unsupported PNG color type: {other:?}"
            )));
        }
    };

    Ok((info.width, info.height, rgba))
}

pub fn write_pixet_bytes(project: &ProjectData) -> Result<Vec<u8>, PixetError> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated);

        let manifest_json = project.document.to_json_pretty()?;
        zip.start_file("manifest.json", options)?;
        zip.write_all(manifest_json.as_bytes())?;

        let width = project.document.size.width;
        let height = project.document.size.height;

        let mut keys: Vec<&String> = project.cels.keys().collect();
        keys.sort();

        for key in keys {
            let rgba = &project.cels[key];
            if rgba.is_empty() {
                continue;
            }
            let Some((layer_id, frame_part)) = key.rsplit_once(':') else {
                continue;
            };
            let png_bytes = encode_rgba_png(width, height, rgba)?;
            let entry_name = format!("cels/{layer_id}__{frame_part}.png");
            zip.start_file(entry_name, options)?;
            zip.write_all(&png_bytes)?;
        }

        zip.finish()?;
    }
    Ok(cursor.into_inner())
}

pub fn read_pixet_bytes(bytes: &[u8]) -> Result<ProjectData, PixetError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;

    let document = {
        let mut manifest_file = archive.by_name("manifest.json").map_err(|_| {
            PixetError::InvalidProject("Missing manifest.json in .pixet archive".to_string())
        })?;
        let mut json_str = String::new();
        manifest_file.read_to_string(&mut json_str)?;
        Document::from_json(&json_str)?
    };

    let mut cels = HashMap::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        if let Some(stem) = name
            .strip_prefix("cels/")
            .and_then(|rest| rest.strip_suffix(".png"))
        {
            if let Some((layer_id, frame_str)) = stem.rsplit_once("__") {
                if let Ok(frame_index) = frame_str.parse::<u32>() {
                    let mut png_bytes = Vec::new();
                    file.read_to_end(&mut png_bytes)?;
                    let (w, h, rgba) = decode_rgba_png(&png_bytes)?;
                    if w != document.size.width || h != document.size.height {
                        return Err(PixetError::InvalidProject(format!(
                            "Cel {layer_id}:{frame_index} dimensions {w}x{h} do not match canvas {}x{}",
                            document.size.width, document.size.height
                        )));
                    }
                    cels.insert(cel_key(layer_id, frame_index), rgba);
                }
            }
        }
    }

    Ok(ProjectData { document, cels })
}

pub fn save_pixet(
    path: impl AsRef<Path>,
    project: &ProjectData,
) -> Result<(), PixetError> {
    let bytes = write_pixet_bytes(project)?;
    if let Some(parent) = path.as_ref().parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::write(path, bytes)?;
    Ok(())
}

pub fn load_pixet(path: impl AsRef<Path>) -> Result<ProjectData, PixetError> {
    let bytes = fs::read(path)?;
    read_pixet_bytes(&bytes)
}
