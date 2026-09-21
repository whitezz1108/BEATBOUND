# BeatBound ARENA — Pattern / Mechanic Capability Audit (READ-ONLY)

日期:2026-09-20 · 分支:`evan-branch` · 审计范围:**仅 ARENA 模式运行时能力**
配套机读目录:`ARENA_PATTERN_CATALOG.json`

> 本报告只记录**当前代码实际能运行的能力**。未修改任何代码,未执行任何 git 操作。
> 所有行号以当前工作区文件为准。

---

## 0. 结论摘要(Executive Summary)

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| Runtime 可用 Arena mechanic | **11** | A01–A11,全部在 `src/mechanics/arena/index.ts:22-34` 注册且被 `BeatBoundGame.ts:160` 实际接线 |
| 库内 Arena pattern(AP) | **26** | AP01–AP26,全部只引用 A01–A11 |
| 跨 mechanic 组合模板 | **0** | 组合只能靠 pattern 里多个 event 并列实现(支持);没有内建 "combo pattern" 数据结构 |
| 完全 dead 的实现 | **0** | 11 个注册项全部可达 |
| 形同虚设的项 | **1** | A10 `variant:"FOLLOW_GAP"` 走的是 `BASIC_GAP` 分支(`RingMechanic.ts:217-221`)——**不会跟随玩家**,行为与 BASIC_GAP 完全相同 |
| 幽灵引用 | **2** | mechanics.mvp.json 兼容性元数据引用了不存在的 `A14`/`A15`(纯元数据,无运行时影响) |

**下一 Agent 编排 Toosie Slide(约 147s,BPM 123.05,4/4)所需的一切积木均已存在**:11 种 hazard 原语、26 个现成 pattern、beat 粒度可到 0.125 beat 的时序系统、section 级 difficulty(1–5)→ 可读性 tier 与 intensity(0–1)→ 逐 mechanic 参数映射、以及一套内建公平性下限(telegraph 下限、缺口最小宽度、移动速度预算)。

---

## 1. 完整运行链(Runtime Call Chain)

```
beatbound_library_v1/*.level.json          (sections[].patterns[] → { patternId, repeat, intensity })
  + patterns.mvp.json                       (patterns[].events[] → { at:{bar,beat,offsetBeats}, mechanicId, params, role })
  + mechanics.mvp.json                      (mechanics[].timing + defaults)
        │
        ▼  src/core/LevelLoader.ts:132-147  load() → fetch 三层 JSON
        ▼  LevelLoader.ts:167-247           validate()(mechanicId 必须存在于 mechanics 库;bar/beat/重复/intensity 检查)
        ▼  LevelLoader.ts:326-384           compile(): ConstantTempoMap(bpm, timeSig);
                                            │  pattern 在 section 内按声明顺序首尾相接(cursorBar += lengthBars×repeat)
                                            │  leadInBeats = min(该 section 用到的最大 telegraph, 1 bar)
                                            │  breatherFromBeat = 模式切换前的静默点(见 §11.4)
        ▼  src/core/PatternScheduler.ts:74-131 schedulePlacement()
                                            │  activationBeat = (placement.startBar-1+at.bar-1)*beatsPerBar + (at.beat-1) + offsetBeats
                                            │  ≥ breatherFromBeat 的事件直接不 spawn
                                            │  spawnBeat = activationBeat − spawnLeadBeats(=max(库 telegraph, 注册 lead))
        ▼  BeatClock.scheduleAtBeat(spawnBeat, …)
        ▼  src/core/MechanicRegistry.ts:110-154 create()
                                            │  params = mechanics.defaults ⨯ event.params(event 覆盖同名项)
                                            │  timing = resolveTiming(见 §5.2)
                                            │  ctx = { definition, params, timing, activationBeat, intensity, role,
                                            │          seed(由 patternId:startBar:repeat:eventIndex 哈希,确定性), clock, feel, tier }
        ▼  factory → 各 *Mechanic 实例      (src/mechanics/arena/*.ts)
        ▼  ModeManager 按 definition.mode 路由(src/game/BeatBoundGame.ts:183)
        ▼  src/modes/arena/ArenaMode.ts:66-69 accept() → this.mechanics[]
        ▼  ArenaMode.update():71-86         player.update(实时秒) → 每个 mechanic.update(beat) → resolveCollisions() → 清理 FINISHED
        ▼  src/core/Mechanic.ts:163-169     相位机:SCHEDULED→TELEGRAPH→ACTIVE→RECOVERY→FINISHED(全部以 beat 计)
        ▼  collision: ArenaMode.ts:88-127   circleIntersectsShape(player.circle, mechanic.hazards()[*])
                                            │  命中 → status.damage(damageSource) + 0.8s 无敌
                                            │  擦边(r+0.020)后脱离 → PERFECT 判定(冷却 0.5 beat)
        ▼  cleanup: FINISHED 后从数组移除(ArenaMode.ts:83-85;A08 Spiral 额外等弹幕飞完)
```

**关键结论**:没有任何 `switch(pattern.type)` 式的独立 pattern 解释器——pattern 只是 event 列表,真正的"能力"全部在 11 个 mechanic 类里。数据层(patterns/mechanics JSON)→ 调度层(PatternScheduler)→ 实现层(mechanic)三层解耦;新 pattern 无需改任何 TS 代码。

---

## 2. Arena Pattern 总表

### 2.1 Mechanic(运行时原语)

| ID | 名称 | 可用 | 类别 | 主要用途 | damage / 单发伤害 | Warning | 天然可组合 |
| -- | ---- | ---- | ---- | -------- | ------------------ | ------- | ---------- |
| `A01` | Floor Warning | ✅ | 地板/区域 | 电报化的危险地板格 | COLLISION / 10 | 派生式两段(§6.1) | 好(与弹幕/链) |
| `A02` | Safe Tile | ✅ | 地板/安全区 | 全场危险只留安全区(STATIC/MOVING/QUADRANT) | COLLISION / 10 | 正向标出安全区+路径预告 | 差(与一切占位 hazard 冲突) |
| `A03` | Projectile | ✅ | 弹幕/边缘 | 边缘发射:spread/wall/stream/fan | PROJECTILE / 12 | 墙上枪口+虚线弹道 | 好 |
| `A04` | Radial Burst | ✅ | 弹幕/中心 | 旋转喷射(中心或边缘向内),7 种发射器路径 | PROJECTILE / 12 | 轮辐+前 3 次喷射鬼影+旋转箭头 | 好 |
| `A05` | Chain | ✅ | 链鞭/线性 | 16 种 layout 的链鞭(LANE/线形/路径族) | COLLISION / 10 | 整条幽灵路径+起点充能(LANE:整条 lane+箭头) | 好 |
| `A06` | Laser | ✅ | 静态带 | 全场水平/垂直激光带 | COLLISION / 10 | 细线→增厚→两端充能节点 | 中(元数据自标 avoidWith A06) |
| `A07` | Rotating Fan | ✅ | 径向/持续 | 旋转扇臂(可达圆心),可摆锤 | COLLISION / 10 | 扇臂渐显+方向箭头 | 好 |
| `A08` | Spiral | ✅ | 弹幕/中心 | SPIRAL/DOUBLE_SPIRAL/FLOWER/PULSE 发射器 | PROJECTILE / 12 | 首批臂角+缠绕方向(+PULSE 预备环) | 好 |
| `A09` | Wave Sweep | ✅ | 移动墙 | 带窗口的过场墙(STATIC/RHYTHM/SHRINK/DOUBLE) | COLLISION / 10 | 入场边鬼影+窗口节拍点位 | 好 |
| `A10` | Ring | ✅ | 径向/重拍 | 缺口圆环内缩/外扩,5 variant × ringCount 序列 | COLLISION / 10 | 危险弧+SAFE 楔形+后续环预览 | 中(要避开其他占位 hazard) |
| `A11` | Sector Sweep | ✅ | 径向/顺序 | 楔形轮流点燃(顺序扫掠) | COLLISION / 10 | 全部分界线+前 3 楔鬼影+方向箭头 | 好 |

### 2.2 Pattern 库(26 个,`beatbound_library_v1/patterns.mvp.json`)

