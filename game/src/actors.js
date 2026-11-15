// actors.js — actor data, the player controller (movement, look, fire input),
// damage and death, and the low-poly bot bodies. Bots' decisions live in bots.js;
// the hitscan itself lives in combat.js.
import * as THREE from 'three';
import { WEAPONS, shotSpread, damageAtRange, applyArmor } from './weapons.js';
import { moveActor } from './map.js';
import { clamp, TEAM_COLOR } from './state.js';
import { fireHitscan, throwGrenade } from './combat.js';
import * as audio from './audio.js';

export const WALK_SPEED = 4.3;
export const CROUCH_SPEED = 1.7;
export const GRAVITY = 14;
export const JUMP_SPEED = 4.9;

const BOT_NAMES = [
  'Rook', 'Sable', 'Moss', 'Juno', 'Fable', 'Orin', 'Vega', 'Pike', 'Lark', 'Dune',
];

let nextId = 1;

export function createActor(team, isPlayer, name) {
  const a = {
    id: nextId++,
    name: name || (isPlayer ? 'You' : BOT_NAMES[(nextId * 7) % BOT_NAMES.length]),
    team, isPlayer,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, half: 0.35, height: 1.75,
    hp: 100, armor: 0, helmet: false, alive: true,
    crouching: false, onGround: true, ads: false,
    // Loadout: primary rifle-class weapon (null = none), always a P9, grenades.
    primary: null, grenades: 0,
    current: 'p9',
    mag: { p9: 12, vk9: 30, ar77: 30, lw50: 5 },
    reserve: { p9: 48, vk9: 120, ar77: 90, lw50: 15 },
    reloading: 0, fireCooldown: 0, bloom: 0, recoil: 0,
    prevFiring: false, switchCooldown: 0,
    money: 800,
    // Bot brain (unused by the player)
    role: null, path: [], pathIdx: 0, brain: null,
    lastSeenByPlayer: -99, lastShotAt: -99, walkPhase: 0,
    mesh: null, deathTime: 0,
  };
  return a;
}

export function resetActorForRound(a, x, z, yaw) {
  a.x = x; a.y = 0; a.z = z; a.vx = a.vy = a.vz = 0;
  a.yaw = yaw; a.pitch = 0;
  a.hp = 100; a.alive = true; a.crouching = false; a.ads = false;
  a.reloading = 0; a.fireCooldown = 0; a.bloom = 0; a.recoil = 0;
  a.current = a.primary || 'p9';
  a.mag = { p9: 12, vk9: 30, ar77: 30, lw50: 5 };
  a.reserve = { p9: 48, vk9: 120, ar77: 90, lw50: 15 };
  // Grenades and armour carry over: only spent ones are gone.
  a.path = []; a.pathIdx = 0;
  a.lastSeenByPlayer = -99;
  if (a.mesh) { a.mesh.visible = true; a.mesh.rotation.set(0, 0, 0); a.mesh.position.set(x, 0, z); }
}

// Damage one actor. Returns true if this killed them. Handles armor, killfeed,
// rewards and bomb drops; the caller records stats.
export function damageActor(state, victim, dmg, headshot, attacker) {
  if (!victim.alive) return false;
  const r = applyArmor(dmg, headshot, victim.armor, victim.helmet);
  victim.armor = Math.max(0, victim.armor - r.armorUsed);
  victim.hp -= r.hp;
  if (attacker && attacker.isPlayer) state.stats.damage += r.hp;
  if (victim.hp <= 0) {
    victim.hp = 0; victim.alive = false; victim.deathTime = state.time;
    victim.reloading = 0;
    if (state.bomb.carrier === victim) {
      state.bomb.state = 'dropped';
      state.bomb.carrier = null;
      state.bomb.x = victim.x; state.bomb.z = victim.z;
    }
    const killer = attacker ? attacker.name : 'the blast';
    state.killfeed.unshift({
      text: `${killer} ${headshot ? '◉' : '✕'} ${victim.name}`,
      team: attacker ? attacker.team : -1, time: state.time,
    });
    if (state.killfeed.length > 6) state.killfeed.pop();
    if (attacker && attacker.isPlayer) {
      state.stats.kills++;
      attacker.money += 300;
      state.events.push({ type: 'kill', victim: victim.id });
    }
    if (victim.isPlayer) {
      state.stats.deaths++;
      state.events.push({ type: 'playerDied' });
    }
    if (victim.mesh) victim.mesh.rotation.x = -Math.PI / 2;
    return true;
  }
  return false;
}

