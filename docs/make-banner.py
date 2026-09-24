# python docs/make-banner.py —— README 顶上那张会动的图：三只手套各自按桌面端的真实节奏循环播放，只有手。
# 背景透明（GIF 只有全透明 / 不透明两档，像素画正好合适）。换了手的图就重跑一次。
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
skin = root / "skill" / "shoulder-tap" / "ui" / "sprites" / "skins" / "glove"

W, H, S = 96, 80, 2.4                     # 一帧 96×80，放大 2.4 倍
HW, HH = round(W * S), round(H * S)
TAPS = [250, 340, 430, 580, 670, 760, 910, 1000, 1300]         # 跟桌面端一样：每帧结束的时刻（毫秒）
SNAPS = [250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250]
# (sheet, 每帧结束时刻, 起步延迟)：三只手错开，像一排依次动起来，而不是一起抽一下
gestures = [("tap", TAPS, 0), ("pat", TAPS, 600), ("snap", SNAPS, 250)]
CYCLE, STEP = 3000, 50                    # 一轮 3 秒：每只手演完都能停一会儿；每 50ms 一帧
col, pad = 360, 8

sheets = {g: Image.open(skin / f"{g}.png").convert("RGBA") for g, _, _ in gestures}
frame_of = lambda ends, t: next((i for i, e in enumerate(ends) if t < e), 8)   # 演完停在最后一帧

frames = []
for t in range(0, CYCLE, STEP):
    img = Image.new("RGBA", (col * len(gestures), HH + 2 * pad), (0, 0, 0, 0))
    for i, (g, ends, delay) in enumerate(gestures):
        k = frame_of(ends, (t - delay) % CYCLE)
        hand = sheets[g].crop((k * W, 0, k * W + W, H)).resize((HW, HH), Image.Resampling.NEAREST)
        img.alpha_composite(hand, (i * col + (col - HW) // 2, pad))
    frames.append(img)

# GIF 调色板：所有帧共用一套，半透明一律当透明（手只有黑、白、全透明）
KEY = (255, 0, 255)
def flat(im):
    out = Image.new("RGB", im.size, KEY)
    out.paste(im.convert("RGB"), mask=im.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
    return out
flats = [flat(f) for f in frames]
palette = flats[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
ps = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in flats]
key_index = next(i for i in range(256) if tuple(palette.getpalette()[i * 3:i * 3 + 3]) == KEY)
out = root / "docs" / "hands-banner.gif"
ps[0].save(out, save_all=True, append_images=ps[1:], duration=STEP, loop=0, transparency=key_index, disposal=2, optimize=False)
print(out, frames[0].size, f"{len(ps)} frames, {out.stat().st_size // 1024} KB")
