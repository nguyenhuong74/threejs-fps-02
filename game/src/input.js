// input.js — keyboard, mouse and pointer lock. Keeps the raw input state the
// simulation reads each fixed step; game code never touches DOM events directly.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseDX: 0, mouseDY: 0, // accumulated since last step, consumed by the sim
    firing: false, // left button held
    aiming: false, // right button held
    locked: false,
    pressed: new Set(), // keys pressed since last step (edge-triggered)
    wheel: 0, // accumulated wheel delta (weapon cycling)
    onLockChange: null,
    onKey: null, // callback(code) for UI keys (buy menu, pause, use)
  };
  const down = (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (input.onKey) input.onKey(e.code);
    if (e.code === 'Space') e.preventDefault();
  };
  const up = (e) => { input.keys.delete(e.code); };
  const move = (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  };
  const mdown = (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  };
  const mup = (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  };
  const wheel = (e) => { if (input.locked) input.wheel += Math.sign(e.deltaY); };
  const lockChange = () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) { input.firing = false; input.aiming = false; }
    if (input.onLockChange) input.onLockChange(input.locked);
  };
  const ctxMenu = (e) => e.preventDefault();
  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);
  document.addEventListener('mousemove', move);
  document.addEventListener('mousedown', mdown);
  document.addEventListener('mouseup', mup);
  document.addEventListener('wheel', wheel, { passive: true });
  document.addEventListener('pointerlockchange', lockChange);
  canvas.addEventListener('contextmenu', ctxMenu);
  input.lock = () => { if (!input.locked) canvas.requestPointerLock(); };
  input.unlock = () => { if (input.locked) document.exitPointerLock(); };
  // Called once per fixed step after the sim has read the deltas.
  input.endStep = () => { input.mouseDX = 0; input.mouseDY = 0; input.pressed.clear(); input.wheel = 0; };
  // Keys are also cleared at the end of each rendered frame so a held key does
  // not leak a stale "pressed" into the next step.
  input.endFrame = () => { input.pressed.clear(); };
  return input;
}
