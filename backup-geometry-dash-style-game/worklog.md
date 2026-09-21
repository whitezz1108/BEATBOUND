# BeatBound — Worklog

Project: BeatBound — music-synchronized side-scrolling rhythm platformer (Next.js 16, canvas engine).

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Environment check + audio acquisition attempt + project init

Work Log:
- Verified project: Next.js 16 + TS + Tailwind 4 + shadcn/ui + zustand installed; dev server on port 3000.
- Attempted real "See Tình" audio download via yt-dlp (web_safari, tv_embedded, android, ios clients) — YouTube blocks datacenter IP ("Sign in to confirm you're not a bot").
- Per spec, did NOT substitute generated music. Structured game to load local files `public/audio/seetinh-original.mp3` + `seetinh-remix.mp3` with clear UI indication + `public/audio/README.md` with exact fetch instructions.
- Created audio README. Initialized this worklog.

Stage Summary:
- Audio strategy: real files auto-detected when supplied; otherwise clearly-labeled TEST MODE metronome click track (not music).
- Next: build engine (constants/types/audio), level system, game engine, UI.

---
Task ID: 2..5
Agent: main (Z.ai Code)
Task: Engine + levels + UI implementation (centralized — tightly coupled real-time systems, not split across subagents)

Work Log:
- (appended progressively below)

---
Task ID: 2
Agent: main (Z.ai Code)
Task: BeatBound engine core — constants, types, audio engine

Work Log:
- Built `src/game/engine/types.ts` (LevelDef authored on beat grids → BuiltLevel world-space), `constants.ts` (CELL=48, VIEW 1280×720, GD-tuned physics: JUMP_V=15.4, GRAVITY=60 → 2u jump, 0.513s air; forgiving hitboxes: player hazard half-width 0.28).
- Built `src/game/engine/audio.ts`: AudioContext master clock (sample-accurate, freezes on pause), dual-track scheduling (original song → crossfade+riser+impact FX → remix), metronome click fills ONLY parts without real audio (honest TEST MODE), synthesized SFX (jump/death/complete).

Stage Summary:
- Engine is song-agnostic; audio clock drives gameplay so pause = ctx.suspend.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Level system — pattern builder, See Tình beatmap, tutorial

Work Log:
- `src/game/levels/patterns.ts`: compiles beat-grid authoring to world space (worldX = sectionStart + beat·speed·60/bpm). Obstacles authored in hitbox-start space.
- `src/game/levels/seetinh.ts`: 4 sections — original intro/hook (8 bars @128bpm), build (16 bars: block hops, saw, triple, ceiling gate), transition runway (8 bars), remix (26 bars @140bpm: chains, doubles, triples, pulses, final triple+pulse finale). ~60 obstacle placements.
- Derived and applied fairness spacing laws from jump-arc math per section tempo (singles ≥1.14/1.24 beats apart; doubles/triples adjacent-spike clusters; gap ≤0.65 beat; gates with clearance).
- `src/game/levels/tutorial.ts`: 5-step 30s tutorial with in-gameplay text banners.
- Wrote throwaway validator (/tmp, not in repo): greedy bot with arc-lookahead + post-landing lookahead. Found & fixed real bugs: doubles/triples were 1-beat-apart (impossible) → made adjacent GD-style clusters; gap death threshold DEATH_Y −2.5→−0.6 (players could fall through 2.5u gaps and snap back). FINAL: ✓ TUTORIAL completed, ✓ SEE TÌNH full level completed (105.8s, 76 jumps).

Stage Summary:
- Level data fully decoupled; new song = new data file. Beatmap proven beatable by simulation.

---
Task ID: 4
Agent: main (Z.ai Code)
Task: Game engine — physics, collisions, loop, particles, renderer

Work Log:
- `GameEngine.ts`: fixed 1/240s substeps driven by audio clock; auto-run; buffered + hold-to-rejump input; GD-style collisions (top-land on blocks, side/bottom death, spike/saw/pulse hitboxes, gap falls, ceiling gates); sections trigger speed/visual transitions; attempts + best% persisted to localStorage; death→instant retry (0.45s lockout); tutorial text emission.
- `particles.ts`: pooled (max 420) — bursts, dust, confetti, beat-reactive ambient, trail.
- `renderer.ts`: 1280×720 logical scaled to element; parallax wireframe polygons + floating shapes pulsing to beat; scrolling beat-grid floor; glowing spikes/blocks/gates/spinning saws/beat-synced pulse rings; finish portal; rotating player cube with squash-stretch + eyes; speed lines + flash + vignette; section-driven energy.

Stage Summary:
- Full game loop verified in browser via in-page autopilot: PLAY → death → retries → transition → remix → LEVEL COMPLETE (attempt 4, 100%, t=106s ≈ designed 104.6s+lead-in).

---
Task ID: 5
Agent: main (Z.ai Code)
Task: UI layer — store, overlays, page, styles

Work Log:
- `src/lib/beatbound-store.ts` (zustand): screen/mode/phase/progress/attempt/best/death/complete/tutorial/audio-status.
- `BeatBoundApp.tsx`: canvas + engine lifecycle, resize observer (canvas DPR + --bbscale UI scale var), keyboard (Space/↑ jump, Esc/P pause, auto-pause on blur) + pointer input, audio preload + status probe, overlays wiring.
- `overlays.tsx`: MainMenu (neon gradient title, PLAY/TUTORIAL, SEE TÌNH card w/ audio status chip + file instructions), HUD (attempt, progress bar w/ %, pause, animated section flash), GET READY, tutorial banners, death overlay (pct + NEW BEST + instant retry), pause overlay, complete overlay (tutorial → PLAY SEE TÌNH).
- Layout: 16:9 frame centered, sticky footer (audio/test-mode hint); overlays authored at 1280×720 scaled via CSS transform → pixel-perfect at any viewport incl. mobile portrait.
- globals.css: neon glow, section-flash/ready/pulse keyframes, .bb-ui-frame scaling.

Stage Summary:
- Mobile portrait + desktop verified via browser screenshots; no console errors; MENU/pause/death/complete flows all exercised.

---
Task ID: 6-8
Agent: main (Z.ai Code)
Task: Verification & wrap-up

Work Log:
- Agent Browser end-to-end: menu → tutorial (banners, jump teaching) → PLAY (attempt counter, progress %, section flashes "SEE TÌNH — ORIGINAL"/"BUILD UP"/"HERE IT COMES…"/"REMIX — FASTER!") → death overlays w/ best% persistence → instant retry → pause/resume → full completion (in-page autopilot using validated bot logic).
- Audio: YouTube blocked all yt-dlp client attempts (datacenter IP bot-wall) → per spec, NO generated music substitute; game loads /audio/seetinh-original.mp3 + /audio/seetinh-remix.mp3 when supplied; menu + footer clearly show TEST MODE with exact paths; public/audio/README.md has ready-to-run yt-dlp commands.
- Final lint ✓, tsc ✓ (my files), dev.log healthy (only expected 404s for missing audio files).

Stage Summary:
- BeatBound prototype complete and browser-verified. To enable the real song: drop the two mp3s into public/audio/ and reload.
