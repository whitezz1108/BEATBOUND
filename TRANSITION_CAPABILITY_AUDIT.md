# BeatBound TRANSITION — Mode-Switch Capability Audit (READ-ONLY)

日期:2026-09-20 · 审计范围:**ARENA / RUNNER / VERTICAL / RADIAL 之间的模式切换运行时能力**
配套机读目录:`TRANSITION_CAPABILITY_CATALOG.json`
审计规范:`prompt/audit prompt/BeatBound_TRANSITION_Capability_Audit_Prompt.md`

> 本报告只记录**当前代码实际能运行的能力**,全部结论追到真实 runtime 代码路径。
> 未修改任何 gameplay 代码,未修改 Editor,未执行任何 git 操作。
> 所有行号以当前工作区文件为准(2026-09-20 工作区状态)。

---

## 0. 结论摘要(Executive Summary)

| 项目 | 数量 | 说明 |
| --- | ---: | --- |
| Runtime 可用 gameplay mode | **4** | ARENA / RUNNER / VERTICAL / RADIAL,`BeatBoundGame.ts:183-186` 注册 |
| 声明但无 runtime 的 mode | **1** | DUO(`src/core/types.ts:11` GAME_MODES 枚举含 DUO;无 factory → `PlaceholderMode`,`ModeManager.ts:199`) |
| mode→mode 真实可达转换 | **16/16 格 SUPPORTED**(4 same-mode + 12 cross-mode) | 切换机制完全 mode-agnostic,切换路径上无任何 mode-id 分支 |
| 库内 pattern | **71** | `patterns.mvp.json`,其中 `function:"TRANSITION"` 2 个(RP10、RP22) |
| mechanic 注册 vs 库数据 | **24 注册 = 24 库条目** | A01–A11 / R01–R04,R08,R09 / V01–V04 / D01,D02,D06,全部可达 |
| Unreachable / dead 实现 | **2** | ① DUO 的 PlaceholderMode 路径(shipped 内容不可达);② `ModeManager.pending` 对"永不激活 mode"的长期缓冲(仅病理 level 可达,>64 静默丢弃) |
| Metadata-only / 运行时 no-op 字段 | **6** | `scene.effects`、`section.function`、`pattern.function`、`transitionOut`(仅显示)、`CourseSpec.seed`(写不读)、`event.role`(携带不分支) |
| JSON 层不存在的 authoring 字段 | **6** | `transitionIn` / `breather` / `leadIn` / `modeSwitch` / `cameraTransition` / section 级 `duration` —— parser 不认识,NOT SUPPORTED |
| 唯一公平性缺口 | **1 项** | 非 RUNNER → **pattern 式 RUNNER section**:首障碍 spawn 提前 4 拍但被 pending 压到切换拍才入屏,失去完整 4 拍滚入预警(§4.2、§14) |

**核心结论**:BeatBound 的模式切换是一条完全由 section 驱动、mode-agnostic 的流水线。任何 mode→任何 mode 的切换走**同一段代码**,行为只随两端 mode 各自的 `activate()/deactivate()` 实现不同。切换前 runtime 自动生成 `max(6 拍, ≈3s)` 的 breather(仅抑制新 spawn,**不提前清除已 spawn 的 hazard**),在 section 边界前 ≤1 bar 提前激活新 mode,旧 mode 的全部 mechanic 在切换拍被一次性清空。音乐与 BeatClock 全程连续,不打断、不重置。

---

## 1. Mode 与真实标识(规范 §4)

真实 enum:`src/core/types.ts:11`

```ts
export const GAME_MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL', 'DUO'] as const;
export type GameMode = (typeof GAME_MODES)[number];
```

| Mode ID | Runtime 实现 | 注册位置 | activate 行为 | deactivate 行为 |
| --- | --- | --- | --- | --- |
| `ARENA` | `ArenaMode` (`src/modes/arena/ArenaMode.ts:33`) | `BeatBoundGame.ts:183` | player.reset()(回中心 0.5,0.5,v=0)、清 mechanics/graze 态(50-56) | `mechanics = []`(58-60) |
| `RUNNER` | `RunnerMode` (`src/modes/runner/RunnerMode.ts:53`) | `BeatBoundGame.ts:184` | player.reset()(落回 GROUND_Y)、gravityDirection=1、manualFlip=false、清 breadcrumbs(79-85) | `mechanics = []`(87-89) |
| `VERTICAL` | `VerticalMode extends NoteMode` (`src/modes/vertical/VerticalMode.ts:46`) | `BeatBoundGame.ts:185` | NoteMode.activate:清 mechanics、combo=0、verdictCounts 清零(`NoteMode.ts:82-87`) | `mechanics = []`(`NoteMode.ts:89-91`) |
| `RADIAL` | `RadialMode extends NoteMode` (`src/modes/radial/RadialMode.ts:41`) | `BeatBoundGame.ts:186` | 同上(继承 NoteMode.activate) | 同上 |
| `DUO` | **无 factory** → `PlaceholderMode` (`src/modes/PlaceholderMode.ts`) | 未注册 | `skipped = 0`(18) | no-op(19) |

**不存在** `NONE` / `INTRO` / `TRANSITION` / `BREAK` 这样的 mode id。相关同名物只有:

- `PatternFunction` 枚举中的 `'TRANSITION'`(`types.ts:15`)——pattern 库的**元数据标签**,runtime 从不读取(pattern 调度不分支 on function);库内 RP10、RP22 两个 pattern 声明了它。
- Editor 生成器 `editor/generator/transitionGenerator.js` 内部的 transition record(`kind: "ARENA_TO_RUNNER"` 等)——只存在于 editor 蓝图,不进入 runtime level JSON 的消费路径。

每个 mechanic / pattern 在库里声明归属 mode(`definition.mode` / `pattern.mode`);ModeManager **只按 `definition.mode` 路由,从不看 mechanic id 或 params**(`ModeManager.ts:113-130`)。

---

## 2. 完整切换调用链(规范 §5)

真实 runtime call chain(全部为当前代码,`→` 为真实函数调用):

