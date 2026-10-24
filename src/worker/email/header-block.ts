// Collects only the header block of a raw message while the whole message streams elsewhere (to
// R2): what the dashboard needs to list mail too large to parse (sender, subject, authentication),
// at a cost bounded by maxBytes rather than by the size of the message.

const HEADER_END_CRLF = [13, 10, 13, 10];
const HEADER_END_LF = [10, 10];

function indexOfSequence(bytes: Uint8Array, sequence: number[], from: number): number {
  outer: for (let index = Math.max(0, from); index <= bytes.length - sequence.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

export class HeaderBlockCollector {
  private bytes = new Uint8Array(0);
  private complete = false;

  constructor(private readonly maxBytes: number) {}

  /** Feeds the next chunk; does nothing once the headers ended or the limit was reached. */
  push(chunk: Uint8Array): void {
    if (this.complete) return;
    const searchFrom = this.bytes.length - HEADER_END_CRLF.length;
    const room = this.maxBytes - this.bytes.length;
    const joined = new Uint8Array(this.bytes.length + Math.min(chunk.byteLength, room));
    joined.set(this.bytes);
    joined.set(chunk.subarray(0, room), this.bytes.length);
    // The separator can straddle two chunks, so the search starts just before the new bytes.
    const ends = [
      indexOfSequence(joined, HEADER_END_CRLF, searchFrom),
      indexOfSequence(joined, HEADER_END_LF, searchFrom),
    ];
    const end = Math.min(...ends.map((index) => (index < 0 ? Number.POSITIVE_INFINITY : index)));
    if (Number.isFinite(end)) {
      this.bytes = joined.slice(0, end);
      this.complete = true;
    } else {
      this.bytes = joined;
      this.complete = joined.length >= this.maxBytes;
    }
  }

  /** The headers as a message with an empty body, ready for the MIME parser. */
  message(): ArrayBuffer {
    const terminator = new TextEncoder().encode("\r\n\r\n");
    const message = new Uint8Array(this.bytes.length + terminator.length);
    message.set(this.bytes);
    message.set(terminator, this.bytes.length);
    return message.buffer;
  }
}
