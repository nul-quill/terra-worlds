/* Headless smoke test for TerraCore: node tests/smoke.js */
'use strict';

require('../src/core.js');
var core = globalThis.TerraCore;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; }
  else { console.log('ok   - ' + msg); }
}

var a = core.generate({ seed: 'aurora basin', width: 200, height: 120 });
var b = core.generate({ seed: 'aurora basin', width: 200, height: 120 });
var c = core.generate({ seed: 'salt mirror', width: 200, height: 120 });

assert(a.width === 200 && a.height === 120, 'grid size honoured');
assert(a.data.length === 200 * 120 * 4, 'rgba buffer sized correctly');
assert(a.biome.length === 200 * 120, 'biome buffer sized correctly');

var same = true;
for (var i = 0; i < a.data.length; i++) { if (a.data[i] !== b.data[i]) { same = false; break; } }
assert(same, 'same seed reproduces identical pixels');
assert(!a.data.every(function (v) { return v === a.data[0]; }), 'different seed changes output');

var alphaOk = true;
for (var p = 3; p < a.data.length; p += 4) { if (a.data[p] !== 255) { alphaOk = false; break; } }
assert(alphaOk, 'alpha channel is opaque everywhere');

var land = a.stats.land, water = a.stats.water;
assert(land > 0.05 && land < 0.95, 'land fraction is non-degenerate (' + land.toFixed(3) + ')');
assert(Math.abs(land + water - 1) < 1e-3, 'land + water covers the grid');

assert(a.stats.rivers > 0, 'drainage produced river cells (' + a.stats.rivers + ')');

var keys = Object.keys(a.stats.counts);
assert(keys.length >= 5, 'multiple biomes present (' + keys.length + ')');

// Every class the biome lookup can return must have a colour in every palette,
// otherwise a cell falls back and one biome renders as the sky. Both sides are
// read from the generator, so the check follows a new class or palette.
var classes = Object.keys(core.biomeNames);
var colourOk = true;
Object.keys(core.palettes).forEach(function (name) {
  var colors = core.palettes[name].colors;
  classes.forEach(function (cls) {
    if (!colors[cls]) colourOk = false;
  });
});
assert(colourOk, 'every palette colours every biome class (' + classes.length + ')');

