// rounds.js — the round state machine, the economy, the buy menu and the bomb.
// Phases: buy (15 s, shop open) -> live (100 s) -> roundEnd (banner) -> next
// round, until one team reaches ROUNDS_TO_WIN and the match ends.
import {
  BUY_TIME, ROUND_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME, ROUNDS_TO_WIN,
  START_MONEY, WIN_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS, MAX_LOSS_REWARD,
  TEAM_NAME, dist2,
} from './state.js';
import { createActor, resetActorForRound } from './actors.js';
import { assignBotRoles } from './bots.js';
import { SITES, SPAWNS } from './map.js';
import { WEAPONS, BUY_ITEMS } from './weapons.js';
import { explode } from './combat.js';
import * as audio from './audio.js';

export function aliveCount(state, team) {
  let n = 0;
  for (const a of state.actors) if (a.team === team && a.alive) n++;
  return n;
}

export function setupMatch(state) {
  state.score = [0, 0];
  state.lossStreak = [0, 0];
  state.round = 1;
  state.matchWinner = -1;
  state.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0, plants: 0, defuses: 0 };
  state.killfeed = [];
  state.actors = [];
  const player = createActor(0, true, 'You');
  player.money = START_MONEY;
  state.player = player;
  state.actors.push(player);
  for (let i = 0; i < 4; i++) state.actors.push(createActor(0, false));
  for (let i = 0; i < 5; i++) state.actors.push(createActor(1, false));
  state.spectate = -1;
}

export function startRound(state) {
  state.phase = 'buy';
  state.phaseTime = 0;
  state.buyOpen = false;
  state.bomb = {
    state: 'carried', carrier: state.player, x: 0, z: 0, site: null,
    fuse: 0, plantProgress: 0, defuseProgress: 0, planter: null, defuser: null,
  };
  state.grenades = [];
  state.tracers = [];
  state.impacts = [];
  state.shots = [];
  let ai = 0, di = 0;
  for (const a of state.actors) {
    const s = a.team === 0 ? SPAWNS.attack[ai++] : SPAWNS.defend[di++];
    resetActorForRound(a, s[0], s[1], a.team === 0 ? 0 : Math.PI);
  }
  assignBotRoles(state);
  state.events.push({ type: 'roundStart', round: state.round });
}

function endRound(state, winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'roundEnd';
  state.phaseTime = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  const p = state.player;
  if (p.team === winner) {
    p.money += WIN_REWARD;
    state.lossStreak[p.team] = 0;
    state.lossStreak[1 - p.team]++;
  } else {
    const streak = state.lossStreak[p.team];
    p.money += Math.min(LOSS_REWARD + streak * LOSS_STREAK_BONUS, MAX_LOSS_REWARD);
    state.lossStreak[p.team]++;
    state.lossStreak[1 - p.team] = 0;
  }
  p.money = Math.min(p.money, 16000);
  state.events.push({ type: 'roundEnd', winner, reason });
  if (winner === 0) audio.playRoundWin(); else audio.playRoundLose();
  if (state.score[winner] >= ROUNDS_TO_WIN) state.matchWinner = winner;
}

function plantBomb(state, site, planter) {
  state.bomb.state = 'planted';
  state.bomb.site = site;
  state.bomb.fuse = BOMB_FUSE;
  state.bomb.x = planter.x;
  state.bomb.z = planter.z;
  state.bomb.plantProgress = 0;
  state.bomb.carrier = null;
  if (planter.isPlayer) state.stats.plants++;
  state.events.push({ type: 'planted', site });
  audio.playPlant();
}

