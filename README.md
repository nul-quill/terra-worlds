# Terra

Deterministic procedural pixel-art world generator. Zero dependencies, zero build
step: open `index.html` in any browser, or run the CLI with Node.

```
node tests/smoke.js     # headless checks
node cli.js "aurora basin" --width 320 --height 200 --out world.ppm
```
Several seeds can be rendered in one call — each writes its own file
(`world-1.ppm`, `world-2.ppm`, …) — and `--json` swaps the stats table for one
JSON record per world, which is what a script would consume.
`--scale n` grows the saved pixels by nearest-neighbour without changing the
grid the stats are computed from, so a small grid can still fill a screen.
`--describe` prints only the one-line summary — the same sentence the sidebar
shows — and skips the `.ppm` file, which is handy for a quick comparison of
seeds.
`--palettes` lists the palette keys the `--palette` flag takes, with the label
each one shows in the dropdown and the sky colour the chart is washed with.
`--shapes` does the same for the shape keys. Both lists come from the generator
(`TerraCore.palettes`, `TerraCore.shapes`), which is also what fills the two
dropdowns — one source of truth for each.
`--channels` is the third list of the same kind: the overlay keys that
`--channel` takes, each with the field it reads.
`--phrases` is the fourth: the hand-picked seed phrases, numbered in the order
the `p` key walks them. Every phrase in that list is also rendered by the smoke
suite, so a suggestion copied from the terminal is never a dead one.
The overlay dropdown is built the same way from `TerraCore.channels`: the first
entry is the plain biome map, and the rest are the scalar ramps that
`--channel` takes. The `c` key walks that same array, so the dropdown, the
shortcut and the CLI always agree.
The stats record also carries a `classes` column: every class on this world's
legend, biggest first, as `shallow=38% grass=22%` pairs. That is the same list
the sidebar shows, so a saved `.ppm` can be described from its own record
without opening it.

Every control is mirrored into the URL hash (`#seed=...&pal=sepia&sea=0.6&...`),
so a finished world can be pasted into a chat and reopened identically. Loading a
hash fills the controls before the first render; anything absent falls back to the
default. `export` picks the nearest-neighbour multiplier used by Save PNG.
`Copy link` puts that URL on the clipboard.
A pinned legend class rides along as `pin=taiga`, so a shared link reopens with
the same class isolated. An unknown key in that field is ignored rather than
fading the whole map.
`grid` pins the column count instead of deriving it from the window width, so the
same seed produces the same number of cells on a phone and on a wide monitor. The
row count keeps the canvas aspect, which is what makes the cells square. Because
the river cut is a quantile of the accumulation field, the share of the grid that
carries a channel barely moves when only the size changes — the smoke suite checks
that.
Keyboard: `space` or `r` rerolls, and `1`-`6` pick a palette by position.
`c` cycles the overlays and `h` the shape curves, both walking the list the
matching dropdown shows.
`p` steps through the seed phrases listed by `--phrases`, which is a quicker way
to browse good worlds than rerolling at random — and unlike reroll it returns to
the first phrase after the last.
Reroll is not random: the next seed is a hash of the current one, so a run of
clicks from the same starting phrase walks the same sequence of worlds every
time. `node cli.js "aurora basin" --next 6` prints that sequence, one seed per
line, which is the quickest way back to a world found by clicking.
Add `--describe` to that call and each seed also gets its summary line.
`g` and `l` toggle grain and lines, `s` saves the PNG; the letters are ignored
while the caret is in a text field, so a seed phrase can still be typed. The
page follows the OS colour scheme, and a print stylesheet keeps the map plus
legend and stats while dropping the controls.
The stats list ends with a `pixels` row: eight hex digits of an FNV-1a hash over
the rendered RGBA buffer. Same seed and same grid, same digits — so a change in
the number means the world really changed, while a different `generate` time
does not. The CLI prints the same value.
Right after `lake` the list shows `basins`: how many separate closed depressions
that lake cover resolves into. Each one keeps its own water and spills over its
own lowest rim cell, so the number says whether the interior is a handful of big
The CLI record carries the same field as `lakeBasins`.
Arrow keys walk the hovered cell, so the readout can be inspected without a
pointer; they are ignored while a form field has the caret.
Hovering a bar in the relief chart also lights up the cells in that height band
on the map, the same way hovering a legend row isolates a class. A legend row
takes priority while the pointer is on it, and leaving either one restores the
full map. The legend works the other way too: bins that hold no cell of the
selected class dim in the chart, so a row shows the slice of the height range it
occupies. Every filter is a preview — only a clicked row ends up in the URL hash.
The hover crosshair and its hairlines take the palette's own ink, so they stay
visible on the pale sky of `Sepia` or `Mono` instead of washing out.
`c` steps through the overlays and back to the biome map. The hover readout
reports the cell's moisture as well as its height, which is what makes two cells
at the same elevation land in different classes.
While an overlay is on, the readout also prints that overlay's own ramp position
for the hovered cell — `drain 68` — which is the number the colour was mixed
from, not the raw field value. The scale is cached on the result when the overlay
is built, so walking the map does not re-sort the field.
At the top of the sidebar, one line puts the world into words — shape, a relief
word with its range, the land share, the dominant class, plus how many separate
lake basins the world has (`4 lakes`) and `polar` when they apply. Hovering a
lake cell names its own basin — `basin 2/4` — so two bodies of water of the same
depth are easy to tell apart while walking the map. The same readout adds the
bearing of that basin's spillway — `drains E` — the direction its surplus
leaves over the lowest point of the rim, which is also where the outflow
channel starts. Hovering that rim cell itself prints `outlet`, so the seam
between a lake and the river network is findable by eye. Save PNG uses the same
idea for the filename: seed, shape, palette, grid size and the pixel checksum, so
a folder of exports stays readable and any file can be traced back to the link
that produced it. The checksum is the same eight digits as the `pixels` row.
The sidebar ends with a small relief histogram: how much of the grid sits at each
elevation, bars below the shoreline drawn fainter, with a rule at the current sea
level. Bins span the world's own height range rather than 0..1, so a flat craton
still fills the chart. Hovering a bin dims the rest and prints that bin's elevation
range and cell count inside the chart. It redraws with every slider move.
Tapping a bar works too: the chart answers a touch `pointerdown` with the same
selection rule the cursor uses, so the bin filter is not mouse-only.
The two corners of the chart carry the minimum and maximum elevation of this
world, so the bars have a scale without needing a second readout.
Between them the chart marks the median height — half the grid sits below that
mark — which is what separates a broad plateau with a trench from a plain with
a single peak, even when both worlds report the same relief range. The same
number appears as the `median` row in the stats list and in the CLI record.
Bin count follows the width of the chart, so a narrow sidebar does not turn into
mush. Hovering the map also highlights the bin that the hovered cell falls in,
which ties a colour on the map back to its place in the elevation spread; moving
the pointer off the map clears it again.
The `channel` select replaces the biome colours with one scalar field of the same
world: `relief` (height), `moist` (the orographic moisture field), `drain`
(catchment accumulation, logged so one big river does not wash out the rest),
`lake` (standing water, scaled by its own basin depth rather than percentiles,
since most of a grid is dry) or `coast` (distance to the nearest shoreline).
Each is stretched over its own percentiles and ramped between two colours taken
from the active palette, so an overlay looks like the map it came from.
Everything underneath is untouched:
legend, stats, chart and hover readout all still describe the same cells. The CLI
accepts the same names through `--channel`.

