# BeatBound Level Editor Development Prompt

You are continuing development of my existing game project
**BeatBound**.

This task is ONLY about building the new level creation system.

Do NOT significantly modify the existing playable gameplay unless a very
small integration hook is absolutely necessary. The existing game should
remain independently playable.

## 1. Create a Separate Editor

Create a new folder directly under the existing project root:

``` text
/project-root
    /editor
    /existing-game-files...
```

All automatic level-generation tools should be developed inside
`/editor`. Do NOT move the existing game into `/editor`.

## 2. Main Goal

Build an **AI-assisted BeatBound Level Creation Workshop**.

Workflow:

``` text
Upload Music / Assets
        ↓
Analyze Music
        ↓
music_analysis.json
        ↓
AI / Rule-Based Level Director
        ↓
Level Blueprint
        ↓
Manual Fine-Tuning
        ↓
Generate level.json
        ↓
Playtest
        ↓
Edit & Iterate
```

## 3. Suggested Architecture

``` text
editor/
    README.md
    music-analysis/
        analyze_music.py
        requirements.txt
    schemas/
        music-analysis.schema.json
        level-blueprint.schema.json
        level.schema.json
    rules/
        gameplay-rules.json
        difficulty-rules.json
        transition-rules.json
    generator/
        levelDirector.js
        patternGenerator.js
        difficultyManager.js
        transitionGenerator.js
    patterns/
        arena/
        runner/
        vertical/
        fourth-mode/
    ui/
    output/
        music_analysis.json
        level_blueprint.json
        level.json
```

Adjust after inspecting the existing project, but keep the editor
modular and separate.

## 4. Music Analysis --- Use librosa

Use the open-source Python library `librosa`. Do NOT implement beat
detection from scratch.

Create `editor/music-analysis/analyze_music.py`.

Extract at least: - Duration - Tempo / BPM - Beat timestamps - Onset
timestamps and strength - RMS energy - Relative intensity - Rhythm
density - Structural section boundaries - Major energy changes

Do not pretend to know semantic labels such as chorus/drop/verse unless
reliable. Initial sections may simply be `section_01`, `section_02`,
etc.

Output `editor/output/music_analysis.json` in a structured,
human-readable, stable format.

## 5. AI as Level Director

Do NOT let AI directly generate arbitrary obstacles.

Architecture:

``` text
music_analysis.json
        ↓
AI LEVEL DIRECTOR
        ↓
RULE SYSTEM + PATTERN LIBRARY
        ↓
level_blueprint.json
        ↓
LEVEL GENERATOR
        ↓
level.json
```

AI decides high-level structure: - Gameplay mode - Section difficulty -
Pattern family - Pattern density - Transition timing - Visual
intensity - Camera intensity

Rules and pattern libraries generate actual gameplay.

## 6. Use Existing Game Elements

Inspect the current BeatBound project and identify all four existing
gameplay modes.

Generate levels using existing gameplay mechanics and objects. Do NOT
invent an unrelated new gameplay system.

## 7. Four-Mode Rotation

A song should cycle through all four gameplay modes before repeating
one:

`A → B → C → D → A → B...`

Do NOT divide the song into four equal chunks. Choose boundaries based
on detected sections, energy changes, strong beats, structural changes,
and major onsets.

## 8. Level and Scene Transitions

Every gameplay-mode change needs a transition period, initially around
2--4 seconds or 4--8 beats.

Transitions should provide: - Hazard reduction - Camera/environment
transition - Player repositioning - Preparation for new controls - Scene
initialization

Support scene-transition instructions such as camera zoom/pan,
background changes, palette changes, particles, wipes, environment
movement, and light flashes. Do not use all effects at once.

## 9. Music Energy → Level Design

Low energy should use lower density, simpler patterns, larger recovery
windows, and lower visual intensity.

Medium energy should use normal density, moderate difficulty, and longer
sequences.

High energy should use greater complexity, density, pattern
combinations, long chains, and stronger visual effects.

**High energy does NOT mean extreme object speed.** Increase complexity,
density, layering, and pattern length before raw speed.

## 10. Pattern Library

Create reusable pattern definitions, for example:

