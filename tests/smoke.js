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
  if (big.width !== small.width * n || big.height !== small.height * n) scaleOk = false;
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

// The readout calls a water cell `off-shelf` at one fixed depth below the sea
// line, and the core calls the same cell `deep` at that same depth. Two numbers
// written in two files, so both are read out of their own source and compared,
// then walked over one world: every cell the readout would mark has to be a
// cell the core classified as deep, and vice versa. A pair that drifted apart
// would print a note about a class the legend does not list.
var shelfSrc = require('fs').readFileSync(__dirname + '/../src/core.js', 'utf8');
var shelfShellSrc = require('fs').readFileSync(__dirname + '/../app.js', 'utf8');
var shelfCore = /seaLevel - ([\d.]+) \? 'deep'/.exec(shelfSrc);
var shelfShell = /seaLevel - ([\d.]+)\) \{\s*\n?\s*parts\.push\('off-shelf'\)/
  .exec(shelfShellSrc);
var shelfWorld = core.generate({seed: 'salt mirror', width: 120, height: 70});
var shelfBad = 0;
for (var si = 0; si < shelfWorld.heightField.length; si++) {
  var sh = shelfWorld.heightField[si];
  var shWant = sh < shelfWorld.seaLevel - Number(shelfCore && shelfCore[1]);
  if (shWant !== (shelfWorld.biome[si] === 'deep')) shelfBad++;
}
assert(shelfCore && shelfShell && shelfBad === 0 &&
  Number(shelfCore[1]) === Number(shelfShell[1]),
  'the off-shelf note is the deep class (' + (shelfCore && shelfCore[1]) +
  ' vs ' + (shelfShell && shelfShell[1]) + ', ' + shelfBad + ' cells)');

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
  return [p.slice(0, at), parseInt(p.slice(at + 1), 10)];
});
var jsonTotal = jsonPairs.reduce(function (n, p) { return n + p[1]; }, 0);
assert(jsonPairs.length === jsonLine.biomes && jsonTotal >= 96 && jsonTotal <= 104,
  'cli class shares match the biome count (' + jsonPairs.length + ' classes, ' +
  jsonTotal + '%)');

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

// The mark also carries the number of the basin it drains, since the readout
// prints both together. That number has to be one the neighbouring lake cells
// actually wear — an outlet naming the wrong tarn is worse than a bare one.
var ownOk = true;
for (var ai = 0; ai < bw.spillway.length; ai++) {
  if (!bw.spillway[ai]) continue;
  var ax = ai % bw.width, ay = (ai / bw.width) | 0;
  var mine = bw.spillway[ai];
  var agree = false;
  if (ax > 0 && bw.basin[ai - 1] === mine) agree = true;
  if (ax < bw.width - 1 && bw.basin[ai + 1] === mine) agree = true;
  if (ay > 0 && bw.basin[ai - bw.width] === mine) agree = true;
  if (ay < bw.height - 1 && bw.basin[ai + bw.width] === mine) agree = true;
  if (!agree) ownOk = false;
}
assert(ownOk,
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
// One terraced plateau world (a single wide tarn) and one with a crowd of small
// ones: the centroid of a big fill and of a two-cell both have to land in the
// same compass bucket the core picked.
var manyBasin = core.generate({seed: 'red ridge', shape: 'fjord', width: 200, height: 120});
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
// differently — the page says `river cells`, the record says `rivers` — so the
// mapping is spelled out here and each side is then checked against it.
var ROW_TO_RECORD = {
  seed: 'seed', grid: 'width', export: 'scale', land: 'land', water: 'water',
  lake: 'lake', basins: 'lakeBasins', ice: 'ice', 'river cells': 'rivers',
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

// Turning a height into a chart bin happens in four places: the binning pass,
// the legend-members pass, the hovered-bin tally and the hover readout. Each
// has to agree with the others or the bar lit under a cursor is not the bar
// that counted the cell. Checked as text: one definition holding the clamp, and
// every site going through it rather than repeating the arithmetic.
var binDefs = (appSrc.match(/function binIndex\(/g) || []).length;
var binCalls = (appSrc.match(/binIndex\(/g) || []).length - binDefs;
var binClamps = (appSrc.match(/Math\.min\(bins - 1/g) || []).length;
assert(binDefs === 1 && binCalls >= 3 && binClamps === 1,
  'one height-to-bin mapping feeds the chart and the readout (' + binDefs +
  ' def, ' + binCalls + ' uses, ' + binClamps + ' clamp)');

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

console.log('\nsummary: ' + a.width + 'x' + a.height +
  ' land=' + Math.round(land * 100) + '% water=' + Math.round(water * 100) +
  '% rivers=' + a.stats.rivers + ' biomes=' + keys.length + ' in ' + a.stats.ms + 'ms');
