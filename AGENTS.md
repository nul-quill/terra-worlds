# AGENTS.md — working notes for this repo

Layout (plain static site, no build step, no package manager):

- `index.html` — shell, loads `src/core.js` then `app.js`
- `src/core.js` — generator only, no DOM access, exposes `window.TerraCore`
- `app.js` — browser shell: canvas draw, hover readout, legend, PNG export
- `cli.js` — headless render to PPM for quick eyeballing
- `tests/smoke.js` — assertions, run with `node tests/smoke.js`
- `env/` — bundled conda env (Python 3.10). Call the interpreter directly:
  `.\env\Scripts\python.exe` fails in PowerShell; use
  `& 'd:\something\env\python.exe' -c "..."` instead.

Conventions:

- ES5-style JS (`var`, function expressions) so the page runs from `file://`
  without a transpiler. No dependencies, no CDN assets.
- Keep generation deterministic: everything derives from the seed hash, so the
  same seed must produce byte-identical pixels at any canvas size.
- Render fixtures (`*.ppm`, the root `*.png`) are written by the smoke suite and
  the CLI on every run, so they are git-ignored: a seed is the artifact, the
  dumped pixels are not. Do not commit them to keep a diff small.
- River density is a quantile of the flow-accumulation field, not an absolute
  cell count. That is what keeps density stable across grid sizes, shapes and
  terracing. Do not replace it with a fixed threshold.
- Drainage walks the height field highest-rank-first with an index tie-break,
  otherwise terraced plateaus stop draining and rivers disappear.
- Lakes are closed depressions: the water surface is the minimum on a ring of
  radius `RIM` around the seed cell, and the basin is a flood fill capped at that
  surface. The old single-cell test (`gap > threshold` only) left one-pixel dots.
  Each fill also records its lowest rim neighbour as a spillway, so a basin's
  accumulation continues downstream instead of dying at the shore.
  `recordSpill()` bumps `stats.lakeBasins` once per fill, which is what the
  `basins` row and the CLI `lakeBasins` field report. Keep the increment there
  (one call per basin) rather than recounting the mask afterwards.
  The same loop labels each filled cell in `result.basin` (1-based), which is
  what the hover readout prints as `basin 2/4`. `describe()` uses the count too:
  `4 lakes` rather than a bare `with lakes`.
  `recordSpill()` also pushes one compass point per basin into
  `result.basinSpill`, indexed by basin number minus one: the bearing from the
  fill's centroid to its spillway, printed by the hover readout as `drains E`.
  The spillway cell itself is marked in `result.spillway` (one cell per basin),
  which the readout prints as `outlet` and the river pass uses to keep a
  basin's catchment drawn even when accumulation alone would cut it off.
  The spillway search caps the rim at `seaLevel + 0.30` on the first pass, then
  retries without the cap — a terraced plateau stacks its rims high enough that
  the capped pass alone would leave a big basin with no outlet at all.
  The flood fill marks cells in `queued` with the fill number at enqueue time,
  not at dequeue: without that a cell offered by two neighbours is pushed twice
  and overflows the one-slot-per-cell queue.
- The trunk/tributary split is a second quantile of the SAME accumulation field
  (`majorCut`), never a separate threshold. `riverMask` holds 1 or 2.
- Hypsometric band count is derived from the relief above the shoreline
  (`contourBands`, clamped 6..20) and published in `stats`, so a flat craton
  does not turn into stripes. Keep it derived, not a fixed constant.
  The water gets its own count from the depth range (`basinBands`, clamped 3..12)
  drawn by the same `contour` switch. Both stay derived, never constants.
  `stats.median` is the middle of the sorted height field, published for the
  same reason: min/max alone cannot tell a plateau from a peaked plain. It is
  grid-size dependent like the band counts, so any assertion comparing it with
  the CLI record must generate the same grid in both places.
- Shading-only knobs (`hillshade`, `lightDir`, `dither`) must never move a biome
    boundary: classification happens before the colour pass. The smoke suite
    asserts that, so keep it that way. `contour` (hypsometric lines) belongs to
    this same group.
