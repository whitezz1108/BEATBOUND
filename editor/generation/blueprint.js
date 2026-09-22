/**
 * Blueprint V2 -- structural validation and normalization.
 *
 * A Level Director (AI or rule-based) produces a blueprint; this module is the
 * gate it has to pass before the compiler will touch it. Two distinct jobs:
 *
 *   validateBlueprint  -- report what is wrong, with the reason, and never
 *                         silently accept it. Used by the repair loop and by
 *                         the tests.
 *   normalizeBlueprint -- repair what can be repaired *deterministically* and
 *                         record every repair. This is what keeps a plausible
 *                         but sloppy model output from becoming an invalid
 *                         level: out-of-range bars are clamped into the song,
 *                         a broken tiling is rebuilt, and anything the compiler
 *                         cannot honour is dropped with a note.
 *
 * The rule throughout: **the model proposes, the music disposes**. A blueprint
 * section may not invent bars the song does not have, may not name a mode it
 * was not offered, and may not claim a musical sync the director context does
 * not contain.
 */

import { GENERATABLE_MODES, checkCapability } from './gameplayContext.js';

export const BLUEPRINT_V2_SCHEMA_VERSION = 'beatbound_level_blueprint_v2';

/** Difficulty is a 1..5 tier everywhere in the runtime. */
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 5;

/** Section functions the director is offered. */
export const SECTION_FUNCTIONS = [
  'INTRO', 'BUILD', 'PEAK', 'SUSTAIN', 'BREAKDOWN', 'RELEASE', 'OUTRO', 'TRANSITION',
];

/** Who produced a blueprint. `ai_director` means a model wrote the plan. */
export const GENERATOR_KINDS = ['ai_director', 'rule_based', 'manual'];

/** Anchor types a sync point may claim (mirrors director-context-v2). */
export const ANCHOR_TYPES = [
  'section_boundary', 'phrase_boundary', 'energy_rise', 'energy_drop', 'energy_peak',
  'strong_beat', 'strong_onset', 'large_pitch_jump', 'melody_rise', 'melody_fall',
  'melody_peak', 'vocal_entry', 'vocal_exit',
];

/** Scene effects the runtime can actually render on a transition. */
export const SCENE_EFFECTS = [
  'cameraZoom', 'cameraPan', 'paletteShift', 'particles', 'wipe', 'bgChange', 'envMovement', 'lightFlash',
];

/**
 * The breather a mode change must leave, in beats.
 *
 * This must equal what the runtime computes, or the validator will reject
 * levels the engine would happily play (or, worse, accept ones whose last bars
 * are silently dropped). The runtime's rule is in src/core/LevelLoader.ts:
 *
 *     Math.max(TUNING.transition.breatherBeats,
 *              beatsForSeconds(level.song.bpm, TUNING.transition.countdownSeconds))
 *
 * and `beatsForSeconds` (src/tuning.ts) is `max(1, round(seconds * bpm / 60))`.
 * The rounding is load-bearing: at 129.2 BPM the countdown is 6.46 beats, and
 * the runtime uses 6, not 6.46.
 *
 * The tuning values are parameters rather than imports because this module is
 * plain JS run directly by node while `src/tuning.ts` is TypeScript -- the
 * editor server reads the live values and injects them, which is the same
 * mechanism `editor/generator/breather.js` documents.
 *
 * @param {number} bpm
 * @param {{breatherBeats?: number, countdownSeconds?: number}} tuning
 */
export function breatherBeats(bpm, tuning = {}) {
  const floor = tuning.breatherBeats ?? 6;
  const countdown = tuning.countdownSeconds ?? 3;
  return Math.max(floor, beatsForSeconds(bpm, countdown));
}

/** Mirror of src/tuning.ts `beatsForSeconds`. */
export function beatsForSeconds(bpm, seconds) {
  return Math.max(1, Math.round((seconds * bpm) / 60));
}

/**
 * The meter the bar arithmetic must use.
 *
 * The blueprint's `song.timeSignature` is what the *director* declared; the
 * director context's `timing.beats_per_bar` is what the *music* is. The music
 * wins -- a director that mislabels 3/4 as 4/4 would otherwise shift every
 * downstream beat count. `meter` is `[numerator, denominator]` in V2, so the
 * numerator is the authoritative beats-per-bar when present.
 *
 * @param {object} directorContext
 * @param {object} [blueprint]
 */
