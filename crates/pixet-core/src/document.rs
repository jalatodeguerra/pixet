use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Current schema version for `.pixet` document manifests.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanvasSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorMode {
    Rgba,
    Indexed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Add,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    Raster,
    Group,
    Tilemap,
    Rig,
    Data,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TileProjection {
    #[default]
    Orthogonal,
    Isometric,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TilesetMeta {
    pub id: String,
    pub name: String,
    pub tile_width: u32,
    pub tile_height: u32,
    pub tile_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TilemapGrid {
    pub cols: u32,
    pub rows: u32,
    pub cells: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cel {
    pub id: String,
    pub frame_index: u32,
    pub linked_to: Option<String>,
    #[serde(default)]
    pub linked_frame: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub kind: LayerKind,
    pub visible: bool,
    pub locked: bool,
    pub opacity: f32,
    pub alpha_lock: bool,
    pub blend_mode: BlendMode,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub clipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_tag: Option<String>,
    pub cels: Vec<Cel>,
    #[serde(default)]
    pub tilemaps: BTreeMap<u32, TilemapGrid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map_role: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frame {
    pub id: String,
    pub index: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnimationTag {
    pub id: String,
    pub name: String,
    pub from_frame: u32,
    pub to_frame: u32,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Palette {
    pub name: String,
    pub colors: Vec<String>,
}

fn default_tiles_version() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub schema_version: u32,
    pub name: String,
    pub size: CanvasSize,
    pub color_mode: ColorMode,
    pub palette: Palette,
    pub layers: Vec<Layer>,
    pub frames: Vec<Frame>,
    pub tags: Vec<AnimationTag>,
    #[serde(default)]
    pub tileset: Option<TilesetMeta>,
    #[serde(default)]
    pub tile_projection: TileProjection,
    #[serde(default = "default_tiles_version")]
    pub tiles_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiles_ext: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draw_ext: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rig: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_data: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model3d_ext: Option<serde_json::Value>,
}

impl Document {
    /// Creates a new default document with standard pixel-art layers, 4 animation frames, and a curated 16-color palette.
    pub fn new_default(width: u32, height: u32) -> Self {
        let frames: Vec<Frame> = (0..4)
            .map(|i| Frame {
                id: format!("frame-{}", i + 1),
                index: i,
                duration_ms: 100,
            })
            .collect();

        let make_layer = |id: &str, name: &str| Layer {
            id: id.to_string(),
            name: name.to_string(),
            kind: LayerKind::Raster,
            visible: true,
            locked: false,
            opacity: 1.0,
            alpha_lock: false,
            blend_mode: BlendMode::Normal,
            parent_id: None,
            clipped: false,
            color_tag: None,
            cels: vec![Cel {
                id: format!("{id}-cel-1"),
                frame_index: 0,
                linked_to: None,
                linked_frame: None,
            }],
            tilemaps: BTreeMap::new(),
            map_role: None,
        };

        Self {
            schema_version: SCHEMA_VERSION,
            name: "untitled.pixet".to_string(),
            size: CanvasSize { width, height },
            color_mode: ColorMode::Rgba,
            palette: Palette {
                name: "Pixet Default 16".to_string(),
                colors: vec![
                    "#0f0f17", "#232136", "#4a3f55", "#8c7a9b", "#f4f4f8", "#d95763", "#df7126",
                    "#fbf236", "#99e550", "#37946e", "#5fcde4", "#5b6ee1", "#76428a", "#d77bba",
                    "#eec39a", "#8f563b",
                ]
                .into_iter()
                .map(str::to_string)
                .collect(),
            },
            layers: vec![
                make_layer("layer-base", "Base"),
                make_layer("layer-shading", "Shading"),
                make_layer("layer-outline", "Outline"),
            ],
            frames,
            tags: vec![AnimationTag {
                id: "tag-idle".to_string(),
                name: "idle".to_string(),
                from_frame: 0,
                to_frame: 3,
                color: "#5b8cff".to_string(),
                direction: None,
            }],
            tileset: None,
            tile_projection: TileProjection::Orthogonal,
            tiles_version: 1,
            tiles_ext: None,
            draw_ext: None,
            rig: None,
            game_data: None,
            model3d_ext: None,
        }
    }

    /// Serializes the document to pretty-printed JSON.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserializes a document from JSON.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_json_round_trip() {
        let doc = Document::new_default(32, 32);
        let json = doc.to_json_pretty().expect("serialize document");
        let parsed = Document::from_json(&json).expect("deserialize document");
        assert_eq!(doc, parsed);
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.size, CanvasSize { width: 32, height: 32 });
        assert_eq!(parsed.layers.len(), 3);
        assert_eq!(parsed.frames.len(), 4);
    }

    #[test]
    fn layer_kinds_serialize_round_trip() {
        let kinds = [
            LayerKind::Raster,
            LayerKind::Group,
            LayerKind::Tilemap,
            LayerKind::Rig,
            LayerKind::Data,
        ];
        for kind in kinds {
            let serialized = serde_json::to_string(&kind).expect("serialize layer kind");
            let deserialized: LayerKind =
                serde_json::from_str(&serialized).expect("deserialize layer kind");
            assert_eq!(kind, deserialized);
        }
    }

    #[test]
    fn tilemap_v1_u16_and_v2_u32_round_trip() {
        let mut doc = Document::new_default(32, 32);
        let mut tilemaps = BTreeMap::new();
        tilemaps.insert(
            0,
            TilemapGrid {
                cols: 2,
                rows: 1,
                cells: vec![1, 2],
            },
        );
        doc.layers.push(Layer {
            id: "tilemap-1".to_string(),
            name: "Ground".to_string(),
            kind: LayerKind::Tilemap,
            visible: true,
            locked: false,
            opacity: 1.0,
            alpha_lock: false,
            blend_mode: BlendMode::Normal,
            parent_id: None,
            clipped: false,
            color_tag: None,
            cels: Vec::new(),
            tilemaps,
            map_role: None,
        });

        // Simulate legacy v1 JSON without tiles_version or tiles_ext
        let mut v1_val = serde_json::to_value(&doc).expect("to_value");
        v1_val.as_object_mut().unwrap().remove("tiles_version");
        let v1_json = serde_json::to_string(&v1_val).expect("to_string");
        let parsed_v1 = Document::from_json(&v1_json).expect("parse legacy v1");
        assert_eq!(parsed_v1.tiles_version, 1);
        assert_eq!(parsed_v1.tiles_ext, None);
        assert_eq!(parsed_v1.layers[3].tilemaps[&0].cells, vec![1, 2]);

        // v2 JSON with flagged u32 cell and tiles_ext
        doc.tiles_version = 2;
        doc.tiles_ext = Some(serde_json::json!({ "extraTilesets": [] }));
        doc.layers[3]
            .tilemaps
            .get_mut(&0)
            .unwrap()
            .cells[1] = 0x8000_0002;
        let v2_json = doc.to_json_pretty().expect("serialize v2");
        let parsed_v2 = Document::from_json(&v2_json).expect("parse v2");
        assert_eq!(parsed_v2.tiles_version, 2);
        assert_eq!(
            parsed_v2.layers[3].tilemaps[&0].cells,
            vec![1, 0x8000_0002]
        );
        assert!(parsed_v2.tiles_ext.is_some());
    }

    #[test]
    fn animation_tag_direction_and_draw_ext_round_trip_and_legacy_compat() {
        let mut doc = Document::new_default(32, 32);
        doc.tags[0].direction = Some("pingpong".to_string());
        doc.draw_ext = Some(serde_json::json!({
            "guides": [
                { "id": "guide-1", "axis": "x", "pos": 16 },
                { "id": "guide-2", "axis": "y", "pos": 8 }
            ]
        }));

        let json = doc.to_json_pretty().expect("serialize with direction and draw_ext");
        let parsed = Document::from_json(&json).expect("deserialize with direction and draw_ext");
        assert_eq!(parsed.tags[0].direction.as_deref(), Some("pingpong"));
        assert_eq!(parsed.draw_ext, doc.draw_ext);

        // Legacy JSON omitting both tag.direction and doc.draw_ext must still deserialize cleanly
        let mut legacy_val = serde_json::to_value(&doc).expect("to_value");
        let obj = legacy_val.as_object_mut().unwrap();
        obj.remove("draw_ext");
        obj["tags"].as_array_mut().unwrap()[0]
            .as_object_mut()
            .unwrap()
            .remove("direction");
        let legacy_json = serde_json::to_string(&legacy_val).expect("legacy to_string");
        let parsed_legacy = Document::from_json(&legacy_json).expect("parse legacy json");
        assert_eq!(parsed_legacy.tags[0].direction, None);
        assert_eq!(parsed_legacy.draw_ext, None);
    }

    #[test]
    fn model3d_ext_round_trip_and_legacy_compat() {
        let mut doc = Document::new_default(32, 32);
        assert_eq!(doc.model3d_ext, None);

        // When None, model3d_ext is omitted from serialized JSON
        let empty_val = serde_json::to_value(&doc).expect("to_value");
        assert!(empty_val.get("model3d_ext").is_none());

        // When omitted in legacy JSON, deserializes to None
        let parsed_omitted =
            Document::from_json(&serde_json::to_string(&empty_val).expect("to_string"))
                .expect("parse omitted model3d_ext");
        assert_eq!(parsed_omitted.model3d_ext, None);

        // When populated, round-trips cleanly
        doc.model3d_ext = Some(serde_json::json!({
            "version": 1,
            "pixelsPerUnit": 16,
            "nodes": [
                { "id": "node-1", "name": "Body", "kind": "cuboid" }
            ]
        }));
        let json = doc.to_json_pretty().expect("serialize with model3d_ext");
        let parsed = Document::from_json(&json).expect("deserialize with model3d_ext");
        assert_eq!(parsed.model3d_ext, doc.model3d_ext);
    }
}
