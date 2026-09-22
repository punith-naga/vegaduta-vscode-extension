// Revolutionary Developer Experience Enhancements for WebLLM
// Provides profiling, performance monitoring, debugging, and dashboard capabilities

import type { EdgeHost } from "./host";
import type { LocalEngineStatus } from "./engine";

// ---------------------------------------------------------------------------
// Performance Profiling System
// ---------------------------------------------------------------------------

interface PerformanceProfile {
  sessionId: string;
  timestamp: number;
  duration: number;
  operations: Array<{
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
    metadata: Record<string, unknown>;
  }>;
  memoryUsage: {
    start: number;
    end: number;
    peak: number;
  };
  gpuMetrics: {
    memoryUsed: number;
    memoryTotal: number;
    utilization: number;
  } | null;
}

interface ProfilingConfig {
  enabled: boolean;
  sampleInterval: number; // milliseconds
  captureStackTraces: boolean;
  captureMemorySnapshots: boolean;
  autoStart: boolean;
}

export class PerformanceProfiler {
  private profiles = new Map<string, PerformanceProfile>();
  private currentProfile: PerformanceProfile | null = null;
  private config: ProfilingConfig = {
    enabled: true,
    sampleInterval: 100,
    captureStackTraces: true,
    captureMemorySnapshots: true,
    autoStart: false,
  };
  private samplingInterval: ReturnType<typeof setInterval> | null = null;
  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
  }

  setConfig(config: Partial<ProfilingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): ProfilingConfig {
    return { ...this.config };
  }

  startSession(sessionId: string): void {
    if (!this.config.enabled) return;

    if (this.currentProfile) {
      this.endSession();
    }

    this.currentProfile = {
      sessionId,
      timestamp: Date.now(),
      duration: 0,
      operations: [],
      memoryUsage: {
        start: this.getCurrentMemoryUsage(),
        end: 0,
        peak: this.getCurrentMemoryUsage(),
      },
      gpuMetrics: this.getCurrentGPUMetrics(),
    };

    if (this.config.captureMemorySnapshots) {
      this.startMemorySampling();
    }
  }

  endSession(): PerformanceProfile | null {
    if (!this.currentProfile) return null;

    this.currentProfile.duration = Date.now() - this.currentProfile.timestamp;
    this.currentProfile.memoryUsage.end = this.getCurrentMemoryUsage();
    this.currentProfile.gpuMetrics = this.getCurrentGPUMetrics();

    if (this.samplingInterval) {
      clearInterval(this.samplingInterval);
      this.samplingInterval = null;
    }

    const profile = this.currentProfile;
    this.profiles.set(profile.sessionId, profile);
    this.currentProfile = null;

    return profile;
  }

  recordOperation(name: string, metadata: Record<string, unknown> = {}): void {
    if (!this.currentProfile) return;

    const operation = {
      name,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      metadata,
    };

    this.currentProfile.operations.push(operation);

    // Return a function to end the operation
    return () => {
      operation.endTime = Date.now();
      operation.duration = operation.endTime - operation.startTime;
    };
  }

  private startMemorySampling(): void {
    this.samplingInterval = setInterval(() => {
      if (!this.currentProfile) return;

      const currentMemory = this.getCurrentMemoryUsage();
      if (currentMemory > this.currentProfile.memoryUsage.peak) {
        this.currentProfile.memoryUsage.peak = currentMemory;
      }
    }, this.config.sampleInterval);
  }

  private getCurrentMemoryUsage(): number {
    if (typeof performance !== "undefined" && "memory" in performance) {
      const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
      return memory?.usedJSHeapSize || 0;
    }
    return 0;
  }

  private getCurrentGPUMetrics(): PerformanceProfile["gpuMetrics"] {
    // In a real implementation, this would query WebGPU for actual metrics
    // For now, return null as GPU metrics are not directly accessible
    return null;
  }

  getProfile(sessionId: string): PerformanceProfile | undefined {
    return this.profiles.get(sessionId);
  }

  getAllProfiles(): PerformanceProfile[] {
    return Array.from(this.profiles.values());
  }

  getLatestProfile(): PerformanceProfile | undefined {
    const profiles = Array.from(this.profiles.values());
    if (profiles.length === 0) return undefined;
    return profiles.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  clearProfiles(): void {
    this.profiles.clear();
  }

  deleteProfile(sessionId: string): void {
    this.profiles.delete(sessionId);
  }

  getProfileStatistics(): {
    totalProfiles: number;
    averageDuration: number;
    averageMemoryUsage: number;
    peakMemoryUsage: number;
    operationCounts: Record<string, number>;
  } {
    const profiles = Array.from(this.profiles.values());

    if (profiles.length === 0) {
      return {
        totalProfiles: 0,
        averageDuration: 0,
        averageMemoryUsage: 0,
        peakMemoryUsage: 0,
        operationCounts: {},
      };
    }

    const totalDuration = profiles.reduce((sum, p) => sum + p.duration, 0);
    const averageMemoryUsage =
      profiles.reduce((sum, p) => sum + p.memoryUsage.peak, 0) / profiles.length;
    const peakMemoryUsage = Math.max(...profiles.map(p => p.memoryUsage.peak));

    const operationCounts: Record<string, number> = {};
    for (const profile of profiles) {
      for (const op of profile.operations) {
        operationCounts[op.name] = (operationCounts[op.name] || 0) + 1;
      }
    }

    return {
      totalProfiles: profiles.length,
      averageDuration: totalDuration / profiles.length,
      averageMemoryUsage,
      peakMemoryUsage,
      operationCounts,
    };
  }
}

