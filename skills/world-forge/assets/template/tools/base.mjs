// Which dev server the tools talk to: --url > GAME_URL > .devport (written by dev.mjs in THIS project) > 8740.
// .devport matters when two projects run at once: without it a tool can silently shoot another world's server.
import { readFileSync } from 'node:fs';
export function baseUrl(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--url'); if (i >= 0 && argv[i + 1]) return argv[i + 1];
  if (process.env.GAME_URL) return process.env.GAME_URL;
  try { const p = readFileSync('.devport', 'utf8').trim(); if (p) return `http://localhost:${p}/`; } catch {}
  return 'http://localhost:8740/';
}