// The shade pass mixes those numbers straight into a pixel without clamping, so
// each entry has to be a triple of whole numbers inside 0..255. The sky is the
// one exception: it is a CSS string, because it is also the page background and
// the blend target for an isolated class. Each palette also needs a label: that
// is what the dropdown and the digit keys show.
function tripleOk(v) {
  return !!v && v.length === 3 && v.every(function (n) {
    return n === Math.round(n) && n >= 0 && n <= 255;
  });
}
var formatBad = [];
Object.keys(core.palettes).forEach(function (name) {
  var pal = core.palettes[name];
  if (!pal.label) formatBad.push(name + ' label');
  if (!/^#[0-9a-f]{6}$/i.test(pal.sky)) formatBad.push(name + ' sky');
  Object.keys(pal.colors).forEach(function (cls) {
    if (!tripleOk(pal.colors[cls])) formatBad.push(name + '.' + cls);
  });
});
assert(formatBad.length === 0 && Object.keys(core.palettes).length >= 4,
  'every palette colour is a whole-number triple (' +
  Object.keys(core.palettes).length + ' palettes, bad ' + formatBad.join(',') + ')');

// A palette is the one knob that moves only pixels, so each entry has to be
// worth a slot in the dropdown: one seed through every palette must give a
// different picture each time, while every count in stats stays the same.
// That pair of checks is what keeps a new entry a real recolour rather than a
// duplicate of the default, or a scheme that quietly re-classifies the world.
var palCounts = '';
var palSums = {};
var palSame = false;
Object.keys(core.palettes).forEach(function (pk) {
  var pr = core.generate({seed: 'salt mirror', palette: pk, width: 120, height: 80});
  var pCounts = JSON.stringify(pr.stats.counts);
  if (!palCounts) palCounts = pCounts;
  if (pCounts !== palCounts) palSame = true;
  palSums[pr.stats.checksum] = 1;
});
assert(!palSame && Object.keys(palSums).length === Object.keys(core.palettes).length,
  'every palette recolours the same world differently (' +
  Object.keys(palSums).length + ')');

var t = core.generate({ seed: 'perf', width: 480, height: 300 });
assert(t.stats.ms < 900, 'generation under 900ms (' + t.stats.ms + 'ms)');

var up = core.upscale(a, 2);
assert(up.width === 400 && up.height === 240, 'upscale doubles the grid');

// Growing the pixels must only repeat them: every source cell becomes a block
// of identical pixels, so a saved PNG at 6x is the same picture as at 2x and
// not a resampled one. Checked on a 3x of a small grid.
var tiny = core.generate({seed: 'upscale check', width: 24, height: 16});
var up3 = core.upscale(tiny, 3);
var blockOk = true;
for (var by = 0; by < tiny.height && blockOk; by++) {
  for (var bx = 0; bx < tiny.width && blockOk; bx++) {
    var so = (by * tiny.width + bx) * 4;
    for (var oy = 0; oy < 3; oy++) {
      for (var ox = 0; ox < 3; ox++) {
        var o = ((by * 3 + oy) * up3.width + bx * 3 + ox) * 4;
        for (var cc = 0; cc < 4; cc++) {
          if (up3.data[o + cc] !== tiny.data[so + cc]) blockOk = false;
        }
      }
    }
  }
}
assert(blockOk, 'upscale repeats each cell as a solid block');

var terraced = core.generate({ seed: 'terraced', width: 165, height: 103, terraces: 8, rivers: 200 });
assert(terraced.stats.rivers > 0, 'terraced plateaus still drain (' + terraced.stats.rivers + ' cells)');

// Every shape must produce a usable map: non-degenerate land, and heights that
// actually span the range rather than collapsing to one value. Walked from the
// generator's own list, so a new curve is covered without editing this file.
core.shapes.forEach(function (shape) {
  var r = core.generate({ seed: 'shape ' + shape.key, width: 180, height: 110, shape: shape.key });
  var lo = 1, hi = 0;
  for (var si = 0; si < r.heightField.length; si++) {
    var hv = r.heightField[si];
    if (hv < lo) lo = hv;
    if (hv > hi) hi = hv;
  }
  assert(r.stats.land > 0.02 && r.stats.land < 0.99 && hi - lo > 0.2,
    shape.key + ' spans a real height range (land=' + Math.round(r.stats.land * 100) + '%)');
});

// A curve in that list has to be worth having: each one is a dropdown entry,
// so two curves that render the same pixels would waste a slot in the cycle.
// One seed is rendered through every shape and the checksums are compared.
var shapeSeen = {};
var shapeSame = false;
core.shapes.forEach(function (sc) {
  var scSum = core.generate({seed: 'pale shelf', shape: sc.key, width: 160, height: 100})
    .stats.checksum;
  if (shapeSeen[scSum]) shapeSame = true;
  shapeSeen[scSum] = sc.key;
});
assert(!shapeSame && Object.keys(shapeSeen).length === core.shapes.length,
  'every shape renders its own world (' + Object.keys(shapeSeen).length + ')');

var noRiver = core.generate({ seed: 'terraced', width: 165, height: 103, rivers: 0 });
assert(noRiver.stats.rivers === 0, 'rivers=0 disables the drainage overlay');

// River hierarchy: a trunk must exist alongside its tributaries, and lake
// outflows must be drawn even where accumulation alone would not reach.
var hier = core.generate({ seed: 'pale shelf', width: 200, height: 120, rivers: 200 });
var minor = 0, major = 0;
for (var hi = 0; hi < hier.riverMask.length; hi++) {
  if (hier.riverMask[hi] === 1) minor++;
  else if (hier.riverMask[hi] === 2) major++;
}
assert(minor > 0 && major > 0 && major < minor,
  'trunk rivers are a subset of the network (' + major + ' of ' + (minor + major) + ')');

// The published pair has to be that same split: `trunks` is the count of mask
// value 2, and the tributary figure the row prints is everything else. A
// `trunks` that counted something else would keep the sum right while
// inverting which weight the sidebar calls the big one.
assert(hier.stats.trunks === major && hier.stats.rivers === minor + major &&
  hier.stats.trunks < hier.stats.rivers,
  'stats.trunks is the trunk half of the network (' + hier.stats.trunks +
  ' of ' + hier.stats.rivers + ')');

// Inland lakes: closed depressions must be detected on a plain-ish grid.
var withLakes = core.generate({ seed: 'pale shelf', width: 200, height: 120 });
var lakeCells = withLakes.stats.counts.lake || 0;
assert(lakeCells > 0, 'inland lakes detected (' + lakeCells + ' cells)');
var lakeFilled = 0;
for (var li = 0; li < withLakes.biome.length; li++) {
  if (withLakes.biome[li] === 'lake') lakeFilled++;
}
assert(lakeFilled === lakeCells, 'lake biome matches the lake mask');

// Climate: pushing the slider toward the poles must cool the world.
var warm = core.generate({ seed: 'pale shelf', width: 160, height: 100, polar: 0 });
var cold = core.generate({ seed: 'pale shelf', width: 160, height: 100, polar: 1 });
var coldBiomes = function (r) { return (r.stats.counts.ice || 0) + (r.stats.counts.tundra || 0); };
assert(coldBiomes(cold) > coldBiomes(warm),
  'climate slider cools the world (' + coldBiomes(warm) + ' -> ' + coldBiomes(cold) + ')');

// The temperature axis is published next to moisture, since the biome lookup
// is a table of both. Two properties make it worth printing in the readout:
// every cell has a value in 0..1, and the climate slider makes latitude
// dominate — the gap between an edge row and the middle row has to widen as
// `polar` goes up. A field that ignored the slider would keep the sentence
// saying `polar` over a world whose own numbers never cooled at the top.
function rowMean(r, y) {
  var t = r.temperature, sum = 0;
  if (t.length !== r.biome.length) return -1;
  for (var xi = 0; xi < r.width; xi++) {
    var v = t[y * r.width + xi];
    if (v < 0 || v > 1) return -1;
    sum += v;
  }
  return sum / r.width;
}
function latGap(r) {
  return rowMean(r, (r.height / 2) | 0) - Math.min(rowMean(r, 0), rowMean(r, r.height - 1));
}
var warmGap = latGap(warm), coldGap = latGap(cold);
// With the slider at zero the field is mostly noise, so only the sign of the
// gap is interesting: at full polar the latitude curve has to take over, which
// means a wider middle-over-edge difference than the noisy world shows.
assert(coldGap > warmGap && coldGap > 0,
  'the temperature field follows the climate slider (' +
  Math.round(warmGap * 100) + ' -> ' + Math.round(coldGap * 100) + ')');

assert(core.hashString('a') !== core.hashString('b'), 'hash distinguishes seeds');

// Stats must report the real extremes of the height field: the histogram bins
// itself over that range, so a wrong min/max would squash the chart.
var ranged = core.generate({ seed: 'aurora basin', width: 160, height: 100 });
var loSeen = 1, hiSeen = 0;
for (var ri = 0; ri < ranged.heightField.length; ri++) {
  if (ranged.heightField[ri] < loSeen) loSeen = ranged.heightField[ri];
  if (ranged.heightField[ri] > hiSeen) hiSeen = ranged.heightField[ri];
}
assert(Math.abs(ranged.stats.min - loSeen) < 1e-6 && Math.abs(ranged.stats.max - hiSeen) < 1e-6,
  'stats report the height range (' + ranged.stats.min.toFixed(3) + '..' +
  ranged.stats.max.toFixed(3) + ')');

// Grain: turning the Bayer dither off must change the shading but never move
// a biome boundary — the classification happens before the shading pass.
var grained = core.generate({ seed: 'salt mirror', width: 160, height: 100 });
var flat = core.generate({ seed: 'salt mirror', width: 160, height: 100, dither: false });
var shadeDiff = 0, biomeDiff = 0;
for (var gi = 0; gi < grained.data.length; gi += 4) {
  if (grained.data[gi] !== flat.data[gi]) shadeDiff++;
}
for (var gj = 0; gj < grained.biome.length; gj++) {
  if (grained.biome[gj] !== flat.biome[gj]) biomeDiff++;
}
assert(shadeDiff > 0 && biomeDiff === 0,
  'grain changes shading only (' + shadeDiff + ' pixels, ' + biomeDiff + ' biome moves)');

// Light bearing: rotating the light must move the shading but again must not
// shift a single biome, since classification happens before the colour pass.
var nw = core.generate({ seed: 'red ridge', width: 160, height: 100, lightDir: 'nw' });
var se = core.generate({ seed: 'red ridge', width: 160, height: 100, lightDir: 'se' });
var dirDiff = 0, dirBiome = 0;
for (var di = 0; di < nw.data.length; di += 4) {
  if (nw.data[di] !== se.data[di]) dirDiff++;
}
for (var dj = 0; dj < nw.biome.length; dj++) {
  if (nw.biome[dj] !== se.biome[dj]) dirBiome++;
}
assert(dirDiff > 0 && dirBiome === 0,
  'light bearing changes shading only (' + dirDiff + ' pixels, ' + dirBiome + ' biome moves)');

// The light bearings are one list too: the dropdown, the `d` key and the shade
// pass all read core.lights, so --lights has to agree with it.
var lit = {};
var litCounts = '';
var litSums = {};
core.lights.forEach(function (lt) {
  lit[lt.key] = core.generate({seed: 'aurora basin', width: 60, height: 40, lightDir: lt.key});
  var counts = JSON.stringify(lit[lt.key].stats.counts);
  if (!litCounts) litCounts = counts;
  assert(counts === litCounts, 'bearing ' + lt.key + ' shades without moving a biome');
  litSums[lit[lt.key].stats.checksum] = 1;
});
assert(Object.keys(litSums).length === core.lights.length,
  'every bearing is a distinct light vector (' + Object.keys(litSums).length + ')');

// Each bearing carries its own normalised vector, since the shade pass mixes
// it straight into a height without renormalising. A long vector would wash
// the relief out and a short one would flatten it, so check the length here
// rather than letting a hand-edited triple drift.
var worstLen = 0;
core.lights.forEach(function (lt) {
  var v = lt.vec;
  var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  worstLen = Math.max(worstLen, Math.abs(len - 1));
});
assert(worstLen < 0.01,
  'every light vector is a unit vector (worst drift ' + worstLen.toFixed(4) + ')');

// The strength slider is the last of the shading-only knobs: a flat world and
// a strongly lit one have to agree on every class while differing in pixels.
// Unlike the bearing it is a magnitude, so both ends of its range are checked
// — one that washed the relief out entirely would look the same at either end.
var softLight = core.generate({seed: 'red ridge', width: 160, height: 100, hillshade: 0});
var hardLight = core.generate({seed: 'red ridge', width: 160, height: 100, hillshade: 1});
var hsDiff = 0, hsBiome = 0;
for (var hsI = 0; hsI < softLight.data.length; hsI += 4) {
  if (softLight.data[hsI] !== hardLight.data[hsI]) hsDiff++;
}
for (var hsJ = 0; hsJ < softLight.biome.length; hsJ++) {
  if (softLight.biome[hsJ] !== hardLight.biome[hsJ]) hsBiome++;
}
assert(hsDiff > 0 && hsBiome === 0,
  'light strength changes shading only (' + hsDiff + ' pixels, ' +
  hsBiome + ' biome moves)');

// Hypsometric contours behave like the other shading knobs: more pixels move,
// no biome boundary does.
var lined = core.generate({ seed: 'craton step', width: 160, height: 100, contour: true });
var plain = core.generate({ seed: 'craton step', width: 160, height: 100 });
var lineDiff = 0, lineBiome = 0;
for (var ci = 0; ci < lined.data.length; ci += 4) {
  if (lined.data[ci] !== plain.data[ci]) lineDiff++;
}
for (var cj = 0; cj < lined.biome.length; cj++) {
  if (lined.biome[cj] !== plain.biome[cj]) lineBiome++;
}
assert(lineDiff > 0 && lineBiome === 0,
  'contour lines change shading only (' + lineDiff + ' pixels, ' + lineBiome + ' biome moves)');

// Band count must track the relief: a flooded world (high sea, so little land
// above the shoreline) gets fewer bands than a fully exposed one.
var flooded = core.generate({ seed: 'red ridge', width: 160, height: 100, seaLevel: 0.8 });
var dryWorld = core.generate({ seed: 'red ridge', width: 160, height: 100, seaLevel: 0.2 });
assert(flooded.stats.contourBands >= 6 && flooded.stats.contourBands <= 20 &&
  dryWorld.stats.contourBands >= flooded.stats.contourBands,
  'contour bands follow the relief (' + flooded.stats.contourBands + ' flooded, ' +
  dryWorld.stats.contourBands + ' dry)');

// The basin count tracks the depth range instead: a high sea level means a
// thicker column of water, so more bathymetric steps, capped at 12.
assert(flooded.stats.basinBands >= 3 && flooded.stats.basinBands <= 12 &&
  flooded.stats.basinBands >= dryWorld.stats.basinBands,
  'basin bands follow the depth range (' + flooded.stats.basinBands + ' flooded, ' +
  dryWorld.stats.basinBands + ' dry)');

// Distance to the shoreline: a cell adjacent to water must be at most one step
// from it, and the widest inland cell must be further. The readout and the
// continental drying both depend on this being a real distance field.
// One bracket press moves the sea slider by its own step, so the step has to be
// fine enough to see but not so fine that a press looks like nothing happened.
var seaStep = core.generate({ seed: 'pale shelf', width: 120, height: 80, seaLevel: 0.48 });
var seaNext = core.generate({ seed: 'pale shelf', width: 120, height: 80, seaLevel: 0.49 });
assert(Math.abs(seaNext.stats.land - seaStep.stats.land) > 0.001 &&
  Math.abs(seaNext.stats.land - seaStep.stats.land) < 0.10,
  'one sea step is visible but small (' + seaStep.stats.land.toFixed(3) + ' -> ' +
  seaNext.stats.land.toFixed(3) + ')');

var spread = core.generate({ seed: 'aurora basin', width: 160, height: 100 });
var cd = spread.coastDistance;
var cdMin = Infinity, cdMax = 0, cdBad = 0;
for (var ci2 = 0; ci2 < cd.length; ci2++) {
  if (cd[ci2] < cdMin) cdMin = cd[ci2];
  if (cd[ci2] > cdMax) cdMax = cd[ci2];
  // Water cells are their own coast, so their distance is zero by definition.
  if (spread.heightField[ci2] < spread.seaLevel && cd[ci2] !== 0) cdBad++;
}
assert(cdMin === 0 && cdMax > cdMin && cdBad === 0,
  'coast distance is a real field (min ' + cdMin + ', max ' + cdMax +
  ', ' + cdBad + ' water cells off by one)');

// The same field is what dries a continental interior, so the furthest cell
// from the shore has to track the size of the grid: a bigger world reaches
// further inland, and the chamfer sweeps must not saturate at some fixed
// number. Bounded by half the short side, since that is the most any cell can
// be from a coast. Land share is compared too — the field is a distance, not a
// second sea level, so growing it must not flood or drain the world.
function inland(seed, w, h) {
  var ir = core.generate({seed: seed, width: w, height: h});
  var irMax = 0;
  for (var ii = 0; ii < ir.coastDistance.length; ii++) {
    if (ir.coastDistance[ii] > irMax) irMax = ir.coastDistance[ii];
  }
  return {max: irMax, land: ir.stats.land};
}
var smallInland = inland('salt mirror', 120, 80);
var bigInland = inland('salt mirror', 480, 300);
// Four times the columns should buy roughly four times the reach, so a factor
// of two is a safe floor; the ceiling is half the short side, which no cell can
// beat by definition.
assert(bigInland.max > smallInland.max * 2 && bigInland.max <= 300 / 2 &&
  Math.abs(bigInland.land - smallInland.land) < 0.05,
  'the interior reaches further on a bigger grid (' + smallInland.max +
  ' -> ' + bigInland.max + ' cells from water)');

// The two sweeps are only worth the name if they compute what a breadth-first
// walk from the water computes. Do that walk here — a plain FIFO queue, four
// neighbours, seeded from every water cell — and compare cell by cell. A
// chamfer that drifted from the real distance still looks plausible on a small
// grid, so this runs on a wide one where the interior matters.
var bfsWorld = core.generate({seed: 'thousand isles', width: 200, height: 120});
var bfsN = bfsWorld.heightField.length;
var bfsWant = new Int32Array(bfsN).fill(-1);
var bfsQ = [];
for (var bi = 0; bi < bfsN; bi++) {
  if (bfsWorld.heightField[bi] < bfsWorld.seaLevel) {
    bfsWant[bi] = 0;
    bfsQ.push(bi);
  }
}
for (var bh = 0; bh < bfsQ.length; bh++) {
  var bq = bfsQ[bh];
  var bx2 = bq % bfsWorld.width, by2 = (bq / bfsWorld.width) | 0;
  var bn = [bx2 > 0 ? bq - 1 : -1, bx2 < bfsWorld.width - 1 ? bq + 1 : -1,
    by2 > 0 ? bq - bfsWorld.width : -1,
    by2 < bfsWorld.height - 1 ? bq + bfsWorld.width : -1];
  for (var bj = 0; bj < 4; bj++) {
    var bnn = bn[bj];
    if (bnn >= 0 && bfsWant[bnn] < 0) {
      bfsWant[bnn] = bfsWant[bq] + 1;
      bfsQ.push(bnn);
    }
  }
}
var bfsDiff = 0;
for (var bk = 0; bk < bfsN; bk++) {
  if (bfsWorld.coastDistance[bk] !== bfsWant[bk]) bfsDiff++;
}
assert(bfsQ.length > 0 && bfsDiff === 0,
  'the sweeps match a walk from the coast (' + bfsDiff + ' cells apart)');

// Overlays: every channel must be a real scalar rendering — some spread in
// the output, opaque, and reproducible — without disturbing the fields the
// readout depends on.
// Driven from the generator's own list, which is also what fills the dropdown
// and what `c` cycles. The first entry is the plain biome map, so it is
// skipped: it has no ramp to check.
var overlayKeys = core.channels.map(function (ch) { return ch.key; })
  .filter(function (k) { return k !== ''; });
// Exactly one entry — the first — means "no overlay", and no key may repeat:
// the dropdown and the `c` cycle both rely on that order.
var seenKeys = {};
var listOk = core.channels[0].key === '';
core.channels.forEach(function (ch, ci) {
  if (ci > 0 && !ch.key) listOk = false;
  if (seenKeys[ch.key]) listOk = false;
  seenKeys[ch.key] = 1;
});
assert(listOk && overlayKeys.length > 1,
  'overlay list starts at the plain biome map (' +
  core.channels.map(function (ch) { return ch.label; }).join(', ') + ')');
overlayKeys.forEach(function (name) {
  var chan = core.channelize(spread, name);
  var loC = 255, hiC = 0, badAlpha = 0;
  for (var cpi = 0; cpi < chan.data.length; cpi += 4) {
    var lum = chan.data[cpi] + chan.data[cpi + 1] + chan.data[cpi + 2];
    if (lum < loC) loC = lum;
    if (lum > hiC) hiC = lum;
    if (chan.data[cpi + 3] !== 255) badAlpha++;
  }
  var again = core.channelize(spread, name);
  var stable = again.data.length === chan.data.length;
  for (var cqi = 0; stable && cqi < chan.data.length; cqi++) {
    if (again.data[cqi] !== chan.data[cqi]) stable = false;
  }
  assert(chan.channel === name && hiC - loC > 40 && badAlpha === 0 && stable,
    name + ' overlay spans a ramp and repeats (' + loC + '..' + hiC + ')');
});

// The lake ramp is the one field that keeps its own scale: a mask of 1..60
// steps, where most of the grid is dry and reads as zero. Percentiles would
// collapse that to one colour — the 98% mark of a world with a handful of
// small tarns is still zero — so the filled cells have to be distinguishable
// from each other while the scale stays the mask's own range.
var tarns = core.generate({seed: 'salt mirror', width: 120, height: 80});
var tarnChan = core.channelize(tarns, 'lake');
var tarnLo = 255, tarnHi = 0, tarnCells = 0;
for (var tli = 0; tli < tarns.lakeMask.length; tli++) {
  if (!tarns.lakeMask[tli]) continue;
  tarnCells++;
  var tLum = tarnChan.data[tli * 4] + tarnChan.data[tli * 4 + 1] +
    tarnChan.data[tli * 4 + 2];
  if (tLum < tarnLo) tarnLo = tLum;
  if (tLum > tarnHi) tarnHi = tLum;
}
assert(tarnCells > 0 && tarnCells < tarns.lakeMask.length / 4 &&
  tarnHi - tarnLo > 40 && tarns.channelScale.lo === 0 &&
  tarns.channelScale.hi === 60,
  'lake depth keeps its own scale (' + tarnCells + ' filled cells, ' +
  tarnLo + '..' + tarnHi + ')');

// That range is one number in the core rather than a literal in three places:
// the mask is written with it, the `lake` overlay scales by it, and the readout
// divides by it. The constant is the cap the mask saturates against, so every
// filled cell must land inside 1..the constant — a shallow tarn tops out below
// it, which is fine — while the overlay's published scale is that same number
// rather than a second cap. The shell reads it from the core instead of
// repeating a bare number next to its own division.
var stepsConst = core.lakeSteps;
var stepsTop = 0, stepsLow = Infinity;
for (var sli = 0; sli < tarns.lakeMask.length; sli++) {
  if (!tarns.lakeMask[sli]) continue;
  if (tarns.lakeMask[sli] > stepsTop) stepsTop = tarns.lakeMask[sli];
  if (tarns.lakeMask[sli] < stepsLow) stepsLow = tarns.lakeMask[sli];
}
// Read the shell directly: the shared `appSrc` string is not populated until
// much later in this file.
var stepsLiterals = (require('fs').readFileSync(__dirname + '/../app.js', 'utf8')
  .match(/\/ 60 \* 100/g) || []).length;
assert(stepsConst === tarns.channelScale.hi && stepsTop <= stepsConst &&
  stepsLow >= 1 && stepsTop > stepsLow && stepsLiterals === 0,
  'one constant is the whole lake depth range (' + stepsLow + '..' + stepsTop +
  ', ' + stepsLiterals + ' literal divides)');

// Heights are stored 0..1 and printed out of a hundred, in the stats rows and
// in the chart labels. Both go through one helper, so `median 49` in the list
// and `median 49` under the bars are the same measurement. Checked as text: one
// definition, several uses, and no leftover inline `* 100` rounding beside it.
var hundredSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
var hundredDefs = (hundredSrc.match(/function hundred\(/g) || []).length;
var hundredCalls = (hundredSrc.match(/hundred\(/g) || []).length - hundredDefs;
var hundredInline = (hundredSrc.match(
  /Math\.round\((?:s\.|lo|hi|result\.stats|from|to|result\.seaLevel)[^)]*\* 100\)/g
  ) || []).length;
assert(hundredDefs === 1 && hundredCalls >= 5 && hundredInline === 0,
  'one helper scales every printed height (' + hundredDefs + ' def, ' +
  hundredCalls + ' uses, ' + hundredInline + ' inline)');

// The readout prints the overlay's own ramp position, so it has to agree with
// the pixels: the colour under the cursor must be the palette pair lerped by
// exactly that number. Checked on the log-scaled field, whose raw values are
// furthest from what the ramp shows.
var rampChan = core.channelize(spread, 'drain');
var rampLo = spread.palette.colors.beach, rampHi = spread.palette.colors.rock;
var rampWorst = 0;
for (var rpi = 0; rpi < 400; rpi++) {
  var rc = (rpi * 37) % (spread.width * spread.height);
  var rt = core.channelValue(spread, rc);
  var ro = rc * 4;
  for (var rcn = 0; rcn < 3; rcn++) {
    var want = rampLo[rcn] + (rampHi[rcn] - rampLo[rcn]) * rt;
    var diff = Math.abs(want - rampChan.data[ro + rcn]);
    if (diff > rampWorst) rampWorst = diff;
  }
}
assert(rampWorst <= 1,
  'overlay readout matches the rendered ramp (worst ' +
  rampWorst.toFixed(2) + ' of 255)');

// Every ramp has to answer with a position in 0..1, on every field it reads:
// the readout prints that number directly, so a value outside the ramp would
// show a percentage no colour on screen can match. Each overlay also records
// the scale it was built from, which is what a hover then reuses instead of
// sorting the field again.
core.channels.forEach(function (oc) {
  core.channelize(spread, oc.key);
  var sc = spread.channelScale;
  var inRange = !!sc && sc.hi > sc.lo;
  for (var oi2 = 0; inRange && oi2 < spread.width * spread.height; oi2 += 7) {
    var ov = core.channelValue(spread, oi2);
    if (!(ov >= 0 && ov <= 1)) inRange = false;
  }
  assert(inRange, (oc.key || 'biome') + ' readout stays inside its ramp (' +
    sc.key + ' ' + sc.lo.toFixed(3) + '..' + sc.hi.toFixed(3) + ')');
});

// An unknown overlay name must still render something sensible rather than an
// empty buffer: the hash can carry a key from an older build.
var fallback = core.channelize(spread, 'no-such-ramp');
assert(fallback.channel === 'relief' && fallback.data.length === spread.data.length,
  'an unknown overlay falls back to relief (' + fallback.channel + ')');

// Each ramp has to be a picture of its own: two overlays that render the same
// pixels would make one of the dropdown entries pointless, and the empty key —
// the plain biome map — is deliberately not a ramp at all, so the buffer it
// leaves behind is the one generate() built. Only the named ramps are compared.
var rampSeen = {};
var rampDistinct = true;
core.channels.forEach(function (dc) {
  if (!dc.key) return;
  var dr = core.generate({seed: 'pale shelf', width: 120, height: 80});
  var dim = core.channelize(dr, dc.key);
  var dig = '';
  for (var dpi = 0; dpi < dim.data.length; dpi += 4) {
    dig += dim.data[dpi] + ',' + dim.data[dpi + 1] + ',' + dim.data[dpi + 2] + ';';
  }
  if (rampSeen[dig]) rampDistinct = false;
  rampSeen[dig] = dc.key;
});
var plainRamp = core.generate({seed: 'pale shelf', width: 120, height: 80});
var untouched = core.channelize(plainRamp, '');
assert(rampDistinct && Object.keys(rampSeen).length === core.channels.length - 1 &&
  untouched.channel === 'relief',
  'each ramp is its own picture, empty key means relief (' +
  Object.keys(rampSeen).length + ')');

// `slope` is the one field built by the lookup rather than by generate, so its
// definition is worth pinning: the steepest of the four neighbour differences,
// never an average. Recomputed here by hand on sampled cells, which also
// catches a field that would drift into smoothing the relief away.
core.channelize(spread, 'slope');
var spSlope = spread.slopeField;
var spW = spread.width, spH = spread.height, spHf = spread.heightField;
var slopeOk = !!spSlope && spSlope.length === spW * spH;
for (var sy = 0; slopeOk && sy < spH; sy += 3) {
  for (var sx = 0; slopeOk && sx < spW; sx += 7) {
    var si = sy * spW + sx;
    var sBest = Math.abs(spHf[si] - spHf[sx > 0 ? si - 1 : si]);
    if (sx + 1 < spW) sBest = Math.max(sBest, Math.abs(spHf[si] - spHf[si + 1]));
    if (sy > 0) sBest = Math.max(sBest, Math.abs(spHf[si] - spHf[si - spW]));
    if (sy + 1 < spH) sBest = Math.max(sBest, Math.abs(spHf[si] - spHf[si + spW]));
    if (Math.abs(spSlope[si] - sBest) > 1e-5) slopeOk = false;
  }
}
assert(slopeOk, 'slope is the steepest neighbour difference');

// The overlay reads the fields rather than the colour buffer, so the biome
// classification underneath is untouched.
assert(spread.biome.length === spread.width * spread.height &&
  spread.moisture.length === spread.biome.length &&
  spread.accumulation.length === spread.biome.length,
  'scalar fields are exported at grid size');

// A pinned grid must behave like the auto one: because the river cut is a
// quantile of the accumulation field, the share of the grid carrying a channel
// should stay in the same band when only the size changes.
var smallGrid = core.generate({ seed: 'aurora basin', width: 120, height: 80, rivers: 120 });
var bigGrid = core.generate({ seed: 'aurora basin', width: 480, height: 320, rivers: 120 });
var smallShare = smallGrid.stats.rivers / smallGrid.stats.pixels;
var bigShare = bigGrid.stats.rivers / bigGrid.stats.pixels;
assert(Math.abs(smallShare - bigShare) < 0.04,
  'river density holds across grid sizes (' + (smallShare * 100).toFixed(1) + '% vs ' +
  (bigShare * 100).toFixed(1) + '%)');

// The same quantile cut is what makes the `rivers` slider behave: each step up
// keeps a larger share of the network, on the same grid, so the figure in the
// sentence moves in one direction only. Walked over the slider's own range —
// a step that ever went backwards would make the control unreadable, and a
// second threshold with its own scale is how that happens.
var slidePrev = -1, slideOk = true, slideLast = 0;
[0, 40, 90, 150, 240, 400].forEach(function (rv) {
  var sw2 = core.generate({seed: 'red ridge', width: 120, height: 80, rivers: rv});
  var share = sw2.stats.rivers / sw2.stats.pixels;
  if (share < slidePrev || share > 0.20) slideOk = false;
  slidePrev = share;
  slideLast = sw2.stats.rivers;
});
assert(slideOk && slideLast > 0,
  'the rivers slider only ever widens the network (' +
  (slidePrev * 100).toFixed(1) + '% at the top of the range)');

// The `rivers` row prints BOTH halves of that network — `19 tri / 4 trunk` —
// and the two come from one field at two quantiles, so a slider step has to
// widen them together. A trunk share that could fall while the total rose would
// mean the second cut had its own scale, and the row would read as a
// contradiction: more water drawn, less of it a main channel. Checked as a
// monotone pair plus the subset relation the row already implies.
var triPrev = -1, trunkPrev = -1, pairOk = true, pairSteps = 0;
[0, 40, 90, 150, 240, 400].forEach(function (rv) {
  var pw2 = core.generate({seed: 'red ridge', width: 120, height: 80, rivers: rv});
  var px = pw2.stats.pixels;
  var tri = (pw2.stats.rivers - pw2.stats.trunks) / px;
  var trunk = pw2.stats.trunks / px;
  if (tri < triPrev || trunk < trunkPrev || trunk > tri) pairOk = false;
  triPrev = tri; trunkPrev = trunk; pairSteps++;
});
assert(pairOk && pairSteps === 6,
  'both halves of the rivers row widen together (' +
  Math.round(triPrev * 100) + ' tri / ' + Math.round(trunkPrev * 100) + ' trunk)');

// The summary sentence is shared by the page and the CLI, so it must name the
// shape, the dominant class and stay identical for the same seed.
var said = core.describe(a);
assert(said === core.describe(core.generate({ seed: 'aurora basin', width: 200, height: 120 })) &&
  said.indexOf('continents') === 0 &&
  /land/.test(said) && said.length > 20,
  'summary sentence is stable (' + said + ')');

// The numbers inside that sentence have to be the ones in stats, so a reader
// can trust the words next to the sidebar rows: the land share and the basin
// count are pulled out of the string and compared with the record.
var saidRec = core.generate({seed: 'salt mirror', width: 160, height: 100});
var saidText = core.describe(saidRec);
var saidLand = parseInt(/(\d+)% land/.exec(saidText)[1], 10);
var saidLakes = parseInt(/(\d+) lakes?/.exec(saidText)[1], 10);
assert(saidLand === Math.round(saidRec.stats.land * 100) &&
  saidLakes === saidRec.stats.lakeBasins,
  'summary numbers match the stats (' + saidLand + '%, ' + saidLakes + ' lakes)');

// The drainage figure in the same sentence is a share of the grid rather than
// a cell count, so it has to come from the same pair the `rivers` row uses.
// Both halves are checked: the number in the string, and the fact that the
// formatter behind it is the one the legend and the CLI record already use —
// a second rounding here would put two different wetness figures on one page.
var saidDrain = /([\d.]+)% drained/.exec(saidText);
var drainWant = core.percentText(saidRec.stats.rivers / saidRec.stats.pixels);
assert(!!saidDrain && saidDrain[1] + '%' === drainWant,
  'the sentence counts drainage as a share (' +
  (saidDrain ? saidDrain[1] + '%' : 'nothing') + ' vs ' + drainWant + ')');

// The relief word and the number in brackets are two views of one difference,
// so they must agree: the word is a bucket of the number, and the number is
// the relief in stats. A sentence that says `plain (88)` would be a bug in the
// bucket list rather than in the field, which is why both come from `s`.
core.shapes.forEach(function (rw) {
  var rWorld = core.generate({seed: 'red ridge', shape: rw.key, width: 140, height: 90});
  var rText = core.describe(rWorld);
  var rMatch = /(rugged|rolling|plain) \((\d+)\)/.exec(rText);
  var rNum = parseInt(rMatch[2], 10);
  var rWant = rNum > 70 ? 'rugged' : rNum > 40 ? 'rolling' : 'plain';
  assert(rMatch[1] === rWant &&
    rNum === Math.round((rWorld.stats.max - rWorld.stats.min) * 100),
    rw.key + ' relief word matches its number (' + rMatch[0] + ')');
});

// The legend prints one row per class with its share of the grid, so the
// counts behind those rows have to add up: every cell is in exactly one class,
// no class is listed with an empty share, and the class the sentence calls
// dominant really is the biggest one.
['aurora basin', 'salt mirror', 'thousand isles', 'red ridge'].forEach(function (ls) {
  var lw = core.generate({seed: ls, width: 180, height: 110});
  var total = 0, filled = 0, topKey = '', topN = 0;
  Object.keys(lw.stats.counts).forEach(function (ck) {
    total += lw.stats.counts[ck];
    if (lw.stats.counts[ck] > 0) filled++;
    if (lw.stats.counts[ck] > topN) { topN = lw.stats.counts[ck]; topKey = ck; }
  });
  // The sentence lists the dominant class by its display name, which can be
  // two words ("Deep water"), so the capture runs to the next separator.
  var saidTop = /mostly ([^·]+)/.exec(core.describe(lw))[1].replace(/\s+$/, '');
  assert(total === lw.stats.pixels && filled === Object.keys(lw.stats.counts).length &&
    saidTop === core.biomeNames[topKey],
    ls + ' legend shares account for the whole grid (' + total + ' of ' +
    lw.stats.pixels + ', mostly ' + saidTop + ')');
});

// The two optional tails of the sentence are conditions rather than counts, so
// each has to appear exactly when its own test passes: `N lakes` only when the
// world has standing water, `polar` only once the ice share is visible. A
// sentence that lies about either is worse than one that stays silent.
core.shapes.forEach(function (sp) {
  var sw = core.generate({seed: 'pale shelf', shape: sp.key, width: 160, height: 100});
  var st = core.describe(sw);
  var lakeWanted = (sw.stats.counts.lake || 0) > 0;
  var polarWanted = sw.stats.ice > 0.02;
  assert(st.indexOf(sw.shape) === 0 &&
    /\d+ lakes?\b/.test(st) === lakeWanted &&
    /polar\b/.test(st) === polarWanted,
    sp.key + ' sentence only says what is true (' + st + ')');
});

// Every hand-picked phrase is rendered by the `p` key and printed by the CLI,
// so each one has to produce a whole sentence on every shape it can be paired
// with: four fields at minimum, a land share that matches the stats, and a
// dominant class after `mostly` that is a real biome name rather than an empty
// capture or a raw key. A phrase that renders a hollow sentence is worse than
// one that is not in the list at all.
var saidOk = true;
core.phrases.forEach(function (ph) {
  core.shapes.forEach(function (phShape) {
    var pw = core.generate({seed: ph, shape: phShape.key, width: 160, height: 100});
    var ps = core.describe(pw);
    var pParts = ps.split(' · ');
    var pLand = /^(\d+)% land$/.exec(pParts[2]);
    var pTop = /^mostly (.+)$/.exec(pParts[3]);
    if (pParts.length < 4 || !pLand || !pTop ||
      Number(pLand[1]) !== Math.round(pw.stats.land * 100) ||
      Object.keys(core.biomeNames).map(function (bk) {
        return core.biomeNames[bk];
      }).indexOf(pTop[1]) < 0 ||
      ps.indexOf(pw.shape) !== 0) saidOk = false;
  });
});
assert(saidOk, 'every phrase writes a full sentence on every shape');

// Every class the lookup can name has to turn up somewhere in those worlds:
// a key with no cells is a dead entry in the palette table and a row the
// legend can never show. Walked from both lists, so a new class or a new
// curve is covered without editing this file.
var touched = {};
core.phrases.forEach(function (tc) {
  core.shapes.forEach(function (ts) {
    var tw = core.generate({seed: tc, shape: ts.key, width: 160, height: 100});
    Object.keys(tw.stats.counts).forEach(function (tk) { touched[tk] = 1; });
  });
});
var neverSeen = Object.keys(core.biomeNames).filter(function (nk) {
  return !touched[nk];
});
assert(neverSeen.length === 0,
  'every biome class appears on some world (' +
  Object.keys(touched).length + ' of ' + Object.keys(core.biomeNames).length + ')');

// The phrase list is what the `p` key walks, so each entry has to be a
// different world rather than a near-copy of the last: distinct checksums at
// one grid, and a land share that stays in the middle band so no phrase is a
// water world or a single continent with nothing around it. A phrase that
// fails either test is not worth a slot in the cycle.
var seenSum = {}, phraseOk = true;
core.phrases.forEach(function (ph) {
  var pr = core.generate({seed: ph, width: 160, height: 100});
  if (seenSum[pr.stats.checksum]) phraseOk = false;
  seenSum[pr.stats.checksum] = true;
  if (!(pr.stats.land > 0.35 && pr.stats.land < 0.75)) phraseOk = false;
});
assert(phraseOk && Object.keys(seenSum).length === core.phrases.length,
  'each phrase is its own middle-of-the-road world (' +
  Object.keys(seenSum).length + ')');

// A pushed climate is the one knob that reliably crosses the ice threshold, so
// at least one sentence has to grow the `polar` tail rather than every world
// sitting under it. Same rule as above, checked from the other side.
// The ice share is a fraction of the grid, so a smaller world on the same
// phrase is the cheapest way past the threshold.
var icy = core.generate({seed: 'aurora basin', width: 60, height: 40, polar: 1});
assert(icy.stats.ice > 0.02 && /polar\b/.test(core.describe(icy)),
  'a cold world says so in its sentence (' + core.describe(icy) + ')');

// The basin tail is the only place the sentence inflects, so the plural has to
// follow the count it prints: one basin reads `1 lake`, any other number
// pluralises. Both shapes are checked here because the sentence is printed by
// the sidebar and the CLI from the same string.
[icy, saidRec].forEach(function (pl) {
  var plText = core.describe(pl);
  var plMatch = /(\d+) lakes?\b/.exec(plText);
  var plN = parseInt(plMatch[1], 10);
  assert(plN === pl.stats.lakeBasins &&
    plMatch[0] === plN + ' lake' + (plN === 1 ? '' : 's'),
    'basin tail agrees with its own count (' + plMatch[0] + ')');
});

// The checksum is the short form of "identical pixels": it must match for a
// repeat of the same seed and differ for another one, without anyone having
// to compare the RGBA buffer by hand.
assert(/^[0-9a-f]{8}$/.test(a.stats.checksum) &&
  a.stats.checksum === b.stats.checksum &&
  a.stats.checksum !== c.stats.checksum,
  'pixel checksum identifies a world (' + a.stats.checksum + ')');

// The Reroll button chains from the current seed instead of drawing a fresh
// random one, so a shared link replays the same sequence of worlds. Two walks
// of five steps from the same phrase must agree, and each step must be a
// different world from the one before it.
function chain(seed) {
  var out = [];
  for (var s = seed, k = 0; k < 4; k++) { s = core.nextSeed(s); out.push(s); }
  return out;
}
var walkA = chain('aurora basin');
var walkB = chain('aurora basin');
assert(walkA.join(',') === walkB.join(',') &&
  walkA.every(function (v, k) { return v === walkB[k]; }) &&
  new Set(walkA).size === walkA.length,
  'reroll chain is reproducible and never repeats (' + walkA[0] + ')');
var chainWorld = core.generate({ seed: String(walkA[0]), width: 120, height: 80 });
assert(/^[0-9a-f]{8}$/.test(chainWorld.stats.checksum),
  'a chained seed renders a world (' + chainWorld.stats.checksum + ')');

// Pressing Reroll repeatedly has to keep producing worlds rather than cycling
// back onto an earlier one, so a longer walk is checked on pixels instead of
// on the seed strings: twelve chained seeds must give twelve pictures, and the
// land shares have to move around rather than pin to one value.
var runSum = {};
var runLand = {};
for (var rs = 'red ridge', rk = 0; rk < 12; rk++) {
  var runWorld = core.generate({seed: String(rs), width: 120, height: 80});
  runSum[runWorld.stats.checksum] = 1;
  runLand[Math.round(runWorld.stats.land * 100)] = 1;
  rs = core.nextSeed(rs);
}
assert(Object.keys(runSum).length === 12 && Object.keys(runLand).length >= 6,
  'a reroll walk keeps making new worlds (' + Object.keys(runSum).length +
  ' worlds, ' + Object.keys(runLand).length + ' land shares)');

// The CLI prints the same chain the button walks, so a phrase found in the
// browser can be replayed from a terminal. Both go through nextSeed, which is
// the only place the derivation is defined.
var cli = require('child_process')
  .execSync('node cli.js "aurora basin" --next 5', {cwd: __dirname + '/..'}).toString().trim().split('\n');
assert(cli.length === 5 && cli[0] === 'aurora basin' &&
  cli.slice(1).join(',') === walkA.join(','),
  'cli --next matches the button chain (' + cli[1] + ')');

// The same chain with --describe has to keep both halves of each line: the
// seed first, then the sentence that seed renders. That pairing is the whole
// point of the combination — a block of sentences is only traceable if every
// line still names the phrase it came from.
var nextSaid = require('child_process')
  .execSync('node cli.js "salt mirror" --next 3 --describe ' +
    '--width 60 --height 40', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var nextPairs = ['salt mirror'];
for (var nn = 1; nn < 3; nn++) {
  nextPairs.push(String(core.nextSeed(nextPairs[nn - 1])));
}
var nextOk = nextSaid.length === nextPairs.length;
nextPairs.forEach(function (np, ni) {
  var line = nextSaid[ni] || '';
  if (line.indexOf(np + '  ') !== 0 || !/\(\d+\)/.test(line)) nextOk = false;
});
assert(nextOk,
  'cli --next --describe pairs each seed with its sentence (' + nextPairs.length + ')');

// The chain is also readable as records, which is how to compare a run of
// clicks without opening the page. Each record must carry the seed of its own
// line in the plain listing, and each must be a different world — a chain that
// collapsed onto one picture would make the Reroll button pointless.
var nextJson = require('child_process')
  .execSync('node cli.js "salt mirror" --next 3 --json --width 40 --height 24 ' +
    '--out next-json.ppm', {cwd: __dirname + '/..'}).toString().trim().split('\n')
  .map(function (line) { return JSON.parse(line); });
var nextSeedOk = nextJson.length === nextPairs.length;
var nextSums = {};
nextJson.forEach(function (rec, ri) {
  if (rec.seed !== nextPairs[ri]) nextSeedOk = false;
  nextSums[rec.checksum] = 1;
});
assert(nextSeedOk && Object.keys(nextSums).length === nextJson.length,
  'cli --next --json records the whole chain (' + nextJson.length +
  ' records, ' + Object.keys(nextSums).length + ' distinct)');

// The same chain asked for as text profiles has to keep the pairing too: one
// block per seed, each caption ending in the checksum of that seed's record.
// That is the only way a pasted block of bars can be traced back to a line of
// JSON, and it holds only because every branch builds its world the same way.
var nextHist = require('child_process')
  .execSync('node cli.js "salt mirror" --next 3 --hist --width 40 --height 24',
    {cwd: __dirname + '/..'}).toString().trim().split('\n');
var nextHistOk = true;
nextPairs.forEach(function (np, ni) {
  var from = nextHist.indexOf(np);
  var to = ni + 1 < nextPairs.length ? nextHist.indexOf(nextPairs[ni + 1])
    : nextHist.length;
  if (from === -1 || to <= from) { nextHistOk = false; return; }
  var block = nextHist.slice(from, to).join('\n');
  if (block.indexOf('- ' + nextJson[ni].checksum) === -1) nextHistOk = false;
});
assert(nextHistOk,
  'cli --next --hist keeps one caption per seed (' + nextHist.length + ' lines)');
// A one-sided grid has to reach every branch, not only the per-seed loop: the
// chain builds its worlds through its own option copies, so a derivation done
// inside one form would leave the other forms with the plain default height.
// Each record of a chain asked for by `--width` alone must therefore carry the
// same derived pair as the first, over three different worlds.
var nextAspect = require('child_process')
  .execSync('node cli.js "salt mirror" --next 3 --json --width 100 ' +
    '--out next-aspect.ppm', {cwd: __dirname + '/..'}).toString().trim().split('\n')
  .map(function (line) { return JSON.parse(line); });
var nextAspectBad = [];
var chainAspect = 480 / 300;
nextAspect.forEach(function (rec) {
  if (rec.width !== 100 || Math.abs(rec.width / rec.height - chainAspect) > 0.06) {
    nextAspectBad.push(rec.seed + ' ' + rec.width + 'x' + rec.height);
  }
});
assert(nextAspectBad.length === 0 && nextAspect.length === nextPairs.length,
  'a chain shares the grid its flags asked for (' + nextAspect.length +
  ' records, off at ' + nextAspectBad.join('; ') + ')');
// The two chain forms have to describe the same bars. Each block is drawn over
// the column count its own record publishes, and that record's counts have to
// fill its own grid exactly. Checked per seed rather than once, since a chain
// that copied one world's histogram into every record would still pass a
// single comparison — and the copied record would then describe a different
// silhouette than the one printed above it.
var chainBarBad = [];
nextPairs.forEach(function (np, ni) {
  var cfrom = nextHist.indexOf(np);
  var cto = ni + 1 < nextPairs.length ? nextHist.indexOf(nextPairs[ni + 1])
    : nextHist.length;
  var cblock = nextHist.slice(cfrom, cto)
    .map(function (l) { return l.replace(/\r$/, ''); })
    .filter(function (l) { return l.length; });
  var cruler = cblock[cblock.length - 2] || '';
  var crec = nextJson[ni];
  var csum = crec.hist.reduce(function (a, b) { return a + b; }, 0);
  if (cruler.length !== crec.bins || crec.hist.length !== crec.bins ||
    csum !== crec.width * crec.height) {
    chainBarBad.push(np + ' ' + cruler.length + '/' + crec.bins + ' sum ' + csum);
  }
});
assert(chainBarBad.length === 0,
  'each chain block is drawn over its own record (' +
  chainBarBad.join('; ') + ')');
// The caption of each chain block is compared with its own record too, since
// the chain builds its worlds through a helper the plain listing never uses.
// Two renders per seed: the record keeps `sea` and `median` to three decimals
// and the caption prints both out of a hundred, so the caption's rounding is
// applied before comparing. A chain that built one world and copied it into
// every seed would already fail the pair above; this catches a chain whose
// blocks and records disagree about where the sea sits.
var chainCapBad = [];
nextPairs.forEach(function (cp2, ci2) {
  var c2from = nextHist.indexOf(cp2);
  var c2to = ci2 + 1 < nextPairs.length ? nextHist.indexOf(nextPairs[ci2 + 1])
    : nextHist.length;
  var c2lines = nextHist.slice(c2from, c2to)
    .map(function (l) { return l.replace(/\r$/, ''); })
    .filter(function (l) { return l.length; });
  var c2cap = c2lines[c2lines.length - 1] || '';
  var c2rec = nextJson[ci2];
  var c2ends = /^(\d+) \.\. (\d+) relief/.exec(c2cap);
  var c2sea = /sea (\d+)/.exec(c2cap);
  var c2med = /median (\d+)/.exec(c2cap);
  if (!c2ends || !c2sea || !c2med ||
    Number(c2ends[1]) !== c2rec.low || Number(c2ends[2]) !== c2rec.high ||
    Number(c2sea[1]) !== Math.round(c2rec.sea * 100) ||
    Number(c2med[1]) !== Math.round(c2rec.median * 100) ||
    c2cap.indexOf(c2rec.checksum) < 0) {
    chainCapBad.push(cp2 + ' -> ' + c2cap);
  }
});
assert(chainCapBad.length === 0 && nextPairs.length >= 3,
  'each chain caption repeats its own record (' + nextPairs.length +
  ' seeds, off at ' + chainCapBad.join('; ') + ')');

// The tallest-bar figure has to be the tallest bar of its own array, per seed.
// `bins` and the sum only fix how many columns there are and how much ink they
// hold between them, so a record that kept one `peak` for the whole chain would
// still pass those while printing every silhouette at the wrong height: the
// profile divides each count by that number. Re-derived from each record's own
// array rather than from a fresh render, since the pair under test is the two
// halves of one record.
var chainPeakBad = [];
nextJson.forEach(function (pr, pi) {
  var top = 0;
  for (var pk = 0; pk < pr.hist.length; pk++) {
    if (pr.hist[pk] > top) top = pr.hist[pk];
  }
  if (pr.peak !== top) chainPeakBad.push(pr.seed + ' ' + pr.peak + '/' + top);
});
assert(chainPeakBad.length === 0 && nextJson.length >= 3,
  'each chain record peaks at its own tallest bar (' +
  chainPeakBad.join('; ') + ')');

// The ruler above each block has to be placed by that seed's own two columns as
// well. The caption already names the sea level and the median, so a chain that
// drew every ruler from the FIRST world's pair would still print five plausible
// captions — and the one mark a reader places by hand would sit in the wrong
// column for four of them. Counted per seed, with the same combined-glyph rule
// the single-world ruler follows.
var chainRulerBad = [];
nextPairs.forEach(function (rp2, ri2) {
  var r2from = nextHist.indexOf(rp2);
  var r2to = ri2 + 1 < nextPairs.length ? nextHist.indexOf(nextPairs[ri2 + 1])
    : nextHist.length;
  var r2lines = nextHist.slice(r2from, r2to)
    .map(function (l) { return l.replace(/\r$/, ''); })
    .filter(function (l) { return l.length; });
  var r2ruler = r2lines[r2lines.length - 2] || '';
  var r2rec = nextJson[ri2];
  var r2one = r2rec.seaCol === r2rec.medCol;
  if (r2ruler.charAt(r2rec.seaCol) !== (r2one ? '+' : '|') ||
    (!r2one && r2ruler.charAt(r2rec.medCol) !== ':') ||
    r2ruler.replace(/-/g, '').length !== (r2one ? 1 : 2)) {
    chainRulerBad.push(rp2 + ' ' + r2rec.seaCol + '/' + r2rec.medCol);
  }
});
assert(chainRulerBad.length === 0,
  'each chain ruler marks its own two columns (' +
  chainRulerBad.join('; ') + ')');

// `--json` is the pipeable form, so the profile block has to stay out of it
// even when both flags are given: one line per world, each a whole record.
// That is what lets a chain be read by `Select-String` or `jq` without first
// stripping a block of bars out of the middle.
var jsonHist = require('child_process')
  .execSync('node cli.js "salt mirror" "aurora basin" --json --hist ' +
    '--width 40 --height 24 --out json-hist.ppm',
    {cwd: __dirname + '/..'}).toString().trim().split('\n');
var jsonHistOk = jsonHist.length === 2;
jsonHist.forEach(function (line) {
  if (!/^\{.*\}$/.test(line)) jsonHistOk = false;
});
assert(jsonHistOk,
  'cli --json keeps the profile block out of the record (' +
  jsonHist.length + ' lines)');

// The palette keys the CLI lists must be the ones the generator knows, so a
// name copied from the terminal is guaranteed to be accepted by --palette.
var listed = require('child_process')
  .execSync('node cli.js --palettes', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var listedNames = listed.map(function (line) { return line.split(/\s+/)[0]; });
var coreNames = Object.keys(core.palettes);
assert(listed.length === coreNames.length &&
  listedNames.join(',') === coreNames.join(','),
  'cli --palettes lists every palette (' + listedNames.length + ')');

// Same check for the shape curves: the dropdown, --shape and this list all
// read TerraCore.shapes, so a key printed in a terminal must be one the
// generator accepts.
var shapeList = require('child_process')
  .execSync('node cli.js --shapes', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var shapeNames = shapeList.map(function (line) { return line.split(/\s+/)[0]; });
var coreShapes = core.shapes.map(function (s) { return s.key; });
assert(shapeList.length === coreShapes.length &&
  shapeNames.join(',') === coreShapes.join(','),
  'cli --shapes lists every shape (' + shapeNames.length + ')');

// And the same for the overlay ramps, including the empty key that means the
// plain biome map: the CLI prints it as "biome", so the printed column still
// lines up with what --channel accepts.
var chanList = require('child_process')
  .execSync('node cli.js --channels', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var chanNames = chanList.map(function (line) { return line.split(/\s+/)[0]; });
var coreChannels = core.channels.map(function (c) { return c.key || 'biome'; });
assert(chanList.length === coreChannels.length &&
  chanNames.join(',') === coreChannels.join(','),
  'cli --channels lists every overlay (' + chanNames.length + ')');

// The hand-picked phrases are a list too, and each one must actually render:
// a phrase in that list is a suggestion, so a dead or degenerate one would be
// a bad first impression. The CLI numbering is checked alongside the phrases.
var phraseOut = require('child_process')
  .execSync('node cli.js --phrases', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var phraseNames = phraseOut.map(function (line) {
  return line.replace(/^\s*\d+\s+/, '');
});
var phraseOk = phraseOut.length === core.phrases.length &&
  phraseNames.join(',') === core.phrases.join(',');
core.phrases.forEach(function (p) {
  var r = core.generate({seed: p, width: 60, height: 40});
  if (!(r.stats.land > 0.02 && r.stats.water > 0.02)) phraseOk = false;
});
assert(phraseOk,
  'cli --phrases lists phrases that each render a world (' + phraseNames.length + ')');

// The pinned column counts are a shared list too: the grid dropdown, the `w`
// key and --width all read core.grids, so every count printed by the CLI must
// be one the generator accepts as a width.
var gridList = require('child_process')
  .execSync('node cli.js --grids', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var gridNames = gridList.map(function (line) { return line.split(/\s+/)[0]; });
var coreGrids = core.grids.map(function (gr) { return gr.key || 'auto'; });
assert(gridList.length === coreGrids.length &&
  gridNames.join(',') === coreGrids.join(','),
  'cli --grids lists every column count (' + gridNames.length + ')');
var gridOk = true;
core.grids.forEach(function (gr) {
  if (!gr.key) return;
  var g = core.generate({seed: 'pale shelf', width: parseInt(gr.key, 10), height: 150});
  if (g.width !== parseInt(gr.key, 10)) gridOk = false;
});
assert(gridOk, 'every pinned column count renders at that width');

// The export multipliers are the sixth shared list: the dropdown, the `e` key
// and --scale all read core.scales, so each multiplier printed by the CLI must
// enlarge a render by exactly that factor.
var scaleList = require('child_process')
  .execSync('node cli.js --scales', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var scaleNames = scaleList.map(function (line) { return line.split(/\s+/)[0]; });
var coreScales = core.scales.map(function (sc) { return sc.key; });
assert(scaleList.length === coreScales.length &&
  scaleNames.join(',') === coreScales.join(','),
  'cli --scales lists every export multiplier (' + scaleNames.length + ')');
var scaleOk = true;
core.scales.forEach(function (sc) {
  var n = parseInt(sc.key, 10);
  var small = core.generate({seed: 'pale shelf', width: 20, height: 12});
  var big = core.upscale(small, n);
  // Growing has to be plain replication at every multiplier the dropdown
  // offers, not just at the one a block check happens to use: a factor that
  // averaged its neighbours would still report the right dimensions while
  // saving a softer picture than the one on screen. Walk each cell's block.
  if (big.width !== small.width * n || big.height !== small.height * n) scaleOk = false;
  for (var sy = 0; sy < small.height && scaleOk; sy++) {
    for (var sx = 0; sx < small.width && scaleOk; sx++) {
      var src = (sy * small.width + sx) * 4;
      for (var oy = 0; oy < n && scaleOk; oy++) {
        for (var ox = 0; ox < n; ox++) {
          var dst = ((sy * n + oy) * big.width + sx * n + ox) * 4;
          for (var oc = 0; oc < 4; oc++) {
            if (big.data[dst + oc] !== small.data[src + oc]) scaleOk = false;
          }
        }
      }
    }
  }
});
assert(scaleOk, 'every export multiplier upscales by that factor');

// The same list seen from a terminal: each multiplier has to say so in its own
// record, and must not disturb a single count on the way. That is the pair of
// facts behind the `export` row in the sidebar — the factor is the only thing
// a saved file gains from it.
var scalePlain = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 40 --height 24 --json ' +
    '--out scale-plain.ppm', {cwd: __dirname + '/..'}).toString().trim());
var scaleDrift = [];
core.scales.forEach(function (sc) {
  var rec = JSON.parse(require('child_process')
    .execSync('node cli.js "salt mirror" --width 40 --height 24 --scale ' +
      sc.key + ' --json --out scale-' + sc.key + '.ppm',
      {cwd: __dirname + '/..'}).toString().trim());
  if (rec.scale !== parseInt(sc.key, 10)) scaleDrift.push(sc.key + '!=' + rec.scale);
  if (rec.checksum !== scalePlain.checksum) scaleDrift.push(sc.key + ' pixels');
  if (rec.rivers !== scalePlain.rivers) scaleDrift.push(sc.key + ' rivers');
});
assert(scaleDrift.length === 0,
  'every export multiplier reports itself and moves no count (' +
  scaleDrift.join(', ') + ')');

// Every one of those listings is read in a terminal, where the dropdown's
// label is not there to explain a key. So each line has to carry a note after
// its key rather than a bare column of words — a key with nothing beside it
// forces a reader back to the source to find out what it does.
var bareLines = [];
['--palettes', '--shapes', '--channels', '--phrases', '--lights', '--grids',
  '--scales'].forEach(function (lf) {
  var lines = require('child_process')
    .execSync('node cli.js ' + lf, {cwd: __dirname + '/..'}).toString().trim().split('\n');
  lines.forEach(function (ln) {
    if (ln.trim().split(/\s+/).length < 2) bareLines.push(lf + ' ' + ln);
  });
});
assert(bareLines.length === 0,
  'every listing explains its key (' + bareLines.join(' | ') + ')');

// Every shared list is also what a URL hash is matched against, so its keys
// must be unique: two options sharing a key would make a restored link depend
// on which of the two the dropdown happened to reach first.
function uniqueKeys(list) {
  var seen = {};
  for (var k = 0; k < list.length; k++) {
    var key = list[k].key;
    if (seen[key]) return false;
    seen[key] = true;
  }
  return true;
}
var listsOk = uniqueKeys(core.shapes) && uniqueKeys(core.channels) &&
  uniqueKeys(core.lights) && uniqueKeys(core.grids) && uniqueKeys(core.scales);
assert(listsOk, 'every dropdown list has distinct keys');

// The help text is the shortest listing, so it must agree with the lists the
// dropdowns read: a shape key missing from --help would look unavailable even
// though --shape accepts it.
var helpOut = require('child_process')
  .execSync('node cli.js --help', {cwd: __dirname + '/..'}).toString();
var helpShapes = core.shapes.every(function (s) {
  return helpOut.indexOf(s.key) >= 0;
});
assert(helpShapes, '--help lists every shape key');

// The same has to hold for the other shared lists: each one is both a dropdown
// and a CLI value, so a key that never appears in the usage line would look
// unavailable from a terminal even though the parser takes it. The empty
// overlay key is the one exception — it prints as "biome".
var helpMissing = [];
Object.keys(core.palettes).forEach(function (hk) {
  if (helpOut.indexOf(hk) < 0) helpMissing.push('palette ' + hk);
});
core.channels.forEach(function (hc) {
  if (helpOut.indexOf(hc.key || 'biome') < 0) helpMissing.push('channel ' + (hc.key || 'biome'));
});
core.lights.forEach(function (hl) {
  if (helpOut.indexOf(hl.key) < 0) helpMissing.push('light ' + hl.key);
});
core.grids.forEach(function (hg) {
  if (helpOut.indexOf(hg.key || 'auto') < 0) helpMissing.push('grid ' + (hg.key || 'auto'));
});
core.scales.forEach(function (hs) {
  if (helpOut.indexOf(hs.key) < 0) helpMissing.push('scale ' + hs.key);
});
assert(helpMissing.length === 0,
  '--help names every key the dropdowns offer (' + helpMissing.join(', ') + ')');

// The other direction is worth checking too: every flag the help text names
// must be one the parser knows, or the usage line advertises something that
// silently falls through to the unknown-flag warning. Each token is run with a
// throwaway value and must leave stderr quiet.
// A leading dash only starts a flag where a word can begin — the start of a
// line, after a space, or after an opening bracket. That keeps the hyphen
// inside "nearest-neighbour" from being read as a flag of its own.
var helpFlags = (helpOut.match(/(?:^|[\s[(])--?[a-z][a-z-]*/gm) || [])
  .map(function (fl) { return fl.replace(/^[\s[(]/, ''); });
var quietFlags = {};
var rejected = [];
// Each flag is fed a value its own list offers, so a warning means the flag
// itself is unknown rather than the sample being wrong. The four key-valued
// flags take their sample from the array behind their dropdown; the rest are
// numeric and read fine from a small integer.
function sampleFor(fl) {
  if (fl === '--palette') return Object.keys(core.palettes)[0];
  if (fl === '--shape') return core.shapes[0].key;
  if (fl === '--channel') return core.channels[1].key || core.channels[0].key;
  if (fl === '--dir') return core.lights[0].key;
  return '24';
}
helpFlags.forEach(function (fl) {
  if (quietFlags[fl]) return;
  quietFlags[fl] = 1;
  var err = require('child_process')
    .execSync('node cli.js "salt mirror" --describe ' + fl + ' ' +
      sampleFor(fl) + ' 2>&1',
      {cwd: __dirname + '/..', stdio: ['ignore', 'pipe', 'ignore']})
    .toString();
  if (/unknown flag/.test(err)) rejected.push(fl);
});
assert(rejected.length === 0 && Object.keys(quietFlags).length > 8,
  'every flag in --help is one the parser takes (' +
  Object.keys(quietFlags).length + ' checked' +
  (rejected.length ? ', stuck on ' + rejected.join(', ') : '') + ')');

// The other direction is worth a look too: a flag the parser accepts but the
// usage line never names is invisible from a terminal, since `--help` is the
// only listing most people read before opening the source. Read the names out
// of the parser's own comparisons and ask that each one show up in that text.
// A single-dash form needs no note of its own — `-h` is an alias of `--help`,
// which the pattern below skips by requiring two dashes.
var parserFlags = {};
require('fs').readFileSync(__dirname + '/../cli.js', 'utf8')
  .replace(/a === '(--[a-z][a-z-]*)'/g, function (m, fl) {
    parserFlags[fl] = 1;
    return m;
  });
var hiddenFlags = Object.keys(parserFlags).filter(function (fl) {
  return helpOut.indexOf(fl) < 0;
});
assert(hiddenFlags.length === 0 && Object.keys(parserFlags).length > 15,
  'the parser takes no flag that --help hides (' +
  Object.keys(parserFlags).length + ' flags, missing ' +
  hiddenFlags.join(', ') + ')');
// The two size flags are the only pair where one value decides the other, so
// the rule has to be readable from the usage line: a terminal that only sees
// `--width 800` should learn the missing side is derived, not left at a fixed
// default. Look for one line naming a size flag and the derivation together.
var aspectNote = helpOut.replace(/\r/g, '').split('\n').filter(function (hl2) {
  return /--(width|height)/.test(hl2) && /aspect|ratio/i.test(hl2);
});
assert(aspectNote.length >= 1,
  '--help explains what a lone size flag does (' + aspectNote.length + ' notes)');

// A dashed word that matches no flag is a typo, not a seed: the CLI says so
// and still renders one world, rather than treating the stray word (and its
// value) as extra seeds. Checked by counting the summaries it prints.
var typoOut = require('child_process')
  .execSync('node cli.js "pale shelf" --describe --widht 30',
    {cwd: __dirname + '/..', stdio: ['ignore', 'pipe', 'ignore']})
  .toString().trim().split('\n');
assert(typoOut.length === 1 && typoOut[0].indexOf('(') > 0,
  'a mistyped flag does not add a second world (' + typoOut.length + ')');

// Several seeds at once: every summary line has to name its own seed, or a
// block of sentences cannot be traced back to the phrase that made it. One
// seed keeps the bare sentence, which is what the page prints.
var manyOut = require('child_process')
  .execSync('node cli.js "pale shelf" "salt mirror" --describe ' +
    '--width 60 --height 40', {cwd: __dirname + '/..'}).toString().trim().split('\n');
assert(manyOut.length === 2 && manyOut[0].indexOf('pale shelf') === 0 &&
  manyOut[1].indexOf('salt mirror') === 0,
  'each summary line names its seed (' + manyOut.length + ')');

// Both views of one world go through `describe()`: the sidebar takes it from
// the generated record, the terminal prints it from the same call. Compared
// here as strings on one seed and one grid, so a phrase edited on one side —
// or a field the CLI forgets to pass — shows up as a difference rather than as
// two sentences that both look reasonable.
var saidCli = require('child_process')
  .execSync('node cli.js "thousand isles" --describe --width 100 --height 64',
    {cwd: __dirname + '/..'}).toString().trim();
var saidCore = core.describe(core.generate({
  seed: 'thousand isles', width: 100, height: 64
}));
assert(saidCli === saidCore,
  'the cli sentence is the page sentence (' + saidCli + ')');

// The text profile has to be the same picture the chart draws: one column per
// bar in the record, six rows of blocks, and the sea marker sitting on the
// column the core's own bin lookup picks for this sea level. The record is read
// here rather than from the one further down this file, since the profile is a
// rendering of that record's own four numbers.
// The record's own four numbers, read straight from the core: the bins the
// profile must match, and the range its sea marker is placed over.
var histWorld = core.generate({seed: 'salt mirror', width: 120, height: 80});
var histBins = core.binCount(core.histWidth);
var histOut = require('child_process')
  .execSync('node cli.js "salt mirror" --width 120 --height 80 --describe --hist',
    {cwd: __dirname + '/..'}).toString().replace(/\r/g, '').split('\n');
// The ruler is the one row that is never trimmed, so it is what counts the
// columns.
// Drop the blank tail the trailing newline leaves, then read the block by its
// own shape: sentence, six rows of blocks, ruler, caption.
var histLines = histOut.filter(function (l) { return l.length; });
var histRuler = histLines[histLines.length - 2];
var histSeaCol = histRuler.indexOf('|');
var histWantCol = core.binOf(histWorld.seaLevel, histWorld.stats.min,
  Math.max(0.001, histWorld.stats.max - histWorld.stats.min), histBins);
var histRows = histLines.slice(1, histLines.length - 2);
// The row count is the core's own number rather than one this file guesses, so
// a block read back from a terminal is checked against the same figure the
// writer used. Both halves are read here: the constant, and the fact that the
// profile reads it rather than restating it.
assert(histRuler.length === histBins && histSeaCol === histWantCol &&
  histRows.length === core.histRows && /#/.test(histRows[histRows.length - 1]),
  'the text profile matches the chart bins (' + histRuler.length + ' columns, ' +
  histRows.length + ' rows, sea at ' + histSeaCol + ')');
// Each row is one threshold over the same bins, so the blocks can only pile up
// downward: a row with fewer blocks than the one above it means the levels are
// inverted, which prints the silhouette upside down while leaving every figure
// in the caption correct. The tallest column is also asked to appear in every
// row, since that is the column the record's `peak` describes.
var hpHist = core.histogram(histWorld, histBins).hist;
var peakCol = 0;
for (var hpi = 1; hpi < hpHist.length; hpi++) {
  if (hpHist[hpi] > hpHist[peakCol]) peakCol = hpi;
}
var rowCounts = histRows.map(function (row) {
  return (row.match(/#/g) || []).length;
});
var stackBad = [];
rowCounts.forEach(function (n, ri) {
  if (ri && n < rowCounts[ri - 1]) {
    stackBad.push(ri + ':' + n + '<' + rowCounts[ri - 1]);
  }
});
var peakFilled = histRows.every(function (row) {
  return row.charAt(peakCol) === '#';
});
// Counting blocks only says the totals grow; it would still pass if a lower
// row dropped one column and gained two elsewhere. The real shape of a
// threshold stack is that every filled column stays filled in the rows below
// it, so compare column by column as well.
var nestBad = [];
histRows.forEach(function (row, ri) {
  if (!ri) return;
  var above = histRows[ri - 1];
  for (var ci = 0; ci < histBins; ci++) {
    if (above.charAt(ci) === '#' && row.charAt(ci) !== '#') {
      nestBad.push(ri + ':' + ci);
      break;
    }
  }
});
assert(stackBad.length === 0 && peakFilled && rowCounts[0] >= 1,
  'the text profile stacks its rows by height (' + rowCounts.join('/') +
  ', peak column ' + peakCol + ' filled ' + peakFilled +
  ', gaps ' + nestBad.join(',') + ')');
// Those three checks describe the block's shape; none of them says the block
// was built from THIS world. Re-derive each row from the histogram and the
// peak the record publishes — one threshold per row, a column filled when its
// count reaches that share of the tallest one — and compare the whole row.
// That is what lets a saved PNG plus one line of JSON redraw the silhouette.
var shapeBad = [];
histRows.forEach(function (row, ri) {
  var level = (histRows.length - ri) / histRows.length;
  var want = '';
  for (var wi = 0; wi < histBins; wi++) {
    want += (hpHist[wi] / hpHist[peakCol]) >= level ? '#' : ' ';
  }
  if (row !== want.replace(/\s+$/, '')) shapeBad.push(ri);
});
assert(shapeBad.length === 0,
  'each row is one threshold over the record\'s counts (' +
  histRows.length + ' rows, off at ' + shapeBad.join(',') + ')');
// The caption under the ruler names the picture the block belongs to, so the
// last line has to carry the same eight hex digits the record prints. Without
// it a pasted block of bars could not be tied back to a saved PNG at all.
// The same ruler carries the median, so the pair of marks has to sit where the
// core's own lookup puts them: `|` for the sea line, `:` for the middle of the
// height field. Both are compared against the field rather than a copy of the
// arithmetic, which is what lets a caption stand in for the chart itself.
var histMedCol = histRuler.indexOf(':');
var histMedWant = core.binOf(histWorld.stats.median, histWorld.stats.min,
  Math.max(0.001, histWorld.stats.max - histWorld.stats.min), histBins);
var histCaption = histLines[histLines.length - 1];
assert(histCaption.indexOf(histWorld.stats.checksum) > 0,
  'the text profile names its own world (' + histCaption + ')');
assert(histMedCol === histMedWant && histCaption.indexOf('median') > 0,
  'the ruler marks the middle as well as the sea (' + histMedCol + ')');
// Where the two marks fall in the SAME column, neither may be dropped: the
// ruler has to show one combined glyph there, and exactly one mark per column
// otherwise. Counted over every phrase, since a collision only shows up on a
// near-flat world and a dropped mark would otherwise slip through.
var rulerBad = [];
core.phrases.forEach(function (rp) {
  var rw = core.generate({seed: rp, width: 100, height: 64});
  var rb = core.binCount(core.histWidth);
  var rspan = Math.max(0.001, rw.stats.max - rw.stats.min);
  var rs = core.binOf(rw.seaLevel, rw.stats.min, rspan, rb);
  var rm = core.binOf(rw.stats.median, rw.stats.min, rspan, rb);
  var rout = require('child_process')
    .execSync('node cli.js "' + rp + '" --width 100 --height 64 --hist',
      {cwd: __dirname + '/..'}).toString().replace(/\r/g, '').split('\n');
  var rlines = rout.filter(function (l) { return l.length; });
  var rr = rlines[rlines.length - 2];
  var marks = rr.replace(/-/g, '').length;
  var wantGlyph = rs === rm ? '+' : '|';
  if (rr.length !== rb || marks !== (rs === rm ? 1 : 2) ||
    rr.charAt(rs) !== wantGlyph || (rs !== rm && rr.charAt(rm) !== ':')) {
    rulerBad.push(rp + ' ' + rs + '/' + rm + ' -> ' + marks);
  }
});
assert(rulerBad.length === 0,
  'the ruler keeps both marks wherever they fall (' +
  rulerBad.join('; ') + ')');
// The column count comes from the sidebar's width rather than the world's
// grid, so two grids of different sizes print the same number of columns and
// their blocks can be laid over each other. A count that tracked the grid
// would make every profile a different width, and the only comparison left
// would be by eye against a second caption.
var wideRuler = '';
['40x24', '200x120'].forEach(function (gsize) {
  var gp = gsize.split('x');
  var gout = require('child_process')
    .execSync('node cli.js "salt mirror" --hist --width ' + gp[0] +
      ' --height ' + gp[1], {cwd: __dirname + '/..'})
    .toString().replace(/\r/g, '').split('\n')
    .filter(function (l) { return l.length; });
  wideRuler = gout[gout.length - 2];
});
assert(wideRuler.length === histBins,
  'profiles of different grids share a column count (' +
  wideRuler.length + ')');
// Every figure in that caption is also a field of the JSON record, so a pasted
// block of bars and a line of JSON have to say the same numbers: the two ends
// of the range are the record's `low` and `high`, the column count is its
// `bins`. Re-derived from the height field here rather than from a second
// parse of the caption, which is what makes a drift on either side visible.
var capEnds = /^(\d+) \.\. (\d+) relief/.exec(histCaption);
var capBins = /(\d+) bins/.exec(histCaption);
var capSea = /sea (\d+)/.exec(histCaption);
var capMed = /median (\d+)/.exec(histCaption);
assert(capEnds && Number(capEnds[1]) === Math.round(histWorld.stats.min * 100) &&
  Number(capEnds[2]) === Math.round(histWorld.stats.max * 100) &&
  capBins && Number(capBins[1]) === histBins &&
  capMed && Number(capMed[1]) === Math.round(histWorld.stats.median * 100) &&
  capSea && Number(capSea[1]) === Math.round(histWorld.seaLevel * 100),
  'the caption repeats the record it came from (' + histCaption + ')');
// The sea line is the one figure the ruler marks, so it has to be a field of
// the record as well: the two ends and the column count only place the block,
// while the rule's own column comes from the level. Read from a record of the
// same world, since the caption rounds and the record keeps three decimals.
var seaRec = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 120 --height 80 --json ' +
    '--out sea-rec.ppm', {cwd: __dirname + '/..'}).toString().trim());
assert(Math.round(seaRec.sea * 100) === Number(capSea[1]) &&
  seaRec.sea === histWorld.seaLevel,
  'the record keeps the sea the ruler marks (' + seaRec.sea + ' -> ' +
  capSea[1] + ')');

// Both marks are published as columns as well, since the caption rounds every
// figure and a rounded end of the range can slide a mark by one column. Read
// the ruler and the record for one world and compare the pair: where they
// differ the ruler shows `+`, which is still one column for both.
var markRec = JSON.parse(require('child_process')
  .execSync('node cli.js "aurora basin" --width 120 --height 80 --json ' +
    '--out mark-rec.ppm', {cwd: __dirname + '/..'}).toString().trim());
var markOut = require('child_process')
  .execSync('node cli.js "aurora basin" --width 120 --height 80 --hist ' +
    '--out mark-hist.ppm', {cwd: __dirname + '/..'})
  .toString().replace(/\r/g, '').split('\n')
  .filter(function (l) { return l.length; });
var markRuler = markOut[markOut.length - 2];
var markOne = markRec.seaCol === markRec.medCol;
var markGlyph = markRuler.charAt(markRec.seaCol);
var markOnly = markRuler.replace(/-/g, '').length;
assert(markOnly === (markOne ? 1 : 2) && markGlyph === (markOne ? '+' : '|') &&
  (!markOne && markRuler.charAt(markRec.medCol) === ':'),
  'the record names the columns the ruler marks (' + markRec.seaCol + '/' +
  markRec.medCol + ' -> ' + markGlyph + ')');
// Those two comparisons each read a single world. The caption is built from the
// same fields for every phrase, so walk the whole list: render a record and a
// profile for each seed and ask that every figure in the caption be that
// record's own field — the two ends of the range already rounded in the JSON,
// the two levels rounded here out of a hundred — and that the ruler's marked
// columns be the two the record names. A phrase whose middle sits on its own
// shoreline is the one that collapses both marks into a `+`, and that is only
// visible if more than one world is opened.
var capBad = [];
core.phrases.forEach(function (cp) {
  var cRec = JSON.parse(require('child_process')
    .execSync('node cli.js "' + cp + '" --width 140 --height 90 --json',
      {cwd: __dirname + '/..'}).toString().trim());
  var cOut = require('child_process')
    .execSync('node cli.js "' + cp + '" --width 140 --height 90 --hist',
      {cwd: __dirname + '/..'}).toString().replace(/\r/g, '').split('\n')
    .filter(function (l) { return l.length; });
  var cCap = cOut[cOut.length - 1];
  var cRuler = cOut[cOut.length - 2];
  var cEnds = /^(\d+) \.\. (\d+) relief/.exec(cCap);
  var cSea = /sea (\d+)/.exec(cCap);
  var cMed = /median (\d+)/.exec(cCap);
  var cBins = /(\d+) bins/.exec(cCap);
  var cOne = cRec.seaCol === cRec.medCol;
  var cMarks = cRuler.replace(/-/g, '').length;
  if (!cEnds || !cSea || !cMed || !cBins ||
    Number(cEnds[1]) !== cRec.low || Number(cEnds[2]) !== cRec.high ||
    Number(cBins[1]) !== cRec.bins ||
    Number(cSea[1]) !== Math.round(cRec.sea * 100) ||
    Number(cMed[1]) !== Math.round(cRec.median * 100) ||
    cCap.indexOf(cRec.checksum) < 0 ||
    cMarks !== (cOne ? 1 : 2) ||
    cRuler.charAt(cRec.seaCol) !== (cOne ? '+' : '|') ||
    (!cOne && cRuler.charAt(cRec.medCol) !== ':')) {
    capBad.push(cp + ' ' + cRec.seaCol + '/' + cRec.medCol + ' -> ' + cMarks);
  }
});
assert(capBad.length === 0 && core.phrases.length >= 4,
  'every caption figure is a field of its own record (' +
  core.phrases.length + ' worlds, off at ' + capBad.join('; ') + ')');

// The caption is only the label under the block, so the bars themselves have to
// be compared per phrase too. One world would let a block built from a fixed
// bin count — or from another world's counts — pass while its caption still
// read correctly. For each seed: render a profile and a record, then rebuild
// every row from THAT record's `hist` and `peak`, one threshold per row, and
// ask for the whole string to match. That is the pair a reader has when only a
// pasted block and one line of JSON survive.
var blockBad = [];
core.phrases.forEach(function (bp) {
  var bRec = JSON.parse(require('child_process')
    .execSync('node cli.js "' + bp + '" --width 130 --height 84 --json',
      {cwd: __dirname + '/..'}).toString().trim());
  var bOut = require('child_process')
    .execSync('node cli.js "' + bp + '" --width 130 --height 84 --describe ' +
      '--hist',
      {cwd: __dirname + '/..'}).toString().replace(/\r/g, '').split('\n')
    .filter(function (l) { return l.length; });
  // The CLI prints its summary sentence above the block, and the ruler plus the
  // caption sit under it: the rows are what is left between those.
  var bRows = bOut.slice(1, bOut.length - 2);
  if (bRows.length !== 6 || bRec.hist.length !== bRec.bins) {
    blockBad.push(bp + ' ' + bRows.length + ' rows');
    return;
  }
  for (var bri = 0; bri < bRows.length; bri++) {
    var bLevel = (bRows.length - bri) / bRows.length;
    var bWant = '';
    for (var bci = 0; bci < bRec.bins; bci++) {
      bWant += (bRec.hist[bci] / bRec.peak) >= bLevel ? '#' : ' ';
    }
    if (bRows[bri] !== bWant.replace(/\s+$/, '')) {
      blockBad.push(bp + ' row ' + bri);
      break;
    }
  }
});
assert(blockBad.length === 0,
  'every block is redrawn by its own record (' + core.phrases.length +
  ' worlds, off at ' + blockBad.join('; ') + ')');

// The readout calls a water cell `off-shelf` at one fixed depth below the sea
// line, and the core calls the same cell `deep` at that same depth. Two numbers
// written in two files, so both are read out of their own source and compared,
// then walked over one world: every cell the readout would mark has to be a
// cell the core classified as deep, and vice versa. A pair that drifted apart
// would print a note about a class the legend does not list.
var shelfSrc = require('fs').readFileSync(__dirname + '/../src/core.js', 'utf8');
var shelfShellSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
// The cut is one constant in the core, and the shell reads it through that
// name rather than writing its own number: the pair is checked as a definition
// plus a reference, so a second literal in the shell shows up here even when
// both numbers happen to agree today.
var shelfCore = /var DEEP_DROP = ([\d.]+);/.exec(shelfSrc);
var shelfUsed = /seaLevel - DEEP_DROP \? 'deep'/.test(shelfSrc);
var shelfShell = /seaLevel - TerraCore\.deepDrop\)/.test(shelfShellSrc);
var shelfWorld = core.generate({seed: 'salt mirror', width: 120, height: 70});
var shelfBad = 0;
for (var si = 0; si < shelfWorld.heightField.length; si++) {
  var sh = shelfWorld.heightField[si];
  var shWant = sh < shelfWorld.seaLevel - Number(shelfCore && shelfCore[1]);
  if (shWant !== (shelfWorld.biome[si] === 'deep')) shelfBad++;
}
assert(shelfCore && shelfUsed && shelfShell && shelfBad === 0 &&
  Number(shelfCore[1]) === Number(core.deepDrop),
  'the off-shelf note is the deep class (' + (shelfCore && shelfCore[1]) +
  ', used ' + shelfUsed + ', shell ' + shelfShell + ', ' + shelfBad + ' cells)');

// Every legend row is a colour key in the palette in use, printed through the
// display-name lookup with the raw key as its fallback. So each scheme has to
// carry exactly the set of keys the lookup knows: a colour with no name would
// show up as `taiga` in the list, and a name with no colour could never be
// drawn at all. Walked over every palette rather than the default one.
var nameKeys = Object.keys(core.biomeNames);
var schemeBad = [];
Object.keys(core.palettes).forEach(function (sk) {
  var ck = Object.keys(core.palettes[sk].colors);
  var unnamed = ck.filter(function (uk) {
    return nameKeys.indexOf(uk) < 0;
  });
  var undrawn = nameKeys.filter(function (nk) {
    return ck.indexOf(nk) < 0;
  });
  if (unnamed.length || undrawn.length) {
    schemeBad.push(sk + ': ' + unnamed.join('/') + ' | ' + undrawn.join('/'));
  }
});
assert(schemeBad.length === 0 && nameKeys.length >= 12,
  'every scheme colours exactly the named classes (' + nameKeys.length +
  ' names, ' + schemeBad.join('; ') + ')');

// The readout prints `N from water` only on dry ground, and it does so on the
// strength of one fact: the sweeps start at the shoreline, so every water cell
// already sits at zero and the `above` guard in the readout is never what
// filters it. Checked cell by cell — each cell with a distance above the note's
// own threshold has to be a cell at or above the sea line. Were that not so,
// the note would be hiding a real reading on half the ocean.
var distWorld = core.generate({seed: 'thousand isles', width: 130, height: 80});
var wetFar = 0;
for (var di = 0; di < distWorld.heightField.length; di++) {
  if (distWorld.coastDistance[di] > 1 &&
    distWorld.heightField[di] < distWorld.seaLevel) wetFar++;
}
var farthest = Math.max.apply(null, distWorld.coastDistance);
assert(wetFar === 0 && farthest > 1,
  'only dry cells are ever far from water (' + wetFar + ' wet, furthest ' +
  farthest + ')');

// Writing several worlds at once must not overwrite: --out becomes a prefix and
// each world gets its own numbered file. The record names that file, so the
// two records of one call have to point at two different paths — and each path
// has to be the file actually written.
var manyJson = require('child_process')
  .execSync('node cli.js "pale shelf" "salt mirror" --json --width 24 --height 16 ' +
    '--out many-check.ppm', {cwd: __dirname + '/..'}).toString().trim().split('\n')
  .map(function (line) { return JSON.parse(line); });
var manyFs = require('fs');
var manyFiles = manyJson.map(function (rec) { return rec.file; });
var manyWritten = manyFiles.every(function (name) {
  return manyFs.existsSync(__dirname + '/../' + name);
});
assert(manyJson.length === 2 && manyFiles[0] !== manyFiles[1] && manyWritten &&
  manyJson[0].checksum !== manyJson[1].checksum,
  'several seeds write one numbered file each (' + manyFiles.join(', ') + ')');

// The prefix is not required to carry an extension, and that is the case where
// a suffix rule can quietly fail: a pattern anchored on the dot matches
// nothing, so every world after the first overwrites the one before it and the
// call leaves a single file behind. Same call without the `.ppm`, so the two
// records must still name two paths and both must exist on disk.
var bareJson = require('child_process')
  .execSync('node cli.js "pale shelf" "salt mirror" --json --width 24 --height 16 ' +
    '--out bare-prefix', {cwd: __dirname + '/..'}).toString().trim().split('\n')
  .map(function (line) { return JSON.parse(line); });
var bareFs = require('fs');
var bareFiles = bareJson.map(function (rec) { return rec.file; });
var bareWritten = bareFiles.every(function (name) {
  return bareFs.existsSync(__dirname + '/../' + name);
});
assert(bareJson.length === 2 && bareFiles[0] !== bareFiles[1] && bareWritten,
  'an extension-less prefix still numbers its files (' +
  bareFiles.join(', ') + ')');

// And the same for the light bearings: the dropdown, the `d` key and the shade
// pass all read core.lights, so a key printed by the CLI must be one the
// generator accepts, with the same note the dropdown implies.
var lightList = require('child_process')
  .execSync('node cli.js --lights', {cwd: __dirname + '/..'}).toString().trim().split('\n');
var lightNames = lightList.map(function (line) { return line.split(/\s+/)[0]; });
var coreLights = core.lights.map(function (lt) { return lt.key; });
assert(lightList.length === coreLights.length &&
  lightNames.join(',') === coreLights.join(','),
  'cli --lights lists every bearing (' + lightNames.length + ')');

// The per-class shares the CLI prints must agree with the counts the generator
// reported, so the two views of the same world cannot drift apart.
var jsonLine = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 120 --height 80 --json --out ch.ppm',
    {cwd: __dirname + '/..'}).toString().trim());
var jsonPairs = jsonLine.classes.split(' ').map(function (p) {
  var at = p.indexOf('=');
  return [p.slice(0, at), parseFloat(p.slice(at + 1))];
});
var jsonTotal = jsonPairs.reduce(function (n, p) { return n + p[1]; }, 0);
assert(jsonPairs.length === jsonLine.biomes && jsonTotal >= 96 && jsonTotal <= 104,
  'cli class shares match the biome count (' + jsonPairs.length + ' classes, ' +
  Math.round(jsonTotal) + '%)');

// The shares in that column are the same strings the sidebar prints, because
// both go through one formatter. Recomputing each pair from the counts proves
// the CLI did not round on its own: a class shown as `0.6%` on the page must
// read `0.6%` in the record, not `1%`.
var jsonWorld = core.generate({ seed: 'salt mirror', width: 120, height: 80 });
var fmtOk = jsonPairs.length === Object.keys(jsonWorld.stats.counts).length;
jsonPairs.forEach(function (p) {
  var want = core.percentText(jsonWorld.stats.counts[p[0]] / jsonWorld.stats.pixels);
  if (p[1] !== parseFloat(want)) fmtOk = false;
});
assert(fmtOk,
  'cli shares use the sidebar formatter (' + jsonPairs[0][0] + '=' + jsonPairs[0][1] + '%)');
// The same record has a plain form for reading in a terminal: one padded label
// per line, then the value. Both forms come out of one object in `summarise()`,
// so the two must agree field by field — every key of the JSON line has to be a
// label of the table, and each label has to carry the JSON value next to it. A
// table that dropped a field would still look complete while hiding the number
// a reader came for, and a table that padded its own rounding would be a second
// formatter to keep in step.
var tableOut = require('child_process')
  .execSync('node cli.js "salt mirror" --width 120 --height 80 ' +
    '--out ch.ppm', {cwd: __dirname + '/..'}).toString()
  .replace(/\r/g, '').split('\n').filter(function (l) { return l.length; });
var tableMap = {};
tableOut.forEach(function (line) {
  var pair = /^(\S+)\s+([\s\S]*)$/.exec(line) || [/^(\S+)\s*$/, line, ''];
  tableMap[pair[1]] = pair[2].replace(/\s+$/, '');
});
var tableBad = [];
Object.keys(jsonLine).forEach(function (jk) {
  if (!(jk in tableMap)) { tableBad.push(jk + ' missing'); return; }
  // The one field allowed to wander between two runs of the same world is the
  // clock, so only its presence is asked for there.
  if (jk === 'ms') { if (!tableMap.ms) tableBad.push('ms empty'); return; }
  var want = Array.isArray(jsonLine[jk])
    ? jsonLine[jk].join(',') : String(jsonLine[jk]);
  if (tableMap[jk] !== want) tableBad.push(jk + ': ' + tableMap[jk]);
});
assert(tableBad.length === 0 && Object.keys(tableMap).length >= 20,
  'the plain table repeats the JSON record (' + Object.keys(jsonLine).length +
  ' fields, off at ' + tableBad.join('; ') + ')');
// A lone size flag should not decide the other side by accident. `--width 100`
// on its own used to mean 100x300 — a letterbox strip — because the untouched
// side fell back to the plain default height. Both one-sided forms are checked
// against the ratio of the two defaults, and against each other, so the missing
// side is derived rather than fixed. Naming both sides is the control: the pair
// must come through exactly as given, which is what stops the derivation from
// becoming a second place the grid is decided.
var oneWide = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 100 --json --out aspect-w.ppm',
    {cwd: __dirname + '/..'}).toString().trim());
var oneTall = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --height 60 --json --out aspect-h.ppm',
    {cwd: __dirname + '/..'}).toString().trim());
var aspect = 480 / 300;
function ratioNear(rec) {
  return Math.abs(rec.width / rec.height - aspect) < 0.06;
}
assert(oneWide.width === 100 && ratioNear(oneWide) && oneWide.height < 300 &&
  oneTall.height === 60 && ratioNear(oneTall) && oneTall.width < 480,
  'a lone size flag keeps the default aspect (' + oneWide.width + 'x' +
  oneWide.height + ', ' + oneTall.width + 'x' + oneTall.height + ')');
// That formatter switches at ten percent: whole numbers above, one decimal
// below. That boundary is what keeps a `2%` class and a `0.2%` class in the
// order their counts give them, which is how the legend reads biggest-first —
// whole numbers alone would print both as `2%`. Walk every share the page
// actually prints (each class, the drainage figure, the three cover rows) over
// each hand-picked world, and require that a string carries a decimal exactly
// when its own value sits under ten. A second rounding at one call site shows
// up here as a row whose figure no longer matches the count beside it.
var fmtBad = [];
var fmtSeen = 0;
function shareRule(label, fraction) {
  var text = core.percentText(fraction);
  var hasDecimal = /\.\d/.test(text);
  fmtSeen++;
  if (hasDecimal !== (parseFloat(text) < 10)) fmtBad.push(label + '=' + text);
}
core.phrases.forEach(function (fp2) {
  var fw2 = core.generate({seed: fp2, width: 200, height: 120});
  var fs = fw2.stats;
  Object.keys(fs.counts).forEach(function (ck3) {
    shareRule(ck3, fs.counts[ck3] / fs.pixels);
  });
  shareRule('rivers', fs.rivers / fs.pixels);
  shareRule('land', fs.land);
  shareRule('water', fs.water);
  shareRule('ice', fs.ice);
});
assert(fmtBad.length === 0 && fmtSeen > 40,
  'a share keeps its decimal only under ten percent (' + fmtSeen +
  ' shares, ' + fmtBad.length + ' off rule)');

// The `median` row prints a height out of a hundred while the record keeps the
// same height as a 0..1 number, so the two only agree if the record scales the
// way the row does. Compare the pair on one world: a record that rounded on its
// own would put a different figure under the bars than the one in the list.
// `appSrc` is only read into a variable further down this file, so this block
// reads the shell itself here rather than waiting for it.
var medSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
var medianRowSrc = (/median',\s*([\s\S]{0,80}?)\]/.exec(medSrc) || ['', ''])[1];
assert(medianRowSrc.indexOf('hundred(') >= 0 && medianRowSrc.indexOf('.median') >= 0 &&
  Math.round(jsonLine.median * 100) === Math.round(jsonWorld.stats.median * 100),
  'the median row and the record are one measurement (' +
  Math.round(jsonLine.median * 100) + ' vs ' + Math.round(jsonWorld.stats.median * 100) + ')');

// The same number is printed twice on the page: once in the stats list and
// once beside the mark under the bars. Both are a rounding of one field, so
// both must scale it through the shared helper — a label that multiplied by a
// hundred on its own would put two different medians in one sidebar, which is
// the one thing a mark sitting under a row should never do.
var medMarkSrc = (/var medLabel = '([\s\S]{0,80}?)\n/.exec(medSrc) ||
  ['', ''])[1];
assert(medMarkSrc.indexOf("median '") === 0 &&
  medMarkSrc.indexOf('hundred(result.stats.median)') > 0 &&
  medMarkSrc.indexOf('* 100') < 0,
  'the chart marks the median the row prints (' + medMarkSrc.trim() + ')');

// Dragging a window edge fires a resize for every pixel of the drag, and each
// one rebuilds the grid from the seed. That is the only handler on this page
// that runs without a person asking for it, so it has to coalesce: one
// scheduled render per frame, with the guard cleared inside the callback so a
// burst collapses to a single rebuild. Read the listener out of the shell and
// ask for that shape rather than for a bare `render` in the listener list.
var resizeSrc = (/window\.addEventListener\('resize',([\s\S]*?)\n  \}\);/
  .exec(medSrc) || ['', ''])[1];
assert(/pendingResize/.test(resizeSrc) &&
  /requestAnimationFrame\(/.test(resizeSrc) &&
  /pendingResize = false;\s*\n\s*render\(\);/.test(resizeSrc) &&
  /addEventListener\('resize', render\)/.test(medSrc) === false,
  'a resize burst rebuilds once per frame (' + resizeSrc.trim().slice(0, 40) +
  '...)');

// The order of that column is the legend's order — biggest share first — so
// the first pair is the class the sentence calls dominant, and no later pair
// may be bigger than the one before it. A record read in a terminal has to
// rank the classes the same way the sidebar does.
var jsonSorted = true;
for (var js = 1; js < jsonPairs.length; js++) {
  if (jsonPairs[js - 1][1] < jsonPairs[js][1]) jsonSorted = false;
}
var jsonTopName = core.biomeNames[jsonPairs[0][0]];
assert(jsonSorted && jsonPairs[0][1] > 0 &&
  jsonLine.summary.indexOf('mostly ' + jsonTopName) > 0,
  'cli classes rank like the legend (' + jsonPairs[0][0] + ' first at ' +
  jsonPairs[0][1] + '%)');

// Ranking by count alone is only half the rule: two classes can cover the same
// number of cells, and then the pair's order is decided by the tie-break the
// legend uses — the palette's own key order. A record that stopped at the count
// would still print a plausible column while listing that pair in whatever
// order its counts object happened to be filled, so the same two rows could
// swap between a terminal and the page over one world. Compared against the
// same insertion pass the legend assertion uses.
function cliOrderOf(world) {
  var cn = Object.keys(world.palette.colors);
  var cc = world.stats.counts;
  var co = [];
  cn.forEach(function (nk) {
    if (!cc[nk]) return;
    var cat = co.length;
    while (cat > 0 && cc[co[cat - 1]] < cc[nk]) {
      co[cat] = co[cat - 1];
      cat--;
    }
    co[cat] = nk;
  });
  return co;
}
var cliOrderBad = [];
core.phrases.forEach(function (ck3) {
  var cw3 = core.generate({seed: ck3, width: 120, height: 80});
  var cwp = Object.keys(cw3.stats.counts)
    .sort(function (sa, sb) {
      return cw3.stats.counts[sb] - cw3.stats.counts[sa] ||
        Object.keys(cw3.palette.colors).indexOf(sa) -
        Object.keys(cw3.palette.colors).indexOf(sb);
    })
    .join(',');
  if (cwp !== cliOrderOf(cw3).join(',')) cliOrderBad.push(ck3);
});
var cliTieSrc = (/var classes = declared\b/.exec(
  require('fs').readFileSync(__dirname + '/../cli.js', 'utf8')
) || ['', ''])[0];
assert(cliOrderBad.length === 0 && cliTieSrc.length > 0 &&
  jsonPairs.map(function (pp) { return pp[0]; }).join(',') ===
  cliOrderOf(jsonWorld).join(','),
  'the record ranks classes the way the legend does (' + jsonPairs.length +
  ' pairs, ' + cliOrderBad.length + ' off)');

// The drainage share in the sentence has to be reproducible from the record's
// own numbers, since that is the only trace a saved file keeps: `rivers` over
// `width` x `height` through the shared formatter must be the string printed
// after it. A second rounding in the record would leave a terminal describing
// a drier world than the one on screen.
var recDrain = /([\d.]+)% drained/.exec(jsonLine.summary);
var recWant = core.percentText(jsonLine.rivers / (jsonLine.width * jsonLine.height));
assert(!!recDrain && recDrain[1] + '%' === recWant,
  'the drained share rebuilds from the record (' +
  (recDrain ? recDrain[1] + '%' : 'nothing') + ' vs ' + recWant + ')');

// The record also names the look it was drawn with, so two worlds that share a
// seed and a grid but differ only in palette are still tellable apart from the
// JSON alone. Checked against a non-default palette to prove it is not a
// hardcoded 'terra'.
var palRec = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 40 --height 24 --palette sepia ' +
    '--json --out pal-check.ppm', {cwd: __dirname + '/..'}).toString().trim());
assert(palRec.palette === 'sepia' && jsonLine.palette === 'terra',
  'cli record names the palette it rendered (' + palRec.palette + ')');

// An overlay is also invisible in the summary sentence, so the record has to
// carry its key: a drained world and a moist one can share every other number.
var chanRec = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 40 --height 24 --channel drain ' +
    '--json --out chan-check.ppm', {cwd: __dirname + '/..'}).toString().trim());
assert(chanRec.channel === 'drain' && jsonLine.channel === '',
  'cli record names the overlay it flattened (' + chanRec.channel + ')');

// An overlay is a recolour of an already-classified world, so every count has
// to survive it. Checked through the CLI record rather than in memory, since
// the record is what a terminal reads back: the same seed through every named
// ramp must report the numbers the plain biome render does.
var chanPlain = JSON.parse(require('child_process')
  .execSync('node cli.js "salt mirror" --width 60 --height 40 --json ' +
    '--out chan-plain.ppm', {cwd: __dirname + '/..'}).toString().trim());
var chanDrift = [];
core.channels.forEach(function (ch) {
  if (!ch.key) return;
  var rec = JSON.parse(require('child_process')
    .execSync('node cli.js "salt mirror" --width 60 --height 40 --channel ' + ch.key +
      ' --json --out chan-' + ch.key + '.ppm', {cwd: __dirname + '/..'})
    .toString().trim());
  ['land', 'water', 'rivers', 'ice', 'lakeBasins', 'relief', 'biomes', 'checksum']
    // `trunks` belongs here too: an overlay recolours pixels, so the split of
    // the drainage network must not move either.
    .forEach(function (k) {
      if (rec[k] !== chanPlain[k]) chanDrift.push(ch.key + '.' + k);
    });
  if (rec.channel !== ch.key) chanDrift.push(ch.key + ' name');
});
assert(chanDrift.length === 0,
  'every overlay keeps the counts of its own world (' + chanDrift.join(', ') + ')');

// A .png name must produce a real PNG rather than a PPM with a new suffix:
// signature, then IHDR carrying the scaled size, then the image data. The
// pixels themselves are the same buffer the PPM writer emits, so the two
// encoders only differ in framing.
var pngOut = require('child_process')
  .execSync('node cli.js "salt mirror" --width 24 --height 12 --scale 2 ' +
    '--json --out png-check.png', {cwd: __dirname + '/..'}).toString().trim();
var pngName = JSON.parse(pngOut).file;
var pngBuf = require('fs').readFileSync(__dirname + '/../' + pngName);
var pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
var pngHeadOk = pngSig.every(function (b, si) { return pngBuf[si] === b; });
// The record keeps the grid as generated, so the scaled size is its own width
// and height times --scale: that is what the IHDR has to advertise.
var pngRec = JSON.parse(pngOut);
assert(pngHeadOk && pngBuf.toString('ascii', 12, 16) === 'IHDR' &&
  pngBuf.readUInt32BE(16) === pngRec.width * 2 &&
  pngBuf.readUInt32BE(20) === pngRec.height * 2 &&
  pngBuf.length > 40,
  'cli writes a real PNG when the name ends in .png (' +
  pngBuf.readUInt32BE(16) + 'x' + pngBuf.readUInt32BE(20) +
  ', ' + pngBuf.length + ' bytes)');

// The multiplier is the one part of the state that changes the file without
// changing a count, so the record has to carry it: the scaled IHDR above is
// only checkable from the JSON if the JSON says what the multiplier was.
assert(pngRec.scale === 2 && jsonLine.scale === 1,
  'cli record carries the export multiplier (' + pngRec.scale + ')');

// Both encoders read the same buffer, so the two files of one world must hold
// the same pixels: inflate the PNG's data stream and compare its rows against
// the PPM body, byte for byte. Checking the header alone would let a wrong
// filter byte or a truncated stream through — the picture would still be the
// right size and look wrong.
require('child_process').execSync(
  'node cli.js "salt mirror" --width 24 --height 12 --scale 2 --out round.ppm',
  {cwd: __dirname + '/..'});
// The PPM header is three whitespace-separated tokens (`P6`, the size, the
// maximum), so the body starts after the third one rather than after a fixed
// count of newlines.
var ppmBuf = require('fs').readFileSync(__dirname + '/../round.ppm');
var at2 = 0;
for (var tk = 0; tk < 3; tk++) {
  while (at2 < ppmBuf.length && ppmBuf[at2] === 0x0a) at2++;
  while (at2 < ppmBuf.length && ppmBuf[at2] !== 0x0a) at2++;
}
var ppmBody = ppmBuf.slice(at2 + 1);
// Walk the PNG chunks to the data stream, then undo the deflation and the
// per-scanline filter byte the writer emits.
var at = 8, idat = [];
while (at < pngBuf.length) {
  var clen = pngBuf.readUInt32BE(at);
  var ctype = pngBuf.toString('ascii', at + 4, at + 8);
  if (ctype === 'IDAT') idat.push(pngBuf.slice(at + 8, at + 8 + clen));
  at += 12 + clen;
}
var raw = require('zlib').inflateRawSync(Buffer.concat(idat));
var pngRows = Buffer.alloc(pngRec.width * pngRec.scale *
  pngRec.height * pngRec.scale * 3);
var pk = 0, rk = 0;
for (var ry = 0; ry < pngRec.height * pngRec.scale; ry++) {
  var filterByte = raw[rk++];
  for (var rx = 0; rx < pngRec.width * pngRec.scale * 3; rx++) {
    pngRows[pk++] = raw[rk++];
  }
  if (filterByte !== 0) pngRows = null;
}
assert(pngRows !== null && pngRows.length === ppmBody.length &&
  pngRows.equals(ppmBody),
  'both encoders write the same pixels (' + ppmBody.length + ' bytes of rgb)');

// The name the browser gives a saved PNG is built from six of these fields:
// seed, shape, palette, the grid, the multiplier and the checksum. A record
// that could not refill all six would leave a person holding a file they
// cannot trace back to a link, so each slot is filled from the record alone
// and asked to be non-empty — with the shape compared against the first word
// of the summary, which is where a terminal reads it.
var nameSlots = ['seed', 'palette', 'width', 'height', 'scale', 'checksum'];
var emptySlot = nameSlots.filter(function (nk) {
  return pngRec[nk] === undefined || pngRec[nk] === null || pngRec[nk] === '';
});
var nameShape = pngRec.summary.split(' · ')[0];
assert(emptySlot.length === 0 && /\w/.test(nameShape) &&
  core.shapes.map(function (sk) { return sk.key; }).indexOf(nameShape) >= 0,
  'a saved file name is rebuildable from the record (' +
  [nameShape].concat(nameSlots.map(function (nk) { return pngRec[nk]; }))
    .join('-') + ')');

// An empty seed box is not a fourth seed: it has to mean the same world as a
// blank `--seed` from a terminal. The generator names its own fallback, and the
// shell reads that same word in the two places a blank box reaches — the stats
// row and the saved file name. Compare the three by scraping each source, so a
// rename on one side shows up here rather than as a link and a PNG that
// describe two different worlds from one empty field.
var seedSrc = require('fs').readFileSync(__dirname + '/../src/core.js', 'utf8');
var coreSeed = (/opts\.seed == null \?\s*'([^']+)'/ .exec(seedSrc) ||
  ['', ''])[1];
