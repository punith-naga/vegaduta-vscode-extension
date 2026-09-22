# Quick Start Guide - Free GitHub Copilot Alternative

Get up and running with your free AI code assistant in minutes!

## 🚀 3-Minute Setup

### Step 1: Enable Free Copilot

In your VSCode extension initialization:

```typescript
import { createWebLlmEngine } from "./webllmEngine";

// Create engine with Free Copilot enabled
const engine = createWebLlmEngine(
  host,
  onStatus,
  false, // extraordinary enhancements (optional)
  undefined, // orchestrator config (optional)
  true, // 🎯 ENABLE FREE COPILOT
  {
    enableCodeCompletion: true,
    enableCodeSearch: true,
    enableCommandExecution: true,
    enableAutonomousActions: false, // Start safe
    maxSuggestions: 5,
    minConfidence: 0.6,
    requireConfirmation: true,
  }
);
```

### Step 2: Index Your Codebase

```typescript
// Get copilot instance
const copilot = (engine as any).copilot;

// Index your project files
const projectFiles = [
  "src/**/*.ts",
  "src/**/*.tsx",
  "src/**/*.js",
  "src/**/*.jsx",
  "lib/**/*.ts",
];

const result = await copilot.indexCodebase(projectFiles);
console.log(`Indexed ${result.indexed} files successfully`);
```

### Step 3: Start Using It!

```typescript
// Get code completions
const suggestions = await copilot.getCodeCompletions(codeContext, engine);

// Search your codebase
const searchResults = await copilot.searchCodebase("authentication logic");

// Explain code
const explanation = await copilot.explainCode(codeSnippet, "typescript", engine);
```

## 💡 Everyday Usage Examples

### Auto-Complete While Typing

```typescript
// When user types in editor:
const context = {
  filePath: editor.document.uri.fsPath,
  language: editor.document.languageId,
  cursorPosition: {
    line: editor.selection.active.line,
    column: editor.selection.active.character
  },
  precedingCode: getPrecedingCode(editor),
  followingCode: getFollowingCode(editor),
  entireFile: editor.document.getText(),
  imports: extractImports(editor.document.getText()),
  functions: extractFunctions(editor.document.getText()),
  classes: extractClasses(editor.document.getText()),
  variables: extractVariables(editor.document.getText()),
};

const suggestions = await copilot.getCodeCompletions(context, engine);

// Show top suggestion inline
if (suggestions.length > 0) {
  showInlineCompletion(suggestions[0].text);
}
```

### Search Code Instantly

```typescript
// User searches: "how to handle API errors"
const results = await copilot.searchCodebase("API error handling", {
  maxResults: 5,
  includeContent: true,
});

// Display results
results.forEach(result => {
  console.log(`Found in ${result.filePath} at line ${result.line}`);
  console.log(`Relevance: ${Math.round(result.relevanceScore * 100)}%`);
  console.log(`Code: ${result.content}`);
});
```

### Get Code Explanations

```typescript
// User selects code and asks: "Explain this"
const selectedCode = getSelectedCode();
const explanation = await copilot.explainCode(
  selectedCode,
  editor.document.languageId,
  engine
);

// Show explanation in a panel
showExplanationPanel(explanation);
```

### Execute Common Commands

```typescript
// Run tests
const testResult = await copilot.executeShellCommand("npm test", true);

// Install dependencies
const installResult = await copilot.executeShellCommand("npm install", true);

// Build project
const buildResult = await copilot.executeShellCommand("npm run build", true);
```

## 🎯 Key Features at a Glance

| Feature | Command | Description |
|---------|---------|-------------|
| **Code Completion** | `getCodeCompletions()` | AI-powered suggestions as you type |
| **Code Search** | `searchCodebase()` | Find code across your entire project |
| **Code Explanation** | `explainCode()` | Get clear explanations of any code |
| **Command Execution** | `executeShellCommand()` | Run terminal commands safely |
| **Task Planning** | `planDevelopmentTask()` | Break down complex tasks into steps |
| **Codebase Indexing** | `indexCodebase()` | Index your project for fast search |

## 🔧 VSCode Integration Example

```typescript
// Register a command for code completion
vscode.commands.registerCommand('vegaduta.copilot.complete', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const copilot = getCopilotEngine(); // Your function to get copilot instance
  const context = extractCodeContext(editor);

  const suggestions = await copilot.getCodeCompletions(context, engine);

  if (suggestions.length > 0) {
    // Show quick pick with suggestions
    const selected = await vscode.window.showQuickPick(
      suggestions.map(s => ({
        label: s.text.substring(0, 50),
        description: s.description,
        detail: `Confidence: ${Math.round(s.confidence * 100)}%`
      }))
    );

    if (selected) {
      const fullSuggestion = suggestions.find(s => s.text.startsWith(selected.label));
      if (fullSuggestion) {
        const position = editor.selection.active;
        editor.edit(editBuilder => {
          editBuilder.insert(position, fullSuggestion.text);
        });
      }
    }
  }
});

// Register command for code search
vscode.commands.registerCommand('vegaduta.copilot.search', async () => {
  const query = await vscode.window.showInputBox({
    prompt: 'Search your codebase',
    placeHolder: 'e.g., "authentication logic" or "error handling"'
  });

  if (query) {
    const copilot = getCopilotEngine();
    const results = await copilot.searchCodebase(query);

    // Show results in a webview or quick pick
    showSearchResults(results);
  }
});

// Register command for code explanation
vscode.commands.registerCommand('vegaduta.copilot.explain', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const selectedCode = editor.document.getText(selection);

  if (selectedCode) {
    const copilot = getCopilotEngine();
    const explanation = await copilot.explainCode(
      selectedCode,
      editor.document.languageId,
      engine
    );

    // Show explanation in a new document or panel
    showExplanation(explanation);
  }
});
```

