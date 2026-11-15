// The nine bot combatants: four teal attackers beside the player, five ember
// defenders. Each bot is a body in the shared physics, a box-built humanoid, a small
// economy (it buys its own gun each round from its own money), and a state machine
// that walks the waypoint graph, fights over lanes, guards or retakes the sites, and
// channels plants and defuses. Shooting itself is resolved by main.js through the
// combat interface, so a bot's bullet obeys the same raycasts as the player's.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBody, moveBody, segmentBlocked } from './physics.js';
import { WEAPONS } from './weapons.js';

const ATTACK_NAMES = ['Vex', 'Miro', 'Sable', 'Onyx'];
const DEFENSE_NAMES = ['Rook', 'Havoc', 'Juno', 'Piston', 'Grudge'];
const EYE = 1.52;
const CHEST = 1.15;

const teamMats = {
  attack: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6, metalness: 0.1 }),
  defense: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6, metalness: 0.1 }),
};
const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.8 });
const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.bone), roughness: 0.55 });

function buildHumanoid(team) {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), teamMats[team]);
  torso.position.y = 1.06;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), skinMat);
  head.position.y = 1.58;
  head.userData.part = 'head';
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.68, 0.28), darkMat);
  legs.position.y = 0.36;
  legs.userData.part = 'legs';
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.18, 1.18, -0.3);
  group.add(torso, head, legs, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return { group, torso, head, legs };
}

