# BeatBound TRANSITION — Complete Capability Audit Prompt

你现在的任务不是开发、不是重构、不是优化，也不是修 bug。

你的唯一任务是：

> **以当前 BeatBound 工作区实际代码为唯一事实来源，对 TRANSITION 模式做一次完整、只读、可追溯的运行时能力审计，并输出一份足够让“关卡设计 LLM + 确定性编译器 + 可玩性验证器”直接使用的权威能力手册。**

本审计的标准请对齐现有 ARENA capability audit 的严谨程度：不仅列出表面 pattern / JSON，而要沿着 **level JSON → loader → scheduler → registry / dispatcher → mechanic implementation → player/controller → collision/judgement → lifecycle → cleanup** 追到最终运行时行为。

---

## 0. 强约束

### 绝对不要

- 不修改任何 gameplay 代码
- 不修 bug
- 不重构
- 不增加 mechanic
- 不删除 mechanic
- 不修改 Editor
- 不修改其他游戏模式
- 不做任何 git 操作
- 不 commit / checkout / reset / merge / stash
- 不把 dead code / prototype / legacy helper 当成当前可用能力
- 不根据设计文档“脑补”当前代码支持什么
- 不因为某能力“应该有”就写成 available

本任务是：

> **READ-ONLY RUNTIME AUDIT**

如果发现：
- implemented but unreachable
- registered but never dispatched
- metadata-only
- dead code
- legacy compatibility alias
- parser 接受但 runtime 不消费
- runtime 消费但 JSON 层不可达

必须明确区分。

---

## 1. 最终输出

生成：

```text
TRANSITION_CAPABILITY_AUDIT.md
TRANSITION_CAPABILITY_CATALOG.json
```

Markdown 给人读；JSON 给后续 LLM / compiler / validator 使用。

最终回复只需简洁汇报：

```text
TRANSITION capability audit complete.

Generated:
- TRANSITION_CAPABILITY_AUDIT.md
- TRANSITION_CAPABILITY_CATALOG.json

Runtime-usable mechanic/pattern primitive count: X
Library/template pattern count: X
Unreachable/dead implementations found: X
Metadata-only / no-op fields found: X

No gameplay code modified.
No git operations performed.
```

---

## 2. 审计原则

每一项结论必须尽量给出：

```text
真实 identifier
真实 source file
真实 handler / class / registry key
真实 JSON 参数名
默认值
单位
clamp / 下限 / 上限
difficulty / intensity 是否会改写
warning / telegraph
active behavior
collision / judgement
cleanup
```

如果不能确认：

```text
UNKNOWN / NEEDS RUNTIME VERIFICATION
```

不要猜。

---


# 3. TRANSITION 审计目标

本报告不审计某个单独玩法，而是审计：

> **BeatBound 在 ARENA / RUNNER / VERTICAL / RADIAL 之间切换时，当前 runtime 真正支持什么、自动做了什么、没做什么，以及 LLM 未来如何安全安排模式切换。**

这部分直接决定整首歌能否自动编排成多模式关卡。

---

# 4. 所有 Mode 与真实标识

扫描并确认：

```text
ARENA
RUNNER
VERTICAL
RADIAL
```

以及任何：

```text
NONE
INTRO
TRANSITION
BREAK
```

真实 enum / mode ID。

输出：

```json
"modes": [...]
```

---

# 5. 完整切换调用链

从：

```text
section N mode
→ section N+1 mode
```

追踪：

```text
LevelLoader
PatternScheduler
ModeManager
current mode deactivate
mechanic cleanup
player cleanup
next mode activate
player reset
camera reset
input context
HUD
scoring
BeatClock
audio
next mechanic spawn
```

必须画真实 runtime call chain。

---

# 6. Breather / Quiet Window 专项

现有 ARENA 审计发现模式切换前存在：

```text
max(6 beat, 3s)
```

级别的 breather 行为。

本任务必须重新从全局 transition 视角确认：

- 是否所有 mode→不同 mode 都 적용
- 具体发生在哪一层
- 是 suppress event spawn 还是提前结束 active hazard
- 已经 spawn 的 hazard 会不会继续存在
- warning 会不会跨 transition
- note/hold 会不会跨 transition
- 不同 BPM 下 6 beat 与 3s 如何取值
- same-mode section 是否不触发
- transitionOut 字段是否有运行时效果

不要仅引用现有报告，要再次追真实代码。

---

# 7. Transition Matrix

输出完整 4×4：

| From \\ To | ARENA | RUNNER | VERTICAL | RADIAL |
|---|---|---|---|---|
| ARENA | same-mode behavior | ... | ... | ... |
| RUNNER | ... | ... | ... | ... |
| VERTICAL | ... | ... | ... | ... |
| RADIAL | ... | ... | ... | ... |

每个格必须记录：

```text
SUPPORTED
SUPPORTED WITH CONDITIONS
UNKNOWN
BROKEN / UNREACHABLE
```

以及：

- player reset
- hazard/note cleanup
- camera
- input
- HUD
- spawn suppression
- minimum quiet time

---

# 8. Player State Handoff

审计跨 mode 是否保留：

