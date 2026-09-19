# BeatBound Library v1

这一版把 BeatBound 的玩法拆成三层：

1. `mechanics.mvp.json`：原子机制，例如 Floor Warning、Spike、Tap、Single。
2. `patterns.mvp.json`：可重复使用的玩法句子，例如 Checkerboard、Jump Slide、Clockwise。
3. `prototype_90s.level.json`：一首歌如何按段落选择 Mode + Pattern。

## 核心原则

- 所有 Pattern 使用 **Bar / Beat 相对时间**，不要直接写死秒数。
- 音频分析负责得到 BPM、Beat、Downbeat、Section。
- AI Director 只负责选择 `mode / difficulty / function / patternId`，尽量不要让 AI 自由生成碰撞逻辑。
- Mechanic 负责运行时行为；Pattern 只负责编排。
- `telegraphBeats` 必须优先于视觉特效，保证玩家有可读的预警。
- 后续 Duo 模式继续沿用同一结构，并在 Pattern event 中使用 `role: PLAYER_A / PLAYER_B / BOTH`。

## 推荐加载流程

```text
Song Analysis
    ↓
Section Manager
    ↓
Level JSON
    ↓
Pattern Manager
    ↓
Mechanic Registry
    ↓
Runtime Objects
```

## Claude Code 实现顺序

1. 建立 `MechanicRegistry`
2. 建立 `BeatClock`
3. 建立 `PatternScheduler`
4. 先只实现 ARENA 的 A01/A03/A05
5. 验证 `AP01/AP03`
6. 再实现 RUNNER / RADIAL / VERTICAL
7. 最后实现 Mode Transition
8. Duo 放在基础系统稳定之后

## 重要约定

- `bar` 从 1 开始。
- 4/4 拍时 `beat` 通常为 1–4，但允许 1.5、2.5 等 subdivision。
- `offsetBeats` 用来做细微提前/延后，不建议第一版大量使用。
- `intensity` 范围 0–1，可由运行时映射到速度、密度、数量等参数。
