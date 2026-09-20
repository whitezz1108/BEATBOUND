# BeatBound Editor — Music Analysis V2.1 / Director Context Upgrade Prompt

## 任务定位

你现在只升级 **BeatBound Editor 的音乐分析与导出层**。

目标不是生成关卡，不是修改 ARENA / RUNNER / VERTICAL / RADIAL，也不是开始做 Gameplay Director。

本轮要把现有 `music_analysis_v2.json` 从“底层音乐特征很丰富”升级为“足够让另一个关卡设计 Agent 稳定理解歌曲结构、重复关系、层次变化，并直接用于关卡编排”的分析结果。

最终必须让用户完成一次歌曲分析后，可以在 Editor UI 中点击按钮下载：

```text
director_context.json
```

这个文件是以后交给 GPT / 关卡设计 Agent 的**首选输入文件**。

---

# 0. 强约束

## 不要做

- 不修改 ARENA
- 不修改 RUNNER
- 不修改 VERTICAL
- 不修改 RADIAL
- 不修改游戏 runtime
- 不做 Gameplay Director
- 不自动生成 level.json
- 不设计具体歌曲的关卡
- 不修改任何现有 mechanic
- 不执行任何 git 操作
- 不 commit / checkout / reset / merge
- 不破坏现有 `music_analysis_v2.json`
- 不破坏兼容旧格式的 v1 projection
- 不用“看起来合理”的假数据填充无法可靠检测的信息

## 必须保持

现有 V2 分析能力继续工作，包括当前已有的：

- global
- rhythm
- energy
- tonal
- stems
- melody
- structure
- events
- timeline
- v1 compatibility projection

所有现有测试必须继续通过。

如果新增能力置信度不足，输出：

```json
null
```

或明确的低置信度标记，不允许硬猜。

---

# 1. 本轮核心目标

新增四个高价值音乐理解能力：

1. **Repetition / repeated-section detection**
2. **Phrase hierarchy**
3. **Arrangement delta between repeated sections**
4. **Downbeat / bar-phase confidence**

另外为未来歌词语义支持预留一个可选字段：

5. **Lyrics / word timestamps（可选，不得成为核心分析的阻塞依赖）**

最后新增一个专门供关卡设计 Agent 使用的：

```text
director_context.json
```

并在 Editor 分析完成页加入下载按钮。

---

# 2. 为什么要做这些

现有 V2 已经能回答：

> 音乐什么时候有 beat、鼓、bass、人声、旋律、能量变化？

但关卡导演还需要回答：

> 哪些段落其实是同一个 Chorus / Hook 再次出现？

> 这是第一次、第二次还是第三次出现？

> 第二次相对第一次到底增强了哪些音乐层？

> 一段 Section 内部怎样分成 4 / 8 / 16 bars 的 phrase？

> 哪一拍是真正的小节第一拍？

这些信息决定游戏能否做到：

```text
Theme
→ Variation
→ Escalation
→ Climax
```

而不是每个 section 都随机重新生成。

---

# 3. 新增模块：Repetition Detection

新增清晰独立的模块，例如：

```text
beatbound_audio/repetition.py
```

具体文件名可以根据现有项目结构调整，但职责必须独立、可测试。

## 3.1 目标

检测不同 `structure.sections` 之间是否属于同一个重复音乐主题。

例如：

```text
Verse A1
Chorus A1
Verse A2
Chorus A2
Bridge
Chorus A3
```

即使 structure 当前只是：

```text
section_1
section_2
section_3
...
```

也要新增机器可读的 repeat group。

---

## 3.2 Section Fingerprint

不要只比较单一 chroma。

为每个 section 构造一个多维 fingerprint，优先复用当前 V2 已经计算出来的数据。

建议至少包含：

### Harmonic

- normalized chroma profile
- chroma temporal summary

### Rhythm

- beat-synchronous onset density
- onset-strength envelope
- drum activity
- kick-like / snare-like / high-percussion ratios where available

### Arrangement

- drums activity
- bass activity
- vocals activity
- other activity

### Melody

- melody density
- pitch contour summary
- pitch range
- phrase density

### Energy

- mean energy
- normalized within-section energy contour

