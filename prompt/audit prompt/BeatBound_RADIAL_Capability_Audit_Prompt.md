# BeatBound RADIAL — Complete Capability Audit Prompt

你现在的任务不是开发、不是重构、不是优化，也不是修 bug。

你的唯一任务是：

> **以当前 BeatBound 工作区实际代码为唯一事实来源，对 RADIAL 模式做一次完整、只读、可追溯的运行时能力审计，并输出一份足够让“关卡设计 LLM + 确定性编译器 + 可玩性验证器”直接使用的权威能力手册。**

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
RADIAL_CAPABILITY_AUDIT.md
RADIAL_CAPABILITY_CATALOG.json
```

Markdown 给人读；JSON 给后续 LLM / compiler / validator 使用。

最终回复只需简洁汇报：

```text
RADIAL capability audit complete.

Generated:
- RADIAL_CAPABILITY_AUDIT.md
- RADIAL_CAPABILITY_CATALOG.json

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


# 3. RADIAL 审计目标

我要让后续 Director 能回答：

> “现在 RADIAL 模式真正支持几个方向、什么输入、什么 note / hold / sequence？8 方向是否已经完整接线？哪些 pattern 可以表现旋律方向、鼓组、旋转和 call-response？”

不要根据“64.0 风格”推测。

只记录当前 runtime。

---

# 4. 完整运行链

追踪：

```text
level/pattern JSON
→ loader / scheduler
→ RADIAL note/mechanic creation
→ radial spawn geometry
→ inward/outward travel
→ direction mapping
→ player input
→ judgement
→ score/combo/health
→ cleanup
```

---

# 5. 方向系统专项 —— 最重要

确认当前真实方向数：

```text
4?
8?
其他?
```

必须列出真实 enum / identifiers，例如若存在：

```text
N
NE
E
SE
S
SW
W
NW
```

则记录：

- angle
- screen position
- input key
- judgement receptor
- JSON 表示
- renderer 表示

如果代码仍只有 4 方向，要明确：

```text
Runtime currently supports 4 directions only.
```

---

# 6. Input Mapping

提取：

- 每方向键位
- 是否支持 diagonal 独立键
- 是否通过两键组合表达 diagonal
- 同时输入上限
- keydown / keyup
- hold state
- input buffer
- opposite directions 是否允许同时按
- adjacent directions 是否允许同时按

输出 machine-readable mapping。

---

# 7. 全部 Radial Note / Mechanic Primitive

搜索：

```text
radial
direction
sector
note
tap
hold
ring
center
approach
orbit
rotate
clockwise
counterclockwise
```

总表：

| ID | 名称 | 方向数 | Tap/Hold | 移动 | 同拍组合 | 判定 |
|---|---|---:|---|---|---|---|

---

# 8. Spawn / Travel Geometry

记录：

```text
spawn radius
judgement radius
center point
incoming/outgoing
angle mapping
travel duration
travel speed
easing
rotation while travelling?
```

确认 note 是：

```text
固定方向直线向中心
沿圆弧
旋转
径向扩张
```

哪一种。

---

# 9. Judgement

完整记录：

- hit windows
- Perfect/Good/Miss 等真实档位
- early/late
- direction mismatch
- simultaneous direction input
- hold release
- score/combo/health

---

# 10. Tap / Hold / Special Gesture

分别审计真实支持：

```text
tap
hold
long
double
chord
opposite pair
adjacent pair
rotation sequence
clockwise chain
counterclockwise chain
alternating
```

不存在就写 NOT SUPPORTED。

---

# 11. Simultaneous Directions

确认同一 hit time：

- 能有几个 note
- 同方向 duplicate 会怎样
- opposite pair
- adjacent pair
- 4-way chord
- 8-way chord

区分 runtime legality 和人类设计推荐。

---

# 12. Pattern Language

审计现有 radial pattern 是否支持：

```text
clockwise rotation
counterclockwise rotation
ping-pong
opposite
cross
diagonal cross
spiral ordering
random/permuted directions
call-response
burst
stream
```

只记录真实 pattern。

---

# 13. Timing Resolution

明确支持：

```text
beat
half-beat
quarter-beat
1/8
1/16
任意 offset
```

最细 authoring resolution 是多少。

如果 JSON 任意小数 beat 都合法，也要写。

---

# 14. Difficulty / Scaling

寻找：

```text
difficulty
intensity
approachSpeed
noteDensity
windowScale
directionComplexity
```

说明真实消费者。

---

# 15. Human / Input Feasibility

基于真实方向键和状态机，输出：

- 单方向最短间隔
- 相邻方向切换最短间隔（runtime）
- 对向切换
- diagonal 是否需要两键组合
- simultaneous chord limit
- hold 占用
- 同时 opposite 是否冲突

如果没有 runtime hard guard，也明确。

---

# 16. Runtime Safety

寻找：

```text
overlap prevention
duplicate direction check
min spacing
chord cap
active note cap
transition cleanup
```

如果没有：

```text
No runtime radial-chart feasibility guarantee detected.
```

---

# 17. 音乐亲和

对真实能力分类：

- kick/snare → ?
- hi-hat → ?
- bass pulse → ?
- melody rising/falling → clockwise / direction progression?
- arpeggio → rotational sequence?
- vocal syllable → directional cue?
- call-response → opposite direction groups?
- phrase boundary → burst/chord?

只能在真实 mechanic 能力范围内总结。

---

# 18. Safe Generation Bounds

输出：

```json
{
  "safe_generation_bounds": {
    "direction_count": ...,
    "min_same_direction_interval_seconds": ...,
    "max_runtime_chord_size": ...,
    "recommended_max_chord_size": ...,
    "approach_time": ...,
    "min_direction_change_interval": ...
  }
}
```

---

# 19. Pattern Library

输出：

| Pattern ID | 名称 | directions used | timing | note types | difficulty |
|---|---|---|---|---|---|

---

# 20. 真实 JSON 示例

每种 note/mechanic：

- minimal valid JSON
- advanced valid JSON
- 当前 parser 真正接受

---

# 21. Machine-Readable Catalog

输出：

```text
RADIAL_CAPABILITY_CATALOG.json
```

建议：

```json
{
  "mode": "RADIAL",
  "direction_system": {},
  "input": {},
  "judgement": {},
  "notes": [],
  "patterns": [],
  "sequencing": {},
  "difficulty": {},
  "safety": {},
  "music_affinity": {},
  "known_risks": []
}
```

---

# 22. RADIAL DESIGNER CHEAT SHEET

必须包含：

```text
Actual direction count
Direction → angle → key mapping
Current note types
Current hold capabilities
Current chord capabilities
Clockwise/CCW pattern support
Timing resolution
Judgement windows
Approach time
Safe autogeneration bounds
Best melody mappings
Best drum mappings
Current hard limitations
Known impossible/high-risk combinations
```

---

# 23. 完成前自检

- [ ] runtime chain
- [ ] actual direction count
- [ ] 8-direction wiring verified/not verified
- [ ] input mapping
- [ ] note primitives
- [ ] spawn/travel geometry
- [ ] judgement
- [ ] simultaneous inputs
- [ ] pattern language
- [ ] timing resolution
- [ ] difficulty
- [ ] feasibility
- [ ] runtime safety
- [ ] pattern library
- [ ] JSON examples
- [ ] machine-readable catalog
- [ ] no code modification
- [ ] no git
