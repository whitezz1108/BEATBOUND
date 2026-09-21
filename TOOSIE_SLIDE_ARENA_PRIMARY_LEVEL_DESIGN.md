# Toosie Slide — Arena Primary

Design and coverage document for `beatbound_library_v1/toosie_slide_arena_primary.level.json`.

Arena-dominant multi-mode arrangement of *Dance Fruits Music, Steve Void — Toosie Slide (Sped Up)*.
Seven sections, 76 bars, six mode transitions, five recurring Arena motifs.

---

## 1. Audio source

| | |
|---|---|
| File | `beatbound_library_v1/audio/editor/dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3` |
| Level `song.audio` | `audio/editor/dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3` |
| Duration | **147.133741 s** |
| Source hash | `f2d5e0b065da4978` (audioHash `f2d5e0b0…03444a`) |

The same recording the analysis was run against — verified by hash, not by filename.

## 2. Analysis source path

| | |
|---|---|
| Analysis | `editor/output/toosie_slide/music_analysis_v2.json` |
| Director context | `editor/output/toosie_slide/director_context_v2.json` |
| Analyzer | `beatbound-audio-analyzer` 2.1.0, schema 2 |
| Settings | `v2.1.1-sr22050-hop512-win500hop250`, stems `htdemucs` 4.1.0, melody `basic-pitch` 0.4.0 |
| Structure method | `beat-sync-checkerboard` |
| Flags | `bpmOverride: 125.6`, `timeSignature: [4,4]`, `force: true` |

Reported warnings: `no reliable tonal centre -- key reported as null`. The level does not depend on key, so this is inert here.

## 3. Timing assumptions

- **BPM 125.6**, tempo confidence 1.0, 4/4. One beat = 0.477707 s, one bar = 1.910828 s.
- Bar 1 beat 1 is t = 0.0 s; the song is **77 bars** long (bar 78 beat 1 lands exactly on 147.133741 s).
- **The grid does not drift.** All 307 `beat` events the analyzer detected deviate **0.0 ms** from the ideal 125.6 BPM grid — maximum 0.0 ms across the whole song. There is therefore no timing-representation problem to correct, and no per-pattern nudging was needed (§3.3).
- The prompt's prose bar labels (§4, §6, §15) sit roughly **one bar earlier** than the same moments measured on the real grid. Every bar number in this document is recomputed on the 125.6 BPM grid from the analyzer's own onset times; §9 lists the mapping. Where the two disagree, the grid wins (§3.2), and the level's section boundaries were chosen to match the prompt's *labelled* landmarks so that §10's transition targets land exactly.
- Gameplay is placed only where `0.0 <= t <= 147.133741`. The analysis contains **0 `important_events`**, so §3.1 has nothing to discard. The level's last level-event is at 141.401 s; its last *gameplay input* is the A12 seal's final note at 143.790 s; the level ends at 145.223 s, exactly where the music stops (§3, below).
- **Every ARENA pattern event in the library is on an integer beat.** This is a hard vocabulary constraint: no ARENA pattern can place an event on a 16th-note pickup. All 120 spawned events in this level are on the integer beat, and **all 120 coincide with an analyzer-detected beat to within 0.0000 s**.
- **Breather:** a mode-changing section's tail is emptied from `sectionEnd − 6 beats`, i.e. a 6-beat / 2.866 s runway (`Math.max(6, Math.round(3 × bpm / 60)) = max(6, 6)`). Five authored events fall in these runways and are deliberately not spawned (§8).
- **Where the song actually ends.** The analyzer's window energy holds drum = 1.00 and bass = 1.00 through 145.00 s (bar 76.88) and collapses to 0.00 at 145.50 s. Bar 77 (145.223 s) is therefore the true end of the music, and the level is 76 bars long so that its last gameplay lands inside the last sounding bar rather than in the digital silence.

## 4. Full 76-bar macro map