### Duration / structure

- bar count
- duration

不要因为某一层缺失就让整个 repetition analysis 失败。

---

## 3.3 Similarity

计算 section-to-section similarity。

可以使用：

- cosine similarity
- normalized correlation
- recurrence / self-similarity matrix
- weighted feature similarity

允许使用现有 `librosa` 能力。

不要为了这个功能引入新的大型深度学习依赖。

输出至少：

```json
{
  "repeat_groups": [
    {
      "group_id": "repeat_001",
      "confidence": 0.91,
      "occurrences": [
        {
          "section_id": "section_2",
          "occurrence_index": 1,
          "start": 23.9,
          "end": 56.4
        },
        {
          "section_id": "section_4",
          "occurrence_index": 2,
          "start": 85.1,
          "end": 102.3
        }
      ]
    }
  ]
}
```

---

## 3.4 不要强制给 Verse / Chorus 标签

本轮首先解决：

> “是不是同一个音乐主题重复出现”

而不是依赖脆弱的：

```text
verse / chorus / bridge
```

自动命名。

如果能够高置信度推断，可增加：

```json
"semantic_role": "chorus",
"semantic_role_confidence": 0.68
```

但低置信度必须为 `null`。

repeat group 本身不能依赖 semantic label 才工作。

---

# 4. 新增模块：Phrase Hierarchy

现有：

```text
beat
→ bar
→ section
```

新增：

```text
beat
→ bar
→ phrase
→ section
```

---

## 4.1 Phrase 目标

Phrase 是供关卡导演使用的主要编排粒度。

优先识别：

- 4 bars
- 8 bars
- 16 bars

但不要强制所有 phrase 必须等长。

必须严格对齐 bar grid。

输出例如：

```json
{
  "phrases": [
    {
      "phrase_id": "phrase_001",
      "section_id": "section_2",
      "start_bar": 13,
      "end_bar": 20,
      "bar_count": 8,
      "start": 23.91,
      "end": 39.52,
      "confidence": 0.86
    }
  ]
}
```

---

## 4.2 Phrase Boundary Detection

综合：

- energy change
- drum activity change
- vocal activity change
- bass activity change
- melody phrase boundaries
- harmonic novelty
- onset-density change
- bar-grid position

禁止仅仅每 8 bars 生硬切一次。

但可以把 4/8/16 bar periodicity 作为 strong prior。

---

## 4.3 Phrase Position

在一个 section 内可以额外提供相对位置：

```json
"position_in_section": 0.0
```

范围：

```text
0.0 → section start
1.0 → section end
```

以及可选标签：

```text
opening
development
peak
transition
```

只有在规则明确且稳定时才输出。

不要让主观标签成为核心依赖。

---

# 5. 新增模块：Arrangement Delta

这是本轮最重要的关卡设计辅助数据之一。

当两个 section 属于同一个 `repeat_group` 时，对 occurrence N 和 occurrence 1 / previous occurrence 做差异比较。

输出例如：

```json
{
  "repeat_comparisons": [
    {
      "group_id": "repeat_001",
      "occurrence": 2,
      "compared_to_occurrence": 1,

      "energy_delta": 0.12,
      "drum_activity_delta": 0.18,
      "drum_density_delta": 0.15,
      "bass_activity_delta": 0.06,
      "vocal_activity_delta": 0.03,
      "other_activity_delta": 0.09,

      "brightness_delta": 0.08,
      "melody_density_delta": 0.05,
      "onset_density_delta": 0.11,

      "arrangement_intensity_delta": 0.13
    }
  ]
}
```

---

## 5.1 Delta 定义

所有 delta 尽可能使用：

```text
normalized occurrence B - normalized occurrence A
```

保证：

```text
positive = stronger / denser / brighter / more active
negative = weaker / sparser / darker / less active
```

必须在 schema / documentation 中写清楚。

---

## 5.2 Arrangement Intensity

允许输出一个综合值：

```text
arrangement_intensity
```

以及：

```text
arrangement_intensity_delta
```

但它必须由明确的可解释权重计算。

不要黑盒。

在代码注释或文档中说明权重。

例如可以综合：