function updateBomb(state, input, dt) {
  const bomb = state.bomb;
  const p = state.player;
  // Picking up a dropped charge by walking over it.
  if (bomb.state === 'dropped' && p.alive && dist2(p.x, p.z, bomb.x, bomb.z) < 1.4 * 1.4) {
    bomb.state = 'carried';
    bomb.carrier = p;
    state.events.push({ type: 'pickup' });
  }
  if (bomb.state === 'carried') {
    const carrier = bomb.carrier;
    if (!carrier || !carrier.alive) return;
    // Which site (if any) is the carrier standing in?
    let site = null;
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      if (dist2(carrier.x, carrier.z, s.x, s.z) < s.r * s.r) { site = key; break; }
    }
    const planting = site &&
      (carrier.isPlayer
        ? (input.keys.has('KeyE') && p.alive)
        : (carrier.brain && carrier.brain.mode === 'plant' && state.time > carrier.brain.plantWait));
    if (planting) {
      bomb.plantProgress += dt / PLANT_TIME;
      bomb.planter = carrier;
      if (bomb.plantProgress >= 1) plantBomb(state, site, carrier);
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt / PLANT_TIME);
      bomb.planter = null;
    }
    return;
  }
  if (bomb.state !== 'planted') return;
  bomb.fuse -= dt;
  // Beeping: once a second, twice a second under 10 s.
  const interval = bomb.fuse < 10 ? 0.5 : 1.0;
  if (Math.floor(bomb.fuse / interval) !== Math.floor((bomb.fuse + dt) / interval)) {
    audio.playBeep(bomb.fuse < 10);
  }
  // A defender standing on the charge defuses it.
  let defuser = null;
  for (const a of state.actors) {
    if (a.team !== 1 || !a.alive) continue;
    if (a.brain && a.brain.mode === 'defuse' && dist2(a.x, a.z, bomb.x, bomb.z) < 2.4 * 2.4) {
      defuser = a; break;
    }
  }
  if (defuser) {
    bomb.defuseProgress += dt / DEFUSE_TIME;
    bomb.defuser = defuser;
    if (bomb.defuseProgress >= 1) {
      bomb.state = 'defused';
      state.events.push({ type: 'defused' });
      audio.playDefuse();
      endRound(state, 1, 'Charge defused');
      return;
    }
  } else {
    bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt / DEFUSE_TIME);
    bomb.defuser = null;
  }
  if (bomb.fuse <= 0) {
    bomb.state = 'exploded';
    explode(state, bomb.x, 0.5, bomb.z, 16, 400, null);
    state.events.push({ type: 'detonated' });
    endRound(state, 0, 'Charge detonated');
  }
}

export function updateRounds(state, input, dt) {
  state.phaseTime += dt;
  if (state.phase === 'buy') {
    if (state.phaseTime >= BUY_TIME) {
      state.phase = 'live';
      state.phaseTime = 0;
      state.buyOpen = false;
      state.events.push({ type: 'live' });
    }
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.phaseTime >= 4.5) {
      if (state.matchWinner >= 0) {
        state.phase = 'matchEnd';
        state.events.push({ type: 'matchEnd', winner: state.matchWinner });
      } else {
        state.round++;
        startRound(state);
      }
    }
    return;
  }
  if (state.phase !== 'live') return;
  updateBomb(state, input, dt);
  if (state.phase !== 'live') return; // bomb may have ended the round
  // Elimination wins — except that a planted charge outlives its planters:
  // if the Vipers are all down after planting, the Wardens must still defuse.
  if (state.bomb.state !== 'planted' && aliveCount(state, 0) === 0) { endRound(state, 1, 'Vipers eliminated'); return; }
  if (aliveCount(state, 1) === 0) { endRound(state, 0, 'Wardens eliminated'); return; }
  // Time out (only when the bomb is not planted — a live fuse outlives the clock).
  if (state.bomb.state !== 'planted' && state.phaseTime >= ROUND_TIME) {
    endRound(state, 1, 'Time expired');
  }
}

// Buy one item during the buy phase. Returns a message for the HUD.
export function buyItem(state, itemId) {
  const p = state.player;
  if (state.phase !== 'buy') return 'Buy phase is over';
  if (!p.alive) return 'You are down';
  const item = BUY_ITEMS.find((i) => i.id === itemId);
  if (!item) return 'Unknown item';
  if (p.money < item.price) { audio.playDenied(); return 'Not enough money'; }
  if (itemId === 'he' && p.grenades >= 1) return 'Already carrying a grenade';
  if (itemId === 'kevlar' && p.armor >= 50) return 'Already armoured';
  if (itemId === 'helmet' && p.helmet) return 'Already have a helmet';
  p.money -= item.price;
  if (itemId === 'he') { p.grenades = 1; }
  else if (itemId === 'kevlar') { p.armor = 50; }
  else if (itemId === 'helmet') { p.armor = 100; p.helmet = true; }
  else if (itemId === 'ammo') {
    for (const k in p.reserve) p.reserve[k] = WEAPONS[k].reserveMax;
  } else {
    p.primary = itemId;
    p.current = itemId;
    p.mag[itemId] = WEAPONS[itemId].mag;
    p.reserve[itemId] = WEAPONS[itemId].reserveMax;
  }
  audio.playBuy();
  return `Bought ${item.name}`;
}

export function roundTimeLeft(state) {
  if (state.phase === 'buy') return BUY_TIME - state.phaseTime;
  if (state.phase === 'live') {
    if (state.bomb.state === 'planted') return state.bomb.fuse;
    return ROUND_TIME - state.phaseTime;
  }
  return 0;
}

export function phaseLabel(state) {
  if (state.phase === 'buy') return 'BUY PHASE';
  if (state.bomb.state === 'planted') return 'CHARGE LIVE';
  return `ROUND ${state.round}`;
}

export function scoreLine(state) {
  return `${TEAM_NAME[0]} ${state.score[0]} — ${state.score[1]} ${TEAM_NAME[1]}`;
}
