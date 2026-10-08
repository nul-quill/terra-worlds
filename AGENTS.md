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
- Moisture is not a standalone field: the orographic pass in `generate` folds the
  relief into it, so ridges get a windward wet band and a leeward rain shadow.
  Keep it a per-row sweep — it is O(n) and must stay that way.

Verify with:

1. `node tests/smoke.js`
2. open `index.html` in the integrated browser, move a slider, hover the map,
   click Reroll and Save PNG.
