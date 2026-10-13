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
  Those ring minima come from two separable passes — rows, then columns — and
  both take their window from one `windowSpan(pos, count)`, since each is only
  the rim's radius held inside its own axis. Written beside each loop the pair of
  bounds could be edited apart, which lets a row window reach one cell past its
  edge while its own column window stopped short — still a plausible shore, so
  the suite counts the definition, its two reads, the single bound inside it and
  asks for no second clamped window left in either filter.
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
  Both reads of that array go through one `spillBearing(no)`, which applies the
  minus-one index for its two callers — a filled cell and its outlet. Written at
  each site the offset could be dropped on one branch only, which would print a
  neighbouring lake's bearing beside this lake's number, so the suite counts the
  definition, the two reads and the single `- 1` inside it.
  The pair `basin 2/4` is one builder too — `basinTally(no)` — since the
  denominator is always `stats.lakeBasins` and only the numerator differs
  between a filled cell and its outlet. Two copies could pad that pair
  differently while each still looked right beside its own caption, so the suite
  counts the definition, the two reads and the one denominator.
  The bucket stays 45 degrees with the north offset: coarsen it and a whole set
  of points goes unused, so the suite walks every hand-picked world and asks
  that all eight points appear somewhere in that array.
  The spillway cell itself is marked in `result.spillway` (one cell per basin),
  which the readout prints as `outlet` and the river pass uses to keep a
  basin's catchment drawn even when accumulation alone would cut it off.
  That last clause is load-bearing: the pass tests each cell against a
  quantile, and a tarn on a wide plain fills a rim cell whose own count sits
  well below the cut, so without the mark the lake would print as a puddle with
  no way out. The suite counts the still-dry outlets of a one-basin and a
  crowded world and asks that each carries a mask. An outlet a later fill
  swallows is excluded — by then it is water, and water is skipped on purpose.
  The mark holds the basin's own number rather than a plain flag, so hovering
  the rim cell says `outlet of basin 2/4` — the outlet sits outside the fill and
  would otherwise be anonymous. Keep the array wide enough for that number.
  That cell IS the way out, so it prints the bearing too — `drains W` beside
  its number, from the same `basinSpill` lookup the filled cells use. Both
  halves of that readout come from one cell, so the suite reads the outlet
  branch out of the shell and asks that it names both.
  Both branches index that array the same way — the basin's own number minus
  one — and the suite counts those lookups, so a third offset has to be written
  down here rather than quietly printed on one side only.
  That number has to match one worn by a neighbouring filled cell, and the suite
  walks that pair on both a one-basin world and a crowded one: a lone tarn
  cannot show a shared rim cell overwriting its own label.
  The three arrays are one-to-one: `stats.lakeBasins` marks, that many distinct
  numbers inside `result.spillway`, one bearing each. The suite counts all three
  on the most crowded world it keeps, so a shared rim cell — where the second
  fill overwrites the first label — shows up as a short count rather than as a
  sentence nobody hovers.
  The spillway search caps the rim at `seaLevel + 0.30` on the first pass, then
  retries without the cap — a terraced plateau stacks its rims high enough that
  the capped pass alone would leave a big basin with no outlet at all.
  Both passes walk that ring through one `sweepRim(count, cap)`, since the
  retry is only a fair second opinion while it visits the same neighbours in the
  same order. Written as two loops the capped sweep could gain a direction the
  retry lacks, which leaves a basin whose outlet sits on a rim cell its own
  second pass would never have chosen — still a plausible shore, so the suite
  counts the definition, its two reads, the four neighbour steps inside it and
  asks for one ring loop.
  The chosen cell is the lowest DRY neighbour on the whole rim, which is what
  lets a filled basin keep draining; the smoke suite re-derives that minimum
  from the height field, so a mark on a higher step or inside the fill fails.
  That same cell is the cap of the fill: every labelled cell sits at or below
  its own outlet, which the suite re-checks per phrase by reading the outlet's
  height back out of the marks. A fill allowed to climb past its spillway would
  print a depth for water its own note says has already left.
  The suite also asks that no mark lands on a filled cell: a mark inside its own
  fill would print a depth and an outlet at once, and the carried catchment
  would stop at the water's edge.
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
  Both are that derivation through one `bandCount(spread, mult, floor, cap)`,
  since a band count is only ever a multiple of a spread held between two bounds.
  Written beside each count the clamp could be dropped on one of them, which lets
  a flat craton grow stripes above its shoreline while its own basins stayed in
  three wide steps — still plausible bands, so the suite counts the definition,
  its two reads, the single clamp inside it and asks for no second copy of either
  bound left beside them.
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
  Both halves of that row are walked over the same range, since `majorCut` is a
  second quantile of the SAME field: a trunk share that could fall while the
  total rose would mean the two cuts had drifted apart into independent
  thresholds, and the row would read as more water drawn with less of it a
  main channel. The suite asks for a monotone pair plus the subset relation the
  row already implies (trunks never exceed the whole network).
  `stats.median` is the middle of the sorted height field, published for the
  same reason: min/max alone cannot tell a plateau from a peaked plain. It is
  grid-size dependent like the band counts, so any assertion comparing it with
  the CLI record must generate the same grid in both places.
  The record keeps three decimals while the row prints out of a hundred, so the
  suite rounds each the same way and asks for one number across every phrase —
  a record a terminal cannot turn into the figure on screen is no substitute for
  a screenshot.
  That finer rounding is one helper in the parser — `three(value)` — read by
  every share the record stores (`land`, `water`, `median`, `sea`, `lake`,
  `ice`), since six inline expressions could be edited apart while each still
  looked reasonable on its own. A `land` kept finer than an `ice` would leave a
  terminal adding two figures that never summed to the grid. The suite counts
  the one definition, the fields that read it and any leftover inline triple.
  That division is the core's (`TerraCore.three`) rather than the parser's own,
  for the reason the out-of-a-hundred scaling is: a reader holding one line of
  JSON applies it when it checks a share against the grid, so the parser
  forwards and the suite counts the definition, the forward, the fields and any
  bare triple left behind.
  `--hist` is that substitute: six rows of blocks over the record's own bins,
  with a ruler under them whose `|` sits on the sea column. The block is built
  from `core.histogram` at the sidebar's 240px width, so its column count is
  the record's `bins` and its tallest bar is the record's `peak` — the suite
  re-derives the sea column with `core.binOf` and compares all three. Keep the
  block out of the `--json` path: one line per world is what makes that form
  pipeable, and the four fields already cover it.
  Those three only fix the frame of the silhouette, not its weight, so the
  record keeps the whole bar array too — `hist`, the same `core.histogram` pass
  at the same width. That is what lets a pasted block of bars be checked
  against one line of JSON: the suite sums the array against `stats.pixels`,
  asks for one entry per `bins`, and compares it with a fresh pass. A record
  with only the count and the tallest bar could describe a plateau or a peak.
  The suite checks that with both flags at once, asking that every line of the
  combined form still be a whole JSON object rather than a bar block wedged
  between two records.
  The width behind that column count is one number as well —
  `TerraCore.histWidth` — read by the shell as the fallback before its canvas
  has a layout, and by the CLI which has no window at all. Two literals would
  let a text profile and the bars on screen disagree about how many columns a
  sidebar buys; the suite counts the lookup on both sides.
  Inside the CLI that pair of lookups is one helper — `histPass(result)` — read
  by the writer of the bar block and by the record beneath it, since the two
  must describe one pass: a width edited on one side only would print a
  silhouette too wide for the `bins` its own caption names, which still looks
  like a plausible chart. The suite counts the definition, its two reads and
  the single nested pair inside it.
  Keep it the strip's measured width (the canvas inside a 250px column, so
  about 200) rather than the column's: the fallback is what a terminal assumes,
  and a figure the page never measures would print a different bar count than
  the one on screen.
  Because the count comes from that width rather than the world, two grids of
  different sizes print the same number of columns, so their profiles can be
  laid over each other. The suite checks that pair directly — a count that
  tracked the grid would make every block a different width.
  The strip's height is one published number too — `TerraCore.histHeight` —
  because three places size that box: the canvas attribute, the `#hist` rule in
  the sheet, and the shell's fallback for the frames before the canvas has a
  measurement. Three literals would be three boxes, and a chart drawn for one
  height while clipped by another still looks plausible at a glance. The suite
  reads the core's figure and compares the attribute and the rule with it, so a
  new height has to be written once and the other two follow.
  The caption under the ruler also carries the world's checksum, which is the
  only link a pasted block of bars has back to the picture it describes — a
  saved PNG keeps nothing but its name, and the checksum is in that name.
  Inside that box the bottom strip is one reserve too — `STRIP`, twelve CSS
  pixels — because four marks are measured from it: the bars stop at its top
  edge, the decade ticks hang below that down to `TICK`, the median mark
  runs from the edge down through the strip. Bare literals would let a taller
  strip grow the bars while the marks stayed put, which reads as a label
  sitting on a bar, so every offset is written relative to the one number and
  the suite asks for no bare pixel offset left beside it.
  That median mark is the one mark in the strip taller than a tick, and its own
  depth is a number beside it — `MARK` — since the two hang from the same edge
  and only differ in how far down they reach. Written as a bare offset the pair
  could be edited apart, which leaves a median standing no taller than its
  neighbours while its label still reads as the important one, so the suite
  counts that depth the same way it counts the tick's.
  Every other figure in that caption is a field of the JSON record as well:
  the two ends of the range are `low` and `high`, the column count is `bins`.
  The two marks on the ruler are named there too — `sea` and `median` — so a
  reader with a block of bars and one line of JSON can place both without the
  page. Keep every caption figure a record field: a number that exists only in
  the text is one a terminal cannot verify.
  `peak` is the last of those: it is the divisor every row of the block is
  drawn against, so without it a pasted block says nothing about how tall a
  full column is and cannot be redrawn at all. The suite compares the caption's
  figure with the record's on every phrase, which is what keeps the block's
  height tied to the counts rather than to the width it was printed at.
  The suite re-reads every one of those figures and compares, so a block of
  bars and a line of JSON cannot describe two different worlds.
  That comparison is a pair of renders per phrase rather than one, since the
  two forms round differently: the record keeps `sea` and `median` to three
  decimals and the caption prints both out of a hundred, so the only fair test
  is the caption's own rounding applied to the record's field. One world would
  also hide the case where the two ruler marks land in the same column — that
  `+` only appears on a near-flat seed, and a phrase list is where to find one.
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
  Both columns are record fields too — `seaCol` and `medCol`, from the same
  `binOf` the ruler is drawn with — because the caption rounds every figure out
  of a hundred and a rounded end of the range can slide a mark by one column.
  The suite reads a ruler and a record for one world and asks that the glyph
  counts match: one `+` when the two columns coincide, otherwise a `|` and a
  `:` at the two numbers the record names.
  That pair is one lookup too — `rulerMarks(result, h)` — read by the ruler and
  by both fields of the record, since two divisions could be cut over two
  ranges while each still landed inside its own box. The suite counts the
  definition, its three reads and the one sea-level division inside it.
  The same pair is checked on every seed of a `--next` chain, since the chain
  builds its worlds through its own helper: a ruler drawn from the first
  world's columns would still sit under a caption naming that seed's own two
  figures, so the mismatch is only visible when each block is compared with its
  own record.
  Above the ruler sit `TerraCore.histRows` rows of blocks — one constant beside
  `histWidth`, read by the writer rather than restated in it — one threshold
  each, so the counts can only grow going down — an inverted level still prints
  a correct caption while showing the silhouette upside down. The suite checks
  that ramp, and that the
  column the record's `peak` describes is filled in every row. Growing totals
  alone are not enough — a lower row could drop one column and gain two
  elsewhere — so the suite also asks that every filled column stay filled in
  the rows beneath it, which is what a stack of thresholds actually looks like.
  That row count is a published number for the same reason the width is: a
  reader holding a pasted block and one line of JSON has to be able to ask
  whether the block is complete, so the suite compares the block's row count
  with the constant and asks that the writer hold no second copy of it.
  The count reaches that reader through the record's own `rows` field, which is
  the same lookup rather than a restated number: the block's rows are counted
  against it, so a profile that lost its last row in transit shows up as a
  short count beside the one line that names the height.
  Shape alone would still pass for the wrong world, so the suite re-derives
  each row from the record's own counts and compares the whole string: a column
  is filled when its count reaches that row's share of `peak`. That is what
  makes a pasted block of bars plus one line of JSON enough to redraw a picture.
  That rebuild runs over every hand-picked phrase rather than one world, since a
  block built from a fixed bin count — or from another seed's counts — still has
  the right ramp and a caption that reads correctly. Per phrase, the row count,
  the column count and every row string are compared against that seed's own
  `bins`, `hist` and `peak`. Note the block sits between the summary sentence
  and the ruler, so a reader of the raw output slices those two off first.
  The `relief` row carries the spread and its two ends — `70 units (10-80)` —
  where the pair in brackets is what the chart prints at its corners. The record
  keeps those ends as `low` and `high`, already out of a hundred, so a terminal
  can reproduce the corner labels from the JSON alone. The suite re-derives both
  from the height field and asks that the row's own source show both halves.
