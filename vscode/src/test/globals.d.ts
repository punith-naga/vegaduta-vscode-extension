// The vitest globals (`npm test` passes --globals). Declared here rather than
// imported from "vitest" because vitest is not a dependency of this package
// (it is borrowed from web/node_modules), so `tsc --noEmit` could not resolve
// the import. Tests use the plain assert helpers in ./assert.ts, not expect.

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;
