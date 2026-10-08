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

var t = core.generate({ seed: 'perf', width: 480, height: 300 });
assert(t.stats.ms < 900, 'generation under 900ms (' + t.stats.ms + 'ms)');

var up = core.upscale(a, 2);
assert(up.width === 400 && up.height === 240, 'upscale doubles the grid');

var terraced = core.generate({ seed: 'terraced', width: 165, height: 103, terraces: 8, rivers: 200 });
assert(terraced.stats.rivers > 0, 'terraced plateaus still drain (' + terraced.stats.rivers + ' cells)');

// Every shape must produce a usable map: non-degenerate land, and heights that
// actually span the range rather than collapsing to one value.
['continents', 'islands', 'atolls', 'craton', 'fjord'].forEach(function (shape) {
  var r = core.generate({ seed: 'shape ' + shape, width: 180, height: 110, shape: shape });
  var lo = 1, hi = 0;
  for (var si = 0; si < r.heightField.length; si++) {
    var hv = r.heightField[si];
    if (hv < lo) lo = hv;
    if (hv > hi) hi = hv;
  }
  assert(r.stats.land > 0.02 && r.stats.land < 0.99 && hi - lo > 0.2,
    shape + ' spans a real height range (land=' + Math.round(r.stats.land * 100) + '%)');
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

console.log('\nsummary: ' + a.width + 'x' + a.height +
  ' land=' + Math.round(land * 100) + '% water=' + Math.round(water * 100) +
  '% rivers=' + a.stats.rivers + ' biomes=' + keys.length + ' in ' + a.stats.ms + 'ms');
