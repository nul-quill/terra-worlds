/* Headless render: node cli.js "seed phrase" [--width 320] [--height 200]
   [--palette terra] [--shape continents] [--sea 0.48] [--out world.ppm] */
'use strict';

require('./src/core.js');
var core = globalThis.TerraCore;
var zlib = require('zlib');

function parseArgs(argv) {
  // The two sizes are deliberately absent here: the generator owns the default
  // grid, and a second copy of it in this object would be one more number to
  // keep in step. What is left for the CLI to decide is only the side a caller
  // did not name — see finishGrid.
  var opts = { seeds: [], unknown: [], out: 'world.ppm' };
  // A flag value that is not a number would otherwise reach the generator as
  // NaN, where every comparison against it is false: the sea level in
  // particular turns a whole world into dry land that way. Reading the number
  // through this helper leaves the option unset instead, so the generator's
  // own default applies and a mistyped value costs nothing but the typo.
  // One reader for both kinds: `Number` understands the exponent form a shell
  // may hand over (`1e3`), which `parseInt` would stop on the first non-digit
  // and read as `1`. It is also stricter about trailing junk — `800x` becomes
  // undefined rather than a quiet 800 — which is the behaviour this helper is
  // for: an unreadable value leaves the option unset so the generator's own
  // default stands. Integer flags round what they are given.
  function nextNum(value, isInt) {
    return core.readNumber(value, isInt);
  }
  // A key that no dropdown offers is a typo rather than a style: `--palette
  // terraa` would otherwise render the default scheme and look like the flag
  // was ignored. Naming it on stderr is the same treatment an unknown flag
  // gets, and leaving the option unset means the generator's default stands.
  function nextKey(value, keys) {
    if (value == null) return undefined;
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] === value) return value;
    }
    opts.unknown.push(value);
    return undefined;
  }
  // Whether the word after this flag is a value at all. A dashed word is the
  // next flag rather than this one's value, so a call that took it would both
  // drop that flag and report its own name as an unknown value. Every
  // value-taking flag below reads through this test, which is why the
  // `argv[++i]` advance stays at each call site: the test only says whether
  // the advance is allowed to happen.
  function hasVal(list, i) {
    return list[i + 1] != null && list[i + 1].charAt(0) !== '-';
  }
  // The keys a list of entries offers, in the list's own order. Three of the
  // core's lists are walked this way before the parser starts — shapes,
  // overlays and bearings — and each walk is the same map over the `key` of an
  // entry. Written beside each list the map could be edited apart: one could
  // drop its keyless first entry, which would let `--channel` reject the plain
  // biome map its own dropdown still names `biome`. The palettes are not part
  // of this pair — that list is a map of schemes, so its keys come from
  // `Object.keys` — which is why the walk stays a separate lookup rather than
  // a second body inside `nextKey`.
  function keyList(list) {
    return list.map(function (entry) { return entry.key; });
  }
  var PALETTE_KEYS = paletteKeys();
  var SHAPE_KEYS = keyList(core.shapes);
  var CHANNEL_KEYS = keyList(core.channels);
  var LIGHT_KEYS = keyList(core.lights);
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--width') opts.width = nextNum(hasVal(argv, i) ? argv[++i] : null, true);
    else if (a === '--height') opts.height = nextNum(hasVal(argv, i) ? argv[++i] : null, true);
    else if (a === '--palette') opts.palette = nextKey(hasVal(argv, i) ? argv[++i] : null, PALETTE_KEYS);
    else if (a === '--shape') opts.shape = nextKey(hasVal(argv, i) ? argv[++i] : null, SHAPE_KEYS);
    else if (a === '--sea') opts.seaLevel = nextNum(hasVal(argv, i) ? argv[++i] : null, false);
    else if (a === '--detail') opts.detail = nextNum(hasVal(argv, i) ? argv[++i] : null, false);
    else if (a === '--polar') opts.polar = nextNum(hasVal(argv, i) ? argv[++i] : null, false);
    else if (a === '--light') opts.hillshade = nextNum(hasVal(argv, i) ? argv[++i] : null, false);
    else if (a === '--dir') opts.lightDir = nextKey(hasVal(argv, i) ? argv[++i] : null, LIGHT_KEYS);
    else if (a === '--terraces') opts.terraces = nextNum(hasVal(argv, i) ? argv[++i] : null, true);
    else if (a === '--rivers') opts.rivers = nextNum(hasVal(argv, i) ? argv[++i] : null, true);
    else if (a === '--no-grain') opts.dither = false;
    else if (a === '--contour') opts.contour = true;
    else if (a === '--channel') opts.channel = nextKey(hasVal(argv, i) ? argv[++i] : null, CHANNEL_KEYS);
    else if (a === '--scale') opts.scale = nextNum(hasVal(argv, i) ? argv[++i] : null, true);
    else if (a === '--out') {
      // Same shape as the rest: a following flag is not this one's name, so
      // the default file name stands and the flag after `--out` still applies.
      // The value is taken as written rather than through a reader, since a
      // file name is not a number or a key from a list.
      if (hasVal(argv, i)) opts.out = argv[++i];
    }
    else if (a === '--seed') {
      // The bare word is still the shortest way to name a world; this form is
      // for the case where the phrase could be mistaken for a flag list, and
      // for scripts that pass every setting as a key. Same guard as the rest,
      // so `--seed --json` leaves the default phrase and still prints a
      // record. Each value is one seed, so several of these behave exactly
      // like several bare words.
      if (hasVal(argv, i)) opts.seeds.push(argv[++i]);
    }
    else if (a === '--describe') opts.describe = true;
    else if (a === '--hist') opts.hist = true;
    else if (a === '--next') opts.next = nextNum(hasVal(argv, i) ? argv[++i] : null, true) || 5;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--palettes') opts.palettes = true;
    else if (a === '--shapes') opts.shapes = true;
    else if (a === '--channels') opts.channels = true;
    else if (a === '--phrases') opts.phrases = true;
    else if (a === '--lights') opts.lights = true;
    else if (a === '--grids') opts.grids = true;
    else if (a === '--scales') opts.scales = true;
    else if (a === '--json') opts.json = true;
    else if (a.charAt(0) === '-') {
      opts.unknown.push(a);
      // Whatever followed was meant for this flag, so it should not become a
      // second seed: a typo should cost one word, not two worlds.
      if (argv[i + 1] && argv[i + 1].charAt(0) !== '-') i++;
    }
    else opts.seeds.push(a);
  }
  // A bare word is a seed; a dashed word that matched nothing is almost
  // always a typo, and swallowing it as a seed would render a world nobody
  // asked for. Saying so is cheaper than a surprise file.
  if (opts.unknown.length) {
    // The same list carries both kinds of typo: a dashed word the parser does
    // not know, and a key no dropdown offers. One note covers both, and the
    // two listings named here are where the valid spellings are.
    console.error('unknown flag or value: ' + opts.unknown.join(', ') +
      ' (--help lists the flags, --palettes and friends list their values)');
  }
  if (!opts.seeds.length) opts.seeds.push('terra');
  return opts;
}

