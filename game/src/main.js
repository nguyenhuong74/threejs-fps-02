// main.js — bootstrap and the game loop. The simulation runs at a fixed 60 Hz
// step, apart from rendering: sim(state, dt) mutates state, render() only
// copies it into THREE objects and the DOM. No allocations in the hot loop.
import * as THREE from 'three';
import { createState, STEP } from './state.js';
import { buildMap } from './map.js';
import { WEAPONS } from './weapons.js';
import { createBotMesh, syncBotMesh, updatePlayer } from './actors.js';
import { updateBots } from './bots.js';
import { updateGrenades } from './combat.js';
import { setupMatch, startRound, updateRounds, buyItem } from './rounds.js';
import { createEffects, updateEffects } from './effects.js';
import { createInput } from './input.js';
import { createHud, showScreen, showBanner, updateHud, fillMatchEnd } from './hud.js';
import * as audio from './audio.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // menu | play | buy | end — stages a real state for screenshots
const DEMO = params.get('demo') === '1';

const state = createState();
state.shotMode = SHOT;
state.demo = DEMO;

// --- Renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.id = 'game-canvas';
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdd8e4);
scene.fog = new THREE.Fog(0xcdd8e4, 55, 130);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 300);
scene.add(new THREE.HemisphereLight(0xbcd3e6, 0x8a7a5f, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(30, 50, 20);
scene.add(sun);
buildMap(scene);
const fx = createEffects(scene);

// Bomb prop: a small charge with a blinking light, shown when dropped/planted.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshLambertMaterial({ color: 0x2a2d31 }),
);
bombBody.position.y = 0.15;
bombMesh.add(bombBody);
const bombLight = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.12),
  new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
);
bombLight.position.y = 0.36;
bombMesh.add(bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Grenade props, one mesh per live grenade.
const grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x3a5a3a });
const grenadeMeshes = [];

// First-person viewmodel: a compact gun built from boxes, parented to the camera.
// Kept small and pushed out to z=-0.7: a long gun close to the lens fills the
// screen through perspective, so the body is short and the muzzle far.
const viewmodel = new THREE.Group();
const vmMat = new THREE.MeshLambertMaterial({ color: 0x4a5058 });
const vmAccent = new THREE.MeshLambertMaterial({ color: 0x2fd4a7 });
const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.25), vmMat);
const vmBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.18), vmMat);
const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.055), vmMat);
const vmSight = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.04, 0.07), vmAccent);
vmBody.position.set(0, 0, 0);
vmBarrel.position.set(0, 0.012, -0.2);
vmGrip.position.set(0, -0.09, 0.07);
vmSight.position.set(0, 0.06, -0.03);
viewmodel.add(vmBody, vmBarrel, vmGrip, vmSight);
viewmodel.position.set(0.26, -0.28, -0.7);
camera.add(viewmodel);
// A soft light at the camera so the viewmodel reads instead of going black.
const vmLight = new THREE.PointLight(0xffffff, 1.6, 4, 1.5);
camera.add(vmLight);
scene.add(camera);

// --- Input / HUD ------------------------------------------------------------
const input = createInput(renderer.domElement);
let expectUnlock = false; // opening the buy menu exits the lock on purpose

const hud = createHud(state, {
  play: () => {
    audio.initAudio(); audio.resumeAudio();
    startGame();
  },
  resume: () => {
    state.paused = false;
    showScreen(hud, 'game');
    input.lock();
  },
  restart: () => {
    audio.initAudio(); audio.resumeAudio();
    startGame();
  },
  toMenu: () => {
    state.phase = 'menu';
    state.paused = false;
    showScreen(hud, 'menu');
  },
});

input.onLockChange = (locked) => {
  if (!locked && !expectUnlock && !state.demo && !state.shotMode &&
      (state.phase === 'buy' || state.phase === 'live') && !state.paused) {
    state.paused = true;
    showScreen(hud, 'pause');
  }
  expectUnlock = false;
};

input.onKey = (code) => {
  if (code === 'KeyB' && (state.phase === 'buy') && state.player && state.player.alive) {
    state.buyOpen = !state.buyOpen;
    if (state.buyOpen) { expectUnlock = true; input.unlock(); }
    else input.lock();
  }
  if (state.buyOpen && code.startsWith('Digit')) {
    const n = code.slice(5);
    const item = { 2: 'vk9', 3: 'ar77', 4: 'lw50', 5: 'he', 6: 'kevlar', 7: 'helmet', 8: 'ammo' }[n];
    if (item) document.getElementById('hint').textContent = buyItem(state, item);
  }
  if (code === 'Escape' && state.buyOpen) {
    state.buyOpen = false;
    input.lock();
  }
};

