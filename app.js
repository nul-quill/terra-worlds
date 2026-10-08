/* Terra app shell — draws the core result onto a crisp canvas. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ctx = view.getContext('2d');
  var readout = document.getElementById('readout');
  var legendList = document.getElementById('legend');
  var statsBox = document.getElementById('stats');
  var histCanvas = document.getElementById('hist');
  var summaryLine = document.getElementById('summary');

  var inputs = {
    seed: document.getElementById('seed'),
    palette: document.getElementById('palette'),
    shape: document.getElementById('shape'),
    scale: document.getElementById('scale'),
    gridSize: document.getElementById('gridSize'),
    seaLevel: document.getElementById('seaLevel'),
    detail: document.getElementById('detail'),
    polar: document.getElementById('polar'),
    terraces: document.getElementById('terraces'),
    hillshade: document.getElementById('hillshade'),
    rivers: document.getElementById('rivers'),
    lightDir: document.getElementById('lightDir'),
    dither: document.getElementById('dither'),
    channel: document.getElementById('channel'),
    contour: document.getElementById('contour')
  };

  var PRESETS = ['aurora basin', 'salt mirror', 'thousand isles', 'red ridge', 'pale shelf'];

  // The whole option set lives in the URL hash, so a finished world can be
  // pasted into a chat and reopen identically. Keys are short to keep the hash
  // readable; anything missing falls back to the default below. 'lit' is the
  // strength of the hillshade, 'dir' the compass bearing of the light.
  var HASH_KEYS = {
    seed: 'seed', palette: 'pal', shape: 'shape', seaLevel: 'sea',
    detail: 'det', polar: 'cli', terraces: 'stp', hillshade: 'lit',
    rivers: 'riv', scale: 's', dither: 'gr', lightDir: 'dir'
    , contour: 'ln', channel: 'ch', gridSize: 'g'
  };

  function readHash() {
    var out = {};
    var raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return out;
    raw.split('&').forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 1) return;
      out[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1));
    });
    return out;
  }

  function writeHash() {
    var parts = [];
    Object.keys(HASH_KEYS).forEach(function (key) {
      var el = inputs[key];
      if (!el) return;
      // Checkboxes are stored as 1/0 so the hash stays short.
      if (el.type === 'checkbox') {
        parts.push(HASH_KEYS[key] + '=' + (el.checked ? 1 : 0));
        return;
      }
      parts.push(HASH_KEYS[key] + '=' + encodeURIComponent(el.value));
    });
    var next = '#' + parts.join('&');
    if (next !== location.hash) {
      history.replaceState(null, '', next);
    }
  }

  // Only keys that are actually in the hash overwrite the defaults below, so
  // a hand-written link with two values still leaves the rest sensible.
  function applyHash() {
    var fromUrl = readHash();
    Object.keys(HASH_KEYS).forEach(function (key) {
      var value = fromUrl[HASH_KEYS[key]];
      var el = inputs[key];
      if (value == null || value === '' || !el) return;
      if (el.type === 'checkbox') el.checked = value === '1';
      else el.value = value;
    });
  }

  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');
  var current = null;
  var hover = { x: -1, y: -1 };

  /* ---- defaults ---- */

  function fillPalettes() {
    var names = TerraCore.palettes;
    var frag = document.createDocumentFragment();
    Object.keys(names).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = names[key].label;
      frag.appendChild(opt);
    });
    inputs.palette.appendChild(frag);
  }

  function readOptions() {
    return {
      seed: inputs.seed.value || 'terra',
      palette: inputs.palette.value,
      shape: inputs.shape.value,
      gridSize: parseInt(inputs.gridSize.value, 10) || 0,
      seaLevel: parseFloat(inputs.seaLevel.value),
      detail: parseFloat(inputs.detail.value),
      polar: parseFloat(inputs.polar.value),
      terraces: parseInt(inputs.terraces.value, 10),
      hillshade: parseFloat(inputs.hillshade.value),
      rivers: parseInt(inputs.rivers.value, 10),
      lightDir: inputs.lightDir.value,
      dither: inputs.dither.checked,
      channel: inputs.channel.value,
      contour: inputs.contour.checked
    };
  }

  /* ---- drawing ---- */

  function render() {
    var opts = readOptions();
    writeHash();
    var rect = view.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    // Native grid: keep cells chunky so the pixel look survives upscaling.
    var cols = Math.max(120, Math.round(rect.width / 3));
    var rows = Math.max(80, Math.round(rect.height / 3));
    // A chosen grid size pins the column count, so the same seed gives the same
    // cell count in a narrow window and on a wide one. Rows keep the aspect of
    // the canvas, which is what makes the cells square rather than stretched.
    if (opts.gridSize) {
      cols = opts.gridSize;
      rows = Math.max(40, Math.round(cols * rect.height / Math.max(1, rect.width)));
    }

    // Cells must be a whole number of device pixels wide, or the columns come
    var bw = Math.round(rect.width * dpr);
    var bh = Math.round(rect.height * dpr);
    // When a cell is at least two pixels wide, snap it to a whole number of
    // device pixels and trim the count to whatever fits: every cell then comes
    // out identical, and only the last couple of pixels stay sky-coloured.
    // Below two pixels the snap would throw away a visible slice of canvas, so
    // the grid keeps its fractional cell size and stretches to fill.
    var cw = bw / cols;
    var chh = bh / rows;
    if (cw >= 2) {
      cw = Math.round(cw);
      cols = Math.min(cols, Math.floor(bw / cw));
    }
    if (chh >= 2) {
      chh = Math.round(chh);
      rows = Math.min(rows, Math.floor(bh / chh));
    }

    var result = TerraCore.generate({
      seed: opts.seed, palette: opts.palette, shape: opts.shape,
      seaLevel: opts.seaLevel, detail: opts.detail, terraces: opts.terraces,
      polar: opts.polar,
      hillshade: opts.hillshade, rivers: opts.rivers, dither: opts.dither,
      lightDir: opts.lightDir,
      contour: opts.contour,
      width: cols, height: rows
    });
    current = result;
    current.cellW = cw;
    current.cellH = chh;

    // A scalar overlay replaces the colour buffer only: every field stays as
    // generated, so the readout, legend and chart still describe this world.
    if (opts.channel) {
      var chan = TerraCore.channelize(result, opts.channel);
      result.data = chan.data;
      result.channelName = chan.channel;
    }

    view.width = bw;
    view.height = bh;
    drawMap();

    drawHover();
    renderLegend(result);
    renderStats(result);
    drawHistogram(result);
    renderSummary(result);
  }

  // Blit the generated grid onto the visible canvas, nearest-neighbour.
  function drawMap() {
    if (!current) return;
    off.width = current.width;
    off.height = current.height;
    var img = offCtx.createImageData(current.width, current.height);
    img.data.set(current.data);
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = current.palette.sky;
    ctx.fillRect(0, 0, view.width, view.height);
    // Draw at the integer cell size rather than stretching to the canvas, so
    // every cell is exactly the same number of device pixels.
    var cs = cellSize();
    ctx.drawImage(off, 0, 0, current.width * cs.w, current.height * cs.h);
  }

  // Whole-device-pixel cell size, matching what render() chose for the grid.
  // The size is stored on the result by render(), so the blit, the crosshair
  // and the pointer mapping all divide by the very same numbers.
  function cellSize() {
    return { w: current.cellW, h: current.cellH };
  }

  function drawHover() {
    if (!current) return;
    // Repaint from the offscreen copy first, so moving the cursor does not
    // leave a trail of previous crosshairs behind.
    drawMap();
    // The crosshair takes the palette's own darkest ink rather than a fixed
    // white, which disappears on the pale sky of Sepia or Mono.
    var ink = hexToRgb(current.palette.sky);
    var deep = current.palette.colors.deep;
    var hair = rgba(mix(deep, ink, 0.45), 0.45);
    var edge = rgba(mix(deep, ink, 0.15), 0.9);
    var cs = cellSize();
    var cellX = cs.w;
    var cellY = cs.h;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, Math.round(cellX * 0.25));
    if (hover.x >= 0) {
      var px = Math.floor(hover.x / cellX);
      var py = Math.floor(hover.y / cellY);
      // Hairline crosshair through the cell makes the readout easy to trust
      // on a dense grid, where the box alone is hard to place.
      ctx.save();
      ctx.strokeStyle = hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round((px + 0.5) * cellX) + 0.5, 0);
      ctx.lineTo(Math.round((px + 0.5) * cellX) + 0.5, view.height);
      ctx.moveTo(0, Math.round((py + 0.5) * cellY) + 0.5);
      ctx.lineTo(view.width, Math.round((py + 0.5) * cellY) + 0.5);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(1, Math.round(cellX * 0.25));
      ctx.strokeRect(px * cellX, py * cellY, cellX, cellY);
      drawInset(px, py);
    }
  }

  // A magnified patch around the hovered cell, drawn in the corner of the
  // canvas: at 2x-3x the individual cells are hard to read, and this shows
  // the pixel structure without touching the main blit.
  function drawInset(px, py) {
    var span = 12;
    var x0 = Math.max(0, Math.min(current.width - span, px - (span >> 1)));
    var y0 = Math.max(0, Math.min(current.height - span, py - (span >> 1)));
    var size = Math.round(Math.min(view.width, view.height) * 0.28);
    var pad = Math.round(size * 0.10);
    var dx = view.width - size - pad;
    var dy = view.height - size - pad;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(dx - 2, dy - 2, size + 4, size + 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, x0, y0, span, span, dx, dy, size, size);
    ctx.strokeStyle = 'rgba(30,38,44,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 2.5, dy - 2.5, size + 5, size + 5);
    ctx.restore();
  }

  // Repaint the map with one biome kept at full strength and the rest faded
  // toward the sky colour, so a legend row can show where that class sits.
  function drawHighlighted(key) {
    if (!current) return;
    var w = current.width, h = current.height;
    var src = current.data;
    var img = offCtx.createImageData(w, h);
    var out = img.data;
    var sky = hexToRgb(current.palette.sky);
    for (var i = 0, o = 0; i < current.biome.length; i++, o += 4) {
      var keep = current.biome[i] === key ? 1 : 0.35;
      out[o] = src[o] * keep + sky[0] * (1 - keep);
      out[o + 1] = src[o + 1] * keep + sky[1] * (1 - keep);
      out[o + 2] = src[o + 2] * keep + sky[2] * (1 - keep);
      out[o + 3] = 255;
    }
    off.width = w;
    off.height = h;
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = current.palette.sky;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.drawImage(off, 0, 0, view.width, view.height);
  }

  function hexToRgb(hex) {
    var s = String(hex).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Blend two rgb triples, and turn one into a css rgba() string. Both are
  // only used for the hover overlay, so the map itself is untouched.
  function mix(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function rgba(c, alpha) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' +
      Math.round(c[2]) + ',' + alpha + ')';
  }

  // How many classes actually occur on this map. The legend only lists those,
  // so the count has to be taken from the occupancy map rather than the
  // fixed list of fourteen names.
  function biomeCount(counts) {
    var n = 0;
    Object.keys(counts).forEach(function (key) {
      if (counts[key] > 0) n++;
    });
    return n;
  }

  function renderLegend(result) {
    var keys = Object.keys(result.palette.colors);
    var counts = result.stats.counts;
    legendList.textContent = '';
    keys
      .filter(function (k) { return counts[k]; })
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .forEach(function (key) {
        var li = document.createElement('li');
        var sw = document.createElement('span');
        sw.className = 'sw';
        var c = result.palette.colors[key];
        sw.style.background = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        var label = document.createElement('span');
        label.textContent = TerraCore.biomeNames[key] || key;
        var pct = document.createElement('span');
        pct.className = 'pct';
        pct.textContent = Math.round(counts[key] / result.stats.pixels * 100) + '%';
        li.appendChild(sw); li.appendChild(label); li.appendChild(pct);
        // Hovering a row isolates that class on the map; leaving restores it.
        li.addEventListener('mouseenter', function () { drawHighlighted(key); });
        li.addEventListener('mouseleave', function () { drawMap(); });
        legendList.appendChild(li);
      });
  }

    // One line that describes the world in words rather than numbers: the shape
    // it was cut from, how much of it is dry, how much relief it carries, and
    // which class covers most of it. Reads better than scanning the table below.
    // Built in the core so the CLI prints the same sentence for the same seed.
    function renderSummary(result) {
      summaryLine.textContent = TerraCore.describe(result);
    }

  function renderStats(result) {
    var s = result.stats;
    var rows = [
      ['grid', result.width + ' x ' + result.height],
      ['land', Math.round(s.land * 100) + '%'],
      ['water', Math.round(s.water * 100) + '%'],
      ['lake', Math.round((s.counts.lake || 0) / s.pixels * 100) + '%'],
      ['ice', Math.round(s.ice * 100) + '%'],
      ['river cells', String(s.rivers)],
      ['relief', Math.round((s.max - s.min) * 100) + ' units'],
      ['biomes', String(biomeCount(s.counts))],
      ['contours', s.contourBands + ' land / ' + s.basinBands + ' basin'],
      ['pixels', s.checksum],
      ['generate', s.ms + ' ms']
    ];
    // When an overlay is on, say which one: the legend below still lists the
    // biomes, so the two together explain what is being looked at.
    if (result.channelName) {
      rows.splice(rows.length - 1, 0, ['channel', result.channelName]);
    }
    statsBox.textContent = '';
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      statsBox.appendChild(dt);
      statsBox.appendChild(dd);
    });
  }

  // A small height histogram: how much of the grid sits at each elevation, with
  // the sea level marked so the balance of a world can be read without hovering.
  // The bins are kept around so a hover over the chart can be repainted
  // without re-binning the whole field.
  var histState = null;

  function drawHistogram(result) {
    // The sidebar width changes with the window, so the backing store is sized
    // to the element rather than the attribute: a fixed-width canvas stretched
    // to 100% reads as a blur. Drawing math stays in CSS pixels because the
    // device-pixel scale is applied with a transform.
    var cssW = histCanvas.clientWidth || 240;
    var cssH = histCanvas.clientHeight || 52;
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var bw = Math.round(cssW * dpr), bhPix = Math.round(cssH * dpr);
    if (histCanvas.width !== bw) histCanvas.width = bw;
    if (histCanvas.height !== bhPix) histCanvas.height = bhPix;
    // One bin per ~5 CSS pixels, clamped: a narrow sidebar with 48 bars reads
    // as mush, a wide one with 24 wastes the space it is given.
    var BINS = Math.max(20, Math.min(72, Math.round(cssW / 5)));
    var hist = new Array(BINS);
    var hf = result.heightField;
    // Bins span the actual range of this world rather than 0..1, so a low
    // relief craton still fills the chart instead of crowding the middle.
    var lo = result.stats.min, hi = result.stats.max;
    var span = Math.max(0.001, hi - lo);
    for (var i = 0; i < hf.length; i++) {
      var b = Math.min(BINS - 1, Math.floor((hf[i] - lo) / span * BINS));
      hist[b] = (hist[b] || 0) + 1;
    }
    var peak = 0;
    for (i = 0; i < BINS; i++) if (hist[i] > peak) peak = hist[i];
    histState = {
      bins: BINS, hist: hist, peak: peak, lo: lo, span: span,
      w: cssW, h: cssH, dpr: dpr, result: result
    };
    paintHistogram(-1);
  }

  // Repaint the chart. `only` dims every bar but that one, which is how a
  // hovered bin stays readable on a 52px-tall strip.
  function paintHistogram(only) {
    if (!histState) return;
    var st = histState, hc = histCanvas.getContext('2d');
    hc.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    var w = st.w, h = st.h, BINS = st.bins, hist = st.hist, peak = st.peak;
    var lo = st.lo, span = st.span, result = st.result;
    var i;
    hc.clearRect(0, 0, w, h);
    var binW = w / BINS;
    var seaX = ((result.seaLevel - lo) / span) * w;
    if (seaX < 0) seaX = 0;
    if (seaX > w) seaX = w;
    hc.fillStyle = result.palette.sky;
    hc.fillRect(0, 0, w, h);
    // Bars take the palette's own water and grass triples, so the little chart
    // reads as part of the world it describes rather than the page chrome.
    var wet = result.palette.colors.shallow;
    var dry = result.palette.colors.grass;
    for (i = 0; i < BINS; i++) {
      // Leave a strip along the bottom for the two corner labels, so the
      // tallest bar never sits on top of the numbers.
      var bh = peak ? hist[i] / peak * (h - 12) : 0;
      var c = lo + (i + 0.5) / BINS * span < result.seaLevel ? wet : dry;
      var keep = only < 0 || i === only ? 1 : 0.45;
      hc.fillStyle = 'rgb(' +
        Math.round(c[0] * keep + 255 * (1 - keep)) + ',' +
        Math.round(c[1] * keep + 255 * (1 - keep)) + ',' +
        Math.round(c[2] * keep + 255 * (1 - keep)) + ')';
      hc.fillRect(Math.round(i * binW), Math.round(h - bh), Math.ceil(binW), Math.round(bh));
    }
    hc.strokeStyle = 'rgba(30,38,44,0.7)';
    hc.lineWidth = 1;
    hc.beginPath();
    hc.moveTo(Math.round(seaX) + 0.5, 0);
    hc.lineTo(Math.round(seaX) + 0.5, h);
    hc.stroke();
    // Corner labels give the chart a scale: without them the shape of the
    // spread is readable but the numbers are not. Drawn before the hovered-bin
    // label so a hover can cover them when space is tight.
    hc.font = '9px system-ui, sans-serif';
    var pad = 3;
    hc.fillStyle = 'rgba(30,38,44,0.55)';
    var loLabel = String(Math.round(lo * 100));
    var hiLabel = String(Math.round((lo + span) * 100));
    hc.fillText(loLabel, pad, h - 1);
    hc.fillText(hiLabel, w - pad - hc.measureText(hiLabel).width, h - 1);
    // A hovered bin gets its elevation range and cell count written into the
    // chart itself, which keeps the sidebar from reflowing on every move.
    if (only >= 0) {
      var from = lo + only / BINS * span;
      var to = lo + (only + 1) / BINS * span;
      var label = Math.round(from * 100) + '-' + Math.round(to * 100) +
        '  ' + (hist[only] || 0) + ' cells';
      hc.font = '10px system-ui, sans-serif';
      var tw = hc.measureText(label).width;
      hc.fillStyle = 'rgba(255,255,255,0.88)';
      hc.fillRect(pad - 1, 1, tw + 4, 13);
      hc.fillStyle = 'rgba(30,38,44,0.9)';
      hc.fillText(label, pad + 1, 11);
    }
  }

  /* ---- interaction ---- */

  function setHoverFromEvent(ev) {
    var rect = view.getBoundingClientRect();
    // Stored in backing-store pixels: the crosshair is drawn in that space, so
    // dividing by the cell size works at any device-pixel ratio.
    hover.x = (ev.clientX - rect.left) * (view.width / Math.max(1, rect.width));
    hover.y = (ev.clientY - rect.top) * (view.height / Math.max(1, rect.height));
  }

  // Keyboard equivalent: put the cursor on a grid cell by index, which is how
  // the arrow keys walk the map. The readout is rebuilt from the same code the
  // mouse uses, so both paths agree on what a cell says.
  function hoverCell(px, py) {
    if (!current) return;
    px = Math.max(0, Math.min(current.width - 1, px));
    py = Math.max(0, Math.min(current.height - 1, py));
    var cs = cellSize();
    hover.x = (px + 0.5) * cs.w;
    hover.y = (py + 0.5) * cs.h;
    updateReadout(px, py);
    drawHover();
  }

  function currentCell() {
    if (hover.x < 0 || !current) {
      return [Math.floor(current ? current.width / 2 : 0),
        Math.floor(current ? current.height / 2 : 0)];
    }
    var cs = cellSize();
    var px = Math.floor(hover.x / cs.w);
    var py = Math.floor(hover.y / cs.h);
    return [px, py];
  }

  function updateReadout(ev) {
    if (!current) return;
    var px, py;
    if (typeof ev === 'number') { px = ev; py = arguments[1]; }
    else {
      var rect = view.getBoundingClientRect();
      // Convert to backing-store pixels first, then divide by the integer cell
      // size — the same pair of numbers the crosshair is drawn with.
      var cs = cellSize();
      px = Math.floor((ev.clientX - rect.left) * (view.width / Math.max(1, rect.width)) / cs.w);
      py = Math.floor((ev.clientY - rect.top) * (view.height / Math.max(1, rect.height)) / cs.h);
    }
    px = Math.max(0, Math.min(current.width - 1, px));
    py = Math.max(0, Math.min(current.height - 1, py));
    var i = py * current.width + px;
    var key = current.biome[i];
    var h = current.heightField[i];
    var above = h >= current.seaLevel;
    var elev = above
      ? Math.round((h - current.seaLevel) / Math.max(0.001, 1 - current.seaLevel) * 100)
      : -Math.round((current.seaLevel - h) / Math.max(0.001, current.seaLevel) * 100);
    var parts = [
      '(' + px + ', ' + py + ')',
      (TerraCore.biomeNames[key] || key),
      (elev > 0 ? '+' : '') + elev + ' units'
    ];
    // Extra context when it costs nothing: how deep the standing water is, and
    // whether this cell is on the drainage network.
    if (above && current.lakeMask && current.lakeMask[i]) {
      // The mask stores 1..60 steps of the basin's own depth range, so the
      // readout converts it to a percentage: "depth 42" means nothing, "62%
      // deep" says how full this part of the basin is.
      parts.push(Math.round(current.lakeMask[i] / 60 * 100) + '% deep');
    } else if (!above && h < current.seaLevel - 0.14) {
      parts.push('off-shelf');
    }
    // Moisture is the other axis of the biome lookup, so printing it explains
    // why two cells at the same height land in different classes.
    if (current.moisture) {
      parts.push('moist ' + Math.round(current.moisture[i] * 100));
    }
    // Distance to the nearest shoreline, so a green patch in the middle of a
    // continent reads differently from the same colour on a coast.
    // Only worth printing inland: a water cell is by definition at the shore,
    // and a beach cell one step in, so those would repeat the biome name.
    var inland = current.coastDistance ? Math.round(current.coastDistance[i]) : 0;
    if (above && inland > 1) parts.push(inland + ' from water');
    if (current.riverMask && current.riverMask[i]) {
      // The catchment behind the channel explains why this cell is a trunk and
      // its neighbour is a tributary: it is the same accumulation number the
      // quantile cut is taken from.
      var catchment = current.accumulation
        ? Math.round(current.accumulation[i]) : 0;
      parts.push((current.riverMask[i] === 2 ? 'trunk river' : 'river') +
        (catchment > 1 ? ' (' + catchment + ' cells)' : ''));
    }
    readout.textContent = parts.join(' — ');
    // Tie the readout to the relief chart: the bin this cell falls in is
    // highlighted, so a colour on the map can be traced back to where it sits
    // in the world's elevation spread.
    paintHistogram(histBinFor(h));
  }

  // Bin index for a height, using the range the chart was binned over.
  function histBinFor(h) {
    if (!histState) return -1;
    var b = Math.floor((h - histState.lo) / histState.span * histState.bins);
    return Math.max(0, Math.min(histState.bins - 1, b));
  }

  function savePng() {
    if (!current) return;
    var big = TerraCore.upscale(current, parseInt(inputs.scale.value, 10) || 3);
    var c = document.createElement('canvas');
    c.width = big.width;
    c.height = big.height;
    var cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    var img = cx.createImageData(big.width, big.height);
    img.data.set(big.data);
    cx.putImageData(img, 0, 0);
    var a = document.createElement('a');
    // The seed alone is not enough to recognise a saved file later: the shape
    // and the grid size tell you which of the many rerolls this was.
    var nameParts = ['terra', inputs.seed.value || 'world', inputs.shape.value,
      current.width + 'x' + current.height];
    // Shape comes off the result rather than the select, so a name written from
    // a hash that skipped the control still matches the world on screen.
    nameParts[2] = current.shape || nameParts[2];
    a.download = nameParts.join('-').replace(/\s+/g, '_') + '.png';
    a.href = c.toDataURL('image/png');
    a.click();
  }

  /* ---- wiring ---- */

  fillPalettes();
  inputs.seed.value = PRESETS[0];
  inputs.seaLevel.value = '0.48';
  inputs.detail.value = '0.35';
  inputs.polar.value = '0.70';
  inputs.terraces.value = '0';
  inputs.hillshade.value = '0.55';
  inputs.rivers.value = '90';
  inputs.scale.value = '3';
  inputs.dither.checked = true;
  // Anything in the address bar wins over the defaults above.
  applyHash();

  Object.keys(inputs).forEach(function (key) {
    inputs[key].addEventListener('change', render);
    inputs[key].addEventListener('input', function () {
      if (inputs[key].type === 'range') render();
    });
  });
  inputs.seed.addEventListener('input', render);
  window.addEventListener('hashchange', function () { applyHash(); render(); });

  document.getElementById('reroll').addEventListener('click', function () {
    // Chain from the current seed rather than picking a fresh random one, so
    // the same starting phrase always walks the same sequence of worlds and a
    // shared link lands on the same tenth reroll.
    inputs.seed.value = String(TerraCore.nextSeed(inputs.seed.value));
    render();
  });
  document.getElementById('save').addEventListener('click', savePng);

  // The hash already holds every option, so the current URL is the whole state.
  document.getElementById('copy').addEventListener('click', function () {
    var url = location.href;
    var done = function () {
      var btn = document.getElementById('copy');
      var was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 900);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    } else {
      var tmp = document.createElement('textarea');
      tmp.value = url;
      document.body.appendChild(tmp);
      tmp.select();
      try { document.execCommand('copy'); } catch (e) { /* older browsers */ }
      document.body.removeChild(tmp);
      done();
    }
  });

  view.addEventListener('mousemove', function (ev) {
    setHoverFromEvent(ev);
    updateReadout(ev);
    drawHover();
  });

  // The relief chart is small, so the readout for a bin is drawn inside the
  // chart rather than in the hud strip under the map.
  histCanvas.addEventListener('mousemove', function (ev) {
    if (!histState) return;
    var rect = histCanvas.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var bin = Math.floor(x / Math.max(1, rect.width) * histState.bins);
    paintHistogram(bin < 0 ? 0 : Math.min(histState.bins - 1, bin));
  });
  histCanvas.addEventListener('mouseleave', function () { paintHistogram(-1); });

  view.addEventListener('mouseleave', function () {
    hover.x = -1; hover.y = -1;
    readout.textContent = 'hover the map';
    drawHover();
    // The chart keeps the last hovered bin until something else picks one, so
    // dropping the pointer off the map clears it along with the readout.
    paintHistogram(-1);
  });

  window.addEventListener('resize', render);

  // Space rerolls from anywhere, unless the caret is in the seed box.
  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // Arrows walk the hovered cell, so the readout is reachable without a
    // pointer. The first press starts from the middle of the grid.
    var step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step) {
      // Only when a text field does not want the arrow for its own caret.
      var ae = document.activeElement;
      var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT');
      if (!typing) {
        var cell = currentCell();
        ev.preventDefault();
        hoverCell(cell[0] + step[0], cell[1] + step[1]);
      }
      return;
    }
    // Number keys pick the palette by position, so a look can be recalled
    // without reaching for the select.
    if (/^[1-9]$/.test(ev.key)) {
      var names = Object.keys(TerraCore.palettes);
      var idx = parseInt(ev.key, 10) - 1;
      if (idx < names.length) {
        ev.preventDefault();
        inputs.palette.value = names[idx];
        render();
      }
      return;
    }
    // 'c' steps through the overlays, which is the quickest way to compare a
    // handful of scalar fields on the same seed.
    if (ev.key === 'c' || ev.key === 'C') {
      ev.preventDefault();
      var order = ['', 'relief', 'moist', 'drain', 'coast'];
      var at = order.indexOf(inputs.channel.value);
      inputs.channel.value = order[(at + 1) % order.length];
      render();
      return;
    }
    if ((ev.key === ' ' || ev.key === 'r') && document.activeElement !== inputs.seed) {
      ev.preventDefault();
      document.getElementById('reroll').click();
    }
  });

  render();
})();
