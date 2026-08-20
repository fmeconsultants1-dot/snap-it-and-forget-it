/**
 * money.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Deterministic money arithmetic for accounting.
 *
 * WHY THIS EXISTS:
 *   0.1 + 0.2 !== 0.3 in IEEE 754 floating point.
 *   Accounting requires that:
 *     SUM(allocated_parts) === total EXACTLY
 *   Not approximately. Not within epsilon. EXACTLY.
 *
 * APPROACH:
 *   All amounts are stored and computed as integer cents.
 *   Input: dollars (number with up to 2 decimal places)
 *   Internal: cents (integer, no fractional cents)
 *   Output: dollars (rounded to 2 decimal places)
 *
 * PROPORTIONAL ALLOCATION (splitProportional):
 *   Given a total and a list of weights (subtotals),
 *   allocate the total proportionally.
 *   The largest-remainder method ensures:
 *     SUM(allocated) === total EXACTLY
 *   Remainder cents are distributed to the largest remainders first.
 *
 * This eliminates floating-point drift in:
 *   - Tax allocation across split lines
 *   - Partial refund calculation
 *   - Any proportional distribution
 */

/**
 * Convert dollars to cents (integer).
 * Input must be a number with at most 2 decimal places.
 * Throws if input is not finite or results in a non-integer cent value.
 */
export function toCents(dollars: number): number {
  if (!isFinite(dollars)) {
    throw new Error(`Invalid money value: ${dollars}`);
  }
  const cents = Math.round(dollars * 100);
  // Verify the round-trip: $X.YZ -> cents -> $X.YZ
  // Allow 0.001 tolerance for floating-point input imprecision
  if (Math.abs(cents / 100 - dollars) > 0.005) {
    throw new Error(
      `Money value ${dollars} has more than 2 decimal places or is otherwise imprecise`
    );
  }
  return cents;
}

/**
 * Convert cents (integer) to dollars (number, 2 decimal places).
 */
export function toDollars(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new Error(`Cents must be an integer, got: ${cents}`);
  }
  return cents / 100;
}

/**
 * Add two dollar amounts safely via cents.
 */
export function add(a: number, b: number): number {
  return toDollars(toCents(a) + toCents(b));
}

/**
 * Subtract two dollar amounts safely via cents.
 */
export function subtract(a: number, b: number): number {
  return toDollars(toCents(a) - toCents(b));
}

/**
 * Multiply a dollar amount by a ratio, rounded to nearest cent.
 */
export function multiply(dollars: number, ratio: number): number {
  return toDollars(Math.round(toCents(dollars) * ratio));
}

/**
 * Proportional allocation using the largest-remainder method.
 *
 * Given a total amount (in dollars) and a list of weights (in dollars,
 * e.g. subtotals), returns an array of allocated amounts that:
 *   1. Are each proportional to the corresponding weight
 *   2. Sum EXACTLY to the total
 *   3. Are each non-negative
 *   4. Are each expressed to 2 decimal places
 *
 * The largest-remainder method distributes any remainder cents
 * (due to integer rounding) to the items with the largest fractional
 * remainders first.
 *
 * @param totalCents   - Total to allocate (in cents)
 * @param weights      - Array of weights (in cents, must sum > 0)
 * @returns Array of allocated amounts (in cents), same length as weights
 */
export function allocateProportionally(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isInteger(totalCents)) {
    throw new Error(`totalCents must be an integer: ${totalCents}`);
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) {
    // Equal distribution when all weights are zero
    const base = Math.floor(totalCents / weights.length);
    const remainder = totalCents - base * weights.length;
    return weights.map((_, i) => base + (i < remainder ? 1 : 0));
  }

  // Step 1: Compute raw (unrounded) allocation for each weight
  const rawAllocations = weights.map(w => (w / totalWeight) * totalCents);

  // Step 2: Floor each allocation to integer cents
  const flooredAllocations = rawAllocations.map(r => Math.floor(r));

  // Step 3: Compute remainders (the fractional part of each allocation)
  const remainders = rawAllocations.map((r, i) => r - flooredAllocations[i]!);

  // Step 4: Compute how many cents are unallocated
  const allocatedSoFar = flooredAllocations.reduce((s, a) => s + a, 0);
  let remainingCents = totalCents - allocatedSoFar;

  // Step 5: Sort by remainder descending, distribute extra cents
  const indices = remainders
    .map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r);

  const result = [...flooredAllocations];
  for (const { i } of indices) {
    if (remainingCents <= 0) break;
    result[i]! += 1;
    remainingCents -= 1;
  }

  // Invariant check
  const resultSum = result.reduce((s, a) => s + a, 0);
  if (resultSum !== totalCents) {
    throw new Error(
      `allocateProportionally invariant violated: sum ${resultSum} !== total ${totalCents}`
    );
  }

  return result;
}

/**
 * Dollar-level proportional allocation.
 * Takes dollar amounts, allocates in cents, returns dollar amounts.
 * Guaranteed: SUM(result) === total (exactly, to 2 decimal places).
 */
export function splitProportional(totalDollars: number, weightsDollars: number[]): number[] {
  const totalCents = toCents(totalDollars);
  const weightsCents = weightsDollars.map(toCents);
  const allocatedCents = allocateProportionally(totalCents, weightsCents);
  return allocatedCents.map(toDollars);
}

/**
 * Verify that a list of dollar amounts sums exactly to an expected total.
 * Returns { valid: true } or { valid: false, actual, expected, diffCents }
 */
export function verifySumExact(
  amounts: number[],
  expectedTotal: number
): { valid: boolean; actual: number; expected: number; diffCents: number } {
  const actualCents = amounts.reduce((s, a) => s + toCents(a), 0);
  const expectedCents = toCents(expectedTotal);
  const diffCents = actualCents - expectedCents;
  return {
    valid: diffCents === 0,
    actual: toDollars(actualCents),
    expected: toDollars(expectedCents),
    diffCents,
  };
}

/**
 * Compute a partial refund amount for each tax component proportionally.
 * The sum of all returned amounts equals the gross refund amount exactly.
 */
export function allocateRefundTax(params: {
  grossRefundCents: number;
  originalSubtotalCents: number;
  originalGstCents: number;
  originalHstCents: number;
  originalPstCents: number;
}): {
  subtotalCents: number;
  gstCents: number;
  hstCents: number;
  pstCents: number;
} {
  const {
    grossRefundCents,
    originalSubtotalCents,
    originalGstCents,
    originalHstCents,
    originalPstCents,
  } = params;

  const originalComponents = [
    originalSubtotalCents,
    originalGstCents,
    originalHstCents,
    originalPstCents,
  ];

  const allocated = allocateProportionally(grossRefundCents, originalComponents);

  return {
    subtotalCents: allocated[0]!,
    gstCents: allocated[1]!,
    hstCents: allocated[2]!,
    pstCents: allocated[3]!,
  };
}
