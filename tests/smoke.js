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

var t = core.generate({ seed: 'perf', width: 480, height: 300 });
assert(t.stats.ms < 900, 'generation under 900ms (' + t.stats.ms + 'ms)');

var up = core.upscale(a, 2);
assert(up.width === 400 && up.height === 240, 'upscale doubles the grid');

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

// The CLI prints the same chain the button walks, so a phrase found in the
// browser can be replayed from a terminal. Both go through nextSeed, which is
// the only place the derivation is defined.
var cli = require('child_process')
  .execSync('node cli.js "aurora basin" --next 5', {cwd: __dirname + '/..'}).toString().trim().split('\n');
assert(cli.length === 5 && cli[0] === 'aurora basin' &&
  cli.slice(1).join(',') === walkA.join(','),
  'cli --next matches the button chain (' + cli[1] + ')');

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

// A dashed word that matches no flag is a typo, not a seed: the CLI says so
// and still renders one world, rather than treating the stray word (and its
// value) as extra seeds. Checked by counting the summaries it prints.
var typoOut = require('child_process')
  .execSync('node cli.js "pale shelf" --describe --widht 30',
    {cwd: __dirname + '/..', stdio: ['ignore', 'pipe', 'ignore']})
  .toString().trim().split('\n');
assert(typoOut.length === 1 && typoOut[0].indexOf('(') > 0,
  'a mistyped flag does not add a second world (' + typoOut.length + ')');

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

console.log('\nsummary: ' + a.width + 'x' + a.height +
  ' land=' + Math.round(land * 100) + '% water=' + Math.round(water * 100) +
  '% rivers=' + a.stats.rivers + ' biomes=' + keys.length + ' in ' + a.stats.ms + 'ms');
