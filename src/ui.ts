// DOM HUD, toolbar, modals and toasts.
import { FLOWERS, HIVE_DESC, SEASON_LENGTH, SEASON_NAMES, WEATHER, winterCostPerBee, waspCount, type Placeable } from './config';
import type { Game, Tone } from './game';
import { drawPlaceableIcon } from './render';

const TOOLS: Placeable[] = ['hive', 'daisy', 'clover', 'thistle', 'sunflower', 'lavender', 'heather'];
const BEST_KEY = 'pollen-paths-best';

export interface UIHandlers {
  start(): void;
  pick(id: string): void;
  continueWinter(): void;
  newRun(sameSeed: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  tool: Placeable | null = null;
  speed = 1;
  private lastSpeed = 1;
  private modalKey = '';
  private game: Game | null = null;
  private toolButtons = new Map<Placeable, HTMLButtonElement>();
  private hoverTool: Placeable | null = null;
  private recorded = false;

  constructor(private h: UIHandlers) {
    this.buildToolbar();
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => this.setSpeed(Number(btn.dataset.speed)));
    });
    window.addEventListener('keydown', e => this.onKey(e));
  }

  get running() {
    return this.speed > 0 && this.game?.phase === 'playing';
  }

  setTool(tool: Placeable | null) {
    if (tool && this.game && !this.game.unlocked.has(tool)) return;
    this.tool = this.tool === tool ? null : tool;
  }

  setSpeed(s: number) {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
  }

  togglePause() {
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }

  toast(text: string, tone: Tone = 'info') {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3300);
  }

  private onKey(e: KeyboardEvent) {
    const g = this.game;
    if (!g || e.metaKey || e.ctrlKey || e.altKey) return;
    if (g.phase === 'title' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.h.start();
      return;
    }
    if (g.phase === 'draft' && /^[1-3]$/.test(e.key)) {
      const card = g.draft[Number(e.key) - 1];
      if (card) this.h.pick(card.id);
      return;
    }
    if (g.phase === 'winter' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.h.continueWinter();
      return;
    }
    if (g.phase !== 'playing') return;
    if (e.key === ' ') {
      e.preventDefault();
      this.togglePause();
    } else if (e.key === 'Escape') {
      this.tool = null;
    } else if (e.key === 'f' || e.key === 'F') {
      this.setSpeed(this.speed >= 3 ? 1 : this.speed + 1);
    } else if (/^[1-7]$/.test(e.key)) {
      this.setTool(TOOLS[Number(e.key) - 1]);
    }
  }

  private buildToolbar() {
    const bar = $('tools');
    TOOLS.forEach((kind, i) => {
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.innerHTML = `<canvas width="88" height="88"></canvas><span class="name"></span><span class="cost"></span><kbd>${i + 1}</kbd>`;
      const c = btn.querySelector('canvas')!;
      drawPlaceableIcon(c.getContext('2d')!, kind, 88);
      btn.querySelector('.name')!.textContent = kind === 'hive' ? 'Hive' : FLOWERS[kind].name;
      btn.addEventListener('click', () => this.setTool(kind));
      btn.addEventListener('mouseenter', () => { this.hoverTool = kind; });
      btn.addEventListener('mouseleave', () => { this.hoverTool = null; });
      bar.appendChild(btn);
      this.toolButtons.set(kind, btn);
    });
  }

  /** Called every frame. */
  sync(game: Game) {
    if (this.game !== game) {
      this.game = game;
      this.tool = null;
      this.modalKey = '';
      this.recorded = false;
    }
    const honey = Math.floor(game.honey);
    const need = game.winterNeed;
    setText('hud-honey', String(honey));
    setText('hud-bees', `${game.bees.length}/${game.capacity}`);
    setText('hud-need', String(need));
    $('hud-winter').classList.toggle('bad', honey < need);
    $('hud-winter').title = `Winter is coming: ${game.bees.length} bees × ${game.perBeeWinter.toFixed(1)} honey each`;
    setText('hud-season', `Year ${game.year} · ${game.seasonName}`);
    setText('hud-time', `${Math.ceil(game.timeLeft)}s`);
    $('hud-bar').style.width = `${(game.elapsed / SEASON_LENGTH) * 100}%`;
    const w = WEATHER[game.weather.kind];
    setText('hud-weather', `${w.icon} ${w.name}${game.phase === 'playing' && game.isRaining() ? ' (raining now)' : ''}`);
    $('hud-weather').title = w.desc;
    document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(btn => {
      btn.classList.toggle('on', Number(btn.dataset.speed) === this.speed);
    });
    $('stage').classList.toggle('paused', this.speed === 0 && game.phase === 'playing');

    for (const [kind, btn] of this.toolButtons) {
      const locked = !game.unlocked.has(kind);
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('poor', !locked && game.honey < game.cost(kind));
      btn.classList.toggle('selected', this.tool === kind);
      setElText(btn.querySelector('.cost')!, locked ? 'locked' : `${game.cost(kind)} honey`);
    }
    const info = this.hoverTool ?? this.tool;
    let infoText = 'Choose a plant or a hive, then click the meadow. Click a wasp to swat it. Space pauses.';
    if (info) {
      const name = info === 'hive' ? 'Hive' : FLOWERS[info].name;
      const desc = info === 'hive' ? HIVE_DESC : FLOWERS[info].desc;
      infoText = game.unlocked.has(info) ? `${name}: ${desc}` : `${name} (locked; unlock it with a seed card). ${desc}`;
    }
    setText('tool-info', infoText);

    this.syncModal(game);
  }

  private syncModal(game: Game) {
    const key = `${game.phase}-${game.year}-${game.season}`;
    if (key === this.modalKey) return;
    this.modalKey = key;
    const modal = $('modal');
    if (game.phase === 'playing') {
      modal.classList.add('hidden');
      return;
    }
    modal.classList.remove('hidden');
    const panel = $('panel');
    if (game.phase === 'title') panel.innerHTML = this.titleHtml();
    else if (game.phase === 'draft') panel.innerHTML = this.draftHtml(game);
    else if (game.phase === 'winter') panel.innerHTML = this.winterHtml(game);
    else panel.innerHTML = this.gameOverHtml(game);

    panel.querySelector('[data-start]')?.addEventListener('click', () => this.h.start());
    panel.querySelector('[data-winter]')?.addEventListener('click', () => this.h.continueWinter());
    panel.querySelector('[data-retry]')?.addEventListener('click', () => this.h.newRun(true));
    panel.querySelector('[data-new]')?.addEventListener('click', () => this.h.newRun(false));
    panel.querySelectorAll<HTMLButtonElement>('[data-card]').forEach(btn => {
      btn.addEventListener('click', () => this.h.pick(btn.dataset.card!));
    });
    (panel.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private titleHtml() {
    const best = loadBest();
    return `
      <h1>Pollen Paths</h1>
      <p class="tag">A cozy bee-colony roguelite</p>
      <ul class="how">
        <li><b>Plant flowers</b> near your hive. Bees find the best nectar on their own.</li>
        <li>Bees turn nectar into <b>honey</b>. Spend it on more flowers and hives.</li>
        <li>Each <b>winter</b>, every bee eats honey. If you run short, bees die.</li>
        <li>From year 2, <b>wasps</b> raid your hives. Plant thistles, or click wasps to swat them.</li>
        <li>Between seasons, <b>choose a card</b> to grow your colony.</li>
      </ul>
      <p class="keys"><kbd>1</kbd>–<kbd>7</kbd> choose a plant · <kbd>Space</kbd> pause · <kbd>F</kbd> speed · right-click cancels</p>
      <button class="primary" data-start>Start foraging</button>
      ${best ? `<p class="best">Best run: ${best.winters} winter${best.winters === 1 ? '' : 's'} survived · ${best.honey} honey made</p>` : ''}
    `;
  }

  private draftHtml(game: Game) {
    const ended = SEASON_NAMES[game.season];
    const next = SEASON_NAMES[game.next.season];
    const w = WEATHER[game.nextWeather.kind];
    const afterWinter = game.next.season === 0;
    const wasps = waspCount(game.next.year, game.next.season);
    const cards = game.draft.map((c, i) => `
      <button class="card" data-card="${c.id}">
        <span class="icon">${c.icon}</span>
        <span class="cname">${c.name}</span>
        <span class="cdesc">${c.desc}</span>
        <kbd>${i + 1}</kbd>
      </button>`).join('');
    return `
      <h2>${afterWinter ? `Spring returns: year ${game.next.year}` : `${ended} is over`}</h2>
      <div class="forecast">
        <span>Next: <b>${next}</b></span>
        <span title="${w.desc}">${w.icon} <b>${w.name}</b>: ${w.desc}</span>
        ${wasps ? `<span class="bad">${wasps} wasp${wasps > 1 ? 's' : ''} expected</span>` : ''}
      </div>
      <p>Choose one for your colony:</p>
      <div class="cards">${cards}</div>
    `;
  }

  private winterHtml(game: Game) {
    const r = game.winter!;
    const nextCost = winterCostPerBee(r.year + 1) * game.mods.winterMult;
    const dead = r.survivors === 0;
    return `
      <h2>❄️ Winter, year ${r.year}</h2>
      <p>Your ${r.bees} bees huddle together, and each one eats ${r.perBee.toFixed(1)} honey.</p>
      <table class="report">
        <tr><td>Honey stored</td><td>${r.had}</td></tr>
        <tr><td>Honey needed</td><td>${r.need}</td></tr>
        <tr><td>Honey left</td><td>${Math.floor(game.honey)}</td></tr>
        <tr class="${r.lost ? 'bad' : 'good'}"><td>Bees lost</td><td>${r.lost}</td></tr>
      </table>
      <p class="${r.lost ? 'bad' : 'good'}">${dead ? 'The hives have fallen silent…' : r.lost ? `${r.lost} bee${r.lost > 1 ? 's' : ''} didn't make it to spring.` : 'Every bee made it through! 🎉'}</p>
      ${dead ? '' : `<p class="hint">Next winter each bee will need ${nextCost.toFixed(1)} honey.${r.year === 1 ? ' Wasps arrive this summer, so thistles near your hives will help.' : ''}</p>`}
      <button class="primary" data-winter>${dead ? 'Continue' : 'Welcome spring →'}</button>
    `;
  }

  private gameOverHtml(game: Game) {
    const winters = game.wintersSurvived;
    const honey = Math.round(game.stats.honeyMade);
    if (!this.recorded) {
      this.recorded = true;
      const best = loadBest();
      if (!best || winters > best.winters || (winters === best.winters && honey > best.honey)) {
        localStorage.setItem(BEST_KEY, JSON.stringify({ winters, honey }));
      }
    }
    const best = loadBest();
    const cause = game.deathCause === 'wasps' ? 'The wasps took the last of your bees.' : 'Your colony ran out of honey in the cold.';
    return `
      <h2>The meadow falls quiet</h2>
      <p>${cause}</p>
      <table class="report">
        <tr><td>Winters survived</td><td>${winters}</td></tr>
        <tr><td>Honey made</td><td>${honey}</td></tr>
        <tr><td>Bees hatched</td><td>${game.stats.beesHatched}</td></tr>
        <tr><td>Flowers planted</td><td>${game.stats.flowersPlanted}</td></tr>
        <tr><td>Wasps driven off</td><td>${game.stats.waspsDefeated}</td></tr>
      </table>
      ${best ? `<p class="best">Best: ${best.winters} winters · ${best.honey} honey</p>` : ''}
      <div class="row">
        <button class="primary" data-new>New meadow</button>
        <button data-retry>Retry this meadow</button>
      </div>
      <p class="hint">Meadow seed: ${game.seed.toString(36)}</p>
    `;
  }
}

function loadBest(): { winters: number; honey: number } | null {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null');
  } catch {
    return null;
  }
}

function setText(id: string, text: string) {
  setElText($(id), text);
}

function setElText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}
