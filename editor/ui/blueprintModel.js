/**
 * The one place that knows what a blueprint is.
 *
 * There are two blueprint schemas in this repo and they do not share field
 * names. The v1 director (`editor/generator/levelDirector.js`) emits
 * `{version:'1.0.0', sections:[{startBar, endBar, patterns}], transitions:[]}`
 * with an *inclusive* `endBar`. The v2 AI director emits
 * `beatbound_level_blueprint_v2` with `{start_bar, end_bar_exclusive}` and no
 * `transitions` array at all -- a transition is `sections[i].transition_out`,
 * living on the outgoing section.
 *
 * The editor used to read v1 names everywhere, so a v2 blueprint in the session
 * produced `undefined.find`, `undefined.forEach` and `NaN` timeline geometry --
 * three crashes that were really one missing decision: *nobody owned the
 * schema*. This module owns it. Readers ask these accessors instead of guessing
 * at field names, and there is exactly one place to look when the answer is
 * wrong.
 *
 * Two rules this file exists to enforce:
 *
 *   1. `end_bar_exclusive` stays exclusive. v2 sections are half-open
 *      `[start_bar, end_bar_exclusive)`; the runtime is `startBar` +
 *      `lengthBars`. A `+1` anywhere here would silently lengthen every section
 *      by one bar and desynchronise the level from the music.
 *   2. Adapting v1 *into* this canonical view is fine -- v1 is external input.
 *      Writing v1 names *onto* a v2 blueprint is not, and `assertV2Purity` is
 *      the test that catches it.
 *
 * Pure data, no DOM and no node builtins, so `editor/server/server.mjs` imports
 * this same file and both ends agree by construction rather than by review.
 */

export const V1_SCHEMA = 'v1';
export const V2_SCHEMA = 'beatbound_level_blueprint_v2';

/** The four modes the game can actually generate for. */
export const MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'];

/** `SECTION_FUNCTIONS` in `editor/generation/blueprint.js`, spelled out so the
 *  browser does not have to pull the whole validator in to render a dropdown. */
export const SECTION_FUNCTIONS = [
  'INTRO', 'BUILD', 'PEAK', 'SUSTAIN', 'BREAKDOWN', 'RELEASE', 'OUTRO', 'TRANSITION',
];

/** `SCENE_EFFECTS` in `editor/generation/blueprint.js` -- the effects the
 *  runtime can actually render. A name outside this list is a validation error,
 *  so the dropdown is built from it rather than hand-written. */
export const SCENE_EFFECTS = [
  'cameraZoom', 'cameraPan', 'paletteShift', 'particles', 'wipe', 'bgChange',
  'envMovement', 'lightFlash',
];

/**
 * Which schema is this?
 *
 * v2 stamps `schema_version`; v1 stamps `version: '1.0.0'`. Neither is
 * optional in its own generator, so the discriminator is exact rather than a
 * guess from field names -- which matters, because a v1 blueprint handed to the
 * v2 compiler fails deep inside with a confusing message about `sections[0]`.
 *
 * @returns {'v1'|'beatbound_level_blueprint_v2'|null} null when this is not a
 *   blueprint at all (no sections), so callers can distinguish "empty session"
 *   from "unrecognised session" instead of conflating them.
 */
export function detectBlueprintSchema(bp) {
  if (!bp || typeof bp !== 'object') return null;

  // A declared schema_version settles it, either way. An *unrecognised* stamp
  // is not a v1 blueprint -- it is a blueprint from a version this editor does
  // not know, and calling it v1 would hand it to v1 readers that would read
  // `undefined` out of it and corrupt it on the way back. The v2 stamp is the
  // only one this build understands.
  if (typeof bp.schema_version === 'string') {
    return bp.schema_version === V2_SCHEMA ? V2_SCHEMA : null;
  }

  // v1 carries no `schema_version`, so it has to be recognised structurally.
  // The director's own stamp plus a sections array is unambiguous; a bare
  // `sections` array is the weaker signal but is all a hand-trimmed v1
  // blueprint has left.
  if (bp.version === '1.0.0' && Array.isArray(bp.sections)) return V1_SCHEMA;
  if (Array.isArray(bp.sections) && bp.sections.length > 0) return V1_SCHEMA;
  return null;
}