| # | Bars | Time | Mode | Function | Diff | Patterns (repeat @ intensity) | transitionOut |
|---|---|---|---|---|---|---|---|
| S01 | 1–17 | 0.00–32.48 s | **ARENA** | TEACH | 2 | AP01×2@0.30, AP01×1@0.35, AP03×2@0.42, AP02×1@0.48, AP05×1@0.52, AP03×1@0.60, AP26×1@0.62 | `ARENA_TO_RUNNER` |
| S02 | 18–24 | 32.48–45.86 s | RUNNER | VARIATION | 2 | RP01×2@0.50, RP02×2@0.55, RP03×1@0.60, RP16×1@0.55 | `RUNNER_TO_ARENA` |
| S03 | 25–40 | 45.86–76.43 s | **ARENA** | COMBINE | 3 | AP25×1@0.55, AP05×1@0.48, AP21×1@0.55, AP05×1@0.58, AP13×1@0.65 | `ARENA_TO_RADIAL` |
| S04 | 41–48 | 76.43–91.72 s | RADIAL | VARIATION | 3 | DP01×4@0.55, DP06×2@0.68, DP10×1@0.72 | `RADIAL_TO_ARENA` |
| S05 | 49–55 | 91.72–105.10 s | **ARENA** | COMBINE | 4 | AP22×1@0.70, AP03×1@0.62, AP05×1@0.50 | `ARENA_TO_VERTICAL` |
| S06 | 56–59 | 105.10–112.74 s | VERTICAL | VARIATION | 3 | VP01×2@0.50, VP02×1@0.55 | `VERTICAL_TO_ARENA` |
| S07 | 60–76 | 112.74–145.22 s | **ARENA** | CLIMAX | 5 | AP05×1@0.62, AP06×1@0.78, AP26×1@0.85, AP20×1@0.88, AP29×1@0.95 | `null` |

Sections are contiguous (no gaps, no overlaps); placements sum exactly to each section's `lengthBars`.
Every mode-changing section carries a `scene` block (2 effects, 4 beats); S07 carries `lightFlash` + `particles`.
The section boundaries 18 / 25 / 41 / 49 / 56 / 60 are exactly §6's macro-plan boundaries and exactly §10's six transition targets.

### Placement-level map

| Section | Placements (absolute bars) |
|---|---|
| S01 | AP01 1–2, AP01 3–4, AP01 5–6, AP03 7, AP03 8, AP02 9–10, AP05 11–12, AP03 13, AP26 14–17 |
| S02 | RP01 18, RP01 19, RP02 20, RP02 21, RP03 22, RP16 23–24 |
| S03 | AP25 25–28, AP05 29–30, AP21 31–34, AP05 35–36, AP13 37–40 |
| S04 | DP01 41, DP01 42, DP01 43, DP01 44, DP06 45, DP06 46, DP10 47–48 |
| S05 | AP22 49–52, AP03 53, AP05 54–55 |
| S06 | VP01 56, VP01 57, VP02 58–59 |
| S07 | AP05 60–61, AP06 62–65, AP26 66–69, AP20 70–73, AP29 74–76 |

## 5. Exact mode allocation

```
Arena    bars / total    57 / 76   75.00 %
Runner   bars / total     7 / 76    9.21 %
Radial   bars / total     8 / 76   10.53 %
Vertical bars / total     4 / 76    5.26 %
number of mode transitions           6
```

All four sit inside the §5 targets (ARENA 70–80, RUNNER 8–12, RADIAL 8–12, VERTICAL 4–8), with Arena comfortably above the 70 % floor. Arena opens the level (bar 1) and owns the ending (bar 76).

## 6. Arena motif definitions

Five motifs, each using real library mechanics, each with introduction → variation → combination → late-song transformation (§8 asks for at least four).

### Motif A — FLOOR PULSE  *(mechanic A01 Floor Warning)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 1–4 | AP01 @0.30 — checkerboard A/B tiles; step off the warned tile |
| Variation | S01 5–6 | AP01 @0.35 — the same read, tightened |
| Combination | S01 14–17 | AP26 @0.62 — A01 as four layouts: `horizontal_strip`, `vertical_strip`, `cross`, `sector` |
| Late transformation | S07 66–69 | AP26 @0.85 — the same four-layout combination at climax intensity, now wedged between the chain corridor and the densest projectile phrase |