// Waypoint graph: nodes within reach and in chest-height line of sight are linked.
function buildGraph(waypoints, colliders) {
  const edges = waypoints.map(() => []);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  for (let i = 0; i < waypoints.length; i += 1) {
    for (let j = i + 1; j < waypoints.length; j += 1) {
      const dist = waypoints[i].distanceTo(waypoints[j]);
      if (dist > 11) continue;
      from.copy(waypoints[i]).setY(1.5);
      to.copy(waypoints[j]).setY(1.5);
      if (segmentBlocked(colliders, from, to)) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }
  return edges;
}

function findPath(waypoints, edges, startPos, goalPos) {
  let start = 0;
  let goal = 0;
  let bestStart = Infinity;
  let bestGoal = Infinity;
  for (let i = 0; i < waypoints.length; i += 1) {
    const ds = waypoints[i].distanceTo(startPos);
    const dg = waypoints[i].distanceTo(goalPos);
    if (ds < bestStart) { bestStart = ds; start = i; }
    if (dg < bestGoal) { bestGoal = dg; goal = i; }
  }
  if (start === goal) return [goalPos.clone()];
  const prev = new Array(waypoints.length).fill(-1);
  const seen = new Array(waypoints.length).fill(false);
  const queue = [start];
  seen[start] = true;
  while (queue.length) {
    const node = queue.shift();
    if (node === goal) break;
    for (const next of edges[node]) {
      if (!seen[next]) {
        seen[next] = true;
        prev[next] = node;
        queue.push(next);
      }
    }
  }
  if (!seen[goal]) return [goalPos.clone()];
  const path = [];
  for (let node = goal; node !== -1; node = prev[node]) path.push(waypoints[node].clone());
  path.reverse();
  path.push(goalPos.clone());
  return path;
}

export function createBots(scene, world, random) {
  const edges = buildGraph(world.waypoints, world.colliders);
  const bots = [];
  const hitMeshes = [];

  function makeBot(name, team, index) {
    const { group, torso, head, legs } = buildHumanoid(team);
    scene.add(group);
    const bot = {
      kind: 'bot',
      name,
      team,
      index,
      body: makeBody(0, 0, 0.34, 1.72),
      yaw: 0,
      health: 100,
      armor: false,
      alive: true,
      money: 900,
      weaponId: 'pistol',
      kills: 0,
      deaths: 0,
      group,
      hitMeshes: [torso, head, legs],
      // AI state
      mode: 'advance',
      holdPoint: null,
      path: [],
      pathAt: 0,
      decisionAt: 0,
      target: null,
      lastKnown: null,
      seenAt: -Infinity,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      pauseUntil: 0,
      strafeDir: 1,
      strafeAt: 0,
      crouchWanted: false,
      channel: null, // { kind: 'plant' | 'defuse', site } while channelling
      fall: 0,
      skill: 0.75 + random() * 0.45, // reaction/aim quality varies per bot
      eyePos: new THREE.Vector3(),
      chestPos: new THREE.Vector3(),
    };
    for (const mesh of bot.hitMeshes) {
      mesh.userData.actor = bot;
      hitMeshes.push(mesh);
    }
    bots.push(bot);
    return bot;
  }

  ATTACK_NAMES.forEach((name, i) => makeBot(name, 'attack', i));
  DEFENSE_NAMES.forEach((name, i) => makeBot(name, 'defense', i));

  const eyeOf = (bot) => bot.eyePos.set(bot.body.position.x, bot.body.position.y + EYE, bot.body.position.z);
  const chestOf = (bot) => bot.chestPos.set(bot.body.position.x, bot.body.position.y + CHEST, bot.body.position.z);

  function buyFor(bot) {
    // A small ladder: rifle when rich, smg on a force, pistol on an eco, armour with
    // whatever is left. Dying last round already dropped the bot back to the pistol.
    const buy = (id) => {
      const price = WEAPONS[id].price;
      if (bot.money < price) return false;
      bot.money -= price;
      bot.weaponId = id;
      return true;
    };
    if (bot.weaponId === 'pistol') {
      if (bot.money >= 2700) buy('rifle');
      else if (bot.money >= 1800 && random() < 0.4) buy('shotgun');
      else if (bot.money >= 1400) buy('smg');
    }
    if (!bot.armor && bot.money >= 650 && random() < 0.8) {
      bot.money -= 650;
      bot.armor = true;
    }
  }

  function reset(bot, spawn, yaw) {
    bot.body.position.set(spawn.x, 0, spawn.z);
    bot.body.velocity.set(0, 0, 0);
    bot.yaw = yaw;
    bot.health = 100;
    bot.alive = true;
    bot.fall = 0;
    bot.mode = bot.team === 'defense' ? 'hold' : 'advance';
    bot.path = [];
    bot.target = null;
    bot.lastKnown = null;
    bot.channel = null;
    bot.group.rotation.set(0, yaw, 0);
    bot.group.visible = true;
    syncMesh(bot);
  }

  function syncMesh(bot) {
    bot.group.position.copy(bot.body.position);
    if (bot.alive) {
      bot.group.rotation.set(0, bot.yaw, 0);
    } else if (bot.fall < 1) {
      bot.fall = Math.min(1, bot.fall + 0.05);
      bot.group.rotation.set(-bot.fall * 1.5, bot.yaw, 0);
      bot.group.position.y = bot.body.position.y - bot.fall * 0.25;
    }
  }

  function setPath(bot, goal) {
    bot.path = findPath(world.waypoints, edges, bot.body.position, goal);
    bot.pathAt = 0;
  }

  function moveAlong(bot, dt, speed) {
    while (bot.pathAt < bot.path.length) {
      const node = bot.path[bot.pathAt];
      const dx = node.x - bot.body.position.x;
      const dz = node.z - bot.body.position.z;
      if (Math.hypot(dx, dz) > 0.7) {
        bot.yaw = Math.atan2(-dx, -dz);
        bot.body.velocity.x = (dx / Math.hypot(dx, dz)) * speed;
        bot.body.velocity.z = (dz / Math.hypot(dx, dz)) * speed;
        return true;
      }
      bot.pathAt += 1;
    }
    bot.body.velocity.x = 0;
    bot.body.velocity.z = 0;
    return false;
  }

  function visibleEnemy(bot, ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const actor of ctx.actors) {
      if (!actor.alive || actor.team === bot.team || actor === bot) continue;
      const targetEye = actor.kind === 'player' ? actor.eyePos : eyeOf(actor);
      const dist = bot.body.position.distanceTo(actor.body.position);
      if (dist > 58) continue;
      const heard = ctx.time - (actor.lastShotAt ?? -Infinity) < 2.5 && dist < 22;
      const dx = actor.body.position.x - bot.body.position.x;
      const dz = actor.body.position.z - bot.body.position.z;
      const facing = Math.atan2(-dx, -dz);
      let angle = Math.abs(facing - bot.yaw) % (Math.PI * 2);
      if (angle > Math.PI) angle = Math.PI * 2 - angle;
      if (angle > 1.9 && !heard && dist > 7) continue;
      if (segmentBlocked(world.colliders, eyeOf(bot), targetEye)) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = actor;
      }
    }
    return best;
  }

  function decide(bot, ctx) {
    const seen = visibleEnemy(bot, ctx);
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactAt = ctx.time + (0.42 - bot.skill * 0.18);
        bot.burstLeft = 0;
        bot.pauseUntil = 0;
      }
      bot.lastKnown = seen.body.position.clone();
      bot.seenAt = ctx.time;
    } else if (ctx.time - bot.seenAt > 3.5) {
      bot.target = null;
    }

    bot.channel = null;
    if (bot.target && ctx.time >= bot.reactAt) {
      bot.mode = 'engage';
      return;
    }

    const charge = ctx.charge;
    if (charge.state === 'planted') {
      const site = charge.site;
      if (bot.team === 'defense') {
        const isDefuser = ctx.defuser === bot;
        if (isDefuser) {
          const dist = bot.body.position.distanceTo(site.plant);
          if (dist < 1.3) {
            bot.mode = 'channel';
            bot.channel = { kind: 'defuse', site };
            return;
          }
          bot.mode = 'retake';
          setPath(bot, site.plant);
          return;
        }
        bot.mode = 'retake';
        setPath(bot, nearestHold(bot, site));
        return;
      }
      bot.mode = 'guard';
      setPath(bot, nearestHold(bot, site));
      return;
    }

    if (bot.team === 'attack') {
      // The carrier plants: the player, or the ally who picked the charge up.
      if (charge.carrier === bot && charge.state === 'carried') {
        const site = ctx.attackSite;
        const dist = bot.body.position.distanceTo(site.plant);
        if (dist < 1.4 && inSite(bot, site)) {
          bot.mode = 'channel';
          bot.channel = { kind: 'plant', site };
          return;
        }
        bot.mode = 'advance';
        setPath(bot, site.plant);
        return;
      }
      if (charge.state === 'dropped') {
        const nearest = nearestBot(bots.filter((b) => b.team === 'attack' && b.alive), charge.position);
        if (nearest === bot) {
          bot.mode = 'advance';
          setPath(bot, charge.position);
          return;
        }
      }
      bot.mode = 'advance';
      setPath(bot, advanceGoal(bot, ctx));
      return;
    }

    // Defenders before the plant: hold the assigned post, rotate on contact calls
    // (an ally seeing an enemy pulls the mid defender toward that half).
    bot.mode = 'hold';
    if (!bot.holdPoint) bot.holdPoint = holdFor(bot, world);
    let goal = bot.holdPoint;
    if (ctx.contactSite && bot.assignment === 'mid') goal = ctx.contactSite.center;
    if (bot.body.position.distanceTo(goal) > 1.2) setPath(bot, goal);
  }

  function inSite(bot, site) {
    return bot.body.position.distanceTo(site.center) < site.radius + 1.5;
  }

  function nearestHold(bot, site) {
    const options = [...world.holds[site.id], site.center];
    let best = options[0];
    let bestDist = Infinity;
    for (const point of options) {
      const d = bot.body.position.distanceTo(point);
      if (d < bestDist) { bestDist = d; best = point; }
    }
    return best;
  }

  function advanceGoal(bot, ctx) {
    // Allies push the site the player is making for; the last ally watches mid.
    if (bot.index === ATTACK_NAMES.length - 1 && ctx.playerActor.alive) return world.waypoints[16];
    return ctx.attackSite.center;
  }

  function update(dt, ctx) {
    for (const bot of bots) {
      if (!bot.alive) {
        syncMesh(bot);
        continue;
      }
      if (ctx.time >= bot.decisionAt) {
        bot.decisionAt = ctx.time + 0.15;
        decide(bot, ctx);
      }

      let speed = 4.1;
      if (bot.mode === 'engage' && bot.target) {
        // Fight: keep the gun up, strafe between bursts, close or back off to range.
        const target = bot.target;
        const dist = bot.body.position.distanceTo(target.body.position);
        bot.yaw = Math.atan2(-(target.body.position.x - bot.body.position.x), -(target.body.position.z - bot.body.position.z));
        if (ctx.time >= bot.strafeAt) {
          bot.strafeAt = ctx.time + 0.7 + random() * 0.9;
          bot.strafeDir = random() < 0.5 ? -1 : 1;
        }
        const ideal = WEAPONS[bot.weaponId].kind === 'shotgun' ? 7 : 13;
        const radial = dist > ideal + 3 ? 1 : dist < ideal - 3 ? -1 : 0;
        const fx = -Math.sin(bot.yaw);
        const fz = -Math.cos(bot.yaw);
        const sx = Math.cos(bot.yaw) * bot.strafeDir;
        const sz = -Math.sin(bot.yaw) * bot.strafeDir;
        bot.body.velocity.x = (fx * radial + sx * 0.7) * 2.2;
        bot.body.velocity.z = (fz * radial + sz * 0.7) * 2.2;
        speed = 0; // velocity set directly above

        if (ctx.phase === 'live' || ctx.phase === 'planted') {
          if (bot.burstLeft <= 0 && ctx.time >= bot.pauseUntil) {
            bot.burstLeft = WEAPONS[bot.weaponId].auto ? 3 + Math.floor(random() * 3) : 1;
          }
          if (bot.burstLeft > 0 && ctx.time >= bot.nextShotAt) {
            bot.nextShotAt = ctx.time + WEAPONS[bot.weaponId].interval * (0.9 + random() * 0.3);
            bot.burstLeft -= 1;
            if (bot.burstLeft === 0) bot.pauseUntil = ctx.time + 0.45 + random() * 0.6;
            ctx.combat.tryShoot(bot, target);
          }
        }
      } else if (bot.mode === 'channel') {
        bot.body.velocity.x = 0;
        bot.body.velocity.z = 0;
        if (bot.channel?.kind === 'plant') bot.yaw += dt * 0.4; // scanning while planting
      } else if (bot.mode === 'hold') {
        if (!moveAlong(bot, dt, 3.4)) {
          bot.body.velocity.x = 0;
          bot.body.velocity.z = 0;
          bot.yaw += Math.sin(ctx.time * 0.4 + bot.index * 2.1) * dt * 0.7; // scanning the lane
        }
      } else {
        moveAlong(bot, dt, speed);
      }

      // Separation: bots never stack inside each other.
      for (const other of bots) {
        if (other === bot || !other.alive) continue;
        const dx = bot.body.position.x - other.body.position.x;
        const dz = bot.body.position.z - other.body.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.0001 && d2 < 0.64) {
          const d = Math.sqrt(d2);
          bot.body.position.x += (dx / d) * (0.8 - d) * 0.5;
          bot.body.position.z += (dz / d) * (0.8 - d) * 0.5;
        }
      }

      moveBody(bot.body, world.colliders, dt);
      syncMesh(bot);
    }
  }

  return {
    bots,
    hitMeshes,
    update,
    buyFor,
    reset,
    eyeOf,
    chestOf,
    byTeam(team) {
      return bots.filter((bot) => bot.team === team);
    },
    aliveCount(team) {
      return bots.filter((bot) => bot.team === team && bot.alive).length;
    },
  };
}

function nearestBot(list, position) {
  let best = null;
  let bestDist = Infinity;
  for (const bot of list) {
    const d = bot.body.position.distanceTo(position);
    if (d < bestDist) { bestDist = d; best = bot; }
  }
  return best;
}

function holdFor(bot, world) {
  const assignments = ['A', 'B', 'mid', 'A', 'B'];
  bot.assignment = assignments[bot.index % assignments.length];
  const points = world.holds[bot.assignment === 'mid' ? 'mid' : bot.assignment];
  return points[bot.index % points.length];
}
