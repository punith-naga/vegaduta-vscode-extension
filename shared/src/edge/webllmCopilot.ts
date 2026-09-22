// Free GitHub Copilot Alternative - Intelligent Code Assistant
// Provides code completion, search, command execution, and autonomous development help

import type { EdgeHost } from "./host";
import type { EngineGenerateRequest, EngineGenerateResult } from "./engine";
import type { ManifestModel, EdgeCapabilities } from "./capabilities";

// Import existing enhancement modules
import { createToolIntegrationSystem, type ToolRegistry, type FileIndexer } from "./webllmTools";
import { createMultiModalSystem, type AdvancedContextManager } from "./webllmMultimodal";
import { createAdvancedWebLlmEngine, type IntelligentModelRouter } from "./webllmAdvanced";

// ---------------------------------------------------------------------------
// Copilot-like Code Completion System
// ---------------------------------------------------------------------------

interface CodeCompletionContext {
  filePath: string;
  language: string;
  cursorPosition: { line: number; column: number };
  precedingCode: string;
  followingCode: string;
  entireFile: string;
  imports: string[];
  functions: Array<{ name: string; line: number }>;
  classes: Array<{ name: string; line: number }>;
  variables: Array<{ name: string; line: number }>;
}

interface CodeCompletionSuggestion {
  text: string;
  confidence: number;
  type: "function" | "variable" | "statement" | "comment" | "import";
  description: string;
  metadata?: {
    modelUsed: string;
    generationTime: number;
    contextHash: string;
  };
}

export interface CopilotConfig {
  enableCodeCompletion: boolean;
  enableCodeSearch: boolean;
  enableCommandExecution: boolean;
  enableAutonomousActions: boolean;
  maxSuggestions: number;
  minConfidence: number;
  contextWindowSize: number;
  autoExecuteCommands: boolean;
  requireConfirmation: boolean;
}

export class FreeCopilotEngine {
  private host: EdgeHost;
  private config: CopilotConfig;
  private toolRegistry: ToolRegistry;
  private fileIndexer: FileIndexer;
  private contextManager: AdvancedContextManager;
  private modelRouter: IntelligentModelRouter;

  // Code completion cache
  private completionCache = new Map<string, {
    suggestions: CodeCompletionSuggestion[];
    timestamp: number;
  }>();

  // Command history
  private commandHistory: Array<{
    command: string;
    timestamp: number;
    success: boolean;
    output: string;
  }> = [];

  // Autonomous action queue
  private actionQueue: Array<{
    action: string;
    params: Record<string, unknown>;
    priority: number;
    timestamp: number;
  }> = [];

  constructor(host: EdgeHost, config: Partial<CopilotConfig> = {}) {
    this.host = host;
    this.config = {
      enableCodeCompletion: true,
      enableCodeSearch: true,
      enableCommandExecution: true,
      enableAutonomousActions: false, // Start conservative
      maxSuggestions: 5,
      minConfidence: 0.6,
      contextWindowSize: 2048,
      autoExecuteCommands: false,
      requireConfirmation: true,
      ...config,
    };

    // Initialize tool system for code execution and file operations
    const toolSystem = createToolIntegrationSystem(host, {
      enableCodeExecution: this.config.enableCommandExecution,
      enableFileIndexing: this.config.enableCodeSearch,
      enableSemanticSearch: this.config.enableCodeSearch,
      defaultTimeout: 10000,
      requireConfirmationForExecution: this.config.requireConfirmation,
    });

    this.toolRegistry = toolSystem.toolRegistry;
    this.fileIndexer = toolSystem.getFileIndexer();

    // Initialize multi-modal system for advanced context
    const multiModalSystem = createMultiModalSystem(host, {
      enableMultiModal: false, // Not needed for code-focused assistant
      enableAdvancedContext: true,
    });

    this.contextManager = multiModalSystem.contextManager;

    // Initialize advanced system for intelligent routing
    const advancedSystem = createAdvancedWebLlmEngine(host, {
      enableEnsemble: false,
      enableMemoryCompression: true,
      enableDynamicTuning: false,
      enableIntelligentRouting: true,
      ensembleStrategy: "adaptive",
      maxEnsembleModels: 1,
    });

    this.modelRouter = advancedSystem.modelRouter;
  }

  // ---------------------------------------------------------------------------
  // Code Completion (Copilot-style)
  // ---------------------------------------------------------------------------

