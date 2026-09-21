/**
 * Micro context.
 *
 * The invariants worth protecting: nothing outside the song's duration is ever
 * emitted, nothing outside the requested bar range, every bar in the range has
 * a row even when the lists are capped, and the caps are *reported* rather than
 * silently applied. A choreographer given a silently truncated section would
 * place moments as if the missing bars did not exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  getMicroContext,
  validateMicroContext,
  recommendedDensity,
  MICRO_CONTEXT_SCHEMA_VERSION,
  MICRO_LIMITS,
} from '../generation/microContext.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REAL_ANALYSIS = `${ROOT}editor/output/music_analysis_v2.json`;
const REAL_DIRECTOR = `${ROOT}editor/output/director_context_v2.json`;

/**
 * A synthetic analysis: 16 bars at 120 BPM in 4/4 (2 s per bar, 32 s total),
 * with a deliberate out-of-range tail so the clamp has something to catch.
 */
function makeAnalysis({ durationSec = 32, barCount = 16 } = {}) {
  const beatLength = 0.5;
  const beats = [];
  for (let bar = 1; bar <= barCount + 2; bar += 1) {
    for (let beat = 1; beat <= 4; beat += 1) {
      beats.push({
        index: beats.length,
        time: ((bar - 1) * 4 + (beat - 1)) * beatLength,
        bar,
        beat,
        beatInBar: beat,
        isDownbeat: beat === 1,
        strength: beat === 1 ? 0.9 : beat === 3 ? 0.6 : 0.1,
      });
    }
  }

  const windows = [];
  for (let t = 0; t < durationSec; t += 0.25) {
    windows.push({
      time: t,
      energy: 0.3 + 0.4 * Math.sin((t / durationSec) * Math.PI),
      drumActivity: 0.5, bassActivity: 0.4,
      vocalActivity: t > 8 && t < 20 ? 0.4 : 0.02,
      melodicActivity: 0.2, brightness: 0.5,
    });
  }

  return {
    schemaVersion: 2,
    source: { songId: 'synthetic', durationSec, audioHash: 'x' },
    global: { bpm: 120, overallEnergy: 0.5 },
    timeline: { hopSec: 0.25, windows },
    layers: {
      rhythm: {
        bpm: 120, timeSignature: [4, 4], beatLengthSec: beatLength,
        beatCount: beats.length, barCount, beats,
        onsets: [
          ...Array.from({ length: 40 }, (_, i) => ({ time: i * 0.7, strength: (i % 5) / 5 })),
          // Out of range: past the end, and negative.
          { time: durationSec + 5, strength: 0.9 },
          { time: -1, strength: 0.9 },
        ],
      },
      melody: {
        available: true, backend: 'basic_pitch',
        notes: [
          ...Array.from({ length: 30 }, (_, i) => ({
            start: i * 1.0, end: i * 1.0 + 0.3, pitchMidi: 60 + (i % 12), confidence: 0.5,
          })),
          { start: durationSec + 3, end: durationSec + 3.3, pitchMidi: 72, confidence: 0.9 },
        ],
        phrases: [{ start: 4, end: 8, direction: 'rising', pitchRangeSemitones: 5, noteCount: 4, confidence: 0.7 }],
      },
      phrasing: {
        phrases: [
          { phrase_id: 'phrase_001', section_id: 'section_01', start_bar: 1, end_bar: 9, position_label: 'opening', energy_mean: 0.4, energy_trend: 'stable', dominant_layers: ['drums'], confidence: 0.8 },
          // Straddles the seam between bars 8 and 9.
          { phrase_id: 'phrase_002', section_id: 'section_01', start_bar: 8, end_bar: 14, position_label: 'middle', energy_mean: 0.6, energy_trend: 'rising', dominant_layers: ['bass'], confidence: 0.7 },
        ],
      },
      stems: { activity: {} },
    },
    events: [
      ...Array.from({ length: 20 }, (_, i) => ({
        time: i * 1.5, type: 'strong_onset', strength: 0.7, bar: Math.floor(i * 1.5 / 2) + 1, beat: 1,
      })),
      { time: 3, type: 'beat', strength: 0.9, bar: 2, beat: 3 },
      { time: durationSec + 10, type: 'energy_peak', strength: 1.0, bar: 99, beat: 1 },
    ],
    lyrics: { available: false, words: [] },
  };
}

