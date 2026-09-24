# python make-cat-paw.py —— 用 cat-paw.png 那一张静态图拼出 skins/cat-paw/ 的三张 sheet。
# 没有逐帧画的猫爪之前先顶着：tap / pat 是爪子往右边挪过去碰三下（第 3、6、8 帧贴边），snap 是两个姿势来回切。
# 有人画了真正的九帧，直接覆盖 skins/cat-paw/*.png 就行，这个脚本就不用了。
from pathlib import Path
from PIL import Image

here = Path(__file__).parent
paw = Image.open(here / "cat-paw.png").convert("RGBA")
W, H, N = 96, 80, 9
out = here / "skins" / "cat-paw"
out.mkdir(parents=True, exist_ok=True)


def sheet(offsets):
    s = Image.new("RGBA", (W * N, H), (0, 0, 0, 0))
    for i, (dx, dy) in enumerate(offsets):
        s.paste(paw, (i * W + dx, dy), paw)
    return s


# 爪子本身在画布里偏右上；碰边的三帧再往右推 6px，其余在 0 和 3 之间回弹。
touch = [(0, 0), (3, 0), (6, 0), (3, 0), (3, 0), (6, 0), (3, 0), (6, 0), (0, 0)]
sheet(touch).save(out / "tap.png")
sheet(touch).save(out / "pat.png")
# 响指：抬起（往上 4px）/ 落下 交替，最后落下。
snap = [(0, -4), (0, 0)] * 4 + [(0, 0)]
sheet(snap).save(out / "snap.png")
print("→", out)
