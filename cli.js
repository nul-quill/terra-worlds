/* Headless render: node cli.js "seed phrase" [--width 320] [--height 200]
   [--palette terra] [--shape continents] [--sea 0.48] [--out world.ppm] */
'use strict';

require('./src/core.js');
var core = globalThis.TerraCore;

function parseArgs(argv) {
  var opts = { seed: 'terra', width: 480, height: 300, out: 'world.ppm' };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--width') opts.width = parseInt(argv[++i], 10);
    else if (a === '--height') opts.height = parseInt(argv[++i], 10);
    else if (a === '--palette') opts.palette = argv[++i];
    else if (a === '--shape') opts.shape = argv[++i];
    else if (a === '--sea') opts.seaLevel = parseFloat(argv[++i]);
    else if (a === '--detail') opts.detail = parseFloat(argv[++i]);
    else if (a === '--polar') opts.polar = parseFloat(argv[++i]);
    else if (a === '--light') opts.hillshade = parseFloat(argv[++i]);
    else if (a === '--dir') opts.lightDir = argv[++i];
    else if (a === '--terraces') opts.terraces = parseInt(argv[++i], 10);
    else if (a === '--rivers') opts.rivers = parseInt(argv[++i], 10);
    else if (a === '--no-grain') opts.dither = false;
    else if (a === '--contour') opts.contour = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else opts.seed = a;
  }
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

var opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log('usage: node cli.js "<seed>" [--width n] [--height n] [--palette name]');
  console.log('       [--shape continents|islands|atolls|craton|fjord] [--sea 0..1]');
  console.log('       [--detail 0..1] [--polar 0..1] [--light 0..1]');
  console.log('       [--dir nw|ne|sw|se] for the hillshade light bearing,');
  console.log('       [--terraces n] [--rivers n] [--out file.ppm]');
  console.log('       [--contour] for hypsometric lines on land and bathymetric');
  console.log('       steps under water, both spaced by this world\'s relief');
  console.log('       [--no-grain] to skip the Bayer dither on the shading');
  console.log('palettes: ' + Object.keys(core.palettes).join(', '));
} else {
  var result = core.generate(opts);
  var fs = require('fs');
  fs.writeFileSync(opts.out, toPpm(result), 'latin1');

  var s = result.stats;
  console.log('seed      ' + opts.seed);
  console.log('grid      ' + result.width + ' x ' + result.height);
  console.log('land      ' + Math.round(s.land * 100) + '%');
  console.log('water     ' + Math.round(s.water * 100) + '%');
  console.log('lake      ' + Math.round((s.counts.lake || 0) / s.pixels * 100) + '%');
  console.log('ice       ' + Math.round(s.ice * 100) + '%');
  console.log('rivers    ' + s.rivers + ' cells');
  console.log('relief    ' + Math.round((s.max - s.min) * 100) + ' units');
  console.log('bands     ' + s.contourBands + ' land / ' + s.basinBands + ' basin');
  console.log('biomes    ' + Object.keys(s.counts).length);
  console.log('time      ' + s.ms + ' ms');
  console.log('wrote     ' + opts.out);
}
