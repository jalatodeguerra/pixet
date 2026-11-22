export type GameBoxKind = "hitbox" | "hurtbox" | "collision";

export interface GameBox {
  id: string;
  frame: number;
  kind: GameBoxKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameSocket {
  id: string;
  frame: number;
  name: string;
  x: number;
  y: number;
}

export interface AnimEvent {
  id: string;
  frame: number;
  name: string;
  payload?: string;
}

export class GameDataState {
  boxes: GameBox[] = [];
  sockets: GameSocket[] = [];
  events: AnimEvent[] = [];
  private nextId = 1;

  reset(): void {
    this.boxes = [];
    this.sockets = [];
    this.events = [];
    this.nextId = 1;
  }

  addBox(box: Omit<GameBox, "id">): GameBox {
    const id = `box-${this.nextId++}`;
    const created: GameBox = {
      id,
      frame: Math.max(0, Math.round(box.frame)),
      kind: box.kind,
      name: box.name.trim() || `${box.kind}_${this.nextId - 1}`,
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
    };
    this.boxes.push(created);
    return created;
  }

  updateBox(id: string, patch: Partial<Omit<GameBox, "id">>): void {
    const target = this.boxes.find((b) => b.id === id);
    if (!target) return;
    if (patch.name !== undefined) target.name = patch.name;
    if (patch.kind !== undefined) target.kind = patch.kind;
    if (patch.x !== undefined) target.x = Math.round(patch.x);
    if (patch.y !== undefined) target.y = Math.round(patch.y);
    if (patch.w !== undefined) target.w = Math.max(1, Math.round(patch.w));
    if (patch.h !== undefined) target.h = Math.max(1, Math.round(patch.h));
  }

  removeBox(id: string): void {
    this.boxes = this.boxes.filter((b) => b.id !== id);
  }

  getBoxesAtFrame(frame: number): GameBox[] {
    return this.boxes.filter((b) => b.frame === frame);
  }

  addSocket(socket: Omit<GameSocket, "id">): GameSocket {
    const id = `sock-${this.nextId++}`;
    const created: GameSocket = {
      id,
      frame: Math.max(0, Math.round(socket.frame)),
      name: socket.name.trim() || `socket_${this.nextId - 1}`,
      x: Math.round(socket.x),
      y: Math.round(socket.y),
    };
    this.sockets.push(created);
    return created;
  }

  updateSocket(id: string, patch: Partial<Omit<GameSocket, "id">>): void {
    const target = this.sockets.find((s) => s.id === id);
    if (!target) return;
    if (patch.name !== undefined) target.name = patch.name;
    if (patch.x !== undefined) target.x = Math.round(patch.x);
    if (patch.y !== undefined) target.y = Math.round(patch.y);
  }

  removeSocket(id: string): void {
    this.sockets = this.sockets.filter((s) => s.id !== id);
  }

  getSocketsAtFrame(frame: number): GameSocket[] {
    return this.sockets.filter((s) => s.frame === frame);
  }

  addEvent(frame: number, name: string, payload?: string): AnimEvent | null {
    const clean = name.trim();
    if (!clean) return null;
    const created: AnimEvent = {
      id: `evt-${this.nextId++}`,
      frame: Math.max(0, Math.round(frame)),
      name: clean,
      payload: payload?.trim() || undefined,
    };
    this.events.push(created);
    return created;
  }

  removeEvent(id: string): void {
    this.events = this.events.filter((e) => e.id !== id);
  }

  getEventsAtFrame(frame: number): AnimEvent[] {
    return this.events.filter((e) => e.frame === frame);
  }

  copyFrameMetadata(fromFrame: number, toFrame: number): number {
    if (fromFrame === toFrame) return 0;
    let copied = 0;
    for (const box of this.getBoxesAtFrame(fromFrame)) {
      this.addBox({
        frame: toFrame,
        kind: box.kind,
        name: box.name,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
      });
      copied++;
    }
    for (const sock of this.getSocketsAtFrame(fromFrame)) {
      this.addSocket({
        frame: toFrame,
        name: sock.name,
        x: sock.x,
        y: sock.y,
      });
      copied++;
    }
    return copied;
  }

  serializeGameDataJson(
    documentName: string,
    width: number,
    height: number,
    frameCount: number
  ): string {
    return JSON.stringify(
      {
        schema: "pixet-gamedata-v1",
        document: documentName,
        canvas: { width, height },
        frameCount,
        boxes: this.boxes,
        sockets: this.sockets,
        events: this.events,
      },
      null,
      2
    );
  }
}
