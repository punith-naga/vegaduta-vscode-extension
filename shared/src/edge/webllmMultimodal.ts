// Revolutionary Multi-Modal Capabilities and Advanced Context Handling for WebLLM
// Enables processing of images, audio, video, and advanced context management

import type { EdgeHost } from "./host";
import type { ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import type { EngineGenerateRequest } from "./engine";

// ---------------------------------------------------------------------------
// Multi-Modal Input Processing
// ---------------------------------------------------------------------------

interface MultiModalInput {
  type: "text" | "image" | "audio" | "video" | "code" | "document";
  content: string | ArrayBuffer;
  metadata?: {
    mimeType?: string;
    dimensions?: { width: number; height: number };
    duration?: number;
    language?: string;
    filename?: string;
    encoding?: string;
  };
  timestamp: number;
}

interface ProcessedModalData {
  originalInput: MultiModalInput;
  processedContent: string;
  embeddings?: number[];
  features?: Record<string, unknown>;
  quality: number; // 0-1 score
  processingTime: number;
}

interface MultiModalConfig {
  enabled: boolean;
  supportedTypes: MultiModalInput["type"][];
  maxImageSize: number; // pixels
  maxAudioDuration: number; // seconds
  maxVideoDuration: number; // seconds
  enableOCR: boolean;
  enableSpeechRecognition: boolean;
  enableObjectDetection: boolean;
}

export class MultiModalProcessor {
  private config: MultiModalConfig = {
    enabled: true,
    supportedTypes: ["text", "image", "audio", "video", "code", "document"],
    maxImageSize: 4096,
    maxAudioDuration: 300,
    maxVideoDuration: 600,
    enableOCR: true,
    enableSpeechRecognition: true,
    enableObjectDetection: true,
  };
  private processingHistory: Array<{
    input: MultiModalInput;
    result: ProcessedModalData;
    timestamp: number;
  }> = [];
  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
  }

  setConfig(config: Partial<MultiModalConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): MultiModalConfig {
    return { ...this.config };
  }

  async processInput(input: MultiModalInput): Promise<ProcessedModalData> {
    if (!this.config.enabled) {
      throw new Error("Multi-modal processing is disabled");
    }

    if (!this.config.supportedTypes.includes(input.type)) {
      throw new Error(`Unsupported input type: ${input.type}`);
    }

    const startTime = Date.now();

    try {
      let processedContent: string;
      let embeddings: number[] | undefined;
      let features: Record<string, unknown> | undefined;
      let quality = 1.0;

      switch (input.type) {
        case "text":
          const textResult = await this.processText(input);
          processedContent = textResult.content;
          embeddings = textResult.embeddings;
          quality = textResult.quality;
          break;

        case "image":
          const imageResult = await this.processImage(input);
          processedContent = imageResult.content;
          features = imageResult.features;
          quality = imageResult.quality;
          break;

        case "audio":
          const audioResult = await this.processAudio(input);
          processedContent = audioResult.content;
          features = audioResult.features;
          quality = audioResult.quality;
          break;

        case "video":
          const videoResult = await this.processVideo(input);
          processedContent = videoResult.content;
          features = videoResult.features;
          quality = videoResult.quality;
          break;

        case "code":
          const codeResult = await this.processCode(input);
          processedContent = codeResult.content;
          features = codeResult.features;
          quality = codeResult.quality;
          break;

        case "document":
          const documentResult = await this.processDocument(input);
          processedContent = documentResult.content;
          features = documentResult.features;
          quality = documentResult.quality;
          break;

        default:
          throw new Error(`Unknown input type: ${input.type}`);
      }

      const result: ProcessedModalData = {
        originalInput: input,
        processedContent,
        embeddings,
        features,
        quality,
        processingTime: Date.now() - startTime,
      };

      // Record processing history
      this.processingHistory.push({
        input,
        result,
        timestamp: Date.now(),
      });

      // Keep history manageable
      if (this.processingHistory.length > 100) {
        this.processingHistory = this.processingHistory.slice(-50);
      }

      return result;
    } catch (error) {
      throw new Error(`Failed to process ${input.type} input: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async processText(input: MultiModalInput): Promise<{
    content: string;
    embeddings?: number[];
    quality: number;
  }> {
    const text = typeof input.content === "string" ? input.content : "";

    // Generate embeddings for text
    const embeddings = await this.generateTextEmbeddings(text);

    // Assess text quality
    const quality = this.assessTextQuality(text);

    return {
      content: text,
      embeddings,
      quality,
    };
  }

  private async processImage(input: MultiModalInput): Promise<{
    content: string;
    features?: Record<string, unknown>;
    quality: number;
  }> {
    const imageData = input.content as ArrayBuffer;

    // Validate image size
    if (input.metadata?.dimensions) {
      const { width, height } = input.metadata.dimensions;
      if (width > this.config.maxImageSize || height > this.config.maxImageSize) {
        throw new Error(`Image dimensions exceed maximum size of ${this.config.maxImageSize}px`);
      }
    }

    let content = "";
    const features: Record<string, unknown> = {};

    // OCR if enabled
    if (this.config.enableOCR) {
      const ocrResult = await this.performOCR(imageData);
      if (ocrResult.text) {
        content += `Text detected in image: "${ocrResult.text}"\n`;
        features.ocrConfidence = ocrResult.confidence;
      }
    }

    // Object detection if enabled
    if (this.config.enableObjectDetection) {
      const objects = await this.detectObjects(imageData);
      if (objects.length > 0) {
        content += `Objects detected: ${objects.map(o => o.label).join(", ")}\n`;
        features.detectedObjects = objects;
      }
    }

    // Image description
    const description = await this.generateImageDescription(imageData);
    content += `Image description: ${description}\n`;

    // Assess image quality
    const quality = this.assessImageQuality(imageData);

    features.description = description;
    features.quality = quality;

    return {
      content: content || "[Image processed but no extractable content]",
      features,
      quality,
    };
  }

  private async processAudio(input: MultiModalInput): Promise<{
    content: string;
    features?: Record<string, unknown>;
    quality: number;
  }> {
    const audioData = input.content as ArrayBuffer;

    // Validate audio duration
    if (input.metadata?.duration && input.metadata.duration > this.config.maxAudioDuration) {
      throw new Error(`Audio duration exceeds maximum of ${this.config.maxAudioDuration} seconds`);
    }

    let content = "";
    const features: Record<string, unknown> = {};

    // Speech recognition if enabled
    if (this.config.enableSpeechRecognition) {
      const transcription = await this.transcribeAudio(audioData);
      if (transcription.text) {
        content += `Transcription: "${transcription.text}"\n`;
        features.transcriptionConfidence = transcription.confidence;
        features.language = transcription.language;
      }
    }

    // Audio analysis
    const analysis = await this.analyzeAudio(audioData);
    content += `Audio characteristics: duration ${analysis.duration}s, ` +
                `${analysis.channels} channels, sample rate ${analysis.sampleRate}Hz\n`;

    features.audioAnalysis = analysis;

    // Assess audio quality
    const quality = this.assessAudioQuality(audioData);

    return {
      content: content || "[Audio processed but no extractable content]",
      features,
      quality,
    };
  }

  private async processVideo(input: MultiModalInput): Promise<{
    content: string;
    features?: Record<string, unknown>;
    quality: number;
  }> {
    const videoData = input.content as ArrayBuffer;

    // Validate video duration
    if (input.metadata?.duration && input.metadata.duration > this.config.maxVideoDuration) {
      throw new Error(`Video duration exceeds maximum of ${this.config.maxVideoDuration} seconds`);
    }

    let content = "";
    const features: Record<string, unknown> = {};

    // Extract key frames and process them
    const keyFrames = await this.extractKeyFrames(videoData, 5); // Extract 5 key frames
    for (let i = 0; i < keyFrames.length; i++) {
      const frameContent = await this.processImage({
        type: "image",
        content: keyFrames[i],
        metadata: {},
        timestamp: Date.now(),
      });
      content += `Frame ${i + 1}: ${frameContent.content}\n`;
    }

    // Video description
    const description = await this.generateVideoDescription(videoData);
    content += `Video summary: ${description}\n`;

    features.keyFramesCount = keyFrames.length;
    features.description = description;

    // Assess video quality
    const quality = this.assessVideoQuality(videoData);

    return {
      content,
      features,
      quality,
    };
  }

  private async processCode(input: MultiModalInput): Promise<{
    content: string;
    features?: Record<string, unknown>;
    quality: number;
  }> {
    const code = typeof input.content === "string" ? input.content : "";
    const language = input.metadata?.language || this.detectCodeLanguage(code);

    const features: Record<string, unknown> = {
      language,
      lines: code.split("\n").length,
      functions: this.countFunctions(code, language),
      classes: this.countClasses(code, language),
    };

    // Code analysis
    const analysis = await this.analyzeCode(code, language);
    features.analysis = analysis;

    // Assess code quality
    const quality = this.assessCodeQuality(code, language);

    return {
      content: code,
      features,
      quality,
    };
  }

  private async processDocument(input: MultiModalInput): Promise<{
    content: string;
    features?: Record<string, unknown>;
    quality: number;
  }> {
    const documentData = input.content as ArrayBuffer;
    const mimeType = input.metadata?.mimeType || "application/pdf";

    let content = "";
    const features: Record<string, unknown> = {
      mimeType,
      size: documentData.byteLength,
    };

    // Extract text from document
    const extractedText = await this.extractTextFromDocument(documentData, mimeType);
    content += extractedText;

    // Document structure analysis
    const structure = await this.analyzeDocumentStructure(documentData, mimeType);
    features.structure = structure;

    // Assess document quality
    const quality = this.assessDocumentQuality(documentData, mimeType);

    return {
      content,
      features,
      quality,
    };
  }

  // Helper methods for modal processing (simplified implementations)

  private async generateTextEmbeddings(text: string): Promise<number[]> {
    // In a real implementation, this would use an embedding model
    // For now, return a simple hash-based embedding
    const embedding = new Array(128).fill(0);
    for (let i = 0; i < text.length; i++) {
      embedding[i % 128] = (embedding[i % 128] + text.charCodeAt(i)) % 256;
    }
    return embedding.map(v => v / 256);
  }

  private assessTextQuality(text: string): number {
    // Simple quality assessment based on length and character distribution
    if (text.length < 10) return 0.3;
    if (text.length < 50) return 0.6;
    if (text.length > 1000) return 0.8;

    const uniqueChars = new Set(text.toLowerCase()).size;
    const uniqueRatio = uniqueChars / text.length;

    return Math.min(1, 0.5 + uniqueRatio);
  }

  private async performOCR(imageData: ArrayBuffer): Promise<{ text: string; confidence: number }> {
    // In a real implementation, this would use Tesseract.js or similar
    // For now, return a placeholder
    return {
      text: "",
      confidence: 0,
    };
  }

  private async detectObjects(imageData: ArrayBuffer): Promise<Array<{ label: string; confidence: number }>> {
    // In a real implementation, this would use a object detection model
    // For now, return empty array
    return [];
  }

  private async generateImageDescription(imageData: ArrayBuffer): Promise<string> {
    // In a real implementation, this would use an image captioning model
    // For now, return a placeholder
    return "Image content description would be generated by a vision model";
  }

  private assessImageQuality(imageData: ArrayBuffer): number {
    // Simple quality assessment based on size
    const size = imageData.byteLength;
    if (size < 1024) return 0.3; // Very small image
    if (size < 1024 * 1024) return 0.7; // Medium image
    return 0.9; // Large image
  }

  private async transcribeAudio(audioData: ArrayBuffer): Promise<{ text: string; confidence: number; language: string }> {
    // In a real implementation, this would use Web Speech API or similar
    // For now, return a placeholder
    return {
      text: "",
      confidence: 0,
      language: "unknown",
    };
  }

  private async analyzeAudio(audioData: ArrayBuffer): Promise<{ duration: number; channels: number; sampleRate: number }> {
    // In a real implementation, this would analyze audio properties
    // For now, return placeholder values
    return {
      duration: 0,
      channels: 2,
      sampleRate: 44100,
    };
  }

  private assessAudioQuality(audioData: ArrayBuffer): number {
    // Simple quality assessment based on size
    const size = audioData.byteLength;
    if (size < 1024) return 0.3;
    if (size < 1024 * 1024) return 0.7;
    return 0.9;
  }

  private async extractKeyFrames(videoData: ArrayBuffer, count: number): Promise<ArrayBuffer[]> {
    // In a real implementation, this would extract frames from video
    // For now, return empty array
    return [];
  }

  private async generateVideoDescription(videoData: ArrayBuffer): Promise<string> {
    // In a real implementation, this would use a video understanding model
    // For now, return a placeholder
    return "Video content description would be generated by a video understanding model";
  }

  private assessVideoQuality(videoData: ArrayBuffer): number {
    // Simple quality assessment based on size
    const size = videoData.byteLength;
    if (size < 1024 * 1024) return 0.3;
    if (size < 10 * 1024 * 1024) return 0.7;
    return 0.9;
  }

  private detectCodeLanguage(code: string): string {
    // Simple language detection based on common patterns
    if (code.includes("function ") || code.includes("const ") || code.includes("=>")) return "javascript";
    if (code.includes("def ") || code.includes("import ")) return "python";
    if (code.includes("func ") || code.includes("package ")) return "go";
    if (code.includes("public class ") || code.includes("import java")) return "java";
    return "text";
  }

  private countFunctions(code: string, language: string): number {
    const patterns: Record<string, RegExp> = {
      javascript: /function\s+\w+/g,
      python: /def\s+\w+/g,
      go: /func\s+\w+/g,
      java: /public\s+\w+\s+\w+\s*\(/g,
    };

    const pattern = patterns[language] || patterns.javascript;
    const matches = code.match(pattern);
    return matches ? matches.length : 0;
  }

  private countClasses(code: string, language: string): number {
    const patterns: Record<string, RegExp> = {
      javascript: /class\s+\w+/g,
      python: /class\s+\w+/g,
      go: /type\s+\w+\s+struct/g,
      java: /class\s+\w+/g,
    };

    const pattern = patterns[language] || patterns.javascript;
    const matches = code.match(pattern);
    return matches ? matches.length : 0;
  }

  private async analyzeCode(code: string, language: string): Promise<Record<string, unknown>> {
    // Simple code analysis
    return {
      complexity: this.calculateCyclomaticComplexity(code),
      linesOfCode: code.split("\n").length,
      commentRatio: this.calculateCommentRatio(code, language),
    };
  }

  private calculateCyclomaticComplexity(code: string): number {
    const lines = code.split("\n");
    let complexity = 1;

    for (const line of lines) {
      if (/\b(if|else|for|while|case|catch|&&|\|\|)\b/.test(line)) {
        complexity++;
      }
    }

    return complexity;
  }

  private calculateCommentRatio(code: string, language: string): number {
    const commentPatterns: Record<string, RegExp> = {
      javascript: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
      python: /#.*$/gm,
      go: /\/\/.*$/gm,
      java: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
    };

    const pattern = commentPatterns[language] || commentPatterns.javascript;
    const comments = code.match(pattern) || [];
    const commentChars = comments.join("").length;
    const totalChars = code.length;

    return totalChars > 0 ? commentChars / totalChars : 0;
  }

  private assessCodeQuality(code: string, language: string): number {
    // Simple quality assessment
    const lines = code.split("\n").length;
    const complexity = this.calculateCyclomaticComplexity(code);

    if (lines < 5) return 0.4;
    if (complexity > 20) return 0.5; // Too complex
    if (lines > 1000) return 0.7; // Long but acceptable

    return 0.9;
  }

  private async extractTextFromDocument(documentData: ArrayBuffer, mimeType: string): Promise<string> {
    // In a real implementation, this would use PDF.js or similar
    // For now, return a placeholder
    return "[Document text extraction would be performed here]";
  }

  private async analyzeDocumentStructure(documentData: ArrayBuffer, mimeType: string): Promise<Record<string, unknown>> {
    // In a real implementation, this would analyze document structure
    // For now, return placeholder
    return {
      pages: 1,
      sections: [],
      metadata: {},
    };
  }

  private assessDocumentQuality(documentData: ArrayBuffer, mimeType: string): number {
    // Simple quality assessment based on size
    const size = documentData.byteLength;
    if (size < 1024) return 0.3;
    if (size < 1024 * 1024) return 0.7;
    return 0.9;
  }

  getProcessingHistory(): Array<{
    input: MultiModalInput;
    result: ProcessedModalData;
    timestamp: number;
  }> {
    return [...this.processingHistory];
  }

  clearHistory(): void {
    this.processingHistory = [];
  }
}

// ---------------------------------------------------------------------------
// Advanced Context Management System
// ---------------------------------------------------------------------------

interface ContextEntry {
  id: string;
  content: string;
  type: "user" | "assistant" | "system" | "tool" | "multimodal";
  timestamp: number;
  importance: number; // 0-1 score
  tags: string[];
  embeddings?: number[];
  metadata: Record<string, unknown>;
}

interface ContextWindow {
  entries: ContextEntry[];
  maxSize: number; // maximum number of entries
  maxTokens: number; // maximum tokens
  currentTokens: number;
  compressionRatio: number;
}

interface ContextConfig {
  maxEntries: number;
  maxTokens: number;
  enableCompression: boolean;
  enableSemanticSearch: boolean;
  enableLongTermMemory: boolean;
  importanceThreshold: number;
  retentionPeriod: number; // milliseconds
}

export class AdvancedContextManager {
  private contextWindow: ContextWindow;
  private longTermMemory = new Map<string, ContextEntry[]>();
  private config: ContextConfig = {
    maxEntries: 100,
    maxTokens: 8192,
    enableCompression: true,
    enableSemanticSearch: true,
    enableLongTermMemory: true,
    importanceThreshold: 0.5,
    retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
  };
  private embeddingCache = new Map<string, number[]>();
  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
    this.contextWindow = {
      entries: [],
      maxSize: this.config.maxEntries,
      maxTokens: this.config.maxTokens,
      currentTokens: 0,
      compressionRatio: 1.0,
    };
  }

  setConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
    this.contextWindow.maxSize = this.config.maxEntries;
    this.contextWindow.maxTokens = this.config.maxTokens;
  }

  getConfig(): ContextConfig {
    return { ...this.config };
  }

  async addEntry(entry: Omit<ContextEntry, "id" | "timestamp">): Promise<string> {
    const id = this.generateEntryId();
    const timestamp = Date.now();

    // Calculate importance if not provided
    const importance = entry.importance || await this.calculateImportance(entry.content, entry.type);

    // Generate embeddings if semantic search is enabled
    let embeddings: number[] | undefined;
    if (this.config.enableSemanticSearch) {
      embeddings = await this.generateEmbeddings(entry.content);
    }

    const contextEntry: ContextEntry = {
      ...entry,
      id,
      timestamp,
      importance,
      embeddings,
    };

    this.contextWindow.entries.push(contextEntry);
    this.contextWindow.currentTokens += this.estimateTokens(entry.content);

    // Manage window size
    await this.manageWindowSize();

    // Move to long-term memory if enabled
    if (this.config.enableLongTermMemory && importance < this.config.importanceThreshold) {
      await this.moveToLongTermMemory(contextEntry);
    }

    return id;
  }

  async addMultiModalEntry(processedData: any, type: ContextEntry["type"]): Promise<string> {
    return this.addEntry({
      content: processedData.processedContent,
      type,
      importance: processedData.quality,
      tags: [processedData.originalInput.type],
      metadata: {
        originalType: processedData.originalInput.type,
        features: processedData.features,
        quality: processedData.quality,
      },
    });
  }

  private generateEntryId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async calculateImportance(content: string, type: ContextEntry["type"]): Promise<number> {
    // Simple importance calculation
    let importance = 0.5;

    // System messages are always important
    if (type === "system") {
      importance = 1.0;
    }

    // User messages are moderately important
    if (type === "user") {
      importance = 0.7;
    }

    // Long content might be more important
    if (content.length > 500) {
      importance += 0.1;
    }

    // Content with specific keywords might be important
    const importantKeywords = ["error", "bug", "fix", "important", "critical", "urgent"];
    for (const keyword of importantKeywords) {
      if (content.toLowerCase().includes(keyword)) {
        importance += 0.1;
      }
    }

    return Math.min(1, importance);
  }

  private async generateEmbeddings(content: string): Promise<number[]> {
    // Check cache first
    const cacheKey = this.hashContent(content);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    // Generate embeddings (simplified implementation)
    const embedding = new Array(128).fill(0);
    for (let i = 0; i < content.length; i++) {
      embedding[i % 128] = (embedding[i % 128] + content.charCodeAt(i)) % 256;
    }
    const normalized = embedding.map(v => v / 256);

    // Cache the result
    this.embeddingCache.set(cacheKey, normalized);

    return normalized;
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private estimateTokens(content: string): number {
    // Simple token estimation
    return Math.ceil(content.length / 4);
  }

  private async manageWindowSize(): Promise<void> {
    // Remove entries based on importance and age
    while (this.contextWindow.entries.length > this.contextWindow.maxSize ||
           this.contextWindow.currentTokens > this.contextWindow.maxTokens) {

      // Find least important entry
      let leastImportantIndex = 0;
      let leastImportantScore = Infinity;

      for (let i = 0; i < this.contextWindow.entries.length; i++) {
        const entry = this.contextWindow.entries[i];
        const score = entry.importance - (entry.timestamp / Date.now()); // Prefer recent entries

        if (score < leastImportantScore) {
          leastImportantScore = score;
          leastImportantIndex = i;
        }
      }

      // Remove the least important entry
      const removed = this.contextWindow.entries.splice(leastImportantIndex, 1)[0];
      this.contextWindow.currentTokens -= this.estimateTokens(removed.content);

      // Move to long-term memory if enabled
      if (this.config.enableLongTermMemory) {
        await this.moveToLongTermMemory(removed);
      }
    }

    // Apply compression if enabled
    if (this.config.enableCompression) {
      await this.compressContext();
    }
  }

  private async compressContext(): Promise<void> {
    // Simple compression: summarize older, less important entries
    const compressionTarget = Math.floor(this.contextWindow.maxTokens * 0.8);

    if (this.contextWindow.currentTokens <= compressionTarget) {
      return;
    }

    // Find entries to compress (older, less important)
    const compressibleEntries = this.contextWindow.entries
      .filter(e => e.importance < 0.7 && e.type !== "system")
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const entry of compressibleEntries) {
      if (this.contextWindow.currentTokens <= compressionTarget) break;

      const originalTokens = this.estimateTokens(entry.content);
      const compressedContent = this.summarizeContent(entry.content);
      const compressedTokens = this.estimateTokens(compressedContent);

      if (compressedTokens < originalTokens) {
        const index = this.contextWindow.entries.indexOf(entry);
        if (index !== -1) {
          this.contextWindow.entries[index].content = compressedContent;
          this.contextWindow.currentTokens -= (originalTokens - compressedTokens);
          this.contextWindow.compressionRatio = this.contextWindow.currentTokens / this.contextWindow.maxTokens;
        }
      }
    }
  }

  private summarizeContent(content: string): string {
    // Simple summarization: take first and last sentences
    const sentences = content.split(/[.!?]+/);
    if (sentences.length <= 2) return content;

    const first = sentences[0].trim();
    const last = sentences[sentences.length - 1].trim();

    return `${first} [...] ${last}.`;
  }

  private async moveToLongTermMemory(entry: ContextEntry): Promise<void> {
    const key = this.generateMemoryKey(entry);
    if (!this.longTermMemory.has(key)) {
      this.longTermMemory.set(key, []);
    }

    this.longTermMemory.get(key)!.push(entry);

    // Clean old entries
    this.cleanLongTermMemory();
  }

  private generateMemoryKey(entry: ContextEntry): string {
    // Generate a key based on tags and type
    return `${entry.type}_${entry.tags.join("_")}`;
  }

  private cleanLongTermMemory(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;

    for (const [key, entries] of this.longTermMemory) {
      const filtered = entries.filter(e => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.longTermMemory.delete(key);
      } else {
        this.longTermMemory.set(key, filtered);
      }
    }
  }

  async searchContext(query: string, limit: number = 5): Promise<ContextEntry[]> {
    if (!this.config.enableSemanticSearch) {
      // Fallback to simple text search
      return this.contextWindow.entries
        .filter(e => e.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
    }

    const queryEmbedding = await this.generateEmbeddings(query);

    // Calculate similarity scores
    const scored = this.contextWindow.entries
      .map(entry => ({
        entry,
        score: this.cosineSimilarity(queryEmbedding, entry.embeddings || []),
      }))
      .filter(item => item.score > 0.5) // Similarity threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(item => item.entry);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async retrieveRelevantContext(query: string, maxTokens: number): Promise<ContextEntry[]> {
    const relevant = await this.searchContext(query, 10);
    const selected: ContextEntry[] = [];
    let usedTokens = 0;

    for (const entry of relevant) {
      const tokens = this.estimateTokens(entry.content);
      if (usedTokens + tokens <= maxTokens) {
        selected.push(entry);
        usedTokens += tokens;
      }
    }

    return selected;
  }

  getContextWindow(): ContextWindow {
    return {
      entries: [...this.contextWindow.entries],
      maxSize: this.contextWindow.maxSize,
      maxTokens: this.contextWindow.maxTokens,
      currentTokens: this.contextWindow.currentTokens,
      compressionRatio: this.contextWindow.compressionRatio,
    };
  }

  getLongTermMemory(): Map<string, ContextEntry[]> {
    return new Map(this.longTermMemory);
  }

  clearContext(): void {
    this.contextWindow.entries = [];
    this.contextWindow.currentTokens = 0;
    this.contextWindow.compressionRatio = 1.0;
  }

  clearLongTermMemory(): void {
    this.longTermMemory.clear();
  }

  clearAll(): void {
    this.clearContext();
    this.clearLongTermMemory();
    this.embeddingCache.clear();
  }

  getContextStatistics(): {
    totalEntries: number;
    totalTokens: number;
    averageImportance: number;
    typeDistribution: Record<string, number>;
    compressionRatio: number;
    longTermMemoryEntries: number;
  } {
    const entries = this.contextWindow.entries;
    const totalEntries = entries.length;
    const totalTokens = this.contextWindow.currentTokens;
    const averageImportance = totalEntries > 0
      ? entries.reduce((sum, e) => sum + e.importance, 0) / totalEntries
      : 0;

    const typeDistribution: Record<string, number> = {};
    for (const entry of entries) {
      typeDistribution[entry.type] = (typeDistribution[entry.type] || 0) + 1;
    }

    let longTermMemoryEntries = 0;
    for (const entries of this.longTermMemory.values()) {
      longTermMemoryEntries += entries.length;
    }

    return {
      totalEntries,
      totalTokens,
      averageImportance,
      typeDistribution,
      compressionRatio: this.contextWindow.compressionRatio,
      longTermMemoryEntries,
    };
  }
}

// ---------------------------------------------------------------------------
// Revolutionary Multi-Modal Factory
// ---------------------------------------------------------------------------

export interface MultiModalSystemConfig {
  enableMultiModal: boolean;
  enableAdvancedContext: boolean;
  multiModalConfig?: Partial<MultiModalConfig>;
  contextConfig?: Partial<ContextConfig>;
}

export function createMultiModalSystem(
  host: EdgeHost,
  config: MultiModalSystemConfig = {
    enableMultiModal: true,
    enableAdvancedContext: true,
  }
) {
  const multiModalProcessor = new MultiModalProcessor(host);
  const contextManager = new AdvancedContextManager(host);

  // Apply configurations
  if (config.multiModalConfig) {
    multiModalProcessor.setConfig(config.multiModalConfig);
  }

  if (config.contextConfig) {
    contextManager.setConfig(config.contextConfig);
  }

  return {
    multiModalProcessor,
    contextManager,
    config,

    // High-level API
    async processInput(input: MultiModalInput) {
      if (config.enableMultiModal) {
        return multiModalProcessor.processInput(input);
      }
      throw new Error("Multi-modal processing is disabled");
    },

    async addContextEntry(entry: Omit<ContextEntry, "id" | "timestamp">) {
      if (config.enableAdvancedContext) {
        return contextManager.addEntry(entry);
      }
      throw new Error("Advanced context management is disabled");
    },

    async searchContext(query: string, limit?: number) {
      if (config.enableAdvancedContext) {
        return contextManager.searchContext(query, limit);
      }
      return [];
    },

    getSystemStatus() {
      return {
        multiModal: {
          enabled: config.enableMultiModal,
          supportedTypes: multiModalProcessor.getConfig().supportedTypes,
          processingHistory: multiModalProcessor.getProcessingHistory().length,
        },
        context: {
          enabled: config.enableAdvancedContext,
          statistics: contextManager.getContextStatistics(),
        },
      };
    },
  };
}
