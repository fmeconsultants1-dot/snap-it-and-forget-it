/**
 * money.runtime.test.ts - FME Mission 001
 * Runtime execution of money.ts deterministic arithmetic.
 * All assertions against actual computed values — no mocks.
 * Run: cd worker && npx vitest run src/tests/runtime/money.runtime.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  toCents, toDollars, add, subtract, multiply,
  allocateProportionally, splitProportional, verifySumExact
} from '../../lib/money';

describe('RUNTIME: toCents / toDollars', () => {
  it('96.34 -> 9634 -> 96.34', () => {
    const cents = toCents(96.34);
    expect(cents).toBe(9634);
    expect(toDollars(cents)).toBe(96.34);
  });
  it('0.01 -> 1 -> 0.01', () => {
    expect(toCents(0.01)).toBe(1);
    expect(toDollars(1)).toBe(0.01);
  });
  it('695.23 -> 69523 -> 695.23', () => {
    expect(toCents(695.23)).toBe(69523);
  });
});

describe('RUNTIME: add / subtract (float trap)', () => {
  it('0.1 + 0.2 = 0.30 exactly', () => {
    // In raw float: 0.1 + 0.2 = 0.30000000000000004
    expect(add(0.1, 0.2)).toBe(0.30);
    expect(add(0.1, 0.2) === 0.30).toBe(true);
  });
  it('96.34 - 48.17 = 48.17 exactly', () => {
    expect(subtract(96.34, 48.17)).toBe(48.17);
  });
  it('100.00 - 33.33 - 33.33 - 33.34 = 0', () => {
    const r1 = subtract(100.00, 33.33);
    const r2 = subtract(r1, 33.33);
    const r3 = subtract(r2, 33.34);
    expect(r3).toBe(0);
  });
});

describe('RUNTIME: multiply', () => {
  it('100.00 * 0.5 = 50.00 exactly', () => {
    expect(multiply(100.00, 0.5)).toBe(50.00);
  });
  it('69.14 * (1/3) is finite and close to 23.05', () => {
    const result = multiply(69.14, 1/3);
    expect(Number.isFinite(result)).toBe(true);
    expect(Math.abs(result - 23.05)).toBeLessThan(0.01);
  });
});

describe('RUNTIME: allocateProportionally - largest-remainder', () => {
  it('100 cents / 3 equal weights: sum = 100 exactly', () => {
    const result = allocateProportionally(100, [100, 100, 100]);
    expect(result.reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('10000 cents / weights [100,80,6267]: sum = 10000', () => {
    const result = allocateProportionally(toCents(254.80), [toCents(100), toCents(80), toCents(62.67)]);
    expect(result.reduce((s, v) => s + v, 0)).toBe(toCents(254.80));
  });
  it('zero total weight: distributes equally', () => {
    const result = allocateProportionally(100, [0, 0, 0]);
    expect(result.reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('single weight: gets everything', () => {
    const result = allocateProportionally(5000, [1]);
    expect(result[0]).toBe(5000);
  });
});

describe('RUNTIME: splitProportional - dollar level', () => {
  it('$100 split [60,40]: sum = $100.00 exactly (diffCents = 0)', () => {
    const parts = splitProportional(100.00, [60, 40]);
    const check = verifySumExact(parts, 100.00);
    expect(check.valid).toBe(true);
    expect(check.diffCents).toBe(0);
  });
  it('$100 split [33.33,33.33,33.34] weights: sum = $100.00', () => {
    const parts = splitProportional(100.00, [100, 100, 100]);
    const check = verifySumExact(parts, 100.00);
    expect(check.valid).toBe(true);
    expect(check.diffCents).toBe(0);
  });
  it('$12.13 GST split [100,80,62.67]: sum = $12.13', () => {
    const parts = splitProportional(12.13, [100, 80, 62.67]);
    const check = verifySumExact(parts, 12.13);
    expect(check.valid).toBe(true);
  });
  it('$47.50 GST split 5 ways [200,250,150,200,150]: sum = $47.50', () => {
    const parts = splitProportional(47.50, [200, 250, 150, 200, 150]);
    const check = verifySumExact(parts, 47.50);
    expect(check.valid).toBe(true);
  });
  it('$3.29 GST split 3 ways: exact sum', () => {
    const parts = splitProportional(3.29, [100, 100, 100]);
    const check = verifySumExact(parts, 3.29);
    expect(check.valid).toBe(true);
  });
  it('$695.23 partial refund ratio 33%: sum exact', () => {
    const parts = splitProportional(695.23, [620.76, 74.47]);
    const check = verifySumExact(parts, 695.23);
    expect(check.valid).toBe(true);
  });
});

describe('RUNTIME: verifySumExact', () => {
  it('33.33 + 33.33 + 33.34 = 100.00 (valid)', () => {
    const check = verifySumExact([33.33, 33.33, 33.34], 100.00);
    expect(check.valid).toBe(true);
    expect(check.diffCents).toBe(0);
  });
  it('33.33 + 33.33 + 33.33 != 100.00 (invalid, off by 1 cent)', () => {
    const check = verifySumExact([33.33, 33.33, 33.33], 100.00);
    expect(check.valid).toBe(false);
    expect(check.diffCents).toBe(-1);
  });
  it('96.34 refund in 3 parts: exact', () => {
    const parts = splitProportional(96.34, [100, 100, 100]);
    const check = verifySumExact(parts, 96.34);
    expect(check.valid).toBe(true);
  });
});