// --- Player controller: one fixed step of input -> movement + weapon use. ---
export function updatePlayer(state, input, dt) {
  const p = state.player;
  if (!p.alive) return;
  // Look (mouse deltas are consumed once per step; recoil rides on top).
  p.yaw -= input.mouseDX * 0.0022;
  p.pitch = clamp(p.pitch - input.mouseDY * 0.0022, -1.55, 1.55);
  p.recoil = Math.max(0, p.recoil - dt * 0.09);
  p.bloom = Math.max(0, p.bloom - dt * 0.05);
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.switchCooldown = Math.max(0, p.switchCooldown - dt);

  const keys = input.keys;
  p.crouching = keys.has('ControlLeft') || keys.has('KeyC');
  p.ads = input.aiming && p.current !== 'he';
  const targetHeight = p.crouching ? 1.15 : 1.75;
  p.height += (targetHeight - p.height) * Math.min(1, dt * 12);

  // Wish direction from keys, relative to facing.
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = 0, wz = 0;
  if (keys.has('KeyW')) { wx -= sin; wz -= cos; }
  if (keys.has('KeyS')) { wx += sin; wz += cos; }
  if (keys.has('KeyA')) { wx -= cos; wz += sin; }
  if (keys.has('KeyD')) { wx += cos; wz -= sin; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const maxSpeed = p.crouching ? CROUCH_SPEED : p.ads ? 2.6 : WALK_SPEED;
  const accel = p.onGround ? 42 : 9;
  p.vx += wx * accel * dt;
  p.vz += wz * accel * dt;
  // Friction + speed cap on the ground; air keeps its momentum.
  if (p.onGround) {
    const f = Math.max(0, 1 - 10 * dt);
    p.vx *= f; p.vz *= f;
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > maxSpeed) { p.vx *= maxSpeed / sp; p.vz *= maxSpeed / sp; }
  }
  if (input.pressed.has('Space') && p.onGround && !p.crouching) {
    p.vy = JUMP_SPEED; p.onGround = false;
  }
  p.vy -= GRAVITY * dt;
  p.onGround = moveActor(p, dt);
  p.walkPhase += Math.hypot(p.vx, p.vz) * dt * 1.6;
  if (p.onGround && Math.hypot(p.vx, p.vz) > 2 && Math.random() < dt * 3) audio.playStep(null);

  // Weapon switching (Digit1 primary, Digit2 pistol, Digit4 grenade, wheel cycles).
  if (input.pressed.has('Digit1') && p.primary) switchWeapon(p, p.primary);
  if (input.pressed.has('Digit2')) switchWeapon(p, 'p9');
  if (input.pressed.has('Digit4') && p.grenades > 0) switchWeapon(p, 'he');
  if (input.wheel !== 0) {
    const order = [p.primary, 'p9', p.grenades > 0 ? 'he' : null].filter(Boolean);
    if (order.length > 1) {
      let i = order.indexOf(p.current);
      i = (i + (input.wheel > 0 ? 1 : -1) + order.length) % order.length;
      switchWeapon(p, order[i]);
    }
  }

  // Reload
  const w = WEAPONS[p.current];
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      const need = w.mag - p.mag[p.current];
      const take = Math.min(need, p.reserve[p.current]);
      p.mag[p.current] += take; p.reserve[p.current] -= take;
    }
  } else if (input.pressed.has('KeyR') && p.mag[p.current] < w.mag && p.reserve[p.current] > 0 && !w.grenade) {
    p.reloading = w.reload;
    audio.playReload();
  }

  // Fire. Semi-auto weapons need a fresh click; autos fire while held.
  const wantFire = w.auto ? input.firing : input.firing && !p.prevFiring;
  p.prevFiring = input.firing;
  if (wantFire && p.fireCooldown <= 0 && p.reloading <= 0 && p.switchCooldown <= 0) {
    if (w.grenade) {
      throwGrenade(state, p);
      p.grenades--;
      p.fireCooldown = 0.9;
      switchWeapon(p, p.primary || 'p9');
    } else if (p.mag[p.current] > 0) {
      p.mag[p.current]--;
      p.fireCooldown = 60 / w.rpm;
      const speed = Math.hypot(p.vx, p.vz);
      const spread = shotSpread(w, speed, !p.onGround, p.ads, p.bloom);
      const aimPitch = p.pitch + p.recoil;
      fireHitscan(state, p, w, p.yaw, aimPitch, spread);
      p.recoil = Math.min(p.recoil + w.recoil, 0.14);
      p.bloom = Math.min(p.bloom + w.recoil * 0.9, 0.06);
      state.shake = Math.min(state.shake + w.kick * 0.5, 0.03);
      audio.playShot(w.sound, null);
      state.shots.push({ x: p.x, z: p.z, time: state.time, team: p.team });
      if (p.mag[p.current] === 0 && p.reserve[p.current] > 0) { p.reloading = w.reload; audio.playReload(); }
    } else {
      p.fireCooldown = 0.25;
      audio.playDryFire();
      if (p.reserve[p.current] > 0) { p.reloading = w.reload; audio.playReload(); }
    }
  }
}