- energy
- drum density
- bass activity
- vocal activity
- onset density
- brightness
- melody density

如果某层数据缺失，应动态 renormalize 权重。

---

# 6. Downbeat / Bar Phase Confidence

当前知道 BPM 和 beat grid 还不够。

音游需要知道：

> 哪一个 beat 是 bar 的第 1 拍？

新增：

```json
{
  "downbeats": [
    {
      "bar": 1,
      "time": 6.71,
      "confidence": 0.91
    }
  ]
}
```

全局增加：

```json
{
  "bar_phase_confidence": 0.88
}
```

---

## 6.1 要求

- 不破坏现有可手动覆盖拍号的能力
- 如果 downbeat 推断不可靠，要反映在 confidence
- 如果已有人工 bar offset / meter override，人工值优先
- 不允许因为 downbeat detection 失败导致整个分析失败

如果实现稳定性不足：

```json
"bar_phase_confidence": null
```

比伪造高置信度更好。

---

# 7. Lyrics / Word Timestamp：只做可选架构

歌词对某些歌曲非常有价值，例如：

```text
right
left
slide
up
down
```

可以成为 Arena 的语义 cue。

但是本轮不要让歌词识别拖垮整个 V2。

---

## 7.1 Schema 先支持

在输出中预留：

```json
{
  "lyrics": {
    "available": false,
    "provider": null,
    "language": null,
    "words": []
  }
}
```

如果项目当前已经拥有可靠的本地 transcription 能力，可接入。

否则：

> 不要在本轮强行安装 WhisperX / 大型新依赖。

---

## 7.2 如果实现 optional transcription

优先采用：

```text
Demucs vocals stem
→ local speech/song transcription
→ word timestamps
```

实现必须：

- 可关闭
- 缺依赖时 graceful fallback
- 不影响核心分析
- 不联网才能完成核心 V2
- 不允许 transcription failure 让 V2 exit non-zero

输出：

```json
{
  "word": "slide",
  "start": 32.14,
  "end": 32.52,
  "confidence": 0.81
}
```

如果 sung vocal 结果不可靠，confidence 必须反映。

---

# 8. 新增 `director_context.json`

这是本轮最终最重要的产品输出。

不要让我以后每次把：

- 759 onsets
- 600 drum onsets
- 524 notes
- 589 timeline windows
- 787 unified events

全部直接塞进关卡设计 prompt。

`director_context.json` 应该是：

> **从完整 V2 数据压缩出来、保留音乐结构与导演价值的 Agent-facing representation。**

---

# 9. Director Context Schema

建议结构：

```json
{
  "schema_version": "beatbound_director_context_v1",

  "source": {
    "audio_file": "",
    "duration": 0,
    "analysis_version": "",
    "generated_at": ""
  },

  "global": {},

  "grid": {
    "bpm": 0,
    "meter": "4/4",
    "bar_phase_confidence": null,
    "bars": []
  },

  "sections": [],

  "phrases": [],

  "repeat_groups": [],

  "repeat_comparisons": [],

  "stem_summary": {},

  "important_events": [],

  "melody_summary": {},

  "intensity_curve": [],

  "lyrics": {
    "available": false,
    "provider": null,
    "words": []
  },

  "provenance": {}
}
```

可根据现有 schema 结构调整，但语义不能丢。

---

# 10. `global`

至少包含：

```text
duration
bpm
bpm_confidence
meter
bar_count
beat_count
key
scale
key_confidence
overall_energy
dynamic_range
brightness
rhythmic_density
melodic_density
```

不要复制无关的大数组。

---

# 11. `grid.bars`

关卡导演需要稳定的 bar anchors。

每个 bar：

```json
{
  "bar": 17,
  "start": 31.42,
  "end": 33.37,
  "downbeat_confidence": 0.89
}
```

如果 75 bars，这种规模完全可以接受。

---

# 12. `sections`

每个 section 要是一个高度浓缩但有导演价值的 block。

至少：

