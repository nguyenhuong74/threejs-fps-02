// audio.js — every sound is synthesized with WebAudio: no audio files, no
// network. One AudioContext, one master gain; distance attenuates bot shots.
let ctx = null;
let master = null;
let started = false;

export function initAudio() {
  if (started) return;
  started = true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

// Short filtered noise burst, the core of every gunshot and explosion.
function noiseBurst(dur, filterFreq, type, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

function tone(freq, dur, type, gain, slideTo = 0, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// gain 1 = point blank; distant shots get quieter (and are the bots' "sound").
function distGain(dist) {
  if (dist == null) return 1;
  return Math.max(0.03, 1 - dist / 90);
}

export function playShot(kind, dist) {
  const g = distGain(dist);
  if (kind === 'pistol') { noiseBurst(0.12, 1800, 'lowpass', 0.5 * g); tone(180, 0.08, 'square', 0.12 * g, 60); }
  else if (kind === 'smg') { noiseBurst(0.09, 2200, 'lowpass', 0.4 * g); tone(220, 0.06, 'square', 0.1 * g, 80); }
  else if (kind === 'rifle') { noiseBurst(0.14, 1400, 'lowpass', 0.6 * g); tone(150, 0.1, 'square', 0.16 * g, 50); }
  else if (kind === 'sniper') { noiseBurst(0.3, 900, 'lowpass', 0.8 * g); tone(90, 0.25, 'sawtooth', 0.2 * g, 30); }
}

export function playDryFire() { tone(1200, 0.05, 'square', 0.08); }
export function playReload() { tone(700, 0.05, 'square', 0.1); tone(500, 0.05, 'square', 0.1, 0, 0.25); tone(900, 0.06, 'square', 0.12, 0, 0.5); }
export function playHit(kill) {
  tone(kill ? 1400 : 1000, 0.07, 'sine', 0.25);
  if (kill) tone(1800, 0.12, 'sine', 0.2, 0, 0.07);
}
export function playHurt() { tone(120, 0.15, 'sawtooth', 0.25, 60); }
export function playExplosion(dist) {
  const g = distGain(dist);
  noiseBurst(1.2, 300, 'lowpass', 0.9 * g);
  tone(60, 1.0, 'sine', 0.7 * g, 25);
}
export function playBeep(urgent) { tone(urgent ? 1600 : 1100, 0.09, 'square', 0.18); }
export function playPlant() { tone(440, 0.1, 'sine', 0.2); tone(660, 0.1, 'sine', 0.2, 0, 0.12); tone(880, 0.18, 'sine', 0.25, 0, 0.24); }
export function playDefuse() { tone(880, 0.1, 'sine', 0.2); tone(660, 0.1, 'sine', 0.2, 0, 0.12); tone(440, 0.18, 'sine', 0.25, 0, 0.24); }
export function playRoundWin() { tone(523, 0.14, 'triangle', 0.25); tone(659, 0.14, 'triangle', 0.25, 0, 0.14); tone(784, 0.3, 'triangle', 0.3, 0, 0.28); }
export function playRoundLose() { tone(392, 0.16, 'triangle', 0.22); tone(330, 0.16, 'triangle', 0.22, 0, 0.16); tone(262, 0.32, 'triangle', 0.25, 0, 0.32); }
export function playBuy() { tone(950, 0.06, 'sine', 0.18); tone(1250, 0.1, 'sine', 0.18, 0, 0.06); }
export function playDenied() { tone(220, 0.12, 'square', 0.15); }
export function playClick() { tone(800, 0.04, 'sine', 0.12); }
export function playStep(dist) { if (Math.random() < 0.5) noiseBurst(0.05, 600, 'lowpass', 0.05 * distGain(dist)); }
export function playThrow() { noiseBurst(0.08, 1200, 'bandpass', 0.15); }
export function playBounce() { tone(300, 0.05, 'sine', 0.08, 150); }
