# BeatBound VERTICAL — Complete Capability Audit Prompt

你现在的任务不是开发、不是重构、不是优化，也不是修 bug。

你的唯一任务是：

> **以当前 BeatBound 工作区实际代码为唯一事实来源，对 VERTICAL 模式做一次完整、只读、可追溯的运行时能力审计，并输出一份足够让“关卡设计 LLM + 确定性编译器 + 可玩性验证器”直接使用的权威能力手册。**

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
VERTICAL_CAPABILITY_AUDIT.md
VERTICAL_CAPABILITY_CATALOG.json
```

Markdown 给人读；JSON 给后续 LLM / compiler / validator 使用。

最终回复只需简洁汇报：

```text
VERTICAL capability audit complete.

Generated:
- VERTICAL_CAPABILITY_AUDIT.md
- VERTICAL_CAPABILITY_CATALOG.json

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


# 3. VERTICAL 审计目标

我要让后续 Director 能回答：

> “现在 VERTICAL 模式到底支持哪些 note / hold / lane / path / simultaneous-input 语言？玩家需要按什么键？判定窗多大？哪些谱面组合在人类输入上可行？”

不要按“节奏大师应该有什么”来写。

只记录当前 runtime 真正支持。

---

# 4. 完整运行链

追踪：

```text
level / pattern JSON
→ loader
→ scheduler
→ VERTICAL dispatcher / note factory
→ note spawn
→ approach / scroll
→ input mapping
→ judgement
→ hold state
→ score / combo / health
→ cleanup
```

如果 UI / renderer 承担了部分 gameplay 逻辑，也要纳入。

---

# 5. 全部 Note / Mechanic Primitive

搜索：

```text
vertical
lane
note
tap
hold
long
drag
slide
drift
flick
chord
simultaneous
judge
hitWindow
approach
receptor
key
input
```

输出总表：

| ID / Type | 名称 | 当前可用 | 输入类型 | 持续型 | 多 lane | 可组合 | 判定 |
|---|---|---|---|---|---|---|---|

只用真实 identifier。

---

# 6. Input Mapping 专项

完整记录：

- lane 数
- lane index 顺序
- 每 lane 对应键位
- 是否支持键位复用
- 是否允许任意键
- simultaneous inputs 数量上限
- keyboard rollover 是否被代码假设
- keydown / keyup 是否都使用
- hold 是否要求持续按住
- 输入 buffering
- autoplay / assist 是否存在

输出：

```json
"input_model": {
  ...
}
```

---

# 7. Judgement 专项

提取全部真实判定：

```text
Perfect
Great
Good
Miss
Early/Late
```

实际有什么就写什么。

对每档记录：

- 时间窗
- 单位 ms / sec / beat
- BPM 是否影响
- difficulty 是否影响
- score
- combo
- health
- visual feedback

如果只有一个 hit window，也明确。

---

# 8. Note Travel / Approach

记录：

```text
spawn position
hit line position
scroll speed
approach time
note travel distance
BPM dependency
difficulty dependency
```

计算：

> note 第一次出现到 hit time 有多少秒 / beat。

这是 VERTICAL 的 reaction window。

---

# 9. Tap 专项

如果支持 tap，记录：

- lane
- hitTime
- simultaneous notes
- note size
- judgement shape
- too-early behavior
- too-late behavior
- ghost tap 是否惩罚
- 同 lane 最短可区分间隔

---

# 10. Hold / Long Note 专项

如果存在：

```text
hold
long note
sustain
```

必须完整追踪：

- start judgement
- end judgement
- keydown / keyup
- 中途松手
- regrab
- tick score
- minimum duration
- maximum duration
- overlap rules
- 同 lane hold 是否允许重叠
- hold 期间能否按其他 lane
- hold tail 可否跨 section / mode boundary

---

# 11. Drift / Slide / Path Hold 专项

用户目标中非常重要，但必须先确认当前实现。

如果存在“长按漂移 / lane-changing hold / slide”：

记录：

- path representation
- node times
- source lane / target lane
- interpolation
- 是否必须持续按同一个键
- 是否需要换键
- lane change judgement
- path width
- simultaneous path
- crossing paths
- min lane-change time

如果不存在：

```text
NOT SUPPORTED BY CURRENT RUNTIME
```

不要脑补。

---

