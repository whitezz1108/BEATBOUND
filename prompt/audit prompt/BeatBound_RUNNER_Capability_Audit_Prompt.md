# BeatBound RUNNER — Complete Capability Audit Prompt

你现在的任务不是开发、不是重构、不是优化，也不是修 bug。

你的唯一任务是：

> **以当前 BeatBound 工作区实际代码为唯一事实来源，对 RUNNER 模式做一次完整、只读、可追溯的运行时能力审计，并输出一份足够让“关卡设计 LLM + 确定性编译器 + 可玩性验证器”直接使用的权威能力手册。**

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
RUNNER_CAPABILITY_AUDIT.md
RUNNER_CAPABILITY_CATALOG.json
```

Markdown 给人读；JSON 给后续 LLM / compiler / validator 使用。

最终回复只需简洁汇报：

```text
RUNNER capability audit complete.

Generated:
- RUNNER_CAPABILITY_AUDIT.md
- RUNNER_CAPABILITY_CATALOG.json

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


# 3. RUNNER 审计目标

我要让后续 Director 能回答：

> “现在 Runner 到底能设计哪些障碍、跳跃、重力变化、地形、节奏序列？哪些参数是真实可调的？玩家的物理极限是什么？什么样的组合一定能跳过去？”

重点不是“看起来像 Geometry Dash”，而是**当前代码真正能运行的 Runner 设计语言**。

---

# 4. 完整运行链

追踪至少：

```text
level JSON
→ section / pattern placement
→ loader / compile
→ scheduler
→ RUNNER dispatcher / mechanic registry
→ obstacle/platform/gravity implementation
→ Runner player physics
→ collision / death / reset
→ camera / scrolling
→ lifecycle / cleanup
```

如果 Runner 不是 mechanic-registry 架构，也要画出真实调用链。

---

# 5. 找出全部 Runner runtime primitives

扫描：

```text
RUNNER
runner
jump
gravity
platform
ground
ceiling
spike
obstacle
gap
portal
pad
speed
scroll
lane
wall
hazard
trigger
```

以及 registry / switch / factory / dispatcher / parser。

输出总表：

| ID / Type | 名称 | 当前可用 | 类别 | 作用 | 致命 | 可参数化 | 可组合 |
|---|---|---|---|---|---|---|---|

必须使用真实 identifier。

---

# 6. Player Physics 专项 —— 本报告最重要部分之一

完整提取 Runner 玩家真实物理：

```text
horizontal / scroll speed
player x behavior
vertical velocity
gravity
jump impulse
double jump?
hold-to-jump?
variable jump height?
coyote time?
jump buffering?
ground snap?
ceiling collision?
gravity inversion?
terminal velocity?
acceleration?
friction?
air control?
player visual size
player collision box / radius
death/reset delay
invulnerability?
```

明确单位：

```text
px/s
normalized units/s
units/beat
seconds
frames
beats
```

如果横向移动其实是世界滚动、玩家 x 固定，也要明确。

---

# 7. 跳跃可达性计算

基于真实物理参数，计算并写入报告：

- 单次跳跃总滞空时间
- 到达最高点时间
- 最大跳高
- 在当前默认横向速度下：
  - 0.25 beat
  - 0.5 beat
  - 1 beat
  - 2 beat
  - 4 beat
  分别横向推进多少
- 单跳理论最大安全 gap
- 不同平台高差下的可达范围
- 倒重力时是否完全对称
- 速度变化后 jump arc 如何变化

如果存在不同 difficulty / speed tier，全部分别计算。

最终给一个机器可读的：

```json
"player_physics": {
  ...
},
"jump_envelope": {
  ...
}
```

---

# 8. Ground / Platform / Obstacle 能力

逐项审计所有可放置元素：

可能包括但不限于：

```text
floor
platform
ceiling
spike
block
pillar
gap
moving platform
slope
wall
orb
pad
portal
```

不要假设存在；只记录真实支持。

对每项记录：

- identifier
- source
- JSON shape
- x/y 或 bar/beat 定位
- width / height
- anchor
- collision shape
- 是否静态
- 是否跟随 scroll
- 是否可移动
- 是否可穿透
- 是否致死
- warning / preview
- duration / lifetime

---

# 9. Jump / Action Mechanic 专项

确认 Runner 玩家到底支持哪些动作：

```text
single jump
double jump
hold jump
short hop
drop-through
dash
air dash
wall jump
orb-assisted jump
jump pad
gravity flip
manual gravity toggle
automatic gravity portal
ceiling run
```

不存在就明确写：

```text
NOT SUPPORTED
```

---

# 10. Gravity 专项

如果存在重力变化，必须追到 runtime：

- normal / inverted
- gravity value
- flip 是瞬时还是过渡
- flip 时 vertical velocity 是否保留
- floor/ceiling 如何交换
- 玩家 sprite / hitbox 是否同步
- camera 是否翻转
- obstacle 是否需要镜像
- flip trigger 的 JSON 参数
- 连续 flip 最短间隔
- flip 是否可能发生在空中
- 是否有 safety / landing protection

特别输出：

```json
"gravity": {
  "supported_states": [],
  "flip_mechanisms": [],
  "constraints": {}
}
```

---

# 11. Speed / Scroll 专项

审计：

```text
base speed
speed changes
speed multiplier
speed portal / trigger
section difficulty 是否影响速度
BPM 是否影响速度
world units per beat
camera speed
```

