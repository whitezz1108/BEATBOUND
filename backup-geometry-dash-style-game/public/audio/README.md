# BeatBound — See Tình Audio Files

BeatBound uses the **actual "See Tình" recordings**. This sandbox could not download
them directly (YouTube blocks datacenter IPs), so the two required audio files must
be supplied locally. Until they exist, the game runs in a clearly-labeled
**TEST MODE** (metronome click track synced to the beatmap — *not* the real song).

## Required files (place them in this folder)

| File                          | Used for                        | Needs to be ≥ |
| ----------------------------- | ------------------------------- | ------------- |
| `seetinh-original.mp3`        | Section 1–3 (original, 128 BPM) | ~62 seconds   |
| `seetinh-remix.mp3`           | Section 4 (faster remix, 140 BPM)| ~46 seconds  |

Exact names, lowercase, `.mp3` (M4A/OGG/WAV also work with matching extension —
or edit the paths in `src/game/levels/seetinh.ts`).

## How to download them locally (from your own machine)

Using [yt-dlp](https://github.com/yt-dlp/yt-dlp) with your own browser's cookies:

```bash
# Original / slower version
yt-dlp --cookies-from-browser chrome -x --audio-format mp3 \
  --audio-quality 0 -o "seetinh-original.mp3" "https://youtu.be/AKChFg7ku2A"

# Faster remix version
yt-dlp --cookies-from-browser chrome -x --audio-format mp3 \
  --audio-quality 0 -o "seetinh-remix.mp3" "https://www.youtube.com/watch?v=bWOA5AxwfsM"
```

Then copy both files into this `public/audio/` directory and reload the game —
the menu will switch from "TEST MODE" to "AUDIO READY" automatically.

## If your files differ in tempo / length

All timing is derived from constants at the top of `src/game/levels/seetinh.ts`:

- `BPM_ORIGINAL` / `BPM_REMIX` — tempos of your two files
- `ORIGINAL_DURATION` / `REMIX_DURATION` — how much of each file the level uses
- `AUDIO_OFFSET_ORIGINAL` — trim silence at the start of a file

Tune those and the whole level re-aligns to the music automatically.
