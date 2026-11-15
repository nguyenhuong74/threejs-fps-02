// map.js — Yard 7, an original container-yard map: colliders, geometry,
// waypoint graph, spawns and bomb sites. One source of truth for physics and
// rendering: every solid box is both a collider and a mesh.
// Coordinates: x east, z south, y up. Ground is y=0. North (-z) is the defence.
import * as THREE from 'three';

// [cx, cz, w, d, h, y0, material] — axis-aligned solid boxes.
export const BOXES = [
  // Perimeter walls (h 5)
  [0, -45, 112, 1, 5, 0, 'wall'], [0, 45, 112, 1, 5, 0, 'wall'],
  [-55, 0, 1, 91, 5, 0, 'wall'], [55, 0, 1, 91, 5, 0, 'wall'],
  // Mid divider (z=8) with five gaps: west edge x[-55,-50], A-short x[-28,-22],
  // mid doors x[-2.5,2.5], B-short x[22,28], east edge x[50,55]
  [-39, 8, 22, 1.2, 4, 0, 'concrete'], [-12.25, 8, 19.5, 1.2, 4, 0, 'concrete'],
  [12.25, 8, 19.5, 1.2, 4, 0, 'concrete'], [39, 8, 22, 1.2, 4, 0, 'concrete'],
  [0, 8, 5, 1.2, 1.5, 3, 'concrete'], // lintel over mid doors
  // Site A compound (NW), centre (-33,-27): south gap x[-40,-35], east gap z[-30,-25]
  [-33, -36, 20, 1, 3.5, 0, 'wall'], [-43, -27, 1, 18, 3.5, 0, 'wall'],
  [-41.5, -18, 3, 1, 3.5, 0, 'wall'], [-29, -18, 12, 1, 3.5, 0, 'wall'],
  [-23, -33, 1, 6, 3.5, 0, 'wall'], [-23, -21.5, 1, 7, 3.5, 0, 'wall'],
  // Site B compound (NE), centre (33,-27): south gap x[35,40], west gap z[-30,-25]
  [33, -36, 20, 1, 3.5, 0, 'wall'], [43, -27, 1, 18, 3.5, 0, 'wall'],
  [29, -18, 12, 1, 3.5, 0, 'wall'], [41.5, -18, 3, 1, 3.5, 0, 'wall'],
  [23, -33, 1, 6, 3.5, 0, 'wall'], [23, -21.5, 1, 7, 3.5, 0, 'wall'],
  // Mid cover containers and crates
  [-6, 20, 6, 2.4, 2.6, 0, 'teal'], [-6, 20, 6, 2.4, 2.6, 2.6, 'olive'],
  [7, 16, 6, 2.4, 2.6, 0, 'rust'], [3.5, 0, 2.4, 6, 2.6, 0, 'slate'],
  [-12, -2, 6, 2.4, 2.6, 0, 'ochre'], [14, -4, 6, 2.4, 2.6, 0, 'slate'],
  [-8, -11, 2.4, 2.4, 1.2, 0, 'crate'], [8, -11, 2.4, 2.4, 1.2, 0, 'crate'],
  // Lane cover
  [-44, 16, 2.4, 6, 2.6, 0, 'rust'], [-41, -8, 6, 2.4, 2.6, 0, 'teal'],
  [-40, -20, 2.4, 2.4, 1.2, 0, 'crate'], [44, 16, 2.4, 6, 2.6, 0, 'rust'],
  [41, -8, 6, 2.4, 2.6, 0, 'teal'], [40, -20, 2.4, 2.4, 1.2, 0, 'crate'],
  [-16, 22, 2.4, 2.4, 1.2, 0, 'crate'], [-21, -6, 6, 2.4, 2.6, 0, 'olive'],
  [16, 22, 2.4, 2.4, 1.2, 0, 'crate'], [21, -6, 6, 2.4, 2.6, 0, 'olive'],
  // Site interiors
  [-38, -30, 2.4, 2.4, 1.2, 0, 'crate'], [-28, -32, 6, 2.4, 2.6, 0, 'rust'],
  [-30, -21, 2.4, 2.4, 1.2, 0, 'crate'], [-26, -24, 2.4, 2.4, 1.2, 0, 'crate'],
  [38, -30, 2.4, 2.4, 1.2, 0, 'crate'], [28, -32, 6, 2.4, 2.6, 0, 'rust'],
  [30, -21, 2.4, 2.4, 1.2, 0, 'crate'], [26, -24, 2.4, 2.4, 1.2, 0, 'crate'],
  // Spawn cover
  [-8, 34, 2.4, 2.4, 1.2, 0, 'crate'], [8, 34, 2.4, 2.4, 1.2, 0, 'crate'],
  [-4, -34, 2.4, 2.4, 1.2, 0, 'crate'], [4, -34, 2.4, 2.4, 1.2, 0, 'crate'],
];