var shellSeed = require('fs').readFileSync(__dirname + '/../app.js', 'utf8')
  .match(/inputs\.seed\.value \|\| '([^']+)'/g) || [];
var shellWords = shellSeed.map(function (s) {
  return /'([^']+)'/.exec(s)[1];
});
var seedSame = coreSeed !== '' && shellWords.length >= 2 &&
  shellWords.every(function (sw) { return sw === coreSeed; });
assert(seedSame,
  'a blank seed means one world everywhere (' + coreSeed + ' / ' +
  shellWords.join(',') + ')');

// The record holds the relief twice: once as a number of its own, once inside
// the summary sentence in brackets. Both come from the same difference in
// stats, so they must agree — a record saying `relief 74` above a sentence
// saying `rolling (52)` would make the two halves of one line disagree.
var reliefRec = JSON.parse(require('child_process')
  .execSync('node cli.js "red ridge" --shape fjord --width 100 --height 60 ' +
    '--json --out relief-check.ppm', {cwd: __dirname + '/..'}).toString().trim());
var reliefSaid = parseInt(/\((\d+)\)/.exec(reliefRec.summary)[1], 10);
assert(reliefSaid === reliefRec.relief &&
  reliefRec.relief === Math.round((function () {
    var rr = core.generate({seed: 'red ridge', shape: 'fjord', width: 100, height: 60});
    return (rr.stats.max - rr.stats.min) * 100;
  })()),
  'record relief matches the number in its sentence (' + reliefRec.relief + ')');

