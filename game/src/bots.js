// bots.js — bot brains: routes, holds, perception (sight + hearing), aiming,
// planting and defusing. Bots follow the waypoint graph, hold angles, react to
// gunfire, and converge on the bomb. All decisions here; shooting via combat.js.
import { WAYPOINTS, nearestNode, findPath, hasLineOfSight, moveActor, SITES } from './map.js';
import { WEAPONS, shotSpread } from './weapons.js';
import { fireHitscan } from './combat.js';
import { clamp, angleLerp, dist2, makeRng, ROUND_TIME } from './state.js';
import * as audio from './audio.js';

const BOT_SPEED = 3.8;
const EYE = 1.55; // bot eye height above feet
const FOV = 1.9; // ~109 degrees of vision
const SIGHT_RANGE = 70;

// Lane definitions: [via node, site node]. findPath stitches spawn->via->site.
const LANES = {
  aLong: [5, 11], aShort: [13, 11], bLong: [34, 31], bShort: [27, 31],
  midA: [19, 11], midB: [19, 31],
};
const A_HOLDS = [41, 42, 43];
const B_HOLDS = [44, 45, 46];

function routeVia(fromNode, via, to) {
  const a = findPath(fromNode, via);
  const b = findPath(via, to);
  return a.concat(b);
}

export function newBrain(role) {
  return {
    role, mode: 'route', route: [], routeIdx: 0,
    target: null, lastSeen: -99, reactUntil: 0,
    aimErr: 0.06, burstLeft: 0, burstPauseUntil: 0,
    nextScan: Math.random() * 0.1, holdYaw: 0, holdNode: -1,
    strafeDir: 1, strafeUntil: 0, hear: null, site: null,
    reloadUntil: 0, plantWait: 0,
  };
}

// Assign roles and routes at round start. Attackers pick a split at random;
// defenders hold: two per site, one mid.
export function assignBotRoles(state) {
  const rng = makeRng(state.round * 7919 + 13);
  const attackers = state.actors.filter((a) => a.team === 0 && !a.isPlayer);
  const defenders = state.actors.filter((a) => a.team === 1);
  const strats = [
    ['aLong', 'aShort', 'bLong', 'midB'],
    ['aLong', 'aShort', 'bShort', 'midA'],
    ['aLong', 'bLong', 'bShort', 'midA'],
    ['aShort', 'bShort', 'midA', 'midB'],
  ];
  const strat = strats[Math.floor(rng() * strats.length)];
  attackers.forEach((a, i) => {
    const lane = LANES[strat[i % strat.length]];
    a.brain = newBrain(strat[i % strat.length]);
    a.brain.site = lane[1] === 11 ? 'A' : 'B';
    a.brain.route = routeVia(nearestNode(a.x, a.z), lane[0], lane[1]);
    a.brain.routeIdx = 0;
    a.primary = i === 3 ? 'lw50' : i === 1 ? 'vk9' : 'ar77';
    a.current = a.primary;
  });
  defenders.forEach((a, i) => {
    const hold = i < 2 ? A_HOLDS[i] : i < 4 ? B_HOLDS[i - 2] : (state.round % 2 ? 47 : 48);
    a.brain = newBrain(i < 2 ? 'holdA' : i < 4 ? 'holdB' : 'holdMid');
    a.brain.holdNode = hold;
    a.brain.route = findPath(nearestNode(a.x, a.z), hold);
    a.brain.routeIdx = 0;
    a.primary = i === 4 ? 'lw50' : i === 1 ? 'vk9' : 'ar77';
    a.current = a.primary;
    a.brain.holdYaw = Math.PI; // face south: attackers come from +z
  });
}

