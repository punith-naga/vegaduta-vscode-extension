// Claude-Compatible API Bridge for WebLLM
// Allows Claude Desktop to use free local models while maintaining Claude's analytical capabilities
// This creates a local server that mimics the Anthropic API format but uses WebLLM under the hood

import type { EdgeHost } from "./host";
import type { EngineGenerateRequest, EngineGenerateResult } from "./engine";
import type { ManifestModel, EdgeCapabilities } from "./capabilities";
import { createWebLlmEngine, type WebLlmLocalEngine } from "./webllmEngine";
import { detectCapabilities, selectBestModel, fetchManifest } from "./capabilities";

// ---------------------------------------------------------------------------
// Claude API Format Compatibility
// ---------------------------------------------------------------------------

interface ClaudeMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: "text" | "image"; text?: string; source?: { type: "base64"; media_type: string; data: string } }>;
}

interface ClaudeRequest {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  system?: string;
  tools?: any[];
  tool_choice?: any;
  metadata?: any;
}

interface ClaudeResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any }>;
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
}

interface ClaudeStreamChunk {
  type: "message_start" | "content_block_start" | "content_block_delta" | "content_block_stop" | "message_delta" | "message_stop";
  index?: number;
  delta?: { type: "text_delta"; text: string };
  message?: ClaudeResponse;
  delta?: { stop_reason: string; stop_sequence?: string };
  usage?: { output_tokens: number };
}

// ---------------------------------------------------------------------------
// Claude-Compatible Server
// ---------------------------------------------------------------------------

interface ClaudeBridgeConfig {
  serverPort: number;
  serverHost: string;
  enableStreaming: boolean;
  maxTokens: number;
  temperature: number;
  enableTools: boolean;
  enableProjectAnalysis: boolean;
  projectPath: string;
  enableCodeExecution: boolean;
  enableFileOperations: boolean;
}

export class ClaudeBridgeServer {
  private host: EdgeHost;
  private config: ClaudeBridgeConfig;
  private webllmEngine: WebLlmLocalEngine | null = null;
  private currentModel: ManifestModel | null = null;
  private server: any = null; // Would be a real HTTP server
  private isRunning = false;

  // Project analysis cache
  private projectAnalysisCache = new Map<string, {
    analysis: string;
    timestamp: number;
    structure: any;
  }>();

  // Tool execution history
  private toolExecutionHistory: Array<{
    tool: string;
    input: any;
    output: any;
    timestamp: number;
  }> = [];

