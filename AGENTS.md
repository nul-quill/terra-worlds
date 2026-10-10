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
  Both tails of that sentence are conditions, not decorations: `N lakes` only
  when `counts.lake` is non-zero, `polar` only when `stats.ice` passes 0.02. The
  smoke suite checks each shape in both directions, so a sentence cannot grow a
  tail the stats do not support — nor lose one they do.
  The lake tail also inflects off its own number (`1 lake`, `6 lakes`), which is
  why the smoke suite checks both a one-basin and a many-basin world.
  Those labels must stay dense: every lake cell carries a number in
  1..`stats.lakeBasins`, every number in that range appears, and no dry cell
  carries one. The smoke suite checks all three, since the readout's
  denominator comes from the count and its numerator from the label.
  `recordSpill()` also pushes one compass point per basin into
  `result.basinSpill`, indexed by basin number minus one: the bearing from the
  fill's centroid to its spillway, printed by the hover readout as `drains E`.
  That array is the readout's only source for the pair, so its length must be
  exactly `stats.lakeBasins` and every entry one of the eight points — a short
  array prints `drains undefined` on the last lake, a long one shifts every
  bearing. The suite checks both halves on a one-basin and a crowded world.
  The bucket stays 45 degrees with the north offset: coarsen it and a whole set
  of points goes unused, so the suite walks every hand-picked world and asks
  that all eight points appear somewhere in that array.
  The spillway cell itself is marked in `result.spillway` (one cell per basin),
  which the readout prints as `outlet` and the river pass uses to keep a
  basin's catchment drawn even when accumulation alone would cut it off.
  The mark holds the basin's own number rather than a plain flag, so hovering
  the rim cell says `outlet of basin 2/4` — the outlet sits outside the fill and
  would otherwise be anonymous. Keep the array wide enough for that number.
  The three arrays are one-to-one: `stats.lakeBasins` marks, that many distinct
  numbers inside `result.spillway`, one bearing each. The suite counts all three
  on the most crowded world it keeps, so a shared rim cell — where the second
  fill overwrites the first label — shows up as a short count rather than as a
  sentence nobody hovers.
  The spillway search caps the rim at `seaLevel + 0.30` on the first pass, then
  retries without the cap — a terraced plateau stacks its rims high enough that
  the capped pass alone would leave a big basin with no outlet at all.
  The chosen cell is the lowest DRY neighbour on the whole rim, which is what
  lets a filled basin keep draining; the smoke suite re-derives that minimum
  from the height field, so a mark on a higher step or inside the fill fails.
  Both halves of that readout are one cell, so the suite also asks that no mark
  lands on a filled cell: a mark inside its own fill would print a depth and an
  outlet at once, and the carried catchment would stop at the water's edge.
  The flood fill marks cells in `queued` with the fill number at enqueue time,
  not at dequeue: without that a cell offered by two neighbours is pushed twice
  and overflows the one-slot-per-cell queue.
- The trunk/tributary split is a second quantile of the SAME accumulation field
  (`majorCut`), never a separate threshold. `riverMask` holds 1 or 2.
  The smoke suite re-derives that ordering: for every hand-picked phrase the
  lowest trunk catchment must sit at or above the highest tributary one, and no
  cell may carry a mask outside 0/1/2. A second field with its own threshold
  would let a thin headwater print as a trunk while its own mouth stayed thin.
