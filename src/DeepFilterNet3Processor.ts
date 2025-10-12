import { WorkerManager } from './manager/WorkerManager';
import { WorkerMessageTypes } from './worker/WorkerMessageTypes';

export interface DeepFilterNet3ProcessorConfig {
  sampleRate?: number;
  noiseReductionLevel?: number;
}

export class DeepFilterNet3Processor {
  private workerManager: WorkerManager | null = null;

  private rawSab: SharedArrayBuffer | null = null;
  private denoisedSab: SharedArrayBuffer | null = null;
  private isInitialized = false;
  private bypassEnabled = false;

  constructor(config: DeepFilterNet3ProcessorConfig = {}) {
    const { sampleRate = 48000, noiseReductionLevel = 50 } = config;

    const bufferSize = sampleRate * 2 * 4;
    this.rawSab = new SharedArrayBuffer(bufferSize);
    this.denoisedSab = new SharedArrayBuffer(bufferSize);

    this.workerManager = new WorkerManager({
      name: 'DF3Worker',
      type: 'classic',
      suppressionLevel: noiseReductionLevel,
      sampleRate,
      rawSab: this.rawSab,
      denoisedSab: this.denoisedSab
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!this.workerManager) {
      throw new Error('WorkerManager not initialized');
    }

    await WorkerManager.getSharedAssets();
    await this.workerManager.createWorkerFromBlob();
    this.isInitialized = true;
  }

  async createAudioWorkletNode(audioContext: AudioContext): Promise<AudioWorkletNode> {
    this.ensureInitialized();

    const workletUrl = new URL('./DeepFilterWorklet.js', import.meta.url);
    await audioContext.audioWorklet.addModule(workletUrl);

    return this.createWorkletNode(audioContext);
  }

  setSuppressionLevel(level: number): void {
    const worker = WorkerManager.getSharedWorker();
    if (!worker || typeof level !== 'number' || isNaN(level)) return;

    const clampedLevel = Math.max(0, Math.min(100, Math.floor(level)));
    worker.postMessage({
      command: WorkerMessageTypes.SET_SUPPRESSION_LEVEL,
      level: clampedLevel
    });
  }

  destroy(): void {
    if (!this.isInitialized) return;

    WorkerManager.clearSharedWorker();
    WorkerManager.cleanupAssets();
    this.workerManager = null;
    this.rawSab = null;
    this.denoisedSab = null;
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized && WorkerManager.isWorkerReady();
  }

  setNoiseSuppressionEnabled(enabled: boolean): void {
    const worker = WorkerManager.getSharedWorker();
    if (!worker) return;

    this.bypassEnabled = !enabled;

    worker.postMessage({
      command: WorkerMessageTypes.SET_BYPASS,
      bypass: !enabled
    });
  }

  isNoiseSuppressionEnabled(): boolean {
    return !this.bypassEnabled;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Processor not initialized. Call initialize() first.');
    }
  }

  private createWorkletNode(audioContext: AudioContext): AudioWorkletNode {
    return new AudioWorkletNode(audioContext, 'deepfilter-audio-processor', {
      processorOptions: {
        rawSab: this.rawSab,
        denoisedSab: this.denoisedSab
      }
    });
  }
}
