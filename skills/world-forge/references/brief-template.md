# BRIEF.md template

Write this file first, in the project root, before any code. It is the contract for the whole run: every later decision is checked against it. Keep it to one page. If the user gave a short prompt, fill the gaps yourself with bold, specific choices — a vague brief produces a generic game. Show it to the user only if they asked to be consulted; otherwise state the choices in your first progress note and go.

```markdown
# <Title>

## One sentence
<Who you are, where you are, what you must do, what stands in the way.>
e.g. "A salvager in a rain-soaked container port at sunset must cut three uplink relays while drones and robot dogs hunt them."

## Scope (small on purpose)
- Play area: <W x D metres> (Saltline: ~70 x 60 m). One place, dense, not big.
- Session length: <minutes> for one full playthrough.
- Core loop: <verb> -> <verb> -> <verb>   (e.g. move between cover -> reach objective -> survive the response)
- Objectives: <2–4 named goals in a fixed order or any order>
- Threats / pressure: <1–2 enemy or hazard types with one clear behaviour each>
- Out of scope: <list what you will NOT build: inventory, dialogue trees, open world, multiplayer...>

## Art bible
- Time of day + weather: <e.g. 13° sun, heavy rain, broken cloud with a gap at the sun>
- Key light: direction <vector>, colour <rgb>, intensity <n>
- Sky: zenith <rgb>, horizon toward sun <rgb>, horizon away <rgb>, fog <rgb>
- Palette: 4–6 base colours (desaturated, real-world), 2–3 accents and what they mean
- Materials list (8–20 names): <concrete, asphalt, painted_metal, rust, glass, wood, rubber...>
- Hero props (3–6) with real dimensions: <name: w x h x d m>
- Signature feature (the thing that makes the place recognisable): <e.g. corrugated containers, wet reflective ground, lantern-lit canals>
- Mood references in words: <films / photos / places, described, not linked>

## The first view
<Describe the player-start shot as a photograph: what is in the foreground (1–3 m), mid ground, background, where the light is, what draws the eye. This is also the title-screen shot.>

## Named views for review (5–8)
start, overview, <hero prop close-up>, <interior>, <objective>, <backdrop / horizon>, <night/weather variant if any>

## Stop target
<independent critic score to reach before hand-over: default 8/10 on two reviews in a row (SKILL.md stop rule)>

## Performance target
<e.g. 60 fps at 1080p on an Apple M-series laptop at 'high'; playable at 'low' on integrated graphics>
```
