# 🐝 Pollen Paths

A cozy bee-colony roguelite for the browser. Plant flowers, build hives, and stockpile honey before winter comes.

## Play

- **Plant flowers** near a hive. Bees pick the best nectar within range on their own.
- Nectar becomes **honey**, which you spend on flowers and hives.
- Each **winter**, every bee eats honey, and the cost per bee rises every year. If you run short, bees die.
- From year 2, **wasps** raid your hives. Plant thistles, take the Guard Bees card, or click wasps to swat them.
- After each season, draft **1 of 3 cards**: new seeds, faster bees, cheaper hives and more.
- Weather changes each season (rain, wind, drought, super bloom), and the next season's forecast appears during the draft.

Keys: `1`–`7` choose a plant · `Space` pause (you can still plant while paused) · `F` speed · right-click/`Esc` cancels.

Every meadow comes from a seed in the URL (`?seed=…`), so you can share a run.

## Develop

```bash
npm install
npm run dev     # local dev server
npm run build   # type-check + production build to dist/
npm run sim     # headless balance check: a bot plays 20 seeds
```

The code is TypeScript + Vite + plain Canvas, with no game framework.

| File | What it does |
|---|---|
| `src/config.ts` | Balance numbers, flowers, cards, weather |
| `src/game.ts` | Pure simulation with no DOM, so it runs headless |
| `src/render.ts` | Canvas drawing, plus procedural placeholder art |
| `src/ui.ts` | HUD, toolbar, draft/winter/game-over panels |
| `scripts/sim.ts` | Bot-driven balance runs |

## Art

The placeholder art is drawn in code. To swap in painted sprites, see [`src/assets/sprites/README.md`](src/assets/sprites/README.md).

Deploys to GitHub Pages on every push to `main`.
