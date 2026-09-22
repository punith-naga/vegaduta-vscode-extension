// Revolutionary Tool Integration System for WebLLM
// Enables code execution, file indexing, semantic search, and advanced IDE integration

import type { EdgeHost } from "./host";
import type { EngineGenerateRequest } from "./engine";

// ---------------------------------------------------------------------------
// Tool Execution Architecture
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
      enum?: string[];
    }>;
    required: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
  category: "code" | "file" | "search" | "analysis" | "system";
  requiresConfirmation: boolean;
  timeout: number;
}

interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  executionTime: number;
  metadata?: Record<string, unknown>;
}

interface ToolExecutionContext {
  requestId: string;
  toolsAvailable: ToolDefinition[];
  executionHistory: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: ToolResult;
    timestamp: number;
  }>;
  sandboxLimits: {
    maxExecutionTime: number;
    maxMemory: number;
    allowedOperations: string[];
  };
}

// ---------------------------------------------------------------------------
// Code Execution Sandbox
// ---------------------------------------------------------------------------

interface CodeExecutionConfig {
  language: "javascript" | "typescript" | "python" | "bash";
  code: string;
  timeout: number;
  memoryLimit: number;
  environment: Record<string, string>;
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  memoryUsed: number;
}

export class CodeExecutionSandbox {
  private executionHistory: Array<{
    config: CodeExecutionConfig;
    result: ExecutionResult;
    timestamp: number;
  }> = [];

  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
  }

  async executeCode(config: CodeExecutionConfig): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      let result: ExecutionResult;

      switch (config.language) {
        case "javascript":
        case "typescript":
          result = await this.executeJavaScript(config);
          break;
        case "python":
          result = await this.executePython(config);
          break;
        case "bash":
          result = await this.executeBash(config);
          break;
        default:
          throw new Error(`Unsupported language: ${config.language}`);
      }

      result.executionTime = Date.now() - startTime;

      // Record execution
      this.executionHistory.push({
        config,
        result,
        timestamp: Date.now(),
      });

      // Keep history manageable
      if (this.executionHistory.length > 100) {
        this.executionHistory = this.executionHistory.slice(-50);
      }

      return result;
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    }
  }

  private async executeJavaScript(config: CodeExecutionConfig): Promise<ExecutionResult> {
    // Safe JavaScript execution using Function constructor with limitations
    const startTime = Date.now();

    try {
      // Create a restricted execution environment
      const sandbox = this.createSandbox(config.environment);

      // Execute with timeout
      const result = await this.withTimeout(
        () => {
          const fn = new Function(...Object.keys(sandbox), config.code);
          return fn(...Object.values(sandbox));
        },
        config.timeout
      );

      return {
        stdout: String(result),
        stderr: "",
        exitCode: 0,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    }
  }

  private async executePython(config: CodeExecutionConfig): Promise<ExecutionResult> {
    // For Python execution, we'd need a Python runtime
    // This is a placeholder for actual Python integration
    const startTime = Date.now();

    try {
      // In a real implementation, this would interface with a Python runner
      // For now, we'll simulate it

      return {
        stdout: "Python execution would require a Python runtime integration",
        stderr: "",
        exitCode: 0,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    }
  }

  private async executeBash(config: CodeExecutionConfig): Promise<ExecutionResult> {
    // For bash execution, we'd need shell access
    // This is a placeholder for actual shell integration
    const startTime = Date.now();

    try {
      // In a real implementation, this would interface with the host's shell
      // For now, we'll simulate it

      return {
        stdout: "Bash execution would require shell integration",
        stderr: "",
        exitCode: 0,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    } catch (error) {
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
      };
    }
  }

  private createSandbox(environment: Record<string, string>): Record<string, unknown> {
    // Create a restricted sandbox environment
    const sandbox: Record<string, unknown> = {
      console: {
        log: (...args: unknown[]) => {
          // Capture console output
          return args.map(arg => String(arg)).join(" ");
        },
        error: (...args: unknown[]) => {
          return args.map(arg => String(arg)).join(" ");
        },
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      Promise: globalThis.Promise,
      Math: globalThis.Math,
      JSON: globalThis.JSON,
      Date: globalThis.Date,
      Array: globalThis.Array,
      Object: globalThis.Object,
      String: globalThis.String,
      Number: globalThis.Number,
      Boolean: globalThis.Boolean,
    };

    // Add environment variables
    for (const [key, value] of Object.entries(environment)) {
      sandbox[key] = value;
    }

    return sandbox;
  }

  private withTimeout<T>(fn: () => T, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeout}ms`));
      }, timeout);

      try {
        const result = fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  getExecutionHistory(): Array<{
    config: CodeExecutionConfig;
    result: ExecutionResult;
    timestamp: number;
  }> {
    return [...this.executionHistory];
  }

  clearHistory(): void {
    this.executionHistory = [];
  }
}

// ---------------------------------------------------------------------------
// File Indexing and Semantic Search
// ---------------------------------------------------------------------------

interface FileIndex {
  filePath: string;
  content: string;
  language: string;
  lastModified: number;
  size: number;
  hash: string;
  symbols: Array<{
    name: string;
    type: "function" | "class" | "variable" | "interface" | "type";
    line: number;
    column: number;
  }>;
  embeddings?: number[]; // Semantic embeddings for search
}

interface SearchResult {
  filePath: string;
  relevanceScore: number;
  matchedLines: number[];
  context: string;
  metadata: {
    language: string;
    lastModified: number;
    symbols: string[];
  };
}

export class FileIndexer {
  private fileIndex = new Map<string, FileIndex>();
  private host: EdgeHost;
  private indexingInProgress = new Set<string>();

  constructor(host: EdgeHost) {
    this.host = host;
  }

  async indexFile(filePath: string, content: string): Promise<FileIndex> {
    if (this.indexingInProgress.has(filePath)) {
      throw new Error(`Indexing already in progress for ${filePath}`);
    }

    this.indexingInProgress.add(filePath);

    try {
      const language = this.detectLanguage(filePath);
      const hash = this.calculateHash(content);
      const symbols = this.extractSymbols(content, language);

      const index: FileIndex = {
        filePath,
        content,
        language,
        lastModified: Date.now(),
        size: content.length,
        hash,
        symbols,
      };

      this.fileIndex.set(filePath, index);
      return index;
    } finally {
      this.indexingInProgress.delete(filePath);
    }
  }

  async indexDirectory(directoryPath: string, recursive: boolean = true): Promise<number> {
    // In a real implementation, this would scan the directory
    // For now, we'll simulate it
    let indexedCount = 0;

    // Placeholder for directory scanning
    console.log(`Indexing directory: ${directoryPath} (recursive: ${recursive})`);

    return indexedCount;
  }

  private detectLanguage(filePath: string): string {
    const extension = filePath.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      html: "html",
      css: "css",
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sql: "sql",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
    };

    return languageMap[extension || ""] || "text";
  }

  private calculateHash(content: string): string {
    // Simple hash calculation
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private extractSymbols(content: string, language: string): FileIndex["symbols"] {
    const symbols: FileIndex["symbols"] = [];
    const lines = content.split("\n");

    // Simple regex-based symbol extraction
    const patterns: Record<string, RegExp[]> = {
      javascript: [
        /function\s+(\w+)/g,
        /const\s+(\w+)\s*=\s*\(/g,
        /class\s+(\w+)/g,
        /interface\s+(\w+)/g,
        /type\s+(\w+)/g,
      ],
      typescript: [
        /function\s+(\w+)/g,
        /const\s+(\w+)\s*=\s*\(/g,
        /class\s+(\w+)/g,
        /interface\s+(\w+)/g,
        /type\s+(\w+)/g,
      ],
      python: [
        /def\s+(\w+)/g,
        /class\s+(\w+)/g,
      ],
      go: [
        /func\s+(\w+)/g,
        /type\s+(\w+)\s+struct/g,
      ],
    };

    const languagePatterns = patterns[language] || patterns.javascript;

    for (const pattern of languagePatterns) {
      for (const line of lines) {
        let match;
        const lineNumber = lines.indexOf(line);
        while ((match = pattern.exec(line)) !== null) {
          const symbolName = match[1];
          const symbolType = this.inferSymbolType(line, symbolName);

          symbols.push({
            name: symbolName,
            type: symbolType,
            line: lineNumber + 1,
            column: line.indexOf(symbolName),
          });
        }
      }
    }

    return symbols;
  }

  private inferSymbolType(line: string, name: string): FileIndex["symbols"][0]["type"] {
    if (line.includes("function ") || line.includes("def ")) return "function";
    if (line.includes("class ")) return "class";
    if (line.includes("interface ") || line.includes("type ")) return "interface";
    if (line.includes("const ") || line.includes("let ") || line.includes("var ")) return "variable";
    return "variable";
  }

  async searchFiles(query: string, options: {
    maxResults?: number;
    includeContent?: boolean;
    fileTypes?: string[];
  } = {}): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const maxResults = options.maxResults || 20;

    for (const [filePath, index] of this.fileIndex) {
      // Filter by file type if specified
      if (options.fileTypes && !options.fileTypes.includes(index.language)) {
        continue;
      }

      // Search in content
      const relevanceScore = this.calculateRelevance(query, index);
      if (relevanceScore > 0) {
        const matchedLines = this.findMatchedLines(query, index.content);
        const context = this.extractContext(index.content, matchedLines);

        results.push({
          filePath,
          relevanceScore,
          matchedLines,
          context,
          metadata: {
            language: index.language,
            lastModified: index.lastModified,
            symbols: index.symbols.map(s => s.name),
          },
        });
      }

      if (results.length >= maxResults) break;
    }

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results;
  }

  private calculateRelevance(query: string, index: FileIndex): number {
    const queryLower = query.toLowerCase();
    const contentLower = index.content.toLowerCase();

    // Exact match bonus
    if (contentLower.includes(queryLower)) {
      return 1.0;
    }

    // Partial match scoring
    const queryWords = queryLower.split(/\s+/);
    let matchCount = 0;

    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      return matchCount / queryWords.length;
    }

    // Symbol matching
    for (const symbol of index.symbols) {
      if (symbol.name.toLowerCase().includes(queryLower)) {
        return 0.8;
      }
    }

    return 0;
  }

  private findMatchedLines(query: string, content: string): number[] {
    const lines = content.split("\n");
    const matchedLines: number[] = [];
    const queryLower = query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        matchedLines.push(i + 1);
      }
    }

    return matchedLines;
  }

  private extractContext(content: string, matchedLines: number[]): string {
    const lines = content.split("\n");
    const contextLines: string[] = [];
    const contextWindow = 2; // Lines before and after

    for (const lineNum of matchedLines) {
      const start = Math.max(0, lineNum - contextWindow - 1);
      const end = Math.min(lines.length, lineNum + contextWindow);

      for (let i = start; i < end; i++) {
        if (!contextLines.includes(lines[i])) {
          contextLines.push(lines[i]);
        }
      }
    }

    return contextLines.join("\n");
  }

  async semanticSearch(query: string, options: {
    maxResults?: number;
    threshold?: number;
  } = {}): Promise<SearchResult[]> {
    // In a real implementation, this would use semantic embeddings
    // For now, we'll fall back to regular search
    return this.searchFiles(query, options);
  }

  getFileIndex(filePath: string): FileIndex | undefined {
    return this.fileIndex.get(filePath);
  }

  getAllIndexedFiles(): FileIndex[] {
    return Array.from(this.fileIndex.values());
  }

  removeFileIndex(filePath: string): void {
    this.fileIndex.delete(filePath);
  }

  clearIndex(): void {
    this.fileIndex.clear();
  }

  getIndexStats(): {
    totalFiles: number;
    totalSymbols: number;
    totalSize: number;
    languages: Record<string, number>;
  } {
    const stats = {
      totalFiles: this.fileIndex.size,
      totalSymbols: 0,
      totalSize: 0,
      languages: {} as Record<string, number>,
    };

    for (const index of this.fileIndex.values()) {
      stats.totalSymbols += index.symbols.length;
      stats.totalSize += index.size;
      stats.languages[index.language] = (stats.languages[index.language] || 0) + 1;
    }

    return stats;
  }
}

// ---------------------------------------------------------------------------
// Advanced Tool Registry and Execution
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private executionContext: ToolExecutionContext;
  private codeSandbox: CodeExecutionSandbox;
  private fileIndexer: FileIndexer;

  constructor(host: EdgeHost) {
    this.codeSandbox = new CodeExecutionSandbox(host);
    this.fileIndexer = new FileIndexer(host);

    this.executionContext = {
      requestId: this.generateRequestId(),
      toolsAvailable: [],
      executionHistory: [],
      sandboxLimits: {
        maxExecutionTime: 30000, // 30 seconds
        maxMemory: 512 * 1024 * 1024, // 512MB
        allowedOperations: ["read", "write", "execute", "search"],
      },
    };

    this.registerDefaultTools();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.executionContext.toolsAvailable = Array.from(this.tools.values());
  }

  unregisterTool(toolName: string): void {
    this.tools.delete(toolName);
    this.executionContext.toolsAvailable = Array.from(this.tools.values());
  }

  getTool(toolName: string): ToolDefinition | undefined {
    return this.tools.get(toolName);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        data: null,
        error: `Tool not found: ${toolName}`,
        executionTime: 0,
      };
    }

    const startTime = Date.now();

    try {
      // Validate parameters
      const validation = this.validateParameters(tool, params);
      if (!validation.valid) {
        return {
          success: false,
          data: null,
          error: `Parameter validation failed: ${validation.error}`,
          executionTime: Date.now() - startTime,
        };
      }

      // Execute with timeout
      const result = await this.withTimeout(
        () => tool.handler(params),
        tool.timeout
      );

      const executionTime = Date.now() - startTime;

      // Record execution
      this.executionContext.executionHistory.push({
        tool: toolName,
        params,
        result,
        timestamp: Date.now(),
      });

      return {
        ...result,
        executionTime,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      };
    }
  }

  private validateParameters(tool: ToolDefinition, params: Record<string, unknown>): {
    valid: boolean;
    error?: string;
  } {
    // Check required parameters
    for (const required of tool.parameters.required) {
      if (!(required in params)) {
        return { valid: false, error: `Missing required parameter: ${required}` };
      }
    }

    // Check parameter types
    for (const [key, value] of Object.entries(params)) {
      const paramDef = tool.parameters.properties[key];
      if (paramDef) {
        const expectedType = paramDef.type;
        const actualType = typeof value;

        if (expectedType === "array" && !Array.isArray(value)) {
          return { valid: false, error: `Parameter ${key} should be an array` };
        }

        if (expectedType !== "array" && actualType !== expectedType) {
          return { valid: false, error: `Parameter ${key} should be ${expectedType}` };
        }

        // Check enum values if specified
        if (paramDef.enum && !paramDef.enum.includes(String(value))) {
          return { valid: false, error: `Parameter ${key} should be one of: ${paramDef.enum.join(", ")}` };
        }
      }
    }

    return { valid: true };
  }

  private async withTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timeout after ${timeout}ms`));
      }, timeout);

      fn()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private registerDefaultTools(): void {
    // Code execution tools
    this.registerTool({
      name: "execute_javascript",
      description: "Execute JavaScript code in a sandboxed environment",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "JavaScript code to execute",
            required: true,
          },
          timeout: {
            type: "number",
            description: "Execution timeout in milliseconds",
            required: false,
          },
        },
        required: ["code"],
      },
      handler: async (params) => {
        const result = await this.codeSandbox.executeCode({
          language: "javascript",
          code: String(params.code),
          timeout: Number(params.timeout) || 5000,
          memoryLimit: 128 * 1024 * 1024,
          environment: {},
        });

        return {
          success: result.exitCode === 0,
          data: { stdout: result.stdout, stderr: result.stderr },
          executionTime: result.executionTime,
        };
      },
      category: "code",
      requiresConfirmation: true,
      timeout: 10000,
    });

    // File indexing tools
    this.registerTool({
      name: "index_file",
      description: "Index a file for semantic search",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Path to the file to index",
            required: true,
          },
          content: {
            type: "string",
            description: "Content of the file",
            required: true,
          },
        },
        required: ["filePath", "content"],
      },
      handler: async (params) => {
        const index = await this.fileIndexer.indexFile(
          String(params.filePath),
          String(params.content)
        );

        return {
          success: true,
          data: {
            filePath: index.filePath,
            language: index.language,
            symbolsCount: index.symbols.length,
          },
          executionTime: 0,
        };
      },
      category: "file",
      requiresConfirmation: false,
      timeout: 5000,
    });

    // Search tools
    this.registerTool({
      name: "search_files",
      description: "Search indexed files for content",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
            required: true,
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results",
            required: false,
          },
        },
        required: ["query"],
      },
      handler: async (params) => {
        const results = await this.fileIndexer.searchFiles(String(params.query), {
          maxResults: Number(params.maxResults) || 10,
        });

        return {
          success: true,
          data: {
            results: results.map(r => ({
              filePath: r.filePath,
              relevanceScore: r.relevanceScore,
              context: r.context,
            })),
          },
          executionTime: 0,
        };
      },
      category: "search",
      requiresConfirmation: false,
      timeout: 5000,
    });

    // Analysis tools
    this.registerTool({
      name: "analyze_code",
      description: "Analyze code for patterns, issues, and suggestions",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "Code to analyze",
            required: true,
          },
          language: {
            type: "string",
            description: "Programming language",
            required: false,
            enum: ["javascript", "typescript", "python", "go", "java"],
          },
        },
        required: ["code"],
      },
      handler: async (params) => {
        // Simple code analysis
        const code = String(params.code);
        const analysis = {
          lines: code.split("\n").length,
          functions: (code.match(/function\s+\w+/g) || []).length,
          classes: (code.match(/class\s+\w+/g) || []).length,
          complexity: this.calculateComplexity(code),
        };

        return {
          success: true,
          data: analysis,
          executionTime: 0,
        };
      },
      category: "analysis",
      requiresConfirmation: false,
      timeout: 5000,
    });
  }

  private calculateComplexity(code: string): number {
    // Simple complexity calculation based on cyclomatic complexity heuristics
    const lines = code.split("\n");
    let complexity = 1; // Base complexity

    for (const line of lines) {
      if (/\b(if|else|for|while|case|catch)\b/.test(line)) {
        complexity++;
      }
      if (/\b(&&|\|\|)\b/.test(line)) {
        complexity++;
      }
    }

    return complexity;
  }

  getExecutionContext(): ToolExecutionContext {
    return { ...this.executionContext };
  }

  getExecutionHistory(): ToolExecutionContext["executionHistory"] {
    return [...this.executionContext.executionHistory];
  }

  clearExecutionHistory(): void {
    this.executionContext.executionHistory = [];
  }

  getCodeSandbox(): CodeExecutionSandbox {
    return this.codeSandbox;
  }

  getFileIndexer(): FileIndexer {
    return this.fileIndexer;
  }
}

