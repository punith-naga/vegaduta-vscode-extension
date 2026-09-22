// Revolutionary Peer-to-Peer Model Sharing and Collaborative Learning System
// Enables decentralized model weight sharing, knowledge transfer, and collaborative
// fine-tuning across devices without central servers

import type { EdgeHost } from "./host";
import type { ManifestModel } from "./capabilities";

// ---------------------------------------------------------------------------
// Revolutionary Architecture Constants
// ---------------------------------------------------------------------------

/** Time window for performance metrics rolling average (milliseconds) */
const COLLABORATIVE_METRICS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// P2P Network Architecture
// ---------------------------------------------------------------------------

interface PeerInfo {
  id: string;
  ipAddress: string; // Local network IP
  port: number;
  capabilities: {
    webgpu: boolean;
    deviceMemory: number;
    maxModels: number;
    availableStorage: number;
  };
  hostedModels: string[];
  lastSeen: number;
  trustScore: number; // 0-1 based on successful interactions
}

interface ModelShard {
  shardId: string;
  modelId: string;
  shardIndex: number;
  totalShards: number;
  data: ArrayBuffer;
  checksum: string;
  size: number;
}

interface DiscoveryMessage {
  type: "discovery" | "announce" | "query" | "response";
  peerId: string;
  timestamp: number;
  payload?: unknown;
}

interface TransferProgress {
  shardIndex: number;
  totalShards: number;
  bytesTransferred: number;
  totalBytes: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}

// ---------------------------------------------------------------------------
// WebRTC-based P2P Connection Manager
// ---------------------------------------------------------------------------

export class P2PConnectionManager {
  private localPeerId: string;
  private peers = new Map<string, PeerInfo>();
  private connections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private host: EdgeHost;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;

  constructor(host: EdgeHost) {
    this.host = host;
    this.localPeerId = this.generatePeerId();
  }