## What it does

Every world is a pure function of a seed string. The same seed renders the same
pixels on any machine, at any window size, in the browser or from the CLI.

Pipeline, all on the CPU:

1. **Height** — fBm value noise blended with a ridged multifractal for mountain
   spines, then a shape curve (`continents`, `islands`, `atolls`, `craton`) and an
   optional high-frequency detail term.
2. **Climate** — a moisture field plus a latitude-driven temperature band, mixed
   with a low-frequency noise so zones are not pure horizontal stripes. The `climate`
   slider blends between a flat temperature profile and a strict latitude ladder.
   A short orographic pass then lets a westerly airmass lose moisture on the windward
   side of a ridge, so the leeward side comes out a band drier.
3. **Drainage** — cells are visited highest-first and each one pushes its
   accumulation into its lowest neighbour, which yields dendritic river networks
   without any per-frame work. The cut is a quantile of the accumulation field, so
   one slider value behaves the same on a small preview and a large export; the top
   slice of that same field is drawn as a trunk river with a stronger blend.
   A two-pass chamfer sweep also measures the distance to the nearest shoreline,
   which dries the continental interior a little and is printed in the hover
   readout as `N from water`.
4. **Basins** — a cell holds water when every route off it climbs. Comparing its
   height against the minimum on a ring around it gives the water surface, and a
   flood fill up to that surface fills the basin. Lakes also green their shore.
   Each basin also reports its lowest rim cell, so the surplus leaves as a short
   outflow channel and the catchment continues downstream instead of stopping.
5. **Biomes** — a temperature x moisture lookup gives 11 land/water classes; coast
   cells, polar ice caps, snow caps and alpine rock are resolved on top.
6. **Shading** — a hillshade from the height gradient, a 4x4 Bayer dither to kill
   banding, and depth falloff under water and in lakes. The `grain` checkbox drops
   the dither for a flat, posterised look; it only touches shading, never a biome
   boundary. `from` picks the compass bearing of the light (NW / NE / SW / SE), which
   is also shading-only.
   The `lines` checkbox adds hypsometric contours: a thin darker rule every
   fraction of the relief above sea level, so the terraces and ridgelines read at
   a glance. The number of bands is derived from the world's own relief — between
   6 and 20 — so a flat craton does not turn into stripes while a jagged spill
   still shows steps. Spacing is measured from the shoreline, so the lines stay
   even however far the `sea` slider floods the map. Like the other shading knobs
   it never moves a biome boundary.
   Hovering a legend row isolates that class on the map; clicking the row pins it,
   so the selection survives moving the cursor back onto the canvas. Clicking the
   same row again releases it, and the pin is kept across a reroll. The rows are in
   the tab order, so `Enter` pins and `Space` releases without a pointer; `Space`
   only rerolls when the caret is somewhere else.
   Under water the same switch draws bathymetric lines, a lighter set of steps
   between the deepest cell and the shoreline, with their own count derived from
   the depth range (3 to 12). Both counts are listed in the stats block.

The noise lattice counts are integers and every octave doubles them, so the field
tiles seamlessly on both axes — pan or tile the map with no visible seam.

## Files

| path | role |
| --- | --- |
| src/core.js | generator: noise, climate, drainage, biomes, shading. No DOM access. |
| app.js | browser shell: canvas draw, hover readout, legend, PNG export |
| cli.js | headless render to PPM + stats |
| styles.css | layout only |
| tests/smoke.js | assertions for determinism, coverage, thresholds, perf |

## Why it is fast

The whole map is one pass over a `Float32Array` height field plus one colour pass,
so a 480x300 world generates in well under 100 ms and re-renders on every slider
move without a visible hitch. Upscaling for export uses nearest-neighbour so the
pixels stay crisp instead of blurring.