// ---------------------------------------------------------------------------
// Real-time Monitoring Dashboard
// ---------------------------------------------------------------------------

interface DashboardMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    cores: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  gpu: {
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
    temperature: number;
  } | null;
  engine: {
    status: LocalEngineStatus;
    activeGenerations: number;
    queuedRequests: number;
    averageResponseTime: number;
  };
  network: {
    connectedPeers: number;
    uploadSpeed: number;
    downloadSpeed: number;
  };
}

interface DashboardConfig {
  enabled: boolean;
  updateInterval: number;
  retainHistory: number; // number of data points to keep
  alertThresholds: {
    cpuUsage: number;
    memoryUsage: number;
    gpuUsage: number;
    responseTime: number;
  };
}

export class MonitoringDashboard {
  private metricsHistory: DashboardMetrics[] = [];
  private config: DashboardConfig = {
    enabled: true,
    updateInterval: 1000,
    retainHistory: 300, // 5 minutes at 1-second intervals
    alertThresholds: {
      cpuUsage: 80,
      memoryUsage: 85,
      gpuUsage: 90,
      responseTime: 5000,
    },
  };
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private alerts: Array<{
    timestamp: number;
    type: string;
    message: string;
    severity: "info" | "warning" | "error";
    metrics: DashboardMetrics;
  }> = [];
  private host: EdgeHost;
  private engineStatus: LocalEngineStatus = { state: "unavailable" };
  private activeGenerations = 0;
  private queuedRequests = 0;
  private responseTimes: number[] = [];

  constructor(host: EdgeHost) {
    this.host = host;
  }