**repeat_001 descendant:** bars 14–17 (AP26) → bars 66–69 (AP26). Bars 66–69 sit wholly inside the required 63–71 window. It is a recognizable descendant, not a literal copy of bars 1–17: the mechanic and the pattern recur, the intensity (0.62 → 0.85) and the surrounding material do not.

### Motif B — CROSSFIRE  *(A03 Projectile, A04 Radial Burst, A06 Laser)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 9–10 | AP02 @0.48 — A03 walls from LEFT / RIGHT / TOP / BOTTOM |
| Variation | S03 31–34 | AP21 @0.55 — the same A03 burst interleaved with A11 sector chases |
| Combination | S05 49–52 | AP22 @0.70 — A04 bursts from `CENTER`, two angles apart, while the sector closes |
| Late transformation | S07 70–73 | AP20 @0.88 — A04 centre + edge bursts woven with A06 lasers on alternating axes |

### Motif C — CHAIN  *(mechanic A05 Chain)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 7–8 | AP03 @0.42 — four-direction chain, one direction per beat |
| Variation | S03 25–28 | AP25 @0.55 — one link per bar; room to re-read the corridor |
| Combination | S05 53 | AP03 @0.62 — the introduction returned *on the bass drop* (see §10) |
| Late transformation | S07 62–65 | AP06 @0.78 — widening gap 0.25 → 0.75, axis flips at bar 65 |

### Motif D — ENCLOSURE  *(A10 Ring, A11 Sector Sweep, A12 Rhythm Breakout)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S03 31–34 | AP21 @0.55 — A11 sector chase |
| Variation | S03 37–40 | AP13 @0.65 — A10 ring collapse |
| Combination | S05 49–52 | AP22 @0.70 — A11 sector sweep and A10 ring in one pattern |
| Late transformation | S07 73.1 → 75.1 | A10 `ADVANCED_ALTERNATING` collapse (46°/ring) into **A12 Rhythm Breakout**, `RUNE_SEAL`, 8-note sequence, `maxMisses: 1`, `failureMode: HEAVY` |

The enclosure motif ends as a literal seal: the ring stops being an obstacle to dodge and becomes a barrier the player must break open on the beat. A12 activates at bar 75 beat 1 = **141.401 s**, which is the song's energy maximum (0.826 at 141.25 s), and its `finalBeatOffset: 5` puts the breakout resolution at **143.790 s** — the last sounding bar.

### Motif E — SAFE GROUND  *(mechanic A02 Safe Tile)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 11–12 | AP05 @0.52 — the inverse lesson: one safe tile, then two |
| Variation | S03 29–30 | AP05 @0.48 — the micro-release after the RUNNER excursion |
| Combination | S03 35–36 | AP05 @0.58 — the same read under the escalation's pressure |
| Late transformation | S05 54–55 | AP05 @0.50 — the release *inside the breakdown*, at the song's lowest energy point (0.016 at 102.0 s) |
| Late transformation | S07 60–61 | AP05 @0.62 — the final re-entry: the level's calmest mechanic opens the last act |

## 7. Purpose of each supporting mode

| Mode | Bars | Music region | Why this mode, here |
|---|---|---|---|
| **RUNNER** | 18–24 | Analysis `section_02` — the drop: drum 0.966, bass 0.957, the highest in the song | The song's biggest moment gets *release*, not escalation. Runner deletes the spatial-aiming language entirely and substitutes one-axis timing (jump / slide / step). Uses only R01 Spike, R03 Low Wall, R04 Platform — the three clearest RUNNER mechanics — and exits after 7 bars, before it can become the song's identity. |
| **RADIAL** | 41–48 | Analysis `section_04` opening — build, energy 0.541 | This is repeat_002's second occurrence opening. It preserves the rhythm cadence of the Runner excursion's opening (one hit per beat) while changing the interaction language to four directions converging on a centre ring. Uses D01, D02, D06 only. |
| **VERTICAL** | 56–59 | bass 0.00, drum ≤ 0.57, melody 1.00, energy 0.28–0.43 | The deliberate clean breakdown, and the only place in the song where the low end disappears for four straight bars. Four falling lanes, hit the key on the line, no spatial reading at all — placed exactly where the music thins, and held to 4 bars. §6 says "do NOT make this the hardest section": it is the level's second-lowest intensity band. |

