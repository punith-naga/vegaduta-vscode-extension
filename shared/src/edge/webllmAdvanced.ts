// Extraordinary WebLLM Enhancements - Multi-Model Ensemble, Intelligent Routing,
// Advanced Memory Management, Real-time Adaptation, and Revolutionary Features

import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  MLCEngineInterface,
} from "@mlc-ai/web-llm";
import type { EdgeHost } from "./host";
import type { ManifestModel, EdgeCapabilities, ModelUseCase } from "./capabilities";
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  LocalEngineStatus,
} from "./engine";
import { estimateLocalTokens, computeLocalPromptBudget, assembleLocalPrompt } from "./webllmEngine";

// ---------------------------------------------------------------------------
// Revolutionary Architecture Constants
// ---------------------------------------------------------------------------

/** Maximum number of models to run in ensemble for a single request */
const MAX_ENSEMBLE_MODELS = 3;

/** Time window for performance metrics rolling average (milliseconds) */
const PERFORMANCE_METRICS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum confidence threshold for model selection confidence */
const CONFIDENCE_THRESHOLD = 0.7;

/** Adaptive temperature range for dynamic parameter tuning */
const ADAPTIVE_TEMP_MIN = 0.1;
const ADAPTIVE_TEMP_MAX = 1.5;

/** Context compression ratio for advanced memory management */
const CONTEXT_COMPRESSION_RATIO = 0.6;

// ---------------------------------------------------------------------------
// Performance Metrics and Learning System
// ---------------------------------------------------------------------------

interface ModelPerformanceMetrics {
  modelId: string;
  avgGenerationTime: number;
  avgTokensPerSecond: number;
  successRate: number;
  lastUsed: number;
  complexityScores: Map<string, number>; // complexity -> score
  useCasePerformance: Map<ModelUseCase, number>; // use case -> performance score
}

interface EnsembleMetrics {
  models: string[];
  weights: number[];
  combinedScore: number;
  individualPerformances: Map<string, number>;
}

export class PerformanceTracker {
  private metrics = new Map<string, ModelPerformanceMetrics>();
  private performanceHistory: Array<{
    modelId: string;
    timestamp: number;
    generationTime: number;
    tokens: number;
    success: boolean;
    complexity: string;
    useCase: ModelUseCase;
  }> = [];

  recordPerformance(
    modelId: string,
    generationTime: number,
    tokens: number,
    success: boolean,
    complexity: string,
    useCase: ModelUseCase
  ): void {
    const now = Date.now();
    this.performanceHistory.push({
      modelId,
      timestamp: now,
      generationTime,
      tokens,
      success,
      complexity,
      useCase,
    });

    // Clean old metrics
    const cutoff = now - PERFORMANCE_METRICS_WINDOW_MS;
    this.performanceHistory = this.performanceHistory.filter((h) => h.timestamp > cutoff);

    // Update model metrics
    let modelMetrics = this.metrics.get(modelId);
    if (!modelMetrics) {
      modelMetrics = {
        modelId,
        avgGenerationTime: 0,
        avgTokensPerSecond: 0,
        successRate: 0,
        lastUsed: now,
        complexityScores: new Map(),
        useCasePerformance: new Map(),
      };
      this.metrics.set(modelId, modelMetrics);
    }

    const recentHistory = this.performanceHistory.filter((h) => h.modelId === modelId);
    if (recentHistory.length > 0) {
      modelMetrics.avgGenerationTime =
        recentHistory.reduce((sum, h) => sum + h.generationTime, 0) / recentHistory.length;
      modelMetrics.avgTokensPerSecond =
        recentHistory.reduce((sum, h) => sum + h.tokens / h.generationTime, 0) /
        recentHistory.length;
      modelMetrics.successRate =
        recentHistory.filter((h) => h.success).length / recentHistory.length;
      modelMetrics.lastUsed = now;

      // Update complexity scores
      const complexityHistory = recentHistory.filter((h) => h.complexity === complexity);
      if (complexityHistory.length > 0) {
        const successRate = complexityHistory.filter((h) => h.success).length / complexityHistory.length;
        modelMetrics.complexityScores.set(complexity, successRate);
      }

      // Update use case performance
      const useCaseHistory = recentHistory.filter((h) => h.useCase === useCase);
      if (useCaseHistory.length > 0) {
        const successRate = useCaseHistory.filter((h) => h.success).length / useCaseHistory.length;
        modelMetrics.useCasePerformance.set(useCase, successRate);
      }
    }
  }