| ID | 名称 | function | 难度 | 长度 | 用到的 mechanic |
| -- | ---- | -------- | ---- | ---- | --------------- |
| AP01 | Checkerboard | TEACH | 1 | 2 bar | A01 checker_A/B ×4 |
| AP02 | Side Volley | PRACTICE | 2 | 2 | A03 wall ×4(四边轮换, telegraphBeats=1) |
| AP03 | Four Direction Chain | PRACTICE | 2 | 1 | A05 LANE 四方向 |
| AP04 | Diagonal Whip | PRACTICE | 2 | 2 | A05 SLASH/BACKSLASH |
| AP05 | Safe Ground | TEACH | 1 | 2 | A02 STATIC ×2 |
| AP06 | Chain Corridor | PRACTICE | 3 | 4 | A05 CORRIDOR(gap 0.25→0.5→0.75→横向) |
| AP07 | Serpent Chain | VARIATION | 3 | 2 | A05 SNAKE/CURVE_S/X_CROSS |
| AP08 | Spiral Out | VARIATION | 3 | 2 | A08 DOUBLE_SPIRAL / FLOWER |
| AP09 | Rhythm Window | COMBINE | 3 | 2 | A09 RHYTHM gapPath ×4 |
| AP10 | Spray And Pendulum | COMBINE | 3 | 2 | A04 FIGURE_EIGHT + A07 pendulum |
| AP11 | Spray Rotation | PRACTICE | 2 | 4 | A04 CIRCLE 发射器 + CW/CCW 轮换 |
| AP12 | Alternating Spray | VARIATION | 3 | 4 | A04 ALTERNATE + A07 |
| AP13 | Ring Collapse | CLIMAX | 4 | 4 | A10(ROTATING_GAP→EXPAND NARROWING×2→基本对) |
| AP14 | Spray Double Time | VARIATION | 4 | 4 | A04 subdivision 0.5, DIAMOND/EDGE 轮换 |
| AP15 | Safe Tile Sweep | COMBINE | 3 | 4 | A02 + A09 STATIC 交替 |
| AP16 | Fan And Spray | COMBINE | 4 | 4 | A07 3臂 + A04 ORBIT |
| AP17 | Pendulum Fan | PRACTICE | 3 | 4 | A07 摆锤参数梯度 |
| AP18 | Spiral Inward | VARIATION | 3 | 2 | A08 expand=false / PULSE 8臂 |
| AP19 | Shrinking Window | PRACTICE | 3 | 4 | A09 SHRINK ×4 |
| AP20 | Laser And Ring Climax | CLIMAX | 5 | 4 | A04+A06×4+A10 ADVANCED_ALTERNATING+A07 |
| AP21 | Sector Chase | COMBINE | 3 | 4 | A11 6楔CW/4楔CCW + A03 wall |
| AP22 | Sector And Spray | CLIMAX | 4 | 4 | A11 skipStep + A04 + A10 |
| AP23 | Shifting Ground | VARIATION | 3 | 4 | A02 MOVING(CIRCLE/LINE_X) |
| AP24 | Quadrant Rotation | COMBINE | 4 | 4 | A02 QUADRANT(单 event 16 beat) |
| AP25 | Chain Formation | VARIATION | 3 | 4 | A05 PARALLEL/FAN/SWEEP/CURVE_C |
| AP26 | Floor Stripes | TEACH | 2 | 4 | A01 strip/cross/sector |

现有关卡用法:`arena_test.level.json`(4 段全 ARENA,difficulty 1→4);`arena_showcase.level.json`(3 段);目标歌曲 `dance_fruits_..._toosie_slide_sped_up.level.json` 已有 S01(bars 1–12, AP15×2/AP03/AP05, diff 1)与 S05(bars 45–60, AP06×3/AP09/AP03, diff 2)两个 ARENA 段。

---

## 3. 玩家能力(Player Movement)— 全部实测于代码

来源:`src/modes/arena/ArenaPlayer.ts:25-105`、`src/tuning.ts:132-182`、`src/core/controls.ts:15-20`

| 项 | 值 | 备注 |
| -- | -- | ---- |
| 场地 | **单位正方形 0..1 × 0..1**,原点左上,y 向下(`geometry.ts:1-7`) | 所有 mechanic 坐标都是归一化 field 单位 |
| 出生点 | (0.5, 0.5) | activate 时 reset |
| 移动速度 | **0.62 field 单位/秒(实时秒,不随 BPM 变)** | `TUNING.arena.playerSpeed` |
| 加速 | 0.07s 到满速(指数逼近,`blend=dt/0.07`) | 起步损失 ≈0.02 单位 |
| 斜向 | 归一化 ×1/√2,斜向速度=正向速度 | `ArenaPlayer.ts:56-61` |
| 输入 | WASD / 方向键,每轴 -1/0/+1 | 无 dash、无冲刺、无惯性滑步 |
| 位置夹取 | [radius, 1−radius] | 不能贴出界 |
| 碰撞半径 | **0.014**(视觉 0.018,碰撞≈视觉 75%) | |
| 擦边判定 | hazard 边缘 +0.020 内经过且未中 → PERFECT,冷却 0.5 beat | `ArenaMode.ts:117-125` |
| 受击无敌 | 0.8s(只对 COLLISION/PROJECTILE 类连击起效) | `tuning.ts:62` |

**理论位移(已扣起步损失,含 BPM 123.05 的换算,spb=0.4876s)**:

| 时长 | 位移(field 单位) | 折合 beat(@123.05) |
| ---- | ----------------- | -------------------- |
| 0.5s | ≈ 0.29 | ≈ 1.0 beat |
| 1.0s | ≈ 0.60 | ≈ 2.1 beat |
| 2.0s | ≈ 1.22(>场地宽) | ≈ 4.1 beat |
| 每 beat | 0.62×spb = **0.302** | — |
| 全场横穿(1.0) | 1.61s | ≈ 3.3 beat |
| 公平性移动预算 `maxGapShiftPerBeat` | 0.302×0.85 = **0.257/beat** | 所有"移动缺口"的速度上限基准 |

伤害:COLLISION=10、PROJECTILE=12;血池 100 共享全模式;低于 30% UI 告警。

---

## 4. 碰撞系统(Collision)

来源:`src/core/geometry.ts:30-102`、`bullets.ts:37-71`

- 3 种 hazard shape:`rect`(AABB)、`circle`、`sector`(环形扇形:rInner/rOuter/a0/a1,弧度,0=+x 顺时针)。
- 判定恒为 **玩家圆 vs shape**;sector 会把弧向两侧撑 `asin(playerR/dist)`,贴边即算命中。
- **视觉≈碰撞是明规则**:弹幕轮廓内切于 hitbox(`bullets.ts:19-24`);玩家碰撞小于外观;BEAM 长形用两枚 hit circle 覆盖全长。
- 各 mechanic 实际 shape:
  - A01:每格 1 个精确 rect
  - A02:危险补集切成 12×12 网格再合并成横条 rect
  - A03:每弹 1 circle(BEAM 2 个)
  - A04:每弹 1 circle
  - A05 LANE:1 个增长 rect;线/路径:沿折线的 link circle(半径=thickness/2,clamp 0.005–0.015,总 link 上限 240)
  - A06:1 个全场 rect
  - A07/A10/A11:annulus sector(精确到弧)
  - A08:每弹 1 circle
  - A09:22 段小 rect 拼墙(含正弦/对角形状,逐段精确)

---

## 5. 全局系统

### 5.1 单位约定(重要)

| 量 | 单位 | 说明 |
| -- | ---- | ---- |
| 位置/半径/宽度/厚度 | **field 单位**(场地=1×1) | projectileRadius 0.019 等 |
| 角度(JSON) | **度** | 内部转弧度;0°=右(+x),90°=下,**−90°=上**(canvas y 向下) |
| 时间(telegraph/duration/subdivision/spacing/quadrantBeats…) | **beat** | 库 timing、event 参数全部以 beat 计 |
| `A02.moveSpeed` / `A04.emitterSpeed` | **圈/秒** | 构造时换算成 beat/圈并 clamp(≥4 beat/圈)——作者写秒,运行按 beat 锁相 |
| `A03.speed` / `A04.speed` / `A08.speed` | 无量纲倍率 | |
| 玩家速度 | 单位/秒(唯一实时量) | |
| 伤害 | 血点(满 100) | |

### 5.2 Timing 解析(`MechanicRegistry.resolveTiming`,138-154 行)

每个 event 的最终 timing:

```
telegraphBeats = (event.params.telegraphBeats ?? 库值) × tier.telegraphScale(仅当>0)
                 → scaleTelegraphBeats(×, intensity, minReactionBeats):
                     高 intensity 向 0.65× 收,下限 = max(0.6, pattern.constraints.minReactionBeats)
durationBeats  = event.params.durationBeats ?? 库值(随后可能被 mechanic 内部改写/拉长)
recoveryBeats  = event.params.cooldownBeats ?? 库 cooldownBeats ?? 0
```

即:**`telegraphBeats` / `durationBeats` / `cooldownBeats` 可以直接写在 event.params 里覆盖库值(作者逃生舱,AP02 就这么用)**。

### 5.3 Section difficulty → tier → 参数(`arenaTiming.ts` + `tuning.ts:196-201`)

`tierForDifficulty(section.difficulty)`(1–5,未写=按 2):

| tier(难度) | travelScale | telegraphScale | gapScale | densityScale |
| ---------- | ----------- | -------------- | -------- | ------------ |
| EASY(1) | 1.35 | 1.5 | 1.35 | 0.7 |
| MEDIUM(2) | 1.18 | 1.25 | 1.18 | 0.85 |
| HARD(3) | 1.0 | 1.05 | 1.0 | 1.0 |
| INTENSE(4–5) | 0.9 | 0.9 | 0.9 | 1.15 |

- **travelScale 总效果 = `hazardTravelScale 1.55 × tier.travelScale`**(EASY≈2.09×,INTENSE≈1.40×),经 `slowed()` 直接拉长 A02/A03/A04/A09/A10/A11 的 ACTIVE 窗口(动作与窗口同步变慢)。A05 链用自身 fairness;A06 静态不需要;A07 逐 beat 旋转;A08 只用它拉长弹飞行。
- gapScale 放大安全缺口:A03 wall 开口、A04 burstArc、A09 gapWidth、A10 gapArc。
- `densityScale` **目前没有任何运行时消费者**(预留字段)。

### 5.4 Intensity(0..1,per placement)→ 逐 mechanic 映射(`src/core/Intensity.ts` + 各实现)

