import { NodeRegistry, nodeRegistry } from "../NodeRegistry.ts";
import { ADJUST_MATH_NODES } from "./adjustMathNodes.ts";
import { ANIM_MACRO_NODES } from "./animMacroNodes.ts";
import { BASIC_INPUT_OUTPUT_NODES } from "./basicInputOutputNodes.ts";
import { FILTER_WARP_NODES } from "./filterWarpNodes.ts";
import { GENERATOR_NODES } from "./generatorNodes.ts";
import { PBR_OUTPUT_NODES } from "./pbrOutputNodes.ts";
import { PIXEL_VFX_NODES } from "./pixelVfxNodes.ts";
import { PIXET_INPUT_NODES } from "./pixetInputNodes.ts";

export function registerBuiltInNodes(registry: NodeRegistry = nodeRegistry): void {
  registry.registerAll(BASIC_INPUT_OUTPUT_NODES);
  registry.registerAll(PIXET_INPUT_NODES);
  registry.registerAll(ANIM_MACRO_NODES);
  registry.registerAll(GENERATOR_NODES);
  registry.registerAll(FILTER_WARP_NODES);
  registry.registerAll(ADJUST_MATH_NODES);
  registry.registerAll(PIXEL_VFX_NODES);
  registry.registerAll(PBR_OUTPUT_NODES);
}

registerBuiltInNodes(nodeRegistry);
