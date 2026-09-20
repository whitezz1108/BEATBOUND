# EDITOR — Audio Understanding V2 — Checkpoint Report

**Date:** 2026-09-20
**Status:** PAUSED SAFELY (paused mid-implementation, workspace consistent)
**Branch:** `evan-branch`
**Workspace:** `C:\Users\44977\Desktop\BB`

---

## 0. Stop summary

The task was stopped after **Step 1 (Audit)** and **Step 2 (schema/foundation
scaffolding)** of the prompt's implementation order. No analyzer algorithm was
written yet, so there is no half-finished code path: every file on disk compiles
and imports cleanly.

Nothing was reverted, staged, cleaned or committed. All installed dependencies,
downloaded model weights and generated artifacts are left in place.

---

## A. Existing system audit

### What the old analyzer currently does

`editor/music-analysis/analyze_music.py` (VERSION `1.0.0`, ~250 lines, single
script, librosa-only) produces `editor/output/music_analysis.json`:

| Stage | Implementation |
| --- | --- |
| Load | `librosa.load(sr=22050, mono=True)` |
| Tempo | `librosa.beat.beat_track` (optional `--bpm` override) |
| Grid | **Constant-tempo** beat/bar grid anchored at audio time 0, because the runtime uses `ConstantTempoMap` — analysis bars == runtime bars |
| Features | RMS, `onset_strength`, `onset_detect`, percentile-normalised per bar |
| Per-bar | `rmsMean`, `rmsPeak`, `onsetCount`, `beatStrength`, `novelty`, `energy`, `rhythmDensity` |
| Sections | Novelty peaks (`mean + 0.55·std`) snapped to the bar grid, merged below `MIN_SECTION_BARS=8`; labels are `section_01…` with **no semantic labels** |
| Extras | `energyChanges` (bar-to-bar rises/falls ≥ 0.18), downsampled `waveformEnvelope` + `rmsCurve` for UI drawing |
| Report | Human-readable parameter record printed to stdout and parsed by the server |

Determinism: fixed parameters, no RNG.

### What legacy behaviour is being preserved

The V2 work is additive. These contracts were identified as load-bearing and
must not change:

1. **`music_analysis.json` (v1 shape) is still written** — the editor server
   (`restoreState()`, `/api/analyze`, `/api/analysis`), the level director and
   the UI all read it.
2. **Fields consumed by the generator** — `music.bars[]` (`energy`,
   `rhythmDensity`, `novelty`, `bar`), `music.sections[]` (`id`, `startBar`,
   `endBar`), `music.tempo.timeSignature[0]`, `music.tempo.bpm`,
   `music.song.id`, `music.song.sourceHash`. Confirmed by grep in
   `editor/generator/levelDirector.js` (lines 37–48, 56–63, 90–137, 221, 269–277).
3. **Fields consumed by the UI** — `waveformEnvelope`, `onsets`, `bars`,
   `sections`, `tempo`, `song.durationSec`
   (`editor/ui/editor.js` lines 368, 410–435, 582–620, 664–687).
4. **`sourceHash`** propagates into `level.json → editor.analysisSource`
   (via `levelDirector.js:277` → `levelCompiler.js:25`), so it must stay
   byte-stable for a given file.
5. **CLI contract** — `analyze_music.py <input> <output> [--bpm N] [--timesig N D]`
   is invoked as a subprocess by `server.mjs:147` (`runAnalysis`), which parses
   **stdout as JSON** (`JSON.parse(out.trim())`).
6. **`editor/schemas/music-analysis.schema.json`** describes the v1 output and
   has `additionalProperties: false` at the root — V2 output must therefore live
   in a *separate* file rather than being grafted onto this one.

### What has already been changed for V2

Only the foundation package. No behaviour change to any existing code path —
`analyze_music.py` is untouched and still the script the editor server runs.

---

## B. Audio pipeline progress

