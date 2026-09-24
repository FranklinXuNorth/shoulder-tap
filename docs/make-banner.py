# python docs/make-banner.py —— README 顶上那张图：三种手势各取最有辨识度的一帧，整数倍放大，像素字标名字。
# 换了手的图就重跑一次。
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
skin = root / "skill" / "shoulder-tap" / "ui" / "sprites" / "skins" / "glove"
font = ImageFont.truetype(str(root / "desktop" / "Fonts" / "fusion-pixel-12px-proportional-zh_hans.ttf"), 24)  # 12px 网格 ×2

W, H, S = 96, 80, 3                  # 一帧 96×80，放大 3 倍
BG, INK, MUTED = (242, 240, 234), (24, 24, 24), (120, 116, 106)
# (sheet, 第几帧, 名字)：tap 贴边那帧、pat 碰到那帧、snap 打响那帧
picks = [("tap", 2, "tap tap"), ("pat", 2, "pat pat"), ("snap", 1, "snap")]
WHEN = {"zh": ["跑偏了 / 习惯到点", "模型在等你回答", "这轮做完了"],
        "en": ["drifted / habit due", "waiting for your answer", "turn finished"]}

col, pad_top = 400, 20
for lang, whens in WHEN.items():
    banner = Image.new("RGB", (col * 3, pad_top + H * S + 96), BG)
    draw = ImageDraw.Draw(banner)
    for i, ((sheet, frame, name), when) in enumerate(zip(picks, whens)):
        hand = Image.open(skin / f"{sheet}.png").convert("RGBA").crop((frame * W, 0, frame * W + W, H))
        hand = hand.resize((W * S, H * S), Image.Resampling.NEAREST)
        banner.paste(hand, (i * col + (col - W * S) // 2, pad_top), hand)
        cx, y = i * col + col // 2, pad_top + H * S + 10
        draw.text((cx, y), name, font=font, fill=INK, anchor="ma")
        draw.text((cx, y + 36), when, font=font, fill=MUTED, anchor="ma")
    out = root / "docs" / ("banner.png" if lang == "zh" else "banner.en.png")
    banner.save(out, optimize=True)
    print(out, banner.size)