export const MATERIALS = {
  wall: 0x948f82, concrete: 0x8a877d, teal: 0x2e6f6a, rust: 0xa34a2a,
  ochre: 0xc08a2d, slate: 0x4a5a6a, olive: 0x6a7a3a, crate: 0x9a7a4a,
  ground: 0x3a3f45, dark: 0x2a2d31,
};

export const SITES = {
  A: { x: -33, z: -27, r: 8, color: 0x35e0c8, label: 'A' },
  B: { x: 33, z: -27, r: 8, color: 0xffb020, label: 'B' },
};

export const SPAWNS = {
  attack: [[0, 37], [-3, 36], [3, 36], [-6, 38], [6, 38]],
  defend: [[0, -39], [-3, -38], [3, -38], [-6, -40], [6, -40]],
};

// Waypoint graph: every edge is a verified-clear straight line (no box crosses it).
export const WAYPOINTS = [
  [0, 36], [-10, 30], [10, 30], [-24, 32], [-38, 30], [-52, 22], [-52, 8], [-52, -6],
  [-46, -14], [-38, -14], [-37, -21], [-33, -27], [-14, 20], [-22, 12], [-25, 0],
  [-27, -10], [-37, -16], [0, 24], [0, 14], [0, 4], [0, -6], [0, -13], [-13, -14],
  [13, -14], [-20, -20], [-20, -27], [14, 20], [22, 12], [25, 0], [27, -10],
  [37, -16], [33, -27], [24, 32], [38, 30], [52, 22], [52, 8], [52, -6], [46, -16],
  [38, -14], [37, -21], [0, -38], [-36, -33], [-26, -28], [-41, -23], [36, -33],
  [26, -28], [41, -23], [-6, -17], [6, -17], [20, -20], [20, -27],
];
const EDGE_PAIRS = [
  [0, 1], [0, 2], [0, 17], [1, 3], [1, 12], [1, 17], [2, 26], [2, 32], [2, 17],
  [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11],
  [12, 13], [13, 14], [14, 15], [15, 16], [16, 11], [12, 18], [14, 19],
  [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [21, 23], [21, 47], [21, 48],
  [22, 24], [24, 25], [25, 11], [22, 16], [22, 48], [23, 49], [49, 50], [50, 31],
  [23, 30], [23, 48], [26, 27], [27, 28], [28, 29], [29, 30], [30, 31],
  [32, 33], [33, 34], [34, 35], [35, 36], [36, 37], [37, 38], [38, 39], [39, 31],
  [40, 47], [40, 48], [41, 11], [42, 11], [43, 11], [44, 31], [45, 31], [46, 31],
];
export const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of EDGE_PAIRS) { ADJ[a].push(b); ADJ[b].push(a); }

// BFS shortest path between waypoint ids; returns array of ids (empty if same).
export function findPath(from, to) {
  if (from === to) return [];
  const prev = new Int16Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    if (n === to) break;
    for (const m of ADJ[n]) if (prev[m] === -1) { prev[m] = n; queue.push(m); }
  }
  if (prev[to] === -1) return [];
  const path = [];
  for (let n = to; n !== from; n = prev[n]) path.push(n);
  path.reverse();
  return path;
}

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i][0] - x, dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Ray vs one AABB (slab test). Returns t or Infinity. Origin o, unit dir d.
function rayBox(ox, oy, oz, dx, dy, dz, b) {
  const minx = b[0] - b[2] / 2, maxx = b[0] + b[2] / 2;
  const miny = b[5], maxy = b[5] + b[4];
  const minz = b[1] - b[3] / 2, maxz = b[1] + b[3] / 2;
  let tmin = 0, tmax = Infinity;
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

// Nearest solid hit along a ray, or null. Reuses the module-level result object.
const hitResult = { t: 0, x: 0, y: 0, z: 0, box: null };
export function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist, bestBox = null;
  for (let i = 0; i < BOXES.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, BOXES[i]);
    if (t < best) { best = t; bestBox = BOXES[i]; }
  }
  // Ground plane y=0
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t >= 0 && t < best) { best = t; bestBox = null; }
  }
  if (best === maxDist) return null;
  hitResult.t = best;
  hitResult.x = ox + dx * best; hitResult.y = oy + dy * best; hitResult.z = oz + dz * best;
  hitResult.box = bestBox;
  return hitResult;
}

// True when the segment between two points crosses no solid box (for bot sight).
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return rayHit(ax, ay, az, dx / len, dy / len, dz / len, len) === null;
}