// The same row also carries the two ends of the range in brackets, which are
// the numbers printed at the corners of the relief chart. A record that only
// kept the spread could not reproduce those corners, so check the pair: each
// endpoint out of a hundred must be what the shell would print for it, and the
// row's own source must show both.
var endsWorld = core.generate({seed: 'red ridge', shape: 'fjord',
  width: 100, height: 60});
var endsSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
var endsOk = reliefRec.low === Math.round(endsWorld.stats.min * 100) &&
  reliefRec.high === Math.round(endsWorld.stats.max * 100) &&
  reliefRec.low < reliefRec.high;
var reliefRowSrc = (/relief',\s*([\s\S]{0,160}?)\],/.exec(endsSrc) ||
  ['', ''])[1];
var endsPrinted = reliefRowSrc.indexOf('.min') >= 0 &&
  reliefRowSrc.indexOf('.max') >= 0 && /\(/.test(reliefRowSrc);
assert(endsOk && endsPrinted,
  'the relief row carries both ends of the range (' + reliefRec.low + '-' +
  reliefRec.high + ')');

// The record also carries the bars themselves, which is what lets a pasted
// block of text profile be checked against a line of JSON. The array has to be
// the very pass the chart draws: one count per bin, every cell counted once,
// and the same numbers a fresh core pass produces at the sidebar's width.
var histRecWorld = core.generate({seed: 'red ridge', shape: 'fjord',
  width: 100, height: 60});
var histRecPass = core.histogram(histRecWorld, core.binCount(core.histWidth));
var histSum = reliefRec.hist.reduce(function (a, b) { return a + b; }, 0);
var histSame = reliefRec.hist.length === reliefRec.bins &&
  histSum === histRecWorld.stats.pixels &&
  reliefRec.hist.join(',') === histRecPass.hist.join(',') &&
  Math.max.apply(null, reliefRec.hist) === reliefRec.peak;
assert(histSame,
  'the record\'s bars are the chart\'s bars (' + reliefRec.hist.length +
  ' bins, ' + histSum + ' cells)');

// The median must sit inside the world's own range and really split the grid
// in half, which is the whole point of publishing it: the relief range on its
// own cannot tell a plateau from a plain with one peak. Same world as the
// record above, so the two numbers are comparable.
var medWorld = core.generate({seed: 'salt mirror', width: 120, height: 80});
var med = medWorld.stats.median;
var belowCount = 0;
for (var mi = 0; mi < medWorld.heightField.length; mi++) {
  if (medWorld.heightField[mi] <= med) belowCount++;
}
var belowShare = belowCount / medWorld.stats.pixels;
assert(med >= medWorld.stats.min && med <= medWorld.stats.max &&
  belowShare > 0.4 && belowShare < 0.6 &&
  Math.abs(med - jsonLine.median) < 0.002,
  'median splits the grid and matches the cli (' + Math.round(med * 100) +
  ' units, ' + Math.round(belowShare * 100) + '% below)');

// The record keeps the median to three decimals while the sidebar prints it
// out of a hundred, so the two only agree if the rounding survives that. That
// is the contract worth testing: a person with nothing but the JSON has to be
// able to write down the same number the `median` row shows. Checked across
// every phrase at one grid, since the middle cell of the sorted field moves
// with the size.
var medDrift = [];
core.phrases.forEach(function (ms) {
  var mrec = JSON.parse(require('child_process')
    .execSync('node cli.js "' + ms + '" --width 120 --height 80 --json ' +
      '--out median-drift.ppm', {cwd: __dirname + '/..'}).toString().trim());
  var mworld = core.generate({seed: ms, width: 120, height: 80});
  if (Math.round(mrec.median * 100) !== Math.round(mworld.stats.median * 100)) {
    medDrift.push(ms + ':' + Math.round(mrec.median * 100) + '/' +
      Math.round(mworld.stats.median * 100));
  }
});
assert(medDrift.length === 0,
  'the printed median is readable from the record (' + medDrift.join(', ') + ')');

// The basin count must agree with the lake cover it summarises: at least one
// basin when there is standing water, never more basins than lake cells, and
// none at all when the whole grid is open water.
var basinWorld = core.generate({
  seed: 'red ridge', shape: 'craton', seaLevel: 0.3, terraces: 6,
  width: 200, height: 120
});
var dryWorld = core.generate({seed: 'red ridge', seaLevel: 0.95, width: 200, height: 120});
var basinCells = basinWorld.stats.counts.lake || 0;
assert(basinCells > 0 && basinWorld.stats.lakeBasins >= 1 &&
  basinWorld.stats.lakeBasins <= basinCells &&
  dryWorld.stats.lakeBasins === 0 && (dryWorld.stats.counts.lake || 0) === 0,
  'basin count tracks the lake cover (' + basinWorld.stats.lakeBasins + ' basins in ' +
  basinCells + ' lake cells)');

// Every labelled basin also needs a bearing, since the readout pairs the two:
// one entry per basin, each a real compass point, and none for a world with no
// standing water.
var POINTS = 'N,NE,E,SE,S,SW,W,NW'.split(',');
var bearingsOk = basinWorld.basinSpill.length === basinWorld.stats.lakeBasins;
for (var bs = 0; bs < basinWorld.basinSpill.length && bearingsOk; bs++) {
  bearingsOk = POINTS.indexOf(basinWorld.basinSpill[bs]) >= 0;
}
assert(bearingsOk && dryWorld.basinSpill.length === 0,
  'each basin names the way its surplus leaves (' +
  basinWorld.basinSpill.join('/') + ')');

// Each basin marks exactly one rim cell as its outlet, and that cell must sit
// against the lake it drains: the readout pairs `outlet` with the neighbouring
// `basin N/M`, so a floating mark would be a lie. Two basins may share one
// seam, hence at most one mark per basin.
var bw = basinWorld, outlets = 0, touching = 0;
for (var oi = 0; oi < bw.spillway.length; oi++) {
  if (!bw.spillway[oi]) continue;
  outlets++;
  var ox = oi % bw.width, oy = (oi / bw.width) | 0;
  if ((ox > 0 && bw.lakeMask[oi - 1]) || (ox < bw.width - 1 && bw.lakeMask[oi + 1]) ||
    (oy > 0 && bw.lakeMask[oi - bw.width]) ||
    (oy < bw.height - 1 && bw.lakeMask[oi + bw.width])) touching++;
}
assert(outlets > 0 && outlets <= bw.stats.lakeBasins && touching === outlets,
  'every basin has one outlet on its own rim (' + outlets + ' of ' +
  bw.stats.lakeBasins + ')');

// The seam has to be dry ground: the readout prints a depth for a filled cell
// and the outlet note for its basin, and a mark sitting inside its own fill
// would print both at once while the catchment it carries stopped draining at
// the water's edge. Re-derived from the mask rather than trusted from the pick.
var wetMark = 0;
for (var wi2 = 0; wi2 < bw.spillway.length; wi2++) {
  if (bw.spillway[wi2] && bw.lakeMask[wi2]) wetMark++;
}
assert(wetMark === 0 && outlets > 0,
  'an outlet is dry land beside its lake (' + wetMark + ' wet marks of ' +
  outlets + ')');

// One terraced plateau world (a single wide tarn) and one with a crowd of small
// ones: both are used below, since a one-cell fill and a two-cell fill are two
// different ways a rim can be shared.
var manyBasin = core.generate({seed: 'red ridge', shape: 'fjord', width: 200, height: 120});

// The outlet is also where a basin's water goes on being a river: the fill's
// whole catchment is added to that cell's accumulation, so the mark has to
// stand at or above the count of cells that drained into it. A spillway that
// only recorded a bearing would leave the network reading as a chain of
// puddles — every shore cell counted, nothing below the lake. Walked on both a
// single tarn and a crowded one, since a shared rim cell is where a carried
// total could be written to the wrong cell.
function carriesCatchment(world) {
  var filled = {};
  for (var ci = 0; ci < world.basin.length; ci++) {
    if (world.basin[ci]) filled[world.basin[ci]] = (filled[world.basin[ci]] || 0) + 1;
  }
  for (var oi2 = 0; oi2 < world.spillway.length; oi2++) {
    var ob = world.spillway[oi2];
    if (!ob) continue;
    if (!(world.accumulation[oi2] >= filled[ob])) return false;
  }
  return true;
}
assert(carriesCatchment(bw) && carriesCatchment(manyBasin),
  'a basin drains into its outlet rather than stopping there (' +
  bw.stats.lakeBasins + ' + ' + manyBasin.stats.lakeBasins + ' basins)');

// The carried catchment only reads as drainage if the outlet is drawn: the
// river pass tests the accumulation of each cell against a quantile, and a
// small tarn on a wide plain fills a rim cell whose own count is far below
// that cut. The spillway mark is what keeps such a cell in the network, so
// every outlet that is still dry ground at the end has to carry a mask. Outlets
// that a later fill swallows are excluded — those are water by then, and the
// pass skips water on purpose. Counted rather than sampled, since one missing
// mark is the whole difference between a lake that drains and a puddle.
function outletsAreDrawn(world) {
  var seen = 0, drawn = 0;
  for (var di = 0; di < world.spillway.length; di++) {
    if (!world.spillway[di]) continue;
    if (world.heightField[di] < world.seaLevel) continue;
    if (world.lakeMask[di]) continue;
    seen++;
    if (world.riverMask[di] >= 1) drawn++;
  }
  return seen > 0 && drawn === seen;
}
assert(outletsAreDrawn(bw) && outletsAreDrawn(manyBasin),
  'every dry outlet is part of the drawn network (' +
  bw.stats.lakeBasins + ' + ' + manyBasin.stats.lakeBasins + ' basins)');

// The mark also carries the number of the basin it drains, since the readout
// prints both together. That number has to be one the neighbouring lake cells
// actually wear — an outlet naming the wrong tarn is worse than a bare one.
// Walked on both a one-basin world and a crowded one: with several tarns a rim
// cell can be shared by two fills, and the second label then overwrites the
// first — which only shows up as a mismatch when more than one basin is near.
function outletsNameTheirShore(world) {
  for (var ai = 0; ai < world.spillway.length; ai++) {
    if (!world.spillway[ai]) continue;
    var ax = ai % world.width, ay = (ai / world.width) | 0;
    var mine = world.spillway[ai];
    var agree = false;
    if (ax > 0 && world.basin[ai - 1] === mine) agree = true;
    if (ax < world.width - 1 && world.basin[ai + 1] === mine) agree = true;
    if (ay > 0 && world.basin[ai - world.width] === mine) agree = true;
    if (ay < world.height - 1 && world.basin[ai + world.width] === mine) agree = true;
    if (!agree) return false;
  }
  return true;
}
assert(outletsNameTheirShore(bw) && outletsNameTheirShore(manyBasin),
  'each outlet names a basin its own shore belongs to');

// The bearing and the mark are two arrays describing one fact: which way the
// surplus leaves. Recompute the compass point from the basin's own centroid to
// its marked outlet and compare, so a `drains E` in the readout has to agree
// with the rim cell it prints next to. Same eight buckets as the core, with y
// growing downwards.
var CENT = {};
for (var ci3 = 0; ci3 < bw.basin.length; ci3++) {
  if (!bw.basin[ci3]) continue;
  var cb = bw.basin[ci3];
  if (!CENT[cb]) CENT[cb] = {n: 0, x: 0, y: 0};
  CENT[cb].n++;
  CENT[cb].x += ci3 % bw.width;
  CENT[cb].y += (ci3 / bw.width) | 0;
}
var POINTS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function bearingsAgree(world) {
  var cent = {};
  for (var ci3 = 0; ci3 < world.basin.length; ci3++) {
    if (!world.basin[ci3]) continue;
    var cb = world.basin[ci3];
    if (!cent[cb]) cent[cb] = {n: 0, x: 0, y: 0};
    cent[cb].n++;
    cent[cb].x += ci3 % world.width;
    cent[cb].y += (ci3 / world.width) | 0;
  }
  var ok = true, seen = 0;
  for (var si2 = 0; si2 < world.spillway.length; si2++) {
    if (!world.spillway[si2]) continue;
    var sb = world.spillway[si2];
    var c = cent[sb];
    if (!c) { ok = false; continue; }
    var sdx = (si2 % world.width) - c.x / c.n;
    var sdy = ((si2 / world.width) | 0) - c.y / c.n;
    var sdeg = Math.atan2(sdy, sdx) * 180 / Math.PI + 90;
    var sstep = Math.round(sdeg / 45) % 8;
    if (sstep < 0) sstep += 8;
    seen++;
    if (world.basinSpill[sb - 1] !== POINTS8[sstep]) ok = false;
  }
  return ok && seen === world.stats.lakeBasins;
}
assert(bearingsAgree(bw) && bearingsAgree(manyBasin) && bw.stats.lakeBasins === 1 &&
  manyBasin.stats.lakeBasins > 4,
  'each bearing points from its lake to the marked outlet (' + bw.stats.lakeBasins +
  ' + ' + manyBasin.stats.lakeBasins + ' basins)');

// The outlet is supposed to be the LOWEST dry cell on its basin's rim — that is
// the whole reason a basin keeps draining after it fills. Walk every lake cell,
// keep the lowest dry neighbour of each, and check no such neighbour is lower
// than the cell that was actually marked. Also check the mark is not itself
// standing water: a spillway inside the lake would hold the surplus in.
var outletOf = {};
for (var wi = 0; wi < bw.spillway.length; wi++) {
  if (bw.spillway[wi]) outletOf[bw.spillway[wi]] = bw.heightField[wi];
}
var rimOk = true, rimDry = true, rimSeen = 0;
for (var ri = 0; ri < bw.basin.length; ri++) {
  if (!bw.basin[ri]) continue;
  var rx = ri % bw.width, ry = (ri / bw.width) | 0;
  var low = -1;
  if (rx > 0 && !bw.lakeMask[ri - 1]) low = ri - 1;
  if (rx < bw.width - 1 && !bw.lakeMask[ri + 1] &&
    (low < 0 || bw.heightField[ri + 1] < bw.heightField[low])) low = ri + 1;
  if (ry > 0 && !bw.lakeMask[ri - bw.width] &&
    (low < 0 || bw.heightField[ri - bw.width] < bw.heightField[low])) low = ri - bw.width;
  if (ry < bw.height - 1 && !bw.lakeMask[ri + bw.width] &&
    (low < 0 || bw.heightField[ri + bw.width] < bw.heightField[low])) low = ri + bw.width;
  if (low < 0) continue;
  rimSeen++;
  var marked = outletOf[bw.basin[ri]];
  if (marked === undefined) rimOk = false;
  else if (bw.heightField[low] > marked + 1e-9) rimOk = false;
}
for (var di = 0; di < bw.spillway.length; di++) {
  if (bw.spillway[di] && bw.lakeMask[di]) rimDry = false;
}
assert(rimSeen > 0 && rimOk && rimDry,
  'each outlet is the lowest dry cell on its rim (' + rimSeen + ' rims)');

// The labels a hover prints as `basin 2/4` have to cover every basin exactly:
// each lake cell carries a number in 1..lakeBasins, and each of those numbers
// appears at least once. A missing label would make the readout's denominator
// wrong, a stray one would point at a basin that does not exist.
var labelSeen = {};
var labelOk = true;
for (var li = 0; li < bw.basin.length; li++) {
  var lbNum = bw.basin[li];
  if (!lbNum) continue;
  if (lbNum > bw.stats.lakeBasins || !bw.lakeMask[li]) labelOk = false;
  labelSeen[lbNum] = 1;
}
var labelCount = Object.keys(labelSeen).length;
assert(labelOk && labelCount === bw.stats.lakeBasins,
  'every lake cell is labelled with its basin (' + labelCount + ' labels)');

// The readout pairs that label with a compass point, looked up as
// `basinSpill[basin - 1]`, so the two arrays have to be the same length and
// every entry has to be a real bearing. A short array would print `drains
// undefined` on the last lake in a crowded world; a stray entry would shift
// every bearing by one. Walked over a one-basin world and a crowded one, since
// the denominator in `basin 2/4` is the other half of the same pair.
var spillBad = [];
[bw, manyBasin].forEach(function (sw) {
  if (sw.basinSpill.length !== sw.stats.lakeBasins) {
    spillBad.push(sw.stats.lakeBasins + '!=' + sw.basinSpill.length);
  }
  for (var bi2 = 0; bi2 < sw.basinSpill.length; bi2++) {
    if (POINTS8.indexOf(sw.basinSpill[bi2]) < 0) {
      spillBad.push(bi2 + '->' + sw.basinSpill[bi2]);
    }
  }
});
assert(spillBad.length === 0 && bw.basinSpill.length === 1 &&
  manyBasin.basinSpill.length > 4,
  'every basin has one bearing to print (' + spillBad.join(', ') + ')');

// Those bearings are worth having at eight points rather than four, which only
// holds while the bucket is 45 degrees with the north offset applied. Coarsen
// either and a whole set of points goes unused: every lake would drain along an
// axis, and a rim that leaves to the north-east would print `drains N`. So walk
// every hand-picked world and require that all eight points show up somewhere.
var usedPoints = {};
var pointTotal = 0;
core.phrases.forEach(function (pk) {
  var pw = core.generate({seed: pk, shape: 'craton', width: 200, height: 130});
  for (var pi = 0; pi < pw.basinSpill.length; pi++) {
    usedPoints[pw.basinSpill[pi]] = 1;
    pointTotal++;
  }
});
var usedNames = Object.keys(usedPoints);
assert(pointTotal > 20 && usedNames.length === POINTS8.length,
  'spillways use the whole compass (' + usedNames.length + ' of ' +
  POINTS8.length + ' points, ' + pointTotal + ' basins)');

// The outlet marks are the third array in that trio, and they have to stay one
// per basin too: `result.spillway` holds the basin's own number, so a world
// with 42 tarns needs 42 marked rim cells and 42 distinct numbers among them.
// Two fills sharing one rim cell would leave one lake anonymous, and a mark
// that overflowed its array would do the same for every basin above 255. Walk
// the crowded world rather than a tidy one, since both failure modes need
// several basins to show.
var markSeen = {};
var markCount = 0;
for (var mi = 0; mi < manyBasin.spillway.length; mi++) {
  var mb = manyBasin.spillway[mi];
  if (!mb) continue;
  markCount++;
  markSeen[mb] = 1;
}
var markNames = Object.keys(markSeen).length;
var markInRange = true;
for (var mj = 1; mj <= manyBasin.stats.lakeBasins; mj++) {
  if (!markSeen[mj]) markInRange = false;
}
assert(markCount === manyBasin.stats.lakeBasins &&
  markNames === markCount && markInRange && manyBasin.stats.lakeBasins > 4,
  'every basin marks exactly one outlet cell (' + markCount + ' marks, ' +
  markNames + ' labels, ' + manyBasin.stats.lakeBasins + ' basins)');
// That mark is also the cap of the fill it belongs to: a basin holds water up to
// the height of its own outlet and no higher, so every labelled cell has to sit
// at or below the rim cell it drains through. Re-derive the outlet height per
// basin from the marks and compare each filled cell against it — a fill that
// climbed past its own spillway would be a lake that overflows on paper while
// the readout still promised `drains E`. Walked over every hand-picked phrase,
// since a wide plain and a crowded one cap their rims differently.
var fillAbove = 0, fillSeen = 0;
core.phrases.forEach(function (fp) {
  var fw = core.generate({seed: fp, width: 200, height: 120});
  var rim = {};
  for (var fi = 0; fi < fw.spillway.length; fi++) {
    if (fw.spillway[fi]) rim[fw.spillway[fi]] = fw.heightField[fi];
  }
  for (var fj = 0; fj < fw.basin.length; fj++) {
    var fb = fw.basin[fj];
    if (!fb) continue;
    fillSeen++;
    if (fw.heightField[fj] > rim[fb] + 1e-9) fillAbove++;
  }
});
assert(fillSeen > 0 && fillAbove === 0,
  'a basin fills to its own outlet and no higher (' + fillSeen + ' filled cells, ' +
  fillAbove + ' above their rim)');
// Within one basin the depth steps have to follow the ground: walk every pair of
// neighbouring lake cells and require that the lower of the two carries at least
// as deep a step. That is what makes the `N% deep` figure in the readout read as
// a bowl rather than as noise — a shore cell one unit higher than its neighbour
// must not claim more water over its head. Compared per pair rather than against
// the basin's own extremes, since a shallow rim and a deep centre are both fine
// as long as the two move in opposite directions.
var stepInv = 0, stepPairs = 0;
core.phrases.forEach(function (qp) {
  var qw = core.generate({seed: qp, width: 200, height: 120});
  var qn = qw.width, qm = qw.height;
  for (var qy = 0; qy < qm; qy++) {
    for (var qx = 0; qx < qn; qx++) {
      var qi = qy * qn + qx;
      if (!qw.basin[qi]) continue;
      var qnb = [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]];
      for (var qk = 0; qk < 4; qk++) {
        var qax = qnb[qk][0], qay = qnb[qk][1];
        if (qax < 0 || qay < 0 || qax >= qn || qay >= qm) continue;
        var qj = qay * qn + qax;
        if (qw.basin[qj] !== qw.basin[qi]) continue;
        if (qw.heightField[qi] === qw.heightField[qj]) continue;
        stepPairs++;
        if (qw.heightField[qi] < qw.heightField[qj] &&
          qw.lakeMask[qi] < qw.lakeMask[qj]) stepInv++;
      }
    }
  }
});
assert(stepPairs > 0 && stepInv === 0,
  'a lake gets deeper toward its own bottom (' + stepPairs + ' neighbour pairs, ' +
  stepInv + ' inverted)');
