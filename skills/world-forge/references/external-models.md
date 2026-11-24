# External models (Tripo, n4d, any GLB): when and how

Everything-in-code is the default: it keeps one consistent style and the build in one file. Use a generated model only where code cannot reach the quality bar. In practice that means **hero characters the player sees up close in good light**, and sometimes one organic hero prop (a statue, a carcass, a boat with a complex hull).

## Decide first
- **Creature in darkness, fog or a glimpse:** use `lib/figure.js` (robe, long limbs, eye glow, stepped motion). Code is enough.
- **A person or creature the player studies up close:** generate a model.
- **Buildings, props, vehicles, terrain, trees:** use code (props-modeling.md, vegetation, terrain).
- Ask the user before spending generation credits. Say what you want to generate and why code is not enough. Their keys may be in `~/.config/tripo/api-key` or `~/.config/n4d/api-key`. Check, and never print the keys.

## Make the source image right
Image-to-3D copies the image's lighting and style into the texture. So:
- Use a neutral, even light (no strong shadows or rim light baked in), with the full body in an A-pose or T-pose, on a plain background.
- Use the art bible's palette and materials (desaturated, worn).
- One character per image, front view.

## Bring it in
1. Put the GLB in `src/assets/`. Keep it under about 5–8 MB: decimate or reduce textures if needed, because the HTML file carries it.
2. Load it: `import glb from '../assets/thing.glb'` then `const m = await loadModel(ctx, glb, { height: 2.0 })`. Use the real height in metres; the feet end up on y = 0.
3. Restyle it so it matches the procedural world:
   - Generated textures are often too clean and too shiny. Set `roughness: 0.75–0.9`, and `tint` the colour toward the palette.
   - Or replace the material: `material: 'fabric'`, or a custom material that keeps the albedo map and adds the shared surface patch (wetness and snow apply then too).
   - Light it with the same sun, fog and grade; it gets them automatically once it is in the scene.
4. Animation:
   - If the GLB has a skeleton and clips, use `THREE.AnimationMixer` with `m.userData.animations`.
   - If it has a skeleton but no clips, pose its bones in code, like `figure.js` does.
   - If it has no skeleton, animate it as rigid parts, or ask the service for a rig. Some services offer auto-rigging; check the current API docs before promising it.
5. Shoot it in the same views as everything else (`?show=` or a level view) and compare it side by side with the procedural parts. If it stands out (sharper, cleaner, a different colour temperature), it does not belong yet: dirty it, roughen it, tint it.

## Costs and limits
- Generation takes minutes and costs credits. Generate once and keep the GLB in the repo.
- Generated topology is dense and messy. Do not try to edit it in code; restyle and pose it instead.
- The licence and terms depend on the service. Tell the user if the game will be shared publicly.