```text
health
score
combo
multiplier
invulnerability
position
velocity
gravity state
held keys
active hold notes
difficulty
intensity
```

逐项说明：

```text
preserved
reset
reinitialized
mode-specific
unknown
```

这是未来 SongValidator 的重要依据。

---

# 9. Input Context Handoff

检查：

- 按住某键从一个模式切到下一个模式会怎样
- keydown state 是否清空
- keyup 缺失是否可能卡键
- Runner jump key 与 Vertical/Radial key 是否冲突
- mode manager 是否切 input map
- transition frame 是否同时被两个 mode 读输入

---

# 10. Camera / Coordinate Handoff

记录：

```text
camera transform
zoom
rotation
scroll offset
world coordinate
normalized coordinate
screen-space coordinate
```

切换时：

- reset?
- animate?
- hard cut?
- previous transform 是否残留?

---

# 11. Hazard / Note Cleanup

对每种 mode 确认 deactivate 时：

- active mechanics 是否立即清除
- bullets 是否清除
- warnings 是否清除
- particles 是否只是视觉残留
- Runner obstacles
- Vertical notes / holds
- Radial notes / holds

尤其检查：

> 是否存在“上一模式 mechanic 已经 spawn，虽然 scheduler 停止新 spawn，但它仍跨模式伤害玩家”的可能。

---

# 12. Audio / BeatClock Continuity

确认：

- music 是否不断
- BeatClock 是否连续
- section startBar 如何对齐
- mode switch 是否重置 beat
- latency compensation 是否一致
- next mode 的 first event 是否仍精确对齐歌曲

---

# 13. Transition Authoring API

寻找：

```text
transitionIn
transitionOut
breather
leadIn
modeSwitch
cameraTransition
duration
```

逐项确认：

- parser 是否接受
- runtime 是否消费
- metadata-only
- default

---

# 14. Transition Timing

计算真实可用指标：

```text
min quiet beats
min quiet seconds
mode deactivate timing
next mode activate timing
first possible next-mode hazard/note timing
```

如果 mode-specific 不同，分开列。

---

# 15. Same-Mode Section Boundary

审计：

```text
ARENA→ARENA
RUNNER→RUNNER
VERTICAL→VERTICAL
RADIAL→RADIAL
```

是否：

- mode 不重置
- player 不重置
- combo 连续
- active mechanic 可跨 section
- breather 不触发
- pattern 可首尾叠加

这影响 Director 是否可以把一个模式拆成多个音乐 section。

---

# 16. Cross-Mode Difficulty Continuity

检查 difficulty/intensity 是：

- section-local
- mode-local
- global

切换时是否会：

```text
difficulty 4 Arena
→ difficulty 1 Runner
```

立即改变 runtime 参数。

---

# 17. 已知危险切换

基于代码列出：

```text
HIGH RISK
CONDITIONAL
SAFE
```

例如但必须验证：

- Arena active projectile → Runner
- Runner airborne → Vertical
- Vertical hold active → Radial
- Radial chord → Arena movement immediately
- gravity inverted Runner → other mode
- mode switch while damage invulnerability active

---

# 18. Transition Safety Contract

为未来 Director / Compiler 输出建议但必须基于真实 runtime：

```json
{
  "transition_safety": {
    "minimum_breathing_beats": ...,
    "minimum_breathing_seconds": ...,
    "clear_previous_hazards": true,
    "allow_active_hold_crossing": false,
    "allowed_boundary_types": ["section_boundary", "phrase_boundary"]
  }
}
```

如果某项 runtime 不保证，必须标：

```text
compiler_required: true
```

---

# 19. Music-Aware Transition Affinity

只做能力总结：

```text
section boundary
phrase boundary
energy drop
break
vocal pause
downbeat
pre-drop
post-climax
```

哪些位置从 runtime/readability 角度最适合 mode switch。

这里不是让你设计歌曲，而是给 Director 使用原则。

---

# 20. Machine-Readable Catalog

输出：

```text
TRANSITION_CAPABILITY_CATALOG.json
```

建议：

```json
{
  "modes": [],
  "matrix": {},
  "breather": {},
  "state_handoff": {},
  "input_handoff": {},
  "camera_handoff": {},
  "cleanup": {},
  "beat_clock": {},
  "authoring_api": {},
  "safe_generation_bounds": {},
  "known_risks": []
}
```

---

# 21. TRANSITION DESIGNER CHEAT SHEET

报告末尾：

```text
Supported mode pairs
Actual breather rule
What gets reset
What persists
Hazard/note cleanup behavior
Input handoff behavior
Camera handoff behavior
BeatClock continuity
Safe transition timing
Same-mode boundary behavior
Known dangerous transitions
Compiler responsibilities not guaranteed by runtime
```

---

# 22. 完成前自检

- [ ] mode IDs
- [ ] full transition chain
- [ ] breather exact behavior
- [ ] 4×4 matrix
- [ ] player state handoff
- [ ] input handoff
- [ ] camera
- [ ] cleanup
- [ ] BeatClock/audio
- [ ] authoring API
- [ ] timing
- [ ] same-mode boundary
- [ ] difficulty continuity
- [ ] dangerous transitions
- [ ] machine-readable catalog
- [ ] no code modification
- [ ] no git
