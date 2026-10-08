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
      ['grass', 'grass', 'forest'],
      ['savanna', 'grass', 'forest'],
      ['desert', 'savanna', 'rain']
    ];
    return table[tb][mb];
  }

  /* ------------------------------------------------------------------ *
   * Height shaping curves.
   * ------------------------------------------------------------------ */

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

    /* ---- Colour pass: biome + hillshade + dither. ---- */

    var data = new Uint8ClampedArray(n * 4);
    var biome = new Array(n);
    var counts = {};
    var landCells = 0, waterCells = 0, riverCells = 0, iceCells = 0;

    // Light direction for the hillshade, normalised.
    // One of four compass directions, so relief can be lit from whichever side
    // reads best for the shape in play. Normalised, z always points at the viewer.
    var LIGHT_DIRS = {
      nw: [-0.55, -0.62, 0.56], ne: [0.55, -0.62, 0.56],
      sw: [-0.55, 0.62, 0.56], se: [0.55, 0.62, 0.56]
    };
    var light = LIGHT_DIRS[opts.lightDir] || LIGHT_DIRS.nw;
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
    var spill = new Uint8Array(n);

    // Lowest non-lake neighbour around a filled basin: that is where the
    // surplus leaves. Ties go to the higher index, matching the drainage
    // tie-break so the outlet is the same cell the walk would pick.
    function pickSpill(candidate, best) {
      if (lake[candidate] || hf[candidate] >= seaLevel + 0.30) return best;
      if (best < 0) return candidate;
      return lower(hf[candidate], candidate, hf[best], best) ? candidate : best;
    }

    function recordSpill(count) {
      var best = -1;
      for (var q = 0; q < count; q++) {
        var bc = queue[q];
        var bx = bc % width, by = (bc / width) | 0;
        if (bx > 0) best = pickSpill(bc - 1, best);
        if (bx < width - 1) best = pickSpill(bc + 1, best);
        if (by > 0) best = pickSpill(bc - width, best);
        if (by < height - 1) best = pickSpill(bc + width, best);
      }
      if (best < 0) return;
      spill[best] = 1;
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
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        if (hf[i] < seaLevel || lake[i]) continue;
        var gap = ringMinimum(x, y) - hf[i];
        if (gap <= 0.006) continue;
        var surface = hf[i] + gap;
        var head = 0, tail = 0;
        queue[tail++] = i;
        while (head < tail) {
          var cur = queue[head++];
          var ch = hf[cur];
          if (ch > surface) continue;
          var d = surface - ch;
          lake[cur] = Math.max(1, Math.round(Math.min(1, d / 0.09) * 60));
          var cx2 = cur % width, cy2 = (cur / width) | 0;
          if (cx2 > 0 && !lake[cur - 1] && hf[cur - 1] <= surface) queue[tail++] = cur - 1;
          if (cx2 < width - 1 && !lake[cur + 1] && hf[cur + 1] <= surface) queue[tail++] = cur + 1;
          if (cy2 > 0 && !lake[cur - width] && hf[cur - width] <= surface) queue[tail++] = cur - width;
          if (cy2 < height - 1 && !lake[cur + width] && hf[cur + width] <= surface) queue[tail++] = cur + width;
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
          key = h < seaLevel - 0.14 ? 'deep' : 'shallow';
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
            var moist = clamp01(mf[i] + (seaLevel + 0.10 - h) * 0.35 +
              (lake[i - 1] || lake[i + 1] || lake[i - width] || lake[i + width] ? 0.10 : 0));
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
          if (acc[i] > majorCut) { river[i] = 2; onRiver = 2; }
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
        if (contour && h >= seaLevel) {
          var above = (h - seaLevel) / Math.max(0.001, 1 - seaLevel);
          var band = above * 14 - Math.floor(above * 14);
          if (band < 0.10) { r *= 0.88; g *= 0.88; b *= 0.88; }
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
      ice: iceCells / n,
      ms: Date.now() - started,
      counts: counts
    };

    return {
      width: width,
      height: height,
      data: data,
      biome: biome,
      heightField: hf,
      lakeMask: lake,
      riverMask: river,
      seaLevel: seaLevel,
      stats: stats,
      palette: pal
    };
  }

  /* ------------------------------------------------------------------ *
   * Export helpers.
   * ------------------------------------------------------------------ */

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

  global.TerraCore = {
    generate: generate,
    upscale: upscale,
    hashString: hashString,
    randomSeed: randomSeed,
    palettes: PALETTES,
    biomeNames: BIOME_NAMES
  };
})(typeof window !== 'undefined' ? window : globalThis);