// Both halves of that pair are printed by the shell, from one array: the
// filled cells get `basin 2/4 — drains E`, the rim cell gets the same bearing
// beside its own number. Read the outlet branch out of the shell and ask that
// it names both, since a note that dropped the direction would leave the one
// cell that knows where the water goes saying less than its own shore.
var outSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
var outletSrc = (/if \(current\.spillway && current\.spillway\[i\]\)([\s\S]{0,300}?)\n    \}/
  .exec(outSrc) || ['', ''])[1];
assert(outletSrc.indexOf('basinSpill') >= 0 &&
  outletSrc.indexOf("drains ") >= 0 &&
  outletSrc.indexOf('current.spillway[i]') >= 0,
  'the outlet note names its basin and its bearing (' +
  outletSrc.replace(/\s+/g, ' ').trim().slice(0, 46) + ')');
// The bearing beside an outlet has to BE the bearing beside the water it
// drains from, and both halves of that pair are only guaranteed while each
// branch indexes `basinSpill` by its own basin number minus one. Two lookups
// with two different offsets would print one lake draining two ways, which no
// amount of re-reading the caption fixes. Count the sites as well, so a third
// opinion about the offset has to be written down here too.
var spillLook = (outSrc.match(/basinSpill\[[^\n]*?- 1\]/g) || []).length;
var shoreAt = outSrc.indexOf("if (current.basin && current.basin[i])");
var shoreSrc = shoreAt < 0 ? '' : outSrc.slice(shoreAt, shoreAt + 400);
var shoreLook = shoreSrc.indexOf('basinSpill[') >= 0 &&
  shoreSrc.indexOf('- 1]') >= 0;