  setConfig(config: Partial<DashboardConfig>): void {
    this.config = { ...this.config, ...config };

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.config.enabled) {
      this.startMonitoring();
    }
  }

  getConfig(): DashboardConfig {
    return { ...this.config };
  }

  startMonitoring(): void {
    if (this.updateInterval) return;

    this.updateInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.updateInterval);
  }

  stopMonitoring(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private async collectMetrics(): Promise<void> {
    const metrics: DashboardMetrics = {
      timestamp: Date.now(),
      cpu: await this.getCPUMetrics(),
      memory: await this.getMemoryMetrics(),
      gpu: await this.getGPUMetrics(),
      engine: {
        status: this.engineStatus,
        activeGenerations: this.activeGenerations,
        queuedRequests: this.queuedRequests,
        averageResponseTime: this.getAverageResponseTime(),
      },
      network: await this.getNetworkMetrics(),
    };

    this.metricsHistory.push(metrics);

    // Trim history
    if (this.metricsHistory.length > this.config.retainHistory) {
      this.metricsHistory = this.metricsHistory.slice(-this.config.retainHistory);
    }

    // Check for alerts
    this.checkAlerts(metrics);
  }

  private async getCPUMetrics(): Promise<DashboardMetrics["cpu"]> {
    // In a real implementation, this would use the CPU API
    // For now, return simulated data
    return {
      usage: Math.random() * 30 + 10, // 10-40% usage
      cores: navigator.hardwareConcurrency || 4,
    };
  }

  private async getMemoryMetrics(): Promise<DashboardMetrics["memory"]> {
    if (typeof performance !== "undefined" && "memory" in performance) {
      const memory = (performance as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
      if (memory) {
        const used = memory.usedJSHeapSize || 0;
        const total = memory.jsHeapSizeLimit || 1;
        return {
          used,
          total,
          percentage: (used / total) * 100,
        };
      }
    }

    return {
      used: 0,
      total: 1,
      percentage: 0,
    };
  }

  private async getGPUMetrics(): Promise<DashboardMetrics["gpu"]> {
    // In a real implementation, this would query WebGPU for actual metrics
    // For now, return null as GPU metrics are not directly accessible
    return null;
  }

  private async getNetworkMetrics(): Promise<DashboardMetrics["network"]> {
    // In a real implementation, this would measure actual network activity
    // For now, return simulated data
    return {
      connectedPeers: 0,
      uploadSpeed: 0,
      downloadSpeed: 0,
    };
  }

  private getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    const sum = this.responseTimes.reduce((a, b) => a + b, 0);
    return sum / this.responseTimes.length;
  }

  private checkAlerts(metrics: DashboardMetrics): void {
    const { alertThresholds } = this.config;

    if (metrics.cpu.usage > alertThresholds.cpuUsage) {
      this.addAlert({
        timestamp: Date.now(),
        type: "cpu",
        message: `High CPU usage: ${metrics.cpu.usage.toFixed(1)}%`,
        severity: "warning",
        metrics,
      });
    }

    if (metrics.memory.percentage > alertThresholds.memoryUsage) {
      this.addAlert({
        timestamp: Date.now(),
        type: "memory",
        message: `High memory usage: ${metrics.memory.percentage.toFixed(1)}%`,
        severity: "warning",
        metrics,
      });
    }

    if (metrics.gpu && metrics.gpu.usage > alertThresholds.gpuUsage) {
      this.addAlert({
        timestamp: Date.now(),
        type: "gpu",
        message: `High GPU usage: ${metrics.gpu.usage.toFixed(1)}%`,
        severity: "warning",
        metrics,
      });
    }

    if (metrics.engine.averageResponseTime > alertThresholds.responseTime) {
      this.addAlert({
        timestamp: Date.now(),
        type: "performance",
        message: `High response time: ${metrics.engine.averageResponseTime.toFixed(0)}ms`,
        severity: "warning",
        metrics,
      });
    }
  }

  private addAlert(alert: DashboardMetrics): void {
    this.alerts.push(alert);

    // Keep only recent alerts
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
  }

  updateEngineStatus(status: LocalEngineStatus): void {
    this.engineStatus = status;
  }

  recordGenerationStart(): void {
    this.activeGenerations++;
  }

  recordGenerationEnd(responseTime: number): void {
    this.activeGenerations = Math.max(0, this.activeGenerations - 1);
    this.responseTimes.push(responseTime);

    // Keep only recent response times
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-50);
    }
  }

  recordQueuedRequest(): void {
    this.queuedRequests++;
  }

  recordDequeuedRequest(): void {
    this.queuedRequests = Math.max(0, this.queuedRequests - 1);
  }

  getCurrentMetrics(): DashboardMetrics | null {
    return this.metricsHistory[this.metricsHistory.length - 1] || null;
  }

  getMetricsHistory(timeRange?: number): DashboardMetrics[] {
    if (!timeRange) return [...this.metricsHistory];

    const cutoff = Date.now() - timeRange;
    return this.metricsHistory.filter(m => m.timestamp > cutoff);
  }

  getAlerts(severity?: "info" | "warning" | "error"): Array<DashboardMetrics> {
    if (severity) {
      return this.alerts.filter(a => a.severity === severity);
    }
    return [...this.alerts];
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  getMetricsSummary(): {
    avgCpuUsage: number;
    avgMemoryUsage: number;
    avgResponseTime: number;
    totalGenerations: number;
    uptime: number;
  } {
    if (this.metricsHistory.length === 0) {
      return {
        avgCpuUsage: 0,
        avgMemoryUsage: 0,
        avgResponseTime: 0,
        totalGenerations: 0,
        uptime: 0,
      };
    }

    const recentMetrics = this.metricsHistory.slice(-60); // Last 60 data points
    const avgCpuUsage = recentMetrics.reduce((sum, m) => sum + m.cpu.usage, 0) / recentMetrics.length;
    const avgMemoryUsage = recentMetrics.reduce((sum, m) => sum + m.memory.percentage, 0) / recentMetrics.length;
    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + m.engine.averageResponseTime, 0) / recentMetrics.length;

    const firstTimestamp = this.metricsHistory[0].timestamp;
    const uptime = Date.now() - firstTimestamp;

    return {
      avgCpuUsage,
      avgMemoryUsage,
      avgResponseTime,
      totalGenerations: this.responseTimes.length,
      uptime,
    };
  }
}

