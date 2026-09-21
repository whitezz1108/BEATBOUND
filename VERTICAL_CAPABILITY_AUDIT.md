# BeatBound VERTICAL — 完整运行时能力审计（VERTICAL_CAPABILITY_AUDIT）

- 审计模式: **READ-ONLY RUNTIME AUDIT**（未修改任何 gameplay 代码；未执行任何 git 操作）
- 唯一事实来源: 当前工作区源码与 `beatbound_library_v1/` JSON（审计日期 2026-09-20）
- **2026-09-21 独立复核修订**:更正 2 处与代码不符的结论——① spawn lead/approach **不**随 tier×intensity 缩放（§1/§5/§12/§13）;② 同 lane 错拍重叠 hold 的第二个必 MISS（§7/§9/§15）。其余结论经逐行复验无误。
- 审计规范: `prompt/audit prompt/BeatBound_VERTICAL_Capability_Audit_Prompt.md`
- 机器可读版本: `VERTICAL_CAPABILITY_CATALOG.json`（同目录）

---

## 0. 结论速览

| 指标 | 数值 |
|---|---|
| Runtime-usable mechanic（注册且可从 JSON 触达） | **4**（V01, V02, V03, V04） |
| 其中真实可玩行为 | **3** 种：tap / chord tap / hold（V04 被扁平化为普通 hold） |
| VERTICAL 库 pattern（patterns.mvp.json） | **9**（VP01–VP09） |
| 含 VERTICAL 段落的 level | **4**（vertical_test, prototype_90s, test_song, dance_fruits…toosie_slide） |
| Unreachable / dead 实现 | **1 个引擎子系统**（drift 车道切换路径）+ 1 个被解析但丢弃的参数（V04 `path`） |
| Metadata-only / no-op 字段 | **10** 项（见 §16.3） |
| Autoplay / assist | **不存在**（仅有 dev 用 `?invincible` URL 开关，不禁用判定） |

---

## 1. 完整运行链（spec §4）

```
level JSON (song/sections/patterns+repeat+intensity)
→ LevelLoader.build()  [src/core/LevelLoader.ts]
    validate: patternId/mechanicId 存在性、mode 匹配(warning)、bar 重叠、intensity 0..1
    compile: ConstantTempoMap(bpm, timeSignature)、placement 展平为绝对 startBar
→ PatternScheduler.schedulePlacement()  [src/core/PatternScheduler.ts]
    activationBeat = patternStartBeat + barBeatToAbsolute(at.bar, at.beat) + (at.offsetBeats ?? 0)
    若 activationBeat ≥ section.breatherFromBeat（mode 切换前 max(6 beats, 3s)）→ 事件被静默跳过
    spawnBeat = activationBeat − registry.spawnLeadBeats(mechanicId)   (= 库 telegraph 2,未缩放——见 §5 复核注)
→ MechanicRegistry.create()  [src/core/MechanicRegistry.ts]
    params = {...definition.defaults, ...event.params}
    timing.telegraphBeats = scaleTelegraphBeats(base × tier.telegraphScale, intensity, constraints.minReactionBeats)
    tier = tierForDifficulty(section.difficulty)
→ ModeManager.route  [src/core/ModeManager.ts]   （按 mechanic 定义 mode='VERTICAL' 路由；未激活则 pending 队列，上限 64/模式）
→ VerticalMode.accept → NoteMode.mechanics  [src/modes/vertical/VerticalMode.ts, src/modes/rhythm/NoteMode.ts]
→ spawn：LaneNoteMechanic / HoldNoteMechanic / DriftHoldMechanic 构造 NoteTarget[]
→ approach：Highway.zOf(beatsAway) = Z_HIT + beatsAway × 0.9（3D 透视 highway，纯 beat 函数）
→ input：ctx.input.wasPressed/isDown(车道键)
→ judgement：NoteMode.judge / judgeHold（全部窗口以 beat 计）
→ score / combo / health：RunStatus + HealthManager
→ cleanup：MISSED/BROKEN 滑出屏幕(z < Z_EXIT) → EXPIRED；mechanic 在最后 target +0.6 beat 后 isFinished 被移除
```

Renderer（Highway.ts）只做表现；判定全部在 NoteMode。UI 侧边面板（VerticalMode.renderCombo）只读 `verdictCounts` / `status`，不承载 gameplay 逻辑。

---

## 2. Note / Mechanic Primitive 总表（spec §5）

| ID / Type | 名称 | 当前可用 | 输入类型 | 持续型 | 多 lane | 可组合 | 判定 |
|---|---|---|---|---|---|---|---|
| `V01` | Tap | **AVAILABLE**（`LaneNoteMechanic`） | 单键 keydown edge | 否（但 `params.holdBeats>0` 会使其变 hold，runtime 真实消费） | 单 lane（`lane`）或列表（`lanes`，同 V03 语义） | 是 | PERFECT/NICE/GOOD/MISS |
| `V02` | Hold | **AVAILABLE**（`HoldNoteMechanic` ⊂ LaneNoteMechanic） | keydown edge + 持续 isDown | 是（`holdBeats`） | 单 lane | 是 | 头部同 tap；尾端无判定，自动完成；中途松手超时 → BROKEN |
| `V03` | Double | **AVAILABLE**（`LaneNoteMechanic`，`lanes` 列表） | 多键同拍 keydown edge | 否 | 是（chord，去重后 ≤6） | 是 | 每个 target 独立判定同 tap |
| `V04` | Drift Hold | **AVAILABLE (DEGRADED)**（`DriftHoldMechanic`） | keydown edge + 持续 isDown | 是 | **否——已扁平化**（path 只取首 lane） | 是 | 与 V02 完全相同 |
| drift（引擎能力：多 checkpoint path hold） | — | **NOT REACHABLE FROM CONTENT**（引擎实现完好，无任何 mechanic 再写入 `target.path`） | — | — | — | — | 引擎分支存在（见 §10.3） |

