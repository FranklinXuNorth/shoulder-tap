# Pixel sprites / Aseprite

The six current editable sources are skins/glove/{tap,pat,snap}.aseprite and skins/cat-paw/{tap,pat,snap}.aseprite. Each contains nine 96x80 frames.

Glove sources separate white fill and black ink. Cat sources separate white fur, outline, and toe creases/pads, plus a hidden before-repair reference layer.

After saving edits in Aseprite, run:

    Aseprite --batch --script export-skins.lua
    python make-webp.py

The exporter validates dimensions, frame count and palette, then writes the three 864x80 PNG sheets for each skin. Web previews use lossless WebP copies. Only black, white and transparency are used; render with nearest-neighbor scaling.

The current desktop tray icon is tap-glove.png, exported from glove tap frame 1. Keep it: the desktop project embeds this file. cat-paw.png and its enlarged preview are exported from the open-paw frame. cat-paw-actions-preview.png and cat-paw-actions.gif are review snapshots of the repaired artwork.

Tap/pat timings: 250, 90, 90, 150, 90, 90, 150, 90, 300 ms. Contact frames: 3, 6, 8. Snap: nine 250ms frames, alternating closed/open and ending open.

Players discover skins with all three PNG sheets in skins/<name>/. Select the skin under Hand on the shoulder-tap page. The setting is skin in ~/.claude/shoulder-tap/config.json. Players trim shared right-side transparent padding so the furthest-reaching frame touches the screen edge.

Cat-paw style is semi-exaggerated: rounded white paw, short wrist, native 96x80 detail and approximately 2px outlines. Tap shows the furry back and extends one cartoon toe. Pat is an oblique side view with toe pads and central pad visible. Snap faces the viewer and opens/closes the paw.

Artwork was initially generated with GPT and repaired with native Aseprite pixel strokes. Older standalone sources, intermediate poses and generation scripts are obsolete but still present pending cleanup. Edit the six current sources directly.


Cat-only action accents are editable in the 'Action puffs - cat only' layer: three small irregular open-arc puffs on tap/pat contact frames 3, 6, 8 and snap open frames 2, 4, 6, 8, 9. Glove accents remain unchanged. After exporting Aseprite sources, run python preview-cat-paw.py to refresh the GIF/review images and cat WebP files. add-cat-paw-marks.lua regenerates only this effect layer; do not rerun it after manually editing the puffs.

