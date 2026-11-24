// Production build: ONE self-contained HTML file (code + three.js inlined), like Saltline.
// Usage: npm run build  ->  dist/index.html  (open it directly or host it anywhere)
import * as esbuild from 'esbuild';
import fs from 'fs';
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020', legalComments: 'none', loader: { '.glb': 'binary', '.bin': 'binary', '.jpg': 'dataurl', '.png': 'dataurl' } });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('index.html', 'utf8').replace(/<script type="module" src="\.\/dist\/game\.js"><\/script>/, () => `<script type="module">${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