- Hypsometric band count is derived from the relief above the shoreline
  (`contourBands`, clamped 6..20) and published in `stats`, so a flat craton
  does not turn into stripes. Keep it derived, not a fixed constant.
  The water gets its own count from the depth range (`basinBands`, clamped 3..12)
  drawn by the same `contour` switch. Both stay derived, never constants.
  The sidebar prints the pair on one `contours` row — `12 land / 7 basin` — and
  the smoke suite checks both halves: each field is in that row's own source and
  each is a key of the CLI record, so a terminal can reproduce the stripes under
  the sea as well as the ones on the highlands.
  The `rivers` row is a second pair of that kind — `19 tri / 4 trunk` — where the
  first number is `stats.rivers - stats.trunks` rather than a stored count. Keep
  the arithmetic in the row: `rivers` already counts every cell in the network,
  so a third field for tributaries would be one more number that can disagree
  with the other two. The suite re-derives the pair from `riverMask` (values 1
  and 2) and checks both halves reach the record.
  Because the cut is a quantile, the `rivers` slider is a keep-fraction: each
  step up widens the network on the same grid, never narrows it. The smoke suite
  walks the slider's own range and asks for a share that only rises (and stays
  under a fifth of the grid), which is what lets the `N% drained` figure in the
  sentence be read as the slider's effect without opening the page.
  `stats.median` is the middle of the sorted height field, published for the
  same reason: min/max alone cannot tell a plateau from a peaked plain. It is
  grid-size dependent like the band counts, so any assertion comparing it with
  the CLI record must generate the same grid in both places.
  The record keeps three decimals while the row prints out of a hundred, so the
  suite rounds each the same way and asks for one number across every phrase —
  a record a terminal cannot turn into the figure on screen is no substitute for
  a screenshot.
  `--hist` is that substitute: six rows of blocks over the record's own bins,
  with a ruler under them whose `|` sits on the sea column. The block is built
  from `core.histogram` at the sidebar's 240px width, so its column count is
  the record's `bins` and its tallest bar is the record's `peak` — the suite
  re-derives the sea column with `core.binOf` and compares all three. Keep the
  block out of the `--json` path: one line per world is what makes that form
  pipeable, and the four fields already cover it.
  The suite checks that with both flags at once, asking that every line of the
  combined form still be a whole JSON object rather than a bar block wedged
  between two records.
  The width behind that column count is one number as well —
  `TerraCore.histWidth` — read by the shell as the fallback before its canvas
  has a layout, and by the CLI which has no window at all. Two literals would
  let a text profile and the bars on screen disagree about how many columns a
  sidebar buys; the suite counts the lookup on both sides.
  Keep it the strip's measured width (the canvas inside a 250px column, so
  about 200) rather than the column's: the fallback is what a terminal assumes,
  and a figure the page never measures would print a different bar count than
  the one on screen.
  Because the count comes from that width rather than the world, two grids of
  different sizes print the same number of columns, so their profiles can be
  laid over each other. The suite checks that pair directly — a count that
  tracked the grid would make every block a different width.
  The caption under the ruler also carries the world's checksum, which is the
  only link a pasted block of bars has back to the picture it describes — a
  saved PNG keeps nothing but its name, and the checksum is in that name.
  Every other figure in that caption is a field of the JSON record as well:
  the two ends of the range are `low` and `high`, the column count is `bins`.
  The two marks on the ruler are named there too — `sea` and `median` — so a
  reader with a block of bars and one line of JSON can place both without the
  page. Keep every caption figure a record field: a number that exists only in
  the text is one a terminal cannot verify.
  The suite re-reads every one of those figures and compares, so a block of
  bars and a line of JSON cannot describe two different worlds.
  `sea` joins them: the ruler's `|` is the one mark a reader has to place by
  hand from a record, so the level itself is a field rather than something to
  infer from the `water` share. Like the other numbers it keeps three decimals
  and the caption rounds it out of a hundred.
  That check also reads the row's own source for the `hundred(` call, so the
  scaling cannot be dropped at the call site while the record keeps its three
  decimals: the two halves of the pair are compared, not just printed.
  The ruler carries two marks: `|` on the sea column and `:` on the column the
  median falls in, since a spread cannot tell a plateau from a peak squeezed
  between its own two ends. Both are the core's `binOf` over the same range, so
  the suite re-derives each and asks that the caption name both figures. Where
  the two columns coincide — a near-flat world whose middle sits on its own
  shoreline — the ruler prints one `+` rather than dropping a mark, and the
  suite walks every phrase asking for exactly one glyph per marked column.
  Above the ruler sit six rows of blocks, one threshold each, so the counts can
  only grow going down — an inverted level still prints a correct caption while
  showing the silhouette upside down. The suite checks that ramp, and that the
  column the record's `peak` describes is filled in every row. Growing totals
  alone are not enough — a lower row could drop one column and gain two
  elsewhere — so the suite also asks that every filled column stay filled in
  the rows beneath it, which is what a stack of thresholds actually looks like.
  The `relief` row carries the spread and its two ends — `70 units (10-80)` —
  where the pair in brackets is what the chart prints at its corners. The record
  keeps those ends as `low` and `high`, already out of a hundred, so a terminal
  can reproduce the corner labels from the JSON alone. The suite re-derives both
  from the height field and asks that the row's own source show both halves.
- Shading-only knobs (`hillshade`, `lightDir`, `dither`) must never move a biome
    boundary: classification happens before the colour pass. The smoke suite
    asserts that, so keep it that way. `contour` (hypsometric lines) belongs to
    this same group.
- Moisture is not a standalone field: the orographic pass in `generate` folds the
  relief into it, so ridges get a windward wet band and a leeward rain shadow.
  Keep it a per-row sweep — it is O(n) and must stay that way.
  The biome lookup is a two-axis table, so `temperature` is published beside
  `moisture` and the readout prints both — `moist 48 — temp 84` says which axis
  moved a cell, which a single colour cannot. The climate slider is the mix
  between the noise term and the latitude curve, so the smoke suite compares
  the middle-over-edge difference at `polar` 0 and 1: the noisy world has only
  a small gap, the polar one must show a wider one. A mean would pass either
  way, since the whole field cools together.
- Distance to the shoreline (`coastDistance`) comes from two chamfer sweeps
  (forward, then backward) over the grid: O(n), no queue. It both dries the
  continental interior in the biome lookup and feeds the hover readout. Do not
  replace it with a BFS from the coast.
  The BFS is still the oracle: the smoke suite walks the same field with a
  plain FIFO queue and compares every cell, so the sweeps cannot drift from it.
  The field itself is unclamped — the furthest cell grows with the grid, which
  the smoke suite checks between a small and a large world — while the biome
  drying reads it through a capped `min(12, dist) / 12`. Keep both: the cap is
  what stops a big grid from turning its whole interior into desert.
  The readout's `N from water` part prints on dry ground only, and it can rely
  on that because the sweeps seed at the shoreline: every water cell is already
  at zero, so the note's own threshold does the filtering and the dry/wet test
  only skips the repeat of the biome name. The suite checks that per cell, since
  a field that left a wet cell at a non-zero distance would quietly lose its
  reading from the hover.
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
  The smoke suite checks both halves of that: the filled cells stay visibly
  graded, and the published scale is the mask's own range rather than a
  percentile pair.
  That step count is one constant — `TerraCore.lakeSteps` — shared by the depth
  written into the mask, the overlay's scale and the `% deep` division in the
  hover readout. Keep it a lookup rather than repeating `60`: a shallow tarn
  tops out below the cap, so the suite asks that every filled cell sit inside
  1..the constant and that the published scale be that same number.
  `slope` is the one field built inside `fieldFor` rather than by `generate`:
  it is a difference of the height field, so it still cannot move a biome
  boundary, and it is cached on `result.slopeField` for the same reason the
  scale is — a hover reads the field once per cell.
  A key that is not in the ramp table falls back to `relief` rather than
  rendering nothing, so a hash saved against an older build still shows a map.
  The smoke suite walks every entry of `TerraCore.channels` and checks each
  ramp both spans a range and answers `channelValue` in 0..1.
