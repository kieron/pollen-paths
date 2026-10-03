// Tuning knobs and content definitions. Everything balance-related lives here.

export const W = 1280;
export const H = 800;

export const SEASON_LENGTH = 45; // seconds of sim time per season
export const START_HONEY = 20;
export const START_BEES = 4;
export const BEE_SPEED = 70; // px/s
export const GATHER_TIME = 1.2; // seconds on a flower
export const BROOD_PER_BEE = 8; // nectar delivered to a hive per new bee
export const HIVE_CAPACITY = 6;
export const HIVE_RANGE = 220; // forage radius
export const HIVE_NEW_BEES = 2;
export const WASP_SPEED = 48;
export const THISTLE_DPS = 0.6;
export const GUARD_DPS = 1.5;
export const LAVENDER_BOOST = 1.4;

export type SeasonIndex = 0 | 1 | 2;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn'] as const;

export const winterCostPerBee = (year: number) => Math.round(6 * 1.4 ** (year - 1));
/** Each extra hive costs more, so the colony can't snowball forever. */
export const hiveCost = (owned: number) => 35 + 15 * Math.max(0, owned - 1);

export function waspCount(year: number, season: SeasonIndex): number {
  if (year < 2) return 0;
  if (season === 0) return Math.max(0, year - 3);
  if (season === 1) return year - 1;
  return year;
}

export const waspHp = (year: number) => 3 + Math.max(0, year - 2);
export const waspSteal = (year: number) => 3 + 2 * year;

export type FlowerKind = 'daisy' | 'clover' | 'thistle' | 'sunflower' | 'lavender' | 'heather';
export type Placeable = FlowerKind | 'hive';

export interface FlowerDef {
  kind: FlowerKind;
  name: string;
  cost: number;
  maxNectar: number;
  regen: number; // nectar per second
  lifespan: number; // seasons
  size: number; // draw + collision radius
  desc: string;
  aura?: { kind: 'speed' | 'guard'; radius: number };
  autumnBoost?: number;
}

export const FLOWERS: Record<FlowerKind, FlowerDef> = {
  daisy: {
    kind: 'daisy', name: 'Daisy', cost: 6, maxNectar: 4, regen: 0.25, lifespan: 2, size: 11,
    desc: 'Cheap and dependable. Lasts 2 seasons.',
  },
  clover: {
    kind: 'clover', name: 'Clover', cost: 3, maxNectar: 2, regen: 0.3, lifespan: 1, size: 9,
    desc: 'Very cheap, but only lasts 1 season.',
  },
  thistle: {
    kind: 'thistle', name: 'Thistle', cost: 10, maxNectar: 0, regen: 0, lifespan: 4, size: 12,
    desc: 'No nectar. Pricks and slows any wasp that flies through. Lasts 4 seasons.',
    aura: { kind: 'guard', radius: 75 },
  },
  sunflower: {
    kind: 'sunflower', name: 'Sunflower', cost: 16, maxNectar: 12, regen: 0.45, lifespan: 3, size: 17,
    desc: 'Holds lots of nectar and can feed a crowd. Lasts 3 seasons.',
  },
  lavender: {
    kind: 'lavender', name: 'Lavender', cost: 12, maxNectar: 3, regen: 0.2, lifespan: 3, size: 12,
    desc: 'Bees fly 40% faster through its scent. Lasts 3 seasons.',
    aura: { kind: 'speed', radius: 95 },
  },
  heather: {
    kind: 'heather', name: 'Heather', cost: 9, maxNectar: 6, regen: 0.12, lifespan: 3, size: 12,
    desc: 'Slow most of the year, but makes 4× nectar in autumn. Lasts 3 seasons.',
    autumnBoost: 4,
  },
};

export const HIVE_DESC = `Houses bees. Comes with ${HIVE_NEW_BEES} bees and holds up to ${HIVE_CAPACITY}. Bees only forage within its range.`;

export interface Mods {
  beeSpeed: number;
  gatherTime: number;
  honeyMult: number;
  winterMult: number;
  extraLifespan: number;
  guardBees: boolean;
  rainMult: number;
  hiveCostMult: number;
  flowerCostMult: number;
  nectarMult: number;
  regenMult: number;
  rangeMult: number;
  capacityBonus: number;
}

export const defaultMods = (): Mods => ({
  beeSpeed: 1, gatherTime: 1, honeyMult: 1, winterMult: 1, extraLifespan: 0, guardBees: false,
  rainMult: 1, hiveCostMult: 1, flowerCostMult: 1, nectarMult: 1, regenMult: 1, rangeMult: 1,
  capacityBonus: 0,
});