| Component | Status | Notes |
| --- | --- | --- |
| **librosa** | installed / configured / validated | `1.0.0` present. **librosa 1.0 removed the top-level re-exports** (`librosa.beat_track`, `librosa.onset_strength`, … are gone) — must import `librosa.beat`, `librosa.onset` submodules. Also `librosa.display` needs `matplotlib`, which is **not** installed: never import it. Validated: `beat_track`, `onset_strength`, `onset_detect`, `feature.*`, `segment.*`, `util.nnls`, `effects.hpss`, `beat.plp`, `pyin`, `tempogram` all callable. |
| **Stem separation / Demucs** | installed / configured / **validated** | `demucs 4.1.0` + `torch 2.14.0+cpu`. HTDemucs weights downloaded (81 MB). Real run on the 147 s mp3: **45.1 s**, output `(4, 2, 6488598)` for `drums/bass/other/vocals` @ 44.1 kHz. Adapter/fallback code **not started**. |
| **Basic Pitch** | installed / configured / **validated** | `basic-pitch 0.4.0` running the **ONNX** backend (`onnxruntime 1.30.0`) — TensorFlow is *not* installed and is not needed. Real run on the 147 s mp3: **1.2 s**, **424 notes**, MIDI range 36–73. Adapter/fallback code **not started**. |
| **Essentia** | not started (deliberately) | No Windows / py3.12 wheel — pip only offers the `essentia-2.1b5.tar.gz` source distribution, which would need a full C++ toolchain. Per §2.D of the prompt it is optional; plan is a no-op backend reporting `available: false`. |
| **Feature aggregation** | not started | |
| **Rhythm / beat analysis** | not started | v1 logic understood; V2 module not written. |
| **Energy analysis** | not started | v1 `percentile_norm` helper already ported into `beatbound_audio/util.py`. |
| **Melody / pitch analysis** | not started | Backend proven available; the note→phrase descriptor layer is unwritten. |
| **Tonal / chroma analysis** | not started | API signatures verified (`chroma_cqt`, `spectral_contrast`, `mfcc`, `tonnetz`). |
| **Section / structure analysis** | not started | `segment.recurrence_matrix` + `segment.agglomerative` verified callable; v1 novelty segmentation is the fallback. |
| **Normalization** | **partially implemented** | `percentile_norm`, `unit_norm`, `smooth`, `fnum` (NaN/inf → `null`, never faked), `clamp01` implemented and smoke-tested in `util.py`. |
| **Caching** | not started | Cache design decided: `editor/cache/audio/<audioHash>/`, keyed on audio hash + analyzer version + model version + settings signature. `hash_file` / `hash_strings` helpers implemented. |
| **Fallback behaviour** | not started | Design decided: every optional backend is an adapter returning `None` + a warning on failure; analysis must always produce a complete JSON with `null`/`unavailable` fields. |
| **Output schema / `music_analysis_v2.json`** | not started | Blocked on a decision — see *CURRENT BLOCKER*. |
| **CLI / editor integration** | not started | v1 CLI preserved unchanged. |
| **Tests** | not started | `pytest` and `jsonschema` are **not installed**; the prompt requires both (schema test + determinism/fallback/short-audio/silence tests). |

### Files created so far

```
editor/music-analysis/beatbound_audio/__init__.py   (new, 671 B)
editor/music-analysis/beatbound_audio/version.py    (new, 1.0 KB)
editor/music-analysis/beatbound_audio/util.py       (new, 5.8 KB)
editor/music-analysis/beatbound_audio/__pycache__/  (new, generated)
```

`__init__.py` is a docstring plus `__all__` only. `version.py` holds the
analyzer / schema / model version constants and the cache settings signature.
`util.py` holds deterministic numeric helpers (`percentile_norm`, `unit_norm`,
`smooth`, `downsample`, `downsample_rows`, `fnum`, `flist`, `ilist`, `clamp01`,
`hash_bytes`, `hash_file`, `hash_strings`, `to_mono`, `peak`, `is_silent`,
`slugify`).

Smoke test result — **all passing**:

```
package import OK
ANALYZER_VERSION 2.0.0 SCHEMA 2
percentile_norm [0. 0.01 0.0233 0.0367 0.05 1.]
unit_norm [0. 0.5 1.]
smooth [0. 0.333 0.333 0.333 0.]
fnum(nan) None  fnum(1.23456789) 1.234568
is_silent(zeros) True   is_silent(noise) False
slugify dance_fruits_musicsteve_void_-_toosie_slide_sped_up
PY_COMPILE OK (all 3 files)
```

---

## C. Environment state

### Python

| Item | Value |
| --- | --- |
| Version | **Python 3.12.10** |
| Interpreter | `C:\Users\44977\AppData\Local\Programs\Python\Python312\python.exe` |
| Virtual environment | **NONE** — global user install. `VIRTUAL_ENV` is unset. |
| Package manager | `pip 25.0.1` |
| Shell used by editor server | `spawn('python', …)` — resolves via PATH to the same interpreter |

