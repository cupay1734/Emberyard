// EMBERYARD — boot and the one loop. A fixed 60 Hz simulation (player, bots, rules,
// grenades) feeds a render at the display's rate; shooting the player's gun happens on
// the render frame where the click lands, everything else in the fixed step.
// ?shot=start|play|end with &seed=N stages a deterministic scene for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, PART_MULTIPLIER } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed * 7919 + 13);

// ---- renderer / scene ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 45, 115);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

// ---- world & actors -------------------------------------------------------------
const world = createWorld(scene);
const player = createPlayer(world.colliders, world.spawns.attack[0]);
const weapons = createWeapons(camera);
const bots = createBots(scene, world, random);
const grenades = createGrenades(scene, world.colliders);
const effects = createEffects(scene);
const audio = createAudio();
const match = createMatch(world);
const hud = createHud();
hud.setMapStatic(world.colliders);
const input = createInput(renderer.domElement, onLockChange);

const playerActor = {
  kind: 'player', name: 'You', team: 'attack',
  body: player.state.body, alive: true, health: 100,
  eyePos: new THREE.Vector3(), lastShotAt: -Infinity, kills: 0, deaths: 0,
  get armor() { return weapons.state.armor; },
};
const actors = [playerActor, ...bots.bots];
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);

// The charge prop: a small ember-lit case, visible when dropped or planted.
const chargeMesh = new THREE.Group();
const chargeCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.16, 0.26),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.3 }),
);
const chargeLightBar = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.03, 0.2),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember) }),
);
chargeLightBar.position.y = 0.1;
chargeMesh.add(chargeCase, chargeLightBar);
chargeMesh.visible = false;
scene.add(chargeMesh);

// ---- state ----------------------------------------------------------------------
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let lastMinimap = 0;
let lastPlantBeep = 0;
let playerDiedLastRound = false;

const buyFacade = {
  get grenades() { return weapons.state.grenades; },
  set grenades(v) { weapons.state.grenades = v; },
  get armor() { return weapons.state.armor; },
  set armor(v) { weapons.state.armor = v; },
  owned: weapons.state.owned,
  give: (id) => weapons.give(id),
  switchTo: (id) => weapons.switchTo(id),
};

const BUY_ITEMS = [
  { id: 'smg', hint: 'Fast, loose on the move' },
  { id: 'rifle', hint: 'The all-rounder' },
  { id: 'shotgun', hint: 'Eight pellets, short reach' },
  { id: 'dmr', hint: 'One heavy, exact shot' },
  { id: 'grenade', hint: 'Frag — throw with G' },
  { id: 'armor', hint: 'Cuts gun damage by 45%' },
];

function buyItemList() {
  return BUY_ITEMS.map((item) => {
    if (item.id === 'grenade') {
      return { id: 'grenade', name: 'Frag grenade', price: 300, hint: item.hint, owned: weapons.state.grenades >= 2, afford: match.playerMoney >= 300 };
    }
    if (item.id === 'armor') {
      return { id: 'armor', name: 'Kevlar vest', price: 650, hint: item.hint, owned: weapons.state.armor, afford: match.playerMoney >= 650 };
    }
    const def = WEAPONS[item.id];
    return { id: item.id, name: def.name, price: def.price, hint: item.hint, owned: weapons.state.owned.has(item.id), afford: match.playerMoney >= def.price };
  });
}

function showBuyMenu() {
  hud.showBuy({
    money: match.playerMoney,
    items: buyItemList(),
    timerText: '',
    onBuy(id) {
      const result = match.buy(id, buyFacade);
      if (result === 'ok') {
        audio.buy();
        showBuyMenu();
        pushHud();
      } else {
        audio.denied();
      }
    },
    onReady() {
      hud.hideBuy();
      input.requestLock();
    },
  });
  document.getElementById('buy-round').textContent = String(match.round);
}

// ---- combat ---------------------------------------------------------------------
function botDamageAt(def, distance) {
  if (distance <= def.falloff) return def.damage;
  return Math.max(1, Math.round(def.damage * Math.max(0.35, 1 - (distance - def.falloff) / 60)));
}