None of the three covers its mode exhaustively, and none runs long enough to be mistaken for the song's identity. The rest of the song returns to Arena, as §9's repeat_002 requires.

## 8. Transition plan

All six use the real transition/breather system (`LevelLoader` `breatherFromBeat` + `ModeManager.setMode`), and all six land on §10's target bar exactly.

| # | Transition | Bar | Breather `breatherFromBeat` | Breather runway | Outgoing hazards |
|---|---|---|---|---|---|
| 1 | ARENA → RUNNER | **18** | 62 (bar 16.50) | bars 16.50–17.99 | `ArenaMode.deactivate()` drops all mechanics |
| 2 | RUNNER → ARENA | **25** | 90 (bar 23.50) | bars 23.50–24.99 | `RunnerMode.deactivate()` drops all mechanics |
| 3 | ARENA → RADIAL | **41** | 154 (bar 39.50) | bars 39.50–40.99 | ARENA mechanics dropped |
| 4 | RADIAL → ARENA | **49** | 186 (bar 47.50) | bars 47.50–48.99 | RADIAL mechanics dropped |
| 5 | ARENA → VERTICAL | **56** | 214 (bar 54.50) | bars 54.50–55.99 | ARENA mechanics dropped |
| 6 | VERTICAL → ARENA | **60** | 230 (bar 58.50) | bars 58.50–59.99 | VERTICAL mechanics dropped |

Notes:

- **No switch happens mid-pattern.** Each breather begins 6 beats before the section end, and `PatternScheduler` suppresses any event whose `activationBeat` reaches it, so the outgoing mode's tail is empty by construction rather than by luck.
- **Hazards clear on every switch.** `ArenaMode.deactivate()`, `RunnerMode.deactivate()` and `VerticalMode.deactivate()` all reset their mechanic lists, so nothing lethal survives into the incoming mode. No transition can cause damage.
- **Perceptual time for the new language** comes from the breather plus the incoming section's `leadInBeats`; the transition wipe itself is 2 beats (`TUNING.transition.sceneBeats`).
- `transitionOut` is a free-string animation label in the schema, used as the wipe's caption id; `ARENA_TO_RUNNER` etc. are valid and render as "arena to runner" under the mode name.

**Five authored events are deliberately not spawned**, because they fall in these runways:

| Section | Suppressed events | Time |
|---|---|---|
| S01 | AP26 17.1 (A01) | 30.573 s |
| S02 | RP16 24.1 (R04) | 43.949 s |
| S03 | AP13 40.1 (A10) | 74.522 s |
| S05 | AP05 55.1 (A02) | 103.185 s |
| S06 | VP02 59.1 (V02) | 110.828 s |

125 events are authored; **120 spawn**. These are the runtime's own numbers — they were read back through `LevelLoader` and `breatherFromBeat`, and they match `validateLevel`'s five "expected tail hand-off" warnings one-for-one. Every one of the five is the last event of its section, i.e. exactly the hand-off the runway is designed to absorb.

## 9. Major musical anchors

The prompt's §15 anchor list is written against a slightly earlier bar labelling. Recomputed onto the real grid (`bar = t / 1.910828 + 1`):

