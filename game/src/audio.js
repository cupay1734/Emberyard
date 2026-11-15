// Synthesised sound: every effect is built from oscillators and filtered noise with
// the Web Audio API, so the game ships no audio files and makes no network requests.
// The context is created lazily and resumed on the first user gesture; in screenshot
// mode (no gesture) every call is a safe no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function noise({ at = 0, dur = 0.1, freq = 1200, q = 0.8, gain = 0.4, type = 'lowpass' }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone({ at = 0, dur = 0.12, freq = 440, slide = 0, gain = 0.2, type = 'sine' }) {
    if (!ensure()) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind = 'rifle', distance = 0) {
      const vol = Math.max(0.08, 0.55 - distance * 0.008);
      if (kind === 'pistol') {
        noise({ dur: 0.07, freq: 2600, gain: vol * 0.7 });
        tone({ dur: 0.05, freq: 190, slide: -90, gain: vol * 0.5, type: 'triangle' });
      } else if (kind === 'shotgun') {
        noise({ dur: 0.22, freq: 900, gain: vol });
        tone({ dur: 0.16, freq: 120, slide: -60, gain: vol * 0.7, type: 'triangle' });
      } else if (kind === 'dmr') {
        noise({ dur: 0.16, freq: 1500, gain: vol });
        tone({ dur: 0.12, freq: 150, slide: -80, gain: vol * 0.6, type: 'triangle' });
      } else {
        noise({ dur: 0.1, freq: 1900, gain: vol * 0.85 });
        tone({ dur: 0.07, freq: 165, slide: -70, gain: vol * 0.5, type: 'triangle' });
      }
    },
    dryFire() {
      tone({ dur: 0.03, freq: 1400, gain: 0.12, type: 'square' });
    },
    reload() {
      tone({ at: 0, dur: 0.04, freq: 900, gain: 0.15, type: 'square' });
      tone({ at: 0.35, dur: 0.04, freq: 650, gain: 0.15, type: 'square' });
      tone({ at: 0.8, dur: 0.05, freq: 1100, gain: 0.18, type: 'square' });
    },
    hit(kill = false) {
      tone({ dur: 0.05, freq: kill ? 1560 : 1180, gain: 0.16, type: 'square' });
      if (kill) tone({ at: 0.06, dur: 0.07, freq: 1960, gain: 0.14, type: 'square' });
    },
    hurt() {
      tone({ dur: 0.09, freq: 220, slide: -80, gain: 0.2, type: 'sawtooth' });
    },
    throwWhoosh() {
      noise({ dur: 0.18, freq: 700, gain: 0.12, type: 'bandpass' });
    },
    explosion(distance = 0) {
      const vol = Math.max(0.1, 0.9 - distance * 0.012);
      noise({ dur: 0.7, freq: 420, gain: vol });
      tone({ dur: 0.6, freq: 110, slide: -70, gain: vol * 0.8, type: 'sine' });
    },
    plantBeep(final = false) {
      tone({ dur: final ? 0.3 : 0.07, freq: final ? 1320 : 880, gain: 0.18, type: 'square' });
    },
    defuseTick() {
      tone({ dur: 0.04, freq: 1040, gain: 0.12, type: 'square' });
    },
    buy() {
      tone({ dur: 0.05, freq: 1320, gain: 0.14, type: 'square' });
      tone({ at: 0.05, dur: 0.06, freq: 1760, gain: 0.12, type: 'square' });
    },
    denied() {
      tone({ dur: 0.09, freq: 240, gain: 0.15, type: 'square' });
    },
    roundEnd(win) {
      const base = win ? 523 : 392;
      tone({ at: 0, dur: 0.14, freq: base, gain: 0.16, type: 'triangle' });
      tone({ at: 0.14, dur: 0.14, freq: base * 1.25, gain: 0.16, type: 'triangle' });
      tone({ at: 0.28, dur: 0.26, freq: base * (win ? 1.5 : 0.84), gain: 0.16, type: 'triangle' });
    },
  };
}
