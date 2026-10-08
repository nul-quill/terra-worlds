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

Every control is mirrored into the URL hash (`#seed=...&pal=sepia&sea=0.6&...`),
so a finished world can be pasted into a chat and reopened identically. Loading a
hash fills the controls before the first render; anything absent falls back to the
default. `export` picks the nearest-neighbour multiplier used by Save PNG.
`Copy link` puts that URL on the clipboard.
`grid` pins the column count instead of deriving it from the window width, so the
same seed produces the same number of cells on a phone and on a wide monitor. The
row count keeps the canvas aspect, which is what makes the cells square. Because
the river cut is a quantile of the accumulation field, the share of the grid that
carries a channel barely moves when only the size changes — the smoke suite checks
that.
Keyboard: `space` or `r` rerolls, and `1`-`6` pick a palette by position.
Arrow keys walk the hovered cell, so the readout can be inspected without a
pointer; they are ignored while a form field has the caret.
`c` steps through the overlays and back to the biome map. The hover readout
reports the cell's moisture as well as its height, which is what makes two cells
at the same elevation land in different classes.
At the top of the sidebar, one line puts the world into words — shape, a relief
word with its range, the land share, the dominant class, plus `with lakes` and
`polar` when they apply. Save PNG uses the same idea for the filename: seed,
shape and grid size, so a folder of exports stays readable.
The sidebar ends with a small relief histogram: how much of the grid sits at each
elevation, bars below the shoreline drawn fainter, with a rule at the current sea
level. Bins span the world's own height range rather than 0..1, so a flat craton
still fills the chart. Hovering a bin dims the rest and prints that bin's elevation
range and cell count inside the chart. It redraws with every slider move.
Bin count follows the width of the chart, so a narrow sidebar does not turn into
mush. Hovering the map also highlights the bin that the hovered cell falls in,
which ties a colour on the map back to its place in the elevation spread; moving
the pointer off the map clears it again.
The `channel` select replaces the biome colours with one scalar field of the same
world: `relief` (height), `moist` (the orographic moisture field), `drain`
(catchment accumulation, logged so one big river does not wash out the rest) or
`coast` (distance to the nearest shoreline). Each is stretched over its own
percentiles and ramped between two colours taken from the active palette, so an
overlay looks like the map it came from. Everything underneath is untouched:
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
   is also shading-only. Hovering a legend row isolates that class on the map.
   The `lines` checkbox adds hypsometric contours: a thin darker rule every
   fraction of the relief above sea level, so the terraces and ridgelines read at
   a glance. The number of bands is derived from the world's own relief — between
   6 and 20 — so a flat craton does not turn into stripes while a jagged spill
   still shows steps. Spacing is measured from the shoreline, so the lines stay
   even however far the `sea` slider floods the map. Like the other shading knobs
   it never moves a biome boundary.
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
