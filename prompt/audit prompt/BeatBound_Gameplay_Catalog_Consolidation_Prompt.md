# BeatBound — Gameplay Capability Catalog Consolidation Prompt

你现在已经拥有以下只读审计产物：

```text
ARENA_PATTERN_CATALOG.json
RUNNER_CAPABILITY_CATALOG.json
VERTICAL_CAPABILITY_CATALOG.json
RADIAL_CAPABILITY_CATALOG.json
TRANSITION_CAPABILITY_CATALOG.json
```

以及对应 Markdown audit。

本任务不是重新审计代码，也不是修改 gameplay。

唯一任务：

> **把 5 份 catalog 规范化、合并成一个供 Gameplay Director LLM 使用的 `BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json`，同时绝不丢失 mode-specific 信息。**

## 强约束

- 不修改 gameplay code
- 不修改原始 catalog
- 不执行 git
- 不“修正”各 audit 中的事实
- 不把不同模式参数强行扁平化成错误的统一字段
- 冲突时保留 mode-specific 原值，并在 `integration_warnings` 标记
- UNKNOWN 保持 UNKNOWN

## 输出

```text
BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json
BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.md
```

## 推荐结构

```json
{
  "schema_version": "beatbound_gameplay_capabilities_v1",

  "modes": {
    "ARENA": {},
    "RUNNER": {},
    "VERTICAL": {},
    "RADIAL": {}
  },

  "transitions": {},

  "global_contract": {
    "timing_coordinate_system": {},
    "difficulty_model": {},
    "intensity_model": {},
    "health_score_combo": {},
    "mode_switching": {}
  },

  "director_view": {
    "mode_selection_affinity": {},
    "primary_gameplay_vocabulary": {},
    "safe_generation_summary": {}
  },

  "integration_warnings": []
}
```

## 必须保留

每个 mode 的：

```text
player/input model
runtime primitives
pattern/template library
parameters
units
timing
difficulty/intensity mapping
collision/judgement
safe generation bounds
known risks
music affinity
minimal valid examples
```

Transition catalog 必须完整保留：

```text
mode matrix
breather
state handoff
input handoff
cleanup
BeatClock continuity
safe transition bounds
```

## Director View

额外生成一个高度压缩的 `director_view`，供 LLM 快速选模式。

不要创造玩法，只从四份 catalog 提炼，例如：

```json
{
  "ARENA": {
    "best_for": ["layered spatial pressure", "continuous melody-controlled motion"],
    "avoid_when": ["..."],
    "timing_resolution": "...",
    "safety_summary": "..."
  }
}
```

同理 Runner / Vertical / Radial。

## Schema

为最终 catalog 写 JSON Schema 并校验 0 errors。

## 最终报告

```text
DONE
- source catalogs loaded: 5/5
- merged catalog generated
- schema validation: PASS/FAIL
- integration warnings: X
- no source catalog modified
- no gameplay code modified
- no git operations performed
```
