// hud.js — every DOM element the player sees: health/ammo/timer/score,
// killfeed, banners, the buy menu, the minimap and the menu screens.
// Reads state each frame; never writes game state except through callbacks.
import { TEAM_NAME, TEAM_COLOR, clamp } from './state.js';
import { WEAPONS, BUY_ITEMS, shotSpread } from './weapons.js';
import { BOXES, SITES } from './map.js';
import { roundTimeLeft, phaseLabel, aliveCount, buyItem } from './rounds.js';

const $ = (id) => document.getElementById(id);

export function createHud(state, callbacks) {
  const hud = {
    el: {},
    lastKillfeed: -1,
    lastMinimap: 0,
    callbacks,
  };
  const ids = ['start-screen', 'pause-screen', 'match-end-screen', 'hud', 'timer', 'phase-label',
    'score', 'alive-v', 'alive-w', 'health-num', 'health-bar', 'armor-num', 'armor-bar',
    'ammo', 'reserve', 'weapon-name', 'money', 'crosshair', 'hitmarker', 'killfeed',
    'banner', 'banner-title', 'banner-sub', 'minimap', 'plant-wrap', 'plant-fill',
    'plant-label', 'hint', 'vignette', 'buy-menu', 'buy-items', 'buy-money',
    'spectate', 'charge', 'match-title', 'match-stats', 'bomb-timer', 'round-msg'];
  for (const id of ids) hud.el[id] = $(id);
  hud.mm = hud.el['minimap'].getContext('2d');
  // Buttons.
  $('play-btn').addEventListener('click', () => callbacks.play());
  $('resume-btn').addEventListener('click', () => callbacks.resume());
  $('restart-btn').addEventListener('click', () => callbacks.restart());
  $('play-again-btn').addEventListener('click', () => callbacks.restart());
  $('menu-btn').addEventListener('click', () => callbacks.toMenu());
  // Buy menu items (built once; affordability refreshed per frame).
  hud.el['buy-items'].innerHTML = BUY_ITEMS.map((it) => `
    <button class="buy-item" data-id="${it.id}">
      <span class="buy-key">${it.key}</span>
      <span class="buy-name">${it.name}</span>
      <span class="buy-desc">${it.desc}</span>
      <span class="buy-price">$${it.price}</span>
    </button>`).join('');
  hud.el['buy-items'].querySelectorAll('.buy-item').forEach((b) => {
    b.addEventListener('click', () => {
      const msg = buyItem(state, b.dataset.id);
      hud.el['hint'].textContent = msg;
    });
  });
  return hud;
}

export function showScreen(hud, name) {
  hud.el['start-screen'].style.display = name === 'menu' ? 'flex' : 'none';
  hud.el['pause-screen'].style.display = name === 'pause' ? 'flex' : 'none';
  hud.el['match-end-screen'].style.display = name === 'matchEnd' ? 'flex' : 'none';
  hud.el['hud'].style.display = name === 'game' ? 'block' : 'none';
}

export function showBanner(state, text, sub, team, secs = 3) {
  state.banner = { text, sub: sub || '', team, until: state.time + secs };
}