不支持（当前 runtime 无实现、无注册、无消费路径）：flick、slide（非 hold 语义）、drag、跨 lane tap、每 lane 多判定线、touch/mouse 输入、任意键重映射。均写 **NOT SUPPORTED**。

---

## 3. Input Mapping 专项（spec §6）

来源: `src/core/controls.ts`（`VERTICAL_LANE_KEYS`）、`src/core/Input.ts`、`src/modes/vertical/VerticalMode.ts`（LANE_KEYS/LANE_INDEXES/KEY_LABELS）。

- **lane 数**: 6（`LANE_COUNT = 6`，`src/mechanics/vertical/LaneNoteMechanic.ts` 第 19 行；Highway 按此渲染，`LANE_W = 1.08/6 = 0.18`）。
- **lane index 顺序**: 1..6，从左到右（`Highway.laneX(lane) = (lane − 3.5) × LANE_W`）。
- **每 lane 键位**（单一键，无别名、无备选键）:
  | lane | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|
  | key（`event.key.toLowerCase()`） | `a` | `s` | `d` | `j` | `k` | `l` |
- **键位复用**: 不支持——一个 lane 只认自己的一个键；无重映射机制（键表硬编码于 controls.ts，UI 提示同源 `MODE_CONTROLS.VERTICAL` = `A S D · J K L`）。
- **是否允许任意键**: 否。
- **simultaneous inputs 上限**: 代码无上限（`Input.down` 是 Set，任意键同帧均可 pressed）。实际上限 = 6 个不同 lane（每 lane 一键）；同帧 6 键 chord 合法。
- **keyboard rollover**: 代码不做假设；依赖浏览器/OS 对同时按键的上报（N-key rollover 与否是硬件问题，代码层面 `keydown`/`keyup` 按键名独立处理）。`event.repeat` 被过滤（OS 重复不会二次触发）。
- **keydown / keyup 是否都使用**: 是。keydown edge（`wasPressed`，每帧清空）用于 tap 命中与 hold 头部；`isDown`（keyup 后为 false）用于 hold 维持判定；`window.blur` 清空全部按下状态（失焦会令 hold 进入 lapse）。
- **hold 是否要求持续按住**: 是，但有宽限：`holdToleranceBeats = 0.12` beat 内的 lapse 不中断（offBeats 累计/按住时以 2× 速率回落，允许 regrab）。
- **输入 buffering**: **无**。提前于窗口的按下直接丢弃（无 RUNNER 式 jump buffer）；迟到的按下只要还在 ±0.25 beat 窗口内有效。
- **autoplay / assist**: 不存在。唯一相关开关是 dev URL `?invincible`（`src/config.ts` devOptionsFromLocation）——伤害不扣血，但 MISS 判定与计数照常。

---

## 4. Judgement 专项（spec §7）

来源: `src/modes/rhythm/NoteMode.ts`（judge/judgeHold/onJudged）、`src/tuning.ts`（`TUNING.vertical`）。**所有窗口单位是 beat，不是 ms**——BPM 越快，秒数越紧；BPM 影响 = 是；difficulty / intensity 影响 = **无**（窗口恒定）。

| Verdict | 条件（beat） | @120 BPM | @123.05 BPM | score | combo | health | 视觉/听觉反馈 |
|---|---|---|---|---|---|---|---|
| `PERFECT` | \|offset\| ≤ **0.09** | ≤45 ms | ≤43.9 ms | 无分数制（notesHit+1） | +1 | 无损 | sfx `tap_perfect`；impact MEDIUM #6de3ff；pad flash、光柱、ring burst、sparks |
| `NICE` | \|offset\| ≤ **0.16** | ≤80 ms | ≤78.0 ms | 同上 | +1 | 无损 | sfx `tap_good`；impact LIGHT #ffd76d |
| `GOOD` | \|offset\| ≤ **0.25** | ≤125 ms | ≤121.9 ms | 同上 | +1 | 无损 | sfx `tap_good`；impact LIGHT #9affc0 |
| `MISS` | offset > **0.25**（首帧即判） | — | — | notesMissed+1 | **清零** | **−8**（`TUNING.health.damage.MISS`，绕过 0.8s 碰撞无敌帧） | sfx `miss`；impact + shockwave #ff5470；红色空心轮廓继续下落 |

- 命名即真实 identifier：`'PERFECT' | 'NICE' | 'GOOD' | 'MISS'`（NoteMode.ts `Verdict`）。**没有** "Great"，**没有** Early/Late 显示。
- too-early（offset < −0.25）：按下无任何效果、**无惩罚**（无 ghost-tap 惩罚；空 lane 按键也无惩罚）。
- 每 10 combo 里程碑：额外 shockwave + sfx（NoteMode.onJudged）。
- 侧边面板（VERTICAL 左侧, x≈0.105）：combo 大数字、PERFECT/NICE/GOOD/MISS 计数、ACC%（notesHit/(hit+miss)）。这是已验证现状。
- 结算面板只显示 hits taken / notes missed / HP left——**无分数(score)系统**。

