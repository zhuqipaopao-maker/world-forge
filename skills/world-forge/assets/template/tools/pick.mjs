// pick what is under screen points: node tools/pick.mjs "cam=x,y,z,lx,ly,lz" '[[u,v],...]'  (u,v in 0..1 from top-left)
import { chromium } from 'playwright-core';
import fs from 'fs';
const port = fs.readFileSync('.devport', 'utf8').trim();
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.goto(`http://localhost:${port}/?shot=1&q=test&${process.argv[2]}`); await p.waitForFunction(() => window.__ready, null, { timeout: 240000 });
await p.waitForTimeout(500);
console.log(await p.evaluate((pts) => { const G = window.__G, rc = new G.THREE.Raycaster();
  return pts.map(([u, v]) => { rc.setFromCamera(new G.THREE.Vector2(u * 2 - 1, 1 - v * 2), G.camera); const h = rc.intersectObjects(G.scene.children, true).slice(0, 4);
    return `${u},${v} -> ` + h.map((i) => i.distance.toFixed(2) + ' ' + (i.object.name || '') + '/' + (i.object.material?.name || i.object.material?.type) + (i.object.isInstancedMesh ? '[inst n=' + i.object.count + ' v=' + i.object.geometry.attributes.position.count + ' c=' + i.object.material.color?.getHexString() + ']' : '') + ' @' + i.point.toArray().map((n) => n.toFixed(2)).join(',')).join(' | '); }).join('\n'); }, JSON.parse(process.argv[3])));
await b.close();