- `stats.checksum` is FNV-1a over the rendered RGBA buffer, as eight hex digits.
  It is the cheap equality test for determinism: same seed + same grid must give
  the same digits, while `stats.ms` is allowed to wander. Keep the multiply in the
  shift-add form so it stays inside 32 bits.
  The relief word in `describe()` is a bucket of that same number — rugged above
  70, rolling above 40, plain below — and the smoke suite re-derives the bucket
  from `stats.max - stats.min` for every shape, so the word cannot drift away
  from the number printed next to it.
  The sentence also carries a drainage figure, as a share of the grid
  (`0.1% drained`) rather than a cell count: the count grows with the grid
  while the quantile cut holds the density steady, so a count would make one
  world look twice as wet in a wide window. It goes through
  `percentText()` like every other share, which is what lets the suite
  re-derive the string from `stats.rivers / stats.pixels`.
  The same string is rebuilt a second time from the CLI record — `rivers` over
  `width` x `height` — since a saved PNG keeps nothing but that JSON line, and
  a record that rounded on its own would describe a drier world than the one
  on screen.
  The stats list itself opens with the `seed` row, before `grid`: a print or a
  screenshot keeps no URL, so the phrase has to be readable off the page. The
  smoke suite reads the row labels out of `renderStats()` and checks that first
  pair plus that no label is reused — two rows with one name would make the
  list ambiguous to read back.
  Every height on the page is stored 0..1 and printed out of a hundred, through
  one helper — `hundred(value)` — shared by the `relief` and `median` rows, the
  chart's corner labels, the sea rule, the median mark, the hovered-bin range and
  the readout's elevation, moisture and ramp numbers. That is what makes
  `median 49` in the stats list and `median 49` under the bars one measurement
  rather than two roundings that happen to agree. Keep the scaling there rather
  than writing `Math.round(x * 100)` at a call site; the suite counts the
  definition, the uses and any leftover inline rounding.
  Shares of the grid go through `TerraCore.percentText(fraction)` — whole percent
  at or above ten, one decimal below, so a 2% class and a 0.2% class keep their
  order in the legend. The `land`, `water` and `ice` rows, the legend's right
  column and the CLI's `classes` pairs all use it, which is what lets a terminal
  read `seasonal=6.2%` and find `Seasonal forest 6.2%` on the page. The suite
  re-derives every pair in that column from the counts with the same helper, so a
  second rounding on either side shows up as a mismatch rather than as two
  plausible-looking numbers.
  The readout's `off-shelf` note and the core's `deep` class are the same depth
  below the sea line, so it is one constant — `TerraCore.deepDrop` — that the
  classification and the hover note both read. The suite asks for the definition,
  both uses and walks one world cell by cell, so a second literal in the shell is
  caught even when the two numbers happen to agree. A pair that drifted apart
  would print a note about a class the legend does not list.
- The CLI record in `summarise()` carries the parts of the state that the summary
  sentence cannot hold: `palette` and `channel` both change only pixels, so every
  count stays identical without them. Keep both in the record and keep the smoke
  assertions comparing one populated run against the plain one.
  `scale` joins them: it is the multiplier behind the saved file's dimensions,
  which is why the PNG assertion in the smoke suite can check the IHDR from the
  record alone. It reads `opts.scale > 1 ? opts.scale : 1`, so a plain render
  reports 1 rather than an empty string.
  Those fields are also everything the saved file's name is made of — seed,
  shape, palette, grid, factor, checksum — so the suite refills each slot from
  one record and asks that none come back empty, with the shape compared
  against the first word of `summary`. A name is the only trace a downloaded
  PNG keeps, and every token in it has to be recoverable from a line of JSON.
- `nextSeed(value)` derives the next seed from the current one (FNV-1a over the
  phrase plus a `\u0001` separator). The Reroll button and `cli.js --next n` both
  use it, so a click sequence is reproducible from the first phrase. Do not
  replace it with a plain `randomSeed()` call in the button.
  The suite walks twelve chained seeds and asks for twelve distinct checksums,
  so a derivation that collapsed onto a short cycle would be caught here rather
  than by someone clicking Reroll twice.
  `--next n` with `--json` prints one record per seed in the chain instead of
  the bare list of phrases, so a run of clicks can be compared from a terminal.
  Each record keeps its own `seed`, which is what ties a line of JSON back to
  the phrase the plain listing prints; the suite checks that pairing and asks
  for distinct checksums across the chain.
  Every branch of that chain builds its world through one `chainWorld(seed)`
  helper that copies the parsed options and swaps in the seed, so a flag added
  to the parser reaches the listing, the `--describe` sentences and the records
  at once rather than only the form someone happened to edit. `--hist` is
  honoured in those branches too: one profile block per seed, each caption
  ending in that seed's checksum, which is what lets a pasted block of bars be
  matched to its own line of JSON. The suite reads both forms and compares the
  two checksums per seed.
