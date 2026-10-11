      // The spread plus its two ends: the difference alone cannot say whether a
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

  // The starting phrases come from the generator's list, which is also what
  // `cli --phrases` prints and what the `p` key walks.
  var PRESETS = TerraCore.phrases;

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

  // Whether a SELECT offers a given value. Used when restoring a link so a
  // stale key cannot blank out a control that would otherwise show a sensible
  // default.
  function hasOption(select, value) {
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return true;
    }
    return false;
  }

  // Same rule the CLI parser follows: a value that does not read as a
  // number is dropped rather than passed on as NaN. In the generator every
  // comparison against NaN is false, so a single unparsed field turns a
  // whole world into flat dry land. Leaving the key undefined lets the
  // generator's own default stand.
  // `Number` rather than the two `parse*` functions: those stop at the first
  // character they cannot read, so a value with junk on the end (`800x`)
  // still reaches the generator as its leading digits. Here as in the CLI an
  // unreadable value means unset, and an empty box is a missing value rather
  // than a zero — `Number('')` is 0, which would shrink the grid to the
  // smallest one the generator can draw. Every control on the page reads its
  // own number through this one helper, so a slider and a flag cannot pick
  // two different grids for one phrase.
  function num(value, isInt) {
    return TerraCore.readNumber(value, isInt);
  }

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
    // The pinned legend class is not a form control, so it rides along here.
    // A link with `pin=taiga` should reopen with that class still isolated.
    if (pinned) parts.push('pin=' + encodeURIComponent(pinned));
    // The hovered cell too, so a link can point at one inlet rather than at a
    // whole world. Written as a pair of grid indices, which survive a resize:
    // the cell is clamped into whatever grid the new window asks for.
    if (hover.x >= 0 && current) {
      var cell = currentCell();
      parts.push('at=' + cell[0] + ',' + cell[1]);
    }
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
      if (el.type === 'checkbox') {
        el.checked = value === '1';
        return;
      }
      // A dropdown only accepts a key its own list offers. An older link can
      // name a palette or overlay that has since been dropped, and setting a
      // missing value on a SELECT leaves it showing nothing at all — so the
      // stale pair is skipped and the default stands.
      if (el.tagName === 'SELECT' && !hasOption(el, value)) return;
      el.value = value;
    });
    // The pin is not an input, so it is read separately. Only a class the
    // palette actually knows is accepted, which keeps a hand-written link from
    // producing a map where every cell is faded.
    var pin = fromUrl.pin;
    pinned = pin && TerraCore.biomeNames[pin] ? pin : null;
    // A cell picked by the link is applied after the first render, since the
    // grid size is not known before then. Anything unparseable is ignored, so
    // a hand-written link with only two values still works.
    var at = fromUrl.at;
    atCell = null;
    if (at && /^\d+,\d+$/.test(at)) {
      var xy = at.split(',');
      atCell = [parseInt(xy[0], 10), parseInt(xy[1], 10)];
    }
  }

  var off = document.createElement('canvas');
  var offCtx = off.getContext('2d');
  var current = null;
  var hover = { x: -1, y: -1 };
  // Which biome is currently isolated: `solo` follows the pointer over the
  // legend, `pinned` survives it and is set by clicking a row. Either one is
  // enough to fade the rest of the map, which is what lets a selection be
  // studied after the pointer has moved on to the canvas.
  var solo = null;
  var pinned = null;
  // Cell picked out of the URL hash, as a pair of grid indices, or null. Like
  // `at=` in the hash it survives a resize: the indices are clamped into each
  // new grid rather than remembered as pixels.
  var atCell = null;
  // Height band picked by hovering the relief chart: a bin index, or -1. Like
  // `solo` this is a preview, so it is not written into the hash.
  var band = -1;
  // Bin the hovered map cell falls in, as a bin index, or -1. Kept beside
  // `band` rather than folded into it: the chart hover is a choice, this is a
  // reading, and a repaint has to be able to restore the reading without
  // pretending the pointer had picked a bar. Also a preview, also out of the
  // hash.
  var cellBand = -1;
  // Whether the magnifier panel is drawn. It is the one overlay that covers
  // part of the map rather than tinting it, so on a small window it is worth
  // being able to drop. Like the hovered bin this is a view setting, not part
  // of the world, so it stays out of the hash.
  var insetOn = true;

  /* ---- defaults ---- */

  // Every dropdown on this page is a list of `{key, label}` pairs from the
  // core, so one fill loop covers them all: the option's value is the key a
  // link stores, its text is what the row shows. A list is added in
  // `src/core.js`, and the cycle key named for that select walks the same
  // array, so the two can never disagree about the order.
  function fillOptions(select, items) {
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = item.label;
      frag.appendChild(opt);
    });
    select.appendChild(frag);
  }

  function fillPalettes() {
    var names = TerraCore.palettes;
    var items = Object.keys(names).map(function (key) {
      return {key: key, label: names[key].label};
    });
    fillOptions(inputs.palette, items);
  }

  // Shapes come from the generator's own list, so the dropdown, `cli --shapes`
  // and shapeHeight() cannot disagree about which keys exist.
  function fillShapes() {
    fillOptions(inputs.shape, TerraCore.shapes);
  }

  // Same for the overlays: the dropdown, the `c` cycle and the ramp in
  // channelize() all walk this one list.
  function fillChannels() {
    fillOptions(inputs.channel, TerraCore.channels);
  }

  // The four compass bearings come from the same list the shade pass reads, so
  // the dropdown, the `d` key and `cli --lights` all offer the same four.
  function fillLights() {
    fillOptions(inputs.lightDir, TerraCore.lights);
  }

  // Column counts come from the core too, so a pinned grid in a link means the
  // same thing after the list is edited.
  function fillGrids() {
    fillOptions(inputs.gridSize, TerraCore.grids);
  }

  // The export multipliers come from the core as well, so the sizes a link can
  // name are the sizes `cli --scales` prints.
  function fillScales() {
    fillOptions(inputs.scale, TerraCore.scales);
  }

  function readOptions() {
    return {
      seed: inputs.seed.value || 'terra',
      palette: inputs.palette.value,
      shape: inputs.shape.value,
      gridSize: num(inputs.gridSize.value, true) || 0,
      seaLevel: num(inputs.seaLevel.value, false),
      detail: num(inputs.detail.value, false),
      polar: num(inputs.polar.value, false),
      terraces: num(inputs.terraces.value, true),
      hillshade: num(inputs.hillshade.value, false),
      rivers: num(inputs.rivers.value, true),
      lightDir: inputs.lightDir.value,
      dither: inputs.dither.checked,
      channel: inputs.channel.value,
      contour: inputs.contour.checked
    };
  }

  /* ---- drawing ---- */

  // Both canvases size their backing store from this one number. The clamp is
  // the contract: at 1 the grid is drawn one device pixel per cell, above 2 a
  // phone's third or fourth band would buy no readable detail while quadrupling
  // the work, so the scale is held between those two. Two copies of the clamp
  // could be edited apart, and a map blitted at one scale under a chart drawn at
  // another reads as a blurry strip beneath a sharp picture.
  function pixelScale() {
    return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  }

  // A one-pixel stroke lands between two device pixels unless its coordinate is
  // pushed to the middle of one, which is what the half-pixel offset does. Both
  // canvases draw hairlines — the crosshair, the sea rule, the decade ticks and
  // the median mark — and each of those reads the offset through this one
  // lookup, so a change to the stroke width of one mark cannot leave the others
  // sitting a half pixel away from the marks beside them.
  function hairline(x) {
    return Math.round(x) + 0.5;
  }

  // Snap one axis of the grid to a whole number of device pixels. A cell at
  // least two pixels wide is rounded and the count trimmed to whatever still
  // fits, so every cell is the same size and only the last couple of pixels
  // stay sky-coloured; below two pixels the snap would throw away a visible
  // slice, so the axis keeps its fractional size and stretches to fill. Both
  // axes go through here so a wide window cannot snap its columns while its
  // rows stayed fractional — that pair reads as cells two pixels tall and one
  // and a half wide. Returns the cell size and the count that fits it.
  function snapCell(boxes, count) {
    var size = boxes / count;
    if (size < 2) return { size: size, n: count };
    size = Math.round(size);
    return { size: size, n: Math.min(count, Math.floor(boxes / size)) };
  }

  // Without a pinned column count the grid is one cell per three CSS pixels,
  // with a floor so a small window still shows some relief rather than a
  // handful of very large blocks. Both axes read that through here, so the
  // two of them cannot end up with different notions of a chunky cell.
  function autoCount(px, floor) {
    return Math.max(floor, Math.round(px / 3));
  }

  function render() {
    var opts = readOptions();
    writeHash();
    var rect = view.getBoundingClientRect();
    var dpr = pixelScale();

    // Native grid: keep cells chunky so the pixel look survives upscaling.
    var cols = autoCount(rect.width, 120);
    var rows = autoCount(rect.height, 80);
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
    var snapX = snapCell(bw, cols);
    var snapY = snapCell(bh, rows);
    var cw = snapX.size;
    var chh = snapY.size;
    cols = snapX.n;
    rows = snapY.n;

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
    // A pinned class is a filter over the grid, so it only means something
    // while this world has cells of that class. A new grid — a wider column
    // count, a different shape — can drop a class entirely, and the legend is
    // rebuilt from the classes that remain: the dimming would stay while the
    // row that would release it is gone. Drop the pin in that case rather
    // than leaving a washed-out map with nothing left to click.
    if (pinned && !result.stats.counts[pinned]) pinned = null;

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
    // The line under the map quotes counts from this world, so a rebuild has
    // to rewrite it: a new grid — or a slider step — changes every share in the
    // legend, and a stale figure beside a fresh one reads as two worlds. Done
    // before the hovered cell is restored so a cell reading still wins over
    // the note, which is what a pointer resting on the map expects to see.
    if (hover.x < 0) bandNote();
    // A link that named one cell gets it back after the rebuild, as long as the
    // pointer has not taken over in the meantime. The indices are clamped by
    // hoverCell, so a link written on a wide window still lands sensibly in a
    // narrow one.
    if (hover.x < 0 && atCell) hoverCell(atCell[0], atCell[1]);
  }

  // Blit the generated grid onto the visible canvas, nearest-neighbour.
  function drawMap() {
    if (!current) return;
    off.width = current.width;
    off.height = current.height;
    var img = offCtx.createImageData(current.width, current.height);
    // A pinned legend class fades every other class toward the sky colour, so
    // the map itself carries the selection. Done here rather than in a second
    // function because every repaint — hover, resize, blur — goes through this
    // one path, and the two must not disagree about what "clean" looks like.
    var src = current.data;
    var out = img.data;
    // A hovered row wins over a pinned one, so hovering elsewhere in the list
    // still previews while the click selection waits underneath it.
    var want = solo || pinned;
    var sky = want ? skyRgb() : null;
    // A hovered bar in the relief chart is the other way to isolate: it selects
    // by height instead of by class, so a band of the histogram lights up the
    // matching cells on the map. Same blend, one more test in the same loop.
    var hs = histState;
    // The bin a hovered cell falls in is a reading rather than a filter: it
    // lights the matching bar in the chart, but only a bar the pointer picked
    // dims the map. Both still have to reach the chart repaint, so the pair is
    // resolved once here — the picked bar wins where both are set.
    var litBand = band >= 0 ? band : cellBand;
    var bandLo = 0, bandSpan = 1, bandOn = band >= 0 && hs;
    // A legend selection wins over a hovered band: the row is what the pointer
    // is on, and two stacked filters would read as a third, dimmer state.
    if (want) bandOn = false;
    if (bandOn) {
      bandLo = hs.lo; bandSpan = hs.span;
      sky = sky || skyRgb();
    }
    var i;
    for (i = 0; i < src.length; i += 4) {
      var cell = i >> 2;
      var keep = (!want || current.biome[cell] === want) &&
        (!bandOn || histBinFor(current.heightField[cell]) === band) ? 1 : 0.35;
      out[i] = src[i] * keep + (sky ? sky[0] * (1 - keep) : 0);
      out[i + 1] = src[i + 1] * keep + (sky ? sky[1] * (1 - keep) : 0);
      out[i + 2] = src[i + 2] * keep + (sky ? sky[2] * (1 - keep) : 0);
      out[i + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = current.palette.sky;
    ctx.fillRect(0, 0, view.width, view.height);
    // Draw at the integer cell size rather than stretching to the canvas, so
    // every cell is exactly the same number of device pixels.
    var cs = cellSize();
    ctx.drawImage(off, 0, 0, current.width * cs.w, current.height * cs.h);
    // The relief chart reads the same selection, so it is repainted from this
    // one place too: every path that changes what is highlighted goes through
    // here, and the two views cannot end up showing different filters.
    paintHistogram(litBand);
  }

  // Whole-device-pixel cell size, matching what render() chose for the grid.
  // The size is stored on the result by render(), so the blit, the crosshair
  // and the pointer mapping all divide by the very same numbers.
  function cellSize() {
    return { w: current.cellW, h: current.cellH };
  }

  // Keep a cell index inside one axis of the grid. Three paths name a cell —
  // the keyboard walk, the hash writer's reader, and the readout itself — and
  // all three must land on the same cell for one click, so the clamp is one
  // lookup rather than a pair of bounds written beside each call. A narrower
  // grid than the one a link was saved against is the case that matters: the
  // restored index has to come back inside the same way a pointer does.
  function clampIndex(n, count) {
    return Math.max(0, Math.min(count - 1, n));
  }

  // Which cell a backing-store pixel falls in. Three paths ask that question —
  // the crosshair, the reader behind the `at=` pair and the readout — and each
  // divides by the very cell size the blit was drawn with, so the division is
  // one lookup rather than three that could be edited to round differently.
  function cellOf(x, y) {
    var cs = cellSize();
    return [Math.floor(x / cs.w), Math.floor(y / cs.h)];
  }

  // The next stop on a list cycle, one step in either direction. Every cycle
  // key answers to `Shift` too, so the step can be negative and the modulo has
  // to come back positive — hence the second wrap. Six lists walk through
  // here: overlay, shape, light, grid, export and the seed phrases. Written at
  // each call site, one of them could drop the second wrap, and that key alone
  // would stick on its first entry under `Shift` while the other five backed
  // out properly.
  function cycleIndex(i, step, count) {
    return ((i + step) % count + count) % count;
  }
  // Where a pointer sits inside a canvas, as a fraction of its layout box. Both
  // canvases need that pair — the map turns it into backing-store pixels for
  // the crosshair, the chart turns it into a bin index — and both have to
  // survive a box that measures nothing, which is what the guard is for. Two
  // copies of the division could be edited apart, and one canvas would then
  // divide by zero while the other still placed its mark.
  function pointerFraction(ev, rect) {
    return {
      x: (ev.clientX - rect.left) / Math.max(1, rect.width),
      y: (ev.clientY - rect.top) / Math.max(1, rect.height)
    };
  }
  // Where a pointer sits, in backing-store pixels. The crosshair is drawn in
  // that space, so both pointer paths convert through here: the ratio of the
  // canvas's own width to its layout width is what maps a click onto the
  // buffer, guarded so an empty layout still divides. Two copies of that pair
  // could be edited apart, and the hover mark would then sit on one cell while
  // the readout named the neighbour to its left.
  function pointerPos(ev) {
    var rect = view.getBoundingClientRect();
    var f = pointerFraction(ev, rect);
    return { x: f.x * view.width, y: f.y * view.height };
  }

  function drawHover() {
    if (!current) return;
    // Repaint from the offscreen copy first, so moving the cursor does not
    // leave a trail of previous crosshairs behind.
    drawMap();
    // The crosshair takes the palette's own darkest ink rather than a fixed
    // white, which disappears on the pale sky of Sepia or Mono.
    var ink = skyRgb();
    var deep = current.palette.colors.deep;
    var hair = rgba(mix(deep, ink, 0.45), 0.45);
    var edge = rgba(mix(deep, ink, 0.15), 0.9);
    var cs = cellSize();
    var cellX = cs.w;
    var cellY = cs.h;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, Math.round(cellX * 0.25));
    if (hover.x >= 0) {
      var cell = cellOf(hover.x, hover.y);
      var px = cell[0];
      var py = cell[1];
      // Hairline crosshair through the cell makes the readout easy to trust
      // on a dense grid, where the box alone is hard to place.
      ctx.save();
      ctx.strokeStyle = hair;
      ctx.lineWidth = 1;
      ctx.beginPath();
      var cx = hairline((px + 0.5) * cellX);
      var cy = hairline((py + 0.5) * cellY);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, view.height);
      ctx.moveTo(0, cy);
      ctx.lineTo(view.width, cy);
      ctx.stroke();
      ctx.restore();
      ctx.strokeRect(px * cellX, py * cellY, cellX, cellY);
      if (insetOn) drawInset(px, py);
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
    // Put the inset in whichever half of the canvas the cursor is NOT in, so
    // the cell being inspected is never hidden behind its own magnifier. The
    // choice is a comparison, not a random offset, so the same hover still
    // produces the same pixels.
    var dx = px * 2 > current.width ? pad : view.width - size - pad;
    var dy = py * 2 > current.height ? pad : view.height - size - pad;
    ctx.save();
    // The panel backing is the palette's own sky, at the same alpha the crosshair
    // uses, so a dark scheme keeps a dark mat under the magnified patch instead
    // of a bright slab. Both colours come from the lookup above, which is also
    // what the isolation blend reads — one source for every overlay colour.
    var sky = skyRgb();
    ctx.fillStyle = rgba(sky, 0.85);
    ctx.fillRect(dx - 2, dy - 2, size + 4, size + 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, x0, y0, span, span, dx, dy, size, size);
    ctx.strokeStyle = rgba(mix(current.palette.colors.deep, sky, 0.35), 0.55);
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 2.5, dy - 2.5, size + 5, size + 5);
    // The patch is a dozen cells wide, so the one under the cursor still has
    // to be identifiable inside it. Same ink as the crosshair, one cell of the
    // patch's own scale — the offset is the difference of two clamped indices,
    // so it stays inside the panel at every edge of the grid.
    var patch = size / span;
    ctx.strokeStyle = rgba(mix(current.palette.colors.deep, sky, 0.15), 0.9);
    ctx.strokeRect(dx + (px - x0) * patch, dy + (py - y0) * patch, patch, patch);
    ctx.restore();
  }

  // Repaint the map with one biome kept at full strength and the rest faded
  // toward the sky colour, so a legend row can show where that class sits.
  // The blend lives in drawMap so a hovered selection and a clicked one cannot
  // drift apart: this only records which class is wanted and repaints.
  function drawHighlighted(key) {
    solo = key;
    drawMap();
    bandNote();
  }

  function hexToRgb(hex) {
    var s = String(hex).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Every overlay on the map — the isolation wash, the crosshair's ink, the
  // mat under the magnifier — is the palette's own sky, so the parse of that
  // hex string is one lookup. Written at each site, a scheme whose sky is
  // stored as a triple rather than a string would need the same guard four
  // times, and a wash that skipped it would fade toward a different colour
  // than the ink drawn over it.
  function skyRgb() {
    return hexToRgb(current.palette.sky);
  }

  // The wash every dimmed thing is blended toward: the hovered cells on the
  // map and the unlit bars of the relief chart both fade to this, so a faded
  // row and a faded bar of the same class read as the same distance back.
  var WHITE = [255, 255, 255];

  // The chart's own ink, on purpose: the relief strip sits on the page rather
  // than on the map, so it keeps one hue while the map follows its palette.
  // Seven marks are drawn with it — the sea rule, the decade ticks, the median
  // mark and the four labels — each at its own alpha, so the hue is named once
  // and only the strength varies per mark.
  var INK = [30, 38, 44];

  // Blend two rgb triples, and turn one into a css rgba() string. The overlay,
  // the magnifier's mat and the dimmed bars all go through these two rather
  // than each writing its own weighted sum.
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

  // Where a height lands along the chart's own width. Three marks are placed
  // that way — the sea rule, the decade ticks and the median — and each of
  // them sits on the range the bars were binned over, so the pair of ends is
  // passed in rather than looked up again. Written at each site, one mark
  // could drop its subtraction of the low end and still land inside the box,
  // drifting away from the bars it is meant to describe.
  function chartX(value, lo, span, w) {
    return ((value - lo) / span) * w;
  }

  // Shrink a list of short fields until its text fits a given width, dropping
  // the least useful field first. The hovered-bin label is the only row that
  // has to do this — a narrow sidebar cannot hold range, count and class at
  // once — and the pair of ends is what ties a bar back to the map, so it is
  // always the last one left. The gap between two fields is the same string on
  // every pass of that loop, which is what keeps a trimmed label looking like
  // the full one rather than like a different kind of note.
  function fitLabel(hc, parts, limit) {
    var keep = [];
    var n;
    for (n = 0; n < parts.length; n++) {
      if (parts[n]) keep.push(parts[n]);
    }
    var label = keep.join('  ');
    while (keep.length > 1 && hc.measureText(label).width > limit) {
      keep.pop();
      label = keep.join('  ');
    }
    return label;
  }

  // Same rule for a fraction that is already normalised: whole numbers above
  // ten percent, one decimal below, so a two-percent class and a
  // zero-two-percent class never print the same string.
  function percentText(fraction) {
    return TerraCore.percentText(fraction);
  }

  // Every height on the page is stored 0..1 and printed as a whole number out
  // of a hundred, so the scaling lives in one place: the stats rows, the chart's
  // corner labels, the sea rule and the hover readout all go through it. That is
  // what makes `median 49` in the stats list and `median 49` under the bars the
  // same measurement rather than two roundings that happen to agree.
  // The lookup is the core's own, so the CLI's caption and record round a height
  // the same way this page does — a figure read off a printed page and one read
  // off a terminal line are then the same measurement.
  function hundred(value) {
    return TerraCore.hundred(value);
  }

  // The smallest band a height can be scaled against. A sea level of 1 leaves
  // no room above the shoreline, and one of 0 leaves none below it, so each
  // share of the elevation reading divides by this floor rather than by an
  // empty band. One lookup so the two halves of that reading — the height of
  // land above the line, the depth of water below it — cannot be scaled
  // against two different notions of a flat world.
  function fillSpan(span) {
    return Math.max(0.001, span);
  }

  // Which way a basin's surplus leaves. The bearing array is indexed by the
  // basin's own number minus one, and two branches of the readout need that
  // pair — a filled cell names its lake and its outflow, the one rim cell that
  // IS the outflow names the same two things. Two copies of the offset could
  // disagree by one slot, which would print one lake draining two ways while
  // each caption still looked plausible beside its own cell.
  function spillBearing(no) {
    return current.basinSpill && current.basinSpill[no - 1];
  }

  // Which of the world's lakes a cell belongs to: the basin's own number over
  // how many there are. Two branches print that pair — a filled cell says
  // `basin 2/4`, the one rim cell that is its outflow says `outlet of basin
  // 2/4` — and the denominator is the count the `basins` row prints, so both
  // halves come from one read of the stats. Written twice, the numerator could
  // keep its own count on one side and the two figures would name different
  // worlds while each still looked like a tally.
  function basinTally(no) {
    return no + '/' + current.stats.lakeBasins;
  }

  // How many classes actually occur on this map. The legend only lists those,
  // so the count has to be taken from the occupancy map rather than the
  // fixed list of fourteen names.
  function biomeCount(counts) {
    return TerraCore.biomeCount(counts);
  }

  // A class's display name, with the raw key as its fallback. Every place a
  // biome is named — a legend row, the chart's hovered-bin label, the hover
  // readout and its mismatch note — reads it through here, so a key the lookup
  // does not know cannot print as a name in one view and as the key in another.
  function biomeLabel(key) {
    return TerraCore.biomeNames[key] || key;
  }

  // Whichever way the legend's pin changed, the same four things follow: the
  // rows are rebuilt so the ring and the spoken attribute follow, the map is
  // repainted so its wash follows, the pair is stored so a pasted URL keeps the
  // class, and the line under the map is refreshed so its word for the filter
  // is the one actually in force. Both pin paths — a click on a row and the `k`
  // cycle — end with this one call, so a sixth step cannot arrive on one of
  // them and leave a mouse pin and a keyboard pin described differently in the
  // same link.
  function applyPin() {
    renderLegend(current);
    drawMap();
    writeHash();
    bandNote();
  }

  function renderLegend(result) {
    var keys = legendKeys(result);
    var counts = result.stats.counts;
    // Both ways of pinning a row — the click and the row's own Enter/Space —
    // run the same five steps: flip the pin, rebuild the rows so the ring and
    // the attribute follow, repaint both views, store the pair in the link and
    // refresh the line under the map. Written at each site, a sixth step added
    // to one branch only would leave a keyboard pin and a mouse pin describing
    // different worlds in the same link.
    function togglePin(key) {
      pinned = pinned === key ? null : key;
      applyPin();
    }
    legendList.textContent = '';
    keys.forEach(function (key) {
        var li = document.createElement('li');
        // The key is kept on the element so a rebuild can find the same row
        // again and hand the caret back after a keyboard toggle.
        li.setAttribute('data-key', key);
        var sw = document.createElement('span');
        sw.className = 'sw';
        var c = result.palette.colors[key] || result.palette.colors.grass;
        sw.style.background = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        var label = document.createElement('span');
        label.textContent = biomeLabel(key);
        var pct = document.createElement('span');
        pct.className = 'pct';
        pct.textContent = percentText(TerraCore.classShare(result.stats, key));
        li.appendChild(sw); li.appendChild(label); li.appendChild(pct);
        // Hovering a row isolates that class on the map; leaving restores it.
        // Both halves repaint through drawHover(), so a cell picked earlier —
        // from the hash or a previous hover — keeps its mark when the pointer
        // leaves the list. drawMap() alone would repaint the grid and lose it.
        li.addEventListener('mouseenter', function () { drawHighlighted(key); });
        li.addEventListener('mouseleave', clearSolo);
        // Clicking keeps the choice after the pointer moves away, which is how
        // to compare a class against the relief chart without holding the
        // cursor on its row. Clicking the same row again releases it.
        li.addEventListener('click', function () {
          togglePin(key);
        });
        // A row is in the tab order, so it has to answer to the keyboard too:
        // Enter or Space toggles the same pin a click would. Without this the
        // click selection would be mouse-only while hover and focus were not.
        li.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          // Space is also the reroll shortcut, so the row has to claim the key
          // before the document handler sees it.
          ev.stopPropagation();
          togglePin(key);
          // Rebuilding the list drops the caret, so put it back on the row that
          // was just activated: a second Enter should release the pin without
          // tabbing through the list again.
          var again = legendList.querySelector('[data-key="' + key + '"]');
          if (again) again.focus();
        });
        if (pinned === key) li.className = 'on';
        // The class only carries the ring, which a screen reader cannot read
        // back, so the row also states its own pin: `true` on the one class
        // kept at full strength, `false` on every other row. One assignment
        // covers both halves, so the two can never disagree about which row is
        // pinned after a rebuild.
        li.setAttribute('aria-current', pinned === key ? 'true' : 'false');
        // Same thing for a keyboard user tabbing through the list: focus takes
        // the place of the pointer, so the isolation trick works without a
        // mouse. The rows are only there to be read, so they are in the tab
        // order deliberately.
        li.tabIndex = 0;
        li.addEventListener('focus', function () { drawHighlighted(key); });
        li.addEventListener('blur', clearSolo);
        legendList.appendChild(li);
      });
  }

  // Dropping a legend hover — the pointer leaving the list, or the caret moving
  // off a row — is one sequence: give the preview back, repaint so the kept
  // selection (or no selection) shows, and rename the line under the map to
  // match. Both halves repaint through drawHover() rather than a bare drawMap(),
  // so a cell picked earlier — from the hash or a previous hover — keeps its
  // mark when the list is left. Written at each site, a step dropped on one of
  // them would leave a pointer-only or keyboard-only clear.
  function clearSolo() {
    solo = null;
    drawHover();
    bandNote();
  }

  // The legend rows in the order they are shown: every class present on this
  // world, biggest first. Both the list and the `k` cycle read this one
  // function, so the key walks the rows in the order they appear rather than
  // in the order the palette happens to declare them.
  function legendKeys(result) {
    // The ranking is the core's, so a terminal reading the record's `classes`
    // column ranks a tied pair exactly as the rows on this page do.
    return TerraCore.legendOrder(result);
  }

    // One line that describes the world in words rather than numbers: the shape
    // it was cut from, how much of it is dry, how much relief it carries, and
    // which class covers most of it. Reads better than scanning the table below.
    // Built in the core so the CLI prints the same sentence for the same seed.
    function renderSummary(result) {
      summaryLine.textContent = TerraCore.describe(result);
    }

  // What Save PNG will write: the grid times the multiplier in the export
  // dropdown. One lookup so the stats row and the saved file cannot disagree
  // about which factor was in use.
  function exportFactor() {
    return num(inputs.scale.value, true) || 3;
  }

  function renderStats(result) {
    var s = result.stats;
    var factor = exportFactor();
    var rows = [
      // First so a printed page or a screenshot of the sidebar still says
      // which phrase the world came from — the hash is not on paper.
      ['seed', inputs.seed.value || 'terra'],
      ['grid', result.width + ' x ' + result.height],
      // The multiplier only ever touches the saved file, so without this row
      // the `e` key would look like it did nothing until a PNG was opened.
      ['export', factor + 'x \u00b7 ' + result.width * factor + ' x ' +
        result.height * factor],
      ['land', percentText(s.land)],
      ['water', percentText(s.water)],
      ['lake', percentText(TerraCore.lakeShare(s))],
      // How many separate basins that lake cover is split into.
      ['basins', String(s.lakeBasins)],
      ['ice', percentText(s.ice)],
      // Both halves of the network, same split as the `contours` row: the
      // weight of a line on the map comes from this pair, so the numbers that
      // explain the drawing sit next to it.
      ['rivers', (s.rivers - s.trunks) + ' tri / ' + s.trunks + ' trunk'],
      // The spread plus its two ends: the difference alone cannot say whether a
      // world climbs from a deep shelf or from a damp plain, and the pair in
      // brackets is the same two numbers printed at the corners of the chart.
      ['relief', hundred(s.max - s.min) + ' units (' + hundred(s.min) +
        '-' + hundred(s.max) + ')'],
      // Half the grid sits below this height, which is what separates a broad
      // plateau from a plain with one peak when both share a relief range.
      ['median', hundred(s.median) + ' units'],
      ['biomes', String(biomeCount(s.counts))],
      ['contours', s.contourBands + ' land / ' + s.basinBands + ' basin'],
      ['checksum', s.checksum],
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
    var cssW = histCanvas.clientWidth || TerraCore.histWidth;
    var cssH = histCanvas.clientHeight || TerraCore.histHeight;
    var dpr = pixelScale();
    var bw = Math.round(cssW * dpr), bhPix = Math.round(cssH * dpr);
    if (histCanvas.width !== bw) histCanvas.width = bw;
    if (histCanvas.height !== bhPix) histCanvas.height = bhPix;
    // One bin per ~5 CSS pixels, clamped: a narrow sidebar with 48 bars reads
    // as mush, a wide one with 24 wastes the space it is given.
    var BINS = TerraCore.binCount(cssW);
    // The bins themselves come from the core, so a terminal counting the same
    // field over the same range gets the same bars — the record's `bins` and
    // `peak` are this very call at the chart's own width.
    var st = TerraCore.histogram(result, BINS);
    histState = {
      bins: st.bins, hist: st.hist, peak: st.peak, lo: st.lo, span: st.span,
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
    // Left/right inset for the text drawn into the chart.
    var pad = 3;
    var seaX = chartX(result.seaLevel, lo, span, w);
    if (seaX < 0) seaX = 0;
    if (seaX > w) seaX = w;
    hc.fillStyle = result.palette.sky;
    hc.fillRect(0, 0, w, h);
    // Which bins hold the class the legend is pointing at. Without this the
    // chart always shows the same silhouette, so a hovered row tells you
    // nothing about where that class sits in the height range. Only computed
    // when a class is actually selected and no bin is hovered.
    var member = null;
    var want = solo || pinned;
    // Same priority as the map: a legend selection beats a hovered bin, so the
    // two views cannot disagree while both filters are live.
    if (want) only = -1;
    if (only < 0 && want && result.biome) {
      member = new Array(BINS);
      var hf = result.heightField;
      for (i = 0; i < result.biome.length; i++) {
        if (result.biome[i] !== want) continue;
        member[binIndex(hf[i], lo, span, BINS)] = 1;
      }
    }
    // Bars take the palette's own water and grass triples, so the little chart
    // reads as part of the world it describes rather than the page chrome.
    var wet = result.palette.colors.shallow;
    var dry = result.palette.colors.grass;
    // The strip along the bottom holds the two corner labels, and everything
    // drawn in it is measured from its own top edge: the bars stop there, the
    // decade ticks hang just below it, the median mark reaches down through it.
    // One number for all three, so a taller strip widens the marks with it
    // rather than leaving a label sitting on a bar.
    var STRIP = 12;
    for (i = 0; i < BINS; i++) {
      // Leave a strip along the bottom for the two corner labels, so the
      // tallest bar never sits on top of the numbers.
      var bh = peak ? hist[i] / peak * (h - STRIP) : 0;
      var c = lo + (i + 0.5) / BINS * span < result.seaLevel ? wet : dry;
      var on = only < 0 ? (!member || member[i]) : i === only;
      var keep = on ? 1 : 0.45;
      // A dimmed bar is the palette's own triple washed toward the page's
      // white, which is the same blend the hover overlay does — so it goes
      // through the same two helpers rather than a fourth rounding of its own.
      hc.fillStyle = rgba(mix(c, WHITE, 1 - keep), 1);
      hc.fillRect(Math.round(i * binW), Math.round(h - bh), Math.ceil(binW), Math.round(bh));
    }
    hc.strokeStyle = rgba(INK, 0.7);
    hc.lineWidth = 1;
    hc.beginPath();
    hc.moveTo(hairline(seaX), 0);
    hc.lineTo(hairline(seaX), h);
    hc.stroke();
    // Ticks every ten units of height, in the strip under the bars. Two corner
    // numbers give the ends of the range but nothing in between, and the ticks
    // are what make a bar's height estimable by eye. Drawn on the same grid as
    // the sea rule so both read as one set of marks.
    // The spacing follows the relief of this world: a flat craton spanning
    // fifteen units would otherwise get a single tick, a tall fjord close to
    // twenty. Pick the first step that leaves at most ten marks.
    // The formula lives in the core, so the suite can check the same spacing a
    // chart is drawn with rather than repeating the candidate list here.
    var stepUnits = TerraCore.tickStep(span * 100);
    hc.strokeStyle = rgba(INK, 0.35);
    for (var u = Math.ceil(lo * 100 / stepUnits) * stepUnits;
      u <= (lo + span) * 100; u += stepUnits) {
      var tickX = chartX(u / 100, lo, span, w);
      if (tickX < pad - 1 || tickX > w - pad + 1) continue;
      hc.beginPath();
      hc.moveTo(hairline(tickX), h - STRIP + 1);
      hc.lineTo(hairline(tickX), h - STRIP + 4);
      hc.stroke();
    }
    // The marker line alone does not say what the sea level is, and the slider
    // is the knob that moves it most, so the number rides next to the rule.
    // Flipped to the left of the line when it would otherwise run off the edge.
    hc.font = '9px system-ui, sans-serif';
    var seaLabel = 'sea ' + hundred(result.seaLevel);
    var seaTw = hc.measureText(seaLabel).width;
    hc.fillStyle = rgba(INK, 0.75);
    hc.fillText(seaLabel,
      seaTw + 6 + seaX < w ? seaX + 4 : seaX - seaTw - 4, 9);
    // Corner labels give the chart a scale: without them the shape of the
    // spread is readable but the numbers are not. Drawn before the hovered-bin
    // label so a hover can cover them when space is tight.
    hc.fillStyle = rgba(INK, 0.55);
    var loLabel = String(hundred(lo));
    var hiLabel = String(hundred(lo + span));
    hc.fillText(loLabel, pad, h - 1);
    hc.fillText(hiLabel, w - pad - hc.measureText(hiLabel).width, h - 1);
    // The median gets a taller mark than the decade ticks: it is the one
    // number that says where most of the grid actually sits, so it is worth
    // seeing against the bars without reading the stats list.
    var medX = chartX(result.stats.median, lo, span, w);
    if (medX >= 0 && medX <= w) {
      hc.strokeStyle = rgba(INK, 0.7);
      hc.beginPath();
      hc.moveTo(hairline(medX), h - STRIP);
      hc.lineTo(hairline(medX), h - STRIP + 7);
      hc.stroke();
      // The mark alone says "most of the grid is around here"; the number says
      // how high that is, which is the difference between a shape and a
      // measurement. Kept inside the corner labels so the strip never overlaps.
      var medLabel = 'median ' + hundred(result.stats.median);
      var medTw = hc.measureText(medLabel).width;
      var loTw = hc.measureText(loLabel).width;
      var hiTw = hc.measureText(hiLabel).width;
      var medTextX = medX - medTw / 2;
      if (medTextX < pad + loTw + 4) medTextX = pad + loTw + 4;
      if (medTextX + medTw > w - pad - hiTw - 4) {
        medTextX = w - pad - hiTw - 4 - medTw;
      }
      if (medTw < w - pad * 2 - loTw - hiTw - 16) {
        hc.fillStyle = rgba(INK, 0.7);
        hc.fillText(medLabel, medTextX, h - 1);
      }
    }
    // A hovered bin gets its elevation range and cell count written into the
    // chart itself, which keeps the sidebar from reflowing on every move.
    if (only >= 0) {
      var sum = bandSummary(only);
      hc.font = '10px system-ui, sans-serif';
      // The full label is the range, the count and the class. On a narrow
      // sidebar that runs past the chart, so the least useful parts are
      // dropped first: class, then count. The range always survives — it is
      // what ties the bump back to the map.
      var parts = [hundred(sum.from) + '-' + hundred(sum.to),
        sum.cells + ' cells',
        sum.top ? biomeLabel(sum.top) : null];
      var label = fitLabel(hc, parts, w - pad * 2);
      var tw = hc.measureText(label).width;
      hc.fillStyle = rgba(WHITE, 0.88);
      hc.fillRect(pad - 1, 1, tw + 4, 13);
      hc.fillStyle = rgba(INK, 0.9);
      hc.fillText(label, pad + 1, 11);
    }
  }

  /* ---- interaction ---- */

  function setHoverFromEvent(ev) {
    var p = pointerPos(ev);
    hover.x = p.x;
    hover.y = p.y;
  }

  // Keyboard equivalent: put the cursor on a grid cell by index, which is how
  // the arrow keys walk the map. The readout is rebuilt from the same code the
  // mouse uses, so both paths agree on what a cell says.
  function hoverCell(px, py) {
    if (!current) return;
    px = clampIndex(px, current.width);
    py = clampIndex(py, current.height);
    var cs = cellSize();
    hover.x = (px + 0.5) * cs.w;
    hover.y = (py + 0.5) * cs.h;
    updateReadout(px, py);
    drawHover();
    // The walked cell is part of the shared state too, so the link follows the
    // keyboard. replaceState does not fire hashchange, so this cannot loop.
    writeHash();
  }

  function currentCell() {
    if (hover.x < 0 || !current) {
      return [Math.floor(current ? current.width / 2 : 0),
        Math.floor(current ? current.height / 2 : 0)];
    }
    var xy = cellOf(hover.x, hover.y);
    // Same clamp the readout applies, so the pair in the hash is the pair a
    // person sees on screen. A pointer resting above the canvas would
    // otherwise write a negative row that `applyHash()` then throws away.
    return [clampIndex(xy[0], current.width), clampIndex(xy[1], current.height)];
  }

  function updateReadout(ev) {
    if (!current) return;
    var px, py;
    if (typeof ev === 'number') { px = ev; py = arguments[1]; }
    else {
      // Backing-store pixels first, then the integer cell size — the same pair
      // of numbers the crosshair is drawn with.
      var p = pointerPos(ev);
      var xy = cellOf(p.x, p.y);
      px = xy[0];
      py = xy[1];
    }
    px = clampIndex(px, current.width);
    py = clampIndex(py, current.height);
    var i = py * current.width + px;
    var key = current.biome[i];
    var h = current.heightField[i];
    var above = h >= current.seaLevel;
    // Both halves of the reading are a share of their own band: a cell above
    // the line is measured against the room left over above the sea, a cell
    // below against the sea itself. Each share is guarded against an empty
    // band by this one floor, so the two branches of one measurement cannot
    // disagree about how flat a world has to be before its heights stop
    // scaling — a pair of guards could be edited apart while each still
    // looked reasonable beside the other.
    var upSpan = fillSpan(1 - current.seaLevel);
    var downSpan = fillSpan(current.seaLevel);
    var elev = above
      ? hundred((h - current.seaLevel) / upSpan)
      : -hundred((current.seaLevel - h) / downSpan);
    var parts = [
      '(' + px + ', ' + py + ')',
      biomeLabel(key),
      (elev > 0 ? '+' : '') + elev + ' units'
    ];
    // A selected legend class fades every cell that is not its own, so a
    // washed-out cell beside a bright one needs the same explanation a picked
    // bar gives: which side of the selection this cell falls on. Only the
    // mismatch costs a word — when the cell already is the selected class, the
    // name printed above is the answer. The word is the SELECTED class, since
    // that is the half a reader has to compare against the row they clicked.
    var want = solo || pinned;
    if (want && key !== want) {
      parts.push('not ' + biomeLabel(want));
    }
    // With an overlay on, the colour under the cursor is a ramp position, so
    // print that position: it is the same 0..100 number the blend used, which
    // is what makes two similar shades distinguishable.
    if (current.channelName) {
      parts.push(current.channelName + ' ' +
        hundred(TerraCore.channelValue(current, i)));
    }
    // Extra context when it costs nothing: how deep the standing water is, and
    // whether this cell is on the drainage network.
    if (above && current.lakeMask && current.lakeMask[i]) {
      // The mask stores 1..60 steps of the basin's own depth range, so the
      // readout converts it to a percentage: "depth 42" means nothing, "62%
      // deep" says how full this part of the basin is.
      parts.push(hundred(current.lakeMask[i] / TerraCore.lakeSteps) + '% deep');
      // Which of the world's lakes this is. Two basins of the same depth read
      // alike otherwise, and the number matches the `basins` row in the stats.
      if (current.basin && current.basin[i]) {
        parts.push('basin ' + basinTally(current.basin[i]));
        // Which side the surplus leaves on. A closed lake still has one low
        // spot in its rim, and that is where the outflow channel starts.
        var bearing = spillBearing(current.basin[i]);
        if (bearing) parts.push('drains ' + bearing);
      }
    } else if (!above && h < current.seaLevel - TerraCore.deepDrop) {
      parts.push('off-shelf');
    }
    // Moisture is the other axis of the biome lookup, so printing it explains
    // why two cells at the same height land in different classes. The lookup is
    // a two-axis table, so the second axis goes in too: a cell that reads
    // `tundra` next to one that reads `boreal` differ here, not in height, and
    // only the pair of numbers says which of the two moved. Both belong to the
    // land branch of that lookup — a water cell is named by its height alone —
    // so on open ocean the pair would be two figures that never decided
    // anything, ahead of the notes that do.
    if (above) {
      if (current.moisture) {
        parts.push('moist ' + hundred(current.moisture[i]));
      }
      if (current.temperature) {
        parts.push('temp ' + hundred(current.temperature[i]));
      }
    }
    // Distance to the nearest shoreline, so a green patch in the middle of a
    // continent reads differently from the same colour on a coast.
    // Only worth printing inland: a water cell is by definition at the shore,
    // and a beach cell one step in, so those would repeat the biome name.
    var inland = current.coastDistance ? Math.round(current.coastDistance[i]) : 0;
    if (above && inland > 1) parts.push(inland + ' from water');
    // The one rim cell a basin spills over. It is the seam between a lake and
    // the river network, so it is worth naming on its own: hovering it shows
    // where the water in a closed basin actually goes.
    // The mark carries the basin's own number, which is how an outlet in a
    // world of a dozen tarns says which one it belongs to. The outlet sits
    // outside the fill, so this is the only place its lake gets named.
    // The bearing rides along here too: this one cell IS the way out, so the
    // direction is worth more on the outlet than on the shore it sits beside.
    // Same lookup as the filled cells, indexed by the mark's own number.
    if (current.spillway && current.spillway[i]) {
      var outB = spillBearing(current.spillway[i]);
      parts.push('outlet of basin ' + basinTally(current.spillway[i]) +
        (outB ? ' drains ' + outB : ''));
    }
    if (current.riverMask && current.riverMask[i]) {
      // The catchment behind the channel explains why this cell is a trunk and
      // its neighbour is a tributary: it is the same accumulation number the
      // quantile cut is taken from.
      var catchment = current.accumulation
        ? Math.round(current.accumulation[i]) : 0;
      parts.push((current.riverMask[i] === 2 ? 'trunk river' : 'river') +
        (catchment > 1 ? ' (' + catchment + ' cells)' : ''));
    }
    // Tie the readout to the relief chart: the bin this cell falls in is
    // highlighted, so a colour on the map can be traced back to where it sits
    // in the world's elevation spread. The bin number is printed here too, from
    // the same lookup, so the sentence and the lit bar cannot disagree about
    // which slice of the height range this cell is in.
    // Kept in `cellBand` rather than passed straight to the chart, so the
    // repaint that follows (drawHover, and the grid pass inside it) restores
    // the same bar instead of painting the chart with no selection.
    cellBand = histBinFor(h);
    if (cellBand >= 0 && histState) {
      // The index says which bar is lit; the pair beside it says what that bar
      // covers, so the reading is a measurement rather than a position in a
      // list. Both ends come from the range the chart was binned over, which is
      // the same arithmetic the lit bar is chosen with.
      var sum = bandSummary(cellBand);
      parts.push('band ' + bandTally(cellBand, sum));
    }
    // A selected bar dims every cell outside its height range, which is why a
    // hovered cell can look washed out next to a bright one. Saying which side
    // of the selection the cell falls on is the shortest link between the two
    // views, and it is read from the same lookup that draws the bar — so the
    // note and the lit bar are always the same slice of the height range.
    // Only the mismatch costs a word: when the two agree, the cell's own band
    // label already is the answer, and repeating it would push the moisture and
    // temperature figures off the end of the line.
    if (band >= 0 && histState && cellBand !== band) {
      var sel = bandSummary(band);
      parts.push('not in ' + bandTally(band, sel));
    }
    readout.textContent = joinParts(parts);
    paintHistogram(cellBand);
  }

  // Bin index for a height, using the range the chart was binned over.
  // Both the binning pass and the hover read go through this one function, so
  // the cell under a cursor always lights the bar that counted it.
  function binIndex(h, lo, span, bins) {
    return TerraCore.binOf(h, lo, span, bins);
  }

  function histBinFor(h) {
    if (!histState) return -1;
    return binIndex(h, histState.lo, histState.span, histState.bins);
  }

  // Everything one bar of the chart knows: the height range it covers, how
  // many cells fell in it, and which biome fills most of it. The chart's own
  // caption and the hover readout both read this one lookup, so a bin cannot
  // describe itself one way inside the chart and another way in the strip
  // under the map.
  function bandSummary(bin) {
    if (!histState) return null;
    var st = histState;
    var from = st.lo + bin / st.bins * st.span;
    var to = st.lo + (bin + 1) / st.bins * st.span;
    var tally = {};
    var biome = st.result.biome;
    if (biome) {
      for (var i = 0; i < biome.length; i++) {
        if (binIndex(st.result.heightField[i], st.lo, st.span, st.bins) !== bin) {
          continue;
        }
        var bk = biome[i];
        tally[bk] = (tally[bk] || 0) + 1;
      }
    }
    var top = null, topN = 0;
    Object.keys(tally).forEach(function (k) {
      if (tally[k] > topN) { topN = tally[k]; top = k; }
    });
    return { from: from, to: to, cells: st.hist[bin] || 0, top: top, n: topN };
  }

  // The short form of that reading: the bar's one-based number over the bin
  // count, then the two ends of its range out of a hundred. Three views print
  // this pair — the hovered cell's own label, the note saying a cell falls
  // outside the selected bar, and the line under the map — and each prefixes it
  // with its own word. Built once so the number, the denominator and the two
  // ends cannot be rounded three different ways while each still looked right
  // beside its own caption.
  function bandTally(bin, sum) {
    return (bin + 1) + '/' + histState.bins +
      ' (' + hundred(sum.from) + '-' + hundred(sum.to) + ')';
  }

  // Every reading on that strip is a list of short fields, and the gap between
  // two fields is one string rather than a detail of whichever view wrote the
  // list. Three paths fill the strip — the hovered cell, the pinned or hovered
  // class and the selected band — so the join lives here: written at each
  // site, one of them could drop its space or swap in a comma while each
  // still read fine on its own, and a single line of the readout would then
  // look like a different kind of note than the ones around it.
  function joinParts(parts) {
    return parts.join(' — ');
  }

  function savePng() {
    if (!current) return;
    var big = TerraCore.upscale(current, exportFactor());
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
    // and the grid size tell you which of the many rerolls this was, the
    // palette separates two looks of the same seed, and the checksum is the
    // shortest way back from a file to the link that produced it.
    var nameParts = ['terra', inputs.seed.value || 'terra', inputs.shape.value,
      inputs.palette.value, current.width + 'x' + current.height,
      current.stats.checksum];
    // The multiplier belongs in the name too: the same world saved at 2x and
    // at 6x is the same checksum, so without the factor the two files would
    // overwrite each other with different pixel sizes.
    nameParts.splice(5, 0, exportFactor() + 'x');
    // Shape comes off the result rather than the select, so a name written from
    // a hash that skipped the control still matches the world on screen.
    nameParts[2] = current.shape || nameParts[2];
    a.download = nameParts.join('-').replace(/\s+/g, '_') + '.png';
    a.href = c.toDataURL('image/png');
    a.click();
  }

  // The hash already holds every option, so the current URL is the whole
  // state. Both the button and the `x` key go through this one path, so a
  // copied link always carries what is on screen — including a hovered cell.
  // The timer is kept outside the handler so a second click during the
  // feedback window replaces the pending restore instead of stacking on it.
  var copyTimer = 0;
  function copyLink() {
    var url = location.href;
    var btn = document.getElementById('copy');
    // The button's real name is remembered the first time it is pressed, so a
    // second click while "Copied" is showing restores the label rather than
    // freezing the feedback word in its place.
    if (!btn.getAttribute('data-label')) {
      btn.setAttribute('data-label', btn.textContent);
    }
    var done = function () {
      btn.textContent = 'Copied';
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyTimer = 0;
        btn.textContent = btn.getAttribute('data-label');
      }, 900);
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
  }

  /* ---- wiring ---- */

  fillPalettes();
  fillShapes();
  fillChannels();
  fillLights();
  fillGrids();
  fillScales();
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
    // The empty box is the fallback phrase here too, so the chain continues
    // from the world actually on screen rather than from an empty string.
    inputs.seed.value = String(TerraCore.nextSeed(inputs.seed.value || 'terra'));
    render();
  });
  document.getElementById('save').addEventListener('click', savePng);

  // The hash already holds every option, so the current URL is the whole state.
  document.getElementById('copy').addEventListener('click', copyLink);

  view.addEventListener('mousemove', function (ev) {
    hoverFromPointer(ev);
  });
  // Touch fires pointer events rather than mousemove, so the readout and the
  // crosshair would never move on a phone. One handler covers both, and the
  // mouse path is skipped when the pointer reports itself as a touch.
  view.addEventListener('pointermove', function (ev) {
    if (ev.pointerType === 'mouse') return;
    hoverFromPointer(ev);
  });

  // Both pointer paths on the map do the same four things in the same order:
  // take the cell out of the event, print it, paint the crosshair, then write
  // the link. Written once so a fifth step cannot arrive on one path only — a
  // phone that moved the crosshair without updating the hash is the shape that
  // bug takes, and it never shows up while a mouse is plugged in.
  function hoverFromPointer(ev) {
    setHoverFromEvent(ev);
    updateReadout(ev);
    drawHover();
    // The hovered cell belongs in the link, so a pasted URL reopens on the same
    // inlet. replaceState does not fire hashchange, so this cannot loop.
    writeHash();
  }

  // The relief chart is small, so the readout for a bin is drawn inside the
  // chart rather than in the hud strip under the map. One function backs both
  // the mouse and the touch path, so a tap selects the same bin the cursor
  // would have.
  function hoverHistogram(ev, toggleSame) {
    if (!histState) return;
    var rect = histCanvas.getBoundingClientRect();
    var f = pointerFraction(ev, rect);
    var bin = Math.floor(f.x * histState.bins);
    // A touch has no hover-out, so nothing would ever clear the band again:
    // tapping the bar that is already selected drops it instead. The mouse
    // path keeps the plain rule, since leaving the chart clears it there.
    if (toggleSame && band === bin) band = -1;
    else band = bin < 0 ? 0 : Math.min(histState.bins - 1, bin);
    // And the matching cells on the map, so the two charts can be read against
    // each other without moving the pointer back and forth. drawHover() goes
    // through drawMap(), which repaints this chart with the same `band`, so one
    // call keeps both views in step.
    drawHover();
    bandNote();
  }

  histCanvas.addEventListener('mousemove', hoverHistogram);
  // A finger reports itself through pointer events, so without this the chart
  // would only respond to a mouse. Same selection rule, same repaint.
  histCanvas.addEventListener('pointerdown', function (ev) {
    if (ev.pointerType === 'mouse') return;
    hoverHistogram(ev, true);
  });

  // The chart's caption is a 10px strip inside a 52px canvas, so the same
  // reading goes into the line under the map: a selected bin is a filter over
  // the whole grid, and its cell count is the figure worth reading at full
  // size. Both halves come from bandSummary(), so the two views cannot state
  // different ranges for one bar. With no selection the line goes back to its
  // placeholder, which is also what a pointer leaving the chart leaves behind.
  function bandNote() {
    // Same precedence the map and the chart use: a legend selection beats a
    // height band, so while a class is pinned the note describes that instead
    // of a band the map is not filtering by. One rule, three readers — the
    // blit, the bars and this line — so no view can show a filter another one
    // has already overridden.
    var want = solo || pinned;
    if (want) {
      // The share comes from the same counts the legend rows are built from, so
      // the figure beside a hovered row and the one in this line are one
      // measurement rather than two roundings of it.
      // The word "pinned" belongs to the clicked selection only: a hovered row
      // is a preview that ends when the pointer moves, so calling that pinned
      // would promise a state the next mouse-move takes away. Which of the two
      // is in charge is the same test the blit makes, so this says "pinned"
      // exactly when the map keeps the class after the pointer leaves.
      readout.textContent = joinParts([
        biomeLabel(want) + (solo ? '' : ' pinned'),
        percentText(TerraCore.classShare(current.stats, want))
      ]);
      return;
    }
    if (band < 0 || !histState) {
      readout.textContent = 'hover the map';
      return;
    }
    var sum = bandSummary(band);
    if (!sum) return;
    var parts = ['band ' + bandTally(band, sum), sum.cells + ' cells'];
    if (sum.top) parts.push(biomeLabel(sum.top));
    readout.textContent = joinParts(parts);
  }

  // Keyboard version of the same selection: Shift+arrows walk the bins, so the
  // height filter is reachable without a pointer. First press starts in the
  // middle of the range, which is where most worlds keep most of their cells.
  function stepBand(bin) {
    if (!histState) return;
    // Same wrap the cell walk uses: sweeping one direction across the height
    // range keeps going instead of sticking on the last bar.
    var n = histState.bins;
    band = cycleIndex(bin, 0, n);
    drawHover();
    bandNote();
  }
  histCanvas.addEventListener('mouseleave', function () {
    band = -1;
    drawHover();
    bandNote();
  });

  view.addEventListener('mouseleave', function () {
    hover.x = -1; hover.y = -1;
    // The chart's hovered bin is cleared together with the crosshair, so the
    // map never keeps a height filter after the pointer has gone while the
    // chart itself shows no selection.
    band = -1;
    // The cell reading goes with it: nothing is under the cursor any more, so
    // the chart should show the whole silhouette again.
    cellBand = -1;
    // One writer for the line under the map: with the selection gone this
    // restores the placeholder rather than a stale range.
    bandNote();
    drawHover();
    // The chart keeps the last hovered bin until something else picks one, so
    // dropping the pointer off the map clears it along with the readout.
    paintHistogram(-1);
  });

  // Dragging a window edge fires a resize for every pixel of the drag, and
  // each one would otherwise rebuild the whole grid. One scheduled render per
  // frame is enough: the last size in the burst is the one that matters, and
  // the world itself only depends on the seed, so no intermediate size is
  // ever seen. The flag is cleared inside the callback rather than before it,
  // which is what keeps a burst to a single rebuild.
  var pendingResize = false;
  window.addEventListener('resize', function () {
    if (pendingResize) return;
    pendingResize = true;
    requestAnimationFrame(function () {
      pendingResize = false;
      render();
    });
  });

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
        // With Shift the same arrows walk the relief chart instead of the
        // grid: the height-band filter then has a keyboard path, which a touch
        // device without a hover state needs. Left/Right move along the bins,
        // Up/Down are the same pair so either axis works.
        if (ev.shiftKey && histState) {
          ev.preventDefault();
          var dx = step[0] || step[1];
          stepBand(band < 0 ? Math.round(histState.bins / 2) : band + dx);
          return;
        }
        var cell = currentCell();
        ev.preventDefault();
        // Wrap at the edges rather than sticking: walking a coastline in one
        // direction should keep going, and a clamped walk stalls on the last
        // column until the other direction is pressed. hoverCell still clamps,
        // so a hash-restored index outside a smaller grid stays sane.
        var nx = cell[0] + step[0];
        var ny = cell[1] + step[1];
        if (current) {
          nx = cycleIndex(nx, 0, current.width);
          ny = cycleIndex(ny, 0, current.height);
        }
        hoverCell(nx, ny);
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
    // Letters are shortcuts only when no text field owns the caret, so a seed
    // phrase like "salt mirror" can still be typed.
    var ae2 = document.activeElement;
    var typingLetter = ae2 && (ae2.tagName === 'INPUT' || ae2.tagName === 'SELECT');
    if (!typingLetter && (ev.key === 'c' || ev.key === 'C')) {
      ev.preventDefault();
      var order = TerraCore.channels.map(function (ch) { return ch.key; });
      // Shift walks the list backwards, the same way it does for the legend
      // pins: backing out of an overlay should not need a full lap.
      var at = order.indexOf(inputs.channel.value);
      var dir = ev.shiftKey ? -1 : 1;
      inputs.channel.value = order[cycleIndex(at, dir, order.length)];
      render();
      return;
    }
    // 'h' steps through the shape curves — the biggest single lever on a
    // world's silhouette, so it earns a key next to the overlay cycle. The
    // list is the same one the dropdown and `cli --shapes` read.
    if (!typingLetter && (ev.key === 'h' || ev.key === 'H')) {
      ev.preventDefault();
      var shapeKeys = TerraCore.shapes.map(function (s) { return s.key; });
      var si = shapeKeys.indexOf(inputs.shape.value);
      var sdir = ev.shiftKey ? -1 : 1;
      inputs.shape.value = shapeKeys[cycleIndex(si, sdir, shapeKeys.length)];
      render();
      return;
    }
    // 'd' walks the light bearing: the same four compass points the dropdown
    // lists, which is the fastest way to see which side a ridge wants.
    if (!typingLetter && /^(d|D)$/.test(ev.key)) {
      ev.preventDefault();
      var bearings = TerraCore.lights.map(function (lt) { return lt.key; });
      var di = bearings.indexOf(inputs.lightDir.value);
      var bdir = ev.shiftKey ? -1 : 1;
      inputs.lightDir.value = bearings[cycleIndex(di, bdir, bearings.length)];
      render();
      return;
    }
    // 'w' walks the column count. It is the one knob that changes how much of
    // the world fits on screen without changing the seed, so it is worth a key
    // next to the shape cycle. The empty entry — auto — is part of the list,
    // so a lap of the key ends where the window began.
    if (!typingLetter && /^(w|W)$/.test(ev.key)) {
      ev.preventDefault();
      var widths = TerraCore.grids.map(function (gr) { return gr.key; });
      var wi = widths.indexOf(inputs.gridSize.value);
      var wdir = ev.shiftKey ? -1 : 1;
      inputs.gridSize.value = widths[cycleIndex(wi, wdir, widths.length)];
      render();
      return;
    }
    // 'e' walks the export multiplier: the fourth of these lists is the only
    // one that changes the saved file and not the world, so it is the safest
    // key to press while comparing two sizes of the same seed.
    if (!typingLetter && /^(e|E)$/.test(ev.key)) {
      ev.preventDefault();
      var sizes = TerraCore.scales.map(function (sc) { return sc.key; });
      var ei = sizes.indexOf(inputs.scale.value);
      var edir = ev.shiftKey ? -1 : 1;
      inputs.scale.value = sizes[cycleIndex(ei, edir, sizes.length)];
      render();
      return;
    }
    // '[' and ']' nudge the sea level, which is the slider that changes a
    // world most: it moves the shoreline, the relief band count and the basin
    // band count at once. The step matches the slider's own, and the bounds
    // come from the input so the two paths cannot disagree.
    if (!typingLetter && (ev.key === '[' || ev.key === ']')) {
      ev.preventDefault();
      // Read by the rule `num()` follows rather than by a second one: a pair
      // written into the hash is read there, and a `parseFloat` here would
      // keep the leading digits of something that reader had already thrown
      // away — so the nudge would move a sea level the world never used.
      // Each bound is only applied when it reads, which is what lets the
      // slider's own attributes stay the single source of the range.
      var stepSea = Number(inputs.seaLevel.step);
      if (!isFinite(stepSea) || stepSea <= 0) stepSea = 0.01;
      var loSea = Number(inputs.seaLevel.min);
      var hiSea = Number(inputs.seaLevel.max);
      var nowSea = Number(inputs.seaLevel.value);
      if (!isFinite(nowSea)) return;
      var nextSea = nowSea + (ev.key === ']' ? stepSea : -stepSea);
      nextSea = Math.round(nextSea * 100) / 100;
      if (isFinite(loSea)) nextSea = Math.max(loSea, nextSea);
      if (isFinite(hiSea)) nextSea = Math.min(hiSea, nextSea);
      inputs.seaLevel.value = String(nextSea);
      render();
      return;
    }
    // The two checkboxes and the export are the only things left that a
    // keyboard user has to reach for: one key each, no modifiers.
    // 'm' drops the magnifier panel. It is the only overlay that hides part of
    // the map rather than tinting it, so it is the one worth being able to
    // switch off — and unlike the legend pin it changes no pixel of the world.
    if (!typingLetter && /^(m|M)$/.test(ev.key)) {
      ev.preventDefault();
      insetOn = !insetOn;
      drawHover();
      return;
    }
    // 'k' walks the legend: each press pins the next class, and the cycle wraps
    // back through "nothing pinned". Same list the rows are built from, so the
    // order under the key is the order on screen.
    if (!typingLetter && /^(k|K)$/.test(ev.key)) {
      ev.preventDefault();
      if (current) {
        var rows = legendKeys(current);
        // Shift steps backwards through the same list, so a mis-press does not
        // need a full lap of the legend to undo.
        var step = ev.shiftKey ? -1 : 1;
        // The empty state is a slot of its own: with only the rows to choose
        // from, a lap came back to the first class and the cleared state was
        // reachable just once, before anything had been pinned. One more slot
        // than there are rows makes "nothing pinned" a stop on the ring, which
        // is what lets a keyboard user release a pin without hunting for the
        // row that set it.
        var slots = rows.length + 1;
        var ki = rows.indexOf(pinned || '');
        if (ki < 0) ki = slots - 1;
        pinned = rows[cycleIndex(ki, step, slots)] || null;
        applyPin();
      }
      return;
    }
    // 'p' steps through the hand-picked seed phrases, which is a quicker way
    // to browse good worlds than rerolling at random. The phrase that is
    // already in the box is replaced rather than appended, so the list never
    // drifts away from itself.
    if (!typingLetter && (ev.key === 'p' || ev.key === 'P')) {
      ev.preventDefault();
      var phrases = TerraCore.phrases;
      var pi = phrases.indexOf(inputs.seed.value);
      var pdir = ev.shiftKey ? -1 : 1;
      inputs.seed.value = phrases[cycleIndex(pi, pdir, phrases.length)];
      render();
      return;
    }
    var toggle = { g: 'dither', l: 'contour' }[ev.key.toLowerCase()];
    // 'x' copies the link, which is the last step of a finished world and the
    // only action left that needed a mouse. Same function as the button, so
    // the two paths cannot disagree about what gets copied.
    if (!typingLetter && (ev.key === 'x' || ev.key === 'X')) {
      ev.preventDefault();
      copyLink();
      return;
    }
    if (!typingLetter && toggle) {
      ev.preventDefault();
      inputs[toggle].checked = !inputs[toggle].checked;
      render();
      return;
    }
    if (!typingLetter && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault();
      savePng();
      return;
    }
    // Both cases, like every other letter key: with Caps Lock on, `ev.key` is
    // the uppercase form, and a shortcut that only answered to one of the two
    // would look broken for reasons that have nothing to do with the map.
    if ((ev.key === ' ' || /^(r|R)$/.test(ev.key)) &&
      document.activeElement !== inputs.seed) {
      ev.preventDefault();
      document.getElementById('reroll').click();
    }
  });

  render();
})();
