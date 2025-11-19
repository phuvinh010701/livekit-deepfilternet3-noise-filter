/**
 * Creates a worklet module URL from inline code string
 * This approach works with all bundlers without special configuration
 */
export async function createWorkletModule(audioContext: AudioContext, workletCode: string): Promise<void> {
  const blob = new Blob([workletCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  await audioContext.audioWorklet.addModule(blobUrl);
}
