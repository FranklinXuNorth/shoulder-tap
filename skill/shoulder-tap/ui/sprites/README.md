# Pixel hand / Aseprite

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
