# embyard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/cupay1734/emberyard/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/cupay1734/emberyard/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

**EMBERYARD** is a round-based tactical FPS for the desktop browser, built with three.js and no build step. In a dusk decommissioned kiln yard, your teal squad of five (you plus four bots) carries a charge across three lanes to plant at site A or B and defend it through a 40-second fuse; five ember bots hold the sites, rotate on contact, and race to defuse once it is planted. First to 7 rounds, at most 12.

Between rounds an economy decides the game as much as aim does: kills, plants and round wins pay out, and the buy menu offers four more guns beyond the starting pistol (the Ripper-9 SMG, the VK Longshore rifle, the Boar-12 shotgun, the Kestrel .308 DMR), frag grenades and armour — die and your primary drops with you. Gunplay rewards discipline: spread blooms hard while moving or airborne and settles when you stop, crouch or walk; headshots deal 3.2× damage. Bots path a waypoint graph through the lanes, peek and strafe in bursts, hear nearby gunfire, guard post-plant positions and channel defuses. Sound is synthesised live with Web Audio; there are no asset files and no network requests.

## Run it

```sh
node serve.ts
# then open http://localhost:8080 in a desktop browser
```

Node 22 or later, nothing to install: `serve.ts` serves the static `game/` folder. WASD to move, mouse to look, click to fire, R reload, Shift walk, Ctrl crouch, 1/2 weapons, G grenade, E plant.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s522t60h&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