// Fill whichever side of the grid a caller did not name, from the ratio of the
// two defaults. `--width 800` alone should be a wide landscape rather than an
// 800x300 letterbox, and `--height 200` alone should not be a tall column. Both
// sides named is left exactly as given.
function finishGrid(opts) {
  var w = typeof opts.width === 'number' && isFinite(opts.width);
  var h = typeof opts.height === 'number' && isFinite(opts.height);
  // The ratio comes from the generator's own default pair, so the shape a lone
  // size flag derives is the shape the generator would have chosen for itself.
  var def = core.defaultGrid;
  if (w && !h) {
    opts.height = Math.round(opts.width * def.height / def.width);
  } else if (h && !w) {
    opts.width = Math.round(opts.height * def.width / def.height);
  }
  return opts;
}

// A share or a level, kept to three decimals. The record stores its figures
// this way — finer than the out-of-a-hundred numbers the caption prints — so a
// terminal can rebuild a bar's column count from a saved line without losing a
// whole step to rounding. One helper for every field, since a share rounded two
// ways would describe a drier world in the JSON than on the page.
// The scaling itself is the core's, read the same way `hundred()` is: one
// division behind every fraction in the record, and the same one a reader of
// that line applies when it checks a share against the grid.
function three(value) {
  return core.three(value);
}