---

## 5. Note Travel / Approach（spec §8）

来源: `src/tuning.ts`（`approachBeats: 2`, `worldUnitsPerBeat: 0.9`）、`src/modes/vertical/Highway.ts`。

- hit line: `Z_HIT = 1`（世界系，field y≈0.87）；spawn（首次可见）: `zOf(2) = 1 + 2×0.9 = 2.8`，与渲染的 neon spawn arch 位置一致。
- travel: 纯 beat 函数 `zOf(beatsAway) = Z_HIT + beatsAway × worldUnitsPerBeat`；scroll speed 恒定（**BPM 不改变速度的 beat 几何**，只改变每 beat 的秒数）；与 difficulty 无关。
- **reaction window = approachBeats = 2 beat**：note 首现到 hit time 2 beat（@120 BPM = 1.00 s；@123.05 BPM = 0.975 s）。
- **spawn lead（note 首现提前量）= 未缩放的库 telegraph,恒 2 beat**（`MechanicRegistry.spawnLeadBeats:82-85` 读的是 mechanics.mvp.json 原始 timing,不是 resolveTiming 的产物）。`resolveTiming` 里 tier×intensity 缩放出的 `timing.telegraphBeats` 只存在于 spawn context,**V01–V04 无一读取**。
- 因此 note 恒在 spawn arch（z = zOf(2) = 2.8）处出现、approach 恒 2 beat——**intensity/difficulty 无法缩短它**,也不存在"高强度半路 pop 进来"的行为。（2026-09-21 复核更正,旧版此条有误。）
- 退场: note 尾端过 `Z_EXIT = 0.72`（≈ beat+holdBeats 之后 0.311 beat）→ `EXPIRED`；mechanic 在最后 target +0.6 beat 后被 `isFinished` 移除。

---

## 6. Tap 专项（spec §9）

- lane: `params.lane`（1-based；`readLanes` 做 `Math.round` + clamp 到 1..6 + 去重；非法/缺省回落 `1`）。
- hitTime: `activationBeat = pattern 相对 bar/beat + offsetBeats`（绝对 beat）。
- simultaneous notes: 同拍多 lane 用 `V03`（`lanes: [..]`）或多个事件叠加；无上限代码。
- note size / judgement shape: 视觉 slab 宽 `LANE_W×0.8`（世界系, 0.144），深度 `NOTE_DEPTH=0.15`，高 `NOTE_HEIGHT=0.09`；判定与视觉尺寸**无关**（纯时间窗 × lane 键）。
- too-early: 无效果无惩罚；too-late: 超 +0.25 beat 即 MISSED（−8 HP, combo 清零）。
- ghost tap: 无惩罚。
- **同 lane 最短可区分间隔**: 两 note 间隔 ≤ 2×goodWindow = **0.5 beat** 时窗口重叠——一次按键可同时命中两个 target（双重计分/连击）。>0.5 beat 才保证需要两次独立按下。另注意：连续同 lane note 必须经历一次 keyup→keydown（`wasPressed` 是 edge），按住不放不会连打。

---

## 7. Hold / Long Note 专项（spec §10）

来源: `NoteMode.judgeHold`（src/modes/rhythm/NoteMode.ts 167–201 行）、`HoldNoteMechanic`、`LaneNoteMechanic`。

- **start judgement**: 头部按 tap 判（PERFECT/NICE/GOOD）；命中后 state=`HOLDING`，并播 `hold_start`。
- **end judgement**: **无**。`beat ≥ target.beat + holdBeats` 即自动置 `HIT`，播 `hold_complete` + LIGHT impact —— 尾端不产 verdict、不加分。即使此刻处于 lapse 宽限（键未按下但 offBeats ≤ tolerance）也照常完成。
- **keydown / keyup**: 头部需 keydown edge；期间要求 `isDown(该 lane 键)`。
- **中途松手**: `offBeats` 按 beat 累计（`deltaSeconds/secondsPerBeat`）；超过 `holdToleranceBeats = 0.12` beat → `BROKEN` → `registerMiss`（MISS verdict、−8 HP、combo 清零）。sfx `hold_tick`（每 0.5 beat 一次，gain 0.6）提示持续连接。
- **regrab**: 允许——重新按住时 offBeats 以 2× 速率衰减回 0。
- **tick score**: 无逐 tick 加分（只有音效）。
- **minimum duration**: V01/V02 的 `holdBeats` 可为 0（退化为 tap）甚至负数（等价 tap，`numberOr` 不 clamp）；**V04 下限 0.5 beat**（`Math.max(0.5, holdBeats)`）。
- **maximum duration**: 无。
- **overlap rules / 同 lane hold 重叠**: **无任何检查**。分两种情形（2026-09-21 复核更正,旧版"可同时维持"有误）:
  - **头部同拍** → 一次按压同时把两个 target 送入 HOLDING,各自独立维持/完成——可玩;
  - **头部错开** → 后一个 hold 的起手 edge 在前一个按住期间**不存在**（键未抬起无 keydown）,它保持 PENDING 直到 +0.25 beat 判 **MISSED**（−8 HP）。想打中后一个必须松→按,而松手 >0.12 beat 会先弄断前一个——**实际不可玩**。
