/*
 * Terra core — deterministic procedural pixel-art world generator.
 * No dependencies, no build step. Works in the browser and in Node.
 * Exposes a single global: TerraCore.
 */
(function (global) {
  'use strict';

  var B1 = 374761393, B2 = 668265263, B3 = 2246822519, B4 = 1274126177;

  /* ------------------------------------------------------------------ *
   * Hashing / seeding
   * ------------------------------------------------------------------ */

  // FNV-1a: turn any seed string into a stable 32-bit int.
  function hashString(str) {
    var h = 2166136261 >>> 0;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Integer lattice hash -> [0,1).
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix | 0, B1) ^ Math.imul(iy | 0, B2) ^ Math.imul(seed | 0, B3);
    h ^= h >>> 13;
    h = Math.imul(h, B4);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // Smallest span a division may see. Every height range on the page is a
  // difference of two levels, and a flat world makes that difference zero:
  // the two band counts, the depth shading under water, both contour ramps and
  // the chart's bin range all divide by such a span, so one floor keeps a
  // level craton from turning those six readings into NaN. Written at each
  // site the guard could be cut against another scale, which reads as one
  // view going blank on a world the other five still describe.
  function spanFloor(value) {
    return Math.max(0.001, value);
  }

  // Where a value sits inside the pair of cuts its overlay was scaled between.
  // Both readers of a scale — the ramp that paints the overlay and the hover
  // that prints the number under the cursor — are that one division held
  // inside the pair, so they share it. Written beside each reader the
  // subtraction of the low end could be dropped on one of them, which prints a
  // figure beside a colour that was measured from a different floor.
  function scaleShare(v, sc) {
    return clamp01((v - sc.lo) / (sc.hi - sc.lo));
  }

  // The value a scale is measured against. Two of the heavy-tailed fields are
  // read through a log so a long tail does not collapse the ramp into one
  // colour, and both readers of that pair — the ramp and the hover — want the
  // same transform. Written beside each reader the log could be dropped on one
  // of them, which prints a number for a cell whose colour was mixed against
  // another curve: still a plausible gradient beside its own caption.
  function scaleValue(v, useLog) {
    return useLog ? Math.log(1 + v) : v;
  }

  // Bounds on one shaded pixel. The two ends are one decision — how far a
  // slope may darken or lighten its own colour — so they are written together:
  // a low end kept beside the call and a high end kept beside the helper could
  // be edited apart until the shade of a lit face no longer matched the shade
  // of its own shadowed one.
  function shadeClamp(sh) {
    if (sh < 0.62) return 0.62;
    if (sh > 1.22) return 1.22;
    return sh;
  }

  // One grain step for a cell. The divisor is the top of the bayer table — the
  // largest entry it holds — and the amplitude is how far that step may move a
  // pixel's shade. Both belong to the grain rather than to the caller, so the
  // table's own span is measured from the table: a divisor written beside the
  // call could be edited away from the entries it divides, which would shift
  // every cell's grain by a constant while still reading as a dither.
  function ditherOffset(bayer, x, y) {
    var top = bayer.length - 1;
    var step = bayer[((y & 3) << 2) | (x & 3)] / top;
    return (step - 0.5) * 0.05;
  }

  // Every quantile in this generator starts by putting a field in order, and
  // every one of those sorts is the same comparison of two numbers. Written at
  // each sort the tie on the field's own value could be dropped from one of
  // them, which leaves a cut taken from a different cell each run while the
  // sorted list still looks ordered beside its own caption.
  function byNumber(a, b) {
    return a - b;
  }

  // Which entry of a sorted field a given share of it falls on. Both river
  // cuts — the network's own and the trunk slice taken from the same list —
  // are that one position, so the clamp that keeps the last entry reachable
  // is written once. Held beside each cut the clamp could be dropped from one
  // of them, which lets a trunk cut read past the end of its own list and come
  // back undefined while the network beside it still looked right.
  function quantileIndex(share, n) {
    return Math.min(n - 1, Math.round(share * (n - 1)));
  }

  // How much a filled cell keeps of its own colour at a given depth. The sea
  // and a tarn both dim by that one shape — a full-depth cell keeps its colour
  // less the basin's own strength — so the two fills share the arithmetic and
  // differ only in the strength they pass. Written beside each fill the shape
  // could be edited apart until a tarn graded its depth on a curve the open sea
  // did not use, which still reads as two plausible basins side by side.
  function depthWash(depth, strength) {
    return 1 - depth * strength;
  }

  // How far a cell above the snow line has faded toward the ice colour. The
  // width of that ramp and the share it reaches are both properties of the cap
  // rather than of its caller, so they are written once here beside the level
  // the cap starts from. Written beside the call the pair could be edited away
  // from that level — a cap that finished its fade a hundredth of a unit too
  // early still reads as snow at a glance.
  function snowFade(h) {
    return clamp01((h - SNOW_LINE) / 0.16) * 0.85;
  }

  // How much of the shallow colour a river cell takes on. A trunk is drawn
  // harder than its tributaries, and a mouth — the last cell before the sea —
  // spreads past both, capped so a wide mouth still reads as a channel rather
  // than as a pond. All four scalars belong to that one decision, so they are
  // written together here: split across the two statements at the call site a
  // tributary could end up inked harder than its own trunk, which still looks
  // like a plausible network at a glance.
  function riverMix(rank, mouth) {
    var mix = rank === 2 ? 0.72 : 0.50;
    return mouth ? Math.min(0.9, mix + 0.18) : mix;
  }

  // Where a cell sits inside its own contour band: the fraction past the last
  // line. Both the land ramp and the bathymetric one are that same fraction of
  // their own count, so the wrap is written once — a pair of copies could be
  // cut differently while each still looked like a set of evenly spaced lines,
  // which reads as two grids of stripes rather than one.
  function bandEdge(t, count) {
    return t * count - Math.floor(t * count);
  }

  // One channel of a pixel on a contour line: the height it had, scaled by the
  // strength of that line. Land lines press a channel down and bathymetric ones
  // lift it, so only the strength differs between the two ramps — the shape of
  // the blend is the same. Written beside each ramp the pair could be edited
  // apart until the stripes above the shoreline and the ones under it stopped
  // looking like one grid of lines.
  function lineChannel(value, strength) {
    return value * strength;
  }

  // Does any neighbour of this cell sit on the other side of the shoreline?
  // The coast ink and a river mouth both ask that question of the same four
  // cells, so the sweep is one helper: written beside each call the pair could
  // be edited apart until a coastline recognised a neighbour its own river
  // mouth ignored, which reads as a mouth sitting a cell off the shore.
  function acrossShore(hf, i, width, height, x, y, seaLevel, dry) {
    function at(v) { return dry ? v >= seaLevel : v < seaLevel; }
    return (y > 0 && at(hf[i - width])) ||
      (y < height - 1 && at(hf[i + width])) ||
      (x > 0 && at(hf[i - 1])) ||
      (x < width - 1 && at(hf[i + 1]));
  }

  // Is neighbour (hv,hi) a valid downhill step from (bv,bi)? Equal heights are
  // resolved by index, which keeps the flow graph acyclic on flat plateaus.
  function lower(hv, hi, bv, bi) {
    return hv < bv || (hv === bv && hi > bi);
  }

  function smoothstep(a, b, x) {
    var t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  }

  /* ------------------------------------------------------------------ *
   * Value noise. Lattice counts are integers and every octave doubles
   * them, so the field wraps seamlessly on both axes.
   * ------------------------------------------------------------------ */

  function wrap(v, m) {
    return ((v % m) + m) % m;
  }

  function valueNoise(x, y, nx, ny, seed) {
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    var sx = fx * fx * (3 - 2 * fx);
    var sy = fy * fy * (3 - 2 * fy);
    var a = wrap(x0, nx), b = wrap(x0 + 1, nx);
    var c = wrap(y0, ny), d = wrap(y0 + 1, ny);
    var v00 = hash2(a, c, seed), v10 = hash2(b, c, seed);
    var v01 = hash2(a, d, seed), v11 = hash2(b, d, seed);
    var i0 = v00 + (v10 - v00) * sx;
    var i1 = v01 + (v11 - v01) * sx;
    return i0 + (i1 - i0) * sy;
  }

  // Fractal Brownian motion over the tiling value noise.
  function fbm(x, y, nx, ny, seed, octaves) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * valueNoise(x * freq, y * freq, nx * freq, ny * freq, seed + o * 7919);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // Ridged multifractal: sharp crests, good for mountain spines.
  function ridged(x, y, nx, ny, seed, octaves) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var o = 0; o < octaves; o++) {
      var n = valueNoise(x * freq, y * freq, nx * freq, ny * freq, seed + o * 6151);
      n = 1 - Math.abs(n * 2 - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /* ------------------------------------------------------------------ *
   * Palettes: biome key -> rgb triple.
   * ------------------------------------------------------------------ */

  var PALETTES = {
    terra: {
      label: 'Terra',
      sky: '#eef3ef',
      colors: {
        deep: [43, 86, 108], shallow: [92, 158, 178], beach: [214, 199, 143],
        lake: [126, 176, 170],
        grass: [110, 160, 82], forest: [61, 120, 71], rain: [44, 106, 68],
        seasonal: [96, 143, 96], savanna: [180, 166, 96], shrub: [136, 152, 110],
        desert: [213, 178, 108], taiga: [74, 116, 100], tundra: [181, 193, 176],
        ice: [236, 243, 245], rock: [140, 138, 128]
      }
    },
    mars: {
      label: 'Mars',
      sky: '#f3ece4',
      colors: {
        deep: [96, 74, 66], shallow: [140, 106, 88], beach: [206, 168, 130],
        lake: [168, 128, 104],
        grass: [186, 138, 96], forest: [150, 100, 72], rain: [128, 88, 66],
        seasonal: [172, 128, 90], savanna: [198, 156, 108], shrub: [160, 122, 92],
        desert: [222, 186, 140], taiga: [132, 92, 74], tundra: [214, 196, 176],
        ice: [246, 240, 234], rock: [112, 84, 70]
      }
    },
    alien: {
      label: 'Alien',
      sky: '#f0eef6',
      colors: {
        deep: [38, 62, 92], shallow: [72, 148, 168], beach: [226, 214, 168],
        lake: [104, 178, 176],
        grass: [122, 196, 156], forest: [58, 148, 140], rain: [40, 128, 122],
        seasonal: [140, 190, 140], savanna: [196, 190, 128], shrub: [150, 170, 150],
        desert: [226, 190, 130], taiga: [86, 132, 148], tundra: [196, 208, 206],
        ice: [240, 246, 250], rock: [128, 116, 148]
      }
    },
    blueprint: {
      label: 'Blueprint',
      sky: '#f6f8fa',
      colors: {
        deep: [28, 48, 78], shallow: [58, 96, 130], beach: [196, 212, 224],
        lake: [128, 158, 186],
        grass: [124, 160, 186], forest: [70, 110, 148], rain: [48, 88, 126],
        seasonal: [104, 138, 166], savanna: [150, 176, 196], shrub: [132, 154, 172],
        desert: [206, 218, 228], taiga: [86, 118, 146], tundra: [186, 200, 212],
        ice: [244, 248, 251], rock: [96, 116, 136]
      }
    },
    sepia: {
      label: 'Sepia',
      sky: '#f7f2e8',
      colors: {
        deep: [92, 78, 60], shallow: [138, 118, 90], beach: [222, 205, 172],
        lake: [176, 158, 126],
        grass: [168, 148, 106], forest: [120, 104, 72], rain: [96, 84, 60],
        seasonal: [150, 132, 96], savanna: [190, 170, 124], shrub: [156, 140, 108],
        desert: [226, 206, 166], taiga: [130, 112, 82], tundra: [208, 196, 174],
        ice: [248, 244, 236], rock: [110, 96, 76]
      }
    },
    mono: {
      label: 'Mono',
      sky: '#ffffff',
      colors: {
        deep: [58, 62, 66], shallow: [104, 110, 116], beach: [226, 228, 230],
        lake: [140, 146, 152],
        grass: [168, 172, 176], forest: [120, 126, 130], rain: [92, 98, 102],
        seasonal: [146, 152, 156], savanna: [186, 190, 194], shrub: [158, 164, 168],
        desert: [212, 214, 216], taiga: [132, 138, 142], tundra: [200, 203, 206],
        ice: [246, 247, 248], rock: [110, 114, 118]
      }
    }
  };

  var BIOME_NAMES = {
    deep: 'Deep water', shallow: 'Shallows', beach: 'Coastal sand',
    lake: 'Inland lake',
    grass: 'Grassland', forest: 'Temperate forest', rain: 'Rain forest',
    seasonal: 'Seasonal forest', savanna: 'Savanna', shrub: 'Shrubland',
    desert: 'Desert', taiga: 'Boreal forest', tundra: 'Tundra',
    ice: 'Ice', rock: 'Alpine rock'
  };

  /* ------------------------------------------------------------------ *
   * Biome lookup: temperature band x moisture band.
   * ------------------------------------------------------------------ */

  function biomeFromTempMoist(t, m) {
    var tb = t < 0.26 ? 0 : t < 0.46 ? 1 : t < 0.70 ? 2 : t < 0.86 ? 3 : 4;
    var mb = m < 0.34 ? 0 : m < 0.66 ? 1 : 2;
    var table = [
      ['tundra', 'tundra', 'ice'],
      ['shrub', 'taiga', 'taiga'],
      ['grass', 'seasonal', 'forest'],
      ['savanna', 'grass', 'forest'],
      ['desert', 'savanna', 'rain']
    ];
    return table[tb][mb];
  }

  /* ------------------------------------------------------------------ *
   * Height shaping curves.
   * ------------------------------------------------------------------ */

  // The shapes the height field can be cut from, in the order the dropdown
  // lists them. Each one is a curve in shapeHeight below, so the list is the
  // single source of truth for both the page and `cli --shapes`.
  var SHAPES = [
    {key: 'continents', label: 'continents', note: 'one landmass with inland seas'},
    {key: 'islands', label: 'islands', note: 'many islands on open water'},
    {key: 'atolls', label: 'atolls', note: 'ring rims around lagoons'},
    {key: 'craton', label: 'craton', note: 'flat interior, one mountain spine'},
    {key: 'fjord', label: 'fjord', note: 'plateau sawn by deep inlets'}
  ];

  function shapeHeight(h, shape) {
    if (shape === 'islands') {
      return Math.pow(clamp01(h), 1.35);
    }
    if (shape === 'atolls') {
      // Ring islands around a lagoon: a narrow band of the base field rises
      // above the sea, so the map reads as broken rims around open water
      // instead of one continuous continent.
      var band = 1 - Math.abs(h - 0.66) * 3.2;
      return clamp01(0.30 + Math.pow(clamp01(band), 2) * 0.62);
    }
    if (shape === 'craton') {
      // Broad flat interiors with a narrow mountain ridge.
      var base = smoothstep(0.28, 0.72, h);
      return clamp01(base * 0.72 + Math.pow(smoothstep(0.55, 0.98, h), 2) * 0.34);
    }
    if (shape === 'fjord') {
      // A high plateau sawn through by deep, narrow inlets: the ridge term is
      // kept high, and the sharp valley term cuts channels straight through it.
      // The valley term is the ridged field squared, so only the sharpest
      // crests bite and the interior stays flat-topped.
      return clamp01(Math.pow(clamp01(h), 0.85) * 0.86 + 0.06);
    }
    return clamp01(h);
  }

  // One side of the grid: a caller's count, rounded, held above the smallest
  // drawable size, falling back to this axis's own default. Both axes are that
  // same three-step reading, so they share it — written beside each axis the
  // floor could be dropped on one of them, which lets a very short window keep
  // its rows while its columns shrink to a ribbon, still a plausible shape for
  // a narrow browser.
  function gridSide(value, fallback) {
    return Math.max(16, Math.round(value || fallback));
  }

  // A neighbour for the shade pass. Every one of the four is the same shape:
  // step off this cell in one direction, unless that direction is already the
  // edge of the grid, in which case the cell reads itself. Written beside each
  // axis the step could be dropped on one of them, which measures a downhill
  // face harder than the uphill one it faces — a ridge leaning one way only,
  // still plausible relief at a glance.
  function shadeStep(hf, i, d, atEdge) {
    return hf[i + (atEdge ? 0 : d)];
  }

  /* ------------------------------------------------------------------ *
   * Main generation entry point.
   * Returns { width, height, data, biome, height, stats }.
   * ------------------------------------------------------------------ */

  function generate(options) {
    var opts = options || {};
    var started = Date.now();

    var width = gridSide(opts.width, DEFAULT_GRID.width);
    var height = gridSide(opts.height, DEFAULT_GRID.height);
    var seed = typeof opts.seed === 'number' ? opts.seed | 0 : hashString(opts.seed == null ? 'terra' : opts.seed);

    var seaLevel = opts.seaLevel == null ? 0.48 : clamp01(opts.seaLevel);
    var detail = opts.detail == null ? 0.35 : clamp01(opts.detail);
    var terraces = opts.terraces == null ? 0 : Math.round(opts.terraces);
    var hillshade = opts.hillshade == null ? 0.55 : clamp01(opts.hillshade);
    var polar = opts.polar == null ? 0.7 : clamp01(opts.polar);
    var riverMin = opts.rivers == null ? 90 : Math.max(0, Math.round(opts.rivers));
    var shape = opts.shape || 'continents';
    var dither = opts.dither !== false;
    // Hypsometric contours: thin bands at fixed height intervals. Off by
    // default because it is a drawing style, not a climate effect.
    var contour = !!opts.contour;

    var pal = PALETTES[opts.palette] || PALETTES.terra;
    var colors = pal.colors;

    // Lattice counts: proportional to aspect so cells stay roughly square.
    var cols = 5;
    var rows = Math.max(3, Math.round(5 * height / width));

    var n = width * height;
    var hf = new Float32Array(n);
    var mf = new Float32Array(n);
    var tf = new Float32Array(n);

    var x, y, i, u, v;
    for (y = 0; y < height; y++) {
      v = (y + 0.5) / height;
      for (x = 0; x < width; x++) {
        i = y * width + x;
        u = (x + 0.5) / width;

        var base = fbm(u * cols, v * rows, cols, rows, seed, 5);
        var crest = ridged(u * cols, v * rows, cols, rows, seed + 101, 4);
        var fine = fbm(u * cols * 4, v * rows * 4, cols * 4, rows * 4, seed + 202, 3);

        var h = base * 0.72 + crest * 0.28;
        h = shapeHeight(h, shape);

        // Fjord country: a second, sharper ridged field marks the channels, and
        // only its sharpest crests bite, so the plateau stays flat-topped while
        // the inlets are cut clean through to the sea.
        if (shape === 'fjord') {
          var ch2 = ridged(u * cols * 2, v * rows * 2, cols * 2, rows * 2, seed + 505, 2);
          h -= smoothstep(0.58, 1.0, ch2) * 0.34;
        }

        h = clamp01(h + (fine - 0.5) * detail);

        hf[i] = h;
        mf[i] = clamp01(fbm(u * cols + 11, v * rows + 7, cols, rows, seed + 303, 4));

        var lat = Math.abs(v * 2 - 1);
        var latT = 1 - lat * lat * 0.85;
        var noiseT = 0.5 + (fbm(u * cols + 31, v * rows + 17, cols, rows, seed + 404, 3) - 0.5) * 0.55;
        tf[i] = clamp01(noiseT * (1 - polar) + latT * polar);
      }
    }

    // Orographic moisture: a westerly airmass climbs the terrain and drops its
    // load, so the leeward side of a ridge comes out drier than the windward
    // side. Sweeping each row left to right is enough to get the effect, and it
    // keeps biome choice tied to the relief instead of an independent field.
    for (y = 0; y < height; y++) {
      var rowBase = y * width;
      var air = mf[rowBase];
      var prev = hf[rowBase];
      for (x = 1; x < width; x++) {
        i = rowBase + x;
        var dh = hf[i] - prev;
        if (dh > 0) air -= dh * 0.85;
        else air += -dh * 0.30;
        air += (mf[i] - air) * 0.35;
        prev = hf[i];
        mf[i] = clamp01(air);
      }
    }

    // Terracing: quantise the land only, so coastlines stay crisp.
    if (terraces > 1) {
      for (i = 0; i < n; i++) {
        if (hf[i] >= seaLevel) {
          hf[i] = (Math.floor(hf[i] * terraces) + 0.5) / terraces;
        }
      }
    }

    // Extremes of the finished height field: the colour pass and the stats
    // both want the actual range, which is narrower than 0..1 after the
    // shape curve and the detail term have done their work.
    var minH = hf[0], maxH = hf[0];
    for (i = 1; i < n; i++) {
      if (hf[i] < minH) minH = hf[i];
      else if (hf[i] > maxH) maxH = hf[i];
    }

    // Middle of the height field. Two worlds can share a range and still look
    // nothing alike — one is a broad plateau with a trench, the other a plain
    // with a single peak — and the median is what separates them. Sorted on a
    // copy so the field itself keeps its row-major order for the sweeps.
    var heights = new Float32Array(n);
    for (i = 0; i < n; i++) heights[i] = hf[i];
    heights.sort();
    var medianH = heights[n >> 1];

    // How many hypsometric bands the relief can carry. Counted above the
    // shoreline, because that is the span the lines are drawn across: a low
    // world gets a handful of wide steps, a jagged one gets more.
    // Both counts are the same shape — a multiple of a spread, held between a
    // floor and a cap — so the shape is one lookup. Written beside each count
    // the clamp could be dropped on one of them, which lets a flat craton turn
    // into stripes above its shoreline while its basins stayed in three wide
    // steps: still plausible bands, so the shape is what is counted.
    function bandCount(spread, mult, floor, cap) {
      return Math.max(floor, Math.min(cap, Math.round(spread * mult)));
    }

    var reliefAboveSea = spanFloor(maxH - seaLevel);
    var contourBands = bandCount(reliefAboveSea, 26, 6, 20);

    // The basin gets its own count from the depth range, so a shallow shelf
    // is not crossed by lines every few pixels while a deep ocean still shows
    // a few steps.
    var reliefBelowSea = spanFloor(seaLevel - minH);
    var basinBands = bandCount(reliefBelowSea, 22, 3, 12);

    /* ---- Drainage: flow accumulation over the height field. ---- */

    var sortArr = new Array(n);
    for (i = 0; i < n; i++) sortArr[i] = i;
    // Rank = height ascending, index descending. The index tie-break keeps the
    // order total, which matters once terracing creates flat plateaus.
    sortArr.sort(function (a, b) { return hf[a] - hf[b] || b - a; });

    var acc = new Float32Array(n);
    for (i = 0; i < n; i++) acc[i] = 1;

    var river = new Uint8Array(n);
    var lake = new Uint8Array(n);

    // Walk from the highest rank downwards, so every upstream cell has already
    // contributed by the time its outlet is visited. On an equal-height plateau
    // the outlet is the higher-indexed neighbour, which still drains it.
    for (var s = n - 1; s >= 0; s--) {
      i = sortArr[s];
      var cx = i % width, cy = (i / width) | 0;
      var bj = -1, bh = hf[i];
      if (cx > 0 && lower(hf[i - 1], i - 1, bh, i)) { bh = hf[i - 1]; bj = i - 1; }
      if (cx < width - 1 && lower(hf[i + 1], i + 1, bh, i)) { bh = hf[i + 1]; bj = i + 1; }
      if (cy > 0 && lower(hf[i - width], i - width, bh, i)) { bh = hf[i - width]; bj = i - width; }
      if (cy < height - 1 && lower(hf[i + width], i + width, bh, i)) { bh = hf[i + width]; bj = i + width; }
      if (bj >= 0) acc[bj] += acc[i];
    }

    /* ---- Distance to the nearest shoreline, by a two-pass chamfer sweep. ---- */

    // Every cell wants to know how far the sea is: the readout uses it, and it
    // is the cheapest way to tell a coast from a continental interior. Two
    // sweeps over the grid (forward, then backward) give a good approximation
    // of the city-block distance in O(n), with no queue.
    // Each sweep reads a neighbour as that neighbour's own distance plus one
    // step, and all four of those reads are the same shape. Written beside each
    // comparison the step could grow on one of them, which leaves a cell one
    // column further from the shore than the neighbour it was reached from —
    // still a plausible distance field, so the shape is held in one place.
    function stepFrom(field, j) {
      return field[j] + 1;
    }
    var dist = new Float32Array(n);
    var BIG = width + height;
    for (i = 0; i < n; i++) dist[i] = hf[i] < seaLevel ? 0 : BIG;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        var dmin = dist[i];
        if (x > 0 && stepFrom(dist, i - 1) < dmin) dmin = stepFrom(dist, i - 1);
        if (y > 0 && stepFrom(dist, i - width) < dmin) dmin = stepFrom(dist, i - width);
        dist[i] = dmin;
      }
    }
    for (y = height - 1; y >= 0; y--) {
      for (x = width - 1; x >= 0; x--) {
        i = y * width + x;
        dmin = dist[i];
        if (x < width - 1 && stepFrom(dist, i + 1) < dmin) dmin = stepFrom(dist, i + 1);
        if (y < height - 1 && stepFrom(dist, i + width) < dmin) dmin = stepFrom(dist, i + width);
        dist[i] = dmin;
      }
    }

    /* ---- Colour pass: biome + hillshade + dither. ---- */

    var data = new Uint8ClampedArray(n * 4);
    var biome = new Array(n);
    var counts = {};
    var landCells = 0, waterCells = 0, riverCells = 0, iceCells = 0;
    var trunkCells = 0;
    // How many separate basins the lake mask resolves into. Filled by
    // recordSpill(), which runs once per basin. A handful of large lakes and a
    // scatter of small ones look the same by cell count, so the count itself
    // is worth publishing.
    var lakeBasins = 0;

    // Light direction for the hillshade, normalised.
    // One of four compass directions, so relief can be lit from whichever side
    // reads best for the shape in play. Normalised, z always points at the viewer.
    var light = lightVector(opts.lightDir);
    var lx = light[0], ly = light[1], lz = light[2];
    var bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    // The cut is a fraction of the largest catchment rather than an absolute
    // cell count, so one slider value behaves the same on a small preview, a
    // large export, a flat craton and a fragmented island chain. The cut is a
    // quantile of the accumulation field: higher slider value keeps a larger
    // share of the network.
    var accSorted = new Array(n);
    for (i = 0; i < n; i++) accSorted[i] = acc[i];
    accSorted.sort(byNumber);
    var keep = 0.01 + clamp01(riverMin / 400) * 0.19;
    var qIndex = quantileIndex(1 - keep, n);
    var riverCut = accSorted[qIndex];
    // Major channels: the top slice of the same field. Drawn with a stronger
    // blend so a trunk river does not look like its own tributaries.
    var majorCut = accSorted[quantileIndex(1 - keep * 0.28, n)];

    // Lakes are closed depressions. A cell holds water when every route off it
    // climbs: compare its height against the lowest point on a ring of radius
    // RIM around it, and the gap between ring and cell is the water depth.
    // Two separable min filters (rows, then columns) give window minima in
    // linear time; the ring is the four window minima on the ring itself.
    var RIM = 4;
    // Both min filters walk a window of this radius over their own axis, and
    // both have to stop at the two ends of it. Written beside each loop the
    // pair could be edited apart, which lets a row window reach one cell past
    // its edge while its own column window stopped short — still a plausible
    // shore, so the shape of the clamp is what is held in one place.
    function windowSpan(pos, count) {
      return {
        lo: pos - RIM < 0 ? 0 : pos - RIM,
        hi: pos + RIM > count - 1 ? count - 1 : pos + RIM
      };
    }
    var rowMin = new Float32Array(n);
    for (y = 0; y < height; y++) {
      var row = y * width;
      for (x = 0; x < width; x++) {
        var wx = windowSpan(x, width);
        var m = hf[row + x];
        for (var k = wx.lo; k <= wx.hi; k++) { if (hf[row + k] < m) m = hf[row + k]; }
        rowMin[row + x] = m;
      }
    }
    var colMin = new Float32Array(n);
    for (x = 0; x < width; x++) {
      for (y = 0; y < height; y++) {
        var wy = windowSpan(y, height);
        var m2 = hf[y * width + x];
        for (var k2 = wy.lo; k2 <= wy.hi; k2++) { if (hf[k2 * width + x] < m2) m2 = hf[k2 * width + x]; }
        colMin[y * width + x] = m2;
      }
    }

    function ringMinimum(px, py) {
      var a = Math.max(0, py - RIM) * width + px;
      var b = Math.min(height - 1, py + RIM) * width + px;
      var c = py * width + Math.max(0, px - RIM);
      var d = py * width + Math.min(width - 1, px + RIM);
      var best = rowMin[a];
      if (rowMin[b] < best) best = rowMin[b];
      if (colMin[c] < best) best = colMin[c];
      if (colMin[d] < best) best = colMin[d];
      return best;
    }

    // Where a basin spills: the lowest cell just outside the filled area. A
    // lake is never the end of the hydrology — the surplus leaves over the
    // lowest point of the rim and cuts a channel on the way down.
    // The value is the basin's own number rather than a flag, so hovering the
    // outlet can name the lake it belongs to. Wide worlds get more than 255
    // basins, hence the wider type.
    var spill = new Uint16Array(n);

    // Which basin each lake cell belongs to, 1-based. Two lakes that look
    // alike on the map are different bodies of water, and the hover readout
    // can only say so if the fill leaves a label behind.
    var basin = new Uint16Array(n);

    // Which way each basin's surplus leaves, as a compass bearing. Indexed by
    // basin number minus one, so a hover can look it up from the label it
    // already has. Filled in recordSpill(), which runs once per basin.
    var basinSpill = [];

    // Eight-point compass. The grid grows y downwards, so a smaller y is
    // north; each bucket covers 45 degrees.
    var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

    function bearing(dx, dy) {
      var deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      var step = Math.round(deg / 45) % 8;
      if (step < 0) step += 8;
      return COMPASS[step];
    }

    // Lowest non-lake neighbour around a filled basin: that is where the
    // surplus leaves. Ties go to the higher index, matching the drainage
    // tie-break so the outlet is the same cell the walk would pick.
    function pickSpill(candidate, best, cap) {
      if (lake[candidate]) return best;
      // A tall rim on a terraced plateau can sit above the comfort cap; the
      // caller then retries without it, so a basin always has an outlet.
      if (cap && hf[candidate] >= seaLevel + 0.30) return best;
      if (best < 0) return candidate;
      // Prefer a rim cell no earlier basin has claimed. Two tarns sharing one
      // saddle otherwise leave the second write on top of the first label, and
      // the lake whose number was overwritten loses its `outlet of basin N`
      // reading even though its own fill is labelled fine. Height still breaks
      // ties between two free cells, so this only reshuffles equal rims.
      var freeCandidate = spill[candidate] ? 0 : 1;
      var freeBest = spill[best] ? 0 : 1;
      if (freeCandidate !== freeBest) return freeCandidate ? candidate : best;
      return lower(hf[candidate], candidate, hf[best], best) ? candidate : best;
    }

    // Every dry neighbour of every filled cell, as a candidate outlet. The
    // first pass caps the rim so a terraced plateau cannot hand its surplus to
    // a cliff; when that cap leaves a basin with nowhere to go the caller
    // retries without it. Both passes walk the same ring in the same order, so
    // the ring is written once: two copies could be trimmed on one side only,
    // which leaves a capped sweep seeing a rim its own retry never visits.
    function sweepRim(count, cap) {
      var best = -1;
      for (var q = 0; q < count; q++) {
        var bc = queue[q];
        var bx = bc % width, by = (bc / width) | 0;
        if (bx > 0) best = pickSpill(bc - 1, best, cap);
        if (bx < width - 1) best = pickSpill(bc + 1, best, cap);
        if (by > 0) best = pickSpill(bc - width, best, cap);
        if (by < height - 1) best = pickSpill(bc + width, best, cap);
      }
      return best;
    }

    function recordSpill(count) {
      lakeBasins++;
      // Label every cell this fill claimed, so a hover can name its lake.
      // Done here rather than in the fill loop: this is the one place that
      // runs exactly once per basin.
      var sumX = 0, sumY = 0;
      for (var lb = 0; lb < count; lb++) {
        var lcq = queue[lb];
        basin[queue[lb]] = lakeBasins;
        sumX += lcq % width;
        sumY += (lcq / width) | 0;
      }
      var best = sweepRim(count, true);
      if (best < 0) best = sweepRim(count, false);
      // Every basin has a rim, so an outlet is essentially always found. When
      // a fill touches the whole grid there is nothing outside it, and the
      // surplus simply stays where it is.
      if (best < 0) return;
      spill[best] = lakeBasins;
      // Bearing from the middle of the lake to its outlet: the way a walker
      // follows to get off the basin. One entry per basin, same order as the
      // labels in `basin`, so a hover can pair them up.
      basinSpill.push(bearing(
        (best % width) - sumX / count,
        ((best / width) | 0) - sumY / count
      ));
      // Everything the basin collected continues downstream from the outlet.
      var carried = 0;
      for (var qq = 0; qq < count; qq++) carried += acc[queue[qq]];
      acc[best] += carried;
    }

    // Fill the mask: depth is the rim-to-floor gap, capped so a deep basin and
    // Fill each basin: the water surface sits at the lowest point of the ring
    // around the seed, and every cell reachable from the seed without climbing
    // above that surface is under water. Depth is surface minus floor, capped
    // so a deep basin and a shallow both read as water rather than a hole.
    var queue = new Int32Array(n);
    // One entry per cell, marked at enqueue time. `gen` is the fill number, so
    // the marks never have to be cleared between basins.
    var queued = new Int32Array(n);
    var gen = 0;
    // Every neighbour offered to a fill is the same four tests: inside its own
    // axis, not yet marked by this fill, still dry, and at or below the
    // surface it is being measured against. Written beside each step the pair
    // of bounds could be edited apart — a left edge held inside the grid while
    // its own right step was not — which leaves a basin whose shore reaches
    // one cell past its rim on one side only. Still a plausible lake, so the
    // four reads share this one shape instead of restating it.
    function offerFill(j, inside) {
      if (!inside || queued[j] === gen || lake[j] || hf[j] > surface) return;
      queued[j] = gen;
      queue[tail++] = j;
    }
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        if (hf[i] < seaLevel || lake[i]) continue;
        var gap = ringMinimum(x, y) - hf[i];
        if (gap <= 0.006) continue;
        var surface = hf[i] + gap;
        var head = 0, tail = 0;
        gen++;
        queued[i] = gen;
        queue[tail++] = i;
        while (head < tail) {
          var cur = queue[head++];
          var ch = hf[cur];
          if (ch > surface) continue;
          var d = surface - ch;
          lake[cur] = Math.max(1, Math.round(Math.min(1, d / 0.09) * LAKE_STEPS));
          var cx2 = cur % width, cy2 = (cur / width) | 0;
          // `queued` marks a cell the moment it enters the queue: the depth is
          // only written on dequeue, so without this a cell offered by two
          // neighbours could be pushed twice and overflow the queue.
          offerFill(cur - 1, cx2 > 0);
          offerFill(cur + 1, cx2 < width - 1);
          offerFill(cur - width, cy2 > 0);
          offerFill(cur + width, cy2 < height - 1);
        }
        recordSpill(tail);
      }
    }

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        var h = hf[i];
        var isWater = h < seaLevel;

        var key;
        if (isWater) {
          waterCells++;
          key = h < seaLevel - DEEP_DROP ? 'deep' : 'shallow';
        } else {
          landCells++;
          var inLake = lake[i] > 0;
          var nearCoast = acrossShore(hf, i, width, height, x, y, seaLevel, false);
          if (inLake) {
            key = 'lake';
          } else if (h < seaLevel + 0.035 || nearCoast) {
            key = 'beach';
          } else if (tf[i] < 0.20 && h < 0.86) {
            key = 'ice';
          } else if (h > 0.88) {
            key = 'rock';
          } else {
            // Lakes and rivers green their surroundings slightly.
            // A continental interior is drier than the coast at the same
            // latitude: an airmass gives up most of its moisture in the first
            // dozen cells inland. The distance field is already computed, so
            // this costs one multiply.
            var far = Math.min(INLAND_CAP, dist[i]) / INLAND_CAP;
            var moist = clamp01(mf[i] + (seaLevel + 0.10 - h) * 0.35 +
              (lake[i - 1] || lake[i + 1] || lake[i - width] || lake[i + width] ? 0.10 : 0) -
              far * 0.10);
            key = biomeFromTempMoist(tf[i], moist);
          }
        }

        // Rivers: strong accumulation carves a line through the land.
        // Standing water in a basin already reads as water, so the network is
        // only drawn where it has to cut a channel.
        var onRiver = 0;
        if (!isWater && !inLake && riverMin > 0 && (acc[i] > riverCut || spill[i])) {
          onRiver = 1;
          river[i] = 1;
          riverCells++;
          // A trunk river gets a stronger blend than its tributaries.
          if (acc[i] > majorCut) {
            river[i] = 2; onRiver = 2; trunkCells++;
          }
        }

        biome[i] = key;
        counts[key] = (counts[key] || 0) + 1;

        var col = colors[key] || colors.grass;
        var r = col[0], g = col[1], b = col[2];

        // Depth shading under water.
        if (isWater) {
          var depth = clamp01((seaLevel - h) / spanFloor(seaLevel));
          var dw = depthWash(depth, 0.30);
          r *= dw; g *= dw; b *= dw;
        } else if (lake[i]) {
          var ldepth = lake[i] / LAKE_STEPS;
          var lw = depthWash(ldepth, 0.22);
          r *= lw; g *= lw; b *= lw;
        } else if (h > SNOW_LINE) {
          // Snow line: high ground fades toward the ice colour, so peaks read
          // as caps on top of whatever biome the slope carries.
          var sn = snowFade(h);
          r += (colors.ice[0] - r) * sn;
          g += (colors.ice[1] - g) * sn;
          b += (colors.ice[2] - b) * sn;
        }

        // Hillshade from the height gradient.
        if (hillshade > 0) {
          var xl = shadeStep(hf, i, -1, x === 0);
          var xr = shadeStep(hf, i, 1, x === width - 1);
          var yu = shadeStep(hf, i, -width, y === 0);
          var yd = shadeStep(hf, i, width, y === height - 1);
          var nxg = (xl - xr) * SLOPE_SCALE;
          var nyg = (yu - yd) * SLOPE_SCALE;
          var len = Math.sqrt(nxg * nxg + nyg * nyg + 1);
          var dot = (nxg * lx + nyg * ly + lz) / len;
          var sh = 0.86 + (dot - 0.56) * hillshade * 1.5;
          if (dither) {
            sh += ditherOffset(bayer, x, y);
          }
          sh = shadeClamp(sh);
          r *= sh; g *= sh; b *= sh;
        }

        // Hypsometric contours: a slightly darker line at each step above sea
        // level makes the relief legible without a gradient ramp. Both counts
        // are measured from the shoreline, which keeps the spacing even when
        // the sea slider floods most of the map, and each follows this world's
        // own relief: a flat craton would turn into stripes under a fixed
        // count, while a mountainous spill needs the extra lines to read.
        if (contour && h >= seaLevel) {
          var above = (h - seaLevel) / spanFloor(1 - seaLevel);
          var band = bandEdge(above, contourBands);
          if (band < LINE_WIDTH) {
            r = lineChannel(r, 0.88);
            g = lineChannel(g, 0.88);
            b = lineChannel(b, 0.88);
          }
        } else if (contour && isWater) {
          // Bathymetric lines: the same idea under water, measured from the
          // deepest cell up to the shoreline. Lighter touch than the land
          // lines, since the depth falloff already carries most of the shape.
          var below = (h - minH) / spanFloor(seaLevel - minH);
          var wband = bandEdge(below, basinBands);
          if (wband < LINE_WIDTH) {
            r = lineChannel(r, 1.10);
            g = lineChannel(g, 1.10);
            b = lineChannel(b, 1.10);
          }
        }

        // Coastline ink: the first ring of water against land catches a little
        // light, which is what makes a pixel coastline readable at small sizes.
        if (isWater) {
          var ashore = acrossShore(hf, i, width, height, x, y, seaLevel, true);
          if (ashore) {
            r += (colors.beach[0] - r) * SHORE_INK;
            g += (colors.beach[1] - g) * SHORE_INK;
            b += (colors.beach[2] - b) * SHORE_INK;
          }
        }

        if (onRiver) {
          // A river mouth spreads: the last cell before the sea widens out.
          var mouth = acrossShore(hf, i, width, height, x, y, seaLevel, false);
          var mix = riverMix(river[i], mouth);
          r = r * (1 - mix) + colors.shallow[0] * mix;
          g = g * (1 - mix) + colors.shallow[1] * mix;
          b = b * (1 - mix) + colors.shallow[2] * mix;
        }

        if (key === 'ice') iceCells++;

        var o = i * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }

    var stats = {
      pixels: n,
      land: landCells / n,
      water: waterCells / n,
      rivers: riverCells,
      // Of those cells, how many are trunk rather than tributary. The two ink
      // weights are visible on the map, but a count is what says whether a
      // world is one big drainage with a few threads or a tight braid, and the
      // tributary figure is just `rivers - trunks`.
      trunks: trunkCells,
      ice: iceCells / n,
      // Extremes of the height field, so a world's relief range is readable
      // without sampling the buffer from the outside.
      min: minH,
      max: maxH,
      // Middle of the same range: half the grid sits below this. Says whether
      // a world is mostly high ground with a trench or mostly plain with a
      // peak, which min and max alone cannot tell apart.
      median: medianH,
      // How many hypsometric bands the current relief can carry, so the CLI
      // and the tests can see the spacing without duplicating the formula.
      contourBands: contourBands,
      basinBands: basinBands,
      // Separate lake basins on the map. Each one keeps its own water and
      // spills over its own rim, so the count says whether the interior is a
      // few large lakes or a scatter of puddles.
      lakeBasins: lakeBasins,
      ms: Date.now() - started,
      // Eight hex digits over the rendered pixels, so two runs can be compared
      // without walking the whole buffer from the outside.
      checksum: checksum(data),
      counts: counts
    };

    return {
      width: width,
      height: height,
      data: data,
      biome: biome,
      heightField: hf,
      moisture: mf,
      // The other axis of the biome lookup. Moisture alone cannot explain why
      // the same green on a cold row reads as boreal and on a warm one as
      // temperate, and the readout prints both numbers side by side.
      temperature: tf,
      accumulation: acc,
      lakeMask: lake,
      basin: basin,
      basinSpill: basinSpill,
      spillway: spill,
      riverMask: river,
      coastDistance: dist,
      seaLevel: seaLevel,
      shape: shape,
      stats: stats,
      palette: pal
    };
  }

  /* ------------------------------------------------------------------ *
   * Export helpers.
   * ------------------------------------------------------------------ */

  // Each overlay reads one field of the world at full contrast. The pairs are
  // taken from the active palette so a channel looks like the map it came from
  // rather than a generic heatmap.
  var CHANNELS = {
    relief: ['deep', 'ice'],
    moist: ['desert', 'rain'],
    drain: ['beach', 'rock'],
    lake: ['shallow', 'lake'],
    slope: ['beach', 'forest'],
    coast: ['beach', 'deep']
  };

  // The overlays in the order the dropdown and the `c` key walk them. The
  // first entry is the plain biome map, which is what an empty key means.
  // Labels are the words the UI shows; the keys are what a URL hash stores.
  var CHANNEL_LIST = [
    {key: '', label: 'biome', note: 'the class lookup, no overlay'},
    {key: 'relief', label: 'relief', note: 'height field at full contrast'},
    {key: 'moist', label: 'moisture', note: 'wetness after the orographic pass'},
    {key: 'drain', label: 'drainage', note: 'catchment size, log ramp'},
    {key: 'lake', label: 'lake depth', note: 'standing water, by basin depth'},
    {key: 'slope', label: 'slope', note: 'height drop to the nearest neighbour'},
    {key: 'coast', label: 'coast dist', note: 'steps to the nearest shore, log ramp'}
  ];

  // Seed phrases worth starting from: each one is a hand-picked world that
  // shows off a different combination of shape, sea level and climate. The
  // dropdown-free `p` key walks this list, and the CLI prints it, so a phrase
  // seen in the terminal is always one the page knows.
  var PHRASES = ['aurora basin', 'salt mirror', 'thousand isles', 'red ridge',
    'pale shelf'];

  // Compass bearings the hillshade accepts, with the light vector each one
  // means. The dropdown, `cli --lights` and the shade pass all read this list,
  // so a bearing printed in the terminal is always one the page will take.
  // z always points at the viewer, which is what keeps the relief readable
  // from every side rather than only from the upper left.
  var LIGHTS = [
    {key: 'nw', label: 'NW', note: 'from the upper left', vec: [-0.55, -0.62, 0.56]},
    {key: 'ne', label: 'NE', note: 'from the upper right', vec: [0.55, -0.62, 0.56]},
    {key: 'sw', label: 'SW', note: 'from the lower left', vec: [-0.55, 0.62, 0.56]},
    {key: 'se', label: 'SE', note: 'from the lower right', vec: [0.55, 0.62, 0.56]}
  ];

  // Steps the lake mask is written in: a filled cell stores its depth as an
  // integer from 1 to this number, so the mask is already normalised by its own
  // basin. The depth shading, the `lake` overlay's scale and the hover readout
  // all divide by this one number rather than repeating it.
  var LAKE_STEPS = 60;

  // Height at which ground starts wearing a cap. The branch test and the fade
  // that follows it are one measurement — a cap that started at one level and
  // grew from another would leave a hard step in the middle of its own ramp —
  // so both halves read this one number.
  var SNOW_LINE = 0.80;

  // How much of each band a contour line occupies. Land lines and bathymetric
  // lines are drawn by the same test — the leading edge of a band — so one
  // number keeps both sets the same thickness; a pair could be edited apart
  // until the stripes above the shoreline and the ones under it stopped
  // looking like one grid of lines.
  var LINE_WIDTH = 0.10;

  // How steep a height difference between neighbours is. Both axes of the
  // shade normal are measured with this one number, since the two are the same
  // comparison of a cell against its neighbour — written beside each axis the
  // pair could be edited apart until a slope read differently sideways than it
  // did up and down, which still looks like relief at a glance.
  var SLOPE_SCALE = 3.2;

  // How far inland an airmass still carries moisture. The biome lookup caps the
  // distance field at this many cells and divides by the same number, so the
  // two halves of that division are one measurement: a cap written beside the
  // test and a divisor written beside the fraction could be edited apart until
  // an interior dried out over one range while its own reading scaled against
  // another — which still looks like a plain enough gradient at a glance.
  var INLAND_CAP = 12;

  // How much of the beach colour the first ring of water takes on. The blend
  // is one strength shared by the three channels of a pixel, so writing it
  // beside each of them could set one channel a shade away from the other two
  // — a coastline tinted slightly pink reads as a plausible warm shore rather
  // than as a broken triple, which is why the three reads are one number.
  var SHORE_INK = 0.16;

  // How far below the shoreline a cell has to sit before it stops being a
  // shelf and reads as open ocean. The classification and the hover note are
  // the same measurement — a note about a depth the map did not use would
  // describe a class the legend never lists — so both read this one number.
  var DEEP_DROP = 0.14;

  // The grid a world falls back to when a caller names no size. The pair is
  // also the aspect a lone `--width` is completed from, so the two numbers are
  // one reading: a fill that kept its own copy of the height would derive a
  // different shape from the one this generator would have picked itself.
  var DEFAULT_GRID = {width: 480, height: 300};

  // Look up a bearing, falling back to the first entry so an empty or unknown
  // --dir still renders rather than dropping the shading entirely.
  function lightVector(key) {
    for (var i = 0; i < LIGHTS.length; i++) {
      if (LIGHTS[i].key === key) return LIGHTS[i].vec;
    }
    return LIGHTS[0].vec;
  }

  // Column counts the page can pin. The first entry lets the grid follow the
  // window; the rest fix it, which is how the same seed keeps the same number
  // of cells in a narrow window and on a wide one. The dropdown, the `w` key,
  // `cli --grids` and the smoke loop all read this one list.
  var GRIDS = [
    {key: '', label: 'auto', note: 'fill the window'},
    {key: '240', label: '240 col', note: 'chunky cells, quick to read'},
    {key: '320', label: '320 col', note: 'the middle ground'},
    {key: '480', label: '480 col', note: 'fine grain, most coastline'}
  ];

  // Nearest-neighbour multipliers the export offers. The grid stays the same
  // size — only the saved pixels grow — so the list is about how big a file a
  // world should become. The dropdown, the `e` key, `cli --scales` and the
  // --scale flag all read this one list.
  var SCALES = [
    {key: '2', label: '2x', note: 'smallest file, still crisp'},
    {key: '3', label: '3x', note: 'the default, fits a laptop screen'},
    {key: '4', label: '4x', note: 'one cell per small window'},
    {key: '6', label: '6x', note: 'wallpaper sized'}
  ];

  // Which stored field an overlay reads. One lookup so the renderer and the
  // hover readout cannot drift to different columns of the same result.
  function fieldFor(key, result) {
    // Slope is the one field derived here rather than in generate: it is a
    // difference of the height field, so it can never move a biome boundary,
    // and an overlay must not change the map underneath it. Cached on the
    // result for the same reason the scale is — a hover re-reads it per cell.
    if (key === 'slope') {
      if (!result.slopeField) result.slopeField = slopeField(result);
      return result.slopeField;
    }
    return key === 'relief' ? result.heightField
      : key === 'moist' ? result.moisture
        : key === 'drain' ? result.accumulation
          : key === 'lake' ? result.lakeMask
          : result.coastDistance;
  }

  // Steepest drop from each cell to its four neighbours, in height units. This
  // is what separates a scarp from a plain when the height field itself is a
  // near-flat plateau: the two share a median and differ entirely in gradient.
  // One neighbour's share of that steepness is a difference without a sign, so
  // the sign is dropped in one place: written beside each of the four steps a
  // comparison could lose its flip and measure a downhill face harder than the
  // uphill one it faces, which reads as a ridge leaning one way only.
  function neighbourDrop(hf, here, there) {
    return Math.abs(hf[here] - hf[there]);
  }

  function slopeField(result) {
    var w = result.width, h = result.height, hf = result.heightField;
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var best = neighbourDrop(hf, i, x > 0 ? i - 1 : i);
        if (x + 1 < w) best = Math.max(best, neighbourDrop(hf, i, i + 1));
        if (y > 0) best = Math.max(best, neighbourDrop(hf, i, i - w));
        if (y + 1 < h) best = Math.max(best, neighbourDrop(hf, i, i + w));
        out[i] = best;
      }
    }
    return out;
  }

  // Spread a field over 0..1 by its own extremes, so a low-contrast field
  // still fills the ramp. The top and bottom 2% are clipped away, which keeps
  // a single deep trench or one huge catchment from washing out the rest.
  function scaleFor(values, n, useLog) {
    var sample = new Array(n);
    for (var i = 0; i < n; i++) {
      sample[i] = useLog ? Math.log(1 + values[i]) : values[i];
    }
    sample.sort(byNumber);
    var lo = sample[quantileIndex(0.02, n)];
    var hi = sample[quantileIndex(0.98, n)];
    if (!(hi > lo)) hi = lo + 1;
    return { lo: lo, hi: hi };
  }

  // Redraw a result as a single scalar field. Deterministic: the buffer only
  // depends on the fields already computed by generate, never on the canvas.
  function channelize(result, name) {
    var w = result.width, h = result.height, n = w * h;
    var out = new Uint8ClampedArray(n * 4);
    var key = CHANNELS[name] ? name : 'relief';
    var useLog = key === 'drain' || key === 'coast';
    var src = fieldFor(key, result);
    var sc;
    // The lake mask is already normalised by its own basin: 1..60 steps from
    // the shore to the deepest cell. Percentiles would be wrong here — most of
    // the grid is dry and reads as zero, so the 98% mark of a world with two
    // small tarns is still zero. The mask's own range is the honest scale.
    if (key === 'lake') sc = {lo: 0, hi: LAKE_STEPS};
    else sc = scaleFor(src, n, useLog);
    // Keep the scale on the result: a hover wants to print the very number the
    // ramp was built from, and re-deriving the percentiles per cell would sort
    // the whole field again.
    result.channelScale = {key: key, useLog: useLog, lo: sc.lo, hi: sc.hi};
    var colors = result.palette.colors;
    var lo = colors[CHANNELS[key][0]];
    var hi = colors[CHANNELS[key][1]];
    for (var i = 0; i < n; i++) {
      var v = scaleValue(src[i], useLog);
      var t = scaleShare(v, sc);
      var o = i * 4;
      out[o] = lo[0] + (hi[0] - lo[0]) * t;
      out[o + 1] = lo[1] + (hi[1] - lo[1]) * t;
      out[o + 2] = lo[2] + (hi[2] - lo[2]) * t;
      out[o + 3] = 255;
    }
    return { width: w, height: h, data: out, channel: key };
  }

  // Nearest-neighbour upscale into a fresh RGBA buffer (crisp pixels).
  function upscale(result, factor) {
    var f = Math.max(1, Math.round(factor || 1));
    var w = result.width * f, h = result.height * f;
    var out = new Uint8ClampedArray(w * h * 4);
    var src = result.data;
    for (var y = 0; y < h; y++) {
      var sy = ((y / f) | 0) * result.width;
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var so = (sy + ((x / f) | 0)) * 4;
        var o = (row + x) * 4;
        out[o] = src[so]; out[o + 1] = src[so + 1]; out[o + 2] = src[so + 2]; out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  function randomSeed() {
    return (Math.random() * 4294967295) >>> 0;
  }

  // The 0..1 position of one cell inside the overlay it is being shown as.
  // Same percentiles and the same log transform as the ramp, so the number in
  // the readout matches the colour under the cursor rather than a raw field
  // value that would need its own scale to interpret.
  function channelValue(result, cell) {
    var sc = result.channelScale;
    if (!sc) return clamp01(result.heightField[cell]);
    var src = fieldFor(sc.key, result);
    var v = scaleValue(src[cell], sc.useLog);
    return scaleShare(v, sc);
  }

  // Derive the next seed from the current one, so a chain of rerolls from the
  // same starting phrase is reproducible: the same first world always walks the
  // same sequence. Falls back to a fresh random value when there is nothing to
  // derive from. The trailing separator moves the hash off the original phrase.
  function nextSeed(value) {
    if (value == null || value === '') return randomSeed();
    return hashString(String(value) + '\u0001');
  }

  // FNV-1a over the rendered pixels, as eight hex digits. Two runs of the same
  // seed must agree here even when their timings differ, so this is the
  // shortest way to tell "identical world" from "close enough".
  function checksum(d) {
    var h = 0x811c9dc5;
    for (var i = 0; i < d.length; i++) {
      h ^= d[i];
      // Shift-add form of the FNV prime: the plain product passes 2^53 and
      // would lose precision in a double, so the multiply stays in 32 bits.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = h.toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return hex;
  }

  // Tick spacing for the relief chart: the first candidate step that leaves at
  // most ten marks over this world's own relief, in height units. A flat craton
  // spanning fifteen units would otherwise get a single tick, a tall fjord close
  // to twenty. Lives here rather than in the shell so the chart and the tests
  // share one formula for what "readable by eye" means.
  var TICK_STEPS = [5, 10, 20, 25, 50];
  function tickStep(units) {
    for (var i = 0; i < TICK_STEPS.length; i++) {
      if (units / TICK_STEPS[i] <= 10) return TICK_STEPS[i];
    }
    return TICK_STEPS[TICK_STEPS.length - 1];
  }

  // How many bars the relief chart gets for a given sidebar width: one bin per
  // ~5 CSS pixels, clamped at both ends. The floor is what keeps a narrow
  // column readable — twenty bars still show a shoreline bump and a snow-line
  // bump as separate marks — and the ceiling is what stops a wide window from
  // turning the strip into mush. Lives next to `tickStep` for the same reason:
  // the shell only reads the number, and the suite can ask the same question a
  // chart answers.
  function binCount(cssWidth) {
    return Math.max(20, Math.min(72, Math.round(cssWidth / 5)));
  }

  // The width the sidebar's chart strip is drawn into when nothing better is
  // known: the shell uses it when the canvas has not been laid out yet, the
  // CLI when it has no window at all. One number so a terminal's text profile
  // and the page's bars land on the same column count.
  // It is the strip's own measured width rather than the sidebar column's —
  // the column is 250px and the canvas inside it loses its padding, so 200 is
  // what a default window actually measures and therefore what a terminal has
  // to assume to get the same number of columns.
  var HIST_WIDTH = 200;

  // The height of that same strip, for the same reason: the shell needs it
  // before its canvas has a layout, and the markup plus the stylesheet each
  // give the box a size. One number so a reader comparing a pasted profile
  // with the page can ask how tall the strip is supposed to be, and so the
  // three places that size it cannot drift into three different boxes.
  var HIST_HEIGHT = 52;

  // How many rows of blocks the text profile stacks above its ruler: one
  // threshold each, so a terminal's silhouette has the same vertical resolution
  // whatever world it describes. Beside `HIST_WIDTH` for the same reason — the
  // number belongs to the profile, not to the call site drawing it, so a
  // reader comparing a pasted block with a record can ask the core how many
  // rows to expect instead of counting them.
  var HIST_ROWS = 6;

  // Bin the height field into `bins` bars over this world's own range. The
  // range is the actual min/max rather than 0..1, so a low-relief craton still
  // fills the chart instead of crowding the middle. Every reader of the relief
  // chart — the bars, the hovered-bin tally, the readout's band note — goes
  // through this one pass, so a bar's count and the cells it lights up are the
  // same measurement. `bin` is the same clamp the shell uses to pick a bar.
  function histogram(result, bins) {
    var hf = result.heightField;
    var lo = result.stats.min;
    var span = spanFloor(result.stats.max - lo);
    var hist = new Array(bins);
    var peak = 0;
    var i;
    for (i = 0; i < bins; i++) hist[i] = 0;
    for (i = 0; i < hf.length; i++) {
      var b = binOf(hf[i], lo, span, bins);
      hist[b]++;
      if (hist[b] > peak) peak = hist[b];
    }
    return {bins: bins, hist: hist, peak: peak, lo: lo, span: span};
  }

  // Height to bar index, clamped to the last bar: a cell sitting exactly on the
  // top of the range would otherwise fall one past the end.
  function binOf(h, lo, span, bins) {
    var b = Math.floor((h - lo) / span * bins);
    return Math.max(0, Math.min(bins - 1, b));
  }

  // One line that puts a world into words: the shape it was cut from, how much
  // relief it carries, how much of it is dry, and which class covers most of
  // it. Both the sidebar and the CLI print this, so a saved PNG and a terminal
  // listing describe a world the same way.
  function describe(result) {
    var s = result.stats;
    var top = null, topCount = -1;
    Object.keys(s.counts).forEach(function (key) {
      if (s.counts[key] > topCount) { topCount = s.counts[key]; top = key; }
    });
    // The same scaling the `relief` row and the chart's corners use, so the
    // number inside this sentence is the number printed beside it. A second
    // rounding written here could be cut against another range and leave the
    // word `rugged (71)` next to a row reading `relief 70 units`.
    var relief = hundred(s.max - s.min);
    var word = relief > 70 ? 'rugged' : relief > 40 ? 'rolling' : 'plain';
    var parts = [
      result.shape,
      word + ' (' + relief + ')',
      // Through the same formatter the `land` row and the legend use, so a
      // world that is mostly ocean prints one figure in both places: a plain
      // rounding here would say `0% land` beside a row reading `land 0.0%`,
      // and the two would look like two measurements of the same grid.
      percentText(s.land) + ' land',
      'mostly ' + (BIOME_NAMES[top] || top)
    ];
    // How much of the grid carries a channel. A share rather than a cell
    // count, since the count grows with the grid while the density is what
    // the quantile cut holds steady — a sentence that printed the count would
    // make the same world look twice as wet in a wide window.
    parts.push(percentText(s.rivers / s.pixels) + ' drained');
    // The count is more useful than the bare fact: three large basins and
    // thirty puddles both have lakes, and the number is already computed.
    if (s.counts.lake) parts.push(s.lakeBasins + ' lake' + (s.lakeBasins === 1 ? '' : 's'));
    if (s.ice > 0.02) parts.push('polar');
    return parts.join(' · ');
  }

  // Share of the grid under standing water. The count is absent rather than
  // zero on a world with no tarns, so the empty case is folded in here: the
  // `lake` row on the page and the `lake` field of a record then divide the
  // same numerator by the same grid, and one prints it out of a hundred while
  // the other keeps three decimals of it.
  function lakeShare(stats) {
    return (stats.counts.lake || 0) / stats.pixels;
  }

  // Share of the grid a single class covers. Same shape as the lake fraction
  // above: a class that never occurs on this world is absent from the counts
  // map rather than holding a zero, so the empty case is folded in here. The
  // legend rows, the note under the map and the CLI's per-class list all take
  // their pair of numbers from this one division, which is what lets a row on
  // screen and a `key=NN%` token in a record be checked against each other.
  function classShare(stats, key) {
    return (stats.counts[key] || 0) / stats.pixels;
  }

  // Share of the grid, as printed text. Whole numbers above ten percent; below
  // that one decimal, so a two-percent class and a nought-point-two-percent
  // class never collapse onto the same string. Both the sidebar rows and the
  // CLI's per-class list go through here, which is what lets a terminal
  // reproduce the figures on screen instead of a rounded echo of them.
  function percentText(fraction) {
    var pct = fraction * 100;
    if (pct >= 10) return Math.round(pct) + '%';
    // Under one percent even one decimal collapses a pair of thin classes onto
    // the same figure — both read `0.0%` — and that tail is exactly where the
    // legend's biggest-first order still has to be readable, so the smallest
    // band buys itself a second decimal. A zero share keeps the plain form.
    if (pct > 0 && pct < 1) return pct.toFixed(2) + '%';
    return pct.toFixed(1) + '%';
  }

  // Every height is stored 0..1 and printed out of a hundred, in the sidebar's
  // stats rows and chart labels and in the CLI's caption and record. One
  // scaling for both, so a figure read off a printed page is the figure a
  // terminal printed: two roundings that happen to agree are still two.
  function hundred(value) {
    return Math.round(value * 100);
  }

  // A share or a level kept to three decimals — finer than the out-of-a-hundred
  // figures a page or a caption prints, so a terminal can rebuild a bar's column
  // count from one saved line without losing a whole step to rounding. The
  // record stores every fraction this way rather than six fields each writing
  // its own division: a `land` kept finer than an `ice` would leave a reader
  // adding two figures that never summed to the grid.
  function three(value) {
    return Math.round(value * 1000) / 1000;
  }

  // Which classes to list, in the order to list them: every class present on
  // this world, biggest first. Equal shares fall back to the order the palette
  // declares its keys in, so the list does not depend on whether this engine's
  // sort happens to be stable — two classes covering the same number of cells
  // keep their relative order on every machine. The legend rows, the `k` cycle,
  // the hover notes and the CLI's `classes` column all walk this one array, so
  // a row's position and the share printed beside it cannot be ranked twice.
  function legendOrder(result) {
    var counts = result.stats.counts;
    var declared = Object.keys(result.palette.colors);
    return declared
      .filter(function (k) { return counts[k]; })
      .sort(function (a, b) {
        return counts[b] - counts[a] ||
          declared.indexOf(a) - declared.indexOf(b);
      });
  }

  // How many classes actually occur on this world. The classification pass only
  // writes a key when it gives that key a cell, so an occupied class is one the
  // counts object names — which is what the legend's row count, the `biomes`
  // row and the CLI record all report. Taken from the occupancy map rather than
  // the fixed list of names in the palette, so a world that never freezes does
  // not claim an ice row it cannot draw.
  function biomeCount(counts) {
    var n = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > 0) n++;
    });
    return n;
  }

  // Turn a flag or a slider into a number, or into nothing at all. `Number`
  // rather than the two `parse*` functions: those stop at the first character
  // they cannot read, so `800x` would reach the generator as its leading digits
  // here and as a rejected value there — two grids for one phrase, depending on
  // where it was typed. An unreadable value means unset, so the generator's own
  // default stands; an empty box is a missing value rather than a zero, since
  // `Number('')` is 0 and that would shrink a world to the smallest grid
  // drawable. Both readers — the page's controls and the CLI's flags — go
  // through this one function for exactly that reason.
  function readNumber(value, isInt) {
    if (value == null || value === '') return undefined;
    var n = Number(value);
    if (!isFinite(n)) return undefined;
    return isInt ? Math.round(n) : n;
  }

  global.TerraCore = {
    generate: generate,
    upscale: upscale,
    channelize: channelize,
    describe: describe,
    channelValue: channelValue,
    percentText: percentText,
    hundred: hundred,
    three: three,
    spanFloor: spanFloor,
    lakeShare: lakeShare,
    classShare: classShare,
    legendOrder: legendOrder,
    biomeCount: biomeCount,
    readNumber: readNumber,
    hashString: hashString,
    randomSeed: randomSeed,
    nextSeed: nextSeed,
    histogram: histogram,
    binOf: binOf,
    palettes: PALETTES,
    shapes: SHAPES,
    channels: CHANNEL_LIST,
    tickStep: tickStep,
    binCount: binCount,
    histWidth: HIST_WIDTH,
    histHeight: HIST_HEIGHT,
    histRows: HIST_ROWS,
    lakeSteps: LAKE_STEPS,
    deepDrop: DEEP_DROP,
    defaultGrid: DEFAULT_GRID,
    phrases: PHRASES,
    lights: LIGHTS,
    grids: GRIDS,
    scales: SCALES,
    biomeNames: BIOME_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
