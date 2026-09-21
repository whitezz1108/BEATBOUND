/**
 * Layer 4a -- deterministic compiler: level_blueprint_v2 -> runtime level.json.
 *
 * The AI director decides *what the level is*: where sections start and end,
 * which mode each one plays, how hard it is, what function it serves, which
 * patterns families suit it, and where the sync points are. This module turns
 * that decision into the runtime's level format. It never asks the model for
 * anything, and it never invents gameplay:
 *
 *   - pattern ids come from the live pattern index (unknown ids are dropped
 *     here *and* were already rejected by the blueprint validator)
 *   - the actual bar-by-bar pattern placement is `fillSection` from
 *     editor/generator/levelDirector.js -- the same code path the rule-based
 *     director uses, so the AI path cannot drift from the tested one
 *   - transitions (tail/head bar geometry, hazard reduction, scene effects)
 *     come from `buildTransition`, likewise shared
 *
 * The one thing the blueprint owns that the rule-based director computed
 * itself is the section tiling and the mode assignment; everything downstream
 * of that is derived here exactly as before.
 *
 * Bar convention: the blueprint is half-open `[start_bar, end_bar_exclusive)`,
 * the runtime is `startBar` + `lengthBars`. The conversion is the only place
 * the two conventions meet.
 */

import { loadPatternIndex } from '../generator/patternIndex.js';
import { breatherForSection } from '../generator/breather.js';
import { buildTransition } from '../generator/transitionGenerator.js';
import { energyStats, fillSection } from '../generator/levelDirector.js';
import { createRng, hashString, round2 } from '../generator/seed.js';
import { beatsPerBarOf, breatherBeats } from './blueprint.js';

export const COMPILER_VERSION = '2.0.0';

/**
 * Compile a validated blueprint into a runtime level definition.
 *
 * The caller is expected to have run `validateBlueprint` already -- this
 * function repairs nothing and reports what it could not do in `warnings`
 * rather than throwing, so the pipeline can surface a level that is *mostly*
 * right and let the repair loop or the operator decide.
 *
 * @param {object} blueprint            beatbound_level_blueprint_v2
 * @param {object} opts
 * @param {object} opts.analysis        the **v1 projection** (`music_analysis.json`),
 *   not `music_analysis_v2.json`. The bar grid the difficulty bands read
 *   (`bars[].energy`, `bars[].rhythmDensity`) lives only in the projection;
 *   V2 carries its energy in `timeline.windows[]` on a 0.25 s hop instead. The
 *   Python analysis writes both in one run, so the pipeline has both to hand.
 * @param {object} opts.directorContext director_context_v2.json
 * @param {object} opts.rules           {gameplay, difficulty, transition}
 * @param {string} [opts.projectRoot]
 * @param {number} [opts.seed]          overrides blueprint.request.seed
 * @returns {{level: object, warnings: string[], meta: object}}
 */
