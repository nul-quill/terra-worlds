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

Verify with:

1. `node tests/smoke.js`
2. open `index.html` in the integrated browser, move a slider, hover the map,
  hover a legend row, toggle `grain` and `lines`, click Reroll and Save PNG.
  The relief histogram at the bottom of the sidebar should follow the `sea` slider,
  and hovering one of its bars should print that bin's range inside the chart.
