// combat.js — hitscan shooting, grenade physics and explosions. Pure simulation:
// it writes tracers/impacts into state for effects.js to draw, and damage into
// actors via damageActor. Friendly fire is off.
import { rayHit, BOXES } from './map.js';
import { damageAtRange } from './weapons.js';
import { damageActor } from './actors.js';
import * as audio from './audio.js';

// Slab test against an explicit AABB. Returns t or Infinity.
function rayAABB(ox, oy, oz, dx, dy, dz, minx, miny, minz, maxx, maxy, maxz, maxT) {
  let tmin = 0, tmax = maxT;
  if (Math.abs(dx) < 1e-9) { if (ox < minx || ox > maxx) return Infinity; }
  else {
    let t1 = (minx - ox) / dx, t2 = (maxx - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < miny || oy > maxy) return Infinity; }
  else {
    let t1 = (miny - oy) / dy, t2 = (maxy - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < minz || oz > maxz) return Infinity; }
  else {
    let t1 = (minz - oz) / dz, t2 = (maxz - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// One hitscan shot from `shooter` along (yaw, pitch) with gaussian-ish spread.
export function fireHitscan(state, shooter, w, yaw, pitch, spread) {
  const ex = shooter.x, ey = shooter.y + shooter.height - 0.22, ez = shooter.z;
  // Spread: sum of three uniforms approximates a bell curve.
  const r = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const py = pitch + r() * spread;
  const yy = yaw + r() * spread;
  const dx = -Math.sin(yy) * Math.cos(py);
  const dy = Math.sin(py);
  const dz = -Math.cos(yy) * Math.cos(py);
  const range = w.range;
  if (shooter.isPlayer) state.stats.shots++;

  // Nearest solid hit caps the shot.
  const wall = rayHit(ex, ey, ez, dx, dy, dz, range);
  let bestT = wall ? wall.t : range;
  let hitActor = null, headshot = false;
  for (const a of state.actors) {
    if (a === shooter || !a.alive || a.team === shooter.team) continue;
    const headTop = a.y + a.height;
    const headT = rayAABB(ex, ey, ez, dx, dy, dz,
      a.x - 0.17, headTop - 0.32, a.z - 0.17, a.x + 0.17, headTop, a.z + 0.17, bestT);
    const bodyT = rayAABB(ex, ey, ez, dx, dy, dz,
      a.x - a.half, a.y, a.z - a.half, a.x + a.half, headTop - 0.3, a.z + a.half, bestT);
    if (headT < bestT) { bestT = headT; hitActor = a; headshot = true; }
    else if (bodyT < bestT) { bestT = bodyT; hitActor = a; headshot = false; }
  }
  const hx = ex + dx * bestT, hy = ey + dy * bestT, hz = ez + dz * bestT;
  // Tracer from the muzzle, impact puff at the end.
  const mx = ex - Math.sin(yaw) * 0.5, mz = ez - Math.cos(yaw) * 0.5;
  state.tracers.push({ x1: mx, y1: ey - 0.12, z1: mz, x2: hx, y2: hy, z2: hz, time: state.time });
  if (state.tracers.length > 40) state.tracers.shift();
  state.impacts.push({ x: hx, y: hy, z: hz, flesh: !!hitActor, time: state.time });
  if (state.impacts.length > 60) state.impacts.shift();

  if (hitActor) {
    let dmg = damageAtRange(w, bestT);
    if (headshot) dmg *= w.headMult;
    if (shooter.isPlayer) {
      state.stats.hits++;
      state.hitmark = state.time;
    }
    const killed = damageActor(state, hitActor, dmg, headshot, shooter);
    if (killed && shooter.isPlayer) {
      state.hitmarkKill = true;
      audio.playHit(true);
    } else if (shooter.isPlayer) {
      state.hitmarkKill = false;
      audio.playHit(false);
    }
    if (hitActor.isPlayer) { state.damageFlash = 1; audio.playHurt(); }
  }
}

// Throw a grenade from the actor's hand along their aim.
export function throwGrenade(state, a) {
  const pitch = a.pitch + a.recoil;
  const speed = 13;
  state.grenades.push({
    x: a.x, y: a.y + a.height - 0.3, z: a.z,
    vx: -Math.sin(a.yaw) * Math.cos(pitch) * speed,
    vy: Math.sin(pitch) * speed + 2.5,
    vz: -Math.cos(a.yaw) * Math.cos(pitch) * speed,
    fuse: 1.6, owner: a, bounced: 0,
  });
  audio.playThrow();
}

function grenadeOverlaps(g, b) {
  return g.x > b[0] - b[2] / 2 - 0.12 && g.x < b[0] + b[2] / 2 + 0.12 &&
    g.z > b[1] - b[3] / 2 - 0.12 && g.z < b[1] + b[3] / 2 + 0.12 &&
    g.y > b[5] - 0.12 && g.y < b[5] + b[4] + 0.12;
}

export function updateGrenades(state, dt) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vy -= 16 * dt;
    const px = g.x, py = g.y, pz = g.z;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.12) { g.y = 0.12; g.vy = Math.abs(g.vy) * 0.45; g.vx *= 0.7; g.vz *= 0.7; audio.playBounce(); }
    for (const b of BOXES) {
      if (!grenadeOverlaps(g, b)) continue;
      // Reflect the axis the grenade entered on, damped.
      if (py >= b[5] + b[4] - 0.12 || py <= b[5] + 0.12) { g.y = py; g.vy = -g.vy * 0.45; }
      else if (px <= b[0] - b[2] / 2 || px >= b[0] + b[2] / 2) { g.x = px; g.vx = -g.vx * 0.45; }
      else { g.z = pz; g.vz = -g.vz * 0.45; }
      if (g.bounced++ < 3) audio.playBounce();
    }
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      explode(state, g.x, g.y, g.z, 6, 120, g.owner);
    }
  }
}

// Radial damage with line-of-sight halving through cover.
export function explode(state, x, y, z, radius, maxDmg, attacker) {
  state.events.push({ type: 'explosion', x, y, z, radius });
  const p = state.player;
  const pd = Math.hypot(p.x - x, p.z - z);
  audio.playExplosion(pd);
  if (pd < radius * 2) state.shake = Math.min(state.shake + 0.06 * (1 - pd / (radius * 2)), 0.12);
  for (const a of state.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - x, (a.y + 0.9) - y, a.z - z);
    if (d > radius) continue;
    let dmg = maxDmg * (1 - (d / radius) * 0.8);
    const wall = rayHit(x, y, z, (a.x - x) / (d || 1), ((a.y + 0.9) - y) / (d || 1), (a.z - z) / (d || 1), d);
    if (wall) dmg *= 0.5; // cover saves lives
    damageActor(state, a, dmg, false, attacker);
  }
}
