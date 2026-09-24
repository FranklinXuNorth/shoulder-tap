# python docs/make-banner.py —— README 顶上那张会动的图：三只手套各自按桌面端的真实节奏循环播放，下面是像素字的说明。
# 背景透明（GIF 只有全透明 / 不透明两档，像素画正好合适），字包在白色圆角框里。换了手的图就重跑一次。
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
skin = root / "skill" / "shoulder-tap" / "ui" / "sprites" / "skins" / "glove"
font = ImageFont.truetype(str(root / "desktop" / "Fonts" / "fusion-pixel-12px-proportional-zh_hans.ttf"), 24)  # 12px 网格 ×2

W, H, S = 96, 80, 2.4                     # 一帧 96×80，放大 2.4 倍
HW, HH = round(W * S), round(H * S)
INK, MUTED, WHITE = (24, 24, 24, 255), (110, 106, 96, 255), (255, 255, 255, 255)
TAPS = [250, 340, 430, 580, 670, 760, 910, 1000, 1300]         # 跟桌面端一样：每帧结束的时刻（毫秒）
SNAPS = [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250]
# 第四项是起步的延迟（毫秒）：三只手错开，像一排依次动起来，而不是一起抽一下
gestures = [("tap", "tap tap", TAPS, 0), ("pat", "pat pat", TAPS, 600), ("snap", "snap", SNAPS, 250)]
WHEN = {"zh": ["跑偏了 / 习惯到点", "模型在等你回答", "这轮做完了"],
        "en": ["drifted / habit due", "waiting for your answer", "turn finished"]}
CYCLE, STEP = 3000, 50                    # 一轮 3 秒：每只手演完都能停一会儿；每 50ms 一帧

col, pad_top, line, pad_x, pad_y = 360, 12, 34, 22, 12
sheets = {g: Image.open(skin / f"{g}.png").convert("RGBA") for g, _, _, _ in gestures}
frame_of = lambda ends, t: next((i for i, e in enumerate(ends) if t < e), 8)   # 演完停在最后一帧

for lang, whens in WHEN.items():
    size = (col * 3, pad_top + HH + 8 + 2 * pad_y + 2 * line + 16)
    base = Image.new("RGBA", size, (0, 0, 0, 0))                  # 不动的部分：字和框
    draw = ImageDraw.Draw(base)
    for i, ((_, name, _, _), when) in enumerate(zip(gestures, whens)):
        cx, top = i * col + col // 2, pad_top + HH + 8
        half = max(draw.textlength(name, font=font), draw.textlength(when, font=font)) / 2 + pad_x
        draw.rounded_rectangle((cx - half, top, cx + half, top + 2 * pad_y + 2 * line - 6), radius=14, fill=WHITE, outline=INK, width=2)
        draw.text((cx, top + pad_y), name, font=font, fill=INK, anchor="ma")
        draw.text((cx, top + pad_y + line), when, font=font, fill=MUTED, anchor="ma")

    frames = []
    for t in range(0, CYCLE, STEP):
        img = base.copy()
        for i, (g, _, ends, delay) in enumerate(gestures):
            k = frame_of(ends, (t - delay) % CYCLE)
            hand = sheets[g].crop((k * W, 0, k * W + W, H)).resize((HW, HH), Image.Resampling.NEAREST)
            img.alpha_composite(hand, (i * col + (col - HW) // 2, pad_top))
        frames.append(img)

    # GIF 调色板：所有帧共用一套，半透明一律当透明（像素画和字框本来就没有半透明边）
    KEY = (255, 0, 255)
    def flat(im):
        out = Image.new("RGB", im.size, KEY)
        out.paste(im.convert("RGB"), mask=im.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
        return out
    flats = [flat(f) for f in frames]
    palette = flats[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    ps = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in flats]
    key_index = next(i for i in range(256) if tuple(palette.getpalette()[i * 3:i * 3 + 3]) == KEY)
    out = root / "docs" / ("hands-banner.gif" if lang == "zh" else "hands-banner.en.gif")
    ps[0].save(out, save_all=True, append_images=ps[1:], duration=STEP, loop=0, transparency=key_index, disposal=2, optimize=False)
    print(out, size, f"{len(ps)} frames, {out.stat().st_size // 1024} KB")
