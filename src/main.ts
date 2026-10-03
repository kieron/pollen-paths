import './style.css';
import { W, H } from './config';
import { Game } from './game';
import { Renderer, type ViewState } from './render';
import { UI } from './ui';

const STEP = 1 / 60;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
const renderer = new Renderer(canvas);
const view: ViewState = { tool: null, mouse: { x: 0, y: 0, inside: false }, running: false };

const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
const urlSeed = new URLSearchParams(location.search).get('seed');

const ui = new UI({
  start: () => game.start(),
  pick: id => game.chooseCard(id),
  continueWinter: () => game.continueWinter(),
  newRun: sameSeed => {
    document.getElementById('toasts')!.replaceChildren();
    game = newGame(sameSeed ? game.seed : randomSeed());
    game.start();
  },
});

let game = newGame(urlSeed ? parseInt(urlSeed, 36) >>> 0 : randomSeed());

function newGame(seed: number): Game {
  const g = new Game(seed);
  g.on(e => ui.toast(e.text, e.tone));
  const url = new URL(location.href);
  url.searchParams.set('seed', seed.toString(36));
  history.replaceState(null, '', url);
  return g;
}

// ---------------------------------------------------------------- input

function toWorld(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  view.mouse.x = ((e.clientX - r.left) / r.width) * W;
  view.mouse.y = ((e.clientY - r.top) / r.height) * H;
  view.mouse.inside = true;
}

canvas.addEventListener('pointermove', toWorld);
canvas.addEventListener('pointerleave', () => { view.mouse.inside = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  toWorld(e);
  if (e.button === 2) {
    ui.tool = null;
    return;
  }
  if (game.phase !== 'playing') return;
  const { x, y } = view.mouse;
  if (ui.speed > 0 && game.swat(x, y)) return;
  if (ui.tool) {
    const problem = game.place(ui.tool, x, y);
    if (problem) ui.toast(problem, 'bad');
  }
});

// ---------------------------------------------------------------- layout

function fit() {
  const r = stage.getBoundingClientRect();
  const pad = 16;
  const scale = Math.min((r.width - pad) / W, (r.height - pad) / H);
  renderer.resize(Math.floor(W * scale), Math.floor(H * scale), Math.min(window.devicePixelRatio || 1, 2));
}
new ResizeObserver(fit).observe(stage);
fit();

// ---------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;
function frame(now: number) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  view.running = ui.running;
  if (view.running) {
    acc += real * ui.speed;
    while (acc >= STEP && game.phase === 'playing') {
      game.update(STEP);
      acc -= STEP;
    }
  } else {
    acc = 0;
  }
  view.tool = game.phase === 'playing' ? ui.tool : null;
  ui.sync(game);
  renderer.draw(game, view, now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle for automated playtesting; stripped from production builds.
if (import.meta.env.DEV) Object.defineProperty(window, '__game', { get: () => game });