function visibleEnemy(state, bot) {
  const ex = bot.x, ey = bot.y + EYE, ez = bot.z;
  let best = null, bestD = SIGHT_RANGE * SIGHT_RANGE;
  for (const e of state.actors) {
    if (e.team === bot.team || !e.alive) continue;
    const d2 = dist2(ex, ez, e.x, e.z);
    if (d2 > bestD) continue;
    const yawTo = Math.atan2(-(e.x - ex), -(e.z - ez));
    let dyaw = yawTo - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    if (Math.abs(dyaw) > FOV / 2) continue;
    if (!hasLineOfSight(ex, ey, ez, e.x, e.y + 1.2, e.z)) continue;
    best = e; bestD = d2;
  }
  return best;
}

function moveToward(state, bot, tx, tz, dt, speed) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const want = Math.atan2(-dx, -dz);
  bot.yaw = angleLerp(bot.yaw, want, Math.min(1, dt * 8));
  bot.vx = (dx / d) * speed;
  bot.vz = (dz / d) * speed;
  bot.vy -= 14 * dt;
  bot.onGround = moveActor(bot, dt);
  bot.walkPhase += speed * dt * 1.6;
  return d < 0.7;
}

function followRoute(state, bot, dt) {
  const b = bot.brain;
  if (b.routeIdx >= b.route.length) return true;
  const [wx, wz] = WAYPOINTS[b.route[b.routeIdx]];
  if (moveToward(state, bot, wx, wz, dt, BOT_SPEED)) b.routeIdx++;
  return b.routeIdx >= b.route.length;
}

function stopBot(bot) { bot.vx = 0; bot.vz = 0; }

function startEngage(bot, enemy, state) {
  const b = bot.brain;
  if (b.target !== enemy) {
    b.target = enemy;
    // Attackers push and react a touch faster; holders are dug in but slower.
    b.reactUntil = state.time + (bot.team === 0 ? 0.25 : 0.35) + Math.random() * 0.3;
    b.aimErr = 0.05 + Math.random() * 0.03;
    b.burstLeft = 0;
  }
  b.lastSeen = state.time;
  enemy.lastSeenByPlayer = state.time; // teammates share what they see
}