| mechanic | intensity 实际改变 |
| -------- | ------------------ |
| 全局 | telegraph 向 0.65× 收(有下限,见 §5.2) |
| A01 | 警告时长 ×(1−0.25·intensity);从补集随机加格 ≤ floor(补集×0.25·intensity),武装上限恒为格子总数 60% |
| A02 | 安全区边长 ×lerp(1, 0.75, intensity)(下限 0.16) |
| A03 | 速度 ×lerp(1, 1.6);spread 数量 ×lerp(1, 3)(cap 4)、stream 数量同式(cap 8) |
| A04 | 弹速 ×(1+0.25·intensity) |
| A05 | LANE 鞭速:duration×lerp(0.45, 0.28)(clamp 0.12–0.4,再吃 warning 下限) |
| A06 | 厚度 ×lerp(1, 1.2)(cap 0.2) |
| A07 | 无(intensity 不影响) |
| A08 | 弹速 ×(1+0.2·intensity) |
| A09 | 无(gapWidth 只吃 tier.gapScale) |
| A10 | 无直连(只吃 tier.gapScale 与 fairness 地板) |
| A11 | 无 |

### 5.5 公平性系统(`src/core/fairness.ts`,常量在 `tuning.ts:100-105`)

这些是**绝对下限**,tier/intensity 都压不破:

| 保护 | 值 | 机制 |
| ---- | -- | ---- |
| 反应地板 | 0.6s(warning < 此为物理不可反应) | telegraph 缩放的下限(MIN_TELEGRAPH_BEATS=0.6) |
| 舒适地板 | 0.9s | `ensureWarningFloor`:A05 鞭、A10 环、A11 步进用它把"telegraph+飞行"撑到 ≥0.9s |
| 最小缺口宽 | `max(2×playerR+0.024, 0.06)` = **0.06** | A09 窗口宽、A03 wall 间距推导、A02 走道参考 |
| 最小角缺口 | `2·asin(0.06/(2r))`;在 r=0.32 ≈ **10.9°**、r=0.14(A10 判定半径)≈ **24.7°** | A04 步进、A08 PULSE 臂数、A10 gapArc 下限 |
| 缺口移动速度 | ≤0.85×玩家每 beat 位移(§3 表) | A02 MOVING 半径、A04 步进、A05 旋转、A09 gapPath、A10 环间 gap 边缘位移、A11 步进 |

每个 mechanic 在**构造时**自行套用这些下限(见各节);不存在跨 mechanic 的统一编排保护(§12)。

---

## 6. Mechanic 逐项拆解

> 格式:行为 → 生成几何 → 运动 → 参数表(默认/范围/自动生成标注)→ Warning → 碰撞 → 生命周期 → 音乐亲和。
> 标注:`SAFE`=可放心自动生成,`BOUNDS`=需限界(给出推荐界),`MANUAL`=只能手工,`UNKNOWN`=未验证。

### 6.1 A01 — Floor Warning(地板格)

- **Identifier**:`mechanicId: "A01"`;实现 `src/mechanics/arena/FloorWarningMechanic.ts`;注册 `index.ts:23`。
- **行为**:指定格子先虚线警示、临激活前变实心急促(critical 尾= min(0.75 beat, 50% telegraph)),然后燃烧造成伤害,冷却期余烬淡出。
- **生成几何**:tile 网格覆盖全场。`grid:[cols,rows]`(默认 4×4,无上限 clamp——大网格=更多 rect)。layout 见下;`tiles:[[col,row],…]` 显式覆盖 layout(越界格被过滤)。

| layout | 说明 |
| ------ | ---- |
| `checker_A` / `checker_B` | (col+row) 奇/偶格(AP01 交替用) |
| `rows` / `cols` | 隔行/隔列 |
| `all` | **全场地武装——激活窗口内无安全处,必吃一下(10 伤)。MANUAL_ONLY** |
| `single` | 正中一格 |
| `horizontal_strip` / `vertical_strip` | 中线整行/列 |
| `cross` | 中线十字 |
| `center_danger` | 中央块(约半宽)危险,边缘安全——惩罚蹲中心 |
| `outer_danger` | 边缘危险,中央安全 |
| `sector` | 中心起右上 90° 楔形(角度写死 `atan2 ∈ [−π/2, 0)`,**不可转**) |

- **运动**:静止。
- **参数**:

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| layout | string | checker_A | 上表 12 种 | 布局 | SAFE |
| grid | [int,int] | [4,4] | ≥1;推荐 3–8 | 网格密度 | BOUNDS(推荐 4×4/6×6) |
| tiles | [[int,int]…] | — | 网格内 | 显式格子 | SAFE |
| damageActiveBeats | number | 库 durationBeats=1 | ≥0(实践 0.5–2) | 危险窗口 | BOUNDS(0.5–2) |
| warningStyle | string | red_flash | 任意 | **纯装饰,无逻辑读它** | SAFE |

- **Warning**:**时长不是作者定的**——`warningBeatsFor()` 实测"最远武装格中心 → 最近安全格中心 + 半格"的步行距离,经 `minimumWarningBeats`(0.6s 反应+步行,上限 4 beat)取 `max(库值, 派生值)`,再 ×(1−0.25·intensity)。两段式:虚线 outline → critical 实心抖动。**warning 与真实攻击格逐格对应;不显示安全区(安全区就是没亮的地方)**。
- **碰撞**:每格 1 rect,精确等于视觉。
- **生命周期**:telegraph(派生,≤4 beat)→ ACTIVE(damageActiveBeats)→ RECOVERY(cooldown)。
- **音乐亲和**:离散触发型。适合 BEAT/SNARE、半拍点、小节重音;`all`/`cross` 适合段落重锤。不适合 16 分连打(格子系统读不过来)。

### 6.2 A02 — Safe Tile(安全区)

- **Identifier**:`"A02"`;`src/mechanics/arena/SafeTileMechanic.ts`。
- **行为**:全场变红,只有安全区是绿的家。三种形态:
  - **STATIC**:patch 一次性放置(seed 决定,回放确定),问"你能不能到";
  - **MOVING**:patch 沿闭合路径漂移(beat 的纯函数),问"你能不能跟上";
  - **QUADRANT**:场分 2 或 4 块按 `quadrantBeats` 轮转安全,跨越踩在拍点上。
- **生成几何**:patch=正方形(边长 safeAreaSize,中心 clamp 在场内);QUADRANT=精确半场/四分之一。
- **运动**:MOVING:CIRCLE/LINE_X/LINE_Y,半径与速度被玩家速度预算 clamp(CIRCLE 半径 ≤ budget);QUADRANT:离散跳变。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| safeZone | string | STATIC | STATIC/MOVING/QUADRANT | 形态 | SAFE |
| safeAreaCount | int | 1 | ≥1 | patch 数(STATIC) | BOUNDS(1–3) |
| safeAreaSize | number | 0.25 | ≥0.16(intensity 收缩后) | patch 边长 | BOUNDS(0.18–0.35) |
| safeAreas | [[x,y]…] | — | 0..1 | 显式中心(优先于 count) | SAFE |
| movePath | string | CIRCLE | CIRCLE/LINE_X/LINE_Y | 路径 | SAFE |
| moveRadius | number | 0.24 | 0–0.4(CIRCLE 另受速度预算) | 漂移半径 | BOUNDS(≤0.3) |
| moveSpeed | number | 0.25 | 圈/秒;强制 ≥4 beat/圈 | 漂移速度 | BOUNDS(0.15–0.4) |
| moveStartDeg | number | -90 | 任意度 | 起始角 | SAFE |
| quadrantCount | int | 4 | 2 或 4 | 分块数 | SAFE |
| quadrantBeats | number | 4 | 被"跨越步行"下限抬高 | 每块安全时长 | BOUNDS(≥库内自动下限,写 ≥2) |
| quadrantDirection | string | CW | CW/CCW | 轮转方向 | SAFE |

- **Warning**:telegraph **正向**画安全区(绿框+填充);MOVING 画整条路径折线;QUADRANT 按顺序渐变预览所有块+激活中始终框出下一块。QUADRANT 的 telegraph 会被抬到 `minimumWarningBeats(1.0)`(保证玩家能走到起始块)。
- **碰撞**:危险补集=12×12 切块合并条 rect(每帧重算 MOVING/QUADRANT);patch 本身无害。
- **生命周期**:slowed() 拉长;QUADRANT 的 duration 强制 ≥ quadrantBeats×quadrantCount(一整轮)。
- **音乐亲和**:STATIC=持续段(sustain/verse 托底);MOVING=旋律线条/loop;QUADRANT=小节级脉动、4 小节方阵(AP24 单 event 16 beat)。

### 6.3 A03 — Projectile(边缘弹幕)

- **Identifier**:`"A03"`;`src/mechanics/arena/ProjectileMechanic.ts`;damageSource PROJECTILE(12)。
- **行为**:从一条边发射,垂直穿过全场。四种 formation:
  - **spread**:散点弹(默认 1 发,intensity 最多加到 4);
  - **wall**:整边铺满、留 1–4 个开口(开口位置均匀+seed 抖动;开口宽随 tier.gapScale 放大;间距由 `(弹半径+玩家半径)×2×0.92` 推导,弹数≈19@默认半径);
  - **stream**:同一 lane 按 `spacing` 连发(读作一条移动的线,玩家沿它走);
  - **fan**:墙上一点张开的扇形(`spreadDeg` 半角 → 侧向 drift,tan 推导、clamp ±0.9)。
