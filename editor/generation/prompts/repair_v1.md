# BeatBound Blueprint Repair — v1

You previously produced a level blueprint. A deterministic validator checked it
against the song and **rejected it**. Your job is to fix exactly what is wrong
and change nothing else.

You are not being asked to rewrite the plan. You are being asked to repair it.
The parts of your blueprint that passed validation were good; a repair that
rewrites them discards work and may introduce new problems.

---

## 1. What you are given

- **The original blueprint** you produced.
- **The validation errors** — each one names the field, says what is wrong, and
  usually says what the music actually contains.
- **The director context** — the same song analysis you had before. It is the
  authority. If an error says a bar has no `energy_drop` anchor, the context is
  what proves it.
- **The gameplay context** — the same capability list you had before.

---

## 2. The rules

**Fix only what is reported.** Every error names a location —
`sections[2]`, `sync_points[4]`, `song.barCount`. Change those. Leave everything
else byte-identical, including the `rationale` strings you already wrote.

**The music is the authority, not your memory of it.** If an error says a bar
does not exist or an anchor is not there, re-read the director context and use
what it actually contains. Do not argue with the validator and do not re-emit
the same value hoping it passes.

**Never invent.** Do not add pattern ids, modes, anchor types, or scene effects
that the gameplay context does not list. If the fix you want needs something
that does not exist, choose the closest thing that does and record the
substitution in `notes`.

**If a section's range was wrong, the tiling still has to hold.** Sections must
cover the song exactly: the first starts at bar 1, each `start_bar` equals the
previous `end_bar_exclusive`, and the last ends at `bar_count + 1`. Fixing one
range often means adjusting its neighbour.

**If a mode change is impossible, do not force it.** A mode change needs at
least `{{BREATHER_BEATS}}` beats of room (about `{{BREATHER_BARS}}` bars at
{{BEATS_PER_BAR}} beats per bar). If a section is too short, either keep the
same mode across it or extend the section — do not emit a mode change that
cannot happen.

---

## 3. What to produce

The **complete corrected blueprint** as a single JSON object, matching the
`beatbound_level_blueprint_v2` schema. Emit **only** the JSON — no prose, no code
fence, no explanation of what you changed.

Append one line to `notes` for each fix, in this shape:

```
"repaired: sections[2].end_bar_exclusive 60 -> 41 (the song has 40 bars)"
```

so a human can see what changed and why without diffing.

---

## 4. The errors

{{ERRORS}}

## 5. The blueprint you produced

{{BLUEPRINT}}

## 6. The song

{{DIRECTOR_CONTEXT}}

## 7. The gameplay you may use

{{GAMEPLAY_CONTEXT}}

Now produce the corrected blueprint JSON.
