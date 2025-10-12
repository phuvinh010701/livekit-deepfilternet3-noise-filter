import { RingBuffer, AudioWriter, AudioReader } from '../worker/RingBuffer';

interface ProcessorOptions {
    rawSab: SharedArrayBuffer;
    denoisedSab: SharedArrayBuffer;
}

class DeepFilterAudioProcessor extends AudioWorkletProcessor {
  private planarBuffer: Float32Array;
  private _audio_writer: AudioWriter;
  private _audio_reader: AudioReader;

  constructor(options: AudioWorkletNodeOptions & { processorOptions: ProcessorOptions }) {
    super();
    const rawSab = options.processorOptions.rawSab;
    const denoisedSab = options.processorOptions.denoisedSab;
    this.planarBuffer = new Float32Array(128);
    this._audio_writer = new AudioWriter(new RingBuffer(rawSab, Float32Array));
    this._audio_reader = new AudioReader(new RingBuffer(denoisedSab, Float32Array));
  }

  process(inputList: Float32Array[][], outputList: Float32Array[][]): boolean {
    const sourceLimit = Math.min(inputList.length, outputList.length);

    this._audio_writer.enqueue(inputList[0][0]);
    if (this._audio_reader.availableRead() >= 128) {
      const samples_read = this._audio_reader.dequeue(this.planarBuffer);
      if (samples_read < 128) {
        console.log(`ERROR! this._audio_reader in audioworklet read ${samples_read}`);
        return false;
      }
      for (let inputNum = 0; inputNum < sourceLimit; inputNum++) {
        const output = outputList[inputNum];
        const channelCount = output.length;
        for (let channelNum = 0; channelNum < channelCount; channelNum++) {
          const outputChannel = output[channelNum];
          for (let i = 0; i < 128; i++) {
            outputChannel[i] = this.planarBuffer[i];
          }
        }
      }
    }
    return true;
  }
}

registerProcessor('deepfilter-audio-processor', DeepFilterAudioProcessor);
