# python make-webp.py —— 给 sprites 下每张 png 存一份无损 webp，网页用 webp，桌面端照旧读 png。
# 无损：像素画压有损会糊边。换了图就重跑一次；页面找不到 webp 会退回 png，不会坏。
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
for png in sorted(here.rglob("*.png")):
    webp = png.with_suffix(".webp")
    Image.open(png).save(webp, "WEBP", lossless=True, quality=100, method=6)
    print(f"{png.relative_to(here)}  {png.stat().st_size}B → {webp.stat().st_size}B")