- **生成几何**:边(LEFT/RIGHT/TOP/BOTTOM/`random`-seed 确定);lane=边上 0..1 位置;fan 自单点张开。
- **运动**:直线轴对齐,速度=`durationBeats(经 slowed)÷speed`,下限 0.25 beat 穿越;fan 直线侧滑(非曲线)。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| spawnSide | string | random | LEFT/RIGHT/TOP/BOTTOM/random | 发射边 | SAFE |
| formation | string | spread | spread/wall/stream/fan | 阵型 | SAFE |
| count | int | 1(spread)/4(stream)/3(fan) | spread 1–4;stream 2–8;fan 2–5 | 数量(intensity 参与缩放) | BOUNDS(≤4/≤8/≤5) |
| speed | number | 1.0 | >0;intensity ×(1–1.6) | 速度倍率 | BOUNDS(0.6–1.6) |
| radius | number | 0.015(edgeProjectileRadius) | 0.006–0.028 | 弹半径 | BOUNDS(默认即可) |
| shape | string | DIAMOND | DIAMOND/ARROW/SHARD/RECT/BEAM | 剪影(BEAM=2 hit circle) | SAFE |
| gaps | int | 2 | 1–4 | wall 开口数 | SAFE |
| lanes | [number…] | — | 0..1 | 显式 lane(spread 逐个;stream 取第 1 个) | SAFE |
| spacing | number | 0.5 | 0.25–2 beat(再被 slowed 拉伸) | stream 间隔 | BOUNDS(≥0.25) |
| spreadDeg | number | 30 | 10–70 | fan 半角 | BOUNDS(10–50) |

- **Warning**:telegraph 画在**墙上**:每发一个枪口剪影+朝内的虚线弹道(随 telegraph 变长);stream 一次亮出全部枪口(可数弹)。warning 与真实弹道一致(fan 的 drift 也预览一半)。
- **碰撞**:弹圆(或 BEAM 双圆);运动拖尾只是视觉。
- **生命周期**:ACTIVE 窗口自动扩到 `最后 fireOffset + crossBeats`;未发射的弹不参与碰撞。
- **音乐亲和**:spread=旋律单音/16 分;wall=强拍/小节墙(drum fill 落点);stream=hi-hat 连打(spacing 0.25=16 分);fan=和弦 stab。

### 6.4 A04 — Radial Burst(旋转喷射)

- **Identifier**:`"A04"`;`src/mechanics/arena/RadialBurstMechanic.ts`;damageSource PROJECTILE(12)。
- **行为**:从中心(或自边缘向内)按 `subdivision` 节奏逐次喷射 `bulletsPerBurst` 发;每次喷射整体转 `stepDeg`,趋势从前两发可读。多 `arms` 为均匀错开的并行喷射组。
- **生成几何**:发射器 7 种路径(beat 纯函数):STATIC(中心)、CIRCLE、SQUARE(L∞)、DIAMOND(L1)、FIGURE_EIGHT(Gerono 双纽线)、WAVE、ORBIT(推到 rim×0.92)。**发射器本身无碰撞**。origin=EDGE 时弹自 rim 向内落到发射器方向。
- **运动**:弹沿发射瞬间的方向直线飞(保留发射器当时的偏移→平行线,不追踪不弯曲);easeOutCubic 减速;travelBeats = clamp(0.767/(0.85×speed×(1+0.25i))/spb, 0.5, 3)。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| arms | int | 1 | 1–3(旧名 gapCount) | 并行喷射组 | SAFE |
| bulletsPerBurst | int | 3 | 2–4 | 每次发数 | SAFE |
| burstArcDeg | number | 40 | 22–60(×tier.gapScale;旧名 gapArcDeg) | 每次喷射角宽 | SAFE |
| stepDeg | number | 45 | 请求 10–90;**有效值= min(max(请求, burstArc+最小角缺口), 速度预算)** | 每次旋转步 | SAFE(clamp 兜底) |
| subdivision | number | 1 | 0.5–2 beat | 喷射间隔 | SAFE |
| direction | string | CW | CW/CCW/ALTERNATE(往返) | 旋转方向 | SAFE |
| startAngleDeg | number | -90 | 任意(旧 gapAngleDeg;旧 rotationDeg 会加进来) | 首发角 | SAFE |
| origin | string | CENTER | CENTER/EDGE | 内/外 | SAFE |
| speed | number | 1.0 | >0 | 弹速倍率 | BOUNDS(0.6–1.6) |
| emitter | string | STATIC | STATIC/CIRCLE/SQUARE/DIAMOND/FIGURE_EIGHT/WAVE/ORBIT | 发射器路径 | SAFE |
| emitterRadius | number | 0.22 | 0.05–0.34 | 路径半径 | SAFE |
| emitterSpeed | number | 0.5 | 圈/秒;≥4 beat/圈 | 发射器速度 | BOUNDS(0.2–0.6) |
| emitterAngleDeg | number | -90 | 任意 | 路径起始角 | SAFE |
| shape | string | 自动(ORB/ARROW) | bullets.ts 全部 9 种 | 弹剪影 | SAFE |

- **Warning**:中心充能+轮辐;**前 3 次喷射的扇形鬼影**+旋转方向弧箭头;移动发射器整条路径预画。喷射次数 = floor((duration−travel)/subdivision)+1。
- **碰撞**:每弹 1 圆;半径=projectileRadius×0.9(中心 0.0171/边缘 0.0135)。
- **生命周期**:slowed() 拉长窗口;弹各自飞完 travelBeats 即无害(但 mechanic 的 ACTIVE 盖住整段)。
- **音乐亲和**:subdivision 0.5=8 分反拍、1=四分 kick/synth 琶音、2=二分;ALTERNATE=call-and-response;移动发射器=旋律轮廓。不适合 >2 beat 的稀疏点(趋势读不出)。

### 6.5 A05 — Chain(链鞭)— 见 §8 专项

### 6.6 A06 — Laser(激光带)

- **Identifier**:`"A06"`;`src/mechanics/arena/LaserMechanic.ts`。
- **行为**:静止的全场水平/垂直带。两条交叉(A06×2,一横一竖)把场切成四象限——库元数据自标 `avoidWith: ["A06"]`,但运行时**不阻止**。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| orientation | string | HORIZONTAL | HORIZONTAL/VERTICAL | 方向 | SAFE |
| position | number | 0.5 | clamp 到 [thickness/2, 1−thickness/2] | 带中心 | SAFE |
| thickness | number | 0.15 | 0.05–0.2(intensity ×1–1.2) | 带厚 | SAFE |

- **Warning**:细瞄线→按 telegraph 进度增厚→两端发射节点充能脉冲。与真实带完全对应。
- **碰撞**:1 个精确 rect。**视觉=碰撞**。
- **生命周期**:库 timing 1 beat ACTIVE + 1 beat cooldown(全部 mechanic 中唯一有非零默认 cooldown 的)。
- **音乐亲和**:downbeat 重锤、bass drop、短促和弦段。持续调制不适合(参数全静态)。

### 6.7 A07 — Rotating Fan(旋转扇)

- **Identifier**:`"A07"`;`src/mechanics/arena/RotatingFanMechanic.ts`。
- **行为**:N 条扇臂绕中心旋转,臂伸到圆心(innerRadius=0 时**无死区**,站中心不安全);安全区=臂间移动楔形,玩法=跟着拍子绕圈。`reversalBeats>0` 变摆锤(往返同弧)。
- **运动**:**beat 量化旋转**——每 beat 前进 `rotationPerBeatDeg`,后半 beat ease 滑动到位(听得见的步进)。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| arms | int | 2 | 1–6 | 臂数 | BOUNDS(≤4;6 臂+大 arc 见 §13) |
| armArcDeg | number | 55 | 16–min(140, 360/arms×0.9) | 臂角宽 | SAFE(自带上限) |
| startAngleDeg | number | -90 | 任意 | 臂 0 起角 | SAFE |
| rotationPerBeatDeg | number | 45 | 10–120 | 每拍转角 | BOUNDS(10–90) |
| direction | string | CW | CW/CCW | 方向 | SAFE |
| radius | number | 0.72 | 0.2–1.1 | 臂外半径 | SAFE |
| innerRadius | number | 0 | 0–0.3 | 内孔(0=臂到心) | SAFE |
| reversalBeats | number | 0 | >0 启用摆锤 | 半摆周期 | BOUNDS(≥2) |

- **Warning**:臂渐显+从心到尖的瞄准线+中心方向箭头(↻/↺);摆锤临近反转显示警示字符。**注意:臂间楔形宽度没有 fairness 角缺口下限**(§13 危险配置)。
- **碰撞**:annulus sector × arms,精确。
- **生命周期**:库 4 beat ACTIVE(不 slowed——旋转本身就是节拍函数)。
- **音乐亲和**:逐 beat 旋转=synth loop/琶音;摆锤=2/4/6 beat 乐句摇摆在强拍反转;最适合"持续调制"型绑定。

### 6.8 A08 — Spiral(中心弹幕发射器)

- **Identifier**:`"A08"`;`src/mechanics/arena/SpiralMechanic.ts`;damageSource PROJECTILE(12)。
- **行为**:中心发射器每 `subdivision` 发射,角步进 `stepDeg`,四种 pattern:
  - **SPIRAL**:arm 角均布(arms≤4),连续螺旋;
  - **DOUBLE_SPIRAL**:双向缠绕,安全缝随交点扫动;
  - **FLOWER**:`petalArms` 发一组、组间跳 `360/petals`,离散花瓣;
  - **PULSE**:整环每 1 beat 一发(arms 2–12,fairness 角缺口封顶),同心环读法。