// ---------------------------------------------------------------------------
// Interactive Debugging System
// ---------------------------------------------------------------------------

interface DebugSession {
  sessionId: string;
  timestamp: number;
  breakpoints: Set<string>;
  watchExpressions: Array<{
    expression: string;
    value: unknown;
    timestamp: number;
  }>;
  callStack: Array<{
    function: string;
    line: number;
    file: string;
  }>;
  variables: Map<string, unknown>;
}

interface DebugConfig {
  enabled: boolean;
  autoBreakOnError: boolean;
  maxWatchExpressions: number;
  maxCallStackDepth: number;
}

export class DebugSystem {
  private sessions = new Map<string, DebugSession>();
  private currentSession: DebugSession | null = null;
  private config: DebugConfig = {
    enabled: true,
    autoBreakOnError: true,
    maxWatchExpressions: 50,
    maxCallStackDepth: 20,
  };
  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
  }

  setConfig(config: Partial<DebugConfig>): void {
    this.config = { ...this.config, ...config };
  }

  startDebugSession(sessionId: string): DebugSession {
    const session: DebugSession = {
      sessionId,
      timestamp: Date.now(),
      breakpoints: new Set(),
      watchExpressions: [],
      callStack: [],
      variables: new Map(),
    };

    this.sessions.set(sessionId, session);
    this.currentSession = session;

    return session;
  }

  endDebugSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.currentSession?.sessionId === sessionId) {
      this.currentSession = null;
    }
  }

  addBreakpoint(file: string, line: number): void {
    if (!this.currentSession) return;

    const breakpointKey = `${file}:${line}`;
    this.currentSession.breakpoints.add(breakpointKey);
  }

  removeBreakpoint(file: string, line: number): void {
    if (!this.currentSession) return;

    const breakpointKey = `${file}:${line}`;
    this.currentSession.breakpoints.delete(breakpointKey);
  }

  addWatchExpression(expression: string): void {
    if (!this.currentSession) return;

    if (this.currentSession.watchExpressions.length >= this.config.maxWatchExpressions) {
      this.currentSession.watchExpressions.shift();
    }

    try {
      // Evaluate the expression (simplified - in real implementation would use proper evaluation)
      const value = this.evaluateExpression(expression);

      this.currentSession.watchExpressions.push({
        expression,
        value,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`Failed to evaluate watch expression: ${expression}`, error);
    }
  }

  private evaluateExpression(expression: string): unknown {
    // In a real implementation, this would safely evaluate expressions
    // For now, return a placeholder
    return `[evaluated: ${expression}]`;
  }

  updateCallStack(callStack: DebugSession["callStack"]): void {
    if (!this.currentSession) return;

    this.currentSession.callStack = callStack.slice(0, this.config.maxCallStackDepth);
  }

  setVariable(name: string, value: unknown): void {
    if (!this.currentSession) return;

    this.currentSession.variables.set(name, value);
  }

  getVariable(name: string): unknown {
    return this.currentSession?.variables.get(name);
  }

  getAllVariables(): Record<string, unknown> {
    if (!this.currentSession) return {};

    return Object.fromEntries(this.currentSession.variables);
  }

  getSession(sessionId: string): DebugSession | undefined {
    return this.sessions.get(sessionId);
  }

  getCurrentSession(): DebugSession | null {
    return this.currentSession;
  }

  getAllSessions(): DebugSession[] {
    return Array.from(this.sessions.values());
  }

  clearSessions(): void {
    this.sessions.clear();
    this.currentSession = null;
  }
}

