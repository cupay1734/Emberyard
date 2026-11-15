// Shared body physics for the player and the bots: a vertical capsule approximated by
// a box, moved one axis at a time against the world's AABB colliders, with gravity and
// a floor at y = 0 plus standing on top of boxes. One implementation, so a bot and the
// player are stopped by exactly the same walls.
import * as THREE from 'three';

const probe = new THREE.Box3();

export function makeBody(x, z, radius = 0.34, height = 1.72) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    radius,
    height,
    onGround: true,
  };
}

export function overlapsAt(colliders, x, y, z, radius, height, lift = 0.02) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (const collider of colliders) {
    if (probe.intersectsBox(collider)) return collider;
  }
  return null;
}

// Move a body by its velocity for dt seconds. Horizontal axes stop at walls; the
// vertical axis lands on floors and box tops. Returns nothing; read body.onGround.
export function moveBody(body, colliders, dt, gravity = 20) {
  body.velocity.y -= gravity * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlapsAt(colliders, nextX, body.position.y, body.position.z, body.radius, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlapsAt(colliders, body.position.x, body.position.y, nextZ, body.radius, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlapsAt(colliders, body.position.x, body.position.y, body.position.z, body.radius, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
}

// Line of sight / bullet travel between two points: true when no collider blocks the
// segment. Colliders are boxes; a slab test per box is exact and allocation-free.
const dir = new THREE.Vector3();
const mid = new THREE.Vector3();

export function segmentBlocked(colliders, from, to) {
  dir.subVectors(to, from);
  const length = dir.length();
  if (length < 0.001) return false;
  dir.divideScalar(length);
  for (const box of colliders) {
    if (rayHitsBox(from, dir, length, box)) return true;
  }
  return false;
}

export function rayHitsBox(origin, direction, maxDistance, box) {
  let tmin = 0;
  let tmax = maxDistance;
  const axes = ['x', 'y', 'z'];
  for (const axis of axes) {
    const o = origin[axis];
    const d = direction[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < box.min[axis] || o > box.max[axis]) return false;
    } else {
      let t1 = (box.min[axis] - o) / d;
      let t2 = (box.max[axis] - o) / d;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

// Is a point inside any collider (expanded by margin)? Used to keep grenades and
// camera probes out of walls.
export function pointInColliders(colliders, point, margin = 0) {
  mid.copy(point);
  for (const box of colliders) {
    if (
      mid.x > box.min.x - margin && mid.x < box.max.x + margin &&
      mid.y > box.min.y - margin && mid.y < box.max.y + margin &&
      mid.z > box.min.z - margin && mid.z < box.max.z + margin
    ) return true;
  }
  return false;
}