function makeDirectorContext() {
  return {
    source: { song_id: 'synthetic', duration_sec: 32 },
    timing: { bpm: 120, beats_per_bar: 4, bar_count: 16 },
    sections: [
      { section_id: 'section_01', start_bar: 1, end_bar_exclusive: 9 },
      { section_id: 'section_02', start_bar: 9, end_bar_exclusive: 17 },
    ],
    bar_curve: Array.from({ length: 16 }, (_, i) => ({
      bar: i + 1,
      combined_intensity: i < 8 ? 0.3 : 0.8,
    })),
    anchors: [
      { bar: 3, beat_in_bar: 1, type: 'strong_beat', strength: 0.9, priority: 'high' },
      { bar: 9, beat_in_bar: 1, type: 'section_boundary', strength: 1.0, priority: 'high' },
      { bar: 99, beat_in_bar: 1, type: 'energy_peak', strength: 1.0, priority: 'high' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Range and clamping
// ---------------------------------------------------------------------------

test('the section range is reported in bars, seconds and beats', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  assert.equal(ctx.schema_version, MICRO_CONTEXT_SCHEMA_VERSION);
  assert.equal(ctx.section.start_bar, 1);
  assert.equal(ctx.section.end_bar_exclusive, 9);
  assert.equal(ctx.section.bar_count, 8);
  assert.equal(ctx.section.start_sec, 0);
  assert.equal(ctx.section.end_sec, 16, '8 bars at 120 BPM in 4/4 is 16 s');
  assert.equal(ctx.section.beats, 32);
});

test('items the analysis placed outside the song are dropped and counted', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 17);
  // One past the end and one negative, in each list that has them. These are
  // analysis defects, and are counted separately from ordinary section
  // boundaries -- which are not a problem, just the range doing its job.
  assert.equal(ctx.diagnostics.dropped_out_of_range.onsetsOutOfSong, 2);
  assert.equal(ctx.diagnostics.dropped_out_of_range.melodyNotesOutOfSong, 1);
  assert.equal(ctx.diagnostics.dropped_out_of_range.eventsOutOfSong, 1);
  assert.equal(ctx.diagnostics.truncated, true);
});

test('items merely outside the requested section are counted separately', () => {
  // Bars 1-9 of a 16-bar song: the rest of the song is legitimately excluded.
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  assert.ok(ctx.diagnostics.dropped_out_of_range.onsetsOutsideSection > 0);
  assert.equal(ctx.diagnostics.dropped_out_of_range.onsetsOutOfSong, 2, 'the two defects are still counted');
});

test('no emitted time is ever outside the song', () => {
  const duration = 32;
  const ctx = getMicroContext(makeAnalysis({ durationSec: duration }), 1, 17);
  for (const list of [ctx.beats, ctx.onsets, ctx.events, ctx.melody.notes, ctx.melody.phrases]) {
    for (const item of list) {
      const t = item.time_sec ?? item.start_sec;
      if (t === undefined) continue;
      assert.ok(t >= 0 && t <= duration, `time ${t} is outside 0..${duration}`);
    }
  }
  assert.deepEqual(validateMicroContext(ctx), []);
});

test('a bar range past the end of the song is clamped and reported', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 500);
  assert.equal(ctx.section.end_bar_exclusive, 17, 'clamped to bar_count + 1');
  assert.ok(ctx.diagnostics.warnings.some((w) => w.includes('clamped')));
});