// Every listing prints a key column and then the words that explain it. The
// width behind that pair is one number, so a listing added later lines up with
// the ones already here instead of buying its own gap: six copies of a padding
// call could be edited apart while each listing still looked tidy on its own,
// and the pair of columns a reader scans would then stop lining up between one
// flag and the next. The numbered phrase column is a different shape — a count
// rather than a name — so it keeps its own narrow width beside its loop.
function listingRow(key, text) {
  return String(key).padEnd(11) + text;
}

// The keys of the scheme table, in the order the table declares them. That
// table is a map rather than a list of entries, so its walk is its own shape
// beside the three list walks in `keyList`. Three prints need it — the flag
// reader, the summary line under `--help` and the `--palettes` column — and
// each is the same call, so a scheme added to the core appears in all three at
// once. Written beside each print the walk could be edited apart, which reads
// as a name the flag accepts and the listing does not show.
function paletteKeys() {
  return Object.keys(core.palettes);
}

// What an entry with no key of its own is called. Two of the core's lists open
// with such an entry — the plain biome map among the overlays, the
// following-the-window count among the grids — and each list's own first label
// is the word every print uses, so the fallback comes from that entry rather
// than a second spelling of it. Copies of the word written beside each print
// could be edited apart while each listing still looked right on its own: a
// usage line naming `plain` above a column naming `biome` for one and the same
// overlay, or `default` beside `auto` for one and the same grid.
function entryName(list, entry) {
  return entry.key || list[0].label;
}

// Every name a list offers, on one line. The four lists the usage text echoes
// are that shape — a name per entry, in the order the page cycles them — so
// the comma and the walk are written once. Each list still decides its own
// names through `entryName`, which is what lets a keyless entry fall back to
// its list's own label rather than to a word spelled out beside one print.
// Written beside each echo the pair could be edited apart, which reads as two
// listings of one list: a usage line naming `plain` above a column naming
// `biome` for one and the same overlay.
function nameList(list, sep) {
  return list.map(function (entry) {
    return entryName(list, entry);
  }).join(sep || ', ');
}

// Every listing that walks one of the core's lists is this same pair of steps:
// one row per entry, its name taken through `entryName` so a keyless entry
// still prints a word beside its note. Written beside each flag the pair could
// be edited apart — one loop could drop the fallback, which leaves the plain
// biome map printing as a blank column under `--channels` while its own usage
// line still names it `biome`. The palette column stays outside this helper on
// purpose: its rows come from a map of schemes, so it keeps its own walk.
function listingDump(list) {
  list.forEach(function (entry) {
    console.log(listingRow(entryName(list, entry), entry.note));
  });
}

function toPpm(img) {
  var out = 'P6\n' + img.width + ' ' + img.height + '\n255\n';
  var chars = new Array(img.width * img.height * 3);
  var k = 0;
  for (var i = 0; i < img.data.length; i += 4) {
    chars[k++] = String.fromCharCode(img.data[i]);
    chars[k++] = String.fromCharCode(img.data[i + 1]);
    chars[k++] = String.fromCharCode(img.data[i + 2]);
  }
  return out + chars.join('');
}