export function compileBlueprint(blueprint, opts = {}) {
  const { analysis, directorContext, rules } = opts;
  if (!analysis) throw new Error('compileBlueprint: analysis is required');
  if (!directorContext) throw new Error('compileBlueprint: directorContext is required');
  if (!rules?.gameplay || !rules?.difficulty || !rules?.transition) {
    throw new Error('compileBlueprint: rules must carry gameplay, difficulty and transition');
  }
  // A V2 analysis has no top-level `bars`, and `energyStats` would quietly
  // return zeros for every section -- every difficulty would land in the
  // lowest band and the level would be uniformly flat. Fail loudly instead.
  if (!Array.isArray(analysis.bars) || analysis.bars.length === 0) {
    throw new Error(
      'compileBlueprint: analysis.bars is empty -- pass the v1 projection ' +
        '(music_analysis.json), not music_analysis_v2.json',
    );
  }

  const warnings = [];
  const index = loadPatternIndex({ projectRoot: opts.projectRoot });
  const beatsPerBar = beatsPerBarOf(directorContext, blueprint);
  const seed = opts.seed ?? blueprint.request?.seed ?? 1;
  const gameRules = rules.gameplay;
  const diffRules = rules.difficulty;
  const transitionRules = rules.transition;

  // ---- 1. blueprint sections -> director-shaped shims ----------------------
  // `fillSection` and `buildTransition` were written against the director's own
  // section shape, and they are the tested implementation, so the compiler
  // adapts to them rather than the other way round. Energy comes from the
  // analysis bar grid over the section's real bars -- the same source the
  // rule-based director used, so difficulty bands behave identically.
  const sections = blueprint.sections.map((s) => {
    const startBar = s.start_bar;
    const endBarExclusive = s.end_bar_exclusive;
    const lengthBars = endBarExclusive - startBar;
    return {
      id: s.id,
      startBar,
      endBar: endBarExclusive - 1, // inclusive, the director's convention
      lengthBars,
      mode: s.mode,
      function: s.function,
      difficulty: s.difficulty,
      intensity: s.intensity,
      rationale: s.rationale,
      variant: s.variant ?? 0,
      course: s.course,
      energy: energyStats(analysis, startBar, endBarExclusive - 1),
    };
  });

  if (sections.length === 0) throw new Error('compileBlueprint: blueprint has no sections');

  // ---- 2. breathers --------------------------------------------------------
  // The runtime stops spawning for the last `breatherBeats` before a mode
  // change. `breatherBeats` mirrors src/tuning.ts exactly; if it ever disagrees
  // the tail of a section plays as dead air the compiler thought was filled.
  const breatherValue = breatherBeats(blueprint.song?.bpm ?? analysis.global?.bpm, {
    breatherBeats: transitionRules.breatherBeats,
    countdownSeconds: transitionRules.countdownSeconds,
  });

  for (let i = 0; i < sections.length; i++) {
    const breather = breatherForSection(sections[i], sections[i + 1] ?? null, breatherValue, beatsPerBar);
    sections[i].fillBars = breather ? breather.fillBars : sections[i].lengthBars;
    sections[i].breatherFromBeat = breather ? breather.fromBeat : null;
  }

  // ---- 3. transitions ------------------------------------------------------
  // Geometry (tail/head bars) comes from buildTransition so the AI path gets
  // the same hazard reduction the rule-based path does. The *visual* choice
  // belongs to the blueprint: its `transition_out.kind` and `scene` win, and
  // the generated scene is only a fallback when the director said nothing.
  const boundary = new Map(); // `${fromId}>${toId}` -> {tailBars, headBars}
  const compiledTransitions = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const from = sections[i];
    const to = sections[i + 1];
    const declared = blueprint.sections[i].transition_out ?? null;

    if (from.mode === to.mode) {
      // Same-mode boundary: no mode change, so no breather and no hazard
      // reduction -- but the blueprint may still ask for a visual beat (a wipe
      // into a new phrase, a palette shift). `transitionOut` stays null because
      // the runtime reads it as "which mode does this hand off to"; the visual
      // intent rides on the section's `scene` instead.
      if (declared) {
        compiledTransitions.push({
          fromSection: from.id,
          toSection: to.id,
          kind: null,
          sameMode: true,
          reason: declared.reason ?? null,
          scene: declared.scene ?? [],
          fromBlueprint: true,
        });
      }
      continue;
    }

    const { record, tailBars, headBars } = buildTransition(from, to, {
      rules: transitionRules,
      gameRules,
      music: analysis,
      rng: createRng((seed ^ hashString(`T:${from.id}>${to.id}`)) >>> 0),
    });
    boundary.set(`${from.id}>${to.id}`, { tailBars, headBars });

    compiledTransitions.push({
      ...record,
      // The blueprint's intent overrides the generated presentation, but the
      // geometry above is what the bars were filled against.
      kind: declared?.kind ?? record.kind,
      reason: declared?.reason ?? null,
      breatherBeats: declared?.breather_beats ?? breatherValue,
      scene: declared?.scene ?? record.scene,
      fromBlueprint: declared !== null,
    });

    if (declared && declared.breather_beats !== undefined && declared.breather_beats < breatherValue) {
      // validateBlueprint already errored on this, so reaching here means the
      // compiler was called on an unvalidated blueprint. Say so rather than
      // silently emitting a section whose tail is dead air.
      warnings.push(
        `${from.id}: asks for ${declared.breather_beats} breather beats but the runtime uses ${breatherValue}`,
      );
    }
  }

  // ---- 4. patterns ---------------------------------------------------------
  // One fill pass in bar order, exactly like the rule-based director: per-mode
  // family history keeps variety across sections that reuse a mode.
  const modeHistory = new Map();
  const notes = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];

    // A RUNNER course replaces the pattern timeline for its section. Filling
    // both would make the runtime warn and throw the patterns away.
    if (s.course) {
      s.patterns = [];
      notes.push(`${s.id} ${s.mode} d${s.difficulty} ${s.function} (${s.startBar}-${s.endBar}) :: course`);
      continue;
    }

    const outgoing = boundary.get(`${s.id}>${sections[i + 1]?.id}`);
    const incoming = i > 0 ? boundary.get(`${sections[i - 1].id}>${s.id}`) : null;

    // A mode the pattern library has no patterns for cannot be filled. The
    // blueprint validator rejects unknown modes, so reaching here means the
    // compiler was handed an unvalidated blueprint -- and since this function
    // promises to report rather than throw, it says so and moves on. The
    // repair loop needs a level back to diff against the validator's errors.
    if (!index.byMode.get(s.mode)?.length) {
      s.patterns = [];
      warnings.push(`${s.id}: mode ${s.mode} has no patterns in the library -- the section will be empty`);
      notes.push(`${s.id} ${s.mode} :: no pattern pool`);
      continue;
    }

    const breather = breatherForSection(s, sections[i + 1] ?? null, breatherValue, beatsPerBar);
    fillSection(s, {
      headBars: incoming?.headBars ?? 0,
      tailBars: outgoing?.tailBars ?? 0,
      index,
      gameRules,
      diffRules,
      transitionRules,
      modeHistory,
      seed,
      breather,
      beatsPerBar,
    });
    notes.push(
      `${s.id} ${s.mode} d${s.difficulty} ${s.function} (${s.startBar}-${s.endBar}) :: ` +
        `${s.patterns.length} pattern(s)`,
    );
  }

  // ---- 5. runtime level ----------------------------------------------------
  const level = {
    version: '1.0.0',
    editor: {
      seed,
      analysisSource: directorContext.source?.audio_file ?? analysis.source?.path ?? null,
      blueprintVersion: blueprint.schema_version,
      compilerVersion: COMPILER_VERSION,
      generator: blueprint.generator?.kind ?? 'unknown',
      intent: blueprint.global?.intent ?? null,
      syncPoints: blueprint.sync_points ?? [],
    },
    song: {
      id: blueprint.song.id,
      title: blueprint.song.title,
      audio: blueprint.song.audio,
      bpm: blueprint.song.bpm,
      timeSignature: blueprint.song.timeSignature,
    },
    sections: [],
  };

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const declared = blueprint.sections[i];
    const outgoing = compiledTransitions.find((t) => t.fromSection === s.id);

    const section = {
      id: s.id,
      startBar: s.startBar,
      lengthBars: s.lengthBars,
      mode: s.mode,
      function: s.function,
      difficulty: s.difficulty,
      patterns: s.patterns.map((p) => ({
        patternId: p.patternId,
        repeat: p.repeat ?? 1,
        intensity: p.intensity ?? round2(0.5),
      })),
      transitionOut: outgoing?.kind ?? null,
    };

    if (s.course) {
      section.course = compileCourse(s, beatsPerBar, seed, warnings);
    }

    // Editor extension: scene instructions from the outgoing transition. The
    // runtime ignores `scene` today; it is carried so the presentation layer
    // has something to consume later.
    if (outgoing?.scene?.length > 0) {
      section.scene = {
        effects: outgoing.scene.map((e) => ({
          effect: e.effect,
          params: e.params ?? {},
          durationBeats: e.durationBeats ?? 4,
        })),
      };
    }

    // Provenance the operator can diff against the blueprint.
    if (s.breatherFromBeat !== null) section.breatherFromBeat = s.breatherFromBeat;
    if (declared.rationale) section.rationale = declared.rationale;

    level.sections.push(section);
  }

  return {
    level,
    warnings,
    meta: {
      compilerVersion: COMPILER_VERSION,
      seed,
      beatsPerBar,
      breatherBeats: breatherValue,
      sectionCount: sections.length,
      transitions: compiledTransitions,
      difficultyCurve: sections.map((s) => ({
        sectionId: s.id,
        difficulty: s.difficulty,
        function: s.function,
        mode: s.mode,
        energy: s.energy.mean,
      })),
      notes,
    },
  };
}