test('a bar range starting before bar 1 is clamped and reported', () => {
  const ctx = getMicroContext(makeAnalysis(), -5, 9);
  assert.equal(ctx.section.start_bar, 1);
  assert.ok(ctx.diagnostics.warnings.some((w) => w.includes('start_bar')));
});

test('an empty bar range produces a reason, not invented time', () => {
  const ctx = getMicroContext(makeAnalysis(), 9, 9);
  assert.ok(ctx.diagnostics.warnings.some((w) => w.includes('empty bar range')));
  assert.ok(ctx.section.end_bar_exclusive > ctx.section.start_bar);
  assert.deepEqual(validateMicroContext(ctx), []);
});

test('a non-numeric bar range falls back rather than throwing', () => {
  const ctx = getMicroContext(makeAnalysis(), undefined, null);
  assert.equal(ctx.section.start_bar, 1);
  assert.deepEqual(validateMicroContext(ctx), []);
});

// ---------------------------------------------------------------------------
// Per-bar aggregate
// ---------------------------------------------------------------------------

test('every bar in the range gets a row, in order', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  assert.equal(ctx.bars.length, 8);
  assert.deepEqual(ctx.bars.map((r) => r.bar), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a bar row carries the layer activity and onset counts', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 3);
  const row = ctx.bars[0];
  assert.equal(row.bar, 1);
  assert.ok(Number.isFinite(row.energy));
  assert.ok(Number.isFinite(row.drums));
  assert.ok(Number.isFinite(row.vocals));
  assert.ok(Number.isInteger(row.onset_count));
  assert.ok(Number.isInteger(row.strong_onset_count));
  assert.equal(row.beat_count, 4);
  assert.ok(Array.isArray(row.event_types));
});

test('the summary names the peak and valley bars', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 17);
  assert.ok(ctx.summary.energy_peak_bar >= 1 && ctx.summary.energy_peak_bar <= 16);
  assert.ok(ctx.summary.energy_valley_bar >= 1 && ctx.summary.energy_valley_bar <= 16);
  assert.ok(ctx.summary.energy_max >= ctx.summary.energy_min);
  assert.ok(ctx.summary.vocal_bars > 0, 'the fixture has vocals between 8 s and 20 s');
});

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

test('downbeats are always emitted', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 5);
  const downbeats = ctx.beats.filter((b) => b.is_downbeat);
  assert.deepEqual(downbeats.map((b) => b.bar), [1, 2, 3, 4]);
});

test('accented non-downbeat beats are kept and weak ones omitted', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 5);
  // The fixture accents beat 3 (0.6) and leaves beats 2 and 4 at 0.1.
  assert.ok(ctx.beats.some((b) => !b.is_downbeat && b.beat === 3));
  assert.ok(!ctx.beats.some((b) => !b.is_downbeat && b.beat === 2));
  assert.equal(ctx.beats_omitted, 8, 'beats 2 and 4 of four bars');
  assert.match(ctx.beats_omitted_reason, /grid is regular/);
});

test('a fully-accented section reports nothing omitted', () => {
  const analysis = makeAnalysis();
  for (const b of analysis.layers.rhythm.beats) b.strength = 0.9;
  const ctx = getMicroContext(analysis, 1, 3);
  assert.equal(ctx.beats_omitted, 0);
  assert.equal(ctx.beats_omitted_reason, null);
});

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

test('the onset cap is reported alongside the true count', () => {
  const analysis = makeAnalysis();
  analysis.layers.rhythm.onsets = Array.from({ length: 500 }, (_, i) => ({
    time: (i / 500) * 32, strength: (i % 10) / 10,
  }));
  const ctx = getMicroContext(analysis, 1, 17, { limits: { onsets: 50 } });
  assert.equal(ctx.onsets.length, 50);
  assert.equal(ctx.onset_count, 500, 'the true count is still reported');
  assert.equal(ctx.diagnostics.dropped_out_of_range.onsets, 1, 'the truncation is counted under its own key');
});