function fmtTime(s) {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function drawMinimap(hud, state) {
  const c = hud.mm;
  const W = 150, H = 124;
  c.clearRect(0, 0, W, H);
  c.fillStyle = 'rgba(10, 14, 12, 0.72)';
  c.fillRect(0, 0, W, H);
  const sx = (x) => (x + 55) / 110 * W;
  const sz = (z) => (z + 45) / 90 * H;
  // Walls and containers.
  c.fillStyle = 'rgba(220, 220, 210, 0.5)';
  for (const b of BOXES) {
    if (b[4] < 2) continue; // crates are not worth drawing
    c.fillRect(sx(b[0] - b[2] / 2), sz(b[1] - b[3] / 2), Math.max(1, b[2] / 110 * W), Math.max(1, b[3] / 90 * H));
  }
  // Sites.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    c.fillStyle = key === 'A' ? '#35e0c8' : '#ffb020';
    c.globalAlpha = 0.85;
    c.beginPath();
    c.arc(sx(s.x), sz(s.z), s.r / 110 * W, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = '#101512';
    c.font = 'bold 10px sans-serif';
    c.textAlign = 'center';
    c.fillText(key, sx(s.x), sz(s.z) + 3);
  }
  // Bomb when dropped or planted.
  const bomb = state.bomb;
  if (bomb.state === 'dropped' || bomb.state === 'planted') {
    c.fillStyle = '#ffe14d';
    const bx = sx(bomb.x), bz = sz(bomb.z);
    c.beginPath();
    c.moveTo(bx, bz - 5); c.lineTo(bx + 4, bz); c.lineTo(bx, bz + 5); c.lineTo(bx - 4, bz);
    c.closePath(); c.fill();
  }
  // Actors: teammates always, enemies only when recently seen.
  for (const a of state.actors) {
    if (!a.alive) continue;
    if (a.isPlayer) continue;
    if (a.team === 1 && state.time - a.lastSeenByPlayer > 3) continue;
    c.fillStyle = a.team === 0 ? '#2fd4a7' : '#ff5a4d';
    c.beginPath();
    c.arc(sx(a.x), sz(a.z), 3, 0, Math.PI * 2);
    c.fill();
  }
  // Player: white wedge facing their yaw.
  const p = state.player;
  if (p.alive) {
    c.save();
    c.translate(sx(p.x), sz(p.z));
    c.rotate(Math.atan2(-Math.sin(p.yaw), -Math.cos(p.yaw)) + Math.PI / 2);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5);
    c.closePath(); c.fill();
    c.restore();
  }
}