### ffmpeg

**Available** — `ffmpeg version 8.1.2-full_build-www.gyan.dev` on PATH. Demucs
and Basic Pitch can both decode mp3 without extra setup.

### Dependencies installed during this task

These were installed into the **global** site-packages (no venv exists in this
project):

**Core (pre-existing, untouched):** `librosa 1.0.0`, `numpy 2.5.3`,
`scipy 1.18.1`, `soundfile 0.14.0`, `numba 0.67.0`, `scikit-learn 1.9.1`,
`llvmlite 0.49.0`, `joblib 1.6.0`, `lazy-loader 0.5`, `pooch 1.9.0`, `soxr 1.1.0`

**Added for stem separation:**
`demucs 4.1.0`, `torch 2.14.0` (**CPU-only** build, 124 MB wheel),
`einops 0.8.2`, `julius 0.2.8`, `sphn 0.2.1`, `lameenc 1.8.4`,
`huggingface_hub 1.32.0`, `safetensors 0.8.0`, `sympy 1.14.0`,
`networkx 3.6.1`, `filelock 4.0.1`, `fsspec 2026.9.0`, `PyYAML 6.0.3`,
`Jinja2 3.1.6`, `MarkupSafe 3.0.3`, `httpx 0.28.1`, `httpcore 1.0.9`,
`h11 0.16.0`, `anyio 4.15.1`, `click 8.5.0`, `colorama 0.4.6`, `tqdm 4.70.1`

**Added for melody transcription:**
`onnxruntime 1.30.0`, `basic-pitch 0.4.0`, `resampy 0.4.3`,
`pretty_midi 0.2.11.post0`, `mir_eval 0.8.2`, `mido 1.3.3`,
`importlib_resources 7.1.0`, `six 1.17.0`

**Added as a build prerequisite:** `setuptools 84.0.0`, `wheel`

### Dependency files

**No dependency file was created or modified yet.**
`editor/music-analysis/requirements.txt` still contains only:

```
librosa>=0.10.2
numpy>=1.26
```

The plan (per §0.1 of the prompt) is to add `editor/requirements-audio.txt`
for the optional heavy backends, leaving the existing `requirements.txt` as the
lightweight librosa-only entry point so the runtime's dependency boundary is
untouched. **Not done yet.**

### PyTorch status

`torch 2.14.0+cpu` — installed, importable, CPU-only (no CUDA on this machine;
`torch.set_num_threads(4)` used for benchmarking). `torchaudio` is **not**
installed and is not required by Demucs 4.1 for this usage.

### Demucs status

Installed and working. `get_model('htdemucs')` loads in **1.8 s** from cache
(19.3 s on first download). Sources: `['drums', 'bass', 'other', 'vocals']`,
native rate 44100 Hz, 2 channels.

### Basic Pitch status

Installed and working, running the **ONNX** path. `basic_pitch` prints three
harmless import warnings on load (`Coremltools is not installed`,
`tflite-runtime is not installed`, `Tensorflow is not installed`) — all three
are expected on Windows and do not prevent ONNX inference.

### Model weights / large caches

