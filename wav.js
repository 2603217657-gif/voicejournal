(function (root, factory) {
  const wav = factory();
  if (typeof module === "object" && module.exports) module.exports = wav;
  else root.TreeholeWav = wav;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 16-bit PCM 单声道 WAV。浏览器录到的是 WebM，解码后用它重新封装，
  // 服务器和本地模型只认这个格式。
  function wavBytes(samples, sampleRate) {
    const dataLength = samples.length * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeAscii = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, dataLength, true);
    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return buffer;
  }

  function encodeWav16(samples, sampleRate) {
    return new Blob([wavBytes(samples, sampleRate)], { type: "audio/wav" });
  }

  return Object.freeze({ wavBytes, encodeWav16 });
});
