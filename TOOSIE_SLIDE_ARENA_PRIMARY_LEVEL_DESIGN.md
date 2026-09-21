# Toosie Slide — Arena Primary

Design and coverage document for `beatbound_library_v1/toosie_slide_arena_primary.level.json`.

Arena-dominant multi-mode arrangement of *Dance Fruits Music, Steve Void — Toosie Slide (Sped Up)*.
Seven sections, 76 bars, six mode transitions, four recurring Arena motifs.

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
- **The grid does not drift.** All 307 `beat` events the analyzer detected deviate **0.0 ms** from the ideal 125.6 BPM grid — mean 0.0 ms, maximum 0.0 ms across the whole song. There is therefore no timing-representation problem to correct, and no per-pattern nudging was needed (§3.3).
- The prompt's own section boundaries and anchor times were written against an older 123.05 BPM frame. Every bar number in this document is recomputed on the real 125.6 BPM grid; §9 of this document lists the mapping.
- Gameplay is placed only where `0.0 <= t <= 147.133741`. The analysis contains **0 `important_events`**, so §3.1 has nothing to discard; the level's last event is at 144.745 s and the level ends at 145.223 s, well inside the real duration.
- **Every ARENA pattern event in the library is on an integer beat.** This is a hard vocabulary constraint: no ARENA pattern can place an event on a 16th-note pickup. All 117 spawned events in this level are on the half-beat grid, and **all 117 coincide with an analyzer-detected beat to within 0.0000 s**.
- **Breather:** a mode-changing section's tail is emptied from `sectionEnd − 6 beats`, i.e. a 6-beat / 2.866 s runway (`Math.max(6, Math.round(3 × bpm / 60)) = max(6, 6)`). Ten authored events fall in these runways and are deliberately not spawned (listed in §10).

## 4. Full 76-bar macro map

| # | Bars | Time | Mode | Function | Diff | Patterns (repeat @ intensity) | transitionOut |
|---|---|---|---|---|---|---|---|
| S01 | 1–17 | 0.00–32.48 s | **ARENA** | TEACH | 2 | AP01×2@0.30, AP01×1@0.35, AP03×2@0.42, AP02×1@0.48, AP05×1@0.52, AP26×1@0.62, AP03×1@0.68 | `ARENA_TO_RUNNER` |
| S02 | 18–24 | 32.48–45.86 s | RUNNER | VARIATION | 2 | RP01×2@0.50, RP02×2@0.55, RP03×1@0.60, RP16×1@0.55 | `RUNNER_TO_ARENA` |
| S03 | 25–40 | 45.86–76.43 s | **ARENA** | COMBINE | 3 | AP25×1@0.55, AP05×1@0.48, AP21×1@0.55, AP05×1@0.58, AP13×1@0.65 | `ARENA_TO_RADIAL` |
| S04 | 41–48 | 76.43–91.72 s | RADIAL | VARIATION | 3 | DP01×4@0.55, DP06×2@0.68, DP10×1@0.72 | `RADIAL_TO_ARENA` |
| S05 | 49–56 | 91.72–107.01 s | **ARENA** | COMBINE | 4 | AP22×1@0.70, AP05×1@0.50, AP09×1@0.55 | `ARENA_TO_VERTICAL` |
| S06 | 57–60 | 107.01–114.65 s | VERTICAL | VARIATION | 3 | VP01×2@0.50, VP02×1@0.55 | `VERTICAL_TO_ARENA` |
| S07 | 61–76 | 114.65–145.22 s | **ARENA** | CLIMAX | 5 | AP26×1@0.72, AP06×1@0.78, AP20×1@0.85, AP29×1@0.90, AP03×1@0.95 | `null` |

Sections are contiguous (no gaps, no overlaps); placements sum exactly to each section's `lengthBars`.
Every mode-changing section carries a `scene` block (2 effects, 4 beats); S07 carries `lightFlash` + `particles`.

### Placement-level map

| Section | Placements (absolute bars) |
|---|---|
| S01 | AP01 1–2, AP01 3–4, AP01 5–6, AP03 7, AP03 8, AP02 9–10, AP05 11–12, AP26 13–16, AP03 17 |
| S02 | RP01 18, RP01 19, RP02 20, RP02 21, RP03 22, RP16 23–24 |
| S03 | AP25 25–28, AP05 29–30, AP21 31–34, AP05 35–36, AP13 37–40 |
| S04 | DP01 41, DP01 42, DP01 43, DP01 44, DP06 45, DP06 46, DP10 47–48 |
| S05 | AP22 49–52, AP05 53–54, AP09 55–56 |
| S06 | VP01 57, VP01 58, VP02 59–60 |
| S07 | AP26 61–64, AP06 65–68, AP20 69–72, AP29 73–75, AP03 76 |

