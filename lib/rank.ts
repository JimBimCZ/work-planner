import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export const rankBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);

export const seedRanks = (count: number) => generateNKeysBetween(null, null, count);
