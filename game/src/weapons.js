// weapons.js — weapon definitions and the pure gunplay math: damage, spread,
// recoil. No rendering, no state: functions take numbers and return numbers.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 1, price: 0, auto: false,
    damage: 34, headMult: 4, rpm: 400, mag: 12, reserveMax: 48,
    reload: 1.8, spread: 0.007, moveSpread: 0.030, airSpread: 0.05,
    recoil: 0.011, recoilRecover: 6, range: 60, adsSpread: 0.6,
    kick: 0.012, zoomFov: 0, sound: 'pistol',
  },
  vk9: {
    id: 'vk9', name: 'VK-9 Striker', slot: 1, price: 1200, auto: true,
    damage: 26, headMult: 4, rpm: 750, mag: 30, reserveMax: 120,
    reload: 2.2, spread: 0.013, moveSpread: 0.020, airSpread: 0.045,
    recoil: 0.008, recoilRecover: 7, range: 55, adsSpread: 0.6,
    kick: 0.009, zoomFov: 0, sound: 'smg',
  },
  ar77: {
    id: 'ar77', name: 'AR-77 Vandal', slot: 1, price: 2700, auto: true,
    damage: 36, headMult: 4, rpm: 600, mag: 30, reserveMax: 90,
    reload: 2.5, spread: 0.005, moveSpread: 0.035, airSpread: 0.06,
    recoil: 0.013, recoilRecover: 5, range: 80, adsSpread: 0.5,
    kick: 0.014, zoomFov: 0, sound: 'rifle',
  },
  lw50: {
    id: 'lw50', name: 'LW-50 Longshot', slot: 1, price: 4750, auto: false,
    damage: 110, headMult: 2, rpm: 50, mag: 5, reserveMax: 15,
    reload: 3.6, spread: 0.0012, moveSpread: 0.09, airSpread: 0.12,
    recoil: 0.05, recoilRecover: 3, range: 120, adsSpread: 1.0,
    kick: 0.06, zoomFov: 30, sound: 'sniper', scoped: true,
    hipSpread: 0.055, // firing unscoped is a lottery, as it should be
  },
  he: {
    id: 'he', name: 'HE Grenade', slot: 4, price: 300, auto: false,
    damage: 0, headMult: 1, rpm: 60, mag: 1, reserveMax: 0,
    reload: 0, spread: 0, moveSpread: 0, airSpread: 0,
    recoil: 0, recoilRecover: 0, range: 0, adsSpread: 1,
    kick: 0, zoomFov: 0, sound: 'throw', grenade: true,
  },
};

export const BUY_ITEMS = [
  { id: 'vk9', name: 'VK-9 Striker', desc: 'Fast SMG, close quarters', price: 1200, key: '2' },
  { id: 'ar77', name: 'AR-77 Vandal', desc: 'Rifle — accurate, hard hitting', price: 2700, key: '3' },
  { id: 'lw50', name: 'LW-50 Longshot', desc: 'Bolt sniper, one-shot body', price: 4750, key: '4' },
  { id: 'he', name: 'HE Grenade', desc: 'Thrown explosive, 6 m blast', price: 300, key: '5' },
  { id: 'kevlar', name: 'Kevlar Vest', desc: 'Absorbs half of body damage', price: 650, key: '6' },
  { id: 'helmet', name: 'Kevlar + Helmet', desc: 'Vest plus head protection', price: 1000, key: '7' },
  { id: 'ammo', name: 'Full Ammo', desc: 'Refill every magazine', price: 200, key: '8' },
];

// Spread (radians) for a shot: base, worse while moving or airborne, worse as
// the recoil bloom builds, better while aiming down sights. Stopping to aim pays.
export function shotSpread(w, speed, airborne, ads, bloom) {
  let s = w.spread;
  if (w.scoped && !ads) s = w.hipSpread;
  s += (w.moveSpread * Math.min(speed / 4.3, 1));
  if (airborne) s += w.airSpread;
  s += bloom;
  if (ads) s *= w.adsSpread;
  return s;
}

// Damage after range falloff: full to 60% of range, then linear down to 55%.
export function damageAtRange(w, dist) {
  const full = w.range * 0.6;
  if (dist <= full) return w.damage;
  const t = Math.min((dist - full) / (w.range - full), 1);
  return w.damage * (1 - 0.45 * t);
}

// Armor: vest absorbs 50% of body damage (helmet: head too), costing armor points.
export function applyArmor(dmg, headshot, armor, helmet) {
  if (armor <= 0) return { hp: dmg, armorUsed: 0 };
  if (headshot && !helmet) return { hp: dmg, armorUsed: 0 };
  const absorbed = Math.min(dmg * 0.5, armor);
  return { hp: dmg - absorbed, armorUsed: absorbed };
}
