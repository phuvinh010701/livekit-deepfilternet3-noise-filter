import { RingBuffer, AudioWriter, AudioReader } from '../worker/RingBuffer';

/** Standard audio processing frame size in Web Audio API */
const AUDIO_WORKLET_FRAME_SIZE = 128;

interface ProcessorOptions {
    rawSab: SharedArrayBuffer;
    denoisedSab: SharedArrayBuffer;
}

class DeepFilterAudioProcessor extends AudioWorkletProcessor {
  private planarBuffer: Float32Array;
  private audioWriter: AudioWriter;
  private audioReader: AudioReader;

  constructor(options: AudioWorkletNodeOptions & { processorOptions: ProcessorOptions }) {
    super();
    const rawSab = options.processorOptions.rawSab;
    const denoisedSab = options.processorOptions.denoisedSab;
    this.planarBuffer = new Float32Array(AUDIO_WORKLET_FRAME_SIZE);
    this.audioWriter = new AudioWriter(new RingBuffer(rawSab, Float32Array));
    this.audioReader = new AudioReader(new RingBuffer(denoisedSab, Float32Array));
  }

  process(inputList: Float32Array[][], outputList: Float32Array[][]): boolean {
    const sourceLimit = Math.min(inputList.length, outputList.length);

    this.audioWriter.enqueue(inputList[0][0]);
    if (this.audioReader.availableRead() >= AUDIO_WORKLET_FRAME_SIZE) {
      const samplesRead = this.audioReader.dequeue(this.planarBuffer);
      if (samplesRead < AUDIO_WORKLET_FRAME_SIZE) {
        console.error(`ERROR! audioReader in audioworklet read ${samplesRead}`);
        return false;
      }
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;
        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          const outputChannel = output[channelNum];
          for (let i = 0; i < AUDIO_WORKLET_FRAME_SIZE; i++) {
            outputChannel[i] = this.planarBuffer[i];
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('deepfilter-audio-processor', DeepFilterAudioProcessor);
