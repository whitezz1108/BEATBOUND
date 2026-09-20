# BeatBound RADIAL — Complete Capability Audit (READ-ONLY)

日期:2026-09-20(修订:同日,修正 8-way chord 可达成性结论,补齐 dead/metadata 清单)· 审计范围:**仅 RADIAL 模式运行时能力**
配套机读目录:`RADIAL_CAPABILITY_CATALOG.json`
审计规范:`prompt/audit prompt/BeatBound_RADIAL_Capability_Audit_Prompt.md`

> 本报告只记录**当前代码实际能运行的能力**,以当前工作区代码为唯一事实来源。
> 未修改任何 gameplay 代码、未修改 Editor、未执行任何 git 操作。
> 所有行号以当前工作区文件为准。无法确认之处明确标注 UNKNOWN / NEEDS RUNTIME VERIFICATION。

---

## 0. 结论摘要(Executive Summary)

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| Runtime 可用 RADIAL mechanic 原语 | **3** | D01 / D02 / D06,全部在 `src/mechanics/radial/index.ts:7-12` 注册,且被 `src/game/BeatBoundGame.ts:163`(`registerRadialMechanics`)实际接线 |
| 库内 RADIAL pattern(DP) | **11** | DP01–DP11,全部只引用 D01/D02/D06 → **全部可达** |
| 完全 dead 的注册实现 | **0** | 3 个注册项全部可达;但存在共享层 dead surface(见 §14.1,共 6 项) |
| RADIAL JSON 层不可达的 runtime(实现存在但不可授权) | **1 组** | hold/drift 判定机器(`NoteMode.judgeHold` + `RadialMode.isHeld`)在 RADIAL 永不触发(两个 mechanic 硬编码 `holdBeats: 0`) |
| metadata-only / 运行时不消费的字段 | **8 项** | 见 §14.2 |
| **真实方向数** | **8** | `DIRECTION8 = N NE E SE S SW W NW`(`src/core/direction8.ts:17`)。**8 方向已完整接线(渲染/判定/解析三处证据)** |
| Note 类型 | **tap only** | 无 hold、无 long、无离(中)心 note、无随机化 |

**一句话回答审计目标(§3)**:当前 RADIAL runtime 真正支持 **8 个方向**;输入模型是"4 个 cardinal 键(↑↓←→ 或 WASD),对角方向 = 两个相邻 cardinal 同按(90 ms 容差,Option B)";note 原语只有**方向 tap**(单发 D01 / 同拍方向和弦 D02 / 步进序列 D06),全部**沿固定方向直线向中心收拢**;判定与 VERTICAL 共用 `NoteMode`,窗口以 beat 计;clockwise/counterclockwise/star/spiral 全部是 **D06 `sequence` 的数据排序**,不存在弧线行进或旋转 travel。

---

## 1. 完整运行链(Runtime Call Chain)

```
beatbound_library_v1/*.level.json           sections[].patterns[] → { patternId, repeat, intensity }
  + patterns.mvp.json                       patterns[].events[] → { at:{bar,beat,offsetBeats}, mechanicId, params, role }
  + mechanics.mvp.json                      D01/D02/D06 的 timing + defaults
        │
        ▼  src/config.ts:9-14               DATA.mechanics='/mechanics.mvp.json', DATA.patterns='/patterns.mvp.json'
        │                                   (vite.config.ts 把 beatbound_library_v1/ 作为 web root;没有第二份数据副本)
        ▼  src/core/LevelLoader.ts:132-147  load()/loadLibraries():fetch 三层 JSON
        ▼  LevelLoader.ts:167-247           validate():
        │                                     - pattern.mode !== section.mode 只是 WARNING(:221-223),不是错误
        │                                     - intensity 必须 0..1,缺省 0.5,越界是 error(:226-229)
        │                                     - event.mechanicId 必须存在于 mechanics 库(:232-235)——只查"数据",不查"实现";
        │                                       缺实现由 BeatBoundGame.reportReadiness(:580-593)单独 console 提示
        ▼  LevelLoader.ts:326-384           compile(): ConstantTempoMap(bpm, timeSignature)(:328)
        │                                     - pattern 在 section 内按声明顺序首尾相接(:339-347)
        │                                     - leadInBeats = min(section 用到的最大库 telegraph, 1 bar)(:369)
        │                                     - breatherFromBeat = section 末拍 − max(6 beat, 3秒→beats)(:375-378)
        ▼  src/game/BeatBoundGame.ts:159-163 registry.loadLibrary + registerRadialMechanics
        ▼  BeatBoundGame.ts:186             modes.register('RADIAL', ctx => new RadialMode(ctx))   ← 模式接线点
        ▼  src/core/PatternScheduler.ts:74-132 schedulePlacement():
        │     activationBeat = patternStartBeat + (at.bar-1)*beatsPerBar + (at.beat-1) + (offsetBeats ?? 0)   (:84)
        │     activationBeat ≥ breatherFromBeat 的事件直接不 spawn(:89)
        │     spawnBeat = activationBeat − spawnLeadBeats(= max(库原始 telegraphBeats, 注册 lead),不缩放)(:95;MechanicRegistry.ts:82-85)
        │     seed = hash(patternId:startBar:repeatIndex:eventIndex)(:96,确定性;RADIAL mechanic 不消费 seed)
        ▼  src/core/MechanicRegistry.ts:110-136 create():
        │     params = { ...definition.defaults, ...event.params }(:126,event 覆盖库默认)
        │     timing = resolveTiming(:138-154,telegraph 受 tier/intensity/minReactionBeats 缩放 —— 但 RADIAL 两个 mechanic 从不读它,见 §9)
        │     tier = tierForDifficulty(section.difficulty)(:134)
        │     无实现 → 返回 null 并 warn 一次(:110-121)
        ▼  factory(src/mechanics/radial/index.ts:7-12):
        │     'D01' → DirectionNoteMechanic      'D02' → DirectionNoteMechanic(与 D01 同一类)
        │     'D06' → ClockwiseMechanic
        ▼  ModeManager.route(info)按 definition.mode 路由(src/core/ModeManager.ts:117-130)
        │     模式未激活 → pending 队列(上限 64,溢出丢最旧并计 droppedSpawns,:56-57,123-127)
        ▼  NoteMode.accept(NoteMode.ts:97-100)→ this.mechanics[]
        ▼  RadialMode.update(:54-66):先逐 cardinal 采样本帧 keydown 边沿(pressedAt/freshThisFrame 快照),
        │   再 super.update → NoteMode.update(:102-119)对每个 PENDING/HOLDING target 执行 judge
        │   (outcome ≠ 'PLAYING' 时停止判定,:104)
        ▼  NoteMode.judge(:130-160):offset = beat − target.beat;
        │     offset > 0.25 → MISSED(registerMiss → status.damage('MISS'));
        │     offset < −0.25 → 早按无效、无惩罚、不缓存;
        │     否则 RadialMode.justPressed(target)(:76-100)通过 → HIT;
        │     verdict = |offset| ≤ 0.09 PERFECT / ≤ 0.16 NICE / ≤ 0.25 GOOD
        ▼  score/combo:status.registerNoteHit()(RunStatus.ts:49-51)、combo++(NoteMode.ts:156-158)
        ▼  health:MISS = TUNING.health.damage.MISS = 8 HP(tuning.ts:64-65),**刻意绕过** 0.8s 碰撞无敌
        │   (HealthManager.ts:75-76;NoteMode.ts:203-209);HP ≤ 30% UI 告警(tuning.ts:73-74)
        ▼  cleanup:
        │     - mechanic isFinished:DirectionNoteMechanic.ts:30-32 = activationBeat+0.6 之后;
        │       ClockwiseMechanic.ts:33-36 = 最后一个 target beat+0.6 之后;NoteMode.update 过滤(:116-118)
        │     - MISSED note 继续向心,isOffscreen(radius ≤ 0.012,RadialMode.ts:112-115)→ EXPIRED;
        │       但 D01/D02 的 mechanic 在 +0.6 beat 即整体移除(此时半径 ≈ 0.031,先于 0.012 的过期点 ≈ +0.715 beat)
        │     - activate/deactivate/clearHazards 清空(NoteMode.ts:82-95);死亡 onDeath 调
        │       clock.clearSchedule + modes.clearHazards(BeatBoundGame.ts:435-441)
```