  getModelMetrics(modelId: string): ModelPerformanceMetrics | undefined {
    return this.metrics.get(modelId);
  }

  getBestModelForTask(
    availableModels: string[],
    complexity: string,
    useCase: ModelUseCase
  ): string | null {
    let bestModel: string | null = null;
    let bestScore = -1;

    for (const modelId of availableModels) {
      const metrics = this.metrics.get(modelId);
      if (!metrics) continue;

      let score = metrics.successRate;
      const complexityScore = metrics.complexityScores.get(complexity);
      if (complexityScore !== undefined) {
        score = (score + complexityScore) / 2;
      }

      const useCaseScore = metrics.useCasePerformance.get(useCase);
      if (useCaseScore !== undefined) {
        score = (score + useCaseScore) / 2;
      }

      // Factor in recency (more recent usage gets slight boost)
      const hoursSinceLastUse = (Date.now() - metrics.lastUsed) / (1000 * 60 * 60);
      const recencyFactor = Math.max(0.5, 1 - hoursSinceLastUse / 24);
      score *= recencyFactor;

      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }

    return bestModel;
  }
}

// ---------------------------------------------------------------------------
// Multi-Model Ensemble System
// ---------------------------------------------------------------------------

interface EnsembleConfig {
  models: ManifestModel[];
  strategy: "voting" | "weighted" | "cascade" | "adaptive";
  confidenceThreshold: number;
  fallbackModel: string | null;
}

interface EnsembleResult {
  text: string;
  confidence: number;
  modelContributions: Map<string, { text: string; weight: number; confidence: number }>;
  metadata: {
    strategy: string;
    modelsAttempted: number;
    totalGenerationTime: number;
  };
}

export class EnsembleEngine {
  private engines = new Map<string, MLCEngineInterface>();
  private performanceTracker: PerformanceTracker;
  private host: EdgeHost;

  constructor(host: EdgeHost, performanceTracker: PerformanceTracker) {
    this.host = host;
    this.performanceTracker = performanceTracker;
  }

  async loadModel(model: ManifestModel): Promise<MLCEngineInterface> {
    const existing = this.engines.get(model.id);
    if (existing) return existing;

    const webllm = await import("@mlc-ai/web-llm");
    const engine = await webllm.CreateMLCEngine(model.id);
    this.engines.set(model.id, engine);
    return engine;
  }