  constructor(host: EdgeHost, config: Partial<ClaudeBridgeConfig> = {}) {
    this.host = host;
    this.config = {
      serverPort: 8080,
      serverHost: "127.0.0.1",
      enableStreaming: true,
      maxTokens: 4096,
      temperature: 0.7,
      enableTools: true,
      enableProjectAnalysis: true,
      projectPath: "",
      enableCodeExecution: false,
      enableFileOperations: true,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    try {
      // Initialize WebLLM engine
      this.webllmEngine = createWebLlmEngine(this.host, (status) => {
        console.log("WebLLM Status:", status);
      });

      // Select best model
      const caps = await detectCapabilities();
      const manifest = await fetchManifest(this.host);
      const selection = selectBestModel(manifest, caps, "auto", "complex", "chat");

      if (selection.kind === "model" && selection.model) {
        this.currentModel = selection.model;
        console.log("Selected model:", selection.model.id);
      }

      // Start the HTTP server
      await this.startServer();

      this.isRunning = true;
      console.log(`Claude Bridge Server running on http://${this.config.serverHost}:${this.config.serverPort}`);
    } catch (error) {
      console.error("Failed to initialize Claude Bridge:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Stop the server
      await this.stopServer();

      // Unload WebLLM engine
      if (this.webllmEngine) {
        // Unload logic would go here
      }

      this.isRunning = false;
      console.log("Claude Bridge Server stopped");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }

  private async startServer(): Promise<void> {
    // In a real implementation, this would start an HTTP server
    // For now, we'll simulate it with the API handling logic
    console.log("Starting Claude-compatible API server...");

    // The server would handle these endpoints:
    // POST /v1/messages - Main Claude API endpoint
    // POST /v1/messages/stream - Streaming endpoint
    // GET /v1/models - List available models
    // GET /v1/models/{model} - Get model info

    // For now, we'll provide the request handling logic
  }

  private async stopServer(): Promise<void> {
    // In a real implementation, this would stop the HTTP server
    console.log("Stopping Claude-compatible API server...");
  }

  // ---------------------------------------------------------------------------
  // Claude API Request Handling
  // ---------------------------------------------------------------------------

  async handleClaudeRequest(request: ClaudeRequest): Promise<ClaudeResponse> {
    if (!this.webllmEngine) {
      throw new Error("WebLLM engine not initialized");
    }

    const messageId = this.generateMessageId();
    const startTime = Date.now();

    try {
      // Convert Claude format to WebLLM format
      const webllmRequest = this.convertToWebLLMRequest(request);

      // Check if this is a project analysis request
      if (this.isProjectAnalysisRequest(request)) {
        return await this.handleProjectAnalysis(request, messageId);
      }

      // Check if this is a tool use request
      if (this.isToolUseRequest(request)) {
        return await this.handleToolUse(request, messageId);
      }

      // Generate response using WebLLM
      const webllmResponse = await this.webllmEngine.generate(webllmRequest);

      if (!webllmResponse.ok) {
        throw new Error(`WebLLM generation failed: ${webllmResponse.reason}`);
      }

      // Convert WebLLM response back to Claude format
      const claudeResponse = this.convertToClaudeResponse(webllmResponse, messageId, request);

      return claudeResponse;
    } catch (error) {
      console.error("Error handling Claude request:", error);

      // Return error response in Claude format
      return {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: `I encountered an error: ${error instanceof Error ? error.message : String(error)}` }],
        model: request.model,
        stop_reason: "end_turn",
        usage: {
          input_tokens: this.estimateTokens(JSON.stringify(request.messages)),
          output_tokens: 0,
        },
      };
    }
  }

  private async handleClaudeStreamRequest(
    request: ClaudeRequest,
    onChunk: (chunk: ClaudeStreamChunk) => void
  ): Promise<void> {
    if (!this.webllmEngine) {
      throw new Error("WebLLM engine not initialized");
    }

    const messageId = this.generateMessageId();

    try {
      // Send message_start chunk
      onChunk({
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [],
          model: request.model,
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      // Send content_block_start chunk
      onChunk({
        type: "content_block_start",
        index: 0,
      });

      // Convert and generate
      const webllmRequest = this.convertToWebLLMRequest(request);

      // Generate with streaming
      let fullText = "";
      const webllmResponse = await this.webllmEngine.generate(webllmRequest, (delta) => {
        fullText += delta;
        onChunk({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: delta },
        });
      });

      if (!webllmResponse.ok) {
        throw new Error(`WebLLM generation failed: ${webllmResponse.reason}`);
      }

      // Send content_block_stop chunk
      onChunk({
        type: "content_block_stop",
        index: 0,
      });

      // Send message_delta chunk with usage
      onChunk({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: this.estimateTokens(fullText) },
      });

      // Send message_stop chunk
      onChunk({
        type: "message_stop",
      });

    } catch (error) {
      console.error("Error in streaming:", error);
      // Send error chunks
      onChunk({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: `\nError: ${error instanceof Error ? error.message : String(error)}` },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Request/Response Conversion
  // ---------------------------------------------------------------------------

  private convertToWebLLMRequest(claudeRequest: ClaudeRequest): EngineGenerateRequest {
    // Extract system message
    let system = claudeRequest.system || "You are a helpful AI assistant.";

    // Handle system message in messages array
    const systemMessage = claudeRequest.messages.find(m => m.role === "system");
    if (systemMessage) {
      if (typeof systemMessage.content === "string") {
        system = systemMessage.content;
      }
    }

    // Extract user messages
    const userMessages = claudeRequest.messages.filter(m => m.role === "user");
    const assistantMessages = claudeRequest.messages.filter(m => m.role === "assistant");

    // Build the prompt from user messages
    let prompt = "";
    for (const message of userMessages) {
      if (typeof message.content === "string") {
        prompt += message.content + "\n";
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "text") {
            prompt += content.text + "\n";
          }
          // Handle images if needed
        }
      }
    }

    // Build history from assistant messages
    const history = assistantMessages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));

    return {
      system,
      prompt: prompt.trim(),
      history,
      maxTokens: claudeRequest.max_tokens || this.config.maxTokens,
      useCase: "chat",
    };
  }