**关键结论**:RADIAL 没有独立 pattern 解释器;pattern 只是 event 列表,能力全部在 2 个 mechanic 类里(D01/D02 共用 `DirectionNoteMechanic`,D06 用 `ClockwiseMechanic`);绘制完全由 `RadialMode.renderNote` 统一完成(mechanic 自身 `render()` 为空,DirectionNoteMechanic.ts:38-40)。

---

## 2. 方向系统专项 —— 8 方向已完整接线(最重要)

事实来源:`src/core/direction8.ts`(全代码库方向派生的唯一入口)。**Runtime currently supports 8 directions** —— 不存在任何 4 方向分支。

### 2.1 权威表

| Direction | 角度(canvas 系,x 右 **y 向下**,DEG :23-25) | 屏幕位置 | 单位向量(:31-38) | Glyph(:40-43) | 颜色(:45-48) | 输入成分(:51-54) | JSON 接受的拼写(:84-98) |
|---|---:|---|---|---|---|---|---|
| N  | −90° | 上 | (0, −1) | ↑ | #6de3ff | `[N]` | `N`/`UP`/`NORTH` |
| NE | −45° | 右上 | (≈0.707, ≈−0.707) | ↗ | #7cf5d0 | `[N, E]` | `NE`/`UP_RIGHT`/`NORTH_EAST` |
| E  | 0°   | 右 | (1, 0) | → | #ffc46d | `[E]` | `E`/`RIGHT`/`EAST` |
| SE | 45°  | 右下 | (≈0.707, ≈0.707) | ↘ | #ff9e6d | `[S, E]` | `SE`/`DOWN_RIGHT`/`SOUTH_EAST` |
| S  | +90° | 下 | (0, 1) | ↓ | #ff8ec4 | `[S]` | `S`/`DOWN`/`SOUTH` |
| SW | 135° | 左下 | (≈−0.707, ≈0.707) | ↙ | #d18cff | `[S, W]` | `SW`/`DOWN_LEFT`/`SOUTH_WEST` |
| W  | 180° | 左 | (−1, 0) | ← | #9a8cff | `[W]` | `W`/`LEFT`/`WEST` |
| NW | 225° | 左上 | (≈−0.707, ≈−0.707) | ↖ | #8cb8ff | `[N, W]` | `NW`/`UP_LEFT`/`NORTH_WEST` |

- `parseDirection` 大小写不敏感、trim(direction8.ts:85)。**非法值不会报错**:`readDirections` 静默丢弃非法项,D01/D02 全部非法时回退 `['N']`(DirectionNoteMechanic.ts:47-53);D06 全部非法时回退完整 8 步顺时针 `[...DIRECTION8]`(ClockwiseMechanic.ts:48-52)。
- **判定 receptor**:每方向在判定环上的锚点 = 圆心 + 方向向量 × `RING_RADIUS`(RadialMode.ts:107-110)。没有独立 receptor 对象——receptor 就是环上该角度处的一段弧。
- **renderer 表示**(RadialMode.ts:135-168, 170-221):8 条方向辐条 + 环外 0.052 处的方向 glyph(对角字号 14、cardinal 17);正在输入的方向高亮(`isDirectionActive` :123-133);**cardinal note 画成圆盘半径 0.027,对角 note 画成方形(半边长 0.024)**(:206-218);每方向用 `DIRECTION_COLOUR` 自己的颜色;命中时从锚点扩出涟漪环(0.5 beat,:178-186);miss 后空心红圈 `#ff5470` 继续飞向中心(:188-194);判定环随 beat 脉冲(:164-167)。
- **8 方向接线验证**:注册(index.ts:8-11)→ RadialMode 渲染循环直接遍历 `DIRECTION8`(:138)→ 两个 mechanic 均接受全部 8 方向 → 库内 DP03/DP04/DP05/DP07–DP11 实际使用对角方向。**verified。**

---

## 3. Input Mapping(machine-readable)

事实来源:`src/core/direction8.ts:57-62`(`CARDINAL_KEYS`)、`src/core/Input.ts`、`src/modes/radial/RadialMode.ts:54-133`、`src/tuning.ts:277-278`。

