/**
 * Micro context -- a fine-grained slice of the song for one section.
 *
 * The director context (Layer 2) is a *song-scale* compression: it is what the
 * Level Director needs to decide the shape of a level. This is the opposite
 * end -- what a choreographer needs to place individual moments inside one
 * section, without being handed the whole 1 MB analysis.
 *
 * Two properties matter:
 *
 *  1. **Bounded.** A section can be 70 bars and the analysis has ~650 events
 *     and ~800 timeline windows. Every list here is capped, and the per-bar
 *     aggregate carries the information that a cap would otherwise drop, so a
 *     truncated list is never a silent loss of the section's shape.
 *  2. **Clamped.** Nothing outside `0 <= t <= duration_sec` is ever emitted, and
 *     nothing outside the requested bar range. Out-of-range items are counted
 *     and reported, exactly as the director context builder does -- a section
 *     that asked for bars the song does not have gets an empty context and a
 *     reason, not a context full of invented time.
 */

export const MICRO_CONTEXT_SCHEMA_VERSION = 'beatbound_micro_context_v1';

/** Caps. A section that exceeds these is summarised, not truncated silently. */
export const MICRO_LIMITS = {
  onsets: 240,
  beats: 320,
  melodyNotes: 200,
  melodyPhrases: 40,
  events: 160,
  // Anchors are the highest-value signal here and each one is small, so this
  // is generous: a cap that drops them costs more than it saves.
  anchors: 200,
  phrases: 40,
  bars: 512,
};

/**
 * Beats below this strength are omitted from `beats[]`.
 *
 * The grid itself is derivable -- bpm and beats_per_bar are in `timing`, and
 * every bar's downbeat is emitted -- so sending all 300 beats of a long section
 * spends the budget on information the model can compute. What it *cannot*
 * derive is where the music actually accents, so the weak beats are dropped and
 * the accented ones kept.
 */
const BEAT_STRENGTH_FLOOR = 0.5;

/** Event types worth sending: `beat` is in `beats[]` already, and every bar has one. */
const NOTABLE_EVENT_TYPES = new Set([
  'strong_beat', 'strong_onset', 'energy_rise', 'energy_drop', 'energy_peak',
  'large_pitch_jump', 'melody_rise', 'melody_fall', 'melody_peak',
  'vocal_entry', 'vocal_exit', 'bass_entry', 'section_boundary',
]);

/**
 * Build the micro context for a bar range.
 *
 * @param {object} analysis          the `music_analysis_v2` document
 * @param {number} startBar          1-based, inclusive
 * @param {number} endBarExclusive   half-open, matching the director context
 * @param {object} [opts]
 * @param {object} [opts.directorContext]  supplies anchors and section context
 * @param {string[]} [opts.features]       restrict which lists are built
 * @param {object} [opts.limits]
 * @returns {object}
 */