```json
{
  "section_id": "section_04",
  "start": 69.8,
  "end": 85.1,

  "start_bar": 36,
  "end_bar": 43,

  "energy": {
    "mean": 0.78,
    "peak": 0.91,
    "trend": "rising"
  },

  "stems": {
    "drums": 0.86,
    "bass": 0.72,
    "vocals": 0.91,
    "other": 0.55
  },

  "rhythm": {
    "onset_density": 0.74,
    "kick_activity": 0.81,
    "snare_activity": 0.68,
    "high_percussion_activity": 0.77
  },

  "melody": {
    "activity": 0.64,
    "density": 0.59,
    "contour": "rising_then_falling",
    "peak_times": []
  },

  "repeat": {
    "group_id": "repeat_001",
    "occurrence": 2,
    "total_occurrences": 3,
    "similarity_to_group": 0.91
  }
}
```

没有的数据允许 null。

---

# 13. `phrases`

不要只输出 phrase 边界。

每个 phrase 给少量 summary：

```json
{
  "phrase_id": "phrase_009",
  "section_id": "section_04",

  "start": 69.8,
  "end": 77.6,

  "start_bar": 36,
  "end_bar": 39,

  "energy_mean": 0.74,
  "energy_trend": "rising",

  "dominant_layers": [
    "vocals",
    "drums",
    "bass"
  ],

  "melody_contour": "rising",

  "important_event_times": [
    71.2,
    73.1,
    76.4
  ]
}
```

---

# 14. `important_events`

不要把完整 787 events 原封不动复制进来。

只保留对导演高价值事件。

例如：

```text
section_boundary
strong_beat（必要时抽样）
energy_rise
energy_drop
energy_peak
bass_entry
vocal_entry
vocal_exit
melody_rise
melody_fall
melody_peak
large_pitch_jump
strong_onset（只保留最显著部分）
```

---

## 14.1 Event Pruning

对高频事件做压缩。

例如 `strong_onset`：

- 按 phrase / bar 选 top-K
- 或使用强度 threshold
- 或做 minimum temporal spacing

目标不是丢失音乐意义，而是让 Director Context 保持可阅读、可传输。

建议整个 `important_events`：

```text
约 100–250 个
```

具体不要硬编码为绝对上限，但避免几百上千个噪声事件。

---

# 15. `intensity_curve`

不需要完整 0.25s × 589 windows。

生成一个面向导演的降采样版本。

例如：

```text
每 1 bar 一个值
```

或：

```text
每 2 beats 一个值
```

每个点可以包含：

```json
{
  "time": 31.42,
  "bar": 17,
  "energy": 0.77,
  "drums": 0.84,
  "bass": 0.69,
  "vocals": 0.52,
  "melody": 0.61,
  "combined_intensity": 0.75
}
```

这样 GPT 可以看到歌曲的整体强弱走势。

---

# 16. `melody_summary`

不要复制全部 524 notes。

保留：

- range
- density
- global contour information
- section / phrase contour
- major peaks
- major rises/falls
- large pitch jumps

完整 note list 继续留在 full V2 JSON。

---

# 17. Provenance

Director Context 中所有高层字段都应尽量能追踪来源。

例如：

```json
{
  "provenance": {
    "repeat_groups": [
      "layers.structure",
      "layers.rhythm",
      "layers.stems",
      "layers.melody"
    ],
    "phrases": [
      "layers.rhythm",
      "layers.energy",
      "layers.melody",
      "layers.stems"
    ]
  }
}
```

不必为每一个数值写 lineage，但至少模块级可解释。

---

# 18. 文件输出

完成一次 V2 分析后，应至少存在：

```text
music_analysis_v2.json
music_analysis_v1.json
director_context.json
```

如果现有 v1 文件名不同，保持当前名称，不要强制重命名。

---

# 19. Editor UI：新增下载按钮

分析完成后，在用户能够查看分析结果的界面增加明显按钮：

```text
Download Director Context
```

点击直接下载：

```text
director_context.json
```

这是本轮必须完成的 UI 功能。

---

## 19.1 可选第二按钮

如果当前 UI 适合，也可以同时保留/增加：

```text
Download Full Analysis
```

对应：

```text
music_analysis_v2.json
```

但首要按钮是：

```text
Download Director Context
```

---

## 19.2 不做 MD 主导出