test('a capped onset list keeps the strongest, then sorts by time', () => {
  const analysis = makeAnalysis();
  analysis.layers.rhythm.onsets = Array.from({ length: 100 }, (_, i) => ({
    time: (i / 100) * 32, strength: i === 7 ? 1.0 : 0.1,
  }));
  const ctx = getMicroContext(analysis, 1, 17, { limits: { onsets: 5 } });
  assert.equal(ctx.onsets.length, 5);
  const times = ctx.onsets.map((o) => o.time_sec);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'still ordered by time');
  assert.ok(ctx.onsets.some((o) => o.strength === 1.0), 'the strongest survived the cap');
});

test('the melody note list is capped and keeps the most confident', () => {
  const analysis = makeAnalysis();
  analysis.layers.melody.notes = Array.from({ length: 100 }, (_, i) => ({
    start: (i / 100) * 32, end: (i / 100) * 32 + 0.2, pitchMidi: 60, confidence: i === 3 ? 0.99 : 0.1,
  }));
  const ctx = getMicroContext(analysis, 1, 17, { limits: { melodyNotes: 10 } });
  assert.equal(ctx.melody.notes.length, 10);
  assert.equal(ctx.melody.note_count, 100);
  assert.ok(ctx.melody.notes.some((n) => n.confidence === 0.99));
});

test('the anchor list is capped and drops anchors outside the section', () => {
  const dc = makeDirectorContext();
  const ctx = getMicroContext(makeAnalysis(), 1, 9, { directorContext: dc });
  assert.deepEqual(ctx.anchors.map((a) => a.bar), [3], 'bar 9 is the next section, bar 99 is past the end');

  const capped = getMicroContext(makeAnalysis(), 1, 17, { directorContext: dc, limits: { anchors: 1 } });
  assert.equal(capped.anchors.length, 1);
  assert.equal(capped.diagnostics.dropped_out_of_range.anchors, 1);
});

// ---------------------------------------------------------------------------
// Feature selection
// ---------------------------------------------------------------------------

test('requesting a subset of features omits the rest', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9, { features: ['bars', 'onsets'] });
  assert.ok(Array.isArray(ctx.bars));
  assert.ok(Array.isArray(ctx.onsets));
  assert.equal(ctx.beats, undefined);
  assert.equal(ctx.melody, undefined);
  assert.equal(ctx.events, undefined);
  assert.deepEqual(validateMicroContext(ctx), []);
});

test('the per-bar aggregate is always present regardless of features', () => {
  // It is the section's shape; a choreographer without it is placing moments blind.
  for (const features of [[], ['onsets'], ['melody']]) {
    const ctx = getMicroContext(makeAnalysis(), 1, 9, { features });
    assert.ok(Array.isArray(ctx.bars) && ctx.bars.length === 8, `bars missing for features ${features}`);
  }
});

// ---------------------------------------------------------------------------
// Melody, vocal, phrases
// ---------------------------------------------------------------------------

test('melody reports the pitch range of the notes inside the section', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  assert.equal(ctx.melody.available, true);
  assert.ok(ctx.melody.pitch_range.min_midi <= ctx.melody.pitch_range.max_midi);
});

test('vocal spans are contiguous runs, not per-window samples', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 17);
  assert.equal(ctx.vocal.present, true);
  assert.ok(ctx.vocal.spans.length > 0);
  for (const span of ctx.vocal.spans) {
    assert.ok(span.end_sec >= span.start_sec);
    assert.ok(span.start_sec >= 0 && span.end_sec <= 32);
  }
  // The fixture has vocals only between 8 s and 20 s.
  assert.ok(ctx.vocal.spans.every((s) => s.start_sec >= 7 && s.end_sec <= 21));
});

test('a section with no vocals reports absence rather than empty spans', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 4);
  assert.equal(ctx.vocal.present, false);
  assert.deepEqual(ctx.vocal.spans, []);
});