// --- Flow -------------------------------------------------------------------
function attachMeshes() {
  for (const a of state.actors) {
    if (a.isPlayer) continue;
    if (!a.mesh) { a.mesh = createBotMesh(a.team); scene.add(a.mesh); }
    a.mesh.visible = true;
    a.mesh.rotation.set(0, 0, 0);
  }
}

function startGame() {
  setupMatch(state);
  attachMeshes();
  startRound(state);
  showScreen(hud, 'game');
  input.lock();
}

function processEvents() {
  for (const e of state.events) {
    if (e.type === 'roundStart') {
      showBanner(state, `ROUND ${e.round}`, 'Vipers plant the charge — Wardens hold the yard', -1, 3);
    } else if (e.type === 'live') {
      showBanner(state, 'GO', '', -1, 1.2);
    } else if (e.type === 'roundEnd') {
      showBanner(state, e.winner === 0 ? 'VIPERS WIN THE ROUND' : 'WARDENS WIN THE ROUND', e.reason, e.winner, 4);
    } else if (e.type === 'planted') {
      showBanner(state, `CHARGE PLANTED AT ${e.site}`, 'Wardens: defuse it. Vipers: guard it.', 0, 3);
    } else if (e.type === 'defused') {
      showBanner(state, 'CHARGE DEFUSED', '', 1, 3);
    } else if (e.type === 'detonated') {
      showBanner(state, 'CHARGE DETONATED', '', 0, 3);
    } else if (e.type === 'pickup') {
      document.getElementById('hint').textContent = 'Picked up the charge';
    } else if (e.type === 'playerDied') {
      const mate = state.actors.find((a) => a.team === 0 && a.alive && !a.isPlayer);
      state.spectate = mate ? mate.id : -1;
    } else if (e.type === 'matchEnd') {
      fillMatchEnd(hud, state);
      showScreen(hud, 'matchEnd');
      input.unlock();
    }
  }
  state.events.length = 0;
}

// --- Simulation (fixed step) -------------------------------------------------
function sim(dt) {
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 0.25);
  updateRounds(state, input, dt);
  if (state.phase === 'buy' || state.phase === 'live') {
    if (state.player.alive) updatePlayer(state, input, dt);
    if (state.phase === 'live') {
      updateBots(state, dt);
      updateGrenades(state, dt);
    }
  }
  // Forget old gunshots (bots only react to fresh ones).
  while (state.shots.length && state.time - state.shots[0].time > 2) state.shots.shift();
  input.endStep();
}

// --- Render ------------------------------------------------------------------
const _v = new THREE.Vector3();
let fovTarget = 75;
let menuAngle = 0;

function render(dt) {
  const p = state.player;
  if (state.phase === 'menu' || !p) {
    // Slow orbit over the yard behind the start screen.
    menuAngle += dt * 0.05;
    camera.position.set(Math.sin(menuAngle) * 42, 26, Math.cos(menuAngle) * 42);
    camera.lookAt(0, 0, -5);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    viewmodel.visible = false;
  } else if (state.demo) {
    // Attract mode: follow a random living attacker from behind.
    const follow = state.actors.find((a) => a.team === 0 && a.alive && !a.isPlayer) || p;
    camera.position.set(follow.x + Math.sin(follow.yaw) * 4, follow.y + 3, follow.z + Math.cos(follow.yaw) * 4);
    camera.lookAt(follow.x, follow.y + 1.2, follow.z);
    viewmodel.visible = false;
  } else if (p.alive) {
    const speed = Math.hypot(p.vx, p.vz);
    const bob = Math.min(speed / 4.3, 1) * (p.onGround ? 1 : 0);
    const bobY = Math.sin(p.walkPhase * 2) * 0.028 * bob;
    const bobX = Math.cos(p.walkPhase) * 0.014 * bob;
    const shX = (Math.random() - 0.5) * state.shake;
    const shY = (Math.random() - 0.5) * state.shake;
    camera.position.set(
      p.x + Math.cos(p.yaw) * bobX,
      p.y + p.height - 0.22 + bobY,
      p.z - Math.sin(p.yaw) * bobX,
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = p.yaw + shX;
    camera.rotation.x = p.pitch + p.recoil + shY;
    camera.rotation.z = 0;
    // Aim-down-sights: narrow the FOV, centre the gun; sniper gets a scope.
    const w = WEAPONS[p.current];
    fovTarget = p.ads ? (w.zoomFov || 55) : 75;
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
    document.getElementById('scope').style.display = p.ads && w.scoped ? 'block' : 'none';
    viewmodel.visible = !(p.ads && w.scoped);
    const adsT = p.ads ? 1 : 0;
    viewmodel.position.x += ((adsT ? 0 : 0.26) - viewmodel.position.x) * Math.min(1, dt * 12);
    viewmodel.position.y += ((adsT ? -0.17 : -0.28) - viewmodel.position.y) * Math.min(1, dt * 12);
    viewmodel.position.z = -0.7 + p.recoil * 0.8 + Math.sin(p.walkPhase * 2) * 0.004 * bob;
    viewmodel.rotation.x = p.recoil * 2;
    // Viewmodel shape follows the current weapon.
    const long = w.id === 'lw50' ? 1.35 : w.id === 'ar77' ? 1.15 : w.id === 'vk9' ? 0.95 : 0.7;
    vmBarrel.scale.z = long;
    vmBarrel.position.z = -0.12 - 0.09 * long;
    vmBody.visible = !w.grenade;
    vmBarrel.visible = !w.grenade;
    vmSight.visible = !w.grenade;
    vmGrip.visible = true;
  } else {
    // Spectate a living teammate from behind.
    const target = state.actors.find((a) => a.id === state.spectate) ||
      state.actors.find((a) => a.alive && !a.isPlayer);
    if (target) {
      _v.set(
        target.x + Math.sin(target.yaw) * 3.2,
        target.y + 2.2,
        target.z + Math.cos(target.yaw) * 3.2,
      );
      camera.position.lerp(_v, Math.min(1, dt * 5));
      camera.lookAt(target.x, target.y + 1.3, target.z);
    }
    viewmodel.visible = false;
  }
  for (const a of state.actors) syncBotMesh(a);
  // Bomb prop.
  const bomb = state.bomb;
  bombMesh.visible = bomb.state === 'dropped' || bomb.state === 'planted';
  if (bombMesh.visible) {
    bombMesh.position.set(bomb.x, 0, bomb.z);
    bombLight.material.color.setHex(
      bomb.state === 'planted' && Math.floor(state.time * (bomb.fuse < 10 ? 4 : 2)) % 2 ? 0xff2a2a : 0x551111,
    );
  }
  // Grenade props follow live grenades.
  while (grenadeMeshes.length < state.grenades.length) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    scene.add(m);
    grenadeMeshes.push(m);
  }
  grenadeMeshes.forEach((m, i) => {
    m.visible = i < state.grenades.length;
    if (m.visible) m.position.set(state.grenades[i].x, state.grenades[i].y, state.grenades[i].z);
  });
  updateEffects(fx, state, dt);
  processEvents();
  updateHud(hud, state, dt);
  renderer.render(scene, camera);
}