- **运动**:径向直线(expand=true 外扩 0.05→0.767;false 自 rim 0.767→0.03 内陷);travelBeats = max(0.75, 2.2×travelScale(tier)÷speed)。**弹会活过 ACTIVE 窗口**——isFinished 等全部弹退休。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| pattern | string | SPIRAL | SPIRAL/DOUBLE_SPIRAL/FLOWER/PULSE | 模式 | SAFE |
| arms | int | 2 | 1–4;PULSE 2–12(fairness 封顶) | 臂数/环弹数 | SAFE |
| stepDeg | number | 26 | 4–90 | 角步进 | SAFE |
| subdivision | number | 0.25 | 0.125–1(PULSE 恒 1) | 发射间隔 | BOUNDS(≥0.125) |
| direction | string | CW | CW/CCW/ALTERNATE | 缠绕方向 | SAFE |
| speed | number | 0.9 | >0(×1+0.2i) | 弹速倍率 | BOUNDS(0.6–1.4) |
| expand | bool | true | true/false | 外扩/内陷 | SAFE |
| startAngleDeg | number | -90 | 任意 | 首发角 | SAFE |
| shape | string | SPARK | 9 种 | 弹剪影 | SAFE |
| petalArms | int | 5 | 2–8 | FLOWER 每组弹数 | SAFE |
| petals | int | 6 | 3–12 | FLOWER 瓣数 | SAFE |

- 总弹量硬上限 400 发(emitted 计数);弹半径 0.01425。
- **Warning**:按真实角度函数画首批臂+缠绕方向短弧;PULSE 画预备环。**发射器中心 0.018 圆是视觉**,无碰撞。
- **音乐亲和**:**全库最细节奏分辨率(0.125=32 分)**——hi-hat 16 分、drum roll、build-up;PULSE=每 beat 一环(kick 环);FLOWER=动机重复;DOUBLE_SPIRAL=双手琶音。

### 6.9 A09 — Wave Sweep(节拍窗口墙)

- **Identifier**:`"A09"`;`src/mechanics/arena/WaveSweepMechanic.ts`。
- **行为**:一堵墙在 `durationBeats`(slowed)内横穿全场,墙上开 1–2 个窗口。四模式:STATIC(窗口固定,seed 定)、**RHYTHM**(窗口中心按 `gapPath` 逐 beat 踩点,ease 连接)、SHRINK(窗口随行程收紧到 `shrinkTo` 比例,地板=最小缺口)、DOUBLE(第二窗口镜像)。
- **生成几何**:axis HORIZONTAL(墙自上而下)/VERTICAL/DIAGONAL(对角墙,位置随横向 u 滑动);`amplitude` 给墙加正弦波前(0=直墙)。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| mode | string | STATIC | STATIC/RHYTHM/SHRINK/DOUBLE | 模式 | SAFE |
| axis | string | HORIZONTAL | HORIZONTAL/VERTICAL/DIAGONAL | 墙走向 | SAFE |
| direction | string | FORWARD | FORWARD/BACKWARD | 行进方向 | SAFE |
| gapCount | int | 1 | 1–2 | 窗口数 | SAFE |
| gapWidth | number | 0.2 | ×tier.gapScale;地板 0.06(SHRINK 为 0.06/shrinkTo);cap 0.5 | 窗口宽 | BOUNDS(0.14–0.35) |
| gapPath | [number…] | [0.5] | 0.1–0.9;每步 ≤0.257(@123bpm) | 每拍窗口中心 | BOUNDS(步长受限) |
| thickness | number | 0.09 | 0.04–0.2 | 墙厚 | SAFE |
| amplitude | number | 0 | 0–0.25 | 正弦波幅 | SAFE |
| shrinkTo | number | 0.65 | 0.55–0.85 | SHRINK 终宽比 | SAFE |

- **Warning**:入场边整墙鬼影;RHYTHM 预画 5 个窗口节拍点位+连线(节拍编排直接可读);STATIC 画贯穿全场的绿色安全线。**warning 与实际碰撞逐段对应**。
- **碰撞**:22 段 rect 拼墙(波前/对角逐段精确)。
- **音乐亲和**:墙穿越=1–2 小节长句;RHYTHM gapPath=**切分/固定音型同步的最佳载体**(每拍一个目标位);SHRINK=build 张力。

### 6.10 A10 — Ring(缺口环)— 见 §7 专项

### 6.11 A11 — Sector Sweep(楔形轮燃)

- **Identifier**:`"A11"`;`src/mechanics/arena/SectorSweepMechanic.ts`。
- **行为**:场切成 `sectorCount` 个楔形,按 `startSector` 起每隔 `stepBeats` 点燃下一个(隔 `skipStep` 个跳);**同一时刻只有一个楔形危险**,其余全安全——玩法是"按扫掠的节奏让位/绕圈",不是找缝。`sweepSteps` 可只扫半圈,没扫到的楔全程安全。
- **运动**:离散步进(stepBeats 有三重下限,见下),critical 尾 40% telegraph。
- **stepBeats** = max(库 duration/sectorCount(clamp 0.15–4), 逃逸步行/速度预算, ensureWarningFloor)。**durationBeats 会被改写为 stepBeats×visits**——事件实际长度由 fairness 决定,作者写的 duration 只是初始建议。

| 参数 | 类型 | 默认 | 范围/clamp | 含义 | 自动生成 |
| ---- | ---- | ---- | ---------- | ---- | -------- |
| sectorCount | int | 6 | 3–12 | 楔数 | SAFE |
| sweepDirection | string | CW | CW/CCW | 方向 | SAFE |
| skipStep | int | 0 | 0–sectorCount−2 | 步进跨楔数(跳过的楔安全) | SAFE |
| sweepSteps | int | 可达全集 ceil(sectors/(skip+1)) | 1–可达数 | 扫过的楔数 | SAFE |
| firstAngleDeg | number | -90 | 任意 | 楔 0 起角 | SAFE |
| startSector | int | 0 | 0..sectorCount−1 | 起始楔 | SAFE |
| innerRadius | number | 0 | 0–0.3 | 中心孔(0=到心) | SAFE |

- **Warning**:全部楔分界线→前 3 个楔按顺序鬼影→方向箭头→critical 脉冲。**激活中始终框出下一个楔**——顺序完全可预测。
- **碰撞**:1 个 annulus sector(当前 live 楔)。
- **音乐亲和**:步进=8 分/四分脉冲鼓组;skipStep=切分;CW→CCW 反转=乐句对答(AP21);适合长持续段。

---

## 7. Ring(A10)专项调查

实现:`src/mechanics/arena/RingMechanic.ts`(全部答案给到参数与行号):

| 问题 | 答案 |
| ---- | ---- |
| 中心可变? | **否**。恒为场心 (0.5,0.5)(`polar.ts:13`)。无参数。 |
| 初始/最终半径 | 由 `mode` 决定:COLLAPSE 从 ARENA_OUTER_RADIUS(≈0.767)缩到 `thickness/2+playerR/2`(内缘永远盖不过玩家半径→**站正中心永远安全的设计被有意排除**);EXPAND 反向。`minRingRadius()`(75-77 行)。 |
| inward/outward | `mode:"COLLAPSE"|"EXPAND"`(默认 COLLAPSE)。 |
| 展开速度 | 每环扫掠时长 = durationBeats(经 slowed)÷ ringCount,easeInOut。 |
| 环厚度 | `thickness` 0.04–0.16,默认 0.07。 |
| 缺口大小 | `gapArcDeg` 28–170(×tier.gapScale),**绝对下限 ≈24.7°**(在判定半径 0.14 处 `minimumAngularGap`,180 行)——任何 variant/强度都压不破。 |
| 缺口位置 | `gapAngleDeg`(首环缺口中心角,默认 −90=上方)+`rotationDeg` 附加角。 |
| 缺口旋转 | `variant:"ROTATING_GAP"`,`rotationPerRingDeg` 每环步进(默认 40°),受"环间 gap 边缘位移 ≤ 玩家步行"预算 clamp(`maxGapEdgeStep`,262-266 行;@123bpm、3 环时预算 ≈38°)。 |
| 多 gap | `gapCount` ≥1,缺口绕圆均布(`spreadFrom`)。 |
| 多环序列 | `ringCount` ≥1:窗口总长 = duration×count,环与环首尾相接(stagger=单环扫掠时长);后续环在 telegraph 里以细弧预览。 |
| 变窄序列 | `variant:"NARROWING_GAP"`,`narrowingPerRing` 0.55–1(每环 gapArc 乘数,默认 0.82);下限仍受 24.7° 保底。 |
| 反向摆动 | `variant:"ADVANCED_ALTERNATING"`:缺口走出去再回来(zig-zag);swing=未署名时取速度预算×0.8,署名 `rotationPerRingDeg` 时 ×1.35。 |
| 随机缺口 | **无 random 选项**(确定性系统,seed 不用于缺口位置)。 |
| 瞄准玩家缺口 | **无任何玩家追踪**。`FOLLOW_GAP` 是文档别名,**实际走 BASIC_GAP 分支**(217-221 行),行为=缺口静止。 |
| warning 阶段缺口可见? | **是**——telegraph 就把首环危险弧画在真实位置,缺口楔形涂绿+“SAFE”字样,后续环预览。 |
| 额外保护 | `applyWarningFloor`(149-167 行):telegraph+到达玩家半径的飞行时间 < 0.9s 时自动拉长 duration(只拉长不缩短)。 |

**生命周期示例**(库默认 duration 3、MEDIUM tier、123.05bpm):ACTIVE ≈ 3×1.55×1.18 ≈ 5.49 beat ≈ 2.68s;ringCount=3 时每环 ≈1.83 beat。

**音乐亲和**:强拍/落拍重锤、段落边界、drop;ringCount 序列=多小节短语;与 A04 是库里注明的 call-and-response 对子。

---

## 8. Chain(A05)专项调查

实现:`src/mechanics/arena/ChainMechanic.ts` + 路径生成器 `src/mechanics/arena/chainPaths.ts`。

