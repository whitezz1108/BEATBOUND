/**
 * BeatBound — AudioEngine.
 *
 * Master clock = AudioContext.currentTime (sample-accurate, freezes on pause).
 * Two tracks are scheduled: the original song for section 1, the remix for
 * section 2, with a hard crossfade + transition FX at the section boundary.
 *
 * If a real audio file is missing, a clearly-labeled metronome click track is
 * synthesized for that part instead (TEST MODE — this is NOT a replacement for
 * the actual song; the UI tells the user to supply the real files).
 */

export interface RunConfig {
  durO: number // seconds of original audio
  durR: number // seconds of remix audio
  bpmO: number
  bpmR: number
  transT: number // song-time when remix begins (= durO)
  leadIn: number // seconds before song t=0
  totalDur: number
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  buffers: { original: AudioBuffer | null; remix: AudioBuffer | null } = {
    original: null,
    remix: null,
  }
  private srcs: AudioBufferSourceNode[] = []
  private t0 = 0
  private running = false
  private cfg: RunConfig | null = null
  private metroTimer: ReturnType<typeof setInterval> | null = null
  private metroNext = 0 // next click time (song time)
  private metroBeat = 0

  get ready(): boolean {
    return !!this.ctx
  }
  get hasOriginal(): boolean {
    return !!this.buffers.original
  }
  get hasRemix(): boolean {
    return !!this.buffers.remix
  }
  /** true when at least one part is missing → partial/full TEST MODE */
  get isTestMode(): boolean {
    return !this.buffers.original || !this.buffers.remix
  }