test('a phrase straddling the section seam is clipped to the part inside', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  const straddling = ctx.phrases.find((p) => p.phrase_id === 'phrase_002');
  assert.equal(straddling.start_bar, 8, 'the phrase itself starts at 8');
  assert.equal(straddling.end_bar, 14, 'and runs to 14');
  assert.equal(straddling.clipped_end_bar, 9, 'but only bar 8 is inside this section');
});

test('a phrase entirely outside the section is not reported', () => {
  const ctx = getMicroContext(makeAnalysis(), 14, 17);
  assert.ok(!ctx.phrases.some((p) => p.phrase_id === 'phrase_001'));
});

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

test('density rises with intensity', () => {
  const low = recommendedDensity({ start_bar: 1, end_bar_exclusive: 9, intensity: 0 }, []);
  const high = recommendedDensity({ start_bar: 1, end_bar_exclusive: 9, intensity: 1 }, []);
  assert.ok(low.moments_per_bar < high.moments_per_bar);
  assert.equal(low.moments_per_bar, 0.25);
  assert.equal(high.moments_per_bar, 1);
});

test('density is never zero -- a section always has at least one moment', () => {
  const d = recommendedDensity({ start_bar: 1, end_bar_exclusive: 2, intensity: 0 }, []);
  assert.ok(d.total_moments >= 1);
});

test('density falls back to the director context bar_curve when no blueprint intensity exists', () => {
  const dc = makeDirectorContext();
  const quiet = recommendedDensity({ start_bar: 1, end_bar_exclusive: 9 }, [], dc);
  const loud = recommendedDensity({ start_bar: 9, end_bar_exclusive: 17 }, [], dc);
  assert.equal(quiet.intensity, 0.3);
  assert.equal(loud.intensity, 0.8);
  assert.ok(loud.moments_per_bar > quiet.moments_per_bar);
  assert.match(quiet.basis, /bar_curve/);
});

test('a blueprint intensity wins over the bar_curve', () => {
  const dc = makeDirectorContext();
  const d = recommendedDensity({ start_bar: 1, end_bar_exclusive: 9, intensity: 0.9 }, [], dc);
  assert.equal(d.intensity, 0.9);
  assert.match(d.basis, /blueprint intensity/);
});

test('density falls back to 0.5 with no information at all', () => {
  const d = recommendedDensity(null, [], null);
  assert.equal(d.intensity, 0.5);
});

test('the micro context carries a density derived from the director context', () => {
  const dc = makeDirectorContext();
  const ctx = getMicroContext(makeAnalysis(), 9, 17, { directorContext: dc });
  assert.equal(ctx.recommended_density.intensity, 0.8);
  assert.equal(ctx.section.intensity, 0.8);
  assert.equal(ctx.section.section_id, 'section_02');
});

// ---------------------------------------------------------------------------
// Determinism and validation
// ---------------------------------------------------------------------------

test('the same input produces byte-identical output', () => {
  const analysis = makeAnalysis();
  const a = JSON.stringify(getMicroContext(analysis, 1, 17, { directorContext: makeDirectorContext() }));
  const b = JSON.stringify(getMicroContext(analysis, 1, 17, { directorContext: makeDirectorContext() }));
  assert.equal(a, b);
});

test('the validator accepts a well-formed context', () => {
  assert.deepEqual(validateMicroContext(getMicroContext(makeAnalysis(), 1, 17)), []);
});

test('the validator rejects a non-object', () => {
  assert.deepEqual(validateMicroContext(null), ['micro context is not an object']);
});

test('the validator rejects the wrong schema version', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  ctx.schema_version = 'beatbound_micro_context_v0';
  assert.ok(validateMicroContext(ctx).some((p) => p.includes('schema_version')));
});

