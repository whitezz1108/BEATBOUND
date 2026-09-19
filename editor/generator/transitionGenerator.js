/**
 * TransitionGenerator -- every gameplay-mode change becomes a transition:
 *
 *   duration    2-4 seconds (4-8 beats at typical tempos), scaled by the
 *               energy jump across the boundary
 *   tail        the outgoing section's last bars switch to recovery patterns
 *               at reduced intensity (hazard reduction)
 *   head        the incoming section's first bars open with TEACH patterns at
 *               reduced intensity (preparation for new controls)
 *   scene       1-2 scene instructions (palette shift, camera zoom, wipe, ...)
 *               carried in the blueprint and into level.json as an editor
 *               extension the runtime can consume later
 */

import { clamp, pickWeighted, round2 } from './seed.js';

/**
 * Build a transition between two blueprint sections.
 * Returns the transition record plus { tailBars, headBars } so the director
 * can re-fill the affected bars of each section.
 */
export function buildTransition(fromSection, toSection, opts) {
  const { rules, gameRules, music, rng } = opts;
  const tr = rules;
  const duration = tr.duration;

  // Energy jump across the boundary drives duration: busier boundaries get
  // a longer breather, capped at 8 beats (and forced even for musicality).
  const delta = Math.abs(fromSection.energy.mean - toSection.energy.mean);
  let beats = Math.round(
    clamp(
      duration.baseBeats + duration.beatsPerEnergyUnit * delta,
      duration.minBeats,
      duration.maxBeats
    )
  );
  if (duration.preferEvenBeats && beats % 2 !== 0) beats += beats < duration.maxBeats ? 1 : -1;

  const beatsPerBar = music.tempo.timeSignature[0];
  // Tail bars: bars fully inside the transition length, capped by the rules
  // and by how many bars the outgoing section can spare. When a mode change
  // is coming the runtime breathes the last `breatherBeats` (no spawning at
  // all), so the tail must end inside the fillable region -- the section's
  // `fillBars` already ends exactly at sectionEndBeat - breatherBeats.
  let tailBars = Math.max(0, Math.floor(beats / beatsPerBar));
  tailBars = Math.min(
    tailBars,
    tr.hazardReduction.tail.maxBars,
    Math.max(0, (fromSection.fillBars ?? fromSection.lengthBars) - tr.hazardReduction.tail.minBarsKept)
  );
  let headBars = Math.max(0, Math.ceil(beats / beatsPerBar) - tailBars);
  headBars = Math.min(headBars, tr.hazardReduction.head.maxBars, toSection.lengthBars);

  // Scene instructions: up to 2 weighted picks, never all effects at once.
  const scene = pickSceneEffects(tr.scene, rng);

  const kind = `${fromSection.mode}_TO_${toSection.mode}`;
  return {
    record: {
      id: `T_${fromSection.id}_${toSection.id}`,
      fromSection: fromSection.id,
      toSection: toSection.id,
      kind,
      lengthBeats: beats,
      tailBars,
      headBars,
      hazardReduction: tailBars > 0 && headBars > 0 ? 'both' : tailBars > 0 ? 'recovery_tail' : 'calm_head',
      scene,
    },
    tailBars,
    headBars,
  };
}

function pickSceneEffects(sceneRules, rng) {
  const max = sceneRules.maxEffectsPerTransition;
  const count = 1 + Math.floor(rng() * max); // 1..max
  const pool = [...sceneRules.effects];
  const picked = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const entries = pool.map((e) => [e, e.weight]);
    const chosen = pickWeighted(rng, entries);
    picked.push({
      effect: chosen.effect,
      params: { ...chosen.params },
      durationBeats: round2(4),
    });
    const idx = pool.indexOf(chosen);
    pool.splice(idx, 1);
  }
  return picked;
}