```
level JSON sections[]
  │
  ▼ LevelLoader.build()/compile()                     src/core/LevelLoader.ts:326-384
  │   每个 section 产出一个 CompiledSection:
  │     mode / startBar / endBar
  │     leadInBeats      = course ? max(SCROLL_LEAD_BEATS=4, beatsPerBar)     (369, 420)
  │                       : min(该 section 所用 mechanic 库 telegraphBeats 的最大值, beatsPerBar)  (369)
  │     transitionOut    = definition.transitionOut ?? null                   (370)
  │     nextMode         = 下一 section 的 mode(无则 null)                    (371)
  │     breatherFromBeat = (mode 将变) ? sectionEndBeat
  │                          - max(TUNING.transition.breatherBeats=6,
  │                                beatsForSeconds(bpm, countdownSeconds=3))  (375-378)
  │                        (同 mode → null)
  │
  ▼ BeatBoundGame.buildSystems()                       src/game/BeatBoundGame.ts:171-207
  │   scheduleSections()  (210-220):
  │     modes.scheduleMode(section.mode, (startBar-1)*beatsPerBar - leadInBeats,
  │                        previousTransition)   ← previousTransition = 上一 section 的 transitionOut
  │   scheduler.scheduleLevel(level)  → PatternScheduler.schedulePlacement()  PatternScheduler.ts:74-131
  │     activationBeat = patternStart + specToRelativeBeats(event.at)
  │     if (section.breatherFromBeat !== null && activationBeat >= section.breatherFromBeat)
  │       continue;                      ← breather:静默抑制(89)
  │     spawnBeat = activationBeat - registry.spawnLeadBeats(mechanicId)      (95)
  │     clock.scheduleAtBeat(spawnBeat, → registry.create(...) → sinks)       (99-130)
  │   scheduleCourses()  (230-234) → scheduleCourse()  courseSchedule.ts:46-76
  │     spawnBeat = course.startBeat - course.leadInBeats(= section 起拍前 1 bar)
  │     合成 'R-COURSE' mechanic → 同一个 sink
  │
  ▼ BeatClock.update() → fireDueEvents()               src/core/BeatClock.ts:177-200
  │   (按 beat 顺序、同拍按插入序弹出;mode 切换先于 mechanic spawn 注册,同拍先执行)
  │
  ▼ ModeManager.setMode(mode, firedBeat, transitionId)  src/core/ModeManager.ts:95-111
  │     1. if (current?.mode === mode) return;        ← same-mode 边界:整体 no-op(96)
  │     2. previous.deactivate(atBeat)                ← 旧 mode 清空全部 mechanic(98)
  │     3. instanceFor(mode).activate(atBeat)         ← 新 mode 激活 + player reset(100-101)
  │     4. flushPending(mode)                         ← 把提前 spawn 的 mechanic 移交新 mode(103, 132-137)
  │     5. transition = { id, from, to, startBeat, lengthBeats: sceneBeats=2 }(104-110)
  │
  ▼ ModeManager.route(info)  (= scheduler.onMechanicSpawned sink, 117-130)
  │     info.mode === current.mode ? current.accept(info)
  │                                 : pending[mode].push(info)   (MAX_PENDING=64,溢出丢最旧+计数)
  │
  ▼ 每帧(BeatBoundGame.frame, 379-420)
      songPlayer.update → clock.update(触发以上全部回调)
      → modes.update(u)        只更新 current 一个 mode(155)
      → input.endFrame()       清 pressedThisFrame(410)
      → draw(): renderer.resetCamera → feel.applyCamera → modes.render(现 mode + 切换 overlay)
```

**关键时序事实**:`scheduleSections()`(210)先于 `scheduleLevel()`(190)注册,所以**同一拍上 mode 切换回调先于该拍的首个 mechanic spawn 回调执行**(BeatClock 队列同拍按插入序,`BeatClock.ts:130-140`)——新 mode 的第一个 telegraph 事件 spawn 时 mode 已经 live,通常直接 accept,不经过 pending。RUNNER 是例外:obstacle 的 `spawnLeadBeats = SCROLL_LEAD_BEATS = 4`(`runnerGeometry.ts:25`,注册于 `mechanics/runner/index.ts:18`)而 pattern section 的 `leadInBeats = min(库 telegraph 最大值≤1, 4)`,因此 RUNNER 首 obstacle 通常**早于切换 3 拍 spawn,先进 `pending` 队列,切换时 flush**——这是 pending 队列的主用途,真实可达。

---

## 3. Breather / Quiet Window 专项(规范 §6)

### 3.1 规则本体(重新从代码推导,非引用旧报告)

`LevelLoader.ts:375-378`:

```ts
breatherFromBeat: modeChanges
  ? (definition.startBar - 1 + definition.lengthBars) * beatsPerBar
    - Math.max(TUNING.transition.breatherBeats, beatsForSeconds(level.song.bpm, TUNING.transition.countdownSeconds))
  : null,
```

- `TUNING.transition.breatherBeats = 6`(`tuning.ts:89`)
- `TUNING.transition.countdownSeconds = 3`(`tuning.ts:84`)
- `beatsForSeconds(bpm, s) = max(1, round(s*bpm/60))`(`tuning.ts:296-298`)

即:**breather 长度 = max(6 拍, 3 秒折算整拍数),从 section 末拍往前推**。**仅当相邻两个 section mode 不同时存在;同 mode 为 `null`。**

### 3.2 它到底是什么行为(逐问回答)

