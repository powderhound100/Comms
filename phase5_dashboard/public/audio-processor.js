/**
 * AudioWorklet processor — ring buffer for gapless SDR audio playback.
 *
 * Main thread posts Float32Array chunks via MessagePort.
 * process() pulls 128 samples per quantum, outputs silence when empty.
 */

class RadioAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Ring buffer: 2 seconds at 48 kHz = 96000 samples
    this._bufferSize = 96000
    this._buffer = new Float32Array(this._bufferSize)
    this._writePos = 0
    this._readPos = 0
    this._count = 0 // samples available

    this.port.onmessage = (e) => {
      if (e.data.type === 'audio') {
        const samples = e.data.samples // Float32Array
        const len = samples.length

        // Write into ring buffer
        for (let i = 0; i < len; i++) {
          this._buffer[this._writePos] = samples[i]
          this._writePos = (this._writePos + 1) % this._bufferSize
        }
        this._count += len

        // If overflow, advance read pointer (drop oldest)
        if (this._count > this._bufferSize) {
          const overflow = this._count - this._bufferSize
          this._readPos = (this._readPos + overflow) % this._bufferSize
          this._count = this._bufferSize
        }
      } else if (e.data.type === 'clear') {
        this._writePos = 0
        this._readPos = 0
        this._count = 0
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output || !output[0]) return true

    const channel = output[0]
    const needed = channel.length // 128 samples per quantum

    if (this._count >= needed) {
      for (let i = 0; i < needed; i++) {
        channel[i] = this._buffer[this._readPos]
        this._readPos = (this._readPos + 1) % this._bufferSize
      }
      this._count -= needed
    } else {
      // Not enough data — output silence
      channel.fill(0)
    }

    // Report buffer level to main thread periodically
    if (currentFrame % 12800 === 0) {
      this.port.postMessage({
        type: 'bufferLevel',
        samples: this._count,
        capacity: this._bufferSize,
      })
    }

    return true
  }
}

registerProcessor('radio-audio-processor', RadioAudioProcessor)