export function getMicroContext(analysis, startBar, endBarExclusive, {
  directorContext = null,
  features = null,
  limits = {},
} = {}) {
  const cap = { ...MICRO_LIMITS, ...limits };
  const want = features === null ? null : new Set(features);

  const duration = numberOr(analysis?.source?.durationSec, 0);
  const rhythm = analysis?.layers?.rhythm ?? {};
  const beatsPerBar = Array.isArray(rhythm.timeSignature) ? rhythm.timeSignature[0] : 4;
  const beatLengthSec = numberOr(rhythm.beatLengthSec, 0);
  const barCount = numberOr(rhythm.barCount, 0);

  const dropped = {};
  const drop = (kind) => {
    dropped[kind] = (dropped[kind] ?? 0) + 1;
  };

  // ---- the range itself ---------------------------------------------------
  // A section asking for bars the song does not have is a caller bug, but it
  // must not become invented time. Clamp, and say so.
  const warnings = [];
  let start = clampInt(startBar, 1, Math.max(barCount, 1));
  let end = clampInt(endBarExclusive, 1, barCount + 1);
  if (start !== startBar) warnings.push(`start_bar ${startBar} clamped to ${start}`);
  if (end !== endBarExclusive) warnings.push(`end_bar_exclusive ${endBarExclusive} clamped to ${end}`);
  if (end <= start) {
    warnings.push(`empty bar range [${start}, ${end}) -- no music to describe`);
    end = Math.min(start + 1, barCount + 1);
  }

  const bars = analysis?.layers?.rhythm?.beats ?? [];
  const startSec = timeOfBar(bars, start, beatLengthSec, beatsPerBar);
  const endSec = timeOfBar(bars, end, beatLengthSec, beatsPerBar);

  // ---- per-bar aggregate --------------------------------------------------
  // This is the section's shape, and it is complete: even when the lists below
  // are capped, every bar in the range has a row here.
  const barRows = [];
  for (let bar = start; bar < end && barRows.length < cap.bars; bar += 1) {
    barRows.push(barRow(analysis, bar, startSec, endSec, duration, drop));
  }
  if (end - start > cap.bars) {
    warnings.push(`section is ${end - start} bars; the per-bar curve was capped at ${cap.bars}`);
  }

  const ctx = {
    schema_version: MICRO_CONTEXT_SCHEMA_VERSION,
    source: {
      song_id: analysis?.source?.songId ?? null,
      duration_sec: round(duration, 6),
      analysis_schema_version: analysis?.schemaVersion ?? null,
    },
    timing: {
      bpm: numberOr(analysis?.global?.bpm, 0),
      beats_per_bar: beatsPerBar,
      beat_length_sec: round(beatLengthSec, 6),
      bar_count: barCount,
    },
    section: {
      start_bar: start,
      end_bar_exclusive: end,
      bar_count: end - start,
      start_sec: round(startSec, 6),
      end_sec: round(endSec, 6),
      duration_sec: round(Math.max(endSec - startSec, 0), 6),
      beats: (end - start) * beatsPerBar,
    },
    // How densely the director asked for this section to be played, expressed
    // as a target the choreographer can aim at rather than a bare intensity.
    recommended_density: null,
    bars: barRows,
    summary: summarise(barRows),
  };

  // ---- optional blocks ----------------------------------------------------
  if (want === null || want.has('beats')) {
    const kept = [];
    let omitted = 0;
    for (const b of beats_inRange(bars, start, end)) {
      // Downbeats always; other beats only when the music accents them.
      const notable = b.isDownbeat === true || numberOr(b.strength, 0) >= BEAT_STRENGTH_FLOOR;
      if (!notable) { omitted += 1; continue; }
      if (kept.length >= cap.beats) { drop('beats'); continue; }
      kept.push({
        bar: b.bar,
        beat: b.beatInBar ?? b.beat,
        time_sec: round(b.time, 6),
        is_downbeat: b.isDownbeat === true,
        strength: roundOrNull(b.strength, 4),
      });
    }
    ctx.beats = kept;
    // Counted rather than silently missing: the model is told the grid is
    // regular and that these beats exist but carry no accent.
    ctx.beats_omitted = omitted;
    ctx.beats_omitted_reason = omitted > 0
      ? 'unaccented non-downbeat beats; the grid is regular at timing.bpm and timing.beats_per_bar'
      : null;
  }

  if (want === null || want.has('onsets')) {
    const all = partitionInRange(
      rhythm.onsets ?? [], (o) => o.time, startSec, endSec, duration, drop,
      { outOfSong: 'onsetsOutOfSong', outOfSection: 'onsetsOutsideSection' },
    );
    const kept = strongestFirst(all, cap.onsets, drop, 'onsets');
    ctx.onsets = kept.map((o) => ({
      time_sec: round(o.time, 6),
      bar: barOfTime(bars, o.time, startSec, beatLengthSec, beatsPerBar, start),
      strength: roundOrNull(o.strength, 4),
    })).sort((a, b) => a.time_sec - b.time_sec);
    ctx.onset_count = all.length;
  }

  if (want === null || want.has('melody')) {
    ctx.melody = melodyBlock(analysis, startSec, endSec, duration, cap, drop);
  }

  if (want === null || want.has('vocal')) {
    ctx.vocal = vocalBlock(analysis, startSec, endSec, duration, start, end, beatsPerBar, beatLengthSec, cap, drop);
  }

  if (want === null || want.has('events')) {
    const all = partitionInRange(
      (analysis?.events ?? []).filter((e) => NOTABLE_EVENT_TYPES.has(e.type)),
      (e) => e.time, startSec, endSec, duration, drop,
      { outOfSong: 'eventsOutOfSong', outOfSection: 'eventsOutsideSection' },
    );
    const kept = strongestFirst(all, cap.events, drop, 'events');
    ctx.events = kept.map((e) => ({
      time_sec: round(e.time, 6),
      type: e.type,
      bar: Number.isInteger(e.bar) ? e.bar : null,
      beat: Number.isInteger(e.beat) ? e.beat : null,
      strength: roundOrNull(e.strength, 4),
    })).sort((a, b) => a.time_sec - b.time_sec || a.type.localeCompare(b.type));
    ctx.event_count = all.length;
  }

  if (want === null || want.has('phrases')) {
    ctx.phrases = clipPhrases(analysis?.layers?.phrasing?.phrases ?? [], start, end, cap.phrases, drop);
  }

  if (directorContext && (want === null || want.has('anchors'))) {
    const kept = [];
    for (const a of directorContext.anchors ?? []) {
      if (!Number.isInteger(a.bar) || a.bar < start || a.bar >= end) continue;
      if (kept.length >= cap.anchors) { drop('anchors'); continue; }
      kept.push({
        bar: a.bar,
        beat_in_bar: a.beat_in_bar ?? null,
        type: a.type,
        strength: roundOrNull(a.strength, 4),
        priority: a.priority ?? null,
      });
    }
    ctx.anchors = kept;
  }

  // The density target: how many moments per bar the director's intensity
  // implies. Derived here so every choreographer call gets the same number.
  const sectionBlock = (directorContext?.sections ?? []).find(
    (s) => s.start_bar === start && s.end_bar_exclusive === end,
  );
  if (sectionBlock) {
    ctx.recommended_density = recommendedDensity(sectionBlock, barRows, directorContext);
    ctx.section.intensity = ctx.recommended_density.intensity;
    ctx.section.function = sectionBlock.function ?? null;
    ctx.section.section_id = sectionBlock.section_id ?? null;
  }

  ctx.diagnostics = {
    dropped_out_of_range: dropped,
    truncated: Object.keys(dropped).length > 0,
    warnings,
    limits: cap,
  };

  return ctx;
}

