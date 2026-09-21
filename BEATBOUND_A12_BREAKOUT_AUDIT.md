# BEATBOUND A12 Rhythm Breakout — Capability Audit

- 日期:2026-09-21
- 对象:commit `84294d1` "Add Rhythm Breakout arena mechanic"(evan-branch,已 fast-forward 合入)
- 性质:只读审计(代码级),非改动性
- 范围:`src/mechanics/arena/` 新增 7 文件、`src/modes/arena/BreakoutController.ts`、`src/core/capabilities.ts`、`src/modes/arena/ArenaMode.ts`、`src/tuning.ts`、`src/feel/AudioFX.ts`、`beatbound_library_v1/`(A12 + AP27–AP29 + arena_breakout 关卡)

---

## 1. 结论

**A12 接线完整、公平性由构造保证、测试全绿(29/29 ARENA patterns 可读可玩)。可上线。** 有 1 个 P1(生产环境 console.warn)和 2 个 P2 级设计注意项,均不阻塞。

---

## 2. 机制概述

A12 是 ARENA 首个 **SequenceEncounter**(节奏事件型机制):玩家被无缺口封印环封在中央,按箭头键打出一段方向短语(判定以 beat 为单位,与 VERTICAL/RADIAL 同语言),最后在指定强拍按 SPACE 击碎封印。打不出则封印通过普通碰撞路径(`hazards()`)塌缩造成伤害——没有特殊失败通道。

数据结构:`BUILD-UP → PRESSURE → INPUT → ANTICIPATION → IMPACT → RELEASE` 六段状态机。

## 3. 分层架构(已验证)

| 文件 | 职责 | 行数 |
|---|---|---|
| `breakoutPlan.ts` | 纯函数:参数包+速度 → 完整时间线;**全部公平性钳制在此** | 319 |
| `breakoutSequence.ts` | 短语状态 + 判定器(与 NoteMode 同规则) | 176 |
| `SealBarrier.ts` | 纯表现:4 种皮肤(SINGLE/DOUBLE_RING、HEX_SEAL、RUNE_SEAL)、碎片物理 | 335 |
| `sealGeometry.ts` | 形状→碰撞/绘制/半径换算(单一事实源) | 162 |
| `breakoutUI.ts` | 提示条(底部 y=0.735–0.88 带,带渐变遮罩防遮挡) | 320 |
| `RhythmBreakoutMechanic.ts` | 状态机,只拥有状态 | 490 |
| `BreakoutController.ts` | 模式侧输入上下文(无状态、每帧重建) | 124 |

## 4. 公平性保证(breakoutPlan.ts,逐条核实)

1. **出生半径 ≥ FIELD_REACH+0.01**(0.72 默认,钳制下限 = 单位方形对角可达距离),封印永远不会"长在玩家身上/外面"。所有半径是 **inradius**,`circumradiusFor()` 换算 → 皮肤(六边形/八边形)是纯外观选择,不是难度选择。✅
2. **prep 自动拉伸**:行走时间(阻尼速度,`movementScale` 下限 0.25)+ `REACTION_FLOOR_SECONDS` 换算成拍数,不足则只拉长 prep(不影响音乐锚点),上限 16 拍。✅
3. **步距下限** `max(0.25拍, 0.11s)`,`spaceSteps()` 只向后推保形;判定窗口 cap = `minInterval×0.45`,一个按键永远不能同时满足两个 prompt。✅
4. **危险半径恰在 finalBeat 到达 criticalRadius**(easeInOut 单调收缩),玩家还有输入可打时封印不可能致命。失败塌缩 0.6 拍。✅
5. criticalRadius 钳制下限 `playerRadius×2+0.08 = 0.108`;AP29 的 0.115 高于下限,合法。✅

## 5. 输入接线(BreakoutController + ArenaMode)

