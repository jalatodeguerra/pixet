export interface PalettePreset {
  name: string;
  colors: string[];
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    name: "Pixet Default 16",
    colors: [
      "#0f0f17", "#232136", "#4a3f55", "#8c7a9b",
      "#f4f4f8", "#d95763", "#df7126", "#fbf236",
      "#99e550", "#37946e", "#5fcde4", "#5b6ee1",
      "#76428a", "#d77bba", "#eec39a", "#8f563b",
    ],
  },
  {
    name: "PICO-8 16",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  {
    name: "Sweetie 16",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57",
      "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7",
      "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
  },
  {
    name: "Endesga 32",
    colors: [
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672",
      "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761",
      "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff",
      "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c",
      "#b55088", "#f6757a", "#e8b796", "#c28569",
    ],
  },
];

function normalizeHex(raw: string): string | null {
  const clean = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `#${clean.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase();
  }
  return null;
}

export function parseHexPalette(content: string): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith(";")) {
      continue;
    }
    const token = trimmed.split(/[\s,]+/)[0];
    const hex = normalizeHex(token);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      colors.push(hex);
    }
  }
  return colors;
}

export function parseGplPalette(content: string): {
  name?: string;
  colors: string[];
} {
  let name: string | undefined;
  const seen = new Set<string>();
  const colors: string[] = [];

  const toByteHex = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "GIMP Palette" || trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.toLowerCase().startsWith("name:")) {
      const parsedName = trimmed.slice(5).trim();
      if (parsedName) name = parsedName;
      continue;
    }
    if (trimmed.toLowerCase().startsWith("columns:")) {
      continue;
    }

    const match = trimmed.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/);
    if (!match) continue;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if (r > 255 || g > 255 || b > 255) continue;

    const hex = `#${toByteHex(r)}${toByteHex(g)}${toByteHex(b)}`;
    if (!seen.has(hex)) {
      seen.add(hex);
      colors.push(hex);
    }
  }

  return { name, colors };
}

export function parsePaletteFile(
  filename: string,
  content: string
): { name: string; colors: string[] } {
  const baseName = filename.replace(/\.[^.]+$/, "") || "Imported Palette";
  if (filename.toLowerCase().endsWith(".gpl") || content.includes("GIMP Palette")) {
    const gpl = parseGplPalette(content);
    return {
      name: gpl.name || baseName,
      colors: gpl.colors,
    };
  }
  return {
    name: baseName,
    colors: parseHexPalette(content),
  };
}