  async getCodeCompletions(
    context: CodeCompletionContext,
    baseEngine: any
  ): Promise<CodeCompletionSuggestion[]> {
    if (!this.config.enableCodeCompletion) {
      return [];
    }

    // Check cache first
    const cacheKey = this.generateContextHash(context);
    const cached = this.completionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) { // 30 second cache
      return cached.suggestions;
    }

    try {
      // Analyze the code context
      const analysis = this.analyzeCodeContext(context);

      // Generate completion request
      const request: EngineGenerateRequest = {
        system: this.getCompletionSystemPrompt(context.language, analysis),
        prompt: this.buildCompletionPrompt(context, analysis),
        suffix: context.followingCode,
        useCase: "code",
        maxTokens: 256,
        history: await this.getRelevantContext(context),
      };

      // Generate completions
      const result = await baseEngine.generate(request);

      if (!result.ok) {
        return [];
      }

      // Parse and rank suggestions
      const suggestions = this.parseCompletionSuggestions(result.text, context);

      // Cache results
      this.completionCache.set(cacheKey, {
        suggestions,
        timestamp: Date.now(),
      });

      // Clean old cache entries
      this.cleanCompletionCache();

      return suggestions.filter(s => s.confidence >= this.config.minConfidence);
    } catch (error) {
      console.error("Code completion failed:", error);
      return [];
    }
  }

  private analyzeCodeContext(context: CodeCompletionContext): {
    likelyIntent: string;
    suggestedCompletions: string[];
    contextSummary: string;
  } {
    const { precedingCode, language, cursorPosition } = context;

    let likelyIntent = "general";
    const suggestedCompletions: string[] = [];

    // Detect intent based on code patterns
    if (precedingCode.trim().endsWith("(")) {
      likelyIntent = "function_call";
      suggestedCompletions.push("function parameters");
    } else if (precedingCode.trim().endsWith("=")) {
      likelyIntent = "assignment";
      suggestedCompletions.push("variable assignment");
    } else if (precedingCode.trim().endsWith("{")) {
      likelyIntent = "block";
      suggestedCompletions.push("code block");
    } else if (precedingCode.includes("import ") || precedingCode.includes("require(")) {
      likelyIntent = "import";
      suggestedCompletions.push("module import");
    } else if (precedingCode.includes("class ")) {
      likelyIntent = "class_definition";
      suggestedCompletions.push("class body");
    } else if (precedingCode.includes("function ") || precedingCode.includes("def ")) {
      likelyIntent = "function_definition";
      suggestedCompletions.push("function body");
    } else if (precedingCode.includes("if ") || precedingCode.includes("for ") || precedingCode.includes("while ")) {
      likelyIntent = "control_flow";
      suggestedCompletions.push("condition body");
    }

    // Build context summary
    const contextSummary = this.buildContextSummary(context);

    return {
      likelyIntent,
      suggestedCompletions,
      contextSummary,
    };
  }

  private getCompletionSystemPrompt(language: string, analysis: any): string {
    return `You are an expert ${language} developer assistant similar to GitHub Copilot. Your task is to provide intelligent code completions.

Current context analysis:
- Intent: ${analysis.likelyIntent}
- Available symbols: ${analysis.contextSummary}

Guidelines:
1. Provide syntactically correct and idiomatic ${language} code
2. Match the coding style and patterns in the surrounding code
3. Complete the partial code naturally and logically
4. Consider the imports and functions already defined
5. Provide concise, practical completions
6. Handle edge cases and error conditions appropriately
7. Follow best practices for ${language}

Return only the code completion, no explanations.`;
  }

  private buildCompletionPrompt(context: CodeCompletionContext, analysis: any): string {
    const { precedingCode, entireFile, imports, functions, classes } = context;

    let prompt = `Complete the following ${context.language} code:\n\n`;

    // Add relevant context
    if (imports.length > 0) {
      prompt += `Available imports:\n${imports.join("\n")}\n\n`;
    }

    if (functions.length > 0) {
      prompt += `Available functions:\n${functions.map(f => `- ${f.name} (line ${f.line})`).join("\n")}\n\n`;
    }

    if (classes.length > 0) {
      prompt += `Available classes:\n${classes.map(c => `- ${c.name} (line ${c.line})`).join("\n")}\n\n`;
    }

    // Add the code to complete
    prompt += `Code to complete:\n${precedingCode}`;

    return prompt;
  }

  private async getRelevantContext(context: CodeCompletionContext): Promise<any[]> {
    // Search for relevant code in the indexed files
    const relevantFunctions = context.functions.slice(0, 3);
    const contextEntries: any[] = [];

    for (const func of relevantFunctions) {
      // Add function definitions as context
      contextEntries.push({
        role: "system",
        content: `Function ${func.name} is defined at line ${func.line}`,
      });
    }

    return contextEntries;
  }

  private parseCompletionSuggestions(
    generatedText: string,
    context: CodeCompletionContext
  ): CodeCompletionSuggestion[] {
    const suggestions: CodeCompletionSuggestion[] = [];

    // Split by common completion separators
    const possibleCompletions = generatedText
      .split(/\n\n+/)
      .filter(c => c.trim().length > 0);

    for (const completion of possibleCompletions.slice(0, this.config.maxSuggestions)) {
      const trimmed = completion.trim();

      // Determine completion type
      let type: CodeCompletionSuggestion["type"] = "statement";
      if (trimmed.startsWith("function ") || trimmed.startsWith("def ")) {
        type = "function";
      } else if (trimmed.startsWith("import ") || trimmed.startsWith("require(")) {
        type = "import";
      } else if (trimmed.startsWith("//") || trimmed.startsWith("/*")) {
        type = "comment";
      } else if (trimmed.match(/^[a-zA-Z_]\w*\s*=/)) {
        type = "variable";
      }

      // Calculate confidence based on various factors
      const confidence = this.calculateCompletionConfidence(trimmed, context);

      suggestions.push({
        text: trimmed,
        confidence,
        type,
        description: this.generateCompletionDescription(trimmed, type),
        metadata: {
          modelUsed: "webllm-ensemble",
          generationTime: 0, // Would be set by actual generation
          contextHash: this.generateContextHash(context),
        },
      });
    }

    return suggestions;
  }

  private calculateCompletionConfidence(completion: string, context: CodeCompletionContext): number {
    let confidence = 0.7; // Base confidence

    // Boost confidence for completions that match the style
    if (completion.includes(context.language === "javascript" ? "const" : "let")) {
      confidence += 0.1;
    }

    // Boost for completions that use existing imports
    const { imports } = context;
    for (const imp of imports) {
      if (completion.includes(imp)) {
        confidence += 0.1;
      }
    }

    // Reduce confidence for very short or very long completions
    if (completion.length < 5) confidence -= 0.2;
    if (completion.length > 500) confidence -= 0.1;

    return Math.min(1, Math.max(0, confidence));
  }

  private generateCompletionDescription(completion: string, type: string): string {
    switch (type) {
      case "function":
        return `Function definition: ${completion.split("(")[0].trim()}`;
      case "variable":
        return `Variable assignment: ${completion.split("=")[0].trim()}`;
      case "import":
        return `Import statement: ${completion.split("from")[0]?.trim() || completion}`;
      case "comment":
        return `Comment: ${completion.substring(0, 50)}...`;
      default:
        return `Code statement: ${completion.substring(0, 50)}...`;
    }
  }

  private buildContextSummary(context: CodeCompletionContext): string {
    const { functions, classes, variables } = context;
    const symbols = [
      ...functions.map(f => f.name),
      ...classes.map(c => c.name),
      ...variables.map(v => v.name),
    ];
    return symbols.join(", ");
  }

  private generateContextHash(context: CodeCompletionContext): string {
    const key = `${context.filePath}:${context.cursorPosition.line}:${context.cursorPosition.column}:${context.precedingCode.slice(-100)}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private cleanCompletionCache(): void {
    const cutoff = Date.now() - 300000; // 5 minutes
    for (const [key, value] of this.completionCache) {
      if (value.timestamp < cutoff) {
        this.completionCache.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Intelligent Code Search
  // ---------------------------------------------------------------------------

  async searchCodebase(
    query: string,
    options: {
      maxResults?: number;
      includeContent?: boolean;
      searchType?: "semantic" | "exact" | "regex";
    } = {}
  ): Promise<Array<{
    filePath: string;
    line: number;
    content: string;
    relevanceScore: number;
    context: string;
  }>> {
    if (!this.config.enableCodeSearch) {
      return [];
    }

    try {
      // Use the file indexer for search
      const searchResults = await this.fileIndexer.searchFiles(query, {
        maxResults: options.maxResults || 20,
        includeContent: options.includeContent || true,
      });

      // Transform results to Copilot-like format
      return searchResults.map(result => ({
        filePath: result.filePath,
        line: result.matchedLines[0] || 0,
        content: result.context,
        relevanceScore: result.relevanceScore,
        context: result.context,
      }));
    } catch (error) {
      console.error("Code search failed:", error);
      return [];
    }
  }

  async explainCode(
    code: string,
    language: string,
    baseEngine: any
  ): Promise<string> {
    const request: EngineGenerateRequest = {
      system: `You are an expert code explainer. Explain the following ${language} code clearly and concisely, focusing on:
1. What the code does
2. How it works
3. Any important patterns or best practices
4. Potential issues or improvements

Keep explanations practical and developer-focused.`,
      prompt: `Explain this ${language} code:\n\n${code}`,
      useCase: "chat",
      maxTokens: 512,
    };

    const result = await baseEngine.generate(request);
    return result.ok ? result.text : "Failed to generate explanation";
  }

  // ---------------------------------------------------------------------------
  // Command Execution and Autonomous Actions
  // ---------------------------------------------------------------------------

  async executeCommand(
    command: string,
    params: Record<string, unknown> = {},
    baseEngine?: any
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
  }> {
    if (!this.config.enableCommandExecution) {
      return {
        success: false,
        output: "",
        error: "Command execution is disabled",
      };
    }

    try {
      // Record command in history
      const startTime = Date.now();

      // Execute using tool registry
      const result = await this.toolRegistry.executeTool(command, params);

      // Record in history
      this.commandHistory.push({
        command,
        timestamp: Date.now(),
        success: result.success,
        output: JSON.stringify(result.data),
      });

      // Keep history manageable
      if (this.commandHistory.length > 100) {
        this.commandHistory = this.commandHistory.slice(-50);
      }

      return {
        success: result.success,
        output: JSON.stringify(result.data, null, 2),
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executeShellCommand(
    command: string,
    requireConfirmation: boolean = true
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
  }> {
    if (!this.config.enableCommandExecution) {
      return {
        success: false,
        output: "",
        error: "Command execution is disabled",
      };
    }

    if (requireConfirmation && this.config.requireConfirmation) {
      // In a real implementation, this would prompt the user
      console.log(`Command execution requires confirmation: ${command}`);
    }

    try {
      // Execute using the code execution sandbox
      const result = await this.toolRegistry.executeTool("execute_javascript", {
        code: `
          const { exec } = require('child_process');
          exec('${command}', (error, stdout, stderr) => {
            console.log(stdout);
            if (error) console.error(stderr);
          });
        `,
      });

      return {
        success: result.success,
        output: JSON.stringify(result.data),
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Autonomous Development Actions
  // ---------------------------------------------------------------------------

  async planDevelopmentTask(
    task: string,
    baseEngine: any
  ): Promise<{
    steps: Array<{
      description: string;
      command?: string;
      files?: string[];
      estimatedTime: number;
    }>;
    confidence: number;
  }> {
    const request: EngineGenerateRequest = {
      system: `You are an expert development planner. Break down the given task into clear, actionable steps.

For each step, provide:
- description: What needs to be done
- command: Any shell commands needed (if applicable)
- files: Files that need to be modified/created (if applicable)
- estimatedTime: Estimated time in minutes

Be specific and practical. Focus on steps that can be executed autonomously.`,
      prompt: `Plan the development task: ${task}\n\nProvide a step-by-step plan.`,
      useCase: "chat",
      maxTokens: 1024,
    };

    const result = await baseEngine.generate(request);

    if (!result.ok) {
      return {
        steps: [],
        confidence: 0,
      };
    }

    // Parse the plan (simplified parsing)
    const steps = this.parseDevelopmentPlan(result.text);

    return {
      steps,
      confidence: 0.8, // Would be calculated based on various factors
    };
  }

  private parseDevelopmentPlan(planText: string): Array<{
    description: string;
    command?: string;
    files?: string[];
    estimatedTime: number;
  }> {
    const steps: Array<{
      description: string;
      command?: string;
      files?: string[];
      estimatedTime: number;
    }> = [];

    // Simple parsing - in production would use more sophisticated parsing
    const lines = planText.split("\n");
    let currentStep: any = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.match(/^\d+\.|^-/)) {
        // New step
        if (currentStep) {
          steps.push(currentStep);
        }
        currentStep = {
          description: trimmed.replace(/^\d+\.|\-/, "").trim(),
          estimatedTime: 5, // Default estimate
        };
      } else if (trimmed.startsWith("Command:") && currentStep) {
        currentStep.command = trimmed.replace("Command:", "").trim();
      } else if (trimmed.startsWith("Files:") && currentStep) {
        currentStep.files = trimmed.replace("Files:", "").split(",").map(f => f.trim());
      } else if (trimmed.startsWith("Time:") && currentStep) {
        const timeMatch = trimmed.match(/(\d+)/);
        if (timeMatch) {
          currentStep.estimatedTime = parseInt(timeMatch[1], 10);
        }
      }
    }

    if (currentStep) {
      steps.push(currentStep);
    }

    return steps;
  }

  async executeDevelopmentPlan(
    plan: Array<{
      description: string;
      command?: string;
      files?: string[];
      estimatedTime: number;
    }>,
    onProgress?: (step: number, total: number, description: string) => void
  ): Promise<{
    success: boolean;
    completedSteps: number;
    results: Array<{
      step: number;
      description: string;
      success: boolean;
      output: string;
    }>;
  }> {
    if (!this.config.enableAutonomousActions) {
      return {
        success: false,
        completedSteps: 0,
        results: [],
      };
    }

    const results: Array<{
      step: number;
      description: string;
      success: boolean;
      output: string;
    }> = [];

    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];

      if (onProgress) {
        onProgress(i + 1, plan.length, step.description);
      }

      let stepSuccess = true;
      let stepOutput = "";

      try {
        // Execute command if provided
        if (step.command && this.config.autoExecuteCommands) {
          const result = await this.executeShellCommand(step.command, false);
          stepSuccess = result.success;
          stepOutput = result.output;
        }

        results.push({
          step: i + 1,
          description: step.description,
          success: stepSuccess,
          output: stepOutput,
        });
      } catch (error) {
        results.push({
          step: i + 1,
          description: step.description,
          success: false,
          output: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      completedSteps: results.filter(r => r.success).length,
      results,
    };
  }

  // ---------------------------------------------------------------------------
  // Codebase Indexing and Understanding
  // ---------------------------------------------------------------------------

  async indexCodebase(filePaths: string[]): Promise<{
    indexed: number;
    failed: number;
    errors: string[];
  }> {
    let indexed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const filePath of filePaths) {
      try {
        // In a real implementation, this would read the file content
        // For now, we'll simulate indexing
        const content = `// Simulated content for ${filePath}`;
        await this.fileIndexer.indexFile(filePath, content);
        indexed++;
      } catch (error) {
        failed++;
        errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { indexed, failed, errors };
  }

  async getCodebaseSummary(): Promise<{
    totalFiles: number;
    totalSymbols: number;
    languages: Record<string, number>;
    complexity: number;
  }> {
    const stats = this.fileIndexer.getIndexStats();

    return {
      totalFiles: stats.totalFiles,
      totalSymbols: stats.totalSymbols,
      languages: stats.languages,
      complexity: Math.sqrt(stats.totalSymbols), // Simple complexity metric
    };
  }

  // ---------------------------------------------------------------------------
  // Configuration and Status
  // ---------------------------------------------------------------------------

  setConfig(config: Partial<CopilotConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CopilotConfig {
    return { ...this.config };
  }

  getStatus(): {
    enabled: boolean;
    features: {
      codeCompletion: boolean;
      codeSearch: boolean;
      commandExecution: boolean;
      autonomousActions: boolean;
    };
    performance: {
      cacheSize: number;
      commandHistorySize: number;
      actionQueueSize: number;
    };
  } {
    return {
      enabled: this.config.enableCodeCompletion || this.config.enableCodeSearch,
      features: {
        codeCompletion: this.config.enableCodeCompletion,
        codeSearch: this.config.enableCodeSearch,
        commandExecution: this.config.enableCommandExecution,
        autonomousActions: this.config.enableAutonomousActions,
      },
      performance: {
        cacheSize: this.completionCache.size,
        commandHistorySize: this.commandHistory.length,
        actionQueueSize: this.actionQueue.length,
      },
    };
  }

  getCommandHistory(): Array<{
    command: string;
    timestamp: number;
    success: boolean;
    output: string;
  }> {
    return [...this.commandHistory];
  }

  clearCache(): void {
    this.completionCache.clear();
  }

  clearHistory(): void {
    this.commandHistory = [];
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createFreeCopilotEngine(
  host: EdgeHost,
  config: Partial<CopilotConfig> = {}
): FreeCopilotEngine {
  return new FreeCopilotEngine(host, config);
}
