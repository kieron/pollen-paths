// Pure simulation: no DOM, so it can run headless (see scripts/sim.ts).
import { Rng } from './rng';
import {
  W, H, SEASON_LENGTH, START_HONEY, START_BEES, BEE_SPEED, GATHER_TIME, BROOD_PER_BEE,
  HIVE_CAPACITY, HIVE_RANGE, HIVE_NEW_BEES, WASP_SPEED, THISTLE_DPS, GUARD_DPS,
  LAVENDER_BOOST, FLOWERS, CARDS, WEATHER, SEASON_NAMES, defaultMods, winterCostPerBee, waspCount,
  waspHp, waspSteal, hiveCost,
  type FlowerKind, type Placeable, type Mods, type CardDef, type WeatherKind, type SeasonIndex,
} from './config';

export interface Obstacle { x: number; y: number; r: number; kind: 'pond' | 'rock' | 'tree' }
export interface Decor { x: number; y: number; kind: 'tuft' | 'speck'; hue: number; s: number }

export interface Flower {
  id: number;
  kind: FlowerKind;
  x: number;
  y: number;
  nectar: number;
  claimed: number; // bees currently heading to / feeding on this flower
  seasonsLeft: number;
  wild: boolean;
  age: number;
}

export interface Hive { id: number; x: number; y: number; brood: number; beeCount: number; age: number }

export type BeeState = 'home' | 'out' | 'gather' | 'return';
export interface Bee {
  id: number;
  hive: Hive;
  x: number;
  y: number;
  state: BeeState;
  target: Flower | null;
  carrying: number;
  timer: number;
  angle: number;
}

export interface Wasp {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  target: Hive;
  state: 'approach' | 'flee';
  exitX: number;
  exitY: number;
  angle: number;
  flash: number;
}

export interface Effect {
  kind: 'puff' | 'text' | 'sparkle' | 'wilt' | 'sprout';
  x: number;
  y: number;
  t: number;
  life: number;
  text?: string;
  color?: string;
  flower?: FlowerKind;
}

export interface Weather { kind: WeatherKind; windAngle: number; windStrength: number }

export interface WinterReport {
  year: number;
  bees: number;
  perBee: number;
  need: number;
  had: number;
  paid: number;
  lost: number;
  survivors: number;
}

export type Phase = 'title' | 'playing' | 'draft' | 'winter' | 'gameover';
export type Tone = 'good' | 'bad' | 'info';
export interface GameEvent { kind: 'toast'; text: string; tone: Tone }