// Axis-separated AABB movement for an actor (feet position, half-width, height).
// Mutates e.x/e.y/e.z from e.vx/e.vy/e.vz over dt; returns true when on ground.
export function moveActor(e, dt) {
  let onGround = false;
  // X axis
  e.x += e.vx * dt;
  for (const b of BOXES) {
    if (overlaps(e, b)) {
      if (e.vx > 0) e.x = b[0] - b[2] / 2 - e.half;
      else if (e.vx < 0) e.x = b[0] + b[2] / 2 + e.half;
      e.vx = 0;
    }
  }
  // Z axis
  e.z += e.vz * dt;
  for (const b of BOXES) {
    if (overlaps(e, b)) {
      if (e.vz > 0) e.z = b[1] - b[3] / 2 - e.half;
      else if (e.vz < 0) e.z = b[1] + b[3] / 2 + e.half;
      e.vz = 0;
    }
  }
  // Y axis (gravity handled by caller; here: ground + box tops)
  e.y += e.vy * dt;
  if (e.y <= 0) { e.y = 0; e.vy = 0; onGround = true; }
  for (const b of BOXES) {
    if (e.x + e.half > b[0] - b[2] / 2 && e.x - e.half < b[0] + b[2] / 2 &&
        e.z + e.half > b[1] - b[3] / 2 && e.z - e.half < b[1] + b[3] / 2) {
      const top = b[5] + b[4];
      if (e.vy <= 0 && e.y <= top && e.y + e.height > b[5] && e.y >= top - 0.6) {
        e.y = top; e.vy = 0; onGround = true;
      } else if (e.vy > 0 && e.y + e.height > b[5] && e.y < b[5]) {
        e.y = b[5] - e.height; e.vy = 0;
      }
    }
  }
  return onGround;
}

function overlaps(e, b) {
  return e.x + e.half > b[0] - b[2] / 2 && e.x - e.half < b[0] + b[2] / 2 &&
    e.z + e.half > b[1] - b[3] / 2 && e.z - e.half < b[1] + b[3] / 2 &&
    e.y < b[5] + b[4] && e.y + e.height > b[5];
}

// Build the visible scene from the same BOXES list. Shared unit box geometry,
// one material per palette key; site markers are rings + light columns + flags.
export function buildMap(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mats = {};
  for (const k in MATERIALS) mats[k] = new THREE.MeshLambertMaterial({ color: MATERIALS[k] });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(112, 92), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.01, 0);
  scene.add(ground);
  for (const b of BOXES) {
    const m = new THREE.Mesh(geo, mats[b[6]]);
    m.position.set(b[0], b[5] + b[4] / 2, b[1]);
    m.scale.set(b[2], b[4], b[3]);
    scene.add(m);
  }
  // Yard dressing: light poles and a dock crane silhouette (decorative, outside play).
  const poleMat = mats.dark;
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const [px, pz] of [[-20, 24], [20, 24], [-20, -8], [20, -8], [0, -20]]) {
    const pole = new THREE.Mesh(geo, poleMat);
    pole.position.set(px, 3.5, pz); pole.scale.set(0.25, 7, 0.25);
    scene.add(pole);
    const lamp = new THREE.Mesh(geo, lampMat);
    lamp.position.set(px, 7.1, pz); lamp.scale.set(0.9, 0.25, 0.9);
    scene.add(lamp);
  }
  const craneMat = new THREE.MeshLambertMaterial({ color: 0xc08a2d });
  const leg1 = new THREE.Mesh(geo, craneMat);
  leg1.position.set(48, 6, -38); leg1.scale.set(1, 12, 1); scene.add(leg1);
  const leg2 = new THREE.Mesh(geo, craneMat);
  leg2.position.set(48, 6, -30); leg2.scale.set(1, 12, 1); scene.add(leg2);
  const beam = new THREE.Mesh(geo, craneMat);
  beam.position.set(48, 12, -34); beam.scale.set(1, 1, 14); scene.add(beam);
  const jib = new THREE.Mesh(geo, craneMat);
  jib.position.set(40, 12.4, -34); jib.scale.set(16, 0.8, 0.8); scene.add(jib);
  // Bomb sites: glowing ring, light column, flag pole.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.4, s.r, 48),
      new THREE.MeshBasicMaterial({ color: s.color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r, s.r, 9, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    col.position.set(s.x, 4.5, s.z);
    scene.add(col);
    const pole = new THREE.Mesh(geo, poleMat);
    pole.position.set(s.x, 2.5, s.z - s.r + 0.5); pole.scale.set(0.18, 5, 0.18);
    scene.add(pole);
    const flag = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: s.color }));
    flag.position.set(s.x + 0.9, 4.6, s.z - s.r + 0.5); flag.scale.set(1.8, 1, 0.08);
    scene.add(flag);
  }
}
