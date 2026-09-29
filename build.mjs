// Build the static site into docs/ (served by GitHub Pages from main /docs).
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';

const out = process.argv[2] || 'docs';
const watch = process.argv.includes('--watch');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const icon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='#0c0d10'/><g fill='#ff5b1f'><rect x='12' y='10' width='6' height='44' rx='3' opacity='.35'/><rect x='29' y='10' width='6' height='44' rx='3' opacity='.35'/><rect x='46' y='10' width='6' height='44' rx='3' opacity='.35'/><rect x='8' y='34' width='14' height='8' rx='2'/><rect x='25' y='18' width='14' height='8' rx='2'/><rect x='42' y='40' width='14' height='8' rx='2'/></g></svg>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strudel Deck</title>
<meta name="description" content="A performance deck for Strudel: channel strips, controls, scenes, key and MIDI mapping for any Strudel code.">
<meta name="theme-color" content="#0c0d10">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="app"></div>
<noscript>Strudel Deck needs JavaScript.</noscript>
<script type="module" src="app.js"></script>
</body>
</html>
`;

const options = {
  entryPoints: { app: 'src/main.js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome111', 'edge111', 'firefox115', 'safari16.4'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  outdir: out,
  loader: { '.strudel': 'text' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
};

writeFileSync(`${out}/index.html`, html);
writeFileSync(`${out}/.nojekyll`, '');
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`watching; serve ${out}/ with any static server`);
} else {
  const result = await esbuild.build(options);
  for (const f of Object.keys(result.metafile.outputs)) console.log(`${f}  ${(statSync(f).size / 1024).toFixed(0)} KB`);
}