export function beatsPerBarOf(directorContext, blueprint) {
  const fromTiming = directorContext?.timing?.beats_per_bar;
  if (Number.isFinite(fromTiming) && fromTiming > 0) return fromTiming;
  // `meter` is the string "4/4" in the real director context and an array in
  // hand-written ones; accept both rather than letting "4"[0] === "4" through.
  const meter = directorContext?.timing?.meter;
  if (typeof meter === 'string') {
    const [num] = meter.split('/');
    const n = Number(num);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(meter) && Number.isFinite(meter[0]) && meter[0] > 0) return meter[0];
  const declared = blueprint?.song?.timeSignature;
  if (Array.isArray(declared) && Number.isFinite(declared[0]) && declared[0] > 0) return declared[0];
  return 4;
}

function isInt(v) {
  return Number.isInteger(v);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v, lo, hi) {
  return clamp(Math.round(Number(v)), lo, hi);
}

/**
 * Validate a blueprint against the director context and the gameplay context.
 *
 * @param {object} blueprint
 * @param {object} opts
 * @param {object} opts.directorContext  the `beatbound_director_context_v2` document
 * @param {object} opts.gameplayContext  the output of buildGameplayContext
 * @param {object} opts.patternIndex     the output of loadPatternIndex
 * @param {object} [opts.tuning]         `{breatherBeats, countdownSeconds}`
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateBlueprint(blueprint, { directorContext, gameplayContext, patternIndex, tuning }) {
  const errors = [];
  const warnings = [];

  if (!blueprint || typeof blueprint !== 'object') {
    return { errors: ['blueprint is not an object'], warnings };
  }
  if (blueprint.schema_version !== BLUEPRINT_V2_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${BLUEPRINT_V2_SCHEMA_VERSION}`);
  }

  const songBars = directorContext?.timing?.bar_count;
  const duration = directorContext?.source?.duration_sec;
  const beatsPerBar = beatsPerBarOf(directorContext, blueprint);

  // ---- song identity ------------------------------------------------------
  const song = blueprint.song;
  if (!song || typeof song !== 'object') {
    errors.push('song is missing');
  } else {
    // A warning, not an error. `song.id` names the *level*, and the library
    // already carries variants whose id is deliberately not the song's:
    // `toosie_slide_arena_primary.level.json` declares
    // `song.id: "toosie_slide_arena_primary"` while its `song.audio` points at
    // the one analysed file. What has to match the analysis is the audio, the
    // BPM, the meter and the bar count -- the things gameplay is computed from
    // -- and those are checked below and are errors.
    if (directorContext?.source?.song_id && song.id !== directorContext.source.song_id) {
      warnings.push(
        `song.id ${JSON.stringify(song.id)} is not the analysed song's id ` +
          `${JSON.stringify(directorContext.source.song_id)} -- fine for a named variant, wrong if this ` +
          `level was meant to be the song itself`,
      );
    }
    if (!(song.bpm > 0)) errors.push(`song.bpm must be > 0 (got ${song.bpm})`);
    if (Number.isFinite(directorContext?.timing?.bpm) && song.bpm !== directorContext.timing.bpm) {
      warnings.push(
        `song.bpm ${song.bpm} disagrees with the analysis ${directorContext.timing.bpm}; the analysis is authoritative`,
      );
    }
    if (!Array.isArray(song.timeSignature) || song.timeSignature.length !== 2) {
      errors.push('song.timeSignature must be a [numerator, denominator] pair');
    } else if (song.timeSignature[0] !== beatsPerBar) {
      warnings.push(
        `song.timeSignature ${song.timeSignature[0]}/4 disagrees with the analysis meter ` +
          `${beatsPerBar}/4; the analysis is authoritative`,
      );
    }
    if (isInt(songBars) && song.barCount !== songBars) {
      errors.push(`song.barCount ${song.barCount} does not match the analysis bar_count ${songBars}`);
    }
    // Compare file names, not paths. `level.song.audio` is resolved by the
    // runtime against the library root (`audio/editor/song.mp3`), while the
    // director context records the analysed file as a bare name
    // (`song.mp3`) -- comparing the two directly warns on every correct level.
    const audioFile = directorContext?.source?.audio_file;
    if (audioFile && song.audio !== null && song.audio !== undefined) {
      const basename = (p) => String(p).replace(/\\/g, '/').split('/').pop();
      if (basename(song.audio) !== basename(audioFile)) {
        warnings.push(`song.audio ${JSON.stringify(song.audio)} does not match the analysed file ${JSON.stringify(audioFile)}`);
      }
    }
  }

  // ---- generator ----------------------------------------------------------
  const gen = blueprint.generator;
  if (!gen || typeof gen !== 'object') {
    errors.push('generator is missing');
  } else if (!GENERATOR_KINDS.includes(gen.kind)) {
    errors.push(`generator.kind ${JSON.stringify(gen.kind)} is not one of ${GENERATOR_KINDS.join(', ')}`);
  }

  // ---- global -------------------------------------------------------------
  const glob = blueprint.global;
  if (!glob || typeof glob !== 'object') {
    errors.push('global is missing');
  } else {
    for (const key of ['intent', 'arc']) {
      if (typeof glob[key] !== 'string' || glob[key].length === 0) {
        errors.push(`global.${key} must be a non-empty string`);
      }
    }
    if (!Array.isArray(glob.difficulty_curve)) {
      errors.push('global.difficulty_curve must be an array');
    } else if (
      glob.difficulty_curve.some((d) => !isInt(d) || d < MIN_DIFFICULTY || d > MAX_DIFFICULTY)
    ) {
      errors.push(`global.difficulty_curve entries must be integers in ${MIN_DIFFICULTY}..${MAX_DIFFICULTY}`);
    }
  }

  // ---- notes --------------------------------------------------------------
  if (blueprint.notes !== undefined && !Array.isArray(blueprint.notes)) {
    errors.push('notes must be an array of strings');
  } else if (Array.isArray(blueprint.notes) && blueprint.notes.some((n) => typeof n !== 'string')) {
    errors.push('notes must contain only strings');
  }

  // ---- request ------------------------------------------------------------
  const req = blueprint.request;
  if (!req || typeof req !== 'object') {
    errors.push('request is missing');
  } else {
    if (!GENERATABLE_MODES.includes(req.primary_mode)) {
      errors.push(`request.primary_mode ${JSON.stringify(req.primary_mode)} is not a generatable mode`);
    }
    if (!Array.isArray(req.allowed_modes) || req.allowed_modes.length === 0) {
      errors.push('request.allowed_modes must be a non-empty array');
    }
    for (const m of req.allowed_modes || []) {
      if (!GENERATABLE_MODES.includes(m)) errors.push(`request.allowed_modes contains unknown mode ${m}`);
    }
    if (gameplayContext && !(req.allowed_modes || []).every((m) => gameplayContext.allowed_modes.includes(m))) {
      errors.push('request.allowed_modes is wider than the modes this generation was allowed to use');
    }
    if (gameplayContext && !(req.allowed_modes || []).includes(req.primary_mode)) {
      errors.push('request.primary_mode is not in request.allowed_modes');
    }
    if (!isInt(req.target_difficulty) || req.target_difficulty < MIN_DIFFICULTY || req.target_difficulty > MAX_DIFFICULTY) {
      errors.push(`request.target_difficulty must be an integer in ${MIN_DIFFICULTY}..${MAX_DIFFICULTY}`);
    }
    if (typeof req.primary_mode_ratio !== 'number' || req.primary_mode_ratio < 0 || req.primary_mode_ratio > 1) {
      errors.push('request.primary_mode_ratio must be in 0..1');
    }
    if (!isInt(req.seed)) {
      errors.push('request.seed must be an integer -- it is what makes a generation reproducible');
    }
  }

  // ---- sections -----------------------------------------------------------
  const sections = blueprint.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    errors.push('sections must be a non-empty array');
    return { errors, warnings };
  }

  const allowedModes = new Set(gameplayContext?.allowed_modes || GENERATABLE_MODES);
  const breather = breatherBeats(song?.bpm ?? 120, tuning);

  let previousEnd = null;
  const seenIds = new Set();
  let primaryBars = 0;
  let totalBars = 0;

  for (const [i, s] of sections.entries()) {
    const where = `sections[${i}]`;
    if (!s || typeof s !== 'object') {
      errors.push(`${where} is not an object`);
      continue;
    }
    if (typeof s.id !== 'string' || s.id.length === 0) {
      errors.push(`${where}: id must be a non-empty string`);
    } else if (seenIds.has(s.id)) {
      errors.push(`${where}: duplicate section id ${JSON.stringify(s.id)}`);
    } else {
      seenIds.add(s.id);
    }

    if (!isInt(s.start_bar) || s.start_bar < 1) errors.push(`${where}: start_bar must be an integer >= 1`);
    if (!isInt(s.end_bar_exclusive) || s.end_bar_exclusive <= (s.start_bar ?? 0)) {
      errors.push(`${where}: end_bar_exclusive must be an integer greater than start_bar`);
    }
    if (isInt(songBars) && isInt(s.end_bar_exclusive) && s.end_bar_exclusive > songBars + 1) {
      errors.push(`${where}: end_bar_exclusive ${s.end_bar_exclusive} runs past the song's ${songBars} bars`);
    }
    if (previousEnd !== null && s.start_bar !== previousEnd) {
      errors.push(
        `${where}: sections must tile the song -- starts at bar ${s.start_bar}, previous ended at ${previousEnd}`,
      );
    }
    previousEnd = s.end_bar_exclusive;

    if (!GENERATABLE_MODES.includes(s.mode)) {
      errors.push(`${where}: unknown mode ${JSON.stringify(s.mode)}`);
    } else if (!allowedModes.has(s.mode)) {
      errors.push(`${where}: mode ${s.mode} was not offered to this generation (allowed: ${[...allowedModes].join(', ')})`);
    }

    if (!SECTION_FUNCTIONS.includes(s.function)) {
      errors.push(`${where}: function ${JSON.stringify(s.function)} is not one of ${SECTION_FUNCTIONS.join(', ')}`);
    }
    if (!isInt(s.difficulty) || s.difficulty < MIN_DIFFICULTY || s.difficulty > MAX_DIFFICULTY) {
      errors.push(`${where}: difficulty must be an integer in ${MIN_DIFFICULTY}..${MAX_DIFFICULTY}`);
    }
    if (typeof s.intensity !== 'number' || s.intensity < 0 || s.intensity > 1) {
      errors.push(`${where}: intensity must be a number in 0..1`);
    }
    if (typeof s.rationale !== 'string' || s.rationale.length === 0) {
      errors.push(`${where}: rationale must be a non-empty string`);
    }

    // ---- pattern choices --------------------------------------------------
    for (const id of s.pattern_ids || []) {
      const entry = patternIndex.byId.get(id);
      if (!entry) {
        errors.push(`${where}: unknown patternId ${JSON.stringify(id)}`);
      } else if (entry.mode !== s.mode) {
        errors.push(`${where}: pattern ${id} is a ${entry.mode} pattern but the section mode is ${s.mode}`);
      }
    }
    for (const fam of s.pattern_families || []) {
      const pool = (patternIndex.byMode.get(s.mode) || []).filter((p) => p.family === fam);
      if (pool.length === 0) {
        warnings.push(`${where}: pattern family ${JSON.stringify(fam)} has no ${s.mode} patterns; it will be ignored`);
      }
    }

    // ---- capability probe -------------------------------------------------
    // The catalog is the authority on what a mode can actually do, so every
    // pattern choice is probed through it too -- not just the library index,
    // which does not know about exclusions. Duplicates are collapsed because
    // the mode check fires once per probe.
    if (gameplayContext && GENERATABLE_MODES.includes(s.mode)) {
      const problems = new Set(checkCapability(gameplayContext, { mode: s.mode }));
      for (const id of s.pattern_ids || []) {
        for (const p of checkCapability(gameplayContext, { mode: s.mode, patternId: id })) {
          problems.add(p);
        }
      }
      errors.push(...problems);
    }

    // ---- course -----------------------------------------------------------
    if (s.course !== undefined && s.course !== null) {
      if (s.mode !== 'RUNNER') {
        errors.push(`${where}: declares a course but its mode is ${s.mode} -- courses are RUNNER-only`);
      }
      const hasPhrases = Array.isArray(s.course.phrases) && s.course.phrases.length > 0;
      const hasGenerate = s.course.generate !== undefined;
      if (!hasPhrases && !hasGenerate) {
        errors.push(`${where}: course needs either a non-empty phrases list or a generate block`);
      }
      const sectionBeats = (s.end_bar_exclusive - s.start_bar) * beatsPerBar;
      if (hasPhrases) {
        const phraseBeats = s.course.phraseBeats ?? 4;
        const total = s.course.phrases.reduce((sum, p) => sum + (p.beats ?? phraseBeats), 0);
        if (total > sectionBeats) {
          warnings.push(`${where}: course is ${total} beats but the section is ${sectionBeats} -- the tail runs past the section`);
        } else if (total < sectionBeats) {
          warnings.push(`${where}: course covers ${total} of ${sectionBeats} beats -- ${sectionBeats - total} beat(s) will have no terrain`);
        }
      }
    }

    // ---- transition feasibility -------------------------------------------
    const isLast = i === sections.length - 1;
    const next = isLast ? null : sections[i + 1];
    const changesMode = next !== null && next.mode !== s.mode;

    if (s.transition_out !== undefined && s.transition_out !== null) {
      if (isLast) {
        warnings.push(`${where}: declares a transition_out but it is the last section; it will be dropped`);
      }
      // The schema says `transition_out` is an object (`kind`, `reason`,
      // `breather_beats`, `scene`), but the director prompt only ever shows
      // `"transition_out": null` and never documents that shape -- so a model
      // describing a transition free-forms prose. Every read below is
      // `.breather_beats` or `.scene`, both `undefined` on a string, so the
      // whole declaration was silently ignored: accepted by the validator,
      // dropped by the compiler, reported nowhere. `normalizeBlueprint` turns
      // prose into `{reason}`, which the compiler does forward; this warns so a
      // human can see it happened rather than having to infer it.
      if (typeof s.transition_out !== 'object' || Array.isArray(s.transition_out)) {
        warnings.push(
          `${where}: transition_out is a ${Array.isArray(s.transition_out) ? 'array' : typeof s.transition_out}, ` +
            `not an object -- only its reason will survive (the schema wants ` +
            `{kind, reason, breather_beats, scene})`,
        );
      }
      const declared = s.transition_out.breather_beats;
      if (declared !== undefined && declared !== null && changesMode && declared < breather) {
        warnings.push(
          `${where}: asks for ${declared} breather beats but a mode change needs at least ${breather} at ${song?.bpm} BPM`,
        );
      }
    }
    if (changesMode) {
      const sectionBeats = (s.end_bar_exclusive - s.start_bar) * beatsPerBar;
      if (sectionBeats < breather) {
        errors.push(
          `${where}: is ${sectionBeats} beats long but the mode change to ${next.mode} needs a ` +
            `${breather}-beat breather -- the section would be entirely breather`,
        );
      }
    }
    // Scene effects are validated whether or not the mode changes: a same-mode
    // transition is still a real visual beat the runtime has to render.
    for (const effect of s.transition_out?.scene || []) {
      if (!SCENE_EFFECTS.includes(effect.effect)) {
        errors.push(`${where}: unknown scene effect ${JSON.stringify(effect.effect)}`);
      }
    }

    const bars = (s.end_bar_exclusive ?? 0) - (s.start_bar ?? 0);
    if (bars > 0) {
      totalBars += bars;
      if (req && s.mode === req.primary_mode) primaryBars += bars;
    }
  }

  // ---- song coverage ------------------------------------------------------
  if (isInt(songBars) && sections.length > 0) {
    const first = sections[0];
    const last = sections[sections.length - 1];
    if (first?.start_bar !== 1) {
      errors.push(`sections must start at bar 1 (first section starts at ${first?.start_bar})`);
    }
    if (last?.end_bar_exclusive !== songBars + 1) {
      errors.push(
        `sections must cover the song: last section ends at bar ${last?.end_bar_exclusive} but the song has ${songBars} bars`,
      );
    }
  }

  // ---- primary-mode share -------------------------------------------------
  if (req && typeof req.primary_mode_ratio === 'number' && totalBars > 0) {
    const actual = primaryBars / totalBars;
    if (actual + 0.10 < req.primary_mode_ratio) {
      warnings.push(
        `primary mode ${req.primary_mode} covers ${(actual * 100).toFixed(1)}% of bars but ${(req.primary_mode_ratio * 100).toFixed(1)}% was requested`,
      );
    }
  }

  // ---- sync points --------------------------------------------------------
  const anchors = directorContext?.anchors || [];
  const anchorBars = new Map();
  for (const a of anchors) {
    if (!anchorBars.has(a.bar)) anchorBars.set(a.bar, new Set());
    anchorBars.get(a.bar).add(a.type);
  }
  for (const [i, sp] of (blueprint.sync_points || []).entries()) {
    const where = `sync_points[${i}]`;
    if (!isInt(sp.bar) || sp.bar < 1 || (isInt(songBars) && sp.bar > songBars)) {
      errors.push(`${where}: bar ${sp.bar} is outside the song's 1..${songBars}`);
      continue;
    }
    if (!ANCHOR_TYPES.includes(sp.anchor_type)) {
      errors.push(`${where}: unknown anchor_type ${JSON.stringify(sp.anchor_type)}`);
      continue;
    }
    // `why` is what makes a sync point reviewable: a claim the music does not
    // support is a warning, but an unexplained claim cannot be judged at all.
    if (typeof sp.why !== 'string' || sp.why.length === 0) {
      errors.push(`${where}: why must be a non-empty string`);
    }
    const types = anchorBars.get(sp.bar);
    if (!types || !types.has(sp.anchor_type)) {
      warnings.push(
        `${where}: claims a ${sp.anchor_type} at bar ${sp.bar}, which the music does not offer`,
      );
    }
  }

  // ---- duration -----------------------------------------------------------
  if (typeof duration === 'number' && duration <= 0) {
    errors.push('the director context has no usable duration');
  }

  return { errors, warnings };
}

/**
 * Repair a blueprint deterministically, recording every change.
 *
 * Repairs are deliberately conservative and always *toward the music*: values
 * are clamped into their legal range, a broken tiling is rebuilt, and anything
 * that cannot be made legal is dropped with a note rather than passed
 * downstream. A blueprint that needs a semantic decision (a mode the caller
 * never offered, a course in a non-RUNNER section) is *not* repaired -- it is
 * reported, so the repair loop can ask the model.
 *
 * @returns {{blueprint: object, fixes: string[]}}
 */