function damageActor(victim, amount, attacker, part, viaGrenade = false) {
  if (!victim.alive || amount <= 0) return;
  if (attacker && attacker !== victim && attacker.team === victim.team && !viaGrenade) return; // no friendly fire from guns
  let damage = amount;
  const armored = victim.kind === 'player' ? weapons.state.armor : victim.armor;
  if (armored) damage *= 0.55;
  victim.health -= damage;
  if (victim.kind === 'player') {
    hud.damageFlash();
    audio.hurt();
    effects.addTrauma(0.22);
  }
  const killed = victim.health <= 0;
  if (attacker?.kind === 'player' && victim.kind === 'bot') {
    hud.hitMarker(killed);
    audio.hit(killed);
  }
  if (!killed) return;
  victim.health = 0;
  victim.alive = false;
  victim.deaths += 1;
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    match.onKill(attacker);
  }
  hud.kill(attacker ? attacker.name : 'Blast', victim.name, attacker ? attacker.team : 'defense', part === 'head');
  if (victim.kind === 'player') {
    playerDiedLastRound = true;
    hud.banner('You are down', 'Your squad fights on without you', 3000);
    input.releaseLock();
  }
}

const aimPoint = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();

// A bot fires one round: aim at the target's chest (sometimes the head), bloom the
// shot by the bot's movement, the gun and the bot's skill, then raycast the world.
function botTryShoot(bot, target) {
  bot.lastShotAt = elapsed;
  const def = WEAPONS[bot.weaponId];
  shotOrigin.copy(bots.eyeOf(bot));
  shotOrigin.y -= 0.14;
  if (target.kind === 'player') {
    const crouch = player.state.crouching;
    aimPoint.copy(target.body.position);
    aimPoint.y += random() < 0.16 * bot.skill ? (crouch ? 0.95 : 1.5) : (crouch ? 0.8 : 1.12);
  } else {
    aimPoint.copy(random() < 0.16 * bot.skill ? bots.eyeOf(target) : bots.chestOf(target));
  }
  const dist = shotOrigin.distanceTo(aimPoint);
  shotDir.subVectors(aimPoint, shotOrigin).normalize();
  const speedBloom = Math.min(1, Math.hypot(bot.body.velocity.x, bot.body.velocity.z) / 4.1);
  const spread = def.spreadStill * 2 + speedBloom * def.spreadMove + (1.15 - bot.skill) * 0.007 + dist * 0.0004;
  shotDir.x += (random() * 2 - 1) * spread;
  shotDir.y += (random() * 2 - 1) * spread;
  shotDir.z += (random() * 2 - 1) * spread;
  shotDir.normalize();
  raycaster.set(shotOrigin, shotDir);
  // Teammates do not block a bot's fire (their meshes are left out); the world and
  // every enemy do.
  const targets = world.shootables.concat(bots.hitMeshes.filter((m) => m.userData.actor.team !== bot.team));
  const hit = raycaster.intersectObjects(targets, false)[0];
  const end = hit ? hit.point : shotOrigin.clone().addScaledVector(shotDir, 60);
  effects.tracer(shotOrigin, end, bot.team === 'attack');
  audio.shot(def.kind, shotOrigin.distanceTo(player.state.body.position));
  if (!hit) return;
  if (hit.object.userData.actor) {
    const victim = hit.object.userData.actor;
    const part = hit.object.userData.part ?? 'torso';
    damageActor(victim, botDamageAt(def, hit.distance) * (PART_MULTIPLIER[part] ?? 1), bot, part);
  } else {
    effects.impact(hit.point);
  }
}

const combat = { tryShoot: botTryShoot };