const CLEAR: Weather = { kind: 'clear', windAngle: 0, windStrength: 0 };
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export class Game {
  phase: Phase = 'title';
  readonly rng: Rng;
  year = 1;
  season: SeasonIndex = 0;
  elapsed = 0;
  clock = 0; // total sim time, drives animation
  honey = START_HONEY;
  stats = { honeyMade: 0, beesHatched: 0, beesLost: 0, waspsDefeated: 0, flowersPlanted: 0 };

  obstacles: Obstacle[] = [];
  decor: Decor[] = [];
  flowers: Flower[] = [];
  hives: Hive[] = [];
  bees: Bee[] = [];
  wasps: Wasp[] = [];
  effects: Effect[] = [];

  unlocked = new Set<Placeable>(['hive', 'daisy', 'clover', 'thistle']);
  cardCounts = new Map<string, number>();
  mods: Mods = defaultMods();
  weather: Weather = CLEAR;
  nextWeather: Weather = CLEAR;
  next: { year: number; season: SeasonIndex } = { year: 1, season: 0 };
  draft: CardDef[] = [];
  winter: WinterReport | null = null;
  deathCause: 'winter' | 'wasps' | null = null;

  private rainWindows: [number, number][] = [];
  private waspTimes: number[] = [];
  private wasRaining = false;
  private lavenders: Flower[] = [];
  private thistles: Flower[] = [];
  private nextId = 1;
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
    this.generateMeadow();
    this.setupStart();
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private toast(text: string, tone: Tone = 'info') {
    for (const l of this.listeners) l({ kind: 'toast', text, tone });
  }

  // ---------------------------------------------------------------- queries

  get seasonName() { return SEASON_NAMES[this.season]; }
  get hiveCapacity() { return HIVE_CAPACITY + this.mods.capacityBonus; }
  get capacity() { return this.hives.length * this.hiveCapacity; }
  get forageRange() { return HIVE_RANGE * this.mods.rangeMult; }
  get perBeeWinter() { return winterCostPerBee(this.year) * this.mods.winterMult; }
  get winterNeed() { return Math.ceil(this.bees.length * this.perBeeWinter); }
  get timeLeft() { return Math.max(0, SEASON_LENGTH - this.elapsed); }
  get wintersSurvived() { return this.year - 1; }

  isRaining(): boolean {
    return this.rainWindows.some(([a, b]) => this.elapsed >= a && this.elapsed < b);
  }

  cost(kind: Placeable): number {
    if (kind === 'hive') return Math.max(1, Math.round(hiveCost(this.hives.length) * this.mods.hiveCostMult));
    return Math.max(1, Math.round(FLOWERS[kind].cost * this.mods.flowerCostMult));
  }

  maxNectar(f: Flower): number {
    return FLOWERS[f.kind].maxNectar * this.mods.nectarMult;
  }

  /** Why `kind` can't go at (x, y), or null if it can. */
  placementProblem(kind: Placeable, x: number, y: number, free = false): string | null {
    const rad = kind === 'hive' ? 22 : FLOWERS[kind].size;
    if (x < rad + 6 || y < rad + 6 || x > W - rad - 6 || y > H - rad - 6) return 'Too close to the edge';
    for (const o of this.obstacles) {
      const r = o.kind === 'tree' ? o.r * 0.8 : o.r;
      if (dist(x, y, o.x, o.y) < r + rad * 0.6) {
        return o.kind === 'pond' ? "Can't plant in the pond" : o.kind === 'rock' ? 'A rock is in the way' : 'A tree is in the way';
      }
    }
    for (const h of this.hives) {
      if (dist(x, y, h.x, h.y) < (kind === 'hive' ? 60 : 30)) return 'Too close to a hive';
    }
    for (const f of this.flowers) {
      const min = kind === 'hive' ? 32 : rad + FLOWERS[f.kind].size + 4;
      if (dist(x, y, f.x, f.y) < min) return 'Too crowded';
    }
    if (!free) {
      if (!this.unlocked.has(kind)) return 'Not unlocked yet';
      if (this.honey < this.cost(kind)) return 'Not enough honey';
    }
    return null;
  }

  // ---------------------------------------------------------------- actions

  start() {
    if (this.phase !== 'title') return;
    this.phase = 'playing';
    this.startSeason(CLEAR);
  }

  /** Returns a problem string if placement failed. */
  place(kind: Placeable, x: number, y: number): string | null {
    if (this.phase !== 'playing') return 'Not now';
    const problem = this.placementProblem(kind, x, y);
    if (problem) return problem;
    this.honey -= this.cost(kind);
    if (kind === 'hive') {
      const hive = this.addHive(x, y);
      for (let i = 0; i < HIVE_NEW_BEES; i++) this.addBee(hive);
    } else {
      this.addFlower(kind, x, y, false);
      this.stats.flowersPlanted++;
    }
    this.effects.push({ kind: 'sprout', x, y, t: 0, life: 0.6 });
    return null;
  }

  /** Click on a wasp to knock it back. Returns true if something was hit. */
  swat(x: number, y: number): boolean {
    if (this.phase !== 'playing') return false;
    let best: Wasp | null = null;
    let bestD = 26;
    for (const w of this.wasps) {
      const d = dist(x, y, w.x, w.y);
      if (d < bestD) { best = w; bestD = d; }
    }
    if (!best) return false;
    best.hp -= 1;
    best.flash = 1;
    const away = Math.atan2(best.y - y, best.x - x);
    best.x += Math.cos(away) * 18;
    best.y += Math.sin(away) * 18;
    this.effects.push({ kind: 'text', x: best.x, y: best.y - 14, t: 0, life: 0.7, text: 'swat!', color: '#fff4d6' });
    return true;
  }

  chooseCard(id: string) {
    if (this.phase !== 'draft') return;
    const card = this.draft.find(c => c.id === id);
    if (!card) return;
    this.cardCounts.set(card.id, (this.cardCounts.get(card.id) ?? 0) + 1);
    if (card.unlock) this.unlocked.add(card.unlock);
    card.apply?.(this.mods);
    if (card.honey) this.honey += card.honey;
    if (card.wildflowers) this.scatterWild(card.wildflowers);
    this.year = this.next.year;
    this.season = this.next.season;
    this.draft = [];
    this.phase = 'playing';
    this.startSeason(this.nextWeather);
  }

  continueWinter() {
    if (this.phase !== 'winter') return;
    if (this.bees.length === 0) {
      this.deathCause = 'winter';
      this.phase = 'gameover';
      return;
    }
    this.openDraft(this.year + 1, 0);
  }

  // ---------------------------------------------------------------- simulation

  update(dt: number) {
    if (this.phase !== 'playing') return;
    this.clock += dt;
    this.elapsed += dt;

    const raining = this.isRaining();
    if (raining !== this.wasRaining) {
      this.wasRaining = raining;
      this.toast(raining ? 'Rain! The bees hurry home' : 'The rain has stopped', raining ? 'bad' : 'good');
    }

    this.lavenders = this.flowers.filter(f => f.kind === 'lavender');
    this.thistles = this.flowers.filter(f => f.kind === 'thistle');

    this.updateFlowers(dt);
    for (const b of this.bees) this.updateBee(b, dt, raining);
    while (this.waspTimes.length && this.waspTimes[0] <= this.elapsed) {
      this.waspTimes.shift();
      this.spawnWasp();
    }
    this.updateWasps(dt);
    if (this.phase !== 'playing') return; // wasps can end the run
    for (const h of this.hives) h.age += dt;
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < e.life);

    if (this.elapsed >= SEASON_LENGTH) this.endSeason();
  }

  private updateFlowers(dt: number) {
    const w = this.weather.kind === 'drought' ? 0.5 : this.weather.kind === 'bloom' ? 1.6 : 1;
    for (const f of this.flowers) {
      f.age += dt;
      const def = FLOWERS[f.kind];
      if (!def.maxNectar) continue;
      let regen = def.regen * w * this.mods.regenMult;
      if (def.autumnBoost && this.season === 2) regen *= def.autumnBoost;
      f.nectar = Math.min(this.maxNectar(f), f.nectar + regen * dt);
    }
  }

  private updateBee(b: Bee, dt: number, raining: boolean) {
    const hive = b.hive;
    switch (b.state) {
      case 'home': {
        b.x = hive.x;
        b.y = hive.y - 4;
        if (raining) return;
        b.timer -= dt;
        if (b.timer > 0) return;
        const f = this.chooseFlower(hive);
        if (!f) {
          b.timer = 0.8 + this.rng.next() * 0.8;
          return;
        }
        f.claimed++;
        b.target = f;
        b.state = 'out';
        return;
      }
      case 'out': {
        const f = b.target!;
        if (raining) {
          this.release(b);
          b.state = 'return';
          return;
        }
        if (this.fly(b, f.x, f.y - 4, dt)) {
          b.state = 'gather';
          b.timer = GATHER_TIME * this.mods.gatherTime;
        }
        return;
      }
      case 'gather': {
        const f = b.target!;
        if (raining) {
          this.release(b);
          b.state = 'return';
          return;
        }
        b.timer -= dt;
        b.x = f.x + Math.cos(this.clock * 5 + b.id) * 3;
        b.y = f.y - 4 + Math.sin(this.clock * 7 + b.id) * 2;
        if (b.timer <= 0) {
          const take = Math.min(1, f.nectar);
          f.nectar -= take;
          b.carrying = take;
          this.release(b);
          b.state = 'return';
        }
        return;
      }
      case 'return':
        if (this.fly(b, hive.x, hive.y - 4, dt)) this.deliver(b);
        return;
    }
  }

  private chooseFlower(hive: Hive): Flower | null {
    const range = this.forageRange;
    let best: Flower | null = null;
    let bestScore = 0;
    for (const f of this.flowers) {
      if (!FLOWERS[f.kind].maxNectar) continue;
      const avail = f.nectar - f.claimed;
      if (avail < 1) continue;
      const d = dist(f.x, f.y, hive.x, hive.y);
      if (d > range) continue;
      const score = Math.min(avail, 4) / (d + 60);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  /** Moves a bee toward a point, pushed by wind. Returns true on arrival. */
  private fly(b: Bee, tx: number, ty: number, dt: number): boolean {
    let speed = BEE_SPEED * this.mods.beeSpeed;
    if (this.lavenders.some(l => dist(b.x, b.y, l.x, l.y) < FLOWERS.lavender.aura!.radius)) speed *= LAVENDER_BOOST;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const d = Math.hypot(dx, dy);
    if (d <= Math.max(speed * dt, 2) + 1) {
      b.x = tx;
      b.y = ty;
      return true;
    }
    let vx = (dx / d) * speed;
    let vy = (dy / d) * speed;
    if (this.weather.kind === 'wind') {
      const ws = this.weather.windStrength * BEE_SPEED;
      vx += Math.cos(this.weather.windAngle) * ws;
      vy += Math.sin(this.weather.windAngle) * ws;
    }
    b.x += vx * dt;
    b.y += vy * dt;
    b.angle = Math.atan2(vy, vx);
    return false;
  }

  private release(b: Bee) {
    if (b.target) {
      b.target.claimed = Math.max(0, b.target.claimed - 1);
      b.target = null;
    }
  }

  private deliver(b: Bee) {
    const hive = b.hive;
    if (b.carrying > 0) {
      const gained = b.carrying * this.mods.honeyMult;
      this.honey += gained;
      this.stats.honeyMade += gained;
      hive.brood += b.carrying;
      b.carrying = 0;
      this.effects.push({ kind: 'sparkle', x: hive.x, y: hive.y - 20, t: 0, life: 0.6 });
    }
    b.state = 'home';
    b.timer = 0.3 + this.rng.next() * 0.4;
    if (hive.brood >= BROOD_PER_BEE) {
      if (hive.beeCount < this.hiveCapacity) {
        hive.brood -= BROOD_PER_BEE;
        this.addBee(hive);
        this.stats.beesHatched++;
        this.effects.push({ kind: 'text', x: hive.x, y: hive.y - 40, t: 0, life: 1.2, text: '+1 bee', color: '#ffe9a8' });
      } else {
        hive.brood = BROOD_PER_BEE;
      }
    }
  }

  private spawnWasp() {
    if (!this.hives.length) return;
    const r = this.rng;
    const side = r.int(0, 3);
    const x = side === 1 ? W + 20 : side === 3 ? -20 : r.range(0, W);
    const y = side === 0 ? -20 : side === 2 ? H + 20 : r.range(0, H);
    const hp = waspHp(this.year);
    this.wasps.push({
      id: this.nextId++, x, y, hp, maxHp: hp, target: r.pick(this.hives), state: 'approach',
      exitX: x, exitY: y, angle: 0, flash: 0,
    });
    this.toast('A wasp is coming! Click it to swat it', 'bad');
  }

  private updateWasps(dt: number) {
    for (let i = this.wasps.length - 1; i >= 0; i--) {
      const w = this.wasps[i];
      w.flash = Math.max(0, w.flash - dt * 4);
      let speed = WASP_SPEED;
      let slowed = false;
      for (const t of this.thistles) {
        if (dist(w.x, w.y, t.x, t.y) < FLOWERS.thistle.aura!.radius) {
          w.hp -= THISTLE_DPS * dt;
          slowed = true;
        }
      }
      if (slowed) speed *= 0.45;
      if (this.mods.guardBees) {
        for (const h of this.hives) {
          if (h.beeCount > 0 && dist(w.x, w.y, h.x, h.y) < 70) w.hp -= GUARD_DPS * dt;
        }
      }
      if (w.hp <= 0) {
        this.wasps.splice(i, 1);
        this.stats.waspsDefeated++;
        this.effects.push({ kind: 'puff', x: w.x, y: w.y, t: 0, life: 0.6 });
        this.toast('Wasp driven off!', 'good');
        continue;
      }
      const tx = w.state === 'approach' ? w.target.x : w.exitX;
      const ty = w.state === 'approach' ? w.target.y - 8 : w.exitY;
      const dx = tx - w.x;
      const dy = ty - w.y;
      const d = Math.hypot(dx, dy);
      if (w.state === 'approach' && d < 16) {
        this.raid(w);
        if (this.phase !== 'playing') return;
        continue;
      }
      if (w.state === 'flee' && d < 10) {
        this.wasps.splice(i, 1);
        continue;
      }
      const wobble = Math.sin(this.clock * 4 + w.id * 1.7) * 0.6;
      const a = Math.atan2(dy, dx) + wobble * 0.5;
      w.x += Math.cos(a) * speed * dt;
      w.y += Math.sin(a) * speed * dt;
      w.angle = a;
    }
  }

  private raid(w: Wasp) {
    const hive = w.target;
    const steal = Math.min(Math.floor(this.honey), waspSteal(this.year));
    this.honey -= steal;
    const victims = this.bees.filter(b => b.hive === hive);
    const victim = victims.find(b => b.state === 'home') ?? victims[0];
    if (victim) this.killBee(victim);
    w.state = 'flee';
    this.effects.push({ kind: 'text', x: hive.x, y: hive.y - 44, t: 0, life: 1.4, text: `-${steal} honey`, color: '#ffb0a0' });
    this.toast(`A wasp raided a hive: −${steal} honey${victim ? ', −1 bee' : ''}`, 'bad');
    if (this.bees.length === 0) {
      this.deathCause = 'wasps';
      this.phase = 'gameover';
    }
  }

  // ---------------------------------------------------------------- seasons

  private startSeason(w: Weather) {
    this.weather = w;
    this.elapsed = 0;
    if (this.season === 0 && this.year > 1) {
      this.scatterWild(Math.max(2, 8 - this.year));
      // An empty hive is recolonised by a small swarm in spring.
      for (const h of this.hives) {
        if (h.beeCount === 0 && this.bees.length >= 4) this.addBee(h);
      }
    }
    this.rainWindows = [];
    if (w.kind === 'rain') {
      const n = this.year >= 3 ? 3 : 2;
      const dur = (5 + this.year) * this.mods.rainMult;
      const slot = SEASON_LENGTH / n;
      for (let i = 0; i < n; i++) {
        const start = i * slot + this.rng.range(2, Math.max(2.5, slot - dur - 1));
        this.rainWindows.push([start, start + dur]);
      }
    }
    const wasps = waspCount(this.year, this.season);
    this.waspTimes = Array.from({ length: wasps }, () => this.rng.range(6, SEASON_LENGTH - 10)).sort((a, b) => a - b);
    this.wasRaining = false;
    this.toast(`${this.seasonName}, year ${this.year}: ${WEATHER[w.kind].icon} ${WEATHER[w.kind].name}`);
  }

  private endSeason() {
    for (const b of [...this.bees]) {
      this.release(b);
      if (b.carrying > 0) this.deliver(b);
      b.state = 'home';
      b.x = b.hive.x;
      b.y = b.hive.y - 4;
    }
    for (const f of this.flowers) f.claimed = 0;
    this.wasps = [];
    this.rainWindows = [];
    this.wasRaining = false;

    const survivors: Flower[] = [];
    for (const f of this.flowers) {
      f.seasonsLeft--;
      if (f.seasonsLeft > 0) survivors.push(f);
      else this.effects.push({ kind: 'wilt', x: f.x, y: f.y, t: 0, life: 1.2, flower: f.kind });
    }
    this.flowers = survivors;

    if (this.season === 2) this.beginWinter();
    else this.openDraft(this.year, (this.season + 1) as SeasonIndex);
  }

  private beginWinter() {
    const bees = this.bees.length;
    const perBee = this.perBeeWinter;
    const need = Math.ceil(bees * perBee);
    const had = Math.floor(this.honey);
    const paid = Math.min(had, need);
    const short = need - paid;
    const lost = short > 0 ? Math.min(bees, Math.ceil(short / perBee)) : 0;
    this.honey -= paid;
    for (let i = 0; i < lost; i++) {
      const fullest = this.hives.reduce((a, b) => (b.beeCount > a.beeCount ? b : a));
      const victim = this.bees.find(b => b.hive === fullest);
      if (victim) this.killBee(victim);
    }
    this.winter = { year: this.year, bees, perBee, need, had, paid, lost, survivors: this.bees.length };
    this.phase = 'winter';
  }

  private openDraft(year: number, season: SeasonIndex) {
    this.next = { year, season };
    this.nextWeather = this.rollWeather(year, season);
    const pool = CARDS.filter(c => {
      if (c.unlock) return !this.unlocked.has(c.unlock);
      return c.max === undefined || (this.cardCounts.get(c.id) ?? 0) < c.max;
    });
    this.draft = this.rng.shuffle(pool).slice(0, 3);
    this.phase = 'draft';
  }

  private rollWeather(year: number, season: SeasonIndex): Weather {
    if (year === 1 && season === 0) return CLEAR;
    const kind = this.rng.weighted<WeatherKind>([
      ['clear', Math.max(12, 34 - 3 * year)],
      ['rain', 20],
      ['wind', 18],
      ['drought', season === 1 ? 18 : 8],
      ['bloom', season === 0 ? 14 : 7],
    ]);
    return { kind, windAngle: this.rng.range(0, Math.PI * 2), windStrength: Math.min(0.6, 0.3 + 0.05 * year) };
  }

  // ---------------------------------------------------------------- world building

  private addHive(x: number, y: number): Hive {
    const hive: Hive = { id: this.nextId++, x, y, brood: 0, beeCount: 0, age: 0 };
    this.hives.push(hive);
    return hive;
  }

  private addBee(hive: Hive) {
    this.bees.push({
      id: this.nextId++, hive, x: hive.x, y: hive.y - 4, state: 'home', target: null, carrying: 0,
      timer: this.rng.next() * 1.5, angle: 0,
    });
    hive.beeCount++;
  }

  private killBee(b: Bee) {
    this.release(b);
    this.bees.splice(this.bees.indexOf(b), 1);
    b.hive.beeCount--;
    this.stats.beesLost++;
  }

  private addFlower(kind: FlowerKind, x: number, y: number, wild: boolean, seasons?: number) {
    const def = FLOWERS[kind];
    this.flowers.push({
      id: this.nextId++, kind, x, y, wild, age: 0, claimed: 0,
      nectar: def.maxNectar * this.mods.nectarMult * 0.5,
      seasonsLeft: seasons ?? def.lifespan + this.mods.extraLifespan,
    });
  }

  private scatterWild(count: number, near?: { x: number; y: number }) {
    const r = this.rng;
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 50; tries++) {
      let x: number;
      let y: number;
      if (near) {
        const a = r.range(0, Math.PI * 2);
        const d = r.range(60, 170);
        x = near.x + Math.cos(a) * d;
        y = near.y + Math.sin(a) * d;
      } else {
        x = r.range(30, W - 30);
        y = r.range(30, H - 30);
      }
      const kind: FlowerKind = near || r.next() < 0.6 ? 'daisy' : 'clover';
      if (this.placementProblem(kind, x, y, true)) continue;
      this.addFlower(kind, x, y, true, r.int(2, 4));
      placed++;
    }
  }

  private generateMeadow() {
    const r = this.rng;
    const cx = W / 2;
    const cy = H / 2;
    const clear = (x: number, y: number, rad: number, fromCentre: number) =>
      dist(x, y, cx, cy) > fromCentre && this.obstacles.every(o => dist(x, y, o.x, o.y) > o.r + rad + 20);

    const ponds = r.int(1, 2);
    for (let i = 0; i < ponds; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const px = r.range(140, W - 140);
        const py = r.range(120, H - 120);
        if (!clear(px, py, 90, 280)) continue;
        const n = r.int(3, 5);
        for (let k = 0; k < n; k++) {
          this.obstacles.push({ kind: 'pond', x: px + r.range(-45, 45), y: py + r.range(-25, 25), r: r.range(28, 52) });
        }
        break;
      }
    }

    const trees = r.int(7, 11);
    for (let i = 0, tries = 0; i < trees && tries < 300; tries++) {
      const side = r.int(0, 3);
      const inset = r.range(10, 55);
      const x = side === 1 ? W - inset : side === 3 ? inset : r.range(0, W);
      const y = side === 0 ? inset : side === 2 ? H - inset : r.range(0, H);
      const rad = r.range(26, 38);
      if (!clear(x, y, rad, 200)) continue;
      this.obstacles.push({ kind: 'tree', x, y, r: rad });
      i++;
    }

    const rocks = r.int(5, 9);
    for (let i = 0, tries = 0; i < rocks && tries < 300; tries++) {
      const x = r.range(60, W - 60);
      const y = r.range(60, H - 60);
      const rad = r.range(9, 17);
      if (!clear(x, y, rad, 150)) continue;
      this.obstacles.push({ kind: 'rock', x, y, r: rad });
      i++;
    }

    for (let i = 0; i < 520; i++) {
      this.decor.push({ kind: 'tuft', x: r.range(0, W), y: r.range(0, H), hue: 0, s: r.range(0.7, 1.4) });
    }
    for (let i = 0; i < 150; i++) {
      this.decor.push({ kind: 'speck', x: r.range(0, W), y: r.range(0, H), hue: r.pick([0, 45, 200, 280, 330]), s: r.range(0.8, 1.6) });
    }
  }

  private setupStart() {
    const hive = this.addHive(W / 2 + this.rng.range(-40, 40), H / 2 + this.rng.range(-30, 30));
    for (let i = 0; i < START_BEES; i++) this.addBee(hive);
    this.scatterWild(6, hive);
    this.scatterWild(6);
  }
}