- **hold 期间能否按其他 lane**: 能——各 lane 独立键（VP08 即此型）。
- **hold tail 跨 section / mode boundary**: mode 切换时 `NoteMode.deactivate()` 清空 `mechanics`——活动 hold **静默消失、不惩罚**；且切换前 `breatherFromBeat`（max(6 beat, 3s)）起 scheduler 停止 spawn，落在该窗口的 hold/tap 事件**根本不会生成**（静默跳过，level 只在加载时以 warning 汇报 bars 溢出，不汇报此丢弃）。

---

## 8. Drift / Slide / Path Hold 专项（spec §11）

### 8.1 内容层结论：**NOT SUPPORTED BY CURRENT RUNTIME（作为 lane 切换玩法）**

`src/mechanics/vertical/DriftHoldMechanic.ts` 头注释明确："**RETIRED as authored content**: playtesting showed switching keys mid-hold is not humanly keepable, so every path is flattened to its head lane… The engine still understands multi-checkpoint paths (NoteMode.judgeHold, VerticalMode.renderDrift); no pattern authors one any more."

具体行为（代码逐行核实）：
- `DriftHoldMechanic` 构造时 `readPath(params.path)` 解析 `[[beatOffset, lane], ...]` 或 `[{beatOffset, lane}, ...]`（排序、lane clamp 1..6），但**只使用 `path[0].lane`** 作为头部 lane；构造的 NoteTarget **不设置 `path` 字段**（第 39 行注释 "No `path`: a single-lane hold, never a lane-switching drift"）。
- 因此库默认 `V04.defaults.path = [[0,1],[1,2],[2,3],[3,4]]` 以及 VP06/VP07/VP09 事件里的多 checkpoint path **全部被丢弃**，实际生成普通直线 hold。
- holdBeats 取 `params.holdBeats` → 否则 path 末端 beatOffset → 否则 `timing.durationBeats`；下限 0.5。

### 8.2 各 spec 子项（按“若存在才记录”原则）

| 子项 | 现状 |
|---|---|
| path representation | 引擎存在（`NoteSegment { beatOffset, lane }[]`，steps 不是 ramps——`requiredLaneAt` 阶跃取 lane），但内容不可达 |
| node times / source→target lane | 同上（引擎语义），内容不可达 |
| interpolation | 需求侧无插值（checkpoint 阶跃）；视觉 ribbon 画折线作预警——不可达代码 |
| 是否必须同一键 | 已扁平化 → 全程一个键（V04 现状） |
| 是否需要换键 | **不需要**（这正是退休原因） |
| lane change judgement | 引擎分支存在（checkpoint 变化播 `drift_checkpoint`），不可达 |
| path width | 视觉 `LANE_W×0.34` ribbon——不可达代码 |
| simultaneous path / crossing paths | 不存在 |
| min lane-change time | 不存在 |

### 8.3 引擎侧 unreachable 清单（dead-at-content，非 dead-code）

- `NoteMode.judgeHold` 的 `isDrift` 分支与 `TUNING.vertical.driftToleranceBeats = 0.18`（唯一消费者是 path hold，无 producer）。
- `VerticalMode.renderDrift`（`target.path && path.length>1` 分支）。
- `capabilities.requiredLaneAt` / `checkpointIndexAt` 的 path 遍历（HOLDING 状态下 `laneOf` 调用，但 path 恒空 → 恒返回 `target.lane`）。
- `NoteTarget.path` 字段本身及 `offBeats` 的 drift 语义。
- sfx `drift_checkpoint`（AudioFX 已定义，唯一调用点在不可达分支）。

全库（patterns.mvp.json 9 个 VP、4 个 level、labs.ts 的 drift lab trigger）没有任何路径能在运行时产出 `target.path.length>1`。

---

## 9. Chord / Simultaneous Input（spec §12）

- 同拍 2 note: `V03`（库默认 `lanes:[1,4]`；VP04/VP09 用 `[1,4]`、`[2,3]`）。
- 同拍 3/4/5/6 note: runtime **支持**（`readLanes` 接受任意列表，clamp+去重后 ≤6）。库中无 >2 chord。
- runtime 硬上限: 单事件去重后 ≤6 lane（>6 的列表被 clamp 进 1..6 后去重，**静默塌缩**）；跨事件叠加无数组上限。
- 理论上限: 6（每 lane 一键；一帧内一个键只有一个 edge）。
- 同 lane 同时间重复 note: 单事件内被 Set 去重；**跨事件不去重**——两个 V01 事件同拍同 lane → 两个 target，一次按键同hit两个（notesHit+2, combo+2）。
- tap + hold start 同拍同 lane: 同样一次按键双命中（hold target 进 HOLDING，tap 进 HIT）。
- 两个 hold 同 lane 重叠: 仅**头部同拍**时可玩（一按双 HOLD）;头部错开则第二个必 MISSED（见 §7/§15）。
- crossing slides: 不存在（drift 已扁平化）。

---

## 10. Note Density / Human Feasibility（spec §13）

**runtime-legal（代码事实上限）**
- 每 lane 最短间隔: 0（可以同拍叠加），但 ≤0.5 beat 时单次按键可双hit（窗口重叠）。
- 全局 note rate: 无代码上限（可任意堆事件）。机械化上限受“每拍每 lane 一次独立 edge”约束 → 理论极限 6 lane × 每 0.5 beat 一次独立判定 ≈ 12 notes/beat（荒谬值，仅说明无保护）。
- chord 后恢复时间: 无代码约束。
- hold 占用期间可用 lane: 其余 5 个 lane 完全可用。
- impossible input 组合: 无运行时防护（见 §12）。

