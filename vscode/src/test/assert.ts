// Plain throwing assertions - typed by this package, no vitest import needed.

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`assertion failed: ${message}\n  expected ${e}\n  actual   ${a}`);
}

export function assertIncludes(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`assertion failed: ${message}\n  expected to include ${JSON.stringify(needle)}\n  in ${JSON.stringify(haystack)}`);
  }
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