``` text
editor/patterns/
    arena/
        radial_out.json
        radial_in.json
        radial_alternating.json
        radial_mixed.json
    runner/
        basic_chain.json
        rapid_chain.json
        platform_chain.json
        gravity_chain.json
    vertical/
        basic_notes.json
        hold_sequence.json
        dense_sequence.json
    fourth-mode/
        ...
```

Use actual project naming after inspection.

Patterns may define ID, gameplay mode, difficulty, duration, beat
length, minimum reaction time, spawn/movement configuration, allowed
next patterns, and tags.

Arena should understand radial outward, inward, alternating, spiral,
mixed, and recovery patterns.

Runner should understand basic jump, rapid jump, stair jump, platform
chain, gap chain, gravity chain, ceiling chain, mixed chain, and
recovery patterns.

Vertical should use existing supported note types, including single,
alternating, dense, hold, mixed hold, and recovery sequences.

## 11. Level Blueprint

Generate `editor/output/level_blueprint.json`.

The blueprint should describe gameplay sections, transitions,
difficulty, patterns, timing, and relevant scene instructions. Adapt its
schema to the existing game's actual level format rather than forcing an
incompatible structure.

## 12. Deterministic Generation

Support a seed.

The same song + music analysis + rules + seed should produce the same
generated level. Avoid uncontrolled randomness.

## 13. Manual Fine-Tuning UI

The first editor does not need to be a professional DAW.

At minimum allow the designer to: - Select/upload a song - Run music
analysis - View detected sections - View assigned gameplay modes -
Change gameplay mode - Change difficulty - Change pattern - Change
section start/end - Change transition duration - Regenerate one
section - Generate final level - Playtest

If reasonably achievable, show waveform, beat markers, section markers,
gameplay-mode blocks, transition blocks, and pattern labels.

The key interaction is selecting one section and editing or regenerating
only that section.

## 14. Level Generation and Playtesting

Convert `level_blueprint.json` into `level.json`.

The final file should contain everything required by the existing game
runtime.

Preferred separation:

``` text
EDITOR
↓
JSON
↓
GAME RUNTIME
```

Avoid having the editor directly manipulate runtime objects throughout
the game.

Create a practical playtest loop:

`Generate → Playtest → Return to Editor → Modify → Generate Again → Playtest Again`

## 15. Do Not Overbuild

This is an MVP.

Focus on: - Music analysis - Structured JSON - Level Director - Rule
system - Pattern Library - Four-mode sequencing - Transitions - Basic
manual editor - Level generation - Playtesting

Do NOT spend time on user accounts, cloud storage, community sharing,
online marketplace, multiplayer, or complex backend systems.

## 16. Development Order

1.  Inspect current project, identify four modes, current level format,
    and external level-loading opportunities. Record findings in
    `editor/README.md`.
2.  Create editor architecture and JSON schemas.
3.  Implement librosa analysis and `music_analysis.json`.
4.  Build Pattern Library, gameplay rules, and difficulty rules.
5.  Implement Level Director, four-mode rotation, transition logic, and
    `level_blueprint.json`.
6.  Build basic editor UI with section/pattern editing and per-section
    regeneration.
7.  Generate `level.json` and integrate the playtest workflow.

## 17. Acceptance Criteria

The editor milestone succeeds when I can: 1. Open the editor. 2. Select
or upload a song. 3. Analyze it using librosa. 4. Produce
`music_analysis.json`. 5. Generate a level blueprint. 6. See all four
gameplay modes used throughout the song. 7. See transition sections
between modes. 8. Change gameplay mode manually. 9. Change pattern
manually. 10. Change difficulty manually. 11. Regenerate one individual
section. 12. Generate `level.json`. 13. Playtest the generated level.
14. Return to the editor and modify it again.

## Final Design Philosophy

**Music Analysis understands the song.**

**AI decides the high-level level structure.**

**Rules enforce valid gameplay.**

**Pattern Libraries provide intentionally designed gameplay.**

**Human designers fine-tune the result.**

**The existing BeatBound runtime plays the final level.**

The goal is not random procedural generation. The goal is **automated +
rule-based + editable + music-aware level design**.

Start by inspecting the existing project before implementing anything.