// ---------------------------------------------------------------------------
// Developer Analytics and Insights
// ---------------------------------------------------------------------------

interface UsageAnalytics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  totalTokensGenerated: number;
  modelUsage: Record<string, number>;
  featureUsage: Record<string, number>;
  timeDistribution: Record<string, number>; // hour of day -> request count
  errorTypes: Record<string, number>;
}

export class DeveloperAnalytics {
  private analytics: UsageAnalytics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    totalTokensGenerated: 0,
    modelUsage: {},
    featureUsage: {},
    timeDistribution: {},
    errorTypes: {},
  };

  private responseTimes: number[] = [];
  private host: EdgeHost;

  constructor(host: EdgeHost) {
    this.host = host;
  }

  recordRequest(success: boolean, responseTime: number, modelId: string, feature: string): void {
    this.analytics.totalRequests++;

    if (success) {
      this.analytics.successfulRequests++;
    } else {
      this.analytics.failedRequests++;
    }

    this.responseTimes.push(responseTime);

    // Keep only recent response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-500);
    }

    // Update average response time
    this.analytics.averageResponseTime =
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;

    // Track model usage
    this.analytics.modelUsage[modelId] = (this.analytics.modelUsage[modelId] || 0) + 1;

    // Track feature usage
    this.analytics.featureUsage[feature] = (this.analytics.featureUsage[feature] || 0) + 1;

    // Track time distribution
    const hour = new Date().getHours();
    this.analytics.timeDistribution[hour] = (this.analytics.timeDistribution[hour] || 0) + 1;
  }

  recordTokensGenerated(tokens: number): void {
    this.analytics.totalTokensGenerated += tokens;
  }

  recordError(errorType: string): void {
    this.analytics.errorTypes[errorType] = (this.analytics.errorTypes[errorType] || 0) + 1;
  }

  getAnalytics(): UsageAnalytics {
    return { ...this.analytics };
  }

  getInsights(): {
    mostUsedModel: string;
    mostUsedFeature: string;
    peakUsageHour: number;
    successRate: number;
    averageTokensPerRequest: number;
    recommendations: string[];
  } {
    const mostUsedModel = Object.entries(this.analytics.modelUsage)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || "unknown";

    const mostUsedFeature = Object.entries(this.analytics.featureUsage)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || "unknown";

    const peakUsageHour = Object.entries(this.analytics.timeDistribution)
      .sort(([, a], [, b]) => b - a)[0]?.[0]
      ? Number(Object.entries(this.analytics.timeDistribution).sort(([, a], [, b]) => b - a)[0]?.[0])
      : 0;

    const successRate =
      this.analytics.totalRequests > 0
        ? (this.analytics.successfulRequests / this.analytics.totalRequests) * 100
        : 0;

    const averageTokensPerRequest =
      this.analytics.totalRequests > 0
        ? this.analytics.totalTokensGenerated / this.analytics.totalRequests
        : 0;

    const recommendations: string[] = [];

    if (successRate < 90) {
      recommendations.push("Consider investigating error patterns to improve reliability");
    }

    if (this.analytics.averageResponseTime > 3000) {
      recommendations.push("Response times are high - consider optimizing or using faster models");
    }

    if (Object.keys(this.analytics.modelUsage).length > 5) {
      recommendations.push("Many models in use - consider consolidating to improve efficiency");
    }

    return {
      mostUsedModel,
      mostUsedFeature,
      peakUsageHour,
      successRate,
      averageTokensPerRequest,
      recommendations,
    };
  }

  reset(): void {
    this.analytics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      totalTokensGenerated: 0,
      modelUsage: {},
      featureUsage: {},
      timeDistribution: {},
      errorTypes: {},
    };
    this.responseTimes = [];
  }

  exportAnalytics(): string {
    return JSON.stringify(this.analytics, null, 2);
  }

  importAnalytics(data: string): void {
    try {
      const imported = JSON.parse(data) as UsageAnalytics;
      this.analytics = { ...this.analytics, ...imported };
    } catch (error) {
      console.error("Failed to import analytics:", error);
    }
  }
}