| Artifact | Location | Size |
| --- | --- | --- |
| HTDemucs weights | `C:\Users\44977\.cache\huggingface\hub\models--adefossez--HTDemucs` | 81 MB |
| Basic Pitch models | `C:\Users\44977\AppData\Local\Programs\Python\Python312\Lib\site-packages\basic_pitch\saved_models\icassp_2022\` | ~2.3 MB (`nmp.onnx` 230 KB is the one used) |
| Torch wheel | installed into site-packages | ~124 MB on disk |

### Dependency / version conflicts discovered

1. **`resampy` vs `pkg_resources`** — `basic-pitch` pins `resampy<0.4.3`, but
   `resampy 0.4.2` imports `pkg_resources`, which **setuptools 84.0.0 no longer
   ships**. This made `import basic_pitch` fail with
   `ModuleNotFoundError: No module named 'pkg_resources'`. **Resolved** by
   installing `resampy==0.4.3` (drops the `pkg_resources` import; verified
   `resampy.resample(y, 22050, 44100)` works). This is an intentional
   deviation from basic-pitch's pin and must be recorded in the dependency file.
2. **`basic-pitch` wants TensorFlow on py≥3.11 Windows.** Its metadata declares
   `tensorflow<2.15.1,>=2.4.1; platform_system != "Darwin" and python_version >= "3.11"`,
   and `tensorflow<2.15.1` has **no py3.12 wheel** — a plain
   `pip install basic-pitch` fails with
   `BackendUnavailable: Cannot import 'setuptools.build_meta'` while trying to
   build `numpy<1.24`. **Resolved** by installing with
   `pip install --no-deps basic-pitch` and adding only the pure-python runtime
   deps; the ONNX backend is selected automatically because TF/CoreML/TFLite are
   absent. This install recipe must be documented or it will not reproduce.
3. **`numpy 2.5.3` is much newer than basic-pitch's `numpy>=1.18` floor and
   librosa 1.0's expectations** — no breakage observed in the validation runs,
   but it is a risk area for the ONNX/numba paths.
4. **librosa 1.0 API break** — see the librosa row in section B.
5. **`pip`/`rich` Unicode crash on this console** — `pip install` output
   containing emoji raises `UnicodeEncodeError: 'gbk' codec can't encode
   character '\U0001f389'`. Workaround used throughout: set
   `PYTHONIOENCODING=utf-8`. Worth putting in the editor README.
6. **HuggingFace symlink warning** on Windows (no Developer Mode) — cosmetic
   only; silenced with `HF_HUB_DISABLE_SYMLINKS_WARNING=1`.

---

## D. Validation state

### Test audio files used

| File | Path | Duration | Role |
| --- | --- | --- | --- |
| Real song (mp3, 44.1 kHz stereo) | `beatbound_library_v1/audio/editor/dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3` | 147.13 s | Primary validation for both ML backends |
| Synthetic test song (wav) | `beatbound_library_v1/audio/editor/test_song.wav` | 128.0 s | librosa + Basic Pitch smoke test |
| Synthetic silence / near-silence / 5 s clips | generated in-memory (`np.zeros`, `1e-5` noise, 5 s noise) | — | librosa edge-case probe |

### Commands already run

```bash
# environment probes
python --version
python -c "import librosa, numpy; ..."
python -m pip list / freeze
ffmpeg -version

# installs (see section C for the exact recipes)
python -m pip install demucs
python -m pip install onnxruntime
python -m pip install --no-deps basic-pitch
python -m pip install "resampy==0.4.3" pretty_midi mir_eval

