import { DeepFilterNet3Processor } from './DeepFilterNet3Processor';
import type { TrackProcessor, AudioProcessorOptions, Track } from 'livekit-client';
import { WorkerManager } from './manager/WorkerManager';

/** Default sample rate for audio processing */
const DEFAULT_SAMPLE_RATE = 48000;

/** Default noise reduction level for LiveKit processor */
const DEFAULT_NOISE_REDUCTION_LEVEL = 80;

export interface DeepFilterNoiseFilterOptions {
  sampleRate?: number;
  noiseReductionLevel?: number;
  enabled?: boolean;
}

export class DeepFilterNoiseFilterProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'deepfilternet3-noise-filter';
  processedTrack?: MediaStreamTrack;
  audioContext: AudioContext | null = null;
  sourceNode: MediaStreamAudioSourceNode | null = null;
  workletNode: AudioWorkletNode | null = null;
  destination: MediaStreamAudioDestinationNode | null = null;
  processor: DeepFilterNet3Processor;
  enabled = true;
  originalTrack?: MediaStreamTrack;

  constructor(options: DeepFilterNoiseFilterOptions = {}) {
    const cfg = {
      sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
      noiseReductionLevel: options.noiseReductionLevel ?? DEFAULT_NOISE_REDUCTION_LEVEL
    };

    this.enabled = options.enabled ?? true;
    this.processor = new DeepFilterNet3Processor(cfg);
  }

  static isSupported(): boolean {
    return typeof AudioContext !== 'undefined' && typeof SharedArrayBuffer !== 'undefined';
  }

  init = async (opts: { track?: MediaStreamTrack; mediaStreamTrack?: MediaStreamTrack }): Promise<void> => {
    const track = opts.track ?? opts.mediaStreamTrack;
    if (!track) {
      throw new Error('DeepFilterNoiseFilterProcessor.init: missing MediaStreamTrack');
    }
    this.originalTrack = track;
    await this.ensureGraph();
  };

  restart = async (): Promise<void> => {
    await this.teardownGraph();
    await this.ensureGraph();
  };

  setEnabled = async (enable: boolean): Promise<boolean> => {
    this.enabled = enable;
    this.processor.setNoiseSuppressionEnabled(enable);
    return this.enabled;
  };

  setSuppressionLevel(level: number): void {
    this.processor.setSuppressionLevel(level);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isNoiseSuppressionEnabled(): boolean {
    return this.processor.isNoiseSuppressionEnabled();
  }

  destroy = async (): Promise<void> => {
    await this.teardownGraph();
    this.processor.destroy();
  };

  private async ensureGraph(): Promise<void> {
    if (!this.originalTrack) {
      throw new Error('No source track');
    }

    this.audioContext ??= new AudioContext({ sampleRate: DEFAULT_SAMPLE_RATE });

    if (this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch (error) {
        console.warn('Failed to resume AudioContext:', error instanceof Error ? error.message : String(error));
      }
    }

    await this.processor.initialize();
    await WorkerManager.waitForWorkerReady();
    const node = await this.processor.createAudioWorkletNode(this.audioContext);

    this.sourceNode = this.audioContext.createMediaStreamSource(new MediaStream([this.originalTrack]));
    this.destination = this.audioContext.createMediaStreamDestination();

    this.sourceNode.connect(node).connect(this.destination);
    this.workletNode = node;
    this.processedTrack = this.destination.stream.getAudioTracks()[0];

    await this.setEnabled(this.enabled);
  }

  private async teardownGraph(): Promise<void> {
    try {
      if (this.workletNode) {
        this.workletNode.disconnect();
        this.workletNode = null;
      }
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      if (this.destination) {
        this.destination.disconnect();
        this.destination = null;
      }
    } catch (error) {
      console.warn('Error during audio graph teardown:', error instanceof Error ? error.message : String(error));
    }
  }
}

export function DeepFilterNoiseFilter(options?: DeepFilterNoiseFilterOptions): DeepFilterNoiseFilterProcessor {
  return new DeepFilterNoiseFilterProcessor(options);
}
