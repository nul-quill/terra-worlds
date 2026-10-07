# Terra

Deterministic procedural pixel-art world generator. Zero dependencies, zero build
step: open `index.html` in any browser, or run the CLI with Node.

```
node tests/smoke.js     # headless checks
node cli.js "aurora basin" --width 320 --height 200 --out world.ppm
```

## What it does

Every world is a pure function of a seed string. The same seed renders the same
pixels on any machine, at any window size, in the browser or from the CLI.

Pipeline, all on the CPU:

1. **Height** — fBm value noise blended with a ridged multifractal for mountain
   spines, then a shape curve (`continents`, `islands`, `atolls`, `craton`) and an
   optional high-frequency detail term.
2. **Climate** — a moisture field plus a latitude-driven temperature band, mixed
   with a low-frequency noise so zones are not pure horizontal stripes.
3. **Drainage** — cells are visited highest-first and each one pushes its
   accumulation into its lowest neighbour, which yields dendritic river networks
   without any per-frame work.
4. **Biomes** — a temperature x moisture lookup gives 11 land/water classes; coast
   cells, polar ice caps and alpine rock are resolved on top.
5. **Shading** — a hillshade from the height gradient, a 4x4 Bayer dither to kill
   banding, and depth falloff under water.

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
