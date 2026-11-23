use std::collections::{HashMap, HashSet};

use crate::document::{BlendMode, Layer, LayerKind, TileProjection};
use crate::io::{cel_key, ProjectData};

#[inline]
fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

#[inline]
fn hard_light_channel(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cb * (2.0 * cs)
    } else {
        1.0 - (1.0 - cb) * (2.0 * (1.0 - cs))
    }
}

#[inline]
fn color_dodge_channel(cb: f32, cs: f32) -> f32 {
    if cb == 0.0 {
        0.0
    } else if cs >= 1.0 {
        1.0
    } else {
        (cb / (1.0 - cs)).min(1.0)
    }
}

#[inline]
fn color_burn_channel(cb: f32, cs: f32) -> f32 {
    if cb == 1.0 {
        1.0
    } else if cs <= 0.0 {
        0.0
    } else {
        1.0 - ((1.0 - cb) / cs).min(1.0)
    }
}

#[inline]
fn soft_light_channel(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
    } else {
        let d = if cb <= 0.25 {
            ((16.0 * cb - 12.0) * cb + 4.0) * cb
        } else {
            cb.sqrt()
        };
        cb + (2.0 * cs - 1.0) * (d - cb)
    }
}

#[inline]
fn lum(r: f32, g: f32, b: f32) -> f32 {
    0.3 * r + 0.59 * g + 0.11 * b
}

fn clip_color(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let l = lum(r, g, b);
    let n = r.min(g).min(b);
    let x = r.max(g).max(b);
    let (mut cr, mut cg, mut cb) = (r, g, b);
    if n < 0.0 {
        let denom = l - n;
        if denom > 0.0 {
            cr = l + ((cr - l) * l) / denom;
            cg = l + ((cg - l) * l) / denom;
            cb = l + ((cb - l) * l) / denom;
        } else {
            cr = l;
            cg = l;
            cb = l;
        }
    }
    if x > 1.0 {
        let denom = x - l;
        if denom > 0.0 {
            cr = l + ((cr - l) * (1.0 - l)) / denom;
            cg = l + ((cg - l) * (1.0 - l)) / denom;
            cb = l + ((cb - l) * (1.0 - l)) / denom;
        } else {
            cr = l;
            cg = l;
            cb = l;
        }
    }
    (clamp01(cr), clamp01(cg), clamp01(cb))
}

fn set_lum(r: f32, g: f32, b: f32, target_l: f32) -> (f32, f32, f32) {
    let d = target_l - lum(r, g, b);
    clip_color(r + d, g + d, b + d)
}

#[inline]
fn sat(r: f32, g: f32, b: f32) -> f32 {
    r.max(g).max(b) - r.min(g).min(b)
}

fn set_sat(r: f32, g: f32, b: f32, s: f32) -> (f32, f32, f32) {
    let c = [r, g, b];
    let mut min_idx = 0usize;
    let mut mid_idx = 1usize;
    let mut max_idx = 2usize;
    if c[min_idx] > c[mid_idx] {
        std::mem::swap(&mut min_idx, &mut mid_idx);
    }
    if c[mid_idx] > c[max_idx] {
        std::mem::swap(&mut mid_idx, &mut max_idx);
    }
    if c[min_idx] > c[mid_idx] {
        std::mem::swap(&mut min_idx, &mut mid_idx);
    }

    let mut out = [0.0f32; 3];
    if c[max_idx] > c[min_idx] {
        out[mid_idx] = ((c[mid_idx] - c[min_idx]) * s) / (c[max_idx] - c[min_idx]);
        out[max_idx] = s;
    } else {
        out[mid_idx] = 0.0;
        out[max_idx] = 0.0;
    }
    out[min_idx] = 0.0;
    (out[0], out[1], out[2])
}

