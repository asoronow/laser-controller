/**
 * Audio Engine — Web Audio API beat detection for laser show sync
 *
 * Uses spectral flux (energy derivative) onset detection instead of raw
 * energy threshold. Detects the *attack* phase of kicks and snares rather
 * than sustained loudness, producing beat timing that matches actual
 * percussive transients.
 */

export type BeatCallback = (energy: number, bpm: number, relativeStrength: number) => void;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private animFrame: number | null = null;

  // Beat detection state
  private prevBassEnergy = 0; // previous frame's bass for flux calculation
  private fluxHistory: number[] = []; // rolling window of flux values
  private beatEnergies: number[] = []; // rolling window of beat energies for strength
  private lastBeatTime = 0;
  private beatTimestamps: number[] = [];
  private callbacks: BeatCallback[] = [];

  // Public state
  energy = 0;
  bassEnergy = 0;
  midEnergy = 0;
  trebleEnergy = 0;
  bpm = 0;
  sensitivity = 1.0;
  running = false;

  private static readonly FFT_SIZE = 1024;
  private static readonly BASS_BINS = 10; // ~0-430Hz at 44.1kHz
  private static readonly MID_START = 10;
  private static readonly MID_END = 80; // ~430-3400Hz
  private static readonly TREBLE_START = 80;
  private static readonly TREBLE_END = 200; // ~3400-8600Hz
  private static readonly FLUX_HISTORY_LEN = 40; // ~0.67s at 60fps
  private static readonly MIN_COOLDOWN_MS = 100;
  private static readonly BPM_WINDOW = 8; // beats for BPM average
  private static readonly MIN_FLUX = 0.015; // absolute floor for flux detection

  async start(): Promise<void> {
    if (this.running) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = AudioEngine.FFT_SIZE;
    // Low smoothing to preserve transients (was 0.3)
    this.analyser.smoothingTimeConstant = 0.1;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.prevBassEnergy = 0;
    this.fluxHistory = [];
    this.beatEnergies = [];
    this.beatTimestamps = [];
    this.lastBeatTime = 0;
    this.running = true;

    this.tick();
  }

  stop(): void {
    this.running = false;

    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }

    this.source?.disconnect();
    this.source = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    if (this.ctx?.state !== "closed") {
      this.ctx?.close().catch(() => {});
    }
    this.ctx = null;
    this.analyser = null;
    this.freqData = null;
    this.energy = 0;
    this.bassEnergy = 0;
    this.midEnergy = 0;
    this.trebleEnergy = 0;
    this.bpm = 0;
  }

  onBeat(cb: BeatCallback): () => void {
    this.callbacks.push(cb);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== cb);
    };
  }

  private tick = (): void => {
    if (!this.running || !this.analyser || !this.freqData) return;

    this.analyser.getByteFrequencyData(this.freqData);

    // ── Calculate bass energy (average of low frequency bins) ──
    let bassSum = 0;
    for (let i = 0; i < AudioEngine.BASS_BINS; i++) {
      bassSum += this.freqData[i];
    }
    const currentBassEnergy = bassSum / (AudioEngine.BASS_BINS * 255);
    this.energy = currentBassEnergy;
    this.bassEnergy = currentBassEnergy;

    // ── Mid-range energy ──
    let midSum = 0;
    const midCount = AudioEngine.MID_END - AudioEngine.MID_START;
    for (let i = AudioEngine.MID_START; i < AudioEngine.MID_END; i++) {
      midSum += this.freqData[i];
    }
    this.midEnergy = midSum / (midCount * 255);

    // ── Treble energy ──
    let trebleSum = 0;
    const trebleCount = AudioEngine.TREBLE_END - AudioEngine.TREBLE_START;
    for (let i = AudioEngine.TREBLE_START; i < AudioEngine.TREBLE_END; i++) {
      trebleSum += this.freqData[i];
    }
    this.trebleEnergy = trebleSum / (trebleCount * 255);

    // ── Spectral flux onset detection ──
    // Half-wave rectified flux: only care about energy *increases* (attacks)
    const flux = Math.max(0, currentBassEnergy - this.prevBassEnergy);
    this.prevBassEnergy = currentBassEnergy;

    // Maintain rolling average of flux values (separate from energy)
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > AudioEngine.FLUX_HISTORY_LEN) {
      this.fluxHistory.shift();
    }

    // Beat detection: flux exceeds adaptive threshold
    if (this.fluxHistory.length >= 10) {
      const fluxAvg =
        this.fluxHistory.reduce((a, b) => a + b, 0) /
        this.fluxHistory.length;
      const threshold = fluxAvg * (1 + this.sensitivity);
      const now = performance.now();

      // Adaptive cooldown: scales with detected BPM
      const cooldownMs =
        this.bpm > 0
          ? Math.max(AudioEngine.MIN_COOLDOWN_MS, (60000 / this.bpm) * 0.4)
          : 150;
      const cooldownOk = now - this.lastBeatTime > cooldownMs;

      if (flux > threshold && flux > AudioEngine.MIN_FLUX && cooldownOk) {
        this.lastBeatTime = now;
        this.beatTimestamps.push(now);

        // Keep only recent beats for BPM
        if (this.beatTimestamps.length > AudioEngine.BPM_WINDOW + 1) {
          this.beatTimestamps.shift();
        }

        // Calculate BPM from intervals
        if (this.beatTimestamps.length >= 3) {
          const intervals: number[] = [];
          for (let i = 1; i < this.beatTimestamps.length; i++) {
            intervals.push(this.beatTimestamps[i] - this.beatTimestamps[i - 1]);
          }
          const avgInterval =
            intervals.reduce((a, b) => a + b, 0) / intervals.length;
          this.bpm = Math.round(60000 / avgInterval);
        }

        // Beat strength classification: compare flux to average flux
        this.beatEnergies.push(flux);
        if (this.beatEnergies.length > 16) this.beatEnergies.shift();
        const avgBeatFlux =
          this.beatEnergies.reduce((a, b) => a + b, 0) /
          this.beatEnergies.length;
        const relativeStrength =
          avgBeatFlux > 0.001 ? flux / avgBeatFlux : 1.0;

        // Fire callbacks with raw energy (for effect scaling) and strength
        for (const cb of this.callbacks) {
          cb(currentBassEnergy, this.bpm, relativeStrength);
        }
      }
    }

    this.animFrame = requestAnimationFrame(this.tick);
  };
}
