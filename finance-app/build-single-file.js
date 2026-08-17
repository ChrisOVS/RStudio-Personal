/*
 * build-single-file.js — bundle the app into one self-contained HTML file.
 *
 * The app normally loads styles.css and four scripts as separate files, which
 * needs a web server (or at least a real directory) to work. This flattens all
 * of it into a single file you can open by double-clicking, mail to someone, or
 * host anywhere.
 *
 *   node build-single-file.js            -> dist/paycheck-calculator.html
 *   node build-single-file.js --fragment -> dist/paycheck-fragment.html
 *
 * --fragment omits the <!doctype>/<html>/<head>/<body> wrapper, for hosts that
 * supply their own document shell.
 *
 * Everything is read from the real source files, so the bundle can never drift
 * from what the tests run against.
 */

var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var fragment = process.argv.indexOf('--fragment') !== -1;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

var html = read('index.html');
var css = read('styles.css');

// The script list is READ OUT OF index.html rather than hardcoded here. A
// hardcoded copy silently goes stale the moment a new file is added to the
// page, and the bundle then ships markup with no code behind it.
var scriptSrcs = [];
var scriptRe = /<script\s+src="([^"]+)"><\/script>/g;
var m;
while ((m = scriptRe.exec(html)) !== null) scriptSrcs.push(m[1]);

if (!scriptSrcs.length) throw new Error('no <script src> tags found in index.html');

var scripts = scriptSrcs
  .map(function (f) {
    return '/* ===== ' + f + ' ===== */\n' + read(f);
  })
  .join('\n\n');

var title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Paycheck Calculator'])[1].trim();

// Pull the body, then drop the <script src> tags — they are being inlined.
var body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1]
  .replace(/[ \t]*<script\s+src=[^>]*><\/script>\s*/g, '')
  .trim();

if (!body) throw new Error('could not extract <body> from index.html');

// A closing </script> anywhere inside the JS would terminate the tag early.
var safeScripts = scripts.replace(/<\/script>/gi, '<\\/script>');

var parts = [
  '<title>' + title + '</title>',
  '<style>\n' + css + '\n</style>',
  body,
  '<script>\n' + safeScripts + '\n</script>'
];

var out;
if (fragment) {
  out = parts.join('\n\n') + '\n';
} else {
  out = '<!doctype html>\n<html lang="en">\n<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + parts[0] + '\n' + parts[1] + '\n'
    + '</head>\n<body>\n\n' + parts[2] + '\n\n' + parts[3] + '\n</body>\n</html>\n';
}

// Guard: every script in js/ must have made it into the bundle. The page loading
// a file the bundle omits produced a build that looked fine and did nothing —
// markup with no code behind it. Fail the build instead of shipping that again.
var onDisk = fs.readdirSync(path.join(ROOT, 'js')).filter(function (f) { return /\.js$/.test(f); });
var missing = onDisk.filter(function (f) { return scriptSrcs.indexOf('js/' + f) === -1; });
if (missing.length) {
  throw new Error(
    'js/' + missing.join(', js/') + ' exists but is not loaded by index.html, so it '
    + 'would be left out of the bundle. Add a <script src> tag or delete the file.');
}

var outDir = path.join(ROOT, 'dist');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
var outFile = path.join(outDir, fragment ? 'paycheck-fragment.html' : 'paycheck-calculator.html');
fs.writeFileSync(outFile, out);

console.log('wrote ' + path.relative(ROOT, outFile) + '  (' + Math.round(out.length / 1024) + ' KB)');