**human-playable recommendation（基于判定/输入模型推导，非 runtime 强制）**
- 同 lane 最短间隔: **≥1 beat** 舒适；**0.5 beat**（8 分连打, 250ms@120BPM）为短爆发上限；**<0.5 beat 不要用**（窗口重叠 → 判定歧义/双hit）。
- chord 规模: ≤2（库现状）；3–4 可玩但仅限强拍；**不要 >6**（会静默塌缩）。
- chord 后恢复: ≥1 beat 再接下一动作。
- hold 长度: 1–6 beat（库 3–6）；>8 beat 的 hold 无逐 tick 反馈增益，只有 tick 音效。
- 同 lane 相邻 note（含 hold 尾→下一 note 头）之间必须允许一次 keyup→keydown：建议 ≥0.5 beat。

---

## 11. Pattern Library（spec §14）

来源: `beatbound_library_v1/patterns.mvp.json`（mode=VERTICAL, 9 条）。全部只使用 V01/V02/V03/V04。

| Pattern ID | 名称 | lengthBars | note types | lane usage | 密度（events/bars） | difficulty.overall |
|---|---|---:|---|---|---:|---:|
| VP01 | Stair Up | 1 | V01×4 | lane 1→2→3→4 每拍 | 4.0 | 1 |
| VP02 | Sustain | 2 | V02×2 (holdBeats 3) | lane 2, 3 | 1.0 | 2 |
| VP03 | Alternating | 1 | V01×4 | lane 1↔4 每拍 | 4.0 | 2 |
| VP04 | Double Beat | 1 | V03×2 | chords [1,4], [2,3] 每两拍 | 2.0 | 3 |
| VP05 | Taps Into Hold | 2 | V01×3 + V02(4 beat) | lane 1→2→3→hold 4 | 2.0 | 3 |
| VP06 | Drift Up | 2 | V04 (holdBeats 6) | **名义 path 1→4；实际 hold lane 1** | 0.5 | 3 |
| VP07 | Drift Zigzag | 2 | V04 (holdBeats 6) | **名义 zigzag；实际 hold lane 4** | 0.5 | 4 |
| VP08 | Hold Plus Taps | 2 | V02(6 beat, lane1) + V01×5 (lane 3/4) | hold+分离手 tap | 3.0 | 4 |
| VP09 | Vertical Climax | 4 | V03×2 + V01×6 + V04(6 beat) | chords + 4 连 stair + **名义下坡 drift（实际 hold lane 4）** | 2.25 | 5 |

真实存在的 pattern 型：tap streams（VP01/VP03 stair/alternating）、**alternating lanes**（VP03）、**chords**（VP04/VP09）、**holds**（VP02/VP05/VP08）、hold+taps 复合（VP08/VP09）、call-response 雏形（VP05 taps→resolve into hold）。**不存在**：drifts（已扁平化）、trills（<1 beat 交替）、sub-beat（八分/十六分）tap 流、staircase 越过 lane 4 的库 pattern（VP01 只到 lane 4；lane 5/6 无任何库 pattern 使用——运行时可用但库未用）。

含 VERTICAL 段的 level（loader 实测会编译）：
- `vertical_test.level.json`（3 段全 VERTICAL: VP01×8 / VP03×8 / VP04×4+VP03×4；**audio `audio/vertical_test_01.mp3` 不存在 → 回落 click track**）
- `prototype_90s.level.json` S04（VP01×4 + VP03×4）
- `test_song.level.json` S03（editor 生成；VP01/VP03/VP04/VP08/VP09，30 bars）
- `dance_fruits_..._toosie_slide_sped_up.level.json` S03（editor 生成；VP01/VP04/VP02，14 bars, BPM 123.05）

使用 V04 的 level: **无**（4 个 level 的 VERTICAL 段都不含 V04；V04 仅存在于 pattern 库 VP06/VP07/VP09 与 lab 触发器中）。

---

## 12. Sequencing / Authoring API（spec §15）

真实字段（`patterns.schema.json` / `level.schema.json` / `src/core/types.ts`，loader/scheduler 实际消费已标注）：

**pattern 事件**（`PatternEvent`）:
- `at.bar`（int ≥1, 1-based）— 消费
- `at.beat`（number ≥1, 允许小数 1.5/2.5）— 消费
- `at.offsetBeats`（number, beat 微调, 加在 bar/beat 之后）— 消费（`specToRelativeBeats`）
- `mechanicId`（string）— 消费
- `params`（自由对象，与 mechanic defaults 浅合并）— 消费
- `role`（PLAYER_A/PLAYER_B/BOTH/SYSTEM）— **仅透传到 mechanic.role，无 gameplay 效果**（无双人输入拆分）

**pattern 定义**:
- `id, name, mode, function`（function **metadata-only**）、`lengthBars`（布局用，消费）、`difficulty{overall,reaction,rhythmComplexity,spatialComplexity,inputComplexity,informationLoad}`（**全部 metadata-only**）、`musicTags`（metadata-only）、`events`、`notes`（文档）
- `constraints.minReactionBeats` — **消费**（telegraph 下限）
- `constraints.maxSimultaneousThreats` — **未消费**（仅类型声明）
- `constraints.requiresMechanics` — **未消费**（仅类型声明）