/**
 * Structural validation for a micro context.
 *
 * Mirrors the discipline of the director context validator: dependency-free,
 * deterministic, and focused on the invariants the compiler relies on.
 *
 * @returns {string[]} problems, empty when the document is sound
 */
export function validateMicroContext(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object') return ['micro context is not an object'];
  if (doc.schema_version !== MICRO_CONTEXT_SCHEMA_VERSION) {
    problems.push(`schema_version must be ${MICRO_CONTEXT_SCHEMA_VERSION}`);
  }

  const duration = doc.source?.duration_sec;
  if (!(typeof duration === 'number' && duration > 0)) {
    problems.push('source.duration_sec must be a positive number');
  }

  const section = doc.section;
  if (!section || typeof section !== 'object') {
    problems.push('section is missing');
    return problems;
  }
  if (!Number.isInteger(section.start_bar) || section.start_bar < 1) {
    problems.push('section.start_bar must be an integer >= 1');
  }
  if (!Number.isInteger(section.end_bar_exclusive) || section.end_bar_exclusive <= section.start_bar) {
    problems.push('section.end_bar_exclusive must be an integer greater than start_bar');
  }

  const barCount = doc.timing?.bar_count;
  if (Number.isInteger(barCount)) {
    if (section.end_bar_exclusive > barCount + 1) {
      problems.push(`section.end_bar_exclusive ${section.end_bar_exclusive} runs past bar_count ${barCount}`);
    }
    if (Array.isArray(doc.bars) && doc.bars.length > barCount) {
      problems.push(`bars has ${doc.bars.length} rows but the song has ${barCount} bars`);
    }
  }

  // The clamp, checked on every time-bearing list. This is the invariant the
  // whole layer exists to guarantee.
  const lists = [
    ['beats', doc.beats],
    ['onsets', doc.onsets],
    ['events', doc.events],
    ['melody.notes', doc.melody?.notes],
    ['melody.phrases', doc.melody?.phrases],
    ['phrases', doc.phrases],
  ];
  for (const [name, list] of lists) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`${name} must be an array`);
      continue;
    }
    for (const [i, item] of list.entries()) {
      const t = item?.time_sec ?? item?.start_sec;
      if (t === undefined) continue;
      if (!Number.isFinite(t) || t < 0 || (typeof duration === 'number' && t > duration)) {
        problems.push(`${name}[${i}] time ${t} is outside 0..${duration}`);
        break;
      }
    }
  }

  // Every bar row must sit inside the section.
  for (const [i, row] of (doc.bars ?? []).entries()) {
    if (!Number.isInteger(row?.bar)) {
      problems.push(`bars[${i}].bar must be an integer`);
      break;
    }
    if (row.bar < section.start_bar || row.bar >= section.end_bar_exclusive) {
      problems.push(`bars[${i}].bar ${row.bar} is outside the section [${section.start_bar}, ${section.end_bar_exclusive})`);
      break;
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function barRow(analysis, bar, startSec, endSec, duration, drop) {
  const windows = analysis?.timeline?.windows ?? [];
  const hop = numberOr(analysis?.timeline?.hopSec, 0.25);
  const beats = analysis?.layers?.rhythm?.beats ?? [];

  const barBeats = beats.filter((b) => b.bar === bar);
  let barStart = barBeats.length > 0 ? barBeats[0].time : null;
  let barEnd = barBeats.length > 0 ? barBeats[barBeats.length - 1].time + hop : null;
  if (barStart === null) {
    // Fall back to the section's own span when the beat grid has no row for
    // this bar (a bar the detector dropped); the window aggregate still works.
    barStart = startSec;
    barEnd = endSec;
  }

  const inBar = windows.filter((w) => inRange(w.time, barStart, barEnd, duration));
  const mean = (key) => meanOf(inBar.map((w) => w[key]));

  const onsets = (analysis?.layers?.rhythm?.onsets ?? []).filter(
    (o) => inRange(o.time, barStart, barEnd, duration),
  );

  const events = (analysis?.events ?? []).filter(
    (e) => NOTABLE_EVENT_TYPES.has(e.type) && inRange(e.time, barStart, barEnd, duration),
  );

  return {
    bar,
    time_sec: round(barStart, 6),
    energy: roundOrNull(mean('energy'), 4),
    drums: roundOrNull(mean('drumActivity'), 4),
    bass: roundOrNull(mean('bassActivity'), 4),
    vocals: roundOrNull(mean('vocalActivity'), 4),
    melody: roundOrNull(mean('melodicActivity'), 4),
    brightness: roundOrNull(mean('brightness'), 4),
    onset_count: onsets.length,
    strong_onset_count: onsets.filter((o) => numberOr(o.strength, 0) >= 0.6).length,
    beat_count: barBeats.length,
    event_types: [...new Set(events.map((e) => e.type))].sort(),
  };
}

function melodyBlock(analysis, startSec, endSec, duration, cap, drop) {
  const melody = analysis?.layers?.melody ?? {};
  const notes = partitionInRange(
    melody.notes ?? [], (n) => n.start, startSec, endSec, duration, drop,
    { outOfSong: 'melodyNotesOutOfSong', outOfSection: 'melodyNotesOutsideSection' },
  );

  const kept = notes.length > cap.melodyNotes
    ? [...notes].sort((a, b) => numberOr(b.confidence, 0) - numberOr(a.confidence, 0)).slice(0, cap.melodyNotes)
    : notes;
  if (notes.length > cap.melodyNotes) drop('melodyNotes');

  const phrases = partitionInRange(
    melody.phrases ?? [], (p) => p.start, startSec, endSec, duration, drop,
    { outOfSong: 'melodyPhrasesOutOfSong', outOfSection: 'melodyPhrasesOutsideSection' },
  );
  const keptPhrases = phrases.slice(0, cap.melodyPhrases);
  if (phrases.length > cap.melodyPhrases) drop('melodyPhrases');

  const pitches = notes.map((n) => n.pitchMidi).filter(Number.isFinite);

  return {
    available: melody.available === true,
    backend: melody.backend ?? null,
    note_count: notes.length,
    notes: kept
      .map((n) => ({
        start_sec: round(n.start, 6),
        end_sec: round(n.end, 6),
        pitch_midi: n.pitchMidi ?? null,
        confidence: roundOrNull(n.confidence, 4),
      }))
      .sort((a, b) => a.start_sec - b.start_sec),
    phrases: keptPhrases.map((p) => ({
      start_sec: round(p.start, 6),
      end_sec: round(p.end, 6),
      direction: p.direction ?? null,
      pitch_range_semitones: p.pitchRangeSemitones ?? null,
      note_count: p.noteCount ?? null,
      confidence: roundOrNull(p.confidence, 4),
    })),
    pitch_range: pitches.length > 0
      ? { min_midi: Math.min(...pitches), max_midi: Math.max(...pitches) }
      : null,
  };
}

function vocalBlock(analysis, startSec, endSec, duration, startBar, endBar, beatsPerBar, beatLengthSec, cap, drop) {
  const windows = analysis?.timeline?.windows ?? [];
  const inRangeWindows = windows.filter((w) => inRange(w.time, startSec, endSec, duration));
  const active = inRangeWindows.filter((w) => numberOr(w.vocalActivity, 0) >= 0.15);
  // Contiguous runs of vocal activity, so the choreographer sees where the
  // vocal *is* rather than a per-window series it has to threshold itself.
  const spans = [];
  let current = null;
  for (const w of active) {
    if (current && w.time - current.end_sec <= 1.0) {
      current.end_sec = w.time;
      current.peak = Math.max(current.peak, numberOr(w.vocalActivity, 0));
    } else {
      if (current) spans.push(current);
      current = { start_sec: w.time, end_sec: w.time, peak: numberOr(w.vocalActivity, 0) };
    }
  }
  if (current) spans.push(current);

  const kept = spans.slice(0, 40);
  if (spans.length > 40) drop('vocalSpans');

  return {
    activity_mean: roundOrNull(meanOf(inRangeWindows.map((w) => w.vocalActivity)), 4),
    activity_peak: roundOrNull(maxOf(inRangeWindows.map((w) => w.vocalActivity)), 4),
    present: spans.length > 0,
    spans: kept.map((s) => ({
      start_sec: round(s.start_sec, 6),
      end_sec: round(Math.min(s.end_sec + 0.25, duration), 6),
      peak: round(s.peak, 4),
    })),
    lyrics_available: analysis?.lyrics?.available === true,
  };
}

function clipPhrases(phrases, startBar, endBar, cap, drop) {
  const overlapping = phrases.filter((p) => {
    const ps = Number.isInteger(p.start_bar) ? p.start_bar : null;
    const pe = Number.isInteger(p.end_bar) ? p.end_bar : null;
    if (ps === null || pe === null) return false;
    return ps < endBar && pe > startBar;
  });
  const kept = overlapping.slice(0, cap.phrases);
  if (overlapping.length > cap.phrases) drop('phrases');
  return kept.map((p) => ({
    phrase_id: p.phrase_id,
    section_id: p.section_id ?? null,
    start_bar: p.start_bar,
    end_bar: p.end_bar,
    // Clipped to the section: a phrase straddling the seam is reported as the
    // part that is actually inside, which is the part that can be played.
    clipped_start_bar: Math.max(p.start_bar, startBar),
    clipped_end_bar: Math.min(p.end_bar, endBar),
    position_label: p.position_label ?? null,
    energy_mean: roundOrNull(p.energy_mean, 4),
    energy_trend: p.energy_trend ?? null,
    dominant_layers: p.dominant_layers ?? [],
    confidence: roundOrNull(p.confidence, 4),
  }));
}

function summarise(barRows) {
  if (barRows.length === 0) return null;
  const energy = barRows.map((r) => r.energy).filter(Number.isFinite);
  const onsets = barRows.map((r) => r.onset_count);
  const peak = barRows.reduce((best, r) => (numberOr(r.energy, -1) > numberOr(best?.energy, -1) ? r : best), null);
  const valley = barRows.reduce((best, r) => (numberOr(r.energy, 2) < numberOr(best?.energy, 2) ? r : best), null);
  return {
    energy_mean: roundOrNull(meanOf(energy), 4),
    energy_min: roundOrNull(minOf(energy), 4),
    energy_max: roundOrNull(maxOf(energy), 4),
    energy_peak_bar: peak?.bar ?? null,
    energy_valley_bar: valley?.bar ?? null,
    onsets_per_bar_mean: roundOrNull(meanOf(onsets), 3),
    onsets_per_bar_max: onsets.length > 0 ? Math.max(...onsets) : 0,
    bars_with_strong_onsets: barRows.filter((r) => r.strong_onset_count > 0).length,
    vocal_bars: barRows.filter((r) => numberOr(r.vocals, 0) >= 0.15).length,
    melody_bars: barRows.filter((r) => numberOr(r.melody, 0) >= 0.15).length,
  };
}

/**
 * Moments per bar implied by a section's intensity.
 *
 * Intensity is taken from the blueprint's section when there is one (the
 * director's design intent), otherwise from the director context's own
 * `bar_curve[].combined_intensity` averaged over the section -- the same number
 * the Level Director reads, so the two layers agree about how hard a section is
 * instead of each inventing its own scale.
 *
 * A linear map onto the useful range: intensity 0 is one moment every four
 * bars, intensity 1 is one per bar. Never zero -- a section with no moments at
 * all is a section the player watches instead of plays.
 */
export function recommendedDensity(sectionBlock, barRows, directorContext = null) {
  const intensity = resolveIntensity(sectionBlock, barRows, directorContext);
  const perBar = 0.25 + intensity * 0.75;
  const bars = Number.isInteger(sectionBlock?.start_bar) && Number.isInteger(sectionBlock?.end_bar_exclusive)
    ? sectionBlock.end_bar_exclusive - sectionBlock.start_bar
    : barRows?.length ?? 0;
  return {
    moments_per_bar: round(perBar, 3),
    total_moments: Math.max(1, Math.round(perBar * bars)),
    intensity: round(intensity, 3),
    basis: sectionBlock?.intensity !== undefined && sectionBlock?.intensity !== null
      ? `blueprint intensity ${round(intensity, 3)} over ${bars} bars`
      : `bar_curve combined_intensity ${round(intensity, 3)} over ${bars} bars`,
  };
}

/** The section's intensity on a 0..1 scale, from the best source available. */
function resolveIntensity(sectionBlock, barRows, directorContext) {
  const declared = sectionBlock?.intensity;
  if (Number.isFinite(declared)) return clamp01(declared);

  const start = sectionBlock?.start_bar;
  const end = sectionBlock?.end_bar_exclusive;
  const curve = directorContext?.bar_curve;
  if (Number.isInteger(start) && Number.isInteger(end) && Array.isArray(curve)) {
    const values = curve
      .filter((row) => Number.isInteger(row?.bar) && row.bar >= start && row.bar < end)
      .map((row) => row.combined_intensity)
      .filter(Number.isFinite);
    if (values.length > 0) return clamp01(values.reduce((a, b) => a + b, 0) / values.length);
  }

  // Last resort: the section's own energy against the song's overall energy,
  // so a quiet section still reads as quieter than a loud one.
  const energy = meanOf((barRows ?? []).map((r) => r.energy));
  const overall = directorContext?.music_profile?.overall_energy;
  if (Number.isFinite(energy) && Number.isFinite(overall) && overall > 0) {
    return clamp01(energy / overall / 2);
  }
  return 0.5;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeOfBar(beats, bar, beatLengthSec, beatsPerBar) {
  const first = beats.find((b) => b.bar === bar);
  if (first) return first.time;
  // Past the last bar the grid knows about: extrapolate from the last beat.
  const last = beats[beats.length - 1];
  if (last) return last.time + (bar - last.bar) * beatsPerBar * beatLengthSec;
  return (bar - 1) * beatsPerBar * beatLengthSec;
}

function beats_inRange(beats, startBar, endBar) {
  return beats.filter((b) => Number.isInteger(b.bar) && b.bar >= startBar && b.bar < endBar);
}

function barOfTime(beats, time, startSec, beatLengthSec, beatsPerBar, fallbackBar) {
  let best = null;
  for (const b of beats) {
    if (b.time <= time && (best === null || b.time > best.time)) best = b;
  }
  if (best) return best.bar;
  return fallbackBar + Math.floor((time - startSec) / (beatsPerBar * beatLengthSec || 1));
}

function inRange(t, lo, hi, duration) {
  if (!Number.isFinite(t)) return false;
  if (t < 0 || t > duration) return false;
  return t >= lo && t < hi;
}

/**
 * Keep the items inside `[lo, hi)`, counting the ones dropped.
 *
 * Two distinct reasons are tracked separately because they mean different
 * things: `outOfSong` is an analysis defect (an event the detector placed
 * outside the track), while `outOfSection` is simply the section boundary doing
 * its job. Only the first is worth reporting as a problem.
 */
function partitionInRange(items, timeOf, lo, hi, duration, drop, kinds) {
  const kept = [];
  for (const item of items) {
    const t = timeOf(item);
    if (Number.isFinite(t) && (t < 0 || t > duration)) {
      drop(kinds.outOfSong);
      continue;
    }
    if (!inRange(t, lo, hi, duration)) {
      drop(kinds.outOfSection);
      continue;
    }
    kept.push(item);
  }
  return kept;
}

function strongestFirst(items, limit, drop, kind) {
  if (items.length <= limit) return items;
  drop(kind);
  return [...items]
    .sort((a, b) => numberOr(b.strength, 0) - numberOr(a.strength, 0))
    .slice(0, limit);
}

function numberOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round(v, digits) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function roundOrNull(v, digits) {
  return Number.isFinite(v) ? round(v, digits) : null;
}

function meanOf(values) {
  const nums = values.filter(Number.isFinite);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function minOf(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length === 0 ? null : Math.min(...nums);
}

function maxOf(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length === 0 ? null : Math.max(...nums);
}