  async generateEnsemble(
    config: EnsembleConfig,
    request: EngineGenerateRequest,
    onDelta?: (delta: string) => void
  ): Promise<EnsembleResult> {
    const startTime = Date.now();
    const results = new Map<string, { text: string; confidence: number; time: number }>();

    // Generate from each model in the ensemble
    for (const model of config.models.slice(0, MAX_ENSEMBLE_MODELS)) {
      try {
        const engine = await this.loadModel(model);
        const modelStartTime = Date.now();

        const messages = this.prepareMessages(request);
        const chunks = await engine.chat.completions.create({
          stream: true,
          messages: messages as ChatCompletionMessageParam[],
          max_tokens: request.maxTokens,
        });

        let text = "";
        for await (const chunk of chunks as AsyncIterable<ChatCompletionChunk>) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            if (onDelta) onDelta(delta);
          }
        }

        const generationTime = Date.now() - modelStartTime;
        const confidence = this.calculateConfidence(text, generationTime, model);

        results.set(model.id, { text, confidence, time: generationTime });

        // Record performance
        this.performanceTracker.recordPerformance(
          model.id,
          generationTime,
          text.length / 4, // rough token estimate
          true,
          this.estimateComplexity(request),
          request.useCase || "chat"
        );
      } catch (error) {
        console.error(`Ensemble model ${model.id} failed:`, error);
        this.performanceTracker.recordPerformance(
          model.id,
          0,
          0,
          false,
          this.estimateComplexity(request),
          request.useCase || "chat"
        );
      }
    }

    // Combine results based on strategy
    const combined = this.combineResults(results, config);
    combined.metadata.totalGenerationTime = Date.now() - startTime;

    return combined;
  }

  private prepareMessages(request: EngineGenerateRequest): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: request.system },
    ];

    if (request.history) {
      for (const msg of request.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const userContent = request.suffix
      ? `${request.prompt}\n\n[CONTEXT AFTER: ${request.suffix}]`
      : request.prompt;
    messages.push({ role: "user", content: userContent });

    return messages;
  }

  private calculateConfidence(text: string, generationTime: number, model: ManifestModel): number {
    // Simple confidence calculation based on output quality metrics
    let confidence = 0.5;

    // Length-based confidence (very short or very long outputs are less confident)
    const length = text.length;
    if (length > 50 && length < 2000) {
      confidence += 0.2;
    }

    // Generation time (too fast might be low quality, too slow might be struggling)
    if (generationTime > 100 && generationTime < 10000) {
      confidence += 0.2;
    }

    // Model capability factor
    if (model.speedTier === "capable") {
      confidence += 0.1;
    }

    return Math.min(1, confidence);
  }

  private estimateComplexity(request: EngineGenerateRequest): string {
    const promptLength = request.prompt.length;
    const hasHistory = request.history && request.history.length > 0;
    const hasSuffix = !!request.suffix;

    if (promptLength > 1000 || (hasHistory && hasSuffix)) {
      return "complex";
    } else if (promptLength > 300 || hasHistory || hasSuffix) {
      return "medium";
    }
    return "simple";
  }

  private combineResults(
    results: Map<string, { text: string; confidence: number; time: number }>,
    config: EnsembleConfig
  ): EnsembleResult {
    const modelContributions = new Map();
    let combinedText = "";
    let overallConfidence = 0;

    if (config.strategy === "voting") {
      // Voting strategy: most confident answer wins
      let bestModel: string | null = null;
      let bestConfidence = 0;

      for (const [modelId, result] of results) {
        if (result.confidence > bestConfidence) {
          bestConfidence = result.confidence;
          bestModel = modelId;
        }
      }

      if (bestModel) {
        const best = results.get(bestModel)!;
        combinedText = best.text;
        overallConfidence = best.confidence;
        modelContributions.set(bestModel, {
          text: best.text,
          weight: 1.0,
          confidence: best.confidence,
        });
      }
    } else if (config.strategy === "weighted") {
      // Weighted strategy: combine results with confidence-based weights
      const texts: string[] = [];
      const weights: number[] = [];
      let totalWeight = 0;

      for (const [modelId, result] of results) {
        texts.push(result.text);
        weights.push(result.confidence);
        totalWeight += result.confidence;
        modelContributions.set(modelId, {
          text: result.text,
          weight: result.confidence / totalWeight,
          confidence: result.confidence,
        });
      }

      // Simple weighted combination (in production, would use more sophisticated merging)
      if (texts.length > 0) {
        const bestIndex = weights.indexOf(Math.max(...weights));
        combinedText = texts[bestIndex];
        overallConfidence = weights[bestIndex];
      }
    } else if (config.strategy === "cascade") {
      // Cascade strategy: try models in order, use first confident result
      for (const [modelId, result] of results) {
        if (result.confidence >= config.confidenceThreshold) {
          combinedText = result.text;
          overallConfidence = result.confidence;
          modelContributions.set(modelId, {
            text: result.text,
            weight: 1.0,
            confidence: result.confidence,
          });
          break;
        }
      }

      // Fallback to best available if threshold not met
      if (!combinedText && results.size > 0) {
        let bestModel: string | null = null;
        let bestConfidence = 0;

        for (const [modelId, result] of results) {
          if (result.confidence > bestConfidence) {
            bestConfidence = result.confidence;
            bestModel = modelId;
          }
        }

        if (bestModel) {
          const best = results.get(bestModel)!;
          combinedText = best.text;
          overallConfidence = best.confidence;
          modelContributions.set(bestModel, {
            text: best.text,
            weight: 1.0,
            confidence: best.confidence,
          });
        }
      }
    } else {
      // Adaptive strategy: use performance tracker to decide
      const availableModels = Array.from(results.keys());
      const complexity = this.estimateComplexityFromResults(results);
      const useCase = "chat"; // Would be passed from request

      const bestModelId = this.performanceTracker.getBestModelForTask(
        availableModels,
        complexity,
        useCase
      );

      if (bestModelId && results.has(bestModelId)) {
        const best = results.get(bestModelId)!;
        combinedText = best.text;
        overallConfidence = best.confidence;
        modelContributions.set(bestModelId, {
          text: best.text,
          weight: 1.0,
          confidence: best.confidence,
        });
      } else if (results.size > 0) {
        // Fallback to voting
        let bestModel: string | null = null;
        let bestConfidence = 0;

        for (const [modelId, result] of results) {
          if (result.confidence > bestConfidence) {
            bestConfidence = result.confidence;
            bestModel = modelId;
          }
        }

        if (bestModel) {
          const best = results.get(bestModel)!;
          combinedText = best.text;
          overallConfidence = best.confidence;
          modelContributions.set(bestModel, {
            text: best.text,
            weight: 1.0,
            confidence: best.confidence,
          });
        }
      }
    }

    return {
      text: combinedText,
      confidence: overallConfidence,
      modelContributions,
      metadata: {
        strategy: config.strategy,
        modelsAttempted: results.size,
        totalGenerationTime: 0, // Will be set by caller
      },
    };
  }

  private estimateComplexityFromResults(
    results: Map<string, { text: string; confidence: number; time: number }>
  ): string {
    const avgTime = Array.from(results.values()).reduce((sum, r) => sum + r.time, 0) / results.size;
    const avgLength =
      Array.from(results.values()).reduce((sum, r) => sum + r.text.length, 0) / results.size;

    if (avgTime > 5000 || avgLength > 1000) {
      return "complex";
    } else if (avgTime > 2000 || avgLength > 300) {
      return "medium";
    }
    return "simple";
  }

  async unloadModel(modelId: string): Promise<void> {
    const engine = this.engines.get(modelId);
    if (engine) {
      try {
        await engine.unload();
      } catch (error) {
        console.error(`Failed to unload model ${modelId}:`, error);
      }
      this.engines.delete(modelId);
    }
  }

  async unloadAll(): Promise<void> {
    for (const modelId of this.engines.keys()) {
      await this.unloadModel(modelId);
    }
  }
}

