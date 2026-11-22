use std::collections::{HashMap, HashSet};

use crate::document::{BlendMode, Layer, LayerKind, TileProjection};
use crate::io::{cel_key, ProjectData};

fn blend_channel(dst: u8, src: u8, mode: BlendMode) -> f32 {
    let d = dst as f32 / 255.0;
    let s = src as f32 / 255.0;
    match mode {
        BlendMode::Multiply => d * s * 255.0,
        BlendMode::Screen => (1.0 - (1.0 - d) * (1.0 - s)) * 255.0,
        BlendMode::Overlay => {
            (if d < 0.5 {
                2.0 * d * s
            } else {
                1.0 - 2.0 * (1.0 - d) * (1.0 - s)
            }) * 255.0
        }
        BlendMode::Add => (d + s).min(1.0) * 255.0,
        BlendMode::Normal => src as f32,
    }
}

pub fn resolve_cel_frame(layer: &Layer, frame_index: u32) -> u32 {
    let mut cur = frame_index;
    let mut visited = HashSet::new();
    visited.insert(cur);

    loop {
        let cel = layer.cels.iter().find(|c| c.frame_index == cur);
        match cel.and_then(|c| c.linked_frame) {
            Some(target) if !visited.contains(&target) => {
                visited.insert(target);
                cur = target;
            }
            _ => break,
        }
    }
    cur
}

fn resolve_layer_effective(
    layer: &Layer,
    by_id: &HashMap<&str, &Layer>,
) -> (bool, f32) {
    let mut visible = layer.visible;
    let mut opacity = layer.opacity.clamp(0.0, 1.0);
    let mut visited = HashSet::new();
    visited.insert(layer.id.as_str());
    let mut parent_id = layer.parent_id.as_deref();

    while let Some(pid) = parent_id {
        if visited.contains(pid) {
            break;
        }
        visited.insert(pid);
        let Some(parent) = by_id.get(pid) else {
            break;
        };
        if !parent.visible {
            visible = false;
        }
        opacity *= parent.opacity.clamp(0.0, 1.0);
        parent_id = parent.parent_id.as_deref();
    }

    (visible, opacity)
}

#[allow(clippy::too_many_arguments)]
fn composite_rgba_region(
    dst: &mut [u8],
    dst_w: usize,
    dst_h: usize,
    src: &[u8],
    src_w: usize,
    src_h: usize,
    offset_x: i32,
    offset_y: i32,
    layer_opacity: f32,
    blend_mode: BlendMode,
) {
    if src.len() != src_w * src_h * 4 {
        return;
    }

    for sy in 0..src_h {
        let dy = offset_y + sy as i32;
        if dy < 0 || dy >= dst_h as i32 {
            continue;
        }
        for sx in 0..src_w {
            let dx = offset_x + sx as i32;
            if dx < 0 || dx >= dst_w as i32 {
                continue;
            }

            let si = (sy * src_w + sx) * 4;
            let raw_sa = src[si + 3];
            if raw_sa == 0 {
                continue;
            }

            let di = ((dy as usize) * dst_w + (dx as usize)) * 4;
            let sa = (raw_sa as f32 / 255.0) * layer_opacity;
            let da = dst[di + 3] as f32 / 255.0;
            let out_a = sa + da * (1.0 - sa);
            if out_a <= 0.0 {
                continue;
            }

            let sr = src[si] as f32;
            let sg = src[si + 1] as f32;
            let sb = src[si + 2] as f32;

            let (br, bg, bb) = if blend_mode != BlendMode::Normal && da > 0.0 {
                let mr = blend_channel(dst[di], src[si], blend_mode);
                let mg = blend_channel(dst[di + 1], src[si + 1], blend_mode);
                let mb = blend_channel(dst[di + 2], src[si + 2], blend_mode);
                (
                    mr * da + sr * (1.0 - da),
                    mg * da + sg * (1.0 - da),
                    mb * da + sb * (1.0 - da),
                )
            } else {
                (sr, sg, sb)
            };

            dst[di] = ((br * sa + dst[di] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[di + 1] =
                ((bg * sa + dst[di + 1] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[di + 2] =
                ((bb * sa + dst[di + 2] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[di + 3] = (out_a * 255.0).round() as u8;
        }
    }
}

/// Alpha-composites all visible layers for `frame_index` bottom-to-top into a raw RGBA buffer.
pub fn composite_frame(project: &ProjectData, frame_index: u32) -> Vec<u8> {
    let w = project.document.size.width as usize;
    let h = project.document.size.height as usize;
    let mut dst = vec![0u8; w * h * 4];

    let by_id: HashMap<&str, &Layer> = project
        .document
        .layers
        .iter()
        .map(|l| (l.id.as_str(), l))
        .collect();

    for layer in project.document.layers.iter().rev() {
        if layer.kind == LayerKind::Group {
            continue;
        }
        let (visible, layer_opacity) = resolve_layer_effective(layer, &by_id);
        if !visible || layer_opacity <= 0.0 {
            continue;
        }

        let resolved_frame = resolve_cel_frame(layer, frame_index);

        if layer.kind == LayerKind::Tilemap {
            let (Some(ts), Some(grid)) = (
                &project.document.tileset,
                layer.tilemaps.get(&resolved_frame),
            ) else {
                continue;
            };
            let tw = ts.tile_width as usize;
            let th = ts.tile_height as usize;
            let iso_h = (ts.tile_width / 2).max(4) as i32;
            let origin_x = (w as i32) / 2;
            let origin_y = iso_h / 2;

            for row in 0..grid.rows {
                for col in 0..grid.cols {
                    let idx = (row * grid.cols + col) as usize;
                    let Some(&cell) = grid.cells.get(idx) else {
                        continue;
                    };
                    let local_id = (cell & 0x000f_ffff) as usize;
                    if local_id == 0 {
                        continue;
                    }
                    let Some(tile_rgba) = project.tiles.get(local_id - 1) else {
                        continue;
                    };

                    let (ox, oy) = match project.document.tile_projection {
                        TileProjection::Isometric => {
                            let cx = origin_x + (col as i32 - row as i32) * (tw as i32 / 2);
                            let cy = origin_y + (col as i32 + row as i32) * (iso_h / 2);
                            (cx - (tw as i32 / 2), cy - (th as i32 / 2))
                        }
                        TileProjection::Orthogonal => {
                            ((col * ts.tile_width) as i32, (row * ts.tile_height) as i32)
                        }
                    };

                    composite_rgba_region(
                        &mut dst,
                        w,
                        h,
                        tile_rgba,
                        tw,
                        th,
                        ox,
                        oy,
                        layer_opacity,
                        layer.blend_mode,
                    );
                }
            }
            continue;
        }

        let key = cel_key(&layer.id, resolved_frame);
        let Some(src) = project.cels.get(&key) else {
            continue;
        };
        composite_rgba_region(
            &mut dst,
            w,
            h,
            src,
            w,
            h,
            0,
            0,
            layer_opacity,
            layer.blend_mode,
        );
    }

    dst
}
