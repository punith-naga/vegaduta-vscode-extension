// Small fakes shared by the tests.

import type { FlagStore } from "../privacy";

/** An in-memory vscode.Memento stand-in. */
export function memoryStore(initial: Record<string, unknown> = {}): FlagStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: <T>(key: string, fallback: T): T => (key in data ? (data[key] as T) : fallback),
    update: async (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}