三族 layout(`LAYOUTS` 常量,共 **16 种**):

1. **LANE(legacy 鞭)**:`direction` 四向、`width`(单位=lane 数,1..laneCount−1)、`laneCount`(≥2,默认 4)、`lane` 显式(否则 seed 随机)。lane 集合**平铺全场**——总有某条 lane 盖住你,站定必挨打(78-80 行注释)。碰撞=整条 lane 带内从起点边增长的 rect;鞭速=duration×lerp(0.45,0.28,intensity),clamp 0.12–0.4 beat,再吃 `ensureWarningFloor`(telegraph+鞭行进 ≥0.9s)。
2. **LINE(手折线)**:SLASH、BACKSLASH、CROSS(两对角)、ZIGZAG(`segments` 2–5)、SNAKE(6 段正弦,`amplitude` 0.1–0.45)、**CORRIDOR**(两条平行链夹出安全走廊:`axis`、`gap` 中心 0.1–0.9、`corridorWidth` 0.07–0.4——走廊宽度无下限 clamp,薄于 0.06 会挤,作者自律)、POLYLINE(`points`[[x,y]…] 显式,clamp 0..1)。
3. **PATH 族(生成器,`chainPaths.ts:82-95`)**:PARALLEL(平行织网,间隔=公平最小值)、X_CROSS(对角+十字,`complexity` 决定 2–4 条)、FAN(边缘扇臂,origin 由 seed 定)、SWEEP(绕 `pivot` LEFT/RIGHT/TOP/BOTTOM 旋转的单/多链)、CURVE_C(C 弧)、CURVE_S(S 曲,`axis`/`amplitude`)、ARC(浅弧)、SPIRAL(阿基米德螺线 `direction` OUTWARD/INWARD,圈数 1.4+1.6×complexity)、ROTATING_CHAINS(中心辐射 N 臂整体旋转)。

**"曲线链"的真身**:CURVE_C/CURVE_S/ARC/SPIRAL 都是用 26–150 个点**采样出的折线**,再沿折线摆 link 圆(半径 thickness/2,总上限 240 link)——碰撞即圆链,视觉=碰撞。旋转族(SWEEP/ROTATING_CHAINS)是**整条折线绕场心刚体旋转**(rotationPerBeat 被 clamp 到"最外点每 beat 位移 ≤ 玩家速度")。

**鞭行为**:ACTIVE 起沿折线从 `travel` FORWARD/BACKWARD 方向伸链(`extendBeats` 内走完),头部高亮;RECOVERY 定格淡出。

**参数总表**(LINE/PATH 共用部分):

| 参数 | 类型 | 默认 | 范围 | 含义 | 自动生成 |
| ---- | ---- | ---- | ---- | ---- | -------- |
| layout | string | LANE | 16 种 | 布局 | SAFE |
| chains | int | 族默认(PARALLEL2/X_CROSS4/FAN3/SWEEP1/CURVE_C1/…/ROTATING2) | 1–6 | 链数(PATH 族) | BOUNDS(≤4) |
| complexity | number | 0.5 | 0–1 | 族内复杂度 | SAFE |
| rotationPerBeat | number | SWEEP 30°/ROTATING 45°(度) | 受玩家速度 clamp(弧度) | 旋转速率 | SAFE(clamp 兜底) |
| travel | string | FORWARD | FORWARD/BACKWARD | 伸链方向 | SAFE |
| thickness | number | 0.016 | 0.01–0.03(link 半径→0.005–0.015) | 链粗 | SAFE |
| corridorWidth | number | 0.16 | 0.07–0.4 | 走廊宽 | BOUNDS(≥0.10) |
| gap | number | 0.5 | 0.1–0.9 | 走廊中心 | SAFE |
| axis | string | VERTICAL | VERTICAL/HORIZONTAL | 走廊/S 曲轴向 | SAFE |
| points | [[x,y]…] | — | 0..1 | POLYLINE 显式 | SAFE |
| segments | int | 3 | 2–5 | ZIGZAG 段数 | SAFE |
| amplitude | number | 0.28 | 0.1–0.45 | SNAKE/CURVE_S 幅 | SAFE |
| pivot | string | LEFT | LEFT/RIGHT/TOP/BOTTOM | SWEEP 支点 | SAFE |
| direction | string | LEFT_TO_RIGHT | 四向(LANE) | 鞭向 | SAFE |
| width / laneCount / lane | — | 1 / 4 / seed | — | LANE 布置 | SAFE |

**Warning**:LANE=整条 lane 点亮+边缘亮片+箭头;线/路径=**整条路径 ghost + 起点充能光点**——路径在 warning 阶段完全可读(CORRIDOR 另画正向安全通道)。
**音乐亲和**:STRONG_BEAT/SNARE 重拍鞭击;PARALLEL/FAN 族=fill;CORRIDOR=持续 groove 段;SPIRAL INWARD=段落收束。

---

## 9. Floor Hazard 专项(A01 + A02 组合结论)

- tile 尺寸 = 1/cols × 1/rows(默认 0.25×0.25;**无上限 clamp**,6×6/8×8 都合法,rect 数量=格数)。
- 支持:checkerboard(AB 互补对)、stripe(rows/cols)、moving stripe(**无原生**——用 A02 MOVING 或 A09 RHYTHM 表达)、wave(**无原生**——A09 amplitude 是墙不是地板)、sequence(A01 连发交替,AP01/AP26)、directional floor(`sector` 固定右上楔,**只有这一个方向,角度写死**)、safe zone(A02)、shrinking safe zone(**无原生**;A02 intensity 收缩 patch 是一次性构造,不随时间缩)。
- **checker_A + checker_B 同时激活 = 100% 全场覆盖**(互补格),两段 telegraph 各自派生但互不知晓——组合时必须错开 ACTIVE 窗口(§13)。
- `all` 布局=必中(§6.1)。`outer_danger`+`center_danger` 同理互补。

---

## 10. Projectile 专项总表

| 能力 | 载体 | 参数 | 追踪? |
| ---- | ---- | ---- | ----- |
| 单发/散点 | A03 spread | count 1–4, lanes | 无 |
| 整墙带缝 | A03 wall | gaps 1–4(缝宽=spacing×0.85×gapScale) | 无 |
| 连发线 | A03 stream | count≤8, spacing≥0.25 | 无 |
| 扇形 | A03 fan | count 2–5, spreadDeg 10–70 | 无 |
| 旋转喷射 | A04 | stepDeg/subdivision/arms | 无 |
| 向内喷射 | A04 origin EDGE | — | 无 |
| 移动源 | A04 emitter ×7 路径 | emitterRadius/Speed | 弹不追踪(平行线,`RadialBurstMechanic.ts:245-252` 明确防"导弹读感") |
| 螺旋/双螺/花/环 | A08 | pattern/stepDeg/subdivision | 无 |
| homing | **不存在** | — | — |
| aimed-at-player | **不存在**(无任何 mechanic 读玩家位置;最接近的是确定性 seed) | — | — |

**结论:Arena 目前是纯 choreographed(编舞)弹幕,零追踪。** 所有"随机"都由 seed 锁定(patternId:startBar:repeat:eventIndex 哈希,`PatternScheduler.ts:173-181`)。

---

## 11. 组合 / 序列 / 编排能力

### 11.1 单 pattern 内多 hazard
- ✅ 一个 pattern 的 `events[]` 就是组合机制:任意数量 event,任意 mechanic,**同一 `at` 允许多个 event**→同拍齐发(无任何去重/互斥逻辑)。
- ✅ 顺序、延迟(`at.bar/beat/offsetBeats`,**支持小数拍**如 `beat: 1.5`)、pattern 内重复(写多个 event)。
- ❌ 嵌套 pattern、pattern 引用 pattern、运行时随机选 pattern、per-event intensity(intensity 在 placement 层)、循环/loop 结构。
- ⚠️ `constraints.maxSimultaneousThreats` 与 `requiresMechanics` **纯元数据——运行时与 loader 都不消费**(只有 `minReactionBeats` 真正进 timing clamp)。

### 11.2 Mechanic 内建复合
ringCount(A10 多环)、chains(A05 多链)、arms(A04/A07/A08)、gapCount(A03/A09/A10)、safeAreaCount(A02)、QUADRANT 轮转(A02)、FLOWER/PULSE(A08)——**一个 event 即一整套子编排**。

### 11.3 关卡层序列
- section:`startBar`(绝对,1 起)/`lengthBars`/`mode`/`function`/`difficulty` 1–5/`patterns[]`。
- placement:`patternId` + `repeat`(≥1)+ `intensity` 0..1。pattern 在 section 内**按声明顺序首尾相接**(cursorBar += lengthBars);overflow 会溢出到后续 bar(loader 只 warning)。
- 空隙=静默(gap 有 warning 不报错);`patterns:[]` 空数组=该段无 hazard(合法,warning)。
- **同拍多 pattern**:两个 pattern 的边界对齐时,前一个末拍与后一个首拍天然同拍——允许且常见。

### 11.4 模式切换缓冲(breather)
下一 section 模式不同时,本 section 尾部 `max(6 beat, 3s)` 内的 event **不 spawn**(`LevelLoader.ts:375-378`、`PatternScheduler.ts:89`)。ARENA→ARENA 不触发。这是唯一的运行时"编排级保护"。

### 11.5 新 pattern 的接入方式
pattern 必须存在于 loader 加载的 pattern 库(`src/config.ts:11` → `/patterns.mvp.json`,即 `beatbound_library_v1/patterns.mvp.json`;mechanic 库同理)。**给 Toosie Slide 编排新 pattern = 向 patterns.mvp.json 增加条目(mechanicId 必须是 A01–A11)+ 在 level JSON 写 placement**。无需改 TS。

