// GAME: state machine  title -> intro -> playing -> (won | lost) ; paused overlays playing.
// The title screen is shown over the live 3D world flying the cinematic path,
// so the first thing a player sees is the best-looking part of the game.
import * as THREE from 'three';

export function create(ctx) {
  const title = document.getElementById('title');
  const A = new THREE.Vector3(), B = new THREE.Vector3(), LA = new THREE.Vector3(), LB = new THREE.Vector3();
  let tCine = 0;
  const g = {
    state: 'title',
    start({ skipIntro = false } = {}) {
      title?.classList.add('hidden');
      ctx.audio.resume();
      ctx.player.reset(); ctx.player.enabled = true;
      g.state = 'playing';
      ctx.hud.setObjective(ctx.level.objectives[0]?.label || 'Explore');
      if (!skipIntro) ctx.hud.toast('Click to look around');
    },
    win() { g.state = 'won'; ctx.events.emit('game:won'); showEnd('Done'); },
    lose() { g.state = 'lost'; ctx.events.emit('game:lost'); showEnd('Lost'); },
    update(dt) {
      if (g.state === 'title') { // fly the cinematic path behind the title
        const path = ctx.level.cinematicPath; if (path && path.length > 1) {
          tCine += dt; const p = ((tCine / 40) % 1) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(p)), f = p - i, s = f * f * (3 - 2 * f);
          A.fromArray(path[i].pos); B.fromArray(path[i + 1].pos); LA.fromArray(path[i].look); LB.fromArray(path[i + 1].look);
          ctx.camera.position.lerpVectors(A, B, s); ctx.camera.lookAt(LA.lerp(LB, s));
        }
        return false;
      }
      return g.state === 'playing';
    },
  };
  function showEnd(text) { const el = document.getElementById('end'); if (el) { el.textContent = text; el.hidden = false; } ctx.input.exitLock?.(); }
  title?.addEventListener('click', () => { g.start(); ctx.input.requestLock(); });
  ctx.renderer.domElement.addEventListener('click', () => { if (g.state === 'playing' && !ctx.input.locked) ctx.input.requestLock(); });
  const pauseEl = document.getElementById('pause');
  pauseEl?.addEventListener('click', () => ctx.input.requestLock());
  ctx.events.on('lock', (locked) => { if (pauseEl) pauseEl.hidden = !(g.state === 'playing' && !locked); if (g.state === 'playing' && !locked) { g.state = 'paused'; ctx.audio.setPaused(true); } else if (g.state === 'paused' && locked) { g.state = 'playing'; ctx.audio.setPaused(false); } });
  return g;
}
