// effects.js — purely visual: tracers, impact puffs, muzzle flashes and
// explosions. It reads state.tracers / state.impacts / state.events and owns
// pooled THREE objects, so the sim never allocates in its hot loops.
import * as THREE from 'three';

const MAX_TRACERS = 40;
const MAX_PARTICLES = 400;

export function createEffects(scene) {
  const fx = {
    scene,
    tracers: [],
    particles: [],
    flash: null,
    flashUntil: 0,
    explosion: null,
    explosionUntil: 0,
  };
  // Tracer pool: one Line per tracer, reused round-robin.
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    fx.tracers.push({ line, until: 0 });
  }
  // Particle pool: one THREE.Points, positions/velocities in typed arrays.
  const pgeo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX_PARTICLES * 3);
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
  const points = new THREE.Points(pgeo, pmat);
  points.frustumCulled = false;
  scene.add(points);
  fx.points = points;
  fx.pVel = new Float32Array(MAX_PARTICLES * 3);
  fx.pLife = new Float32Array(MAX_PARTICLES);
  fx.pNext = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) pos[i * 3 + 1] = -100; // park below ground
  // Muzzle flash: a small additive sprite at the gun tip.
  const flashMat = new THREE.SpriteMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  fx.flash = new THREE.Sprite(flashMat);
  fx.flash.scale.set(0.5, 0.5, 1);
  scene.add(fx.flash);
  // Explosion: an expanding additive sphere.
  fx.explosion = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff9a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  fx.explosion.visible = false;
  scene.add(fx.explosion);
  fx.light = new THREE.PointLight(0xff9a2a, 0, 40, 1.5);
  scene.add(fx.light);
  return fx;
}

function spawnParticles(fx, x, y, z, n, color, speed) {
  const pos = fx.points.geometry.attributes.position.array;
  for (let k = 0; k < n; k++) {
    const i = fx.pNext;
    fx.pNext = (fx.pNext + 1) % MAX_PARTICLES;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
    fx.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * speed;
    fx.pVel[i * 3 + 1] = Math.cos(ph) * speed + 1;
    fx.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * speed;
    fx.pLife[i] = 0.35 + Math.random() * 0.3;
  }
  fx.points.material.color.setHex(color);
  fx.points.geometry.attributes.position.needsUpdate = true;
}

let tracerIdx = 0;
export function updateEffects(fx, state, dt) {
  // New tracers from the sim (consumed here, list cleared each frame).
  for (const t of state.tracers) {
    const slot = fx.tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % MAX_TRACERS;
    const pos = slot.line.geometry.attributes.position.array;
    pos[0] = t.x1; pos[1] = t.y1; pos[2] = t.z1;
    pos[3] = t.x2; pos[4] = t.y2; pos[5] = t.z2;
    slot.line.geometry.attributes.position.needsUpdate = true;
    slot.line.visible = true;
    slot.line.material.opacity = 0.85;
    slot.until = state.time + 0.07;
    // Muzzle flash at the tracer's start.
    fx.flash.position.set(t.x1, t.y1, t.z1);
    fx.flash.material.opacity = 0.95;
    fx.flashUntil = state.time + 0.05;
  }
  state.tracers.length = 0;
  for (const slot of fx.tracers) {
    if (slot.line.visible && state.time > slot.until) slot.line.visible = false;
  }
  if (fx.flash.material.opacity > 0 && state.time > fx.flashUntil) fx.flash.material.opacity = 0;
  // Impacts: dust on walls, red on flesh.
  for (const im of state.impacts) {
    spawnParticles(fx, im.x, im.y, im.z, im.flesh ? 8 : 5, im.flesh ? 0xc22e2e : 0xd8cdb8, im.flesh ? 1.6 : 2.4);
  }
  state.impacts.length = 0;
  // Explosion events from the sim.
  for (const e of state.events) {
    if (e.type === 'explosion') {
      fx.explosion.visible = true;
      fx.explosion.position.set(e.x, e.y, e.z);
      fx.explosion.scale.setScalar(0.5);
      fx.explosionUntil = state.time + 0.6;
      fx.light.position.set(e.x, e.y + 2, e.z);
      fx.light.intensity = 60;
      spawnParticles(fx, e.x, e.y, e.z, 60, 0xff9a2a, 7);
    }
  }
  if (fx.explosion.visible) {
    const remain = fx.explosionUntil - state.time;
    if (remain <= 0) { fx.explosion.visible = false; fx.light.intensity = 0; }
    else {
      const t = 1 - remain / 0.6;
      fx.explosion.scale.setScalar(0.5 + t * 9);
      fx.explosion.material.opacity = 0.7 * (1 - t);
      fx.light.intensity = 60 * (1 - t);
    }
  }
  // Particle physics: gravity, fade by parking dead ones underground.
  const pos = fx.points.geometry.attributes.position.array;
  let moved = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (fx.pLife[i] <= 0) continue;
    fx.pLife[i] -= dt;
    if (fx.pLife[i] <= 0) { pos[i * 3 + 1] = -100; moved = true; continue; }
    fx.pVel[i * 3 + 1] -= 9 * dt;
    pos[i * 3] += fx.pVel[i * 3] * dt;
    pos[i * 3 + 1] += fx.pVel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += fx.pVel[i * 3 + 2] * dt;
    if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; fx.pVel[i * 3 + 1] *= -0.3; }
    moved = true;
  }
  if (moved) fx.points.geometry.attributes.position.needsUpdate = true;
}
