import test from "node:test";
import assert from "node:assert/strict";

import {
  CommandRegistry,
  LEGACY_COMMAND_IDS,
  migrateKeybindingIds,
  type CommandContext,
  type CommandDef,
} from "../src/engine/config/commands.ts";
import {
  ASEPRITE_KEYBINDINGS,
  PIXET_DEFAULT_KEYBINDINGS,
} from "../src/engine/config/keybindings.ts";

function def(partial: Partial<CommandDef> & { id: string }): CommandDef {
  return {
    title: partial.id,
    category: "Test",
    scope: "global",
    run: () => {},
    ...partial,
  };
}

const draw: CommandContext = { workspace: "draw" };
const rig: CommandContext = { workspace: "rig" };
const nodes: CommandContext = { workspace: "nodes" };
const tilesMap: CommandContext = { workspace: "tiles", tilesMode: "map" };
const tilesTile: CommandContext = { workspace: "tiles", tilesMode: "tile" };

function sample(): CommandRegistry {
  const r = new CommandRegistry();
  r.registerAll([
    def({ id: "tool.pencil", scope: "global", chordScope: ["draw", "tiles.tile"], chord: "b" }),
    def({ id: "rig.tool.addBone", scope: "rig", chord: "b" }),
    def({ id: "tiles.tool.brush", scope: "tiles.map", chord: "b" }),
    def({ id: "view.zoomFit", scope: "global", chord: "ctrl+0" }),
    def({ id: "nodes.addMenu", scope: "nodes", chord: "shift+a", aliases: ["/"] }),
    def({ id: "nodes.delete", scope: "nodes", chord: "delete", aliases: ["backspace"] }),
    def({ id: "rig.play", scope: "rig", hint: "Enter" }),
  ]);
  return r;
}

test("resolve: same chord maps to a different command per workspace", () => {
  const r = sample();
  assert.equal(r.resolve("b", draw, {})?.id, "tool.pencil");
  assert.equal(r.resolve("b", tilesTile, {})?.id, "tool.pencil");
  assert.equal(r.resolve("b", rig, {})?.id, "rig.tool.addBone");
  assert.equal(r.resolve("b", tilesMap, {})?.id, "tiles.tool.brush");
  assert.equal(r.resolve("b", nodes, {}), null);
  assert.equal(r.resolve("ctrl+0", nodes, {})?.id, "view.zoomFit");
  assert.equal(r.resolve("Ctrl+0", draw, {})?.id, "view.zoomFit");
});

test("resolve: aliases, hint-only commands and loose Shift", () => {
  const r = sample();
  assert.equal(r.resolve("/", nodes, {})?.id, "nodes.addMenu");
  assert.equal(r.resolve("backspace", nodes, {})?.id, "nodes.delete");
  assert.equal(r.resolve("enter", rig, {}), null, "hints are not chords");
  assert.equal(r.resolve("shift+b", rig, {}), null);
  assert.equal(r.resolve("shift+b", rig, {}, { looseShift: true })?.id, "rig.tool.addBone");
  // An exact Shift binding still wins over the loose fallback.
  assert.equal(r.resolve("shift+a", nodes, {}, { looseShift: true })?.id, "nodes.addMenu");
});

test("resolve: overrides rebind, unbind and beat defaults", () => {
  const r = sample();
  assert.equal(r.resolve("q", rig, { "rig.tool.addBone": "q" })?.id, "rig.tool.addBone");
  assert.equal(r.resolve("b", rig, { "rig.tool.addBone": "q" }), null);
  assert.equal(r.resolve("b", rig, { "rig.tool.addBone": "" }), null, "explicit unbind");
  const def0 = r.get("tool.pencil");
  assert.ok(def0);
  assert.equal(r.effectiveChord(def0, {}), "b");
  assert.equal(r.effectiveChord(def0, { "tool.pencil": "Shift+P" }), "shift+p");
  assert.equal(r.displayChord(def0, { "tool.pencil": "ctrl+shift+p" }), "Ctrl+Shift+P");
  assert.equal(r.displayChord(r.get("rig.play") as CommandDef, {}), "Enter");
});

