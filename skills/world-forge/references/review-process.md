# Review process: self-review, independent critic, user checkpoints

The builder judges its own work too kindly. In the first test run, it rated every view "moody" while the luma numbers said they were murky, and it called a mannequin a creature. Three layers fix that.

## 1. Self-review (every loop, cheap)
This is the loop in SKILL.md: shoot → read the numbers → compare with the previous sheet → name the worst flaw → fix → shoot again. The numbers (luma, errors, audiocheck, clicktest) are not opinions; trust them over your impression.

## 2. Independent critic (every 30–45 minutes of a long run, and before hand-over)
Use a fresh critic that has **not** seen the build: no code, no conversation, only pictures and the bar. Three ways, in order of preference:
- a **subagent** of your own agent (Claude Code, or any agent with subagents), given the prompt below;
- `node tools/critic.mjs` with `CRITIC_CLI=claude` or `CRITIC_CLI=codex`: a separate non-interactive process of the user's CLI;
- `node tools/critic.mjs` with a vision API (`CRITIC_API_KEY`, `CRITIC_BASE_URL`, `CRITIC_MODEL`; any OpenAI-compatible endpoint such as Qwen-VL, GLM-4V, Kimi, Doubao, OpenAI, OpenRouter, or `CRITIC_PROVIDER=anthropic`). **If your own model cannot read images (e.g. DeepSeek), this is the only way to see your work:** work from its text and the luma numbers.

`critic.mjs` has the prompts below built in: `node tools/critic.mjs score <sheet> [--goal "..."]`, `node tools/critic.mjs ab <old> <new>` (blind, shuffled X/Y; it un-shuffles the scores for you), `node tools/critic.mjs cal <sheet>` (blind against `assets/reference/street-sheet.jpg` or `--ref`). It appends every verdict to `shots/critic.log`. If the user has asked to be consulted about quota, ask once at the start of the run, saying it is a few short calls.

**Calibrated scale, not "the reference is a 9".** Run 4 learned this the hard way: with the old prompt (judge one sheet against Saltline, "the reference is a 9") the critic gave **5/10 eight times in a row** while the station visibly went from blockout to near-photographic. A blind A/B of the first and the latest sheet then scored them 5 and 6.5 and named the right differences. Single-sheet scores against a reference are anchored and cannot see progress. So every review is two calls, both blind (files renamed X / Y, no "newer" hint):

**Call A: the absolute score** (fill in the paths):
```
You are an art director. Look at these images (Read each): <project>/shots/<iter>/_sheet.png and the full-size views
<list 4-8 PNGs>. The world is meant to be: <one sentence from BRIEF.md>. Goal: <"photographic realism" or the brief's goal>.
Compare with real photographs of such places (and the reference sheets in assets/reference/ for craft, not content).
1. The 3 biggest gaps, most important first: which view, what you see, why it breaks the illusion, one concrete fix.
2. One thing that already works and must not be lost.
3. Score 1-10 on this scale: 10 = indistinguishable from a real photo, 8 = beyond a high-end AAA screenshot (only a trained
   eye can tell), 7 = a high-end AAA game screenshot, 5 = a decent indie game, 3 = a prototype.
Under 250 words. No praise beyond item 2.
```
**Trust B over A.** Later in run 4 Call A still gave 5/10 to a sheet that Call B scored 7 against its predecessor, and A listed flaws that were not in the images ("no dead tubes", "no tunnel segment joints": both were there). A single sheet invites the critic's prior; a side-by-side forces it to look. So: use A for the list of gaps (check each claim against the image before acting on it), and use B's score for the gate. The gate is two B reviews in a row where the newer version scores ≥ the target.

**Noise.** One reviewer's verdict on a *small* difference is noise: in run 4 two reviewers in a row gave opposite verdicts on the same detail (chromatic aberration + a cyan grade: "game-like, remove it" vs "camera character, keep it"), and every "small" A/B scored the newer version 6.5 and the older 6 whatever changed. So: act on "clear" or "large" verdicts; for "small", run 3 reviewers and take the majority, or treat it as no change. To see real progress, calibrate against a fixed reference (a sheet from `assets/reference/` as P/Q, labels shuffled; `critic.mjs cal`) every few rounds.