assert(spillLook === 2 && shoreLook,
  'an outlet and its shore read one bearing (' + spillLook + ' lookups, shore ' +
  shoreLook + ')');
// A finger reports itself through pointer events rather than mousemove, so
// both canvases need a pointer path or a phone would show a map nobody can
// hover and a chart nobody can select. Each of those paths has to hand the
// event back to the mouse when the pointer says it IS a mouse, or one cursor
// move would paint the same frame twice. Count the guards with the handlers,
// so a third pointer listener cannot arrive without saying which half it is.
var pointerSites = (outSrc.match(/addEventListener\('pointer(?:move|down)'/g) || []).length;
var mouseGuards = (outSrc.match(/ev\.pointerType === 'mouse'/g) || []).length;
var mouseSites = (outSrc.match(/addEventListener\('mousemove'/g) || []).length;
assert(pointerSites === 2 && mouseGuards === pointerSites &&
  mouseSites === pointerSites,
  'both canvases answer a finger (' + pointerSites + ' pointer paths, ' +
  mouseGuards + ' guards, ' + mouseSites + ' mouse paths)');
// Moisture is not a standalone field: the orographic pass folds the relief
// into it by walking each row west to east, so a cell keeps more of what the
// air carried when it came in than after the next climb. That direction is the
// whole mechanism, and it shows up as an asymmetry — moisture follows the
// height of the cell upwind of it more closely than the one downwind. A
// symmetric smoothing would put both on the same footing, and a reversed sweep
// would swap the pair, so the comparison is worth keeping in both directions.
function corrOf(xs, ys) {
  var n = xs.length, i, mx = 0, my = 0, s = 0, sx = 0, sy = 0;
  for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  for (i = 0; i < n; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
    sx += (xs[i] - mx) * (xs[i] - mx);
    sy += (ys[i] - my) * (ys[i] - my);
  }
  return s / Math.sqrt(sx * sy);
}
var orroBad = [];
core.phrases.forEach(function (op) {
  var ow = core.generate({seed: op, shape: 'craton', width: 160, height: 100});
  var ow2 = ow.width, oh2 = ow.height;
  var m = [], up = [], dn = [];
  for (var oy = 0; oy < oh2; oy++) {
    for (var ox = 1; ox < ow2 - 1; ox++) {
      var oi = oy * ow2 + ox;
      m.push(ow.moisture[oi]);
      up.push(ow.heightField[oi - 1]);
      dn.push(ow.heightField[oi + 1]);
    }
  }
  var cu = corrOf(m, up), cd = corrOf(m, dn);
  if (!(cu > cd) || m.length < 1000) orroBad.push(op + ' ' + cu + '/' + cd);
});
assert(orroBad.length === 0,
  'moisture follows the side the air came from (' + orroBad.join('; ') + ')');
// The two axes of the biome lookup are only consulted on land: a water cell is
// named by its height alone, so `moist` and `temp` beside one would be two
// figures that never decided anything — and they sit ahead of the notes that do
// decide a shore cell. Read the dry branch out of the shell and require both
// numbers inside it, then count each push so neither can also live outside.
var axesAt = outSrc.indexOf('if (above) {');
var axesSrc = axesAt < 0 ? '' : outSrc.slice(axesAt, axesAt + 420);
var moistPush = (outSrc.match(/parts\.push\('moist '/g) || []).length;
var tempPush = (outSrc.match(/parts\.push\('temp '/g) || []).length;
assert(axesAt >= 0 && axesSrc.indexOf("moist ") >= 0 &&
  axesSrc.indexOf("temp ") >= 0 && moistPush === 1 && tempPush === 1,
  'the biome axes print where they are used (' + moistPush + ', ' + tempPush +
  ', window ' + axesSrc.length + ')');

// The hash is only useful if it carries every control on screen, so the two
// lists are checked against each other: each INPUT or SELECT id in the page
// must appear in HASH_KEYS, and every name in HASH_KEYS must be a real id.
// A control left out of the map would silently drop out of shared links.
var fs = require('fs');
var html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
var appSrc = fs.readFileSync(__dirname + '/../app.js', 'utf8');
var controlIds = [];
html.replace(/<(?:input|select)[^>]*id="([^"]+)"/g, function (m, id) {
  controlIds.push(id);
  return m;
});
var hashBlock = /var HASH_KEYS = \{([\s\S]*?)\n  \};/.exec(appSrc);
var hashNames = [];
if (hashBlock) {
  // The KEY of each pair is the element id, the value is the short name that
  // shows up in the URL, so the ids are what has to line up with the page.
  hashBlock[1].replace(/([A-Za-z]+)\s*:/g, function (m, name) {
    hashNames.push(name);
    return m;
  });
}
var unmapped = controlIds.filter(function (id) {
  return hashNames.indexOf(id) < 0;
});
var unknown = hashNames.filter(function (name) {
  return controlIds.indexOf(name) < 0;
});
assert(controlIds.length > 8 && hashNames.length > 8 &&
  unmapped.length === 0 && unknown.length === 0,
  'every control is carried by the hash (' + controlIds.length +
  ' controls, unmapped ' + unmapped.join(',') + ', extra ' + unknown.join(',') + ')');

// A link can carry the whole view, but only if a screen reader can name the
// parts it restores. Every control sits inside its own LABEL, so the visible
// caption is already its name; the two canvases and the hover readout are not
// labels at all, so each has to say what it is in the markup. Walk the four by
// id and ask each for the attribute that gives it a name.
var a11yBad = [];
['view', 'hist', 'readout'].forEach(function (aid) {
  var tag = new RegExp('<(canvas|span)[^>]*id="' + aid + '"[^>]*>')
    .exec(html);
  if (!tag) { a11yBad.push(aid + ' missing'); return; }
  if (aid === 'readout') {
    if (!/aria-live="polite"/.test(tag[0])) a11yBad.push(aid + ' silent');
    return;
  }
  if (!/role="img"/.test(tag[0]) || !/aria-label="[^"]{3,}"/.test(tag[0])) {
    a11yBad.push(aid + ' unnamed');
  }
});
// A caption can sit before its control, or after it when the field is a
// checkbox — both are inside the same LABEL, so both name it.
var captioned = (html.match(/<label class="field[^>]*>\s*(?:<input[^>]*>\s*)?<span>[^<]+/g) || []).length;
var fieldLabels = (html.match(/<label class="field/g) || []).length;
assert(a11yBad.length === 0 && fieldLabels === controlIds.length &&
  captioned === fieldLabels,
  'every control and canvas has a name a reader can speak (' +
  captioned + ' captions, ' + fieldLabels + ' labels, ' +
  a11yBad.join(', ') + ')');

// The short names are what a person reads back out of a pasted link, so each
// one has to point at exactly one control: two controls sharing `sea` would
// make a shared link ambiguous, and a name longer than four characters stops
// being readable in a hash that already carries fifteen pairs.
var shortNames = [];
if (hashBlock) {
  hashBlock[1].replace(/:\s*'([^']+)'/g, function (m, shortName) {
    shortNames.push(shortName);
    return m;
  });
}
var dupeShort = '';
var tooLong = '';
var seenShort = {};
shortNames.forEach(function (name) {
  if (seenShort[name]) dupeShort = name;
  seenShort[name] = 1;
  if (name.length > 5) tooLong = name;
});
assert(shortNames.length === hashNames.length &&
  dupeShort === '' && tooLong === '',
  'each hash name is short and unique (' + shortNames.length +
  ' names, dupe ' + dupeShort + ', long ' + tooLong + ')');

// The two pairs that are not form controls — the pinned legend class and the
// hovered cell — are written outside the HASH_KEYS loop, so nothing else
// guarantees that a link carrying them also restores them. Walk each name and
// ask for one write in `writeHash()` and at least one read in `applyHash()`:
// a pair that only ever goes out would make a shared link lose its selection
// on the second load, which is the whole reason the pair exists.
var extraPairs = ['pin', 'at'];
var writeBody = (/function writeHash\(\)([\s\S]*?)\n  \}/.exec(appSrc) || ['', ''])[1];
var applyBody = (/function applyHash\(\)([\s\S]*?)\n  \}/.exec(appSrc) || ['', ''])[1];
var oneWay = [];
extraPairs.forEach(function (name) {
  var pushed = (writeBody.match(new RegExp("parts\\.push\\('" + name + '=')) || []).length;
  var taken = (applyBody.match(new RegExp('fromUrl\\.' + name + '\\b')) || []).length;
  if (pushed !== 1 || taken < 1) oneWay.push(name + ':' + pushed + '/' + taken);
});
assert(oneWay.length === 0,
  'the non-control hash pairs round-trip (' + oneWay.join(', ') + ')');

