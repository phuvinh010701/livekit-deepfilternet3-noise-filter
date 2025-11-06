/** Size of ring buffer header (read and write pointers) in bytes */
const RING_BUFFER_HEADER_SIZE = 8;

/** Type representing typed array constructors */
type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

/** Type representing typed array instances */
type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** The base RingBuffer class
 *
 * A Single Producer - Single Consumer thread-safe wait-free ring buffer.
 *
 * The producer and the consumer can be on separate threads, but cannot change roles,
 * except with external synchronization.
 */
export class RingBuffer<T extends TypedArray = Float32Array> {
  private readonly _type: TypedArrayConstructor;
  private readonly _capacity: number;
  private readonly buf: SharedArrayBuffer;
  private readonly write_ptr: Uint32Array;
  private readonly read_ptr: Uint32Array;
  private readonly storage: T;

  /** Allocate the SharedArrayBuffer for a RingBuffer, based on the type and
   * capacity required
   * @param capacity The number of elements the ring buffer will be able to hold.
   * @param type A typed array constructor, the type that this ring buffer will hold.
   * @return A SharedArrayBuffer of the right size.
   */
  static getStorageForCapacity(capacity: number, type: TypedArrayConstructor): SharedArrayBuffer {
    if (!type.BYTES_PER_ELEMENT) {
      throw new TypeError('Pass in a TypedArray subclass');
    }
    const bytes = RING_BUFFER_HEADER_SIZE + (capacity + 1) * type.BYTES_PER_ELEMENT;
    return new SharedArrayBuffer(bytes);
  }

  /**
   * @constructor
   * @param sab A SharedArrayBuffer obtained by calling {@link RingBuffer.getStorageFromCapacity}.
   * @param type A typed array constructor, the type that this ring buffer will hold.
   */
  constructor(sab: SharedArrayBuffer, type: TypedArrayConstructor) {
    if (type.BYTES_PER_ELEMENT === undefined) {
      throw new TypeError('Pass a concrete typed array class as second argument');
    }

    // Maximum usable size is 1<<32 - type.BYTES_PER_ELEMENT bytes in the ring
    // buffer for this version, easily changeable.
    // -4 for the write ptr (uint32_t offsets)
    // -4 for the read ptr (uint32_t offsets)
    // capacity counts the empty slot to distinguish between full and empty.
    this._type = type;
    this._capacity = (sab.byteLength - RING_BUFFER_HEADER_SIZE) / type.BYTES_PER_ELEMENT;
    this.buf = sab;
    this.write_ptr = new Uint32Array(sab, 0, 1);
    this.read_ptr = new Uint32Array(sab, 4, 1);
    this.storage = new type(sab, RING_BUFFER_HEADER_SIZE, this._capacity) as T;
  }

  /**
   * @return the type of the underlying ArrayBuffer for this RingBuffer. This
   * allows implementing crude type checking.
   */
  type(): string {
    return this._type.name;
  }

  /**
   * Push elements to the ring buffer.
   * @param elements A typed array of the same type as passed in the ctor, to be written to the queue.
   * @param length If passed, the maximum number of elements to push.
   * If not passed, all elements in the input array are pushed.
   * @param offset If passed, a starting index in elements from which
   * the elements are read. If not passed, elements are read from index 0.
   * @return the number of elements written to the queue.
   */
  push(elements: T, length?: number, offset: number = 0): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if ((wr + 1) % this.storageCapacity() === rd) {
      // full
      return 0;
    }

    const len = length ?? elements.length;
    const toWrite = Math.min(this.availableWriteInternal(rd, wr), len);
    const firstPart = Math.min(this.storageCapacity() - wr, toWrite);
    const secondPart = toWrite - firstPart;

    this.copy(elements, offset, this.storage, wr, firstPart);
    this.copy(elements, offset + firstPart, this.storage, 0, secondPart);

