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
    seaLevel: document.getElementById('seaLevel'),
    detail: document.getElementById('detail'),
    terraces: document.getElementById('terraces'),
    hillshade: document.getElementById('hillshade'),
    rivers: document.getElementById('rivers')
  };

  var PRESETS = ['aurora basin', 'salt mirror', 'thousand isles', 'red ridge', 'pale shelf'];

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
      terraces: parseInt(inputs.terraces.value, 10),
      hillshade: parseFloat(inputs.hillshade.value),
      rivers: parseInt(inputs.rivers.value, 10)
    };
  }

  /* ---- drawing ---- */

  function render() {
    var opts = readOptions();
    var rect = view.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    // Native grid: keep cells chunky so the pixel look survives upscaling.
    var cols = Math.max(120, Math.round(rect.width / 3));
    var rows = Math.max(80, Math.round(rect.height / 3));

    var result = TerraCore.generate({
      seed: opts.seed, palette: opts.palette, shape: opts.shape,
      seaLevel: opts.seaLevel, detail: opts.detail, terraces: opts.terraces,
      hillshade: opts.hillshade, rivers: opts.rivers, width: cols, height: rows
    });
    current = result;

    off.width = result.width;
    off.height = result.height;
    var img = offCtx.createImageData(result.width, result.height);
    img.data.set(result.data);
    offCtx.putImageData(img, 0, 0);

    view.width = Math.round(rect.width * dpr);
    view.height = Math.round(rect.height * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = result.palette.sky;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.drawImage(off, 0, 0, view.width, view.height);

    drawHover();
    renderLegend(result);
    renderStats(result);
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
        legendList.appendChild(li);
      });
  }

  function renderStats(result) {
    var s = result.stats;
    var rows = [
      ['grid', result.width + ' x ' + result.height],
      ['land', Math.round(s.land * 100) + '%'],
      ['water', Math.round(s.water * 100) + '%'],
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
    readout.textContent = '(' + px + ', ' + py + ') — ' + (TerraCore.biomeNames[key] || key) +
      ' — ' + (elev > 0 ? '+' : '') + elev + ' units';
  }

  function savePng() {
    if (!current) return;
    var big = TerraCore.upscale(current, 3);
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
  inputs.terraces.value = '0';
  inputs.hillshade.value = '0.55';
  inputs.rivers.value = '90';

  Object.keys(inputs).forEach(function (key) {
    inputs[key].addEventListener('change', render);
    inputs[key].addEventListener('input', function () {
      if (inputs[key].type === 'range') render();
    });
  });
  inputs.seed.addEventListener('input', render);

  document.getElementById('reroll').addEventListener('click', function () {
    inputs.seed.value = String(TerraCore.randomSeed());
    render();
  });
  document.getElementById('save').addEventListener('click', savePng);

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
