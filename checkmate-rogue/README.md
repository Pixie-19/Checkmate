# Checkmate Rogue

> *A dark gothic chess roguelike — where every move leaves a memory.*

Face three rival adversaries of increasing strength. Collect powerful relics. Let the rivals learn your playing habits. Defeat them all to claim the crown.

No installation required — runs entirely in your browser as a static web application.

---

## Gameplay

### Objective

Defeat all three rival adversaries in sequence to complete a run:

| Encounter | Rival | Stockfish Strength |
|-----------|-------|-------------------|
| 01 | **The Nameless Rival** | Apprentice (ELO ~1320) |
| 02 | **The Iron Warden** | Knight (ELO ~1800) |
| 03 | **The Crown Keeper** | Boss (ELO ~2400) |

### Hearts

You begin each run with **3 hearts**. Losing a chess encounter costs one heart. Reach zero and the run ends. Drawing a game restores no hearts and grants no relic — you retry the same encounter.

### Relics

Win an encounter to choose one relic from the available pool. Each relic grants a **single-use ability** per chess game:

| Relic | Ability | Trade-off |
|-------|---------|-----------|
| **Oracle's Debt** | Ask Stockfish for the best move in the current position | Bumps the *next* encounter's difficulty by one tier |
| **Fortress Pact** | Get a local heuristic defensive move suggestion | None |
| **Knight's Echo** | Undo your last move (engine reply also undone if applicable) | Forfeits your next relic reward on a win |

### Rival Intelligence

Each rival silently observes your playing patterns throughout the encounter and records:

- Whether and when you castled
- Early queen activity
- Repeated piece moves (failure to develop)
- Pawn push frequency
- Capture aggression
- Check delivery frequency

This behavioral profile drives the rival's **Observation**, **Taunt**, and **Tactical Tip** dialogue. The rivals do not learn between runs, and no data leaves your browser — analysis is entirely local and deterministic.

