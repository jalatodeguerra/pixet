// Pure frame-order logic for animated exports.

export type ExportTagDirection = "forward" | "reverse" | "pingpong";

export interface SequenceTag {
  fromFrame: number;
  toFrame: number;
  direction?: ExportTagDirection;
}

/**
 * Returns the ordered list of document frame indices for an animated export.
 * With no tag, all frames play forward. Ping-pong plays from..to then back
 * down to from+1 (endpoints are not repeated) so the loop is seamless.
 */
export function buildFrameSequence(
  frameCount: number,
  tag: SequenceTag | null
): number[] {
  if (frameCount <= 0) return [];
  const maxIdx = frameCount - 1;
  const from = tag ? Math.max(0, Math.min(maxIdx, tag.fromFrame)) : 0;
  const to = tag ? Math.max(from, Math.min(maxIdx, tag.toFrame)) : maxIdx;
  const dir = tag?.direction ?? "forward";

  const forward: number[] = [];
  for (let i = from; i <= to; i++) forward.push(i);
  if (dir === "reverse") return forward.reverse();
  if (dir === "pingpong") {
    for (let i = to - 1; i > from; i--) forward.push(i);
    return forward;
  }
  return forward;
}
