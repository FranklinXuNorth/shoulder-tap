"""Assemble GPT-drawn key poses into three distinct cat-paw animations."""
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
W, H, N = 96, 80, 9
out = here / "skins" / "cat-paw"
out.mkdir(parents=True, exist_ok=True)
colors = {(0, 0, 0, 0), (0, 0, 0, 255), (255, 255, 255, 255)}
poses = {p.stem: Image.open(p).convert("RGBA") for p in (here / "cat-paw-poses").glob("*.png")}


def frame(name, dx=0, dy=0):
    pose = poses[name]
    assert pose.size == (W, H), name
    bbox = pose.getbbox()
    assert 0 < bbox[0] + dx and bbox[2] + dx < W, (name, dx)
    assert 0 < bbox[1] + dy and bbox[3] + dy < H, (name, dy)
    result = Image.new("RGBA", (W, H))
    result.alpha_composite(pose, (dx, dy))
    assert set(result.getdata()) <= colors, name
    return result


tap = [frame("tap-ready", dx, dy) for dx, dy in
       [(0, 0), (2, 0), (4, -2), (0, 0), (2, 0), (4, -2), (0, 0), (4, -2), (0, 0)]]
pat = [frame(name, dx, dy) for name, dx, dy in [
    ("pat-ready", 0, -2), ("pat-ready", 2, 0), ("pat-contact", 2, 0),
    ("pat-ready", 0, -2), ("pat-ready", 2, 0), ("pat-contact", 2, 0),
    ("pat-ready", 0, -2), ("pat-contact", 2, 0), ("pat-ready", 0, -2),
]]
snap = [frame("snap-ready" if i in (0, 2, 4, 6) else "snap-release") for i in range(N)]
animations = {"tap": tap, "pat": pat, "snap": snap}
durations = [250, 90, 90, 150, 90, 90, 150, 90, 300]
for name, frames in animations.items():
    sheet = Image.new("RGBA", (W * N, H))
    for i, image in enumerate(frames):
        sheet.alpha_composite(image, (i * W, 0))
    sheet.save(out / f"{name}.png")
    sheet.save(out / f"{name}.webp", lossless=True, exact=True, method=6)
    assert Image.open(out / f"{name}.webp").convert("RGBA").tobytes() == sheet.tobytes()
    print(f"{name}: 864x80, {len({f.tobytes() for f in frames})} distinct frames; palette and bounds OK")

# Rows: tap, pat, snap. Columns: anticipation / contact or release.
preview = Image.new("RGBA", (W * 2, H * 3), "white")
for row, frames in enumerate(animations.values()):
    preview.alpha_composite(frames[0], (0, H * row))
    preview.alpha_composite(frames[1 if row == 2 else 2], (W, H * row))
preview.resize((W * 8, H * 12), Image.Resampling.NEAREST).save(here / "cat-paw-actions-preview.png")

# Side-by-side review at the players' actual timing: tap / pat / snap.
ends = [sum(durations[:i + 1]) for i in range(N)]
review = []
for t in range(0, 2500, 10):
    canvas = Image.new("RGBA", (W * 3, H), "white")
    for col, (name, frames) in enumerate(animations.items()):
        index = min(t // 250, 8) if name == "snap" else next((i for i, end in enumerate(ends) if t < end), 8)
        canvas.alpha_composite(frames[index], (W * col, 0))
    review.append(canvas.resize((W * 9, H * 3), Image.Resampling.NEAREST).convert("RGB"))
review[0].save(here / "cat-paw-actions.gif", save_all=True, append_images=review[1:], duration=10, loop=0)