function playerShoot() {
  const pellets = weapons.fire();
  if (pellets === 0) {
    if (weapons.dryFire()) audio.dryFire();
    return;
  }
  playerActor.lastShotAt = elapsed;
  const def = weapons.def();
  audio.shot(def.kind, 0);
  camera.getWorldDirection(shotDir);
  shotOrigin.copy(camera.position);
  for (let p = 0; p < pellets; p += 1) {
    const spread = weapons.spread(player.moveFactor());
    const dir = shotDir.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    raycaster.set(shotOrigin, dir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    const end = hit ? hit.point : shotOrigin.clone().addScaledVector(dir, 70);
    effects.tracer(shotOrigin, end, true);
    if (!hit) continue;
    const victim = hit.object.userData.actor;
    if (victim) {
      if (victim.team !== playerActor.team) {
        const part = hit.object.userData.part ?? 'torso';
        damageActor(victim, weapons.damageAt(hit.distance) * (PART_MULTIPLIER[part] ?? 1), playerActor, part);
      }
    } else {
      effects.impact(hit.point);
    }
  }
  player.recoil(0.006 + weapons.def().kick * 0.008, (random() * 2 - 1) * 0.003);
  effects.addTrauma(0.05);
  pushHud();
}

// ---- round flow -------------------------------------------------------------------
function resetActorsForRound() {
  playerDiedLastRound = false;
  playerActor.alive = true;
  playerActor.health = 100;
  player.teleport(world.spawns.attack[0], 0);
  weapons.topUpAll();
  bots.bots.forEach((bot, i) => {
    const spawn = bot.team === 'attack' ? world.spawns.attack[(i % 4) + 1] : world.spawns.defense[i - 4];
    const died = !bot.alive;
    if (died) {
      bot.weaponId = 'pistol';
      bot.armor = false;
    }
    bots.reset(bot, spawn, bot.team === 'attack' ? 0 : Math.PI);
    bots.buyFor(bot);
  });
  chargeMesh.visible = false;
}

function scoreboardRows() {
  const rows = [['', 'K', 'D']];
  const sorted = [...actors].sort((a, b) => b.kills - a.kills);
  for (const a of sorted) rows.push([`${a.team === 'attack' ? '◆' : '◇'} ${a.name}`, String(a.kills), String(a.deaths)]);
  return rows;
}

function handleMatchEvents() {
  for (const event of match.drainEvents()) {
    if (event.type === 'round-start') {
      hud.hideOverlay();
      hud.banner(`Round ${event.round}`, match.scores.attack + match.scores.defense === 0 ? 'Plant the charge, or clear the yard' : `First to 7 — you ${match.scores.attack}, them ${match.scores.defense}`, 2400);
      showBuyMenu();
    } else if (event.type === 'live') {
      hud.hideBuy();
      if (!input.state.locked && started && !shot && playerActor.alive) hud.showOverlay('buyPause');
    } else if (event.type === 'planted') {
      hud.banner('Charge planted', `Site ${event.site.id} — defend it`, 2600);
      audio.plantBeep(true);
      chargeMesh.visible = true;
      chargeMesh.position.copy(event.site.plant).setY(0.1);
    } else if (event.type === 'detonated') {
      effects.explosion(event.site.plant);
      effects.addTrauma(0.7);
      audio.explosion(6);
      chargeMesh.visible = false;
    } else if (event.type === 'defused') {
      hud.banner('Charge defused', '', 2200);
      chargeMesh.visible = false;
    } else if (event.type === 'charge-dropped') {
      chargeMesh.visible = true;
      chargeMesh.position.copy(match.charge.position).setY(0.1);
    } else if (event.type === 'charge-picked') {
      chargeMesh.visible = false;
    } else if (event.type === 'round-end') {
      const won = event.winner === 'attack';
      hud.banner(won ? 'Round won' : 'Round lost', event.reason, 3400);
      audio.roundEnd(won);
      hud.setScores(match.scores.attack, match.scores.defense, aliveCount('attack'), aliveCount('defense'));
    } else if (event.type === 'need-round-reset') {
      if (playerDiedLastRound) {
        weapons.dropPrimary();
        weapons.state.armor = false;
      }
      resetActorsForRound();
      match.startRound(actors);
      input.releaseLock();
    } else if (event.type === 'match-end') {
      input.releaseLock();
      hud.showOverlay(event.winner === 'attack' ? 'matchoverAttack' : 'matchoverDefense', scoreboardRows());
    }
  }
}

function aliveCount(team) {
  return actors.filter((a) => a.team === team && a.alive).length;
}

// ---- HUD sync ---------------------------------------------------------------------
function pushHud() {
  const a = weapons.currentAmmo();
  hud.setHealth(playerActor.health, weapons.state.armor);
  hud.setAmmo(a.mag, a.reserve, weapons.def().name);
  hud.setMoney(match.playerMoney);
  hud.setGrenades(weapons.state.grenades);
}

function pushObjective() {
  const charge = match.charge;
  if (match.phase === 'buy') hud.objective('Buy phase — equip your squad role, then Ready');
  else if (match.phase === 'live') {
    if (charge.state === 'carried') hud.objective(charge.carrier === playerActor ? 'You have the charge — plant at A or B (hold E)' : `${charge.carrier?.name ?? 'A teammate'} has the charge — cover them`);
    else hud.objective('Recover the dropped charge');
  } else if (match.phase === 'planted') hud.objective(`Defend the charge at site ${charge.site.id}`);
  else if (match.phase === 'over') hud.objective(match.winReason);
  else hud.objective('');

  if (charge.state === 'carried') hud.chargeTag(charge.carrier === playerActor ? 'YOU HAVE THE CHARGE' : null);
  else if (charge.state === 'dropped') hud.chargeTag('CHARGE DROPPED');
  else hud.chargeTag(null);

  const channel = charge.channelActor;
  if (channel && charge.plantProgress > 0) hud.progress(charge.plantProgress, channel === playerActor ? 'Planting the charge…' : `${channel.name} is planting…`);
  else if (channel && charge.defuseProgress > 0) hud.progress(charge.defuseProgress, `${channel.name} is defusing!`);
  else hud.progress(null);
}

// ---- input / lock flow --------------------------------------------------------------
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.phase === 'matchover') {
    match.startMatch(actors);
    resetActorsForRound();
    return;
  }
  if (!started) {
    started = true;
    match.startMatch(actors);
    resetActorsForRound();
    return;
  }
  // Resuming from pause during a live round.
  if (!hud.buyVisible()) input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    hud.hideOverlay();
    hud.hideBuy();
    if (match.phase === 'buy') match.beginLive();
  } else if (started && playerActor.alive && (match.phase === 'live' || match.phase === 'planted')) {
    hud.showOverlay('paused');
  }
}