    // publish the enqueued data to the other side
    Atomics.store(this.write_ptr, 0, (wr + toWrite) % this.storageCapacity());
    return toWrite;
  }

  /**
   * Read up to `elements.length` elements from the ring buffer. `elements` is a typed
   * array of the same type as passed in the ctor.
   * Returns the number of elements read from the queue, they are placed at the
   * beginning of the array passed as parameter.
   * @param elements An array in which the elements read from the queue will be written, starting at the beginning of the array.
   * @param length If passed, the maximum number of elements to pop. If not passed, up to elements.length are popped.
   * @param offset If passed, an index in elements in which the data is written to. `elements.length - offset` must be greater or equal to `length`.
   * @return The number of elements read from the queue.
   */
  pop(elements: T, length?: number, offset: number = 0): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if (wr === rd) {
      return 0;
    }

    const len = length ?? elements.length;
    const toRead = Math.min(this.availableReadInternal(rd, wr), len);
    const firstPart = Math.min(this.storageCapacity() - rd, toRead);
    const secondPart = toRead - firstPart;

    this.copy(this.storage, rd, elements, offset, firstPart);
    this.copy(this.storage, 0, elements, offset + firstPart, secondPart);

    Atomics.store(this.read_ptr, 0, (rd + toRead) % this.storageCapacity());
    return toRead;
  }

  /**
   * @return True if the ring buffer is empty false otherwise. This can be late
   * on the reader side: it can return true even if something has just been
   * pushed.
   */
  empty(): boolean {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return wr === rd;
  }

  /**
   * @return True if the ring buffer is full, false otherwise. This can be late
   * on the write side: it can return true when something has just been popped.
   */
  full(): boolean {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return (wr + 1) % this.storageCapacity() === rd;
  }

  /**
   * @return The usable capacity for the ring buffer: the number of elements
   * that can be stored.
   */
  capacity(): number {
    return this._capacity - 1;
  }

  /**
   * @return The number of elements available for reading. This can be late, and
   * report less elements that is actually in the queue, when something has just
   * been enqueued.
   */
  availableRead(): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return this.availableReadInternal(rd, wr);
  }

  /**
   * @return The number of elements available for writing. This can be late, and
   * report less elements that is actually available for writing, when something
   * has just been dequeued.
   */
  availableWrite(): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return this.availableWriteInternal(rd, wr);
  }


  // private methods //

  /**
   * @return Number of elements available for reading, given a read and write
   * pointer.
   */
  private availableReadInternal(rd: number, wr: number): number {
    return (wr + this.storageCapacity() - rd) % this.storageCapacity();
  }

  /**
   * @return Number of elements available from writing, given a read and write
   * pointer.
   */
  private availableWriteInternal(rd: number, wr: number): number {
    return this.capacity() - this.availableReadInternal(rd, wr);
  }

  /**
   * @return The size of the storage for elements not accounting the space for
   * the index, counting the empty slot.
   */
  private storageCapacity(): number {
    return this._capacity;
  }

  /**
   * Copy `size` elements from `input`, starting at offset `offsetInput`, to
   * `output`, starting at offset `offsetOutput`.
   * @param input The array to copy from
   * @param offsetInput The index at which to start the copy
   * @param output The array to copy to
   * @param offsetOutput The index at which to start copying the elements to
   * @param size The number of elements to copy
   */
  private copy(input: T, offsetInput: number, output: T, offsetOutput: number, size: number): void {
    for (let i = 0; i < size; i++) {
      output[offsetOutput + i] = input[offsetInput + i];
    }
  }
}

/**
 * Send interleaved audio frames to another thread, wait-free.
 *
 * These classes allow communicating between a non-real time thread (browser
 * main thread or worker) and a real-time thread (in an AudioWorkletProcessor).
 * Write and Reader cannot change role after setup, unless externally
 * synchronized.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on how implementations schedule GC
 * passes. After the setup phase no GC is triggered on either side of the queue.
 */
export class AudioWriter {
  private ringbuf: RingBuffer;

  /**
   * From a RingBuffer, build an object that can enqueue enqueue audio in a ring
   * buffer.
   * @constructor
   */
  constructor(ringbuf: RingBuffer) {
    if (ringbuf.type() !== 'Float32Array') {
      throw TypeError('This class requires a ring buffer of Float32Array');
    }
    this.ringbuf = ringbuf;
  }

  /**
   * Enqueue a buffer of interleaved audio into the ring buffer.
   *
   *
   * Care should be taken to enqueue a number of samples that is a multiple of the
   * channel count of the audio stream.
   *
   * @param {Float32Array} buf An array of interleaved audio frames.
   *
   * @return The number of samples that have been successfuly written to the
   * queue. `buf` is not written to during this call, so the samples that
   * haven't been written to the queue are still available.
   */
  enqueue(buf: Float32Array): number {
    return this.ringbuf.push(buf);
  }

  /**
   * @return The free space in the ring buffer. This is the amount of samples
   * that can be queued, with a guarantee of success.
   */
  availableWrite(): number {
    return this.ringbuf.availableWrite();
  }
}

/**
 * Receive interleaved audio frames to another thread, wait-free.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on how implementations schedule GC
 * passes. After the setup phase no GC is triggered on either side of the queue.
 */
export class AudioReader {
  private ringbuf: RingBuffer;

  /**
   * From a RingBuffer, build an object that can dequeue audio in a ring
   * buffer.
   * @constructor
   */
  constructor(ringbuf: RingBuffer) {
    if (ringbuf.type() !== 'Float32Array') {
      throw TypeError('This class requires a ring buffer of Float32Array');
    }
    this.ringbuf = ringbuf;
  }

  /**
   * Attempt to dequeue at most `buf.length` samples from the queue. This
   * returns the number of samples dequeued. If greater than 0, the samples are
   * at the beginning of `buf`.
   *
   * Care should be taken to dequeue a number of samples that is a multiple of the
   * channel count of the audio stream.
   *
   * @param {Float32Array} buf A buffer in which to copy the dequeued
   * interleaved audio frames.
   * @return The number of samples dequeued.
   */
  dequeue(buf: Float32Array): number {
    if (this.ringbuf.empty()) {
      return 0;
    }
    return this.ringbuf.pop(buf);
  }

  /**
   * Query the occupied space in the queue.
   *
   * @return The amount of samples that can be read with a guarantee of success.
   *
   */
  availableRead(): number {
    return this.ringbuf.availableRead();
  }
}