| Prompt time | Real bar | Anchor | Used by the level |
|---|---|---|---|
| 23.405 s | 13 | energy rise | AP03 13.1–13.4 (A05, i0.60) — the first payoff's chain burst |
| 25.356 s | 14 | energy peak / strong beat | AP26 14.1 (A01) |
| 29.256 s | 16 | energy peak | AP26 16.1 (A01) |
| 33.157 s | 18 | energy peak + section boundary | RUNNER 18.1 / 18.3 (R01) — the excursion is live on the boundary |
| 37.058 s | 20 | energy peak | RP02 20.1 / 20.2 / 20.4 (R01) |
| 44.860 s | 24 | energy peak | *inside the S02 runway — deliberately empty* (see below) |
| 50.711 s | 27 | energy peak | AP25 27.1 (A05) |
| 54.612 s | 29 | deep energy drop | AP05 29.1 (A02) — the micro-release |
| 70.215 s | 37 | energy rise | AP13 37.1 (A10) |
| 72.166 s | 38 | energy peak + strong beat | AP13 38.1 (A10) |
| 78.017 s | 41 | section boundary | DP01 41.1–41.4 (D01) — RADIAL is live on the boundary |
| 79.967 s | 42 | energy peak | DP01 42.1–42.4 (D01) |
| 85.819 s | 45 | energy peak | DP06 45.1 / 45.3 (D02) |
| 89.720 s | 47 | energy peak | DP10 47.1 (D06) |
| 93.620 s | 49 | energy peak | AP22 49.1 / 49.3 (A11 + A04) |
| 97.521 s | 52 | energy peak | AP22 52.1 (A10) |
| 99.472 s | 53 | energy drop | AP03 53.1–53.4 (A05) — the chain lands on the bass drop |
| 107.273 s | 57 | energy drop | VP01 57.1–57.4 (V01) — the breakdown |
| 115.075 s | 61 | energy rise | AP05 61.1 (A02) — the final re-entry |
| 117.026 s | 62 | energy peak | AP06 62.1 (A05) |
| 118.976 s | 63 | strong beat | AP06 63.1 (A05) |
| 120.926 s | 64 | peak + section boundary | AP06 64.1 (A05) |
| 124.827 s | 66 | peak | AP26 66.1 (A01) |
| 128.728 s | 68 | energy drop | AP26 68.1 (A01) |
| 130.679 s | 69 | energy rise | AP26 69.1 (A01) |
| 132.629 s | 70 | energy peak | AP20 70.1 / 70.3 (A04 + A06) |
| 138.480 s | 73 | section boundary | AP20 73.1 / 73.3 (A10 + A07) |
| 140.431 s | 74 | final-section peak | A12 seal telegraph — the seal appears at bar 74 beat 1, activates at 75.1 |
| 142.381 s | 75 | strong beat | AP29 75.1 (A12) — the seal's activation |
| 144.332 s | 76 | final energy drop | A12 seal resolution (final note at 143.790 s, inside bar 76) |

Used selectively: anchors mark section boundaries, drops and peaks, not one object per event.

Coverage of the 30 anchors:

| | Count |
|---|---:|
| A spawned gameplay hit in the anchor's own bar | 27 / 30 |
| No hit in its own bar, but inside the A12 seal window (bars 74–76) | 2 / 30 — 140.431 s, 144.332 s |
| Covered only by an adjacent bar | 1 / 30 — 44.860 s |
| Uncovered | **0 / 30** |

The adjacent-bar case is intentional rather than missed: 44.860 s falls inside the deliberate S02 runway (bars 23.50–24.99), which is emptied so the RUNNER excursion ends cleanly before the mode changes.

## 10. Difficulty curve

Non-monotonic, following §18. The two excursions are troughs by design — a mode change is a change of *language*, not of difficulty.