// The form controls are carried by the loop rather than one line each, so the
// two things that could still break a link are the pair of encodings the loop
// agrees with itself about: a checkbox goes out as 1/0 and comes back as a
// comparison against '1', and a dropdown only takes a value its own list
// offers. Each half is one call in one function, so a rename on one side is
// caught here rather than as a link that reopens with the wrong look.
var writeCheck = (writeBody.match(/el\.checked \? 1 : 0/g) || []).length;
var readCheck = (applyBody.match(/value === '1'/g) || []).length;
assert(writeCheck === 1 && readCheck === 1,
  'a checkbox round-trips as 1 and 0 (' + writeCheck + '/' + readCheck + ')');
var staleGuard = (applyBody.match(/hasOption\(el, value\)/g) || []).length;
assert(staleGuard === 1,
  'a dropdown only takes a key its list offers (' + staleGuard + ')');

// The note under the chart is the only place the keyboard is documented, so
// every single-letter shortcut the shell handles must be named there. Pulled
// out of the handler with the same comparison it uses, then matched against
// the paragraph in the page.
var note = (/class="note">([\s\S]*?)<\/p>/m.exec(html) || ['', ''])[1];
var handled = {};
appSrc.replace(/ev\.key === '(.+?)'/g, function (m, keyName) {
  if (/^[A-Za-z]$/.test(keyName)) handled[keyName.toLowerCase()] = 1;
  return m;
});
// The other half of the handlers match with a regex instead of a comparison,
// The other half of the handlers match with a regex instead of a comparison —
// /^(d|D)$/ and friends — so both forms have to be walked or the count
// understates the key set. The first letter of the pair is the lowercase one.
appSrc.replace(/\(([A-Za-z])\|[A-Za-z]\)/g, function (m, keyName) {
  handled[keyName.toLowerCase()] = 1;
  return m;
});
var undocumented = Object.keys(handled).filter(function (keyName) {
  // Match the letter as its own token ("C cycles channels") rather than as a
  // letter inside any word, or the check would pass on prose alone.
  var re = new RegExp('(^|[\\s,])' + keyName.toUpperCase() + '([\\s,]|$)');
  return !re.test(note);
});
assert(Object.keys(handled).length > 8 && undocumented.length === 0,
  'the note names every shortcut key (' + Object.keys(handled).length +
  ' keys, missing ' + undocumented.join(',') + ')');