本轮不要以 Markdown 作为机器工作流的主要导出。

原因：

```text
JSON 更适合后续：
- GPT / Agent ingest
- schema validation
- 自动编译
- diff
- regression test
```

如果 UI 里非常容易额外提供：

```text
Download Human Summary
```

可以输出 Markdown，但它是 optional。

**必须保证 JSON 是权威格式。**

---

# 20. Director Context Schema Validation

新增正式 schema，例如：

```text
schemas/director_context.schema.json
```

文件位置按当前项目组织方式选择。

必须能够：

```text
director_context.json
→ schema validate
→ 0 errors
```

不能只靠 TypeScript / Python object shape。

---

# 21. CLI 支持

当前 V2 CLI 跑分析后，应自动生成 director context。

如果当前 CLI 类似：

```bash
python analyze_music_v2.py song.mp3
```

则正常分析完成后自动输出：

```text
music_analysis_v2.json
director_context.json
```

兼容现有 v1 projection。

如现有 CLI 有 `--output` / `--force` 等参数，保持兼容。

---

# 22. 可选 CLI 开关

如果歌词 transcription 被实现，建议：

```text
--lyrics
--no-lyrics
```

默认行为必须安全。

如果未安装 optional transcription dependency：

```text
分析照常成功
lyrics.available = false
```

---

# 23. Cache / Determinism

新增分析必须继续重视 determinism。

同一音频、相同配置、相同依赖环境：

```text
repeat_groups
phrases
repeat_comparisons
director_context
```

应尽可能稳定。

如果算法有随机性：

- 固定 seed
- 或禁用 randomness
- 或显式记录 nondeterministic source

---

# 24. 不允许模型制造假精度

尤其以下内容：

```text
section semantic role
repeat similarity
downbeat confidence
lyrics confidence
phrase confidence
```

都要真实反映算法可靠度。

不要因为产品 UI 想看起来完整，就输出：

```text
0.95
```

这种没有依据的高置信度。

---

# 25. 新增测试

至少覆盖以下。

## Repetition

- identical / near-identical synthetic repeated section 能被聚类
- 明显不同 section 不应错误聚类
- occurrence index 正确
- group ordering deterministic

## Phrase

- phrase boundaries 对齐 bar
- section 内 phrase 不越界
- start/end 连续合法
- short song graceful fallback

## Arrangement Delta

- 第二段明显加大 drums 时 delta > 0
- 相同段 delta 接近 0
- missing stem graceful fallback

## Downbeat

- 手工 meter override 优先
- 低置信度不制造 false precision

## Director Context

- schema validation
- 不包含完整 raw note list
- 不包含完整 raw onset list
- sections / phrases / repeat groups 引用合法
- 时间全部在歌曲 duration 内
- bar references 合法
- deterministic export

## UI

如果现有测试框架允许：

- Download Director Context button 出现
- 下载文件名正确
- 内容是最新一次分析对应的数据

---

# 26. Regression

必须完整运行现有测试套件。

如果本轮修改让旧测试失败：

> 优先修复兼容性，而不是删除旧测试。

不要为了新 schema 强制破坏旧 V2 consumer。

---

# 27. 用 Toosie Slide 做真实验收

使用当前已经跑通的真实测试歌曲：

```text
Dance Fruits Music, Steve Void - Toosie Slide (Sped Up)
```

约：

```text
147 秒
123 BPM
```

完成一次真实全流程分析。

重点人工检查：

1. director_context.json 成功生成
2. JSON schema 0 errors
3. sections 有效
4. phrases 有效
5. repeat_groups 不为空时结果听感上合理
6. repeat occurrence 顺序正确
7. repeat_comparisons 能看出重复段的编曲变化
8. bar grid 与现有节拍分析一致
9. important_events 没有膨胀回原始 700+ 事件规模
10. UI 按钮可以正确下载对应文件

---

# 28. 对重复段识别要保守

这是重要要求。

宁愿：

```text
两个相似副歌没有被合并
```

也不要：

```text
主歌和副歌错误聚成一个 repeat group
```

因为后续 Gameplay Director 会基于重复关系做 Pattern Evolution。

False Positive 的破坏性比 False Negative 更大。