- `parseArgs()` in `cli.js` treats a bare word as a seed and a dashed word as a
  flag. A dashed word that matches nothing is named on stderr, and the word
  after it is skipped, so a mistyped `--widht 30` costs one warning instead of
  quietly rendering a second world from the number `30`. Keep that skip in the
  parser rather than filtering the seed list afterwards.
  Numeric flags read their value through `nextNum()`, which returns
  `undefined` for anything that does not parse. A raw `parseFloat` would hand
  the generator a `NaN`, where every comparison is false and the whole grid
  comes back as dry land; `undefined` lets the generator's own default stand.
  Keep the `argv[++i]` advance at the call site — moving it inside the helper
  reads each value twice and shifts every later flag by one.
  Key-valued flags (`--palette`, `--shape`, `--channel`, `--dir`) read theirs
  through `nextKey()`, which matches against the same array its dropdown is
  filled from and pushes a miss onto the one `unknown` list. Both kinds of typo
  — an unknown flag and an unknown value — share that single stderr note. The
  smoke suite feeds each advertised flag a value taken from its own list, so a
  warning there means the flag is missing rather than the sample being wrong.
  `--describe` prints the bare summary for one seed and prefixes each line with
  its seed when several are given, matching the `--next --describe` form, so a
  block of sentences is still traceable to its phrase.
  Both views of a world go through one `describe()` call — the sidebar takes the
  string from the record it just generated, the CLI from its own — so the suite
  compares the two for one seed and one grid. A field the CLI forgets to pass,
  or a phrase edited on one side only, shows up there as a difference rather
  than as two sentences that each look reasonable on their own.
  With several seeds, `--out` is a prefix: the suffix is built by stripping an
  optional extension and appending `-<n>.<ext>`. Strip with an anchored
  `/\.(ppm|png)$/` rather than an optional one — a prefix with no dot at all
  (`--out map`) must still get its numbers, or every world after the first
  overwrites the one before it and the call leaves a single file behind. The
  suite checks both a dotted and a bare prefix.