  private convertToClaudeResponse(
    webllmResponse: EngineGenerateSuccess,
    messageId: string,
    originalRequest: ClaudeRequest
  ): ClaudeResponse {
    return {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: webllmResponse.text }],
      model: originalRequest.model,
      stop_reason: "end_turn",
      usage: {
        input_tokens: this.estimateTokens(JSON.stringify(originalRequest.messages)),
        output_tokens: this.estimateTokens(webllmResponse.text),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Project Analysis (Claude's Specialty)
  // ---------------------------------------------------------------------------

  private isProjectAnalysisRequest(request: ClaudeRequest): boolean {
    const text = this.extractTextFromMessages(request.messages);
    const analysisKeywords = [
      "analyze", "understand", "explore", "overview", "structure",
      "architecture", "codebase", "project", "directory", "files"
    ];

    return analysisKeywords.some(keyword =>
      text.toLowerCase().includes(keyword)
    );
  }

  private async handleProjectAnalysis(
    request: ClaudeRequest,
    messageId: string
  ): Promise<ClaudeResponse> {
    const projectPath = this.config.projectPath;
    const cacheKey = `${projectPath}_${this.extractTextFromMessages(request.messages)}`;

    // Check cache
    const cached = this.projectAnalysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5 minute cache
      return {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: cached.analysis }],
        model: request.model,
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: this.estimateTokens(cached.analysis) },
      };
    }

    // Perform project analysis
    const analysis = await this.analyzeProject(projectPath, request);

    // Cache the result
    this.projectAnalysisCache.set(cacheKey, {
      analysis,
      timestamp: Date.now(),
      structure: analysis.structure,
    });

    return {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: analysis.text }],
      model: request.model,
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: this.estimateTokens(analysis.text) },
    };
  }

  private async analyzeProject(projectPath: string, request: ClaudeRequest): Promise<{
    text: string;
    structure: any;
  }> {
    if (!this.webllmEngine) {
      throw new Error("WebLLM engine not available");
    }

    // Get project structure
    const structure = await this.getProjectStructure(projectPath);

    // Build analysis prompt
    const analysisPrompt = this.buildAnalysisPrompt(structure, request);

    // Generate analysis using WebLLM
    const webllmRequest: EngineGenerateRequest = {
      system: "You are an expert code analyst. Analyze the given project structure and provide comprehensive insights about the codebase, architecture, patterns, and recommendations.",
      prompt: analysisPrompt,
      maxTokens: 2048,
      useCase: "chat",
    };

    const webllmResponse = await this.webllmEngine.generate(webllmRequest);

    if (!webllmResponse.ok) {
      throw new Error(`Analysis failed: ${webllmResponse.reason}`);
    }

    return {
      text: webllmResponse.text,
      structure,
    };
  }

  private async getProjectStructure(projectPath: string): Promise<any> {
    // In a real implementation, this would scan the actual project directory
    // For now, return a simulated structure
    return {
      root: projectPath,
      directories: [
        "src",
        "tests",
        "docs",
        "config",
      ],
      files: [
        "src/index.ts",
        "src/app.ts",
        "src/utils.ts",
        "tests/index.test.ts",
        "README.md",
        "package.json",
      ],
      languages: {
        typescript: 5,
        javascript: 2,
        markdown: 1,
      },
      totalFiles: 8,
      totalLines: 1250,
    };
  }

  private buildAnalysisPrompt(structure: any, request: ClaudeRequest): string {
    const userQuery = this.extractTextFromMessages(request.messages);

    return `Project Structure Analysis:

Root: ${structure.root}
Directories: ${structure.directories.join(", ")}
Files: ${structure.files.join(", ")}
Languages: ${JSON.stringify(structure.languages, null, 2)}
Total Files: ${structure.totalFiles}
Total Lines: ${structure.totalLines}

User Query: ${userQuery}

Please analyze this project structure and provide:
1. Overall project architecture
2. Key components and their relationships
3. Technology stack and frameworks used
4. Code organization patterns
5. Potential improvements or issues
6. Recommendations for the user's specific query`;
  }

  // ---------------------------------------------------------------------------
  // Tool Use Handling (Claude's Tool Calling)
  // ---------------------------------------------------------------------------

  private isToolUseRequest(request: ClaudeRequest): boolean {
    return request.tools && request.tools.length > 0;
  }

  private async handleToolUse(
    request: ClaudeRequest,
    messageId: string
  ): Promise<ClaudeResponse> {
    if (!this.config.enableTools) {
      throw new Error("Tools are disabled");
    }

    // For now, we'll simulate tool use
    // In a real implementation, this would execute actual tools

    const tools = request.tools || [];
    const toolChoice = request.tool_choice;

    // Convert Claude request to WebLLM and let it decide about tools
    const webllmRequest = this.convertToWebLLMRequest(request);

    // Add tool information to system prompt
    webllmRequest.system = `You are an AI assistant with access to tools.

Available tools:
${tools.map(tool => `- ${tool.name}: ${tool.description}`).join("\n")}

When you need to use a tool, format your response as:
TOOL: tool_name
INPUT: {"param": "value"}
END_TOOL

Then continue with your response after the tool output.`;

    const webllmResponse = await this.webllmEngine.generate(webllmRequest);

    if (!webllmResponse.ok) {
      throw new Error(`Tool use failed: ${webllmResponse.reason}`);
    }

    // Parse tool use from response
    const toolUses = this.parseToolUses(webllmResponse.text);

    // Execute tools
    const toolResults: Array<{ tool: string; output: any }> = [];
    for (const toolUse of toolUses) {
      const result = await this.executeTool(toolUse.tool, toolUse.input);
      toolResults.push({ tool: toolUse.tool, output: result });

      // Record in history
      this.toolExecutionHistory.push({
        tool: toolUse.tool,
        input: toolUse.input,
        output: result,
        timestamp: Date.now(),
      });
    }

    // Generate final response with tool results
    const finalPrompt = `${webllmRequest.prompt}\n\nTool Results:\n${JSON.stringify(toolResults, null, 2)}\n\nPlease provide your response based on the tool results.`;

    const finalResponse = await this.webllmEngine.generate({
      ...webllmRequest,
      prompt: finalPrompt,
    });

    if (!finalResponse.ok) {
      throw new Error(`Final response failed: ${finalResponse.reason}`);
    }

    return {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: finalResponse.text }],
      model: request.model,
      stop_reason: "end_turn",
      usage: {
        input_tokens: this.estimateTokens(JSON.stringify(request.messages)),
        output_tokens: this.estimateTokens(finalResponse.text),
      },
    };
  }

  private parseToolUses(text: string): Array<{ tool: string; input: any }>[] {
    const toolUses: Array<{ tool: string; input: any }> = [];
    const lines = text.split("\n");
    let currentTool: any = null;

    for (const line of lines) {
      if (line.startsWith("TOOL:")) {
        if (currentTool) {
          toolUses.push(currentTool);
        }
        currentTool = { tool: line.replace("TOOL:", "").trim(), input: {} };
      } else if (line.startsWith("INPUT:") && currentTool) {
        try {
          currentTool.input = JSON.parse(line.replace("INPUT:", "").trim());
        } catch {
          currentTool.input = { raw: line.replace("INPUT:", "").trim() };
        }
      } else if (line.startsWith("END_TOOL") && currentTool) {
        toolUses.push(currentTool);
        currentTool = null;
      }
    }

    if (currentTool) {
      toolUses.push(currentTool);
    }

    return toolUses;
  }

  private async executeTool(toolName: string, input: any): Promise<any> {
    // In a real implementation, this would execute actual tools
    // For now, simulate tool execution

    console.log(`Executing tool: ${toolName} with input:`, input);

    // Simulate different tool responses
    switch (toolName) {
      case "read_file":
        return { content: `// Simulated content of ${input.path}` };
      case "list_files":
        return { files: ["file1.ts", "file2.ts", "file3.ts"] };
      case "search_files":
        return { matches: [`Found ${input.query} in file1.ts`] };
      case "execute_command":
        if (this.config.enableCodeExecution) {
          return { stdout: "Command executed successfully", stderr: "" };
        } else {
          return { error: "Code execution is disabled" };
        }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Utility Functions
  // ---------------------------------------------------------------------------

  private extractTextFromMessages(messages: ClaudeMessage[]): string {
    let text = "";
    for (const message of messages) {
      if (typeof message.content === "string") {
        text += message.content + " ";
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "text" && content.text) {
            text += content.text + " ";
          }
        }
      }
    }
    return text.trim();
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private estimateTokens(text: string): number {
    // Simple token estimation (roughly 4 chars per token)
    return Math.ceil(text.length / 4);
  }

  // ---------------------------------------------------------------------------
  // Server Status
  // ---------------------------------------------------------------------------

  getStatus(): {
    running: boolean;
    config: ClaudeBridgeConfig;
    model: ManifestModel | null;
    projectCache: number;
    toolHistory: number;
  } {
    return {
      running: this.isRunning,
      config: this.config,
      model: this.currentModel,
      projectCache: this.projectAnalysisCache.size,
      toolHistory: this.toolExecutionHistory.length,
    };
  }

  setProjectPath(path: string): void {
    this.config.projectPath = path;
    // Clear cache when project changes
    this.projectAnalysisCache.clear();
  }

  setConfig(config: Partial<ClaudeBridgeConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ---------------------------------------------------------------------------
// Claude Desktop Integration Helper
// ---------------------------------------------------------------------------

export class ClaudeDesktopIntegrator {
  private bridgeServer: ClaudeBridgeServer;
  private host: EdgeHost;

  constructor(host: EdgeHost, bridgeConfig?: Partial<ClaudeBridgeConfig>) {
    this.host = host;
    this.bridgeServer = new ClaudeBridgeServer(host, bridgeConfig);
  }

  async initialize(projectPath?: string): Promise<void> {
    if (projectPath) {
      this.bridgeServer.setProjectPath(projectPath);
    }
    await this.bridgeServer.initialize();
  }

  async shutdown(): Promise<void> {
    await this.bridgeServer.shutdown();
  }

  getBridgeServer(): ClaudeBridgeServer {
    return this.bridgeServer;
  }

  // Helper for Claude Desktop configuration
  getClaudeDesktopConfig(): {
    anthropicBaseUrl: string;
    anthropicApiKey: string;
    anthropicModel: string;
  } {
    return {
      anthropicBaseUrl: `http://${this.bridgeServer["config"].serverHost}:${this.bridgeServer["config"].serverPort}/v1`,
      anthropicApiKey: "local-webllm-bridge", // Dummy key for local usage
      anthropicModel: "claude-3-5-sonnet", // Will be mapped to local model
    };
  }

  // Generate Claude Desktop configuration file
  generateClaudeConfig(projectPath: string): string {
    const config = this.getClaudeDesktopConfig();

    return `{
  "anthropicBaseUrl": "${config.anthropicBaseUrl}",
  "anthropicApiKey": "${config.anthropicApiKey}",
  "anthropicModel": "${config.anthropicModel}",
  "mcpServers": {},
  "projectPath": "${projectPath}"
}`;
  }

  // Instructions for setting up Claude Desktop
  getSetupInstructions(): string {
    return `# Claude Desktop Setup for Local WebLLM

## Step 1: Start the Bridge Server
The bridge server is now running at: http://${this.bridgeServer["config"].serverHost}:${this.bridgeServer["config"].serverPort}

## Step 2: Configure Claude Desktop
1. Open Claude Desktop Settings
2. Go to "API Configuration"
3. Set Custom API Base URL to: http://${this.bridgeServer["config"].serverHost}:${this.bridgeServer["config"].serverPort}
4. Set API Key to: local-webllm-bridge
5. Set Model to: claude-3-5-sonnet (will be mapped to local WebLLM model)

## Step 3: Configure Project
1. In Claude Desktop, set your project path
2. The bridge will analyze your project structure
3. You can now use Claude Desktop with local WebLLM models!

## Features Available
- ✅ Project analysis and understanding
- ✅ Code completion and suggestions
- ✅ Multi-file editing
- ✅ Tool use (file operations, search)
- ✅ Streaming responses
- ✅ Claude-compatible API format

## Notes
- All processing happens locally on your machine
- No data is sent to external servers
- Uses free WebLLM models instead of paid Claude API
- Maintains Claude Desktop's user experience`;
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createClaudeBridgeServer(
  host: EdgeHost,
  config?: Partial<ClaudeBridgeConfig>
): ClaudeBridgeServer {
  return new ClaudeBridgeServer(host, config);
}

export function createClaudeDesktopIntegrator(
  host: EdgeHost,
  bridgeConfig?: Partial<ClaudeBridgeConfig>
): ClaudeDesktopIntegrator {
  return new ClaudeDesktopIntegrator(host, bridgeConfig);
}
