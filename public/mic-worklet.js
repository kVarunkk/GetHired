class MicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0][0];

    if (channel && channel.length) {
      const pcm = new Int16Array(channel.length);

      for (let i = 0; i < channel.length; i++) {
        const s = Math.min(1, Math.max(-1, channel[i]));

        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor("mic-capture-processor", MicCaptureProcessor);
