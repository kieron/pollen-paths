// Headless balance check: a simple bot plays many seeds and reports how long it lasts.
// Usage: npm run sim [-- runs]
import { Game } from '../src/game';
import { W, H, type Placeable } from '../src/config';

const STEP = 1 / 30;

function tryPlace(g: Game, kind: Placeable, near: { x: number; y: number } | null, min: number, max: number): boolean {
  for (let i = 0; i < 40; i++) {
    let x: number;
    let y: number;
    if (near) {
      const a = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      x = near.x + Math.cos(a) * d;
      y = near.y + Math.sin(a) * d;
    } else {
      x = Math.random() * W;
      y = Math.random() * H;
    }
    if (!g.place(kind, x, y)) return true;
  }
  return false;
}

function act(g: Game) {
  const reserve = g.winterNeed * (g.season === 2 ? 1 : 0.5);
  const spendable = () => g.honey - reserve;
  const hive = g.hives[Math.floor(Math.random() * g.hives.length)];

  if (g.bees.length >= g.capacity - 1 && spendable() > g.cost('hive') + 15) {
    tryPlace(g, 'hive', hive, 150, 220);
  }
  if (g.year >= 2) {
    for (const h of g.hives) {
      const guarded = g.flowers.some(f => f.kind === 'thistle' && Math.hypot(f.x - h.x, f.y - h.y) < 70);
      if (!guarded && spendable() > g.cost('thistle')) tryPlace(g, 'thistle', h, 35, 60);
    }
  }
  const inRange = g.flowers.filter(f => f.kind !== 'thistle' && g.hives.some(h => Math.hypot(f.x - h.x, f.y - h.y) < g.forageRange)).length;
  const want = Math.ceil(g.bees.length * 0.9);
  for (let i = inRange; i < want; i++) {
    const kind: Placeable = g.unlocked.has('sunflower') && spendable() > g.cost('sunflower') ? 'sunflower' : 'daisy';
    if (spendable() < g.cost(kind)) break;
    tryPlace(g, kind, hive, 40, 160);
  }
}

function swatNearby(g: Game) {
  // A human would click wasps sometimes; simulate a lazy swatter.
  for (const w of g.wasps) if (Math.random() < 0.02) g.swat(w.x, w.y);
}

function run(seed: number, swat: boolean) {
  const g = new Game(seed);
  g.start();
  let steps = 0;
  while (g.phase !== 'gameover' && g.year <= 12 && steps < 2_000_000) {
    if (g.phase === 'draft') { g.chooseCard(g.draft[0].id); continue; }
    if (g.phase === 'winter') { g.continueWinter(); continue; }
    if (steps % 60 === 0) act(g);
    if (swat) swatNearby(g);
    g.update(STEP);
    steps++;
  }
  return { winters: g.wintersSurvived, cause: g.deathCause, made: Math.round(g.stats.honeyMade), hives: g.hives.length, lost: g.stats.beesLost };
}

const runs = Number(process.argv[2] ?? 20);
for (const swat of [false, true]) {
  const results = Array.from({ length: runs }, (_, i) => run(1000 + i, swat));
  const winters = results.map(r => r.winters).sort((a, b) => a - b);
  const causes = results.reduce<Record<string, number>>((acc, r) => { acc[r.cause ?? 'alive'] = (acc[r.cause ?? 'alive'] ?? 0) + 1; return acc; }, {});
  console.log(`swat=${swat} winters survived: min ${winters[0]} median ${winters[winters.length >> 1]} max ${winters[winters.length - 1]}`, causes);
  console.log('  sample:', results.slice(0, 4));
}
