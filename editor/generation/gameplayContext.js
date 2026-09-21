/**
 * Gameplay Generation Context -- what the game can actually do, per mode.
 *
 * The consolidated capability catalog
 * (`BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json`) is an *audit* document: it
 * describes the runtime exhaustively, including the parts a generator must
 * never use. Handing it to a Level Director wholesale would be a mistake in
 * both directions -- it is far too large for a prompt, and it advertises dead,
 * aliased and metadata-only capabilities as if they were playable.
 *
 * This module projects the catalog down to the generation-relevant subset:
 *
 *   * only modes the caller allows, in the caller's order;
 *   * only primitives and library patterns that exist *and* are reachable --
 *     phantom references (ARENA A14/A15), no-op aliases (A10 FOLLOW_GAP) and
 *     metadata-only flags are moved into an explicit `excluded` list rather
 *     than silently dropped, so the director's context is honest about what
 *     was withheld and why;
 *   * the per-mode safety bounds as numbers a compiler can enforce, kept
 *     verbatim from the catalog rather than re-derived;
 *   * the cross-mode integration warnings that are relevant to the modes in
 *     play -- these are the traps that make otherwise-valid content unplayable.
 *
 * Nothing here is invented. Every value is a projection of the catalog, and
 * every exclusion carries the catalog's own reason string.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root; the catalog lives beside package.json. */
export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const GAMEPLAY_CONTEXT_SCHEMA_VERSION = 'beatbound_gameplay_generation_context_v1';

/** The catalog the context is projected from. */
export const CATALOG_FILE = 'BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json';

/** Modes a level can contain, in the canonical order the runtime uses. */
export const GENERATABLE_MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'];

/**
 * Capabilities the catalog itself flags as unusable. Kept here as data so the
 * projection is auditable and a catalog change surfaces as a test failure
 * rather than as silently generated dead content.
 */
const KNOWN_EXCLUSIONS = {
  ARENA: {
    primitives: {
      A14: 'phantom reference: exists only in mechanics.mvp.json compatibility metadata',
      A15: 'phantom reference: exists only in mechanics.mvp.json compatibility metadata',
    },
    variants: {
      'A10:FOLLOW_GAP': 'no-op alias: RingMechanic builds identical rings to BASIC_GAP',
    },
    flags: ['constraints.maxSimultaneousThreats', 'constraints.requiresMechanics'],
  },
  VERTICAL: {
    primitives: {},
    variants: {
      'V04:DRIFT': 'dead subsystem: path data collapses to the first lane',
    },
    flags: [],
  },
  RUNNER: { primitives: {}, variants: {}, flags: [] },
  RADIAL: { primitives: {}, variants: {}, flags: [] },
};

/** Fields of `normalized` that describe safety and are carried verbatim. */
const BOUND_FIELDS = ['safe_generation_bounds', 'safety_enforcement'];

/** Cross-mode traps, copied from `director_view` and `integration_warnings`. */
function relevantWarnings(catalog, modes) {
  const wanted = new Set(modes);
  const out = [];
  for (const w of catalog.integration_warnings || []) {
    const applies = (w.modes || []).filter((m) => wanted.has(m));
    if (applies.length === 0) continue;
    out.push({
      id: w.id,
      type: w.type,
      summary: w.summary,
      resolution: w.resolution,
      applies_to: applies,
    });
  }
  return out;
}

/** The transition contract, which is a property of the level, not of a mode. */
function transitionContract(catalog) {
  const t = (catalog.director_view?.safe_generation_summary || {}).TRANSITIONS || {};
  const raw = (catalog.transitions || {});
  return {
    minimum_breathing_beats: t.minimum_breathing_beats ?? null,
    clear_previous_hazards: t.clear_previous_hazards ?? null,
    clear_point: t.clear_point ?? null,
    allow_active_hold_crossing: t.allow_active_hold_crossing ?? null,
    pending_queue_cap_per_mode: t.pending_queue_cap_per_mode ?? null,
    note: t.note ?? null,
    // The catalog's own transition section is the evidence for the summary.
    evidence: raw.meta ? { source: raw.meta.source || null } : {},
  };
}

/**
 * Load the consolidated capability catalog.
 *
 * @param {{projectRoot: string}} opts
 * @returns {object} the parsed catalog
 */
export function loadCatalog({ projectRoot = PROJECT_ROOT } = {}) {
  const file = path.join(projectRoot, CATALOG_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(
      `gameplay capability catalog not found at ${file}. ` +
        'Generation cannot run without it: the director would be guessing at what the runtime supports.',
    );
  }
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (catalog.schema_version !== 'beatbound_gameplay_capabilities_v1') {
    throw new Error(
      `unsupported capability catalog schema ${catalog.schema_version}; expected beatbound_gameplay_capabilities_v1`,
    );
  }
  return catalog;
}

/**
 * Project the catalog into one mode's generation context.
 *
 * @param {object} catalog
 * @param {string} mode
 * @returns {object}
 */