export interface CardDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  max?: number; // times it can be taken; unlimited if omitted
  unlock?: FlowerKind;
  apply?: (m: Mods) => void;
  honey?: number;
  wildflowers?: number;
}

export const CARDS: CardDef[] = [
  { id: 'sunflower', name: 'Sunflower Seeds', icon: '🌻', desc: 'Unlock Sunflowers. They hold lots of nectar and last 3 seasons.', unlock: 'sunflower' },
  { id: 'lavender', name: 'Lavender Seeds', icon: '💜', desc: 'Unlock Lavender. Bees fly 40% faster through its scent.', unlock: 'lavender' },
  { id: 'heather', name: 'Heather Seeds', icon: '🌸', desc: 'Unlock Heather. Slow most of the year, but 4× nectar in autumn.', unlock: 'heather' },
  { id: 'royal-jelly', name: 'Royal Jelly', icon: '👑', desc: 'Every hive holds 2 more bees.', max: 3, apply: m => { m.capacityBonus += 2; } },
  { id: 'strong-wings', name: 'Strong Wings', icon: '🪽', desc: 'Bees fly 15% faster.', max: 3, apply: m => { m.beeSpeed *= 1.15; } },
  { id: 'long-tongues', name: 'Long Tongues', icon: '👅', desc: 'Bees gather nectar 30% faster.', max: 2, apply: m => { m.gatherTime *= 0.7; } },
  { id: 'hex-comb', name: 'Hexagonal Comb', icon: '🍯', desc: 'Every delivery makes 20% more honey.', max: 3, apply: m => { m.honeyMult += 0.2; } },
  { id: 'fuzzy-coats', name: 'Fuzzy Coats', icon: '🧣', desc: 'Bees eat 20% less honey in winter.', max: 2, apply: m => { m.winterMult *= 0.8; } },
  { id: 'perennials', name: 'Perennial Roots', icon: '🌱', desc: 'Flowers you plant from now on last 1 more season.', max: 2, apply: m => { m.extraLifespan += 1; } },
  { id: 'guard-bees', name: 'Guard Bees', icon: '🛡️', desc: 'Hives sting wasps that come close.', max: 1, apply: m => { m.guardBees = true; } },
  { id: 'rain-dance', name: 'Rain Dance', icon: '☔', desc: 'Rain showers are half as long.', max: 1, apply: m => { m.rainMult *= 0.5; } },
  { id: 'beeswax', name: 'Beeswax Surplus', icon: '🕯️', desc: 'Hives cost 30% less.', max: 1, apply: m => { m.hiveCostMult *= 0.7; } },
  { id: 'seed-bank', name: 'Seed Bank', icon: '🫘', desc: 'Flowers cost 20% less.', max: 1, apply: m => { m.flowerCostMult *= 0.8; } },
  { id: 'rich-soil', name: 'Rich Soil', icon: '🪱', desc: 'Flowers hold 25% more nectar and refill 15% faster.', max: 2, apply: m => { m.nectarMult *= 1.25; m.regenMult *= 1.15; } },
  { id: 'far-flight', name: 'Far Flight', icon: '🧭', desc: 'Bees forage 25% further from their hive.', max: 1, apply: m => { m.rangeMult *= 1.25; } },
  { id: 'honey-pot', name: 'Honey Pot', icon: '🏺', desc: 'Get 25 honey right away.', honey: 25 },
  { id: 'wildflowers', name: 'Wildflower Meadow', icon: '🌼', desc: '6 wild flowers sprout across the meadow.', wildflowers: 6 },
];

export type WeatherKind = 'clear' | 'rain' | 'wind' | 'drought' | 'bloom';

export const WEATHER: Record<WeatherKind, { name: string; icon: string; desc: string }> = {
  clear: { name: 'Clear skies', icon: '☀️', desc: 'Perfect foraging weather.' },
  rain: { name: 'Showers', icon: '🌧️', desc: 'Rain grounds your bees a few times this season.' },
  wind: { name: 'Windy', icon: '🍃', desc: 'Wind blows bees off course and slows them when they fly into it.' },
  drought: { name: 'Drought', icon: '🥵', desc: 'Flowers refill their nectar at half speed.' },
  bloom: { name: 'Super bloom', icon: '🌼', desc: 'Flowers refill their nectar 60% faster.' },
};