- Moisture is not a standalone field: the orographic pass in `generate` folds the
  relief into it, so ridges get a windward wet band and a leeward rain shadow.
  Keep it a per-row sweep — it is O(n) and must stay that way.
- Distance to the shoreline (`coastDistance`) comes from two chamfer sweeps
  (forward, then backward) over the grid: O(n), no queue. It both dries the
  continental interior in the biome lookup and feeds the hover readout. Do not
  replace it with a BFS from the coast.
- `channelize(result, name)` is a separate pass over the already-computed fields
  (`heightField`, `moisture`, `accumulation`, `coastDistance`). It never feeds back
  into `generate`: an overlay must not change the biome map. Stretch each field by
  its own 2%/98% percentiles, and keep the log transform on `drain` and `coast` —
  both are heavy-tailed and a linear ramp collapses them into one colour.
  `fieldFor(key, result)` is the single field lookup shared by the ramp and by
  `channelValue(result, cell)`, which is what the hover readout prints. The scale
  is cached in `result.channelScale` during `channelize` so a hover does not sort
  the field again; keep it that way rather than recomputing percentiles per cell.
  The `lake` overlay is the one exception to the percentile rule: the mask is
  already normalised by its own basin (1..60 steps), and most of a grid is dry,
  so the 98% mark of a world with two small tarns is still zero. It scales over
  0..60 instead.
  `slope` is the one field built inside `fieldFor` rather than by `generate`:
  it is a difference of the height field, so it still cannot move a biome
  boundary, and it is cached on `result.slopeField` for the same reason the
  scale is — a hover reads the field once per cell.
- `stats.checksum` is FNV-1a over the rendered RGBA buffer, as eight hex digits.
  It is the cheap equality test for determinism: same seed + same grid must give
  the same digits, while `stats.ms` is allowed to wander. Keep the multiply in the
  shift-add form so it stays inside 32 bits.
- The CLI record in `summarise()` carries the parts of the state that the summary
  sentence cannot hold: `palette` and `channel` both change only pixels, so every
  count stays identical without them. Keep both in the record and keep the smoke
  assertions comparing one populated run against the plain one.
- `nextSeed(value)` derives the next seed from the current one (FNV-1a over the
  phrase plus a `\u0001` separator). The Reroll button and `cli.js --next n` both
  use it, so a click sequence is reproducible from the first phrase. Do not
  replace it with a plain `randomSeed()` call in the button.
- Letter shortcuts (`c`, `h`, `k`, `d`, `w`, `g`, `l`, `p`, `s`) are skipped while an INPUT or
  SELECT owns the caret, so a seed phrase can still be typed. Each cycle key
  reads the same array its dropdown does — `TerraCore.channels` for `c`,
  `TerraCore.shapes` for `h`, `TerraCore.phrases` for `p`, `TerraCore.lights` for
  `d`, `TerraCore.grids` for `w` — so a key and the
  select can never disagree about the order. Every cycle key also answers to
  `Shift`: one branch, a `±1` step, so a mis-press backs out instead of looping
  the whole list. `styles.css` ends with two
  `@media` blocks: `print` (hides the chrome, one column) and
  `prefers-color-scheme: dark` (only the CSS variables change). Both are checked
  with `page.emulateMedia()` followed by a reload.
  - The URL hash is written by `writeHash()` only, and every pair in it comes from
    a form control in `HASH_KEYS` plus two extras that are not controls: `pin=` for
    the clicked legend class and `at=x,y` for the hovered cell. Both pointer paths
    and `hoverCell()` call `writeHash()` after painting, so the link always matches
    what the readout shows. `applyHash()` stores `at` in `atCell` and `render()`
    replays it through `hoverCell()` when no pointer hover is active — that is the
    only writer of the pair, so keep the clamp inside `hoverCell()` rather than
    trimming the indices at parse time.
