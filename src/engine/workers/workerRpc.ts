/**
 * Tiny request/response layer over a module Worker. React-free; the pure
 * computation lives in the engine modules that both a worker and the tests
 * import, this file only moves messages. A missing Worker (node tests,
 * restricted webviews) or a worker that fails is reported by rejecting, so
 * callers can fall back to running the same pure function synchronously.
 */

export type RpcResponse<Res> =
  | { id: number; ok: true; result: Res }
  | { id: number; ok: false; error: string };

interface RpcRequest<Req> {
  id: number;
  payload: Req;
}

interface Pending<Res> {
  resolve: (value: Res) => void;
  reject: (reason: Error) => void;
}

export function workersSupported(): boolean {
  return typeof Worker !== "undefined";
}

export class WorkerRpc<Req, Res> {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending<Res>>();

  private readonly createWorker: () => Worker;

  constructor(createWorker: () => Worker) {
    this.createWorker = createWorker;
  }

  /** False once the worker failed to start or crashed; callers should run sync. */
  get available(): boolean {
    return workersSupported() && !this.broken;
  }

  call(payload: Req, transfer: Transferable[] = []): Promise<Res> {
    if (!this.available) {
      return Promise.reject(new Error("Worker unavailable"));
    }
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return new Promise<Res>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const msg: RpcRequest<Req> = { id, payload };
      try {
        worker.postMessage(msg, transfer);
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<RpcResponse<Res>>) => {
      const res = event.data;
      const entry = this.pending.get(res.id);
      if (!entry) return;
      this.pending.delete(res.id);
      if (res.ok) entry.resolve(res.result);
      else entry.reject(new Error(res.error));
    };
    worker.onerror = (event: ErrorEvent) => {
      this.fail(new Error(event.message || "Worker error"));
    };
    this.worker = worker;
    return worker;
  }

  private fail(error: Error): void {
    this.broken = true;
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}

/** The subset of a dedicated worker scope that `serveRpc` needs. */
export interface RpcScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void
  ): void;
  postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
}

/** Worker side: answer each request with the handler's return value. */
export function serveRpc<Req, Res>(
  scope: RpcScope,
  handler: (payload: Req) => { result: Res; transfer?: Transferable[] }
): void {
  scope.addEventListener("message", (event: MessageEvent) => {
    const req = event.data as RpcRequest<Req>;
    try {
      const { result, transfer } = handler(req.payload);
      const res: RpcResponse<Res> = { id: req.id, ok: true, result };
      scope.postMessage(res, { transfer: transfer ?? [] });
    } catch (err) {
      const res: RpcResponse<Res> = {
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      scope.postMessage(res);
    }
  });
}
