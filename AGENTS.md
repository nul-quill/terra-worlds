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
- The trunk/tributary split is a second quantile of the SAME accumulation field
  (`majorCut`), never a separate threshold. `riverMask` holds 1 or 2.
- Hypsometric band count is derived from the relief above the shoreline
  (`contourBands`, clamped 6..20) and published in `stats`, so a flat craton
  does not turn into stripes. Keep it derived, not a fixed constant.
  The water gets its own count from the depth range (`basinBands`, clamped 3..12)
  drawn by the same `contour` switch. Both stay derived, never constants.
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
- `stats.checksum` is FNV-1a over the rendered RGBA buffer, as eight hex digits.
  It is the cheap equality test for determinism: same seed + same grid must give
  the same digits, while `stats.ms` is allowed to wander. Keep the multiply in the
  shift-add form so it stays inside 32 bits.
- `nextSeed(value)` derives the next seed from the current one (FNV-1a over the
  phrase plus a `\u0001` separator). The Reroll button and `cli.js --next n` both
  use it, so a click sequence is reproducible from the first phrase. Do not
  replace it with a plain `randomSeed()` call in the button.
- Letter shortcuts (`c`, `g`, `l`, `s`) are skipped while an INPUT or SELECT owns
  the caret, so a seed phrase can still be typed. `styles.css` ends with two
  `@media` blocks: `print` (hides the chrome, one column) and
  `prefers-color-scheme: dark` (only the CSS variables change). Both are checked
  with `page.emulateMedia()` followed by a reload.
- Legend isolation lives in `drawMap()`: `solo` follows the pointer/focus,
  `pinned` is the click selection and survives a reroll. Both blend non-matching
  cells toward the palette sky in that one loop — do not add a second blend
  path, or hover and click will disagree about the result.
- `cli.js --palettes` lists the palette keys from `core.palettes`, so a name
  copied from the terminal is always valid for `--palette`. The smoke suite
  compares that listing against `Object.keys(core.palettes)` — keep both in step.
  The sea-level rule in the relief chart also prints its value; set the chart
  font before `measureText` so the flip-to-fit test is accurate.

Verify with:

1. `node tests/smoke.js`
2. open `index.html` in the integrated browser, move a slider, hover the map,
  hover a legend row, walk the cursor with the arrow keys, toggle `grain` and
  `lines`, click Reroll and Save PNG.
  The relief histogram at the bottom of the sidebar should follow the `sea` slider,
  and hovering one of its bars should print that bin's range inside the chart.
  Hovering the map highlights the hovered cell's bin in that same chart.
