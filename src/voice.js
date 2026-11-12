export class VoiceChat {
  constructor(socket, { onChange = () => {}, onError = () => {} } = {}) {
    this.socket = socket;
    this.onChange = onChange;
    this.onError = onError;
    this.enabled = false;
    this.connecting = false;
    this.stream = null;
    this.roomCode = null;
    this.peers = new Map();
    this.attempt = 0;
    this.audio = document.querySelector('#voice-audio');
    socket.on('voice:signal', (signal) => this.receiveSignal(signal));
    socket.on('voice:peer-leave', ({ id }) => this.closePeer(id));
  }

  get status() {
    return {
      enabled: this.enabled,
      connecting: this.connecting,
      connected: [...this.peers.values()].filter((peer) => peer.pc.connectionState === 'connected').length,
    };
  }

  changed() {
    this.onChange(this.status);
  }

  async start(roomCode) {
    if (this.enabled || this.connecting) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Voice chat needs a browser with WebRTC support on localhost or HTTPS.');
    this.connecting = true;
    const attempt = ++this.attempt;
    this.changed();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (attempt !== this.attempt) {
        for (const track of this.stream.getTracks()) track.stop();
        this.stream = null;
        return;
      }
      this.roomCode = roomCode;
      const response = await this.socket.timeout(6000).emitWithAck('voice:join', {});
      if (response.error) throw new Error(response.error);
      if (attempt !== this.attempt) return;
      this.enabled = true;
      for (const id of response.peers) this.createPeer(id);
      this.connecting = false;
      this.changed();
    } catch (error) {
      if (attempt !== this.attempt) return;
      this.connecting = false;
      this.stop();
      throw error;
    }
  }

  stop() {
    this.attempt += 1;
    if (this.roomCode && this.socket.connected) this.socket.emit('voice:leave');
    this.enabled = false;
    this.connecting = false;
    this.roomCode = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.audio.replaceChildren();
    this.changed();
  }

  createPeer(id) {
    if (this.peers.has(id) || !this.stream) return this.peers.get(id);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
    });
    const peer = { pc, polite: this.socket.id < id, makingOffer: false, ignoreOffer: false, pending: [] };
    this.peers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.socket.emit('voice:signal', { to: id, description: pc.localDescription });
      } catch (error) {
        this.onError(error);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.socket.emit('voice:signal', { to: id, candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams: [stream] }) => {
      let audio = this.audio.querySelector(`audio[data-peer="${id}"]`);
      if (!audio) {
        audio = document.createElement('audio');
        audio.dataset.peer = id;
        audio.autoplay = true;
        audio.playsInline = true;
        this.audio.append(audio);
      }
      audio.srcObject = stream;
      audio.play().catch(this.onError);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      if (pc.connectionState === 'closed') this.closePeer(id);
      this.changed();
    };
    this.changed();
    return peer;
  }

  async receiveSignal({ from, description, candidate }) {
    if (!this.enabled) return;
    const peer = this.createPeer(from);
    const pc = peer.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        for (const queued of peer.pending.splice(0)) await pc.addIceCandidate(queued);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.socket.emit('voice:signal', { to: from, description: pc.localDescription });
        }
      } else if (candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else peer.pending.push(candidate);
      }
    } catch (error) {
      this.onError(error);
    }
  }

  closePeer(id) {
    const peer = this.peers.get(id);
    if (peer) peer.pc.close();
    this.peers.delete(id);
    this.audio.querySelector(`audio[data-peer="${id}"]`)?.remove();
    this.changed();
  }
}
