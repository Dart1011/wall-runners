export class AudioEngine {
  constructor() {
    this.muted = localStorage.getItem('wall-runners-muted') === 'true';
    this.context = null;
    this.windGain = null;
  }

  unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      const wind = this.context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 650;
      this.windGain = this.context.createGain();
      this.windGain.gain.value = 0;
      wind.connect(filter).connect(this.windGain).connect(this.context.destination);
      wind.start();
    }
    if (this.context.state === 'suspended') this.context.resume();
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('wall-runners-muted', String(this.muted));
    this.unlock();
    return this.muted;
  }

  update(active, grapple, boost) {
    if (!this.context || !this.windGain) return;
    const target = !this.muted && active ? (boost ? 0.13 : grapple ? 0.065 : 0.022) : 0;
    this.windGain.gain.setTargetAtTime(target, this.context.currentTime, 0.25);
  }

  tone(frequency, duration, type = 'sine', volume = 0.06, endFrequency = frequency) {
    if (this.muted || !this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  event(type) {
    this.unlock();
    if (type === 'pickup' || type === 'gas') this.tone(580, 0.18, 'sine', 0.065, 920);
    if (type === 'supply') { this.tone(440, 0.13, 'sine', 0.05, 660); setTimeout(() => this.tone(660, 0.18, 'sine', 0.04, 880), 80); }
    if (type === 'heart') { this.tone(440, 0.3, 'sine', 0.07, 880); this.tone(660, 0.4, 'sine', 0.04, 1100); }
    if (type === 'boost') this.tone(130, 0.6, 'sawtooth', 0.06, 580);
    if (type === 'pace') { this.tone(330, 0.24, 'triangle', 0.05, 660); this.tone(495, 0.3, 'sine', 0.035, 990); }
    if (type === 'hit') { this.tone(120, 0.4, 'sawtooth', 0.1, 35); this.tone(65, 0.35, 'square', 0.06, 30); }
    if (type === 'start') this.tone(220, 0.5, 'triangle', 0.05, 440);
    if (type === 'eliminated') this.tone(180, 0.8, 'triangle', 0.08, 45);
    if (type === 'click') this.tone(420, 0.06, 'sine', 0.025, 500);
  }
}
