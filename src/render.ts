// Canvas rendering. Procedural, painterly placeholder art; any sprite found via sprites.ts wins.
import { W, H, FLOWERS, type FlowerKind, type Placeable } from './config';
import type { Game, Flower, Hive, Bee, Wasp, Effect, Obstacle } from './game';
import { Rng } from './rng';
import { sprite } from './sprites';

export interface ViewState {
  tool: Placeable | null;
  mouse: { x: number; y: number; inside: boolean };
  running: boolean; // sim is advancing (not paused / not in a menu)
}

type VisualSeason = 0 | 1 | 2 | 3;

const PALETTE: Record<VisualSeason, { base: string; light: string; dark: string; tuft: string; canopy: string[] }> = {
  0: { base: '#93bf63', light: '#b5d77e', dark: '#6f9a45', tuft: '#5a8538', canopy: ['#4f8a3c', '#64a04a', '#7db75a'] },
  1: { base: '#a2bb55', light: '#c3d36f', dark: '#7f9a3c', tuft: '#66812f', canopy: ['#41762f', '#568c38', '#6fa545'] },
  2: { base: '#bba65a', light: '#d6c178', dark: '#94803c', tuft: '#7d6a2e', canopy: ['#c4622d', '#d98a36', '#e3ad4a'] },
  3: { base: '#dfe5e6', light: '#f4f7f7', dark: '#c3ccd0', tuft: '#aab5ba', canopy: ['#8a9aa0', '#a9b7bc', '#d5dee0'] },
};

