/**
 * Creates a Worker from inline code string using Blob URL
 * This approach works with all bundlers (Webpack, Rollup, Vite, etc.)
 * without requiring special configuration
 */
export function createWorkerFromString(workerCode: string, options?: WorkerOptions): Worker {
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  return new Worker(blobUrl, options);
}

/**
 * Creates a worklet module URL from inline code string
 * This approach works with all bundlers without special configuration
 */
export async function createWorkletModule(audioContext: AudioContext, workletCode: string): Promise<void> {
  const blob = new Blob([workletCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  await audioContext.audioWorklet.addModule(blobUrl);
}
