import { AssetLoader, AssetConfig, AssetUrls, getAssetLoader } from '../asset-loader/AssetLoader';
import { WorkerMessageTypes } from '../worker/WorkerMessageTypes';

export interface WorkerConfig {
  name?: string;
  type?: 'classic' | 'module';
  assetConfig?: AssetConfig;
  suppressionLevel?: number;
  sampleRate: number;
  rawSab: SharedArrayBuffer;
  denoisedSab: SharedArrayBuffer;
}

interface WorkerAssets {
  wasmBytes: ArrayBuffer;
  modelBytes: ArrayBuffer;
  assetUrls: AssetUrls;
}

export class WorkerManager {
  private static worker: Worker | null = null;
  private static assets: WorkerAssets | null = null;

  private static workerReadyPromise: Promise<void> | null = null;
  private static workerReadyResolve: (() => void) | null = null;


  private readonly config: WorkerConfig;
  private readonly assetLoader: AssetLoader;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.assetLoader = getAssetLoader(config.assetConfig);
  }

  static async getSharedAssets(): Promise<WorkerAssets> {
    if (WorkerManager.assets) return WorkerManager.assets;

    const loader = getAssetLoader();
    const assetUrls = loader.getAssetUrls();

    const [wasmBytes, modelBytes] = await Promise.all([
      loader.fetchAsset(assetUrls.wasm),
      loader.fetchAsset(assetUrls.model)
    ]);

    WorkerManager.assets = { wasmBytes, modelBytes, assetUrls };
    return WorkerManager.assets;
  }


  async createWorkerFromBlob(): Promise<Worker> {
    if (WorkerManager.worker) {
      WorkerManager.worker.terminate();
    }

    WorkerManager.workerReadyPromise = new Promise((resolve) => {
      WorkerManager.workerReadyResolve = resolve;
    });

    const worker = new Worker(new URL('./DeepFilterWorker.js', import.meta.url), {
      type: this.config.type,
      name: this.config.name
    });

    worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event);

    WorkerManager.worker = worker;
    return worker;
  }

  private handleWorkerMessage(event: MessageEvent): void {
    if (event.data.type === WorkerMessageTypes.FETCH_WASM) {
      void this.sendAssetsToWorker();
    }
    else if (event.data.type === WorkerMessageTypes.SETUP_AWP) {
      WorkerManager.workerReadyResolve?.();
      WorkerManager.workerReadyResolve = null;
    }
  }

  private async sendAssetsToWorker(): Promise<void> {
    if (!WorkerManager.worker) return;

    const assets = await WorkerManager.getSharedAssets();

    WorkerManager.worker.postMessage({
      command: WorkerMessageTypes.INIT,
      bytes: assets.wasmBytes,
      model_bytes: assets.modelBytes,
      rawSab: this.config.rawSab,
      denoisedSab: this.config.denoisedSab,
      suppression_level: this.config.suppressionLevel
    });
  }

  static getSharedWorker(): Worker | null {
    return WorkerManager.worker;
  }

  static isWorkerReady(): boolean {
    return WorkerManager.worker !== null;
  }

  static async waitForWorkerReady(): Promise<void> {
    if (WorkerManager.workerReadyPromise) {
      await WorkerManager.workerReadyPromise;
    }
  }

  static clearSharedWorker(): void {
    WorkerManager.worker?.terminate();
    WorkerManager.worker = null;
  }

  static cleanupAssets(): void {
    WorkerManager.assets = null;
  }
}
