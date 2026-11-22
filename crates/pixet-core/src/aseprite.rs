use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Read;
use std::path::Path;

use flate2::read::ZlibDecoder;

use crate::document::{
    AnimationTag, BlendMode, CanvasSize, Cel, ColorMode, Document, Frame, Layer, LayerKind,
    Palette, TileProjection, SCHEMA_VERSION,
};
use crate::io::{cel_key, PixetError, ProjectData};

const ASE_MAGIC: u16 = 0xA5E0;
const FRAME_MAGIC: u16 = 0xF1FA;
const CHUNK_OLD_PALETTE: u16 = 0x0004;
const CHUNK_LAYER: u16 = 0x2004;
const CHUNK_CEL: u16 = 0x2005;
const CHUNK_TAGS: u16 = 0x2018;
const CHUNK_PALETTE: u16 = 0x2019;

fn read_u8(data: &[u8], off: usize) -> Result<u8, PixetError> {
    data.get(off)
        .copied()
        .ok_or_else(|| PixetError::InvalidProject("Unexpected EOF in .ase file".to_string()))
}

fn read_u16_le(data: &[u8], off: usize) -> Result<u16, PixetError> {
    let slice = data
        .get(off..off + 2)
        .ok_or_else(|| PixetError::InvalidProject("Unexpected EOF reading u16".to_string()))?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_i16_le(data: &[u8], off: usize) -> Result<i16, PixetError> {
    Ok(read_u16_le(data, off)? as i16)
}

fn read_u32_le(data: &[u8], off: usize) -> Result<u32, PixetError> {
    let slice = data
        .get(off..off + 4)
        .ok_or_else(|| PixetError::InvalidProject("Unexpected EOF reading u32".to_string()))?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_ase_string(data: &[u8], off: usize) -> Result<(String, usize), PixetError> {
    let len = read_u16_le(data, off)? as usize;
    let end = off + 2 + len;
    let slice = data
        .get(off + 2..end)
        .ok_or_else(|| PixetError::InvalidProject("Unexpected EOF reading string".to_string()))?;
    Ok((String::from_utf8_lossy(slice).into_owned(), end))
}

fn map_ase_blend_mode(code: u16) -> BlendMode {
    match code {
        1 => BlendMode::Multiply,
        2 => BlendMode::Screen,
        3 => BlendMode::Overlay,
        14 => BlendMode::Add,
        _ => BlendMode::Normal,
    }
}

enum ParsedCelPayload {
    Linked(u32),
    Pixels {
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        opacity: u8,
        raw: Vec<u8>,
    },
}

struct ParsedCelRecord {
    layer_idx: usize,
    frame_idx: u32,
    payload: ParsedCelPayload,
}

pub fn read_aseprite_bytes(bytes: &[u8]) -> Result<ProjectData, PixetError> {
    if bytes.len() < 128 {
        return Err(PixetError::InvalidProject(
            ".ase file is smaller than 128-byte header".to_string(),
        ));
    }

    let magic = read_u16_le(bytes, 4)?;
    if magic != ASE_MAGIC {
        return Err(PixetError::InvalidProject(format!(
            "Invalid .ase magic: 0x{magic:04X}"
        )));
    }

    let frame_count = read_u16_le(bytes, 6)? as u32;
    let width = read_u16_le(bytes, 8)? as u32;
    let height = read_u16_le(bytes, 10)? as u32;
    let color_depth = read_u16_le(bytes, 12)?;
    let default_speed_ms = read_u16_le(bytes, 18)?.max(1) as u32;
    let transparent_index = read_u8(bytes, 28)?;

    if width == 0 || height == 0 || frame_count == 0 {
        return Err(PixetError::InvalidProject(
            "Invalid zero-sized .ase canvas or 0 frames".to_string(),
        ));
    }

    let color_mode = match color_depth {
        8 => ColorMode::Indexed,
        16 | 32 => ColorMode::Rgba,
        other => {
            return Err(PixetError::InvalidProject(format!(
                "Unsupported .ase color depth: {other}"
            )));
        }
    };

    let mut palette_rgba: Vec<[u8; 4]> = vec![[0, 0, 0, 255]; 256];
    let mut palette_len: usize = 0;
    let mut saw_new_palette = false;

    let mut layers: Vec<Layer> = Vec::new();
    let mut group_stack: Vec<(u16, String)> = Vec::new();
    let mut frames: Vec<Frame> = Vec::with_capacity(frame_count as usize);
    let mut tags: Vec<AnimationTag> = Vec::new();
    let mut cel_records: Vec<ParsedCelRecord> = Vec::new();

    let mut pos: usize = 128;

    for frame_idx in 0..frame_count {
        if pos + 16 > bytes.len() {
            break;
        }
        let frame_size = read_u32_le(bytes, pos)? as usize;
        let frame_magic = read_u16_le(bytes, pos + 4)?;
        if frame_magic != FRAME_MAGIC {
            return Err(PixetError::InvalidProject(format!(
                "Invalid frame magic at offset {pos}: 0x{frame_magic:04X}"
            )));
        }
        let old_chunks = read_u16_le(bytes, pos + 6)? as u32;
        let duration_ms = {
            let d = read_u16_le(bytes, pos + 8)? as u32;
            if d > 0 { d } else { default_speed_ms }
        };
        let new_chunks = read_u32_le(bytes, pos + 12)?;
        let chunk_count = if new_chunks > 0 { new_chunks } else { old_chunks };

        frames.push(Frame {
            id: format!("frame-{}", frame_idx + 1),
            index: frame_idx,
            duration_ms,
        });

        let frame_end = pos.saturating_add(frame_size).min(bytes.len());
        let mut cpos = pos + 16;

        for _ in 0..chunk_count {
            if cpos + 6 > frame_end {
                break;
            }
            let chunk_size = read_u32_le(bytes, cpos)? as usize;
            let chunk_type = read_u16_le(bytes, cpos + 4)?;
            if chunk_size < 6 || cpos + chunk_size > frame_end {
                break;
            }
            let chunk = &bytes[cpos + 6..cpos + chunk_size];
            cpos += chunk_size;

            match chunk_type {
                CHUNK_LAYER => {
                    if chunk.len() < 18 {
                        continue;
                    }
                    let flags = read_u16_le(chunk, 0)?;
                    let layer_type = read_u16_le(chunk, 2)?;
                    let child_level = read_u16_le(chunk, 4)?;
                    let blend_code = read_u16_le(chunk, 10)?;
                    let opacity_byte = read_u8(chunk, 12)?;
                    let (name, _) = read_ase_string(chunk, 16)?;

                    while group_stack
                        .last()
                        .is_some_and(|(lvl, _)| *lvl >= child_level)
                    {
                        group_stack.pop();
                    }
                    let parent_id = group_stack.last().map(|(_, id)| id.clone());
                    let id = format!("layer-{}", layers.len() + 1);
                    let kind = if layer_type == 1 {
                        LayerKind::Group
                    } else {
                        LayerKind::Raster
                    };
                    if kind == LayerKind::Group {
                        group_stack.push((child_level, id.clone()));
                    }

                    layers.push(Layer {
                        id,
                        name,
                        kind,
                        visible: (flags & 1) != 0,
                        locked: (flags & 2) == 0,
                        opacity: (opacity_byte as f32 / 255.0).clamp(0.0, 1.0),
                        alpha_lock: false,
                        blend_mode: map_ase_blend_mode(blend_code),
                        parent_id,
                        cels: Vec::new(),
                        tilemaps: BTreeMap::new(),
                        map_role: None,
                    });
                }
                CHUNK_CEL => {
                    if chunk.len() < 18 {
                        continue;
                    }
                    let layer_idx = read_u16_le(chunk, 0)? as usize;
                    let x = read_i16_le(chunk, 2)? as i32;
                    let y = read_i16_le(chunk, 4)? as i32;
                    let opacity = read_u8(chunk, 6)?;
                    let cel_type = read_u16_le(chunk, 7)?;

                    match cel_type {
                        1 => {
                            let linked_frame = read_u16_le(chunk, 16)? as u32;
                            cel_records.push(ParsedCelRecord {
                                layer_idx,
                                frame_idx,
                                payload: ParsedCelPayload::Linked(linked_frame),
                            });
                        }
                        0 | 2 => {
                            if chunk.len() < 20 {
                                continue;
                            }
                            let w = read_u16_le(chunk, 16)? as u32;
                            let h = read_u16_le(chunk, 18)? as u32;
                            let payload_bytes = &chunk[20..];
                            let raw = if cel_type == 0 {
                                payload_bytes.to_vec()
                            } else {
                                let mut decoder = ZlibDecoder::new(payload_bytes);
                                let mut decompressed = Vec::new();
                                decoder.read_to_end(&mut decompressed).map_err(|e| {
                                    PixetError::InvalidProject(format!(
                                        "Failed to decompress cel zlib: {e}"
                                    ))
                                })?;
                                decompressed
                            };
                            cel_records.push(ParsedCelRecord {
                                layer_idx,
                                frame_idx,
                                payload: ParsedCelPayload::Pixels {
                                    x,
                                    y,
                                    w,
                                    h,
                                    opacity,
                                    raw,
                                },
                            });
                        }
                        _ => {}
                    }
                }
                CHUNK_TAGS => {
                    if chunk.len() < 10 {
                        continue;
                    }
                    let tag_count = read_u16_le(chunk, 0)? as usize;
                    let mut toff = 10usize;
                    for ti in 0..tag_count {
                        if toff + 19 > chunk.len() {
                            break;
                        }
                        let from_frame = read_u16_le(chunk, toff)? as u32;
                        let to_frame = read_u16_le(chunk, toff + 2)? as u32;
                        let r = chunk[toff + 13];
                        let g = chunk[toff + 14];
                        let b = chunk[toff + 15];
                        let (name, next_off) = read_ase_string(chunk, toff + 17)?;
                        toff = next_off;
                        tags.push(AnimationTag {
                            id: format!("tag-{}", ti + 1),
                            name,
                            from_frame,
                            to_frame,
                            color: format!("#{r:02x}{g:02x}{b:02x}"),
                        });
                    }
                }
                CHUNK_PALETTE => {
                    if chunk.len() < 20 {
                        continue;
                    }
                    let total_size = read_u32_le(chunk, 0)? as usize;
                    let first_idx = read_u32_le(chunk, 4)? as usize;
                    let last_idx = read_u32_le(chunk, 8)? as usize;
                    if palette_rgba.len() < total_size {
                        palette_rgba.resize(total_size, [0, 0, 0, 255]);
                    }
                    palette_len = palette_len.max(total_size);
                    saw_new_palette = true;

                    let mut poff = 20usize;
                    for idx in first_idx..=last_idx {
                        if poff + 6 > chunk.len() {
                            break;
                        }
                        let entry_flags = read_u16_le(chunk, poff)?;
                        let r = chunk[poff + 2];
                        let g = chunk[poff + 3];
                        let b = chunk[poff + 4];
                        let a = chunk[poff + 5];
                        poff += 6;
                        if (entry_flags & 1) != 0 {
                            let (_, next_poff) = read_ase_string(chunk, poff)?;
                            poff = next_poff;
                        }
                        if idx < palette_rgba.len() {
                            palette_rgba[idx] = [r, g, b, a];
                        }
                    }
                }
                CHUNK_OLD_PALETTE if !saw_new_palette => {
                    if chunk.len() < 2 {
                        continue;
                    }
                    let packets = read_u16_le(chunk, 0)? as usize;
                    let mut poff = 2usize;
                    let mut color_idx = 0usize;
                    for _ in 0..packets {
                        if poff + 2 > chunk.len() {
                            break;
                        }
                        color_idx += chunk[poff] as usize;
                        let count = if chunk[poff + 1] == 0 {
                            256usize
                        } else {
                            chunk[poff + 1] as usize
                        };
                        poff += 2;
                        for _ in 0..count {
                            if poff + 3 > chunk.len() {
                                break;
                            }
                            if color_idx < palette_rgba.len() {
                                palette_rgba[color_idx] = [
                                    chunk[poff],
                                    chunk[poff + 1],
                                    chunk[poff + 2],
                                    255,
                                ];
                                palette_len = palette_len.max(color_idx + 1);
                            }
                            color_idx += 1;
                            poff += 3;
                        }
                    }
                }
                _ => {}
            }
        }

        pos = frame_end;
    }

    if layers.is_empty() {
        layers.push(Layer {
            id: "layer-1".to_string(),
            name: "Layer 1".to_string(),
            kind: LayerKind::Raster,
            visible: true,
            locked: false,
            opacity: 1.0,
            alpha_lock: false,
            blend_mode: BlendMode::Normal,
            parent_id: None,
            cels: Vec::new(),
            tilemaps: BTreeMap::new(),
            map_role: None,
        });
    }

    let mut cels: HashMap<String, Vec<u8>> = HashMap::new();
    let bpp: usize = match color_depth {
        32 => 4,
        16 => 2,
        8 => 1,
        _ => 4,
    };

    for record in cel_records {
        let Some(layer) = layers.get_mut(record.layer_idx) else {
            continue;
        };
        let cel_id = format!("{}-cel-{}", layer.id, record.frame_idx + 1);

        match record.payload {
            ParsedCelPayload::Linked(target_frame) => {
                layer.cels.push(Cel {
                    id: cel_id,
                    frame_index: record.frame_idx,
                    linked_to: Some(format!("{}-cel-{}", layer.id, target_frame + 1)),
                    linked_frame: Some(target_frame),
                });
            }
            ParsedCelPayload::Pixels {
                x,
                y,
                w,
                h,
                opacity,
                raw,
            } => {
                if w == 0 || h == 0 {
                    continue;
                }
                let mut canvas_rgba = vec![0u8; (width * height * 4) as usize];
                let expected_raw = (w as usize) * (h as usize) * bpp;
                if raw.len() < expected_raw {
                    continue;
                }
                let opacity_scale = opacity as f32 / 255.0;

                for cy in 0..h as i32 {
                    let dy = y + cy;
                    if dy < 0 || dy >= height as i32 {
                        continue;
                    }
                    for cx in 0..w as i32 {
                        let dx = x + cx;
                        if dx < 0 || dx >= width as i32 {
                            continue;
                        }
                        let src_i = ((cy as usize) * (w as usize) + (cx as usize)) * bpp;
                        let [r, g, b, mut a] = match color_depth {
                            32 => [raw[src_i], raw[src_i + 1], raw[src_i + 2], raw[src_i + 3]],
                            16 => {
                                let v = raw[src_i];
                                [v, v, v, raw[src_i + 1]]
                            }
                            8 => {
                                let idx = raw[src_i];
                                if idx == transparent_index {
                                    [0, 0, 0, 0]
                                } else {
                                    palette_rgba.get(idx as usize).copied().unwrap_or([0, 0, 0, 255])
                                }
                            }
                            _ => [0, 0, 0, 0],
                        };
                        if opacity < 255 && a > 0 {
                            a = ((a as f32) * opacity_scale).round().clamp(0.0, 255.0) as u8;
                        }
                        if a == 0 {
                            continue;
                        }
                        let dst_i = ((dy as usize) * (width as usize) + (dx as usize)) * 4;
                        canvas_rgba[dst_i] = r;
                        canvas_rgba[dst_i + 1] = g;
                        canvas_rgba[dst_i + 2] = b;
                        canvas_rgba[dst_i + 3] = a;
                    }
                }

                cels.insert(cel_key(&layer.id, record.frame_idx), canvas_rgba);
                layer.cels.push(Cel {
                    id: cel_id,
                    frame_index: record.frame_idx,
                    linked_to: None,
                    linked_frame: None,
                });
            }
        }
    }

    // Reverse bottom-to-top Aseprite layer order into top-to-bottom Pixet order
    layers.reverse();

    let final_palette: Vec<String> = if palette_len > 0 {
        palette_rgba[..palette_len.min(palette_rgba.len())]
            .iter()
            .map(|[r, g, b, _]| format!("#{r:02x}{g:02x}{b:02x}"))
            .collect()
    } else {
        Document::new_default(width, height).palette.colors
    };

    let document = Document {
        schema_version: SCHEMA_VERSION,
        name: "imported.pixet".to_string(),
        size: CanvasSize { width, height },
        color_mode,
        palette: Palette {
            name: "Aseprite Palette".to_string(),
            colors: final_palette,
        },
        layers,
        frames,
        tags,
        tileset: None,
        tile_projection: TileProjection::Orthogonal,
        rig: None,
        game_data: None,
    };

    Ok(ProjectData {
        document,
        cels,
        tiles: Vec::new(),
    })
}

pub fn load_aseprite(path: impl AsRef<Path>) -> Result<ProjectData, PixetError> {
    let bytes = fs::read(path.as_ref())?;
    let mut project = read_aseprite_bytes(&bytes)?;
    if let Some(stem) = path.as_ref().file_stem().and_then(|s| s.to_str()) {
        project.document.name = format!("{stem}.pixet");
    }
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn push_str(buf: &mut Vec<u8>, s: &str) {
        buf.extend_from_slice(&(s.len() as u16).to_le_bytes());
        buf.extend_from_slice(s.as_bytes());
    }

    fn wrap_chunk(chunk_type: u16, body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&((body.len() + 6) as u32).to_le_bytes());
        out.extend_from_slice(&chunk_type.to_le_bytes());
        out.extend_from_slice(body);
        out
    }

    fn wrap_frame(duration_ms: u16, chunks: &[Vec<u8>]) -> Vec<u8> {
        let body_len: usize = chunks.iter().map(|c| c.len()).sum();
        let total_size = 16 + body_len;
        let mut out = Vec::new();
        out.extend_from_slice(&(total_size as u32).to_le_bytes());
        out.extend_from_slice(&FRAME_MAGIC.to_le_bytes());
        out.extend_from_slice(&(chunks.len() as u16).to_le_bytes());
        out.extend_from_slice(&duration_ms.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(chunks.len() as u32).to_le_bytes());
        for c in chunks {
            out.extend_from_slice(c);
        }
        out
    }

    #[test]
    fn aseprite_binary_import_round_trip() {
        // Palette chunk (2 colors)
        let mut pal = Vec::new();
        pal.extend_from_slice(&2u32.to_le_bytes());
        pal.extend_from_slice(&0u32.to_le_bytes());
        pal.extend_from_slice(&1u32.to_le_bytes());
        pal.extend_from_slice(&[0u8; 8]);
        pal.extend_from_slice(&0u16.to_le_bytes());
        pal.extend_from_slice(&[10, 20, 30, 255]);
        pal.extend_from_slice(&0u16.to_le_bytes());
        pal.extend_from_slice(&[240, 80, 90, 255]);

        // Two layers: Base (bottom) and Top (top)
        let make_layer = |name: &str| {
            let mut body = Vec::new();
            body.extend_from_slice(&3u16.to_le_bytes()); // visible + editable
            body.extend_from_slice(&0u16.to_le_bytes()); // normal raster
            body.extend_from_slice(&0u16.to_le_bytes()); // child level 0
            body.extend_from_slice(&[0u8; 4]);
            body.extend_from_slice(&0u16.to_le_bytes()); // normal blend
            body.push(255); // opacity
            body.extend_from_slice(&[0u8; 3]);
            push_str(&mut body, name);
            wrap_chunk(CHUNK_LAYER, &body)
        };

        // Zlib compressed 2x2 cel on layer 1 (Top) at (1, 1)
        let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&[
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 255, 255,
        ])
        .unwrap();
        let compressed = enc.finish().unwrap();

        let mut cel_f0 = Vec::new();
        cel_f0.extend_from_slice(&1u16.to_le_bytes()); // layer index 1
        cel_f0.extend_from_slice(&1i16.to_le_bytes()); // x = 1
        cel_f0.extend_from_slice(&1i16.to_le_bytes()); // y = 1
        cel_f0.push(255);
        cel_f0.extend_from_slice(&2u16.to_le_bytes()); // compressed image
        cel_f0.extend_from_slice(&[0u8; 7]);
        cel_f0.extend_from_slice(&2u16.to_le_bytes()); // cel w = 2
        cel_f0.extend_from_slice(&2u16.to_le_bytes()); // cel h = 2
        cel_f0.extend_from_slice(&compressed);

        // Tags chunk
        let mut tag_body = Vec::new();
        tag_body.extend_from_slice(&1u16.to_le_bytes());
        tag_body.extend_from_slice(&[0u8; 8]);
        tag_body.extend_from_slice(&0u16.to_le_bytes()); // from 0
        tag_body.extend_from_slice(&1u16.to_le_bytes()); // to 1
        tag_body.push(0);
        tag_body.extend_from_slice(&0u16.to_le_bytes());
        tag_body.extend_from_slice(&[0u8; 6]);
        tag_body.extend_from_slice(&[91, 140, 255]); // color
        tag_body.push(0);
        push_str(&mut tag_body, "walk");

        // Linked cel in frame 1 referencing frame 0
        let mut cel_f1 = Vec::new();
        cel_f1.extend_from_slice(&1u16.to_le_bytes());
        cel_f1.extend_from_slice(&0i16.to_le_bytes());
        cel_f1.extend_from_slice(&0i16.to_le_bytes());
        cel_f1.push(255);
        cel_f1.extend_from_slice(&1u16.to_le_bytes()); // linked
        cel_f1.extend_from_slice(&[0u8; 7]);
        cel_f1.extend_from_slice(&0u16.to_le_bytes()); // target frame 0

        let frame0 = wrap_frame(
            120,
            &[
                wrap_chunk(CHUNK_PALETTE, &pal),
                make_layer("Base"),
                make_layer("Top"),
                wrap_chunk(CHUNK_CEL, &cel_f0),
                wrap_chunk(CHUNK_TAGS, &tag_body),
            ],
        );
        let frame1 = wrap_frame(140, &[wrap_chunk(CHUNK_CEL, &cel_f1)]);

        let total_file_size = (128 + frame0.len() + frame1.len()) as u32;
        let mut header = vec![0u8; 128];
        header[0..4].copy_from_slice(&total_file_size.to_le_bytes());
        header[4..6].copy_from_slice(&ASE_MAGIC.to_le_bytes());
        header[6..8].copy_from_slice(&2u16.to_le_bytes()); // 2 frames
        header[8..10].copy_from_slice(&4u16.to_le_bytes()); // 4x4
        header[10..12].copy_from_slice(&4u16.to_le_bytes());
        header[12..14].copy_from_slice(&32u16.to_le_bytes()); // 32bpp RGBA
        header[18..20].copy_from_slice(&100u16.to_le_bytes());

        let mut file_bytes = header;
        file_bytes.extend_from_slice(&frame0);
        file_bytes.extend_from_slice(&frame1);

        let project = read_aseprite_bytes(&file_bytes).expect("parse .ase");
        assert_eq!(project.document.size, CanvasSize { width: 4, height: 4 });
        assert_eq!(project.document.frames.len(), 2);
        assert_eq!(project.document.frames[0].duration_ms, 120);
        assert_eq!(project.document.frames[1].duration_ms, 140);
        assert_eq!(project.document.layers.len(), 2);
        // Reversed top-to-bottom so "Top" is layers[0]
        assert_eq!(project.document.layers[0].name, "Top");
        assert_eq!(project.document.layers[1].name, "Base");
        assert_eq!(project.document.palette.colors, vec!["#0a141e", "#f0505a"]);
        assert_eq!(project.document.tags.len(), 1);
        assert_eq!(project.document.tags[0].name, "walk");

        let top_id = &project.document.layers[0].id;
        let rgba = project.cels.get(&cel_key(top_id, 0)).expect("cel pixel data");
        // (1, 1) -> red [255, 0, 0, 255]
        let idx_1_1 = (1 * 4 + 1) * 4;
        assert_eq!(&rgba[idx_1_1..idx_1_1 + 4], &[255, 0, 0, 255]);
        // Linked cel in frame 1
        assert_eq!(project.document.layers[0].cels[1].linked_frame, Some(0));
    }
}
