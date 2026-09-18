// A small, hand-written stand-in for the `vscode` module, for unit tests.
//
// vitest.config.mjs aliases "vscode" to this file, so the extension's real
// modules import it unchanged. It implements only what the modules under test
// touch; anything else is simply absent (a test that reaches for it fails
// loudly, which is the point). Tests reach the knobs through `mock` below,
// imported by relative path - the alias resolves to this same module instance.
//
// Not shipped: .vscodeignore drops src/** and esbuild bundles from
// src/extension.ts, which never imports this file.

import { posix, sep } from "node:path";

// --- Uri --------------------------------------------------------------------

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string
  ) {}

  static file(fsPath: string): Uri {
    let p = fsPath.replace(/\\/g, "/");
    // VS Code lower-cases the drive letter and roots it: C:\x -> /c:/x.
    if (/^[a-zA-Z]:/.test(p)) p = `/${p[0].toLowerCase()}${p.slice(1)}`;
    if (!p.startsWith("/")) p = `/${p}`;
    return new Uri("file", p);
  }

  static parse(value: string): Uri {
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/[^/]*(\/.*)?$/.exec(value);
    return m ? new Uri(m[1], m[2] ?? "/") : new Uri("file", value);
  }

  /** Like vscode.Uri.joinPath: posix join, so ".." collapses. */
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, posix.join(base.path, ...segments));
  }

  get fsPath(): string {
    if (/^\/[a-zA-Z]:/.test(this.path)) return this.path.slice(1).replace(/\//g, "\\");
    return sep === "\\" ? this.path.replace(/\//g, "\\") : this.path;
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

// --- small value types ------------------------------------------------------

export class Position {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
    this.start = new Position(startLine, startChar);
    this.end = new Position(endLine, endChar);
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

export class Selection extends Range {}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ViewColumn {
  Active = -1,
  One = 1,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ConfigurationTarget {
  Global = 1,
}

type Listener<T> = (value: T) => unknown;

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  readonly event = (listener: Listener<T>): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  };
  fire(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}

// --- test knobs -------------------------------------------------------------

export interface MockDocument {
  uri: Uri;
  lineCount: number;
  languageId: string;
  isClosed: boolean;
  getText(range?: Range): string;
  lineAt(line: number): { range: Range };
}

/** A text document over `text` (lines split on \n). */
export function mockDocument(uri: Uri, text: string, languageId = "plaintext"): MockDocument {
  const lines = text.split("\n");
  return {
    uri,
    lineCount: lines.length,
    languageId,
    isClosed: false,
    getText: () => text,
    lineAt: (line: number) => ({ range: new Range(line, 0, line, lines[line]?.length ?? 0) }),
  };
}

export const mock = {
  /** Every show*Message call, in order. */
  messages: [] as Array<{ level: "info" | "warning" | "error"; text: string }>,
  /** Answer returned by the next show*Message calls (a button label). */
  messageAnswer: undefined as string | undefined,
  executed: [] as Array<{ command: string; args: unknown[] }>,
  commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  clipboard: "",
  activeTerminal: undefined as { name: string } | undefined,
  activeTextEditor: undefined as unknown,
  workspaceFolders: undefined as Array<{ uri: Uri; name: string; index: number }> | undefined,
  extensions: new Map<string, unknown>(),
  documents: new Map<string, MockDocument>(),
  shown: [] as Array<{ uri: string; selection?: Range }>,
  revealed: [] as Range[],
  config: new Map<string, unknown>(),
  reset(): void {
    this.messages = [];
    this.messageAnswer = undefined;
    this.executed = [];
    this.commandHandlers = new Map();
    this.clipboard = "";
    this.activeTerminal = undefined;
    this.activeTextEditor = undefined;
    this.workspaceFolders = undefined;
    this.extensions = new Map();
    this.documents = new Map();
    this.shown = [];
    this.revealed = [];
    this.config = new Map();
  },
};

// --- namespaces ---------------------------------------------------------------

function message(level: "info" | "warning" | "error") {
  return async (text: string): Promise<string | undefined> => {
    mock.messages.push({ level, text });
    return mock.messageAnswer;
  };
}

export const window = {
  get activeTextEditor(): unknown {
    return mock.activeTextEditor;
  },
  get activeTerminal(): { name: string } | undefined {
    return mock.activeTerminal;
  },
  onDidChangeActiveTextEditor: (_listener: unknown) => ({ dispose() {} }),
  showInformationMessage: message("info"),
  showWarningMessage: message("warning"),
  showErrorMessage: message("error"),
  async showTextDocument(document: MockDocument, options?: { selection?: Range }) {
    mock.shown.push({ uri: document.uri.toString(), selection: options?.selection });
    return {
      document,
      revealRange: (range: Range) => mock.revealed.push(range),
    };
  },
  createStatusBarItem() {
    return { show() {}, hide() {}, dispose() {} };
  },
};

export const workspace = {
  get workspaceFolders() {
    return mock.workspaceFolders;
  },
  asRelativePath(target: Uri | string): string {
    const path = typeof target === "string" ? target : target.path;
    for (const folder of mock.workspaceFolders ?? []) {
      const root = folder.uri.path.replace(/\/+$/, "");
      if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
    }
    return typeof target === "string" ? target : target.fsPath;
  },
  async openTextDocument(uri: Uri): Promise<MockDocument> {
    const doc = mock.documents.get(uri.toString());
    if (!doc) throw new Error(`mock: no document ${uri.toString()}`);
    return doc;
  },
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        return mock.config.has(key) ? (mock.config.get(key) as T) : fallback;
      },
      async update() {},
    };
  },
};

export const env = {
  clipboard: {
    async readText(): Promise<string> {
      return mock.clipboard;
    },
    async writeText(text: string): Promise<void> {
      mock.clipboard = text;
    },
  },
  async openExternal() {
    return true;
  },
};

export const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    mock.executed.push({ command, args });
    return mock.commandHandlers.get(command)?.(...args);
  },
  registerCommand() {
    return { dispose() {} };
  },
};

export const extensions = {
  getExtension(id: string): unknown {
    return mock.extensions.get(id);
  },
};

export const languages = {
  getDiagnostics(): unknown[] {
    return [];
  },
};
