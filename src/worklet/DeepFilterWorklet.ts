import * as wasm_bindgen from '../df3/df';
import { WorkletMessageTypes } from '../constants';
import type { ProcessorOptions, DeepFilterModel } from '../interfaces';

class DeepFilterAudioProcessor extends AudioWorkletProcessor {
  private dfModel: DeepFilterModel | null = null;
  private inputBuffer: Float32Array;
  private outputBuffer: Float32Array;
  private inputWritePos = 0;
  private inputReadPos = 0;
  private outputWritePos = 0;
  private outputReadPos = 0;
  private bypass = false;
  private isInitialized = false;
  private bufferSize: number;
  private tempFrame: Float32Array | null = null;

  // Dynamic suppression parameters
  private dynamicSuppressionEnabled = false;
  private manualSuppressionLevel = 50;
  private currentSuppressionLevel = 50;

  // Audio analysis state
  private energyHistory: number[] = [];
  private zcRateHistory: number[] = [];
  private historySize = 20; // Keep last 20 frames for analysis
  private smoothingFactor = 0.3; // For exponential smoothing

  // Thresholds for dynamic adjustment
  private readonly speechEnergyThreshold = 0.01; // RMS threshold for speech detection
  private readonly silenceEnergyThreshold = 0.001; // RMS threshold for silence
  private readonly speechZcrMin = 0.05; // Minimum ZCR for speech
  private readonly speechZcrMax = 0.35; // Maximum ZCR for speech

