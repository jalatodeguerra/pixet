export type TagDirection = "forward" | "reverse" | "pingpong";

export interface PlaybackStepResult {
  nextFrame: number;
  nextPingPongDir: 1 | -1;
  stop: boolean;
}

export interface OnionSkinFrameEntry {
  frame: number;
  kind: "prev" | "next";
  opacity: number;
}

export function computeNextPlaybackFrame(
  current: number,
  start: number,
  end: number,
  direction: TagDirection,
  pingPongDir: 1 | -1,
  loop: boolean
): PlaybackStepResult {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  if (lo === hi) {
    return {
      nextFrame: lo,
      nextPingPongDir: pingPongDir,
      stop: !loop && current === lo,
    };
  }

  if (direction === "forward") {
    if (current < lo || current > hi) {
      return { nextFrame: lo, nextPingPongDir: 1, stop: false };
    }
    if (current >= hi) {
      return loop
        ? { nextFrame: lo, nextPingPongDir: 1, stop: false }
        : { nextFrame: hi, nextPingPongDir: 1, stop: true };
    }
    return { nextFrame: current + 1, nextPingPongDir: 1, stop: false };
  }

  if (direction === "reverse") {
    if (current < lo || current > hi) {
      return { nextFrame: hi, nextPingPongDir: -1, stop: false };
    }
    if (current <= lo) {
      return loop
        ? { nextFrame: hi, nextPingPongDir: -1, stop: false }
        : { nextFrame: lo, nextPingPongDir: -1, stop: true };
    }
    return { nextFrame: current - 1, nextPingPongDir: -1, stop: false };
  }

  // pingpong
  if (current < lo || current > hi) {
    const entryFrame = pingPongDir === 1 ? lo : hi;
    return { nextFrame: entryFrame, nextPingPongDir: pingPongDir, stop: false };
  }

  if (pingPongDir === 1) {
    if (current < hi) {
      const next = current + 1;
      const nextDir: 1 | -1 = next === hi ? -1 : 1;
      return { nextFrame: next, nextPingPongDir: nextDir, stop: false };
    }
    // At hi while dir === 1 (e.g. started at hi): bounce to hi - 1
    return {
      nextFrame: hi - 1,
      nextPingPongDir: hi - 1 === lo ? 1 : -1,
      stop: false,
    };
  }

  // pingPongDir === -1
  if (current > lo) {
    const next = current - 1;
    if (next === lo) {
      if (!loop) {
        return { nextFrame: lo, nextPingPongDir: 1, stop: true };
      }
      return { nextFrame: lo, nextPingPongDir: 1, stop: false };
    }
    return { nextFrame: next, nextPingPongDir: -1, stop: false };
  }

  // At lo while dir === -1
  if (!loop) {
    return { nextFrame: lo, nextPingPongDir: 1, stop: true };
  }
  return {
    nextFrame: lo + 1,
    nextPingPongDir: lo + 1 === hi ? -1 : 1,
    stop: false,
  };
}

export function resolveOnionSkinFrames(
  current: number,
  totalFrames: number,
  prevCount: number,
  nextCount: number,
  loopWrap: boolean,
  baseOpacity = 0.35
): OnionSkinFrameEntry[] {
  if (totalFrames <= 0) return [];
  const prevSteps = Math.max(0, Math.floor(prevCount));
  const nextSteps = Math.max(0, Math.floor(nextCount));
  const entries: OnionSkinFrameEntry[] = [];

  // Farthest prev first -> closest prev last
  for (let step = prevSteps; step >= 1; step--) {
    let frame = current - step;
    if (loopWrap) {
      frame = ((frame % totalFrames) + totalFrames) % totalFrames;
      if (frame === current) continue;
    } else if (frame < 0 || frame >= totalFrames) {
      continue;
    }
    const opacity = baseOpacity * (1 - (step - 1) / (prevSteps + 0.5));
    entries.push({ frame, kind: "prev", opacity });
  }

  // Farthest next first -> closest next last
  for (let step = nextSteps; step >= 1; step--) {
    let frame = current + step;
    if (loopWrap) {
      frame = ((frame % totalFrames) + totalFrames) % totalFrames;
      if (frame === current) continue;
    } else if (frame < 0 || frame >= totalFrames) {
      continue;
    }
    const opacity = baseOpacity * (1 - (step - 1) / (nextSteps + 0.5));
    entries.push({ frame, kind: "next", opacity });
  }

  return entries;
}