- Letter shortcuts (`c`, `h`, `k`, `d`, `w`, `e`, `g`, `l`, `m`, `p`, `s`) are skipped while an INPUT or
  (`x` joins that list: it is not a list cycle but a call to `copyLink()`, the
  same function the `Copy link` button is wired to, so the two paths cannot
  disagree about what lands on the clipboard. Keep that one function for both.)
  The button's own name is remembered in a `data-label` attribute the first
  time it is pressed, and the restore is one shared timer that each press
  clears before scheduling again — otherwise a second click inside the feedback
  window leaves the button reading `Copied` for good.
  SELECT owns the caret, so a seed phrase can still be typed. Each cycle key
  reads the same array its dropdown does — `TerraCore.channels` for `c`,
  `TerraCore.shapes` for `h`, `TerraCore.phrases` for `p`, `TerraCore.lights` for
  `d`, `TerraCore.grids` for `w`, `TerraCore.scales` for `e` — so a key and the
  select can never disagree about the order. Every cycle key also answers to
  `Shift`: one branch, a `±1` step, so a mis-press backs out instead of looping
  the whole list. Each letter answers in BOTH cases — `'c' || 'C'`, a
  `/^(d|D)$/` test, or the `toLowerCase()` lookup the two checkboxes share —
  because Caps Lock makes the browser report the uppercase form, and a shortcut
  that only answered to one of the two looks broken for reasons that have
  nothing to do with the map. The suite walks the letters the note names and
  asks each for one of those three shapes, so a new key cannot arrive with a
  single-case comparison. `styles.css` ends with two
  `@media` blocks: `print` (hides the chrome, one column) and
  `prefers-color-scheme: dark` (only the CSS variables change). Both are checked
  with `page.emulateMedia()` followed by a reload.
  The dark block only works by replacing every variable in `:root`, so the suite
  compares the two name lists: a variable declared once and never restated keeps
  its light value under a dark background, which is the one way this scheme can
  go wrong. A new colour has to appear on both sides.
  The legend's hover tint is the one colour written as a hue plus its own alpha,
  so it lives in `--accent-soft` and the hover rule reads that lookup rather than
  a literal rgba — that is what lets the dark block raise both halves at once.
  The suite asks for the lookup in the rule and for exactly two declarations,
  one per scheme.
  The tint alone is too faint to follow as a tab stop on a ten-row list, so
  `:focus-visible` also draws the inset ring a pinned row wears — both halves
  from `--accent`, so neither scheme needs a third colour for the caret.
  The print block is checked by the names it hides: the controls, the chart and
  the key note are chrome, the legend, the stats list, the summary sentence and
  the canvas are the content. A printed page that lost the stats list would keep
  the picture and throw away every number behind it, so the suite asks for those
  four to sit outside the `display: none` rules.
  - The URL hash is written by `writeHash()` only, and every pair in it comes from
    a form control in `HASH_KEYS` plus two extras that are not controls: `pin=` for
    the clicked legend class and `at=x,y` for the hovered cell. Both pointer paths
    and `hoverCell()` call `writeHash()` after painting, so the link always matches
    what the readout shows. `applyHash()` stores `at` in `atCell` and `render()`
    replays it through `hoverCell()` when no pointer hover is active — that is the
    only writer of the pair, so keep the clamp inside `hoverCell()` rather than
    trimming the indices at parse time.
    `currentCell()` — the reader that builds the `at=` pair — clamps the same
    way, so a pointer resting above or right of the canvas cannot write
    `at=48,-159` while the readout prints `(48, 0)`. Both the clamp and the
    wrap live in those two functions, never in `applyHash()`.
    The arrow handler wraps its own pair before calling `hoverCell()`, so a walk
    in one direction keeps sweeping instead of sticking on the last column; the
    clamp in `hoverCell()` still handles a hash-restored index outside a smaller
    grid.
    A dropdown only takes a value its own list offers: `applyHash()` checks
    `hasOption()` before assigning, so a link saved against a key that has since
    been dropped keeps the current default instead of leaving the select blank.
    Keep the check in `applyHash()` — the lists are filled before it runs.
    The two checkboxes are the only pair whose two halves differ: the writer
    stores `checked ? 1 : 0` and the reader compares against `'1'`, since a bare
    `false` in a URL would read as a value rather than as a tick. The suite
    counts one of each, so the encoding cannot be changed on one side only.
  Every INPUT or SELECT id in `index.html` is a key of `HASH_KEYS`, and every
  key there names a real control: the smoke suite compares the two lists, so a
  new dropdown cannot arrive without also surviving a shared link.
  The same suite compares the key set with the note under the chart, which is
  the only place the shortcuts are written down: a new letter has to appear
  there as its own token, not merely be handled.
  Each control also gets its spoken name from the LABEL wrapping it, so a new
  dropdown needs a caption there rather than an `aria-label`. The three things
  that are not labels — both canvases and the hover readout — carry their own
  attribute instead, and the suite walks those three by id. A control added
  without its caption shows up as a caption count below the control count.
  Those two extras are checked on their own, since they sit outside the
  `HASH_KEYS` loop: each has exactly one `parts.push()` in `writeHash()` and at
  least one `fromUrl.` read in `applyHash()`. A pair that only went out would
  still look right in the address bar while the reopened link lost the pin or
  the cell it promised.
  Every colour painted on the map canvas comes from the palette in use — the
  isolation blend, the crosshair and the magnifier panel in `drawInset()` all
  read `palette.sky` and the biome triples. A fixed ink would read as a bright
  slab under a dark scheme, so the suite walks the `ctx` assignments and asks
  for none of them to be a literal string. The relief chart keeps its own fixed
  ink: it sits on the page, not on the map.