// ---------------------------------------------------------------------------
// Advanced Memory Management with Context Compression
// ---------------------------------------------------------------------------

interface ContextCompressionConfig {
  enabled: boolean;
  compressionRatio: number;
  preserveSystemPrompt: boolean;
  preserveRecentTurns: number;
  compressionStrategy: "semantic" | "statistical" | "hybrid";
}

export class AdvancedMemoryManager {
  private compressionConfig: ContextCompressionConfig = {
    enabled: true,
    compressionRatio: CONTEXT_COMPRESSION_RATIO,
    preserveSystemPrompt: true,
    preserveRecentTurns: 2,
    compressionStrategy: "hybrid",
  };

  private semanticCache = new Map<string, { summary: string; timestamp: number }>();
  private compressionCache = new Map<string, string>();

  setCompressionConfig(config: Partial<ContextCompressionConfig>): void {
    this.compressionConfig = { ...this.compressionConfig, ...config };
  }

  compressContext(
    messages: ChatCompletionMessageParam[],
    contextWindowSize: number,
    reserveTokens: number = 1024
  ): ChatCompletionMessageParam[] {
    if (!this.compressionConfig.enabled) {
      return messages;
    }

    const budget = computeLocalPromptBudget(contextWindowSize, reserveTokens);
    const currentTokens = this.estimateTokens(messages);

    if (currentTokens <= budget) {
      return messages; // No compression needed
    }

    const targetTokens = Math.floor(budget * this.compressionConfig.compressionRatio);
    return this.performCompression(messages, targetTokens);
  }

  private estimateTokens(messages: ChatCompletionMessageParam[]): number {
    return messages.reduce((sum, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return sum + estimateLocalTokens(content);
    }, 0);
  }