function modeContext(catalog, mode) {
  const entry = catalog.modes?.[mode];
  if (!entry) throw new Error(`mode ${mode} is not in the capability catalog`);

  const n = entry.normalized || {};
  const dv = catalog.director_view || {};
  const affinity = dv.mode_selection_affinity?.[mode] || {};
  const vocab = dv.primary_gameplay_vocabulary?.[mode] || {};
  const bounds = dv.safe_generation_summary?.[mode] || {};

  const excluded = KNOWN_EXCLUSIONS[mode] || { primitives: {}, variants: {}, flags: [] };
  const primitiveIds = (n.runtime_primitive_ids || []).filter((id) => !(id in excluded.primitives));
  const libraryIds = (n.pattern_library_ids || []).slice();

  return {
    mode,
    best_for: affinity.best_for || [],
    avoid_when: affinity.avoid_when || [],
    timing_resolution: affinity.timing_resolution || null,
    movement_model: n.movement_model || null,
    input_model: n.input_model || null,
    judgement_model: n.judgement_model || null,
    score_system: n.score_system || null,
    // Numbers the compiler enforces, taken from the catalog verbatim.
    bounds,
    bounds_detail: Object.fromEntries(
      BOUND_FIELDS.filter((f) => n[f] !== undefined).map((f) => [f, n[f]]),
    ),
    primitives: {
      ids: primitiveIds,
      // The human-readable names, so a director can reason about meaning.
      names: (vocab.primitives || []).filter((label) => {
        const id = String(label).split(' ')[0];
        return !(id in excluded.primitives);
      }),
      count: primitiveIds.length,
    },
    library_patterns: {
      ids: libraryIds,
      count: libraryIds.length,
      note: vocab.library || null,
    },
    verbs: vocab.verbs || [],
    phrase_archetypes: vocab.phrase_archetypes || [],
    excluded: {
      primitives: Object.entries(excluded.primitives).map(([id, reason]) => ({ id, reason })),
      variants: Object.entries(excluded.variants).map(([id, reason]) => ({ id, reason })),
      metadata_only_flags: excluded.flags.slice(),
      note:
        'These exist in the audit catalog but must never be emitted as distinct ' +
        'capabilities. Listing them keeps the director honest about what was withheld.',
    },
    warnings: (entry.provenance?.warnings || []).slice(),
  };
}

/**
 * Build the gameplay generation context for one generation request.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string[]} opts.allowedModes  modes the level may use, primary first
 * @param {string} [opts.primaryMode]   must be one of `allowedModes`
 * @param {object} [opts.catalog]       pre-loaded catalog (avoids re-reading)
 * @returns {object}
 */
export function buildGameplayContext({ projectRoot = PROJECT_ROOT, allowedModes, primaryMode, catalog }) {
  const cat = catalog || loadCatalog({ projectRoot });

  const modes = (allowedModes || []).filter((m) => GENERATABLE_MODES.includes(m));
  if (modes.length === 0) {
    throw new Error(
      `no generatable modes requested (got ${JSON.stringify(allowedModes)}); ` +
        `expected a subset of ${GENERATABLE_MODES.join(', ')}`,
    );
  }
  const primary = primaryMode || modes[0];
  if (!modes.includes(primary)) {
    throw new Error(`primaryMode ${primary} must be one of the allowed modes ${modes.join(', ')}`);
  }

  // Primary first: the director reads the list in order and the first mode is
  // the one that should carry the song.
  const ordered = [primary, ...modes.filter((m) => m !== primary)];

  return {
    schema_version: GAMEPLAY_CONTEXT_SCHEMA_VERSION,
    source: {
      catalog_schema_version: cat.schema_version,
      catalog_counts: cat.meta?.counts || {},
    },
    primary_mode: primary,
    allowed_modes: ordered,
    modes: ordered.map((m) => modeContext(cat, m)),
    transitions: transitionContract(cat),
    cross_mode_warnings: relevantWarnings(cat, ordered),
    global_contract: cat.global_contract || {},
  };
}

/**
 * Reject anything a director might emit that this context does not support.
 *
 * Used by the blueprint validator: the director is allowed to be creative, but
 * not to invent capabilities, use a mode it was not offered, or name a
 * primitive the runtime does not have.
 *
 * @param {object} context  the output of {@link buildGameplayContext}
 * @param {{mode?: string, primitiveIds?: string[], patternId?: string}} probe
 * @returns {string[]} human-readable problems, empty when the probe is legal
 */
export function checkCapability(context, probe) {
  const problems = [];
  // A malformed context is a wiring mistake, not a bad probe -- say so, rather
  // than throwing `context.modes.map is not a function` from deep inside a
  // validator whose whole job is to produce readable problems.
  if (!context || !Array.isArray(context.modes) || !Array.isArray(context.allowed_modes)) {
    throw new Error(
      'checkCapability: the gameplay context is malformed -- expected the output of buildGameplayContext ' +
        `(got modes=${typeof context?.modes}, allowed_modes=${typeof context?.allowed_modes})`,
    );
  }
  const modes = new Map(context.modes.map((m) => [m.mode, m]));

  if (probe.mode !== undefined) {
    if (!modes.has(probe.mode)) {
      problems.push(
        `mode ${probe.mode} is not available for this generation ` +
          `(allowed: ${context.allowed_modes.join(', ')})`,
      );
      return problems;
    }
  }
  const mode = probe.mode !== undefined ? modes.get(probe.mode) : null;

  for (const id of probe.primitiveIds || []) {
    if (!mode) {
      problems.push(`primitive ${id} checked without a mode`);
      continue;
    }
    if (!mode.primitives.ids.includes(id)) {
      const excluded = mode.excluded.primitives.find((e) => e.id === id);
      problems.push(
        excluded
          ? `primitive ${id} is not usable in ${probe.mode}: ${excluded.reason}`
          : `primitive ${id} does not exist in ${probe.mode}`,
      );
    }
  }

  if (probe.patternId !== undefined) {
    if (!mode) {
      problems.push(`pattern ${probe.patternId} checked without a mode`);
    } else if (!mode.library_patterns.ids.includes(probe.patternId)) {
      problems.push(`pattern ${probe.patternId} is not in the ${probe.mode} pattern library`);
    }
  }

  return problems;
}