---

# 29. 不要在本轮生成 gameplay difficulty

不要在 `director_context.json` 输出：

```text
recommended_difficulty
hazard_count
ring_speed
bullet_density
```

这些属于下一层：

```text
Gameplay Director
```

本轮只负责：

> Musical Understanding Context

保证音乐事实尽可能可靠、结构尽可能清晰。

---

# 30. 推荐最终架构

最终音乐处理层大致应该成为：

```text
Audio
  ↓
Rhythm
Energy
Tonal
Stems
Melody
Structure
  ↓
Repetition      ← NEW
Phrasing        ← NEW
Arrangement Diff← NEW
Downbeat Confidence ← NEW
  ↓
Unified Events
Timeline
  ↓
Director Context Builder ← NEW
  ↓
director_context.json
```

未来另一个系统会做：

```text
director_context.json
+
ARENA_PATTERN_CATALOG.json
        ↓
Gameplay Director
        ↓
Arena Blueprint
        ↓
Playability Validator
        ↓
level.json
```

本轮不要跨过这条边界。

---

# 31. 推荐数据职责边界

## Full V2 JSON

保留详细分析：

- 全部 beats
- 全部 onsets
- stems detail
- notes
- timeline
- raw events
- repetition
- phrase hierarchy
- arrangement comparison

## Director Context JSON

只保留导演真正需要的：

- global
- bars
- sections
- phrases
- repeat relationships
- arrangement delta
- layer activity
- melody contour
- important events
- reduced intensity curve
- optional lyrics

两者不要混成同一个超大文件。

---

# 32. 最终产物

代码修改完成后，必须至少交付：

```text
1. repetition analysis
2. phrase hierarchy
3. repeated-section arrangement comparison
4. downbeat / bar phase confidence
5. director_context builder
6. director_context JSON schema
7. Editor download button
8. CLI automatic export
9. tests
10. real-song validation
```

---

# 33. 最终报告

完成后请给我一份简洁但信息完整的报告：

```text
DONE
- files added
- files modified
- algorithms added
- schema added
- UI button added
- tests added
- total test result
- real-song validation result

DIRECTOR CONTEXT
- output path
- file size
- section count
- phrase count
- repeat group count
- repeat comparison count
- important event count
- bar count
- lyrics available or not

COMPATIBILITY
- V2 output still valid: yes/no
- V1 projection still valid: yes/no
- existing tests passing: yes/no

NOT DONE / LIMITATIONS
- ...

NO GIT OPERATIONS PERFORMED
```

如果真实歌曲上 repetition / downbeat 等某项结果置信度不足，要明确报告。

不要为了“任务完成”隐藏低质量结果。

---

# 34. 完成标准

只有以下全部满足才算完成：

- [ ] 现有 V2 流水线未被破坏
- [ ] v1 projection 未被破坏
- [ ] repeat group 可以输出
- [ ] occurrence index 可以输出
- [ ] repeated-section delta 可以输出
- [ ] phrase hierarchy 可以输出
- [ ] phrase 对齐 bar grid
- [ ] downbeat confidence 可以输出或诚实 null
- [ ] director_context.json 自动生成
- [ ] director_context schema validation 通过
- [ ] Director Context 不复制大量 raw events / notes / onsets
- [ ] Editor 中出现 Download Director Context 按钮
- [ ] 点击可下载正确 JSON
- [ ] 真实歌曲完整跑通
- [ ] 全部测试通过
- [ ] 没有修改任何游戏模式
- [ ] 没有进行任何 git 操作

---

## 最终原则

这一轮的目标不是让 Editor “更复杂”。

目标是让它从：

> 很强的音频分析器

变成：

> **可靠的音乐理解数据供应器。**

最终我只需要把：

```text
director_context.json
```

和之后生成的：

```text
ARENA_PATTERN_CATALOG.json
```

一起交给关卡设计 Agent。

前者告诉它：

> 音乐发生了什么、哪里重复、哪里增强、音乐各层怎样变化。

后者告诉它：

> Arena 目前实际能做什么。

之后才进入真正的：

```text
Music → Gameplay
```

关卡导演阶段。