function updateCombat(state, bot, dt) {
  const b = bot.brain;
  const t = b.target;
  if (!t || !t.alive) { b.target = null; return; }
  // Aim at the chest (sometimes the head), error shrinking while tracking.
  const aimY = Math.random() < 0.15 ? t.y + t.height - 0.15 : t.y + 1.1;
  const dx = t.x - bot.x, dy = aimY - (bot.y + EYE), dz = t.z - bot.z;
  const dist = Math.hypot(dx, dy, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.asin(clamp(dy / dist, -1, 1));
  bot.yaw = angleLerp(bot.yaw, wantYaw, Math.min(1, dt * 7));
  bot.pitch += (wantPitch - bot.pitch) * Math.min(1, dt * 7);
  b.aimErr = Math.max(bot.team === 0 ? 0.008 : 0.012, b.aimErr - dt * 0.08);
  // Strafe in combat; holders drop to a crouch behind cover.
  if (state.time > b.strafeUntil) {
    b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    b.strafeUntil = state.time + 0.5 + Math.random() * 0.8;
  }
  const sx = Math.cos(bot.yaw) * b.strafeDir, sz = -Math.sin(bot.yaw) * b.strafeDir;
  bot.vx = sx * 1.6; bot.vz = sz * 1.6;
  bot.vy -= 14 * dt;
  bot.onGround = moveActor(bot, dt);
  bot.crouching = b.mode === 'hold' && bot.id % 2 === 0;
  // Fire in bursts once reacted.
  const w = WEAPONS[bot.current];
  if (state.time < b.reactUntil || bot.reloading > 0) return;
  if (bot.mag[bot.current] <= 0) {
    bot.reloading = w.reload; // updateBots refills the mag when this hits 0
    return;
  }
  if (b.burstLeft <= 0) {
    if (state.time < b.burstPauseUntil) return;
    b.burstLeft = w.auto ? 3 + Math.floor(Math.random() * 4) : 1;
  }
  if (bot.fireCooldown > 0) return;
  bot.fireCooldown = 60 / w.rpm;
  bot.mag[bot.current]--;
  b.burstLeft--;
  if (b.burstLeft <= 0) b.burstPauseUntil = state.time + 0.4 + Math.random() * 0.6;
  const spread = shotSpread(w, 1.6, false, false, 0) + b.aimErr;
  fireHitscan(state, bot, w, bot.yaw, bot.pitch, spread);
  const pd = Math.hypot(state.player.x - bot.x, state.player.z - bot.z);
  audio.playShot(w.sound, pd);
  state.shots.push({ x: bot.x, z: bot.z, time: state.time, team: bot.team });
  b.aimErr = Math.min(b.aimErr + w.recoil * 0.8, 0.06);
}

export function updateBots(state, dt) {
  for (const bot of state.actors) {
    if (bot.isPlayer || !bot.alive) continue;
    const b = bot.brain;
    if (!b) continue;
    bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
    if (bot.reloading > 0) {
      bot.reloading -= dt;
      if (bot.reloading <= 0) bot.mag[bot.current] = WEAPONS[bot.current].mag;
    }
    // Staggered perception: sight, then hearing.
    if (state.time >= b.nextScan) {
      b.nextScan = state.time + 0.1 + Math.random() * 0.05;
      const seen = visibleEnemy(state, bot);
      if (seen) startEngage(bot, seen, state);
      else if (b.target && state.time - b.lastSeen > 1.2) b.target = null;
      if (!b.target && !b.hear) {
        for (let i = state.shots.length - 1; i >= 0; i--) {
          const s = state.shots[i];
          if (state.time - s.time > 1.5) break;
          if (s.team === bot.team) continue;
          const d2 = dist2(bot.x, bot.z, s.x, s.z);
          if (d2 < 30 * 30 && Math.random() < 0.6) {
            b.hear = { x: s.x, z: s.z, until: state.time + 4 };
            break;
          }
        }
      }
    }
    // Bomb logic overrides routing.
    const bomb = state.bomb;
    if (bot.team === 0) {
      if (bomb.state === 'dropped' && b.mode !== 'pickup') {
        // Nearest living attacker fetches the dropped charge.
        const others = state.actors.filter((a) => a.team === 0 && a.alive && !a.isPlayer && a.brain.mode === 'pickup');
        if (others.length === 0) {
          b.mode = 'pickup';
          b.route = findPath(nearestNode(bot.x, bot.z), nearestNode(bomb.x, bomb.z));
          b.routeIdx = 0;
        }
      }
      if (bomb.state === 'carried' && bomb.carrier === bot && b.mode !== 'plant') {
        // Only (re)path when the bot has no route left: repathing every step
        // from the nearest node can send it back to the node it just left.
        if (b.route.length === 0 || b.routeIdx >= b.route.length) {
          b.mode = 'route';
          const site = b.site || 'A';
          const node = site === 'A' ? 11 : 31;
          b.route = routeVia(nearestNode(bot.x, bot.z), site === 'A' ? 13 : 27, node);
          b.routeIdx = 0;
        }
      }
      if (bomb.state === 'planted') b.mode = 'guard';
    } else if (bomb.state === 'planted') {
      if (b.mode !== 'retake' && b.mode !== 'defuse') {
        b.mode = 'retake';
        const node = bomb.site === 'A' ? 11 : 31;
        b.route = findPath(nearestNode(bot.x, bot.z), node);
        b.routeIdx = 0;
      }
    } else if (state.phase === 'live' && state.phaseTime > ROUND_TIME - 25) {
      // Clock nearly out and no bomb down: defenders hunt the last Vipers
      // instead of watching the clock run out.
      if (b.mode !== 'hunt' || state.time > (b.repathUntil || 0)) {
        const foe = state.actors.filter((a) => a.team === 0 && a.alive)
          .sort((x, y) => dist2(bot.x, bot.z, x.x, x.z) - dist2(bot.x, bot.z, y.x, y.z))[0];
        if (foe) {
          b.mode = 'hunt';
          b.route = findPath(nearestNode(bot.x, bot.z), nearestNode(foe.x, foe.z));
          b.routeIdx = 0;
          b.repathUntil = state.time + 2;
        }
      }
    }

    if (b.target) { updateCombat(state, bot, dt); continue; }
    stopBot(bot);
    bot.crouching = false;
    if (b.mode === 'route' || b.mode === 'pickup' || b.mode === 'retake' || b.mode === 'hunt') {
      const done = followRoute(state, bot, dt);
      if (done) {
        if (b.mode === 'pickup') {
          if (Math.hypot(bot.x - bomb.x, bot.z - bomb.z) < 2 && bomb.state === 'dropped') {
            bomb.state = 'carried'; bomb.carrier = bot;
            b.mode = 'route';
            const site = b.site || 'A';
            b.route = routeVia(nearestNode(bot.x, bot.z), site === 'A' ? 13 : 27, site === 'A' ? 11 : 31);
            b.routeIdx = 0;
          } else b.mode = 'route';
        } else if (b.mode === 'retake') {
          b.mode = 'defuse';
        } else if (b.mode === 'hunt') {
          b.repathUntil = 0; // repath to the foe's new position next step
        } else if (bot.team === 0) {
          b.mode = 'plant';
          b.plantWait = state.time + 1;
        } else {
          b.mode = 'hold';
        }
      }
    } else if (b.mode === 'plant') {
      const site = SITES[b.site || 'A'];
      const inSite = dist2(bot.x, bot.z, site.x, site.z) < site.r * site.r;
      if (!inSite) { moveToward(state, bot, site.x, site.z, dt, BOT_SPEED); }
      else if (bomb.state === 'carried' && bomb.carrier === bot) {
        // Wait for the site to look clear, then stand still and plant.
        bot.yaw = angleLerp(bot.yaw, b.holdYaw, Math.min(1, dt * 3));
      } else if (bomb.state === 'carried' && bomb.carrier && bomb.carrier !== bot) {
        // Escort: hold the site entrance.
        bot.yaw = angleLerp(bot.yaw, b.holdYaw, Math.min(1, dt * 3));
      }
    } else if (b.mode === 'defuse') {
      const d = Math.hypot(bot.x - bomb.x, bot.z - bomb.z);
      if (d > 2.2) moveToward(state, bot, bomb.x, bomb.z, dt, BOT_SPEED);
      // Standing on the bomb: rounds.js advances the defuse.
    } else if (b.mode === 'guard') {
      const site = SITES[bomb.site || 'A'];
      if (dist2(bot.x, bot.z, site.x, site.z) > 10 * 10) moveToward(state, bot, site.x, site.z, dt, BOT_SPEED);
      else bot.yaw += dt * 0.4; // slow scan
    } else if (b.mode === 'hold') {
      bot.yaw = angleLerp(bot.yaw, b.holdYaw, Math.min(1, dt * 2));
      if (b.hear && state.time < b.hear.until) {
        moveToward(state, bot, b.hear.x, b.hear.z, dt, BOT_SPEED);
        if (Math.hypot(bot.x - b.hear.x, bot.z - b.hear.z) < 2) b.hear = null;
      }
    }
    if (b.hear && state.time >= b.hear.until) b.hear = null;
  }
  // Separation so bots do not stack on each other.
  const bots = state.actors;
  for (let i = 0; i < bots.length; i++) {
    if (!bots[i].alive) continue;
    for (let j = i + 1; j < bots.length; j++) {
      if (!bots[j].alive) continue;
      const dx = bots[j].x - bots[i].x, dz = bots[j].z - bots[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.64 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (0.8 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        bots[i].x -= nx * push; bots[i].z -= nz * push;
        bots[j].x += nx * push; bots[j].z += nz * push;
      }
    }
  }
}