test("resolve: more specific scope wins over global; enabled wins among equals", () => {
  const r = new CommandRegistry();
  r.registerAll([
    def({ id: "global.x", scope: "global", chord: "x" }),
    def({ id: "rig.x", scope: "rig", chord: "x" }),
    def({ id: "n.off", scope: "nodes", chord: "m", when: () => false }),
    def({ id: "n.on", scope: "nodes", chord: "m", when: () => true }),
  ]);
  assert.equal(r.resolve("x", rig, {})?.id, "rig.x");
  assert.equal(r.resolve("x", draw, {})?.id, "global.x");
  assert.equal(r.resolve("m", nodes, {})?.id, "n.on");
});

test("palette availability: workspace commands plus global ones", () => {
  const r = sample();
  const ids = (ctx: CommandContext) => r.forContext(ctx).map((c) => c.id);
  assert.deepEqual(ids(rig), ["rig.tool.addBone", "rig.play", "tool.pencil", "view.zoomFit"]);
  assert.ok(ids(tilesMap).includes("tiles.tool.brush"));
  assert.ok(!ids(tilesTile).includes("tiles.tool.brush"));
  assert.ok(!ids(draw).includes("rig.tool.addBone"));
});

test("conflicts are detected per workspace scope only", () => {
  const r = sample();
  // b in draw / rig / tiles-map: different scopes, no conflict.
  assert.deepEqual(r.findConflicts({}), []);
  // Rebinding a rig tool onto a chord already used in Rig conflicts...
  r.register(def({ id: "rig.tool.chain", scope: "rig", chord: "c" }));
  const rigClash = r.findConflicts({ "rig.tool.chain": "b" });
  assert.equal(rigClash.length, 1);
  assert.equal(rigClash[0].chord, "b");
  assert.deepEqual(rigClash[0].commandIds.sort(), ["rig.tool.addBone", "rig.tool.chain"]);
  // ...a global command clashes with every workspace-specific one...
  const globalClash = r.findConflicts({ "view.zoomFit": "b" });
  assert.equal(globalClash.length, 1);
  assert.ok(globalClash[0].commandIds.includes("view.zoomFit"));
  assert.ok(globalClash[0].commandIds.includes("rig.tool.addBone"));
  // ...and the same chord in two different workspaces is fine.
  assert.deepEqual(
    r.findConflicts({ "nodes.delete": "c", "rig.tool.chain": "c" }),
    []
  );
  // "tiles" overlaps its sub-modes.
  r.register(def({ id: "tiles.any", scope: "tiles", chord: "q" }));
  r.register(def({ id: "tiles.mapOnly", scope: "tiles.map", chord: "q" }));
  assert.equal(r.findConflicts({}).length, 1);
});

test("override migration moves legacy ids and keeps explicit new ids", () => {
  assert.equal(LEGACY_COMMAND_IDS["sprite.mergeDown"], "layer.mergeDown");
  assert.deepEqual(
    migrateKeybindingIds({ "sprite.mergeDown": "ctrl+shift+m", "tool.pencil": "n" }),
    { "tool.pencil": "n", "layer.mergeDown": "ctrl+shift+m" }
  );
  // An override already stored under the new id wins over the legacy one.
  assert.deepEqual(
    migrateKeybindingIds({ "sprite.mergeDown": "x", "layer.mergeDown": "y" }),
    { "layer.mergeDown": "y" }
  );
  // Empty string (explicit unbind) migrates too.
  assert.deepEqual(migrateKeybindingIds({ "sprite.mergeDown": "" }), {
    "layer.mergeDown": "",
  });
  assert.deepEqual(
    migrateKeybindingIds({ a: "1", old: "2" }, { old: "new" }),
    { a: "1", new: "2" }
  );
});

test("default presets: every draw chord is conflict-free within its scope", () => {
  for (const preset of [PIXET_DEFAULT_KEYBINDINGS, ASEPRITE_KEYBINDINGS]) {
    const r = new CommandRegistry();
    for (const id of Object.keys(preset)) {
      r.register(
        def({
          id,
          scope: "global",
          chordScope: ["draw", "tiles.tile", "studio3d", "data"],
          chord: preset[id],
        })
      );
    }
    assert.deepEqual(r.findConflicts({}), []);
  }
});
