# DUSTLINE — Yard 7

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, built with three.js 0.187.0. You are a
**VIPER** in a 5v5 match against the **WARDENS** on an original container-yard map:
plant the charge at site A or B and guard it till it blows, or eliminate the other
team. Win rounds, earn cash, buy better guns. First to 8 rounds takes the match.

Built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty,
$1,000 in USDC.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: `game/` is plain static files, and three.js is vendored
under `game/` (0.187.0, byte for byte from npm). Any static HTTP server works.

## Play

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look |
| LMB | Fire · throw grenade |
| RMB | Aim down sights / scope |
| R | Reload |
| 1 / 2 / 4 | Primary / pistol / grenade |
| B | Buy menu (buy phase only) |
| E | Plant the charge (hold, inside a site) |
| Ctrl / C | Crouch |
| Space | Jump |
| Esc | Pause |

## What's in the game

- **Rounds and economy** — 15 s buy phase, 100 s rounds, $800 start, $300 per kill,
  $3,250 for a round win, rising loss bonuses. Buy menu: SMG, rifle, bolt sniper,
  HE grenade, Kevlar, helmet, ammo.
- **Gunplay where accuracy counts** — hitscan against head/body hitboxes (headshots
  deal 4×), recoil bloom and spread that punish firing on the move or in the air,
  armour that absorbs half of body damage, a scoped sniper that is a lottery
  unscoped.
- **An objective beyond killing** — the charge: plant it (3 s), defend the 35 s
  fuse, or watch the Wardens defuse it (5 s). Dropped charges can be picked up by
  either side's carrier.
- **Bots that play the map** — waypoint routes down five lanes, site holds, burst
  fire with reaction times and tracking aim, strafing in combat, hearing gunshots
  and investigating, planting, retaking and defusing.
- **The map** — Yard 7: a container yard with two walled bomb sites, a mid lane
  with doors, long flanks and a connector, in a dusty dusk palette with a live
  minimap that only shows enemies your team has recently seen.
- **Feel** — synthesized WebAudio gunfire, beeps, explosions and stingers (no audio
  files), tracers, impact particles, muzzle flashes, camera shake and a damage
  vignette, plus a first-person viewmodel that follows the equipped weapon.

## Layout

```
game/
  index.html            HUD, menus, import map (three -> ./three.module.min.js)
  style.css
  three.module.min.js   three.js 0.187.0 (npm build, specifiers rewritten)
  three.core.min.js     three.js 0.187.0 core (npm build, byte for byte)
  src/
    main.js             bootstrap, fixed 60 Hz sim loop, camera, viewmodel
    state.js            the single game-state object + tuning constants
    map.js              Yard 7: colliders, geometry, waypoint graph, raycasts
    weapons.js          weapon table + spread / damage / armour math
    actors.js           player controller, damage, bot bodies
    bots.js             bot AI: routes, holds, sight, hearing, plant/defuse
    combat.js           hitscan, grenades, explosions
    rounds.js           round machine, economy, buy menu, bomb
    audio.js            synthesized WebAudio SFX
    hud.js              HUD, killfeed, buy menu, minimap, screens
    effects.js          tracers, particles, muzzle flash, explosions
main.ts                 entrypoint: copies game/ + screenshots/ to /output,
                        writes dossier.json with vendor/makefun-threejs.ts
screenshots/            3–4 real renders of the game in a browser
```

## Screenshots

The screenshots are real renders of this game's own code in headless Chromium.
`?shot=` stages the game into a real state for the camera — `menu`, `play` (a live
round mid-map), `buy` (buy menu open) or `end` (match-end screen) — and `?demo=1`
runs an attract mode where the camera follows a bot. Nothing is edited or
composited.

## License

MIT — see LICENSE.