export function normalizeBlueprint(blueprint, { directorContext, gameplayContext, patternIndex, tuning }) {
  const fixes = [];
  const out = JSON.parse(JSON.stringify(blueprint));

  const songBars = directorContext?.timing?.bar_count;

  if (!Array.isArray(out.sections) || out.sections.length === 0) {
    return { blueprint: out, fixes: ['sections was empty -- nothing to normalize'] };
  }

  const allowedModes = new Set(gameplayContext?.allowed_modes || GENERATABLE_MODES);

  // ---- 1. bring out-of-range bars back inside the song --------------------
  // Note what this deliberately does NOT do: it does not snap section
  // boundaries onto the music's own detected sections. Subdividing the music
  // is the director's whole job -- a song whose structure detector found two
  // sections can carry six -- so a boundary that falls between two detected
  // sections is a perfectly good place for one. Snapping to those tiles
  // collapses such a plan onto the handful of boundaries the detector found,
  // and since the tiling rebuild below then closes the resulting gaps, a
  // six-section plan becomes a pile of one-bar sections. Only values the song
  // cannot contain are touched; the tiling itself is rebuilt in step 3.
  for (const [i, s] of out.sections.entries()) {
    if (!isInt(s.start_bar)) continue;
    if (isInt(songBars)) {
      if (s.start_bar < 1) {
        fixes.push(`sections[${i}]: start_bar ${s.start_bar} is before the song -- moved to bar 1`);
        s.start_bar = 1;
      }
      if (isInt(s.end_bar_exclusive) && s.end_bar_exclusive > songBars + 1) {
        fixes.push(
          `sections[${i}]: end_bar_exclusive ${s.end_bar_exclusive} runs past the song's ${songBars} bars -- ` +
            `clamped to ${songBars + 1}`,
        );
        s.end_bar_exclusive = songBars + 1;
      }
    }
  }

  // ---- 2. clamp values into their legal range ----------------------------
  for (const [i, s] of out.sections.entries()) {
    if (isInt(songBars)) {
      if (isInt(s.start_bar)) s.start_bar = clampInt(s.start_bar, 1, songBars);
      if (isInt(s.end_bar_exclusive)) s.end_bar_exclusive = clampInt(s.end_bar_exclusive, 2, songBars + 1);
    }
    if (s.end_bar_exclusive <= s.start_bar) {
      fixes.push(`sections[${i}]: empty range ${s.start_bar}..${s.end_bar_exclusive} widened to one bar`);
      s.end_bar_exclusive = Math.min((s.start_bar ?? 1) + 1, (songBars ?? 1) + 1);
    }
    if (!isInt(s.difficulty)) {
      fixes.push(`sections[${i}]: non-integer difficulty ${JSON.stringify(s.difficulty)} rounded`);
      s.difficulty = clampInt(Number(s.difficulty) || 3, MIN_DIFFICULTY, MAX_DIFFICULTY);
    } else if (s.difficulty < MIN_DIFFICULTY || s.difficulty > MAX_DIFFICULTY) {
      fixes.push(`sections[${i}]: difficulty ${s.difficulty} clamped to ${MIN_DIFFICULTY}..${MAX_DIFFICULTY}`);
      s.difficulty = clampInt(s.difficulty, MIN_DIFFICULTY, MAX_DIFFICULTY);
    }
    if (typeof s.intensity !== 'number' || Number.isNaN(s.intensity)) {
      fixes.push(`sections[${i}]: non-numeric intensity ${JSON.stringify(s.intensity)} defaulted to 0.5`);
      s.intensity = 0.5;
    } else if (s.intensity < 0 || s.intensity > 1) {
      fixes.push(`sections[${i}]: intensity ${s.intensity} clamped to 0..1`);
      s.intensity = clamp(s.intensity, 0, 1);
    }
    if (!SECTION_FUNCTIONS.includes(s.function)) {
      fixes.push(`sections[${i}]: unknown function ${JSON.stringify(s.function)} replaced with SUSTAIN`);
      s.function = 'SUSTAIN';
    }
    if (typeof s.rationale !== 'string' || s.rationale.length === 0) {
      fixes.push(`sections[${i}]: missing rationale filled in`);
      s.rationale = '(no rationale given by the director)';
    }

    // Pattern choices that cannot be honoured are dropped, not guessed at:
    // a wrong-mode pattern is a semantic error the repair loop should see.
    if (Array.isArray(s.pattern_ids)) {
      const kept = s.pattern_ids.filter((id) => {
        const entry = patternIndex.byId.get(id);
        if (!entry) {
          fixes.push(`sections[${i}]: dropped unknown patternId ${JSON.stringify(id)}`);
          return false;
        }
        if (entry.mode !== s.mode) {
          fixes.push(`sections[${i}]: dropped ${id} (${entry.mode} pattern in a ${s.mode} section)`);
          return false;
        }
        return true;
      });
      if (kept.length !== s.pattern_ids.length) s.pattern_ids = kept;
      if (kept.length === 0) delete s.pattern_ids;
    }
    if (Array.isArray(s.pattern_families)) {
      const kept = s.pattern_families.filter((fam) =>
        (patternIndex.byMode.get(s.mode) || []).some((p) => p.family === fam),
      );
      if (kept.length !== s.pattern_families.length) {
        fixes.push(`sections[${i}]: dropped pattern families with no ${s.mode} patterns`);
      }
      if (kept.length === 0) delete s.pattern_families;
      else s.pattern_families = kept;
    }

    // A mode the caller never offered is not repairable by guessing.
    if (!GENERATABLE_MODES.includes(s.mode)) {
      fixes.push(`sections[${i}]: mode ${JSON.stringify(s.mode)} is unknown -- defaulting to the primary mode`);
      s.mode = gameplayContext?.primary_mode || GENERATABLE_MODES[0];
    } else if (!allowedModes.has(s.mode)) {
      // Deterministic and safe: the primary mode is always allowed, and the
      // director's intent for this section is preserved as a note.
      fixes.push(
        `sections[${i}]: mode ${s.mode} was not offered -- replaced with the primary mode ` +
          `${gameplayContext?.primary_mode}`,
      );
      s.mode = gameplayContext?.primary_mode || [...allowedModes][0];
    }
  }

  // ---- 3. re-establish an ordered, gapless tiling -------------------------
  out.sections.sort((a, b) => a.start_bar - b.start_bar || a.end_bar_exclusive - b.end_bar_exclusive);

  // Ids are the only handle the director's notes and sync points have on a
  // section, so a missing or duplicated one is repaired positionally rather
  // than left for the model -- nothing structural references the old spelling.
  const usedIds = new Set();
  for (const [i, s] of out.sections.entries()) {
    if (typeof s.id !== 'string' || s.id.length === 0) {
      const generated = `section_${String(i + 1).padStart(2, '0')}`;
      fixes.push(`sections[${i}]: missing id -- generated ${generated}`);
      s.id = generated;
    }
    if (usedIds.has(s.id)) {
      let n = 2;
      while (usedIds.has(`${s.id}_${n}`)) n += 1;
      fixes.push(`sections[${i}]: duplicate id ${s.id} renamed to ${s.id}_${n}`);
      s.id = `${s.id}_${n}`;
    }
    usedIds.add(s.id);
  }

  let cursor = 1;
  for (const [i, s] of out.sections.entries()) {
    if (s.start_bar !== cursor) {
      fixes.push(`sections[${i}]: start_bar ${s.start_bar} moved to ${cursor} to keep the song tiled`);
      s.start_bar = cursor;
    }
    if (s.end_bar_exclusive <= s.start_bar) {
      s.end_bar_exclusive = s.start_bar + 1;
      fixes.push(`sections[${i}]: empty range widened to one bar`);
    }
    cursor = s.end_bar_exclusive;
  }
  if (isInt(songBars) && out.sections.length > 0) {
    const last = out.sections[out.sections.length - 1];
    if (last.end_bar_exclusive !== songBars + 1) {
      fixes.push(`the last section now ends at bar ${songBars + 1} so the level covers the whole song`);
      last.end_bar_exclusive = songBars + 1;
    }
    // Merging may have produced a degenerate tail; fold it into its neighbour.
    while (out.sections.length > 1) {
      const tail = out.sections[out.sections.length - 1];
      if (tail.end_bar_exclusive > tail.start_bar) break;
      fixes.push(`dropped an empty trailing section (${tail.id})`);
      out.sections.pop();
      out.sections[out.sections.length - 1].end_bar_exclusive = songBars + 1;
    }
  }

  // ---- 4. transitions -----------------------------------------------------
  const breather = breatherBeats(out.song?.bpm ?? 120, tuning);
  const beatsPerBar = beatsPerBarOf(directorContext, out);
  for (const [i, s] of out.sections.entries()) {
    const isLast = i === out.sections.length - 1;
    const next = isLast ? null : out.sections[i + 1];
    const changesMode = next !== null && next.mode !== s.mode;

    if (isLast) {
      if (s.transition_out) {
        fixes.push(`sections[${i}]: dropped transition_out on the last section`);
        delete s.transition_out;
      }
      continue;
    }
    if (changesMode) {
      const sectionBeats = (s.end_bar_exclusive - s.start_bar) * beatsPerBar;
      if (sectionBeats < breather) {
        // The only deterministic repair that preserves playability: keep the
        // music tiling but stop changing mode here.
        fixes.push(
          `sections[${i}]: ${sectionBeats} beats is too short for a ${breather}-beat breather -- ` +
            `mode change to ${next.mode} dropped, section stays ${s.mode}`,
        );
        next.mode = s.mode;
      }
    }
    // A prose `transition_out` is a real declaration in the wrong shape -- the
    // director wrote down why the seam matters, and every structured read of it
    // (`kind`, `breather_beats`, `scene`) returns `undefined`. Dropping it would
    // throw away the only record of the intent; rewriting it as `{reason}` keeps
    // the words in a field the compiler forwards to the compiled transition, and
    // makes the blueprint match its own schema again.
    if (typeof s.transition_out === 'string') {
      const reason = s.transition_out.trim();
      if (reason.length > 0) {
        fixes.push(`sections[${i}]: transition_out was prose -- kept as its reason`);
        s.transition_out = { reason };
      } else {
        fixes.push(`sections[${i}]: dropped an empty transition_out`);
        delete s.transition_out;
      }
    } else if (Array.isArray(s.transition_out)) {
      fixes.push(`sections[${i}]: dropped a transition_out that was an array, not an object`);
      delete s.transition_out;
    }

    if (s.transition_out && Array.isArray(s.transition_out.scene)) {
      const kept = s.transition_out.scene.filter((e) => SCENE_EFFECTS.includes(e.effect));
      if (kept.length !== s.transition_out.scene.length) {
        fixes.push(`sections[${i}]: dropped unknown scene effects`);
        s.transition_out.scene = kept;
      }
    }
  }

  // ---- 4b. courses follow the mode ----------------------------------------
  // Every repair that can change a section's mode has now run (the unoffered
  // mode replacement in step 2, the infeasible mode change in step 4). A course
  // is only legal on a RUNNER section, so sweeping here -- once, after all of
  // them -- is what guarantees the normalizer never hands back a blueprint that
  // is still invalid for a reason it created itself.
  for (const [i, s] of out.sections.entries()) {
    if (s.course && s.mode !== 'RUNNER') {
      fixes.push(`sections[${i}]: course dropped -- its mode is now ${s.mode}, and courses are RUNNER-only`);
      delete s.course;
    }
  }

  // ---- 5. sync points -----------------------------------------------------
  if (Array.isArray(out.sync_points)) {
    const anchorBars = new Map();
    for (const a of directorContext?.anchors || []) {
      if (!anchorBars.has(a.bar)) anchorBars.set(a.bar, new Set());
      anchorBars.get(a.bar).add(a.type);
    }
    const kept = out.sync_points.filter((sp) => {
      if (!isInt(sp.bar) || sp.bar < 1 || (isInt(songBars) && sp.bar > songBars)) {
        fixes.push(`dropped sync point at bar ${sp.bar} (outside the song)`);
        return false;
      }
      const types = anchorBars.get(sp.bar);
      if (!types || !types.has(sp.anchor_type)) {
        fixes.push(`dropped sync point claiming a ${sp.anchor_type} at bar ${sp.bar} that the music does not offer`);
        return false;
      }
      return true;
    });
    if (kept.length !== out.sync_points.length) out.sync_points = kept;
  }

  // ---- 6. difficulty curve ------------------------------------------------
  const bars = out.sections.reduce((sum, s) => sum + (s.end_bar_exclusive - s.start_bar), 0);
  if (Array.isArray(out.global?.difficulty_curve) && out.global.difficulty_curve.length !== bars) {
    fixes.push(
      `global.difficulty_curve had ${out.global.difficulty_curve.length} entries for ${bars} bars -- rebuilt from the sections`,
    );
    out.global.difficulty_curve = [];
    for (const s of out.sections) {
      for (let b = s.start_bar; b < s.end_bar_exclusive; b += 1) out.global.difficulty_curve.push(s.difficulty);
    }
  }

  return { blueprint: out, fixes };
}