// A .png name gets a real PNG: an 8-bit RGB scanline stream, deflated, behind
// the four standard chunks. Node's zlib does the compression, so there is no
// dependency and no second code path — the pixels come from the same buffer
// the PPM writer reads.
function crc32(buf) {
  var c, crc = 0xffffffff;
  for (var i = 0; i < buf.length; i++) {
    // Shift the whole register, not just the incoming byte: the byte is
    // folded in first, then eight rounds of the polynomial walk it through.
    c = crc ^ buf[i];
    for (var b = 0; b < 8; b++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc = c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var len = data.length;
  var out = Buffer.alloc(12 + len);
  out.writeUInt32BE(len, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.slice(4, 8 + len)), 8 + len);
  return out;
}

function toPng(img) {
  var w = img.width, h = img.height;
  var rows = Buffer.alloc(h * (1 + w * 3));
  var k = 0;
  for (var y = 0; y < h; y++) {
    rows[k++] = 0; // every scanline starts with its filter byte: none
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      rows[k++] = img.data[i];
      rows[k++] = img.data[i + 1];
      rows[k++] = img.data[i + 2];
    }
  }
  var head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;   // bits per channel
  head[9] = 2;   // colour type: truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', zlib.deflateRawSync(rows, {level: 9})),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

var opts = parseArgs(process.argv.slice(2));
finishGrid(opts);

// Every printed world is built from the parsed flags with one seed on top, so
// the copy is one function: a flag added to the parser then reaches the plain
// listing, the `--next` chain and every form of both at once, rather than only
// the branch someone happened to edit. Listing the keys by hand in each place
// is how one form ends up rendering without a flag the others honour.
function runWorld(seed) {
  var runOpts = {};
  Object.keys(opts).forEach(function (k) { runOpts[k] = opts[k]; });
  runOpts.seed = seed;
  return core.generate(runOpts);
}

if (opts.help) {
  console.log('usage: node cli.js "<seed>" [--width n] [--height n] [--palette name]');
  // The two sizes are the only flags where one value changes the other, so the
  // rule is stated where a terminal reads it rather than left for the source.
  console.log('       a lone --width or --height keeps the default aspect: the');
  console.log('       side you leave out is filled from the ratio of the two');
  console.log('       defaults, so --width 800 is a wide landscape not a strip;');
  console.log('       name both sizes to override that.');
  // The shape keys are read from the generator's list rather than repeated
  // here, so adding a curve in core.js shows up in this listing too.
  console.log('       [--shape ' + nameList(core.shapes, '|') + '] [--sea 0..1]');
  console.log('       [--detail 0..1] [--polar 0..1] [--light 0..1]');
  // Like the shape list above, the bearings come from the generator's own
  // array, so a new compass point appears in the usage line without a second
  // edit here.
  console.log('       [--dir ' + nameList(core.lights, '|') +
    '] for the hillshade light bearing,');
  console.log('       [--terraces n] [--rivers n] [--out file.ppm]');
  console.log('       [--contour] for hypsometric lines on land and bathymetric');
  console.log('       steps under water, both spaced by this world\'s relief');
  // Same rule as the two lists above: the overlay keys are read from
  // core.channels, so a ramp added there is immediately nameable from a
  // terminal. The empty-key entry is shown as 'biome', which is what the
  // dropdown calls it.
  console.log('       [--channel ' + nameList(core.channels, '|') +
    '] to flatten');
  console.log('       the world to one scalar field instead of the biome colours');
  console.log('       [--scale n] nearest-neighbour multiplier applied to the');
  console.log('       saved pixels, so a small grid can still fill a screen');
  console.log('       [--describe] to print only the one-line summary and skip');
  console.log('       the .ppm file entirely; with several seeds each line');
  console.log('       also carries its own seed');
  console.log('       [--hist] to add the relief profile as text bars under the');
  console.log('       summary, binned the way the sidebar chart bins it');
  console.log('       [--next n] with one seed to print that seed plus the n-1 seeds');
  console.log('       the Reroll button derives from it, one per line; with');
  console.log('       [--json] each line of that chain is a full record');
  console.log('       [--no-grain] to skip the Bayer dither on the shading');
  console.log('       [--seed phrase] names a world the way a bare word does,');
  console.log('       for a call that already passes every other setting as a');
  console.log('       key; repeat it for several worlds, exactly as several');
  console.log('       bare words would');
  console.log('       [--palettes] to list the palette keys and their labels');
  console.log('       [--shapes] to list the shape keys and what each one cuts');
  console.log('       [--channels] to list the overlay keys and the field each');
  console.log('       one reads, in the order the c key cycles them');
  console.log('       [--phrases] to list the hand-picked seed phrases the p key');
  console.log('       walks, one per line, ready to paste after this command');
  console.log('       [--lights] to list the light bearings --dir takes');
  console.log('       [--grids] to list the column counts the grid dropdown pins');
  console.log('       [--scales] to list the export multipliers --scale takes');
  console.log('       [--help] prints this listing, so a terminal can find');
  console.log('       the flags without opening the source; -h does the same');
  console.log('       several seeds at once are fine: each gets its own file');
  console.log('       (--out becomes a prefix), and [--json] prints one line of');
  console.log('       JSON per world instead of the table');
  // One rule covers every value-taking flag, so it is stated once here rather
  // than beside each of them: a dashed word after a flag belongs to that next
  // flag, which is why `--out --json` and `--palette --json` both keep their
  // own defaults and still print a record.
  console.log('       a value is optional when the next word is itself a flag:');
  console.log('       that word belongs to the next flag, so [--out --json]');
  console.log('       keeps world.ppm and [--palette --json] the default');
  console.log('       scheme, both still printing JSON');
  console.log('palettes: ' + paletteKeys().join(', '));
  console.log('channels: ' + nameList(core.channels));
  console.log('lights: ' + nameList(core.lights));
  console.log('grids: ' + nameList(core.grids));
  console.log('scales: ' + nameList(core.scales));
} else if (opts.grids) {
  // The column counts the grid dropdown pins, in the order the `w` key walks
  // them. Each is a --width that keeps a world's cell count stable across
  // window sizes; "auto" is the one that follows the window instead.
  listingDump(core.grids);
} else if (opts.scales) {
  // The multipliers --scale takes, in the order the `e` key walks them. Each
  // one only enlarges the saved pixels, so the world behind them is identical.
  listingDump(core.scales);
} else if (opts.lights) {
  // The bearings --dir accepts, with the words the dropdown shows. Same list
  // the shade pass reads, so a key copied here is always valid.
  listingDump(core.lights);
} else if (opts.palettes) {
  // One row per palette: the key that --palette takes, plus the label the
  // dropdown shows and the sky triple the chart is washed with. Names only,
  // so it is cheap to eyeball before choosing a scheme for a render.
  paletteKeys().forEach(function (name) {
    var p = core.palettes[name];
    console.log(listingRow(name, p.label + '  sky ' + p.sky));
  });
  } else if (opts.shapes) {
    // Same idea for the shape curve: the key --shape takes, plus a short note
    // on what the curve does to the height field. Both lists are read from the
    // generator, so a name copied from here is always valid.
    listingDump(core.shapes);
} else if (opts.channels) {
  // The overlay ramps in the order the dropdown and the `c` key walk them.
  // The empty key is the plain biome map, which prints as "biome" so the
  // line is never a blank column.
  listingDump(core.channels);
} else if (opts.phrases) {
  // The hand-picked seed phrases the `p` key walks. Each one is a whole
  // world in two words, so this is the shortest way to a good first render.
  core.phrases.forEach(function (p, i) {
    console.log(String(i + 1).padEnd(3) + p);
  });
} else {
  var fs = require('fs');
  // --next is the seed-chain dump: the first seed plus the n seeds derived
  // from it, which is exactly the sequence the Reroll button walks. Handy for
  // reproducing a favourite run of clicks from a single phrase.
  if (opts.next) {
    var chainSeed = opts.seeds[0];
    var chain = [chainSeed];
    for (var cn = 1; cn < opts.next; cn++) {
      chainSeed = String(core.nextSeed(chainSeed));
      chain.push(chainSeed);
    }
    // With --describe each seed also gets its one-line summary, which is how
    // to pick a world out of a chain without opening the page.
    if (opts.describe) {
      console.log(chainRows(chain, function (s) {
        var r = runWorld(s);
        return s + '  ' + core.describe(r) +
          (opts.hist ? '\n' + histBlock(r) : '');
      }));
    } else if (opts.json) {
      // One record per seed in the chain, in the order the Reroll button
      // visits them. This is how to compare a run of clicks from a terminal:
      // the plain listing gives the phrases, this gives the numbers behind
      // each of them, and the `seed` field ties a record back to its line.
      console.log(chainRows(chain, function (s) {
        var r = runWorld(s);
        return summarise(s, r, opts.out, true);
      }));
    } else {
      // The bare listing is the phrase per seed; with --hist each phrase also
      // carries the silhouette behind it, so a run of clicks can be skimmed
      // from a terminal without opening the page.
      console.log(chainRows(chain, function (s) {
        if (!opts.hist) return s;
        return s + '\n' + histBlock(runWorld(s));
      }));
    }
    return;
  }
  opts.seeds.forEach(function (seed, si) {
    var result = runWorld(seed);
    if (opts.channel) {
      var chan = core.channelize(result, opts.channel);
      result.data = chan.data;
    }
    // With several seeds the output name becomes a prefix, so nothing is
    // silently overwritten.
    // --describe is the quick look: no file, just the sentence. The stats in
    // the sentence come from the grid as generated, before any upscale.
    if (opts.describe) {
      // One seed: just the sentence. Several: each line also names its seed, so
      // a block of summaries can still be traced back to a phrase — the same
      // shape `--next --describe` prints.
      var saidLine = core.describe(result);
      console.log(opts.seeds.length > 1 ? seed + '  ' + saidLine : saidLine);
      if (opts.hist) console.log(histBlock(result));
      return;
    }
    // The extension picks the encoder: .png gets the PNG writer, anything
    // else the plain PPM one. With several seeds the name becomes a prefix,
    // and the suffix keeps whichever extension was asked for.
    var ext = /\.png$/i.test(opts.out) ? 'png' : 'ppm';
    // The extension is optional, so the split has to work without one too:
    // a prefix written as `map` still needs a number per world, and dropping
    // the suffix whenever no dot is present would let every world after the
    // first overwrite the one before it.
    var name = opts.seeds.length > 1
      ? opts.out.replace(/\.(ppm|png)$/i, '') + '-' + (si + 1) + '.' + ext
      : opts.out;
    // The grid stays as generated for the stats; only the saved pixels grow.
    var img = opts.scale > 1 ? core.upscale(result, opts.scale) : result;
    // The PPM body is a one-byte-per-channel string, so it needs the latin1
    // range kept intact; the PNG is already a Buffer.
    if (ext === 'png') fs.writeFileSync(name, toPng(img));
    else fs.writeFileSync(name, toPpm(img), 'latin1');
    console.log(summarise(seed, result, name, opts.json));
    // The record already carries `bins` and `peak`; this is the shape those two
    // numbers describe, for a terminal with no chart to draw into. With
    // `--json` the record is the whole output — one line per world is what
    // makes it pipeable — and those two fields are enough to redraw this.
    if (opts.hist && !opts.json) console.log(histBlock(result));
  });
}

// Which columns the two ruler marks fall in. Both readers of that pair — the
// text ruler below and the record's `seaCol`/`medCol` — go through here, so a
// mark is never placed against one range in one form and another in the next.
function rulerMarks(result, h) {
  return {
    sea: core.binOf(result.seaLevel, h.lo, h.span, h.bins),
    med: core.binOf(result.stats.median, h.lo, h.span, h.bins)
  };
}

// The relief profile as text: six rows of blocks over the same bins the
// sidebar chart draws, so a saved PNG plus one line of JSON can still be
// redrawn by eye. The bins come from `core.histogram` at the sidebar's own
// width, which is what ties these columns to the bars on screen.
// The relief bins for one world, at the width the sidebar draws into. Both
// readers of that pass — the text profile and the record — go through here, so
// the bars a terminal counts from the record are the bars the block above the
// caption shows, and the width behind the column count is written once.
function histPass(result) {
  return core.histogram(result, core.binCount(core.histWidth));
}

// The profile as one string. Every printed form that stacks a silhouette —
// each branch of the chain and the plain per-seed loop — reads this rather
// than joining the rows itself, so a block cannot be assembled with one
// separator in one form and another in the next.
function histBlock(result) {
  return profile(result).join('\n');
}

// One block for a whole seed chain: a line per seed, in the order the Reroll
// button walks them. Each printed form of the chain — the sentences, the
// records, the bare listing — is that shape, so the walk and its join are
// written once and only the mapping differs. Beside each branch the join
// could be edited apart, which would leave one form running its seeds
// together while the others still kept a line each.
function chainRows(chain, line) {
  return chain.map(line).join('\n');
}

function profile(result) {
  var h = histPass(result);
  // The row count is the profile's own constant rather than a number written
  // here, so a reader who has the block and the record can ask the core how
  // many rows the block should have instead of counting them off.
  var rows = core.histRows;
  var lines = [];
  for (var r = 0; r < rows; r++) {
    var level = (rows - r) / rows;
    var line = '';
    for (var i = 0; i < h.bins; i++) {
      var frac = h.peak ? h.hist[i] / h.peak : 0;
      line += frac >= level ? '#' : ' ';
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  // Under the bars: where the sea sits among the columns, then the two ends of
  // the range the bins were cut over — the same figures the chart prints. The
  // median gets a second mark, since the spread alone cannot say whether a
  // world is a plateau or a peak squeezed between two ends.
  var marks = rulerMarks(result, h);
  var seaCol = marks.sea;
  var medCol = marks.med;
  var ruler = '';
  for (var c = 0; c < h.bins; c++) {
    // A world whose middle sits exactly on its shoreline gets one column for
    // both marks, and dropping either would lose a figure the caption still
    // names. `+` says both at once, so the count of marks never depends on how
    // the two happen to fall.
    ruler += c === seaCol ? (c === medCol ? '+' : '|')
      : (c === medCol ? ':' : '-');
  }
  lines.push(ruler);
  lines.push(core.hundred(h.lo) + ' .. ' +
    core.hundred(h.lo + h.span) + ' relief, sea ' +
    core.hundred(result.seaLevel) + ', median ' +
    core.hundred(result.stats.median) + ', ' + h.bins + ' bins, peak ' +
    h.peak + ' cells - ' +
    // The same eight hex digits the stats list and the record print, so a
    // pasted block of text names the picture it came from — the one field a
    // reader can match against a saved PNG's name without any other file.
    result.stats.checksum);
  return lines;
}

// One world, one line of text. The JSON form is what scripts consume; the
// table is what a person reads after a reroll.
function summarise(seed, result, name, asJson) {
  var s = result.stats;
  // The relief chart's two numbers, computed once for the record below. The
  // width is the sidebar's own default rather than this world's grid, since
  // the chart bins by the strip it is drawn into — 240 CSS pixels is what the
  // core maps to 48 bars, which is also what the suite compares against.
  var hist = histPass(result);
  // Per-class shares, biggest first. The one-line summary only names the
  // dominant class, which is not enough to tell two worlds apart when most of
  // the grid is water. Kept as "key=NN%" pairs so the table form stays a
  // single line and the JSON form needs no extra nesting.
  // The order is the legend's order, tie-break included: two classes covering
  // the same number of cells are listed in the order the palette declares its
  // keys, so a record read in a terminal ranks a pair the same way the rows on
  // screen do rather than in whatever order the counts object happened to be
  // filled.
  var classes = core.legendOrder(result)
    .map(function (k) {
      return k + '=' + core.percentText(core.classShare(s, k));
    })
    .join(' ');
  var rec = {
    seed: seed,
    width: result.width, height: result.height,
    // The look is part of the state: two records with the same seed and grid
    // can still be different pictures, and the palette name is what tells the
    // two apart. Shape is already the first word of the summary.
    palette: opts.palette || 'terra',
    // Which scalar field the pixels came from, when the biome colours were
    // dropped for an overlay. Like the palette it is invisible in the summary
    // sentence, and two records with the same checksum otherwise look alike.
    channel: opts.channel || '',
    // The multiplier is in the record too: it changes the saved file's pixel
    // dimensions without touching a single count above, so without it a record
    // cannot say why its PNG is bigger than the grid it lists.
    scale: opts.scale > 1 ? opts.scale : 1,
    land: three(s.land),
    water: three(s.water),
    median: three(s.median),
    // The sea line is the one figure the text ruler marks, and it is also what
    // splits the bars into wet and dry. Without it a record could not say
    // where its own rule sits, and the `water` share alone cannot be turned
    // back into the level that produced it.
    sea: three(result.seaLevel),
    lake: three(core.lakeShare(result.stats)),
    ice: three(s.ice),
    rivers: s.rivers,
    // The same split the sidebar prints on its `rivers` row: without the
    // trunk half a record can say how much of a world is drained but not how
    // much of that drainage is a trunk.
    trunks: s.trunks,
    lakeBasins: s.lakeBasins,
    relief: core.hundred(s.max - s.min),
    // The two ends behind that difference, out of a hundred: the spread alone
    // cannot say whether a world climbs from a deep shelf or from a damp
    // plain, and those are the numbers printed at the corners of the chart.
    low: core.hundred(s.min),
    high: core.hundred(s.max),
    contourBands: s.contourBands, basinBands: s.basinBands,
    // The relief chart's own two numbers: how many bars the sidebar would draw
    // for this world and the tallest of them. Both come from the same core
    // pass the chart uses, so a terminal can redraw the silhouette from the
    // record alone — the bars themselves are the height field binned over
    // `low`..`high`, which the four fields above already pin down.
    bins: hist.bins,
    peak: hist.peak,
    // How many rows the block is supposed to have. `bins` and `peak` fix the
    // width and the height of a silhouette but not its length, so a reader
    // holding a pasted block could not tell a complete profile from one whose
    // last rows were cut off in transit. The number is the core's own.
    rows: core.histRows,
    // Which columns the two ruler marks fall in. The caption rounds every
    // figure out of a hundred, and a rounded end of the range can move a mark
    // by a column, so the two positions are published rather than left for a
    // reader to re-derive from `low` and `high`. Both come from the same
    // `binOf` the text ruler is drawn with.
    seaCol: rulerMarks(result, hist).sea,
    medCol: rulerMarks(result, hist).med,
    // The bars themselves. `bins` and `peak` say how tall the silhouette is
    // but not where its weight sits, which is the difference between a plateau
    // and a peak squeezed between its own two ends. The array is the same pass
    // the chart draws from, so a pasted block of bars and the one line of JSON
    // around it describe one world rather than two that look alike.
    hist: Array.prototype.slice.call(hist.hist),
    // Same lookup the `biomes` row on the page reads, so a terminal and the
    // sidebar report one count of the classes this world actually wears.
    biomes: core.biomeCount(s.counts),
    classes: classes,
    summary: core.describe(result),
    checksum: s.checksum,
    ms: s.ms, file: name
  };
  if (asJson) return JSON.stringify(rec);
  var lines = [];
  var keys = Object.keys(rec);
  // The value column starts one space past the longest label, and that width
  // is measured from the record rather than written here. A fixed number is
  // only right while the widest key happens to be the one it was counted off,
  // so a longer field added later would print its value flush against the name
  // and the column would read as two columns.
  var padTo = 0;
  keys.forEach(function (k) { if (k.length > padTo) padTo = k.length; });
  padTo += 1;
  keys.forEach(function (k) {
    var label = k;
    while (label.length < padTo) label += ' ';
    lines.push(label + rec[k]);
  });
  return lines.join('\n');
}