// ---- simulation step ------------------------------------------------------------------
function buildChannels() {
  const channels = [];
  if (playerActor.alive && match.charge.carrier === playerActor && input.state.keys.has('KeyE')) {
    for (const site of world.sites) {
      if (player.state.body.position.distanceTo(site.center) < site.radius) {
        channels.push({ actor: playerActor, kind: 'plant', site });
      }
    }
  }
  for (const bot of bots.bots) {
    if (bot.alive && bot.channel) channels.push({ actor: bot, kind: bot.channel.kind, site: bot.channel.site });
  }
  return channels;
}

function currentDefuser() {
  if (match.phase !== 'planted' || !match.charge.position) return null;
  let best = null;
  let bestDist = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'defense' || !bot.alive) continue;
    const d = bot.body.position.distanceTo(match.charge.position);
    if (d < bestDist) { bestDist = d; best = bot; }
  }
  return best;
}

function currentContactSite() {
  for (const a of actors) {
    if (a.team !== 'attack' || elapsed - a.lastShotAt > 2.5) continue;
    for (const site of world.sites) {
      if (a.body.position.distanceTo(site.center) < site.radius + 7) return site;
    }
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  const inRound = match.phase === 'live' || match.phase === 'planted' || match.phase === 'over';
  if (playerActor.alive && inRound) player.step(dt, input.state.keys);
  weapons.step(dt);

  if (inRound) {
    bots.update(dt, {
      time: elapsed,
      phase: match.phase,
      actors,
      playerActor,
      charge: match.charge,
      attackSite: match.attackSite,
      defuser: currentDefuser(),
      contactSite: currentContactSite(),
      combat,
    });
  }

  for (const event of grenades.step(dt)) {
    effects.explosion(event.position);
    audio.explosion(event.position.distanceTo(player.state.body.position));
    effects.addTrauma(Math.max(0, 0.5 - event.position.distanceTo(player.state.body.position) * 0.05));
    for (const actor of actors) {
      if (!actor.alive) continue;
      const damage = grenades.damageAt(event.position, actor.body.position);
      if (damage > 0) damageActor(actor, damage, event.owner, 'torso', true);
    }
  }

  match.step(dt, actors, buildChannels());
  handleMatchEvents();

  if (match.phase === 'planted' && elapsed - lastPlantBeep > (match.phaseLeft < 10 ? 0.35 : 0.95)) {
    lastPlantBeep = elapsed;
    audio.plantBeep(match.phaseLeft < 3);
    chargeLightBar.material.color.set(PALETTE.ember);
  }

  effects.step(dt);
}

function syncCamera() {
  const body = player.state.body;
  if (playerActor.alive) {
    camera.position.set(body.position.x, body.position.y + player.state.eye, body.position.z);
    camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  } else {
    camera.position.set(body.position.x, body.position.y + 0.5, body.position.z);
    camera.rotation.set(-0.5, player.state.yaw, 0.55, 'YXZ');
  }
  const shake = effects.shake();
  camera.position.x += shake.x;
  camera.position.y += shake.y;
  playerActor.eyePos.copy(camera.position);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    // Clamp one frame's delta: engaging pointer lock can deliver a single huge
    // synthetic jump, which must not spin the view around.
    if (input.state.locked && playerActor.alive) {
      player.look(Math.max(-320, Math.min(320, look.x)), Math.max(-320, Math.min(320, look.y)));
    }

    weapons.state.triggerHeld = input.state.firing;
    if (input.state.locked && input.state.firing && playerActor.alive && (match.phase === 'live' || match.phase === 'planted')) {
      playerShoot();
    }
    if (input.state.locked && playerActor.alive && (match.phase === 'live' || match.phase === 'planted')) {
      if (input.wasPressed('KeyR') && weapons.reload()) audio.reload();
      if (input.wasPressed('Digit1')) weapons.switchTo('pistol');
      if (input.wasPressed('Digit2')) {
        const primary = weapons.primaryId();
        if (primary) weapons.switchTo(primary);
      }
      if (input.wasPressed('KeyG') && weapons.state.grenades > 0) {
        camera.getWorldDirection(shotDir);
        shotOrigin.copy(camera.position).addScaledVector(shotDir, 0.4);
        if (grenades.throwFrom(playerActor, shotOrigin, shotDir, 16)) {
          weapons.state.grenades -= 1;
          audio.throwWhoosh();
          pushHud();
        }
      }
      pushHud();
    }

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    input.endFrame();
    syncCamera();

    hud.setClock(match.phaseLeft, match.round, match.phase);
    hud.setScores(match.scores.attack, match.scores.defense, aliveCount('attack'), aliveCount('defense'));
    pushObjective();
    if (hud.buyVisible()) hud.refreshBuyMoney(match.playerMoney, `0:${String(Math.ceil(match.phaseLeft)).padStart(2, '0')}`);
    if (elapsed - lastMinimap > 0.12) {
      lastMinimap = elapsed;
      hud.drawMinimap({
        player: { x: player.state.body.position.x, z: player.state.body.position.z, yaw: player.state.yaw },
        allies: bots.bots.filter((b) => b.team === 'attack' && b.alive).map((b) => b.body.position),
        enemies: bots.bots.filter((b) => b.team === 'defense' && b.alive && elapsed - (b.lastShotAt ?? -Infinity) < 3).map((b) => b.body.position),
        sites: world.sites,
        chargePos: match.charge.state === 'dropped' || match.charge.state === 'planted' ? match.charge.position : null,
      });
    }
  }
  renderer.render(scene, camera);
}