// ---------------------------------------------------------------------------
// Revolutionary Developer Experience Factory
// ---------------------------------------------------------------------------

export interface DeveloperExperienceConfig {
  enableProfiling: boolean;
  enableMonitoring: boolean;
  enableDebugging: boolean;
  enableAnalytics: boolean;
  profilingConfig?: Partial<ProfilingConfig>;
  dashboardConfig?: Partial<DashboardConfig>;
  debugConfig?: Partial<DebugConfig>;
}

export function createDeveloperExperienceSystem(
  host: EdgeHost,
  config: DeveloperExperienceConfig = {
    enableProfiling: true,
    enableMonitoring: true,
    enableDebugging: true,
    enableAnalytics: true,
  }
) {
  const profiler = new PerformanceProfiler(host);
  const dashboard = new MonitoringDashboard(host);
  const debugSystem = new DebugSystem(host);
  const analytics = new DeveloperAnalytics(host);

  // Apply configurations
  if (config.profilingConfig) {
    profiler.setConfig(config.profilingConfig);
  }

  if (config.dashboardConfig) {
    dashboard.setConfig(config.dashboardConfig);
  }

  if (config.debugConfig) {
    debugSystem.setConfig(config.debugConfig);
  }

  // Start systems based on config
  if (config.enableMonitoring) {
    dashboard.startMonitoring();
  }

  return {
    profiler,
    dashboard,
    debugSystem,
    analytics,
    config,

    // High-level API
    startProfiling(sessionId: string) {
      if (config.enableProfiling) {
        profiler.startSession(sessionId);
      }
    },

    stopProfiling() {
      if (config.enableProfiling) {
        return profiler.endSession();
      }
      return null;
    },

    getDeveloperDashboard() {
      return {
        metrics: dashboard.getCurrentMetrics(),
        alerts: dashboard.getAlerts(),
        summary: dashboard.getMetricsSummary(),
        insights: analytics.getInsights(),
      };
    },

    recordGeneration(success: boolean, responseTime: number, modelId: string, feature: string) {
      if (config.enableAnalytics) {
        analytics.recordRequest(success, responseTime, modelId, feature);
        dashboard.recordGenerationEnd(responseTime);
      }
    },

    getFullReport() {
      return {
        profiling: profiler.getProfileStatistics(),
        monitoring: dashboard.getMetricsSummary(),
        analytics: analytics.getAnalytics(),
        insights: analytics.getInsights(),
      };
    },
  };
}