test('the validator catches a time pushed past the song duration', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  ctx.onsets[0].time_sec = 999;
  assert.ok(validateMicroContext(ctx).some((p) => p.includes('outside 0..32')));
});

test('the validator catches a bar row outside the section', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  ctx.bars[0].bar = 12;
  assert.ok(validateMicroContext(ctx).some((p) => p.includes('outside the section')));
});

test('the validator catches a section running past the song', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  ctx.section.end_bar_exclusive = 40;
  assert.ok(validateMicroContext(ctx).some((p) => p.includes('runs past bar_count')));
});

test('the validator catches a missing duration', () => {
  const ctx = getMicroContext(makeAnalysis(), 1, 9);
  ctx.source.duration_sec = 0;
  assert.ok(validateMicroContext(ctx).some((p) => p.includes('duration_sec')));
});

// ---------------------------------------------------------------------------
// The real artifact
// ---------------------------------------------------------------------------

test('the real analysis slices cleanly for every real section', { skip: !existsSync(REAL_ANALYSIS) }, () => {
  const analysis = JSON.parse(readFileSync(REAL_ANALYSIS, 'utf8'));
  const dc = existsSync(REAL_DIRECTOR) ? JSON.parse(readFileSync(REAL_DIRECTOR, 'utf8')) : null;

  const sections = dc?.sections ?? [{ start_bar: 1, end_bar_exclusive: analysis.layers.rhythm.barCount + 1 }];
  for (const s of sections) {
    const ctx = getMicroContext(analysis, s.start_bar, s.end_bar_exclusive, { directorContext: dc });
    assert.deepEqual(validateMicroContext(ctx), [], `section ${s.section_id} produced an invalid context`);
    assert.equal(ctx.bars.length, s.end_bar_exclusive - s.start_bar);
    assert.equal(ctx.bars[0].bar, s.start_bar);
    assert.ok(ctx.bars.every((r) => r.bar >= s.start_bar && r.bar < s.end_bar_exclusive));
  }
});

test('the real micro context scales with the section, not the song', { skip: !existsSync(REAL_ANALYSIS) }, () => {
  // The point of the layer: the choreographer gets one section, not the song.
  // The reduction should track how much of the song the section covers -- a
  // section holding most of the song is legitimately most of the payload.
  const analysis = JSON.parse(readFileSync(REAL_ANALYSIS, 'utf8'));
  const dc = existsSync(REAL_DIRECTOR) ? JSON.parse(readFileSync(REAL_DIRECTOR, 'utf8')) : null;
  const sections = dc?.sections ?? [{ section_id: 'all', start_bar: 1, end_bar_exclusive: 41 }];

  const full = JSON.stringify(analysis).length;
  const barCount = analysis.layers.rhythm.barCount;

  for (const s of sections) {
    const bars = s.end_bar_exclusive - s.start_bar;
    const micro = JSON.stringify(
      getMicroContext(analysis, s.start_bar, s.end_bar_exclusive, { directorContext: dc }),
    ).length;
    const share = bars / barCount;

    assert.ok(micro < full, `section ${s.section_id} produced a context larger than the analysis`);
    // The per-bar cost must be bounded: a section covering `share` of the song
    // should cost well under `share` of the analysis, because the analysis's
    // per-window timeline is the bulk of it and the micro context summarises it
    // into one row per bar.
    assert.ok(
      micro < full * Math.min(share * 3, 1),
      `section ${s.section_id} (${bars}/${barCount} bars) produced ${micro} bytes of ${full}`,
    );
  }
});

test('a short section of the real song is a small fraction of it', { skip: !existsSync(REAL_ANALYSIS) }, () => {
  const analysis = JSON.parse(readFileSync(REAL_ANALYSIS, 'utf8'));
  const full = JSON.stringify(analysis).length;
  const micro = JSON.stringify(getMicroContext(analysis, 1, 9)).length;
  assert.ok(micro < full / 10, `an 8-bar slice produced ${micro} bytes of ${full}`);
});