  private performCompression(
    messages: ChatCompletionMessageParam[],
    targetTokens: number
  ): ChatCompletionMessageParam[] {
    const compressed: ChatCompletionMessageParam[] = [];
    let usedTokens = 0;

    // Always preserve system prompt if configured
    if (this.compressionConfig.preserveSystemPrompt) {
      const systemMsg = messages.find((m) => m.role === "system");
      if (systemMsg) {
        compressed.push(systemMsg);
        usedTokens += this.estimateMessageTokens(systemMsg);
      }
    }

    // Preserve recent turns
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    const recentTurns = nonSystemMessages.slice(-this.compressionConfig.preserveRecentTurns * 2);

    for (const msg of recentTurns) {
      const msgTokens = this.estimateMessageTokens(msg);
      if (usedTokens + msgTokens <= targetTokens) {
        compressed.push(msg);
        usedTokens += msgTokens;
      }
    }

    // Compress older messages based on strategy
    const olderMessages = nonSystemMessages.slice(0, -this.compressionConfig.preserveRecentTurns * 2);
    const remainingBudget = targetTokens - usedTokens;

    if (remainingBudget > 0 && olderMessages.length > 0) {
      const compressedOlder = this.compressMessages(olderMessages, remainingBudget);
      compressed.push(...compressedOlder);
    }

    return compressed;
  }

  private estimateMessageTokens(msg: ChatCompletionMessageParam): number {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    return estimateLocalTokens(content);
  }

  private compressMessages(
    messages: ChatCompletionMessageParam[],
    budget: number
  ): ChatCompletionMessageParam[] {
    const compressed: ChatCompletionMessageParam[] = [];
    let usedTokens = 0;

    for (const msg of messages) {
      const msgTokens = this.estimateMessageTokens(msg);

      if (usedTokens + msgTokens <= budget) {
        compressed.push(msg);
        usedTokens += msgTokens;
      } else {
        // Try to compress this message
        const compressedMsg = this.compressSingleMessage(msg, budget - usedTokens);
        if (compressedMsg) {
          compressed.push(compressedMsg);
          usedTokens += this.estimateMessageTokens(compressedMsg);
        }
      }
    }

    return compressed;
  }

  private compressSingleMessage(
    msg: ChatCompletionMessageParam,
    budget: number
  ): ChatCompletionMessageParam | null {
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    const currentTokens = estimateLocalTokens(content);

    if (currentTokens <= budget) {
      return msg;
    }

    // Simple compression: take first and last parts, summarize middle
    const targetLength = Math.floor((budget * 3.5) / 2); // Convert tokens back to chars
    if (content.length <= targetLength) {
      return msg;
    }

    const firstPart = content.slice(0, Math.floor(targetLength / 2));
    const lastPart = content.slice(-Math.floor(targetLength / 2));
    const compressedContent = `${firstPart}\n[... ${content.length - targetLength} characters compressed ...]\n${lastPart}`;

    return { ...msg, content: compressedContent } as ChatCompletionMessageParam;
  }

  getContextStatistics(): {
    compressionEnabled: boolean;
    compressionRatio: number;
    semanticCacheSize: number;
    compressionCacheSize: number;
  } {
    return {
      compressionEnabled: this.compressionConfig.enabled,
      compressionRatio: this.compressionConfig.compressionRatio,
      semanticCacheSize: this.semanticCache.size,
      compressionCacheSize: this.compressionCache.size,
    };
  }

