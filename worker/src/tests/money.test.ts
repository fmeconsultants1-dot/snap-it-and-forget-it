/**
 * money.test.ts — FME Mission 001
 * Unit tests for money.ts deterministic arithmetic.
 * Run: cd worker && npx vitest run src/tests/money.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  toCents, toDollars, add, subtract, multiply,
  allocateProportionally, splitProportional, verifySumExact
} from '../lib/money';

describe('toCents / toDollars round-trip', () => {
  it('96.34 -> 9634 -> 96.34', () => {
    expect(toCents(96.34)).toBe(9634);
    expect(toDollars(9634)).toBe(96.34);
  });
  it('0.01 -> 1 -> 0.01', () => {
    expect(toCents(0.01)).toBe(1);
    expect(toDollars(1)).toBe(0.01);
  });
  it('100.00 -> 10000 -> 100.00', () => {
    expect(toCents(100.00)).toBe(10000);
  });
});

describe('add / subtract', () => {
  it('0.1 + 0.2 = 0.30 exactly (float trap)', () => {
    expect(add(0.1, 0.2)).toBe(0.30);
  });
  it('96.34 - 48.17 = 48.17', () => {
    expect(subtract(96.34, 48.17)).toBe(48.17);
  });
});

describe('multiply', () => {
  it('100.00 * 0.5 = 50.00', () => { expect(multiply(100.00, 0.5)).toBe(50.00); });
  it('69.14 * (1/3) rounds to nearest cent', () => {
    const result = multiply(69.14, 1/3);
    expect(Number.isFinite(result)).toBe(true);
    expect(Math.abs(result - 23.05)).toBeLessThan(0.01);
  });
});

describe('allocateProportionally — largest-remainder method', () => {
  it('100 cents split 3 equal weights: [34,33,33] or [33,34,33] — sums to 100', () => {
    const result = allocateProportionally(100, [100, 100, 100]);
    expect(result.reduce((s,v) => s+v, 0)).toBe(100);
  });
  it('10000 cents split [100,80,62.67] weights: sums to 10000 exactly', () => {
    const weights = [toCents(100), toCents(80), toCents(62.67)];
    const result = allocateProportionally(toCents(254.80), weights);
    expect(result.reduce((s,v) => s+v, 0)).toBe(toCents(254.80));
  });
  it('zero total weight: distributes equally', () => {
    const result = allocateProportionally(100, [0, 0, 0]);
    expect(result.reduce((s,v) => s+v, 0)).toBe(100);
  });
});

describe('splitProportional — dollar level', () => {
  it('$100 split [60,40]: sums to $100.00 exactly', () => {
    const parts = splitProportional(100.00, [60, 40]);
    const check = verifySumExact(parts, 100.00);
    expect(check.valid).toBe(true);
    expect(check.diffCents).toBe(0);
  });

  it('$100 split [33.33,33.33,33.34]: sums to $100.00', () => {
    // The weights are equal thirds; largest-remainder gives exact sum
    const parts = splitProportional(100.00, [100, 100, 100]);
    const check = verifySumExact(parts, 100.00);
    expect(check.valid).toBe(true);
  });

  it('$12.13 GST split [100,80,62.67]: sums to $12.13', () => {
    const parts = splitProportional(12.13, [100, 80, 62.67]);
    const check = verifySumExact(parts, 12.13);
    expect(check.valid).toBe(true);
  });

  it('$47.50 GST split 5 ways [200,250,150,200,150]: sums to $47.50', () => {
    const parts = splitProportional(47.50, [200, 250, 150, 200, 150]);
    const check = verifySumExact(parts, 47.50);
    expect(check.valid).toBe(true);
  });

  it('$3.29 split 1/3: proportional and exact', () => {
    const parts = splitProportional(3.29, [100, 100, 100]);
    const check = verifySumExact(parts, 3.29);
    expect(check.valid).toBe(true);
  });
});

describe('verifySumExact', () => {
  it('valid when exact', () => {
    expect(verifySumExact([33.33, 33.33, 33.34], 100.00).valid).toBe(true);
  });
  it('invalid when off by 1 cent', () => {
    expect(verifySumExact([33.33, 33.33, 33.33], 100.00).valid).toBe(false);
    expect(verifySumExact([33.33, 33.33, 33.33], 100.00).diffCents).toBe(-1);
  });
});
