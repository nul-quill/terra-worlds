      /* Terra app shell — draws the core result onto a crisp canvas. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ctx = ctxOf(view);
  var readout = document.getElementById('readout');
  var legendList = document.getElementById('legend');
  var statsBox = document.getElementById('stats');
  var histCanvas = document.getElementById('hist');
  var summaryLine = document.getElementById('summary');
  // The copy button is read once here, beside the two canvases and the three
  // text boxes, so the wiring at the bottom and the body it calls both hold
  // the same node. Two lookups of one button could be edited apart — a renamed
  // id would leave the click wired to nothing while the label still restored
  // itself on the node the other read found.
  var copyBtn = document.getElementById('copy');
  // The reroll button is read the same way, since two bodies need it too: the
  // listener at the bottom of the shell, and the `Space`/`R` branch of the
  // keyboard handler, which presses the button rather than duplicating its
  // chain step. Both must find the same node, so both read this one lookup.
  var rerollBtn = document.getElementById('reroll');
  // The save button is held here too, so every button on the panel is looked
  // up once beside the canvases and the text boxes rather than once at the
  // listener that wires it. With two shapes of lookup, an id rename could be
  // fixed on one side only — which reads as a button that never answers a
  // click while its label still looks right in a screenshot.
  var saveBtn = document.getElementById('save');

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
    // Every pair in the link is a short name, an equals sign, and a value that
    // has to survive a query string. Two kinds of control reach that shape here
    // — the ticked boxes and everything else — so the join is one lookup:
    // written beside each push the separator could be edited on one of them,
    // which reads as a link whose checkboxes use one delimiter and its
    // dropdowns another, and a reopened page then only half restores.
    function hashPair(name, value) {
      return name + '=' + encodeURIComponent(value);
    }
    Object.keys(HASH_KEYS).forEach(function (key) {
      var el = inputs[key];
      if (!el) return;
      // Checkboxes are stored as 1/0 so the hash stays short.
      if (el.type === 'checkbox') {
        parts.push(hashPair(HASH_KEYS[key], el.checked ? 1 : 0));
        return;
      }
      parts.push(hashPair(HASH_KEYS[key], el.value));
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
      atCell = pairOf(at);
    }
  }

  // Both halves of a pair in the hash are the same kind of number over the
  // same count, so one split covers the two: the shape is checked by the
  // caller, and each half only has to drop the comma it sits beside. Written
  // out twice at the call site, one half could keep the leading digits of a
  // value the other rejected, which names a cell in one axis and a different
  // one in the other — close enough to look like a slightly odd cursor.
  function pairOf(text) {
    var xy = String(text).split(',');
    return [num(xy[0], true), num(xy[1], true)];
  }

  // Two places need a loose canvas: the offscreen copy the map is blitted from,
  // and the buffer a saved PNG is filled from. Both want the same kind of node,
  // so the request is written once. Beside each site the element name could be
  // restated on one of them only, which reads as a save path drawing into a
  // different kind of surface than the one on screen — a slightly off picture
  // rather than an obvious error, so both halves read this one lookup.
  function newCanvas() {
    return document.createElement('canvas');
  }

  var off = newCanvas();
  var offCtx = ctxOf(off);
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

  // The order the palette dropdown and the digit keys walk. Both are a list of
  // keys in the order the scheme table declares them, so the two read it
  // through this one lookup: written beside each caller, one could sort the
  // keys while the other kept declaration order, which reads as `3` picking a
  // different scheme from the third row of the dropdown — close enough to a
  // working pair that nobody looks twice at it.
  function paletteKeys() {
    return Object.keys(TerraCore.palettes);
  }

  function fillPalettes() {
    var names = TerraCore.palettes;
    var items = paletteKeys().map(function (key) {
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

  // What an empty seed box means. A blank field is not a fourth seed: it names
  // the generator's own default, so the fallback word has to be that one string
  // everywhere a blank box reaches — the world that gets built, the `seed` row,
  // the second slot of a saved file name and the phrase a reroll derives from.
  // Written beside each of those it could be edited on one side only, which
  // reads as a link and a PNG describing two worlds from one empty field.
  function seedPhrase() {
    return inputs.seed.value || 'terra';
  }

  // Every numeric control on the page is read the same way: the control's id,
  // plus a flag saying whether the field holds a count or a level. Written
  // beside each field that pair could be edited apart — one row keeping the
  // whole-number flag, its neighbour dropping it — which lets a slider feed
  // the generator a fraction the option reader then reads two ways, while
  // every field on its own still looks reasonable. One lookup holds the pair.
  function optionNumber(key, isInt) {
    return num(inputs[key].value, isInt);
  }

  function readOptions() {
    return {
      seed: seedPhrase(),
      palette: inputs.palette.value,
      shape: inputs.shape.value,
      gridSize: optionNumber('gridSize', true) || 0,
      seaLevel: optionNumber('seaLevel', false),
      detail: optionNumber('detail', false),
      polar: optionNumber('polar', false),
      terraces: optionNumber('terraces', true),
      hillshade: optionNumber('hillshade', false),
      rivers: optionNumber('rivers', true),
      lightDir: inputs.lightDir.value,
      dither: inputs.dither.checked,
      channel: inputs.channel.value,
      contour: inputs.contour.checked
    };
  }

  /* ---- drawing ---- */

  // Every canvas in the shell is drawn with the same kind of context: the map,
  // its offscreen copy, the relief strip and the buffer a saved PNG is filled
  // from. Four lookups of the same string could be edited apart — one asking
  // for a bitmap context while the other three stayed with the 2d one — which
  // reads as a single view that stops answering at a size another still draws
  // at, so the request is one lookup the four share.
  function ctxOf(el) {
    return el.getContext('2d');
  }

  // Both canvases size their backing store from this one number. The clamp is
  // the contract: at 1 the grid is drawn one device pixel per cell, above 2 a
  // phone's third or fourth band would buy no readable detail while quadrupling
  // the work, so the scale is held between those two. Two copies of the clamp
  // could be edited apart, and a map blitted at one scale under a chart drawn at
  // another reads as a blurry strip beneath a sharp picture.
  function pixelScale() {
    return Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  }

  // Every blit in the shell is nearest-neighbour: the map is drawn from its
  // offscreen copy, the magnifier enlarges a dozen cells of that copy, and the
  // saved PNG is filled from the upscaled buffer. All three want the same thing
  // — a cell edge that stays a cell edge — so the flag is one lookup the three
  // reads share. Written beside each blit, one of them could keep the
  // browser's default smoothing while the other two stayed crisp, which reads
  // as a slightly soft panel beside a sharp map rather than as a bug.
  function nearest(c) {
    c.imageSmoothingEnabled = false;
  }

  // Both canvases open by laying the palette's sky behind everything else: the
  // map fills its own box before blitting the grid, the relief strip fills its
  // box before drawing bars. Each is the same pair of writes — a hue, then a
  // rectangle over the whole box — so the pair is one lookup the two reads
  // share. Written beside each canvas the hue could stay while the rectangle
  // shrank to a partial fill, which leaves a strip whose own margins are a
  // different colour than the map behind it — still a plausible chart at a
  // glance, so both halves go through this one writer.
  function paintSky(c, sky, w, h) {
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
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

  // Every one of those marks is the same four calls: open a path, drop a
  // hairline from one edge of the strip to another, close it. Written beside
  // each mark the pair of endpoints could be edited apart from the offset that
  // keeps them crisp, which leaves one mark drawn between two pixels while its
  // neighbours stayed on one — a slightly soft line among sharp ones, close
  // enough to an odd chart that nobody opens the console over it. One lookup
  // holds the sequence, so each site names only its own two ends.
  function strokeMark(g, x, y1, y2) {
    g.beginPath();
    g.moveTo(hairline(x), y1);
    g.lineTo(hairline(x), y2);
    g.stroke();
  }

  // The width those marks are stroked at is the other half of the same idea: a
  // hairline is one device pixel, and the three of them — the crosshair's pair
  // of hairlines, the border of the magnifier's mat and the sea rule under the
  // bars — all want the same one. Written beside each stroke the number could
  // be edited on one mark only, which leaves a single thick line among thin
  // ones: close enough to read as an odd cursor rather than as a bug, so it is
  // one lookup the three reads share.
  var HAIR = 1;

  // How many device pixels a CSS measurement is worth. Both canvases size their
  // backing store this way — the map from the layout box, the chart from the
  // sidebar's column — and both round, since a fractional store makes every
  // cell edge land between two pixels. Written beside each canvas, one of them
  // could truncate instead and still look sharp on its own, while the two
  // pictures in one sidebar disagreed about how wide a pixel is.
  function bufferSize(cssPx, dpr) {
    return Math.round(cssPx * dpr);
  }

  // Both halves of a backing store are written together. A canvas is only
  // ever sized as a pair — a width without its height leaves the old rows
  // under a new column count — and assigning either half wipes what the
  // canvas holds, so each write is guarded by a comparison with the value it
  // already has. That pair of tests belongs here rather than beside each of
  // the four canvases: written at each site, one of them could drop its guard
  // and clear a picture the other three keep, which reads as a strip that
  // blinks while the map beside it stays put.
  function sizeCanvas(el, w, h) {
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
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

  // Whether the map has no pointer on it right now. Two reads in `render()`
  // Three reads depend on that one notion: the two in `render()` — the note
  // under the map may refill the whole strip only while nothing is hovered,
  // and a hash-restored cell only wins while nothing is hovered — plus the
  // reader that builds the `at=` pair, which falls back to the middle cell.
  // Written beside each caller the pair could be edited apart, and a rebuild
  // that restored a cell while its own line still showed the placeholder would
  // read as a stale caption rather than as a bug.
  function pointerAway() {
    return hover.x < 0;
  }

  // How wide a canvas actually is on the page. Three places ask that question
  // — the grid is counted off the map's own box, a pointer is mapped onto the
  // buffer through it, and a bin is picked out of the chart's — and each needs
  // a box that may measure nothing while a layout is still settling. Written
  // beside each site the read could gain a guard on one of them only, which
  // lets a pointer divide by a zero-width box while the grid beside it still
  // rounded safely: the crosshair then names one column and the bars another.
  function layoutBox(el) {
    return el.getBoundingClientRect();
  }

  // The smallest span a layout box is allowed to divide by. A canvas that has
  // not been laid out yet measures nothing, and every division by one of its
  // edges — a pointer mapped onto the buffer, a pinned column count turned into
  // rows — would otherwise come back as Infinity. Held to one rather than left
  // bare, so a measure taken before the first layout still yields a count
  // instead of an empty grid. Written beside each division the guard could be
  // dropped on one of them, which reads as a crosshair naming one column while
  // the bars beside it were counted against another.
  function boxSpan(measured) {
    return Math.max(1, measured);
  }

  // One axis of a canvas in CSS pixels, with the core's published figure behind
  // it for the frames before the element has a measurement. Both halves of the
  // chart's box ask that same question, so the fallback is written once: kept
  // beside each read, one of them could fall back to another number while the
  // other still matched the CLI's caption, which prints a silhouette whose own
  // `bins` count disagrees with the bars above it.
  function cssSize(measured, fallback) {
    return measured || fallback;
  }

  function render() {
    var opts = readOptions();
    writeHash();
    var rect = layoutBox(view);
    var dpr = pixelScale();

    // Native grid: keep cells chunky so the pixel look survives upscaling.
    var cols = autoCount(rect.width, 120);
    var rows = autoCount(rect.height, 80);
    // A chosen grid size pins the column count, so the same seed gives the same
    // cell count in a narrow window and on a wide one. Rows keep the aspect of
    // the canvas, which is what makes the cells square rather than stretched.
    // A very wide window still needs a world rather than a ribbon, so the
    // derived row count has one floor. The two auto counts pass their own
    // floors as arguments; this is the only bound the pinned form needs.
    var MINROWS = 40;
    if (opts.gridSize) {
      cols = opts.gridSize;
      rows = Math.max(MINROWS, Math.round(cols * rect.height / boxSpan(rect.width)));
    }

    // Cells must be a whole number of device pixels wide, or the columns come
    var bw = bufferSize(rect.width, dpr);
    var bh = bufferSize(rect.height, dpr);
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

    sizeCanvas(view, bw, bh);
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
    if (pointerAway()) bandNote();
    // A link that named one cell gets it back after the rebuild, as long as the
    // pointer has not taken over in the meantime. The indices are clamped by
    // hoverCell, so a link written on a wide window still lands sensibly in a
    // narrow one.
    if (pointerAway() && atCell) hoverCell(atCell[0], atCell[1]);
  }

  // One channel of a faded cell: keep this much of its own colour and give the
  // rest to the palette's sky, which is nothing at all when no filter is on.
  // Three channels of one pixel are that same sum, so the shape is written once
  // and each read names its own index. Beside each channel the pair could be
  // edited apart until a shore tinted one channel harder than its neighbours,
  // which reads as a slightly warm coastline rather than as a broken triple.
  function fadeChannel(value, keep, sky, n) {
    return value * keep + (sky ? sky[n] * (1 - keep) : 0);
  }

  // Blit the generated grid onto the visible canvas, nearest-neighbour.
  function drawMap() {
    if (!current) return;
    sizeCanvas(off, current.width, current.height);
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
      out[i] = fadeChannel(src[i], keep, sky, 0);
      out[i + 1] = fadeChannel(src[i + 1], keep, sky, 1);
      out[i + 2] = fadeChannel(src[i + 2], keep, sky, 2);
      out[i + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    nearest(ctx);
    paintSky(ctx, current.palette.sky, view.width, view.height);
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
  // restored index has to come back inside the same way a pointer does.
  function clampIndex(n, count) {
    return Math.max(0, Math.min(count - 1, n));
  }

  // The middle cell of one axis, which is what the hash falls back to when no
  // pointer is on the map. Both axes of that pair are the same rule over their
  // own count, so the division is one lookup rather than two that could be
  // edited to round differently — a link would then name a cell in the left
  // half of a wide map while its crosshair sat in the top third.
  function middleIndex(count) {
    return Math.floor((count || 0) / 2);
  }

  // Which cell a backing-store pixel falls in. Three paths ask that question —
  // the crosshair, the reader behind the `at=` pair and the readout — and each
  // divides by the very cell size the blit was drawn with, so the division is
  // one lookup rather than three that could be edited to round differently.
  function cellOf(x, y) {
    var cs = cellSize();
    return [Math.floor(x / cs.w), Math.floor(y / cs.h)];
  }

  // Where a cell's centre falls in backing-store pixels. Four marks are placed
  // that way — the pair of hairlines the crosshair is drawn with, and the pair
  // of fields the hover position keeps — so the half-cell offset is one lookup
  // rather than four that could be edited apart. Written at each site, one of
  // them could drop the half and still land inside the grid: the box would
  // then sit on a cell's left edge while its own crosshair stayed in the
  // middle, which reads as an odd cursor rather than as a bug.
  function cellCentre(i, size) {
    return (i + 0.5) * size;
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

  // Which way `Shift` moves a cycle. Every list key answers to `Shift` with a
  // step backwards, so the pair of signs is one lookup rather than seven
  // written beside their own handler: one of them could invert while the rest
  // still backed out, which reads as a single key walking the wrong way round
  // its list for reasons nothing in the dropdown explains.
  function shiftStep(ev) {
    return ev.shiftKey ? -1 : 1;
  }

  // Every list cycle is the same five steps: take the keys out of the core's
  // own list, find where the control sits in it, step by the `Shift`-aware
  // sign, wrap through the shared ring, then rebuild. Written beside each key,
  // one of them could drop its `Shift` step or its rebuild while the others
  // stayed right, which reads as a single letter cycling the wrong way — or
  // not at all — for reasons nothing in the dropdown explains. The list is
  // passed in rather than looked up here, so each cycle still names the array
  // its own dropdown is filled from. A list of plain words (the seed phrases)
  // needs no key field, which is what the second half of that map is for.
  function cycleControl(select, items, ev) {
    var keys = items.map(function (it) {
      return it.key != null ? it.key : it;
    });
    var at = keys.indexOf(select.value);
    select.value = keys[cycleIndex(at, shiftStep(ev), keys.length)];
    render();
  }
  // Where a pointer sits inside a canvas, as a fraction of its layout box. Both
  // canvases need that pair — the map turns it into backing-store pixels for
  // the crosshair, the chart turns it into a bin index — and both have to
  // survive a box that measures nothing, which is what the guard is for. Two
  // copies of the division could be edited apart, and one canvas would then
  // divide by zero while the other still placed its mark.
  function pointerFraction(ev, rect) {
    return {
      x: (ev.clientX - rect.left) / boxSpan(rect.width),
      y: (ev.clientY - rect.top) / boxSpan(rect.height)
    };
  }
  // Where a pointer sits, in backing-store pixels. The crosshair is drawn in
  // that space, so both pointer paths convert through here: the ratio of the
  // canvas's own width to its layout width is what maps a click onto the
  // buffer, guarded so an empty layout still divides. Two copies of that pair
  // could be edited apart, and the hover mark would then sit on one cell while
  // the readout named the neighbour to its left.
  function pointerPos(ev) {
    var rect = layoutBox(view);
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
    var deep = inkColour();
    var hair = rgba(mix(deep, ink, 0.45), 0.45);
    var edge = cellInk();
    var cs = cellSize();
    var cellX = cs.w;
    var cellY = cs.h;
    ctx.strokeStyle = edge;
    // The box around a hovered cell is the one mark whose width scales with the
    // grid rather than staying a hairline: a quarter of a cell reads as a frame
    // at any cell size, and never less than one pixel so it stays visible on a
    // dense grid. That fraction is one number beside its only read.
    var BOX = 0.25;
    ctx.lineWidth = Math.max(1, Math.round(cellX * BOX));
    if (hover.x >= 0) {
      var cell = cellOf(hover.x, hover.y);
      var px = cell[0];
      var py = cell[1];
      // Hairline crosshair through the cell makes the readout easy to trust
      // on a dense grid, where the box alone is hard to place.
      ctx.save();
      ctx.strokeStyle = hair;
      ctx.lineWidth = HAIR;
      ctx.beginPath();
      var cx = hairline(cellCentre(px, cellX));
      var cy = hairline(cellCentre(py, cellY));
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
  // Where a patch of `span` cells starts, given the cell it is centred on.
  // The inset holds a whole block inside the grid rather than a single index,
  // which is why this bound is wider than the one a hovered cell ends with.
  // Both axes read it, so a patch cannot be kept on one axis and left to run
  // off the canvas on the other.
  function insetOrigin(pos, extent, span) {
    return Math.max(0, Math.min(extent - span, pos - (span >> 1)));
  }

  // Which half of the canvas the panel sits in: the one the cursor is NOT in,
  // so the cell being inspected is never hidden behind its own magnifier. The
  // choice is a comparison, not a random offset, so the same hover still
  // produces the same pixels. Both axes read it, since a panel that followed
  // the cursor sideways while its own row stayed on a fixed side reads as a
  // second cursor rather than as a magnifier.
  function farHalf(pos, extent, room, pad) {
    return pos * 2 > extent ? pad : room - pad;
  }

  // A box measured as a share of a bigger one. Two measurements of the
  // magnifier are that shape: the panel over the shorter canvas edge, and its
  // padding over the panel. Written beside each call the pair could be edited
  // apart — one truncating while the other rounds — which reads as a mat whose
  // padding no longer scales with the panel it frames, still a plausible panel
  // at a glance.
  function boxScale(px, share) {
    return Math.round(px * share);
  }

  function drawInset(px, py) {
    // How many cells the panel shows. The same number is the width of the
    // source block read from the offscreen copy and the divisor behind the
    // panel's own cell size, so it is written once: a dozen written at each of
    // those five places could be edited apart, which reads as a patch whose
    // mark no longer matches the cells it magnifies.
    var PATCH = 12;
    var x0 = insetOrigin(px, current.width, PATCH);
    var y0 = insetOrigin(py, current.height, PATCH);
    // Two fractions decide the panel: how much of the shorter canvas edge the
    // patch may take, and how much of that patch is given back as padding. Both
    // are read once each, and the second is measured against the first, so a
    // wider panel keeps its own margin rather than crowding the map with a
    // fixed gap. Written as bare numbers beside each other the pair could be
    // edited apart, which reads as a panel whose border grows while its picture
    // stays the same size.
    var PANEL = 0.28;
    var PAD = 0.10;
    var size = boxScale(Math.min(view.width, view.height), PANEL);
    var pad = boxScale(size, PAD);
    var dx = farHalf(px, current.width, view.width - size, pad);
    var dy = farHalf(py, current.height, view.height - size, pad);
    ctx.save();
    // The mat around the patch is one box drawn twice: a filled backing and a
    // hairline on its edge. Both are this much wider than the patch, and the
    // stroke sits half a pixel further out so it lands on the fill's own edge.
    // Written per site, the border could grow past its background on one of
    // them only, which reads as a line floating off the panel it frames.
    var MAT = 2;
    // The hairline sits half a pixel outside that fill on every side, so its
    // own reach is the mat plus that half. Written as three separate offsets
    // the stroke could be pulled in on one axis only, which leaves a frame
    // whose left edge sits on its background while its right edge floats.
    var EDGE = MAT + 0.5;
    // Both boxes around the patch grow by twice their own reserve: the fill on
    // each of its four sides, and the hairline one half-pixel beyond that. That
    // doubling is one shape, so both read it through this lookup. Written beside
    // each call the pair could be edited apart, which leaves a frame whose border
    // is thicker on one axis than the fill underneath it — still a plausible
    // panel at a glance, so the doubling is written once.
    function matSpan(size, reserve) {
      return size + reserve * 2;
    }
    // The panel backing is the palette's own sky, at the same alpha the crosshair
    // uses, so a dark scheme keeps a dark mat under the magnified patch instead
    // of a bright slab. Both colours come from the lookup above, which is also
    // what the isolation blend reads — one source for every overlay colour.
    var sky = skyRgb();
    ctx.fillStyle = rgba(sky, 0.85);
    ctx.fillRect(dx - MAT, dy - MAT, matSpan(size, MAT), matSpan(size, MAT));
    nearest(ctx);
    ctx.drawImage(off, x0, y0, PATCH, PATCH, dx, dy, size, size);
    ctx.strokeStyle = rgba(mix(inkColour(), sky, 0.35), 0.55);
    ctx.lineWidth = HAIR;
    ctx.strokeRect(dx - EDGE, dy - EDGE,
      matSpan(size, EDGE), matSpan(size, EDGE));
    // The patch is a dozen cells wide, so the one under the cursor still has
    // to be identifiable inside it. Same ink as the crosshair, one cell of the
    // patch's own scale — the offset is the difference of two clamped indices,
    // so it stays inside the panel at every edge of the grid.
    var patch = size / PATCH;
    ctx.strokeStyle = cellInk();
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

  // The palette's own darkest ink, which every hairline on the map is stroked
  // with: the crosshair's pair of lines, the border of the magnifier's mat and
  // the one-cell mark inside that patch. Three marks read it, so the hue is
  // named once and only the alpha varies per mark — the same shape as the sky
  // lookup above. Written at each site, one mark could be pointed at another
  // entry of the colour table and still look like the scheme's ink beside the
  // other two, which reads as a slightly odd cursor rather than as a bug.
  function inkColour() {
    return current.palette.colors.deep;
  }

  // The enclosing box around the hovered cell is drawn twice: the rectangle on
  // the map, and the one-cell mark inside the magnifier's patch. Both name the
  // same cell, so both are the same ink at the same strength — the palette's
  // darkest ink pulled a little toward its own sky. Written at each site, that
  // blend could be edited on one of them only, which reads as a box sitting a
  // shade off the mark inside its own panel: close enough to pass beside a
  // crosshair, so the suite counts the lookup, its two reads and asks that the
  // one blend be the only such pair left in the shell.
  function cellInk() {
    return rgba(mix(inkColour(), skyRgb(), 0.15), 0.9);
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

  // Three of those seven marks are stroked or filled at the same strength: the
  // sea rule, the median's own mark, and the number hanging under it. That
  // figure is one number rather than three — written beside each mark it could
  // be edited apart until the sea's rule sat darker than the median it is
  // meant to be compared with, which still reads as a plausible chart while
  // its two notes no longer carry equal weight.
  var MID = 0.7;

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

  // The family every mark in the relief strip is drawn in. Two sizes are used
  // there — the small ruler labels and the bigger hovered-bin caption — and
  // both are that same family, so only the number in front of it differs. Two
  // copies of the stack could be edited apart while each still looked fine
  // beside its own row, which reads as a caption set in a different face from
  // the labels under it.
  var FONT = 'system-ui, sans-serif';

  // Both rows of that strip set their type the same way: a size, the unit, then
  // the one family. Written beside each row the pair could be edited apart —
  // one keeping the unit, one dropping it — which reads as a caption set at a
  // different size from the labels under it while each still looked fine on its
  // own row, so the two sizes go through this one writer.
  function chartFont(hc, size) {
    hc.font = size + 'px ' + FONT;
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

  // Heights are stored 0..1 and the tick ladder counts whole units, so every
  // mark in that strip first passes through the same scaling. Three reads: the
  // step the ladder picks and both ends of the range it walks. Written beside
  // each site the pair could be edited apart — one scaling by a hundred, one
  // keeping the stored fraction — which leaves ticks counted against a range
  // their own step never measured: a strip crowded with marks beside a step
  // picked for a wider one, still a plausible chart at a glance.
  function wholeUnits(value) {
    return value * 100;
  }

  // The other direction of that same scaling: a tick counted in whole units has
  // to be placed on a chart whose axis is stored 0..1. Both halves name the
  // same hundred, so the step it picks and the position it lands at cannot be
  // measured on two scales — a crowded strip beside a step picked for a wide
  // one, still a plausible chart at a glance.
  function storedHeight(u) {
    return u / 100;
  }

  // A mark placed by `chartX` can fall just outside the strip when a world's
  // own range is narrower than the two levels the marks name, so each of those
  // positions is held inside the chart's width. Both ends of that hold are one
  // decision about how far a mark may leave its box, so they live together:
  // written as two comparisons beside the call, one could be dropped while the
  // other stayed, which lets a sea rule ride off the right edge of a chart
  // while still coming back on the left — an asymmetry small enough to read as
  // an odd chart rather than as a bug.
  function clampTo(value, hi) {
    return Math.max(0, Math.min(hi, value));
  }

  // The width of a piece of text, as the chart's own context measures it. Every
  // mark that has to be nudged to fit — a right-hand corner label, a tick that
  // would crowd it, a pill grown around a caption — asks that one question, and
  // the answer is always the width of the same measurement. Written beside each
  // site the pair could be edited apart, which lets a label be placed by one
  // metric while its own box is sized by another: a caption a pixel off its
  // pill still reads as a caption, so all seven reads go through here.
  function textWidth(hc, s) {
    return hc.measureText(s).width;
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
    while (keep.length > 1 && textWidth(hc, label) > limit) {
      keep.pop();
      label = keep.join('  ');
    }
    return label;
  }

  // One bar of the relief chart is a box: where its column starts, how tall it
  // stands above the strip, and the two edges that keep neighbouring bars from
  // sharing a pixel. Those four measurements are one box, so they are written
  // once. Beside the call the pair of truncations could be edited apart — one
  // rounding the column, the other keeping a fraction — which lets a bar start
  // half a pixel from the edge its own width then rounds away: a hairline gap
  // between two columns of bars, small enough to read as a slightly loose
  // chart rather than as a broken grid.
  function fillBar(hc, i, binW, h, bh) {
    hc.fillRect(Math.round(i * binW), Math.round(h - bh),
      Math.ceil(binW), Math.round(bh));
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
    return TerraCore.spanFloor(span);
  }

  // A count of cells, printed whole. The readout carries two of them — how far
  // a dry cell sits from the shoreline, and how many cells drain behind a
  // channel — and both are whole numbers over a grid, so both are rounded by
  // this one lookup rather than by a division written beside each note. Two
  // copies could be edited apart while each still read fine beside its own
  // caption, and one hovered cell would then report its two counts on two
  // different scales.
  function cellCount(value) {
    return Math.round(value);
  }

  // A count of cells read out of one of the grid's own fields. Two notes in the
  // readout do that — how far a dry cell sits from the shoreline, how many
  // cells drain behind a channel — and each has to survive a world whose field
  // is absent altogether, which is a zero rather than a blank. Written beside
  // each note the fallback could be edited on one of them only: one would print
  // nothing where the other printed `0`, which reads as a note that goes quiet
  // for reasons its neighbour does not share. Both halves are one lookup.
  function fieldCount(field, i) {
    return field ? cellCount(field[i]) : 0;
  }

  // Whether one of the grid's own marks names the hovered cell. Four notes in
  // the readout ask that question — the standing water, its basin number, the
  // outlet that drains it, the channel behind a river — and each has to
  // survive a world whose field is absent altogether, which is the same empty
  // answer as a cell the field never touched. Written beside each note the
  // pair of halves could be edited apart, one keeping the absent-field test
  // and one dropping it, which reads as a note that goes quiet on a plain
  // world while its neighbour still prints — each half plausible beside its
  // own caption, so the pair is one lookup both read.
  function marked(field, i) {
    return !!field && !!field[i];
  }

  // Whether a count of cells says anything. Both counts in the readout — how
  // far a dry cell sits from the shoreline, how many cells drain behind a
  // channel — are worth a word only once they are past the cell itself, and
  // the two notes are read side by side in one line, so the pair should agree
  // on where "worth a word" starts. Written beside each note the threshold
  // could be edited on one side only, which reads as one note going quiet a
  // step earlier than the other for reasons nothing on the page explains.
  function worthNaming(n) {
    return n > 1;
  }

  // A height out of a hundred, with the word that says what the number counts.
  // Three views print one: the `relief` row, the `median` row and the elevation
  // in the hover readout. Each already scales through the same out-of-a-hundred
  // lookup, and the unit is the other half of that pair — written beside each
  // view it could lose its space on one of them, which reads as two columns of
  // numbers set by two different hands. One builder keeps the suffix in step
  // with the scaling above it.
  function unitText(n) {
    return n + ' units';
  }

  // One end of the chart's range, printed as a plain number. The two corners of
  // the relief strip are that same conversion — a scaled height with no word
  // beside it — so the shape is written once and each corner names its own
  // end. Beside each label the conversion could lose its `String` on one side
  // only, which reads as a pair of figures set by two different hands: the
  // corner that kept it prints a number, the other a bare value the ruler has
  // to re-read. Close enough to look fine in a screenshot, so both halves go
  // through this lookup.
  function cornerLabel(value) {
    return String(hundred(value));
  }

  // One axis of the biome lookup, written into the readout. The pair — the
  // moisture that moved a cell and the temperature that moved it with it — is
  // two fields of the same shape: a field or nothing, an index, and the same
  // out-of-a-hundred scaling. Written beside each other the two could be
  // edited apart, one keeping its own guard and one dropping it, which reads
  // as a readout that names the wet axis on a world without a moisture field
  // while staying silent about the cold one. Both go through this lookup so
  // the pair always arrives together, or not at all.
  // The third step is the overlay's own name: with the moisture ramp on, the
  // figure above the pair already IS that axis, so printing it twice would
  // crowd the two readings that do say something new off the end of the line.
  function pushAxis(parts, name, field, i) {
    if (!field || name === current.channelName) return;
    parts.push(name + ' ' + hundred(field[i]));
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

  // A class's share of the grid, already printed: the division of its count by
  // the grid plus the one formatter every share on the page uses. Two views
  // show that pair — the right column of the legend and the note under the
  // map when a row is pinned — and each of them needs both halves, so the
  // scaling lives here rather than beside each caller. Written twice, one
  // view could round a small class to a whole percent while the other kept a
  // decimal, which reads as a row and a note disagreeing about the same class
  // they both name.
  function shareText(stats, key) {
    return percentText(TerraCore.classShare(stats, key));
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
  // Both lists on the page are rebuilt from scratch rather than patched: the
  // legend rows and the stats rows each follow the world they describe. Each
  // rebuild starts by emptying its own container, and that first step is the
  // same for both — written beside each list one could drop to
  // `innerHTML = ''` while the other kept a text clear, which reads as a stale
  // row surviving under a list that looked rebuilt.
  function clearBox(el) {
    el.textContent = '';
  }

  // Which attribute a legend row carries its class in. Two places need that
  // name: the write as each row is built, and the read that finds the same row
  // again after a keyboard toggle so the caret can be handed back. Written
  // beside each site the name could be changed on one side only, which reads as
  // a row that shows its ring and then loses the caret on the floor — the pin
  // still works with a click, so nothing else looks wrong.
  var ROW_KEY = 'data-key';

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
    // Every legend row is three spans: a swatch, a name, a share. Each is a
    // span with a class on it — the name is the one that carries none — so the
    // shape of the node is written once and each read names its own class.
    // Written beside each part the creation could gain a class on one of them
    // only, which reads as a row whose swatch stops matching its own column.
    function rowSpan(cls) {
      var s = document.createElement('span');
      if (cls) s.className = cls;
      return s;
    }
    // A row answers to two kinds of caret the same way: whatever puts the
    // pointer or the focus on it previews that class, whatever takes it away
    // gives the preview back. Four listeners, two shapes — written beside each
    // other the pair could be edited apart, which reads as a row that keeps a
    // faded map after the pointer leaves while a tab away still restored it.
    // Both halves repaint through drawHover(), so a cell picked earlier — from
    // the hash or a previous hover — keeps its mark when the list is left.
    function watchRow(li, key) {
      li.addEventListener('mouseenter', function () { drawHighlighted(key); });
      li.addEventListener('mouseleave', clearSolo);
      li.addEventListener('focus', function () { drawHighlighted(key); });
      li.addEventListener('blur', clearSolo);
    }
    clearBox(legendList);
    keys.forEach(function (key) {
        var li = document.createElement('li');
        // The key is kept on the element so a rebuild can find the same row
        // again and hand the caret back after a keyboard toggle.
        li.setAttribute(ROW_KEY, key);
        watchRow(li, key);
        var sw = rowSpan('sw');
        var c = result.palette.colors[key] || result.palette.colors.grass;
        sw.style.background = rgba(c, 1);
        var label = rowSpan(null);
        label.textContent = biomeLabel(key);
        var pct = rowSpan('pct');
        pct.textContent = shareText(result.stats, key);
        li.appendChild(sw); li.appendChild(label); li.appendChild(pct);
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
          var again = legendList.querySelector('[' + ROW_KEY + '="' + key + '"]');
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
    return optionNumber('scale', true) || 3;
  }

  function renderStats(result) {
    var s = result.stats;
    var factor = exportFactor();
    // A grid is always read as a pair of counts with a space either side of
    // the `x`, in the row that names the world and in the row that names the
    // size it saves at. Written beside each row the separator could lose a
    // space on one of them, which reads as two columns of numbers set by two
    // different hands — close enough to look fine in a screenshot.
    function sizeText(w, h) {
      return w + ' x ' + h;
    }
    // Two of these rows are a split rather than a single figure: the network's
    // two weights, the two band counts on either side of the shoreline. Each
    // prints a count, a word, the slash, then the other pair. Written beside
    // each row the separator could gain or lose its spaces on one of them,
    // which reads as two tables of numbers set by two different hands.
    function splitText(first, firstWord, second, secondWord) {
      return first + ' ' + firstWord + ' / ' + second + ' ' + secondWord;
    }
    // Two other rows are a plain count of things on this world: how many
    // separate basins the lake cover is split into, how many classes it wears.
    // Neither needs a unit or a second figure, so both are just the number as
    // text. Written beside each row the conversion could gain a pad or a
    // prefix on one of them, which reads as two columns of counts set by two
    // different hands — close enough to look fine beside their own labels.
    function countText(n) {
      return String(n);
    }
    // Each row is two cells: a name and its figure. Both are a node with a
    // text on it, so the pair is one builder read once per half. Written beside
    // each half the creation could gain a class on one of them, or drop its
    // text assignment, which reads as a column of figures with no names beside
    // them — a table that still looks tidy in a screenshot.
    function statCell(tag, text) {
      var el = document.createElement(tag);
      el.textContent = text;
      return el;
    }
    var rows = [
      // First so a printed page or a screenshot of the sidebar still says
      // which phrase the world came from — the hash is not on paper.
      ['seed', seedPhrase()],
      ['grid', sizeText(result.width, result.height)],
      // The multiplier only ever touches the saved file, so without this row
      // the `e` key would look like it did nothing until a PNG was opened.
      ['export', factor + 'x \u00b7 ' +
        sizeText(result.width * factor, result.height * factor)],
      ['land', percentText(s.land)],
      ['water', percentText(s.water)],
      ['lake', percentText(TerraCore.lakeShare(s))],
      // How many separate basins that lake cover is split into.
      ['basins', countText(s.lakeBasins)],
      ['ice', percentText(s.ice)],
      // Both halves of the network, same split as the `contours` row: the
      // weight of a line on the map comes from this pair, so the numbers that
      // explain the drawing sit next to it.
      ['rivers', splitText(s.rivers - s.trunks, 'tri', s.trunks, 'trunk')],
      // The spread plus its two ends: the difference alone cannot say whether a
      // world climbs from a deep shelf or from a damp plain, and the pair in
      // brackets is the same two numbers printed at the corners of the chart.
      ['relief', unitText(hundred(s.max - s.min)) + ' (' +
        rangeText(s.min, s.max) + ')'],
      // Half the grid sits below this height, which is what separates a broad
      // plateau from a plain with one peak when both share a relief range.
      ['median', unitText(hundred(s.median))],
      ['biomes', countText(biomeCount(s.counts))],
      ['contours', splitText(s.contourBands, 'land', s.basinBands, 'basin')],
      ['checksum', s.checksum],
    ];
    // When an overlay is on, say which one: the legend below still lists the
    // biomes, so the two together explain what is being looked at. The row is
    // pushed in place rather than spliced in after the list is closed, so its
    // position — between the checksum and the clock — is written once.
    if (result.channelName) {
      rows.push(['channel', result.channelName]);
    }
    rows.push(['generate', s.ms + ' ms']);
    clearBox(statsBox);
    rows.forEach(function (row) {
      statsBox.appendChild(statCell('dt', row[0]));
      statsBox.appendChild(statCell('dd', row[1]));
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
    var cssW = cssSize(histCanvas.clientWidth, TerraCore.histWidth);
    var cssH = cssSize(histCanvas.clientHeight, TerraCore.histHeight);
    var dpr = pixelScale();
    var bw = bufferSize(cssW, dpr), bhPix = bufferSize(cssH, dpr);
    sizeCanvas(histCanvas, bw, bhPix);
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
    var st = histState, hc = ctxOf(histCanvas);
    hc.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    var w = st.w, h = st.h, BINS = st.bins, hist = st.hist, peak = st.peak;
    var lo = st.lo, span = st.span, result = st.result;
    var i;
    hc.clearRect(0, 0, w, h);
    var binW = w / BINS;
    // Left/right inset for the text drawn into the chart.
    // Every mark that is not a bar is measured from that inset: the tick
    // bounds, the two corner labels, the three-way squeeze of the median, the
    // width a hovered caption may fill and the pill behind it. Written beside
    // each site the pair could be edited apart, which would let a corner label
    // sit closer to its edge than the tick under it — a difference small enough
    // to read as a slightly odd chart rather than as a bug.
    var GUT = 3;
    // Two marks are measured against the room left INSIDE that gutter: the
    // fit test for the median row and the limit a hovered caption shrinks to.
    // Both are the chart's width minus the inset on either side, so the pair
    // of subtractions is written once. Beside each call the count of gutters
    // could be edited apart — one dropping to a single inset — which lets a
    // caption claim a column the median test had already given to its corner
    // number: still a plausible row of labels, one of them overlapping.
    function innerWidth(w) {
      return w - GUT * 2;
    }
    var seaX = chartX(result.seaLevel, lo, span, w);
    seaX = clampTo(seaX, w);
    paintSky(hc, result.palette.sky, w, h);
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
    // The median's mark is taller than a decade tick, and that depth is one
    // number of its own: it hangs from the same edge as the ticks and reaches
    // further down, which is what makes the middle of the range findable
    // without reading its label. Written as a bare offset the two marks could
    // be edited apart, which leaves a median standing no taller than the ticks
    // beside it while its own number still reads as the important one.
    var MARK = 7;
    for (i = 0; i < BINS; i++) {
      // Leave a strip along the bottom for the two corner labels, so the
      // tallest bar never sits on top of the numbers.
      var bh = TerraCore.barShare(hist, peak, i) * (h - STRIP);
      var c = binEdge(lo, span, BINS, i + 0.5) < result.seaLevel ? wet : dry;
      var on = only < 0 ? (!member || member[i]) : i === only;
      var keep = on ? 1 : 0.45;
      // A dimmed bar is the palette's own triple washed toward the page's
      // white, which is the same blend the hover overlay does — so it goes
      // through the same two helpers rather than a fourth rounding of its own.
      hc.fillStyle = rgba(mix(c, WHITE, 1 - keep), 1);
      fillBar(hc, i, binW, h, bh);
    }
    hc.strokeStyle = rgba(INK, MID);
    hc.lineWidth = HAIR;
    strokeMark(hc, seaX, 0, h);
    // Ticks every ten units of height, in the strip under the bars. Two corner
    // numbers give the ends of the range but nothing in between, and the ticks
    // are what make a bar's height estimable by eye. Drawn on the same grid as
    // the sea rule so both read as one set of marks.
    // The spacing follows the relief of this world: a flat craton spanning
    // fifteen units would otherwise get a single tick, a tall fjord close to
    // twenty. Pick the first step that leaves at most ten marks.
    // The formula lives in the core, so the suite can check the same spacing a
    // chart is drawn with rather than repeating the candidate list here.
    var stepUnits = TerraCore.tickStep(wholeUnits(span));
    hc.strokeStyle = rgba(INK, 0.35);
    // A tick that would sit under one of the corner numbers is skipped rather
    // than drawn short, and the tolerance for "under" is one number that both
    // ends of the strip read. Both halves of that hold — the low gutter and
    // the high one — are one question about a mark, so they live together:
    // written as two comparisons beside the loop the pair could be edited
    // apart, which crowds the ticks into one corner while the other still
    // breathes — an asymmetry small enough to read as an odd chart.
    var SLACK = 1;
    function insideStrip(x, w) {
      return x >= GUT - SLACK && x <= w - GUT + SLACK;
    }
    for (var u = Math.ceil(wholeUnits(lo) / stepUnits) * stepUnits;
      u <= wholeUnits(lo + span); u += stepUnits) {
      var tickX = chartX(storedHeight(u), lo, span, w);
      if (!insideStrip(tickX, w)) continue;
      // Every tick is the same short mark hanging from the strip's own top
      // edge, so its length is one number: the mark starts one pixel below
      // that edge and runs down to this depth. Written as two offsets the
      // pair could be edited apart, which leaves one tick shorter than its
      // neighbours while the rest of the row still reads as a plausible
      // scale — an asymmetry too small for anyone to open the console over.
      var TICK = 4;
      strokeMark(hc, tickX, h - STRIP + 1, h - STRIP + TICK);
    }
    // The marker line alone does not say what the sea level is, and the slider
    // is the knob that moves it most, so the number rides next to the rule.
    // Flipped to the left of the line when it would otherwise run off the edge.
    chartFont(hc, 9);
    var seaLabel = 'sea ' + hundred(result.seaLevel);
    var seaTw = textWidth(hc, seaLabel);
    hc.fillStyle = rgba(INK, 0.75);
    // The gap between the rule and its number is one measure: it is the lead
    // on whichever side the label lands, and twice that lead is what the flip
    // test needs before it commits to the right. Written per site the pair
    // could be edited apart, which puts the number closer to the line on one
    // side of the chart than on the other.
    var LEAD = 4;
    hc.fillText(seaLabel,
      seaTw + LEAD * 2 + seaX < w ? seaX + LEAD : seaX - seaTw - LEAD, 9);
    // Corner labels give the chart a scale: without them the shape of the
    // spread is readable but the numbers are not. Drawn before the hovered-bin
    // label so a hover can cover them when space is tight.
    hc.fillStyle = rgba(INK, 0.55);
    var loLabel = cornerLabel(lo);
    var hiLabel = cornerLabel(lo + span);
    // All three labels in that strip sit on one baseline, measured up from its
    // bottom edge: the two ends of the range and the median between them. A
    // second offset written beside one of them would put that figure a pixel
    // off the others, which reads as two rows of numbers rather than one.
    var BASE = 1;
    hc.fillText(loLabel, GUT, h - BASE);
    hc.fillText(hiLabel, w - GUT - textWidth(hc, hiLabel), h - BASE);
    // The median gets a taller mark than the decade ticks: it is the one
    // number that says where most of the grid actually sits, so it is worth
    // seeing against the bars without reading the stats list.
    var medX = chartX(result.stats.median, lo, span, w);
    if (medX >= 0 && medX <= w) {
      hc.strokeStyle = rgba(INK, MID);
      strokeMark(hc, medX, h - STRIP, h - STRIP + MARK);
      // The mark alone says "most of the grid is around here"; the number says
      // how high that is, which is the difference between a shape and a
      // measurement. Kept inside the corner labels so the strip never overlaps.
      var medLabel = 'median ' + hundred(result.stats.median);
      var medTw = textWidth(hc, medLabel);
      var loTw = textWidth(hc, loLabel);
      var hiTw = textWidth(hc, hiLabel);
      // Three labels share that strip, so the gap between two of them is one
      // number: it pushes the median clear of the low-end figure, pulls it back
      // from the high end, and is multiplied up when the row is measured to see
      // whether the whole thing fits. Written per site the pair could be edited
      // apart, and a median sitting on top of its own corner number still reads
      // as a plausible chart at a glance.
      var GAP = 4;
      var medTextX = medX - medTw / 2;
      if (medTextX < GUT + loTw + GAP) medTextX = GUT + loTw + GAP;
      if (medTextX + medTw > w - GUT - hiTw - GAP) {
        medTextX = w - GUT - hiTw - GAP - medTw;
      }
      if (medTw < innerWidth(w) - loTw - hiTw - GAP * 4) {
        hc.fillStyle = rgba(INK, MID);
        hc.fillText(medLabel, medTextX, h - BASE);
      }
    }
    // A hovered bin gets its elevation range and cell count written into the
    // chart itself, which keeps the sidebar from reflowing on every move.
    if (only >= 0) {
      var sum = bandSummary(only);
      chartFont(hc, 10);
      // The full label is the range, the count and the class. On a narrow
      // sidebar that runs past the chart, so the least useful parts are
      // dropped first: class, then count. The range always survives — it is
      // what ties the bump back to the map.
      var parts = [rangeText(sum.from, sum.to)]
        .concat(bandFields(sum));
      var label = fitLabel(hc, parts, innerWidth(w));
      var tw = textWidth(hc, label);
      // The box behind the caption is the label plus one padding on every
      // side: the fill starts that far left of the text and grows by twice
      // itself, so the ink never touches the edge of its own pill. Written per
      // site the pair could be edited apart, which leaves the padding deep on
      // one side of the box and tight on the other — an asymmetry small enough
      // to read as a stray mark rather than as a bug.
      var PILL = 2;
      // The box and its caption are one row of the chart, so the height of
      // the fill and the baseline of the ink inside it are one measurement:
      // the box is this tall, and the text sits two pixels above its own
      // bottom edge. Written beside each call the pair could be edited apart,
      // which leaves a caption riding low in a box grown taller around it —
      // an asymmetry small enough to read as a stray mark rather than as a
      // bug, so both halves read the one number.
      var CAP = 13;
      hc.fillStyle = rgba(WHITE, 0.88);
      hc.fillRect(GUT - PILL, 1, tw + PILL * 2, CAP);
      hc.fillStyle = rgba(INK, 0.9);
      hc.fillText(label, GUT, CAP - 2);
    }
  }

  /* ---- interaction ---- */

  // Every path that moves the cursor ends by putting the crosshair somewhere,
  // and the mark is a pair: a column and a row. Written at each site the pair
  // could lose one half on one branch only, which reads as a cursor that
  // tracks sideways while its own row stays put — a difference small enough to
  // look like an odd mouse rather than a bug, so both halves go through this
  // one writer and every caller hands over two numbers.
  function setHoverPoint(x, y) {
    hover.x = x;
    hover.y = y;
  }

  function setHoverFromEvent(ev) {
    var p = pointerPos(ev);
    setHoverPoint(p.x, p.y);
  }

  // Keyboard equivalent: put the cursor on a grid cell by index, which is how
  // the arrow keys walk the map. The readout is rebuilt from the same code the
  // mouse uses, so both paths agree on what a cell says.
  function hoverCell(px, py) {
    if (!current) return;
    px = clampIndex(px, current.width);
    py = clampIndex(py, current.height);
    var cs = cellSize();
    setHoverPoint(cellCentre(px, cs.w), cellCentre(py, cs.h));
    updateReadout(px, py);
    drawHover();
    // The walked cell is part of the shared state too, so the link follows the
    // keyboard. replaceState does not fire hashchange, so this cannot loop.
    writeHash();
  }

  function currentCell() {
    if (pointerAway() || !current) {
      // With no pointer the link names the middle cell of each axis, so a
      // reopened page has something under its crosshair. Both halves are the
      // same rule over one count, and a world that is not built yet counts as
      // nothing — the same fallback the two guards above already imply.
      return [middleIndex(current && current.width),
        middleIndex(current && current.height)];
    }
    var xy = cellOf(hover.x, hover.y);
    // Same clamp the readout applies, so the pair in the hash is the pair a
    // person sees on screen. A pointer resting above the canvas would
    // otherwise write a negative row that `applyHash()` then throws away.
    return [clampIndex(xy[0], current.width), clampIndex(xy[1], current.height)];
  }

  function updateReadout(ev, py) {
    if (!current) return;
    var px;
    if (typeof ev === 'number') { px = ev; }
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
      (elev > 0 ? '+' : '') + unitText(elev)
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
    if (above && marked(current.lakeMask, i)) {
      // The mask stores 1..60 steps of the basin's own depth range, so the
      // readout converts it to a percentage: "depth 42" means nothing, "62%
      // deep" says how full this part of the basin is.
      parts.push(hundred(current.lakeMask[i] / TerraCore.lakeSteps) + '% deep');
      // Which of the world's lakes this is. Two basins of the same depth read
      // alike otherwise, and the number matches the `basins` row in the stats.
      if (marked(current.basin, i)) {
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
      pushAxis(parts, 'moist', current.moisture, i);
      pushAxis(parts, 'temp', current.temperature, i);
    }
    // Distance to the nearest shoreline, so a green patch in the middle of a
    // continent reads differently from the same colour on a coast.
    // Only worth printing inland: a water cell is by definition at the shore,
    // and a beach cell one step in, so those would repeat the biome name.
    var inland = fieldCount(current.coastDistance, i);
    if (above && worthNaming(inland)) parts.push(inland + ' from water');
    // The one rim cell a basin spills over. It is the seam between a lake and
    // the river network, so it is worth naming on its own: hovering it shows
    // where the water in a closed basin actually goes.
    // The mark carries the basin's own number, which is how an outlet in a
    // world of a dozen tarns says which one it belongs to. The outlet sits
    // outside the fill, so this is the only place its lake gets named.
    // The bearing rides along here too: this one cell IS the way out, so the
    // direction is worth more on the outlet than on the shore it sits beside.
    // Same lookup as the filled cells, indexed by the mark's own number.
    if (marked(current.spillway, i)) {
      var outB = spillBearing(current.spillway[i]);
      parts.push('outlet of basin ' + basinTally(current.spillway[i]) +
        (outB ? ' drains ' + outB : ''));
    }
    if (marked(current.riverMask, i)) {
      // The catchment behind the channel explains why this cell is a trunk and
      // its neighbour is a tributary: it is the same accumulation number the
      // quantile cut is taken from.
      var catchment = fieldCount(current.accumulation, i);
      parts.push((current.riverMask[i] === 2 ? 'trunk river' : 'river') +
        (worthNaming(catchment) ? ' (' + catchment + ' cells)' : ''));
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

  // Where a position inside the bin count falls in the height range. Three
  // readers need that: the two ends of a hovered bar's range, and the middle of
  // a bar where its own colour is compared against the shoreline. Each is the
  // same division of a bin slot by the count, scaled by the range. Written
  // beside each reader the scaling could be edited apart, which lets a bar be
  // coloured by one range while its caption names another — both still read as
  // a plausible silhouette beside their own labels.
  function binEdge(lo, span, bins, k) {
    return lo + k / bins * span;
  }

  // How many bars this world's chart was binned over. Six readers ask that
  // question: the pass that bins a height, the tally printed beside a bar,
  // both halves of a pointer's bin (the raw count and the bound that keeps it
  // inside), the keyboard walk's own count, and the first press of that walk.
  // Written beside each reader the count could be edited apart, which lets a
  // bar be lit by one ladder while its own caption counts against another —
  // still a plausible silhouette beside its own label, so the count is read
  // once here.
  function binTotal() {
    return histState.bins;
  }

  function histBinFor(h) {
    if (!histState) return -1;
    return binIndex(h, histState.lo, histState.span, binTotal());
  }

  // Everything one bar of the chart knows: the height range it covers, how
  // many cells fell in it, and which biome fills most of it. The chart's own
  // caption and the hover readout both read this one lookup, so a bin cannot
  // describe itself one way inside the chart and another way in the strip
  // under the map.
  function bandSummary(bin) {
    if (!histState) return null;
    var st = histState;
    var from = binEdge(st.lo, st.span, st.bins, bin);
    var to = binEdge(st.lo, st.span, st.bins, bin + 1);
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
    return (bin + 1) + '/' + binTotal() +
      ' (' + rangeText(sum.from, sum.to) + ')';
  }

  // The two ends of one bar's height range, out of a hundred. Both the chart's
  // own caption and every note that names a bar print this pair, and each of
  // them scales it through the same out-of-a-hundred lookup the rows use. Cut
  // that scaling twice and one view could round a bin against another range
  // than the one that lit it, while each figure still looked reasonable beside
  // its own caption — so the pair is built once, here.
  function rangeText(lo, hi) {
    return hundred(lo) + '-' + hundred(hi);
  }

  // The two fields every view of a bin prints after its tally: how many cells
  // fell in the bar, and which class fills most of it. Both the caption drawn
  // inside the chart and the line under the map end with this pair, and each
  // leaves the class out when a bin has none. Written beside each view the
  // pair could be edited apart — one counting cells and the other naming a
  // class the first never mentioned — which still reads as two plausible
  // readings of one bar. Both go through this list so the two views say the
  // same thing about the same bin, at whatever length each of them fits.
  function bandFields(sum) {
    var fields = [sum.cells + ' cells'];
    if (sum.top) fields.push(biomeLabel(sum.top));
    return fields;
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
    var c = newCanvas();
    sizeCanvas(c, big.width, big.height);
    var cx = ctxOf(c);
    nearest(cx);
    var img = cx.createImageData(big.width, big.height);
    img.data.set(big.data);
    cx.putImageData(img, 0, 0);
    var a = document.createElement('a');
    // The seed alone is not enough to recognise a saved file later: the shape
    // and the grid size tell you which of the many rerolls this was, the
    // palette separates two looks of the same seed, and the checksum is the
    // shortest way back from a file to the link that produced it.
    var nameParts = ['terra', seedPhrase(), inputs.shape.value,
      inputs.palette.value, current.width + 'x' + current.height,
      exportFactor() + 'x', current.stats.checksum];
    // The multiplier is part of the ordered list rather than a later insert:
    // the factor sits between the grid size and the checksum, and a positional
    // `splice` would have to be re-counted every time a field joined the list.
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
  // How long that window lasts is one number too: long enough to read the
  // word over the button, short enough that a second click is never fighting
  // a stale label. Written beside the timer it could be edited into two
  // different waits for the two branches of the copy path.
  var FEED = 900;
  var copyTimer = 0;
  // The button's own name is remembered under one attribute, and three sites
  // touch it: the guard that only stores it once, the write, and the restore.
  // Written beside each site the name could be changed on one of them only,
  // which reads as a button whose label never comes back — the copy still
  // works, so nothing else looks wrong. One lookup holds the spelling.
  var LABEL_KEY = 'data-label';
  function copyLink() {
    var url = location.href;
    var btn = copyBtn;
    // The button's real name is remembered the first time it is pressed, so a
    // second click while "Copied" is showing restores the label rather than
    // freezing the feedback word in its place.
    if (!btn.getAttribute(LABEL_KEY)) {
      btn.setAttribute(LABEL_KEY, btn.textContent);
    }
    var done = function () {
      btn.textContent = 'Copied';
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        copyTimer = 0;
        btn.textContent = btn.getAttribute(LABEL_KEY);
      }, FEED);
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

  // Every control answers the same pair of events, so one loop wires them all:
  // `change` for the dropdowns and the checkboxes, `input` for the things that
  // redraw while their value is being moved — the sliders and the seed box.
  // Written as a loop plus one extra listener beside it, the pair could be
  // edited apart: a control added to `inputs` would then answer one event only,
  // which reads as a box that waits for a click elsewhere before showing the
  // world it was just given. The seed box is named inside the same guard as the
  // sliders, since it is the one text control that redraws as it is typed.
  Object.keys(inputs).forEach(function (key) {
    inputs[key].addEventListener('change', render);
    inputs[key].addEventListener('input', function () {
      if (inputs[key].type === 'range' || key === 'seed') render();
    });
  });
  window.addEventListener('hashchange', function () { applyHash(); render(); });

  rerollBtn.addEventListener('click', function () {
    // Chain from the current seed rather than picking a fresh random one, so
    // the same starting phrase always walks the same sequence of worlds and a
    // shared link lands on the same tenth reroll.
    // The empty box is the fallback phrase here too, so the chain continues
    // from the world actually on screen rather than from an empty string.
    inputs.seed.value = String(TerraCore.nextSeed(seedPhrase()));
    render();
  });
  saveBtn.addEventListener('click', savePng);

  // The hash already holds every option, so the current URL is the whole state.
  copyBtn.addEventListener('click', copyLink);

  view.addEventListener('mousemove', function (ev) {
    hoverFromPointer(ev);
  });
  // Touch fires pointer events rather than mousemove, so the readout and the
  // crosshair would never move on a phone. One handler covers both, and the
  // mouse path is skipped when the pointer reports itself as a touch.
  // Which kind of pointer a handler is answering is the same question in both
  // places a pointer event is taken, so the comparison sits in one lookup. The
  // two guards are the pair that keeps one cursor move from painting the same
  // frame twice, and written beside each handler one of them could invert
  // while the other stayed put — which reads as a map that only answers a
  // finger, or a chart that redraws twice under a mouse, rather than as a bug.
  function fromTouch(ev) {
    return ev.pointerType !== 'mouse';
  }

  view.addEventListener('pointermove', function (ev) {
    if (!fromTouch(ev)) return;
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
    var rect = layoutBox(histCanvas);
    var f = pointerFraction(ev, rect);
    var bin = Math.floor(f.x * binTotal());
    // A touch has no hover-out, so nothing would ever clear the band again:
    // tapping the bar that is already selected drops it instead. The mouse
    // path keeps the plain rule, since leaving the chart clears it there.
    // Dropping the bar that is already selected is the same clear the two
    // pointer-leave paths do, so it reads that one helper rather than writing
    // its own reset beside a repaint.
    if (toggleSame && band === bin) { clearBand(); return; }
    // The same bound the three cell paths use: a bin is one index over one
    // count, so a pointer just past the last bar and a link restored against
    // a narrower grid both come back inside by this one rule. Written here as
    // well it could drop its lower guard while the cell walk kept its own, so
    // a tap left of the first bar would name a bar that was never counted.
    band = clampIndex(bin, binTotal());
    // And the matching cells on the map, so the two charts can be read against
    // each other without moving the pointer back and forth. drawHover() goes
    // through drawMap(), which repaints this chart with the same `band`, so one
    // call keeps both views in step.
    applyBand();
  }

  histCanvas.addEventListener('mousemove', hoverHistogram);
  // A finger reports itself through pointer events, so without this the chart
  // would only respond to a mouse. Same selection rule, same repaint.
  histCanvas.addEventListener('pointerdown', function (ev) {
    if (!fromTouch(ev)) return;
    hoverHistogram(ev, true);
  });

  // Every chart path ends the same way: repaint both views so the lit bar and
  // the faded cells agree, then rewrite the line under the map so its figures
  // are the ones now in force. Written beside each handler, a step dropped on
  // one of them reads as a bar that dims the map without naming itself.
  function applyBand() {
    drawHover();
    bandNote();
  }

  // Every way of putting the height filter back the way it was — a second tap
  // on the same bar, a pointer leaving the chart, a pointer leaving the map —
  // is the same reset followed by the same pair of repaints. Written beside
  // each handler the trio could be edited apart, which reads as a clear that
  // drops the selection from the map while the line under it still names the
  // old band. The reset itself lives here so no caller restates it.
  function clearBand() {
    band = -1;
    applyBand();
  }

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
        shareText(current.stats, want)
      ]);
      return;
    }
    if (band < 0 || !histState) {
      readout.textContent = 'hover the map';
      return;
    }
    var sum = bandSummary(band);
    if (!sum) return;
    var parts = ['band ' + bandTally(band, sum)].concat(bandFields(sum));
    readout.textContent = joinParts(parts);
  }

  // Keyboard version of the same selection: Shift+arrows walk the bins, so the
  // height filter is reachable without a pointer. First press starts in the
  // middle of the range, which is where most worlds keep most of their cells.
  function stepBand(bin) {
    if (!histState) return;
    // Same wrap the cell walk uses: sweeping one direction across the height
    // range keeps going instead of sticking on the last bar.
    var n = binTotal();
    band = cycleIndex(bin, 0, n);
    applyBand();
  }
  histCanvas.addEventListener('mouseleave', function () {
    clearBand();
  });

  view.addEventListener('mouseleave', function () {
    setHoverPoint(-1, -1);
    // The cell reading goes with it: nothing is under the cursor any more, so
    // the chart should show the whole silhouette again.
    cellBand = -1;
    // The chart's hovered bin is cleared together with the crosshair, so the
    // map never keeps a height filter after the pointer has gone while the
    // chart itself shows no selection.
    clearBand();
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

  // Whether the caret sits in a field that needs its own keys: the seed box
  // takes typed characters, and a select takes the arrows that move between
  // its options. Both are checked here so the arrow walk and the letter
  // shortcuts agree on when to stand back — one list written twice could let
  // the arrows into a dropdown the letters still avoided, which reads as a
  // half-working keyboard rather than as a deliberate split.
  function ownsCaret() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'SELECT'));
  }

  // Whether a key event carries a given letter, in either case. With Caps Lock
  // on the browser reports the uppercase form, so every letter shortcut has to
  // answer to both — and that pair is one comparison rather than a shape each
  // branch writes for itself. Written beside each key the pair could be cut
  // differently (one branch keeping only its own case), which reads as a
  // single letter that stops working for reasons nothing on the page explains.
  function keyIs(ev, letter) {
    return ev.key.toLowerCase() === letter;
  }

  // Which checkbox a letter flips. The two boxes on the panel — grain and
  // contour lines — are the only controls whose shortcut is a bare flip rather
  // than a walk over a list, so both pairs of letter-to-control sit in this one
  // table. Written beside each branch the pair could be edited apart, which
  // reads as one box answering two keys while its neighbour answers none.
  function checkboxFor(letter) {
    return { g: 'dither', l: 'contour' }[letter];
  }

  // Space rerolls from anywhere, unless the caret is in the seed box.
  document.addEventListener('keydown', function (ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // Arrows walk the hovered cell, so the readout is reachable without a
    // pointer. The first press starts from the middle of the grid.
    var step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (step) {
      // Only when a text field does not want the arrow for its own caret.
      if (!ownsCaret()) {
        // With Shift the same arrows walk the relief chart instead of the
        // grid: the height-band filter then has a keyboard path, which a touch
        // device without a hover state needs. Left/Right move along the bins,
        // Up/Down are the same pair so either axis works.
        if (ev.shiftKey && histState) {
          ev.preventDefault();
          var dx = step[0] || step[1];
          // With no bar picked yet the walk starts in the middle of the range,
          // which is the same middle the `at=` pair falls back to — one rule
          // for both, so a chart and a link cannot name two centres.
          stepBand(band < 0 ? middleIndex(binTotal()) : band + dx);
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
      var names = paletteKeys();
      // Read through `num()` like every other number on the page, so the
      // digit that picks a scheme is parsed by the one rule the sliders and
      // the option reader follow rather than by a second one beside it.
      var idx = num(ev.key, true) - 1;
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
    var typingLetter = ownsCaret();
    if (!typingLetter && keyIs(ev, 'c')) {
      ev.preventDefault();
      // Shift walks the list backwards, the same way it does for the legend
      // pins: backing out of an overlay should not need a full lap.
      cycleControl(inputs.channel, TerraCore.channels, ev);
      return;
    }
    // 'h' steps through the shape curves — the biggest single lever on a
    // world's silhouette, so it earns a key next to the overlay cycle. The
    // list is the same one the dropdown and `cli --shapes` read.
    if (!typingLetter && keyIs(ev, 'h')) {
      ev.preventDefault();
      cycleControl(inputs.shape, TerraCore.shapes, ev);
      return;
    }
    // 'd' walks the light bearing: the same four compass points the dropdown
    // lists, which is the fastest way to see which side a ridge wants.
    if (!typingLetter && keyIs(ev, 'd')) {
      ev.preventDefault();
      cycleControl(inputs.lightDir, TerraCore.lights, ev);
      return;
    }
    // 'w' walks the column count. It is the one knob that changes how much of
    // the world fits on screen without changing the seed, so it is worth a key
    // next to the shape cycle. The empty entry — auto — is part of the list,
    // so a lap of the key ends where the window began.
    if (!typingLetter && keyIs(ev, 'w')) {
      ev.preventDefault();
      cycleControl(inputs.gridSize, TerraCore.grids, ev);
      return;
    }
    // 'e' walks the export multiplier: the fourth of these lists is the only
    // one that changes the saved file and not the world, so it is the safest
    // key to press while comparing two sizes of the same seed.
    if (!typingLetter && keyIs(ev, 'e')) {
      ev.preventDefault();
      cycleControl(inputs.scale, TerraCore.scales, ev);
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
      var stepSea = num(inputs.seaLevel.step);
      if (!isFinite(stepSea) || stepSea <= 0) stepSea = 0.01;
      var loSea = num(inputs.seaLevel.min);
      var hiSea = num(inputs.seaLevel.max);
      var nowSea = num(inputs.seaLevel.value);
      if (!isFinite(nowSea)) return;
      var nextSea = nowSea + (ev.key === ']' ? stepSea : -stepSea);
      // The nudge has to drop the float drift a run of steps accumulates, and
      // the quantum it drops to is the one every other figure on the page
      // prints at: the shared out-of-a-hundred scale, divided back into the
      // 0..1 the slider holds. A second rounding written beside this branch
      // could be cut finer than the figures next to it, so the slider would
      // hold a level no readout on the page is able to name.
      nextSea = hundred(nextSea) / 100;
      // Both ends of the slider's range hold the level the same way: a bound
      // that reads moves the level to it, a bound that does not is left out.
      // Written beside each comparison the pair could be edited apart, which
      // lets a shoreline stop dead at its low end while running past its high
      // one — still a plausible sea level beside its own caption, so the hold
      // is one lookup both ends share.
      function holdBound(value, bound, isLow) {
        if (!isFinite(bound)) return value;
        return isLow ? Math.max(bound, value) : Math.min(bound, value);
      }
      nextSea = holdBound(nextSea, loSea, true);
      nextSea = holdBound(nextSea, hiSea, false);
      inputs.seaLevel.value = String(nextSea);
      render();
      return;
    }
    // The two checkboxes and the export are the only things left that a
    // keyboard user has to reach for: one key each, no modifiers.
    // 'm' drops the magnifier panel. It is the only overlay that hides part of
    // the map rather than tinting it, so it is the one worth being able to
    // switch off — and unlike the legend pin it changes no pixel of the world.
    if (!typingLetter && keyIs(ev, 'm')) {
      ev.preventDefault();
      insetOn = !insetOn;
      drawHover();
      return;
    }
    // 'k' walks the legend: each press pins the next class, and the cycle wraps
    // back through "nothing pinned". Same list the rows are built from, so the
    // order under the key is the order on screen.
    if (!typingLetter && keyIs(ev, 'k')) {
      ev.preventDefault();
      if (current) {
        var rows = legendKeys(current);
        // Shift steps backwards through the same list, so a mis-press does not
        // need a full lap of the legend to undo.
        var step = shiftStep(ev);
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
    if (!typingLetter && keyIs(ev, 'p')) {
      ev.preventDefault();
      cycleControl(inputs.seed, TerraCore.phrases, ev);
      return;
    }
    var toggle = checkboxFor(ev.key.toLowerCase());
    // 'x' copies the link, which is the last step of a finished world and the
    // only action left that needed a mouse. Same function as the button, so
    // the two paths cannot disagree about what gets copied.
    if (!typingLetter && keyIs(ev, 'x')) {
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
    if (!typingLetter && keyIs(ev, 's')) {
      ev.preventDefault();
      savePng();
      return;
    }
    // Both cases, like every other letter key: with Caps Lock on, `ev.key` is
    // the uppercase form, and a shortcut that only answered to one of the two
    // would look broken for reasons that have nothing to do with the map.
    if ((ev.key === ' ' || keyIs(ev, 'r')) &&
      document.activeElement !== inputs.seed) {
      ev.preventDefault();
      rerollBtn.click();
    }
  });

  render();
})();
