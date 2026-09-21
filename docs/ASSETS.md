# shoulder-tap 像素素材需求书

这份文档给两种人用：拿去喂图像模型的人（每个素材都附了可直接粘贴的英文 prompt），
和之后接手改这套素材的美术。

素材的用途：shoulder-tap 在你工作跑偏时会拍你一下肩膀。这些图就是「拍」的那一下——
它们出现的时机是你**正专心做别的事**的时候，所以第一要求是<b>一眼看懂、不吵</b>，
不是好看。

---

## 0. 通用规则

这一段适用于下面每一个素材，喂给模型时建议原样前置：

```
Pixel art, 16-color palette maximum, hard 1px edges, NO anti-aliasing,
NO gradients, NO drop shadows, NO outline glow.
Transparent background (alpha), PNG.
Readable at 100% zoom on BOTH a white (#eef1f2) and a dark (#0e1213) background.
Single subject, centered, generous empty margin inside the canvas.
Flat 2-3 tone shading only (base / shadow / highlight).
No text, no letters, no numbers, no UI chrome, no border frame.
```

**配色**（不强制，但统一了更像一套东西）：

| 角色 | 色值 | 用在 |
| --- | --- | --- |
| 主色 | `#0e7c7b` 深青 | 放行、正向动作 |
| 主色亮 | `#4bb5b2` | 暗色模式下的同一角色 |
| 警示 | `#c1471d` 烧橙 | 拍肩、拦截 |
| 中性深 | `#2a3435` | 线条、轮廓 |
| 中性浅 | `#d3dbdc` | 高光、反光 |
| 皮肤（如果画手/人） | `#e8b88a` / `#c08c5e` | 手、小人 |

轮廓一律用中性深，**不要用纯黑**——纯黑在暗色背景上会糊成一团。

**交付方式**：透明 PNG，放进 `skill/shoulder-tap/ui/sprites/`，文件名照下面写死的来。
多帧动画交**横向雪碧图**（所有帧等宽，从左到右按顺序排成一行，不要留间隔、不要网格线）。
单帧和雪碧图都行的，优先给雪碧图。

---

## 1. 拍肩 — `tap.png` ★ 最重要

**规格**：64×64 每帧，4 帧，横向雪碧图（成品 256×64）

这是整个产品的那一下。你正在写别的代码，屏幕角落一只手伸进来拍你两下。

| 帧 | 内容 |
| --- | --- |
| 1 | 手还在画面外，只露出一点指尖（或者完全空，留作静止帧） |
| 2 | 手伸进来，手掌张开，接触到画面右侧边缘 |
| 3 | 拍击的瞬间——手掌压扁一点，边缘带 2-3 根短促的冲击线 |
| 4 | 手回收，比帧 2 靠外一点 |

```
A pixel art sprite sheet, 4 frames in a single horizontal row, each frame 64x64 pixels,
total image 256x64. A cartoon human hand and forearm reaching in from the RIGHT edge
of the frame to tap someone on the shoulder.
Frame 1: only the fingertips visible at the right edge.
Frame 2: the open hand has entered, palm facing left.
Frame 3: the moment of impact - the palm slightly squashed against the right edge,
with two or three short straight impact lines radiating from the contact point.
Frame 4: the hand pulling back, further right than frame 2.
The hand is the only subject. Skin tones #e8b88a and #c08c5e, outline #2a3435,
impact lines #c1471d.
[+ 通用规则]
```

**播放方式**：`steps(4)`，一轮 520ms，播两轮后停在帧 1。不循环——拍两下就够了，一直拍是骚扰。

---

## 2. 放行 — `ok.png`

**规格**：32×32 每帧，2 帧，横向雪碧图（成品 64×32）

你要做的正是说好的那件事时，一闪而过。**必须不打扰**——小、快、安静。

| 帧 | 内容 |
| --- | --- |
| 1 | 一只手比 OK / 竖大拇指，静止 |
| 2 | 同一只手轻轻上抬 2px，旁边多一个小小的对勾 |

```
A pixel art sprite sheet, 2 frames in a horizontal row, each 32x32 pixels, total 64x32.
A small hand giving a thumbs-up.
Frame 1: the thumbs-up at rest.
Frame 2: the same hand raised two pixels higher, with a tiny checkmark beside it.
Teal #0e7c7b for the checkmark, skin #e8b88a, outline #2a3435. Minimal, very few pixels.
[+ 通用规则]
```

**播放方式**：`steps(2)`，360ms，播一轮，然后 400ms 淡出。

---

## 3. 喝水 — `water.png`

**规格**：48×48 每帧，3 帧，横向雪碧图（成品 144×48）

