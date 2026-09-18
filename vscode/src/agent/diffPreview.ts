// Consent you can actually give: the agent's proposed file contents shown
// against the real file in VS Code's own diff editor, before anything is
// written. A summary ("- 3 lines removed / + 5 added") tells you the size of a
// change, never what it does.
//
// Three deliberate choices:
//  - The proposed side is a read-only in-memory document served by a
//    TextDocumentContentProvider, never a temp file. Nothing touches the
//    workspace until the user says Apply.
//  - The prompt is NOT modal. A modal dialog sits on top of the diff and blocks
//    scrolling, so it would ask "do you accept this?" while stopping you from
//    reading it. A warning notification stays on screen until it is answered
//    (VS Code auto-dismisses info, not warnings) and leaves the diff usable.
//  - Nothing here throws. If the diff editor cannot be opened at all, the
//    prompt falls back to the modal summary rather than failing the run.

import * as vscode from "vscode";

const SCHEME = "vegaduta-agent-proposed";

const APPLY = "Apply";
const SKIP = "Skip";
const ALLOW_ALL = "Allow all edits this run";
const STOP = "Stop the agent";

class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }

  put(uri: vscode.Uri, text: string): void {
    this.contents.set(uri.toString(), text);
    this.changed.fire(uri);
  }

  forget(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  dispose(): void {
    this.contents.clear();
    this.changed.dispose();
  }
}

let provider: ProposedContentProvider | undefined;
let registration: vscode.Disposable | undefined;
let previewCount = 0;

/** Registered on first use: most sessions never start a coding task, and an
 * unused content provider is still a listener on every document open. */
function ensureProvider(): ProposedContentProvider {
  if (!provider) {
    provider = new ProposedContentProvider();
    registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider);
  }
  return provider;
}

/** Called from deactivate(), since the registration is lazy and therefore not
 * in context.subscriptions. */
export function disposeDiffPreview(): void {
  registration?.dispose();
  provider?.dispose();
  registration = undefined;
  provider = undefined;
}

export type PreviewDecision = "apply" | "skip" | "allow-all" | "stop";

export interface ProposedChange {
  /** The real file. Used as the diff's left side so an open, unsaved buffer is
   * what the user is shown - the same text the caller matched against. */
  uri: vscode.Uri;
  /** Workspace-relative path, for the diff title. */
  label: string;
  /** Contents right now, or null when the file does not exist yet. */
  current: string | null;
  /** Contents the agent wants it to have. */
  proposed: string;
}

/**
 * Open the diff and ask. The returned decision is advisory to the caller: this
 * function writes nothing and closes nothing but its own tab.
 */
export async function previewChange(
  change: ProposedChange,
  summary: string,
  detail: string
): Promise<PreviewDecision> {
  const store = ensureProvider();
  previewCount += 1;

  // The URI ends in the real filename so the diff gets the right language and
  // syntax highlighting, and carries a counter so a second preview of the same
  // file is never served from VS Code's content cache.
  const name = change.label.split("/").pop() || "file";
  const after = vscode.Uri.parse(`${SCHEME}:/${previewCount}/proposed/${name}`);
  store.put(after, change.proposed);

  const isNew = change.current === null;
  const before = isNew ? vscode.Uri.parse(`${SCHEME}:/${previewCount}/empty/${name}`) : change.uri;
  if (isNew) store.put(before, "");

  const title = isNew
    ? `${change.label} (new file) - VegaDuta proposal`
    : `${change.label} - on disk vs VegaDuta proposal`;

  let opened = true;
  try {
    // vscode.diff opens its own editor, so this works in a window with no
    // visible editor at all.
    await vscode.commands.executeCommand("vscode.diff", before, after, title, {
      preview: true,
      preserveFocus: false,
    });
  } catch {
    opened = false;
  }

  const choice = opened
    ? await vscode.window.showWarningMessage(`${summary} - ${detail}`, APPLY, SKIP, ALLOW_ALL, STOP)
    : await vscode.window.showWarningMessage(
        summary,
        { modal: true, detail: `${detail}\n\nThe diff editor could not be opened, so this is the summary only.` },
        APPLY,
        ALLOW_ALL,
        STOP
      );

  await closeDiff(after);
  store.forget(after);
  if (isNew) store.forget(before);

  switch (choice) {
    case APPLY:
      return "apply";
    case ALLOW_ALL:
      return "allow-all";
    case STOP:
      return "stop";
    default:
      // Dismissing is a refusal of this step, not of the run - same rule the
      // modal gate has always used.
      return "skip";
  }
}

async function closeDiff(modified: vscode.Uri): Promise<void> {
  try {
    const target = modified.toString();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input: unknown = tab.input;
        if (input instanceof vscode.TabInputTextDiff && input.modified.toString() === target) {
          await vscode.window.tabGroups.close(tab, true);
        }
      }
    }
  } catch {
    // A tab that will not close is cosmetic. Never fail an approved edit on it.
  }
}
