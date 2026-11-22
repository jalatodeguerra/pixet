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
    pub cels: Vec<Cel>,
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Palette {
    pub name: String,
    pub colors: Vec<String>,
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
            cels: vec![Cel {
                id: format!("{id}-cel-1"),
                frame_index: 0,
                linked_to: None,
                linked_frame: None,
            }],
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
            }],
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
}
