/* Terra app shell — draws the core result onto a crisp canvas. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ctx = view.getContext('2d');
  var readout = document.getElementById('readout');
  var legendList = document.getElementById('legend');
  var statsBox = document.getElementById('stats');

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
    var cellX = view.width / current.width;
    var cellY = view.height / current.height;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(cellX * 0.25));
    if (hover.x >= 0) {
      var px = Math.floor(hover.x / cellX);
      var py = Math.floor(hover.y / cellY);
      ctx.strokeRect(px * cellX, py * cellY, cellX, cellY);
    }
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
  view.addEventListener('mouseleave', function () {
    hover.x = -1; hover.y = -1;
    readout.textContent = 'hover the map';
    drawHover();
  });

  window.addEventListener('resize', render);

  // Space rerolls from anywhere, unless the caret is in the seed box.
  document.addEventListener('keydown', function (ev) {
    if (ev.key === ' ' && document.activeElement !== inputs.seed) {
      ev.preventDefault();
      document.getElementById('reroll').click();
    }
  });

  render();
})();