export function isV2(bp) {
  return detectBlueprintSchema(bp) === V2_SCHEMA;
}

/** Sections, always an array. A blueprint with no sections is a real state
 *  (a failed generation), not a reason to throw on the way to rendering it. */
export function sectionsOf(bp) {
  return Array.isArray(bp?.sections) ? bp.sections : [];
}

// ---------------------------------------------------------------------------
// Section geometry
//
// The four accessors the rest of the editor is supposed to use. v1's `endBar`
// is inclusive and v2's `end_bar_exclusive` is not; converting v1 here, once,
// is what keeps the difference from leaking into timeline maths, where a
// one-bar error is invisible until the level desyncs from the music.
// ---------------------------------------------------------------------------

/** First bar of the section, 1-based. */
export function sectionStartBar(s) {
  if (!s || typeof s !== 'object') return null;
  if (Number.isFinite(s.start_bar)) return s.start_bar;
  if (Number.isFinite(s.startBar)) return s.startBar;
  return null;
}

/**
 * One past the last bar of the section -- the half-open upper bound.
 *
 * v1 stores the *inclusive* `endBar`, so the adapter is `+ 1` **on the way in
 * only**. Nothing downstream may add another.
 */
export function sectionEndBarExclusive(s) {
  if (!s || typeof s !== 'object') return null;
  if (Number.isFinite(s.end_bar_exclusive)) return s.end_bar_exclusive;
  if (Number.isFinite(s.endBar)) return s.endBar + 1;
  return null;
}

/**
 * Length in bars: `end_bar_exclusive - start_bar`.
 *
 * Deliberately **no `+1`**. The timeline used to compute
 * `(s.endBar - s.startBar + 1)` against a v2 section, where `s.endBar` is
 * `undefined` -- so the width was `NaN` and every overlay vanished without a
 * single exception being thrown. Returning `null` rather than `NaN` when the
 * geometry is unknown means a bad section is visibly skipped instead of
 * silently painting nothing.
 */
export function sectionDurationBars(s) {
  const start = sectionStartBar(s);
  const end = sectionEndBarExclusive(s);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const bars = end - start;
  return bars > 0 ? bars : null;
}

/** The section's mode, or null. v1 and v2 agree on this name. */
export function sectionMode(s) {
  return typeof s?.mode === 'string' ? s.mode : null;
}

// ---------------------------------------------------------------------------
// Transitions
//
// v2 has no `transitions` array. The editor's transition panel still needs
// something to select, so transitions are *derived*: boundary `i` is the seam
// between `sections[i]` and `sections[i + 1]`, and its editable state is
// `sections[i].transition_out`. Deriving rather than storing is the point --
// a stored copy is a second source of truth that drifts the moment a section
// is edited, and v1's `transitions[]` array is exactly that copy.
// ---------------------------------------------------------------------------

/**
 * A v2 `transition_out` is an object (`kind`, `reason`, `breather_beats`,
 * `scene`), but the director prompt only ever shows `"transition_out": null`
 * and never documents that shape, so the model free-forms prose:
 *
 *     "transition_out": "cut held notes on the last downbeat"
 *
 * `validateBlueprint` reads `s.transition_out.breather_beats` -- `undefined` on
 * a string, so the check no-ops -- and the compiler reads `.kind`/`.scene`,
 * also `undefined`, so the director's intent was accepted and then thrown away.
 * This adapter keeps it: prose becomes `{reason}`, which is a real v2 field the
 * compiler already forwards to the compiled transition.
 *
 * @returns {object|null} always an object or null, never a string.
 */