interface Particle { x: number; y: number; vx: number; vy: number; s: number; a: number }

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg = new Map<string, HTMLCanvasElement>();
  private bgSeed = -1;
  private grain: CanvasPattern | null;
  private particles: Particle[] = [];
  private particleKind = '';
  private rainAmount = 0;
  private lastNow = 0;
  private pxScale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.grain = makeGrain(this.ctx);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.pxScale = (cssW / W) * dpr;
  }

  draw(game: Game, view: ViewState, now: number) {
    const dt = Math.min(0.1, this.lastNow ? now - this.lastNow : 0);
    this.lastNow = now;
    const ctx = this.ctx;
    const vs: VisualSeason = game.phase === 'winter' || (game.phase === 'gameover' && game.deathCause === 'winter') ? 3 : game.season;
    const t = game.clock;

    ctx.setTransform(this.pxScale, 0, 0, this.pxScale, 0, 0);
    ctx.drawImage(this.background(game, vs), 0, 0, W, H);

    this.drawAuras(game, view);
    if (view.tool) for (const h of game.hives) rangeCircle(ctx, h.x, h.y, game.forageRange, 0.5);

    const hovered = view.mouse.inside && !view.tool ? this.pick(game, view.mouse.x, view.mouse.y) : null;
    if (hovered && 'beeCount' in hovered) rangeCircle(ctx, hovered.x, hovered.y, game.forageRange, 0.9);

    // Depth-sort ground objects so lower things overlap higher ones.
    const things: { y: number; draw: () => void }[] = [];
    for (const f of game.flowers) things.push({ y: f.y, draw: () => this.drawFlower(game, f, now, vs) });
    for (const h of game.hives) things.push({ y: h.y, draw: () => this.drawHive(game, h) });
    for (const o of game.obstacles) if (o.kind === 'tree') things.push({ y: o.y + o.r * 0.4, draw: () => drawTree(ctx, o, PALETTE[vs].canopy, game.seed) });
    things.sort((a, b) => a.y - b.y);
    for (const th of things) th.draw();

    for (const b of game.bees) if (b.state !== 'home') this.drawBee(b, t);
    for (const w of game.wasps) this.drawWasp(w, t);
    for (const e of game.effects) this.drawEffect(e, now);

    this.drawWeather(game, view, vs, dt);
    if (view.tool && view.mouse.inside && game.phase === 'playing') this.drawGhost(game, view.tool, view.mouse.x, view.mouse.y);
    if (hovered) this.drawTooltip(game, hovered, view.mouse.x, view.mouse.y);

    if (this.grain) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /** Flower or hive under the cursor. */
  pick(game: Game, x: number, y: number): Flower | Hive | null {
    for (const h of game.hives) if (Math.hypot(h.x - x, h.y - 14 - y) < 24) return h;
    let best: Flower | null = null;
    let bestD = Infinity;
    for (const f of game.flowers) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < FLOWERS[f.kind].size + 6 && d < bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ background

  private background(game: Game, vs: VisualSeason): HTMLCanvasElement {
    if (this.bgSeed !== game.seed) {
      this.bg.clear();
      this.bgSeed = game.seed;
    }
    const key = String(vs);
    let c = this.bg.get(key);
    if (!c) {
      c = paintBackground(game, vs);
      this.bg.set(key, c);
    }
    return c;
  }

  // ------------------------------------------------------------ entities

  private drawAuras(game: Game, view: ViewState) {
    const ctx = this.ctx;
    for (const f of game.flowers) {
      const aura = FLOWERS[f.kind].aura;
      if (!aura) continue;
      const colour = aura.kind === 'speed' ? '150,120,210' : '200,90,110';
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, aura.radius);
      g.addColorStop(0, `rgba(${colour},0.16)`);
      g.addColorStop(1, `rgba(${colour},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, aura.radius, 0, Math.PI * 2);
      ctx.fill();
      if (view.tool) {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = `rgba(${colour},0.5)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawFlower(game: Game, f: Flower, now: number, vs: VisualSeason) {
    const ctx = this.ctx;
    const def = FLOWERS[f.kind];
    const grow = easeOutBack(Math.min(1, f.age * 2.5));
    const sway = Math.sin(now * 1.6 + f.x * 0.05) * 0.06;
    ctx.save();
    ctx.translate(f.x, f.y);
    shadow(ctx, 0, def.size * 0.55, def.size * 0.9, def.size * 0.35);
    if (f.seasonsLeft <= 1) ctx.globalAlpha = 0.82;
    ctx.rotate(sway);
    ctx.scale(grow, grow);
    drawFlowerArt(ctx, f.kind, def.size, vs === 2);
    ctx.restore();

    if (def.maxNectar > 0) {
      const frac = Math.min(1, f.nectar / game.maxNectar(f));
      const r = def.size + 4;
      ctx.save();
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,250,235,0.35)';
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (frac > 0.01) {
        ctx.strokeStyle = '#f0a020';
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawHive(game: Game, h: Hive) {
    const ctx = this.ctx;
    const pop = easeOutBack(Math.min(1, h.age * 2.5 + (game.phase === 'title' ? 1 : 0)));
    ctx.save();
    ctx.translate(h.x, h.y);
    shadow(ctx, 2, 3, 26, 8);
    ctx.scale(pop, pop);
    drawHiveArt(ctx);
    ctx.restore();

    // Bee count pill + brood progress.
    const label = `${h.beeCount}/${game.hiveCapacity}`;
    ctx.save();
    ctx.font = '600 12px Nunito, system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 22;
    const px = h.x - tw / 2;
    const py = h.y + 9;
    roundRect(ctx, px, py, tw, 17, 8.5);
    ctx.fillStyle = h.beeCount === 0 ? 'rgba(120,60,50,0.85)' : 'rgba(61,50,38,0.82)';
    ctx.fill();
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.ellipse(px + 9, py + 8.5, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff6e0';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + 16, py + 9);
    const brood = Math.min(1, h.brood / 8);
    if (brood > 0 && h.beeCount < game.hiveCapacity) {
      ctx.fillStyle = 'rgba(255,233,168,0.9)';
      roundRect(ctx, px + 4, py + 15, (tw - 8) * brood, 2, 1);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawBee(b: Bee, t: number) {
    const ctx = this.ctx;
    // Small perpendicular wobble so flight looks lively.
    const wob = Math.sin(t * 9 + b.id * 1.3) * 2;
    const x = b.x + Math.cos(b.angle + Math.PI / 2) * wob;
    const y = b.y + Math.sin(b.angle + Math.PI / 2) * wob;
    ctx.save();
    ctx.translate(x, y);
    const img = sprite('bee');
    if (img) {
      ctx.rotate(b.angle);
      ctx.drawImage(img, -11, -11, 22, 22);
    } else {
      ctx.rotate(b.angle);
      if (Math.cos(b.angle) < 0) ctx.scale(1, -1); // keep wings on top
      ctx.scale(1.6, 1.6);
      drawBeeArt(ctx, Math.sin(t * 50 + b.id), b.carrying > 0);
    }
    ctx.restore();
  }

  private drawWasp(w: Wasp, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(w.x, w.y);
    shadow(ctx, 4, 14, 8, 3);
    ctx.save();
    ctx.rotate(w.angle);
    if (Math.cos(w.angle) < 0) ctx.scale(1, -1);
    const img = sprite('wasp');
    if (img) ctx.drawImage(img, -13, -13, 26, 26);
    else {
      ctx.scale(1.5, 1.5);
      drawWaspArt(ctx, Math.sin(t * 45 + w.id), w.flash);
    }
    ctx.restore();
    if (w.hp < w.maxHp) {
      const frac = Math.max(0, w.hp / w.maxHp);
      ctx.fillStyle = 'rgba(40,30,20,0.6)';
      roundRect(ctx, -13, -20, 26, 4, 2);
      ctx.fill();
      ctx.fillStyle = '#e25b3c';
      roundRect(ctx, -13, -20, 26 * frac, 4, 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawEffect(e: Effect, _now: number) {
    const ctx = this.ctx;
    const p = e.t / e.life;
    ctx.save();
    switch (e.kind) {
      case 'sparkle':
        ctx.fillStyle = `rgba(255,214,90,${1 - p})`;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + e.x;
          const d = 4 + p * 14;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d - p * 6, 1.8 * (1 - p) + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'text':
        ctx.globalAlpha = 1 - p * p;
        ctx.font = '700 14px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(50,35,20,0.8)';
        ctx.strokeText(e.text ?? '', e.x, e.y - p * 22);
        ctx.fillStyle = e.color ?? '#fff';
        ctx.fillText(e.text ?? '', e.x, e.y - p * 22);
        break;
      case 'puff':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.fillStyle = `rgba(240,235,225,${0.7 * (1 - p)})`;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(a) * p * 18, e.y + Math.sin(a) * p * 18, 5 + p * 5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'sprout':
        ctx.strokeStyle = `rgba(255,250,220,${0.8 * (1 - p)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 8 + p * 26, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'wilt':
        if (e.flower) {
          ctx.globalAlpha = 1 - p;
          ctx.translate(e.x, e.y + p * 6);
          ctx.rotate(p * 0.6);
          ctx.scale(1 - p * 0.5, 1 - p * 0.5);
          ctx.filter = 'sepia(0.8) saturate(0.6)';
          drawFlowerArt(ctx, e.flower, FLOWERS[e.flower].size, false);
          ctx.filter = 'none';
        }
        break;
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ overlays

  private drawWeather(game: Game, view: ViewState, vs: VisualSeason, dt: number) {
    const ctx = this.ctx;
    const raining = game.phase === 'playing' && game.isRaining();
    this.rainAmount += ((raining ? 1 : 0) - this.rainAmount) * Math.min(1, dt * 2);
    const kind = vs === 3 ? 'snow' : game.weather.kind;
    if (kind !== this.particleKind) {
      this.particleKind = kind;
      this.particles = [];
      const n = kind === 'rain' ? 220 : kind === 'wind' ? 40 : kind === 'bloom' ? 36 : kind === 'snow' ? 160 : 0;
      for (let i = 0; i < n; i++) this.particles.push(spawnParticle(true));
    }
    const step = view.running || vs === 3 ? dt : 0;

    // Season / weather tint.
    const tint = vs === 1 ? 'rgba(255,200,90,0.06)' : vs === 2 ? 'rgba(230,120,40,0.08)' : null;
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
    }
    if (kind === 'drought') {
      ctx.fillStyle = 'rgba(255,170,60,0.10)';
      ctx.fillRect(0, 0, W, H);
    }
    if (this.rainAmount > 0.01) {
      ctx.fillStyle = `rgba(50,70,100,${0.22 * this.rainAmount})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    for (const p of this.particles) {
      if (kind === 'rain') {
        if (this.rainAmount < 0.05) continue;
        p.x += -120 * step;
        p.y += 760 * step;
        if (p.y > H) Object.assign(p, spawnParticle(false), { y: -10 });
        ctx.strokeStyle = `rgba(215,228,245,${0.55 * this.rainAmount})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 3, p.y + 15);
        ctx.stroke();
      } else if (kind === 'wind') {
        const a = game.weather.windAngle;
        p.a += step * 0.6;
        p.x += Math.cos(a) * 260 * step;
        p.y += Math.sin(a) * 260 * step;
        if (p.a > 1 || p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) Object.assign(p, spawnParticle(false));
        const alpha = Math.sin(p.a * Math.PI) * 0.35;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const len = 40 * p.s;
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(
          p.x - Math.cos(a) * len * 0.5 + Math.sin(a) * 4, p.y - Math.sin(a) * len * 0.5 - Math.cos(a) * 4,
          p.x - Math.cos(a) * len, p.y - Math.sin(a) * len,
        );
        ctx.stroke();
      } else if (kind === 'bloom') {
        p.x += (p.vx + 14) * step;
        p.y += (p.vy + 18) * step;
        p.a += step * 2;
        if (p.y > H + 10 || p.x > W + 10) Object.assign(p, spawnParticle(false), { y: -10 });
        ctx.fillStyle = 'rgba(248,190,215,0.8)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 3.5 * p.s, 2 * p.s, p.a, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'snow') {
        p.x += (Math.sin(p.a + p.y * 0.02) * 12) * step;
        p.y += 40 * p.s * step;
        if (p.y > H + 5) Object.assign(p, spawnParticle(false), { y: -5 });
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 * p.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawGhost(game: Game, tool: Placeable, x: number, y: number) {
    const ctx = this.ctx;
    const problem = game.placementProblem(tool, x, y);
    ctx.save();
    if (tool === 'hive') rangeCircle(ctx, x, y, game.forageRange, 1);
    else {
      const aura = FLOWERS[tool].aura;
      if (aura) {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = aura.kind === 'speed' ? 'rgba(150,120,210,0.9)' : 'rgba(200,90,110,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, aura.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = problem ? 0.4 : 0.75;
    ctx.translate(x, y);
    if (tool === 'hive') drawHiveArt(ctx);
    else drawFlowerArt(ctx, tool, FLOWERS[tool].size, false);
    ctx.restore();

    ctx.save();
    ctx.font = '700 13px Nunito, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const text = problem ?? `${game.cost(tool)} honey`;
    const ty = y + (tool === 'hive' ? 34 : FLOWERS[tool].size + 22);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(50,35,20,0.75)';
    ctx.strokeText(text, x, ty);
    ctx.fillStyle = problem ? '#ffb8a8' : '#fff1c4';
    ctx.fillText(text, x, ty);
    ctx.restore();
  }

  private drawTooltip(game: Game, item: Flower | Hive, mx: number, my: number) {
    const lines: string[] = [];
    if ('beeCount' in item) {
      lines.push('Hive');
      lines.push(`${item.beeCount}/${game.hiveCapacity} bees`);
      lines.push(item.beeCount < game.hiveCapacity ? `Next bee: ${Math.floor(item.brood)}/8 nectar` : 'Full: plant more flowers or build a hive');
    } else {
      const def = FLOWERS[item.kind];
      lines.push(`${item.wild ? 'Wild ' : ''}${def.name}`);
      if (def.maxNectar > 0) lines.push(`Nectar ${item.nectar.toFixed(1)}/${game.maxNectar(item).toFixed(0)}`);
      lines.push(item.seasonsLeft <= 1 ? 'Wilts at the end of this season' : `${item.seasonsLeft} seasons left`);
      if (def.maxNectar > 0 && !game.hives.some(h => Math.hypot(h.x - item.x, h.y - item.y) <= game.forageRange)) {
        lines.push('Out of range of every hive');
      }
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '600 12px Nunito, system-ui, sans-serif';
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18;
    const h = lines.length * 16 + 10;
    let x = mx + 16;
    let y = my + 14;
    if (x + w > W - 4) x = mx - w - 12;
    if (y + h > H - 4) y = my - h - 10;
    roundRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(250,244,226,0.95)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,110,60,0.5)';
    ctx.stroke();
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? '800 12px Nunito, system-ui, sans-serif' : '600 12px Nunito, system-ui, sans-serif';
      ctx.fillStyle = l.startsWith('Out of range') ? '#b4472d' : '#3d3226';
      ctx.fillText(l, x + 9, y + 6 + i * 16);
    });
    ctx.restore();
  }
}

// ============================================================ shared art helpers

/** Draws a placeable at the origin; used by the canvas and by the toolbar icons. */
export function drawPlaceableIcon(ctx: CanvasRenderingContext2D, kind: Placeable, size: number) {
  ctx.save();
  ctx.translate(size / 2, size / 2 + (kind === 'hive' ? size * 0.3 : 0));
  const s = kind === 'hive' ? size / 46 : size / (FLOWERS[kind].size * 3.2);
  ctx.scale(s, s);
  if (kind === 'hive') drawHiveArt(ctx);
  else drawFlowerArt(ctx, kind, FLOWERS[kind].size, false);
  ctx.restore();
}

function drawFlowerArt(ctx: CanvasRenderingContext2D, kind: FlowerKind, s: number, autumn: boolean) {
  const img = sprite(`flower-${kind}`);
  if (img) {
    const d = s * 3.2;
    ctx.drawImage(img, -d / 2, -d / 2, d, d);
    return;
  }
  switch (kind) {
    case 'daisy':
      leaves(ctx, s, '#5f9a45');
      petals(ctx, 12, s, s * 0.27, '#fffaf0', '#e1d3b8');
      dot(ctx, 0, 0, s * 0.38, '#f2b632', '#c98a1b');
      dot(ctx, -s * 0.1, -s * 0.1, s * 0.12, 'rgba(255,240,180,0.7)');
      break;
    case 'clover':
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i - 1) * 0.9;
        dot(ctx, Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.4 + s * 0.2, s * 0.38, '#5c9a45', '#3f7330');
      }
      for (let i = 0; i < 11; i++) {
        const a = i * 2.4;
        const r = Math.sqrt(i / 11) * s * 0.42;
        dot(ctx, Math.cos(a) * r, Math.sin(a) * r - s * 0.25, s * 0.2, i % 2 ? '#f4dbe7' : '#e7b3cb');
      }
      break;
    case 'thistle':
      ctx.fillStyle = '#4f7d3a';
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 0.15 + (i / 4) * Math.PI * 0.7;
        ctx.beginPath();
        ctx.moveTo(-3, s * 0.3);
        ctx.lineTo(Math.cos(a) * s * 1.1, s * 0.3 + Math.sin(a) * s * 0.5);
        ctx.lineTo(3, s * 0.3);
        ctx.fill();
      }
      dot(ctx, 0, s * 0.15, s * 0.4, '#79a24f', '#4f7d3a');
      ctx.strokeStyle = '#a564c9';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 11; i++) {
        const a = -Math.PI / 2 + (i / 10 - 0.5) * 1.8;
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.05);
        ctx.lineTo(Math.cos(a) * s * 0.85, -s * 0.05 + Math.sin(a) * s * 0.85);
        ctx.stroke();
      }
      dot(ctx, 0, -s * 0.15, s * 0.25, '#8e4fb3');
      break;
    case 'sunflower':
      leaves(ctx, s, '#4f8a3c');
      petals(ctx, 16, s, s * 0.24, '#f6c026', '#d99a12');
      petals(ctx, 16, s * 0.8, s * 0.2, '#f9d453', null, Math.PI / 16);
      dot(ctx, 0, 0, s * 0.45, '#6b3e1d', '#4a2a12');
      ctx.fillStyle = '#8a5530';
      for (let i = 0; i < 14; i++) {
        const a = i * 2.4;
        const r = Math.sqrt(i / 14) * s * 0.35;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'lavender':
      for (let k = -1; k <= 1; k++) {
        const bx = k * s * 0.35;
        const tx = k * s * 0.55;
        ctx.strokeStyle = '#6b8f4a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx * 0.3, s * 0.7);
        ctx.lineTo(tx, -s * 0.9);
        ctx.stroke();
        for (let j = 0; j < 6; j++) {
          const f = j / 5;
          const x = bx * 0.3 + (tx - bx * 0.3) * (0.35 + f * 0.65);
          const y = s * 0.7 + (-s * 0.9 - s * 0.7) * (0.35 + f * 0.65);
          dot(ctx, x - 1.5, y, s * 0.15, j % 2 ? '#8e7cc3' : '#a993dd');
          dot(ctx, x + 1.5, y + 1.5, s * 0.13, j % 2 ? '#a993dd' : '#7a67b3');
        }
      }
      break;
    case 'heather':
      ctx.fillStyle = '#5f7d3c';
      ctx.beginPath();
      ctx.ellipse(0, s * 0.25, s * 0.95, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 22; i++) {
        const a = i * 2.4;
        const r = Math.sqrt(i / 22);
        dot(ctx, Math.cos(a) * r * s * 0.85, Math.sin(a) * r * s * 0.5 + s * 0.05, s * 0.15,
          autumn ? (i % 2 ? '#e070b0' : '#f39ccc') : (i % 2 ? '#c99ab5' : '#ddb6cb'));
      }
      break;
  }
}

function drawHiveArt(ctx: CanvasRenderingContext2D) {
  const img = sprite('hive');
  if (img) {
    ctx.drawImage(img, -28, -50, 56, 56);
    return;
  }
  ctx.fillStyle = '#7a5230';
  roundRect(ctx, -21, -3, 42, 7, 3);
  ctx.fill();
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const w = 20 - i * 2.2 - Math.max(0, i - 3) * 2.2;
    const y = -6 - i * 6;
    ctx.beginPath();
    ctx.ellipse(0, y, w, 5.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? '#dba94f' : '#c99036';
    ctx.fill();
    ctx.strokeStyle = '#8a5a1c';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    // straw texture
    ctx.strokeStyle = 'rgba(255,230,170,0.35)';
    ctx.beginPath();
    ctx.moveTo(-w * 0.6, y - 1.5);
    ctx.lineTo(w * 0.3, y - 2.5);
    ctx.stroke();
  }
  dot(ctx, 0, -42, 4.5, '#c99036', '#8a5a1c');
  ctx.fillStyle = '#3b2410';
  ctx.beginPath();
  ctx.ellipse(0, -5, 5, 3.6, 0, Math.PI, 0);
  ctx.fill();
}

function drawBeeArt(ctx: CanvasRenderingContext2D, flap: number, carrying: boolean) {
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-1, -3.2, 3.4, 1.2 + Math.abs(flap) * 1.6, -0.5, 0, Math.PI * 2);
  ctx.ellipse(1.6, -3.0, 3.0, 1 + Math.abs(flap) * 1.4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 4.6, 3.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f5c518';
  ctx.fill();
  ctx.strokeStyle = '#6b4b10';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.strokeStyle = '#2b2118';
  ctx.lineWidth = 1.3;
  for (const sx of [-1.4, 1.2]) {
    ctx.beginPath();
    ctx.moveTo(sx, -2.8);
    ctx.lineTo(sx, 2.8);
    ctx.stroke();
  }
  dot(ctx, 4.6, 0, 1.9, '#2b2118');
  if (carrying) dot(ctx, -1, 3.6, 1.7, '#f0a020', '#b56d0a');
}

function drawWaspArt(ctx: CanvasRenderingContext2D, flap: number, flash: number) {
  ctx.fillStyle = 'rgba(220,225,235,0.7)';
  ctx.beginPath();
  ctx.ellipse(-1, -3.6, 4.4, 1.3 + Math.abs(flap) * 1.8, -0.4, 0, Math.PI * 2);
  ctx.ellipse(2, -3.4, 3.8, 1.1 + Math.abs(flap) * 1.6, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(-6, -1);
  ctx.lineTo(-6, 1);
  ctx.fillStyle = '#2b2118';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-2, 0, 4.6, 2.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = flash > 0.3 ? '#fff' : '#ea7a2b';
  ctx.fill();
  ctx.strokeStyle = '#2b2118';
  ctx.lineWidth = 1.4;
  for (const sx of [-4, -1.5]) {
    ctx.beginPath();
    ctx.moveTo(sx, -2.6);
    ctx.lineTo(sx, 2.6);
    ctx.stroke();
  }
  dot(ctx, 3.4, 0, 1.8, flash > 0.3 ? '#fff' : '#d8662a', '#2b2118');
  dot(ctx, 6, 0, 2, '#2b2118');
}

function drawTree(ctx: CanvasRenderingContext2D, o: Obstacle, canopy: string[], seed: number) {
  const img = sprite('tree');
  if (img) {
    ctx.drawImage(img, o.x - o.r * 1.4, o.y - o.r * 1.9, o.r * 2.8, o.r * 2.8);
    return;
  }
  const r = new Rng(seed ^ Math.round(o.x * 31 + o.y));
  shadow(ctx, o.x + o.r * 0.3, o.y + o.r * 0.55, o.r * 1.1, o.r * 0.45);
  ctx.fillStyle = '#6b4a2c';
  ctx.fillRect(o.x - 4, o.y - 4, 8, o.r * 0.6);
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, Math.PI * 2);
    const d = r.range(0, o.r * 0.55);
    ctx.fillStyle = canopy[i % canopy.length];
    ctx.beginPath();
    ctx.arc(o.x + Math.cos(a) * d, o.y - o.r * 0.5 + Math.sin(a) * d * 0.8, o.r * r.range(0.45, 0.7), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,220,0.18)';
  ctx.beginPath();
  ctx.arc(o.x - o.r * 0.25, o.y - o.r * 0.85, o.r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function paintBackground(game: Game, vs: VisualSeason): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  const p = PALETTE[vs];
  const r = new Rng(game.seed ^ 0x9e3779b9);

  g.fillStyle = p.base;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 280; i++) {
    g.globalAlpha = r.range(0.06, 0.2);
    g.fillStyle = r.next() < 0.5 ? p.light : p.dark;
    blob(g, r.range(0, W), r.range(0, H), r.range(30, 130), r);
  }
  g.globalAlpha = 1;

  for (const d of game.decor) {
    if (d.kind === 'tuft') {
      g.strokeStyle = p.tuft;
      g.globalAlpha = 0.45;
      g.lineWidth = 1.2;
      g.lineCap = 'round';
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(d.x + k * 2, d.y);
        g.quadraticCurveTo(d.x + k * 3, d.y - 4 * d.s, d.x + k * 5 * d.s, d.y - 7 * d.s);
        g.stroke();
      }
    } else if (vs !== 3) {
      g.globalAlpha = 0.85;
      g.fillStyle = `hsl(${d.hue}, ${vs === 2 ? 45 : 70}%, ${d.hue === 45 ? 65 : 80}%)`;
      g.beginPath();
      g.arc(d.x, d.y, 1.6 * d.s, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  const ponds = game.obstacles.filter(o => o.kind === 'pond');
  const pondLayer = (grow: number, colour: string) => {
    g.fillStyle = colour;
    g.beginPath();
    for (const o of ponds) {
      g.moveTo(o.x + o.r + grow, o.y);
      g.arc(o.x, o.y, o.r + grow, 0, Math.PI * 2);
    }
    g.fill();
  };
  pondLayer(7, vs === 3 ? '#c6d0d4' : '#7d8f55');
  pondLayer(2, vs === 3 ? '#d8e6ee' : '#4f8fa8');
  pondLayer(-8, vs === 3 ? '#e8f1f6' : '#5ea3bb');
  for (const o of ponds) {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(o.x - o.r * 0.2, o.y - o.r * 0.2, o.r * 0.35, o.r * 0.12, -0.2, 0, Math.PI * 2);
    g.stroke();
    if (vs !== 3 && r.next() < 0.6) {
      dot(g, o.x + o.r * 0.3, o.y + o.r * 0.2, 6, '#5d9a4a', '#3f7330');
      dot(g, o.x + o.r * 0.3 + 2, o.y + o.r * 0.2 - 1, 2, '#f2c6d8');
    }
  }

  for (const o of game.obstacles) {
    if (o.kind !== 'rock') continue;
    const img = sprite('rock');
    if (img) {
      g.drawImage(img, o.x - o.r * 1.3, o.y - o.r * 1.3, o.r * 2.6, o.r * 2.6);
      continue;
    }
    shadow(g, o.x + 3, o.y + o.r * 0.5, o.r * 1.1, o.r * 0.45);
    g.fillStyle = vs === 3 ? '#b8bfc3' : '#9a958a';
    blob(g, o.x, o.y, o.r, r);
    g.fillStyle = vs === 3 ? '#ffffff' : 'rgba(255,255,255,0.25)';
    blob(g, o.x - o.r * 0.25, o.y - o.r * 0.35, o.r * 0.45, r);
  }

  const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(40,30,10,0.28)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  return c;
}

function makeGrain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 40;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return ctx.createPattern(c, 'repeat');
}

function spawnParticle(anywhere: boolean): Particle {
  return {
    x: Math.random() * (W + 200) - 100,
    y: anywhere ? Math.random() * H : Math.random() * H,
    vx: Math.random() * 20 - 10,
    vy: Math.random() * 10,
    s: 0.6 + Math.random() * 0.8,
    a: anywhere ? Math.random() : 0,
  };
}

function rangeCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, strength: number) {
  ctx.save();
  ctx.fillStyle = `rgba(255,240,180,${0.07 * strength})`;
  ctx.strokeStyle = `rgba(255,248,220,${0.65 * strength})`;
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function petals(ctx: CanvasRenderingContext2D, n: number, len: number, wid: number, fill: string, stroke: string | null, rot = 0) {
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate(rot + (i / n) * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(len * 0.55, 0, len * 0.5, wid, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function leaves(ctx: CanvasRenderingContext2D, s: number, colour: string) {
  ctx.fillStyle = colour;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * s * 0.75, s * 0.55, s * 0.55, s * 0.22, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string) {
  if (r <= 0) return;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = 'rgba(40,50,20,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, r: Rng) {
  const n = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = rad * r.range(0.78, 1.18);
    pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
  }
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const [ax, ay] = pts[i % n];
    const [bx, by] = pts[(i + 1) % n];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    if (i === 0) ctx.moveTo(mx, my);
    else ctx.quadraticCurveTo(ax, ay, mx, my);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2));
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