---

## 12. 难度/缩放、并发与保护

- **Difficulty**:section 级 1–5 → tier(§5.3)→ telegraph/旅行速度/缺口三把尺子。**没有**全局 speedMultiplier/densityMultiplier 旋钮;`tier.densityScale` 是预留死字段。
- **并发上限**:**无**。ArenaMode 的 mechanics 数组无上限,只清理 FINISHED;唯一硬上限在各 mechanic 内部(A05 240 link、A03 4/8 发、A08 400 发、A01 60% 格)。`activeMechanicCount` 只是 HUD 只读统计。
- **对象池**:无(粒子 trail 6 采样,渲染层事务)。
- **可玩性保护(存在,但全部是单 mechanic 内)**:
  - telegraph 下限 0.6 beat/0.6s + pattern `minReactionBeats`;
  - 缺口宽度/角缺口下限(§5.5);
  - 移动缺口速度 ≤0.85×玩家;
  - A05/A10/A11 的 `ensureWarningFloor` 0.9s;
  - A10 环间 gap 边缘位移预算;
  - A01 派生警告(最长 4 beat);
  - 受击 0.8s 无敌。
- **跨 mechanic 保护:不存在。** No runtime playability guarantee for composed patterns —— 组合是否可解完全靠作者(以及离线工具 `tools/fairness-check.ts` 与 `tools/camp-audit.ts`,它们不在运行时)。

---

## 13. 当前明显危险组合(仅记录,不修改)

| 组合 | 风险 | 依据 |
| ---- | ---- | ---- |
| A01 `all`(或 checker_A+checker_B 同拍) | 理论必中(全场武装,只有 0.8s 无敌可赌) | `buildTiles` 显式格子不受 60% cap;两 checker 互补 |
| A02 任意形态 + A10 | 安全 patch 与环缺口**无协调**:patch 不在 gap 楔内=二选一必死 | 两 mechanic 独立构造,互不知晓 |
| A02 + A11 / A02 + A07(innerRadius 0) | live 楔/旋转臂扫过唯一 patch 时段=无解窗口 | 同上 |
| A03 wall 双侧同拍(对边) | 两组 gap 由各自 seed 决定,可能不重叠 | gap 抖动独立 |
| A06 横+竖 双激光 + A03 wall | 四象限只剩角,wall 缝可能不在角上 | A06 厚度上限 0.2 留 ≥0.3 走廊,但叠 wall 后危险 |
| A07 arms=6 + armArcDeg≈54(上限) | 臂间楔仅 6°,在 r<0.27 处窄于玩家直径,且**无角缺口 fairness 下限** | `maxArc = min(140,(360/arms)×0.9)` 是唯一 clamp |
| A07/A11 + 玩家被逼到 innerRadius>0 的中心孔 | 孔半径 ≤0.3 可站;若同时有 A08 内陷弹,孔内无遮蔽 | 组合叠加 |
| A09 SHRINK + 高 intensity + INTENSE tier | gapWidth 地板 0.06/shrinkTo 有效值仍 ≥0.052——可过,但叠 A03 spread 时窗口内已有弹 | 多 hazard 叠加 |
| A05 CORRIDOR corridorWidth=0.07(下限) + A01 任意 | 走廊 0.07 仅比最小缺口 0.06 大 0.01,地板格一旦压到走廊即堵 | 走廊宽无 fairness 下限 |
| 大量 A08 subdivision 0.125 × duration 长 | 弹幕 400 上限前屏幕密度极高(信息过载) | 上限存在但很高 |

**库元数据自declared 的 avoidWith**:A01↔A15(不存在)、A02/A05↔A14(不存在)、A06↔A06——只有 A06 自避是真实可参考的。

---

## 14. 组合兼容矩阵(判断依据=速度/警告/占位/时长,§3、§5)

| Primary ↓ / + | Ring(A10) | Chain(A05) | Floor(A01) | SafeTile(A02) | Bullet(A03/A04/A08) | Sector(A11) | Fan(A07) | Laser(A06) | Sweep(A09) |
| ------------- | --------- | ---------- | ---------- | ------------- | ------------------- | ----------- | -------- | --------- | --------- |
| **Ring** | CONDITIONAL:同拍双环 gap 各自定,可能无交集;**错拍序列 SAFE**(AP13) | CONDITIONAL:链线可能横穿 gap 楔;thin line 可跨 | **HIGH RISK**:地板格可武装 gap 下的地面 | **HIGH RISK**:patch≠gap 即无解 | CONDITIONAL:弹穿 gap,可读但挤 | CONDITIONAL:live 楔可能恰盖 gap | CONDITIONAL:臂扫过 gap 时段 | CONDITIONAL:环+带可夹出死角 | CONDITIONAL:两移动系统,gap 与窗口无协调 |
| **Chain** | — | SAFE:细线互穿,X_CROSS 本身就是多链 | CONDITIONAL:走线可能被格子压 | **HIGH RISK**:CORRIDOR 通道须含 patch | SAFE | CONDITIONAL | SAFE | CONDITIONAL | CONDITIONAL |
| **Floor(A01)** | — | — | **HIGH RISK**:互补布局=全覆盖 | **HIGH RISK**:格+补集可全覆盖 | SAFE–CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL |
| **SafeTile(A02)** | — | — | — | SAFE(多 patch 并存) | CONDITIONAL:wall 缝须落在 patch 侧 | **HIGH RISK** | **HIGH RISK**(臂到心) | CONDITIONAL | CONDITIONAL |
| **Bullet** | — | — | — | — | CONDITIONAL:对侧 wall 缝不对齐 | SAFE(AP21/AP22 实证) | SAFE(AP16 实证) | SAFE | SAFE |
| **Sector(A11)** | — | — | — | — | — | CONDITIONAL:双 sweep 方向/步频冲突 | CONDITIONAL | SAFE | CONDITIONAL |
| **Fan(A07)** | — | — | — | — | — | — | SAFE(差速双扇,需验臂距) | SAFE | SAFE |
| **Laser(A06)** | — | — | — | — | — | — | — | CONDITIONAL:横竖交叉留四角,再加第三个=HIGH RISK | SAFE |
| **Sweep(A09)** | — | — | — | — | — | — | — | — | CONDITIONAL:正交双墙缝须相交 |

判定口径:SAFE=有实证 pattern 或几何上必然留安全域;CONDITIONAL=需作者保证参数(gap/位置对齐或错拍);HIGH RISK=存在无协调的天然冲突,默认参数下可能不可解。

---

## 15. 设计语言总结(Design Vocabulary)

### Spatial pressure(空间压迫)
A02 全场压迫(唯一 patch)、A10 环收拢、A01 `center_danger`/`all`、A03 wall、A09 墙+SHRINK、A06 带。

### Directional attacks(方向性攻击)
A03 四边弹幕、A05 LANE 四向鞭、A09 定向墙、A04 origin EDGE 向内喷。

### Timing attacks(时间判定)
A01 派生 warning→燃烧窗、A02 QUADRANT 轮转拍、A07 beat 量化旋转、A11 stepBeats 步进、A09 RHYTHM gapPath、A03 stream spacing。

### Continuous hazards(持续存在)
A07(全 ACTIVE 旋转)、A11(整段扫掠)、A02(全 ACTIVE 补集)、A06(整段带)、A10 多环序列、A04/A08 持续发射(弹幕长尾)。

### Reactive / tracking hazards(反应/追踪)
**无。** 全部编舞化、seed 确定、零玩家读取。

### Visual-only feedback(纯视觉)
发射器本体(A04/A08 中心圆点,无碰撞)、A03 拖尾、SAFE 字样/箭头/方向字符、feel 层(打击停顿 0.06s、震屏、粒子——不影响判定)、`A01.warningStyle` 装饰参数、`role` 字段(DUO 管道,单人无效果)。

---

## 16. 音乐亲和速查(能力分类,非具体设计)

| mechanic | 适合 | 不适合 |
| -------- | ---- | ------ |
| A01 | 四分/反拍鼓点、段落重音、半拍 checker 交替 | 16 分密网(格子系统读不动) |
| A02 STATIC | 长音/verse 托底、breakdown | 快速细分 |
| A02 MOVING | 旋律线、loop、人声滑音的位移隐喻 | — |
| A02 QUADRANT | 小节脉动、4 小节结构 | 半拍级事件 |
| A03 spread | 旋律单音、hi-hat 点 | — |
| A03 wall | 强拍、bar 边界、fill 落点 | 16 分连发 |
| A03 stream | hi-hat/16 分连击(spacing 0.25 地板) | — |
| A03 fan | 和弦 stab | — |
| A04 | kick/synth 琶音(subdivision 0.5–2)、ALTERNATE=对答句 | 稀疏长点(>2 beat 读不出趋势) |
| A05 | snare 重拍鞭、fill(PARALLEL/FAN)、groove(CORRIDOR) | — |
| A06 | downbeat、bass drop、短促重锤 | 持续调制 |
| A07 | synth loop、逐拍旋转=节奏锁定、摆锤=乐句摆动 | 稀疏点(它整段都在) |
| A08 | **16/32 分 hi-hat、drum roll、build**(分辨率 0.125)、PULSE=kick 环 | 稀疏段 |
| A09 | bar 级长句;RHYTHM=切分/固定音型同步;SHRINK=渐强 | — |
| A10 | 强拍/短语边界/drop、多环=跨小节句 | 16 分 |
| A11 | 8 分/四分脉冲、CW/CCW 对答、skipStep 切分 | 半拍以下 |