**placement**（section.patterns[]）: `patternId`、`repeat`（默认 1）、`intensity`（默认 0.5，校验 0..1）。
**section**: `id, startBar, lengthBars, mode, function`（metadata）、`difficulty`（1–5；对 V 无 gameplay 效果,仅环境氛围能量,见 §13）、`patterns`、`transitionOut`（作为切换动画的文字 id 显示）、`course`（RUNNER-only；VERTICAL section 写 course 会报 error "courses are RUNNER-only"）。
**song**: `id, title, audio, bpm, timeSignature`（ConstantTempoMap; `beatsPerBar = timeSignature[0]`）。

没有名为 `bar/beat/durationBeats/lane/path/repeat/subdivision` 的顶层通用字段；`durationBeats` 只以 `event.params.durationBeats` 或 mechanic library timing 形式存在（被 `resolveTiming` 与 V02 的 `pickPositive` 消费）。没有 pattern 级 `repeat` 字段（repeat 在 placement 上）。

---

## 13. Difficulty / Scaling（spec §16）

| 输入 | 运行时实际效果 |
|---|---|
| `section.difficulty` 1–5 | 对 VERTICAL gameplay **零效果**（2026-09-21 复核更正）。tier（1→EASY ×1.5、2→MEDIUM ×1.25、3→HARD ×1.0、4/5→INTENSE ×0.9,`tierForDifficulty` 未设按 2）只写进 resolved `timing.telegraphBeats`,V01–V04 无一读取;spawn lead 用未缩放库 telegraph。唯一实际消费者是 `BeatBoundGame.sectionEnergy():420-426` → **背景氛围粒子**（非 gameplay）。判定窗、approach、密度均不变。 |
| `placement.intensity` 0–1 | 对 VERTICAL gameplay **零效果**（2026-09-21 复核更正）。`scaleTelegraphBeats` 的缩放只落在 resolved timing（V 机制不读）;approach 恒 2 beat。`scaleCount/scaleSpeed/scaleDensity` 本就无 V mechanic 调用。越界 0..1 仍是 load error。 |
| `pattern.difficulty.*`（6 项） | metadata-only，无消费者。 |
| note speed | 恒定（`approachBeats 2` / `worldUnitsPerBeat 0.9`），无任何缩放入口。 |
| window scale | 不存在——判定窗不随 difficulty/intensity/BPM(以 beat 计) 变化。 |
| lane complexity | 不存在（LANE_COUNT 恒 6）。 |

---

## 14. Runtime Safety / Validation（spec §17）

存在的保护（代码证实）：
- lane clamp: 所有 lane 输入 `round` + clamp 1..6（`readLanes` / `clampLane`）；空/非法回落 lane 1。
- loader 校验: 未知 patternId/mechanicId（error）、mode 不匹配（warning）、bar 重叠（error）、intensity 越界（error）、pattern 占用超出 section（warning）。
- mode 切换 breather: 切换前 max(6 beat, 3s) 停止 spawn；切换时 `deactivate()` 清空全部 mechanics；`pending` 队列上限 64/mode（超出丢最旧并计 `droppedSpawns`）。
- 失败清理: FAILED 时 `clearSchedule()` + `clearHazards()`；渲染 stall（>0.35s）自动暂停回退。
- `holdBeats` 下限: 仅 V04（0.5）；V01/V02 无下限。

**不存在的保护**：
- 无 note-vs-note overlap check（同 lane 同拍重复不合并）。
- 无 same-lane spacing / min note spacing 检查。
- 无 chord cap（>6 lane 静默塌缩）。
- 无 hold-overlap / hold-tail-vs-next-head 冲突检查。
- 无 chart 级可行性模拟（RUNNER 有 traversalSim/fairness-check；VERTICAL 没有对应物——`tools/fairness-check.ts` 只审计 ARENA 事件）。

> **No runtime chart-feasibility guarantee detected.**（针对 note 拥挤/冲突）

---

## 15. 已知危险 / 不可能谱型（spec §18，以输入状态机为准）

**IMPOSSIBLE**
1. 同拍 >6 lane chord：`readLanes` clamp+去重后最多 6 —— 超出需求被静默塌缩，无法表达。
2. “按住不放连打”：`wasPressed` 是 edge，同 lane 相邻 note（含 hold 尾之后的同 lane 头）若玩家不松开重按，第二个必 MISSED。谱面要求 <0.5 beat 同 lane 双按等价于此。
3. 跨 lane 滑动的 drift hold（内容层）：V04 扁平化后无任何表达手段（NOT SUPPORTED）。

**HIGH RISK**
1. 同 lane 间隔 ≤0.5 beat 的双 note：±0.25 窗口重叠，一次按键双hit（双重计分）或两次按键中一记落窗外 → MISS，判定歧义。
2. 事件落在 mode 切换 breather 内（section 末尾 max(6 beat, 3s)）：**静默不生成**——编谱器以为有 note，玩家看到空场。
3. 同 lane 错拍重叠双 hold：第二个的起手 edge 不存在 → 必 MISSED（−8 HP）；强行松→按则先断第一个（>0.12 beat）。（头部同拍的 chord-hold 除外,那是一按双 HOLD,可玩。）
4. 长 hold 尾 + 紧接同 lane note（间隔 <0.5 beat）：需在 0.12 beat 宽限内松键再按，极易 BROKEN/MISS。
5. `?invincible` 之外无 failsafe：3 连 MISS = −24 HP（MISS 伤害绕过无敌帧），25% 血量瞬间蒸发。