  clearCaches(): void {
    this.semanticCache.clear();
    this.compressionCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Dynamic Parameter Tuning System
// ---------------------------------------------------------------------------

interface AdaptiveParameters {
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  maxTokens: number;
}

interface ParameterTuningConfig {
  enabled: boolean;
  adaptationSpeed: number; // 0-1, how quickly parameters adapt
  minTemperature: number;
  maxTemperature: number;
  targetResponseLength: number;
}

export class DynamicParameterTuner {
  private config: ParameterTuningConfig = {
    enabled: true,
    adaptationSpeed: 0.3,
    minTemperature: ADAPTIVE_TEMP_MIN,
    maxTemperature: ADAPTIVE_TEMP_MAX,
    targetResponseLength: 500,
  };

  private currentParameters: AdaptiveParameters = {
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repetitionPenalty: 1.0,
    maxTokens: 2048,
  };

  private performanceHistory: Array<{
    parameters: AdaptiveParameters;
    responseLength: number;
    quality: number;
    timestamp: number;
  }> = [];

  setConfig(config: Partial<ParameterTuningConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getCurrentParameters(): AdaptiveParameters {
    return { ...this.currentParameters };
  }

  adaptParameters(feedback: {
    responseLength: number;
    quality: number; // 0-1 score
    userSatisfaction?: number; // 0-1 score
  }): void {
    if (!this.config.enabled) return;

    // Record performance
    this.performanceHistory.push({
      parameters: { ...this.currentParameters },
      responseLength: feedback.responseLength,
      quality: feedback.quality,
      timestamp: Date.now(),
    });

    // Keep only recent history
    const cutoff = Date.now() - PERFORMANCE_METRICS_WINDOW_MS;
    this.performanceHistory = this.performanceHistory.filter((h) => h.timestamp > cutoff);

    // Adapt temperature based on response length
    const lengthDiff = feedback.responseLength - this.config.targetResponseLength;
    if (lengthDiff > 200) {
      // Response too long, decrease temperature
      this.currentParameters.temperature = Math.max(
        this.config.minTemperature,
        this.currentParameters.temperature - (0.1 * this.config.adaptationSpeed)
      );
    } else if (lengthDiff < -200) {
      // Response too short, increase temperature
      this.currentParameters.temperature = Math.min(
        this.config.maxTemperature,
        this.currentParameters.temperature + (0.1 * this.config.adaptationSpeed)
      );
    }

    // Adapt based on quality
    if (feedback.quality < 0.5) {
      // Low quality, try different parameters
      this.currentParameters.topP = Math.max(0.5, this.currentParameters.topP - 0.05);
      this.currentParameters.repetitionPenalty = Math.min(
        1.5,
        this.currentParameters.repetitionPenalty + 0.1
      );
    } else if (feedback.quality > 0.8) {
      // High quality, reinforce current settings
      this.currentParameters.topP = Math.min(1.0, this.currentParameters.topP + 0.02);
    }

    // Consider user satisfaction if provided
    if (feedback.userSatisfaction !== undefined) {
      if (feedback.userSatisfaction < 0.5) {
        // User unhappy, try more creative parameters
        this.currentParameters.temperature = Math.min(
          this.config.maxTemperature,
          this.currentParameters.temperature + 0.15
        );
      }
    }
  }

  resetToDefaults(): void {
    this.currentParameters = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repetitionPenalty: 1.0,
      maxTokens: 2048,
    };
  }

  getPerformanceHistory(): Array<{
    parameters: AdaptiveParameters;
    responseLength: number;
    quality: number;
    timestamp: number;
  }> {
    return [...this.performanceHistory];
  }
}

// ---------------------------------------------------------------------------
// Intelligent Model Router
// ---------------------------------------------------------------------------

interface RoutingDecision {
  selectedModel: string;
  confidence: number;
  reasoning: string;
  alternativeModels: Array<{ modelId: string; score: number; reason: string }>;
}

export class IntelligentModelRouter {
  private performanceTracker: PerformanceTracker;
  private routingHistory: Array<{
    request: EngineGenerateRequest;
    decision: RoutingDecision;
    outcome: { success: boolean; quality: number };
    timestamp: number;
  }> = [];

  constructor(performanceTracker: PerformanceTracker) {
    this.performanceTracker = performanceTracker;
  }

  async selectBestModel(
    availableModels: ManifestModel[],
    request: EngineGenerateRequest,
    caps: EdgeCapabilities
  ): Promise<RoutingDecision> {
    const complexity = this.estimateRequestComplexity(request);
    const useCase = request.useCase || "chat";

    const scores = availableModels.map((model) => {
      const score = this.calculateModelScore(model, complexity, useCase, caps, request);
      return {
        modelId: model.id,
        model,
        score,
        reason: this.explainScore(model, score, complexity, useCase),
      };
    });

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    const best = scores[0];
    const confidence = Math.min(1, best.score / 100);

    const decision: RoutingDecision = {
      selectedModel: best.modelId,
      confidence,
      reasoning: best.reason,
      alternativeModels: scores.slice(1, 3).map((s) => ({
        modelId: s.modelId,
        score: s.score,
        reason: s.reason,
      })),
    };

    return decision;
  }

  private calculateModelScore(
    model: ManifestModel,
    complexity: string,
    useCase: ModelUseCase,
    caps: EdgeCapabilities,
    request: EngineGenerateRequest
  ): number {
    let score = 50; // Base score

    // Use case alignment
    if (model.useCases?.includes(useCase)) {
      score += 20;
    }

    // Speed tier consideration
    if (complexity === "simple" && model.speedTier === "fast") {
      score += 15;
    } else if (complexity === "complex" && model.speedTier === "capable") {
      score += 15;
    }

    // Performance history
    const metrics = this.performanceTracker.getModelMetrics(model.id);
    if (metrics) {
      score += metrics.successRate * 10;
      const useCasePerf = metrics.useCasePerformance.get(useCase);
      if (useCasePerf !== undefined) {
        score += useCasePerf * 10;
      }
    }

    // Context window consideration
    const estimatedTokens = estimateLocalTokens(request.prompt);
    if (model.contextWindowSize && model.contextWindowSize > estimatedTokens * 2) {
      score += 10; // Comfortable context window
    }

    // Size vs performance tradeoff
    if (complexity === "simple") {
      // Prefer smaller models for simple tasks
      score += Math.max(0, 10 - model.sizeBytes / (1024 * 1024 * 1024)); // Penalize large models
    } else {
      // Prefer larger models for complex tasks
      score += Math.min(10, model.sizeBytes / (1024 * 1024 * 1024)); // Reward large models
    }

    return score;
  }

  private explainScore(
    model: ManifestModel,
    score: number,
    complexity: string,
    useCase: ModelUseCase
  ): string {
    const reasons: string[] = [];

    if (model.useCases?.includes(useCase)) {
      reasons.push(`optimized for ${useCase}`);
    }

    if (model.speedTier === complexity) {
      reasons.push(`speed tier matches ${complexity} task`);
    }

    if (score > 70) {
      reasons.push("strong historical performance");
    }

    if (model.contextWindowSize && model.contextWindowSize > 8192) {
      reasons.push("large context window");
    }

    return reasons.length > 0 ? reasons.join(", ") : "general purpose model";
  }

  private estimateRequestComplexity(request: EngineGenerateRequest): string {
    const promptLength = request.prompt.length;
    const hasHistory = request.history && request.history.length > 0;
    const hasSuffix = !!request.suffix;
    const historyLength = request.history?.reduce((sum, h) => sum + h.content.length, 0) || 0;

    const totalLength = promptLength + historyLength;

    if (totalLength > 2000 || (hasHistory && hasSuffix)) {
      return "complex";
    } else if (totalLength > 500 || hasHistory || hasSuffix) {
      return "medium";
    }
    return "simple";
  }

  recordRoutingOutcome(
    request: EngineGenerateRequest,
    decision: RoutingDecision,
    outcome: { success: boolean; quality: number }
  ): void {
    this.routingHistory.push({
      request,
      decision,
      outcome,
      timestamp: Date.now(),
    });

    // Clean old history
    const cutoff = Date.now() - PERFORMANCE_METRICS_WINDOW_MS;
    this.routingHistory = this.routingHistory.filter((h) => h.timestamp > cutoff);
  }

  getRoutingHistory(): Array<{
    request: EngineGenerateRequest;
    decision: RoutingDecision;
    outcome: { success: boolean; quality: number };
    timestamp: number;
  }> {
    return [...this.routingHistory];
  }
}

// ---------------------------------------------------------------------------
// Revolutionary WebLLM Advanced Engine Factory
// ---------------------------------------------------------------------------

export interface AdvancedWebLlmConfig {
  enableEnsemble: boolean;
  enableMemoryCompression: boolean;
  enableDynamicTuning: boolean;
  enableIntelligentRouting: boolean;
  ensembleStrategy: "voting" | "weighted" | "cascade" | "adaptive";
  maxEnsembleModels: number;
}

export function createAdvancedWebLlmEngine(
  host: EdgeHost,
  config: AdvancedWebLlmConfig = {
    enableEnsemble: true,
    enableMemoryCompression: true,
    enableDynamicTuning: true,
    enableIntelligentRouting: true,
    ensembleStrategy: "adaptive",
    maxEnsembleModels: 3,
  }
) {
  const performanceTracker = new PerformanceTracker();
  const ensembleEngine = new EnsembleEngine(host, performanceTracker);
  const memoryManager = new AdvancedMemoryManager();
  const parameterTuner = new DynamicParameterTuner();
  const modelRouter = new IntelligentModelRouter(performanceTracker);

  return {
    performanceTracker,
    ensembleEngine,
    memoryManager,
    parameterTuner,
    modelRouter,
    config,
  };
}
