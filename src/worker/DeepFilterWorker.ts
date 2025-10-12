import * as wasm_bindgen from '../df3/df';
import * as ringbuffer from './RingBuffer';
import { WorkerMessageTypes } from './WorkerMessageTypes';
import type { DeepFilterModel } from './WorkerTypes';

declare const self: WorkerGlobalScope & typeof globalThis;
export {};

let frame_length: number;
let df_model: DeepFilterModel | null = null;
let _audio_reader: ringbuffer.AudioReader | null = null;
let _audio_writer: ringbuffer.AudioWriter | null = null;
let rawStorage: Float32Array;
let interval: number | null = null;
let bypass = false;
const suppression_level = 50;

async function readFromQueue(): Promise<number> {
  if (!_audio_reader || !_audio_writer || !df_model) return 0;

  if (_audio_reader.availableRead() < frame_length) {
    return 0;
  }

  const samples_read = _audio_reader.dequeue(rawStorage);
  const input_frame = rawStorage.subarray(0, samples_read);

  const output_frame = bypass
    ? input_frame
    : wasm_bindgen.df_process_frame(df_model, input_frame);

  _audio_writer.enqueue(output_frame);

  return samples_read;
}


self.onmessage = async (e: MessageEvent): Promise<void> => {
  switch (e.data.command) {
    case WorkerMessageTypes.INIT: {
      _audio_reader = new ringbuffer.AudioReader(
        new ringbuffer.RingBuffer(e.data.rawSab, Float32Array)
      );

      _audio_writer = new ringbuffer.AudioWriter(
        new ringbuffer.RingBuffer(e.data.denoisedSab, Float32Array)
      );

      try {
        wasm_bindgen.initSync(e.data.bytes);

        const uint8Array = new Uint8Array(e.data.model_bytes);
        df_model = wasm_bindgen.df_create(uint8Array, e.data.suppression_level ?? suppression_level);

        frame_length = wasm_bindgen.df_get_frame_length(df_model);
        rawStorage = new Float32Array(frame_length);

        interval = setInterval(() => void readFromQueue(), 0) as unknown as number;
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
      if (df_model && typeof newLevel === 'number' && newLevel >= 0 && newLevel <= 100) {
        wasm_bindgen.df_set_atten_lim(df_model, newLevel);
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