| 问题 | 答案 | 证据 |
| --- | --- | --- |
| 是否所有 mode→不同 mode 都生效? | **是**。只判断 `next.mode !== definition.mode`,不看具体 mode 对(`LevelLoader.ts:333`) | LevelLoader.ts:332-334 |
| 发生在哪一层? | **PatternScheduler 的 spawn 抑制**(compile 期计算,schedule 期消费) | PatternScheduler.ts:89 |
| suppress spawn 还是提前结束 active hazard? | **只 suppress spawn**:`if (section.breatherFromBeat !== null && activationBeat >= section.breatherFromBeat) continue;`。已创建的 mechanic 一概不提前结束 | PatternScheduler.ts:89 |
| 已 spawn 的 hazard 会不会继续存在? | **会,且继续造成伤害**,直到模式切换拍 `deactivate()` 才被清空。breather 期间 ARENA 碰撞检测照常运行 | ArenaMode.ts:71-86, 88-127 |
| warning 会不会跨 transition? | 被抑制的事件**连 warning 都不存在**(mechanic 对象未创建)。已存在 mechanic 的 telegraph 可以延伸进 breather,但其宿主在切换拍被清除 | PatternScheduler.ts:89; ArenaMode.deactivate |
| note/hold 会不会跨 transition? | spawn 于 breather 前、activation 亦在 breather 前的 note/hold 正常存在;**hold 可以延伸越过 section 末拍**,直到切换拍被 `deactivate()` 直接清除——**不掉血、不计 MISS**(`NoteMode.deactivate` 只是 `mechanics = []`) | NoteMode.ts:89-91 |
| 不同 BPM 下如何取值? | 见 3.3 表。**注意 `Math.round` 可能向下取整,3 秒并不严格保证** | tuning.ts:296-298 |
| same-mode section 是否不触发? | **不触发**(`modeChanges` 为 false → `null`;scheduler 检查 `!== null`) | LevelLoader.ts:375; PatternScheduler.ts:89 |
| transitionOut 是否有运行时效果? | **有,但仅视觉效果**:作为切换 overlay 的文字标签 id(`ModeManager.renderTransition` 中 `t.id.replace(/_/g,' ').toLowerCase()` 显示,ModeManager.ts:188)。对 gameplay(时序、清理、camera)**零影响** | BeatBoundGame.ts:217-218; ModeManager.ts:104-110, 188 |

### 3.3 BPM 对照表

`round(bpm/20)`(JS Math.round,.5 向上),breather 拍数 = `max(6, round(bpm/20))`,秒数 = 拍数 × 60/bpm:

| BPM | 3s 折算拍数 | breather 拍数 | 实际秒数 |
| ---: | ---: | ---: | ---: |
| 90 | 5 (round 4.5=5) | 6(floor 生效) | **4.00 s** |
| 100 | 5 | 6 | **3.60 s** |
| 110 | 6 (5.5→6) | 6 | **3.27 s** |
| **120** | 6 | 6 | **3.00 s** |
| 126 | 6 (6.3→6) | 6 | **2.86 s** |
| 128 | 6 (6.4→6) | 6 | **2.81 s** ← 全域最小点 |
| 130 | 7 (6.5→7) | 7 | **3.23 s** |
| 140 | 7 | 7 | **3.00 s** |
| 160 | 8 | 8 | **3.00 s** |
| 174 | 9 (8.7→9) | 9 | **3.10 s** |
| 200 | 10 | 10 | **3.00 s** |

**精确保证**:静默窗 ≥ 6 拍;秒数**近似** 3s,但因整拍舍入可在 (120,130) BPM 区间 undershoot 至 ≈2.81s。runtime 的硬下限是"6 拍",不是"3 秒"。

### 3.4 Breather 的玩家可见反馈

`BeatBoundGame.drawBreather()`(`BeatBoundGame.ts:499-516`):`section.breatherFromBeat` 非空且 `nextMode` 非空时,从 breather 起点到 section 末拍绘制:`NEXT: <MODE>`(下一 mode 主题色 `MODE_COLOURS`,`ModeManager.ts:23-29`)+ 下一 mode 的按键提示(`MODE_CONTROLS`,`controls.ts:45-60`)+ 3-2-1 倒数(3 秒映射到 breather 拍数,alpha 1.5 拍淡入)。

### 3.5 附:mode 提前激活(lead-in)

新 mode 在 section 首拍前 `leadInBeats` 拍即已 live(`BeatBoundGame.ts:217`)。pattern section:`min(该 section mechanic 库 telegraph 最大值, beatsPerBar)`(最多 1 拍);course section:`max(SCROLL_LEAD_BEATS=4, beatsPerBar)` = 4/4 下 4 拍。**因此旧 mode 的实际存活时间比 section 名义长度短最多 1 bar**;旧 mode 的"真实静默期" = breather − leadIn(其余部分由新 mode 接管,但新 mode 此时通常还没有任何 mechanic)。

---

## 4. Transition Matrix(规范 §7)

切换机制完全 mode-agnostic(grep 证实 `src/core`、`src/game` 无任何 mode-id 分支;唯一 mode 判断在 LevelLoader 的 course 校验 `mode !== 'RUNNER'`,与切换无关)。每格的行为差异只来自两端 mode 各自的 activate/deactivate。

判定:**16 格全部 SUPPORTED**(无 UNKNOWN / BROKEN)。

| From \ To | ARENA | RUNNER | VERTICAL | RADIAL |
|---|---|---|---|---|
| **ARENA** | same-mode:no-op 边界 | SUPPORTED | SUPPORTED | SUPPORTED |
| **RUNNER** | SUPPORTED | same-mode:连续 | SUPPORTED | SUPPORTED |
| **VERTICAL** | SUPPORTED | SUPPORTED | same-mode:连续 | SUPPORTED |
| **RADIAL** | SUPPORTED | SUPPORTED | SUPPORTED | same-mode:连续 |

### 4.1 跨 mode 格公共行为(12 格一致)

| 维度 | 行为 | 证据 |
| --- | --- | --- |
| player reset | **是**,新 mode `activate()` 内:`ArenaPlayer.reset()`(回 0.5,0.5,v=0)/ `RunnerPlayer.reset()`(GROUND_Y、grounded、gravity=1)/ NoteMode(无 player,重置 combo/verdicts) | ArenaMode.ts:50-56; RunnerMode.ts:79-85; RunnerPlayer.ts:133-147; NoteMode.ts:82-87 |
| hazard/note cleanup | **是**,旧 mode `deactivate()` 即 `mechanics = []`(bullets/warnings/notes/obstacles/course 全部瞬时消失) | 各 Mode deactivate |
| camera | **不重置**。共享 `CameraFX` 连续(见 §7) | GameFeel.ts:182-185, 207-212 |
| input | **不切换、不清空**(见 §6) | Input.ts |
| spawn suppression | **是**,旧 section 尾部 `max(6 拍, ≈3s)` | PatternScheduler.ts:89 |
| minimum quiet time | ≥6 拍 spawn 静默(≈3s,见 3.3);**活跃 hazard 可伤人直到切换拍** | LevelLoader.ts:375-378 |
| 视觉 | 2 拍场景 wipe(目标 mode 色带 + mode 名 + transitionOut 标签),纯视觉 | ModeManager.ts:172-191; tuning.ts:91 |

