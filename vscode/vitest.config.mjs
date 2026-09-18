// Test config for `npm test`. There is no vitest in this package: the script
// borrows the one installed in web/node_modules (the same arrangement
// clients/chrome uses), so this file imports nothing from vitest - a plain
// object is a valid config.
//
// The one thing it adds: "vscode" is not a real package outside the editor,
// so it is aliased to a small hand-written mock (src/test/vscodeMock.ts).

import { fileURLToPath } from "node:url";

export default {
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./src/test/vscodeMock.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
};
