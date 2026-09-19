/**
 * LevelCompiler -- level_blueprint.json -> level.json.
 *
 * The output is the runtime's level format (version / song / sections[] with
 * absolute bars, modes, pattern placements and transitionOut ids) plus two
 * forward-compatible editor extensions the runtime currently ignores:
 *
 *   sections[].scene   transition scene instructions (future scene hook)
 *   editor             provenance: seed, analysis source, blueprint version
 */

import { GENERATOR_VERSION } from './levelDirector.js';

/**
 * Compile a blueprint into a runtime level definition object.
 * Returns { level, warnings }.
 */
export function compile(blueprint) {
  const warnings = [];

  const level = {
    version: '1.0.0',
    editor: {
      seed: blueprint.seed,
      analysisSource: blueprint.analysisSource,
      blueprintVersion: GENERATOR_VERSION,
    },
    song: {
      id: blueprint.song.id,
      title: blueprint.song.title,
      audio: blueprint.song.audioPath,
      bpm: blueprint.song.bpm,
      timeSignature: blueprint.song.timeSignature,
    },
    sections: [],
  };

  for (const s of blueprint.sections) {
    const patterns = s.patterns.map((p) => ({
      patternId: p.patternId,
      repeat: p.repeat,
      intensity: p.intensity,
    }));

    // transitionOut: the next mode change, or null on the last section.
    const outgoing = blueprint.transitions.find((t) => t.fromSection === s.id);

    const section = {
      id: s.id,
      startBar: s.startBar,
      lengthBars: s.endBar - s.startBar + 1,
      mode: s.mode,
      function: s.function,
      difficulty: s.difficulty,
      patterns,
      transitionOut: outgoing ? outgoing.kind : null,
    };

    // Editor extension: scene instructions from the outgoing transition.
    if (outgoing && outgoing.scene && outgoing.scene.length > 0) {
      section.scene = {
        effects: outgoing.scene.map((e) => ({
          effect: e.effect,
          params: e.params ?? {},
          durationBeats: e.durationBeats ?? 4,
        })),
      };
    }

    level.sections.push(section);
  }

  if (level.sections.length === 0) {
    throw new Error('LevelCompiler: blueprint has no sections');
  }
  return { level, warnings };
}