**CONDITIONAL**
1. VP06/VP07/VP09 的 "drift"：可玩（退化为 hold），但难度标注（inputComplexity 4–5）与实际不符。
2. 失焦/切窗：`blur` 清空按键 → 活动 hold 0.12 beat 后 BROKEN（属预期行为，自动暂停 mitigate）。

---

## 16. Metadata-only / dead / unreachable 汇总（spec §0 强约束要求的区分）

### 16.1 Unreachable（引擎实现完好，内容不可达）
1. **Drift path 系统**：`NoteMode.judgeHold` drift 分支 + `driftToleranceBeats(0.18)` + `VerticalMode.renderDrift` + `requiredLaneAt/checkpointIndexAt` 的 path 遍历 + sfx `drift_checkpoint`。唯一 producer `DriftHoldMechanic` 已不再写 `target.path`。

### 16.2 Parser 接受但 runtime 不消费/丢弃
2. `V04 params.path`（含库默认与 VP06/VP07/VP09 的 path）：被 `readPath` 解析后**只取首 lane**，其余丢弃。
3. `V01 params.holdBeats`：**会**被消费（>0 时 V01 变 hold）——此条是“接受且消费”，但与 mechanic 文档语义不符，列为 authoring 陷阱而非 dead。
4. `params.cooldownBeats` → `recoveryBeats`：解析进 ResolvedTiming，V mechanic 无消费者。
5. `event.role`（PLAYER_A/B/BOTH）：透传，无 gameplay 效果。

### 16.3 Metadata-only 字段（JSON 有、runtime 无消费者）
6. `pattern.difficulty`（overall + 5 子分）
7. `pattern.function`、`section.function`
8. `pattern.musicTags`、`mechanic.musicTags`、`mechanic.playerSkills`、`mechanic.compatibility`
9. `pattern.constraints.maxSimultaneousThreats`、`pattern.constraints.requiresMechanics`
10. `mechanic.status`（MVP/OPTIONAL/STRETCH）、`mechanic.difficulty`、`mechanic.notes`
11. 陈旧提示文案：`levels.index.json` vertical_test blurb "Hit D F J K"、`editor/rules/transition-rules.json` "VERTICAL: D F J K lanes" —— 实际键位是 **A S D J K L**（controls.ts 为唯一事实来源）。
12. VP06/VP07 的 `notes` 文案仍描述 lane 滑动（"slide lane 1 -> 4"）——与运行时行为不符。

---

## 17. 音乐亲和（spec §19）

依据 `mechanics.mvp.json` / `patterns.mvp.json` 的 `musicTags`（**注意：这是 metadata，供 Director 选型参考，runtime 不消费**）+ 已验证的机械行为：

| Gesture / 谱面动作 | 适用 primitive | 建议映射 |
|---|---|---|
| kick / 强拍 | V01 | 每拍单 tap（VP01 型）；lane 可跟旋律声部 |
| snare / backbeat | V01 | 2/4 拍 tap，与 kick 错 lane |
| hi-hat / subdivision | V01 | **0.5 beat 间隔流是上限**（窗口重叠风险），不建议更细 |
| bass pulse | V03 | 双音 chord（库默认 [1,4]） |
| melody contour | V01 序列 | lane 序列跟随音高走向（VP01 stair 即型） |
| vocal syllables | V01 | 每 syllable 一 tap |
| sustain vocal / 长音 | V02 / V04(实际 hold) | hold 3–6 beat（VP02/VP06 型） |
| arpeggio | V01 快速序列 | 跨 lane staircase，≥0.5 beat/音 |
| build | V03→V01 密度抬升 | chord 领入（VP04→VP03 型） |
| drop | VP09 型 | chord + stair + 长 hold 叠加 |
| phrase boundary | V02 长 hold 收尾 | hold 作乐句解决 |

---

## 18. Safe Generation Bounds（spec §20，机器可读版见 catalog `safe_generation_bounds`）

```json
{
  "lane_count": 6,
  "min_same_lane_interval_seconds_beats": 0.5,
  "recommended_same_lane_interval_beats": 1.0,
  "max_runtime_chord_size": 6,
  "recommended_max_chord_size": 2,
  "min_hold_duration_beats_v04": 0.5,
  "min_hold_duration_beats_v01_v02": 0,
  "recommended_hold_duration_beats": [1, 6],
  "min_lane_change_time": null,
  "approach_time_beats": 2,
  "judgement_windows_beats": { "perfect": 0.09, "nice": 0.16, "good": 0.25 },
  "hold_lapse_tolerance_beats": 0.12,
  "mode_change_silence_before_boundary_beats": "max(6, 3s-in-beats)"
}
```

---

## 19. 真实 JSON 示例（spec §21 —— 当前 parser 真正接受的写法）

VERTICAL note 只能通过 **pattern event** 进入 runtime（level → patterns.mvp.json）。以下均为 `beatbound_library_v1/patterns.mvp.json` schema 校验通过、且被当前 runtime 按所述行为消费的最小/进阶形态：

**V01 Tap — minimal**
```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "V01", "params": { "lane": 3 } }
```