### 4.2 格间真实差异(仅有的两点)

1. **→ pattern 式 RUNNER**:RUNNER 障碍 spawn lead 固定 4 拍(`SCROLL_LEAD_BEATS`),而 leadIn ≤1 拍 → 首障碍先进 pending、切换拍 flush,入屏时已按绝对拍推算滚入 ~3/4 行程——**预警被压缩,但对拍精确**。course 式 RUNNER 无此问题(course 的 leadIn = 4 拍,与滚入 lead 匹配)。
2. **→ NoteMode(VERTICAL/RADIAL)**:首 note 的 approach 即 telegraph(2 拍 × tier 缩放),leadIn 恰好匹配 → 切换拍起完整可见。

(→DUO / DUO→:结构 SUPPORTED,玩法 NOT SUPPORTED——PlaceholderMode 空转。)

---

## 5. Player State Handoff(规范 §8)

| 状态 | 跨 mode 切换 | 证据/说明 |
| --- | --- | --- |
| health | **preserved** | 单一 `HealthManager` 挂在 `RunStatus` 上,整个 run 一份,四 mode 共享;仅 `BeatBoundGame.start()` 经 `status.reset()` 重置(`RunStatus.ts:57-63`;`HealthManager.ts:6-9` 注释明示设计意图) |
| score(hits / notesHit / notesMissed) | **preserved** | `RunStatus.hits/notesHit/notesMissed` 全 run 累计,模式切换不触碰 |
| combo | **reset(跨 mode 进入)/ preserved(same-mode 边界)** | `NoteMode.activate()` `combo = 0`(`NoteMode.ts:85`);`bestCombo` 保留;`setMode` same-mode 早退不调用 activate。ARENA/RUNNER 无 combo 概念 |
| multiplier | **NOT SUPPORTED(不存在)** | 代码中无任何 multiplier 字段 |
| invulnerability | **preserved** | `HealthManager.invulnerableUntil` 以 song 秒计(0.8s 窗,`tuning.ts:62`),切换不重置;新 mode 的伤害判定与受击闪烁都会读它(`RunStatus.isInvulnerable`) |
| position | **reset(新 mode 初始化)** | ArenaPlayer→(0.5,0.5);RunnerPlayer→GROUND_Y;NoteMode 无 player。**不跨 mode 携带** |
| velocity | **reset** | ArenaPlayer.vx/vy=0;RunnerPlayer.velocity=0 |
| gravity state(RUNNER) | **reset** | `RunnerMode.activate()` `gravityDirection = 1; manualFlip = false`;`RunnerPlayer.reset()` gravityDirection=1、grounded=true |
| held keys | **preserved(全局,不清)** | `Input.down` Set 与 mode 无关(见 §6) |
| active hold notes | **dropped(无惩罚)** | 随 `deactivate()` 清空;不掉血不计 MISS,combo 不因切断而扣 |
| difficulty | **section-local,逐 spawn 生效** | `section.definition.difficulty` 在 spawn 时传入 registry(`PatternScheduler.ts:111`),立即改变后续 spawn 的 tier 参数(见 §13) |
| intensity | **placement-local** | 每 placement `intensity ?? 0.5`,只影响该 placement 的 mechanic 参数 |

附:跨 activation 仍保留的 mode 实例内部计数(ArenaMode.perfects、RunnerMode.jumps、NoteMode.bestCombo)——仅 HUD 显示用,无 gameplay 影响。

---

## 6. Input Context Handoff(规范 §9)

单一全局 `Input`(`src/core/Input.ts`),mode 不自绑按键;绑定表 `src/core/controls.ts`。

| 检查项 | 结论 |
| --- | --- |
| 按住某键跨切换 | **`down` Set 原样保留**。切换不清键盘状态;新 mode 立即能读到按住态(`isDown`)。按键表重叠:VERTICAL lane 键 a/s/d 同时是 ARENA 左/下/右;RADIAL 与 ARENA/RUNNER 共用 w/a/s/d/arrows |
| keydown state 是否清空 | **否**(仅 `window.blur` 清空,`Input.ts:24`;每帧 `endFrame()` 清 `pressedThisFrame`,`Input.ts:45-47`) |
| keyup 缺失是否卡键 | keyup 即删(`Input.ts:23`);窗口失焦兜底清空;切帧/切 mode 不影响 keyup 处理。极端 OS 层丢 keyup:NEEDS RUNTIME VERIFICATION |
| 切换帧是否两 mode 同时读输入 | **不会**。切换发生在 `clock.update()` 的回调里,先于本帧 `modes.update()`;每帧只有 `current` 一个 mode 被更新(`ModeManager.ts:155`)。`wasPressed` 边沿本帧内被新 mode 独占消费 |
| Runner jump key 与 Vertical/Radial key 冲突 | jump=w/↑/space,slide=s/↓(`controls.ts:22-23`);VERTICAL lane=a,s,d,j,k,l(28-35);RADIAL=arrows+wasd。**按住不产生 wasPressed 边沿,不会自动触发 note 判定**;但:进 RUNNER 时按住的 s/↓ → 立即进入 slide 态;进 ARENA 时按住的任意方向键 → 立即产生移动(axis 是 isDown 语义,`Input.ts:50-54`)。这两条是真实可复现的跨 mode 输入残留 |
| mode manager 是否切 input map | **否**。没有 per-mode input map;各 mode 自己读各自的键列表 |

---

## 7. Camera / Coordinate Handoff(规范 §10)

