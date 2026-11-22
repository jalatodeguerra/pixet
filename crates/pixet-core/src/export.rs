use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::composite::composite_frame;
use crate::document::{LayerKind, TileProjection};
use crate::io::{encode_rgba_png, PixetError, ProjectData};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackMode {
    Grid,
    Tight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Json,
    Godot,
    GodotTileset,
    Tiled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub pack: PackMode,
    pub trim: bool,
    pub extrude: u32,
    pub padding: u32,
    pub sheet_name: String,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            format: ExportFormat::Json,
            pack: PackMode::Tight,
            trim: false,
            extrude: 0,
            padding: 1,
            sheet_name: "spritesheet".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackedFrame {
    pub frame_index: u32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub source_x: u32,
    pub source_y: u32,
    pub source_w: u32,
    pub source_h: u32,
    pub trimmed: bool,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackedSheet {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub frames: Vec<PackedFrame>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportResult {
    pub png_path: PathBuf,
    pub metadata_path: PathBuf,
    pub sheet_width: u32,
    pub sheet_height: u32,
    pub frame_count: usize,
}

struct CroppedFrame {
    frame_index: u32,
    duration_ms: u32,
    source_x: u32,
    source_y: u32,
    source_w: u32,
    source_h: u32,
    w: u32,
    h: u32,
    trimmed: bool,
    rgba: Vec<u8>,
}

fn crop_frame_rgba(
    rgba: &[u8],
    src_w: u32,
    src_h: u32,
    frame_index: u32,
    duration_ms: u32,
    trim: bool,
) -> CroppedFrame {
    if !trim {
        return CroppedFrame {
            frame_index,
            duration_ms,
            source_x: 0,
            source_y: 0,
            source_w: src_w,
            source_h: src_h,
            w: src_w,
            h: src_h,
            trimmed: false,
            rgba: rgba.to_vec(),
        };
    }

    let mut min_x = src_w;
    let mut min_y = src_h;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut any = false;

    for y in 0..src_h {
        for x in 0..src_w {
            let idx = ((y * src_w + x) * 4 + 3) as usize;
            if rgba[idx] > 0 {
                any = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }

    if !any {
        return CroppedFrame {
            frame_index,
            duration_ms,
            source_x: 0,
            source_y: 0,
            source_w: src_w,
            source_h: src_h,
            w: 1,
            h: 1,
            trimmed: true,
            rgba: vec![0, 0, 0, 0],
        };
    }

    let w = max_x - min_x + 1;
    let h = max_y - min_y + 1;
    let trimmed = w != src_w || h != src_h;
    let mut cropped = vec![0u8; (w * h * 4) as usize];

    for row in 0..h {
        let src_start = (((min_y + row) * src_w + min_x) * 4) as usize;
        let src_end = src_start + (w * 4) as usize;
        let dst_start = (row * w * 4) as usize;
        cropped[dst_start..dst_start + (w * 4) as usize]
            .copy_from_slice(&rgba[src_start..src_end]);
    }

    CroppedFrame {
        frame_index,
        duration_ms,
        source_x: min_x,
        source_y: min_y,
        source_w: src_w,
        source_h: src_h,
        w,
        h,
        trimmed,
        rgba: cropped,
    }
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

impl Rect {
    fn contains(&self, other: &Rect) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.x + other.w <= self.x + self.w
            && other.y + other.h <= self.y + self.h
    }
}

fn try_pack_maxrects(
    items: &[(usize, u32, u32)],
    bin_w: u32,
    bin_h: u32,
) -> Option<Vec<(usize, u32, u32)>> {
    let mut free_rects = vec![Rect {
        x: 0,
        y: 0,
        w: bin_w,
        h: bin_h,
    }];
    let mut placements = Vec::with_capacity(items.len());

    for &(orig_idx, w, h) in items {
        let mut best_rect: Option<Rect> = None;
        let mut best_short = u32::MAX;
        let mut best_long = u32::MAX;

        for fr in &free_rects {
            if fr.w >= w && fr.h >= h {
                let leftover_h = fr.w - w;
                let leftover_v = fr.h - h;
                let short_side = leftover_h.min(leftover_v);
                let long_side = leftover_h.max(leftover_v);
                if short_side < best_short
                    || (short_side == best_short && long_side < best_long)
                {
                    best_short = short_side;
                    best_long = long_side;
                    best_rect = Some(Rect {
                        x: fr.x,
                        y: fr.y,
                        w,
                        h,
                    });
                }
            }
        }

        let placed = best_rect?;
        placements.push((orig_idx, placed.x, placed.y));

        // Split intersecting free rectangles
        let mut next_free = Vec::new();
        for fr in &free_rects {
            let intersects = !(placed.x >= fr.x + fr.w
                || placed.x + placed.w <= fr.x
                || placed.y >= fr.y + fr.h
                || placed.y + placed.h <= fr.y);
            if !intersects {
                next_free.push(*fr);
                continue;
            }
            if placed.x > fr.x {
                next_free.push(Rect {
                    x: fr.x,
                    y: fr.y,
                    w: placed.x - fr.x,
                    h: fr.h,
                });
            }
            if placed.x + placed.w < fr.x + fr.w {
                next_free.push(Rect {
                    x: placed.x + placed.w,
                    y: fr.y,
                    w: (fr.x + fr.w) - (placed.x + placed.w),
                    h: fr.h,
                });
            }
            if placed.y > fr.y {
                next_free.push(Rect {
                    x: fr.x,
                    y: fr.y,
                    w: fr.w,
                    h: placed.y - fr.y,
                });
            }
            if placed.y + placed.h < fr.y + fr.h {
                next_free.push(Rect {
                    x: fr.x,
                    y: placed.y + placed.h,
                    w: fr.w,
                    h: (fr.y + fr.h) - (placed.y + placed.h),
                });
            }
        }

        // Prune redundant free rectangles contained within others
        let mut pruned = Vec::with_capacity(next_free.len());
        for i in 0..next_free.len() {
            let mut contained = false;
            for j in 0..next_free.len() {
                if i != j && next_free[j].contains(&next_free[i]) {
                    contained = true;
                    break;
                }
            }
            if !contained {
                pruned.push(next_free[i]);
            }
        }
        free_rects = pruned;
    }

    Some(placements)
}

fn blit_with_extrude(
    sheet: &mut [u8],
    sheet_w: u32,
    frame_rgba: &[u8],
    dst_x: u32,
    dst_y: u32,
    w: u32,
    h: u32,
    extrude: u32,
) {
    let put_px = |buf: &mut [u8], x: u32, y: u32, px: [u8; 4]| {
        let idx = ((y * sheet_w + x) * 4) as usize;
        buf[idx..idx + 4].copy_from_slice(&px);
    };
    let get_src_px = |sx: u32, sy: u32| -> [u8; 4] {
        let idx = ((sy * w + sx) * 4) as usize;
        [
            frame_rgba[idx],
            frame_rgba[idx + 1],
            frame_rgba[idx + 2],
            frame_rgba[idx + 3],
        ]
    };

    for sy in 0..h {
        for sx in 0..w {
            put_px(sheet, dst_x + sx, dst_y + sy, get_src_px(sx, sy));
        }
    }

    if extrude == 0 {
        return;
    }

    // Top & bottom edge extrusion
    for sx in 0..w {
        let top_px = get_src_px(sx, 0);
        let bot_px = get_src_px(sx, h - 1);
        for e in 1..=extrude {
            put_px(sheet, dst_x + sx, dst_y - e, top_px);
            put_px(sheet, dst_x + sx, dst_y + h - 1 + e, bot_px);
        }
    }

    // Left & right edge extrusion
    for sy in 0..h {
        let left_px = get_src_px(0, sy);
        let right_px = get_src_px(w - 1, sy);
        for e in 1..=extrude {
            put_px(sheet, dst_x - e, dst_y + sy, left_px);
            put_px(sheet, dst_x + w - 1 + e, dst_y + sy, right_px);
        }
    }

    // 4 corner extrusion
    let tl = get_src_px(0, 0);
    let tr = get_src_px(w - 1, 0);
    let bl = get_src_px(0, h - 1);
    let br = get_src_px(w - 1, h - 1);
    for ey in 1..=extrude {
        for ex in 1..=extrude {
            put_px(sheet, dst_x - ex, dst_y - ey, tl);
            put_px(sheet, dst_x + w - 1 + ex, dst_y - ey, tr);
            put_px(sheet, dst_x - ex, dst_y + h - 1 + ey, bl);
            put_px(sheet, dst_x + w - 1 + ex, dst_y + h - 1 + ey, br);
        }
    }
}

pub fn pack_spritesheet(
    project: &ProjectData,
    opts: &ExportOptions,
) -> Result<PackedSheet, PixetError> {
    if project.document.frames.is_empty() {
        return Err(PixetError::InvalidProject(
            "Document has no frames to export".to_string(),
        ));
    }

    let src_w = project.document.size.width;
    let src_h = project.document.size.height;

    let mut cropped = Vec::with_capacity(project.document.frames.len());
    for f in &project.document.frames {
        let comp = composite_frame(project, f.index);
        cropped.push(crop_frame_rgba(
            &comp,
            src_w,
            src_h,
            f.index,
            f.duration_ms,
            opts.trim,
        ));
    }

    let n = cropped.len();
    let extrude = opts.extrude;
    let padding = opts.padding;

    let mut coords = vec![(0u32, 0u32); n];
    let sheet_w: u32;
    let sheet_h: u32;

    match opts.pack {
        PackMode::Grid => {
            let cols = (n as f64).sqrt().ceil() as usize;
            let rows = n.div_ceil(cols);
            let max_w = cropped.iter().map(|c| c.w).max().unwrap_or(1);
            let max_h = cropped.iter().map(|c| c.h).max().unwrap_or(1);
            let cell_w = max_w + 2 * extrude;
            let cell_h = max_h + 2 * extrude;

            sheet_w = (cols as u32) * cell_w + (cols.saturating_sub(1) as u32) * padding;
            sheet_h = (rows as u32) * cell_h + (rows.saturating_sub(1) as u32) * padding;

            for (i, pos) in coords.iter_mut().enumerate() {
                let col = (i % cols) as u32;
                let row = (i / cols) as u32;
                let sx = col * (cell_w + padding) + extrude;
                let sy = row * (cell_h + padding) + extrude;
                *pos = (sx, sy);
            }
        }
        PackMode::Tight => {
            let mut items: Vec<(usize, u32, u32)> = cropped
                .iter()
                .enumerate()
                .map(|(i, c)| (i, c.w + 2 * extrude + padding, c.h + 2 * extrude + padding))
                .collect();
            items.sort_by(|a, b| {
                let max_b = b.1.max(b.2);
                let max_a = a.1.max(a.2);
                max_b.cmp(&max_a).then_with(|| (b.1 * b.2).cmp(&(a.1 * a.2)))
            });

            let min_w = items.iter().map(|it| it.1).max().unwrap_or(1);
            let min_h = items.iter().map(|it| it.2).max().unwrap_or(1);
            let total_area: u64 = items.iter().map(|it| (it.1 as u64) * (it.2 as u64)).sum();
            let side = ((total_area as f64).sqrt().ceil() as u32)
                .max(min_w)
                .max(min_h);

            let mut bin_w = side.next_power_of_two().max(min_w);
            let mut bin_h = side.next_power_of_two().max(min_h);

            let placements = loop {
                if let Some(p) = try_pack_maxrects(&items, bin_w, bin_h) {
                    break p;
                }
                if bin_w <= bin_h {
                    bin_w *= 2;
                } else {
                    bin_h *= 2;
                }
            };

            let mut used_w = 1u32;
            let mut used_h = 1u32;
            for (orig_idx, px, py) in placements {
                let fx = px + extrude;
                let fy = py + extrude;
                coords[orig_idx] = (fx, fy);
                used_w = used_w.max(fx + cropped[orig_idx].w + extrude);
                used_h = used_h.max(fy + cropped[orig_idx].h + extrude);
            }
            sheet_w = used_w;
            sheet_h = used_h;
        }
    }

    let mut sheet_rgba = vec![0u8; (sheet_w * sheet_h * 4) as usize];
    let mut frames = Vec::with_capacity(n);

    for (i, c) in cropped.iter().enumerate() {
        let (fx, fy) = coords[i];
        blit_with_extrude(
            &mut sheet_rgba,
            sheet_w,
            &c.rgba,
            fx,
            fy,
            c.w,
            c.h,
            extrude,
        );
        frames.push(PackedFrame {
            frame_index: c.frame_index,
            x: fx,
            y: fy,
            w: c.w,
            h: c.h,
            source_x: c.source_x,
            source_y: c.source_y,
            source_w: c.source_w,
            source_h: c.source_h,
            trimmed: c.trimmed,
            duration_ms: c.duration_ms,
        });
    }

    Ok(PackedSheet {
        width: sheet_w,
        height: sheet_h,
        rgba: sheet_rgba,
        frames,
    })
}

pub fn generate_spritesheet_json(
    project: &ProjectData,
    sheet: &PackedSheet,
    png_filename: &str,
) -> String {
    let base_name = project
        .document
        .name
        .strip_suffix(".pixet")
        .unwrap_or(&project.document.name);

    let frames_json: Vec<serde_json::Value> = sheet
        .frames
        .iter()
        .map(|f| {
            json!({
                "filename": format!("{base_name}_{}.png", f.frame_index),
                "frame": { "x": f.x, "y": f.y, "w": f.w, "h": f.h },
                "rotated": false,
                "trimmed": f.trimmed,
                "spriteSourceSize": {
                    "x": f.source_x,
                    "y": f.source_y,
                    "w": f.w,
                    "h": f.h
                },
                "sourceSize": { "w": f.source_w, "h": f.source_h },
                "duration": f.duration_ms
            })
        })
        .collect();

    let tags_json: Vec<serde_json::Value> = project
        .document
        .tags
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "from": t.from_frame,
                "to": t.to_frame,
                "direction": "forward",
                "color": t.color
            })
        })
        .collect();

    let root = json!({
        "frames": frames_json,
        "meta": {
            "app": "pixet",
            "version": env!("CARGO_PKG_VERSION"),
            "image": png_filename,
            "format": "RGBA8888",
            "size": { "w": sheet.width, "h": sheet.height },
            "scale": "1",
            "frameTags": tags_json
        }
    });

    serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{}".to_string())
}

pub fn generate_godot_spriteframes(
    project: &ProjectData,
    sheet: &PackedSheet,
    png_filename: &str,
) -> String {
    let load_steps = 2 + sheet.frames.len();
    let mut out = String::new();
    out.push_str(&format!(
        "[gd_resource type=\"SpriteFrames\" load_steps={load_steps} format=3]\n\n"
    ));
    out.push_str(&format!(
        "[ext_resource type=\"Texture2D\" path=\"res://{png_filename}\" id=\"1_tex\"]\n\n"
    ));

    for (i, f) in sheet.frames.iter().enumerate() {
        out.push_str(&format!(
            "[sub_resource type=\"AtlasTexture\" id=\"AtlasTexture_{i}\"]\n"
        ));
        out.push_str("atlas = ExtResource(\"1_tex\")\n");
        out.push_str(&format!(
            "region = Rect2({}, {}, {}, {})\n",
            f.x, f.y, f.w, f.h
        ));
        if f.trimmed {
            out.push_str(&format!(
                "margin = Rect2({}, {}, {}, {})\n",
                f.source_x,
                f.source_y,
                f.source_w.saturating_sub(f.w),
                f.source_h.saturating_sub(f.h)
            ));
        }
        out.push('\n');
    }

    out.push_str("[resource]\n");
    out.push_str("animations = [");

    let build_anim_entries = |from: u32, to: u32| -> (String, f32) {
        let mut slice: Vec<&PackedFrame> = sheet
            .frames
            .iter()
            .filter(|f| f.frame_index >= from && f.frame_index <= to)
            .collect();
        if slice.is_empty() {
            slice = sheet.frames.iter().collect();
        }
        let avg_ms = (slice.iter().map(|f| f.duration_ms as f32).sum::<f32>()
            / (slice.len().max(1) as f32))
            .max(16.0);
        let speed = 1000.0 / avg_ms;

        let entries: Vec<String> = slice
            .iter()
            .map(|f| {
                let rel_dur = (f.duration_ms as f32 / avg_ms).max(0.1);
                format!(
                    "{{\n\"duration\": {rel_dur:.2},\n\"texture\": SubResource(\"AtlasTexture_{}\")\n}}",
                    f.frame_index
                )
            })
            .collect();

        (entries.join(", "), speed)
    };

    if project.document.tags.is_empty() {
        let max_idx = sheet.frames.len().saturating_sub(1) as u32;
        let (frames_str, speed) = build_anim_entries(0, max_idx);
        out.push_str(&format!(
            "{{\n\"frames\": [{frames_str}],\n\"loop\": true,\n\"name\": &\"default\",\n\"speed\": {speed:.2}\n}}"
        ));
    } else {
        let anim_blocks: Vec<String> = project
            .document
            .tags
            .iter()
            .map(|tag| {
                let (frames_str, speed) =
                    build_anim_entries(tag.from_frame, tag.to_frame);
                format!(
                    "{{\n\"frames\": [{frames_str}],\n\"loop\": true,\n\"name\": &\"{}\",\n\"speed\": {speed:.2}\n}}",
                    tag.name
                )
            })
            .collect();
        out.push_str(&anim_blocks.join(", "));
    }

    out.push_str("]\n");
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TilesetAtlas {
    pub width: u32,
    pub height: u32,
    pub cols: u32,
    pub rows: u32,
    pub tile_width: u32,
    pub tile_height: u32,
    pub tile_count: u32,
    pub extrude: u32,
    pub padding: u32,
    pub rgba: Vec<u8>,
}

pub fn build_tileset_atlas(
    project: &ProjectData,
    padding: u32,
    extrude: u32,
) -> Result<TilesetAtlas, PixetError> {
    let ts = project.document.tileset.as_ref().ok_or_else(|| {
        PixetError::InvalidProject("Project has no tileset to export".to_string())
    })?;
    if project.tiles.is_empty() {
        return Err(PixetError::InvalidProject(
            "Project has no tiles to export".to_string(),
        ));
    }

    let n = project.tiles.len() as u32;
    let cols = (n as f64).sqrt().ceil() as u32;
    let rows = n.div_ceil(cols);
    let cell_w = ts.tile_width + 2 * extrude;
    let cell_h = ts.tile_height + 2 * extrude;
    let atlas_w = cols * cell_w + cols.saturating_sub(1) * padding;
    let atlas_h = rows * cell_h + rows.saturating_sub(1) * padding;

    let mut rgba = vec![0u8; (atlas_w * atlas_h * 4) as usize];
    for (i, tile_rgba) in project.tiles.iter().enumerate() {
        let col = (i as u32) % cols;
        let row = (i as u32) / cols;
        let dst_x = col * (cell_w + padding) + extrude;
        let dst_y = row * (cell_h + padding) + extrude;
        if tile_rgba.len() == (ts.tile_width * ts.tile_height * 4) as usize {
            blit_with_extrude(
                &mut rgba,
                atlas_w,
                tile_rgba,
                dst_x,
                dst_y,
                ts.tile_width,
                ts.tile_height,
                extrude,
            );
        }
    }

    Ok(TilesetAtlas {
        width: atlas_w,
        height: atlas_h,
        cols,
        rows,
        tile_width: ts.tile_width,
        tile_height: ts.tile_height,
        tile_count: n,
        extrude,
        padding,
        rgba,
    })
}

pub fn generate_godot_tileset(
    project: &ProjectData,
    atlas: &TilesetAtlas,
    png_filename: &str,
) -> String {
    let mut out = String::new();
    out.push_str("[gd_resource type=\"TileSet\" load_steps=3 format=3]\n\n");
    out.push_str(&format!(
        "[ext_resource type=\"Texture2D\" path=\"res://{png_filename}\" id=\"1_tex\"]\n\n"
    ));
    out.push_str("[sub_resource type=\"TileSetAtlasSource\" id=\"TileSetAtlasSource_1\"]\n");
    out.push_str("texture = ExtResource(\"1_tex\")\n");
    if atlas.extrude > 0 {
        out.push_str(&format!(
            "margins = Vector2i({}, {})\n",
            atlas.extrude, atlas.extrude
        ));
    }
    let sep = atlas.padding + 2 * atlas.extrude;
    if sep > 0 {
        out.push_str(&format!("separation = Vector2i({sep}, {sep})\n"));
    }
    out.push_str(&format!(
        "texture_region_size = Vector2i({}, {})\n",
        atlas.tile_width, atlas.tile_height
    ));

    for i in 0..atlas.tile_count {
        let col = i % atlas.cols;
        let row = i / atlas.cols;
        out.push_str(&format!("{col}:{row}/0 = 0\n"));
    }

    out.push_str("\n[resource]\n");
    let effective_h = match project.document.tile_projection {
        TileProjection::Isometric => {
            out.push_str("tile_shape = 1\n");
            (atlas.tile_width / 2).max(4)
        }
        TileProjection::Orthogonal => atlas.tile_height,
    };
    out.push_str(&format!(
        "tile_size = Vector2i({}, {})\n",
        atlas.tile_width, effective_h
    ));
    out.push_str("sources/0 = SubResource(\"TileSetAtlasSource_1\")\n");
    out
}

pub fn generate_tiled_tileset_json(
    project: &ProjectData,
    atlas: &TilesetAtlas,
    png_filename: &str,
) -> String {
    let ts_name = project
        .document
        .tileset
        .as_ref()
        .map(|t| t.name.as_str())
        .unwrap_or("Pixet Tileset");

    let root = json!({
        "columns": atlas.cols,
        "image": png_filename,
        "imageheight": atlas.height,
        "imagewidth": atlas.width,
        "margin": atlas.extrude,
        "name": ts_name,
        "spacing": atlas.padding + 2 * atlas.extrude,
        "tilecount": atlas.tile_count,
        "tiledversion": "1.10.2",
        "tileheight": atlas.tile_height,
        "tilewidth": atlas.tile_width,
        "type": "tileset",
        "version": "1.10"
    });
    serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{}".to_string())
}

pub fn generate_tiled_tilemap_json(
    project: &ProjectData,
    atlas: &TilesetAtlas,
    tsj_filename: &str,
) -> String {
    let default_cols = (project.document.size.width / atlas.tile_width.max(1)).max(1);
    let default_rows = (project.document.size.height / atlas.tile_height.max(1)).max(1);

    let mut map_cols = default_cols;
    let mut map_rows = default_rows;

    let tilemap_layers: Vec<_> = project
        .document
        .layers
        .iter()
        .rev()
        .filter(|l| l.kind == LayerKind::Tilemap)
        .collect();

    for l in &tilemap_layers {
        if let Some(grid) = l.tilemaps.get(&0).or_else(|| l.tilemaps.values().next()) {
            map_cols = map_cols.max(grid.cols);
            map_rows = map_rows.max(grid.rows);
        }
    }

    let mut tiled_layers = Vec::new();
    for (idx, layer) in tilemap_layers.iter().enumerate() {
        let mut data = vec![0u32; (map_cols * map_rows) as usize];
        if let Some(grid) = layer.tilemaps.get(&0).or_else(|| layer.tilemaps.values().next()) {
            let mc = map_cols.min(grid.cols);
            let mr = map_rows.min(grid.rows);
            for r in 0..mr {
                for c in 0..mc {
                    let tile_id = grid.cells[(r * grid.cols + c) as usize];
                    data[(r * map_cols + c) as usize] = tile_id as u32;
                }
            }
        }
        tiled_layers.push(json!({
            "data": data,
            "height": map_rows,
            "id": idx + 1,
            "name": layer.name,
            "opacity": layer.opacity,
            "type": "tilelayer",
            "visible": layer.visible,
            "width": map_cols,
            "x": 0,
            "y": 0
        }));
    }

    let (orientation, cell_h) = match project.document.tile_projection {
        TileProjection::Isometric => ("isometric", (atlas.tile_width / 2).max(4)),
        TileProjection::Orthogonal => ("orthogonal", atlas.tile_height),
    };

    let root = json!({
        "compressionlevel": -1,
        "height": map_rows,
        "infinite": false,
        "layers": tiled_layers,
        "nextlayerid": tiled_layers.len() + 1,
        "nextobjectid": 1,
        "orientation": orientation,
        "renderorder": "right-down",
        "tiledversion": "1.10.2",
        "tileheight": cell_h,
        "tilesets": [{
            "firstgid": 1,
            "source": tsj_filename
        }],
        "tilewidth": atlas.tile_width,
        "type": "map",
        "version": "1.10",
        "width": map_cols
    });
    serde_json::to_string_pretty(&root).unwrap_or_else(|_| "{}".to_string())
}

pub fn export_project(
    project: &ProjectData,
    out_dir: impl AsRef<Path>,
    opts: &ExportOptions,
) -> Result<ExportResult, PixetError> {
    let out_dir = out_dir.as_ref();
    fs::create_dir_all(out_dir)?;

    let clean_name = if opts.sheet_name.trim().is_empty() {
        "spritesheet"
    } else {
        opts.sheet_name.trim()
    };

    match opts.format {
        ExportFormat::GodotTileset => {
            let atlas = build_tileset_atlas(project, opts.padding, opts.extrude)?;
            let png_filename = format!("{clean_name}_tileset.png");
            let png_path = out_dir.join(&png_filename);
            let png_bytes = encode_rgba_png(atlas.width, atlas.height, &atlas.rgba)?;
            fs::write(&png_path, png_bytes)?;

            let tres = generate_godot_tileset(project, &atlas, &png_filename);
            let metadata_path = out_dir.join(format!("{clean_name}_tileset.tres"));
            fs::write(&metadata_path, tres)?;

            return Ok(ExportResult {
                png_path,
                metadata_path,
                sheet_width: atlas.width,
                sheet_height: atlas.height,
                frame_count: atlas.tile_count as usize,
            });
        }
        ExportFormat::Tiled => {
            let atlas = build_tileset_atlas(project, opts.padding, opts.extrude)?;
            let png_filename = format!("{clean_name}_tileset.png");
            let png_path = out_dir.join(&png_filename);
            let png_bytes = encode_rgba_png(atlas.width, atlas.height, &atlas.rgba)?;
            fs::write(&png_path, png_bytes)?;

            let tsj_filename = format!("{clean_name}.tsj");
            let tsj_path = out_dir.join(&tsj_filename);
            fs::write(
                &tsj_path,
                generate_tiled_tileset_json(project, &atlas, &png_filename),
            )?;

            let tmj_path = out_dir.join(format!("{clean_name}.tmj"));
            fs::write(
                &tmj_path,
                generate_tiled_tilemap_json(project, &atlas, &tsj_filename),
            )?;

            return Ok(ExportResult {
                png_path,
                metadata_path: tmj_path,
                sheet_width: atlas.width,
                sheet_height: atlas.height,
                frame_count: atlas.tile_count as usize,
            });
        }
        ExportFormat::Json | ExportFormat::Godot => {}
    }

    let sheet = pack_spritesheet(project, opts)?;
    let png_filename = format!("{clean_name}.png");
    let png_path = out_dir.join(&png_filename);
    let png_bytes = encode_rgba_png(sheet.width, sheet.height, &sheet.rgba)?;
    fs::write(&png_path, png_bytes)?;

    let (ext, metadata_contents) = match opts.format {
        ExportFormat::Json => (
            "json",
            generate_spritesheet_json(project, &sheet, &png_filename),
        ),
        ExportFormat::Godot => (
            "tres",
            generate_godot_spriteframes(project, &sheet, &png_filename),
        ),
        ExportFormat::GodotTileset | ExportFormat::Tiled => unreachable!(),
    };

    let metadata_path = out_dir.join(format!("{clean_name}.{ext}"));
    fs::write(&metadata_path, metadata_contents)?;

    Ok(ExportResult {
        png_path,
        metadata_path,
        sheet_width: sheet.width,
        sheet_height: sheet.height,
        frame_count: sheet.frames.len(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::document::Document;
    use crate::io::{cel_key, read_pixet_bytes, write_pixet_bytes};

    fn make_sample_project() -> ProjectData {
        let doc = Document::new_default(8, 8);
        let mut cels = HashMap::new();

        for f in 0..4u32 {
            let mut base = vec![0u8; 8 * 8 * 4];
            // Paint a 2x2 pixel block shifted by frame index
            for dy in 0..2u32 {
                for dx in 0..2u32 {
                    let x = f + dx;
                    let y = 2 + dy;
                    let idx = ((y * 8 + x) * 4) as usize;
                    base[idx] = 91;
                    base[idx + 1] = 140;
                    base[idx + 2] = 255;
                    base[idx + 3] = 255;
                }
            }
            cels.insert(cel_key("layer-base", f), base);
        }

        ProjectData {
            document: doc,
            cels,
            tiles: Vec::new(),
        }
    }

    #[test]
    fn pixet_zip_round_trip() {
        let project = make_sample_project();
        let bytes = write_pixet_bytes(&project).expect("write .pixet zip");
        let loaded = read_pixet_bytes(&bytes).expect("read .pixet zip");
        assert_eq!(project.document, loaded.document);
        assert_eq!(project.cels.len(), loaded.cels.len());
        assert_eq!(
            project.cels.get("layer-base:2"),
            loaded.cels.get("layer-base:2")
        );
    }

    #[test]
    fn pack_grid_and_tight_with_trim_and_extrude() {
        let project = make_sample_project();

        let grid = pack_spritesheet(
            &project,
            &ExportOptions {
                format: ExportFormat::Json,
                pack: PackMode::Grid,
                trim: false,
                extrude: 1,
                padding: 1,
                sheet_name: "hero".to_string(),
            },
        )
        .expect("grid pack");
        // 2x2 grid of (8 + 2*1) = 10px cells + 1px padding = 21x21
        assert_eq!(grid.width, 21);
        assert_eq!(grid.height, 21);
        assert_eq!(grid.frames.len(), 4);

        // Verify extrusion copied edge pixel at (fx - 1, fy) for frame 0
        let f0 = &grid.frames[0];
        // Frame 0 painted (0,2), so at (f0.x - 1, f0.y + 2) should be blue
        let ext_idx = (((f0.y + 2) * grid.width + (f0.x - 1)) * 4) as usize;
        assert_eq!(grid.rgba[ext_idx + 2], 255);
        assert_eq!(grid.rgba[ext_idx + 3], 255);

        let tight = pack_spritesheet(
            &project,
            &ExportOptions {
                format: ExportFormat::Json,
                pack: PackMode::Tight,
                trim: true,
                extrude: 0,
                padding: 1,
                sheet_name: "hero".to_string(),
            },
        )
        .expect("tight pack");
        assert_eq!(tight.frames.len(), 4);
        assert!(tight.frames.iter().all(|f| f.trimmed && f.w == 2 && f.h == 2));
        assert!(tight.width <= 12 && tight.height <= 12);
    }

    #[test]
    fn json_and_godot_export_formats() {
        let project = make_sample_project();
        let sheet = pack_spritesheet(
            &project,
            &ExportOptions {
                format: ExportFormat::Godot,
                pack: PackMode::Tight,
                trim: true,
                extrude: 0,
                padding: 1,
                sheet_name: "hero".to_string(),
            },
        )
        .expect("pack");

        let json_str = generate_spritesheet_json(&project, &sheet, "hero.png");
        let parsed: serde_json::Value =
            serde_json::from_str(&json_str).expect("valid spritesheet json");
        assert_eq!(parsed["frames"].as_array().unwrap().len(), 4);
        assert_eq!(parsed["meta"]["image"], "hero.png");
        assert_eq!(parsed["meta"]["frameTags"][0]["name"], "idle");

        let tres = generate_godot_spriteframes(&project, &sheet, "hero.png");
        assert!(tres.contains("[gd_resource type=\"SpriteFrames\" load_steps=6 format=3]"));
        assert!(tres.contains("path=\"res://hero.png\""));
        assert!(tres.contains("[sub_resource type=\"AtlasTexture\" id=\"AtlasTexture_0\"]"));
        assert!(tres.contains("\"name\": &\"idle\""));
        assert!(tres.contains("margin = Rect2("));
    }

    #[test]
    fn tileset_zip_round_trip_and_godot_tiled_exports() {
        use crate::document::{Layer, TilemapGrid, TilesetMeta};
        use std::collections::BTreeMap;

        let mut project = make_sample_project();
        project.document.size = crate::document::CanvasSize {
            width: 16,
            height: 8,
        };
        project.document.tile_projection = TileProjection::Isometric;
        project.document.tileset = Some(TilesetMeta {
            id: "ts-1".to_string(),
            name: "IsoTerrain".to_string(),
            tile_width: 8,
            tile_height: 8,
            tile_count: 2,
        });
        // Tile 1 = solid red, Tile 2 = solid green
        let tile1 = vec![255, 0, 0, 255].repeat(8 * 8);
        let tile2 = vec![0, 255, 0, 255].repeat(8 * 8);
        project.tiles = vec![tile1, tile2];

        let mut tilemaps = BTreeMap::new();
        tilemaps.insert(
            0,
            TilemapGrid {
                cols: 2,
                rows: 2,
                cells: vec![1, 2, 0, 1],
            },
        );
        project.document.layers.insert(
            0,
            Layer {
                id: "tilemap-1".to_string(),
                name: "Ground".to_string(),
                kind: LayerKind::Tilemap,
                visible: true,
                locked: false,
                opacity: 1.0,
                alpha_lock: false,
                blend_mode: crate::document::BlendMode::Normal,
                parent_id: None,
                cels: Vec::new(),
                tilemaps,
                map_role: None,
            },
        );
        project.cels.clear();

        // Round-trip ZIP with tileset PNGs and TilemapGrid
        let zip_bytes = write_pixet_bytes(&project).expect("write .pixet with tiles");
        let loaded = read_pixet_bytes(&zip_bytes).expect("read .pixet with tiles");
        assert_eq!(loaded.tiles.len(), 2);
        assert_eq!(loaded.document.tileset, project.document.tileset);
        assert_eq!(
            loaded.document.tile_projection,
            TileProjection::Isometric
        );

        // Headless composite renders isometric tilemap
        let comp = composite_frame(&loaded, 0);
        assert!(comp.chunks_exact(4).any(|px| px == [255, 0, 0, 255]));

        // Godot 4 TileSet (.tres)
        let atlas = build_tileset_atlas(&loaded, 1, 1).expect("atlas");
        let godot_ts = generate_godot_tileset(&loaded, &atlas, "terrain_tileset.png");
        assert!(godot_ts.contains("[gd_resource type=\"TileSet\" load_steps=3 format=3]"));
        assert!(godot_ts.contains("tile_shape = 1"));
        assert!(godot_ts.contains("0:0/0 = 0"));
        assert!(godot_ts.contains("1:0/0 = 0"));

        // Tiled (.tsj + .tmj)
        let tsj = generate_tiled_tileset_json(&loaded, &atlas, "terrain_tileset.png");
        let tsj_val: serde_json::Value = serde_json::from_str(&tsj).expect("valid tsj");
        assert_eq!(tsj_val["tilecount"], 2);

        let tmj = generate_tiled_tilemap_json(&loaded, &atlas, "terrain.tsj");
        let tmj_val: serde_json::Value = serde_json::from_str(&tmj).expect("valid tmj");
        assert_eq!(tmj_val["orientation"], "isometric");
        assert_eq!(tmj_val["layers"][0]["data"], json!([1, 2, 0, 1]));
    }
}
