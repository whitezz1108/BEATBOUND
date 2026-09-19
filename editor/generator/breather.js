/**
 * Breather -- the runtime's no-spawn window before a mode change.
 *
 * The game's LevelLoader compiles `breatherFromBeat` for any section whose
 * mode differs from the next section: PatternScheduler then drops every event
 * whose activation beat is >= breatherFromBeat, and `npm run test:timing`
 * exempts those bars from its dead-air check. The editor must mirror this
 * exactly, or it writes gameplay the runtime silently throws away.
 *
 * All arithmetic here is in BEATS, never bars: breatherBeats = 6 in 4/4 cuts
 * 1.5 bars off the end of a section, and the fill region must end precisely at
 * sectionEndBeat - breatherBeats. Rounding up to whole bars would either eat
 * playable beats or leave extra dead air.
 *
 * breatherBeats comes from the live game source (src/tuning.ts ->
 * TUNING.transition.breatherBeats); the server injects it into the rules so
 * the editor can never drift from the runtime.
 */

/**
 * Compute the breather for one section.
 *
 * @param section     {startBar, endBar, mode} (1-based inclusive bars)
 * @param nextSection the following section, or null at the end of the level
 * @param breatherBeats beats of no-spawn before a mode change (>= 0)
 * @param beatsPerBar time signature numerator
 * @returns {fromBeat, breatherBeats, fillBars, usableBeatsInLastBar} or null
 *   when the section needs no breather (same mode continues, last section, or
 *   breatherBeats = 0).
 *
 *   fromBeat              absolute beat the breather starts at; every
 *                         activation at >= fromBeat is dropped by the runtime
 *   fillBars              bars the editor may fill (startBar..startBar+fillBars-1)
 *   usableBeatsInLastBar  beats of the final fill bar that still spawn, i.e.
 *                         fromBeat - (start of the final fill bar). Equal to
 *                         beatsPerBar when the breather starts on a bar line.
 */
export function breatherForSection(section, nextSection, breatherBeats, beatsPerBar) {
  const beats = Math.max(0, Math.floor(breatherBeats ?? 0));
  if (!nextSection || nextSection.mode === section.mode || beats === 0) return null;

  const startBeat = (section.startBar - 1) * beatsPerBar;
  const endBeat = section.endBar * beatsPerBar; // section end, exclusive
  const fromBeat = endBeat - beats;

  // Bars with at least one beat before the breather starts. A partial final
  // bar is still fillable: a beat-1 activation there spawns (< fromBeat).
  const fillBars = Math.max(0, Math.floor((fromBeat - startBeat - 1) / beatsPerBar) + 1);
  const usableBeatsInLastBar =
    fillBars > 0 ? fromBeat - (startBeat + (fillBars - 1) * beatsPerBar) : 0;

  return { fromBeat, breatherBeats: beats, fillBars, usableBeatsInLastBar };
}

/**
 * Beat-precise end of the playable region, as a bar + beat inside the section
 * (1-based). Used by the UI to draw the breather boundary without rounding.
 * Returns { bar, beat } relative to the section start, or null.
 */
export function breatherBarLine(section, breather, beatsPerBar) {
  if (!breather) return null;
  const startBeat = (section.startBar - 1) * beatsPerBar;
  const rel = breather.fromBeat - startBeat; // beats into the section, 0-based
  return { bar: Math.floor(rel / beatsPerBar) + 1, beat: (rel % beatsPerBar) + 1 };
}