| Bars | §6 role | This level |
|---|---|---|
| 1–4 | intro / calibration | AP01 @0.30 — one mechanic, checkerboard tiles, two hits per bar |
| 5–6 | development | AP01 @0.35 — the same read, tightened |
| 7–8 | development | AP03 @0.42 — A05 chain introduced, four directions in one bar |
| 9–10 | development | AP02 @0.48 — A03 projectile walls introduced |
| 11–12 | development | AP05 @0.52 — A02 safe ground, the inverse lesson |
| 13 | first mini-climax | AP03 @0.60 — chain burst, the energy rise at 23.405 s |
| 14–17 | first mini-climax | AP26 @0.62 — A01 as four layouts; bar 17 is the runway |
| 18–24 | *(excursion)* | RUNNER @0.50–0.60 — difficulty *drops*; the drop is a release |
| 25–28 | return / groove rebuild | AP25 @0.55 — chain slows to one link per bar |
| 29–30 | return / groove rebuild | AP05 @0.48 — micro-release at the deep energy drop (54.612 s) |
| 31–34 | return / groove rebuild | AP21 @0.55 — A11 sector chase introduced, A03 interleaved |
| 35–36 | major escalation | AP05 @0.58 — the safe-tile read under pressure |
| 37–40 | major escalation | AP13 @0.65 — A10 ring collapse; bar 40 is the runway |
| 41–48 | *(excursion)* | RADIAL @0.55–0.72 — trough, then a local peak at DP10 |
| 49–52 | heavy return | AP22 @0.70 — the heaviest Arena phrase, entirely inside the full-drums region (drum 1.00 / bass 1.00, energy 0.59–0.85) |
| 53 | heavy return → drop | AP03 @0.62 — the chain burst lands on the bass drop (bass 1.00 → 0.01 between 99.25 s and 99.50 s) |
| 54–55 | release | AP05 @0.50 — safe tile at the energy trough (0.016 at 102.0 s); bar 55 is the runway |
| 56–59 | *(excursion)* | VERTICAL @0.50–0.55 — the clean breakdown, melody-only |
| 60–61 | final re-entry build | AP05 @0.62 — the calmest Arena mechanic opens the last act |
| 62–65 | final major climax | AP06 @0.78 — chain corridor, gap 0.25 → 0.75, axis flips at 65 |
| 66–69 | final major climax | AP26 @0.85 — the repeat_001 descendant, four floor layouts |
| 70–73 | compact peak | AP20 @0.88 — 8 hits over 4 bars: A04 bursts + A06 lasers, then A10 ring + A07 rotating fan |
| 74–76 | final burst and resolution | AP29 @0.95 — **A12 Rhythm Breakout**, activation at the song's energy peak (141.401 s), resolving at 143.790 s |

Intensities map to §16 bands: 0.30–0.35 teach, 0.42–0.48 light, 0.50–0.60 medium, 0.62–0.72 medium-high, 0.78–0.95 high. Human pacing overrides mechanical scaling — the excursions sit at medium regardless of the music's energy, because the point of an excursion is legibility.

**One deliberate deviation from §6's prose.** §6 describes bars 53–55 as "rebuild" (rising). The analyzer shows the opposite: bass falls from 1.00 to 0.01 at 99.50 s (bar 53.07) and stays at 0.00 for the rest of the section, with the window energy bottoming at 0.016 at 102.0 s (bar 54.38). Bars 53–55 are a *breakdown*, not a rebuild, so the level descends (0.70 → 0.62 → 0.50) instead. §16's "human-readable pacing overrides mechanical scaling" and §3.2's "prefer the beat grid" both point the same way.

## 11. Technical constraints

- **No new mechanics.** Every event uses an id already in `mechanics.mvp.json`. Mechanics used: A01, A02, A03, A04, A05, A06, A07, A10, A11, A12, D01, D02, D06, R01, R03, R04, V01, V02 — 18 ids, all with a runtime implementation. No runtime system was changed to make this level work.
- **Vocabulary limit:** ARENA pattern events are integer-beat only, so 16th-note syncopation cannot be authored in ARENA. The level therefore reads the music on the beat, which is what §3.2 asks for.
- **Fairness:** `camp-audit` reports 0/1681 safe spots on all four ARENA sections (verdict `ok (must move)`, minimum 14 / 18 / 5 / 8 hits for a stationary player). No ARENA section can be beaten by standing still.
- **RUNNER geometry:** all 25 RUNNER patterns pass `runner-check` ("Every RUNNER pattern is clearable"); S02 uses RP01, RP02, RP03, RP16, all `ok`. No speed changes, no custom geometry, `x` fixed by `trackX`.
- **Sync:** 120/120 spawned events coincide with an analyzer-detected beat to within 0.0000 s; the beat grid itself is drift-free (0.0 ms maximum deviation across all 307 detected beats).
- **Duration:** last level-event 141.401 s; last gameplay input (A12 resolution) 143.790 s; level ends 145.223 s; song ends 147.133741 s. No gameplay after the real duration.