| 项 | 行为 |
| --- | --- |
| camera transform | **单一共享 `CameraFX`**(zoom pulse + shake/kick offset),每帧 `feel.applyCamera()` 统一应用(`GameFeel.ts:182-185`)。模式切换 **不 reset、不 animate、不 hard cut camera state**;shake/zoom 自行快速衰减(shake 0.22s,`tuning.ts:119`)。`feel.reset()` 仅在 run 启动时调用 |
| zoom | 连续(beat pulse 0.010 / downbeat 0.022,`tuning.ts:108-110`),跨切换持续 |
| rotation | **不存在**(`Renderer.setCamera` 仅 zoom+offset,`Renderer.ts:40-43`) |
| scroll offset | RUNNER 轨道位置是 beat 的纯函数 `trackX = PLAYER_X + (activationBeat - beat) * 0.26`(`runnerGeometry.ts:30-32`),**无 camera offset 状态可残留** |
| 坐标系 | 全部 mode 在同一归一化 field space(0..1)绘制;VERTICAL 的 3D highway 是 beat 的纯投影(`Highway.zOf`);无 per-mode world transform 需要交接 |
| 切换视觉 | `ModeManager.renderTransition`(`ModeManager.ts:172-191`):2 拍("sceneBeats",`tuning.ts:91`)的暗幕 + 目标 mode 色带扫过 + mode 名 + transitionOut 标签文字,progress≥1 自动清除。**纯 overlay,不触碰 camera**;previous transform 无残留 |
| particles / screen FX | 全局 `ParticlePool`/`ScreenFX` 跨切换保留(纯视觉残留,无碰撞) |

---

## 8. Hazard / Note Cleanup(规范 §11)

`GameplayMode` 契约(`src/modes/GameplayMode.ts:29-39`):deactivate "Should drop its mechanics"。

| Mode | deactivate 清什么 | 立即性 |
| --- | --- | --- |
| ARENA | `mechanics = []`——飞行中 bullets(A03)、chain(A05)、laser(A06)、floor warning(A01)、sweep/fan/spiral/ring/burst 全部 | 瞬时 |
| RUNNER | `mechanics = []`——滚动到一半的 obstacle(R01–R04,R08)与整条 course(R-COURSE),即使 course 名义 duration 延伸到 section 之外 | 瞬时 |
| VERTICAL | `mechanics = []`(`NoteMode.ts:89-91`)——所有 PENDING/HOLDING/HIT/MISSED note 消失;HOLDING 被切断无惩罚 | 瞬时 |
| RADIAL | 同上 | 瞬时 |
| pending 队列 | 保留;**仅被激活的 mode 的队列 flush**(`ModeManager.ts:103, 132-137`)。其余 mode 的 pending 留存至其激活或 `clearHazards()` | — |
| particles/warnings 残影 | Feel 层粒子/冲击波是全局的,只是视觉残留,无碰撞 | — |

**"上一模式 mechanic 跨模式伤害"核查(规范重点)**:

- 结论:**切换拍之后不可能**——deactivate 已清空;`modes.update` 只更新 current(旧 mode 不再 update,mechanics 引用已弃)。
- **切换拍之前可能**:breather 只挡新 spawn,不结束已 ACTIVE 的 hazard。若 author 在 breather 起点前一刻放置长 duration mechanic(如 A11 dur 6 拍,再乘 `slowed()` 的 travelScale 1.55×tier,实际危险窗可达 ~9-13 拍),它可以**带着 breather 全程活跃并伤人直到切换拍**。runtime 无任何防护 → **compiler_required:最后一个 outgoing 事件的 activation 应远早于 breatherFromBeat**。
- 死亡路径额外保障:`onDeath()` → `clock.clearSchedule()`(取消**包括未来 mode 切换在内**的全部计划事件)+ `modes.clearHazards()`(清所有已实例化 mode + pending)(`BeatBoundGame.ts:435-441`;`ModeManager.ts:146-149`)。

---

## 9. Audio / BeatClock Continuity(规范 §12)

| 检查项 | 结论 |
| --- | --- |
| music 是否不断 | **不断**。模式切换不触碰 `songPlayer`;`BufferSongPlayer` 以 `AudioContext.currentTime` 锚定连续播放(`AudioEngine.ts:96-99`)。SFX 经同一 AudioContext 叠加 |
| BeatClock 是否连续 | **连续**。`absoluteBeat` 每帧从 playbackTime 重算(`BeatClock.ts:181`),切换不重置任何 clock 状态。`visualBeat` 仅 hit-stop 短暂冻结(纯视觉,`BeatClock.ts:83-87`) |
| section startBar 如何对齐 | 切换拍 = `(startBar-1)*beatsPerBar - leadInBeats`,乐理时间调度(`BeatClock.scheduleAtBeat`)。负数切点合法且有意(bar 1 的 mode 在 count-in 期间已 live,`BeatBoundGame.ts:214-216`) |
| mode switch 是否重置 beat | **否** |
| latency compensation 是否一致 | 单一全局锚(`startCtxTime`,`AudioEngine.ts:97-99`);逐回调记录延迟统计(`BeatClock.recordLatency`)。无 per-mode 差异 |
| next mode 首事件是否对齐歌曲 | **是**。activation 由 pattern 的绝对 beat 决定;approach/telegraph 自切换拍后可见(pattern section leadIn 与最大 telegraph 匹配);RUNNER obstacle 提前 spawn 进 pending,flush 后从其 beat 推算轨道位置(可能出现"已滚入一半"的视觉,位置仍精确对拍) |

---

## 10. Transition Authoring API(规范 §13)

level JSON(`level.schema.json` + `LevelDefinition`)中与切换相关的全部字段逐项判定:

