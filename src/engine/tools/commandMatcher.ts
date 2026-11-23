export type CommandEntry = {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  keywords?: string[];
};

const WORD_BOUNDARY_RE = /[\s\-_/:.([\]]/;

function isWordBoundary(original: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = original[index - 1];
  if (WORD_BOUNDARY_RE.test(prev)) return true;
  const curr = original[index];
  return (
    prev >= "a" &&
    prev <= "z" &&
    curr >= "A" &&
    curr <= "Z"
  );
}

function scoreField(queryLower: string, target: string, fieldBonus: number): number {
  if (!target) return 0;
  const targetLower = target.toLowerCase();

  if (targetLower.startsWith(queryLower)) {
    const exactBonus = targetLower === queryLower ? 5 : 0;
    return 300 + fieldBonus + exactBonus;
  }

  let idx = targetLower.indexOf(queryLower);
  if (idx !== -1) {
    let atBoundary = false;
    while (idx !== -1) {
      if (isWordBoundary(target, idx)) {
        atBoundary = true;
        break;
      }
      idx = targetLower.indexOf(queryLower, idx + 1);
    }
    if (atBoundary) {
      return 240 + fieldBonus;
    }
    return 200 + fieldBonus;
  }

  // Ordered subsequence match
  let qi = 0;
  let consecutive = 0;
  let prevMatchIdx = -2;
  for (let ti = 0; ti < targetLower.length && qi < queryLower.length; ti++) {
    if (targetLower[ti] === queryLower[qi]) {
      if (ti === prevMatchIdx + 1) {
        consecutive++;
      }
      prevMatchIdx = ti;
      qi++;
    }
  }

  if (qi === queryLower.length) {
    const densityBonus = Math.min(20, Math.round((consecutive / queryLower.length) * 20));
    return 100 + fieldBonus + densityBonus;
  }

  return 0;
}

function scoreCommand(queryLower: string, item: CommandEntry): number {
  let best = scoreField(queryLower, item.label, 20);

  if (item.keywords) {
    for (const kw of item.keywords) {
      const s = scoreField(queryLower, kw, 10);
      if (s > best) best = s;
    }
  }

  if (item.category) {
    const s = scoreField(queryLower, item.category, 0);
    if (s > best) best = s;
  }

  return best;
}

export function fuzzyMatchCommands<T extends CommandEntry>(
  query: string,
  items: readonly T[]
): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return items.slice();
  }

  const queryLower = trimmed.toLowerCase();
  const scored: Array<{ item: T; score: number; index: number }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const score = scoreCommand(queryLower, item);
    if (score > 0) {
      scored.push({ item, score, index: i });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  return scored.map((entry) => entry.item);
}
