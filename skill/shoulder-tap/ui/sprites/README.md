# Pixel hand / Aseprite

## Skins

### Editable Aseprite sources

Both `skins/glove/` and `skins/cat-paw/` contain `tap.aseprite`, `pat.aseprite`, and `snap.aseprite`: native 96×80, nine-frame animations with the player's frame durations. These six files are the current editable sources. Glove artwork is separated into white fill and black ink layers, and matches the current sheets pixel-for-pixel. Cat artwork has separate white fur, continuous outline, and toe-crease/pad layers, plus a hidden before-repair reference layer.

After editing and saving these files in Aseprite, run `Aseprite --batch --script export-skins.lua`, then `python make-webp.py`. This exports the visible layers and refreshes the web assets. `repair-paws.lua` documents the initial native Aseprite cleanup; rerunning it or `make-cat-paw.py` regenerates artwork from key poses, so **do not rerun them after manual source edits**.

The original top-level `tap-glove.aseprite` and `completion-hand.aseprite` are historical sources; use the six files under `skins/` for current edits.

The players read three sheets from `skins/<name>/`: `tap.png` (tap tap), `pat.png` (pat pat), `snap.png` (snap).
Each is 864×80: nine 96×80 frames in a row, black / white / transparent only, nearest-neighbor scaling.
`glove` is the built-in set (the sheets described below). Drop another folder next to it — say `skins/cat-paw/` —
and it shows up under Hand in the shoulder-tap page (tray icon, or `node onboard.mjs --hands`); the choice is `skin` in
`~/.claude/shoulder-tap/config.json`. Timing is fixed per gesture, not per skin: tap/pat 250, 90, 90, 150, 90, 90, 150, 90, 300 ms;
snap 9 × 250 ms alternating loaded / snapped, ending on snapped.
Players trim the transparent columns on the right that every frame leaves empty, so the frame that reaches furthest touches the screen edge. Padding on the right is harmless, but it will not show as a gap.

### Cat paw

`cat-paw-poses/` contains six GPT-generated key poses in a semi-exaggerated cartoon style: a dominant rounded white paw with only a short fur-edged wrist. Resolution matches the glove's native 96×80 detail, using single-pixel contour steps and approximately 2px black outlines, rather than enlarging a 48×40 drawing.

The final imagegen prompt directions are: tap shows the furry back and extends one short cartoon toe to the right; pat shows the underside obliquely from the side, with foreshortened toe pads and a central pad visible as the paw lowers; snap faces the pads toward the viewer and alternates curled/open toes. All prompts require black, white and transparency only, short wrists, and full canvas containment. The stylization is intentional; the snap animation represents paw opening/closing rather than a literal human finger snap.

Visual research used a [reaching-cat photograph](https://catvets.com/cat-friendly/certificate-program/sponsored/mars-shelter-program/) and a [paw anatomy diagram](https://anatomylearner.com/cat-paw-anatomy/) before adapting the gestures to the requested cartoon style.

`make-cat-paw.py` assembles key poses into the three nine-frame PNG sheets and matching lossless WebP files in `skins/cat-paw/` for initial generation. It validates dimensions, palette, frame bounds, and PNG/WebP pixel equality. For subsequent Aseprite edits use the export workflow above. `cat-paw-actions-preview.png` shows anticipation/contact pairs in tap, pat, snap row order; `cat-paw-actions.gif` plays the three gestures side by side at their actual timing.

## Current direction: cartoon pointer glove

`tap-glove.aseprite` is the revised design: bold two-pixel black contour, oversized round index finger, plump four-finger white glove, three back-of-hand stitches and a rolled cuff. The entire hand stays inside the canvas and points right.

Exports: `tap-glove.png` (transparent static), `tap-glove-sheet.png` (9 frames, 864×80), `tap-glove-preview.png` (6× white-background review). Source generator: `draw-glove.lua`. Uses the same frame timing below.

Frame durations (ms): 250, 90, 90, 150, 90, 90, 150, 90, 300. Total: 1300 ms.
Frames 3, 6 and 8 touch the edge. Play once for three taps, then hide the overlay; do not loop continuously.
Artwork uses only black, white and fully transparent pixels. Render with nearest-neighbor scaling.
The hand stays inside the canvas throughout. The reference edge is a separate layer and can be hidden for integration.

The HTML demo and desktop tap overlay now play `tap-glove-sheet.png`. Desktop completion continues to use `completion-hand-sheet.png`: both have the same white-glove style, with distinct index-tap and raised-palm gestures.

## Completion knock

`completion-hand.aseprite` uses the same bold white cartoon glove as `tap-glove`: two-pixel black outline, three short stitches, rolled cuff. Side profile based on the supplied photo: four extended fingers held together, thumb separated below, palm raised. The source is `draw-completion.lua`; exports are `completion-hand.png`, `completion-hand-sheet.png` and `completion-hand-preview.png`. Same 96?80 canvas and nine frame durations as above. The desktop completion overlay plays this sheet once; the original tap gesture is retained separately.

## Snap

Two stills drawn outside Aseprite: `snap-glove.png` (loaded) and `snap-glove-snapped.png` (snapped), same 96×80 canvas and palette.
`snap-glove-sheet.png` is the nine-frame strip the players use: loaded / snapped alternating, ending on snapped, played at 4fps (250ms per frame).
