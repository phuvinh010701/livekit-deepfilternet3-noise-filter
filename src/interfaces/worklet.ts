export interface ProcessorOptions {
  wasmModule: WebAssembly.Module;
  modelBytes: ArrayBuffer;
  suppressionLevel: number;
  dynamicSuppression?: boolean;
}

export interface DeepFilterModel {
  handle: number;
  frameLength: number;
}
