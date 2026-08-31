import { describe, expect, test } from 'vitest';
import { rankBetween, ranksAfter, seedRanks } from './rank';

describe('seedRanks', () => {
  test('returns the requested number of keys in ascending order', () => {
    const ranks = seedRanks(5);

    expect(ranks).toHaveLength(5);
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBe(5);
  });

  test('returns nothing for a count of zero', () => {
    expect(seedRanks(0)).toEqual([]);
  });
});

describe('rankBetween', () => {
  test('sorts strictly between its neighbours', () => {
    const [first, second] = seedRanks(2);

    const middle = rankBetween(first, second);

    expect(first < middle).toBe(true);
    expect(middle < second).toBe(true);
  });

  test('extends past either end', () => {
    const [only] = seedRanks(1);

    expect(rankBetween(null, only) < only).toBe(true);
    expect(rankBetween(only, null) > only).toBe(true);
  });
});

describe('ranksAfter', () => {
  test('returns the requested number of keys, all after the given one', () => {
    const keys = ranksAfter('a0', 3);

    expect(keys).toHaveLength(3);
    expect(keys.every((key) => key > 'a0')).toBe(true);
    expect([...keys].sort()).toEqual(keys);
  });

  test('starts from the beginning when there is nothing before', () => {
    expect(ranksAfter(null, 2)).toEqual(seedRanks(2));
  });

  test('returns nothing for a count of zero', () => {
    expect(ranksAfter('a0', 0)).toEqual([]);
  });
});
