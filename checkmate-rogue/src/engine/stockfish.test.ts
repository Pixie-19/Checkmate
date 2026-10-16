import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StockfishEngine, getWorkerUrl, getEngineUrls } from "./stockfish";
import { Chess } from "chess.js";

// Realistic Mock Worker
class MockWorker {
  static instances: MockWorker[] = [];
  static nextWorkerBehavior: {
    failOnUci?: boolean;
    failErrorMessage?: string;
    noHandshake?: boolean;
    delayMoveResponse?: boolean;
  } | null = null;

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postedMessages: string[] = [];
  terminated = false;
  url: string;
  delayMoveResponse = false;

  private behavior = MockWorker.nextWorkerBehavior;

  constructor(url: string) {
    this.url = url;
    MockWorker.instances.push(this);
    if (this.behavior?.delayMoveResponse) {
      this.delayMoveResponse = true;
    }
    MockWorker.nextWorkerBehavior = null;
  }

  postMessage(msg: string) {
    this.postedMessages.push(msg);

    if (this.behavior?.failOnUci && msg === "uci") {
      queueMicrotask(() => {
        this.onerror?.({
          message: this.behavior?.failErrorMessage || "WASM compilation failed",
          filename: "stockfish-19-lite-single.js",
          lineno: 12,
          colno: 50,
        } as ErrorEvent);
      });
      return;
    }

    if (this.behavior?.noHandshake) {
      return;
    }

    // Standard UCI handshake simulation
    if (msg === "uci") {
      queueMicrotask(() => {
        this.onmessage?.({ data: "Stockfish 19 Lite WASM\nuciok" } as MessageEvent);
      });
    } else if (msg === "isready") {
      queueMicrotask(() => {
        this.onmessage?.({ data: "readyok" } as MessageEvent);
      });
    } else if (msg.startsWith("go depth")) {
      if (!this.delayMoveResponse) {
        queueMicrotask(() => {
          this.onmessage?.({ data: "info depth 5 score cp 15\nbestmove e7e5" } as MessageEvent);
        });
      }
    }
  }

  terminate() {
    this.terminated = true;
  }
}

