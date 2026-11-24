// HUD: plain DOM over the canvas. Keep it minimal and diegetic-feeling; the world is the star.
export async function create(ctx) {
  const root = document.getElementById('hud');
  root.innerHTML = `<div class="obj" id="hud-obj"></div><div class="toast" id="hud-toast"></div><div class="cross"></div>`;
  const obj = root.querySelector('#hud-obj'), toast = root.querySelector('#hud-toast');
  let toastT = 0;
  return {
    setObjective(text) { obj.textContent = text || ''; },
    toast(text, secs = 2.5) { toast.textContent = text; toast.classList.add('on'); toastT = secs; },
    update(dt) { if (toastT > 0 && (toastT -= dt) <= 0) toast.classList.remove('on'); root.hidden = ctx.game?.state !== 'playing'; },
  };
}