## 5. Exact mode allocation

```
Arena    bars / total    57 / 76   75.0 %
Runner   bars / total     7 / 76    9.2 %
Radial   bars / total     8 / 76   10.5 %
Vertical bars / total     4 / 76    5.3 %
number of mode transitions          6
```

All four sit inside the §5 targets (ARENA 70–80, RUNNER 8–12, RADIAL 8–12, VERTICAL 4–8), with Arena comfortably above the 70 % floor. Arena opens the level (bar 1) and owns the ending (bar 76).

## 6. Arena motif definitions

Four motifs, each using real library mechanics, each with introduction → variation → combination → late-song transformation.

### Motif A — FLOOR PULSE  *(mechanic A01 Floor Warning)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 1–4 | AP01 @0.30 — checkerboard A/B tiles; move off the warned tile |
| Variation | S01 5–6 | AP01 @0.35 — the same read, tightened |
| Combination | S01 13–16 | AP26 @0.62 — A01 as four layouts: `horizontal_strip`, `vertical_strip`, `cross`, `sector` |
| Late transformation | S07 61–64 | AP26 @0.72 — the identical combination 48 bars later at maximum floor density |

**repeat_001 descendant:** bars 13–16 (AP26) → bars 61–64 (AP26), landing inside the required 63–71 window. Recognizable, not a literal copy of bars 1–17: the mechanic and pattern recur, the intensity and surrounding material do not.

### Motif B — CROSSFIRE  *(A03 / A04 Radial Burst, A06 Laser)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 9–10 | AP02 @0.48 — A03 bursts from `CENTER` on the half-bar |
| Variation | S03 32, 34 | AP21 @0.55 — the same A03 burst interleaved with A11 sector chases |
| Combination | S05 49.3, 50.3 | AP22 @0.70 — A04 bursts from `EDGE` while the sector closes |
| Late transformation | S07 69–71 | AP20 @0.85 — A04 centre+edge bursts woven with A06 lasers on alternating axes |

### Motif C — CHAIN  *(mechanic A05 Chain)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S01 7–8 | AP03 @0.42 — four-direction chain, one direction per beat |
| Variation | S03 25–28 | AP25 @0.55 — one link per bar; room to re-read the corridor |
| Combination | S07 65–68 | AP06 @0.78 — widening gap 0.25 → 0.75, axis flips at bar 68 |
| Late transformation | S07 76 | AP03 @0.95 — the introduction returned at the level's highest intensity, four links in the final bar |

### Motif D — ENCLOSURE  *(A10 Ring, A11 Sector Chase, A12 Rhythm Breakout)*

| Stage | Where | Material |
|---|---|---|
| Introduction | S03 31, 33 | AP21 @0.55 — A11 sector chase |
| Variation | S03 37–39 | AP13 @0.65 — A10 ring collapse |
| Combination | S05 49.1, 51.1, 52.1 | AP22 @0.70 — A11 chase and A10 ring in one pattern |
| Late transformation | S07 72.1 → 74.1 | A10 `ADVANCED_ALTERNATING` collapse (46°/ring) into **A12 Rhythm Breakout**, `RUNE_SEAL`, 8-note sequence, `maxMisses: 1`, `failureMode: HEAVY` |

The enclosure motif ends as a literal seal: the ring stops being an obstacle to dodge and becomes a barrier the player must break open on the beat. A12's `finalBeatOffset: 5` puts the breakout resolution at beat 297 = **141.879 s**, and the analyzer's strongest onset in that bar is at **141.897 s** — an 18 ms match.

## 7. Purpose of each supporting mode