- Legend isolation lives in `drawMap()`: `solo` follows the pointer/focus,
  `pinned` is the click selection and survives a reroll. Both blend non-matching
  cells toward the palette sky in that one loop — do not add a second blend
  path, or hover and click will disagree about the result.
  A hovered relief-chart bar (`band`, a bin index) is the third filter in that
  same loop: it selects by height instead of by class, and a legend selection
  wins over it. Like `solo` it is a preview and never goes into the hash; both
  are cleared when the pointer leaves the map.
  Every site that clears `solo` repaints through `drawHover()`, never a bare
  `drawMap()`: the grid pass alone drops the crosshair on the cell picked out of
  the hash, so a hover over the legend list would erase a mark the link promised.
  The smoke suite counts the clear sites and asks each one for that repaint.
  The chart reads the same three filters in `paintHistogram()`: a hovered bin
  dims the other bars, a legend selection dims the bins with none of that class.
  `drawMap()` calls `paintHistogram()` so one repaint keeps both views in step —
  do not repaint the chart from the individual handlers.
  `hoverHistogram()` is shared by `mousemove` and a touch `pointerdown`, so a tap
  on the chart selects a bin the same way a cursor does. Keep the one function.
  The touch call passes a second argument so tapping the bar that is already
  selected clears it: a finger has no hover-out, and without that second tap a
  phone would never get the full map back. The mouse path keeps the plain rule.
  Shift+arrows walk the same bin through `stepBand()`, which is the keyboard
  path for the height filter; plain arrows still walk cells. Both are previews —
  neither goes into the hash.
  `stepBand()` wraps its bin with the same modulo the cell walk uses, so one
  direction keeps sweeping the height range instead of sticking on the last bar.
  Turning a height into a bin index is `binIndex(h, lo, span, bins)` and it is
  the only place the clamp to the last bar lives: the binning pass, the
  legend-members pass, the hovered-bin tally and `histBinFor()` all go through
  it, so the bar lit under a cursor is always the bar that counted the cell.
  The clamp itself sits one level down, in `TerraCore.binOf`, which the shell's
  lookup only forwards to — the same reason `tickStep` and `binCount` live in
  the core. Beside it is `TerraCore.histogram(result, bins)`, the whole binning
  pass: it returns `{bins, hist, peak, lo, span}` over the world's own min/max,
  and `drawHistogram()` keeps only the pixel geometry on top of that. The CLI
  record reads its `bins` and `peak` from the same call at the sidebar's 240px
  width, so a terminal can redraw the silhouette from JSON alone; the suite
  counts one definition, one call from the shell, and asks that the bars sum to
  `stats.pixels` and match the record on one world.
  The hovered cell's own bin is held in `cellBand` — a reading, not a filter.
  `updateReadout()` writes it once from `histBinFor()`, prints it as
  `band 38/72` in the readout, and hands it to the chart; `drawMap()` lights
  that bar through `band >= 0 ? band : cellBand`, which is what keeps the
  highlight alive across the repaint a hover triggers. A picked bar (`band`)
  still wins over it. Both are cleared when the pointer leaves, and neither
  goes into the hash — the link carries the cell, and the bin follows from it.
  That label is a measurement rather than a position in a list, so both ends of
  That label is a measurement rather than a position in a list, so both ends of
  the bin's height range go beside it — `band 45/72 (53-54)` — built from the
  range the chart was binned over. That arithmetic lives in one lookup,
  `bandSummary(bin)`, which the chart's hovered-bin caption, the hovered-cell
  note and the selected-band line all call: three callers, two ends, and the
  suite counts both so a bin cannot round against one scale in one view and
  another in the second.
  A bin picked on the chart is a filter over the whole grid, so `bandNote()`
  writes the same reading into the line under the map — `band 40/72 (48-49) —
  485 cells — Deep water` — where the count is big enough to read. Every path
  that moves the selection calls it (chart hover, tap, `Shift`+arrow walk, and
  either pointer leaving), and with no selection the same function restores the
  `hover the map` placeholder, which is why that literal appears once. The suite
  counts every one of those sites and the one placeholder.
  A legend pin is a filter change too, so all three of its sites — the click,
  the row's own `Enter`/`Space`, and the `k` cycle — call the same writer after
  `writeHash()`. Otherwise the line keeps describing a height band over a map
  that is now filtered by class, and the next pointer move is what fixes it: a
  link copied in between would show the wrong pair of numbers.
  A hovered or focused row is the same kind of change — `solo` is the first half
  of the note's precedence — so `drawHighlighted()` and both clear handlers call
  the writer too. That is why the count of call sites is eleven rather than the
  four the chart paths alone would give: a row that faded the map without
  renaming itself in the line would leave the two halves of one filter saying
  different things until something else repainted.
  A rebuild is a filter change as well, so `render()` calls the writer before it
  replays a hovered cell: a new grid moves every share in the legend, and a line
  that kept the old counts would describe the world that was just thrown away.
  It goes before the hover restore so a cell reading still wins the line.
  That line also has to agree with the blit about which filter is in charge. A
  pinned legend class wins over a picked band — `solo || pinned` in both places —
  so the note reads `Deep water pinned — 65%` while a bar is also hovered, which
  is what the map looks like: every class faded except the pinned one. Reading
  the band there would describe a set of cells the blit no longer shows. The
  suite pulls the note's own body out of the shell and asks both halves for that
  one expression, so the precedence cannot be dropped on one side only.
  Exactly three places read that pair — the blit, the bars and the note — and
  the suite counts all three, so a fourth opinion about which filter wins has
  to be added there as well as in the shell.
  The word beside the class is gated on the same pair: only a clicked row is
  called `pinned`, a hovered one just prints its name and share, since a preview
  is gone on the next mouse-move. The suite reads that gate out of the note's
  body, so a hovered row cannot quietly claim a state it does not keep.
    Because a picked bar dims every cell outside its range, the hovered-cell
    reading also says which side of the selection the cell falls on — `not in
    22/72 (30-31)` beside a washed-out cell. Only the mismatch costs a word:
    when the cell's own bin and the picked one agree, the label the cell already
    printed is the answer, so the note is gated on that comparison rather than
    printing the same pair twice and pushing moisture off the end of the line.
    The note is the fourth caller of `bandSummary()`: it reads the SELECTED bin
    rather than the cell's own, so it cannot reuse the range already there. The
    suite counts the four callers and the gate behind the note.
  The magnifier in `drawInset()` is the one overlay that covers map rather than
  tinting it, so `m` drops it: `insetOn` gates the call in `drawHover()` and
  nothing else. Like `solo` and `band` it is a view setting and stays out of
  the hash — a shared link should reopen with the panel drawn.
  The patch is a dozen cells wide, so it also marks the hovered cell inside
  itself: the offset is the difference of the two clamped indices times the
  patch's own cell size, which is why a mark at a fixed offset would sit on the
  wrong cell everywhere but one. The suite counts both halves of that pair.
  Rows carry `data-key` so a keyboard toggle can hand the caret back after the
  list is rebuilt, and the row's own `keydown` stops propagation: `Space` is
  also the reroll shortcut and must not fire twice.
  The row order comes from `legendKeys(result)` — classes present on this world,
  biggest first. The `k` cycle walks that same array, so the key follows the
  order on screen instead of the order the palette declares. Like the click it
  pins, so it writes the hash; unlike `solo` and `band` it is not a preview.
  The suite re-derives that order from `stats.counts` and asks that it differs
  from the palette's own declaration for at least one world, so the sort cannot
  be dropped without the list losing its biggest-class-first reading.
  `stats.counts` is the partition behind those rows: every cell lands in exactly
  one class, so the counts sum to `stats.pixels` and no listed class is empty.
  The smoke suite checks that on every hand-picked phrase, along with the
  sentence's `mostly X` naming the same biggest class the first row does.
  That one partition is also the `biomes` row, the rows of the legend and the
  `classes` column of the CLI record, so the suite counts all three on one world
  and asks for the same number: a class counted but not drawn would drop a row
  off the legend while the stats still said it was there, and the swatch keeps a
  palette-derived fallback for exactly that case.
  A row's label comes from `biomeNames` with the raw key as its fallback, so the
  two key sets have to be identical in every scheme: a colour key with no name
  would print as `taiga`, a name with no colour could never be drawn. The suite
  compares both directions for each entry of `core.palettes`, so a scheme that
  renames one key in its own table is caught even when the default scheme is
  fine — the legend of that scheme alone would read differently.
  `Shift+k` walks the same array backwards, which is why the cycle is a
  `(ki + step + slots) % slots` step rather than a plain increment: a mis-press
  should not need a whole lap to undo. Keep the one branch handling both
  directions. The ring has one slot MORE than there are rows — `slots` is
  `rows.length + 1`, and an index past the last row reads as `null` — because
  the comment over the handler promises a lap comes back through "nothing
  pinned", which is only true if the empty state is itself a stop on the ring.
  With `rows.length` slots a lap landed on the first class again and the cleared
  state was reachable just once, before anything had been pinned. The smoke
  suite walks one whole lap and asks that every class appear exactly once, that
  the empty state appear once, and that the lap end where it started.
