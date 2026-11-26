# Pixet

Pixet is a pixel-art editor built for solo indie game developers. Draw a character, animate it with frames and tags (optionally rig it), then export a spritesheet and a Godot 4 `SpriteFrames` resource without leaving the app. It runs as a desktop app (Tauri v2) and as a browser build, and ships with a headless CLI for batch exports.

## Features

**Draw**
- Pencil, eraser, shapes, fill, gradient, selections, free transform, custom brushes, symmetry, pixel-perfect mode.
- Layers with blend modes, clipping and alpha lock; frames, per-frame durations, onion skinning and animation tags.
- Palettes, filters (auto-outline, drop shadow, color replace, offset/wrap, scale), Aseprite-style keybinding preset.
- Game Data panel (a panel inside Draw) for attaching data to your sprites.

**Tiles**
- Tilesets, tilemap layers, auto-tiling, terrain sets and AutoMap rules; Map and Tile editing modes.

**Rig**
- Skeletons and bind-pose weights, pose and keyframe animation (Setup and Animate modes), baking to frames, export of rig clips.

**3D Studio**
- 2.5D extruded spin, sprite stacking and low-poly modeling with a rig and turntable bakes to sprites.

**Nodes**
- A WebGL node-graph workspace for image effects (palette LUT, material/PBR-style channel previews) that can feed back into your sprite.

**Export**
- Spritesheet (PNG + JSON), animated GIF, PNG sequence, Godot 4 SpriteFrames (`.tres` + PNG). Desktop only: Godot 4 TileSet and Tiled (`.tmj`/`.tsj`).

## Hero workflow: character to Godot

1. Start Pixet and pick **Character 32×32** on the welcome screen (or **File › New Sprite…**).
2. Draw your character on frame 1 (`B` pencil, `E` eraser, `G` paint bucket).
3. Add frames in the timeline, draw the remaining poses, and set per-frame durations.
4. Create a tag with **+ Tag** in the timeline (for example `walk`); each tag becomes one Godot animation.
5. Choose **File › Export Spritesheet…**, select **Godot 4 SpriteFrames**, export, and copy the `.tres` and `.png` into your Godot project. In Godot, add an `AnimatedSprite2D`, then in the inspector open **Sprite Frames** and choose **Load** to import the `.tres`.

The welcome screen also offers sample projects (a gem idle and a slime hop) that are ready to export.

## Running

Prerequisites: Node 22, pnpm 10, Rust stable, and the Tauri system dependencies for your OS: https://v2.tauri.app/start/prerequisites/ (the Tauri dependencies are only needed for the desktop app).

```sh
pnpm install
pnpm dev                 # browser build (Vite dev server)
pnpm tauri dev           # desktop app
pnpm test                # TypeScript tests
pnpm run build           # type-check and production web build
cargo test -p pixet-core -p pixet-cli
```

## Project layout

- `src/engine/` – React-free editor engine (documents, tools, tiles, rig, 3D, nodes, I/O, export).
- `src/components/` – React UI; `src/store/` – Zustand store; `src/styles/` – CSS.
- `crates/pixet-core/` – Rust core: project format, packing and export.
- `crates/pixet-cli/` – headless CLI (`pixet`) with two subcommands: `info <file>` prints project metadata, and `export <file> --format <json|godot|godot-tileset|tiled> --out <dir> [--pack grid|tight] [--trim] [--extrude N] [--padding N] [--name NAME]` writes sprite sheets and engine assets (run `cargo run -p pixet-cli -- --help` for exact flags).
- `src-tauri/` – desktop shell.
- `docs/plans/` – design documents for each workspace.
- `tests/` – Node test runner suites.

## Browser vs desktop

| | Browser | Desktop |
|---|---|---|
| Save / open | Save downloads `<name>.pixet.json`; Open picks a `.json` file | Native `.pixet` files, recent files list on the welcome screen |
| Godot TileSet, Tiled export | Not available | Available |
| Aseprite (`.ase`/`.aseprite`) import | Not available | Available |
| Autosave / crash recovery | IndexedDB | IndexedDB |

## License

The Cargo workspace declares the MIT license, but there is no `LICENSE` file in the repository yet. Add one before distributing.