| 字段 | parser 接受? | runtime 消费? | 判定 | default |
| --- | --- | --- | --- | --- |
| `section.transitionOut` (string\|null) | 是(`types.ts:138`;schema 允许) | **是,但仅作为切换 overlay 的标签文字**(BeatBoundGame.ts:217-218 → ModeManager transition.id → renderTransition 文本) | **consumed-display-only(gameplay no-op)** | `null` |
| `section.scene` + `scene.effects[]`(paletteShift / lightFlash / cameraPan / particles / envMovement,含 durationBeats) | **tolerated**(LevelLoader 不做 schema 校验,未知字段静默忽略) | **否**。`SectionDefinition`/`CompiledSection` 无此字段;src/ 无任何读取 | **metadata-only(editor 扩展)**;且与 `level.schema.json` 的 `additionalProperties: false` 冲突(shipped 文件 test_song / dance_fruits 实际带此字段) | — |
| `section.function` | 是(类型声明 `types.ts:135`) | **否**(CompiledSection 不携带,无人读) | **metadata-only** | — |
| `pattern.function`(含 `"TRANSITION"`) | 是 | **否**(调度不分支) | **metadata-only** | — |
| `transitionIn` | 否 | 否 | **NOT SUPPORTED(不存在)** | — |
| `breather`(JSON 字段) | 否 | 否(breather 是 runtime 派生值,不可从 JSON 配置) | **NOT SUPPORTED** | — |
| `leadIn`(JSON 字段) | 否 | 否(`leadInBeats` 是 compile 派生:mechanic telegraph / course 1 bar) | **NOT SUPPORTED** | — |
| `modeSwitch` | 否 | 否 | **NOT SUPPORTED** | — |
| `cameraTransition` | 否 | 否(editor scene 里的 cameraPan 同样 no-op) | **NOT SUPPORTED** | — |
| section 级 `duration` | 否 | 否 | **NOT SUPPORTED**(时长由 startBar+lengthBars 表达) | — |
| `course`(RUNNER) | 是 | 是(见 §2) | SUPPORTED | — |
| `course.generate`(procedural) | 是 | 是(compile 期展开,`LevelLoader.ts:402-413`) | SUPPORTED | — |
| `course.seed`(author 字段) | 是 | **否**:`composeCourse` 消费的是 `generate.seed`;`planCourse` 只收 `{startBeat, phraseBeats}`;`course.seed` 被 compile 写入默认值后无人读(courseSchedule 的合成 seed 用 `hashString(section.id)`,`courseSchedule.ts:93`) | **metadata-only(写不读)** | — |
| `event.role`(PLAYER_A/B/BOTH/SYSTEM) | 是 | 携带(`info.role`、`ctx.role`)但**无任何分支消费**——所有 role 同样 spawn | **carried metadata(no-op)** | `"SYSTEM"` |

---

## 11. Transition Timing(规范 §14)

以 4/4、BPM B 计:

| 指标 | 值 | 出处 |
| --- | --- | --- |
| min quiet beats(旧 mode 无新 spawn) | `max(6, round(B/20))` 拍(120 BPM = 6 拍) | LevelLoader.ts:375-378 |
| min quiet seconds | ≈3.0s;**最坏 ≈2.81s(128 BPM,整拍舍入)**;90 BPM 时 4.0s | §3.3 表 |
| 旧 mode deactivate 时机 | `sectionEndBeat - leadInBeats`;pattern section leadIn = `min(最大库 telegraph, beatsPerBar)`;course section = `max(4, beatsPerBar)` | BeatBoundGame.ts:217; LevelLoader.ts:369, 420 |
| 新 mode activate 时机 | **同一拍**,同步执行(setMode 内先 deactivate 后 activate) | ModeManager.ts:98-101 |
| 新 mode 首个可见 telegraph | 切换拍起(pattern section;leadIn 恰匹配最大 telegraph) | §2 时序事实 |
| 新 mode 首个可伤人事件 | 由 pattern 的 activation beat 决定(通常 = section 首拍);RUNNER obstacle 在其 activation 拍抵达 PLAYER_X;V/R note 在其 beat 判定 | PatternScheduler.ts:84 |
| RUNNER course 首地形可见 | 切换拍(course 于切换拍 flush,滚动位置按绝对拍推算) | courseSchedule.ts:55-56; ScrollingObstacle.ts:26-29 |
| 视觉切换时长 | 2 拍(`sceneBeats`) | tuning.ts:91 |
| run 开局 count-in | `max(4, beatsForSeconds(bpm, 3))` 拍(负拍区运行) | BeatBoundGame.ts:260-262 |

mode-specific 差异:仅 RUNNER(pattern 路线)的 spawn lead 固定 4 拍(pending 交接),其余 mode spawn lead = 库 telegraph(V/R = 2 拍,D = 2 拍,A = 0.5–1.5 拍)。

---

## 12. Same-Mode Section Boundary(规范 §15)

`ModeManager.setMode` 第一行 `if (this.current?.mode === mode) return;`(`ModeManager.ts:96`)。因此 ARENA→ARENA / RUNNER→RUNNER / VERTICAL→VERTICAL / RADIAL→RADIAL:

| 检查项 | 结论 |
| --- | --- |
| mode 重置? | **否**(不 deactivate、不 activate,实例原样) |
| player 重置? | **否**(位置/重力/combo/verdict 计数全保留) |
| combo 连续? | **是**(NoteMode 不经 activate) |
| active mechanic 可跨 section? | **是**(mechanic 生命周期绑定绝对拍;pattern 溢出 section 末尾只是 load warning,`LevelLoader.ts:242-243`) |
| breather 触发? | **否**(`breatherFromBeat = null`,无 spawn 抑制、无倒计时 overlay、无场景 wipe) |
| pattern 可首尾叠加? | **是**(placements 按 startBar 顺序首尾相接,`LevelLoader.ts:339-347`) |
| transitionOut 消费? | 即使上一 section 声明了 transitionOut,也会被传入但 setMode 早退——**无任何效果** |

实际使用:`src/lab/labs.ts` 的 `sequence()`(99-135)在单 mode 内连续多个 section(combined 系列 lab),是该路径的真实消费者。**shipped 库中无同 mode 相邻 section 的 level**(3 个多 mode level:prototype_90s、test_song、dance_fruits 的相邻 section 均 mode 不同)——行为由代码推导,lab 实证,无 shipped 关卡样本。

Director 启示:同一模式可安全拆成多个音乐 section,无任何隐藏代价;但**没有 runtime breather**,密度衔接是 compiler 的责任。

---

## 13. Cross-Mode Difficulty Continuity(规范 §16)

- `difficulty`(1–5,section-local;schema 限 1..5,类型 optional):**逐 spawn 生效**。`PatternScheduler.ts:111` 把当前 section 的 difficulty 传入 `registry.create` → `tierForDifficulty`(`arenaTiming.ts:18-25`:1→EASY,2→MEDIUM,3→HARD,4/5→INTENSE,缺省=MEDIUM)。
- 立即可见的 runtime 变化:
  - **所有 mode**:库 telegraph>0 的 mechanic,warning 长度乘 `tier.telegraphScale`(EASY 1.5 / MEDIUM 1.25 / HARD 1.05 / INTENSE 0.9)(`MechanicRegistry.ts:144-150`)——即 `difficulty 4 → 1` 的切换会让下一个 mode 的 note/危险 telegraph 立即变长(再经 intensity 只缩不涨,floor 0.6 拍 / `constraints.minReactionBeats`,`Intensity.ts:17-27`)。
  - ARENA 专属:`travelScale`/`gapScale` 作用于 A03/A04/A08/A10 等(`arenaTiming.ts:28-42` `slowed()` 把 duration 同步拉伸,保证危险窗覆盖全程)。
  - RUNNER course:course 合成 intensity = `(difficulty-1)/4`(`courseSchedule.ts:88`)。
  - 环境层:`sectionEnergy()`(`BeatBoundGame.ts:422-429`)把 difficulty+intensity 映射为氛围密度,逐帧跟随当前 section。
