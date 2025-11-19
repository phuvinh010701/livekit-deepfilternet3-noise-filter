export interface ProcessorOptions {
  wasmModule: WebAssembly.Module;
  modelBytes: ArrayBuffer;
  suppressionLevel: number;
}

export interface DeepFilterModel {
  handle: number;
  frameLength: number;
}
