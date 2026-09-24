"""
Snap glove: python draw-snap.py  (Pillow; Aseprite isn't needed for this one)

Same contract as draw-glove.lua / draw-completion.lua: 96x80 canvas, 9 frames,
black / white / transparent only, 2px contour, rolled cuff, hand stays inside the canvas.
Unlike the tap and pat sheets this one is just two stills, "loaded" and "snapped",
alternating at 4fps (250ms per frame); the desktop players use their own timing for it.

Exports: snap-glove.png, snap-glove-sheet.png (864x80), snap-glove-preview.png (6x, white).
"""
from pathlib import Path
from PIL import Image

W, H = 96, 80
BLACK, WHITE = (0, 0, 0, 255), (255, 255, 255, 255)
OUT = Path(__file__).parent


def canvas():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def px(img, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        img.putpixel((x, y), c)


def line(img, x0, y0, x1, y1, c=BLACK):
    # Bresenham with a 2x2 brush, identical to the Lua scripts.
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        for ox, oy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            px(img, x0 + ox, y0 + oy, c)
        if x0 == x1 and y0 == y1:
            break
        e = 2 * err
        if e >= dy:
            err += dy; x0 += sx
        if e <= dx:
            err += dx; y0 += sy


def path(img, pts, closed=False):
    for a, b in zip(pts, pts[1:]):
        line(img, *a, *b)
    if closed:
        line(img, *pts[-1], *pts[0])


def polygon(img, p):
    for y in range(H):
        for x in range(W):
            inside, j = False, len(p) - 1
            for i in range(len(p)):
                a, b = p[i], p[j]
                if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
                    inside = not inside
                j = i
            if inside:
                px(img, x, y, WHITE)
    path(img, p, closed=True)


def cuff(img):
    polygon(img, [(24, 56), (29, 57), (42, 65), (43, 69), (39, 74), (35, 76), (17, 65), (17, 61), (20, 57)])
    path(img, [(20, 59), (24, 60), (39, 69)])


def stitches(img):
    path(img, [(31, 48), (34, 53)])
    path(img, [(37, 46), (40, 51)])
    path(img, [(43, 45), (45, 50)])


def ready():
    """Loaded: middle finger bent forward, thumb pushing up into its tip. Index stays up."""
    img = canvas()
    polygon(img, [(40, 30), (46, 16), (52, 8), (57, 6), (61, 8), (61, 12), (56, 20), (52, 31)])
    polygon(img, [(26, 60), (22, 50), (24, 40), (32, 33), (44, 30), (56, 33), (62, 38), (66, 44), (65, 52), (60, 60), (52, 65), (38, 66)])
    path(img, [(54, 44), (52, 48), (55, 53), (62, 53)])
    path(img, [(53, 55), (53, 58), (58, 60)])
    # Thumb first, so the middle finger sits on top of its tip: that overlap is the pinch.
    polygon(img, [(58, 48), (64, 40), (70, 32), (75, 30), (79, 32), (78, 37), (72, 44), (64, 52)])
    polygon(img, [(48, 32), (56, 25), (65, 21), (73, 20), (77, 22), (77, 27), (72, 30), (62, 32), (56, 38)])
    stitches(img)
    cuff(img)
    return img


def snapped():
    """Middle finger slammed into the palm, thumb flicked up past where it was."""
    img = canvas()
    polygon(img, [(40, 30), (46, 16), (52, 8), (57, 6), (61, 8), (61, 12), (56, 20), (52, 31)])
    polygon(img, [(26, 60), (22, 50), (24, 40), (32, 33), (44, 30), (56, 33), (62, 38), (66, 44), (65, 52), (60, 60), (52, 65), (38, 66)])
    # Middle finger now curled against the heel of the thumb: a fat knuckle bump.
    polygon(img, [(52, 33), (60, 30), (67, 32), (70, 37), (68, 42), (61, 42), (56, 40)])
    path(img, [(56, 44), (52, 48), (55, 53), (63, 53)])
    path(img, [(54, 55), (53, 58), (58, 60)])
    # Thumb straight up and out, tip clear of the middle finger.
    polygon(img, [(60, 38), (66, 28), (70, 18), (74, 13), (78, 13), (80, 17), (77, 25), (72, 34), (68, 42)])
    stitches(img)
    cuff(img)
    return img


def burst(img, big):
    """The 'pop' next to where finger met thumb. Short 2px rays, like the contact strokes on the tap."""
    rays = [((82, 20), (86, 20)), ((80, 11), (83, 8)), ((81, 28), (84, 31)), ((72, 6), (72, 3))]
    far = [((88, 20), (91, 20)), ((85, 6), (87, 4)), ((86, 33), (88, 35)), ((66, 5), (64, 2))]
    for a, b in rays + (far if big else []):
        line(img, *a, *b)
    return img


# Two poses flipped at 4fps (250ms each): loaded, SNAP, loaded, SNAP ... ending on the snap.
R, S = ready(), burst(snapped(), True)
frames = [R, S, R, S, R, S, R, S, S]

ready().save(OUT / "snap-glove.png")
sheet = canvas().resize((W * len(frames), H))
for i, f in enumerate(frames):
    sheet.alpha_composite(f, (i * W, 0))
sheet.save(OUT / "snap-glove-sheet.png")

# Review image: the ready pose and the snap frame side by side, 6x on white.
preview = Image.new("RGBA", (W * 2, H), WHITE)
preview.alpha_composite(frames[0], (0, 0))
preview.alpha_composite(frames[1], (W, 0))
preview.resize((W * 12, H * 6), Image.NEAREST).save(OUT / "snap-glove-preview.png")
print("Created 96x80 snap glove, 9 frames, black/white/transparent.")