```json
{
  "cardinal_keys": {
    "N": ["arrowup", "w"],
    "E": ["arrowright", "d"],
    "S": ["arrowdown", "s"],
    "W": ["arrowleft", "a"]
  },
  "diagonal_entry": {
    "model": "two_adjacent_cardinals_down_simultaneously (§30 Option B)",
    "NE": ["N", "E"], "SE": ["S", "E"], "SW": ["S", "W"], "NW": ["N", "W"],
    "tolerance_seconds": 0.09,
    "tolerance_source": "TUNING.radial.diagonalToleranceSeconds (src/tuning.ts:277-278)",
    "rule": "两键都按住 + 其中一键是本帧新按下 + 两键按下时刻差 ≤ 0.09s(RadialMode.ts:81-88)",
    "tolerance_clock": "RadialMode.now 累积 deltaSeconds(真实时间),与 BPM 无关"
  },
  "cardinal_refusal": {
    "rule": "cardinal 目标拒绝'作为对角一半'的按键:另一相邻 cardinal 按住且其按下时刻与本次 ≤ 0.09s 时不触发(RadialMode.ts:92-99)",
    "opposite_exempt": "对向 cardinal(N+S、E+W)不构成对角,互不阻塞,各自独立触发(isDiagonalPair,direction8.ts:73-76;diff===2 或 6)",
    "stale_adjacent_key": "相邻键按住超过 0.09s 后:不阻塞新主键判定,也不能再补成斜向(斜向目标同样要求两键 ≤0.09s)"
  },
  "keydown_keyup": "window keydown/keyup;event.repeat 被过滤(Input.ts:19);wasPressed 仅本帧有效,endFrame() 每帧清空(Input.ts:40-47);blur 清空全部状态(Input.ts:24)",
  "prevent_default": ["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d", "f", "j", "k", "1", "2", "3", "4"],
  "hold_state": "isDown 逐 cardinal 查询;仅当存在 holdBeats>0 的 target 才有意义 —— RADIAL 中不可达(§6)",
  "input_buffer": "无(早于判定窗的按键直接无效且不缓存,NoteMode.ts:144-145)",
  "simultaneous_input_cap": "无 runtime 上限(仅受浏览器 n-key rollover 限制 —— UNKNOWN at hardware level)",
  "press_consumption": "非消耗式:一次按键可同时满足多个 pending 目标(同向双 note 双得分;NE+SE 可共享一次 E 按键)",
  "opposite_directions_simultaneous": "允许且被 D02 依赖:两次独立按键 = 两次独立 HIT",
  "adjacent_directions_simultaneous": "≤0.09s 内按下读作一个对角方向;同拍相邻 cardinal 双目标因此无法双双命中(§8.2)",
  "frame_snapshot": "每帧先采样 4 主键边沿(freshThisFrame),再统一判定,chord 内所有目标看到同一输入快照(RadialMode.ts:54-66)"
}
```

键位提示 UI 与实现共享 `CARDINAL_KEYS`(`src/core/controls.ts:5-9` 注释明确 UI 不允许硬编码副本);`MODE_CONTROLS.RADIAL` = `DIRECT ↑←↓→ or W A S D`(controls.ts:55-58),用于 count-in 与模式切换倒计时(BeatBoundGame.ts:509-511, 536-539)。

---

## 4. 全部 Radial Note / Mechanic Primitive 总表

| ID | 名称(库) | runtime 类 | 方向数 | Tap/Hold | 移动 | 同拍组合 | 判定 |
|---|---|---|---:|---|---|---|---|
| D01 | Single | `DirectionNoteMechanic` | 单方向,event 一个 target | tap | 直线向心 | — | 4 档(§7) |
| D02 | "Opposite Double" | `DirectionNoteMechanic`(与 D01 同类) | `directions` 列表 1–8 向(Set 去重) | tap ×N | 直线向心 | 是(列表全部同 beat) | 每方向独立 4 档 |
| D06 | Clockwise | `ClockwiseMechanic` | `sequence` 任意长 | tap ×N | 直线向心 | 否(每 `stepBeats` 一个) | 每音独立 4 档 |

- **命名纠偏(legacy 名)**:D02 并不要求对向 —— `readDirections` 接受**任意**方向列表;D06 并不锁定顺时针 —— `sequence` 完全由数据决定(库默认 4 主向顺时针;代码级回退全 8 步顺时针,仅当 sequence 显式为空/全非法时触发,ClockwiseMechanic.ts:48-52)。
- mechanics.mvp.json 中 mode=RADIAL 的定义恰好 3 条;`registerRadialMechanics` 注册恰好这 3 条;`MechanicRegistry.unimplementedIn('RADIAL')` 语义下无缺口。**无 registered-but-never-dispatched 项。**
- `dangerShapes()` 恒 `[]`(DirectionNoteMechanic.ts:34-36,ClockwiseMechanic.ts:38-40)→ RADIAL 运行时**零碰撞体**;唯一伤害来源是 MISS。
- `isFinished`:D01/D02 = `activationBeat + 0.6` beat;D06 = 最后一个 target beat + 0.6。
- 事件 `role`(PLAYER_A/PLAYER_B/BOTH/SYSTEM,DUO 预留)与确定性 `seed` 被传入但 RADIAL mechanic 均不消费。

### 不存在的 primitive(JSON 层不可达,明确 NOT SUPPORTED)