- **无闩锁**:capture 集每帧从 beat 重建,死亡/切模式/中途销毁都不可能留下被占用的键、速度倍率或轴禁用;`activate/deactivate/clearHazards` 三处均调用 `reset()`。✅
- **键位分工**:capture 期间箭头=短语、WASD=移动;非 capture 期间两者皆可移动(`axisFrom(moveKeys)`)。`wasPressed` 边沿触发,按住不会连发。✅
- **顺序正确**:controller update 在 avatar 移动之前轮询,移动绑定与按键读取同一帧一致。✅
- **计分闭环**:encounter 自己判定,verdict 通过 `drainJudgements()` 由 mode 灌入 `RunStatus.registerNoteHit/Miss`——对所有 encounter drain(不止 capture 中的),漏掉 final accent 的 MISS 也能入账。✅
- 4 个新 SFX(`seal_form/charge/break/shatter`)已在 `AudioFX.ts` 定义接线。✅
- 新增 `hitStop.sealBreakSeconds: 0.10` 和全局上限 `maxSeconds: 0.16`(机制可申请的 freeze 上限)。✅
- sync-test.ts 的 dead-air 统计已按 telegraph→danger 窗口计"在场",A12 三拍跨度的 encounter 不会被误判 dead air。✅

## 6. 数据(A12 + AP27–AP29 + 关卡)

- **A12** mechanics.mvp.json 条目完整:defaults 与 `planEncounter` 的 fallback 一致;支持 `perfectWindowMs/goodWindowMs` 备选单位;avoidWith = A04/A07/A08/A10/A11(全部 spatial 提问型 ring,语义冲突,合理)。
- **AP27**(教学):4 拍短语 + maxMisses 2;**AP28**(切分):6 输入含两个半拍,HEX_SEAL;**AP29**(BOSS):8 输入含重复方向 + 三个半拍,窗口收紧(0.09/0.18)、HEAVY 失败。三个 pattern 均 `maxSimultaneousThreats: 1`。
- **arena_breakout_01** 关卡:3 段(TEACH/PRACTICE/CLIMAX),每段一个 A12 + 常规 pattern 混排,levels.index.json 已登记。
- `npm test` 全绿:AP27–AP29 均通过 camp-audit 与 readability 校验,29/29 patterns 可读。

## 7. 发现

### P1 — 生产路径 console.warn(建议修复)
`RhythmBreakoutMechanic.ts:131` 构造函数对每条 plan note 执行 `console.warn`。运行期每次 spawn A12 都会刷控制台。plan 的 `notes` 是作者数据告警,应走 debug 开关或与其它机制一致的日志通道(arena 其余 11 个机制均为 0 处 console.warn)。

### P2 — 双 encounter 重叠时的按键广播(设计注意,当前受控)
`BreakoutController.update` 把同一按键转发给**所有** capture 中的 encounter。两个 A12 同时 live 时一次按键会同时喂给两个短语。当前被两层护栏挡住:JSON `maxSimultaneousThreats: 1` + A12 avoidWith 列表;且 capture 无闩锁不会永久占键。**但 JSON 只是数据约定,代码层没有互斥**——若未来编排器生成重叠 encounter(或与后续新 SequenceEncounter 并存),需在 controller 加"同时最多一个 capture"或按键路由规则。

### P2 — 按键提示文案硬编码 `keyLabel: 'SPACE'`(`RhythmBreakoutMechanic.ts:443`)
与 `controls.ts` 的 `ARENA_CONFIRM_KEYS = [' ']` 目前一致,但改键位时此 UI 文案不会跟随。低风险,建议从 controls 常量派生。

### 备注(非缺陷)
- `capturesInput` 在 BROKEN 后仍保持 0.5 拍以吞掉残余输入,是有意设计(注释已说明)。
- 判定窗口以 beat 计价,与 VERTICAL/RADIAL 一致,难度随速度天然缩放;tier `gapScale` 缩放窗口,符合"难度 metadata-only"惯例。
- 绘制用 visual beat(受 hit-stop 冻结)、碰撞用 absolute beat,分离正确。
- 碎片物理用真实秒 + dt 钳制(0.05s),独立于音乐时间,注释已说明是 debris 不是 choreography。

## 8. 与既有审计目录的关系

- `BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG` 中 ARENA 机制表为 A01–A11;**A12 是本次新增,目录尚未收录**。建议下次目录更新时补 A12 行(mode=ARENA, difficulty=3, SequenceEncounter capability, avoidance 同上)。
- `FOLLOW_GAP 空别名` 等旧审计结论不受本提交影响(未触及相应代码)。

## 9. 建议后续动作

1. 修复 P1(console.warn → 静默或 debug 开关)。
2. 决定是否在 `BreakoutController` 加 encounter 互斥(P2,可在下一个编排需求出现时再做)。
3. 将 A12 补入 capability catalog 下次更新。
