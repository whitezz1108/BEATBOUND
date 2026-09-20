# BeatBound ARENA — Completion Report
**Agent session:** 2026-09-20 (after `BeatBound_ARENA_New_Agent_Handoff_2026-09-20.md`)
**Workspace:** isolated `BB-arena` copy. No git operations. No wholesale copy-back.

---

## 1. Sync-test root cause and fix

**Failure:** `arena_test.level.json — 2 empty bars: 30, 32` (section T04, bars 25–32).

**Root cause:** The empty-bar rule in `tools/sync-test.ts:346-370` counts a bar as
active only if a mechanic *spawns* in it. T04 places AP21 (bars 25–28, one event
per bar — fine) then AP23 (bars 29–32). AP23 authored events only on pattern bars
1 and 3, and A02 Safe Tile's default `durationBeats` is 2 — half a bar. So the
MOVING refuge from bar 29 died mid-bar and nothing spawned in bars 30/32: genuine
dead air, not validator blindness. The same latent gap existed in AP22 (bar 2)
and AP24 (bars 2+4, though QUADRANT's forced ≥16-beat duration covered them).

**Fix (data-only, no validator or mechanic changes):**
- **AP23 "Shifting Ground"** — one A02 MOVING event per bar: circle bars 1–2
  (opposite `moveStartDeg` each bar, so the drift cannot be camped), line bars 3–4.
- **AP22 "Sector And Spray"** — added the bar-2 spray (A04, offset −45°), which
  the pattern's own name promises.
- Result: `arena_test.level.json` PASS with 50 events; library coverage run now
  spawns 580 mechanics across 71 patterns with no empty bars.

## 2. Playtest method and findings

The in-app browser webview suspends rAF *and* timers when occluded
(`document.hidden` is unforgeable there), so the game cannot run in that surface
unattended. Playtest was therefore done in **headless Edge driven over CDP**
(`playwright-core`, installed `--no-save`, `package.json`/lock untouched) against
the real vite dev build, capturing the live run at targeted bar/beat windows
(24 screenshots in `playtest-shots/`). This is real-runtime verification, but it
is **not human hands** — feel verdicts below are visual-analysis based.

**Reads well:** AP21 Sector Chase (wedge order + next-sector telegraph clear in
both phases), AP22 skip-sweep, AP23 both refuge phases (red floor / green refuge
contrast is the best in the set; path preview visible), AP07 chains (CURVE_S and
X_CROSS unmistakable), AP16 orbit emitter, AP18 pulse spiral, floor warnings in
the checkerboard lab, new AP25 formations (PARALLEL/FAN/SWEEP), new AP26 stripes
(cross layout unmistakable), stage presentation and avatar overall.

**Issues found:**
- **AP24 bar-3 overlap rendered as a bug** — the 4-quadrant event's forced
  16-beat lap collided with the bar-3 half-arena event; two contradictory safe
  sets, one nearly invisible. Fixed by removing the bar-3 event (see §10);
  AP24 is now one clean 16-beat rotation, exactly what its notes describe.
- **AP13 ring gap readability is the weakest read** — during collapse the gap
  direction is not obvious; the telegraph is a faint arc; the two-ring
  narrowing reads as one thick ring. Geometry is fairness-gated and passes;
  this is a *visual polish* item for human eyes (bolder gap markers / louder
  telegraph), not a data bug. Not retuned here per the "tune after real
  playtest" rule.
- **Avatar contrast** — the dark avatar blends against red hazards in dense
  frames; the player hit-burst VFX is red-on-red with rings. Polish note.
- **AP21 wall volley** at one captured instant read as a dense lance column
  with non-obvious gaps (gaps exist and are fairness-floored; the read under
  motion is likely easier than the frozen frame suggests).

## 3. Ring/floor timing in motion

Rings: mechanically fair (fairness tool 2.67s reaction budget at 0.80 intensity,
worst-case travel derived), but gap *communication* is the polish gap (§2).
Floor: excellent — warning length visibly scales with escape distance (the
cross layout telegraphs longer than the strip), progression
TELEGRAPH → CRITICAL → ACTIVE reads clearly. `ringCount > 1` works and stays
readable at the geometry level.

## 4. Projectile readability after rebalance

Good in motion: smaller/slower bullets with distinct centre-vs-edge silhouettes
(radial bursts read as rings of dots; edge volleys as lances). No "few large
fast circles" feel. Dense instants (AP21 wall, AP14 double-time) need motion to
resolve — acceptable, flagged for human feel-check.

## 5. Chain-pattern quality

Strong family. PARALLEL/FAN/SWEEP/CURVE_C/X_CROSS all read at a glance with
bright heads and trailing links; rotation is clamped and visibly followable;
the pivot dot on SWEEP is a nice touch. Legacy LANE/SLASH/CORRIDOR/SNAKE remain
solid.

## 6. Sector sweep / moving safe zones

Sector sweep (A11): clear wedges, readable order, reversal punishes
memorisation as designed — the best of the new mechanics. Moving safe zone
(A02 MOVING): red/green contrast excellent, path preview works; per-bar
relocation (new AP23) is a real ask without being unfair. QUADRANT (A24):
reads well *as a single event* now.

## 7. Showcase changes

`arena_showcase.level.json` rebuilt (still 24 bars ≈ 46s @ 124 BPM, 3×8 bars):
- **A-S01 TEACH d1:** AP26 Floor Stripes → AP01 Checkerboard → AP05 Safe Ground
- **A-S02 PRACTICE d2:** AP25 Chain Formation → AP02 Side Volley → AP03 ×2
- **A-S03 CLIMAX d4:** AP21 Sector Chase (the deliberate two-mechanic
  combination) → AP13 Ring Collapse (ends on EXPAND = release gesture)

Two iterations were needed to make A-S02 uncampable (AP08 spiral left 307
campable corner spots; swapping AP08→AP04 left 6; final AP02 side volleys —
which cycle all four edges — closes it: 0/1681, "must move" in all sections).
Max two major mechanics simultaneous; no kitchen-sink stacking.

## 8. Final Arena pattern count

**26 ARENA patterns** (71 total). New this session: **AP25 Chain Formation**
(PARALLEL/FAN/SWEEP/CURVE_C — one verb, four forms) and **AP26 Floor Stripes**
(horizontal_strip/vertical_strip/cross/sector). Deliberately *not* shipped:
ARC / SPIRAL / ROTATING_CHAINS chains and single/center_danger/outer_danger
floors — supported by code, documented here as intentionally unshipped rather
than padded in (available via lab params).

## 9. Validation — exact results (all run in this workspace)

| command | result |
|---|---|
| `npm run typecheck` | green, no errors |
| `npm run test:timing` | **All timing checks passed**; arena_test 50 events; 71 patterns / 580 mechanics schedule, run, retire; no empty bars |
| `npm run audit` | **No ARENA section can be beaten by standing still** (all showcase/test sections "must move") |
| `npm run fairness` | **All 26 ARENA patterns are readable** (13 individually campable layer pieces — policy: composed camp-audit is the gate) |
| `npm run runner-check` | **12 course(s) fly as planned** |
| `npm test` (all five) | 38 PASS / 0 FAIL |
| `npm run build` | green — tsc + vite, 89 modules, built in 477ms |

## 10. Files changed this session

- `beatbound_library_v1/patterns.mvp.json` — AP22 bar-2 event; AP23 rewritten to
  per-bar events; AP24 bar-3 event removed (overlap bug); AP25/AP26 added (**shared file**)
- `beatbound_library_v1/arena_showcase.level.json` — full rebuild (**shared file**)
- `src/lab/labs.ts` — pattern lab list extended AP21–AP26 (lab-only)
- `tools/__playtest-capture.mjs`, `tools/__playtest-recapture.mjs`,
  `tools/__playtest-new2526.mjs`, `tools/__showcase-shots.mjs` + `playtest-shots/`
  — my playtest harness and evidence (scratch, kept for the next human pass)

## 11. Shared files changed

Still integration-sensitive vs the original `BB`: `patterns.mvp.json`,
`arena_showcase.level.json`. **Untouched this session:** `src/core/fairness.ts`,
`src/core/Mechanic.ts`, `src/tuning.ts`, `mechanics.mvp.json`. No Editor files,
no RUNNER files, no git operations, no wholesale copy-back.

## 12. Remaining rough edges

1. **Human hands-on playtest still not done** — my pass is real-runtime visual
   verification, not feel. Priority list for a human: AP13 gap readability,
   avatar contrast under dense red fields, AP21 wall volley gaps in motion.
2. **Editor discoverability gap confirmed:** `editor/patterns/annotations.json`
   documents none of `movePath` / `safeZone` / `layout` families / `quadrant*` /
   `sectorCount` / `pivot` / `rotationPerRingDeg`. Not fixed here (Editor is
   developed in parallel; handoff forbids touching it).
3. `playwright-core` sits in `node_modules` (installed `--no-save`; manifests
   clean). Remove with a plain `npm ci` if desired.
4. AP24 and AP26 are lab/library-only (AP24 can't meet spawn-per-bar without
   contradicting safe sets; by design).

## 13. Ready for selective integration?

**Mostly yes, with deliberate merge required.** Arena-only source
(`src/mechanics/arena/*`, `src/modes/arena/*`) is low-risk. The two shared data
files changed this session must be diffed against the *current* original `BB`
before merging (RUNNER/Editor may have moved `patterns.mvp.json` too). The
validator suite is fully green here, so the copy is a sound merge source — but
do not merge on validators alone: the human playtest items in §12.1 should gate
final sign-off.