# validation
python -c "from demucs.pretrained import get_model; ..."          # model load
python -c "apply_model(...)"                                       # 20 s + full-length
python -c "from basic_pitch.inference import Model, predict; ..."  # ONNX transcribe
python -m py_compile editor/music-analysis/beatbound_audio/*.py
```

### Successful tests

**1. Demucs on the real 147 s mp3 — PASS**

```
[demucs] model load      :    1.8s  sources=['drums', 'bass', 'other', 'vocals'] sr=44100
[demucs] audio           : 147.1s @ 44100Hz
[demucs] separate        :   45.1s  out=(4, 2, 6488598)
```

**2. Basic Pitch (ONNX) on the real 147 s mp3 — PASS**

```
[pitch ] model load      :    0.1s  backend=MODEL_TYPES.ONNX
[pitch ] transcribe      :    1.2s  notes=424
[pitch ] midi range      : 36..73  (span 37 semitones)
```

**3. Basic Pitch on the synthetic `test_song.wav` — PASS (backend), 0 notes**
Expected: the synthetic click track has no pitched content, so 0 note events is
the correct answer and confirms the analyzer does not invent notes.

**4. librosa edge cases — PASS**

```
silence        bpm= 0.0                  onset_env max 0.0    onsets 0
near-silence   bpm= 135.99917763157896   onset_env max 2.99   onsets 37
short5 (5 s)   bpm= 135.99917763157896   onset_env max 4.46   onsets 4
```

Note the **silence result `bpm = 0.0`** — the V2 analyzer must map this to
`null`, not to a fake 0 BPM, and must not emit events for it.

**5. `beatbound_audio` package import + helper smoke test — PASS** (output in section B)

**6. `py_compile` on all three new files — PASS**

**7. librosa 1.0 API surface probe — PASS** (all required functions present and
callable with the signatures V2 will use)

### Failed tests

None that remain unresolved. The two install-time failures
(`pkg_resources` / `BackendUnavailable`) are recorded in section C with their
fixes and are both resolved.

### Current error messages worth preserving

```
ModuleNotFoundError: No module named 'pkg_resources'
  -> resampy 0.4.2 + setuptools 84.0.0. Fix: resampy==0.4.3

BackendUnavailable: Cannot import 'setuptools.build_meta'
  -> pip building numpy<1.24 for tensorflow<2.15.1 on py3.12. Fix: --no-deps

UnicodeEncodeError: 'gbk' codec can't encode character '\U0001f389'
  -> pip's rich output on this console. Fix: PYTHONIOENCODING=utf-8

ValueError: not enough values to unpack (expected 3, got 2)
  -> apply_model needs (batch, channels, samples); mono (samples,) is rejected.
     Fix: load with mono=False or unsqueeze the channel axis.
```

### Known Windows / path / environment issues

- No venv — installs land in the global user site-packages. Any future venv
  creation will need these 40+ packages reinstalled, or a requirements file
  (not yet written).
- `spawn('python', …)` in `server.mjs` depends on PATH resolution; unchanged.
- `analyze_music.py:190` uses `path.split("/")[-1].split("\\")[-1]` for the song
  id — a Windows-aware but fragile idiom. V2 should use `os.path.basename`.
- No `editor/cache/` directory exists yet.
- The `_ = librosa.display` path is a trap: `matplotlib` is not installed, so
  any accidental `import librosa.display` raises `ModuleNotFoundError`.

### Next test that should be run

A **schema-shape test** on a hand-written `music_analysis_v2.json` fixture:
assert `schemaVersion`, `source`, `global`, `timeline`, `sections`, `events`,
`analysisMeta` are present and correctly typed — runnable **without** any ML
backend, so it can be written before the aggregator exists.

After that: a **fallback test** that forces `stem_separator` and `melody` to
raise and asserts the analysis still completes with `available: false`.

---

## E. Scope protection

### Files modified by this task

```
NEW   editor/music-analysis/beatbound_audio/__init__.py
NEW   editor/music-analysis/beatbound_audio/version.py
NEW   editor/music-analysis/beatbound_audio/util.py
NEW   editor/music-analysis/beatbound_audio/__pycache__/   (generated)
```

That is the complete list. No existing file was edited.

### Was anything outside the Editor/audio-analysis boundary touched?

**NO.** Verified by `git status --short`:

- Under `editor/`, the only entries are
  `M editor/patterns/annotations.json` (pre-existing, see below) and
  `?? editor/music-analysis/beatbound_audio/` (mine).
- `src/`, `beatbound_library_v1/`, `tools/`, `package.json`, `README.md` all
  show the **same** entries that were present before this session started.

### Pre-existing modifications observed (NOT mine)

Recorded at the start of the session, before any write, and unchanged since:

**Parallel RUNNER work:**
`src/modes/runner/RunnerMode.ts`, `RunnerPlayer.ts`, `RunnerDebug.ts`,
`src/mechanics/runner/{Gap,Spike,Platform,RunnerCourse}Mechanic.ts`,
`src/mechanics/runner/{courseAudit,courseSchedule,courseWorld,motion,runnerPhysics,runnerPlanner,terrainProbe,trajectory,traversalSim}.ts`,
`src/mechanics/runner/index.ts`, plus ~12 new `runner_test_*.level.json` and
`runner_showcase.level.json`, and ~150 `tools/.tmp-*.ts` / `tools/tmp-*.ts`
scratch files.

**Parallel ARENA work:**
`src/mechanics/arena/{Chain,Projectile,RadialBurst,RotatingFan,WaveSweep}Mechanic.ts`,
`src/game/BeatBoundGame.ts`, `src/core/{Input,LevelLoader,MechanicRegistry,capabilities,types}.ts`,
`src/core/controls.ts`, `src/core/fairness.ts`, `src/modes/vertical/VerticalMode.ts`,
`src/tuning.ts`, `tools/{level-report,runner-check,sync-test,fairness-check,course-dump}.ts`,
`package.json`, `README.md`, and the `beatbound_library_v1/*.level.json` /
`*.index.json` / `*.mvp.json` files.

**Pre-existing inside `editor/`:**
`editor/patterns/annotations.json` — 610 insertions / 71 deletions
(reformatting plus added pattern annotations such as `RP25` under
`recoveryByMode.RUNNER`). **This is not my work and I did not touch it.**

### Conflict assessment

- **Protected ARENA/RUNNER files touched by this task: NONE.**
- **Shared files touched by this task: NONE.**
- **Shared file risk to watch:** `package.json` (for a future
  `editor:analyze` npm script) is already modified by the parallel work.
  Per the prompt's §0.1 rule 4, if an npm script is added it must be a minimal,
  local, mergeable edit with the line-level impact called out. Preferred
  alternative: add no npm script at all and keep the Python CLI as the entry
  point, leaving `package.json` completely alone.
- **`editor/patterns/annotations.json` is a live parallel-edit target inside
  `editor/`.** V2 does not need it, but any future editor work must not
  reformat it.

### Git operations performed

**None.** No `reset`, `restore`, `checkout -- .`, `clean`, `stash`, `merge`,
`rebase`, `commit`, `push`, or repository-wide formatter/autofix was run.

### Housekeeping performed

One temporary probe directory, `.probe/` (a pip download scratch dir used to
inspect the `basic-pitch` wheel contents), was created inside the repo root and
then **removed**. It was untracked and contained no source. Everything else —
installed packages, HF model cache, `editor/output/` artifacts, all pre-existing
modifications — is left exactly in place.

---

## CURRENT BLOCKER

**A design decision is needed before the schema can be written.**

The prompt's §4 mandates a `music_analysis_v2.json` whose root is
`{schemaVersion, source, global, timeline, sections, events, analysisMeta}`.
But the existing `editor/schemas/music-analysis.schema.json` is the v1 shape
(`{version, song, tempo, beats, bars, onsets, energyChanges, sections,
waveformEnvelope, …}`) with `additionalProperties: false` — and that v1 shape is
read by `editor/generator/levelDirector.js` and `editor/ui/editor.js`.

Two mutually exclusive options:

- **(a) Two files.** `analyze_music.py` keeps emitting the exact v1
  `music_analysis.json` for the editor/director, and a new
  `analyze_music_v2.py` emits `music_analysis_v2.json` alongside it. Maximum
  safety, zero risk to the parallel work, but the audio is decoded twice unless
  the two share a cached feature store.
- **(b) One file, adapter projection.** A single V2 run writes
  `music_analysis_v2.json`, and a `legacy_projection.py` adapter derives the v1
  object from it so `music_analysis.json` is still produced unchanged.

Option (b) is more in the spirit of §23 ("new analyzer → 兼容旧 editor") and
avoids double decoding, but it means the v1 output is now *derived*, so the
adapter needs a golden-file test proving the v1 projection is byte-comparable
on the fields the director consumes.

**This choice determines the whole module layout, so it should be settled before
any analyzer code is written.**

Two smaller open items, neither blocking:

- `pytest` and `jsonschema` are not installed and §20 requires tests. Install
  them into the same global environment (and record them), or hand-roll the
  checks.
- Whether to add `editor/requirements-audio.txt` (recommended by §0.1) versus
  extending the existing `requirements.txt` with the pinned `resampy==0.4.3`
  override.

---

## NEXT STEP

**Resolve the blocker above, then write the schema — no algorithm code.**

Concretely, in this order:

1. Decide **(a) two files** or **(b) one file + legacy projection adapter**.
2. Create `editor/schemas/music-analysis-v2.schema.json` describing the §4 root
   shape plus the §5–§13 sub-objects (`global`, `timeline.beats`,
   `timeline.energy`, `timeline.windows`, `sections`, `events`,
   `analysisMeta`), with `schemaVersion: 2` and `null` explicitly allowed for
   every not-estimated field.
3. Add a `music_analysis_v2.json` fixture under a new
   `editor/music-analysis/tests/fixtures/` and a schema-shape test that runs
   with **no ML backend present**.
4. Install `pytest` + `jsonschema`, and write
   `editor/requirements-audio.txt` pinning `resampy==0.4.3` with a comment
   explaining the override and the `--no-deps basic-pitch` recipe.
5. Only then start `preprocess.py` → `rhythm_analyzer.py` → `energy_analyzer.py`
   (Step 3 of the prompt's order).

**Do not** proceed to stems, melody, structure, aggregation, the Director,
Music Map, pattern generation, level generation, or any ARENA/RUNNER work until
the schema is settled and the editor's existing v1 workflow is proven still
green.

---

EDITOR AUDIO V2 PAUSED SAFELY

**WORKSPACE:**
`C:\Users\44977\Desktop\BB` (branch `evan-branch`)

**MODIFIED FILES:**
- `editor/music-analysis/beatbound_audio/__init__.py` (new)
- `editor/music-analysis/beatbound_audio/version.py` (new)
- `editor/music-analysis/beatbound_audio/util.py` (new)
- `editor/music-analysis/beatbound_audio/__pycache__/` (new, generated)

Nothing else. No existing file was edited; no file was deleted; no git
state-changing command was run. Pre-existing parallel modifications in `src/`,
`beatbound_library_v1/`, `tools/`, `package.json`, `README.md` and
`editor/patterns/annotations.json` were left untouched.

**AUDIO PIPELINE STATUS:**
- librosa — installed / configured / validated (1.0.0; note the top-level API break)
- stem separation / Demucs — installed / configured / **validated** (45.1 s for a 147 s song, 4 stems)
- Basic Pitch — installed / configured / **validated** (ONNX backend, 1.2 s, 424 notes)
- Essentia — not started; no Windows py3.12 wheel; planned as an unavailable-stub backend
- feature aggregation — not started
- rhythm / beat analysis — not started
- energy analysis — not started (only the `percentile_norm` helper is ported)
- melody / pitch analysis — not started (backend proven, descriptor layer unwritten)
- tonal / chroma analysis — not started (API verified)
- section / structure analysis — not started (API verified)
- normalization — **partially implemented** (`util.py`, smoke-tested)
- caching — not started (design fixed: `editor/cache/audio/<hash>/`)
- fallback behaviour — not started (design fixed: adapter returns `None` + warn, JSON always complete)
- output schema / `music_analysis_v2.json` — not started (**blocked**, see below)
- CLI / editor integration — not started; v1 CLI preserved untouched
- tests — not started (`pytest` + `jsonschema` not installed)

**PYTHON / ENVIRONMENT STATUS:**
Python 3.12.10 at
`C:\Users\44977\AppData\Local\Programs\Python\Python312\python.exe`.
**No virtual environment** — everything installed into global site-packages;
`VIRTUAL_ENV` unset. Package manager: `pip 25.0.1`. ffmpeg 8.1.2 present on
PATH. `torch 2.14.0+cpu` (CPU-only, no torchaudio). `demucs 4.1.0` working,
HTDemucs weights cached at `C:\Users\44977\.cache\huggingface\hub\` (81 MB).
`basic-pitch 0.4.0` working via `onnxruntime 1.30.0`; TF/CoreML/TFLite absent
and not needed. Also installed: `einops`, `julius`, `sphn`, `lameenc`,
`huggingface_hub`, `safetensors`, `sympy`, `networkx`, `resampy 0.4.3`,
`pretty_midi`, `mir_eval`, `mido`, `setuptools 84.0.0`. No dependency file
created or modified yet. Conflicts found and fixed: `resampy 0.4.2` needs the
removed `pkg_resources` (→ pin `0.4.3`); plain `pip install basic-pitch` fails
on py3.12 because `tensorflow<2.15.1` has no wheel (→ `--no-deps` + ONNX);
`pip`'s console output crashes on GBK (→ `PYTHONIOENCODING=utf-8`).

**LAST SUCCESSFUL TEST:**
Full-length backend validation on the real 147 s song — Demucs HTDemucs
separation `45.1 s → (4, 2, 6488598)` for drums/bass/other/vocals, and Basic
Pitch ONNX transcription `1.2 s → 424 notes`, MIDI range 36–73. Preceded by a
passing `py_compile` + import/smoke test of the new `beatbound_audio` package.

**CURRENT BLOCKER:**
No code blocker — a **design decision**: `music_analysis_v2.json` as a second
file next to an unchanged v1 `music_analysis.json` (option a), **or** a single
V2 file plus a legacy-projection adapter that regenerates the v1 object the
level director and editor UI already consume (option b, closer to the prompt's
§23 compatibility intent, but needs a golden-file test). The choice fixes the
module layout, so it must be made before any analyzer is written. Secondary:
`pytest` and `jsonschema` are not yet installed and §20 requires them.

**NEXT STEP:**
Decide (a) or (b), then create
`editor/schemas/music-analysis-v2.schema.json` for the §4 root shape
(`schemaVersion`, `source`, `global`, `timeline`, `sections`, `events`,
`analysisMeta`) with `null` allowed for every not-estimated field, add a
`music_analysis_v2.json` fixture plus a backend-free schema-shape test, install
`pytest`/`jsonschema`, and write `editor/requirements-audio.txt` pinning
`resampy==0.4.3`. Only after that, start `preprocess.py` →
`rhythm_analyzer.py` → `energy_analyzer.py`.
