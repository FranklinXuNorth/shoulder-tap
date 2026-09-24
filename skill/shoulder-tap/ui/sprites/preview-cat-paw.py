"""Render review images from exported sheets; never changes editable artwork."""
from pathlib import Path
from PIL import Image

root = Path(__file__).parent
frames = {}
allowed = {(0, 0, 0, 0), (0, 0, 0, 255), (255, 255, 255, 255)}
for name in ("tap", "pat", "snap"):
    path = root / "skins" / "cat-paw" / f"{name}.png"
    sheet = Image.open(path).convert("RGBA")
    assert sheet.size == (864, 80)
    frames[name] = [sheet.crop((i * 96, 0, (i + 1) * 96, 80)) for i in range(9)]
    for image in frames[name]:
        pixels = image.load()
        assert {pixels[x, y] for y in range(80) for x in range(96)} <= allowed
        left, top, right, bottom = image.getbbox()
        assert left > 0 and top > 0 and right < 96 and bottom < 80
    # Each puff's top arc must appear on action frames only.
    x, y = {"tap": (67, 12), "pat": (68, 17), "snap": (52, 5)}[name]
    active = {1, 3, 5, 7, 8} if name == "snap" else {2, 5, 7}
    for i, image in enumerate(frames[name]):
        assert (image.getpixel((x, y))[3] == 255) == (i in active), (name, i)
        if i in active:
            assert image.getpixel((x, y)) == (0, 0, 0, 255)
            assert image.getpixel((x, y - 1)) == (255, 255, 255, 255), (name, i, "white backing")
    sheet.save(path.with_suffix(".webp"), lossless=True, exact=True, method=6)
    assert Image.open(path.with_suffix(".webp")).convert("RGBA").tobytes() == sheet.tobytes()
    print(f"{name}: frame timing, puff visibility, bounds, palette, WebP verified")

preview = Image.new("RGBA", (192, 240), "white")
for row, (name, images) in enumerate(frames.items()):
    preview.alpha_composite(images[0], (0, row * 80))
    preview.alpha_composite(images[1 if name == "snap" else 2], (96, row * 80))
preview.resize((768, 960), Image.Resampling.NEAREST).save(root / "cat-paw-actions-preview.png")

# Side-by-side light/dark backgrounds make the white backing visible for review.
contrast = Image.new("RGBA", (192, 240))
for row, (name, images) in enumerate(frames.items()):
    action = images[1 if name == "snap" else 2]
    for col, color in enumerate(("#eeeeee", "#252830")):
        tile = Image.new("RGBA", (96, 80), color)
        tile.alpha_composite(action)
        contrast.paste(tile, (col * 96, row * 80))
contrast.resize((768, 960), Image.Resampling.NEAREST).save(root / "cat-paw-puffs-contrast.png")

ends = (250, 340, 430, 580, 670, 760, 910, 1000, 1300)
review = []
for t in range(0, 2500, 10):
    canvas = Image.new("RGBA", (288, 80), "white")
    for col, (name, images) in enumerate(frames.items()):
        index = min(t // 250, 8) if name == "snap" else next((i for i, end in enumerate(ends) if t < end), 8)
        canvas.alpha_composite(images[index], (col * 96, 0))
    review.append(canvas.resize((864, 240), Image.Resampling.NEAREST).convert("RGB"))
review[0].save(root / "cat-paw-actions.gif", save_all=True, append_images=review[1:], duration=10, loop=0)
for name in ("cat-paw.png", "cat-paw-preview.png", "cat-paw-actions-preview.png"):
    Image.open(root / name).save((root / name).with_suffix(".webp"), lossless=True, exact=True, method=6)