/**
 * Blueprint course -> runtime course.
 *
 * The blueprint already speaks the runtime's course vocabulary -- `phrases`,
 * `phraseBeats`, `generate` -- because the blueprint validator checks those
 * exact fields, so this is a pass-through with the two things the director is
 * not asked to compute filled in: a seed (from the level seed) and `generate.
 * beats` (the section's true length in beats, so the course covers it exactly).
 *
 * An authored `phrases` list wins outright; `generate` is only emitted when the
 * director asked for a procedural course, because the runtime warns when a
 * course carries both.
 */
function compileCourse(section, beatsPerBar, seed, warnings) {
  const spec = section.course;
  const sectionBeats = section.lengthBars * beatsPerBar;
  const courseSeed = Number.isInteger(spec.seed) ? spec.seed : seed;
  const hasPhrases = Array.isArray(spec.phrases) && spec.phrases.length > 0;

  const course = {
    phraseBeats: spec.phraseBeats ?? 4,
    seed: courseSeed,
    phrases: hasPhrases ? spec.phrases : [],
  };

  if (!hasPhrases) {
    course.generate = {
      ...(spec.generate ?? {}),
      beats: spec.generate?.beats ?? sectionBeats,
      seed: Number.isInteger(spec.generate?.seed) ? spec.generate.seed : courseSeed,
      intensity: spec.generate?.intensity ?? section.intensity ?? 0.5,
    };
  }

  // The runtime measures a section as `lengthBars * 4` regardless of the real
  // meter (src/core/LevelLoader.ts). In 4/4 -- every song in the library -- the
  // two agree. In any other meter the runtime would warn about a course that is
  // exactly right, so say so here instead of letting it look like our bug.
  if (beatsPerBar !== 4) {
    warnings.push(
      `${section.id}: song is ${beatsPerBar}/4 but the runtime measures course coverage as lengthBars * 4; ` +
        `expect a spurious coverage warning from the level loader`,
    );
  }
  if (!hasPhrases && !(course.generate.beats > 0)) {
    warnings.push(`${section.id}: course.generate.beats is ${course.generate.beats}; the runtime will reject it`);
  }
  return course;
}
