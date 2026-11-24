// Dev server: rebuilds dist/game.js on change and serves the folder. Usage: npm run dev [port]
import * as esbuild from 'esbuild';
import fs from 'node:fs';
const port = +(process.argv[2] || 8740);
const c = await esbuild.context({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', outfile: 'dist/game.js', sourcemap: true, logLevel: 'info', loader: { '.glb': 'binary', '.bin': 'binary', '.jpg': 'dataurl', '.png': 'dataurl' } });
await c.watch();
const { host } = await c.serve({ servedir: '.', port });
fs.writeFileSync('.devport', String(port));   // the tools read this, so they shoot THIS project even when another server runs
console.log(`serving http://localhost:${port}/`);