- Shading-only knobs (`hillshade`, `lightDir`, `dither`) must never move a biome
    boundary: classification happens before the colour pass. The smoke suite
    asserts that, so keep it that way. `contour` (hypsometric lines) belongs to
    this same group.
  The snow cap in that same colour pass is one level — `SNOW_LINE` — read by the
  branch that starts the fade and by the ramp that grows it. Written beside each
  half the pair could be edited apart, which leaves a hard step inside a cap that
  still reads as snow at a glance, so the suite counts the one number, its two
  reads and asks for no bare level left beside them.
  The two scalars of that cap's fade — the width of its ramp and the share it
  reaches — sit inside one helper, `snowFade(h)`, since both belong to the cap
  rather than to the branch that starts it. Written beside the call the pair
  could be edited away from the level the cap starts from, which leaves a cap
  finishing its fade a hundredth too early while still reading as snow, so the
  suite counts the definition, its single read, both scalars inside it and asks
  for no second ramp left beside the branch.
  The two contour ramps in that same pass share one thickness — `LINE_WIDTH`,
  the share of a band its own line occupies. Both are a test on the leading edge
  of a band, so a pair could be edited apart until the stripes above the
  shoreline and the ones under it stopped looking like one grid of lines; the
  suite counts the one number, its two reads and asks for no bare share left
  beside them.
  Those two ramps compute the leading edge of their band through one
  `bandEdge(t, count)`, since both are the same fraction of their own count
  wrapped by the same subtraction of its floor. Written beside each ramp the
  wrap could be cut differently while each still looked like evenly spaced
  lines, which reads as two grids of stripes rather than one — so the suite
  counts the definition, its two reads and asks for no inline wrap left beside
  them.
  The shade pass in that same group holds a pixel between two bounds through one
  `shadeClamp(sh)`, since the two ends are one decision about how far a slope may
  move its own colour. Written beside each comparison the pair could be edited
  apart until a lit face and its shadow were measured on different scales, which
  still reads as plausible relief; the suite counts the definition, its single
  read and the two bounds living inside it.
  The two axes of that same pass are measured with one number — `SLOPE_SCALE`,
  the share a height difference between neighbours becomes in the normal. Both
  are the same comparison of a cell against its neighbour, so writing the divisor
  beside each axis could set one sideways and leave the other up and down, which
  reads as a ridge leaning one way only; the suite counts the one number, its two
  reads and asks for no bare divisor left beside either axis.
  Those four neighbours are reached through one `shadeStep(hf, i, d, atEdge)`,
  since each is the same step off a cell that stops at its own edge. Written at
  each axis the step could be dropped on three of them, which measures a downhill
  face harder than the uphill one it faces — a ridge leaning one way only, still
  plausible relief at a glance; the suite counts the definition, its four reads
  and asks for no bare two-way ternary of a height index left beside them.
  The grain step in that same pass is one helper — `ditherOffset(bayer, x, y)` —
  whose divisor is the bayer table's own span (`bayer.length - 1`) rather than a
  number written beside the call. That divisor is the top of the table, so a
  second copy could be edited away from the entries it divides and shift every
  cell's grain by a constant while still reading as a dither; the suite counts the
  definition, its single read, the length-derived divisor inside it and the one
  site that indexes the table.
  The first ring of water in that same pass takes on the beach colour with one
  strength — `SHORE_INK` — read once per channel of the pixel. Written beside each
  channel the figure could be edited apart until a shore tinted one channel harder
  than its neighbours, which reads as a slightly warm coastline rather than as a
  broken triple, so the suite counts the one number, its three reads and asks for
  no bare fraction left beside them.
  Three reads in that same group ask whether a neighbour sits on the far side of
  the shoreline — the biome's beach test, the coast ink, and the mouth of a river —
  and all three walk the same four cells through one `acrossShore()` sweep with a
  `dry` flag for which side counts. Written beside each call the pair could be
  edited apart until a coastline recognised a neighbour its own river mouth
  ignored, which reads as a mouth sitting a cell off the shore rather than as a
  broken sweep, so the suite counts the definition, its three reads and asks for
  no inline four-neighbour test left beside them.
  Both fills under water in that same pass dim by one shape — `depthWash(depth,
  strength)` — since a sea and a tarn differ only in how hard their own depth is
  pressed down. Written beside each fill the shape could be edited apart until a
  tarn graded its depth on a curve the open sea did not use, which still reads as
  two plausible basins beside each other; the suite counts the definition, its two
  reads and asks for no inline `1 - depth *` left beside them.
  A river's ink in that same pass is one decision held by one helper —
  `riverMix(rank, mouth)` — since a trunk, its tributaries and the mouth where a
  channel meets the sea are four scalars about the same blend. Split across two
  statements at the call site a tributary could end up inked harder than its own
  trunk, or a mouth could overshoot its cap, while each line still read as a
  plausible network; the suite counts the definition, its single read and both
  pairs of scalars inside it.
- Moisture is not a standalone field: the orographic pass in `generate` folds the
  relief into it, so ridges get a windward wet band and a leeward rain shadow.
  Keep it a per-row sweep — it is O(n) and must stay that way.
  The direction of that sweep is the mechanism, and it is visible as an
  asymmetry: moisture tracks the height of the cell upwind of it better than
  the one downwind. The smoke suite compares the two correlations on every
  hand-picked phrase, so a symmetric smoothing — or a reversed sweep — shows up
  as a flipped pair rather than as a plausible-looking field.
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
  Each of those two sweeps reads a neighbour as that neighbour's own distance
  plus one step, and all four reads go through one `stepFrom(field, j)`, since
  every cell of the grid is reached by that one shape. Written beside each
  comparison the step could grow on one of them, which leaves a cell a column
  further from the shore than the neighbour it was reached from — still a
  plausible distance field beside its own caption, so the suite counts the
  definition, its eight reads and asks for no bare neighbour-plus-one left in
  either sweep.
  The field itself is unclamped — the furthest cell grows with the grid, which
  the smoke suite checks between a small and a large world — while the biome
  drying reads it through a capped `min(INLAND_CAP, dist) / INLAND_CAP`. Keep
  both halves on that one number: the cap is what stops a big grid from turning
  its whole interior into desert, and a divisor written beside the fraction
  could be edited apart from it until the interior dried over one range while
  its own reading scaled against another.
  The readout's `N from water` part prints on dry ground only, and it can rely
  on that because the sweeps seed at the shoreline: every water cell is already
  at zero, so the note's own threshold does the filtering and the dry/wet test
  only skips the repeat of the biome name. The suite checks that per cell, since
  a field that left a wet cell at a non-zero distance would quietly lose its
  reading from the hover.
  The two axes of the biome lookup — `moist` and `temp` — are gated on that same
  dry/wet test, for the same reason: a water cell is named by its height alone,
  so beside one the pair is two figures that decided nothing, printed ahead of
  the notes that do. The suite reads the dry branch out of the shell and asks
  that both pushes sit inside it, one each, so neither can also live outside.
  Those two pushes are one builder too — `pushAxis(parts, name, field, i)` —
  since both are a field or nothing, one index and the same out-of-a-hundred
  scaling. Written beside each other the pair could be edited apart, one
  keeping its own guard and one dropping it, which reads as a readout naming
  the wet axis on a world whose moisture field is missing while staying silent
  about the cold one. The suite counts the definition, the two reads, the one
  scaling inside the helper and asks for no bare push left beside them.