// ---- screenshot staging -------------------------------------------------------------
function stageShot(name) {
  hud.hideOverlay();
  started = true;
  resetActorsForRound();
  match.startRound(actors);
  match.drainEvents();
  hud.hideBuy();
  weapons.give('rifle');
  weapons.switchTo('rifle');

  const place = (bot, x, z, yaw) => bots.reset(bot, new THREE.Vector3(x, 0, z), yaw);
  const atk = bots.byTeam('attack');
  const def = bots.byTeam('defense');

  if (name === 'start') {
    player.teleport(new THREE.Vector3(0, 0, 15.5), 0);
    place(atk[0], -3, 13, 0); place(atk[1], 3.4, 13.4, 0); place(atk[2], -13, 8, 0); place(atk[3], 13, 8, 0);
    place(def[0], -16, -12, Math.PI); place(def[1], 12, -10, Math.PI); place(def[2], 0, -12, Math.PI);
    place(def[3], -10, -18, Math.PI); place(def[4], 17, -17, Math.PI);
    hud.showOverlay('start');
    match.phase = 'live';
    match.phaseLeft = 115;
  } else if (name === 'play') {
    player.teleport(new THREE.Vector3(3.4, 0, -0.5), 0);
    playerActor.health = 78;
    weapons.ammoOf('rifle').mag = 24;
    place(atk[0], -4.5, 3.5, 0.4); place(atk[1], 1.8, 4.5, -0.3); place(atk[2], -14, -6, 0); place(atk[3], 15, 2, 0);
    place(def[0], 4.6, -10.5, Math.PI); place(def[1], -11, -13, Math.PI); place(def[2], 13, -13.5, Math.PI);
    place(def[3], -18, -18.5, Math.PI); place(def[4], 18, -19, Math.PI);
    def[0].lastShotAt = elapsed;
    match.phase = 'live';
    match.phaseLeft = 72;
    match.round = 6;
    match.scores.attack = 3;
    match.scores.defense = 2;
    match.playerMoney = 1450;
  } else {
    // 'end': the plant went off at A. Two defenders down, the squad holds the site.
    player.teleport(new THREE.Vector3(-8.5, 0, -10.5), 0.69);
    place(atk[0], -17, -12.5, -1.2); place(atk[1], -11, -19, 2.8); place(atk[2], -19.5, -17, -0.8); place(atk[3], 0, -3, 0);
    place(def[0], -11.5, -14, 0.8); place(def[1], -13.5, -12, 2.2); place(def[2], 14, -12, Math.PI);
    place(def[3], 16, -20, Math.PI); place(def[4], 0, -18, Math.PI);
    for (const fallen of [def[0], def[1]]) {
      fallen.alive = false;
      fallen.health = 0;
      fallen.group.rotation.x = -1.5;
      fallen.group.position.y = -0.25;
    }
    match.playerMoney = 2100;
    match.phase = 'planted';
    match.phaseLeft = 24;
    match.round = 6;
    match.scores.attack = 3;
    match.scores.defense = 2;
    match.charge.state = 'planted';
    match.charge.site = world.sites[0];
    match.charge.position = world.sites[0].plant.clone();
    chargeMesh.visible = true;
    chargeMesh.position.copy(world.sites[0].plant).setY(0.1);
    hud.banner('Charge planted', 'Site A — defend it', 60000);
  }
  pushHud();
  hud.setClock(match.phaseLeft, match.round, match.phase);
  hud.setScores(match.scores.attack, match.scores.defense, aliveCount('attack'), aliveCount('defense'));
  pushObjective();
  if (name === 'start') {
    hud.objective('');
    hud.chargeTag(null);
  }
  hud.drawMinimap({
    player: { x: player.state.body.position.x, z: player.state.body.position.z, yaw: player.state.yaw },
    allies: bots.bots.filter((b) => b.team === 'attack' && b.alive).map((b) => b.body.position),
    enemies: bots.bots.filter((b) => b.team === 'defense' && b.alive).map((b) => b.body.position),
    sites: world.sites,
    chargePos: match.charge.position,
  });
  syncCamera();
  // Aim the staged 'play' camera at the mid defender so the frame reads as a duel.
  if (name === 'play') {
    const target = def[0].body.position;
    const dx = target.x - player.state.body.position.x;
    const dz = target.z - player.state.body.position.z;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = 0.02;
    syncCamera();
  }
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

pushHud();
hud.setClock(115, 1, 'live');
if (shot) stageShot(shot);
else requestAnimationFrame(frame);