> **Important:** The game does **not** train a chess model, perform online weight updates, or use machine learning of any kind. Behavior analysis is a set of hand-coded heuristic rules applied to the current game's move list.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build tool | Vite 8 |
| Chess rules | [chess.js](https://github.com/jhlywa/chess.js) v1 |
| Chess engine | [Stockfish 19 Lite Single-threaded WASM](https://github.com/official-stockfish/Stockfish) |
| Icons | [lucide-react](https://lucide.dev/) |
| Optional AI dialogue | [Ollama](https://ollama.com/) `gemma2:2b` (local only) |

---

## Architecture

```
src/
├── engine/
│   └── stockfish.ts          # Worker wrapper for Stockfish WASM
├── ai/
│   ├── playerBehavior.ts     # Heuristic move-list analysis
│   ├── rivalInsight.ts       # Deterministic dialogue templates
│   └── dialogueProvider.ts   # Provider abstraction (Scripted / Gemma)
├── game/
│   ├── campaign.ts           # Run state, hearts, relics, progression
│   ├── relicEffects.ts       # Relic mechanics (hint, undo, defense)
│   └── encounterState.ts     # Per-encounter relic usage flags
├── data/
│   └── relics.ts             # Relic definitions
├── components/
│   └── HowToPlay.tsx         # First-run onboarding modal
├── App.tsx                   # Root component, game orchestration
└── App.css                   # Gothic design system
```

### Stockfish Integration

Stockfish 19 Lite runs as a **Web Worker** loaded from `/engine/stockfish-19-lite-single.js`. The WASM binary (`stockfish-19-lite-single.wasm`) is co-located in the same directory so the worker can resolve it without cross-origin issues.

The engine communicates via UCI protocol over `postMessage`. The wrapper in `stockfish.ts`:
- Handles the `uci` → `uciok` → `isready` → `readyok` handshake
- Enforces a 15-second initialization timeout
- Manages a single pending move promise at a time
- Disposes cleanly on React effect cleanup (React StrictMode safe)

Difficulty maps to UCI `Skill Level` + `UCI_LimitStrength` + `UCI_Elo` combinations.

### Behavior Analysis

`playerBehavior.ts` scans the move history of the current game and produces a `PlayerBehaviorProfile` containing:

- Summary statistics (castled, side, queen moves, pawn pushes, captures, checks)
- A ranked list of `PlayerInsight` objects (id, title, description, evidence snippets, confidence level)
- A `hasSufficientEvidence` flag (requires ≥ 3 player moves)

This profile is recomputed on every move and fed to the dialogue provider.

### Dialogue Providers

Two providers implement the `DialogueProvider` interface:

1. **TemplateDialogueProvider** — Fully deterministic, offline, zero dependencies. Selects one of ~20 scripted insight templates based on the player's primary behavioral habit, game phase, rival index, and outcome. No network traffic ever.

2. **GemmaDialogueProvider** — Connects to a locally-running Ollama instance. Sends only a minimal, privacy-conscious behavior summary (no PGN, no FEN, no raw move list). Falls back transparently to template dialogue if Ollama is unavailable, misconfigured, or times out. The fallback is always labeled as `"template"` — never falsely attributed to the model.

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- npm 10+

### Installation

```bash
git clone <repository-url>
cd checkmate-rogue
npm install
```

### Running in Development

```bash
npm run dev
```

Opens at `http://localhost:5173` with hot module replacement.

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Available variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_OLLAMA_ENDPOINT` | `http://127.0.0.1:11434/api/generate` | Ollama API endpoint |
| `VITE_OLLAMA_MODEL` | `gemma2:2b` | Model name |
| `VITE_OLLAMA_TIMEOUT_MS` | `4000` | Request timeout (ms) |
| `VITE_IS_HOSTED` | *(unset)* | Set to `true` for public deployments |

---

## Optional: Local Gemma Dialogue via Ollama

The game supports enhanced rival dialogue using a locally-running language model. This feature is **optional** and **only available in local development** — it is automatically disabled in hosted deployments.

### Setup

1. [Install Ollama](https://ollama.com/download)
2. Pull the model:
   ```bash
   ollama pull gemma2:2b
   ```
3. Start Ollama (it runs as a background service automatically on most platforms)
4. In the game's **Chronicle** panel, click **Local Gemma** to switch dialogue mode

The Vite dev server proxies `/ollama` → `http://127.0.0.1:11434` to avoid CORS issues.

If Ollama is unavailable or the model fails, the game silently falls back to scripted dialogue. The fallback is always honest — dialogue generated by a template is never labeled as AI-generated.

---

## Testing

```bash
npm test -- --run
```

**82 tests across 5 suites:**

| Suite | Tests |
|-------|-------|
| `engine/stockfish.test.ts` | 5 |
| `game/campaign.test.ts` | 24 |
| `game/relicEffects.test.ts` | 22 |
| `ai/dialogueProvider.test.ts` | 14 |
| `ai/playerBehavior.test.ts` | 17 |

Tests run in Vitest and do not require a browser, Stockfish binary, or Ollama.

---

## Production Build

```bash
npm run build
```

Output is written to `dist/`. The build includes:

- `dist/index.html` — entry point
- `dist/assets/` — bundled JS and CSS
- `dist/engine/stockfish-19-lite-single.js` — Stockfish worker script
- `dist/engine/stockfish-19-lite-single.wasm` — Stockfish WASM binary

### Preview the Production Build Locally

```bash
npm run preview
```

Opens at `http://localhost:4173`.

---

## Deployment

Checkmate Rogue is a **fully static web application** — no server, no database, no API keys.

### Deployment Checklist

1. Run `npm run build`
2. Upload the entire `dist/` directory to your static host
3. Ensure the host serves `.wasm` files with MIME type `application/wasm`
4. Set `VITE_IS_HOSTED=true` in your build environment to disable Gemma mode for public visitors

### Supported Hosts

Any static file host works: GitHub Pages, Netlify, Vercel (static export), Cloudflare Pages, AWS S3 + CloudFront, etc.

### Subdirectory Deployment

If deploying to a path like `https://example.com/games/checkmate-rogue/`, pass the `--base` flag:

```bash
npx vite build --base=/games/checkmate-rogue/
```

### CORS Headers for WASM

Some browsers require `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers to use `SharedArrayBuffer`. Stockfish 19 Lite (single-threaded) does **not** require `SharedArrayBuffer`, but setting these headers is harmless and future-proofs the deployment.

The Vite dev server and `vite preview` set these headers automatically.

### Gemma in a Hosted Environment

The Local Gemma feature requires each visitor to have Ollama installed locally — this is **not feasible for public deployments**.

When `VITE_IS_HOSTED=true`:
- The Gemma dialogue toggle is hidden
- No requests are ever made to `localhost` or any Ollama endpoint
- Scripted deterministic dialogue is used exclusively
- Players see an accurate label: "Scripted dialogue"

If you want to offer model-driven dialogue to all visitors from a hosted environment, you would need to build and operate your own secure backend proxy to an inference API. This is out of scope for the current version. A reference architecture would include: a server-side proxy that accepts anonymized behavior summaries, calls an inference API (e.g., Vertex AI, Hugging Face Inference Endpoints), and returns validated dialogue JSON — never exposing API credentials to the browser.

---

## Known Limitations

- **No persistent save**: Campaign state is in React memory only. Refreshing the page starts a new run.
- **Single-threaded Stockfish**: Uses the lite single-threaded WASM build. Stronger analysis is available with the multi-threaded build but requires `SharedArrayBuffer` (requires COOP/COEP headers on the host).
- **Promotion always promotes to queen**: Automatic queen promotion on pawn advancement.
- **No clock / time controls**: Untimed encounters only.
- **Local Gemma only**: No cloud AI dialogue in the public build.
- **Desktop-first layout**: The three-column layout collapses gracefully on tablets and phones but the chess board may be small on very narrow screens (<360px).

---

## License

This project uses the following open-source components:

- **chess.js** — BSD 2-Clause License
- **Stockfish** — GPL v3 ([stockfishchess.org](https://stockfishchess.org/))
- **React** — MIT License
- **Vite** — MIT License
- **lucide-react** — ISC License

See individual package licenses in `node_modules/` or on their respective repositories.

The game's original source code, design, and content are copyright their respective authors. Check the repository's `LICENSE` file for terms applicable to this project's original code.