- `intensity`(0–1,placement-local,default 0.5):不跨 section 携带;作用于 count/speed/telegraph/density 逐参数(`Intensity.ts`)。
- **结论**:`difficulty 4 ARENA → difficulty 1 RUNNER` 会立即(从 RUNNER section 的第一个 spawn 起)改变 runtime 参数;无平滑、无继承。

---

## 14. 已知危险切换(规范 §17)

| 场景 | 判定 | 依据 |
| --- | --- | --- |
| ARENA active projectile → 任意 mode | **HIGH RISK(可编译规避)** | projectile 在 breather 全程持续 ACTIVE 且可伤人,直到切换拍才消失;长 duration + `slowed()` 可把危险窗拖过整个 breather。runtime 不提前清除 → compiler 必须保证末事件 activation ≪ breatherFromBeat |
| 任意 mode 长尾 warning → 切换拍 | SAFE | 切换拍 deactivate 硬清,无跨模式伤害 |
| 非 RUNNER → pattern 式 RUNNER | **CONDITIONAL** | 首障碍 pending 压缩,失去 4 拍滚入预警(仍对拍、对位);course 式 RUNNER 无此问题 |
| RUNNER airborne → 任意 mode | SAFE | 切走时 RunnerMode 整体弃置;再进入时 reset 到地面。空中状态无跨 mode 后果 |
| gravity inverted RUNNER(manualFlip 或 course flip 中)→ 任意 mode | SAFE | `gravityDirection`/`manualFlip` 在 activate 时归位;mechanics 清空使 course gravity 消失 |
| VERTICAL/RADIAL hold active → 任意 mode | SAFE(行为注记) | hold 被无惩罚切断(不计 MISS、不扣血);combo 由 incoming activate 归零;音乐表达上是被截断 |
| RADIAL chord / VERTICAL 按住 → ARENA | **CONDITIONAL** | 按住的 a/s/d/arrows 在 ARENA 里立即产生移动(axis isDown);玩家可能带着按住态漂移 |
| 任意 → RUNNER 时按住 s/↓ | **CONDITIONAL** | 进入即 slide 态(grounded 时);按住 w 只影响 jumpCut,不触发跳(需新 keydown) |
| mode switch 时 damage invulnerability active | **CONDITIONAL(低险)** | 0.8s 窗跨切换保留;新 mode 的首次碰撞可能被吞掉(不 flash 不扣血)——玩家可感知为"穿怪" |
| pending 队列 >64(病理 level:某 mode 大量事件但长期不激活) | **CONDITIONAL** | 静默丢最旧 spawn,`droppedSpawns` 计数(HUD 可见);无告警 |
| 死亡发生在切换前 | SAFE(run 终止) | `clock.clearSchedule()` 连未触发的 mode 切换一起取消;画面定格在旧 mode |
| → DUO(或任何未注册 mode) | NOT SUPPORTED(玩法) | PlaceholderMode:无 hazard、事件计数跳过、显示 "not implemented yet";run 不会崩 |
| section 间有 gap(startBar > 前一 endBar) | SAFE + load warning | 旧 mode 在空档期继续运行;`LevelLoader.ts:194-196` 出 warning |

---

## 15. Transition Safety Contract(规范 §18)

基于真实 runtime 的契约(供 Director/Compiler 使用):

```json
{
  "transition_safety": {
    "minimum_breathing_beats": 6,
    "minimum_breathing_seconds_nominal": 3.0,
    "minimum_breathing_seconds_worst_case": 2.81,
    "breather_formula": "max(6, round(bpm/20)) beats, measured back from section end beat",
    "clear_previous_hazards": true,
    "clear_previous_hazards_at": "mode switch beat (sectionEndBeat_outgoing - leadInBeats_incoming), NOT at breather start",
    "allow_active_hold_crossing": false,
    "hold_cut_penalty": "none (no MISS, no damage; combo reset by incoming activate)",
    "allowed_boundary_types": ["section_boundary"],
    "section_boundary_definition": "bar line (incoming section startBar) minus leadInBeats (<= 1 bar, or max(4, beatsPerBar) for courses)",
    "phrase_boundary": "not enforced by runtime",
    "compiler_required": [
      "last outgoing event activation must be strictly < breatherFromBeat (>= is suppressed); keep the active-window tail clear of the switch beat",
      "avoid placing long-duration mechanics (A07/A08/A11, slowed() variants) in the final bars before a mode change",
      "same-mode section boundaries get NO runtime breather - manage density manually",
      "incoming section's first event should activate at or after its startBar (earlier is possible via pending but visually compressed)",
      "expect held-key carryover across the switch (input is global state)"
    ]
  }
}
```

runtime **不保证**而必须由 compiler 保证的完整清单:活跃 hazard 的提前收尾、hold 不跨边界(或跨了也接受截断)、同 mode 边界的密度衔接、gap 段填充、pending 溢出避免(单 mode 缓冲 ≤64)、难度跳变的人体工学。

---

## 16. Music-Aware Transition Affinity(规范 §19)(能力总结,非设计)

runtime 事实决定的合适切换位:

- **section boundary(bar 线)**:唯一受 runtime 支持的边界;切换拍 = bar 线前 ≤1 bar,天然落在乐句格点上。
- **breather 尾 / 倒计时结束**:倒数 overlay 以 3s 刻度收束到切换拍,视觉上把注意力引向 bar 线。
- **downbeat**:切点即拍点(clock 调度保证);wipe 的 arrival ring("One ring on arrival ... lands on a beat",`ModeManager.ts:189-190`)强化落拍感。
- **energy drop / break**:breather 本身就是 runtime 强制的 energy drop(密度归零 + 倒数);Director 应把 mode switch 安排在音乐能量回落的 section 边界。
- **pre-drop / post-climax**:runtime 无音乐分析能力,但 pattern 库提供对应功能标签(RECOVERY/CLIMAX,`PATTERN_FUNCTIONS`)与 editor 的 energy-delta transition 时长模型(`transitionGenerator.js:31-40`),供 compiler 侧选择。
- **vocal pause**:runtime 不感知;纯音乐判断,超出本审计范围(NEEDS MUSIC ANALYSIS,非 runtime 能力)。