  /** Must be called from a user gesture. */
  async ensure(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = 0.9
        this.master.connect(this.ctx.destination)
        const len = Math.floor(this.ctx.sampleRate * 1.8)
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return true
    } catch {
      return false
    }
  }

  async load(urlOriginal: string, urlRemix: string): Promise<void> {
    const ok = await this.ensure()
    if (!ok || !this.ctx) return
    const [o, r] = await Promise.all([this.decode(urlOriginal), this.decode(urlRemix)])
    this.buffers.original = o
    this.buffers.remix = r
  }

  private async decode(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      return await this.ctx.decodeAudioData(ab)
    } catch {
      return null
    }
  }

  /* ────────────── run lifecycle ────────────── */

  startRun(cfg: RunConfig): void {
    if (!this.ctx || !this.master) return
    this.stopRun()
    this.cfg = cfg
    this.t0 = this.ctx.currentTime + cfg.leadIn
    this.running = true
    const c = this.ctx

    // Track 1 — original song (or silence if the file is missing)
    if (this.buffers.original) {
      const src = c.createBufferSource()
      src.buffer = this.buffers.original
      const g = c.createGain()
      g.gain.value = 1
      src.connect(g).connect(this.master)
      src.start(this.t0, 0, cfg.durO + 0.6)
      if (this.buffers.remix) {
        // quick crossfade at the transition
        g.gain.setValueAtTime(1, this.t0 + cfg.transT - 0.05)
        g.gain.linearRampToValueAtTime(0, this.t0 + cfg.transT + 0.14)
        src.stop(this.t0 + cfg.transT + 0.7)
      }
      this.srcs.push(src)
    }

    // Track 2 — remix
    if (this.buffers.remix) {
      const src = c.createBufferSource()
      src.buffer = this.buffers.remix
      const g = c.createGain()
      g.gain.setValueAtTime(0, this.t0 + cfg.transT)
      g.gain.linearRampToValueAtTime(1, this.t0 + cfg.transT + 0.12)
      src.connect(g).connect(this.master)
      src.start(this.t0 + cfg.transT, 0, cfg.durR + 0.6)
      this.srcs.push(src)
    }

    // Transition FX (riser + impact) — always, to sell the switch
    this.riser(this.t0 + cfg.transT - 1.55, 1.55)
    this.impact(this.t0 + cfg.transT)

    // Metronome fills only the parts without real audio (TEST MODE)
    this.metroNext = -cfg.leadIn
    this.metroBeat = 0
    this.metroTimer = setInterval(this.metroTick, 30)
  }

  /** Song time right now (negative during the lead-in). */
  now(): number {
    if (!this.ctx || !this.running) return 0
    return this.ctx.currentTime - this.t0
  }

  stopRun(): void {
    for (const s of this.srcs) {
      try {
        s.stop()
      } catch {
        /* already stopped */
      }
    }
    this.srcs = []
    if (this.metroTimer) {
      clearInterval(this.metroTimer)
      this.metroTimer = null
    }
    this.running = false
    this.cfg = null
  }

  async pause(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend()
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /* ────────────── metronome (TEST MODE click track) ────────────── */

  private metroTick = (): void => {
    if (!this.ctx || !this.running || !this.cfg || this.ctx.state !== 'running') return
    const cfg = this.cfg
    const ahead = this.now() + 0.25
    while (this.metroNext < ahead && this.metroNext < cfg.totalDur) {
      const t = this.metroNext
      const inRemix = t >= cfg.transT
      const hasReal = inRemix ? !!this.buffers.remix : !!this.buffers.original
      if (!hasReal && t >= 0) {
        const bpm = inRemix ? cfg.bpmR : cfg.bpmO
        const sectionBeat = inRemix ? t - cfg.transT : t
        const beatDur = 60 / bpm
        const beatIdx = Math.round(sectionBeat / beatDur)
        // only click near integer beats (drift guard)
        if (Math.abs(sectionBeat - beatIdx * beatDur) < beatDur * 0.25) {
          this.click(this.t0 + t, beatIdx % 4 === 0)
        }
      }
      this.metroNext += 60 / (inRemix ? cfg.bpmR : cfg.bpmO)
    }
  }

  private click(when: number, accent: boolean): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = 'sine'
    o.frequency.value = accent ? 1560 : 1040
    g.gain.setValueAtTime(accent ? 0.22 : 0.14, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.06)
    o.connect(g).connect(this.master)
    o.start(when)
    o.stop(when + 0.08)
  }

  /* ────────────── transition FX ────────────── */

  private riser(when: number, dur: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const c = this.ctx
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = c.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 7
    f.frequency.setValueAtTime(240, when)
    f.frequency.exponentialRampToValueAtTime(3600, when + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.24, when + dur)
    g.gain.exponentialRampToValueAtTime(0.001, when + dur + 0.1)
    src.connect(f).connect(g).connect(this.master)
    src.start(when)
    src.stop(when + dur + 0.15)
  }

  private impact(when: number): void {
    if (!this.ctx || !this.master) return
    const c = this.ctx
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(175, when)
    o.frequency.exponentialRampToValueAtTime(42, when + 0.45)
    g.gain.setValueAtTime(0.5, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.5)
    o.connect(g).connect(this.master)
    o.start(when)
    o.stop(when + 0.55)
    if (this.noiseBuf) {
      const n = c.createBufferSource()
      n.buffer = this.noiseBuf
      const f = c.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 900
      const ng = c.createGain()
      ng.gain.setValueAtTime(0.3, when)
      ng.gain.exponentialRampToValueAtTime(0.001, when + 0.3)
      n.connect(f).connect(ng).connect(this.master)
      n.start(when)
      n.stop(when + 0.35)
    }
  }

  /* ────────────── SFX ────────────── */

  private tone(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
    slideTo?: number
  ): void {
    if (!this.ctx || !this.master) return
    const when = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, when)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, when + dur)
    g.gain.setValueAtTime(gain, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + dur)
    o.connect(g).connect(this.master)
    o.start(when)
    o.stop(when + dur + 0.05)
  }

  sfxJump(): void {
    this.tone(720, 0.05, 0.035, 'square')
  }

  sfxDeath(): void {
    this.tone(330, 0.34, 0.4, 'sawtooth', 0, 52)
    if (this.ctx && this.noiseBuf && this.master) {
      const c = this.ctx
      const when = c.currentTime
      const n = c.createBufferSource()
      n.buffer = this.noiseBuf
      const f = c.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 350
      const g = c.createGain()
      g.gain.setValueAtTime(0.28, when)
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
      n.connect(f).connect(g).connect(this.master)
      n.start(when)
      n.stop(when + 0.2)
    }
  }

  sfxComplete(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => this.tone(f, 0.32, 0.16, 'triangle', i * 0.1))
    this.tone(1046.5, 0.7, 0.1, 'sine', 0.42)
  }

  sfxUi(): void {
    this.tone(880, 0.06, 0.06, 'sine')
  }
}