### Known limitations

1. **First obstacle of the RUNNER section has no scroll-in.** RUNNER mechanics declare `telegraphBeats: 0`, so S02's `leadInBeats` is 0 and the mode goes live exactly on bar 18 beat 1. Its first obstacle spawns `SCROLL_LEAD_BEATS = 4` beats earlier, before the mode is live, so `ModeManager` queues it and flushes it at the switch — where `trackX` puts it exactly at `PLAYER_X`. Measured lead: **0.002 beats** instead of 4.
   This is a pre-existing property of every pattern-driven RUNNER section, not of this level: `prototype_90s` shows the identical thing on both of its RUNNER sections (bar 9, lead 0.009 beats; bar 39, lead 0.029 beats). It is exactly one obstacle per RUNNER section — the one on the section's first beat — and this level has the minimum possible incidence, one RUNNER section. `runner-check` does not catch it because it validates pattern clearability, not spawn lead at a section boundary. The course path is unaffected: `compileCourse` sets `leadInBeats = max(SCROLL_LEAD_BEATS, beatsPerBar)`, which is the fix the pattern path is missing. Not changed here, because it would alter the mode-switch timing of an unrelated shipped level.
2. **The final 16th-note pickup is not representable.** The song's true last onset is a `melody_rise` + `large_pitch_jump` (strength 1.0) at 144.962 s = bar 76 beat 4.5. No ARENA pattern places an event off the integer beat, so no hit can land on it. The level instead lets the A12 seal resolve at 143.790 s and leaves 143.79–145.22 s as the visual release §4's Section 05 asks for; the music's own last full-energy bar (76) is covered by the seal's final note.
3. **A09 Wave Sweep is unused.** S05 has a 7-bar budget (bars 49–55, per §6's macro plan) whose last 1.5 bars are the mode-change runway. A09's pattern is 2 bars, and the only arrangements that fit it push either the heavy block or a third of the pattern into the runway. A11 Sector Sweep already carries the section's sweeping-wall identity, so A09 was left out rather than authored as a mostly-suppressed pattern. The level still uses 18 of the library's 25 mechanics.

## 12. QA table

| Bars | Music role | Mode | Main mechanics/patterns | Motif | Intensity | Transition |
|---|---|---|---|---|---:|---|
| 1–4 | intro / calibration | ARENA | AP01 ×2 — A01 Floor Warning (checkerboard A/B) | A intro | 0.30 | — |
| 5–6 | development | ARENA | AP01 — A01, tightened read | A variation | 0.35 | — |
| 7–8 | development | ARENA | AP03 ×2 — A05 Chain, four directions | C intro | 0.42 | — |
| 9–10 | development | ARENA | AP02 — A03 Projectile walls, four sides | B intro | 0.48 | — |
| 11–12 | development | ARENA | AP05 — A02 Safe Tile (inverse lesson) | E intro | 0.52 | — |
| 13 | first mini-climax | ARENA | AP03 — A05 chain burst at the 23.405 s rise | C | 0.60 | — |
| 14–17 | first mini-climax | ARENA | AP26 — A01 as strip / vertical / cross / sector *(17.1 suppressed)* | A combination | 0.62 | `ARENA_TO_RUNNER` |
| 18–19 | the drop (drum 0.97) | RUNNER | RP01 ×2 — R01 Spike | repeat_002 opening 1 | 0.50 | — |
| 20–21 | the drop | RUNNER | RP02 ×2 — R01 Spike, off-beat | | 0.55 | — |
| 22 | the drop | RUNNER | RP03 — R01 + R03 Low Wall | | 0.60 | — |
| 23–24 | the drop | RUNNER | RP16 — R04 Platform *(24.1 suppressed)* | | 0.55 | `RUNNER_TO_ARENA` |
| 25–28 | return / groove rebuild | ARENA | AP25 — A05 Chain, one link per bar | C variation | 0.55 | — |
| 29–30 | return / groove rebuild | ARENA | AP05 — A02 Safe Tile at the 54.612 s drop | E variation | 0.48 | — |
| 31–34 | return / groove rebuild | ARENA | AP21 — A11 Sector Chase / A03 Burst | D intro, B variation | 0.55 | — |
| 35–36 | major escalation | ARENA | AP05 — A02 Safe Tile under pressure | E combination | 0.58 | — |
| 37–40 | major escalation | ARENA | AP13 — A10 Ring Collapse *(40.1 suppressed)* | D variation | 0.65 | `ARENA_TO_RADIAL` |
| 41–44 | cross-mode reinterpretation | RADIAL | DP01 ×4 — D01, one hit per beat | repeat_002 opening 2 | 0.55 | — |
| 45–46 | build | RADIAL | DP06 ×2 — D02 | | 0.68 | — |
| 47–48 | build peak | RADIAL | DP10 — D06 | | 0.72 | `RADIAL_TO_ARENA` |
| 49–52 | heavy return (drum+bass full) | ARENA | AP22 — A11 sector sweep + A04 centre bursts + A10 ring | B + D combination | 0.70 | — |
| 53 | bass drop (1.00 → 0.01) | ARENA | AP03 — A05 chain burst on the drop | C combination | 0.62 | — |
| 54–55 | release / energy trough | ARENA | AP05 — A02 Safe Tile *(55.1 suppressed)* | E late transformation | 0.50 | `ARENA_TO_VERTICAL` |
| 56–57 | breakdown (melody only) | VERTICAL | VP01 ×2 — V01 Tap, four lanes | | 0.50 | — |
| 58–59 | breakdown | VERTICAL | VP02 — V02 Hold *(59.1 suppressed)* | | 0.55 | `VERTICAL_TO_ARENA` |
| 60–61 | final re-entry build | ARENA | AP05 — A02 Safe Tile opens the last act | E late transformation | 0.62 | — |
| 62–65 | final major climax | ARENA | AP06 — A05 Chain Corridor, gap 0.25→0.75, axis flip at 65 | C late transformation | 0.78 | — |
| 66–69 | final major climax | ARENA | AP26 — A01 floor stripes / vertical / cross / sector | **A late transformation (repeat_001 descendant)** | 0.85 | — |
| 70–73 | compact peak | ARENA | AP20 — A04 bursts + A06 lasers, then A10 ring + A07 fan | B + D late transformation | 0.88 | — |
| 74–76 | final burst and resolution | ARENA | AP29 — **A12 Rhythm Breakout**, RUNE_SEAL, 8 notes, maxMisses 1 | **D late transformation (seal)** | 0.95 | — |

**Bars 60–76 are the largest Arena payoff:** five consecutive ARENA placements, intensity 0.62 → 0.95, spanning the repeat_001 descendant, the chain corridor, the densest projectile read, and the A12 seal — with no mode change in between.

### Bar-count report

| | Bars | Share | §5 target |
|---|---:|---:|---|
| ARENA | 57 | 75.00 % | 70–80 % ✅ |
| RUNNER | 7 | 9.21 % | 8–12 % ✅ |
| RADIAL | 8 | 10.53 % | 8–12 % ✅ |
| VERTICAL | 4 | 5.26 % | 4–8 % ✅ |
| **Total** | **76** | 100 % | — |

Mode transitions: 6. Arena opens the song and owns the final climax and ending.