describe("StockfishEngine Comprehensive Lifecycle & Regression Coverage", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    MockWorker.nextWorkerBehavior = null;
    vi.stubGlobal("Worker", MockWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("1. Worker initialization success: completes uci and isready handshake", async () => {
    const engine = new StockfishEngine();
    await engine.initialize();
    expect(engine.isBusy()).toBe(false);
    expect(MockWorker.instances.length).toBe(1);
    expect(MockWorker.instances[0].postedMessages).toContain("uci");
    expect(MockWorker.instances[0].postedMessages).toContain("isready");
    engine.dispose();
    expect(MockWorker.instances[0].terminated).toBe(true);
  });

  it("2. Worker error event: captures and rejects with formatted error details", async () => {
    MockWorker.nextWorkerBehavior = {
      failOnUci: true,
      failErrorMessage: "Out of memory in WebAssembly.Memory",
    };

    const engine = new StockfishEngine();
    await expect(engine.initialize()).rejects.toThrow(
      "Stockfish worker failed: Out of memory in WebAssembly.Memory at stockfish-19-lite-single.js:12:50"
    );
    expect(MockWorker.instances[0].terminated).toBe(true);
    engine.dispose();
  });

  it("3. WASM loading failure: rejects cleanly and terminates failed worker", async () => {
    MockWorker.nextWorkerBehavior = {
      failOnUci: true,
      failErrorMessage: "HTTP 404: stockfish-19-lite-single.wasm not found",
    };

    const engine = new StockfishEngine();
    await expect(engine.initialize()).rejects.toThrow("stockfish-19-lite-single.wasm not found");
    expect(MockWorker.instances[0].terminated).toBe(true);
    engine.dispose();
  });

  it("4. Initialization timeout: rejects when handshake never completes", async () => {
    vi.useFakeTimers();
    MockWorker.nextWorkerBehavior = { noHandshake: true };

    const engine = new StockfishEngine();
    const initPromise = engine.initialize();
    const rejection = expect(initPromise).rejects.toThrow("Stockfish initialization timed out");

    // Advance 16 seconds past timeout
    await vi.advanceTimersByTimeAsync(16000);
    await rejection;

    expect(MockWorker.instances[0].terminated).toBe(true);
    engine.dispose();
    vi.useRealTimers();
  });

  it("5. Disposal during initialization: aborts without timeout leakage", async () => {
    vi.useFakeTimers();
    MockWorker.nextWorkerBehavior = { noHandshake: true };

    const engine = new StockfishEngine();
    let caughtError: Error | null = null;
    const initPromise = engine.initialize();
    initPromise.catch((err: unknown) => {
      caughtError = err instanceof Error ? err : new Error(String(err));
    });

    // Immediate disposal during StrictMode mount/unmount cycle
    engine.dispose();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(20000);

    expect((caughtError as Error | null)?.message).toBe("Engine disposed");
    expect(MockWorker.instances[0].terminated).toBe(true);
    vi.useRealTimers();
  });

  it("6. Recovery after Worker failure: fresh instance initializes without lingering failure", async () => {
    // First instance fails
    MockWorker.nextWorkerBehavior = {
      failOnUci: true,
      failErrorMessage: "Script load failure",
    };
    const failedEngine = new StockfishEngine();
    await expect(failedEngine.initialize()).rejects.toThrow("Stockfish worker failed");
    failedEngine.dispose();
    expect(MockWorker.instances[0].terminated).toBe(true);

    // Second instance retried
    const freshEngine = new StockfishEngine();
    await freshEngine.initialize();
    expect(MockWorker.instances.length).toBe(2);
    expect(MockWorker.instances[1].terminated).toBe(false);

    const game = new Chess();
    const move = await freshEngine.getBestMove(game, "apprentice");
    expect(move).toBe("e7e5");

    freshEngine.dispose();
    expect(MockWorker.instances[1].terminated).toBe(true);
  });

  it("7. Retry without duplicate Workers: terminating old engine leaves exactly one active worker", async () => {
    const engine1 = new StockfishEngine();
    await engine1.initialize();
    expect(MockWorker.instances.length).toBe(1);

    // Dispose old engine when retrying
    engine1.dispose();
    expect(MockWorker.instances[0].terminated).toBe(true);

    const engine2 = new StockfishEngine();
    await engine2.initialize();
    expect(MockWorker.instances.length).toBe(2);
    expect(MockWorker.instances[0].terminated).toBe(true);
    expect(MockWorker.instances[1].terminated).toBe(false);

    engine2.dispose();
    expect(MockWorker.instances[1].terminated).toBe(true);
  });

  it("8. Search cancellation: stop() resolves pending search with null and halts engine", async () => {
    const engine = new StockfishEngine();
    await engine.initialize();

    // Enable delayed move response for the active worker
    MockWorker.instances[0].delayMoveResponse = true;

    const game = new Chess();
    const movePromise = engine.getBestMove(game, "knight");
    await Promise.resolve();
    expect(engine.isBusy()).toBe(true);

    engine.stop();
    const result = await movePromise;
    expect(result).toBeNull();
    expect(engine.isBusy()).toBe(false);
    expect(MockWorker.instances[0].postedMessages).toContain("stop");

    engine.dispose();
  });

  it("9. Stale responses after restart or undo: late bestmove is safely ignored", async () => {
    const engine = new StockfishEngine();
    await engine.initialize();

    MockWorker.instances[0].delayMoveResponse = true;

    const game = new Chess();
    const movePromise = engine.getBestMove(game, "apprentice");
    await Promise.resolve();

    // Player presses undo or restarts encounter
    engine.stop();
    const result = await movePromise;
    expect(result).toBeNull();

    // Simulate worker sending bestmove late after stop
    const worker = MockWorker.instances[0];
    expect(() => {
      worker.onmessage?.({ data: "bestmove e7e5" } as MessageEvent);
    }).not.toThrow();

    expect(engine.isBusy()).toBe(false);
    engine.dispose();
  });

  it("10. Engine URL generation: includes valid script URL and encoded wasm hash fragment", () => {
    const urls = getEngineUrls();
    expect(urls.scriptUrl.href).toContain("engine/stockfish-19-lite-single.js");
    expect(urls.wasmUrl.href).toContain("engine/stockfish-19-lite-single.wasm");
    expect(urls.targetUrl).toContain("#" + encodeURIComponent(urls.wasmUrl.href));

    const workerUrl = getWorkerUrl();
    expect(workerUrl).toBe(urls.targetUrl);
  });

  it("11. Duplicate initialize() calls return the identical promise", async () => {
    const engine = new StockfishEngine();
    const p1 = engine.initialize();
    const p2 = engine.initialize();
    expect(p1).toBe(p2);
    await p1;
    engine.dispose();
  });
});
