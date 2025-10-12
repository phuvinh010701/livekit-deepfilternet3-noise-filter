export interface AssetConfig {
  cdnUrl?: string;
  version?: string;
}

export interface AssetUrls {
  wasm: string;
  model: string;
}

export class AssetLoader {
  private readonly packageName = 'deepfilternet3-workers';
  private readonly version: string;
  private readonly cdnUrl: string;

  constructor(config: AssetConfig = {}) {
    this.cdnUrl = config.cdnUrl ?? 'https://cdn.jsdelivr.net/npm';
    this.version = config.version ?? 'latest';
  }

  private getCdnUrl(relativePath: string): string {
    return `${this.cdnUrl}/${this.packageName}@${this.version}/dist/${relativePath}`;
  }

  getAssetUrls(): AssetUrls {
    return {
      wasm: this.getCdnUrl('pkg/df_bg.wasm'),
      model: this.getCdnUrl('models/DeepFilterNet3_onnx.tar.gz')
    };
  }

  async fetchAsset(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset: ${response.statusText}`);
    }
    return response.arrayBuffer();
  }
}

let defaultLoader: AssetLoader | null = null;

export function getAssetLoader(config?: AssetConfig): AssetLoader {
  if (!defaultLoader || config) {
    defaultLoader = new AssetLoader(config);
  }
  return defaultLoader;
}