- `cli.js --palettes` lists the palette keys from `core.palettes`, so a name
  copied from the terminal is always valid for `--palette`. The smoke suite
  compares that listing against `Object.keys(core.palettes)` — keep both in step.
  Each entry is a `label`, a `sky` written as a CSS hex string, and one rgb
  triple per biome key. The shade pass mixes those triples into a pixel without
  clamping, so they stay whole numbers in 0..255; the smoke suite checks both
  the triples and the sky string, since the sky is also the isolation blend
  target in `drawMap()`.
  Each scheme must also earn its slot: the suite renders one seed through every
  palette and asks for a different checksum each time while every count in
  `stats` stays put — that is the pair that says a palette is a recolour and
  not a second classification path.
  `--shapes` does the same job for the shape curves from `core.shapes`, which is
  also what fills the shape dropdown. Add a curve in `core.js` only; the list,
  the dropdown and the CLI output all follow from that one array.
  The `--help` usage line builds its `[--shape a|b|c]` list from the same array
  rather than repeating the keys, and the smoke suite checks every key appears
  in that listing.
  The listing covers the other lists too — palette, overlay, light, grid and
  export keys are each echoed by name — so one `--help` is enough to choose any
  value, and the suite walks all five arrays against that output.
  Reachability goes both ways. The suite reads the flag names out of the
  parser's own comparisons in `cli.js` and asks that each one appears in that
  text, so a flag added to the parser without a line in `--help` is caught
  there rather than staying unknown. `--help` itself is in the listing, since
  the note is where a terminal looks for the rest.
  The same reachability rule holds in the page: the note advertises `1-9` for the
  palette digits, so the suite compares that span with the length of
  `core.palettes`. A tenth scheme has to widen the note rather than sit beyond the
  last digit, which is why the count and the span are checked together.
  The six `--listings` themselves are checked too: every line must carry a
  note beside its key, since a terminal has no dropdown label to explain it.
  Each curve must also be its own picture: the suite renders one seed through
  every entry and compares the checksums, so a new curve that only re-skims an
  existing one loses its slot in the `h` cycle rather than diluting it.
  `core.channels` is the third of these lists: the overlay ramps, with the
  empty-key entry first so "no overlay" is always the default selection. The
  channel dropdown, the `c` cycle and the smoke overlay loop all read that one
  array — add a ramp there, never in `app.js`.
  `core.phrases` is the fourth: the hand-picked seed phrases. `PRESETS` in
  `app.js` is that array, the `p` key walks it, `cli.js --phrases` prints it and
  the smoke suite renders every entry, so a phrase is only worth adding if it
  produces a non-degenerate world at the default grid.
  Two more things the suite holds each entry to: its checksum must differ from
  every other phrase at one grid, and its land share must stay in the middle
  band, so the cycle never spends a slot on a near-copy or an all-water world.
  `core.lights` is the fifth: the four compass bearings the hillshade accepts.
  Each entry carries its own normalised vector, so `lightVector()` is the only
  lookup and the shade pass, the `from` dropdown, the `d` cycle and
  `cli --lights` all read that one array. A bearing is shading only — the smoke
  suite checks all four keep the biome counts identical while the checksum of
  each differs from the others.
  The smoke suite also checks each vector's length, since the shade pass mixes
  it into a height without renormalising: a long one washes the relief out, a
  short one flattens it.
  `core.grids` is the sixth: the column counts the grid dropdown pins, with the
  empty-key "auto" entry first so following the window stays the default. The
  `w` cycle, `cli --grids` and the smoke width loop read that array; every
  non-empty key must be usable as `generate({width})` unchanged, which is what
  makes a pinned count mean the same thing in the page and from a terminal.
  `core.scales` is the seventh: the nearest-neighbour multipliers the export
  dropdown offers. The `e` cycle, `cli --scales` and the smoke upscale loop read
  that array. A multiplier enlarges only the saved pixels, so every count in
  `stats` is the same at 2x as at 6x — that is what makes it safe to change
  while comparing two worlds.
  `upscale()` replicates each cell as a solid f x f block rather than blending
  it, which is what keeps a 6x save the same picture as a 2x one; the smoke
  suite checks that block-for-block on a small grid.
  The same list is checked from a terminal too: each multiplier must report
  itself in the JSON record while the checksum and the river count stay put,
  which is what lets the `export` row change size without changing a number.
  Both writers are held to one picture as well: the suite inflates the PNG's
  data stream and compares its rows against the PPM body of the same seed, so
  a stray filter byte or a truncated stream is caught rather than showing up
  as a right-sized, wrong-looking file. Keep the two encoders reading the same
  buffer — that comparison skips the PPM header's three tokens by counting
  them, not by counting newlines.
  Because it moves no count, the multiplier is shown in its own `export` row
  right under `grid`: the factor plus the pixel size it saves at. Both the row
  and `savePng()` read it through `exportFactor()`, so the number on screen is
  always the number that was written.
  The factor also goes into the saved filename, between the grid size and the
  checksum: the checksum is computed on the unscaled buffer, so a 2x and a 6x
  save of one world otherwise share every other field of the name.
  `[` and `]` are not a list cycle: they nudge the sea slider by one step,
  reading `min`/`max`/`step` off the input itself so the key and the slider
  cannot disagree about the size of a step. Keep the clamp there rather than
  hard-coding the range in the handler.
  The number the slider starts on is written three times — the generator's
  `seaLevel == null` fallback, the value the shell assigns on first load, and the
  `min`/`max` span in the markup — so the suite reads all three and asks that the
  two defaults be equal and sit inside that span. A first default outside the
  span would be clamped by the browser before the first render, which is one way
  a link and a fresh page could draw different worlds from the same phrase.
  The same three-way read runs over every range slider, each one's core fallback
  scraped from `src/core.js` rather than repeated here, so a new slider is
  covered by the rule the moment it gets a `== null` default. Compare the pair as
  numbers: `0.7` in the core and `'0.70'` in the shell are one value, and a text
  comparison would report a mismatch that no rendering can show.
  The sea-level rule in the relief chart also prints its value; set the chart
  font before `measureText` so the flip-to-fit test is accurate.
  That rule is also the wet/dry split of the bars, so it has to agree with the
  counted `water` share: the suite walks each phrase at three sea levels and
  asks that both figures rise together and land in the same neighbourhood. A
  second source for the rule — the median, or a fixed pixel — would read against
  the `water` row sitting right beside the chart.
  The median mark prints its number in the same bottom strip, squeezed between
  the two corner labels: measure all three first and skip the median label when
  the strip cannot hold the whole row, rather than overlapping the corners.
  The decade ticks under the bars do not use a fixed ten-unit step: the step is
  the first of 5/10/20/25/50 that leaves at most ten marks over this world's own
  relief. A flat craton would otherwise get one tick, a tall fjord twenty.
  The candidate list and that rule live in `core.tickStep(units)`, which the
  chart calls through `TerraCore.tickStep` and the smoke suite walks over every
  shape — one formula for "readable by eye", so a chart cannot quietly drift to
  a spacing the tests never saw. Keep the helper in the core; the shell only
  reads it.
  The number of bars follows the same rule through `core.binCount(cssWidth)`:
  one bar per five CSS pixels, clamped 20..72. The clamp ends are part of the
  contract, not decoration — the suite asks that a narrow strip reaches the
  floor and a wide one the ceiling, so a band that never engages is caught
  rather than mistaken for a formula. Keep the count out of the shell too.
  The one handler that fires without being asked is `resize`: dragging a window
  edge fires one event per pixel, and each would rebuild the grid. The listener
  schedules a single `render()` through `requestAnimationFrame` behind a
  `pendingResize` flag, cleared inside the callback so a burst collapses to one
  rebuild — the last size in the burst is the only one that matters, since the
  world depends on the seed and not on the window. Keep the flag reset inside
  the callback; resetting it before scheduling would let every event in the
  burst queue its own render again.

Verify with:

1. `node tests/smoke.js`
2. open `index.html` in the integrated browser, move a slider, hover the map,
  hover a legend row, walk the cursor with the arrow keys, toggle `grain` and
  `lines`, click Reroll and Save PNG.
  Press `p` a few times: the seed box should walk the phrase list and wrap,
  then keep typing in the seed box to check the letter keys stay out of the way.
  Press `c`, `h`, `d`, `w` and `k` too — each should move the dropdown or pin it
  is named for, and `Shift` with any of them should back one step up. `e` walks
  the export size, which changes only the saved pixels — the `export` row under
  `grid` should follow it while every other count stays put. Walk off
  the right-hand edge with the arrows: the cursor should come back on the left.
  `[` and `]` should move the `sea` slider by one hundredth, and `x` should
  briefly read `Copied` on the button.
  The relief histogram at the bottom of the sidebar should follow the `sea` slider,
  and hovering one of its bars should print that bin's range inside the chart.
  Hovering the map highlights the hovered cell's bin in that same chart.
