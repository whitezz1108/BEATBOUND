/**
 * Level Director -- music analysis -> level blueprint.
 *
 * The director decides the *high-level structure* of the level:
 *   - where sections begin and end (analysis section boundaries + bar grid)
 *   - which gameplay mode each section uses (four-mode rotation)
 *   - each section's difficulty and function (difficulty rules + energy)
 *   - pattern families and densities (pattern generator + energy bands)
 *   - transition durations and scene instructions (transition rules)
 *
 * It never invents obstacles: every placement references a pattern id from
 * the live library, and the rules/pattern modules generate the actual
 * gameplay. All randomness is seeded, so the same song + analysis + rules +
 * seed always produce the same blueprint.
 */

import { createRng, hashString } from './seed.js';
import { loadPatternIndex } from './patternIndex.js';
import { breatherForSection } from './breather.js';
import {
  difficultyFor,
  functionFor,
  intensityFor,
  smoothDifficultyCurve,
} from './difficultyManager.js';
import { fillSectionBars, fillTransitionHead, describePlacements } from './patternGenerator.js';
import { buildTransition } from './transitionGenerator.js';

export const GENERATOR_VERSION = '1.0.0';
const MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'];

// ---------------------------------------------------------------------------
// Sections from analysis
// ---------------------------------------------------------------------------

/** Per-section energy stats from the analysis bar grid. */
export function energyStats(music, startBar, endBar) {
  const bars = music.bars.filter((b) => b.bar >= startBar && b.bar <= endBar);
  if (bars.length === 0) {
    return { mean: 0, peak: 0, rhythmDensity: 0 };
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    mean: round2(mean(bars.map((b) => b.energy))),
    peak: round2(Math.max(...bars.map((b) => b.energy))),
    rhythmDensity: round2(mean(bars.map((b) => b.rhythmDensity))),
  };
}

/**
 * Turn analysis sections into director sections on the bar grid:
 * merge anything below minBars, split anything above maxBars at the strongest
 * internal novelty, and make sure there are at least enough sections for a
 * full four-mode rotation (splitting the longest at the best boundary).
 */