- Legend isolation lives in `drawMap()`: `solo` follows the pointer/focus,
  `pinned` is the click selection and survives a reroll. Both blend non-matching
  cells toward the palette sky in that one loop — do not add a second blend
  path, or hover and click will disagree about the result.
  A hovered relief-chart bar (`band`, a bin index) is the third filter in that
  same loop: it selects by height instead of by class, and a legend selection
  wins over it. Like `solo` it is a preview and never goes into the hash; both
  are cleared when the pointer leaves the map.
  The chart reads the same three filters in `paintHistogram()`: a hovered bin
  dims the other bars, a legend selection dims the bins with none of that class.
  `drawMap()` calls `paintHistogram()` so one repaint keeps both views in step —
  do not repaint the chart from the individual handlers.
  `hoverHistogram()` is shared by `mousemove` and a touch `pointerdown`, so a tap
  on the chart selects a bin the same way a cursor does. Keep the one function.
  Shift+arrows walk the same bin through `stepBand()`, which is the keyboard
  path for the height filter; plain arrows still walk cells. Both are previews —
  neither goes into the hash.
  Rows carry `data-key` so a keyboard toggle can hand the caret back after the
  list is rebuilt, and the row's own `keydown` stops propagation: `Space` is
  also the reroll shortcut and must not fire twice.
  The row order comes from `legendKeys(result)` — classes present on this world,
  biggest first. The `k` cycle walks that same array, so the key follows the
  order on screen instead of the order the palette declares. Like the click it
  pins, so it writes the hash; unlike `solo` and `band` it is not a preview.
  `Shift+k` walks the same array backwards, which is why the cycle is a
  `(ki + step + rows.length) % rows.length` step rather than a plain increment:
  a mis-press should not need a whole lap to undo. Keep the one branch handling
  both directions.
- `cli.js --palettes` lists the palette keys from `core.palettes`, so a name
  copied from the terminal is always valid for `--palette`. The smoke suite
  compares that listing against `Object.keys(core.palettes)` — keep both in step.
  `--shapes` does the same job for the shape curves from `core.shapes`, which is
  also what fills the shape dropdown. Add a curve in `core.js` only; the list,
  the dropdown and the CLI output all follow from that one array.
  `core.channels` is the third of these lists: the overlay ramps, with the
  empty-key entry first so "no overlay" is always the default selection. The
  channel dropdown, the `c` cycle and the smoke overlay loop all read that one
  array — add a ramp there, never in `app.js`.
  `core.phrases` is the fourth: the hand-picked seed phrases. `PRESETS` in
  `app.js` is that array, the `p` key walks it, `cli.js --phrases` prints it and
  the smoke suite renders every entry, so a phrase is only worth adding if it
  produces a non-degenerate world at the default grid.
  `core.lights` is the fifth: the four compass bearings the hillshade accepts.
  Each entry carries its own normalised vector, so `lightVector()` is the only
  lookup and the shade pass, the `from` dropdown, the `d` cycle and
  `cli --lights` all read that one array. A bearing is shading only — the smoke
  suite checks all four keep the biome counts identical while the checksum of
  each differs from the others.
  `core.grids` is the sixth: the column counts the grid dropdown pins, with the
  empty-key "auto" entry first so following the window stays the default. The
  `w` cycle, `cli --grids` and the smoke width loop read that array; every
  non-empty key must be usable as `generate({width})` unchanged, which is what
  makes a pinned count mean the same thing in the page and from a terminal.
  The sea-level rule in the relief chart also prints its value; set the chart
  font before `measureText` so the flip-to-fit test is accurate.
  The median mark prints its number in the same bottom strip, squeezed between
  the two corner labels: measure all three first and skip the median label when
  the strip cannot hold the whole row, rather than overlapping the corners.
  The decade ticks under the bars do not use a fixed ten-unit step: the step is
  the first of 5/10/20/25/50 that leaves at most ten marks over this world's own
  relief. A flat craton would otherwise get one tick, a tall fjord twenty.

Verify with:

1. `node tests/smoke.js`
2. open `index.html` in the integrated browser, move a slider, hover the map,
  hover a legend row, walk the cursor with the arrow keys, toggle `grain` and
  `lines`, click Reroll and Save PNG.
  Press `p` a few times: the seed box should walk the phrase list and wrap,
  then keep typing in the seed box to check the letter keys stay out of the way.
  The relief histogram at the bottom of the sidebar should follow the `sea` slider,
  and hovering one of its bars should print that bin's range inside the chart.
  Hovering the map highlights the hovered cell's bin in that same chart.