**V01 Tap — advanced（lane 5；注意 lane 5/6 库 pattern 未用但 runtime 支持）**
```json
{ "at": { "bar": 2, "beat": 2.5, "offsetBeats": 0 }, "mechanicId": "V01", "params": { "lane": 5 } }
```

**V03 Double（chord）— minimal**
```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "V03", "params": { "lanes": [1, 4] } }
```

**V03 — advanced（3-key chord；runtime 接受，超库惯例）**
```json
{ "at": { "bar": 1, "beat": 3 }, "mechanicId": "V03", "params": { "lanes": [1, 3, 6] } }
```

**V02 Hold — minimal**
```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "V02", "params": { "lane": 4, "holdBeats": 4 } }
```

**V02 Hold — advanced（不写 holdBeats → 用 event timing.durationBeats 或库默认 2）**
```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "V02", "params": { "durationBeats": 3 } }
```

**V04 Drift Hold — 当前真实行为（path 被接受但扁平化）**
```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "V04",
  "params": { "path": [[0, 1], [2, 2], [4, 3], [6, 4]], "holdBeats": 6 } }
```
→ 运行时 = **lane 1 的 6-beat 直线 hold**（path 中 lane 2/3/4 丢弃；无换键需求）。

**parser 接受但会产生意外行为的写法（勿用）**
- `{ "mechanicId": "V01", "params": { "holdBeats": 2 } }` → V01 变成 2-beat hold。
- `{ "mechanicId": "V03", "params": { "lanes": [1, 8, 0, -2] } }` → clamp+去重后 = lanes [1, 6]（0、-2 → 1，8 → 6 后去重）。
- 任何出现在 section 末尾 breather（max(6 beat, 3s)）内的 event → 静默不 spawn。

---

## 20. VERTICAL DESIGNER CHEAT SHEET（spec §23）

```
Lane count / keys ........ 6 lanes: 1=A 2=S 3=D 4=J 5=K 6=L（单键/lane，不可重映射；controls.ts 唯一来源）
Current note types ....... V01 Tap / V02 Hold / V03 Double(chord) / V04 Drift Hold(已扁平化=直线 hold)
Hold capabilities ........ 头部 tap 判定 → 持住 holdBeats；lapse 宽限 0.12 beat（可 regrab）；尾端自动完成无判定；
                           中断 = BROKEN = MISS(−8 HP, combo 清零)；无同 lane 冲突检查；跨 mode 边界的 hold 被静默清除
Drift/slide capabilities . NOT SUPPORTED（引擎保留，内容层不可达——V04 path 只取首 lane）
Chord capabilities ....... 无硬上限；实际 ≤6（每 lane 一键）；库最大 2；>6 lane 列表被 clamp+去重静默塌缩
Judgement windows ........ PERFECT ≤0.09 beat / NICE ≤0.16 / GOOD ≤0.25 / MISS >0.25（beat 制，BPM 越快越紧；
                           @120BPM = 45/80/125 ms）；无 Early/Late；early 无惩罚；无 ghost-tap 惩罚
Approach time ............ 2 beat（@120BPM = 1.0s）；恒速 0.9 world-units/beat；intensity/difficulty 只改变
                           note 首次出现的位置（spawn lead），不改变到线的行程速度
Safe chart-generation bounds
                           同 lane 间隔 ≥1 beat（硬下限 0.5，低于此窗口重叠/双hit）
                           chord ≤2（硬上限 6）；chord 后恢复 ≥1 beat
                           hold 1–6 beat（V04 下限 0.5）
                           section 末尾 max(6 beat, 3s) 是 spawn 禁区（事件静默丢弃）
Best mappings for drums .. kick→V01 强拍, snare→V01 反拍, hi-hat→V01 0.5-beat 短流（上限）, bass→V03 chord
Best mappings for melody . melody contour→V01 lane 序列(stair), arpeggio→跨 lane ≥0.5 beat/音
Best mappings for vocals . syllable→V01, sustain→V02/V04 hold 3–6 beat
Current hard limitations . 无分数制；判定窗/速度不可调（无 difficulty 缩放）；lane 5/6 无库 pattern；
                           无 autoplay；无输入缓冲；无任意键重映射；DUO role 字段无效果
Known impossible/high-risk
                           IMPOSSIBLE: >6 lane chord（塌缩）；同 lane 按住连打（需 keyup→keydown）；lane 切换 drift
                           HIGH RISK: 同 lane ≤0.5 beat 双 note（窗口重叠）；breather 内事件静默丢失；
                                      同 lane 重叠 hold；hold 尾紧接同 lane note
```

---

## 21. 完成前自检（spec §24）

- [x] runtime chain（§1）
- [x] note primitives（§2）
- [x] input mapping（§3）
- [x] judgement windows（§4）
- [x] note travel / approach（§5）
- [x] tap（§6）
- [x] hold（§7）
- [x] drift/slide（§8 — NOT SUPPORTED at content level，引擎 unreachable 已区分）
- [x] chord（§9）
- [x] human feasibility（§10，runtime-legal 与 human recommendation 已分开）
- [x] pattern library（§11）
- [x] sequencing（§12）
- [x] difficulty（§13 — spawn-lead-only 已标明）
- [x] runtime validation（§14 — "No runtime chart-feasibility guarantee detected"）
- [x] risks（§15）
- [x] JSON examples（§19）
- [x] machine-readable catalog（VERTICAL_CAPABILITY_CATALOG.json）
- [x] no code modification
- [x] no git operations