  private generatePeerId(): string {
    return `peer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async startDiscovery(): Promise<void> {
    // Start local network discovery using WebRTC and mDNS-like mechanisms
    this.discoveryInterval = setInterval(() => {
      this.broadcastDiscovery();
    }, 5000); // Broadcast every 5 seconds

    // Listen for discovery messages
    this.setupDiscoveryListener();
  }

  stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
  }

  private async broadcastDiscovery(): Promise<void> {
    // In a real implementation, this would use WebRTC data channels or
    // WebSocket broadcasting for local network discovery
    const message: DiscoveryMessage = {
      type: "announce",
      peerId: this.localPeerId,
      timestamp: Date.now(),
      payload: await this.getLocalCapabilities(),
    };

    // Broadcast to known peers
    for (const [peerId, connection] of this.connections) {
      try {
        const channel = this.dataChannels.get(peerId);
        if (channel && channel.readyState === "open") {
          channel.send(JSON.stringify(message));
        }
      } catch (error) {
        console.error(`Failed to send discovery to ${peerId}:`, error);
      }
    }
  }

  private setupDiscoveryListener(): void {
    // Listen for incoming discovery messages from peers
    // This would set up WebSocket servers or WebRTC signaling
  }

  private async getLocalCapabilities(): Promise<PeerInfo["capabilities"]> {
    // Detect local capabilities
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
    let deviceMemory = 4; // Default fallback
    let maxModels = 2;
    let availableStorage = 10 * 1024 * 1024 * 1024; // 10GB default

    if (typeof navigator !== "undefined" && "deviceMemory" in navigator) {
      deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory || 4;
    }

    if (typeof navigator !== "undefined" && "storage" in navigator) {
      try {
        const estimate = await (navigator as { storage?: { estimate: () => Promise<{ quota?: number; usage?: number }> } }).storage?.estimate();
        if (estimate && estimate.quota && estimate.usage) {
          availableStorage = estimate.quota - estimate.usage;
        }
      } catch {
        // Use default
      }
    }

    return {
      webgpu: !!webgpu,
      deviceMemory,
      maxModels: webgpu ? Math.floor(deviceMemory / 4) : 1,
      availableStorage,
    };
  }

  async connectToPeer(peerInfo: PeerInfo): Promise<boolean> {
    try {
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      // Create data channel for model transfer
      const dataChannel = connection.createDataChannel("model-transfer", {
        ordered: true,
      });

      this.setupDataChannel(dataChannel, peerInfo.id);

      // ICE candidate handling
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to peer through signaling
          this.sendIceCandidate(peerInfo.id, event.candidate);
        }
      };

      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "connected") {
          this.peers.set(peerInfo.id, peerInfo);
          this.connections.set(peerInfo.id, connection);
          this.dataChannels.set(peerInfo.id, dataChannel);
        } else if (connection.connectionState === "disconnected" || connection.connectionState === "failed") {
          this.cleanupPeer(peerInfo.id);
        }
      };

      // Create and set local description
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      // Send offer to peer through signaling
      await this.sendOffer(peerInfo.id, offer);

      return true;
    } catch (error) {
      console.error(`Failed to connect to peer ${peerInfo.id}:`, error);
      return false;
    }
  }

  private setupDataChannel(channel: RTCDataChannel, peerId: string): void {
    channel.onopen = () => {
      console.log(`Data channel opened with peer ${peerId}`);
    };

    channel.onmessage = (event) => {
      this.handlePeerMessage(peerId, event.data);
    };

    channel.onerror = (error) => {
      console.error(`Data channel error with peer ${peerId}:`, error);
    };

    channel.onclose = () => {
      console.log(`Data channel closed with peer ${peerId}`);
    };
  }

  private async sendOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // In a real implementation, this would use a signaling server
    // For now, we'll simulate it
    console.log(`Sending offer to ${peerId}:`, offer);
  }

  private sendIceCandidate(peerId: string, candidate: RTCIceCandidate): void {
    // Send ICE candidate through signaling
    console.log(`Sending ICE candidate to ${peerId}:`, candidate);
  }

  private handlePeerMessage(peerId: string, data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      try {
        const message = JSON.parse(data) as DiscoveryMessage;
        this.handleDiscoveryMessage(peerId, message);
      } catch {
        console.error(`Failed to parse message from ${peerId}`);
      }
    } else {
      // Handle binary data (model shards)
      this.handleModelData(peerId, data);
    }
  }

  private handleDiscoveryMessage(peerId: string, message: DiscoveryMessage): void {
    switch (message.type) {
      case "announce":
        // Peer announced themselves
        console.log(`Peer announcement from ${peerId}:`, message.payload);
        break;
      case "query":
        // Peer querying for models
        this.handleModelQuery(peerId, message);
        break;
      case "response":
        // Response to our query
        this.handleModelResponse(peerId, message);
        break;
    }
  }

  private handleModelQuery(peerId: string, message: DiscoveryMessage): void {
    // Respond with available models
    const response: DiscoveryMessage = {
      type: "response",
      peerId: this.localPeerId,
      timestamp: Date.now(),
      payload: this.getHostedModels(),
    };

    const channel = this.dataChannels.get(peerId);
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(response));
    }
  }

  private handleModelResponse(peerId: string, message: DiscoveryMessage): void {
    // Process response about available models from peer
    console.log(`Model response from ${peerId}:`, message.payload);
  }

  private handleModelData(peerId: string, data: ArrayBuffer): void {
    // Handle incoming model shard data
    console.log(`Received model data from ${peerId}:`, data.byteLength, "bytes");
  }

  private getHostedModels(): string[] {
    // Return list of models hosted locally
    // This would interface with the WebLLM engine
    return [];
  }

  private cleanupPeer(peerId: string): void {
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.close();
      this.connections.delete(peerId);
    }

    const channel = this.dataChannels.get(peerId);
    if (channel) {
      channel.close();
      this.dataChannels.delete(peerId);
    }

    this.peers.delete(peerId);
  }

  getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  getPeer(peerId: string): PeerInfo | undefined {
    return this.peers.get(peerId);
  }

  async disconnectFromPeer(peerId: string): Promise<void> {
    this.cleanupPeer(peerId);
  }

  async disconnectAll(): Promise<void> {
    for (const peerId of this.peers.keys()) {
      await this.disconnectFromPeer(peerId);
    }
  }
}

// ---------------------------------------------------------------------------
// Distributed Model Storage and Sharing
// ---------------------------------------------------------------------------

interface ModelDistribution {
  modelId: string;
  shards: Array<{
    shardId: string;
    hostedBy: string[]; // Peer IDs hosting this shard
    checksum: string;
    size: number;
  }>;
  replicationFactor: number; // Number of copies of each shard
}

export class DistributedModelStorage {
  private p2pManager: P2PConnectionManager;
  private modelDistributions = new Map<string, ModelDistribution>();
  private localShards = new Map<string, ModelShard>();
  private host: EdgeHost;

  constructor(p2pManager: P2PConnectionManager, host: EdgeHost) {
    this.p2pManager = p2pManager;
    this.host = host;
  }

  async distributeModel(modelId: string, modelData: ArrayBuffer): Promise<void> {
    // Split model into shards for distributed storage
    const shards = this.createModelShards(modelId, modelData);
    const distribution: ModelDistribution = {
      modelId,
      shards: shards.map((shard) => ({
        shardId: shard.shardId,
        hostedBy: [this.p2pManager["localPeerId"]], // Initially hosted locally
        checksum: shard.checksum,
        size: shard.size,
      })),
      replicationFactor: 3, // Each shard replicated 3 times across network
    };

    this.modelDistributions.set(modelId, distribution);

    // Store shards locally
    for (const shard of shards) {
      this.localShards.set(shard.shardId, shard);
    }

    // Begin distributing to peers
    await this.distributeToPeers(modelId, distribution);
  }

  private createModelShards(modelId: string, modelData: ArrayBuffer): ModelShard[] {
    const shardSize = 10 * 1024 * 1024; // 10MB shards
    const totalShards = Math.ceil(modelData.byteLength / shardSize);
    const shards: ModelShard[] = [];

    for (let i = 0; i < totalShards; i++) {
      const start = i * shardSize;
      const end = Math.min(start + shardSize, modelData.byteLength);
      const shardData = modelData.slice(start, end);

      shards.push({
        shardId: `${modelId}_shard_${i}`,
        modelId,
        shardIndex: i,
        totalShards,
        data: shardData,
        checksum: this.calculateChecksum(shardData),
        size: shardData.byteLength,
      });
    }

    return shards;
  }

  private calculateChecksum(data: ArrayBuffer): string {
    // Simple checksum calculation (in production, use proper cryptographic hash)
    const view = new Uint8Array(data);
    let sum = 0;
    for (let i = 0; i < view.length; i++) {
      sum = (sum + view[i]) % 0xffffffff;
    }
    return sum.toString(16);
  }

  private async distributeToPeers(modelId: string, distribution: ModelDistribution): Promise<void> {
    const peers = this.p2pManager.getConnectedPeers();

    for (const shardInfo of distribution.shards) {
      // Find peers that don't have this shard yet
      const currentHosts = new Set(shardInfo.hostedBy);
      const availablePeers = peers.filter((p) => !currentHosts.has(p.id));

      // Select peers based on capabilities and trust score
      const selectedPeers = this.selectPeersForShard(
        availablePeers,
        distribution.replicationFactor - shardInfo.hostedBy.length
      );

      for (const peer of selectedPeers) {
        await this.transferShardToPeer(shardInfo.shardId, peer.id);
      }
    }
  }

  private selectPeersForShard(peers: PeerInfo[], count: number): PeerInfo[] {
    // Select best peers based on storage, trust score, and capabilities
    const sorted = [...peers].sort((a, b) => {
      const scoreA = a.trustScore * 0.5 + (a.capabilities.availableStorage / (1024 * 1024 * 1024)) * 0.3 + (a.capabilities.webgpu ? 0.2 : 0);
      const scoreB = b.trustScore * 0.5 + (b.capabilities.availableStorage / (1024 * 1024 * 1024)) * 0.3 + (b.capabilities.webgpu ? 0.2 : 0);
      return scoreB - scoreA;
    });

    return sorted.slice(0, count);
  }

  private async transferShardToPeer(shardId: string, peerId: string): Promise<void> {
    const shard = this.localShards.get(shardId);
    if (!shard) {
      console.error(`Shard ${shardId} not found locally`);
      return;
    }

    // Transfer shard data to peer
    // In a real implementation, this would use the P2P data channel
    console.log(`Transferring shard ${shardId} to peer ${peerId}`);
  }

  async retrieveModel(modelId: string): Promise<ArrayBuffer | null> {
    const distribution = this.modelDistributions.get(modelId);
    if (!distribution) {
      console.error(`Model ${modelId} not found in distributed storage`);
      return null;
    }

    // Collect all shards from peers
    const shards: ModelShard[] = [];

    for (const shardInfo of distribution.shards) {
      // Try to get shard from local storage first
      const localShard = this.localShards.get(shardInfo.shardId);
      if (localShard) {
        shards.push(localShard);
        continue;
      }

      // Otherwise, fetch from a peer hosting it
      const shard = await this.fetchShardFromPeer(shardInfo, modelId);
      if (shard) {
        shards.push(shard);
        // Cache locally
        this.localShards.set(shardInfo.shardId, shard);
      } else {
        console.error(`Failed to retrieve shard ${shardInfo.shardId}`);
        return null;
      }
    }

    // Reassemble model from shards
    return this.reassembleModel(shards);
  }

  private async fetchShardFromPeer(
    shardInfo: ModelDistribution["shards"][0],
    modelId: string
  ): Promise<ModelShard | null> {
    // Try each peer hosting the shard
    for (const peerId of shardInfo.hostedBy) {
      try {
        const shard = await this.requestShardFromPeer(peerId, shardInfo.shardId);
        if (shard) {
          // Verify checksum
          if (this.calculateChecksum(shard.data) === shardInfo.checksum) {
            return shard;
          } else {
            console.error(`Checksum mismatch for shard ${shardInfo.shardId} from peer ${peerId}`);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch shard ${shardInfo.shardId} from peer ${peerId}:`, error);
      }
    }

    return null;
  }

  private async requestShardFromPeer(peerId: string, shardId: string): Promise<ModelShard | null> {
    // Request shard from peer via P2P connection
    // In a real implementation, this would send a request and wait for response
    console.log(`Requesting shard ${shardId} from peer ${peerId}`);
    return null;
  }

  private reassembleModel(shards: ModelShard[]): ArrayBuffer {
    // Sort shards by index
    shards.sort((a, b) => a.shardIndex - b.shardIndex);

    // Calculate total size
    const totalSize = shards.reduce((sum, shard) => sum + shard.data.byteLength, 0);

    // Combine all shard data
    const combined = new ArrayBuffer(totalSize);
    const view = new Uint8Array(combined);
    let offset = 0;

    for (const shard of shards) {
      const shardView = new Uint8Array(shard.data);
      view.set(shardView, offset);
      offset += shard.data.byteLength;
    }

    return combined;
  }

  getModelDistribution(modelId: string): ModelDistribution | undefined {
    return this.modelDistributions.get(modelId);
  }

  getLocalShards(): ModelShard[] {
    return Array.from(this.localShards.values());
  }

  async removeModel(modelId: string): Promise<void> {
    const distribution = this.modelDistributions.get(modelId);
    if (!distribution) return;

    // Remove local shards
    for (const shardInfo of distribution.shards) {
      this.localShards.delete(shardInfo.shardId);
    }

    // Notify peers to remove shards
    await this.notifyPeersToRemoveModel(modelId);

    this.modelDistributions.delete(modelId);
  }

  private async notifyPeersToRemoveModel(modelId: string): Promise<void> {
    // Notify all peers to remove their shards of this model
    const peers = this.p2pManager.getConnectedPeers();
    for (const peer of peers) {
      console.log(`Notifying peer ${peer.id} to remove model ${modelId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Collaborative Learning and Knowledge Transfer
// ---------------------------------------------------------------------------

interface KnowledgeGradient {
  modelId: string;
  layerIndex: number;
  gradientData: ArrayBuffer;
  timestamp: number;
  contributionScore: number; // Quality of this gradient
  sourcePeer: string;
}

interface CollaborativeTrainingConfig {
  enabled: boolean;
  aggregationStrategy: "federated_averaging" | "weighted_averaging" | "peer_selection";
  minPeersForAggregation: number;
  qualityThreshold: number;
  privacyPreservation: boolean; // Apply differential privacy
}

export class CollaborativeLearningEngine {
  private p2pManager: P2PConnectionManager;
  private knowledgeGradients = new Map<string, KnowledgeGradient[]>();
  private config: CollaborativeTrainingConfig = {
    enabled: true,
    aggregationStrategy: "federated_averaging",
    minPeersForAggregation: 3,
    qualityThreshold: 0.7,
    privacyPreservation: true,
  };

  constructor(p2pManager: P2PConnectionManager) {
    this.p2pManager = p2pManager;
  }

  setConfig(config: Partial<CollaborativeTrainingConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async contributeGradient(
    modelId: string,
    layerIndex: number,
    gradientData: ArrayBuffer,
    qualityScore: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    if (qualityScore < this.config.qualityThreshold) {
      console.log(`Gradient quality ${qualityScore} below threshold ${this.config.qualityThreshold}, skipping`);
      return;
    }

    // Apply privacy preservation if enabled
    const processedGradient = this.config.privacyPreservation
      ? this.applyDifferentialPrivacy(gradientData)
      : gradientData;

    const gradient: KnowledgeGradient = {
      modelId,
      layerIndex,
      gradientData: processedGradient,
      timestamp: Date.now(),
      contributionScore: qualityScore,
      sourcePeer: this.p2pManager["localPeerId"],
    };

    // Store locally
    if (!this.knowledgeGradients.has(modelId)) {
      this.knowledgeGradients.set(modelId, []);
    }
    this.knowledgeGradients.get(modelId)!.push(gradient);

    // Share with peers
    await this.shareGradientWithPeers(gradient);
  }

  private applyDifferentialPrivacy(gradientData: ArrayBuffer): ArrayBuffer {
    // Add noise to gradient for differential privacy
    const view = new Float32Array(gradientData);
    const noisyView = new Float32Array(view.length);

    const noiseScale = 0.01; // Privacy parameter
    for (let i = 0; i < view.length; i++) {
      const noise = (Math.random() - 0.5) * 2 * noiseScale;
      noisyView[i] = view[i] + noise;
    }

    return noisyView.buffer;
  }

  private async shareGradientWithPeers(gradient: KnowledgeGradient): Promise<void> {
    const peers = this.p2pManager.getConnectedPeers();

    for (const peer of peers) {
      // Share gradient with peer
      console.log(`Sharing gradient for model ${gradient.modelId} with peer ${peer.id}`);
    }
  }

  async aggregateGradients(modelId: string): Promise<ArrayBuffer | null> {
    const gradients = this.knowledgeGradients.get(modelId);
    if (!gradients || gradients.length < this.config.minPeersForAggregation) {
      console.log(`Not enough gradients for aggregation (need ${this.config.minPeersForAggregation}, have ${gradients?.length || 0})`);
      return null;
    }

    switch (this.config.aggregationStrategy) {
      case "federated_averaging":
        return this.federatedAveraging(gradients);
      case "weighted_averaging":
        return this.weightedAveraging(gradients);
      case "peer_selection":
        return this.peerSelectionAggregation(gradients);
      default:
        return this.federatedAveraging(gradients);
    }
  }

  private federatedAveraging(gradients: KnowledgeGradient[]): ArrayBuffer {
    // Simple average of all gradients
    const firstGradient = gradients[0];
    const view = new Float32Array(firstGradient.gradientData);
    const averaged = new Float32Array(view.length);

    for (const gradient of gradients) {
      const gradView = new Float32Array(gradient.gradientData);
      for (let i = 0; i < view.length; i++) {
        averaged[i] += gradView[i];
      }
    }

    for (let i = 0; i < averaged.length; i++) {
      averaged[i] /= gradients.length;
    }

    return averaged.buffer;
  }

  private weightedAveraging(gradients: KnowledgeGradient[]): ArrayBuffer {
    // Weighted average based on contribution scores
    const firstGradient = gradients[0];
    const view = new Float32Array(firstGradient.gradientData);
    const averaged = new Float32Array(view.length);

    const totalWeight = gradients.reduce((sum, g) => sum + g.contributionScore, 0);

    for (const gradient of gradients) {
      const gradView = new Float32Array(gradient.gradientData);
      const weight = gradient.contributionScore / totalWeight;

      for (let i = 0; i < view.length; i++) {
        averaged[i] += gradView[i] * weight;
      }
    }

    return averaged.buffer;
  }

  private peerSelectionAggregation(gradients: KnowledgeGradient[]): ArrayBuffer {
    // Select top-quality gradients and average them
    const sorted = [...gradients].sort((a, b) => b.contributionScore - a.contributionScore);
    const topGradients = sorted.slice(0, Math.max(3, Math.floor(sorted.length / 2)));

    return this.federatedAveraging(topGradients);
  }

  async receiveGradientFromPeer(peerId: string, gradient: KnowledgeGradient): Promise<void> {
    if (!this.config.enabled) return;

    // Validate gradient
    if (gradient.contributionScore < this.config.qualityThreshold) {
      console.log(`Received low-quality gradient from peer ${peerId}`);
      return;
    }

    // Store gradient
    if (!this.knowledgeGradients.has(gradient.modelId)) {
      this.knowledgeGradients.set(gradient.modelId, []);
    }
    this.knowledgeGradients.get(gradient.modelId)!.push(gradient);

    console.log(`Received gradient for model ${gradient.modelId} from peer ${peerId}`);
  }

  getGradientsForModel(modelId: string): KnowledgeGradient[] {
    return this.knowledgeGradients.get(modelId) || [];
  }

  clearGradientsForModel(modelId: string): void {
    this.knowledgeGradients.delete(modelId);
  }

  clearAllGradients(): void {
    this.knowledgeGradients.clear();
  }
}

// ---------------------------------------------------------------------------
// Trust and Reputation System
// ---------------------------------------------------------------------------

interface PeerReputation {
  peerId: string;
  trustScore: number; // 0-1
  successfulInteractions: number;
  failedInteractions: number;
  lastInteraction: number;
  contributions: Array<{
    type: "model_shard" | "gradient" | "validation";
    timestamp: number;
    quality: number;
  }>;
}

export class TrustManager {
  private reputations = new Map<string, PeerReputation>();
  private p2pManager: P2PConnectionManager;

  constructor(p2pManager: P2PConnectionManager) {
    this.p2pManager = p2pManager;
  }

  recordInteraction(
    peerId: string,
    success: boolean,
    contributionType: "model_shard" | "gradient" | "validation",
    quality: number
  ): void {
    let reputation = this.reputations.get(peerId);

    if (!reputation) {
      reputation = {
        peerId,
        trustScore: 0.5, // Start with neutral trust
        successfulInteractions: 0,
        failedInteractions: 0,
        lastInteraction: Date.now(),
        contributions: [],
      };
      this.reputations.set(peerId, reputation);
    }

    if (success) {
      reputation.successfulInteractions++;
      reputation.trustScore = Math.min(1, reputation.trustScore + 0.05);
    } else {
      reputation.failedInteractions++;
      reputation.trustScore = Math.max(0, reputation.trustScore - 0.1);
    }

    reputation.lastInteraction = Date.now();
    reputation.contributions.push({
      type: contributionType,
      timestamp: Date.now(),
      quality,
    });

    // Keep only recent contributions
    const cutoff = Date.now() - COLLABORATIVE_METRICS_WINDOW_MS;
    reputation.contributions = reputation.contributions.filter((c) => c.timestamp > cutoff);
  }

  getTrustScore(peerId: string): number {
    const reputation = this.reputations.get(peerId);
    return reputation?.trustScore || 0.5;
  }

  getPeerReputation(peerId: string): PeerReputation | undefined {
    return this.reputations.get(peerId);
  }

  getAllReputations(): PeerReputation[] {
    return Array.from(this.reputations.values());
  }

  getTrustedPeers(threshold: number = 0.7): string[] {
    return Array.from(this.reputations.entries())
      .filter(([_, rep]) => rep.trustScore >= threshold)
      .map(([peerId, _]) => peerId);
  }

  decayTrustScores(): void {
    // Gradually decay trust scores over time to encourage continued good behavior
    const decayFactor = 0.99;

    for (const reputation of this.reputations.values()) {
      const hoursSinceLastInteraction = (Date.now() - reputation.lastInteraction) / (1000 * 60 * 60);
      const decay = Math.pow(decayFactor, hoursSinceLastInteraction);

      reputation.trustScore = Math.max(0.3, reputation.trustScore * decay);
    }
  }
}

// ---------------------------------------------------------------------------
// Revolutionary Collaborative WebLLM Factory
// ---------------------------------------------------------------------------

export interface CollaborativeConfig {
  enableP2PDiscovery: boolean;
  enableModelSharing: boolean;
  enableCollaborativeLearning: boolean;
  replicationFactor: number;
  minPeersForAggregation: number;
  privacyPreservation: boolean;
}

export function createCollaborativeWebLlmSystem(
  host: EdgeHost,
  config: CollaborativeConfig = {
    enableP2PDiscovery: true,
    enableModelSharing: true,
    enableCollaborativeLearning: true,
    replicationFactor: 3,
    minPeersForAggregation: 3,
    privacyPreservation: true,
  }
) {
  const p2pManager = new P2PConnectionManager(host);
  const distributedStorage = new DistributedModelStorage(p2pManager, host);
  const collaborativeLearning = new CollaborativeLearningEngine(p2pManager);
  const trustManager = new TrustManager(p2pManager);

  // Configure collaborative learning
  collaborativeLearning.setConfig({
    enabled: config.enableCollaborativeLearning,
    minPeersForAggregation: config.minPeersForAggregation,
    privacyPreservation: config.privacyPreservation,
  });

  return {
    p2pManager,
    distributedStorage,
    collaborativeLearning,
    trustManager,
    config,

    // High-level API
    async start() {
      if (config.enableP2PDiscovery) {
        await p2pManager.startDiscovery();
      }
    },

    async stop() {
      p2pManager.stopDiscovery();
      await p2pManager.disconnectAll();
    },

    getNetworkStatus() {
      return {
        connectedPeers: p2pManager.getConnectedPeers().length,
        hostedModels: distributedStorage.getLocalShards().length,
        trustedPeers: trustManager.getTrustedPeers().length,
        activeGradients: collaborativeLearning.getGradientsForModel("*").length,
      };
    },
  };
}