export function buildSections(music, gameRules) {
  const rules = gameRules.section;
  const totalBars = music.bars.length;
  const raw = music.sections.map((s) => ({
    startBar: s.startBar,
    endBar: Math.min(s.endBar, totalBars),
    analysisSection: s.id,
  }));

  // Merge tiny segments into the previous one.
  const merged = [];
  for (const s of raw) {
    const len = s.endBar - s.startBar + 1;
    if (len < rules.minBars && merged.length > 0) {
      merged[merged.length - 1].endBar = s.endBar;
    } else if (len >= rules.minBars || merged.length === 0) {
      merged.push({ ...s });
    }
  }
  // The final segment may have shrunk below minBars; absorb it into its
  // neighbour unless it is the only section.
  if (merged.length > 1) {
    const last = merged[merged.length - 1];
    if (last.endBar - last.startBar + 1 < rules.minBars) {
      merged[merged.length - 2].endBar = last.endBar;
      merged.pop();
    }
  }

  const splitAt = (s, bar) => [
    { startBar: s.startBar, endBar: bar - 1, analysisSection: s.analysisSection },
    { startBar: bar, endBar: s.endBar, analysisSection: s.analysisSection },
  ];

  // Split overly long sections at the strongest internal novelty bar.
  const sized = [];
  for (const s of merged) {
    const len = s.endBar - s.startBar + 1;
    if (len > rules.maxBars) {
      const middle = music.bars
        .filter((b) => b.bar > s.startBar + 4 && b.bar <= s.endBar - 4)
        .sort((a, b) => b.novelty - a.novelty);
      const cut = middle[0]?.bar ?? Math.floor((s.startBar + s.endBar) / 2) + 1;
      sized.push(...splitAt(s, cut));
    } else {
      sized.push(s);
    }
  }

  // Ensure at least minSectionsForFullRotation sections so every mode appears.
  const minSections = Math.min(
    rules.minSectionsForFullRotation,
    Math.floor(totalBars / rules.minBars)
  );
  while (sized.length < minSections && sized.length > 0) {
    let longest = 0;
    for (let i = 1; i < sized.length; i++) {
      const a = sized[i].endBar - sized[i].startBar;
      const b = sized[longest].endBar - sized[longest].startBar;
      if (a > b) longest = i;
    }
    const s = sized[longest];
    if (s.endBar - s.startBar + 1 < rules.minBars * 2) break; // cannot split further
    const middle = music.bars
      .filter((b) => b.bar > s.startBar + rules.minBars - 1 && b.bar <= s.endBar - rules.minBars + 1)
      .sort((a, b) => b.novelty - a.novelty);
    const cut = middle[0]?.bar ?? Math.floor((s.startBar + s.endBar) / 2) + 1;
    sized.splice(longest, 1, ...splitAt(s, cut));
  }

  // Assemble final section records.
  return sized.map((s, i) => {
    const startBar = s.startBar;
    const endBar = s.endBar;
    const lengthBars = endBar - startBar + 1;
    return {
      id: `${gameRules.section.idPrefix}${String(i + 1).padStart(2, '0')}`,
      startBar,
      endBar,
      lengthBars,
      analysisSection: s.analysisSection,
      energy: energyStats(music, startBar, endBar),
      mode: MODES[0],
      function: 'TEACH',
      difficulty: 1,
      patterns: [],
      source: 'auto',
      variant: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Mode rotation
// ---------------------------------------------------------------------------

/** Four-mode rotation A -> B -> C -> D -> A... across the sections in order. */
export function assignModes(sections, modeOrder, startMode) {
  const order = modeOrder ?? MODES;
  let idx = Math.max(0, order.indexOf(startMode ?? order[0]));
  for (const s of sections) {
    s.mode = order[idx % order.length];
    idx++;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

/**
 * Direct a level: music analysis + rules + seed -> blueprint.
 *
 * opts: { seed, startMode, modeOrder, projectRoot }
 */
export function direct(music, rules, opts = {}) {
  const seed = opts.seed ?? 1;
  const gameRules = rules.gameplay;
  const diffRules = rules.difficulty;
  const transitionRules = rules.transition;
  const index = loadPatternIndex({ projectRoot: opts.projectRoot });
  const modeOrder = opts.modeOrder ?? gameRules.modeOrder;
  const startMode = opts.startMode ?? modeOrder[0];

  const sections = buildSections(music, gameRules);
  assignModes(sections, modeOrder, startMode);

  // Difficulty + function decisions (before patterns, so transitions can use
  // them).
  for (const s of sections) {
    s.difficulty = difficultyFor(diffRules, {
      energy: s.energy.mean,
      rhythmDensity: s.energy.rhythmDensity,
    });
  }
  // Climax: the highest-peak-energy section, past the intro.
  let climaxIdx = -1;
  for (let i = gameRules.climax.minSectionsBeforeClimax; i < sections.length; i++) {
    if (climaxIdx < 0 || sections[i].energy.peak > sections[climaxIdx].energy.peak) {
      climaxIdx = i;
    }
  }
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    s.function = functionFor(diffRules, {
      isFirst: i === 0,
      isClimax: i === climaxIdx && gameRules.climax.atMostOneClimax,
      difficulty: s.difficulty,
      mode: s.mode,
      seedChoice: (seed >>> 3) / 4294967296,
    });
  }
  smoothDifficultyCurve(diffRules, sections, music);
  if (sections.length > 0) {
    sections[0].function = 'TEACH';
    sections[0].difficulty = Math.min(
      sections[0].difficulty,
      gameRules.firstSection.difficultyCap
    );
  }

  // Breathers: the runtime's no-spawn window before a mode change, in beats.
  // Computed before transitions so tail bars can be capped by the fillable
  // region; stored on the section so the blueprint and the UI show it.
  const beatsPerBar = music.tempo.timeSignature[0];
  const breatherBeats = gameRules.transition.breatherBeats ?? 0;
  for (let i = 0; i < sections.length; i++) {
    const breather = breatherForSection(sections[i], sections[i + 1] ?? null, breatherBeats, beatsPerBar);
    sections[i].fillBars = breather ? breather.fillBars : sections[i].lengthBars;
    sections[i].breatherFromBeat = breather ? breather.fromBeat : null;
  }

  // Transitions (depend only on energies + rules, so they survive section
  // regeneration unchanged).
  const transitions = [];
  const boundary = new Map(); // `${fromId}>${toId}` -> {tailBars, headBars}
  for (let i = 0; i < sections.length - 1; i++) {
    const from = sections[i];
    const to = sections[i + 1];
    if (from.mode === to.mode) continue;
    const { record, tailBars, headBars } = buildTransition(from, to, {
      rules: transitionRules,
      gameRules,
      music,
      rng: transitionRng(seed, from.id, to.id),
    });
    transitions.push(record);
    boundary.set(`${from.id}>${to.id}`, { tailBars, headBars });
  }

  // Patterns: one fill pass in bar order. Per-mode family history keeps
  // variety across sections that reuse a mode.
  const modeHistory = new Map();
  const notes = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const outgoing = boundary.get(`${s.id}>${sections[i + 1]?.id}`);
    const incoming = i > 0 ? boundary.get(`${sections[i - 1].id}>${s.id}`) : null;
    const headBars = incoming?.headBars ?? 0;
    const tailBars = outgoing?.tailBars ?? 0;
    const breather = breatherForSection(s, sections[i + 1] ?? null, breatherBeats, beatsPerBar);
    fillSection(s, { headBars, tailBars, index, gameRules, diffRules, transitionRules, modeHistory, seed, breather, beatsPerBar });
    notes.push(
      `${s.id} ${s.mode} d${s.difficulty} ${s.function} (${s.startBar}-${s.endBar}) :: ${describePlacements(s.patterns)}`
    );
  }

  return {
    version: '1.0.0',
    seed,
    generator: { name: 'beatbound-level-director', version: GENERATOR_VERSION },
    song: {
      id: music.song.id,
      title: music.song.title,
      bpm: music.tempo.bpm,
      timeSignature: music.tempo.timeSignature,
      audioPath: music.song.audioPath,
      durationSec: music.song.durationSec,
      barCount: music.bars.length,
    },
    analysisSource: music.song.sourceHash ?? music.song.id,
    modeOrder,
    sections,
    transitions,
    difficultyCurve: sections.map((s) => ({
      sectionId: s.id,
      difficulty: s.difficulty,
      function: s.function,
    })),
    notes,
  };
}

/** Fill one section's placements: transition head + main body + transition tail. */
function fillSection(s, { headBars, tailBars, index, gameRules, diffRules, transitionRules, modeHistory, seed, breather, beatsPerBar }) {
  const rng = sectionRng(seed, s.id, s.variant ?? 0);
  const energyBand = bandFor(diffRules, s.energy.mean);
  const baseIntensity = intensityFor(diffRules, {
    energy: s.energy.mean,
    rhythmDensity: s.energy.rhythmDensity,
    peakEnergy: s.energy.peak,
  });

  // The breather (mode change coming) shrinks the fillable region; its bars
  // are the runtime's no-spawn window and must stay empty.
  const fillBars = breather ? breather.fillBars : s.lengthBars;

  // Guard: heads and tails must never swallow the whole fillable section.
  let head = headBars;
  let tail = tailBars;
  while (head + tail >= fillBars && head + tail > 0) {
    if (tail > 0) tail--;
    else head--;
  }

  const placements = [];
  const history = modeHistory.get(s.mode) ?? [];
  // Only the zone that touches the section's fill boundary faces the
  // breather's mid-bar cut; inner zones end on clean bar lines.
  const endUsable = (zoneIsLast) =>
    zoneIsLast && breather ? breather.usableBeatsInLastBar : beatsPerBar;
  const barsOf = (list) =>
    list.reduce((n, p) => n + (index.byId.get(p.patternId)?.lengthBars ?? 0) * (p.repeat ?? 1), 0);

  // Head: TEACH patterns, reduced intensity. Whatever the head does not fill
  // (e.g. no teach pattern fits the head window) is absorbed by the body --
  // zones are sized from what was actually placed, never from what was planned.
  let headBarsUsed = 0;
  if (head > 0) {
    const { placements: headPlacements } = fillTransitionHead(head, s.mode, {
      index,
      rules: gameRules,
      intensity: baseIntensity,
      rng,
    });
    headBarsUsed = barsOf(headPlacements);
    placements.push(...headPlacements);
    // The body should vary from the head, not immediately repeat it.
    for (const p of headPlacements) history.push(p.family);
  }

  // Tail: recovery patterns at reduced intensity (hazard reduction). The tail
  // zone is the LAST bars of the fill region, so it ends exactly at the
  // breather boundary. It is drawn before the body so an unfillable tail zone
  // (the breather's mid-bar cut leaving no recovery pattern that activates
  // inside the window) can be dropped -- but appended AFTER the body, because
  // the tail is the end of the section, never the middle.
  let tailPlacements = [];
  const tailRoom = fillBars - headBarsUsed;
  if (tail > tailRoom) tail = Math.max(0, tailRoom);
  if (tail > 0) {
    const tailFill = fillSectionBars(tail, s.mode, {
      index,
      rules: gameRules,
      difficulty: Math.min(s.difficulty, 2),
      functionName: transitionRules.hazardReduction.tail.function,
      energy: energyBand.name,
      intensity: baseIntensity,
      familyHistory: history,
      role: 'TRANSITION_TAIL',
      roleBars: tail,
      rng,
      usableBeatsInLastBar: endUsable(true),
      beatsPerBar,
    });
    if (!(tailFill.unfilledBars > 0 && breather)) {
      tailPlacements = tailFill.placements;
    }
  }

  // Body: the section's main gameplay. It absorbs whatever the head and tail
  // zones left over, so the section always ends exactly at the fill boundary
  // (when a tail exists the body ends on a clean bar line; otherwise it faces
  // the breather's mid-bar cut itself).
  const bodyBars = fillBars - headBarsUsed - barsOf(tailPlacements);
  if (bodyBars > 0) {
    const body = fillSectionBars(bodyBars, s.mode, {
      index,
      rules: gameRules,
      difficulty: s.difficulty,
      functionName: s.function,
      energy: energyBand.name,
      intensity: baseIntensity,
      familyHistory: history,
      role: 'MAIN',
      rng,
      usableBeatsInLastBar: endUsable(tailPlacements.length === 0),
      beatsPerBar,
    });
    placements.push(...body.placements);
    history.push(...body.familyHistory);
  }
  if (tailPlacements.length > 0) {
    placements.push(...tailPlacements);
    history.push(...tailPlacements.map((p) => p.family));
  }
  modeHistory.set(s.mode, history);

  s.patterns = placements;
}

function bandFor(diffRules, energy) {
  const bands = diffRules.energyBands;
  for (const band of bands) {
    if (energy >= band.minEnergy && energy < band.maxEnergy) return band;
  }
  return bands[bands.length - 1];
}

// ---------------------------------------------------------------------------
// Per-section regeneration
// ---------------------------------------------------------------------------

/**
 * Regenerate exactly one section, leaving everything else untouched.
 *
 * The section's bounds/mode/function/difficulty are whatever the blueprint
 * (possibly hand-edited) says; only its patterns are re-derived, plus the
 * two adjacent transitions' tail/head bars so the neighbours stay coherent.
 * The section's `variant` is bumped, which changes its RNG stream -- same
 * seed, different roll, still fully deterministic.
 */
export function regenerateSection(blueprint, sectionId, rules, opts = {}) {
  const index = loadPatternIndex({ projectRoot: opts.projectRoot });
  const music = opts.music;
  if (!music) throw new Error('regenerateSection: opts.music (analysis) is required');

  const idx = blueprint.sections.findIndex((s) => s.id === sectionId);
  if (idx < 0) throw new Error(`regenerateSection: unknown section ${sectionId}`);
  const section = blueprint.sections[idx];
  const seed = blueprint.seed;
  const beatsPerBar = music.tempo.timeSignature[0];
  const breatherBeats = rules.gameplay.transition.breatherBeats ?? 0;

  // Rebuild the two adjacent transitions (kinds may have changed if the mode
  // was edited); every other transition record stays as authored.
  const transitions = [...blueprint.transitions];
  const adjacent = [];
  if (idx > 0) adjacent.push({ from: blueprint.sections[idx - 1], to: section });
  if (idx < blueprint.sections.length - 1) adjacent.push({ from: section, to: blueprint.sections[idx + 1] });

  for (const { from, to } of adjacent) {
    const oldIdx = transitions.findIndex((t) => t.fromSection === from.id && t.toSection === to.id);
    if (oldIdx >= 0) transitions.splice(oldIdx, 1);
    if (from.mode === to.mode) continue;
    const { record } = buildTransition(from, to, {
      rules: rules.transition,
      gameRules: rules.gameplay,
      music,
      rng: transitionRng(seed, from.id, to.id),
    });
    transitions.push(record);
  }

  /** head/tail bars for a section, from the (updated) transition records. */
  const roleBars = (sid) => {
    const incoming = transitions.find((t) => t.toSection === sid);
    const outgoing = transitions.find((t) => t.fromSection === sid);
    return { headBars: incoming?.headBars ?? 0, tailBars: outgoing?.tailBars ?? 0 };
  };

  // Modes may have been hand-edited, so the affected sections' breathers are
  // recomputed and stored before any fill (tail caps read section.fillBars).
  const affected = [idx - 1, idx, idx + 1].filter(
    (i) => i >= 0 && i < blueprint.sections.length
  );
  const breatherOf = (i) =>
    breatherForSection(
      blueprint.sections[i],
      blueprint.sections[i + 1] ?? null,
      breatherBeats,
      beatsPerBar
    );
  for (const i of affected) {
    const b = breatherOf(i);
    blueprint.sections[i].fillBars = b ? b.fillBars : blueprint.sections[i].lengthBars;
    blueprint.sections[i].breatherFromBeat = b ? b.fromBeat : null;
  }

  // Rebuild family history from all other sections in bar order.
  const modeHistory = new Map();
  for (let i = 0; i < blueprint.sections.length; i++) {
    const s = blueprint.sections[i];
    if (i === idx) continue;
    for (const p of s.patterns) {
      const h = modeHistory.get(s.mode) ?? [];
      h.push(p.family);
      modeHistory.set(s.mode, h);
    }
  }

  // Refill the regenerated section, then patch neighbours' role placements.
  section.variant = (section.variant ?? 0) + 1;
  section.source = 'regenerated';
  const own = roleBars(section.id);
  fillSection(section, {
    headBars: own.headBars,
    tailBars: own.tailBars,
    index,
    gameRules: rules.gameplay,
    diffRules: rules.difficulty,
    transitionRules: rules.transition,
    modeHistory,
    seed,
    breather: breatherOf(idx),
    beatsPerBar,
  });

  // Patch the outgoing section's tail (its head and body stay as-authored).
  if (idx > 0) {
    const prev = blueprint.sections[idx - 1];
    prev.patterns = refillRole(prev, { ...roleBars(prev.id), index, rules, modeHistory, seed, breather: breatherOf(idx - 1), beatsPerBar });
  }
  // Patch the incoming section's head (its tail and body stay as-authored).
  if (idx < blueprint.sections.length - 1) {
    const next = blueprint.sections[idx + 1];
    next.patterns = refillRole(next, { ...roleBars(next.id), index, rules, modeHistory, seed, breather: breatherOf(idx + 1), beatsPerBar });
  }

  blueprint.transitions = transitions;
  blueprint.notes.push(`[regenerated ${sectionId} variant ${section.variant}]`);
  return blueprint;
}

/** Refill a neighbour section preserving its main body placements. */
function refillRole(s, { headBars, tailBars, index, rules, modeHistory, seed, breather, beatsPerBar }) {
  const rng = sectionRng(seed, s.id, s.variant ?? 0);
  const energyBand = bandFor(rules.difficulty, s.energy.mean);
  const baseIntensity = intensityFor(rules.difficulty, {
    energy: s.energy.mean,
    rhythmDensity: s.energy.rhythmDensity,
    peakEnergy: s.energy.peak,
  });
  const keep = s.patterns.filter(
    (p) => p.role === undefined || p.role === 'MAIN'
  );
  const mainBars = keep.reduce((n, p) => n + (index.byId.get(p.patternId)?.lengthBars ?? 0) * p.repeat, 0);

  // The breather (mode change coming) shrinks the fillable region; its bars
  // are the runtime's no-spawn window and must stay empty.
  const fillBars = breather ? breather.fillBars : s.lengthBars;

  let head = headBars;
  let tail = tailBars;
  while (head + tail >= fillBars && head + tail > 0) {
    if (tail > 0) tail--;
    else head--;
  }

  const placements = [];
  const history = modeHistory.get(s.mode) ?? [];
  const endUsable = (zoneIsLast) =>
    zoneIsLast && breather ? breather.usableBeatsInLastBar : beatsPerBar;
  const barsOf = (list) =>
    list.reduce((n, p) => n + (index.byId.get(p.patternId)?.lengthBars ?? 0) * (p.repeat ?? 1), 0);

  let headBarsUsed = 0;
  if (head > 0) {
    const { placements: headPlacements } = fillTransitionHead(head, s.mode, {
      index,
      rules: rules.gameplay,
      intensity: baseIntensity,
      rng,
    });
    headBarsUsed = barsOf(headPlacements);
    placements.push(...headPlacements);
  }
  // Tail first (see fillSection): drawn before the body so an unfillable tail
  // zone can be dropped, appended after the body because it ends the section.
  let tailPlacements = [];
  const tailRoom = fillBars - headBarsUsed;
  if (tail > tailRoom) tail = Math.max(0, tailRoom);
  if (tail > 0) {
    const tailFill = fillSectionBars(tail, s.mode, {
      index,
      rules: rules.gameplay,
      difficulty: Math.min(s.difficulty, 2),
      functionName: rules.transition.hazardReduction.tail.function,
      energy: energyBand.name,
      intensity: baseIntensity,
      familyHistory: history,
      role: 'TRANSITION_TAIL',
      roleBars: tail,
      rng,
      usableBeatsInLastBar: endUsable(true),
      beatsPerBar,
    });
    if (!(tailFill.unfilledBars > 0 && breather)) {
      tailPlacements = tailFill.placements;
    }
  }
  // Reuse the kept body if it still fits; otherwise refill.
  const bodyBars = fillBars - headBarsUsed - barsOf(tailPlacements);
  if (bodyBars > 0 && mainBars === bodyBars) {
    placements.push(...keep);
  } else if (bodyBars > 0) {
    const body = fillSectionBars(bodyBars, s.mode, {
      index,
      rules: rules.gameplay,
      difficulty: s.difficulty,
      functionName: s.function,
      energy: energyBand.name,
      intensity: baseIntensity,
      familyHistory: history,
      role: 'MAIN',
      rng,
      usableBeatsInLastBar: endUsable(tailPlacements.length === 0),
      beatsPerBar,
    });
    placements.push(...body.placements);
    history.push(...body.familyHistory);
    modeHistory.set(s.mode, history);
  }
  if (tailPlacements.length > 0) {
    placements.push(...tailPlacements);
    history.push(...tailPlacements.map((p) => p.family));
    modeHistory.set(s.mode, history);
  }
  return placements;
}

// ---------------------------------------------------------------------------
// RNG streams
// ---------------------------------------------------------------------------

function sectionRng(seed, sectionId, variant) {
  return createRng((seed ^ hashString(`${sectionId}:v${variant}`)) >>> 0);
}

function transitionRng(seed, fromId, toId) {
  return createRng((seed ^ hashString(`T:${fromId}>${toId}`)) >>> 0);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
