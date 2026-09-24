/** ICE may arrive before the offer has created its peer connection. */
export class CallIceBuffer {
  private readonly candidates = new Map<string, RTCIceCandidateInit[]>();

  add(peerId: string, candidate: RTCIceCandidateInit): void {
    if (!this.candidates.has(peerId) && this.candidates.size >= 128) {
      const oldestPeer = this.candidates.keys().next().value;
      if (oldestPeer) this.candidates.delete(oldestPeer);
    }
    const queue = this.candidates.get(peerId) ?? [];
    // Only candidates awaiting a peer entry are buffered; established peers
    // use the existing peer-level queue or addIceCandidate directly.
    if (queue.length === 64) queue.shift();
    queue.push(candidate);
    this.candidates.set(peerId, queue);
  }

  take(peerId: string): RTCIceCandidateInit[] {
    const queue = this.candidates.get(peerId) ?? [];
    this.candidates.delete(peerId);
    return queue;
  }

  clear(): void {
    this.candidates.clear();
  }
}
