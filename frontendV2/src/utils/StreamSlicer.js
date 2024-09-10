// From https://gist.github.com/thomaskonrad/b8f30e3f18ea2f538bdf422203bdc473
//
// This source code is taken from Firefox Send (https://github.com/mozilla/send) and slightly modified.

export default class StreamSlicer {
  chunkSize;
  partialChunk;
  offset;

  constructor(chunkSize) {
    this.chunkSize = chunkSize;
    this.partialChunk = new Uint8Array(this.chunkSize);
    this.offset = 0;
  }

  send(buf, controller) {
    controller.enqueue(buf);
    this.partialChunk = new Uint8Array(this.chunkSize);
    this.offset = 0;
  }

  transform(chunk, controller) {
    let i = 0;

    if (this.offset > 0) {
      const len = Math.min(chunk.byteLength, this.chunkSize - this.offset);
      this.partialChunk.set(chunk.slice(0, len), this.offset);
      this.offset += len;
      i += len;

      if (this.offset === this.chunkSize) {
        this.send(this.partialChunk, controller);
      }
    }

    while (i < chunk.byteLength) {
      const remainingBytes = chunk.byteLength - i;
      if (remainingBytes >= this.chunkSize) {
        const record = chunk.slice(i, i + this.chunkSize);
        i += this.chunkSize;
        this.send(record, controller);
      } else {
        const end = chunk.slice(i, i + remainingBytes);
        i += end.byteLength;
        this.partialChunk.set(end);
        this.offset = end.byteLength;
      }
    }
  }

  flush(controller) {
    if (this.offset > 0) {
      controller.enqueue(this.partialChunk.slice(0, this.offset));
    }
  }
}