---

## 17. Machine-Readable Catalog

见 `TRANSITION_CAPABILITY_CATALOG.json`(同目录)。结构:`modes / switch_chain / matrix / breather / state_handoff / input_handoff / camera_handoff / cleanup / beat_clock / authoring_api / transition_timing / same_mode_boundary / difficulty_continuity / known_risks / safe_generation_bounds / counts`。

---

## 18. TRANSITION DESIGNER CHEAT SHEET(规范 §21)

```text
Supported mode pairs
    4x4 全 SUPPORTED。same-mode 对角 = 无操作边界(连续)。cross-mode 12 格共用同一条切换流水线。
    (→DUO 结构可切,玩法 NOT SUPPORTED:PlaceholderMode)

Actual breather rule
    旧 section 尾部 max(6 拍, round(bpm/20) 拍) —— ≈3s(128 BPM 最坏 2.81s,90 BPM 4.0s)。
    仅抑制新 spawn(activation >= breatherFromBeat 的事件整个不创建,含 warning);
    不提前结束已 spawn 的 hazard。same-mode 不触发。JSON 不可配置。

What gets reset(跨 mode)
    player 位置/速度(新 mode 初始化)、RUNNER 重力与 manualFlip、combo、verdict 计数、
    全部 active mechanics。不重置:health、hits/notes 计数、invulnerability(0.8s 窗)、
    按住的键、camera、particles、BeatClock、music。

What persists
    HealthManager(全 run 一份)、RunStatus 计数、pending 队列(未激活 mode 的提前 spawn,
    上限 64)、mode 实例本身(instances Map,复用不重建)、feel 层视觉残留。

Hazard/note cleanup behavior
    切换拍 deactivate:旧 mode mechanics=[] 一次清空(bullets/warnings/notes/obstacles/course)。
    hold 被切断无惩罚。切换拍之后旧 mode 的 mechanic 不可能再伤害玩家;
    切换拍之前(含整个 breather)旧 hazard 仍然致命。

Input handoff behavior
    全局键盘状态,切换不清。held keys 立即被新 mode 语义解读
    (a/s/d/arrows → ARENA 移动;s/↓ → RUNNER slide)。边沿(wasPressed)每帧只被
    current mode 消费,切换帧只有新 mode 读输入。

Camera handoff behavior
    单一共享 CameraFX,连续,不重置不动画;切换视觉是 2 拍 overlay wipe(纯装饰)。
    RUNNER 滚动位置是 beat 纯函数,无残留 transform。

BeatClock continuity
    完全连续:music 不断、beat 不重置、切换在乐理时间上精确到拍
    (section bar 线 - leadIn,负拍合法)。latency 单一全局锚,无 per-mode 差异。

Safe transition timing
    新 spawn 静默 >= max(6, round(bpm/20)) 拍;旧 mode 存活到 sectionEnd-leadIn;
    新 mode 首个 telegraph 自切换拍可见;首个危险事件按 pattern 绝对拍(通常 section 首拍)。

Same-mode boundary behavior
    纯 no-op:不 reset、不清理、无 breather、combo 连续、mechanic 可跨 section。
    密度衔接由 compiler 负责。

Known dangerous transitions
    (1) 长 duration ARENA mechanic 拖过 breather 伤人直到切换拍(HIGH RISK,可编译规避);
    (2) 非 RUNNER → pattern 式 RUNNER 首障碍预警被 pending 压缩;
    (3) held-key 跨切残留(RADIAL/VERTICAL→ARENA 立即漂移;→RUNNER 立即 slide);
    (4) invulnerability 跨切吞掉新 mode 首次碰撞(低险);
    (5) pending >64 静默丢 spawn(病理 level);
    (6) difficulty 跳变立即改写 telegraph/travel 参数(设计自由,需注意可读性)。

Compiler responsibilities not guaranteed by runtime
    末事件 activation 远离 breather 起点、hold 不跨边界、同 mode 边界密度、
    空档(gap)填充、单 mode pending ≤64、首事件不早于 section 起拍、
    transitionOut 命名(仅显示)、难度曲线的人体工学。
```

---

## 19. 完成前自检(规范 §22)

- [x] mode IDs(GAME_MODES 5 个,4 实现 + DUO placeholder)
- [x] full transition chain(LevelLoader → BeatBoundGame.scheduleSections/scheduleCourses → BeatClock → ModeManager.setMode → deactivate/activate/flushPending → route/accept)
- [x] breather exact behavior(suppress-spawn-only,max(6 拍, ~3s),BPM 表,含舍入 undershoot)
- [x] 4×4 matrix(16/16 SUPPORTED,逐格公共行为表 + 格间差异)
- [x] player state handoff(逐项 preserved/reset/dropped/not-supported)
- [x] input handoff(全局状态,不清空,冲突表)
- [x] camera(共享 CameraFX,连续,2 拍 overlay wipe)
- [x] cleanup(逐 mode deactivate;跨模式伤害的精确边界=切换拍)
- [x] BeatClock/audio(连续,不重置,单锚)
- [x] authoring API(transitionOut display-only;scene/function/seed/role metadata-only;transitionIn 等 NOT SUPPORTED)
- [x] timing(quiet beats/seconds、deactivate/activate 时机、首事件时机)
- [x] same-mode boundary(no-op,lab 实证,无 shipped 样本已注明)
- [x] difficulty continuity(section-local 逐 spawn,立即生效)
- [x] dangerous transitions(HIGH RISK / CONDITIONAL / SAFE 分级)
- [x] machine-readable catalog(TRANSITION_CAPABILITY_CATALOG.json,node JSON.parse 自检通过)
- [x] no code modification(本审计只读;仅新增/覆盖两份审计产物)
- [x] no git operations
