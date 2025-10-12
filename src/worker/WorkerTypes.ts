import type * as RingBuffer from './RingBuffer';
import { WorkerMessageTypes } from './WorkerMessageTypes';

export type DeepFilterModel = number;

export interface WorkerState {
  frameLength: number;
  model: DeepFilterModel;
  audioReader: RingBuffer.AudioReader;
  audioWriter: RingBuffer.AudioWriter;
  rawStorage: Float32Array;
  interval: number;
  bypass: boolean;
  suppressionLevel: number;
}

export interface InitMessage {
  command: typeof WorkerMessageTypes.INIT;
  rawSab: SharedArrayBuffer;
  denoisedSab: SharedArrayBuffer;
  bytes: ArrayBuffer;
  model_bytes: ArrayBuffer;
  suppression_level?: number;
}

export interface SetSuppressionLevelMessage {
  command: typeof WorkerMessageTypes.SET_SUPPRESSION_LEVEL;
  level: number;
}

export interface StopMessage {
  command: typeof WorkerMessageTypes.STOP;
}

export interface SetBypassMessage {
  command: typeof WorkerMessageTypes.SET_BYPASS;
  bypass: boolean;
}

export type WorkerMessage =
  | InitMessage
  | SetSuppressionLevelMessage
  | StopMessage
  | SetBypassMessage;