| Mode | Bars | Music region | Why this mode, here |
|---|---|---|---|
| **RUNNER** | 18–24 | Analysis `section_02` — the drop: drum 0.966, bass 0.957, the highest in the song | The song's biggest moment gets *release*, not escalation. Runner deletes the spatial-aiming language entirely and substitutes one-axis timing (jump / slide / step). Uses only R01 Spike, R03 Low Wall, R04 Platform — the three clearest RUNNER mechanics — and exits after 7 bars, before it can become the song's identity. |
| **RADIAL** | 41–48 | Analysis `section_04` opening — build, energy 0.541 | This is repeat_002's second occurrence opening. It preserves the rhythm cadence of the Runner excursion's opening while changing the interaction language to four directions converging on a centre ring. Uses D01, D02, D06 only. |
| **VERTICAL** | 57–60 | Analysis `section_04` tail — energy trough before the final chorus | The deliberate clean breakdown. Four falling lanes, hit the key on the line, no spatial reading at all — placed exactly where the music thins, and held to 4 bars. |

None of the three covers its mode exhaustively, and none runs long enough to be mistaken for the song's identity. The rest of the song returns to Arena, as §9's repeat_002 requires.

## 8. Transition plan

All six use the real transition/breather system (`LevelLoader` `breatherFromBeat` + `ModeManager.scheduleMode`), and all sit on phrase boundaries.

| # | Transition | Bar | Mode goes live | Breather runway | Outgoing hazards |
|---|---|---|---|---|---|
| 1 | ARENA → RUNNER | 18 | beat 68 (bar 18.000), `leadInBeats 0` | bars 16.5–17.99 (6 beats) | `ArenaMode.deactivate()` drops all mechanics |
| 2 | RUNNER → ARENA | 25 | beat 94.5 (bar 24.625), `leadInBeats 1.5` | bars 23.5–24.99 | `RunnerMode.deactivate()` drops all mechanics |
| 3 | ARENA → RADIAL | 41 | beat 158 (bar 40.500), `leadInBeats 2` | bars 39.5–40.99 | ARENA mechanics dropped |
| 4 | RADIAL → ARENA | 49 | beat 190.5 (bar 48.625), `leadInBeats 1.5` | bars 47.5–48.99 | RADIAL mechanics dropped |
| 5 | ARENA → VERTICAL | 56 | beat 222 (bar 56.500), `leadInBeats 2` | bars 55.5–56.99 | ARENA mechanics dropped |
| 6 | VERTICAL → ARENA | 60 | beat 236 (bar 60.000), `leadInBeats 4` | bars 59.5–60.99 | VERTICAL mechanics dropped |

Notes:

- **No switch happens mid-pattern.** Each breather begins 6 beats before the section end, and `PatternScheduler` suppresses any event whose `activationBeat` reaches it, so the outgoing mode's tail is empty by construction rather than by luck.
- **Hazards clear on every switch.** `ArenaMode.deactivate()`, `RunnerMode.deactivate()` and `VerticalMode.deactivate()` all reset their mechanic lists, so nothing lethal survives into the incoming mode. No transition can cause damage.
- **Perceptual time for the new language** comes from the breather plus the incoming section's `leadInBeats`; the transition wipe itself is 2 beats (`TUNING.transition.sceneBeats`).
- `transitionOut` is a free-string animation label in the schema, used as the wipe's caption id; `ARENA_TO_RUNNER` etc. are valid and render as "arena to runner" under the mode name.

**Ten authored events are deliberately not spawned**, because they fall in these runways:

| Section | Suppressed events |
|---|---|
| S01 | AP03 17.1, 17.2, 17.3, 17.4 |
| S02 | RP16 24.1 |
| S03 | AP13 40.1 |
| S04 | *(none — DP10 47.1 is inside the section's last bar but before the runway)* |
| S05 | AP09 55.3, 56.1, 56.3 |
| S06 | VP02 60.1 |

127 events are authored; 117 spawn. That 117 matches the runtime event count reported by the sync test.

## 9. Major musical anchors

The prompt's §15 anchor list is written in the older 123.05 BPM frame. Recomputed onto the real grid (`bar = t / 1.910828 + 1`):

| Prompt time | Real bar.beat | Anchor | Used by the level |
|---|---|---|---|
| 23.405 s | 13.1.99 | energy rise | AP26 13.1 (A01, i0.62) — first payoff begins |
| 25.356 s | 14.2.08 | energy peak / strong beat | AP26 14.1 (A01) |
| 29.256 s | 16.2.24 | energy peak | AP26 16.1 (A01) |
| 33.157 s | 18.2.41 | energy peak + section boundary | RUNNER 18.3 (R01) — the excursion is live |
| 37.058 s | 20.2.57 | energy peak | RP02 20.1 (R01) |
| 44.860 s | 24.2.91 | energy peak | *inside the S02 runway — deliberately empty* |
| 50.711 s | 27.3.16 | energy peak | AP25 27.1 (A05) |
| 54.612 s | 29.3.32 | deep energy drop | AP05 29.1 (A02) — the micro-release |
| 70.215 s | 37.3.98 | energy rise | AP13 37.1 (A10) |
| 72.166 s | 38.4.07 | energy peak + strong beat | AP13 38.1 (A10) |
| 78.017 s | 41.4.32 | section boundary | DP01 41.4 (D01) — RADIAL is live |
| 79.967 s | 42.4.40 | energy peak | DP01 42.4 (D01) |
| 85.819 s | 45.4.65 | energy peak | DP06 45.3 (D02) |
| 89.720 s | 47.4.81 | energy peak | DP10 47.1 (D06) |
| 93.620 s | 49.4.98 | energy peak | AP22 49.3 (A04) |
| 97.521 s | 52.1.14 | energy peak | AP22 52.1 (A10) |
| 99.472 s | 53.1.23 | energy drop | AP05 53.1 (A02) |
| 107.273 s | 57.1.56 | energy drop | VP01 57.1 (V01) — the breakdown |
| 115.075 s | 61.1.89 | energy rise | AP26 61.1 (A01) — final build |
| 117.026 s | 62.1.97 | energy peak | AP26 62.1 (A01) |
| 118.976 s | 63.2.06 | strong beat | AP26 63.1 (A01) — transformed opening motif |
| 120.926 s | 64.2.14 | peak + section boundary | AP26 64.1 (A01) |
| 124.827 s | 66.2.30 | peak | AP06 66.1 (A05) |
| 128.728 s | 68.2.47 | energy drop | AP06 68.1 (A05) — axis flip |
| 130.679 s | 69.2.55 | energy rise | AP20 69.1/69.3 (A04/A06) |
| 132.629 s | 70.2.64 | energy peak | AP20 70.1/70.3 (A06/A04) |
| 138.480 s | bar 73, beat 2.88 | section boundary | A12 telegraph window (bars 73.31–74.00, 138.18–139.49 s) |
| 140.431 s | bar 74, beat 2.97 | final-section peak | A12 seal is live (activation bar 74 beat 1, danger to bar 75.5) |
| 142.381 s | bar 75, beat 3.05 | strong beat | 0.05 beats after the A12 danger window closes at 142.357 s — the seal has just released |
| 144.332 s | 76.3.13 | final energy drop | AP03 76.3 (A05) |

Used selectively: anchors mark section boundaries, drops and peaks, not one object per event.

Coverage of the 30 anchors:

| | Count |
|---|---:|
| A gameplay hit in the anchor's own bar | 27 / 30 |
| No hit in its own bar, but inside the A12 seal window (bars 73.31–75.50) | 1 / 30 — 138.480 s |
| Covered only by an adjacent bar | 2 / 30 — 44.860 s, 142.381 s |
| Uncovered | **0 / 30** |

The two adjacent-bar cases are both intentional or unavoidable rather than missed: 44.860 s falls inside the deliberate S02 runway (bars 23.5–24.99, emptied so the RUNNER excursion ends cleanly), and 142.381 s lands 0.05 beats after the A12 danger window closes at 142.357 s — the seal has just released.

## 10. Difficulty curve

Non-monotonic, following §18. The two excursions are troughs by design — a mode change is a change of *language*, not of difficulty.

| Bars | §18 role | This level |
|---|---|---|
| 1–4 | teach | AP01 @0.30 — one mechanic, checkerboard tiles, two hits per bar |
| 5–12 | develop | @0.35→0.48; adds A05 chain (7–8), A03 burst (9–10), A02 safe ground (11–12) |
| 13–17 | first payoff | AP26 @0.62 then AP03 @0.68 — four-layout floor, then a chain on every beat |
| 18–24 | *(excursion)* | RUNNER @0.50–0.60 — difficulty *drops*; the drop is a release |
| 25–32 | reset + new spatial vocabulary | AP25 @0.55, AP05 @0.48, AP21 @0.55 — chain slows to one link per bar, then A11 sector chase is introduced |
| 33–40 | strong escalation | AP05 @0.58, AP13 @0.65 — A10 ring collapse introduced |
| 41–48 | *(excursion)* | RADIAL @0.55–0.72 — trough, then a local peak at DP10 |
| 49–55 | heavy return with micro-release | AP22 @0.70, AP05 @0.50 (the micro-release at 53–54), AP09 @0.55 |
| 56–59 | *(runway + excursion)* | bar 56 empty (runway); VERTICAL @0.50–0.55 — the clean breakdown |
| 60–62 | final build | bar 60 runway; AP26 @0.72 from bar 61 |
| 63–69 | transformed opening motif | AP26 @0.72 (63–64), AP06 @0.78 (65–68) |
| 70–71 | compact peak | AP20 @0.85 — 2 hits/bar of A04+A06 then A06+A04 |
| 72–75 | final burst + resolution | AP20 @0.85 (A10 + A07 rotating fan), then A12 @0.90 |
| 76 | resolution | AP03 @0.95 — four chain links in the last bar |

Intensities map to §16 bands: 0.30–0.35 teach, 0.42–0.48 light, 0.50–0.60 medium, 0.62–0.72 medium-high, 0.78–0.95 high. Human pacing overrides mechanical scaling — the excursions sit at medium regardless of the music's energy, because the point of an excursion is legibility.

## 11. Technical constraints

- **No new mechanics.** Every event uses an id already in `mechanics.mvp.json`. Mechanics used: A01, A02, A03, A04, A05, A06, A07, A09, A10, A11, A12, D01, D02, D06, R01, R03, R04, V01, V02 — 19 ids, all with a runtime implementation. No runtime system was changed to make this level work.
- **Vocabulary limit:** ARENA pattern events are integer-beat only, so 16th-note syncopation cannot be authored in ARENA. The level therefore reads the music on the beat, which is what §3.2 asks for.
- **Fairness:** `camp-audit` reports 0/1681 safe spots on all four ARENA sections (verdict `ok (must move)`, minimum 12/18/6/2 hits for a stationary player). No ARENA section can be beaten by standing still.
- **RUNNER geometry:** all 25 RUNNER patterns pass `runner-check` ("Every RUNNER pattern is clearable"); S02 uses RP01, RP02, RP03, RP16, all `ok`. No speed changes, no custom geometry, `x` fixed by `trackX`.
- **Sync:** 117/117 spawned events coincide with an analyzer-detected beat to within 0.0000 s; the beat grid itself is drift-free.
- **Duration:** last event 144.745 s; level ends 145.223 s; song ends 147.133741 s. No gameplay after the real duration.

### Known limitations

1. **First obstacle of the RUNNER section has no scroll-in.** RUNNER mechanics declare `telegraphBeats: 0`, so S02's `leadInBeats` is 0 and the mode goes live exactly on bar 18 beat 1. Its first obstacle spawns `SCROLL_LEAD_BEATS = 4` beats earlier, before the mode is live, so `ModeManager` queues it and flushes it at the switch — where `trackX` puts it exactly at `PLAYER_X`. Measured lead: **0.002 beats** instead of 4.
   This is a pre-existing property of every pattern-driven RUNNER section, not of this level: `prototype_90s` shows the identical thing on both of its RUNNER sections (bar 9, lead 0.009 beats; bar 39, lead 0.029 beats). It is exactly one obstacle per RUNNER section — the one on the section's first beat — and this level has the minimum possible incidence, one RUNNER section. `runner-check` does not catch it because it validates pattern clearability, not spawn lead at a section boundary. The course path is unaffected: `compileCourse` sets `leadInBeats = max(SCROLL_LEAD_BEATS, beatsPerBar)`, which is the fix the pattern path is missing. Not changed here, because it would alter the mode-switch timing of an unrelated shipped level.
2. **The final 16th-note pickup is not representable.** The song's true ending is a `melody_rise` + `large_pitch_jump` (strength 1.0) at 144.962 s = bar 76 beat 4.5. No ARENA pattern places an event off the integer beat, so the closest achievable hit is bar 76 beat 4 at 144.745 s — 0.217 s earlier. Extending the level to bar 77 would put the last hit at 145.223 s, which is both 0.261 s away and inside the song's silent decay (strength 0.006, `vocal_exit` at 145.543 s), so the current ending is the best available within the supported vocabulary.

## 12. QA table

| Bars | Music role | Mode | Main mechanics/patterns | Motif | Intensity | Transition |
|---|---|---|---|---:|---|
| 1–4 | teach | ARENA | AP01 ×2 — A01 Floor Warning (checkerboard A/B) | A intro | 0.30 | — |
| 5–6 | develop | ARENA | AP01 — A01, tightened read | A variation | 0.35 | — |
| 7–8 | develop | ARENA | AP03 ×2 — A05 Chain, four directions | C intro | 0.42 | — |
| 9–10 | develop | ARENA | AP02 — A03 Radial Burst from CENTER | B intro | 0.48 | — |
| 11–12 | develop | ARENA | AP05 — A02 Safe Ground (inverse lesson) | A variation | 0.52 | — |
| 13–16 | first payoff | ARENA | AP26 — A01 as strip / vertical / cross / sector | A combination | 0.62 | — |
| 17 | first payoff | ARENA | AP03 — A05 chain *(all four suppressed by the runway)* | C | 0.68 | `ARENA_TO_RUNNER` |
| 18–19 | the drop (drum 0.97) | RUNNER | RP01 ×2 — R01 Spike | repeat_002 opening 1 | 0.50 | — |
| 20–21 | the drop | RUNNER | RP02 ×2 — R01 Spike, off-beat | | 0.55 | — |
| 22 | the drop | RUNNER | RP03 — R01 + R03 Low Wall | | 0.60 | — |
| 23–24 | the drop | RUNNER | RP16 — R04 Platform *(24.1 suppressed)* | | 0.55 | `RUNNER_TO_ARENA` |
| 25–28 | reset + new vocabulary | ARENA | AP25 — A05 Chain, one link per bar | C variation | 0.55 | — |
| 29–30 | reset | ARENA | AP05 — A02 Safe Ground | A variation | 0.48 | — |
| 31–34 | reset + new vocabulary | ARENA | AP21 — A11 Sector Chase / A03 Burst | D intro, B variation | 0.55 | — |
| 35–36 | escalation | ARENA | AP05 — A02 Safe Ground | A variation | 0.58 | — |
| 37–40 | strong escalation | ARENA | AP13 — A10 Ring Collapse *(40.1 suppressed)* | D variation | 0.65 | `ARENA_TO_RADIAL` |
| 41–44 | cross-mode reinterpretation | RADIAL | DP01 ×4 — D01, one hit per beat | repeat_002 opening 2 | 0.55 | — |
| 45–46 | build | RADIAL | DP06 ×2 — D02 | | 0.68 | — |
| 47–48 | build peak | RADIAL | DP10 — D06 | | 0.72 | `RADIAL_TO_ARENA` |
| 49–52 | heavy return | ARENA | AP22 — A11 chase + A04 edge burst + A10 ring | B combination, D combination | 0.70 | — |
| 53–54 | micro-release | ARENA | AP05 — A02 Safe Ground | A variation | 0.50 | — |
| 55–56 | micro-release → runway | ARENA | AP09 — A09 Rhythm Window *(55.3, 56.1, 56.3 suppressed)* | B variation | 0.55 | `ARENA_TO_VERTICAL` |
| 57–58 | breakdown | VERTICAL | VP01 ×2 — V01 Tap, four lanes | | 0.50 | — |
| 59–60 | breakdown | VERTICAL | VP02 — V02 Hold *(60.1 suppressed)* | | 0.55 | `VERTICAL_TO_ARENA` |
| 61–62 | final build | ARENA | AP26 — A01 floor stripes | A late transformation | 0.72 | — |
| 63–64 | transformed opening motif | ARENA | AP26 — A01 floor stripes | **A late transformation (repeat_001 descendant)** | 0.72 | — |
| 65–68 | transformed opening motif | ARENA | AP06 — A05 Chain Corridor, gap 0.25→0.75, axis flip at 68 | C combination | 0.78 | — |
| 69–71 | compact peak | ARENA | AP20 — A04 bursts + A06 lasers, alternating axes | B late transformation | 0.85 | — |
| 72 | final burst | ARENA | AP20 — A10 ring collapse + A07 Rotating Fan | D late transformation | 0.85 | — |
| 73–75 | final burst + resolution | ARENA | AP29 — **A12 Rhythm Breakout**, RUNE_SEAL, 8 notes, maxMisses 1 | **D late transformation (seal)** | 0.90 | — |
| 76 | resolution | ARENA | AP03 — A05 Chain, four links in the final bar | C late transformation | 0.95 | — |

**Bars 63–75 are the largest Arena payoff:** five consecutive ARENA placements, intensity 0.72 → 0.95, spanning the repeat_001 descendant, the chain combination, the densest projectile read, and the A12 seal — with no mode change in between.
