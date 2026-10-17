import type { Chess } from "chess.js";

export type EngineDifficulty = "apprentice" | "knight" | "boss";

type PendingMove = {
  resolve: (move: string | null) => void;
  reject: (error: Error) => void;
};

const DIFFICULTIES = {
  apprentice: { skill: 0, elo: 1320, depth: 5 },
  knight: { skill: 7, elo: 1800, depth: 9 },
  boss: { skill: 16, elo: 2400, depth: 13 },
} as const;

export function getEngineUrls(): { scriptUrl: URL; wasmUrl: URL; targetUrl: string } {
  const baseUrl = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://localhost:5173";
  const scriptUrl = new URL(`${normalizedBase}engine/stockfish-19-lite-single.js`, origin);
  const wasmUrl = new URL(`${normalizedBase}engine/stockfish-19-lite-single.wasm`, origin);
  // Pass explicit WASM URL via hash anchor so the Stockfish loader always locates it
  const targetUrl = `${scriptUrl.href}#${encodeURIComponent(wasmUrl.href)}`;
  return { scriptUrl, wasmUrl, targetUrl };
}

export function getWorkerUrl(): string {
  return getEngineUrls().targetUrl;
}

export async function createStockfishWorker(): Promise<{ worker: Worker; cleanup?: () => void }> {
  const { scriptUrl, wasmUrl, targetUrl } = getEngineUrls();

  // In test / non-browser environments or when mock worker is installed:
  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    (typeof Worker !== "undefined" && Worker.name === "MockWorker")
  ) {
    return { worker: new Worker(targetUrl) };
  }

  // In browsers, instantiate via Blob URL.
  // This achieves 100% reliability across all modern browser engines by avoiding
  // classic worker cross-origin fetch restrictions, COEP require-corp blocking on script URLs,
  // and local dev server MIME quirks.
  try {
    const res = await fetch(scriptUrl.href);
    if (!res.ok) {
      throw new Error(`Failed to fetch Stockfish script (HTTP ${res.status} ${res.statusText})`);
    }
    const code = await res.text();
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(`${blobUrl}#${encodeURIComponent(wasmUrl.href)}`);
    return {
      worker,
      cleanup: () => {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // ignore
        }
      },
    };
  } catch (fetchErr) {
    if (import.meta.env?.DEV) {
      console.warn("[Stockfish] Blob worker creation failed, falling back to direct Worker:", fetchErr);
    }
    const worker = new Worker(targetUrl);
    return { worker };
  }
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private workerCleanup: (() => void) | null = null;
  private pending: PendingMove | null = null;
  private ready = false;
  private searchGeneration = 0;
  private initializing: Promise<void> | null = null;
  private initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private initReject: ((error: Error) => void) | null = null;
  private isDisposed = false;

  private cleanupInit() {
    if (this.initTimeoutId !== null) {
      clearTimeout(this.initTimeoutId);
      this.initTimeoutId = null;
    }
    this.initReject = null;
  }

  private terminateWorker() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      try {
        if (this.ready) {
          this.worker.postMessage("stop");
        }
        this.worker.terminate();
      } catch {
        // ignore termination errors
      }
      this.worker = null;
    }
    if (this.workerCleanup) {
      this.workerCleanup();
      this.workerCleanup = null;
    }
  }

  initialize(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.initializing) return this.initializing;
    if (this.isDisposed) {
      return Promise.reject(new Error("Engine disposed"));
    }

    this.initializing = new Promise<void>((resolve, reject) => {
      this.initReject = reject;
      let cleanupBlob: (() => void) | undefined;

      createStockfishWorker()
        .then(({ worker, cleanup }) => {
          if (this.isDisposed) {
            cleanup?.();
            worker.terminate();
            reject(new Error("Engine disposed"));
            return;
          }

          cleanupBlob = cleanup;
          this.workerCleanup = cleanup || null;
          this.worker = worker;

          this.initTimeoutId = setTimeout(() => {
            this.cleanupInit();
            this.terminateWorker();
            this.initializing = null;
            reject(new Error("Stockfish initialization timed out"));
          }, 15000);

          this.worker.onmessage = (event: MessageEvent) => {
            const lines = String(event.data).split("\n");

            for (const rawLine of lines) {
              const line = rawLine.trim();

              if (line === "uciok") {
                this.worker?.postMessage("isready");
              }

              if (line === "readyok" && !this.ready) {
                this.ready = true;
                this.cleanupInit();
                resolve();
              }

              if (line.startsWith("bestmove") && this.pending) {
                const move = line.split(" ")[1];
                this.pending.resolve(
                  move && move !== "(none)" ? move : null
                );
                this.pending = null;
              }
            }
          };

          this.worker.onerror = (event: ErrorEvent) => {
            if (import.meta.env?.DEV) {
              const { targetUrl } = getEngineUrls();
              console.error("[Stockfish Worker Error]", {
                message: event?.message,
                filename: event?.filename,
                lineno: event?.lineno,
                colno: event?.colno,
                error: event?.error,
                targetUrl,
                stage: "worker_onerror",
              });
            }
            this.cleanupInit();
            this.terminateWorker();
            this.initializing = null;
            const details = [
              event?.message,
              event?.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : null,
            ]
              .filter(Boolean)
              .join(" ");
            const msg = details || "Stockfish worker failed";
            reject(new Error(`Stockfish worker failed: ${msg}`));
          };

          this.worker.onmessageerror = () => {
            this.cleanupInit();
            this.terminateWorker();
            this.initializing = null;
            reject(new Error("Stockfish worker message deserialization error"));
          };

          this.worker.postMessage("uci");
        })
        .catch((error) => {
          cleanupBlob?.();
          this.cleanupInit();
          this.initializing = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });

    return this.initializing;
  }

  async getBestMove(
    game: Chess,
    difficulty: EngineDifficulty = "apprentice"
  ): Promise<string | null> {
    const currentGen = ++this.searchGeneration;
    await this.initialize();

    if (this.searchGeneration !== currentGen) {
      return null;
    }

    if (!this.worker || !this.ready) throw new Error("Stockfish not initialized");
    if (this.pending) throw new Error("Engine is already thinking");

    const config = DIFFICULTIES[difficulty];

    this.worker.postMessage(
      `setoption name Skill Level value ${config.skill}`
    );
    this.worker.postMessage(
      "setoption name UCI_LimitStrength value true"
    );
    this.worker.postMessage(
      `setoption name UCI_Elo value ${config.elo}`
    );
    this.worker.postMessage(`position fen ${game.fen()}`);

    return new Promise<string | null>((resolve, reject) => {
      if (this.searchGeneration !== currentGen) {
        resolve(null);
        return;
      }
      this.pending = { resolve, reject };
      this.worker?.postMessage(`go depth ${config.depth}`);
    });
  }

  /** True while a getBestMove request is in flight. */
  isBusy(): boolean {
    return this.pending !== null;
  }

  /** Halts any in-flight move search immediately and clears pending promise. */
  stop() {
    this.searchGeneration++;
    if (this.ready && this.worker) {
      this.worker.postMessage("stop");
    }
    if (this.pending) {
      this.pending.resolve(null);
      this.pending = null;
    }
  }

  dispose() {
    this.isDisposed = true;
    this.searchGeneration++;
    const reject = this.initReject;
    this.cleanupInit();

    if (reject) {
      reject(new Error("Engine disposed"));
    }

    this.terminateWorker();
    this.ready = false;
    this.initializing = null;

    if (this.pending) {
      this.pending.reject(new Error("Engine disposed"));
      this.pending = null;
    }
  }
}