- `channelize(result, name)` is a separate pass over the already-computed fields
  (`heightField`, `moisture`, `accumulation`, `coastDistance`). It never feeds back
  into `generate`: an overlay must not change the biome map. Stretch each field by
  its own 2%/98% percentiles, and keep the log transform on `drain` and `coast` —
  both are heavy-tailed and a linear ramp collapses them into one colour.
  Both of those sorts order their field through one `byNumber(a, b)`, since a
  quantile is only ever a middle of a list of numbers. Written beside each sort
  the comparison could be edited apart — one keeping a tie-break the other drops
  — which lets a cut come from a neighbouring cell while each sorted list still
  looked ordered beside its own caption. The legend's ranking is a different
  shape on purpose (a count with a tie-break on declaration order), so it stays
  outside this pair; the suite counts the definition, its two reads and asks for
  no second plain comparator left beside them.
  Each of those sorts is read at one position through `quantileIndex(share, n)`
  — the rounded share of a list, held inside its own length — since that is what
  keeps the last entry reachable. Written beside each cut the clamp could be
  dropped on one of them, which lets a cut ask past the end of its own list and
  come back undefined while the field beside it still looked ordered; the suite
  counts the definition, its four reads and the single clamp inside it.
  `fieldFor(key, result)` is the single field lookup shared by the ramp and by
  `channelValue(result, cell)`, which is what the hover readout prints. The scale
  is cached in `result.channelScale` during `channelize` so a hover does not sort
  the field again; keep it that way rather than recomputing percentiles per cell.
  Both of those readers turn a value into a position inside that cached pair
  through one `scaleShare(v, sc)`, since the ramp and the readout measure the
  same cell against the same two cuts. Written beside each reader the subtraction
  of the low end could be dropped on one of them, which prints a figure beside a
  colour measured from a different floor — still a plausible ramp, so the suite
  counts the definition, its two reads and the single division inside it.
  Both of those readers also compress their field through one `scaleValue(v,
  useLog)`, since the two heavy-tailed overlays are logged in front of the same
  pair of cuts. Written beside each reader the log could be dropped on one of
  them, which prints a number for a cell whose colour was mixed against another
  curve — still a plausible gradient beside its own caption, so the suite counts
  the definition, its two reads, the single log inside it and asks for no bare
  transform left beside them.
  The `lake` overlay is the one exception to the percentile rule: the mask is
  already normalised by its own basin (1..60 steps), and most of a grid is dry,
  so the 98% mark of a world with two small tarns is still zero. It scales over
  0..60 instead.
  The smoke suite checks both halves of that: the filled cells stay visibly
  graded, and the published scale is the mask's own range rather than a
  percentile pair.
  That step count is one constant — `TerraCore.lakeSteps` — shared by the depth
  written into the mask, the depth shading under water, the overlay's scale and
  the `% deep` division in the hover readout. Keep it a lookup rather than
  repeating `60`: a shallow tarn
  tops out below the cap, so the suite asks that every filled cell sit inside
  1..the constant and that the published scale be that same number.
  The share of the grid those steps cover is one fraction too —
  `TerraCore.lakeShare(stats)` — read by the `lake` row and by the record's
  `lake` field. The count is absent rather than zero on a world with no tarns,
  so the empty case lives in that lookup: two copies of the fallback could
  disagree about a dry world while each figure still looked plausible on its
  own, one printing `0%` and the other a bare `0`.
  Those steps also follow the ground rather than the fill order: for any two
  neighbouring cells of one basin, the lower one carries at least as deep a
  step. The suite walks those pairs on every phrase, which is what keeps the
  `N% deep` reading a bowl instead of noise — a rim cell one unit above its
  neighbour must not claim more water over its head.
  `slope` is the one field built inside `fieldFor` rather than by `generate`:
  it is a difference of the height field, so it still cannot move a biome
  boundary, and it is cached on `result.slopeField` for the same reason the
  scale is — a hover reads the field once per cell.
  That field compares a cell with each of its four neighbours through one
  `neighbourDrop(hf, here, there)`, since all four are the same difference
  without a sign. Written beside each step the sign could be dropped on three of
  them, which measures a downhill face harder than the uphill one it faces — a
  ridge leaning one way only, still plausible relief at a glance. The suite
  counts the definition, its four reads and asks for no bare difference of two
  heights left beside them.
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
  The `N% land` figure in that same sentence is a share too, so it reads
  through `percentText()` rather than a bare `Math.round`: a mostly-ocean world
  prints `2.5% land` in the sentence and `land 2.5%` in its own row, and one
  plain rounding would make those two figures disagree by a whole step. The
  suite compares the whole string against the formatter's output for every
  phrase, which is what catches a second rounding at the call site.
  The stats list itself opens with the `seed` row, before `grid`: a print or a
  screenshot keeps no URL, so the phrase has to be readable off the page. The
  smoke suite reads the row labels out of `renderStats()` and checks that first
  pair plus that no label is reused — two rows with one name would make the
  list ambiguous to read back.
  That list is one ordered list rather than a list plus a later insert. The two
  rows appended at its tail — the overlay's name, which only exists when an
  overlay is on, and the clock that always closes the column — are pushed in the
  list's own order, since a positional `splice` has to be re-counted every time a
  row joins it, and a stale index still produces a plausible column with the
  clock in the middle. The suite therefore scrapes the literal and both pushes
  together, and asks for one list, two pushes, one `channel` row and no
  `splice` left beside them. Because the scrape now walks the pushed rows too,
  `channel` is a key of the row-to-record mapping like every other label: the
  overlay a link stores is the overlay the record names.
  Two of those rows carry a pair of pixel counts — the `grid` the world was
  built on, and the size the export multiplier saves it at — and both print the
  pair through one `sizeText(w, h)`, since the separator is the only thing the
  two rows share. Written beside each row it could lose a space on one of them,
  which reads as two columns of numbers set by two different hands — close
  enough to look fine in a screenshot, so the suite counts the definition, the
  two reads and asks for one spaced separator left in the shell. The `WxH`
  token of a saved file name is a different shape on purpose and keeps its own
  form: a filename is not a row of a table.
  Two rows are a split rather than a pair of counts — `rivers` and `contours` —
  and both print through one `splitText(first, firstWord, second, secondWord)`,
  since the spaced slash is the only thing they share. Written beside each row
  that gap could be edited on one of them only, which reads as two tables of
  numbers set by two different hands. The suite counts the definition, the two
  reads and asks that the only spaced slash in the shell sit inside the helper;
  the two row probes now look for that lookup rather than for a literal slash.
  An empty seed box is not a fourth seed: it names the generator's own default,
  so the fallback lives in one lookup — `seedPhrase()` — read by every place a
  blank field reaches: the option reader, the `seed` row, the second slot of a
  saved file name and the seed the Reroll button derives from. Written beside
  each of those it could be edited on one side only, which reads as a link and a
  PNG describing two worlds from one empty field — so the suite compares the
  word inside the helper with the core's `seed == null` default, counts the four
  reads, and asks for one inline fallback left beside them (the one inside that
  lookup). The reroll is a derivation rather than a display, so its read is
  counted on its own: the suite asks for one guarded `nextSeed(seedPhrase())`
  and no bare one beside it, since a chain started from `''` would walk a
  different sequence of worlds than the one the empty box draws.
  Every height on the page is stored 0..1 and printed out of a hundred, through
  one helper — `hundred(value)` — shared by the `relief` and `median` rows, the
  chart's corner labels, the sea rule, the median mark, the hovered-bin range and
  the readout's elevation, moisture and ramp numbers. That is what makes
  `median 49` in the stats list and `median 49` under the bars one measurement
  rather than two roundings that happen to agree. Keep the scaling there rather
  than writing `Math.round(x * 100)` at a call site; the suite counts the
  definition, the uses and any leftover inline rounding.
  That helper is the core's (`TerraCore.hundred`) rather than the shell's, since
  the CLI's caption and record print the same figures: the shell forwards to it
  and the CLI reads the same lookup, so `median 46` under the bars and
  `"median":0.459` rounded by a terminal are one measurement. The suite counts
  the core definition, the shell's forward and the CLI's uses, and asks for no
  leftover inline round in either reader.
  The word that follows such a figure is one suffix too — `unitText(n)` — read by
  the three views that name a height in words: the `relief` row, the `median` row
  and the elevation in the hover readout. Written beside each view it could lose
  its space on one of them, which reads as two columns of numbers set by two
  different hands — close enough to look right in a screenshot, so the suite
  counts the definition, the three reads and asks that the only `' units'` in the
  shell sit inside the helper. The chart's corner labels stay outside this pair on
  purpose: they sit under a ruler that already names the unit in its caption.
  The summary sentence is a printed height too. Its relief figure picks the word
  in front of it, so `describe()` reads the same lookup rather than writing a
  rounding of its own: a second one could be cut against another range and leave
  `rugged (71)` beside a row reading `relief 70 units`, which is two
  measurements of one grid while each still looks fine alone. The suite pulls
  that sentence's body out of the core and asks for the lookup plus no inline
  `* 100` left inside it.
  The elevation in the hover readout is a share of one of two bands — room above
  the shoreline for land, the sea itself for water — and each share is guarded
  against an empty band by one lookup, `fillSpan(span)`. Both branches of that
  ternary read it, so the two halves of one hovered cell cannot scale their
  heights against different notions of a flat world; the suite counts the one
  definition, the two reads and the single forward inside the helper. That
  forward lands on the core's `spanFloor(value)`, which holds the floor itself:
  the two band counts, the depth shading under water, both contour ramps and the
  chart's bin range divide by a difference of levels in the generator, so a
  seventh reader written beside its own `Math.max(0.001` would let a level
  craton count its stripes against one floor while its own readout scaled
  against another. The suite counts that definition, its six reads, the export,
  the shell's forward and the single floor left inside the helper.
  The two counts in that same readout — how far a dry cell sits from the
  shoreline, and how many cells drain behind a channel — are whole numbers over
  one grid, so both round through `cellCount(value)`. Written beside each note,
  the pair could be edited apart while each still read fine beside its own
  caption, and one hovered cell would then report its two counts on two scales;
  the suite counts the one definition and asks for no bare `Math.round(current.`
  left beside them.
  Those two counts also read their field through one lookup —
  `fieldCount(field, i)` — since either field can be absent on a plain world,
  and that case is a zero rather than a blank. Written beside each note the
  fallback could be edited on one side only, so one note would print nothing
  where the other printed `0` — a note going quiet for reasons its neighbour
  does not share. The rounding then lives one level down, read once inside that
  lookup. The suite counts the definition, the two reads and the single
  fallback inside it, and asks the rounding for that one read rather than two.
  Both of those counts also go quiet at the same step, through
  `worthNaming(n)` — a distance of one cell, or a catchment of one, says no
  more than the biome name already did. Written beside each note the pair could
  be edited apart, which reads as one note stopping a step earlier than the
  other for reasons nothing on the page explains; the suite counts the one
  definition, the two reads and asks for no bare `> 1` gate left beside them.
  Shares of the grid go through `TerraCore.percentText(fraction)` — whole percent
  at or above ten, one decimal below that, two under one percent, so a 2% class,
  a 0.2% class and a 0.04% class each keep their own figure in the legend. The
  `land`, `water` and `ice` rows, the legend's right
  column and the CLI's `classes` pairs all use it, which is what lets a terminal
  read `seasonal=6.2%` and find `Seasonal forest 6.2%` on the page. The suite
  re-derives every pair in that column from the counts with the same helper, so a
  second rounding on either side shows up as a mismatch rather than as two
  plausible-looking numbers.
  The fraction beside each of those pairs is one division too —
  `TerraCore.classShare(stats, key)` — read through one shell lookup by the
  legend's right column and the note under the map, and directly by the
  record's `classes` column. A class that never
  occurs on a world is absent from `stats.counts` rather than holding a zero, so
  that fallback lives in the lookup: two copies could disagree about a missing
  class while each figure still looked plausible, one printing a bare `0%` and
  the other an empty string. The suite counts the definition, the one lookup on
  each side of the pair, and re-checks one pair against a hand-written division.
  On the page side those two readers go through one builder — `shareText(stats,
  key)` — since both show the pair rather than the fraction alone: the legend's
  right column and the note under the map each print a share out of a hundred.
  Written beside each view the scaling could be edited apart while each still
  looked plausible on its own, which reads as a row saying `6.2%` over a note
  saying `6%` for the class they both name. The suite counts the definition, the
  two reads, the one formatter call inside the helper and asks for no bare pair
  left beside them.
  That switch at ten is checked rather than assumed: the suite walks every share
  the page prints — each class, the drainage figure, the three cover rows — over
  every hand-picked world and asks that a string carry a decimal exactly when its
  own value sits under ten. Whole numbers alone would print a 2% class and a 0.2%
  class as the same figure, which is the one thing a biggest-class-first list
  cannot survive.
  The tail of that list is why the smallest band is a band at all: two classes
  under one percent both read `0.0%` on one decimal, and the order of those two
  rows is the last place the list still says something. The suite compares the
  decimal count each band promises — two under one percent, one up to ten, none
  above — so widening the extra digit everywhere is caught as well as dropping it.
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
  That name is one ordered list rather than a list plus a later insert. The
  factor sits between the grid size and the checksum in the list itself, since
  a positional `splice` has to be re-counted every time a field joins it — and
  a stale index still produces a plausible file name, with the factor printed
  after the checksum instead of before it. The suite counts the one list, the
  factor inside it, the one shape override, the single join and asks for no
  `splice` left beside them.
  Both forms of that record are checked against each other: without `--json`
  the same object prints as a padded label column, and the suite parses that
  column and asks that every key of the JSON line be a label carrying the same
  value. The two are built from one object, so a field that reaches only one of
  them is a field a reader of the other form silently loses. `ms` is the one
  exception — it is the clock, so only its presence is asked for there. Note
  that the padding is a whitespace RUN, and the longest key leaves exactly one
  space: split on `\s+` rather than on two spaces, or the tallest row of the
  table drops out of the comparison.
  That one space is the whole rule behind the column, and the width it is
  measured against comes from the record's own longest key rather than a number
  written beside the loop — a constant is only right while the widest field
  happens to be the one it was counted off, and a longer field added later
  would otherwise print its value flush against the name. The suite re-measures
  the widest key of the JSON line and asks every row of the table for that
  row's own gap, so the pad cannot drift from the labels it is set by.
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
  Every printed world — the plain listing and each branch of that chain — is
  built through one `runWorld(seed)` helper that copies the parsed options and
  swaps in the seed, so a flag added to the parser reaches the listing, the
  `--describe` sentences and the records at once rather than only the form
  someone happened to edit. `--hist` is
  honoured in those branches too: one profile block per seed, each caption
  ending in that seed's checksum, which is what lets a pasted block of bars be
  matched to its own line of JSON. The suite reads both forms and compares the
  two checksums per seed.
  The rest of each chain caption is compared the same way — the two ends of the
  range, the sea level and the median — against that seed's own record rather
  than against the first one. Each form reads its figures from the world it just
  built, so a caption that read them from another seed would still print a
  plausible silhouette above it.
  Those two forms also have to agree about the bars themselves, per seed: the
  ruler above a block is as wide as that seed's own `bins`, and the record's
  `hist` array has that many entries summing to `width * height`. Checked
  seed by seed rather than once, since a chain that copied one world's counts
  into every record still passes a single comparison while printing bars that
  belong to the wrong picture.
  That pair fixes the frame again rather than the weight, so each record's
  `peak` is re-derived from its own `hist` array too — the tallest entry, not
  a figure carried over from the first seed. The profile divides every count
  by that number, so one shared `peak` would print every silhouette of the
  chain at the wrong height while each block still looked plausible.
