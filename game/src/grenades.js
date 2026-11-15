// Frag grenades: a thrown sphere with gravity, floor and wall bounces, a two-second
// fuse, and radial damage with a line-of-sight falloff. One pool, reused; the thrower
// is remembered so the kill feed can credit the right actor.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segmentBlocked } from './physics.js';

const RADIUS = 0.09;
const FUSE = 2.0;
const BLAST_RADIUS = 5.2;
const MAX_DAMAGE = 92;
const GRAVITY = 14;

const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.4 });
const bandMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.5 });

export function createGrenades(scene, colliders) {
  const pool = [];
  for (let i = 0; i < 6; i += 1) {
    const group = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 12, 10), grenadeMat);
    const band = new THREE.Mesh(new THREE.TorusGeometry(RADIUS, 0.02, 6, 14), bandMat);
    group.add(ball, band);
    group.visible = false;
    scene.add(group);
    pool.push({
      group,
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      fuse: 0,
      owner: null,
    });
  }

  const blastPoint = new THREE.Vector3();

  function throwFrom(owner, origin, direction, power = 15) {
    const g = pool.find((item) => !item.active);
    if (!g) return false;
    g.active = true;
    g.owner = owner;
    g.fuse = FUSE;
    g.position.copy(origin);
    g.velocity.copy(direction).multiplyScalar(power);
    g.velocity.y += 3.2;
    g.group.visible = true;
    g.group.position.copy(g.position);
    return true;
  }

  // Returns explosion events for this step: [{ position, owner }]. Damage is applied
  // by the caller, which knows the actors.
  function step(dt) {
    const events = [];
    for (const g of pool) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.velocity.y -= GRAVITY * dt;
      g.position.addScaledVector(g.velocity, dt);
      if (g.position.y < RADIUS) {
        g.position.y = RADIUS;
        g.velocity.y = Math.abs(g.velocity.y) * 0.42;
        g.velocity.x *= 0.72;
        g.velocity.z *= 0.72;
        if (Math.abs(g.velocity.y) < 0.6) g.velocity.y = 0;
      }
      // Bounce out of walls on the horizontal axes with a cheap point test.
      for (const axis of ['x', 'z']) {
        blastPoint.copy(g.position);
        blastPoint[axis] += Math.sign(g.velocity[axis]) * RADIUS;
        let inside = false;
        for (const box of colliders) {
          if (blastPoint.x > box.min.x && blastPoint.x < box.max.x && blastPoint.y > box.min.y && blastPoint.y < box.max.y && blastPoint.z > box.min.z && blastPoint.z < box.max.z) {
            inside = true;
            break;
          }
        }
        if (inside) {
          g.velocity[axis] *= -0.45;
          g.position[axis] -= Math.sign(g.velocity[axis]) * RADIUS * 2;
        }
      }
      g.group.position.copy(g.position);
      if (g.fuse <= 0) {
        g.active = false;
        g.group.visible = false;
        events.push({ position: g.position.clone(), owner: g.owner });
      }
    }
    return events;
  }

  // Damage an actor at `point` takes from a blast at `position`: full inside 1.6 m,
  // fading to zero at the rim, halved when a wall blocks the line.
  function damageAt(position, point) {
    const dist = position.distanceTo(point);
    if (dist > BLAST_RADIUS) return 0;
    let damage = MAX_DAMAGE * (dist <= 1.6 ? 1 : 1 - (dist - 1.6) / (BLAST_RADIUS - 1.6));
    blastPoint.copy(point).setY(point.y + 0.9);
    const from = new THREE.Vector3(position.x, position.y + 0.3, position.z);
    if (segmentBlocked(colliders, from, blastPoint)) damage *= 0.45;
    return Math.round(damage);
  }

  return { throwFrom, step, damageAt, BLAST_RADIUS };
}