| 能力 | 状态 |
|---|---|
| hold / long note | **NOT SUPPORTED**(`holdBeats` 硬编码 0;§14.1#1) |
| drift / path hold | **NOT SUPPORTED**(`path` 为 VERTICAL lane 语义,capabilities.ts:44-49) |
| 离心 / outward note | **NOT SUPPORTED**(travel 硬编码向心,`radiusAt` 单调递减) |
| double tap 专属机制 | 可用两个事件拼出,无专用 mechanic |
| 随机/permuted 方向 | **NOT SUPPORTED**(radial mechanic 不消费 seed,随机性不在 runtime) |

---

## 5. Spawn / Travel Geometry

事实来源:`src/modes/radial/RadialMode.ts:32-36, 112-121, 170-221`。

| 项 | 值 | 出处 |
|---|---|---|
| centre point | 场地归一坐标 (0.5, 0.5) | :32 `CENTRE` |
| spawn radius | 0.46(场地单位,1 = 短边) | :36 `SPAWN_RADIUS` |
| judgement radius | 0.13 | :34 `RING_RADIUS` |
| note 可见起点 | radius ≤ SPAWN_RADIUS + 0.06 = 0.52(剔除阈) | :197 |
| travel 模型 | **固定方向直线向中心**:`radius = RING + (beatsAway / approachBeats) × (SPAWN − RING)`,对 beat 严格线性、无 easing(`easeOutCubic` 只用于命中涟漪) | :117-121 |
| travel duration | `TUNING.radial.approachBeats` = **2 beats**(120 BPM = 1.0 s),**固定,JSON/难度/intensity 均不可改** | tuning.ts:268-270 |
| travel speed | (0.46−0.13)/2 = 0.165 场地单位/beat,恒定 | 推导 |
| incoming/outgoing | **仅 incoming(向心)**。外向扩张是 ARENA 的 A10/RadialBurst,与本模式无关 | 全文件仅向心公式 |
| 行进中旋转/弧线/径向扩张 | **都没有**;"clockwise" 只是 D06 里方向**排序**,不是运动轨迹 | 全文件无角度随时间变化逻辑 |
| miss 后 | 继续同速穿过判定环飞向中心,radius ≤ 0.012 时 EXPIRED(:112-115);D01/D02 的 mechanic 在 activation+0.6 beat 先被移除(表现层截断,非判定问题) | NoteMode.ts:110-115 |
| telegraph(视觉预警) | **没有独立 telegraph 图形**;预警就是接近本身。⚠️ **D06 的 spawn lead = 库 telegraph = 1 beat < approach 2 beat → 序列第一个 note 在半径 ≈ 0.295 处(半途)出现,可见接近只有 1 beat;后续 note 有完整 2-beat 接近**。D01/D02 lead = 2 beat 恰好从 rim 入场 | MechanicRegistry.spawnLeadBeats(:82-85)+ D06 库 timing.telegraphBeats=1 |
| 尾迹 | 沿方向臂向后 0.05 长度的渐隐线 | :203-204 |

---

## 6. Tap / Hold / Special Gesture 真实支持

| 手势 | 状态 | 依据 |
|---|---|---|
| tap(单方向) | **SUPPORTED** | D01 |
| chord(同拍多方向) | **SUPPORTED**(D02 `directions` 列表,任意方向子集,单 event 内 Set 去重) | DirectionNoteMechanic.ts:47-53 |
| opposite pair | **SUPPORTED**(D02 默认;对向按键互不阻塞,记两次 HIT) | RadialMode.ts:13-15, 92-99 |
| adjacent pair(相邻 cardinal 同拍) | **runtime 合法但事实不可玩**:0.09s 内的两键被读成一个对角方向,两个 cardinal 目标都无法触发(§8.2) | RadialMode.ts:92-99 |
| diagonal(对角) | **SUPPORTED**(两键组合,90ms 容差;两键均须保持到判定帧) | RadialMode.ts:81-88, 102-105 |
| rotation sequence(CW / CCW / star / spiral ordering) | **SUPPORTED,全部是 D06 `sequence` 数据排序**;库内 DP02/DP04/DP05/DP09/DP10 | ClockwiseMechanic.ts:48-52 |
| alternating(cardinal↔diagonal 交替) | **SUPPORTED**(数据层面;DP07) | patterns.mvp.json DP07 |
| hold / long | **NOT SUPPORTED(授权层)**。`NoteTarget.holdBeats` 被两个 mechanic 硬编码为 0(DirectionNoteMechanic.ts:25,ClockwiseMechanic.ts:28);JSON 无任何参数可产生 RADIAL hold。共享判定管线(judgeHold,NoteMode.ts:167-201;isHeld,RadialMode.ts:102-105)存在且对 holdBeats>0 的 target 有效,但 **runtime 消费、JSON 层不可达**(hold 容差常量甚至挂在 `TUNING.vertical.*` 下,tuning.ts:261-264) | — |
| double(同向同拍) | 无专用机制;单 event 内重复方向被去重;跨 event 的同向同拍双目标会被**一次按键同时满足、双计分**(无 guard) | DirectionNoteMechanic.ts:52 |
| call-response | 无专用机制/pattern;可手工用交替方向近似 | — |

---

## 7. Judgement(完整)

事实来源:`src/modes/rhythm/NoteMode.ts:23, 69-80, 130-209` + `src/tuning.ts:267-275`。窗口单位是 **beat**(随 BPM 缩放),括号内为 120 BPM 换算。

| 档位 | 窗口(\|offset\|) | 120 BPM | 反馈 |
|---|---|---|---|
| PERFECT | ≤ 0.09 beat | ±45 ms | sfx `direction_perfect`,MEDIUM impact,#6de3ff |
| NICE | ≤ 0.16 beat | ±80 ms | sfx `direction_hit`,LIGHT impact,#ffd76d |
| GOOD | ≤ 0.25 beat | ±125 ms | sfx `direction_hit`,LIGHT impact,#9affc0 |
| MISS | offset > 0.25 beat(晚) | >125 ms late | sfx `miss`,红环冲击波,**−8 HP** |

- **early/late 完全对称**(`Math.abs(offset)`,:151-154);无逐毫秒 early/late 区分。
- **早按**:早于 −0.25 beat 的按键无效果、不惩罚、不缓存(:144-145)。
- **方向错误**:justPressed 返回 false,无惩罚;note 超窗后按 MISS 结算。
- **同拍多 target**:每个 target 独立判定,共享同一帧输入快照 → 一次按键边沿可同时满足多个同拍同方向 target(:54-66 快照 + judge 循环)。
- **hold release / BROKEN**:RADIAL 不可达(无 hold)。
- **Combo**:命中 +1,MISS 归零;每 10 combo 触发 `radial_combo` sfx + shockwave(:236-241);bestCombo 记录。
- **Score**:没有分数系统。RunStatus 只有 `notesHit / notesMissed / hits` 与 accuracy;`verdictCounts` 在 NoteMode 累计但 **RadialMode 不渲染**(只有 VerticalMode.ts:187 覆写渲染)。statusLine = `RADIAL notes:x/y (acc%) combo:c/best last:patternId`。
- **Health**:全局共用 100 HP 池;MISS −8(tuning.ts:64-65),**刻意绕过 0.8s 碰撞无敌**(HealthManager.ts:75-76;NoteMode.ts:203-205);13 次 MISS 即死(104 ≥ 100);命中不回血。
- 判定前提:`status.outcome === 'PLAYING'`(:104)。

---

## 8. Simultaneous Directions(§11)

**runtime 合法性**(代码事实)与**人类可行性**分开陈述:

| 问题 | runtime 事实 | 可玩性 |
|---|---|---|
| 同一 hit time 能有几个 target | **无上限**:一个 D02 event 可列任意多方向(Set 去重后 ≤8 个有意义的不同方向);多个 event/pattern 重叠可再叠加;无 chord cap | — |
| 同方向 duplicate | 单 event 内去重为 1 个 target(:52);跨 event 各自成 target,**一次按键全部命中、全部计分**(无去重、无惩罚、无 guard) | 污染统计,生成器应避免 |
| opposite pair | 支持(D02 默认形态);两次独立按键 = 两次独立 HIT | ✅ 可玩 |
| adjacent pair(同拍相邻 cardinal) | 合法存在,但 ≤0.09s 内按下被读作对角 → **两个 cardinal 目标都无法命中**;>0.09s 分开按则各自成立(但须都落进 ±0.25 beat 窗) | ❌ 事实不可玩(§8.2) |
| 4-way cardinal chord(N+E+S+W) | 合法;四键齐按(≤0.09s)时每对相邻键两两成斜向,**实际读作 NE+SE+SW+NW 四斜向 chord,4 个 cardinal target 全部被拒** | ❌ 不能按 4 主向得分 |
| **8-way chord(全 8 向同拍)** | 合法存在;**但不可全清**:4 键同一瞬间按下最多命中 4 个斜向 target;4 个 cardinal target 因互阻规则在该拍无法成立。要命中一个 cardinal 必须让相邻键的按下时刻差 >0.09s,而这同时使对角目标的 90ms 组合窗失效 —— 8 个同拍 target 无法被一次性全清 | ❌ |
| 单一瞬间最多可命中几个同拍 target | **4**(四键齐按 → 4 个对角);纯 cardinal 同拍最多 2(一对手向) | — |
| `constraints.maxSimultaneousThreats` | **metadata-only**,无 runtime 消费者 | — |

### 8.2 相邻 cardinal 同拍双目标的确切行为(RadialMode.ts:92-99)

按下 N(t0)后 0.05s 按下 E(t0+0.05),对同拍的 N、E 两个目标:
- N 目标:fresh N ✓,但 E 按住且 |0.05| ≤ 0.09 且 isDiagonalPair(N,E) → **拒绝**;
- E 目标:fresh E ✓,N 按住且差 0.05 ≤ 0.09 → **拒绝**;
- 两个 target 最终都 MISS(各 −8 HP)。两键间隔 > 0.09s 则各自正常触发。

### 8.3 对角对(如 NE+SW)同拍

NE 要求 N+E 按住(其一 fresh,差 ≤0.09s);SW 要求 S+W 同理。四键同帧按下 → 两个对角 target 同时满足 ✓。NE+SE 组合可通过 N→E→S 链式按压(两两 ≤90ms)共享 E 键一次命中。

---

## 9. Difficulty / Scaling(§14)—— 对 RADIAL 基本是 metadata-only

| 字段 | 来源 | RADIAL 真实消费者 |
|---|---|---|
| `placement.intensity` 0..1 | level JSON(缺省 0.5,越界是 error,LevelLoader.ts:226-229) | ① `resolveTiming` telegraph 缩放(MechanicRegistry.ts:142-150)→ **RADIAL mechanic 从不读 timing → 无游戏性效果**;② `sectionEnergy()`(BeatBoundGame.ts:422-429)取 `placements[0].intensity` → 背景粒子/环境能量。**对 RADIAL 玩法 = no-op(仅氛围)** |
| `section.difficulty` 1..5 | level JSON(缺省 2) | ① `tierForDifficulty` → tier(MechanicRegistry.ts:134)→ **RADIAL mechanic 忽略 tier**;② sectionEnergy(氛围);③ leadInBeats 的 telegraph 上限(LevelLoader.ts:369)。**对 RADIAL 玩法 = no-op(仅氛围)** |
| `approachSpeed` | **不存在**(approach 恒 2 beat,无 JSON 参数) | NOT SUPPORTED |
| `noteDensity` / `windowScale` / `directionComplexity` | **不存在**(全代码库无此参数) | NOT SUPPORTED |
| pattern 六维 `difficulty` 元数据 | patterns.mvp.json | **无 src 运行时消费者**(仅 editor/generator 工具链读)→ metadata-only |
| `constraints.minReactionBeats` | patterns.mvp.json | 唯一消费者 `scaleTelegraphBeats`(Intensity.ts:23-27,下限 max(0.6, minReactionBeats))→ 结果被 RADIAL 忽略 → 对 RADIAL metadata-only |
| `constraints.maxSimultaneousThreats` / `requiresMechanics` | patterns.mvp.json | **src 无任何消费者**(全库 grep 只有 types.ts 声明与 editor 工具)→ metadata-only |
| 事件级 `params.telegraphBeats / durationBeats`(authoring escape hatch,MechanicRegistry.ts:142,151) | pattern event | 被解析进 ResolvedTiming,但 radial mechanic 不读 → **无可观测效果** |

**结论:RADIAL 的难度 100% 来自 pattern 排布本身(方向组合、步长、密度)。spawn lead 用的是库原始 telegraph(不缩放,MechanicRegistry.ts:82-85),连"对象何时创建"都不受 intensity/difficulty 影响。**

---

## 10. Timing Resolution(§13)

- 事件时刻:`at: { bar, beat, offsetBeats? }`;bar/beat 1-based,`beat` 允许任意小数(TempoMap.ts:13;PatternScheduler.ts:83 "Fractional beats (2.5) … fall out of this for free");`offsetBeats` 叠加任意小数偏移(specToRelativeBeats,TempoMap.ts:48-50)。→ **authoring resolution = 任意小数 beat**(1/4、1/8、1/16、任意 offset 全部合法;ConstantTempoMap 下秒 = beat × 60/BPM)。无量化/对齐校正。
- `stepBeats`(D06):任意 `Number.isFinite && > 0` 的数(ClockwiseMechanic.ts:54-56);**没有上限**,序列可伸出 pattern 长度之外(LevelLoader 只对 event.at.bar 越界 warning,ClockwiseMechanic 的 targets 不参与该检查)。
- 库内实证:DP09/DP11 `stepBeats: 0.5`(八分音);RP08(RUNNER)使用 `beat: 1.5`;无 RADIAL pattern 实际使用 `offsetBeats`,但 parser 完全接受。
- 判定窗以 beat 计 → 时间精度需求随 BPM 自动缩放;`diagonalToleranceSeconds` 例外,是真实时间(0.09s),不随 BPM 变。

---

## 11. Pattern Language(§12)—— 只记录真实存在的

11 个库 pattern(DP01–DP11)全部由 D01/D02/D06 组成:

| 能力 | 支持 | 真实载体 |
|---|---|---|
| clockwise rotation | ✓ | DP02(4 步)、DP04(8 步)、DP11 后半(0.5 beat 步进) |
| counterclockwise rotation | ✓ | DP05(sequence 逆序) |
| ping-pong | ⚠️ 无专用 pattern(可用 D06 手工序列表达) | — |
| opposite | ✓ | DP06、DP08、DP11 前半(D02) |
| cross(主向十字) | ✓ | DP06(N/S → W/E) |
| diagonal cross | ✓ | DP08(NE/SW → NW/SE) |
| spiral ordering | ✓(方向排序) | DP09:N E S W NE SE SW NW @0.5 beat |
| star / 跳步 ordering | ✓ | DP10(+3 步跳:N SE W NE S NW E SW) |
| random / permuted directions | ✗ 无随机化 runtime;radial mechanic 不消费 seed | — |
| call-response | ✗ 无专用机制/pattern(可手工近似) | — |
| burst(同拍 chord) | ✓ 数据层面 = D02 多方向列表;库内最大 2 向;runtime 可写更多但见 §8 可玩性 | — |
| stream(连续流) | ✓ DP09/DP11(0.5 beat 步进 8 连) | — |

---

## 12. Human / Input Feasibility(§15)

基于真实键位与状态机。**runtime 无任何 hard guard**;以下"最短间隔"是判定窗/输入模型推导,非代码强制:

| 项 | 值 |
|---|---|
| 单方向最短间隔(runtime guard) | **无**。窗口 ±0.25 beat;同向间隔 < 0.25 beat 时窗口重叠 → 一按双得(2 hit、2 combo,MISS 才扣血所以此处 0 伤害);库内最密 = 0.5 beat(DP09/DP11) |
| 相邻方向切换最短间隔(runtime) | 无 guard;cardinal↔cardinal 需松旧按新(每次新边沿);对角→对角可保持两组键(如 N+E → S+W 四键同按) |
| 对向切换 | 两键独立,无互斥、无惩罚 |
| diagonal 是否需要两键组合 | **是**,且两键须在 0.09s 内按下并保持到判定帧 |
| simultaneous chord limit(runtime) | 无代码上限;物理 4 主键 → 单一瞬间最多命中 4 个同拍 target(全为对角);distinct 方向授权上限 8 |
| hold 占用 | 无 hold(无占用概念) |
| 同时 opposite 是否冲突 | 不冲突(刻意豁免,RadialMode.ts:13-15) |
| 硬 guard 声明 | **没有 runtime radial-chart feasibility guarantee,也没有 dedicated input guard**。`src/core/fairness.ts` 只被 ARENA mechanic 引用(grep 证实),与 RADIAL 模式无关 |

---

## 13. Runtime Safety(§16)

| 检查项 | 存在? |
|---|---|
| overlap prevention | ✗ |
| duplicate direction check | 单 event 内去重(Set);跨 event/mechanic 无检查 |
| min spacing guard | ✗ |
| chord cap | ✗(唯一物理上限:4 主键) |
| active note cap | ✗(NoteMode 无上限;ModeManager pending 队列 64 只管"模式未激活时"的 spawn 缓冲,溢出丢最旧,ModeManager.ts:56-57,123-127) |
| transition cleanup | ✓ 三层:breather(≥breatherFromBeat 的 event 不 spawn,PatternScheduler.ts:89)+ 模式切换 deactivate 清空(NoteMode.ts:89-91)+ 死亡 clearSchedule/clearHazards(BeatBoundGame.ts:435-441) |
| 失焦保护 | ✓ blur 清空按键状态(Input.ts:24) |
| 离线可行性工具 | ✗ 无 RADIAL 专用 checker:`tools/fairness-check.ts` 只过滤 ARENA pattern(:188);`tools/runner-check.ts` 仅 RUNNER;`tools/sync-test.ts`(`npm run test:timing`)用真实库无头验证**调度激活时刻**(含 RADIAL),不验证可玩性;`tools/level-report.ts` 无 radial 专项 |

> **No runtime radial-chart feasibility guarantee detected.**

---

## 14. Dead / Unreachable / Metadata-only 清单

### 14.1 dead code / JSON 层不可达(共 6 项)

| # | 项 | 位置 | 定性 |
|---|---|---|---|
| 1 | RADIAL hold 授权路径 | DirectionNoteMechanic.ts:25、ClockwiseMechanic.ts:28(`holdBeats: 0` 硬编码);判定管线 NoteMode.ts:167-201 + RadialMode.ts:102-105 存在 | **implemented but unreachable from RADIAL JSON** |
| 2 | `rotate()` / `opposite()` | direction8.ts:101-109 | 导出函数,src 内零外部消费者(opposite 仅被 rotate 自身)—— dead helper(旋转语义完全由 D06 数据表达) |
| 3 | `RADIAL_DIRECTIONS` 常量 | capabilities.ts:27 | 兼容别名,全库无 import —— dead alias(`RadialDirection` **类型**经 NoteTarget 存活) |
| 4 | `CARDINALS` / `DIAGONALS` 常量 | direction8.ts:20-21 | 无消费者(RadialMode 自建 `CARDINAL_LIST`,:38-39)—— dead const |
| 5 | `radial_climax` SFX | AudioFX.ts:28, 74 | 定义了音色但全代码库无触发点 —— metadata-only SFX(direction_hit / direction_perfect / radial_combo 均真实使用,NoteMode.ts:226-238) |
| 6 | section `scene.effects` 字段 | 出现于 editor 生成的 level(dance_fruits…level.json S04、editor/output/level.json S04);`SectionDefinition`(types.ts:130-158)无此字段,LevelLoader 不读 | **parser 接受(JSON 合法)但 runtime 不消费** —— metadata-only |

### 14.2 metadata-only / 对 RADIAL 玩法 no-op(共 8 项)

1. `resolveTiming` 的 telegraph/duration/recovery(MechanicRegistry.ts:138-154)——为 D01/D02/D06 计算但两个 mechanic 类零引用 `this.timing`。
2. placement `intensity` → 无游戏性效果(仅氛围能量,BeatBoundGame.ts:422-429)。
3. section `difficulty` → tier 被 RADIAL 忽略(仅氛围 + leadIn 上限)。
4. pattern 六维 `difficulty` 元数据 —— src 无消费者。
5. `constraints.maxSimultaneousThreats` —— src 无消费者。
6. `constraints.requiresMechanics` —— src 无消费者。
7. `constraints.minReactionBeats` —— 只喂给被 RADIAL 忽略的 telegraph 缩放。
8. mechanic 库的 `musicTags` / `playerSkills` / `compatibility` / `status` / `difficulty`(D01/D02/D06 条目)—— 运行时不读(musicTags 仅 editor/generator/patternIndex.js 消费)。`compatibility` 引用的 D01/D02/D06 均真实存在,**无幽灵引用**(与 ARENA 库的 A14/A15 幽灵引用不同)。

另:`role`(PLAYER_A/PLAYER_B/BOTH/SYSTEM)与 `seed` 随事件携带,RADIAL 均不消费(DUO 预留管线)。
文档漂移:`levels.index.json` 中 radial_test 的 blurb 写 "Four directions converging on the centre ring",而 runtime 支持 8 向 —— 纯描述性元数据,不影响运行。

---

## 15. 音乐亲和(§17)—— 只在真实能力范围内

| 音乐素材 | RADIAL 真实映射(现有 mechanic 内) |
|---|---|
| kick / bass(强拍) | D02 对向 chord(库 musicTags: KICK/BASS;DP06/DP11 实例 —— musicTags 本身是元数据) |
| snare | D01 单发 tap(方向任选) |
| hi-hat / 细分 | D06 高细分 `stepBeats`(0.5 = 八分;任意细分可写) |
| melody 上行/下行 | **D06 自定义 sequence 排序** = 唯一的"方向进行"表达(DP04 顺时针 / DP05 逆时针);注意 note 轨迹仍是直线向心,旋律感只来自方向排序 |
| arpeggio | D06 旋转/跳步序列(DP09 spiral、DP10 star) |
| vocal syllable | D01 单点方向 cue |
| call-response | 无专用机制;可手工用交替方向组近似 —— 库内无此 pattern |
| phrase boundary | D02 多方向 chord(数据上可堆到 8 向;人类可玩上限见 §8) |

**约束**:所有映射只有 tap 一种动作;approach 恒定 2 beat;无音高/力度/持续参数。

---

## 16. Safe Generation Bounds(§18)

```json
{
  "safe_generation_bounds": {
    "direction_count": 8,
    "min_same_direction_interval_seconds": null,
    "min_same_direction_interval_note": "no runtime guard; library-densest = 0.5 beats (DP09/DP11); < 0.25 beat 同向间隔窗口重叠导致一按双得",
    "min_same_direction_interval_beats_recommended": 0.5,
    "max_runtime_chord_size": null,
    "max_runtime_chord_size_note": "targets/beat 无上限;单 D02 event 去重后 ≤8 个不同方向;同一瞬间 4 键最多命中 4 个 target(全为对角)",
    "max_scoreable_targets_single_instant": 4,
    "recommended_max_chord_size": 2,
    "approach_time": "2 beats fixed (TUNING.radial.approachBeats, src/tuning.ts:268-270); D06 first note effectively 1 beat",
    "min_direction_change_interval": null,
    "min_direction_change_interval_note": "no runtime guard; 同拍相邻 cardinal 对事实不可玩;对角组合窗 0.09s(真实时间)",
    "hold_capable": false,
    "judgement_window_beats": { "perfect": 0.09, "nice": 0.16, "good": 0.25 },
    "authoring_resolution": "arbitrary fractional beat + offsetBeats + fractional stepBeats"
  }
}
```

---

## 17. Pattern Library(§19)

全部来自 `beatbound_library_v1/patterns.mvp.json`(唯一被加载的 pattern 库,src/config.ts:9-14);71 个 pattern 中 RADIAL 占 11:

| Pattern ID | 名称 | directions used | timing(beat) | note types | difficulty.overall | 库 function |
|---|---|---|---|---|---:|---|
| DP01 | Cardinal | UP DOWN LEFT RIGHT(=N S W E) | 每 beat 1 个,D01×4 | tap | 1 | TEACH |
| DP02 | Clockwise | UP RIGHT DOWN LEFT | D06 stepBeats 1 | tap 序列 | 2 | PRACTICE |
| DP03 | Diagonal Cycle | NE SE SW NW | 每 beat 1 个,D01×4 | tap(对角) | 2 | TEACH |
| DP04 | Clockwise 8 | N NE E SE S SW W NW | stepBeats 1,跨 2 bar | tap 序列 | 3 | PRACTICE |
| DP05 | Counterclockwise 8 | N NW W SW S SE E NE | stepBeats 1 | tap 序列 | 3 | PRACTICE |
| DP06 | Cross Double | [UP,DOWN] + [LEFT,RIGHT] | beat 1 / beat 3,D02×2 | tap chord(2) | 3 | CLIMAX |
| DP07 | Cardinal Diagonal Alternation | N, SE, W, NE | 每 beat 1 个 | tap 混合 | 4 | VARIATION |
| DP08 | Diagonal Opposite Pairs | [NE,SW] + [NW,SE] | beat 1 / beat 3,D02×2 | tap chord(2,对角) | 4 | COMBINE |
| DP09 | Spiral 8 | N E S W NE SE SW NW | stepBeats **0.5** | tap 流 | 4 | VARIATION |
| DP10 | Star | N SE W NE S NW E SW(+3 跳) | stepBeats 1 | tap 序列 | 4 | VARIATION |
| DP11 | Radial Climax | 4 个对向对 + CW8 | D02×4(beat 1-4)+ D06 stepBeats 0.5 | tap chord + 流 | 5 | CLIMAX |

全部 11 个 DP 声明 `constraints.minReactionBeats: 0.5`(元数据,不被 RADIAL 消费)。

**消费这些 pattern 的 level(可达性证明,全部在册于 levels.index.json)**:
- `radial_test.level.json`:D-T01 DP01×8 → D-T02 DP02×8 → D-T03 DP06×4+DP02×4(120 BPM)。
- `prototype_90s.level.json`:S03(DP01×4+DP02×4,intensity 0.45/0.6)、S07(DP06×4,intensity 1)。
- `test_song.level.json`(editor 生成):S04(DP01、DP09×4、DP03)。
- `dance_fruits_musicsteve_void_-_toosie_slide_sped_up.level.json`(editor 生成):S04 CLIMAX difficulty 4(DP01、DP06×4、DP11、DP03;`scene.effects` 被 runtime 忽略,§14.1#6)。
- Polish Labs(`src/lab/labs.ts:299-327`):lab 18 `radial-8dir-input`(DP01/DP03/DP07 + 一键触发 D01 NE)、lab 19 `radial-8dir-patterns`(DP04/DP05/DP08/DP09/DP10)、lab 20 `radial-combined`(DP01→DP11 全链)。labs 经 `spawnOneShot`/同一 loader 编译管线(BeatBoundGame.ts:126-131, 147-153),lab 面板显示 RADIAL 调参行(LabController.ts:159-162:windows/diagonal tolerance/approach)。

---

## 18. 真实 JSON 示例(§20)—— 当前 parser 真正接受的形态

### 18.1 D01 单方向 tap(minimal)

```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "D01", "params": { "direction": "N" } }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "D01", "params": { "direction": "UP_RIGHT" } }
```
省略 `params` 时取库默认 `direction: "UP"`(mechanics.mvp.json D01.defaults)。方向可为 §2.1 表中任一拼写。

### 18.2 D02 同拍方向 chord

```json
{ "at": { "bar": 5, "beat": 3.5 }, "mechanicId": "D02", "params": { "directions": ["NE", "SW"] } }
```
列表内 Set 去重;非法项静默过滤,全非法回退 `["N"]`。也可用单数 `direction`(等价 D01)。

### 18.3 D06 方向序列(advanced)

```json
{ "at": { "bar": 9, "beat": 1 }, "mechanicId": "D06",
  "params": { "sequence": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], "stepBeats": 0.5 } }
```
`sequence` 省略/全非法 → 完整 8 步顺时针;`stepBeats` 省略 → 库默认 1;非法(≤0/非数)→ 回退 1;无上限、可小数。**没有任何参数能产生 hold 或改变 approach/窗口。**

### 18.4 完整最小 pattern + level 引用

```json
{
  "id": "RADIAL_MIN",
  "name": "Minimal Radial",
  "mode": "RADIAL",
  "function": "TEACH",
  "difficulty": { "overall": 1, "reaction": 1, "rhythmComplexity": 1, "spatialComplexity": 1, "inputComplexity": 1, "informationLoad": 1 },
  "lengthBars": 1,
  "events": [
    { "at": { "bar": 1, "beat": 1 }, "mechanicId": "D01", "params": { "direction": "N" } },
    { "at": { "bar": 1, "beat": 2, "offsetBeats": 0.5 }, "mechanicId": "D06",
      "params": { "sequence": ["W", "S", "E"], "stepBeats": 0.5 } }
  ]
}
```

level 侧:

```json
{ "id": "S1", "startBar": 1, "lengthBars": 1, "mode": "RADIAL", "function": "TEACH", "difficulty": 1,
  "patterns": [ { "patternId": "RADIAL_MIN", "repeat": 1, "intensity": 0.5 } ], "transitionOut": null }
```

`role`、`constraints`、`musicTags`、section `scene` 可写但 runtime 不消费(§14)。

---

## 19. RADIAL DESIGNER CHEAT SHEET(§22)

```text
Actual direction count ............ 8(N NE E SE S SW W NW)— 完整接线,verified
Direction → angle → key mapping ... (canvas 角度,y 向下;每 cardinal 有 arrow+WASD 两键)
  N  −90°  ↑   → arrowup | w
  NE −45°  ↗   → (arrowup|w) + (arrowright|d) 同按,≤90ms
  E    0°  →   → arrowright | d
  SE  45°  ↘   → (arrowdown|s) + (arrowright|d)
  S   90°  ↓   → arrowdown | s
  SW 135°  ↙   → (arrowdown|s) + (arrowleft|a)
  W  180°  ←   → arrowleft | a
  NW 225°  ↖   → (arrowup|w) + (arrowleft|a)
Current note types ................ 方向 tap(单发 D01 / 同拍 chord D02 / 步进序列 D06),全部直线向心
Current hold capabilities ......... NOT SUPPORTED(管线在、授权路径死)
Current chord capabilities ........ D02 任意方向子集去重 1–8 向,runtime 无上限;同一瞬间最多命中 4 target;
                                    对向 pair 可玩;相邻 cardinal 同拍 pair 事实不可玩;4 主向齐按读作 4 斜向
Clockwise/CCW pattern support ..... 完整(D06 sequence 数据表达;DP02/04/05/09/10);仅方向排序,无弧线 travel
Timing resolution ................. 任意小数 beat(at.bar/at.beat 1-based + offsetBeats + stepBeats;库内最细 0.5)
Judgement windows ................. PERFECT ≤0.09 / NICE ≤0.16 / GOOD ≤0.25 beat(对称);MISS >0.25;120BPM=45/80/125ms
Approach time ..................... 恒定 2 beat(rim 0.46 → ring 0.13,直线,线性);D06 首 note 仅 1 beat;无 approachSpeed 参数
Miss cost ......................... −8 HP/音(绕过 0.8s 无敌帧)+ combo 清零;HP 100,≤30% 告警
Safe autogeneration bounds ........ direction_count 8;chord ≤2;同向/换向 ≥0.5 beat(惯例值非强制);
                                    禁止同拍相邻 cardinal 对;对角两键 ≤90ms;步长 ≥0.5 beat
Best melody mappings .............. 旋律轮廓 → D06 自定义 sequence;琶音 → D06 spiral/star 序;长音 → 无(无 hold)
Best drum mappings ................ kick/bass → D02 对向 double;snare → D01;hi-hat → D06 @0.5 beat 流
Current hard limitations .......... 仅 tap;approach/窗口/方向数/容差全部硬编码于 TUNING.radial;
                                    intensity/difficulty 不改变玩法(仅氛围);无分数系统(仅命中率+combo);
                                    无随机化;无离(中)心 note;无 runtime 可玩性保障
Known impossible/high-risk ........ 同拍相邻 cardinal 对(0.09s 内按下互拒,双双 MISS);
                                    全 8 向同拍 chord(4 键齐按只命中 4 斜向,cardinal 全拒);
                                    同向 <0.25 beat(一按双得,污染统计);跨 event 同向同拍(无 guard);
                                    D06 首音中途入场(视觉);stepBeats 过小(<0.25)或序列伸出 pattern
```

---

## 20. 完成前自检(§23)

- [x] runtime chain(§1,逐文件行号)
- [x] actual direction count = 8(§2)
- [x] 8-direction wiring **verified**(渲染/判定/解析三处证据)
- [x] input mapping(§3,machine-readable)
- [x] note primitives(§4,3 个 + 不存在项明确标注)
- [x] spawn/travel geometry(§5,含 D06 首音瑕疵)
- [x] judgement(§7,档位/伤害/无敌帧绕过)
- [x] simultaneous inputs(§8,runtime legality vs 人类可行性分开;修正"8-way chord 可达成"的早期误判)
- [x] pattern language(§11)
- [x] timing resolution(§10)
- [x] difficulty(§9,metadata-only + 证据链)
- [x] feasibility(§12,无 hard guard 已明确)
- [x] runtime safety(§13,无可行性保障已声明)
- [x] pattern library(§17,11 pattern 全表 + 4 level + 3 lab 消费者)
- [x] JSON examples(§18)
- [x] machine-readable catalog(`RADIAL_CAPABILITY_CATALOG.json`)
- [x] no code modification(本审计只读;产出仅两份文档)
- [x] no git

**UNKNOWN / NEEDS RUNTIME VERIFICATION 项**:浏览器 n-key rollover 上限(硬件层);实机 0.09s 对角容差手感与 <0.25 beat 同向间隔的真实可玩上限(需 playtest)。以上为环境依赖,非代码可审计事实。