// --- Screenshot staging ------------------------------------------------------
// ?shot= stages the game into a real state (menu / live round / buy menu /
// match end) so its own screens can be rendered for screenshots.
function stageShot() {
  if (SHOT === 'menu' || !SHOT) return;
  setupMatch(state);
  attachMeshes();
  if (SHOT === 'buy') {
    startRound(state);
    state.buyOpen = true;
    showScreen(hud, 'game');
  } else if (SHOT === 'play') {
    startRound(state);
    state.phase = 'live';
    state.phaseTime = 0;
    const p = state.player;
    p.primary = 'ar77'; p.current = 'ar77'; p.armor = 100; p.helmet = true;
    p.money = 4250;
    p.x = 4; p.z = 14; p.yaw = 0.35; // mid, angled toward the doors and site A
    // Pull two defenders into mid view and hold them there, facing the player,
    // so the firefight is visible in the screenshot.
    const defs = state.actors.filter((a) => a.team === 1);
    defs[0].x = -2; defs[0].z = -6; defs[0].yaw = Math.PI;
    defs[1].x = 4; defs[1].z = -10; defs[1].yaw = Math.PI;
    for (const d of defs.slice(0, 2)) {
      d.brain.mode = 'hold';
      d.brain.route = [];
      d.brain.holdYaw = Math.PI; // face south, toward the player
    }
    showScreen(hud, 'game');
  } else if (SHOT === 'end') {
    state.score = [8, 6];
    state.matchWinner = 0;
    state.stats = { kills: 14, deaths: 9, shots: 210, hits: 88, damage: 3420, plants: 2, defuses: 0 };
    state.phase = 'matchEnd';
    fillMatchEnd(hud, state);
    showScreen(hud, 'matchEnd');
  }
}

// --- Main loop ---------------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!state.paused && (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd')) {
    acc += frameDt;
    let steps = 0;
    while (acc >= STEP && steps < 5) { sim(STEP); acc -= STEP; steps++; }
    if (steps === 5) acc = 0;
  } else if (state.demo && state.phase !== 'menu') {
    acc += frameDt;
    while (acc >= STEP) { sim(STEP); acc -= STEP; }
  }
  input.endFrame();
  render(frameDt);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Boot.
if (DEMO) {
  setupMatch(state);
  attachMeshes();
  startRound(state);
  state.phase = 'live';
  state.phaseTime = 0;
  showScreen(hud, 'game');
} else if (SHOT) {
  stageShot();
  if (SHOT === 'menu') showScreen(hud, 'menu');
} else {
  showScreen(hud, 'menu');
}
requestAnimationFrame(frame);