如果存在速度变化，说明：

- immediate / eased
- duration
- min/max
- 对 jump feasibility 的影响
- 是否会让既有 obstacle spacing 失效

---

# 12. Pattern / Template Library

扫描所有 Runner：

```text
patterns
levels
tests
fixtures
demo
showcase
```

输出：

| Pattern ID | 名称 | 长度 | 功能 | 真实 primitives | 关键参数 | 难度 |
|---|---|---:|---|---|---|---|

必须区分：

```text
primitive mechanic
composite pattern
level placement
```

---

# 13. Sequencing 能力

确认 Runner pattern 支持：

```text
absolute bar
relative bar
beat
offsetBeats
repeat
sequence
parallel
nested
loop
random choice
conditional
difficulty scaling
```

同时回答：

> 同一时刻能否叠多个 Runner obstacle / trigger？

---

# 14. Telegraph / Readability

Runner 里如果不是 warning-based，而是通过“提前看见前方障碍”提供反应时间，也要量化：

```text
camera look-ahead
visible distance
time-to-contact
spawn distance
obstacle render distance
```

计算默认速度下：

```text
玩家第一次看见障碍 → 碰撞
```

有多少秒 / beat。

这就是 Runner 的实际 reaction window。

---

# 15. Collision / Death

记录：

- player collision shape
- spike collision shape
- platform collision
- swept collision?
- tunneling protection?
- landing tolerance
- head collision
- ceiling collision
- side collision
- death condition
- fail / respawn behavior

检查视觉和碰撞是否一致。

---

# 16. Runner Difficulty / Scaling

寻找：

```text
difficulty
intensity
speedMultiplier
gapScale
obstacleDensity
reactionScale
jumpScale
```

说明实际消费者。

元数据字段若没人读取，必须标：

```text
METADATA ONLY
```

---

# 17. 可玩性保护

搜索：

```text
max gap
min spacing
minimum reaction
jump feasibility
landing window
safe spawn
overlap prevention
gravity protection
speed clamp
```

明确：

> 当前 runtime 有没有真正的 Runner playability guarantee？

如果没有：

```text
No runtime jump-feasibility guarantee detected.
```

---

# 18. 危险 / 不可行组合

基于真实物理，列出：

```text
HIGH RISK
IMPOSSIBLE
CONDITIONAL
```

例如但不要预设：

- gap > jump envelope
- spike 紧贴 landing point
- gravity flip 后立即 gap
- speed-up 后 spacing 不够
- ceiling obstacle 与 ground obstacle 同 x 封死
- 连续 jumps 要求超过输入能力

必须给出代码依据或物理计算依据。

---

# 19. Runner Playability Envelope

给后续 compiler 一个最重要的摘要：

```json
{
  "safe_generation_bounds": {
    "min_reaction_seconds": ...,
    "max_jumpable_gap_default_speed": ...,
    "max_step_up": ...,
    "max_step_down": ...,
    "min_obstacle_spacing": ...,
    "gravity_flip_min_spacing": ...
  }
}
```

无法确定的填 null。

---

# 20. 音乐设计亲和

对每个真实 primitive 分类：

```text
best for strong beat
best for quarter-note pulse
best for eighth-note sequence
best for melody contour
best for phrase boundary
best for build
best for drop
best for sustained section
```

只做能力分类，不编具体歌曲。

---

# 21. 真实 JSON 示例

对每个 runtime-usable primitive：

- 最小有效 JSON
- 重要项给高级 JSON
- 使用当前 parser 真正接受的格式

不允许 pseudo JSON。

---

# 22. Machine-Readable Catalog

输出：

```text
RUNNER_CAPABILITY_CATALOG.json
```

建议至少：

```json
{
  "mode": "RUNNER",
  "player": {},
  "physics": {},
  "primitives": [],
  "patterns": [],
  "sequencing": {},
  "difficulty": {},
  "safety": {},
  "music_affinity": {},
  "known_risks": []
}
```

每个 primitive 至少：

```json
{
  "id": "",
  "available": true,
  "category": "",
  "source_files": [],
  "parameters": {},
  "units": {},
  "collision": {},
  "timing": {},
  "safe_to_autogenerate": {},
  "minimal_example": {}
}
```

---

# 23. RUNNER DESIGNER CHEAT SHEET

报告末尾必须包含：

```text
Currently usable terrain
Currently usable hazards
Currently usable movement modifiers
Gravity capabilities
Speed capabilities
Best beat-sync mechanics
Best phrase-level mechanics
Player physics summary
Jump envelope
Safe autogeneration bounds
Current hard limitations
Known impossible/high-risk combinations
```

---

# 24. 完成前自检

- [ ] 完整 runtime call chain 已追踪
- [ ] 所有 Runner primitive 已审计
- [ ] player physics 已提取
- [ ] jump envelope 已计算
- [ ] gravity 已审计
- [ ] speed / scroll 已审计
- [ ] collision 已审计
- [ ] pattern library 已审计
- [ ] sequencing 已审计
- [ ] reaction/readability 已量化
- [ ] runtime safety 已审计
- [ ] dangerous combinations 已列出
- [ ] 真实 JSON 示例已给出
- [ ] machine-readable catalog 已输出
- [ ] 未修改代码
- [ ] 未执行 git