export function switchWeapon(p, id) {
  if (p.current === id || p.switchCooldown > 0) return;
  p.current = id;
  p.reloading = 0;
  p.ads = false;
  p.switchCooldown = 0.25;
  audio.playClick();
}

// --- Bot bodies: chunky low-poly soldiers, team-coloured vests and helmets. ---
export function createBotMesh(team) {
  const g = new THREE.Group();
  const vest = new THREE.MeshLambertMaterial({ color: TEAM_COLOR[team] });
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262b });
  const skin = new THREE.MeshLambertMaterial({ color: 0xc9a17e });
  const gunMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  box(0.52, 0.72, 0.32, vest, 0, 1.05, 0); // torso / vest
  box(0.34, 0.3, 0.34, skin, 0, 1.58, 0); // head
  box(0.4, 0.12, 0.4, vest, 0, 1.76, 0); // helmet brim
  const legL = box(0.2, 0.68, 0.24, dark, -0.14, 0.34, 0);
  const legR = box(0.2, 0.68, 0.24, dark, 0.14, 0.34, 0);
  box(0.14, 0.14, 0.7, gunMat, 0.2, 1.25, -0.35); // rifle pointing forward (-z local)
  g.userData.legL = legL;
  g.userData.legR = legR;
  return g;
}

// Sync a bot's mesh to its simulated body (called from the render step).
export function syncBotMesh(a) {
  if (!a.mesh) return;
  const m = a.mesh;
  m.position.set(a.x, a.y, a.z);
  if (a.alive) {
    m.rotation.set(0, a.yaw, 0);
    const swing = Math.min(Math.hypot(a.vx, a.vz) / WALK_SPEED, 1) * 0.5;
    m.userData.legL.rotation.x = Math.sin(a.walkPhase * 2) * swing;
    m.userData.legR.rotation.x = -Math.sin(a.walkPhase * 2) * swing;
    m.scale.y = a.crouching ? 0.72 : 1;
    m.visible = true;
  }
}