  constructor(options: AudioWorkletNodeOptions & { processorOptions: ProcessorOptions }) {
    super();

    this.bufferSize = 8192;
    this.inputBuffer = new Float32Array(this.bufferSize);
    this.outputBuffer = new Float32Array(this.bufferSize);

    try {
      // Initialize WASM from pre-compiled module
      wasm_bindgen.initSync(options.processorOptions.wasmModule);

      const modelBytes = new Uint8Array(options.processorOptions.modelBytes);
      const initialLevel = options.processorOptions.suppressionLevel ?? 50;
      const handle = wasm_bindgen.df_create(modelBytes, initialLevel);

      const frameLength = wasm_bindgen.df_get_frame_length(handle);

      this.dfModel = { handle, frameLength };

      this.bufferSize = frameLength * 4;
      this.inputBuffer = new Float32Array(this.bufferSize);
      this.outputBuffer = new Float32Array(this.bufferSize);

      // Pre-allocate temp frame buffer for processing
      this.tempFrame = new Float32Array(frameLength);

      // Initialize dynamic suppression
      this.manualSuppressionLevel = initialLevel;
      this.currentSuppressionLevel = initialLevel;
      this.dynamicSuppressionEnabled = options.processorOptions.dynamicSuppression ?? false;

      this.isInitialized = true;

      this.port.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };
    } catch (error) {
      console.error('Failed to initialize DeepFilter in AudioWorklet:', error);
      this.isInitialized = false;
    }
  }

  private handleMessage(data: { type: string; value?: number | boolean }): void {
    switch (data.type) {
      case WorkletMessageTypes.SET_SUPPRESSION_LEVEL:
        if (this.dfModel && typeof data.value === 'number') {
          const level = Math.max(0, Math.min(100, Math.floor(data.value)));
          this.manualSuppressionLevel = level;
          if (!this.dynamicSuppressionEnabled) {
            this.currentSuppressionLevel = level;
            wasm_bindgen.df_set_atten_lim(this.dfModel.handle, level);
          }
        }
        break;
      case WorkletMessageTypes.SET_BYPASS:
        this.bypass = Boolean(data.value);
        break;
      case WorkletMessageTypes.SET_DYNAMIC_SUPPRESSION:
        this.dynamicSuppressionEnabled = Boolean(data.value);
        if (!this.dynamicSuppressionEnabled && this.dfModel) {
          // When disabling dynamic mode, revert to manual level
          this.currentSuppressionLevel = this.manualSuppressionLevel;
          wasm_bindgen.df_set_atten_lim(this.dfModel.handle, this.manualSuppressionLevel);
        }
        break;
    }
  }

  private getInputAvailable(): number {
    return (this.inputWritePos - this.inputReadPos + this.bufferSize) % this.bufferSize;
  }

  private getOutputAvailable(): number {
    return (this.outputWritePos - this.outputReadPos + this.bufferSize) % this.bufferSize;
  }

  /**
   * Calculate RMS (Root Mean Square) energy of audio frame
   */
  private calculateRMS(frame: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i];
    }
    return Math.sqrt(sum / frame.length);
  }

  /**
   * Calculate Zero-Crossing Rate (ZCR) of audio frame
   * ZCR helps distinguish between voiced speech, unvoiced speech, and noise
   */
  private calculateZCR(frame: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) {
        crossings++;
      }
    }
    return crossings / frame.length;
  }

  /**
   * Calculate spectral centroid (simplified version)
   * Higher values indicate brighter sound (more high-frequency content)
   */
  private calculateSpectralCentroid(frame: Float32Array): number {
    let weightedSum = 0;
    let magnitudeSum = 0;

    for (let i = 0; i < frame.length; i++) {
      const magnitude = Math.abs(frame[i]);
      weightedSum += i * magnitude;
      magnitudeSum += magnitude;
    }

    return magnitudeSum > 0 ? weightedSum / magnitudeSum : 0;
  }

  /**
   * Determine optimal suppression level based on audio characteristics
   */
  private calculateDynamicSuppressionLevel(frame: Float32Array): number {
    const rms = this.calculateRMS(frame);
    const zcr = this.calculateZCR(frame);
    const centroid = this.calculateSpectralCentroid(frame);

    // Update history
    this.energyHistory.push(rms);
    this.zcRateHistory.push(zcr);

    if (this.energyHistory.length > this.historySize) {
      this.energyHistory.shift();
      this.zcRateHistory.shift();
    }

    // Calculate average energy over recent history
    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const avgZCR = this.zcRateHistory.reduce((a, b) => a + b, 0) / this.zcRateHistory.length;

    // Normalize centroid to 0-1 range (approximate)
    const normalizedCentroid = Math.min(1, centroid / (frame.length / 2));

    let targetLevel: number;

    // Decision logic based on audio characteristics
    if (rms < this.silenceEnergyThreshold) {
      // Very low energy - likely silence or background noise
      // Use high suppression to remove noise
      targetLevel = 85;
    } else if (rms > this.speechEnergyThreshold &&
               avgZCR > this.speechZcrMin &&
               avgZCR < this.speechZcrMax) {
      // Energy + ZCR characteristics suggest active speech
      // Use moderate suppression to preserve voice quality

      // Adjust based on energy level and spectral content
      const energyFactor = Math.min(1, rms / 0.1); // Normalize to typical speech energy
      const spectralFactor = normalizedCentroid;

      // Higher energy and richer spectral content = lower suppression
      targetLevel = 60 - (energyFactor * 20) - (spectralFactor * 10);
      targetLevel = Math.max(30, Math.min(60, targetLevel));
    } else if (rms > this.speechEnergyThreshold && avgZCR > this.speechZcrMax) {
      // High ZCR suggests unvoiced speech or fricatives
      // Use lower suppression to preserve these sounds
      targetLevel = 45;
    } else if (rms > this.silenceEnergyThreshold && rms < this.speechEnergyThreshold) {
      // Medium energy - could be quiet speech or noise
      // Use moderate-high suppression
      targetLevel = 70 - (avgEnergy / this.speechEnergyThreshold * 20);
    } else {
      // Default moderate suppression
      targetLevel = this.manualSuppressionLevel;
    }

    // Apply exponential smoothing to prevent abrupt changes
    const smoothedLevel = this.currentSuppressionLevel * (1 - this.smoothingFactor) +
                         targetLevel * this.smoothingFactor;

    return Math.max(10, Math.min(95, Math.floor(smoothedLevel)));
  }

  process(inputList: Float32Array[][], outputList: Float32Array[][]): boolean {
    const sourceLimit = Math.min(inputList.length, outputList.length);

    const input = inputList[0]?.[0];
    if (!input) {
      return true;
    }

    // Passthrough mode - copy input to all output channels
    if (!this.isInitialized || !this.dfModel || this.bypass || !this.tempFrame) {
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;
        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          output[channelNum].set(input);
        }
      }
      return true;
    }

    // Write input to ring buffer
    for (let i = 0; i < input.length; i++) {
      this.inputBuffer[this.inputWritePos] = input[i];
      this.inputWritePos = (this.inputWritePos + 1) % this.bufferSize;
    }

    const frameLength = this.dfModel.frameLength;

    while (this.getInputAvailable() >= frameLength) {
      // Extract frame from ring buffer
      for (let i = 0; i < frameLength; i++) {
        this.tempFrame[i] = this.inputBuffer[this.inputReadPos];
        this.inputReadPos = (this.inputReadPos + 1) % this.bufferSize;
      }

      // Apply dynamic suppression level adjustment if enabled
      if (this.dynamicSuppressionEnabled) {
        const newLevel = this.calculateDynamicSuppressionLevel(this.tempFrame);
        if (Math.abs(newLevel - this.currentSuppressionLevel) >= 1) {
          this.currentSuppressionLevel = newLevel;
          wasm_bindgen.df_set_atten_lim(this.dfModel.handle, newLevel);
        }
      }

      const processed = wasm_bindgen.df_process_frame(this.dfModel.handle, this.tempFrame);

      // Write to output ring buffer
      for (let i = 0; i < processed.length; i++) {
        this.outputBuffer[this.outputWritePos] = processed[i];
        this.outputWritePos = (this.outputWritePos + 1) % this.bufferSize;
      }
    }

    const outputAvailable = this.getOutputAvailable();
    if (outputAvailable >= 128) {
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;

        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          const outputChannel = output[channelNum];
          let readPos = this.outputReadPos;

          for (let i = 0; i < 128; i++) {
            outputChannel[i] = this.outputBuffer[readPos];
            readPos = (readPos + 1) % this.bufferSize;
          }
        }
      }
      this.outputReadPos = (this.outputReadPos + 128) % this.bufferSize;
    }
    return true;
  }
}

registerProcessor('deepfilter-audio-processor', DeepFilterAudioProcessor);