---

## 17. 真实 JSON 示例

### 17.1 每个 mechanic 的最小 event(pattern 库内格式,parser 实际消费)

```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A01" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A02" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A03" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A04" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A05" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A06" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A07" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A08" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A09" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A10" }
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "A11" }
```

### 17.2 完整最小 pattern + 关卡(以 A10 为例,可直接加入库)

patterns.mvp.json 新增条目:

```json
{
  "id": "AP90",
  "name": "Audit Demo Ring",
  "mode": "ARENA",
  "function": "VARIATION",
  "difficulty": { "overall": 3, "reaction": 3, "rhythmComplexity": 2, "spatialComplexity": 3, "inputComplexity": 2, "informationLoad": 3 },
  "lengthBars": 2,
  "events": [
    { "at": { "bar": 1, "beat": 1 }, "mechanicId": "A10" },
    { "at": { "bar": 2, "beat": 3 }, "mechanicId": "A10", "params": { "mode": "EXPAND" } }
  ],
  "constraints": { "minReactionBeats": 1, "maxSimultaneousThreats": 1, "requiresMechanics": ["A10"] }
}
```

level JSON 段落:

```json
{
  "id": "S-ARENA-DEMO",
  "startBar": 45,
  "lengthBars": 4,
  "mode": "ARENA",
  "function": "VARIATION",
  "difficulty": 3,
  "patterns": [ { "patternId": "AP90", "repeat": 1, "intensity": 0.6 } ],
  "transitionOut": null
}
```

### 17.3 高级示例(全部为当前真实支持)

**旋转缺口三连环 + 对角墙 + 半拍弹(同 pattern 编排,含小数拍):**

```json
{
  "id": "AP91",
  "name": "Audit Advanced Combo",
  "mode": "ARENA",
  "function": "CLIMAX",
  "difficulty": { "overall": 5, "reaction": 4, "rhythmComplexity": 4, "spatialComplexity": 4, "inputComplexity": 3, "informationLoad": 5 },
  "lengthBars": 4,
  "events": [
    { "at": { "bar": 1, "beat": 1 }, "mechanicId": "A10", "params": {
        "variant": "ROTATING_GAP", "mode": "COLLAPSE", "ringCount": 3,
        "gapArcDeg": 60, "gapAngleDeg": -90, "rotationPerRingDeg": 34,
        "thickness": 0.08, "telegraphBeats": 1.5 } },
    { "at": { "bar": 2, "beat": 1, "offsetBeats": 0.5 }, "mechanicId": "A09", "params": {
        "mode": "RHYTHM", "axis": "DIAGONAL", "gapWidth": 0.24,
        "gapPath": [0.3, 0.45, 0.6, 0.45] } },
    { "at": { "bar": 3, "beat": 1 }, "mechanicId": "A08", "params": {
        "pattern": "DOUBLE_SPIRAL", "direction": "CW", "subdivision": 0.25,
        "stepDeg": 26, "expand": true, "durationBeats": 4 } },
    { "at": { "bar": 4, "beat": 1 }, "mechanicId": "A11", "params": {
        "sectorCount": 8, "sweepDirection": "CCW", "skipStep": 1, "firstAngleDeg": -90 } },
    { "at": { "bar": 4, "beat": 3 }, "mechanicId": "A03", "params": {
        "spawnSide": "TOP", "formation": "fan", "count": 4, "spreadDeg": 40 } }
  ],
  "constraints": { "minReactionBeats": 1, "maxSimultaneousThreats": 2, "requiresMechanics": ["A10", "A09", "A08", "A11", "A03"] }
}
```

**单 event 高级形态示例(逐 mechanic 选摘,全部合法):**

```json
{ "mechanicId": "A05", "params": { "layout": "ROTATING_CHAINS", "chains": 4, "rotationPerBeat": 0.5, "complexity": 0.8, "durationBeats": 4 } }
{ "mechanicId": "A04", "params": { "emitter": "FIGURE_EIGHT", "emitterRadius": 0.26, "emitterSpeed": 0.35, "direction": "ALTERNATE", "subdivision": 0.5, "stepDeg": 35, "arms": 2, "durationBeats": 6 } }
{ "mechanicId": "A02", "params": { "safeZone": "MOVING", "movePath": "LINE_Y", "moveRadius": 0.3, "moveSpeed": 0.3, "safeAreaSize": 0.28, "durationBeats": 8 } }
{ "mechanicId": "A01", "params": { "layout": "outer_danger", "grid": [6, 6], "damageActiveBeats": 1.5, "telegraphBeats": 2 } }
{ "mechanicId": "A03", "params": { "spawnSide": "LEFT", "formation": "stream", "count": 6, "spacing": 0.5, "lanes": [0.35] } }
{ "mechanicId": "A07", "params": { "arms": 3, "armArcDeg": 45, "rotationPerBeatDeg": 60, "reversalBeats": 4, "innerRadius": 0.08, "durationBeats": 8 } }
```

> 注意 `telegraphBeats` / `durationBeats` / `cooldownBeats` 可直接出现在任何 event.params 中覆盖库值(§5.2)。

---

# ARENA DESIGNER CHEAT SHEET

### Currently usable primary hazards(主威胁)
`A10 Ring`(缺口环,difficulty 3)· `A11 Sector Sweep`(轮燃楔,3)· `A07 Rotating Fan`(旋转/摆锤扇,3)· `A09 Wave Sweep`(窗口墙,2)· `A05 Chain`(16 种 layout 的链鞭,2)· `A06 Laser`(静态带,2)

### Secondary hazards(副/点缀威胁)
`A03 Projectile`(spread/wall/stream/fan,1)· `A04 Radial Burst`(旋转喷射+移动发射器,3)· `A08 Spiral`(SPIRAL/DOUBLE_SPIRAL/FLOWER/PULSE,4)

### Floor / zone mechanics(地板/区域)
`A01 Floor Warning`(12 种布局)· `A02 Safe Tile`(STATIC/MOVING/QUADRANT)

### Directional mechanics(方向性)
A03 spawnSide 四边 · A05 LANE 四向 · A09 axis(H/V/对角)+direction · A04 origin EDGE · A11 CW/CCW

### Continuous mechanics(持续存在)
A07 全程旋转 · A11 全程扫掠 · A02 全程补集 · A06 全程带 · A04/A08 持续发射 · A10 多环序列

### Best mechanics for beat sync(节拍同步)
强拍/downbeat:A10、A06、A03 wall、A02 QUADRANT · 反拍/8 分:A04(subdivision 0.5)、A11、A03 stream · 16 分/32 分:A08(subdivision 最低 0.125)、A03 stream spacing 0.25 · 切分:A09 RHYTHM gapPath、A11 skipStep、A04 ALTERNATE

### Best mechanics for melody motion(旋律运动)
A02 MOVING(漂移安全区跟随旋律线)· A04 移动发射器(7 种路径画旋律轮廓)· A05 CURVE_S/SPIRAL(曲线行进)· A07 摆锤(乐句摇摆)

### Best mechanics for vocals(人声段)
A02 STATIC/MOVING(托底 sustain + 位移隐喻)· A09 RHYTHM(逐拍窗口踩人声节奏点)· A03 spread(单音点缀)

### Current hard limitations(硬限制)
- 无追踪/瞄准玩家的一切能力(纯编舞)
- Ring 中心恒为场心,不可移动;A01 `sector` 布局角度写死(-90°..0)
- timing 只能 beat 键;玩家移动是实时秒(不随 BPM 缩放)
- `constraints.maxSimultaneousThreats`/`requiresMechanics` 不被运行时消费
- 无运行时并发上限/组合保护;无全局难度倍率(只有 tier+intensity 两条映射)
- 新 pattern 必须写进 patterns.mvp.json 才能被 loader 找到
- `A10 variant:"FOLLOW_GAP"` = BASIC_GAP(不跟随玩家)
- pattern 内无循环/嵌套/随机结构;事件粒度最细 0.125 beat(写任意小数都合法)

### Known dangerous combinations(已知危险组合)
见 §13。要点:`A01 all` 必中;A02×(A10/A07/A11) 无协调;checker_A+B 同拍全覆盖;对侧双 wall 缝可能不对齐;A07 6 臂×54° 无角缺口下限。

### 给 Toosie Slide(123.05 BPM,~147s≈75 bar)编排的定量备忘
- spb=0.4876s;玩家每 beat 走 0.302(=30% 场宽);全场横穿 3.3 beat
- 移动缺口速度上限 0.257/beat(A02/A04/A09/A10/A11 内建 clamp)
- 最低 telegraph:max(0.6 beat, pattern minReactionBeats);实际=库值×tier.scale×intensity 缩放
- section difficulty 建议:开场 1–2、副歌 3、drop/climax 4;INTENSE(4+)只在真正的高潮段用
- 现有 ARENA 段:S01(bars 1–12)与 S05(bars 45–60);其余段属于其他模式,按任务要求不动

---

*审计方法:通读 LevelLoader/PatternScheduler/MechanicRegistry/Mechanic/ArenaMode/ArenaPlayer/geometry/fairness/Intensity/arenaTiming/tuning 全文 + 11 个 mechanic 实现全文 + mechanics/patterns 库 + arena 关卡 + tools(fairness-check/sync-test/level-report)与 labs 接线。无遗留 UNKNOWN 项;唯一行为性发现是 FOLLOW_GAP 别名(BASIC_GAP 分支,源码可证)。*
