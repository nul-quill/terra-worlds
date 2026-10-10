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

  /* ------------------------------------------------------------------ *
   * Main generation entry point.
   * Returns { width, height, data, biome, height, stats }.
   * ------------------------------------------------------------------ */

  function generate(options) {
    var opts = options || {};
    var started = Date.now();

    var width = Math.max(16, Math.round(opts.width || 480));
    var height = Math.max(16, Math.round(opts.height || 300));
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
    var reliefAboveSea = Math.max(0.001, maxH - seaLevel);
    var contourBands = Math.max(6, Math.min(20, Math.round(reliefAboveSea * 26)));

    // The basin gets its own count from the depth range, so a shallow shelf
    // is not crossed by lines every few pixels while a deep ocean still shows
    // a few steps.
    var reliefBelowSea = Math.max(0.001, seaLevel - minH);
    var basinBands = Math.max(3, Math.min(12, Math.round(reliefBelowSea * 22)));

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
    var dist = new Float32Array(n);
    var BIG = width + height;
    for (i = 0; i < n; i++) dist[i] = hf[i] < seaLevel ? 0 : BIG;
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        var dmin = dist[i];
        if (x > 0 && dist[i - 1] + 1 < dmin) dmin = dist[i - 1] + 1;
        if (y > 0 && dist[i - width] + 1 < dmin) dmin = dist[i - width] + 1;
        dist[i] = dmin;
      }
    }
    for (y = height - 1; y >= 0; y--) {
      for (x = width - 1; x >= 0; x--) {
        i = y * width + x;
        dmin = dist[i];
        if (x < width - 1 && dist[i + 1] + 1 < dmin) dmin = dist[i + 1] + 1;
        if (y < height - 1 && dist[i + width] + 1 < dmin) dmin = dist[i + width] + 1;
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
    accSorted.sort(function (a, b) { return a - b; });
    var keep = 0.01 + clamp01(riverMin / 400) * 0.19;
    var qIndex = Math.min(n - 1, Math.round((1 - keep) * (n - 1)));
    var riverCut = accSorted[qIndex];
    // Major channels: the top slice of the same field. Drawn with a stronger
    // blend so a trunk river does not look like its own tributaries.
    var majorCut = accSorted[Math.min(n - 1, Math.round((1 - keep * 0.28) * (n - 1)))];

    // Lakes are closed depressions. A cell holds water when every route off it
    // climbs: compare its height against the lowest point on a ring of radius
    // RIM around it, and the gap between ring and cell is the water depth.
    // Two separable min filters (rows, then columns) give window minima in
    // linear time; the ring is the four window minima on the ring itself.
    var RIM = 4;
    var rowMin = new Float32Array(n);
    for (y = 0; y < height; y++) {
      var row = y * width;
      for (x = 0; x < width; x++) {
        var loX = x - RIM < 0 ? 0 : x - RIM;
        var hiX = x + RIM > width - 1 ? width - 1 : x + RIM;
        var m = hf[row + x];
        for (var k = loX; k <= hiX; k++) { if (hf[row + k] < m) m = hf[row + k]; }
        rowMin[row + x] = m;
      }
    }
    var colMin = new Float32Array(n);
    for (x = 0; x < width; x++) {
      for (y = 0; y < height; y++) {
        var loY = y - RIM < 0 ? 0 : y - RIM;
        var hiY = y + RIM > height - 1 ? height - 1 : y + RIM;
        var m2 = hf[y * width + x];
        for (var k2 = loY; k2 <= hiY; k2++) { if (hf[k2 * width + x] < m2) m2 = hf[k2 * width + x]; }
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
      var best = -1;
      for (var q = 0; q < count; q++) {
        var bc = queue[q];
        var bx = bc % width, by = (bc / width) | 0;
        if (bx > 0) best = pickSpill(bc - 1, best, true);
        if (bx < width - 1) best = pickSpill(bc + 1, best, true);
        if (by > 0) best = pickSpill(bc - width, best, true);
        if (by < height - 1) best = pickSpill(bc + width, best, true);
      }
      if (best < 0) {
        for (var q2 = 0; q2 < count; q2++) {
          var cc = queue[q2];
          var cx3 = cc % width, cy3 = (cc / width) | 0;
          if (cx3 > 0) best = pickSpill(cc - 1, best, false);
          if (cx3 < width - 1) best = pickSpill(cc + 1, best, false);
          if (cy3 > 0) best = pickSpill(cc - width, best, false);
          if (cy3 < height - 1) best = pickSpill(cc + width, best, false);
        }
      }
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
          if (cx2 > 0 && queued[cur - 1] !== gen && !lake[cur - 1] && hf[cur - 1] <= surface) { queued[cur - 1] = gen; queue[tail++] = cur - 1; }
          if (cx2 < width - 1 && queued[cur + 1] !== gen && !lake[cur + 1] && hf[cur + 1] <= surface) { queued[cur + 1] = gen; queue[tail++] = cur + 1; }
          if (cy2 > 0 && queued[cur - width] !== gen && !lake[cur - width] && hf[cur - width] <= surface) { queued[cur - width] = gen; queue[tail++] = cur - width; }
          if (cy2 < height - 1 && queued[cur + width] !== gen && !lake[cur + width] && hf[cur + width] <= surface) { queued[cur + width] = gen; queue[tail++] = cur + width; }
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
          var nearCoast =
            (y > 0 && hf[i - width] < seaLevel) ||
            (y < height - 1 && hf[i + width] < seaLevel) ||
            (x > 0 && hf[i - 1] < seaLevel) ||
            (x < width - 1 && hf[i + 1] < seaLevel);
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
            var far = Math.min(12, dist[i]) / 12;
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
          var depth = clamp01((seaLevel - h) / Math.max(0.001, seaLevel));
          var dw = 1 - depth * 0.30;
          r *= dw; g *= dw; b *= dw;
        } else if (lake[i]) {
          var ldepth = lake[i] / 60;
          var lw = 1 - ldepth * 0.22;
          r *= lw; g *= lw; b *= lw;
        } else if (h > 0.80) {
          // Snow line: high ground fades toward the ice colour, so peaks read
          // as caps on top of whatever biome the slope carries.
          var sn = clamp01((h - 0.80) / 0.16) * 0.85;
          r += (colors.ice[0] - r) * sn;
          g += (colors.ice[1] - g) * sn;
          b += (colors.ice[2] - b) * sn;
        }

        // Hillshade from the height gradient.
        if (hillshade > 0) {
          var xl = hf[i - (x > 0 ? 1 : 0)];
          var xr = hf[i + (x < width - 1 ? 1 : 0)];
          var yu = hf[i - (y > 0 ? width : 0)];
          var yd = hf[i + (y < height - 1 ? width : 0)];
          var nxg = (xl - xr) * 3.2;
          var nyg = (yu - yd) * 3.2;
          var len = Math.sqrt(nxg * nxg + nyg * nyg + 1);
          var dot = (nxg * lx + nyg * ly + lz) / len;
          var sh = 0.86 + (dot - 0.56) * hillshade * 1.5;
          if (dither) {
            sh += ((bayer[((y & 3) << 2) | (x & 3)] / 15) - 0.5) * 0.05;
          }
          if (sh < 0.62) sh = 0.62;
          if (sh > 1.22) sh = 1.22;
          r *= sh; g *= sh; b *= sh;
        }

        // Hypsometric contours: every 0.06 of height gets a slightly darker
        // line above sea level, which makes the relief legible without a
        // gradient ramp. Measuring from the shoreline keeps the spacing even
        // when the sea slider floods most of the map.
        // The number of bands follows this world's own relief: a flat craton
        // would turn into stripes under a fixed count, while a mountainous
        // spill needs the extra lines to read at all. Measuring from the
        // shoreline keeps the spacing even when the sea slider floods most
        // of the map.
        if (contour && h >= seaLevel) {
          var above = (h - seaLevel) / Math.max(0.001, 1 - seaLevel);
          var band = above * contourBands - Math.floor(above * contourBands);
          if (band < 0.10) { r *= 0.88; g *= 0.88; b *= 0.88; }
        } else if (contour && isWater) {
          // Bathymetric lines: the same idea under water, measured from the
          // deepest cell up to the shoreline. Lighter touch than the land
          // lines, since the depth falloff already carries most of the shape.
          var below = (h - minH) / Math.max(0.001, seaLevel - minH);
          var wband = below * basinBands - Math.floor(below * basinBands);
          if (wband < 0.10) { r *= 1.10; g *= 1.10; b *= 1.10; }
        }

        // Coastline ink: the first ring of water against land catches a little
        // light, which is what makes a pixel coastline readable at small sizes.
        if (isWater) {
          var ashore =
            (y > 0 && hf[i - width] >= seaLevel) ||
            (y < height - 1 && hf[i + width] >= seaLevel) ||
            (x > 0 && hf[i - 1] >= seaLevel) ||
            (x < width - 1 && hf[i + 1] >= seaLevel);
          if (ashore) {
            r += (colors.beach[0] - r) * 0.16;
            g += (colors.beach[1] - g) * 0.16;
            b += (colors.beach[2] - b) * 0.16;
          }
        }

        if (onRiver) {
          // A river mouth spreads: the last cell before the sea widens out.
          var mouth =
            (x > 0 && hf[i - 1] < seaLevel) || (x < width - 1 && hf[i + 1] < seaLevel) ||
            (y > 0 && hf[i - width] < seaLevel) || (y < height - 1 && hf[i + width] < seaLevel);
          var mix = river[i] === 2 ? 0.72 : 0.50;
          if (mouth) mix = Math.min(0.9, mix + 0.18);
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

  // How far below the shoreline a cell has to sit before it stops being a
  // shelf and reads as open ocean. The classification and the hover note are
  // the same measurement — a note about a depth the map did not use would
  // describe a class the legend never lists — so both read this one number.
  var DEEP_DROP = 0.14;

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
  function slopeField(result) {
    var w = result.width, h = result.height, hf = result.heightField;
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var best = Math.abs(hf[i] - hf[x > 0 ? i - 1 : i]);
        if (x + 1 < w) best = Math.max(best, Math.abs(hf[i] - hf[i + 1]));
        if (y > 0) best = Math.max(best, Math.abs(hf[i] - hf[i - w]));
        if (y + 1 < h) best = Math.max(best, Math.abs(hf[i] - hf[i + w]));
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
    sample.sort(function (a, b) { return a - b; });
    var lo = sample[Math.round((n - 1) * 0.02)];
    var hi = sample[Math.round((n - 1) * 0.98)];
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
      var v = useLog ? Math.log(1 + src[i]) : src[i];
      var t = clamp01((v - sc.lo) / (sc.hi - sc.lo));
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
    var v = sc.useLog ? Math.log(1 + src[cell]) : src[cell];
    return clamp01((v - sc.lo) / (sc.hi - sc.lo));
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
  var HIST_WIDTH = 240;

  // Bin the height field into `bins` bars over this world's own range. The
  // range is the actual min/max rather than 0..1, so a low-relief craton still
  // fills the chart instead of crowding the middle. Every reader of the relief
  // chart — the bars, the hovered-bin tally, the readout's band note — goes
  // through this one pass, so a bar's count and the cells it lights up are the
  // same measurement. `bin` is the same clamp the shell uses to pick a bar.
  function histogram(result, bins) {
    var hf = result.heightField;
    var lo = result.stats.min;
    var span = Math.max(0.001, result.stats.max - lo);
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
    var relief = Math.round((s.max - s.min) * 100);
    var word = relief > 70 ? 'rugged' : relief > 40 ? 'rolling' : 'plain';
    var parts = [
      result.shape,
      word + ' (' + relief + ')',
      Math.round(s.land * 100) + '% land',
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

  // Share of the grid, as printed text. Whole numbers above ten percent; below
  // that one decimal, so a two-percent class and a nought-point-two-percent
  // class never collapse onto the same string. Both the sidebar rows and the
  // CLI's per-class list go through here, which is what lets a terminal
  // reproduce the figures on screen instead of a rounded echo of them.
  function percentText(fraction) {
    var pct = fraction * 100;
    return (pct >= 10 ? Math.round(pct) : pct.toFixed(1)) + '%';
  }

  global.TerraCore = {
    generate: generate,
    upscale: upscale,
    channelize: channelize,
    describe: describe,
    channelValue: channelValue,
    percentText: percentText,
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
    lakeSteps: LAKE_STEPS,
    deepDrop: DEEP_DROP,
    phrases: PHRASES,
    lights: LIGHTS,
    grids: GRIDS,
    scales: SCALES,
    biomeNames: BIOME_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
