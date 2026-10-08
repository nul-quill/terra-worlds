/* Terra app shell — draws the core result onto a crisp canvas. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ctx = view.getContext('2d');
  var readout = document.getElementById('readout');
  var legendList = document.getElementById('legend');
  var statsBox = document.getElementById('stats');
  var histCanvas = document.getElementById('hist');

  var inputs = {
    seed: document.getElementById('seed'),
    palette: document.getElementById('palette'),
    shape: document.getElementById('shape'),
    scale: document.getElementById('scale'),
    seaLevel: document.getElementById('seaLevel'),
    detail: document.getElementById('detail'),
    polar: document.getElementById('polar'),
    terraces: document.getElementById('terraces'),
    hillshade: document.getElementById('hillshade'),
    rivers: document.getElementById('rivers'),
    lightDir: document.getElementById('lightDir'),
    dither: document.getElementById('dither'),
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
    , contour: 'ln'
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
      seaLevel: parseFloat(inputs.seaLevel.value),
      detail: parseFloat(inputs.detail.value),
      polar: parseFloat(inputs.polar.value),
      terraces: parseInt(inputs.terraces.value, 10),
      hillshade: parseFloat(inputs.hillshade.value),
      rivers: parseInt(inputs.rivers.value, 10),
      lightDir: inputs.lightDir.value,
      dither: inputs.dither.checked,
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

    view.width = Math.round(rect.width * dpr);
    view.height = Math.round(rect.height * dpr);
    drawMap();

    drawHover();
    renderLegend(result);
    renderStats(result);
    drawHistogram(result);
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
    ctx.drawImage(off, 0, 0, view.width, view.height);
  }

  function drawHover() {
    if (!current) return;
    // Repaint from the offscreen copy first, so moving the cursor does not
    // leave a trail of previous crosshairs behind.
    drawMap();
    var cellX = view.width / current.width;
    var cellY = view.height / current.height;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(cellX * 0.25));
    if (hover.x >= 0) {
      var px = Math.floor(hover.x / cellX);
      var py = Math.floor(hover.y / cellY);
      // Hairline crosshair through the cell makes the readout easy to trust
      // on a dense grid, where the box alone is hard to place.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round((px + 0.5) * cellX) + 0.5, 0);
      ctx.lineTo(Math.round((px + 0.5) * cellX) + 0.5, view.height);
      ctx.moveTo(0, Math.round((py + 0.5) * cellY) + 0.5);
      ctx.lineTo(view.width, Math.round((py + 0.5) * cellY) + 0.5);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
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
      ['contours', s.contourBands + ' bands'],
      ['generate', s.ms + ' ms']
    ];
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
    var BINS = 48;
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
      var bh = peak ? hist[i] / peak * (h - 6) : 0;
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
    // A hovered bin gets its elevation range and cell count written into the
    // chart itself, which keeps the sidebar from reflowing on every move.
    if (only >= 0) {
      var from = lo + only / BINS * span;
      var to = lo + (only + 1) / BINS * span;
      var label = Math.round(from * 100) + '-' + Math.round(to * 100) +
        '  ' + (hist[only] || 0) + ' cells';
      hc.font = '10px system-ui, sans-serif';
      var pad = 3;
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
    hover.x = ev.clientX - rect.left;
    hover.y = ev.clientY - rect.top;
  }

  function updateReadout(ev) {
    if (!current) return;
    var rect = view.getBoundingClientRect();
    var px = Math.floor((ev.clientX - rect.left) / rect.width * current.width);
    var py = Math.floor((ev.clientY - rect.top) / rect.height * current.height);
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
      parts.push('depth ' + current.lakeMask[i]);
    } else if (!above && h < current.seaLevel - 0.14) {
      parts.push('off-shelf');
    }
    if (current.riverMask && current.riverMask[i]) {
      parts.push(current.riverMask[i] === 2 ? 'trunk river' : 'river');
    }
    readout.textContent = parts.join(' — ');
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
    a.download = 'terra-' + (inputs.seed.value || 'world') + '.png';
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
    inputs.seed.value = String(TerraCore.randomSeed());
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
  });

  window.addEventListener('resize', render);

  // Space rerolls from anywhere, unless the caret is in the seed box.
  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
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
    if ((ev.key === ' ' || ev.key === 'r') && document.activeElement !== inputs.seed) {
      ev.preventDefault();
      document.getElementById('reroll').click();
    }
  });

  render();
})();