export function normalizeTransitionOut(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const reason = value.trim();
    return reason.length > 0 ? { reason } : null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

/**
 * Every editable seam in the blueprint, in bar order.
 *
 * `id` is derived (`boundary:<fromId>`) rather than stored, so it stays stable
 * across an edit that renames nothing and cannot collide with a section id.
 *
 * @returns {Array<{id, fromSection, toSection, fromId, toId, bar, kind, reason,
 *   breatherBeats, scene, changesMode, editable, fromBlueprint}>}
 */
export function boundariesOf(bp) {
  const sections = sectionsOf(bp);
  const v2 = isV2(bp);
  const out = [];

  for (let i = 0; i < sections.length - 1; i++) {
    const from = sections[i];
    const to = sections[i + 1];
    const fromId = from?.id ?? `section_${i + 1}`;
    const toId = to?.id ?? `section_${i + 2}`;
    const declared = v2 ? normalizeTransitionOut(from?.transition_out) : null;

    // A v1 blueprint keeps its transitions in their own array, keyed by the
    // section pair, so look the geometry up there rather than inventing it.
    const v1 = v2
      ? null
      : (Array.isArray(bp.transitions) ? bp.transitions : []).find(
          (t) => t.fromSection === fromId || t.from === fromId,
        ) ?? null;

    out.push({
      id: `boundary:${fromId}`,
      fromSection: from,
      toSection: to,
      fromId,
      toId,
      // The bar the seam sits on -- the first bar of the incoming section.
      bar: sectionStartBar(to),
      kind: v2 ? declared?.kind ?? null : v1?.kind ?? null,
      reason: v2 ? declared?.reason ?? null : v1?.reason ?? null,
      breatherBeats: v2 ? declared?.breather_beats ?? null : v1?.breatherBeats ?? null,
      // v1 only: the compiled hazard-reduction geometry. v2 has none -- the
      // compiler derives tail/head bars from the two modes and the rules, so
      // there is nothing here to read and nothing for the editor to write.
      tailBars: v2 ? null : v1?.tailBars ?? null,
      headBars: v2 ? null : v1?.headBars ?? null,
      scene: v2 ? (Array.isArray(declared?.scene) ? declared.scene : []) : v1?.scene ?? [],
      changesMode: sectionMode(from) !== sectionMode(to),
      // v1 boundaries are compiled artefacts -- `regenerateSection` rebuilds
      // them from the sections either side -- so only v2 seams are editable.
      editable: v2,
      fromBlueprint: v2 ? declared !== null : v1 !== null,
    });
  }
  return out;
}

export function findSection(bp, id) {
  return sectionsOf(bp).find((s) => s.id === id) ?? null;
}

export function findBoundary(bp, id) {
  return boundariesOf(bp).find((b) => b.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// The v2-only guard the test suite asserts against.
// ---------------------------------------------------------------------------

/** v1 field names that must never appear on a v2 blueprint. A v2 session that
 *  acquires any of these is a hybrid, and a hybrid is how the two conventions
 *  get mixed up in the first place. */
export const V1_ONLY_FIELDS = ['startBar', 'endBar', 'patterns', 'transitions', 'difficultyCurve'];

/**
 * @returns {string[]} one message per v1 field found, empty when the blueprint
 *   is pure. Used by the schema-purity test and by the editor's own
 *   `consistency-warn` banner, so a hybrid is reported to a human at the moment
 *   it appears rather than at the moment it breaks playback.
 */
export function assertV2Purity(bp) {
  const problems = [];
  if (!isV2(bp)) return problems;

  for (const field of V1_ONLY_FIELDS) {
    if (field in bp) problems.push(`blueprint.${field} is a v1 field on a v2 blueprint`);
  }
  for (const [i, s] of sectionsOf(bp).entries()) {
    const where = s?.id ? `section ${s.id}` : `sections[${i}]`;
    for (const field of ['startBar', 'endBar', 'patterns']) {
      if (field in (s ?? {})) problems.push(`${where}.${field} is a v1 field on a v2 section`);
    }
  }
  return problems;
}
