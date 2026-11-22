use std::collections::{HashMap, HashSet};

use crate::document::{BlendMode, Layer, LayerKind};
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
        let key = cel_key(&layer.id, resolved_frame);
        let Some(src) = project.cels.get(&key) else {
            continue;
        };
        if src.len() != dst.len() {
            continue;
        }

        for i in (0..dst.len()).step_by(4) {
            let raw_sa = src[i + 3];
            if raw_sa == 0 {
                continue;
            }
            let sa = (raw_sa as f32 / 255.0) * layer_opacity;
            let da = dst[i + 3] as f32 / 255.0;
            let out_a = sa + da * (1.0 - sa);
            if out_a <= 0.0 {
                continue;
            }

            let sr = src[i] as f32;
            let sg = src[i + 1] as f32;
            let sb = src[i + 2] as f32;

            let (br, bg, bb) = if layer.blend_mode != BlendMode::Normal && da > 0.0 {
                let mr = blend_channel(dst[i], src[i], layer.blend_mode);
                let mg = blend_channel(dst[i + 1], src[i + 1], layer.blend_mode);
                let mb = blend_channel(dst[i + 2], src[i + 2], layer.blend_mode);
                (
                    mr * da + sr * (1.0 - da),
                    mg * da + sg * (1.0 - da),
                    mb * da + sb * (1.0 - da),
                )
            } else {
                (sr, sg, sb)
            };

            dst[i] = ((br * sa + dst[i] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[i + 1] =
                ((bg * sa + dst[i + 1] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[i + 2] =
                ((bb * sa + dst[i + 2] as f32 * da * (1.0 - sa)) / out_a).round() as u8;
            dst[i + 3] = (out_a * 255.0).round() as u8;
        }
    }

    dst
}