- `parseArgs()` in `cli.js` treats a bare word as a seed and a dashed word as a
  flag. A dashed word that matches nothing is named on stderr, and the word
  after it is skipped, so a mistyped `--widht 30` costs one warning instead of
  quietly rendering a second world from the number `30`. Keep that skip in the
  parser rather than filtering the seed list afterwards.
  `--seed phrase` is the key form of that bare word: it pushes onto the same
  list, so one flag per world is the same as several bare words and both forms
  print the same sentences. Keep the list shared rather than holding a second
  `opts.seed`, since a record built from only one of the two would describe a
  shorter chain than the one on screen. It reads through `hasVal()` like every
  other value-taking flag, so `--seed --json` keeps the generator's phrase and
  still prints a record. The suite compares the two forms string for string.
  Numeric flags read their value through `nextNum()`, which returns
  `undefined` for anything that does not parse. A raw `parseFloat` would hand
  the generator a `NaN`, where every comparison is false and the whole grid
  comes back as dry land; `undefined` lets the generator's own default stand.
  The reader is `Number` rather than `parseInt`: an exponent reaches the
  generator whole (`--width 1e2` is 100, not the `1` that `parseInt` stops on),
  and trailing junk is rejected outright instead of being read as its leading
  digits. An empty value counts as unset rather than as zero, since `Number('')`
  is 0 and that would replace the default grid with the smallest drawable one.
  The suite checks both halves against the generator's own default pair.
  The policy itself is the core's — `TerraCore.readNumber(value, isInt)` — and
  both readers are forwards to it: `nextNum()` in the CLI and `num()` in the
  shell. Two bodies written out in full can be edited apart while each still
  looks reasonable on its own, and a pair that disagrees about `800x` gives one
  phrase two grids depending on whether it was typed in a terminal or in the
  seed box. The suite therefore asks the core's definition for the three traits
  (`Number`, an `isFinite` test, no `parse*` call) and asks each reader to be a
  forward rather than a second copy.
  It sits at the top of the shell rather than inside `readOptions()`, because
  `exportFactor()` reads the export dropdown through it too: the factor behind
  the `export` row, the saved file's name and the multiplier in the CLI record
  are then one reading of one control.
  Keep the `argv[++i]` advance at the call site — moving it inside the helper
  reads each value twice and shifts every later flag by one.
  The chain count is read by that same helper, so `--next 1e1` walks ten seeds
  and `--next 3x` falls back to the chain's own default of five rather than to
  the leading digit. One reader for every numeric flag is what keeps a shell's
  exponent form working everywhere at once.
  The parser holds no copy of the default grid: `width`/`height` start absent so
  the generator's own defaults stand, and `finishGrid()` only fills the side a
  caller did not name, from the ratio of the generator's own default pair —
  `TerraCore.defaultGrid`, one lookup read by the fill and by the suite. That is
  what makes `--width 800` a wide landscape instead of an 800x300 letterbox, and
  `--height 200` a wide strip rather than a tall column. When both sides are
  given the pair passes through untouched, so the derivation is never a second
  place the grid is decided. The suite checks both one-sided forms against that
  ratio, since a fixed fallback for the missing side would still look plausible
  in either direction on its own.
  The pair is a lookup rather than two numbers written beside the fill because a
  second copy only has to be edited once to make a terminal and the page disagree
  about the shape of a world: the suite therefore asks the fill for that lookup by
  name and asks for no leftover ratio literal.
  Inside the generator each side of that pair is one rounded count with one
  floor — `gridSide(value, fallback)` — since both axes are the same three steps
  (round the caller's number, hold it above the smallest drawable size, fall back
  to that axis's own default). Written beside each axis the floor could be dropped
  on one of them, which lets a very short window keep its rows while its columns
  shrink to a ribbon — still a plausible shape for a narrow browser, so the suite
  counts the definition, its two reads, the single floor inside it and asks for no
  second clamped rounding left beside the pair.
  Because the fill runs once on the parsed options rather than inside a print
  branch, the `--next` chain — which builds its worlds through its own option
  copies — reports the same derived pair as the plain listing. The suite checks
  that pairing over a three-seed chain asked for by `--width` alone.
  The rule is also in the `--help` text, since that is where a terminal looks
  first: the two sizes are the only flags where one value decides the other, so
  a reader who names only `--width` should learn the missing side is derived
  rather than fixed. The suite asks for one line naming a size flag and the
  derivation together, which is what separates that note from the surrounding
  list of key-valued flags.
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
  Its value is the only one taken as written, which makes it the one flag that
  can swallow the next one: `--out --json` would otherwise name the file
  `--json` and print the plain table. The reader therefore keeps the default
  name when the following word is itself dashed, and does not advance past it,
  so the flag after `--out` still applies. Every other value-taking flag reads
  through the same test — `hasVal(argv, i)` — so `--palette --json` keeps the
  generator's scheme and still prints a record rather than naming `--json` as
  an unknown value. The suite checks a key flag and a count of guarded reads
  against bare ones, since a flag left outside the guard would swallow its
  neighbour while every other flag behaved. That one rule is also in the
  `--help` text — a single note beside the flag listing, since it covers every
  value-taking flag at once rather than each of them separately. The suite asks
  for a line naming both halves: that a value is optional, and that the reason
  is the next word being a flag itself.
- Letter shortcuts (`c`, `h`, `k`, `d`, `w`, `e`, `g`, `l`, `m`, `p`, `s`) are skipped while an INPUT or
  (`x` joins that list: it is not a list cycle but a call to `copyLink()`, the
  same function the `Copy link` button is wired to, so the two paths cannot
  disagree about what lands on the clipboard. Keep that one function for both.)
  The button's own name is remembered in a `data-label` attribute the first
  time it is pressed, and the restore is one shared timer that each press
  clears before scheduling again — otherwise a second click inside the feedback
  window leaves the button reading `Copied` for good.
  The length of that window is one number too — `FEED` — since the clipboard
  branch and the fallback branch both schedule it. Written beside each call the
  pair could be edited apart, which reads as a button that holds its label a
  different length in one browser than another, so the suite counts the one
  definition, its read and asks for no bare millisecond count left beside them.
  That button is also the one control whose node two bodies need: the wiring at
  the bottom of the shell, and `copyLink()` itself, which has to write its
  feedback into the same element the click lands on. The lookup therefore sits
  beside the canvases and the text boxes, and each caller reads the variable.
  With two lookups an id rename could be fixed on one side only, which reads as
  a button that never answers a click while its label still restores itself —
  plausible in a screenshot, so the suite counts the one lookup and the reads.
  The reroll button is held the same way, because it too has two callers: the
  listener that chains the seed, and the `Space`/`R` branch that presses the
  button rather than writing that chain step a second time. A second lookup
  there would let the keyboard press a node the listener never wired, which
  reads as a shortcut that clears nothing at all.
  SELECT owns the caret, so a seed phrase can still be typed. That test is one
  `ownsCaret()` lookup read by both keyboard paths — the arrow walk and the
  letter block — since two copies could drop `SELECT` from one of them, which
  reads as arrows moving a dropdown while every letter still waits for the
  caret to move. Each cycle key
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
  Every one of those cycles wraps through one `cycleIndex(i, step, count)`,
  read by the shared list-cycle helper, the legend ring, the `Shift`+arrow walk
  over the height bins and both axes of the arrow walk over cells — five sites,
  since the ring's empty slot is itself a stop.
  The double modulo is the point: a
  negative step under `Shift` has to come back positive, and a wrap written
  once would stick on the first entry for one key while the others backed out
  properly. The suite counts the definition, the five reads and asks for no
  bare wrap left beside them.
  The sign that step is paired with is one lookup too — `shiftStep(ev)` — read
  by the shared helper and the legend ring, so a `Shift` mis-press backs one
  step up on every cycle rather than on the ones whose branch happens to match. Written
  beside each handler the pair could invert on one key only, which reads as a
  single letter cycling the wrong way for reasons nothing in the dropdown
  explains; the suite therefore counts the definition, the two reads and the
  one ternary inside it.
  Those two lookups are reached from one place by the six list cycles — `c`,
  `h`, `d`, `w`, `e` and `p` — through `cycleControl(select, items, ev)`, which
  pulls the keys out of the core's own array, finds where the control sits,
  steps by the `Shift` sign, wraps and rebuilds. The map keeps a key when an
  entry has one and falls back to the entry itself otherwise, which is what lets
  the plain string list of phrases walk through the same helper as the six
  `{key, label}` lists. Written beside each letter the five steps could be
  edited apart: one key could drop its rebuild, so its dropdown would change
  without the map following, or drop its `Shift` step, so that one letter would
  only ever walk forwards. Both read as a slightly odd key rather than as a
  bug, so the suite counts the definition, the six reads, the one key map and
  the one rebuild inside it, and asks for no second such map left in the shell.
  The dark block only works by replacing every variable in `:root`, so the suite
  compares the two name lists: a variable declared once and never restated keeps
  its light value under a dark background, which is the one way this scheme can
  go wrong. A new colour has to appear on both sides.
  The legend's hover tint is the one colour written as a hue plus its own alpha,
  so it lives in `--accent-soft` and the hover rule reads that lookup rather than
  a literal rgba — that is what lets the dark block raise both halves at once.
  The suite asks for the lookup in the rule and for exactly two declarations,
  one per scheme.
  The two surfaces that are not quite the panel — the boxes you type into and
  the strip the hover readout sits on — are `--field` and `--hud` for the same
  reason: each is a wash over the panel, so both schemes set them inside
  `:root` and neither rule needs a literal. That is what keeps the dark block's
  promise (variables only) true; a literal in either rule would need a matching
  colour rule in that block, which is one more place a colour can be edited
  while the other scheme is not looking. The suite asks each rule for its
  lookup and each variable for exactly two declarations. The one leftover in
  the block is the readout's ink, since that strip sits on the map rather than
  on the panel, so the variable swap does not decide its text colour.
  A filled button is the accent behind its own label, so its ink is `--on-accent`
  rather than `--ink`: the dark scheme's accent is the lighter of its two greens,
  which a white label would wash out. With that lookup the last literal in the
  sheet sits inside a declaration, so every colour a rule reads is one the
  name-list comparison already walks — the suite asks the button rule for that
  lookup and the variable for exactly two declarations.
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
    Both halves of that pair come back through one `pairOf(text)`, which splits
    once and hands each half to `num()`. Written as two inline parses they could
    be edited apart — one keeping the leading digits of a value the other
    rejected — which would name a cell in one axis and its neighbour in the
    other, a difference too small to notice beside a crosshair. The shape test
    stays in `applyHash()`, since the helper only reads what it is given; the
    suite counts the definition, the one read and asks for no bare `parseInt(`
    left inside the hash reader.
    Whether the map has a pointer on it at all is one lookup — `pointerAway()`
    — read by the two guards in `render()` and by that reader. The note under
    the map may refill the whole strip only while nothing is hovered, a
    hash-restored cell only wins while nothing is hovered, and the `at=` pair
    falls back to the middle cell otherwise. Written beside each caller the
    three could be edited apart, which reads as a rebuild that restored a cell
    under a caption describing the whole grid — a stale line, not an obvious
    bug — so the suite counts the definition, the three guarded reads and asks
    for no bare comparison of the hover against zero left beside them.
    That fallback pair — the middle cell of each axis, for a link with no cell
    in it — is one lookup too, `middleIndex(count)`, read once per axis. Both
    halves are the same division over their own count, and a pair written side
    by side could be cut differently while each still looked reasonable beside
    its own caption: a link would then name a cell in the left half of a wide
    map while its crosshair sat in the top third of a tall one. An unbuilt
    world counts as nothing inside the helper, which is the empty case both
    callers already relied on. The suite counts the definition, the two reads
    and asks for no bare division of a grid side by two left beside them.
    The first `Shift`+arrow on the chart starts from that same middle — the
    middle bar of the bin count, since most worlds keep most of their cells
    near the middle of their own range — so a walk that begins without a
    pointer lands where a link without a cell does. Three reads in all.
    A pointer is mapped onto the buffer by one `pointerPos(ev)`, which reads its
    pair of fractions from `pointerFraction(ev, rect)`: the offset inside the
    layout box over that box, guarded so an empty layout still divides. Both
    pointer paths on the map — the hover mark and the readout's own cell — read
    that one conversion, so the crosshair and the text cannot name two different
    cells for one click, and the chart's bin index reads the same fraction
    rather than writing a second division of its own. The suite counts the
    definition, the two reads, both guards inside the helper and asks that the
    chart hold no bare division left beside it.
    Those two paths then run one shared sequence — `hoverFromPointer(ev)` —
    which moves the mark, prints the readout, repaints and writes the hash, in
    that order. A fifth step added to the mouse branch only would keep a
    desktop link in sync while a phone's drifted, which no one notices with a
    mouse plugged in, so the suite counts the one definition, the two reads,
    the four steps inside it and asks for no bare sequence left beside them.
    The mark those steps move is a pair too — a column and a row — and one
    `setHoverPoint(x, y)` writes both halves for all three paths that reach it:
    a pointer on the map, the keyboard walk, and a pointer leaving. Written
    beside each caller the pair could lose one half on one branch only, which
    reads as a cursor that tracks sideways while its own row stays put — close
    enough to a working crosshair that nobody opens the console over it. The
    suite counts the definition, the three reads and asks that exactly one
    assignment to the pair's halves be left, inside that helper.
    That readout is filled from two kinds of caller — a pointer event, which it
    turns into a cell itself, and the pair of indices a keyboard walk just
    clamped — so both halves of that pair are named parameters of
    `updateReadout(ev, py)` rather than a second value picked out of
    `arguments`. Written that way the two callers cannot disagree about how many
    numbers they hand over: a reader that kept one axis and dropped the other
    would print a column with no row beside it, which is a crosshair sitting on
    the wrong cell rather than an obvious error. The suite counts the one
    definition with both parameters, the two reads and asks for no
    `arguments[` left beside them.
    The bound each of those cells ends with is one lookup too —
    `clampIndex(n, count)` — read by the keyboard walk, the reader that builds
    the `at=` pair and the readout's own pair, twice each since a cell has two
    axes. A link saved against a wider grid is the case that matters: the
    restored index has to come back inside the same way a pointer does, and a
    bound written beside each caller could be edited on one side only. The
    inset's patch clamp is a different shape — it holds a whole block inside
    the grid — so it stays outside this pair, and the suite asks for no second
    copy of the single-cell form left in the shell.
    A picked bar is one index over one count as well, so the chart's own
    selection reads that same bound: seven reads in all. Written beside that
    handler the lower guard could be dropped while the cell walk kept its own,
    which reads as a tap left of the first bar naming a bin nothing ever
    counted — a one-column error too small to notice, so the suite counts the
    reads and asks for no second clamp of that shape in the chart.
    Before that bound, the same three paths turn a backing-store pixel into a
    cell index through one `cellOf(x, y)`, which divides by the very cell size
    the blit was drawn with. Written at each site, one of them could divide by
    a rounded or re-derived size and still land inside the grid, so the
    crosshair would sit on a neighbouring cell from the one the readout names —
    a difference of one column that reads as an odd cursor rather than as a
    bug. The suite counts the definition, the three reads and asks for no bare
    division by a cell size left beside them.
    That cell index becomes a drawn position through one more lookup —
    `cellCentre(i, size)` — read by the pair of hairlines the crosshair is
    stroked with and the pair of fields the hover position keeps. Written beside
    each of them the half-cell offset could be dropped on one branch only, which
    leaves a box sitting on a cell's left edge under a crosshair that stayed in
    the middle: close enough to read as an odd cursor, so the suite counts the
    definition, the four reads and the single offset inside the helper.
    The patch that panel draws is held inside the grid by one more bound of its
    own — `insetOrigin(pos, extent, span)` — read once per axis, since a block
    has two edges to keep in and a single index has only one. That is why it
    sits beside `clampIndex()` rather than inside it: the wider shape measures
    the span as well as the position, and a shared body would have to guess
    which of the two a caller meant. Written beside each axis the offset could
    be dropped on one of them only, which leaves a panel flush against the
    right edge of a map while its own top row still floats — an asymmetry small
    enough to read as an odd cursor, so the suite counts the definition, the two
    reads and asks for no bare clamp of that shape left beside them.
    The arrow handler wraps its own pair through `cycleIndex()` before calling
    `hoverCell()`, so a walk in one direction keeps sweeping instead of sticking
    on the last column; the clamp in `hoverCell()` still handles a hash-restored
    index outside a smaller grid.
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
  That sky is parsed by one lookup — `skyRgb()` — read by all four overlay
  That sky is parsed by one lookup — `skyRgb()` — read by all five overlay
  sites: the isolation blend twice (a pinned class, a hovered band), the
  crosshair's ink, the mat under the magnifier and the blend behind the box
  around a hovered cell. Written at each site, the
  parse could be guarded on one branch only, which leaves a map fading toward
  one colour while its own crosshair is drawn in a slightly different one —
  close enough to pass at a glance. The suite counts the definition, the five
  reads and the single `hexToRgb` call inside it.
  The ink those marks are stroked with is one lookup as well —
  `inkColour()` — read by the three of them: the crosshair's pair of hairlines,
  the border of the magnifier's mat and the one-cell mark inside that patch.
  Each sits over its own background at its own alpha, so the alpha is written
  per mark while the hue is not. Written beside each stroke, one mark could be
  pointed at another entry of the colour table and still read as the scheme's
  ink next to the other two — a slightly odd cursor rather than a bug, so the
  suite counts the definition, the three reads and asks that the only table
  access of that shape be the one inside the helper.
  The box around a hovered cell is that ink blended a little toward the sky, and
  it is drawn twice: the rectangle on the map, and the one-cell mark inside the
  magnifier's patch. Both name the same cell, so that blend is one lookup too —
  `cellInk()` — since writing it beside each site could deepen one of them while
  the other stayed put, which reads as a box sitting a shade off the mark inside
  its own panel. The suite counts the definition, the two reads and asks that the
  only blend of that strength be the one inside the helper.
- Legend isolation lives in `drawMap()`: `solo` follows the pointer/focus,
  `pinned` is the click selection and survives a reroll. Both blend non-matching
  cells toward the palette sky in that one loop — do not add a second blend
  path, or hover and click will disagree about the result.
  The pinned row also states itself in text: each `<li>` gets
  `aria-current="true"` on the kept class and `"false"` on the rest, from the
  same `pinned === key` comparison that sets the ring's class. The ring is only
  a colour difference, which a screen reader reads as nothing, so the attribute
  is the row's only spoken state. Keep one comparison feeding both — the suite
  counts the single attribute write plus every use of that comparison — the one
  flip inside `togglePin()` that both toggles share, and the two reads that
  paint it — so the ink and the announcement cannot name different rows after a
  rebuild, and a fourth opinion about which row is on has to be written down.
  "Survives a reroll" means a reroll of the same kind: a wider column count can
  drop a class entirely, and the legend is rebuilt from the classes that remain,
  so a pin left over from the previous grid would dim the whole map with no row
  left to release it. `render()` therefore forgets a pin the new `stats.counts`
  does not list. The suite re-derives that pair — a class present at one pinned
  width and absent at another, plus exactly one such guard in the shell — so the
  cleanup cannot be dropped while the counts still look reasonable.
  A hovered relief-chart bar (`band`, a bin index) is the third filter in that
  same loop: it selects by height instead of by class, and a legend selection
  wins over it. Like `solo` it is a preview and never goes into the hash; both
  are cleared when the pointer leaves the map.
  Every site that clears `solo` goes through one `clearSolo()`, which holds
  `solo = null; drawHover(); bandNote();` — the pointer leaving the list and the
  caret moving off a row are the same three steps, and writing them beside each
  handler could drop one on a single branch, which reads as a clear that only
  works with a mouse. The repaint stays `drawHover()` rather than a bare
  `drawMap()`: the grid pass alone drops the crosshair on the cell picked out of
  the hash, so a hover over the legend list would erase a mark the link promised.
  The smoke suite counts the one definition, the two reads, the single clear and
  the single repaint inside the helper, plus the one bare assignment left beside
  it — the `var solo = null;` declaration, which is a first value and not a clear.
  The chart reads the same three filters in `paintHistogram()`: a hovered bin
  dims the other bars, a legend selection dims the bins with none of that class.
  `drawMap()` calls `paintHistogram()` so one repaint keeps both views in step —
  do not repaint the chart from the individual handlers.
  The dim itself is a weighted sum of a palette triple and a wash target, and it
  is written once: `mix(a, b, t)` blends, `rgba(c, alpha)` prints, and the bars
  fade toward one `WHITE` through that pair rather than spelling out three
  `Math.round(c[n] * keep + 255 * (1 - keep))` expressions of their own. The
  overlay on the map reads the same two helpers with its own palette target.
  The suite counts the wash target, the one blend call in the chart and that no
  inline sum is left beside it.
  The chart's own ink is one list too — `INK`, the hue behind the sea rule, the
  decade ticks, the median mark and all four labels — and each mark reads it
  through `rgba(INK, a)` at its own strength. The pill behind a hovered bin's
  label is `WHITE` at its own alpha, so the strip holds no `rgba(...)` string at
  all: seven uses of two named lists, which the suite counts beside the count of
  leftover literals. A hue written out seven times could be edited seven ways,
  and a chart with two inks still looks plausible at a glance.
  The strip's type is one list as well — `FONT`, read by both sizes that set it:
  the small ruler labels and the bigger hovered-bin caption. Only the number in
  front of the family differs, so each site writes `'9px ' + FONT` rather than a
  second stack. Two copies could be edited apart while each still looked fine
  beside its own row, which reads as a caption set in another face from the
  labels under it; the suite counts the one list, the two reads and asks for no
  leftover stack beside them.
  `hoverHistogram()` is shared by `mousemove` and a touch `pointerdown`, so a tap
  on the chart selects a bin the same way a cursor does. Keep the one function.
  The touch call passes a second argument so tapping the bar that is already
  selected clears it: a finger has no hover-out, and without that second tap a
  phone would never get the full map back. The mouse path keeps the plain rule.
  Both canvases carry that pair — one `mousemove` and one pointer path — and
  each pointer handler starts by handing the event back when the pointer reports
  itself as a mouse, so one cursor move never paints the same frame twice. The
  suite counts the three lists together, so a third pointer listener has to
  state its own guard rather than relying on the other two.
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
  Summing to the grid only fixes the frame, so the suite also re-tallies each
  column with `binOf` over the pass's own `lo` and `span` and compares the whole
  array, plus `peak` and the two ends of the range. That is what keeps the bar
  lit under a cursor the bar that counted the cell: a second rounding inside the
  pass shifts a cell one column while leaving the total untouched.
  The hovered cell's own bin is held in `cellBand` — a reading, not a filter.
  `updateReadout()` writes it once from `histBinFor()`, prints it as
  `band 38/72` in the readout, and hands it to the chart; `drawMap()` lights
  that bar through `band >= 0 ? band : cellBand`, which is what keeps the
  highlight alive across the repaint a hover triggers. A picked bar (`band`)
  still wins over it. Both are cleared when the pointer leaves, and neither
  goes into the hash — the link carries the cell, and the bin follows from it.
  That label is a measurement rather than a position in a list, so both ends of
  the bin's height range go beside it — `band 45/72 (53-54)` — built from the
  range the chart was binned over. That arithmetic lives in one lookup,
  `bandSummary(bin)`, which the chart's hovered-bin caption, the hovered-cell
  note and the selected-band line all call: three callers, two ends, and the
  suite counts both so a bin cannot round against one scale in one view and
  another in the second.
  Those three views print the same short pair beside their own word — the
  bar's number over the bin count, then the two ends out of a hundred — so that
  pair is one builder too, `bandTally(bin, sum)`, read by the hovered cell's
  label, its mismatch note and the line under the map. Three copies of the
  division could round one bin three ways while each still looked right beside
  its own caption, so the suite counts the builder, its three reads and the
  denominator inside it.
  Inside that tally the two ends of the range are one print of their own —
  `rangeText(sum)` — read by the tally and by the caption drawn inside the
  chart, since a bar's own label names the pair beside a count and a class
  while every note names it inside a tally. Written beside each caller the
  scaling could be edited apart while each still looked plausible on its own
  row, which reads as a bar whose caption and note disagree about the heights
  it covers. The suite counts the definition, the two reads and asks that the
  only `hundred(sum.from)` pair left in the shell be the one inside that helper.
  The two fields that follow that tally — how many cells fell in the bar, and
  which class fills most of it — are one list too, `bandFields(sum)`, read by
  the caption drawn inside the chart and by the line under the map. The class
  is dropped when a bin has none, so the gate lives inside the helper rather
  than beside each caller: written twice, one view could count cells while the
  other named a class the first never mentioned, and each still read as a
  plausible note about one bar. The suite counts the definition, the two reads,
  the one count field and the single class gate inside it.
  Those three views each fill the whole strip with a list of short fields, and
  the gap between two fields is one string too — `joinParts(parts)` — so the
  hovered cell, the pinned class and the selected band all separate their
  readings the same way. Written at each site, one of them could drop its space
  or swap in a comma while each still read fine beside its own caption, so the
  suite counts the definition, the three reads and asks that the only separator
  literal left in the shell be the one inside that helper.
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
  The chart's four paths — hover a bar, tap one, walk with `Shift`+arrow, or
  leave the strip — end with one `applyBand()`, which holds `drawHover();
  bandNote();`. Written beside each handler, a step added for the mouse only
  would keep a desktop link in sync while a phone's drifted, so the suite counts
  the one definition and its three reads beside the direct writes.
  Dropping the height filter is a fifth path of that kind, and it is one
  `clearBand()` holding `band = -1;` plus a read of that same tail. Three ways
  reach it: a second tap on the bar already selected, a pointer leaving the
  chart, and a pointer leaving the map. Written beside each handler the reset
  could stay while the repaint pair was dropped, which reads as a map that
  forgot its band while the line under it still named the old one — so the
  suite counts the definition, its three reads, the one reset and the one tail
  inside it, and asks for no bare `band = -1;` written outside the helper.
  On the map's own leave the cell reading is cleared first, since the shared
  tail repaints the chart from that number.
  The tail of all three — rebuild the rows, repaint the map, write the hash,
  refresh the note — is one `applyPin()`, read by `togglePin(key)` (which the
  click and the row's `Enter`/`Space` both call, after flipping the pin) and by
  the `k` cycle (which sets its own index first). Written at each site, a sixth
  step added to one branch only would keep a mouse pin and a keyboard pin
  describing different worlds in the same link, which is what the suite counts:
  the three helpers that each hold one write (`applyPin()` for the pins,
  `clearSolo()` for the two legend clears, `applyBand()` for the chart paths),
  the seven reads of those helpers, and the three direct writes beside them —
  six writes in all, reached from every handler that moves a filter.
  A hovered or focused row is the same kind of change — `solo` is the first half
  of the note's precedence — so `drawHighlighted()` and both clear handlers call
  the writer too. That is why the count is ten writes plus a helper both halves
  of a pin read, rather than the four the chart paths alone would give: a row
  that faded the map without renaming itself in the line would leave the two
  halves of one filter saying different things until something else repainted.
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
  Exactly four places read that pair — the blit, the bars, the note and the
  hovered-cell reading — and the suite counts all four, so a fifth opinion
  about which filter wins has to be added there as well as in the shell.
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
    A pinned or previewed class dims the map the same way, so the hovered cell
    gets the matching note for that filter too — `not Grassland` beside a faded
    cell, naming the SELECTED class rather than the cell's own, which is the
    half a reader has to compare with the row they clicked. Same gate as the
    band note: a cell already of that class printed its own name one field
    earlier, so a second copy would only push moisture off the end of the line.
    Both filters fold through the same `solo || pinned` lookup the blit uses,
    which is why the hover follows a pinned row it did not hover. The suite
    counts that lookup among the four readers and asks for exactly one such
    mismatch note in the readout.
  The magnifier in `drawInset()` is the one overlay that covers map rather than
  tinting it, so `m` drops it: `insetOn` gates the call in `drawHover()` and
  nothing else. Like `solo` and `band` it is a view setting and stays out of
  the hash — a shared link should reopen with the panel drawn.
  The patch is a dozen cells wide, so it also marks the hovered cell inside
  itself: the offset is the difference of the two clamped indices times the
  patch's own cell size, which is why a mark at a fixed offset would sit on the
  wrong cell everywhere but one. The suite counts both halves of that pair.
  That dozen is one number too — `PATCH` — since five reads cover it: both
  halves of the clamp, the pair of edges of the source block cut from the
  offscreen copy, and the divisor behind the panel's own cell size. Written
  beside each use it could be edited apart, which reads as a patch whose
  one-cell mark no longer matches the cells it magnifies, so the suite counts
  the one number and its reads.
  Inside that panel the mat behind the patch is one reserve too — `MAT`, two
  CSS pixels — because two halves read it: the filled backing is that much wider
  than the patch on every side, and the hairline sits half a pixel further out so
  it lands on the fill's own edge. Written at each site, the border could grow
  past its background on one branch only, which reads as a line floating off the
  panel it frames, so the suite counts the one number, its reads and asks for no
  bare offset left beside them. That further half pixel is one derivation too —
  `EDGE`, the reserve plus a half — read by all four sides of the stroke, since
  four offsets written beside the call could pull the frame in on one axis only,
  which leaves a border sitting on its background at the left while floating at
  the right. The suite counts that derivation, its four reads and both probes.
  The panel's own size is a pair of fractions — `PANEL`, the share of the shorter
  canvas edge the patch may take, and `PAD`, the share of that patch given back as
  padding. The second is measured against the first rather than the canvas, so a
  wider panel keeps its own margin instead of crowding the map with a fixed gap.
  Written as two bare numbers beside each other the pair could be edited apart,
  which reads as a border that grows while the picture inside it stays put, so the
  suite counts one definition and one read of each and asks for no bare fraction
  left beside them.
  Which half of the canvas that panel sits in is one lookup as well —
  `farHalf(pos, extent, room, pad)` — read once per axis, since the panel has a
  column to place and a row. Written beside each axis the comparison could be
  dropped on one of them only, which leaves a panel that tracks the cursor
  sideways while its own row stays pinned to one side — that reads as a second
  cursor rather than as a magnifier, so the suite counts the definition, the
  two reads and asks for no bare half-plane choice left beside them.
  Rows carry `data-key` so a keyboard toggle can hand the caret back after the
  list is rebuilt, and the row's own `keydown` stops propagation: `Space` is
  also the reroll shortcut and must not fire twice.
  The row order comes from `legendKeys(result)`, which forwards to
  `TerraCore.legendOrder(result)` — classes present on this world, biggest
  first. The `k` cycle walks that same array, so the key follows the
  order on screen instead of the order the palette declares. Like the click it
  pins, so it writes the hash; unlike `solo` and `band` it is not a preview.
  The CLI's `classes` column reads the same lookup, so the ranking is written
  once: the sort lives in the core, and each reader is a call rather than a
  second copy that could be edited apart from the rows on screen. The suite
  counts both forwards beside the one tie-break.
  The suite re-derives that order from `stats.counts` and asks that it differs
  from the palette's own declaration for at least one world, so the sort cannot
  be dropped without the list losing its biggest-class-first reading.
  Two classes can cover the same number of cells, so the comparison ends with a
  tie-break on the palette's own key order (`declared.indexOf(a) -
  declared.indexOf(b)`). Without it the pair's order is whatever this engine's
  sort happens to produce, and the same seed lists its rows differently on two
  machines — which also flips the `k` cycle that walks the same array. The suite
  compares the lookup against a hand-written insertion sort (stable by
  construction) over three tied fixtures plus every phrase, since a generated
  grid rarely hands two classes the same count on its own.
  The `classes` column of the CLI record is that same ranking, tie-break
  included, so a terminal and the sidebar cannot put one pair in two orders.
  The suite compares the column against the insertion pass the legend
  assertion uses.
  `stats.counts` is the partition behind those rows: every cell lands in exactly
  one class, so the counts sum to `stats.pixels` and no listed class is empty.
  The smoke suite checks that on every hand-picked phrase, along with the
  sentence's `mostly X` naming the same biggest class the first row does.
  That one partition is also the `biomes` row, the rows of the legend and the
  `classes` column of the CLI record, so the suite counts all three on one world
  and asks for the same number: a class counted but not drawn would drop a row
  off the legend while the stats still said it was there, and the swatch keeps a
  palette-derived fallback for exactly that case.
  That swatch is also the one colour the page paints outside the two canvases,
  and it prints its triple through `rgba(c, 1)` like every mark on the map. A
  hand-built `'rgb(' + …` beside it could keep a triple the printer rounds and
  it does not, which reads as a swatch a shade off its own row — close enough
  to look right in a screenshot, so the suite asks for the one read through the
  printer and for no bare triple left beside it.
  The count of occupied classes is one lookup — `TerraCore.biomeCount(counts)` —
  that the `biomes` row and the record's `biomes` field both read, since the
  classification pass only writes a key when it hands that key a cell. Two
  bodies could disagree about whether a zero entry counts, and the row beside
  the chart would then name a different number of classes than a terminal
  prints. The suite asks for the core's definition, the shell's forward and the
  CLI's lookup, so a third copy has to be written down rather than implied.
  A row's label comes from `biomeNames` with the raw key as its fallback, so the
  two key sets have to be identical in every scheme: a colour key with no name
  would print as `taiga`, a name with no colour could never be drawn. The suite
  compares both directions for each entry of `core.palettes`, so a scheme that
  renames one key in its own table is caught even when the default scheme is
  fine — the legend of that scheme alone would read differently.
  That fallback is written once — `biomeLabel(key)` in the shell — and every
  view that names a biome reads it: a legend row, the chart's hovered-bin
  label, the hover readout, its mismatch note and the line under the map. Two
  bodies could disagree about a key the table does not know, one printing the
  raw key and one printing nothing, while each still looked reasonable beside
  the other. The suite counts the one definition, the six uses and the two
  reads of the table itself — the helper's own lookup and the hash reader's
  existence test, which keeps a pin rather than naming it.
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
  That pair of columns is one builder — `listingRow(key, text)` — read by all
  six, so a listing added later lines up with the ones already here. Six
  separate pad calls could be edited apart while each listing still looked tidy
  on its own, and the columns a reader scans would then stop matching between
  one flag and the next; the suite counts the definition, the six reads and the
  one padding call left inside the helper. The numbered phrase column is outside
  that pair on purpose: its first field is a count rather than a name, so it
  keeps its own narrow width beside its loop.
  Two of those lists open with an entry that has no key of its own — the plain
  biome map among the overlays, the `auto` count among the grids — and each
  needs a word beside it in every print. That word is one lookup,
  `entryName(list, entry)`, which reads the first label of the list it is handed
  rather than a spelling written beside the print: five reads in all (the
  overlay usage line, the two summary lines and the two listing rows). Written
  at each site the pair could be edited apart while each listing still looked
  right alone — a usage line naming `plain` above a column naming `biome` for
  one and the same overlay — so the suite counts the definition, the five reads
  and asks for no leftover word beside them.
  Each curve must also be its own picture: the suite renders one seed through
  every entry and compares the checksums, so a new curve that only re-skims an
  existing one loses its slot in the `h` cycle rather than diluting it.
  `core.channels` is the third of these lists: the overlay ramps, with the
  empty-key entry first so "no overlay" is always the default selection. The
  channel dropdown, the `c` cycle and the smoke overlay loop all read that one
  array — add a ramp there, never in `app.js`.
  On the page side all six selects are filled by one `fillOptions(select, items)`
  loop, since each list is `{key, label}` pairs from the core: the key becomes
  the option's value — what a link stores — and the label its text. Six copies
  of that loop could be edited apart while each still looked right, so the suite
  counts the one definition, a call per select and a single option builder.
  The palettes are the one list that needs a step before that loop: the scheme
  table is a map rather than an array, so its keys come out through
  `paletteKeys()`. Two readers take that order — the dropdown builder and the
  digit keys — and both go through the lookup, since a pair written out in full
  could be edited apart, one sorting the keys and one keeping declaration order.
  That would make `3` pick a different scheme from the third row of the
  dropdown, which reads as an odd choice rather than as a bug, so the suite
  counts the definition, the two reads and the single `Object.keys` inside it.
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
  The block walk runs over every entry of `core.scales`, not just one factor:
  dimensions alone would also pass for a smoothing resize, which saves a softer
  picture than the one on screen while reporting the same counts.
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
  Those three attributes are read through `num()` itself — the same forward to
  the core's rule that every other numeric read uses — since the pair the nudge
  writes goes into the hash, and a reader that kept the leading digits of a
  value would move the shoreline to a level the option reader had already
  thrown away. Restating `Number` beside that helper would let the two drift:
  the slider would keep `80x` while the option reader threw it away. Each bound
  is applied only when it reads, so the markup stays the single source of the
  range; the suite scrapes that branch for the four `num()` reads, the
  `isFinite` test behind them, and no bare `Number(` left beside them.
  The palette digits are a numeric read of that same kind: the key names a
  position in `TerraCore.palettes`, so the digit goes through `num()` too rather
  than a `parseInt` beside it. Two readings could disagree about a value with
  junk on the end — one keeping the leading digits, one rejecting the whole
  thing — which would pick one scheme from a terminal and another on the page.
  The suite asks that branch for the one `num()` read and no `parse*` call.
  That branch also has to shed the float drift a run of steps leaves behind, and
  it does so on the scale every other figure prints at — one `hundred(nextSea)`
  divided back out of a hundred, rather than a second rounding written beside
  it. Cut finer than the rows next to the slider, the control would hold a level
  no readout on the page can name; the suite asks for that one read and no bare
  `Math.round(nextSea` left in the branch.
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
  The gap between that rule and its number is one measure — `LEAD`, four CSS
  pixels — which is the lead on whichever side the label lands and twice itself
  in the flip test. Written beside each site the pair could be edited apart,
  which puts the figure nearer the line on one side of the chart than on the
  other, so the suite counts the one number, its reads and asks for no bare gap
  left beside them.
  That rule is also the wet/dry split of the bars, so it has to agree with the
  counted `water` share: the suite walks each phrase at three sea levels and
  asks that both figures rise together and land in the same neighbourhood. A
  second source for the rule — the median, or a fixed pixel — would read against
  the `water` row sitting right beside the chart.
  The median mark prints its number in the same bottom strip, squeezed between
  the two corner labels: measure all three first and skip the median label when
  the strip cannot hold the whole row, rather than overlapping the corners.
  That squeeze is one gap — `GAP`, four CSS pixels — since four measurements
  read it five times: each of the two bounds uses it on both sides of its own
  comparison, and the fit test scales it up once. Written beside each site the
  pair could be edited apart, which leaves a median printed on top of its own
  corner number — still a plausible chart at a glance — so the suite counts the
  one number, its reads and asks for no bare gap left beside them.
  Those marks all sit inside one inset — `GUT`, three CSS pixels — which is the
  gutter every non-bar mark is measured from: the two tick bounds, both corner
  labels, the three comparisons of the median squeeze, the width a hovered
  caption may fill and the pill behind it. Twelve reads of one number, since a
  gutter written beside each site could be edited apart, which lets a corner
  label sit closer to its edge than the tick under it — close enough to read as
  a slightly odd chart, so the suite counts the one number, its twelve reads and
  asks for no bare gutter left beside them.
  Those three labels also sit on one baseline — `BASE`, one CSS pixel up from
  the strip's bottom edge — since a second offset written beside one of them
  would drop that figure a pixel below the others, which reads as two rows of
  numbers rather than one. The hovered bin's caption is its own row at the top
  of the chart, so it stays outside this pair; the suite counts the one number,
  its three reads and asks for no bare offset left in that strip.
  That caption is the one label in the chart with a box behind it, and the
  padding of that box is one number too — `PILL`, two CSS pixels — since the
  fill starts that far left of the text and grows by twice itself. Written
  beside each call the pair could be edited apart, which pads the box deeply on
  one side and tightly on the other — an asymmetry small enough to read as a
  stray mark rather than as a bug, so the suite counts the one number, its two
  reads and asks for no bare offset left in that box.
  That box and the caption inside it are one row too — `CAP`, thirteen CSS
  pixels — since the fill is that tall and the ink sits two pixels above its own
  bottom edge. Written beside each call the pair could be edited apart, which
  leaves a caption riding low in a box grown taller around it, so the suite
  counts the one number, its two reads and asks for no bare height or baseline
  left beside them.
  The decade ticks under the bars do not use a fixed ten-unit step: the step is
  the first of 5/10/20/25/50 that leaves at most ten marks over this world's own
  relief. A flat craton would otherwise get one tick, a tall fjord twenty.
  The candidate list and that rule live in `core.tickStep(units)`, which the
  chart calls through `TerraCore.tickStep` and the smoke suite walks over every
  shape — one formula for "readable by eye", so a chart cannot quietly drift to
  a spacing the tests never saw. Keep the helper in the core; the shell only
  reads it.
  "Reads it" is checked rather than assumed: the suite counts one
  `TerraCore.tickStep(` lookup in the shell and asks that the shell hold no copy
  of the ladder, so a second list cannot be edited into a different spacing than
  the one the tests walk. The suite also re-picks the step by hand over a spread
  of reliefs, which is what pins the choice to the TIGHTEST step that fits — a
  helper that returned the last candidate instead of the first would still leave
  at most ten marks, while spacing a flat world's ticks wider than it needs.
  A tick that would land under one of the corner numbers is skipped rather than
  drawn short, and the tolerance for that skip is one number — `SLACK`, one CSS
  pixel — read by both bounds of the strip. Written beside each bound the pair
  could be edited apart, which crowds the ticks toward one corner while the
  other stays empty: an asymmetry small enough to read as a slightly odd chart
  rather than as a bug, so the suite counts the one number, its two reads and
  asks for no bare tolerance left in those bounds.
  The number of bars follows the same rule through `core.binCount(cssWidth)`:
  one bar per five CSS pixels, clamped 20..72. The clamp ends are part of the
  contract, not decoration — the suite asks that a narrow strip reaches the
  floor and a wide one the ceiling, so a band that never engages is caught
  rather than mistaken for a formula. Keep the count out of the shell too.
  Both canvases size their backing store through one `pixelScale()` — the
  clamp on `devicePixelRatio` between 1 and 2. The map blits its cells at that
  scale and the chart scales its own context by it, so a phone at 3x gets two
  of the same picture rather than a sharp grid under a soft strip. Two copies
  of the clamp could be edited apart while each still looked reasonable, so the
  suite counts the one definition and the two reads beside it.
  Converting a CSS measurement into that store is one lookup too —
  `bufferSize(cssPx, dpr)` — read four times: twice for the map's layout box and
  twice for the chart's column. Both round, since a fractional store puts every
  cell edge between two pixels. Written beside each canvas, one of them could
  truncate instead and still look sharp on its own, while the map and the strip
  under it disagreed about how wide a device pixel is; the suite counts the
  definition, the four reads and the single `* dpr)` inside the helper.
  Those two canvases also draw four thin marks — the crosshair's pair of
  hairlines, the sea rule, the decade ticks and the median mark — and every
  stroke coordinate goes through one `hairline(x)`, which rounds and adds the
  half pixel a one-pixel line needs to land on a whole device pixel. Written at
  each site the offset can be dropped on one mark only, which leaves a single
  soft line beside three crisp ones — a difference small enough that nobody
  opens the console over it, so the suite counts the definition, the eight
  reads and asks for no bare `Math.round(...) + 0.5` left beside them.
  The width those marks are stroked at is one number as well — `HAIR` — read by
  the three of them: the crosshair's pair of hairlines, the border of the
  magnifier's mat and the sea rule. Each sits over its own background at its own
  alpha, so the alpha is written per mark while the width is not. Written beside
  each stroke, one mark could grow a second pixel while the others stayed thin,
  which reads as a stray line across the chart rather than as a bug — close
  enough to a working cursor that nobody opens the console over it. The suite
  therefore counts the definition, the three reads, and asks that no bare
  one-pixel width be left written beside them. The box around a hovered cell
  keeps its own width on purpose, since that one scales with the cell.
    That share is one fraction — `BOX`, a quarter of a cell with a one-pixel
    floor — read once beside the stroke it sets, so the frame cannot go thick on
    a coarse grid while its own crosshair stayed thin.
  Those same three chart marks are also placed by one lookup —
  `chartX(value, lo, span, w)` — since each is a height over the range the bars
  were binned over, times the chart's width. Written at each site, one mark
  could drop its subtraction of the low end and still land inside the box, so a
  sea rule sitting a few pixels from its own column of bars reads as a slightly
  odd chart rather than as a bug. The suite counts the definition, the three
  reads and asks that the only division of that shape left in the shell be the
  one inside the helper.
  The label over a hovered bar is a shrink-to-fit loop rather than a fixed
  string, since the caption names a bin, a count and a class and a narrow
  sidebar cannot hold all three. That loop is one `fitLabel(hc, parts, limit)`
  — it drops the last field until the measured width fits — so the two joins
  of its two-space gap sit in the helper and not beside the call. Written at
  the call site, a label could be measured with one separator and printed with
  another, which reads as a caption that truncates a field too early. The
  suite counts the definition, the single read and asks that both joins be the
  only ones in the shell.
  Inside that same pass the box ink is set once — a stroke style plus the
  border width, a quarter of a cell and never less than one pixel — and the
  hairlines are drawn between a `save()` and a `restore()`, which puts that
  pair back on its own. Re-stating it after the restore is one more place the
  border can be edited, and letting the hairline's own ink leak into the box
  is the bug the first copy avoids, so the suite asks for one of each: one
  stroke style, one width, one save and one restore.
  Each axis of the grid is then snapped by one `snapCell(boxes, count)`: a cell
  at least two device pixels wide is rounded and its count trimmed to whatever
  still fits, below two pixels the axis keeps its fractional size and stretches
  to fill. Both axes read that one helper, so a wide window cannot snap its
  columns while its rows stayed fractional — that pair reads as cells of two
  different shapes in one picture. The suite counts the definition, the two
  calls and asks for no second copy of the snap left in the renderer.
  Before that snap, the two axes also count themselves by one rule when no
  column count is pinned: one cell per three CSS pixels, with a floor per axis
  so a small window still shows relief rather than a few huge blocks. That
  divisor is one `autoCount(px, floor)` read twice — once per axis — rather
  than two divisions beside the grid comment. Written at each site the pair
  could be edited apart, a wide axis on three pixels and a tall one on four,
  which reads as rectangular cells in an unpinned window while every pinned
  count still looks right. The suite counts the definition, the two reads and
  asks for no bare division by that divisor left beside them.
  When a count is pinned, the other axis follows the canvas aspect and needs a
  single bound: a floor so a very wide window still gets a world rather than a
  ribbon. That floor is one `MINROWS` beside the derivation, since the two auto
  counts already carry their floors as arguments — a third literal would be a
  second place the shape of a small window is decided. The suite counts the one
  number, its read and asks for no bare floor left beside them.
  The one handler that fires without being asked is `resize`: dragging a window
  edge fires one event per pixel, and each would rebuild the grid. The listener
  schedules a single `render()` through `requestAnimationFrame` behind a
  `pendingResize` flag, cleared inside the callback so a burst collapses to one
  rebuild — the last size in the burst is the only one that matters, since the
  world depends on the seed and not on the window. Keep the flag reset inside
  the callback; resetting it before scheduling would let every event in the
  burst queue its own render again.
- Both prose files are read in a terminal, where a sentence that appears twice
  is one the reader has to diff by eye. The suite asks each of them for no line
  identical to the line above it, which is the shape a half-applied edit leaves
  behind. Keep notes in one place: a convention belongs in AGENTS.md, the
  reader-facing description in README.md, and neither repeats itself.

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