pub fn blend_rgb(
    dr: f32,
    dg: f32,
    db: f32,
    sr: f32,
    sg: f32,
    sb: f32,
    mode: BlendMode,
) -> (f32, f32, f32) {
    match mode {
        BlendMode::Normal => (sr, sg, sb),
        BlendMode::Multiply => (dr * sr, dg * sg, db * sb),
        BlendMode::Screen => (
            1.0 - (1.0 - dr) * (1.0 - sr),
            1.0 - (1.0 - dg) * (1.0 - sg),
            1.0 - (1.0 - db) * (1.0 - sb),
        ),
        BlendMode::Overlay => (
            hard_light_channel(sr, dr),
            hard_light_channel(sg, dg),
            hard_light_channel(sb, db),
        ),
        BlendMode::Add => ((dr + sr).min(1.0), (dg + sg).min(1.0), (db + sb).min(1.0)),
        BlendMode::Darken => (dr.min(sr), dg.min(sg), db.min(sb)),
        BlendMode::Lighten => (dr.max(sr), dg.max(sg), db.max(sb)),
        BlendMode::ColorDodge => (
            color_dodge_channel(dr, sr),
            color_dodge_channel(dg, sg),
            color_dodge_channel(db, sb),
        ),
        BlendMode::ColorBurn => (
            color_burn_channel(dr, sr),
            color_burn_channel(dg, sg),
            color_burn_channel(db, sb),
        ),
        BlendMode::HardLight => (
            hard_light_channel(dr, sr),
            hard_light_channel(dg, sg),
            hard_light_channel(db, sb),
        ),
        BlendMode::SoftLight => (
            soft_light_channel(dr, sr),
            soft_light_channel(dg, sg),
            soft_light_channel(db, sb),
        ),
        BlendMode::Difference => ((dr - sr).abs(), (dg - sg).abs(), (db - sb).abs()),
        BlendMode::Hue => {
            let (hr, hg, hb) = set_sat(sr, sg, sb, sat(dr, dg, db));
            set_lum(hr, hg, hb, lum(dr, dg, db))
        }
        BlendMode::Saturation => {
            let (sr2, sg2, sb2) = set_sat(dr, dg, db, sat(sr, sg, sb));
            set_lum(sr2, sg2, sb2, lum(dr, dg, db))
        }
        BlendMode::Color => set_lum(sr, sg, sb, lum(dr, dg, db)),
        BlendMode::Luminosity => set_lum(dr, dg, db, lum(sr, sg, sb)),
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
    clip_base_alpha: Option<&[u8]>,
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

            let p_idx = (dy as usize) * dst_w + (dx as usize);
            let clip_factor = match clip_base_alpha {
                Some(mask) => mask[p_idx] as f32 / 255.0,
                None => 1.0,
            };
            if clip_factor <= 0.0 {
                continue;
            }

            let di = p_idx * 4;
            let sa = (raw_sa as f32 / 255.0) * layer_opacity * clip_factor;
            let da = dst[di + 3] as f32 / 255.0;
            let out_a = sa + da * (1.0 - sa);
            if out_a <= 0.0 {
                continue;
            }

            let sr = src[si] as f32;
            let sg = src[si + 1] as f32;
            let sb = src[si + 2] as f32;

            let (br, bg, bb) = if blend_mode != BlendMode::Normal && da > 0.0 {
                let (mr, mg, mb) = blend_rgb(
                    dst[di] as f32 / 255.0,
                    dst[di + 1] as f32 / 255.0,
                    dst[di + 2] as f32 / 255.0,
                    sr / 255.0,
                    sg / 255.0,
                    sb / 255.0,
                    blend_mode,
                );
                let mr = mr * 255.0;
                let mg = mg * 255.0;
                let mb = mb * 255.0;
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
    let pixel_count = w * h;
    let mut dst = vec![0u8; pixel_count * 4];
    let mut clip_base_alpha: Option<Vec<u8>> = None;

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
        let is_clipped = layer.clipped;
        if !visible || layer_opacity <= 0.0 {
            if !is_clipped && matches!(layer.kind, LayerKind::Raster | LayerKind::Tilemap) {
                clip_base_alpha = None;
            }
            continue;
        }

        if is_clipped && clip_base_alpha.is_none() {
            continue;
        }

        let resolved_frame = resolve_cel_frame(layer, frame_index);

        if layer.kind == LayerKind::Tilemap {
            if !is_clipped {
                let mut base_alpha = vec![0u8; pixel_count];
                if let (Some(ts), Some(grid)) = (
                    &project.document.tileset,
                    layer.tilemaps.get(&resolved_frame),
                ) {
                    let tw = ts.tile_width as usize;
                    let th = ts.tile_height as usize;
                    let iso_h = (ts.tile_width / 2).max(4) as i32;
                    let origin_x = (w as i32) / 2;
                    let origin_y = iso_h / 2;
                    let mut scratch = vec![0u8; pixel_count * 4];

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
                                    let cx =
                                        origin_x + (col as i32 - row as i32) * (tw as i32 / 2);
                                    let cy = origin_y + (col as i32 + row as i32) * (iso_h / 2);
                                    (cx - (tw as i32 / 2), cy - (th as i32 / 2))
                                }
                                TileProjection::Orthogonal => {
                                    ((col * ts.tile_width) as i32, (row * ts.tile_height) as i32)
                                }
                            };
                            composite_rgba_region(
                                &mut scratch,
                                w,
                                h,
                                tile_rgba,
                                tw,
                                th,
                                ox,
                                oy,
                                layer_opacity,
                                BlendMode::Normal,
                                None,
                            );
                        }
                    }
                    for p in 0..pixel_count {
                        base_alpha[p] = scratch[p * 4 + 3];
                    }
                }
                clip_base_alpha = Some(base_alpha);
            }

            let active_clip = if is_clipped {
                clip_base_alpha.as_deref()
            } else {
                None
            };

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
                        active_clip,
                    );
                }
            }
            continue;
        }

        let key = cel_key(&layer.id, resolved_frame);
        let src_opt = project.cels.get(&key);

        if !is_clipped && layer.kind == LayerKind::Raster {
            let mut base_alpha = vec![0u8; pixel_count];
            if let Some(src) = src_opt {
                if src.len() == pixel_count * 4 {
                    for p in 0..pixel_count {
                        let a = src[p * 4 + 3];
                        if a > 0 {
                            base_alpha[p] = ((a as f32) * layer_opacity).round() as u8;
                        }
                    }
                }
            }
            clip_base_alpha = Some(base_alpha);
        }

        let active_clip = if is_clipped {
            clip_base_alpha.as_deref()
        } else {
            None
        };

        let Some(src) = src_opt else {
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
            active_clip,
        );
    }

    dst
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{Document, SCHEMA_VERSION};
    use std::collections::BTreeMap;

    #[test]
    fn blend_rgb_matches_all_16_modes() {
        let approx = |a: (f32, f32, f32), b: (f32, f32, f32), name: &str| {
            assert!((a.0 - b.0).abs() < 1e-5, "{name} r: {} vs {}", a.0, b.0);
            assert!((a.1 - b.1).abs() < 1e-5, "{name} g: {} vs {}", a.1, b.1);
            assert!((a.2 - b.2).abs() < 1e-5, "{name} b: {} vs {}", a.2, b.2);
        };

        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Normal),
            (0.2, 0.8, 0.5),
            "Normal",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Multiply),
            (0.08, 0.48, 0.4),
            "Multiply",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Screen),
            (1.0 - 0.6 * 0.8, 1.0 - 0.4 * 0.2, 1.0 - 0.2 * 0.5),
            "Screen",
        );
        approx(
            blend_rgb(0.25, 0.75, 0.5, 0.6, 0.4, 0.8, BlendMode::Overlay),
            (2.0 * 0.25 * 0.6, 1.0 - 2.0 * 0.25 * 0.6, 0.8),
            "Overlay",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Add),
            (0.6, 1.0, 1.0),
            "Add",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Darken),
            (0.2, 0.6, 0.5),
            "Darken",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, BlendMode::Lighten),
            (0.4, 0.8, 0.8),
            "Lighten",
        );
        approx(
            blend_rgb(0.3, 0.5, 0.2, 0.5, 0.2, 0.6, BlendMode::ColorDodge),
            (0.6, 0.625, 0.5),
            "ColorDodge",
        );
        approx(
            blend_rgb(1.0, 0.5, 0.8, 0.3, 0.0, 0.5, BlendMode::ColorBurn),
            (1.0, 0.0, 0.6),
            "ColorBurn",
        );
        approx(
            blend_rgb(0.6, 0.4, 0.8, 0.25, 0.75, 0.5, BlendMode::HardLight),
            (2.0 * 0.6 * 0.25, 1.0 - 2.0 * 0.6 * 0.25, 0.8),
            "HardLight",
        );
        approx(
            blend_rgb(0.16, 0.64, 0.5, 0.25, 0.75, 0.5, BlendMode::SoftLight),
            (
                0.16 - (1.0 - 0.5) * 0.16 * 0.84,
                0.64 + (1.5 - 1.0) * (0.64f32.sqrt() - 0.64),
                0.5,
            ),
            "SoftLight",
        );
        approx(
            blend_rgb(0.4, 0.6, 0.8, 0.7, 0.2, 0.8, BlendMode::Difference),
            (0.3, 0.4, 0.0),
            "Difference",
        );

        let hue = blend_rgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, BlendMode::Hue);
        assert!((lum(hue.0, hue.1, hue.2) - lum(0.8, 0.2, 0.2)).abs() < 1e-5);
        assert!(hue.2 > hue.1 && hue.1 > hue.0);

        let sat_out = blend_rgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, BlendMode::Saturation);
        assert!((lum(sat_out.0, sat_out.1, sat_out.2) - lum(0.8, 0.2, 0.2)).abs() < 1e-5);
        assert!((sat(sat_out.0, sat_out.1, sat_out.2) - 0.7).abs() < 1e-5);

        let color_out = blend_rgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, BlendMode::Color);
        assert!((lum(color_out.0, color_out.1, color_out.2) - lum(0.8, 0.2, 0.2)).abs() < 1e-5);
        assert!(color_out.2 > color_out.1 && color_out.1 > color_out.0);

        let lum_out = blend_rgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, BlendMode::Luminosity);
        assert!((lum(lum_out.0, lum_out.1, lum_out.2) - lum(0.2, 0.4, 0.9)).abs() < 1e-5);
        assert!(lum_out.0 > lum_out.1 && (lum_out.1 - lum_out.2).abs() < 1e-5);
    }

    #[test]
    fn composite_clipping_masks_and_legacy_json_compat() {
        let mut doc = Document::new_default(3, 1);
        let make_raster = |id: &str, blend_mode: BlendMode, clipped: bool, color_tag: Option<&str>| Layer {
            id: id.to_string(),
            name: id.to_string(),
            kind: LayerKind::Raster,
            visible: true,
            locked: false,
            opacity: 1.0,
            alpha_lock: false,
            blend_mode,
            parent_id: None,
            clipped,
            color_tag: color_tag.map(str::to_string),
            cels: Vec::new(),
            tilemaps: BTreeMap::new(),
            map_role: None,
        };

        // Top-to-bottom order: clip2 (top) -> clip1 -> base (bottom)
        doc.layers = vec![
            make_raster("clip2", BlendMode::Lighten, true, Some("#5fcde4")),
            make_raster("clip1", BlendMode::Normal, true, None),
            make_raster("base", BlendMode::Normal, false, Some("#d95763")),
        ];

        let mut cels = HashMap::new();
        // base: px0 opaque blue, px1 128 alpha blue, px2 transparent
        cels.insert(
            cel_key("base", 0),
            vec![0, 0, 255, 255, 0, 0, 255, 128, 0, 0, 0, 0],
        );
        // clip1: solid red everywhere
        cels.insert(
            cel_key("clip1", 0),
            vec![255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255],
        );
        // clip2: 128-alpha green everywhere
        cels.insert(
            cel_key("clip2", 0),
            vec![0, 255, 0, 128, 0, 255, 0, 128, 0, 255, 0, 128],
        );

        let project = ProjectData {
            document: doc.clone(),
            cels,
            tiles: Vec::new(),
        };

        let out = composite_frame(&project, 0);
        // px0: clip1 red + clip2 Lighten green at ~50% alpha -> (255, 128, 0, 255)
        assert_eq!(&out[0..4], &[255, 128, 0, 255]);
        // px1: partially clipped onto semi-transparent base (non-zero, alpha < 255)
        assert!(out[7] > 128 && out[7] < 255);
        // px2: transparent base -> clipped layers produce nothing
        assert_eq!(&out[8..12], &[0, 0, 0, 0]);

        // Backward-compatible JSON deserialization without clipped / color_tag and with new blend_mode
        let legacy_json = format!(
            r##"{{
              "schema_version": {SCHEMA_VERSION},
              "name": "legacy.pixet",
              "size": {{ "width": 2, "height": 2 }},
              "color_mode": "rgba",
              "palette": {{ "name": "Test", "colors": ["#000000"] }},
              "layers": [{{
                "id": "l1",
                "name": "Layer 1",
                "kind": "raster",
                "visible": true,
                "locked": false,
                "opacity": 1.0,
                "alpha_lock": false,
                "blend_mode": "color_dodge",
                "parent_id": null,
                "cels": []
              }}],
              "frames": [{{ "id": "f1", "index": 0, "duration_ms": 100 }}],
              "tags": []
            }}"##
        );
        let parsed = Document::from_json(&legacy_json).expect("parse legacy JSON");
        assert_eq!(parsed.layers[0].blend_mode, BlendMode::ColorDodge);
        assert!(!parsed.layers[0].clipped);
        assert_eq!(parsed.layers[0].color_tag, None);

        // Round-trip new fields
        let json_with_new = doc.to_json_pretty().expect("serialize doc");
        let reparsed = Document::from_json(&json_with_new).expect("reparse doc");
        assert_eq!(reparsed.layers[0].blend_mode, BlendMode::Lighten);
        assert!(reparsed.layers[0].clipped);
        assert_eq!(reparsed.layers[0].color_tag.as_deref(), Some("#5fcde4"));
    }
}
