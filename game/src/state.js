// state.js — the one place all mutable game state lives. Every module reads and
// writes this object; nothing else keeps game state. Pure data, no THREE here.
export const STEP = 1 / 60; // fixed simulation step (seconds)
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 15; // seconds of buy phase before the round goes live
export const BOMB_FUSE = 35; // seconds from plant to detonation
export const PLANT_TIME = 3.0; // seconds holding E to plant
export const DEFUSE_TIME = 5.0; // seconds holding E to defuse
export const ROUNDS_TO_WIN = 8;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1400;
export const LOSS_STREAK_BONUS = 500;
export const MAX_LOSS_REWARD = 3400;

export const TEAM = { VIPER: 0, WARDEN: 1 }; // Vipers attack (plant), Wardens defend
export const TEAM_NAME = ['VIPERS', 'WARDENS'];
export const TEAM_COLOR = [0x2fd4a7, 0xffb020]; // teal attackers, amber defenders

// Phases: 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd' | 'paused' (paused overlays, sim frozen)
export function createState() {
  return {
    phase: 'menu',
    time: 0, // total sim time
    phaseTime: 0, // time in current phase
    round: 1,
    score: [0, 0],
    lossStreak: [0, 0],
    roundWinner: -1,
    roundReason: '',
    matchWinner: -1,
    bomb: {
      state: 'carried', // 'carried' | 'dropped' | 'planted' | 'exploded' | 'defused'
      carrier: null, // actor id carrying it
      x: 0, z: 0, // position when dropped/planted
      site: null, // 'A' | 'B' when planted
      fuse: 0, // seconds left once planted
      plantProgress: 0,
      defuseProgress: 0,
      planter: null,
      defuser: null,
    },
    player: null, // actor object, see actors.js
    actors: [], // every actor incl. player, index 0 is the player
    grenades: [], // live grenade projectiles
    tracers: [], // visual tracer records (rendered by effects.js)
    impacts: [], // visual impact records
    shots: [], // sound events bots can hear: {x, z, time, team}
    killfeed: [], // {text, team, time}
    stats: { kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0, plants: 0, defuses: 0 },
    roundKills: [], // actor ids killed this round, for spectate
    spectate: -1, // actor id the camera follows when the player is dead
    buyOpen: false,
    paused: false,
    demo: false, // attract mode (?demo=1): camera drifts, bots play
    shotMode: null, // ?shot=menu|play|buy|end — staging for screenshots
    shake: 0, // camera shake magnitude, decays
    hitmark: 0, // time of last hitmarker
    hitmarkKill: false,
    damageFlash: 0, // red vignette strength
    banner: null, // {text, sub, team, until}
    events: [], // one-frame event flags consumed by hud/audio: {type, ...}
    rngSeed: 1234567,
  };
}

// Deterministic-ish RNG (mulberry32) so bot behaviour is stable per round seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
// Squared distance from point (px,pz) to segment (ax,az)-(bx,bz), for path following.
export function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return dist2(px, pz, cx, cz);
}
