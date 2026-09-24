# python docs/make-banner.py —— README 顶上那张图：三种手势各取最有辨识度的一帧，整数倍放大，像素字标名字。
# 背景透明，GitHub 深浅色都能放；字包在白色圆角框里（细黑边，浅色页面上也看得见框）。换了手的图就重跑一次。
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
skin = root / "skill" / "shoulder-tap" / "ui" / "sprites" / "skins" / "glove"
font = ImageFont.truetype(str(root / "desktop" / "Fonts" / "fusion-pixel-12px-proportional-zh_hans.ttf"), 24)  # 12px 网格 ×2

W, H, S = 96, 80, 3                  # 一帧 96×80，放大 3 倍
INK, MUTED, WHITE = (24, 24, 24, 255), (110, 106, 96, 255), (255, 255, 255, 255)
# (sheet, 第几帧, 名字)：tap 贴边那帧、pat 碰到那帧、snap 打响那帧
picks = [("tap", 2, "tap tap"), ("pat", 2, "pat pat"), ("snap", 1, "snap")]
WHEN = {"zh": ["跑偏了 / 习惯到点", "模型在等你回答", "这轮做完了"],
        "en": ["drifted / habit due", "waiting for your answer", "turn finished"]}

col, pad_top, line, pad_x, pad_y = 400, 16, 34, 22, 12
for lang, whens in WHEN.items():
    banner = Image.new("RGBA", (col * 3, pad_top + H * S + 2 * pad_y + 2 * line + 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(banner)
    for i, ((sheet, frame, name), when) in enumerate(zip(picks, whens)):
        hand = Image.open(skin / f"{sheet}.png").convert("RGBA").crop((frame * W, 0, frame * W + W, H))
        hand = hand.resize((W * S, H * S), Image.Resampling.NEAREST)
        banner.alpha_composite(hand, (i * col + (col - W * S) // 2, pad_top))
        cx, top = i * col + col // 2, pad_top + H * S + 8
        half = max(draw.textlength(name, font=font), draw.textlength(when, font=font)) / 2 + pad_x
        draw.rounded_rectangle((cx - half, top, cx + half, top + 2 * pad_y + 2 * line - 6), radius=14, fill=WHITE, outline=INK, width=2)
        draw.text((cx, top + pad_y), name, font=font, fill=INK, anchor="ma")
        draw.text((cx, top + pad_y + line), when, font=font, fill=MUTED, anchor="ma")
    out = root / "docs" / ("hands-banner.png" if lang == "zh" else "hands-banner.en.png")
    banner.save(out, optimize=True)
    print(out, banner.size)
