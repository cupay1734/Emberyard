// Player movement: acceleration and friction on the ground, weak control in the air,
// crouch, slow-walk and jump, all resolved through the shared body physics so the
// player collides exactly as the bots do. Accuracy lives in weapons.js; this module
// only reports how fast and how settled the body is.
import * as THREE from 'three';
import { makeBody, moveBody, overlapsAt } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const RUN_SPEED = 4.9;
const WALK_SPEED = 2.6;
const CROUCH_SPEED = 2.2;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 8;
const FRICTION = 10;
const JUMP_SPEED = 6.0;

export function createPlayer(colliders, spawn) {
  const body = makeBody(spawn.x, spawn.z, 0.34, STAND_HEIGHT);
  body.position.y = spawn.y;
  const state = {
    body,
    position: body.position,
    velocity: body.velocity,
    yaw: 0, // yaw 0 faces -z (north, toward the sites): forward = (-sin yaw, -cos yaw)
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    walking: false,
    get onGround() {
      return body.onGround;
    },
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0021) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function teleport(point, yaw = 0) {
    body.position.set(point.x, point.y, point.z);
    body.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.crouching = false;
    body.height = STAND_HEIGHT;
    state.eye = STAND_EYE;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && state.crouching && !overlapsAt(colliders, body.position.x, body.position.y, body.position.z, body.radius, STAND_HEIGHT, 0.02)) {
      state.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);
    state.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = state.crouching ? CROUCH_SPEED : state.walking ? WALK_SPEED : RUN_SPEED;
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    moveBody(body, colliders, dt);
  }

  return {
    state,
    step,
    look,
    recoil,
    teleport,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    // 0 when standing still on the ground, 1 at full run or airborne: the spread input.
    moveFactor() {
      const speed = Math.hypot(body.velocity.x, body.velocity.z) / RUN_SPEED;
      const air = body.onGround ? 0 : 0.6;
      const crouchBonus = state.crouching ? -0.25 : 0;
      return Math.max(0, Math.min(1, speed + air + crouchBonus));
    },
  };
}