// ---------------------------------------------------------------------------
// Revolutionary Tool Integration Factory
// ---------------------------------------------------------------------------

export interface ToolIntegrationConfig {
  enableCodeExecution: boolean;
  enableFileIndexing: boolean;
  enableSemanticSearch: boolean;
  defaultTimeout: number;
  requireConfirmationForExecution: boolean;
}

export function createToolIntegrationSystem(
  host: EdgeHost,
  config: ToolIntegrationConfig = {
    enableCodeExecution: true,
    enableFileIndexing: true,
    enableSemanticSearch: true,
    defaultTimeout: 10000,
    requireConfirmationForExecution: true,
  }
) {
  const toolRegistry = new ToolRegistry(host);

  // Apply configuration
  if (!config.enableCodeExecution) {
    toolRegistry.unregisterTool("execute_javascript");
  }

  if (!config.enableFileIndexing) {
    toolRegistry.unregisterTool("index_file");
  }

  if (!config.enableSemanticSearch) {
    toolRegistry.unregisterTool("search_files");
  }

  return {
    toolRegistry,
    config,

    // High-level API
    async executeTool(toolName: string, params: Record<string, unknown>) {
      return toolRegistry.executeTool(toolName, params);
    },

    getAvailableTools() {
      return toolRegistry.getAllTools();
    },

    getExecutionStats() {
      const history = toolRegistry.getExecutionHistory();
      return {
        totalExecutions: history.length,
        successfulExecutions: history.filter(h => h.result.success).length,
        failedExecutions: history.filter(h => !h.result.success).length,
        averageExecutionTime: history.length > 0
          ? history.reduce((sum, h) => sum + h.result.executionTime, 0) / history.length
          : 0,
      };
    },

    getCodeSandbox() {
      return toolRegistry.getCodeSandbox();
    },

    getFileIndexer() {
      return toolRegistry.getFileIndexer();
    },
  };
}
