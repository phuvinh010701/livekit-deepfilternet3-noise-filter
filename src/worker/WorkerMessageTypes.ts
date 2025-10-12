export const WorkerMessageTypes = {
  INIT: 'INIT',
  SET_SUPPRESSION_LEVEL: 'SET_SUPPRESSION_LEVEL',
  STOP: 'STOP',
  SET_BYPASS: 'SET_BYPASS',
  FETCH_WASM: 'FETCH_WASM',
  SETUP_AWP: 'SETUP_AWP',
  ERROR: 'ERROR'
} as const;

export type WorkerMessageType = typeof WorkerMessageTypes[keyof typeof WorkerMessageTypes];