## 📋 Recommended VSCode Keybindings

Add these to your `keybindings.json`:

```json
{
  "key": "ctrl+space",
  "command": "vegaduta.copilot.complete",
  "when": "editorTextFocus"
},
{
  "key": "ctrl+shift+f",
  "command": "vegaduta.copilot.search",
  "when": "editorTextFocus"
},
{
  "key": "ctrl+shift+e",
  "command": "vegaduta.copilot.explain",
  "when": "editorTextFocus && editorHasSelection"
}
```

## 🎨 Tips for Best Results

### 1. **Index Your Codebase Regularly**
```typescript
// Re-index when files change
vscode.workspace.onDidSaveTextDocument(async (document) => {
  const copilot = getCopilotEngine();
  await copilot.indexCodebase([document.uri.fsPath]);
});
```

### 2. **Provide Good Context**
```typescript
// Include surrounding code for better completions
const context = {
  // ... other fields
  precedingCode: getExtendedPrecedingCode(editor, 10), // 10 lines before
  followingCode: getExtendedFollowingCode(editor, 5),  // 5 lines after
};
```

### 3. **Adjust Confidence Threshold**
```typescript
// Lower threshold for more suggestions (might be less accurate)
copilot.setConfig({ minConfidence: 0.5 });

// Raise threshold for fewer but higher quality suggestions
copilot.setConfig({ minConfidence: 0.8 });
```

### 4. **Use Semantic Search**
```typescript
// Search for concepts, not just exact matches
const results = await copilot.searchCodebase("user authentication flow", {
  searchType: "semantic" // Find related code even if exact words don't match
});
```

## 🚨 Troubleshooting

### Problem: No completions appearing
**Solution:**
1. Check that WebLLM model is downloaded
2. Verify copilot is enabled: `copilot.getConfig().enableCodeCompletion`
3. Ensure minimum confidence isn't too high
4. Check that file language is supported

### Problem: Search returns no results
**Solution:**
1. Make sure codebase is indexed: `await copilot.indexCodebase(files)`
2. Try broader search terms
3. Check that search is enabled in config
4. Verify file paths are correct

### Problem: Commands fail to execute
**Solution:**
1. Ensure command execution is enabled
2. Check required permissions
3. Verify command syntax
4. Review command history: `copilot.getCommandHistory()`

## 📊 Performance Tips

### 1. **Use Caching**
Completions are automatically cached for 30 seconds - no manual setup needed!

### 2. **Index Strategically**
Index only the files you actually work with:
```typescript
const importantFiles = [
  "src/**/*.ts",      // Your source code
  "lib/**/*.ts",      // Your libraries
  // Skip node_modules, dist, build folders
];
```

### 3. **Adjust Context Window**
For faster completions, reduce context window:
```typescript
copilot.setConfig({ contextWindowSize: 1024 }); // Smaller = faster
```

## 🎓 Next Steps

1. **Explore All Features**: Try code search, explanations, and command execution
2. **Customize Configuration**: Adjust settings to match your workflow
3. **Integrate with Your Workflow**: Add custom commands and automations
4. **Provide Feedback**: Help improve the system by reporting issues

## 💪 Advanced Usage

### Autonomous Development (Use with Caution)
```typescript
// Enable autonomous actions
copilot.setConfig({ enableAutonomousActions: true, autoExecuteCommands: false });

// Plan and execute a complex task
const plan = await copilot.planDevelopmentTask(
  "Add unit tests for authentication module",
  engine
);

const result = await copilot.executeDevelopmentPlan(plan.steps, (step, total, desc) => {
  console.log(`Executing step ${step}/${total}: ${desc}`);
});
```

### Custom Tool Integration
```typescript
// Add your own tools to the copilot
copilot.toolRegistry.registerTool({
  name: "run_linter",
  description: "Run linter on current file",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", required: true }
    },
    required: ["filePath"]
  },
  handler: async (params) => {
    // Your custom linter logic
    return { success: true, data: { issues: [] } };
  },
  category: "analysis",
  requiresConfirmation: false,
  timeout: 30000
});
```

---

**You're all set!** 🎉

Your free AI code assistant is now ready to help you code faster and smarter. No subscription required, no payment needed - just powerful AI assistance running locally on your machine.

For more detailed information, see [README_COPILOT.md](./README_COPILOT.md)
