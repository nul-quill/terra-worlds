/* Headless render: node cli.js "seed phrase" [--width 320] [--height 200]
   [--palette terra] [--shape continents] [--sea 0.48] [--out world.ppm] */
'use strict';

require('./src/core.js');
var core = globalThis.TerraCore;
var zlib = require('zlib');

function parseArgs(argv) {
  var opts = { seeds: [], unknown: [], width: 480, height: 300, out: 'world.ppm' };
  // A flag value that is not a number would otherwise reach the generator as
  // NaN, where every comparison against it is false: the sea level in
  // particular turns a whole world into dry land that way. Reading the number
  // through this helper leaves the option unset instead, so the generator's
  // own default applies and a mistyped value costs nothing but the typo.
  function nextNum(value, isInt) {
    var n = isInt ? parseInt(value, 10) : parseFloat(value);
    return isNaN(n) ? undefined : n;
  }
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--width') opts.width = nextNum(argv[++i], true);
    else if (a === '--height') opts.height = nextNum(argv[++i], true);
    else if (a === '--palette') opts.palette = argv[++i];
    else if (a === '--shape') opts.shape = argv[++i];
    else if (a === '--sea') opts.seaLevel = nextNum(argv[++i], false);
    else if (a === '--detail') opts.detail = nextNum(argv[++i], false);
    else if (a === '--polar') opts.polar = nextNum(argv[++i], false);
    else if (a === '--light') opts.hillshade = nextNum(argv[++i], false);
    else if (a === '--dir') opts.lightDir = argv[++i];
    else if (a === '--terraces') opts.terraces = nextNum(argv[++i], true);
    else if (a === '--rivers') opts.rivers = nextNum(argv[++i], true);
    else if (a === '--no-grain') opts.dither = false;
    else if (a === '--contour') opts.contour = true;
    else if (a === '--channel') opts.channel = argv[++i];
    else if (a === '--scale') opts.scale = nextNum(argv[++i], true);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--describe') opts.describe = true;
    else if (a === '--next') opts.next = parseInt(argv[++i], 10) || 5;
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
    console.error('unknown flag: ' + opts.unknown.join(', ') +
      ' (--help lists the ones that exist)');
  }
  if (!opts.seeds.length) opts.seeds.push('terra');
  return opts;
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