# 12. Chord / Simultaneous Input

审计：

```text
同拍 2 note
3 note
4 note
更多
```

runtime 有没有上限？

如果没有硬上限，也要根据实际 lane 数和输入模型说明理论上限。

检查：

- 同 lane 同时间重复 note
- tap + hold start 同时
- hold + tap 同 lane
- 两个 hold 同 lane
- crossing slides

---

# 13. Note Density / Human Feasibility

基于真实 judgement 和输入模型，计算并报告：

- 每 lane 最短 note 间隔
- 全局每秒最大合理 note rate（不要凭感觉；先给 runtime hard limit，再单列 human-design recommendation）
- chord 后最短恢复时间
- hold 占用期间可用 lane
- 可能造成 impossible input 的组合

区分：

```text
runtime-legal
human-playable recommendation
```

不要混为一谈。

---

# 14. Pattern Library

扫描全部 Vertical patterns / levels / tests。

输出：

| Pattern ID | 名称 | 长度 | note types | lane usage | density | difficulty |
|---|---|---:|---|---|---|---|

确认是否存在：

```text
tap streams
alternating lanes
chords
holds
drifts
call-response
trills
staircases
```

只记录真实存在。

---

# 15. Sequencing / Authoring API

明确 level/pattern JSON 支持：

```text
bar
beat
offsetBeats
durationBeats
lane
path
repeat
intensity
difficulty
subdivision
```

真实字段是什么就写什么。

---

# 16. Difficulty / Scaling

寻找：

```text
difficulty
intensity
note speed
density
window scale
lane complexity
```

说明运行时实际效果。

如果 difficulty 只是 metadata，标出来。

---

# 17. Runtime Safety / Validation

寻找：

```text
overlap check
same-lane conflict
hold conflict
min note spacing
chord cap
mode-transition cleanup
```

如果不存在统一保护：

```text
No runtime chart-feasibility guarantee detected.
```

---

# 18. 已知危险 / 不可能谱型

必须根据输入状态机列出：

```text
IMPOSSIBLE
HIGH RISK
CONDITIONAL
```

例如是否存在：

- 同 lane 两个重叠 hold
- hold tail 与下一 hold start 冲突
- 需要同一个键同时 down/up
- 超出 lane 数的 chord
- note 太密导致 judgement window 重叠
- mode transition 时仍有 hold active

但必须以代码为准。

---

# 19. 音乐亲和

对每种真实 note / gesture 分类：

```text
kick / snare
hi-hat
bass pulse
melody contour
vocal syllables
sustain vocal
arpeggio
build
drop
phrase boundary
```

这部分是供 Director 选“哪层音乐控制哪类谱面动作”。

---

# 20. Safe Generation Bounds

机器可读输出建议：

```json
{
  "safe_generation_bounds": {
    "lane_count": ...,
    "min_same_lane_interval_seconds": ...,
    "max_runtime_chord_size": ...,
    "recommended_max_chord_size": ...,
    "min_hold_duration": ...,
    "min_lane_change_time": ...,
    "approach_time": ...
  }
}
```

无法确认填 null。

---

# 21. 真实 JSON 示例

每种 runtime-usable note / mechanic：

- minimal JSON
- advanced JSON
- 当前 parser 真正接受

---

# 22. Machine-Readable Catalog

输出：

```text
VERTICAL_CAPABILITY_CATALOG.json
```

建议：

```json
{
  "mode": "VERTICAL",
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

# 23. VERTICAL DESIGNER CHEAT SHEET

报告末尾：

```text
Lane count / keys
Current note types
Hold capabilities
Drift/slide capabilities
Chord capabilities
Judgement windows
Approach time
Safe chart-generation bounds
Best mappings for drums
Best mappings for melody
Best mappings for vocals
Current hard limitations
Known impossible/high-risk combinations
```

---

# 24. 完成前自检

- [ ] runtime chain
- [ ] note primitives
- [ ] input mapping
- [ ] judgement windows
- [ ] note travel / approach
- [ ] tap
- [ ] hold
- [ ] drift/slide
- [ ] chord
- [ ] human feasibility
- [ ] pattern library
- [ ] sequencing
- [ ] difficulty
- [ ] runtime validation
- [ ] risks
- [ ] JSON examples
- [ ] machine-readable catalog
- [ ] no code modification
- [ ] no git