| 帧 | 内容 |
| --- | --- |
| 1 | 一只装满水的玻璃杯，放在桌面上 |
| 2 | 杯子被举起并倾斜，水位下降一半 |
| 3 | 杯子放回桌面，接近空，杯口有一两滴水 |

```
A pixel art sprite sheet, 3 frames in a horizontal row, each 48x48 pixels, total 144x48.
A simple drinking glass filled with water.
Frame 1: the full glass standing still.
Frame 2: the glass lifted and tilted to the right, water level halfway down.
Frame 3: the glass back down, nearly empty, one or two droplets near the rim.
Water in teal #4bb5b2, glass outline #2a3435, highlight #d3dbdc.
No hand, no face, no table - just the glass.
[+ 通用规则]
```

**播放方式**：`steps(3)`，900ms，循环两轮。

---

## 4. 起来走走 — `walk.png`

**规格**：48×48 每帧，4 帧，横向雪碧图（成品 192×48）

经典 4 帧走路循环，**侧面**视角，接触 / 下沉 / 通过 / 上升四个姿势。

```
A pixel art walk cycle sprite sheet, 4 frames in a horizontal row, each 48x48 pixels,
total 192x48. A small simple character walking in side view, facing right.
The four classic walk poses in order: contact, down, passing, up.
The character keeps the same vertical center in every frame so the cycle does not jitter.
No background, no ground line, no shadow.
Simple flat character, teal #0e7c7b clothing, skin #e8b88a, outline #2a3435.
[+ 通用规则]
```

**播放方式**：`steps(4)`，560ms，循环三轮。

---

## 5. 今天做完了 — `done.png`

**规格**：64×64，**静态单帧**（动效用 CSS 做）

| 内容 |
| --- |
| 一面插在地上的小旗，或者一个盖下去的「完成」印章。二选一，给哪个都行。 |

```
A single pixel art icon, 64x64 pixels. A small triumphant flag planted on a tiny mound,
OR a stamp pressed down leaving a solid mark - pick one, not both.
Teal #0e7c7b as the main color, outline #2a3435.
Celebratory but quiet - not confetti, not fireworks, not a trophy.
[+ 通用规则]
```

**播放方式**：CSS 做一次轻微的缩放弹跳（`scale 0.9 → 1.05 → 1`，400ms），不做帧动画。

---

## 6. 角色立绘 — `character.png`

**规格**：96×96，**静态单帧**

用在设置界面和空状态。这是这个产品的脸。

**重要的方向约束**：画成「一直看着你的那个存在」，**不要画成真人老板 / 上司 / 监工**。
威胁感太强，用户会卸载。目标语气是「你妈在看着你」那种——无奈的、带点好笑的、
但你确实不好意思在它面前摸鱼。

推荐方案（按优先级）：

1. **一只猫**，正面坐着，眼睛睁得很大，面无表情地盯着你。最优先，请先出这个。
2. **一只眼睛**，风格化的、平静的，不要恐怖不要充血。
3. 一只手，做出「我在看着你」的手势。

```
A single pixel art character portrait, 96x96 pixels.
A cat sitting upright, facing the viewer directly, with large round unblinking eyes,
completely deadpan expression - calmly staring at you, mildly judgmental but not angry,
not cute-aggressive, not threatening. Symmetrical, centered.
Fur in cool grey tones, eyes teal #0e7c7b, outline #2a3435.
No background, no furniture, no speech bubble, no accessories.
[+ 通用规则]
```

---

## 7. 验收清单

每张图交付前对一遍：

- [ ] 背景真的是透明的（不是白底，不是棋盘格被画进去了）
- [ ] 放到 `#eef1f2` 浅底和 `#0e1213` 深底上，都看得清
- [ ] 放大到 400% 没有半透明的毛边（说明没开抗锯齿）
- [ ] 颜色数 ≤ 16（用 `magick identify -format "%k" x.png` 数一下）
- [ ] 雪碧图每帧等宽，总宽 = 帧宽 × 帧数，一个像素都不多
- [ ] 动画帧之间主体没有整体漂移（走路循环尤其容易出这个问题）
- [ ] 图里没有任何文字

## 8. 只能给静态图的话

完全可以。除了走路循环以外，其它几个用一张静态图加 CSS 也能成立：

| 素材 | 静态替代方案 |
| --- | --- |
| 拍肩 | 一张「手伸进来」的图，CSS 左右平移两下（`translateX 0 → -6px → 0`，两轮） |
| 放行 | 一张对勾，CSS 淡入 + 轻微放大 |
| 喝水 | 一张杯子，CSS 左右倾斜一次（`rotate 0 → -20deg → 0`） |
| 走路 | **这个必须给 4 帧**，CSS 模拟不出走路 |
| 完成 / 立绘 | 本来就是静态的 |

先出静态版、验证完拦人手感再补帧，也是完全合理的顺序。