if (opts.help) {
  console.log('usage: node cli.js "<seed>" [--width n] [--height n] [--palette name]');
  // The shape keys are read from the generator's list rather than repeated
  // here, so adding a curve in core.js shows up in this listing too.
  console.log('       [--shape ' + core.shapes.map(function (s) {
    return s.key;
  }).join('|') + '] [--sea 0..1]');
  console.log('       [--detail 0..1] [--polar 0..1] [--light 0..1]');
  // Like the shape list above, the bearings come from the generator's own
  // array, so a new compass point appears in the usage line without a second
  // edit here.
  console.log('       [--dir ' + core.lights.map(function (lt) {
    return lt.key;
  }).join('|') + '] for the hillshade light bearing,');
  console.log('       [--terraces n] [--rivers n] [--out file.ppm]');
  console.log('       [--contour] for hypsometric lines on land and bathymetric');
  console.log('       steps under water, both spaced by this world\'s relief');
  // Same rule as the two lists above: the overlay keys are read from
  // core.channels, so a ramp added there is immediately nameable from a
  // terminal. The empty-key entry is shown as 'biome', which is what the
  // dropdown calls it.
  console.log('       [--channel ' + core.channels.map(function (c) {
    return c.key || 'biome';
  }).join('|') + '] to flatten');
  console.log('       the world to one scalar field instead of the biome colours');
  console.log('       [--scale n] nearest-neighbour multiplier applied to the');
  console.log('       saved pixels, so a small grid can still fill a screen');
  console.log('       [--describe] to print only the one-line summary and skip');
  console.log('       the .ppm file entirely; with several seeds each line');
  console.log('       also carries its own seed');
  console.log('       [--next n] with one seed to print that seed plus the n-1 seeds');
  console.log('       the Reroll button derives from it, one per line');
  console.log('       [--no-grain] to skip the Bayer dither on the shading');
  console.log('       [--palettes] to list the palette keys and their labels');
  console.log('       [--shapes] to list the shape keys and what each one cuts');
  console.log('       [--channels] to list the overlay keys and the field each');
  console.log('       one reads, in the order the c key cycles them');
  console.log('       [--phrases] to list the hand-picked seed phrases the p key');
  console.log('       walks, one per line, ready to paste after this command');
  console.log('       [--lights] to list the light bearings --dir takes');
  console.log('       [--grids] to list the column counts the grid dropdown pins');
  console.log('       [--scales] to list the export multipliers --scale takes');
  console.log('       several seeds at once are fine: each gets its own file');
  console.log('       (--out becomes a prefix), and [--json] prints one line of');
  console.log('       JSON per world instead of the table');
  console.log('palettes: ' + Object.keys(core.palettes).join(', '));
  console.log('channels: ' + core.channels.map(function (c) {
    return c.key || 'biome';
  }).join(', '));
  console.log('lights: ' + core.lights.map(function (lt) {
    return lt.key;
  }).join(', '));
  console.log('grids: ' + core.grids.map(function (gr) {
    return gr.key || 'auto';
  }).join(', '));
  console.log('scales: ' + core.scales.map(function (sc) {
    return sc.key;
  }).join(', '));
} else if (opts.grids) {
  // The column counts the grid dropdown pins, in the order the `w` key walks
  // them. Each is a --width that keeps a world's cell count stable across
  // window sizes; "auto" is the one that follows the window instead.
  core.grids.forEach(function (gr) {
    console.log((gr.key || 'auto').padEnd(11) + gr.note);
  });
} else if (opts.scales) {
  // The multipliers --scale takes, in the order the `e` key walks them. Each
  // one only enlarges the saved pixels, so the world behind them is identical.
  core.scales.forEach(function (sc) {
    console.log(sc.key.padEnd(11) + sc.note);
  });
} else if (opts.lights) {
  // The bearings --dir accepts, with the words the dropdown shows. Same list
  // the shade pass reads, so a key copied here is always valid.
  core.lights.forEach(function (lt) {
    console.log(lt.key.padEnd(11) + lt.note);
  });
} else if (opts.palettes) {
  // One row per palette: the key that --palette takes, plus the label the
  // dropdown shows and the sky triple the chart is washed with. Names only,
  // so it is cheap to eyeball before choosing a scheme for a render.
  Object.keys(core.palettes).forEach(function (name) {
    var p = core.palettes[name];
    console.log(name.padEnd(11) + p.label + '  sky ' + p.sky);
  });
  } else if (opts.shapes) {
    // Same idea for the shape curve: the key --shape takes, plus a short note
    // on what the curve does to the height field. Both lists are read from the
    // generator, so a name copied from here is always valid.
    core.shapes.forEach(function (s) {
      console.log(s.key.padEnd(11) + s.note);
    });
} else if (opts.channels) {
  // The overlay ramps in the order the dropdown and the `c` key walk them.
  // The empty key is the plain biome map, which prints as "biome" so the
  // line is never a blank column.
  core.channels.forEach(function (c) {
    console.log((c.key || 'biome').padEnd(11) + c.note);
  });
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
      console.log(chain.map(function (s) {
        var r = core.generate({
          seed: s, width: opts.width, height: opts.height, palette: opts.palette,
          shape: opts.shape, seaLevel: opts.seaLevel, detail: opts.detail,
          polar: opts.polar, terraces: opts.terraces, rivers: opts.rivers,
          hillshade: opts.hillshade, lightDir: opts.lightDir
        });
        return s + '  ' + core.describe(r);
      }).join('\n'));
    } else {
      console.log(chain.join('\n'));
    }
    return;
  }
  opts.seeds.forEach(function (seed, si) {
    var runOpts = {};
    Object.keys(opts).forEach(function (k) { runOpts[k] = opts[k]; });
    runOpts.seed = seed;
    var result = core.generate(runOpts);
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
      return;
    }
    // The extension picks the encoder: .png gets the PNG writer, anything
    // else the plain PPM one. With several seeds the name becomes a prefix,
    // and the suffix keeps whichever extension was asked for.
    var ext = /\.png$/i.test(opts.out) ? 'png' : 'ppm';
    var name = opts.seeds.length > 1
      ? opts.out.replace(/\.(ppm|png)?$/i, '-' + (si + 1) + '.' + ext)
      : opts.out;
    // The grid stays as generated for the stats; only the saved pixels grow.
    var img = opts.scale > 1 ? core.upscale(result, opts.scale) : result;
    // The PPM body is a one-byte-per-channel string, so it needs the latin1
    // range kept intact; the PNG is already a Buffer.
    if (ext === 'png') fs.writeFileSync(name, toPng(img));
    else fs.writeFileSync(name, toPpm(img), 'latin1');
    console.log(summarise(seed, result, name, opts.json));
  });
}

// One world, one line of text. The JSON form is what scripts consume; the
// table is what a person reads after a reroll.
function summarise(seed, result, name, asJson) {
  var s = result.stats;
  // Per-class shares, biggest first. The one-line summary only names the
  // dominant class, which is not enough to tell two worlds apart when most of
  // the grid is water. Kept as "key=NN%" pairs so the table form stays a
  // single line and the JSON form needs no extra nesting.
  var classes = Object.keys(s.counts)
    .sort(function (a, b) { return s.counts[b] - s.counts[a]; })
    .map(function (k) {
      return k + '=' + Math.round(s.counts[k] / s.pixels * 100) + '%';
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
    land: Math.round(s.land * 1000) / 1000,
    water: Math.round(s.water * 1000) / 1000,
    median: Math.round(s.median * 1000) / 1000,
    lake: Math.round((s.counts.lake || 0) / s.pixels * 1000) / 1000,
    ice: Math.round(s.ice * 1000) / 1000,
    rivers: s.rivers,
    lakeBasins: s.lakeBasins,
    relief: Math.round((s.max - s.min) * 100),
    contourBands: s.contourBands, basinBands: s.basinBands,
    biomes: Object.keys(s.counts).length,
    classes: classes,
    summary: core.describe(result),
    checksum: s.checksum,
    ms: s.ms, file: name
  };
  if (asJson) return JSON.stringify(rec);
  var lines = [];
  Object.keys(rec).forEach(function (k) {
    var label = k;
    // Longest key is 'contourBands', so the value column starts after it.
    while (label.length < 13) label += ' ';
    lines.push(label + rec[k]);
  });
  return lines.join('\n');
}
