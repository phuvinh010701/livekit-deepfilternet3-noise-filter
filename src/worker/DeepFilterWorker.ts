import * as wasm_bindgen from '../df3/df';
import * as ringbuffer from './RingBuffer';
import { WorkerMessageTypes } from './WorkerMessageTypes';
import type { DeepFilterModel } from './WorkerTypes';

declare const self: WorkerGlobalScope & typeof globalThis;
export {};

/** Default suppression level if not provided */
const DEFAULT_SUPPRESSION_LEVEL = 50;

let frameLength: number;
let dfModel: DeepFilterModel | null = null;
let audioReader: ringbuffer.AudioReader | null = null;
let audioWriter: ringbuffer.AudioWriter | null = null;
let rawStorage: Float32Array;
let interval: number | null = null;
let bypass = false;

function readFromQueue(): number {
  if (!audioReader || !audioWriter || !dfModel) return 0;

  if (audioReader.availableRead() < frameLength) {
    return 0;
  }

  const samplesRead = audioReader.dequeue(rawStorage);
  const inputFrame = rawStorage.subarray(0, samplesRead);

  const outputFrame = bypass
    ? inputFrame
    : wasm_bindgen.df_process_frame(dfModel, inputFrame);

  audioWriter.enqueue(outputFrame);

  return samplesRead;
}


self.onmessage = async (e: MessageEvent): Promise<void> => {
  switch (e.data.command) {
    case WorkerMessageTypes.INIT: {
      audioReader = new ringbuffer.AudioReader(
        new ringbuffer.RingBuffer(e.data.rawSab, Float32Array)
      );

      audioWriter = new ringbuffer.AudioWriter(
        new ringbuffer.RingBuffer(e.data.denoisedSab, Float32Array)
      );

      try {
        wasm_bindgen.initSync(e.data.bytes);

        const uint8Array = new Uint8Array(e.data.model_bytes);
        dfModel = wasm_bindgen.df_create(uint8Array, e.data.suppression_level ?? DEFAULT_SUPPRESSION_LEVEL);

        frameLength = wasm_bindgen.df_get_frame_length(dfModel);
        rawStorage = new Float32Array(frameLength);

        interval = setInterval(readFromQueue, 0) as unknown as number;
        self.postMessage({ type: WorkerMessageTypes.SETUP_AWP });
      } catch (error) {
        self.postMessage({
          type: WorkerMessageTypes.ERROR,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      break;
    }
    case WorkerMessageTypes.SET_SUPPRESSION_LEVEL: {
      const newLevel = e.data.level;
      if (dfModel && typeof newLevel === 'number' && newLevel >= 0 && newLevel <= 100) {
        wasm_bindgen.df_set_atten_lim(dfModel, newLevel);
      }
      break;
    }
    case WorkerMessageTypes.STOP: {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      break;
    }
    case WorkerMessageTypes.SET_BYPASS: {
      bypass = e.data.bypass;
      break;
    }
    default:
      throw new Error('Unhandled message type');
  }
};

self.postMessage({ type: WorkerMessageTypes.FETCH_WASM });