export function updateHud(hud, state, dt) {
  const el = hud.el;
  const p = state.player;
  if (!p) return;
  // Top bar.
  el['timer'].textContent = fmtTime(roundTimeLeft(state));
  el['timer'].className = roundTimeLeft(state) < 10 && state.phase === 'live' ? 'urgent' : '';
  el['phase-label'].textContent = phaseLabel(state);
  el['score'].textContent = `${state.score[0]} — ${state.score[1]}`;
  el['alive-v'].textContent = `◆ ${aliveCount(state, 0)}`;
  el['alive-w'].textContent = `◆ ${aliveCount(state, 1)}`;
  // Bottom left: health + armour.
  el['health-num'].textContent = Math.max(0, Math.ceil(p.hp));
  el['health-bar'].style.width = `${clamp(p.hp, 0, 100)}%`;
  el['health-bar'].className = p.hp < 30 ? 'low' : '';
  el['armor-num'].textContent = p.helmet ? `⬡ ${Math.ceil(p.armor)} +H` : p.armor > 0 ? `⬡ ${Math.ceil(p.armor)}` : '';
  el['armor-bar'].style.width = `${clamp(p.armor, 0, 100)}%`;
  // Bottom right: weapon + money.
  const w = WEAPONS[p.current];
  el['weapon-name'].textContent = w.name;
  el['ammo'].textContent = w.grenade ? `${p.grenades}` : `${p.mag[p.current]}`;
  el['reserve'].textContent = w.grenade ? 'throw with LMB' : `/ ${p.reserve[p.current]}`;
  el['ammo'].className = !w.grenade && p.mag[p.current] === 0 ? 'empty' : '';
  el['money'].textContent = `$${p.money}`;
  // Crosshair gap follows the live spread: moving and spraying opens it up.
  const speed = Math.hypot(p.vx, p.vz);
  const spread = shotSpread(w, speed, !p.onGround, p.ads, p.bloom);
  const gap = clamp(4 + spread * 900, 4, 42);
  el['crosshair'].style.setProperty('--gap', `${gap.toFixed(1)}px`);
  el['crosshair'].style.opacity = p.ads && w.scoped ? '0' : '1';
  // Hitmarker: 120 ms, red on a kill.
  const hm = state.time - state.hitmark < 0.12;
  el['hitmarker'].style.opacity = hm ? '1' : '0';
  el['hitmarker'].style.color = state.hitmarkKill ? '#ff4444' : '#ffffff';
  // Killfeed (rebuild only when it changes).
  if (state.killfeed.length !== hud.lastKillfeed || (state.killfeed[0] && state.time - state.killfeed[0].time < 0.2)) {
    hud.lastKillfeed = state.killfeed.length;
    el['killfeed'].innerHTML = state.killfeed.slice(0, 5).map((k) =>
      `<div class="kf" style="--tc:${k.team === 0 ? '#2fd4a7' : k.team === 1 ? '#ffb020' : '#888'}">${k.text}</div>`).join('');
  }
  // Banner.
  if (state.banner && state.time < state.banner.until) {
    el['banner'].style.display = 'block';
    el['banner-title'].textContent = state.banner.text;
    el['banner-title'].style.color = state.banner.team === 0 ? '#2fd4a7' : state.banner.team === 1 ? '#ffb020' : '#fff';
    el['banner-sub'].textContent = state.banner.sub;
  } else {
    el['banner'].style.display = 'none';
  }
  // Plant / defuse progress.
  const bomb = state.bomb;
  let showPlant = false, frac = 0, label = '';
  if (bomb.state === 'carried' && bomb.planter === p && bomb.plantProgress > 0) {
    showPlant = true; frac = bomb.plantProgress; label = 'PLANTING CHARGE…';
  } else if (bomb.state === 'planted' && bomb.defuser) {
    showPlant = true; frac = bomb.defuseProgress; label = 'ENEMY DEFUSING…';
  }
  el['plant-wrap'].style.display = showPlant ? 'block' : 'none';
  if (showPlant) {
    el['plant-fill'].style.width = `${(frac * 100).toFixed(0)}%`;
    el['plant-label'].textContent = label;
  }
  // Bomb status line + hints.
  if (bomb.state === 'planted') {
    el['bomb-timer'].textContent = `☢ CHARGE AT ${bomb.site} — ${bomb.fuse.toFixed(1)}s`;
    el['bomb-timer'].style.display = 'block';
  } else el['bomb-timer'].style.display = 'none';
  if (bomb.state === 'carried' && bomb.carrier === p) {
    el['charge'].textContent = 'YOU CARRY THE CHARGE — plant at A or B (hold E)';
    el['charge'].style.display = 'block';
  } else if (bomb.state === 'dropped') {
    el['charge'].textContent = 'CHARGE DROPPED — pick it up';
    el['charge'].style.display = 'block';
  } else el['charge'].style.display = 'none';
  // Buy menu.
  el['buy-menu'].style.display = state.buyOpen ? 'block' : 'none';
  if (state.buyOpen) {
    el['buy-money'].textContent = `$${p.money}`;
    el['buy-items'].querySelectorAll('.buy-item').forEach((b) => {
      const it = BUY_ITEMS.find((i) => i.id === b.dataset.id);
      b.classList.toggle('cant', p.money < it.price);
    });
  }
  // Spectate line.
  if (!p.alive && state.phase === 'live') {
    const target = state.actors.find((a) => a.id === state.spectate);
    el['spectate'].textContent = target ? `You are down — spectating ${target.name}` : 'You are down';
    el['spectate'].style.display = 'block';
  } else el['spectate'].style.display = 'none';
  // Damage vignette.
  state.damageFlash = Math.max(0, state.damageFlash - dt * 1.8);
  el['vignette'].style.opacity = state.damageFlash.toFixed(2);
  // Round hint.
  if (state.phase === 'buy') el['hint'].textContent = 'Buy phase — press B to shop, then push a site';
  else if (state.phase === 'roundEnd') el['hint'].textContent = state.roundReason;
  // Minimap, 10 Hz is plenty.
  if (state.time - hud.lastMinimap > 0.1) {
    hud.lastMinimap = state.time;
    drawMinimap(hud, state);
  }
}

export function fillMatchEnd(hud, state) {
  const won = state.matchWinner === 0;
  hud.el['match-title'].textContent = won ? 'VIPERS WIN THE MATCH' : 'WARDENS WIN THE MATCH';
  hud.el['match-title'].style.color = won ? '#2fd4a7' : '#ffb020';
  const s = state.stats;
  const acc = s.shots > 0 ? Math.round((s.hits / s.shots) * 100) : 0;
  hud.el['match-stats'].innerHTML = `
    <div>Final score — ${TEAM_NAME[0]} ${state.score[0]} : ${state.score[1]} ${TEAM_NAME[1]}</div>
    <div>Kills <b>${s.kills}</b> · Deaths <b>${s.deaths}</b> · Accuracy <b>${acc}%</b></div>
    <div>Damage dealt <b>${Math.round(s.damage)}</b> · Charges planted <b>${s.plants}</b></div>`;
}

export { TEAM_COLOR };