// Each of those letters has to answer in BOTH cases. With Caps Lock on the
// browser reports the uppercase form, so a shortcut written as a single
// comparison against the lowercase letter looks broken for reasons that have
// nothing to do with the map. Three shapes are acceptable: both comparisons, a
// `(x|X)` regex, or a `toLowerCase()` lookup. Walk the letters the note names
// and ask that each one is covered by one of them.
var keyBody = (/document\.addEventListener\('keydown', function \(ev\)([\s\S]*)$/
  .exec(appSrc) || ['', ''])[1];
var oneCase = [];
Object.keys(handled).forEach(function (lk) {
  var lower = lk.toLowerCase();
  var upper = lk.toUpperCase();
  var both = new RegExp("'" + lower + "'").test(keyBody) &&
    new RegExp("'" + upper + "'").test(keyBody);
  var pair = new RegExp('\\(' + lower + '\\|' + upper + '\\)').test(keyBody);
  if (!(both || pair || /toLowerCase\(\)/.test(keyBody))) oneCase.push(lower);
});
assert(oneCase.length === 0,
  'every shortcut letter answers in both cases (' + oneCase.join(',') + ')');

// The keys are only half of how the view is driven: a legend row and a chart
// bar are both reachable with a pointer, and neither has a letter of its own.
// The note is the only prose on the page, so each of those two has to be
// described there too — otherwise a first-time visitor sees a chart that
// responds to nothing they were told about.
var pointerNotes = [];
if (!/Click a legend row/.test(note)) pointerNotes.push('legend click');
if (!/[Hh]over or tap a bar/.test(note)) pointerNotes.push('chart hover');
assert(pointerNotes.length === 0,
  'the note covers the pointer paths too (' + pointerNotes.join(', ') + ')');

// The note also promises a digit range for the palettes ("1-9 pick a
// palette"), and that promise is only true while the list fits inside the
// advertised span: a tenth scheme would be unreachable by key while the note
// still said the digits were enough. Both halves are read from the page, so
// neither can drift from the other.
var span = /(\d)-(\d)\s+pick a palette/.exec(note);
var hi = span ? parseInt(span[2], 10) : 0;
var paletteCount = Object.keys(core.palettes).length;
assert(!!span && paletteCount <= hi && paletteCount >= parseInt(span[1], 10),
  'the digit range in the note reaches every palette (' + paletteCount +
  ' schemes, note says ' + (span ? span[1] + '-' + span[2] : 'nothing') + ')');

// Dropping a legend hover has to repaint through the same path that draws the
// crosshair, or the cell picked out of the hash loses its mark the moment the
// pointer crosses the list. Each clear site is a `solo = null;` followed by a
// repaint, so the pairs are counted and compared: one repaint per clear, and
// none of them the plain grid pass that would drop the mark.
var pairs = appSrc.match(/solo = null;\s*\w+\(\);/g) || [];
var plainRepaint = pairs.filter(function (pair) {
  return !/drawHover\(\)/.test(pair);
}).length;
assert(pairs.length >= 2 && plainRepaint === 0,
  'leaving a legend row keeps the picked cell marked (' + pairs.length +
  ' clear sites, ' + plainRepaint + ' without the hover repaint)');

// The map canvas is drawn in twelve different looks, so every colour the shell
// paints on it has to come from the palette in use: a fixed ink would read as a
// bright slab under a dark scheme. The chart in the sidebar keeps its own fixed
// ink on purpose — it sits on the page, not on the map — so only the assignments
// on the map context are walked here.
var literalInk = [];
appSrc.replace(/\bctx\.(?:fill|stroke)Style = ([^\n]*)/g, function (m, rhs) {
  if (/^['"]/.test(rhs.trim())) literalInk.push(rhs.trim());
  return m;
});
assert(literalInk.length === 0,
  'map overlay colours come from the palette (' + literalInk.join(' | ') + ')');

// The Copy button shows a short confirmation and then puts its own name back.
// Pressing it twice inside that window has to be one pending restore, not two:
// the second press clears the first timer before scheduling its own, otherwise
// the older callback wins and the button is left reading its feedback word
// forever. Both halves are checked on the function body itself.
var copyBody = (/function copyLink\(\) \{([\s\S]*?)\n  \}/.exec(appSrc) ||
  ['', ''])[1];
var timers = (copyBody.match(/setTimeout/g) || []).length;
var clears = (copyBody.match(/clearTimeout/g) || []).length;
assert(timers === 1 && clears === 1 &&
  copyBody.indexOf('clearTimeout(copyTimer)') >= 0 &&
  copyBody.indexOf('copyTimer = setTimeout') >= 0,
  'the copy button keeps one restore timer (' + timers + ' set, ' + clears +
  ' clear)');

// The stats list is the only trace of a world once it is printed or screenshotted,
// so it has to open with the thing every other number hangs off: the seed. Read
// the row labels straight out of the shell and check the order, plus that no label
// is repeated — two rows with one name would make the list ambiguous.
var rowsBlock = /var rows = \[([\s\S]*?)\n    \];/.exec(appSrc);
var rowLabels = [];
if (rowsBlock) {
  rowsBlock[1].replace(/\['([a-z ]+)'[,:]/g, function (m, label) {
    rowLabels.push(label);
    return m;
  });
}
var dupeRow = '';
var seenRow = {};
rowLabels.forEach(function (label) {
  if (seenRow[label]) dupeRow = label;
  seenRow[label] = 1;
});
assert(rowLabels.length > 10 && rowLabels[0] === 'seed' &&
  rowLabels[1] === 'grid' && dupeRow === '',
  'the stats list opens with the seed (' + rowLabels.slice(0, 3).join('/') +
  ', dupe ' + dupeRow + ')');

// Every number the sidebar prints has to be reachable from a terminal too,
// or a record cannot stand in for a screenshot. The two lists are named
// differently in places — the page says `grid`, the record says `width` — so
// the mapping is spelled out here and each side is then checked against it.
var ROW_TO_RECORD = {
  seed: 'seed', grid: 'width', export: 'scale', land: 'land', water: 'water',
  lake: 'lake', basins: 'lakeBasins', ice: 'ice', rivers: 'rivers',
  relief: 'relief', median: 'median', biomes: 'biomes',
  contours: 'contourBands', checksum: 'checksum', generate: 'ms'
};
var missingField = [];
rowLabels.forEach(function (label) {
  if (!ROW_TO_RECORD[label]) missingField.push(label);
});
var recordKeys = Object.keys(jsonLine);
var missingKey = [];
Object.keys(ROW_TO_RECORD).forEach(function (label) {
  if (recordKeys.indexOf(ROW_TO_RECORD[label]) < 0) {
    missingKey.push(label + '->' + ROW_TO_RECORD[label]);
  }
});
assert(missingField.length === 0 && missingKey.length === 0,
  'every sidebar row has a field in the cli record (' + rowLabels.length +
  ' rows, missing ' + missingField.concat(missingKey).join(',') + ')');

// One row carries two numbers rather than one: `contours` prints the land
// band count and the basin band count side by side, so the mapping above only
// names half of it. Both halves have to be printed by that row and both have
// to be in the record, or a terminal could reproduce the stripes on the
// highlands while saying nothing about the ones under the sea.
var contourFields = ['contourBands', 'basinBands'];
var contourMissing = contourFields.filter(function (field) {
  return recordKeys.indexOf(field) < 0;
});
var contourRowSrc = (/contours',\s*([\s\S]{0,120}?)\]/.exec(appSrc) ||
  ['', ''])[1];
var unprinted = contourFields.filter(function (field) {
  return contourRowSrc.indexOf('.' + field) < 0;
});
assert(contourMissing.length === 0 && unprinted.length === 0 &&
  /\//.test(contourRowSrc),
  'both halves of the contours row reach a terminal (' +
  contourMissing.concat(unprinted).join(',') + ')');

// The `rivers` row carries the same kind of pair — tributary cells and trunk
// cells — and the record keeps both as separate fields. The row's first number
// is a difference rather than a stored count, so check it is written as one:
// a row that printed only the trunk figure would still look plausible next to
// a `rivers` field that counts every cell in the network.
var riverFields = ['rivers', 'trunks'];
var riverMissing = riverFields.filter(function (field) {
  return recordKeys.indexOf(field) < 0;
});
var riverRowSrc = (/rivers',\s*([\s\S]{0,120}?)\]/.exec(appSrc) ||
  ['', ''])[1];
var riverUnprinted = riverFields.filter(function (field) {
  return riverRowSrc.indexOf('.' + field) < 0;
});
assert(riverMissing.length === 0 && riverUnprinted.length === 0 &&
  /\//.test(riverRowSrc) && riverRowSrc.indexOf('-') > 0,
  'both halves of the rivers row reach a terminal (' +
  riverMissing.concat(riverUnprinted).join(',') + ')');

// The tick spacing under the relief bars comes from the core, so the chart and
// this check share one formula. Two properties make a strip readable: the step
// has to be one of the offered candidates, and it has to leave at most ten
// marks over this world's own relief — one tick on a flat craton is as useless
// as twenty on a fjord. Walked over every shape, since each one sets its own
// relief range.
var tickBad = [];
core.shapes.forEach(function (tk) {
  var tw = core.generate({seed: 'pale shelf', shape: tk.key, width: 140, height: 90});
  var relief = (tw.stats.max - tw.stats.min) * 100;
  var step = core.tickStep(relief);
  var marks = Math.floor(relief / step);
  if (marks > 10 || relief / step < 2) tickBad.push(tk.key + ' ' + marks);
});
assert(tickBad.length === 0 && core.tickStep(15) === 5 && core.tickStep(500) === 50,
  'relief ticks stay between two and ten marks (' + tickBad.join(', ') + ')');

// Two more things that check is not yet asking. The first is that the chosen
// step is the SMALLEST candidate that still fits: a step that skipped a
// workable smaller one would space the ticks wider than the strip needs, and a
// chart could pass the count rule while reading coarser than it has to. So
// walk the candidate ladder by hand and compare the whole result. The second is
// that only the core holds that ladder: the shell must read it through the one
// lookup rather than keeping a copy of the numbers next to its own drawing
// code, which is where a second list would drift.
var LADDER = [5, 10, 20, 25, 50];
var ladderBad = [];
[7, 15, 48, 55, 96, 140, 300, 500, 900].forEach(function (un) {
  var want = LADDER[LADDER.length - 1];
  for (var li = 0; li < LADDER.length; li++) {
    if (un / LADDER[li] <= 10) { want = LADDER[li]; break; }
  }
  if (core.tickStep(un) !== want) ladderBad.push(un + '->' + core.tickStep(un));
});
var tickLookup = (appSrc.match(/TerraCore\.tickStep\(/g) || []).length;
var tickCopied = /5,\s*10,\s*20,\s*25,\s*50/.test(appSrc);
assert(ladderBad.length === 0 && tickLookup === 1 && !tickCopied,
  'ticks take the tightest step that fits, from one list (' +
  ladderBad.join(' ') + ', ' + tickLookup + ' lookups, copied ' +
  tickCopied + ')');

// The chart draws one vertical rule at the sea level, and the bars either side
// of it are the whole reading of the strip. That split has to track the counted
// water share: both follow the sea slider in the same direction, and the two
// figures stay in the same neighbourhood. A rule drawn from a second number —
// a fixed pixel, or the median instead of the sea level — would drift into a
// chart that reads opposite to the `water` row beside it.
var splitBad = [];
core.phrases.forEach(function (sp) {
  var prevBars = -1, prevWater = -1;
  [0.3, 0.48, 0.65].forEach(function (sl) {
    var sw3 = core.generate({seed: sp, width: 120, height: 80, seaLevel: sl});
    var bins = core.binCount(250);
    var lo = sw3.stats.min, span = Math.max(0.001, sw3.stats.max - lo);
    var wet = 0, bi;
    for (bi = 0; bi < bins; bi++) {
      if (lo + (bi + 0.5) / bins * span < sw3.seaLevel) wet++;
    }
    var barShare = wet / bins, waterShare = sw3.stats.water;
    if (barShare < prevBars - 1e-9 || waterShare < prevWater - 1e-9 ||
      Math.abs(barShare - waterShare) > 0.30) {
      splitBad.push(sp + ' ' + sl + ' ' + barShare.toFixed(2) + '/' +
        waterShare.toFixed(2));
    }
    prevBars = barShare; prevWater = waterShare;
  });
});
assert(splitBad.length === 0,
  'the sea rule splits the bars like the water count (' +
  splitBad.join('; ') + ')');

// The number of bars comes from the same place, for the same reason: the chart
// and this check have to agree on what a sidebar width buys. Three properties:
// a wider strip never gets fewer bars, the count stays inside the readable
// band, and the two ends of that band are actually reachable — a clamp that
// never engages is a constant wearing a formula's clothes.
var binWidths = [90, 100, 120, 160, 200, 240, 300, 360, 500, 900];
var binBad = [];
var binPrev = 0;
binWidths.forEach(function (bwpx) {
  var n = core.binCount(bwpx);
  if (n < binPrev || n < 20 || n > 72) binBad.push(bwpx + '->' + n);
  binPrev = n;
});
assert(binBad.length === 0 && core.binCount(90) === 20 && core.binCount(900) === 72 &&
  core.binCount(240) === 48,
  'bar count grows with the sidebar and stays inside its band (' +
  binBad.join(', ') + ')');

// The `export` row and the name of the saved file are two views of one number,
// so both have to come from the same lookup. A second parse of the dropdown in
// either path could disagree the moment the default changes — which is exactly
// the case the row exists to make visible. Checked as text: one definition, a
// call at each of the three sites, and the dropdown parsed in one place only.
var factorDefs = (appSrc.match(/function exportFactor\(\)/g) || []).length;
var factorUses = (appSrc.match(/exportFactor\(\)/g) || []).length - factorDefs;
var factorParses = (appSrc.match(/parseInt\(inputs\.scale\.value/g) || []).length;
assert(factorDefs === 1 && factorUses === 3 && factorParses === 1,
  'the export row and the file name share one factor lookup (' + factorDefs +
  ' def, ' + factorUses + ' uses, ' + factorParses + ' parse)');

// The legend is ordered biggest-class-first, and that order is what both the
// list and the `k` cycle walk. Rebuilt here from the same counts, the order has
// to be non-increasing and — for at least one world — actually differ from the
// order the palette declares its classes in. Otherwise the sort is doing no
// work and could silently be dropped, leaving a list that no longer starts
// with the class covering most of the grid.
var orderBad = [];
var orderDiffers = 0;
core.phrases.slice(0, 4).forEach(function (ok) {
  var ow = core.generate({seed: ok, width: 170, height: 100});
  var declared = Object.keys(ow.palette.colors).filter(function (dk) {
    return ow.stats.counts[dk];
  });
  var sorted = declared.slice().sort(function (sa, sb) {
    return ow.stats.counts[sb] - ow.stats.counts[sa];
  });
  for (var oi = 1; oi < sorted.length; oi++) {
    if (ow.stats.counts[sorted[oi]] > ow.stats.counts[sorted[oi - 1]]) {
      orderBad.push(ok + ' ' + oi);
    }
  }
  if (sorted.join(',') !== declared.join(',')) orderDiffers++;
});
var legendDefs = (appSrc.match(/function legendKeys\(/g) || []).length;
var legendUses = (appSrc.match(/legendKeys\(/g) || []).length - legendDefs;
assert(orderBad.length === 0 && orderDiffers > 0 && legendDefs === 1 &&
  legendUses >= 2,
  'legend rows sort by share and one lookup feeds both paths (' + orderDiffers +
  ' reordered, ' + legendDefs + ' def, ' + legendUses + ' uses)');

// Two classes can cover exactly the same number of cells, and then the only
// thing separating their rows is the tie-break. A sort that stops at the count
// difference leaves the pair in whatever order this engine's sort happens to
// produce, so the same seed can list its rows in two orders on two machines —
// and the `k` cycle, which walks the same array, walks them the other way. The
// shell breaks ties on the palette's own key order; rebuilt here with a plain
// insertion sort (stable by construction) over the declared keys, the result
// has to be the same list, and every tie has to be settled that way rather
// than left to chance.
function declaredOrder(world) {
  var names = Object.keys(world.palette.colors);
  var counts = world.stats.counts;
  var out = [];
  names.forEach(function (nk) {
    if (!counts[nk]) return;
    var at = out.length;
    while (at > 0 && counts[out[at - 1]] < counts[nk]) {
      out[at] = out[at - 1];
      at--;
    }
    out[at] = nk;
  });
  return out;
}
function legendOrderOf(world) {
  var names = Object.keys(world.palette.colors);
  var counts = world.stats.counts;
  return names.filter(function (k) { return counts[k]; }).sort(function (a, b) {
    return counts[b] - counts[a] || names.indexOf(a) - names.indexOf(b);
  });
}
// A real grid rarely hands two classes the same cell count, so the tied case is
// fed by hand: each fixture is one palette's keys with a deliberate tie in the
// middle. The insertion pass is stable by construction, so it shows what a
// count-only sort SHOULD produce on an engine that preserves input order, and
// the shell's lookup has to agree with it — plus with the same pair on a real
// world, where nothing ties and the count alone decides.
var tieFixtures = [
  {grass: 40, forest: 40, desert: 30, ice: 10},
  {lake: 12, grass: 12, forest: 12, rock: 5},
  {tundra: 9, shrub: 9, taiga: 9, rain: 9}
];
var tieRows = 0;
var tieBad = [];
tieFixtures.forEach(function (fc, fi) {
  var fw = {palette: core.palettes.terra, stats: {counts: fc}};
  var tcounts = fc;
  var tnames = Object.keys(fw.palette.colors).filter(function (fk) {
    return tcounts[fk];
  });
  for (var ti = 0; ti < tnames.length; ti++) {
    for (var tj = ti + 1; tj < tnames.length; tj++) {
      if (tcounts[tnames[ti]] === tcounts[tnames[tj]]) tieRows++;
    }
  }
  if (declaredOrder(fw).join(',') !== legendOrderOf(fw).join(',')) {
    tieBad.push('fixture ' + fi);
  }
});
core.phrases.forEach(function (tk) {
  var tw = core.generate({seed: tk, width: 150, height: 90});
  if (declaredOrder(tw).join(',') !== legendOrderOf(tw).join(',')) {
    tieBad.push(tk);
  }
});
var tieBreakSites = (appSrc.match(
  /counts\[b\] - counts\[a\] \|\| declared\.indexOf\(a\) - declared\.indexOf\(b\)/g) || []
).length;
assert(tieRows > 0 && tieBad.length === 0 && tieBreakSites === 1,
  'equal legend rows keep the palette order (' + tieRows + ' ties, ' +
  tieBad.join(',') + ', ' + tieBreakSites + ' tie-break)');

// A pinned row has to say so in text as well as in ink: the ring is a colour
// difference, which a screen reader reads as nothing. So each row also carries
// `aria-current`, and both halves of that pair — the ring's class and the
// attribute — are decided by ONE comparison of the row's key against the pin.
// Two views could otherwise disagree about which row is pinned after a rebuild,
// which is exactly when a keyboard user is looking. Counted: one write of the
// attribute, one write of the ring's class, and the shared comparison at each
// of its four sites — the two toggles that set the pin (click, Enter/Space) and
// the two reads that paint it. A fifth opinion about which row is on would have
// to be added here as well as in the shell.
var pinAttr = (appSrc.match(/setAttribute\('aria-current'/g) || []).length;
var pinTest = (appSrc.match(/pinned === key/g) || []).length;
var pinClass = (appSrc.match(/li\.className = 'on'/g) || []).length;
assert(pinAttr === 1 && pinClass === 1 && pinTest === 4,
  'a pinned legend row states its pin (' + pinAttr + ' attribute, ' +
  pinClass + ' class, ' + pinTest + ' comparisons)');

// The `k` cycle is a ring of the rows PLUS an empty slot, which is what the
// comment over the handler promises: a lap has to come back through "nothing
// pinned". Rebuilt here with the same arithmetic, one lap must show every class
// exactly once and land back on the empty state, so the cleared state is a stop
// on the ring rather than something only reachable before the first press. The
// step is the handler's own `+1`, and Shift is the same ring backwards.
var ringWorld = core.generate({seed: core.phrases[0], width: 170, height: 100});
var ringRows = Object.keys(ringWorld.palette.colors)
  .filter(function (rk) { return ringWorld.stats.counts[rk]; })
  .sort(function (ra, rb) {
    return ringWorld.stats.counts[rb] - ringWorld.stats.counts[ra];
  });
var ringSlots = ringRows.length + 1;
function ringStep(held, dir) {
  var ki = ringRows.indexOf(held || '');
  if (ki < 0) ki = ringSlots - 1;
  return ringRows[(ki + dir + ringSlots) % ringSlots] || null;
}
var ringSeen = {};
var ringNow = null;
for (var rn = 0; rn < ringSlots; rn++) {
  ringNow = ringStep(ringNow, 1);
  ringSeen[String(ringNow)] = (ringSeen[String(ringNow)] || 0) + 1;
}
var ringCovers = ringRows.every(function (ck) { return ringSeen[ck] === 1; });
assert(ringCovers && ringSeen.null === 1 && ringNow === null &&
  ringStep(null, -1) === ringRows[ringRows.length - 1] &&
  ringStep(ringStep(ringRows[0], 1), -1) === ringRows[0] &&
  ringStep(ringRows[0], -1) === null &&
  /var slots = rows\.length \+ 1;/.test(appSrc),
  'the k cycle is a ring of rows plus an empty slot (' + ringRows.length +
  ' rows, ' + ringSlots + ' slots, covers ' + ringCovers + ', back to empty ' +
  (ringNow === null) + ')');

// A pinned class is a filter over the grid, and a rebuild can drop that class:
// the legend is rebuilt from the classes that occur, so a pin left over from
// the previous grid would dim the whole map with no row left to release it.
// That is only a real hazard while some class really does disappear between two
// grids of one seed, so check the pair: find such a pair of grids, and ask that
// the rebuild consults the new counts for the held pin — exactly once, so a
// second opinion about when to forget cannot hide in another branch.
var stalePairs = 0;
var staleMissing = '';
core.phrases.forEach(function (sk2) {
  var small = core.generate({seed: sk2, width: 120, height: 70});
  var big = core.generate({seed: sk2, width: 240, height: 130});
  Object.keys(small.stats.counts).forEach(function (ck2) {
    if (!small.stats.counts[ck2]) return;
    if (!big.stats.counts[ck2]) { stalePairs++; staleMissing = ck2; }
  });
});
var staleGuard = (appSrc.match(
  /if \(pinned && !result\.stats\.counts\[pinned\]\) pinned = null;/g) || []
).length;
assert(stalePairs > 0 && staleGuard === 1,
  'a rebuild forgets a pin the new world cannot show (' + stalePairs +
  ' dropped classes, ' + staleGuard + ' guard, e.g. ' + staleMissing + ')');

// The same partition shows up in three places: the `biomes` row in the stats
// list, the rows of the legend, and the `classes` column of the record. All
// three count the classes that actually occur, so the numbers have to be equal
// for one world — and every counted class needs both a colour to draw it and a
// name to label its row, or a row would print a raw key or a blank swatch.
var partBad = [];
core.phrases.forEach(function (pk) {
  var pw = core.generate({seed: pk, width: 170, height: 100});
  var pc = pw.stats.counts;
  var counted = Object.keys(pc).filter(function (ck) { return pc[ck] > 0; });
  var rowsAgain = Object.keys(pw.palette.colors).filter(function (rk) {
    return pc[rk];
  });
  var bare = counted.filter(function (bk) {
    return !pw.palette.colors[bk] || !core.biomeNames[bk];
  });
  if (counted.length !== rowsAgain.length || counted.length < 6 || bare.length) {
    partBad.push(pk + ':' + counted.length + '/' + rowsAgain.length +
      '/' + bare.join('|'));
  }
});
var partDefs = (appSrc.match(/function biomeCount\(/g) || []).length;
var partUses = (appSrc.match(/biomeCount\(/g) || []).length - partDefs;
assert(partBad.length === 0 && partDefs === 1 && partUses >= 1 &&
  jsonPairs.length === jsonLine.biomes,
  'one partition feeds the row, the legend and the record (' +
  jsonLine.biomes + ' classes, ' + partDefs + ' def, ' + partUses + ' uses)');

// Turning a height into a chart bin happens in four places: the binning pass,
// the legend-members pass, the hovered-bin tally and the hover readout. Each
// has to agree with the others or the bar lit under a cursor is not the bar
// that counted the cell. Checked as text: one definition holding the clamp, and
// every site going through it rather than repeating the arithmetic.
var binDefs = (appSrc.match(/function binIndex\(/g) || []).length;
var binCalls = (appSrc.match(/binIndex\(/g) || []).length - binDefs;
// The clamp itself now sits in the core, beside the bin count and the tick
// step, so the shell only delegates. Read the core here rather than waiting
// for the variable further down this file.
var binCoreSrc = require('fs').readFileSync(__dirname + '/../src/core.js', 'utf8');
var binClamps = (binCoreSrc.match(/Math\.min\(bins - 1/g) || []).length;
var binHistDefs = (binCoreSrc.match(/function histogram\(/g) || []).length;
var binHistUses = (appSrc.match(/TerraCore\.histogram\(/g) || []).length;
assert(binDefs === 1 && binCalls >= 3 && binClamps === 1,
  'one height-to-bin mapping feeds the chart and the readout (' + binDefs +
  ' def, ' + binCalls + ' uses, ' + binClamps + ' clamp)');
// The whole binning pass is the core's too, so the bars a terminal counts from
// the record are the bars on screen: one definition, one call from the shell,
// and the counts have to add up to the grid the record lists.
var histSummed = core.histogram(jsonWorld, core.binCount(core.histWidth));
var histTotal = histSummed.hist.reduce(function (n, v) { return n + v; }, 0);
assert(binHistDefs === 1 && binHistUses === 1 &&
  histTotal === jsonWorld.stats.pixels &&
  histSummed.bins === jsonLine.bins && histSummed.peak === jsonLine.peak,
  'the relief bins are counted once, in the core (' + histSummed.bins +
  ' bars, peak ' + histSummed.peak + ', ' + histTotal + ' cells)');
// Summing to the grid is only the frame of that claim: a pass could move cells
// between columns and still add up. So re-tally each column with the same
// `binOf` the hover uses and compare the whole array, plus the two ends of the
// range the bins were cut over. That is what guarantees the bar lit under a
// cursor is the bar that counted the cell — a second rounding inside the pass
// would shift a cell one column while leaving the total untouched.
var histTallyBad = [];
core.phrases.forEach(function (hp) {
  var hw = core.generate({seed: hp, width: 200, height: 120});
  var hb = core.binCount(core.histWidth);
  var hh = core.histogram(hw, hb);
  var tally = [];
  for (var tn = 0; tn < hb; tn++) tally.push(0);
  for (var ti = 0; ti < hw.heightField.length; ti++) {
    tally[core.binOf(hw.heightField[ti], hh.lo, hh.span, hb)]++;
  }
  var hLo = Math.min.apply(null, hw.heightField);
  var hHi = Math.max.apply(null, hw.heightField);
  if (tally.join(',') !== hh.hist.join(',') ||
    hh.bins !== hb || hh.peak !== Math.max.apply(null, hh.hist) ||
    Math.abs(hh.lo - hLo) > 1e-6 || Math.abs(hh.span - (hHi - hLo)) > 1e-6) {
    histTallyBad.push(hp);
  }
});
assert(histTallyBad.length === 0,
  'every bar counts what its own lookup puts in it (' + histSummed.bins +
  ' columns, mismatched: ' + histTallyBad.join(',') + ')');
// The width those bins are counted over is one number too: the shell reads it
// as the fallback when its canvas has no layout yet, the CLI when it has no
// window at all. Both go through the core's lookup, so a text profile and the
// bars on screen cannot disagree about how many columns a sidebar buys.
var histCliSrc = require('fs').readFileSync(__dirname + '/../cli.js', 'utf8');
assert(/clientWidth \|\| TerraCore\.histWidth/.test(appSrc) &&
  (histCliSrc.match(/core\.binCount\(core\.histWidth\)/g) || []).length === 2,
  'one sidebar width feeds the chart and the text profile (' +
  core.histWidth + ' -> ' + histSummed.bins + ' bars)');
// The height of that same block is one number too. The profile stacks a fixed
// number of threshold rows, and a reader who has only a pasted block and one
// line of JSON has to be able to ask whether the block is complete — so the
// count lives beside the width, and the writer reads it rather than restating
// it. Counted on both sides: the core publishes one constant, the profile
// reads it once, and no second copy of the number is left in the writer.
var rowDefs = (binCoreSrc.match(/var HIST_ROWS = \d+;/g) || []).length;
var rowUses = (histCliSrc.match(/core\.histRows/g) || []).length;
var rowLiterals = (histCliSrc.match(/var rows = \d+;/g) || []).length;
assert(rowDefs === 1 && rowUses === 1 && rowLiterals === 0 &&
  core.histRows >= 2,
  'one row count feeds the profile and its reader (' + rowDefs + ' def, ' +
  rowUses + ' uses, ' + rowLiterals + ' literals, ' + core.histRows +
  ' rows)');

// The bin a hovered cell falls in has to survive the repaint that follows the
// hover: the readout records it, the grid pass reads it back, and leaving the
// map drops it again. Held in one variable with one write from the bin lookup,
// so no second copy can go stale while the chart is being redrawn.
var cellReadDefs = (appSrc.match(/var cellBand = -1;/g) || []).length;
var cellReadWrites = (appSrc.match(/cellBand = histBinFor\(/g) || []).length;
// The declaration also reads `cellBand = -1`, so the clear sites are matched at
// the start of their own line: that is a handler resetting the reading, not the
// variable being introduced.
var cellReadClears = (appSrc.match(/^\s+cellBand = -1;/gm) || []).length;
var cellReadShared = /band >= 0 \? band : cellBand/.test(appSrc);
assert(cellReadDefs === 1 && cellReadWrites === 1 && cellReadClears === 1 &&
  cellReadShared,
  'a hovered cell keeps its bar through the next repaint (' + cellReadDefs +
  ' def, ' + cellReadWrites + ' write, ' + cellReadClears + ' clear, shared ' +
  cellReadShared + ')');

// The readout also names the bin it just lit, so the pair has to be built from
// that same reading: a one-based number off `cellBand`, over the bin count the
// chart was binned with. A second denominator — a fixed bar count, or the raw
// zero-based index — would print a row the lit bar cannot match.
var bandLabels = (appSrc.match(/'band ' \+ \(cellBand \+ 1\)/g) || []).length;
var bandTally = /\+ '\/' \+ histState\.bins/.test(appSrc);
var bandFixed = /'band ' \+ \d+\/\d+/.test(appSrc);
assert(bandLabels === 1 && bandTally && !bandFixed,
  'the readout numbers the bar it lights (' + bandLabels + ' label, tally ' +
  bandTally + ', fixed ' + bandFixed + ')');

// The band label is a measurement rather than a position in a list, so both of
// its ends come from the range the chart was binned over. That arithmetic lives
// in one lookup — `bandSummary()` — which the chart caption, the hovered-cell
// note and the selected-band line all go through: two ends in the lookup, and a
// caller for each of the three views. A second copy of the division could round
// a bin against a different scale than the one that lit it, so the count of both
// is checked rather than either alone.
var bandDefs = (appSrc.match(/function bandSummary\(/g) || []).length;
var bandEnds = (appSrc.match(/\/ st\.bins \* st\.span/g) || []).length;
var bandCalls = (appSrc.match(/= bandSummary\(/g) || []).length;
var bandStray = (appSrc.match(/histState\.bins \* histState\.span/g) ||
  []).length;
var bandBracket = /'band ' \+ \(cellBand \+ 1\)[\s\S]{0,160}\+ '-' \+ hundred\(sum\.to\)/
  .test(appSrc);
// Four callers: the chart's own caption, the hovered-cell reading, the note
// under the map, and the pair that tells a hovered cell whether the selected
// bar covers it. The last one reads the SELECTED bin rather than the cell's
// own, so it cannot reuse the other result and has to be counted. The note is
// gated on a mismatch: when the two bins agree, the cell's own label already
// is the answer, so the note must not print a second copy of the same pair.
var bandInside = /'not in ' \+ \(band \+ 1\)/.test(appSrc);
var bandGate = /band >= 0 && histState && cellBand !== band/.test(appSrc);
assert(bandDefs === 1 && bandEnds === 2 && bandCalls === 4 && !bandStray &&
  bandBracket && bandInside && bandGate,
  'a lit bar says what height range it covers (' + bandDefs + ' lookup, ' +
  bandEnds + ' ends, ' + bandCalls + ' callers, stray ' + bandStray +
  ', bracket ' + bandBracket + ', note ' + bandInside + ', gate ' +
  bandGate + ')');

// A bin selected on the chart is a filter over the whole grid, so its reading
// also goes into the line under the map — that line is the only place the count
// is big enough to read. Every path that moves a filter has to refresh it: a
// pointer over the chart, a tap, a `Shift`+arrow walk, either pointer leaving,
// each of the three ways a legend pin is set or released, the legend's own
// hover and clear paths, and the rebuild that follows a resize or a slider
// step — a new grid changes every share in the legend, so the line beside it
// has to be rewritten too. Eleven sites, one definition, and the placeholder
// is restored by that same function rather than by a second write of the
// literal.
// The note also has to follow the same precedence the blit does: a pinned
// legend class beats a height band, so the line cannot describe a band while
// the map is fading everything that is not the pinned class. Both sides of that
// rule are read out of the source — the blit's own test and the note's.
var noteDefs = (appSrc.match(/function bandNote\(/g) || []).length;
var noteCalls = (appSrc.match(/bandNote\(\);/g) || []).length;
var notePlaceholder = (appSrc.match(/= 'hover the map'/g) || []).length;
var noteBody = (/function bandNote\(\)([\s\S]*?)\n  \}/.exec(appSrc) ||
  ['', ''])[1];
var notePrecedence = /var want = solo \|\| pinned;/.test(noteBody);
var blitPrecedence = /var want = solo \|\| pinned;/.test(appSrc);
// Three things read that pair, and only those three: the map blit, the chart's
// bars, the line under the map, and the hovered-cell reading. That last one is
// the shortest link from a faded cell back to the row that faded it, so it has
// to fold the pair the same way rather than notice only the hovered preview.
// A fifth would be a fifth opinion about which filter is in charge, which is
// what the shared expression exists to avoid. Counted rather than sampled, so
// a new reader has to be named here.
var readers = (appSrc.match(/var want = solo \|\| pinned;/g) || []).length;
var cellWants = (appSrc.match(/if \(want && key !== want\) \{/g) || []).length;
assert(noteDefs === 1 && noteCalls === 11 && notePlaceholder === 1 &&
  notePrecedence && blitPrecedence && readers === 4 && cellWants === 1,
  'a selected band is readable under the map (' + noteDefs + ' def, ' +
  noteCalls + ' sites, ' + notePlaceholder + ' placeholder, ' + readers +
  ' readers, note precedence ' + notePrecedence + ', blit ' +
  blitPrecedence + ')');

// The word beside a selected class also has to match what the map does with
// it. A clicked row keeps its class after the pointer moves — that one is
// pinned. A hovered row is a preview that the next mouse-move takes away, so
// the same word there would promise more than the state delivers. The note
// picks its word off `solo`, the preview half of the same pair the blit reads,
// so one lookup decides both the fade and the caption.
var wordGate = /\(solo \? '' : ' pinned'\)/.test(noteBody);
assert(wordGate,
  'the note only says pinned for a clicked row (' + wordGate + ')');

// The magnifier covers the map rather than tinting it, so the cell a hover
// picked has to be findable inside the panel: the mark is one patch cell,
// offset by the difference of the two clamped indices. Both halves of that are
// counted in `drawInset()`, since a mark at a fixed offset would sit on the
// wrong cell everywhere but one.
var insetDefs = (appSrc.match(/function drawInset\(/g) || []).length;
var insetMark = (appSrc.match(/dx \+ \(px - x0\) \* patch/g) || []).length;
var insetRows = (appSrc.match(/dy \+ \(py - y0\) \* patch/g) || []).length;
var insetGate = (appSrc.match(/if \(insetOn\) drawInset\(/g) || []).length;
assert(insetDefs === 1 && insetMark === 1 && insetRows === 1 && insetGate === 1,
  'the magnifier marks the cell it magnifies (' + insetDefs + ' def, ' +
  insetMark + '/' + insetRows + ' mark, ' + insetGate + ' gate)');

// The dark scheme is meant to change nothing but the colour variables, which
// only works if it replaces every one of them: a variable declared once in
// `:root` and left alone by the dark block would keep its light value under a
// dark background. Both blocks are read out of the stylesheet and compared by
// name, so a new variable cannot arrive on one side only.
var cssSrc = require('fs').readFileSync(__dirname + '/../styles.css', 'utf8');
var rootBlock = /:root\s*\{([\s\S]*?)\}/.exec(cssSrc);
var darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n\}/
  .exec(cssSrc);
function varNames(block) {
  var found = [];
  (block || '').replace(/(--[a-z-]+)\s*:/g, function (m, name) {
    if (found.indexOf(name) < 0) found.push(name);
    return m;
  });
  return found;
}
var rootVars = varNames(rootBlock && rootBlock[1]);
var darkVars = varNames(darkBlock && darkBlock[1]);
var halfSet = rootVars.filter(function (rv) {
  return darkVars.indexOf(rv) < 0;
});
assert(rootVars.length >= 4 && darkVars.length >= 4 && halfSet.length === 0,
  'the dark scheme restates every colour variable (' + darkVars.length +
  ' of ' + rootVars.length + ', unset ' + halfSet.join(',') + ')');

// The legend tint is the one place a colour is written twice over — a hue and
// its own alpha — so it is a variable rather than a literal in the rule. That
// is what lets the dark block raise both halves together, and it is why the
// hover rule is checked for the lookup instead of for a plausible rgba.
var tintRule = /\.legend li:hover,\s*\.legend li:focus\s*\{\s*background:\s*var\(--accent-soft\)/
  .test(cssSrc);
var tintDeclared = (cssSrc.match(/--accent-soft\s*:/g) || []).length;
assert(tintRule && tintDeclared === 2,
  'the legend tint reads a variable both schemes restate (' + tintRule +
  ', ' + tintDeclared + ' declarations)');

// The tint is only a wash of colour, which is hard to follow as a tab stop on
// a ten-row list, so focus also gets the inset ring a pinned row wears. Both
// are lookups rather than literals, which is what keeps the ring readable in
// either scheme without a third colour to keep in step.
var focusRing = /\.legend li:focus-visible\s*\{\s*box-shadow:\s*inset 0 0 0 1px var\(--accent\)/
  .test(cssSrc);
assert(focusRing,
  'a focused legend row shows a ring and not only the tint (' + focusRing + ')');

// The print block is the other half of the stylesheet's last two rules: it is
// meant to drop the chrome and keep the reading. So the two it exists to hide
// have to be in it, and the three that carry the numbers must not be — a
// printed page that lost the stats list would keep the picture and throw away
// every number behind it.
var printBlock = /@media print\s*\{([\s\S]*?)\n\}/.exec(cssSrc);
var printSrc = (printBlock && printBlock[1]) || '';
var hiddenInPrint = [];
printSrc.replace(/([^{}\n]+)\s*\{[^}]*display:\s*none/g, function (m, sel) {
  sel.split(',').forEach(function (one) {
    hiddenInPrint.push(one.trim().replace(/^[.#]/, ''));
  });
  return m;
});
var wantedHidden = ['controls', 'hist', 'note'];
var lostChrome = wantedHidden.filter(function (wh) {
  return hiddenInPrint.indexOf(wh) < 0;
});
var wantedShown = ['legend', 'stats', 'summary', 'view'];
var overHidden = wantedShown.filter(function (ws) {
  return hiddenInPrint.indexOf(ws) >= 0;
});
assert(printBlock !== null && lostChrome.length === 0 && overHidden.length === 0,
  'the print block drops the chrome and keeps the numbers (' +
  lostChrome.concat(overHidden).join(',') + ')');

// The sea level is the one number written in three places: the generator's own
// fallback, the value the shell puts in the box on first load, and the span the
// slider is allowed to move across. If the first two disagree, a link and a
// fresh page draw different worlds from one phrase; if the third is narrower
// than the other two, the browser clamps the number the core just chose. All
// three are read out of their own file and compared here.
var coreSrc = require('fs').readFileSync(__dirname + '/../src/core.js', 'utf8');
var coreSea = /seaLevel == null \?\s*([\d.]+)/.exec(coreSrc);
var shellSea = /inputs\.seaLevel\.value = '([\d.]+)'/.exec(appSrc);
var seaInput = /<input id="seaLevel"[^>]*>/.exec(html);
var seaMin = seaInput && /min="([\d.]+)"/.exec(seaInput[0]);
var seaMax = seaInput && /max="([\d.]+)"/.exec(seaInput[0]);
var seaStep = seaInput && /step="([\d.]+)"/.exec(seaInput[0]);
var seaNum = Number(shellSea && shellSea[1]);
assert(coreSea && shellSea && seaMin && seaMax && seaStep &&
  Number(coreSea[1]) === seaNum && seaNum >= Number(seaMin[1]) &&
  seaNum <= Number(seaMax[1]),
  'one sea default fits the slider it starts in (' +
  (coreSea && coreSea[1]) + ', ' + (shellSea && shellSea[1]) + ', ' +
  (seaMin && seaMin[1]) + '-' + (seaMax && seaMax[1]) + ')');

// The other sliders are the same shape of problem, so the same three-way read
// runs over each: the generator's fallback, the shell's first value, and the
// span in the markup. A `0.70` in the box against a `0.7` in the core is the
// same number and must not be reported as a mismatch, which is why every pair
// compares as a Number rather than as text.
var sliderBad = [];
['detail', 'polar', 'terraces', 'hillshade', 'rivers'].forEach(function (sName) {
  // The core's own fallback is read from its source rather than repeated here,
  // so the comparison stays core-vs-shell rather than a copy of either.
  var sCore = new RegExp('opts\\.' + sName +
    ' == null \\?\\s*([\\d.]+)').exec(coreSrc);
  var sShell = new RegExp('inputs\\.' + sName + '\\.value = \'([\\d.]+)\'')
    .exec(appSrc);
  var sInput = new RegExp('<input id="' + sName + '"[^>]*>').exec(html);
  var sMin = sInput && /min="([\d.]+)"/.exec(sInput[0]);
  var sMax = sInput && /max="([\d.]+)"/.exec(sInput[0]);
  if (!sCore || !sShell || !sMin || !sMax) {
    sliderBad.push(sName + ' unreadable');
  } else if (Number(sShell[1]) !== Number(sCore[1]) ||
    Number(sShell[1]) < Number(sMin[1]) ||
    Number(sShell[1]) > Number(sMax[1])) {
    sliderBad.push(sName + ' ' + sShell[1] + ' vs ' + sCore[1] + ' in ' +
      sMin[1] + '-' + sMax[1]);
  }
});
assert(sliderBad.length === 0,
  'every slider starts on the number its generator would pick (' +
  sliderBad.join('; ') + ')');
// The trunk/tributary split is a second quantile of the SAME accumulation
// field, so it has to behave like one cut: every trunk cell drains at least as
// much water as every tributary, and no cell carries a third kind of mark. A
// separate threshold on a second field would let a small headwater stream be
// drawn as a trunk while a wide lower course stayed thin, which is the one way
// this hierarchy can read as noise. Walked over every hand-picked phrase, since
// each one has its own catchment sizes.
var cutBad = [];
core.phrases.forEach(function (ck) {
  var cw = core.generate({seed: ck, width: 170, height: 100});
  var trunkLow = Infinity, minorHigh = -Infinity, stray = 0;
  var ci2, cm, ca;
  for (ci2 = 0; ci2 < cw.riverMask.length; ci2++) {
    cm = cw.riverMask[ci2];
    ca = cw.accumulation[ci2];
    if (cm === 2) {
      if (ca < trunkLow) trunkLow = ca;
    } else if (cm === 1) {
      if (ca > minorHigh) minorHigh = ca;
    } else if (cm !== 0) {
      stray++;
    }
  }
  if (stray || !(trunkLow >= minorHigh)) {
    cutBad.push(ck + ' ' + trunkLow + '/' + minorHigh + ' stray ' + stray);
  }
});
assert(cutBad.length === 0,
  'one accumulation cut splits trunks from tributaries (' +
  cutBad.join('; ') + ')');

// Both prose files are read in a terminal, where a sentence printed twice is a
// sentence the reader has to diff by eye. Each is checked for a line that is
// identical to the one above it — the shape a half-applied edit leaves behind —
// over every file that carries notes rather than code.
['README.md', 'AGENTS.md'].forEach(function (doc) {
  var dlines = require('fs').readFileSync(__dirname + '/../' + doc, 'utf8')
    .replace(/\r/g, '').split('\n');
  var dups = [];
  for (var di2 = 1; di2 < dlines.length; di2++) {
    var dcur = dlines[di2].trim();
    if (dcur.length > 20 && dcur === dlines[di2 - 1].trim()) {
      dups.push(di2 + 1);
    }
  }
  assert(dups.length === 0, doc + ' states each sentence once (' +
    dups.join(',') + ')');
});

console.log('\nsummary: ' + a.width + 'x' + a.height +
  ' land=' + Math.round(land * 100) + '% water=' + Math.round(water * 100) +
  '% rivers=' + a.stats.rivers + ' biomes=' + keys.length + ' in ' + a.stats.ms + 'ms');