**More noise sources (run 7), fix them before trusting any A/B:**
- *The build itself changes between shots* when textures or decals use `Math.random` (see SKILL.md, long-run discipline). Make the scene deterministic first; shoot one view twice and compare.
- *Reviewers mis-assign details between X and Y.* Twice in a row a reviewer credited the new slatted chair to the old sheet, and once "the old furniture is more convincing" referred to the new set. When a verdict hinges on a named detail, open both images and check where that detail really is; if it is assigned to the wrong sheet, discard the verdict.
- *A whole-sheet A/B dilutes a one-view change.* A change confined to one interior is 1 tile of 10; the verdict is mostly noise. For a one-view change, A/B that view alone (full size, both versions), and use the sheet A/B only every few changes.
- *Calibration noise is about ±1.* Run 7's calibrations over one morning of small improvements read 4.5, 6, 5, 5, 5, 5, 5, 6, 5, 5, 4, 5. Read the run of numbers, never one value.

**Critics prefer clean.** In run 4 a blind A/B rejected per-tile ageing of the wall tiles as "busier, more CG". Two hours later the user's first words were "it looks a bit too new". A model critic compares images. A person compares them with places they have been. So, for any wear, dirt or age change, add one line to the critic prompt: "Also judge AGE AND USE: does this look like a place used daily for 10+ years, or like a new build?" Show the user one build early. Their eye overrules an A/B on taste.

**Call B: the progress check:** the previous scored sheet and the current one as X / Y (random order): "Which is more <goal>, by how much (none / small / clear / large)? The 3 differences that decide it. Score each on the same scale." If B says "none" or the earlier one wins, your last changes did not work: revert or change technique (run 4: deeper grout + perforated benches + dropping weak rect lights lost 6.5 → 5.5; reverted). Ask B also for "the 3 changes that would most raise the better one" and "only describe what you actually see".

- A smaller, cheaper vision model is fine for the critic. It only looks and writes.
- Put the critic's 3 gaps at the top of the work queue in PROGRESS.md, and do them before your own ideas.
- **The score is the stop gate** (SKILL.md, the stop rule): hand over only at ≥ 8/10 on the calibrated scale (Call A) on two reviews in a row, or when the user says stop. Log every score with its sheet path in PROGRESS.md.
- When the same gap comes back in 2 reviews (run 4: "flat light" four times), the current technique has hit its limit: change technique, do not tune it again.
- If the critic and the numbers disagree with your impression, they win.

## 3. User checkpoints (only if the user wants check-ins)
At the start, ask the user once: one long autonomous run, or 2–3 short check-ins? If they want check-ins, stop at:
1. **First light:** the blockout with the final light, sky, fog and grade, before detailing. One sheet. Ask: "Is this the mood?" Changing the mood later is expensive.
2. **First full sheet:** all views built, before polishing. Ask: "What bothers you most?"
3. **Hand-over:** the game, the sheet, bench, audiocheck, and a request to listen and play.

Each checkpoint is one image and one question. Their answer outranks the critic and the quality bar. Record it word for word in PROGRESS.md.

**Plateau test (run 5).** Five calibrations of the night fuel station against Saltline gave 4, 5, 5, 5, 4 while dozens of wear details went in. The critic sees the sheet at ~800 px per view: oil stains, cracks and stickers are invisible at that size, and it judges the big shapes (a code-built pump, truck or shelf reads "low-poly" up close). When three calibrations in a row do not move, stop adding small detail. Report to the user with the options that change big shapes: hero models (Tripo / n4d, costs credits), fewer close-up review views of code-built products (only if the game does not put them close either), or a scene with fewer man-made hero props.

**Run 7 broke this rule and paid for it.** The plateau test fired after the third calibration of the morning, yet about ten more rounds went into stains, papers, clutter and decals: every A/B said "newer, small margin", the calibration stayed at 5. What did move the critics' language (not the score) were big changes: interior bounce light, collapsed building corners, rebuilt furniture. When the test fires, write the options in PROGRESS.md and switch to the biggest-shape item on the list within the hour, or ask the user which big change to fund.
