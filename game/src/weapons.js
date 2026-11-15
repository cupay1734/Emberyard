// The armoury: five guns defined as data, one inventory, and the view models.
// Damage is per pellet on the body; main.js applies the part multiplier (head x3.2,
// legs x0.75) and range falloff. Spread is the tactical core: every gun is near-exact
// standing still and blooms hard on the move, so stopping to shoot always pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sparrow', kind: 'pistol', slot: 'sidearm', price: 0,
    damage: 25, interval: 0.24, auto: false, pellets: 1, mag: 12, reserve: 48,
    reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, kick: 0.35, falloff: 28,
  },
  smg: {
    id: 'smg', name: 'Ripper-9', kind: 'smg', slot: 'primary', price: 1400,
    damage: 21, interval: 0.075, auto: true, pellets: 1, mag: 32, reserve: 96,
    reload: 1.7, spreadStill: 0.009, spreadMove: 0.036, kick: 0.22, falloff: 20,
  },
  rifle: {
    id: 'rifle', name: 'VK Longshore', kind: 'rifle', slot: 'primary', price: 2700,
    damage: 34, interval: 0.105, auto: true, pellets: 1, mag: 30, reserve: 90,
    reload: 1.9, spreadStill: 0.0025, spreadMove: 0.03, kick: 0.5, falloff: 42,
  },
  shotgun: {
    id: 'shotgun', name: 'Boar-12', kind: 'shotgun', slot: 'primary', price: 1800,
    damage: 9, interval: 0.85, auto: false, pellets: 8, mag: 6, reserve: 24,
    reload: 2.6, spreadStill: 0.042, spreadMove: 0.055, kick: 1.0, falloff: 10,
  },
  dmr: {
    id: 'dmr', name: 'Kestrel .308', kind: 'dmr', slot: 'primary', price: 3400,
    damage: 72, interval: 0.55, auto: false, pellets: 1, mag: 8, reserve: 32,
    reload: 2.2, spreadStill: 0.0008, spreadMove: 0.04, kick: 0.9, falloff: 70,
  },
};
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;
export const ARMOR_PRICE = 650;
export const PART_MULTIPLIER = { head: 3.2, torso: 1, legs: 0.75 };

const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.25 });
const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.concrete), roughness: 0.45, metalness: 0.4 });
const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.5, metalness: 0.2 });

function part(geo, mat, x, y, z) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// A view model per gun, built from boxes in the same visual language as the world.
// Every part stays at local z <= 0.13 and the group sits 0.55 m out, so nothing comes
// close enough to the camera to balloon across the frame.
function buildViewModel(def) {
  const model = new THREE.Group();
  if (def.kind === 'pistol') {
    model.add(part(new THREE.BoxGeometry(0.055, 0.09, 0.2), bodyMat, 0, 0, -0.1));
    model.add(part(new THREE.BoxGeometry(0.045, 0.1, 0.05), gripMat, 0, -0.08, -0.02));
  } else if (def.kind === 'shotgun' || def.kind === 'dmr') {
    model.add(part(new THREE.BoxGeometry(0.07, 0.09, 0.52), bodyMat, 0, 0, -0.2));
    model.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.42), gripMat, 0, 0.02, -0.62));
    model.add(part(new THREE.BoxGeometry(0.06, 0.05, 0.06), accentMat, 0, 0.08, -0.25));
    model.add(part(new THREE.BoxGeometry(0.07, 0.08, 0.2), gripMat, 0, -0.03, 0.12));
  } else {
    model.add(part(new THREE.BoxGeometry(0.08, 0.1, 0.4), bodyMat, 0, 0, -0.18));
    model.add(part(new THREE.BoxGeometry(0.04, 0.04, 0.34), gripMat, 0, 0.03, -0.52));
    model.add(part(new THREE.BoxGeometry(0.05, 0.13, 0.07), gripMat, 0, -0.1, -0.12));
    model.add(part(new THREE.BoxGeometry(0.07, 0.07, 0.14), gripMat, 0, -0.02, 0.06));
    if (def.kind === 'rifle') model.add(part(new THREE.BoxGeometry(0.03, 0.045, 0.09), accentMat, 0, 0.07, -0.22));
  }
  model.position.set(0.25, -0.23, -0.55);
  model.visible = false;
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def);
    camera.add(models[def.id]);
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.25, -0.2, -1.18);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 6);
  flashLight.position.set(0.25, -0.17, -0.85);
  camera.add(flashLight);

  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve };

  const inv = {
    owned: new Set(['pistol']),
    current: 'pistol',
    grenades: 0,
    armor: false,
    cooldown: 0,
    reloadLeft: 0,
    flashLeft: 0,
    kick: 0,
    triggerHeld: false,
  };

  function def() {
    return WEAPONS[inv.current];
  }

  function showModel() {
    for (const [id, model] of Object.entries(models)) model.visible = id === inv.current;
  }
  showModel();

  return {
    state: inv,
    def,
    ammoOf(id) {
      return ammo[id];
    },
    currentAmmo() {
      return ammo[inv.current];
    },
    give(id) {
      inv.owned.add(id);
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    },
    hasPrimary() {
      return [...inv.owned].some((id) => WEAPONS[id].slot === 'primary');
    },
    primaryId() {
      return [...inv.owned].find((id) => WEAPONS[id].slot === 'primary') ?? null;
    },
    dropPrimary() {
      for (const id of [...inv.owned]) if (WEAPONS[id].slot === 'primary') inv.owned.delete(id);
      if (WEAPONS[inv.current].slot === 'primary') this.switchTo('pistol');
    },
    switchTo(id) {
      if (!inv.owned.has(id) || id === inv.current) return false;
      inv.current = id;
      inv.reloadLeft = 0;
      inv.cooldown = Math.max(inv.cooldown, 0.18);
      showModel();
      return true;
    },
    topUpAll() {
      for (const d of Object.values(WEAPONS)) ammo[d.id] = { mag: d.mag, reserve: d.reserve };
    },
    ready() {
      return inv.cooldown === 0 && inv.reloadLeft === 0 && ammo[inv.current].mag > 0;
    },
    // One trigger pull. Returns the pellet count to resolve, or 0 if it cannot fire.
    fire() {
      const d = def();
      const a = ammo[inv.current];
      if (inv.reloadLeft > 0 || inv.cooldown > 0) return 0;
      if (!d.auto && inv.triggerHeld) return 0;
      if (a.mag <= 0) return 0;
      a.mag -= 1;
      inv.cooldown = d.interval;
      inv.flashLeft = 0.055;
      inv.kick = Math.min(1, inv.kick + d.kick * 0.14);
      return d.pellets;
    },
    dryFire() {
      if (inv.cooldown > 0 || inv.reloadLeft > 0) return false;
      if (!def().auto && inv.triggerHeld) return false;
      if (ammo[inv.current].mag > 0) return false;
      inv.cooldown = 0.3;
      return true;
    },
    reload() {
      const a = ammo[inv.current];
      if (inv.reloadLeft > 0 || a.mag === def().mag || a.reserve === 0) return false;
      inv.reloadLeft = def().reload;
      return true;
    },
    spread(moveFactor) {
      const d = def();
      return d.spreadStill + moveFactor * (d.spreadMove - d.spreadStill);
    },
    damageAt(distance) {
      const d = def();
      if (distance <= d.falloff) return d.damage;
      return Math.max(1, Math.round(d.damage * Math.max(0.35, 1 - (distance - d.falloff) / 60)));
    },
    step(dt) {
      inv.cooldown = Math.max(0, inv.cooldown - dt);
      inv.flashLeft = Math.max(0, inv.flashLeft - dt);
      inv.kick += (0 - inv.kick) * Math.min(1, dt * 13);
      const model = models[inv.current];
      model.position.z = -0.55 + inv.kick * 0.4;
      model.rotation.x = inv.kick * 0.9;
      if (inv.reloadLeft > 0) {
        inv.reloadLeft = Math.max(0, inv.reloadLeft - dt);
        model.rotation.x = -0.6 * Math.sin(Math.PI * (1 - inv.reloadLeft / def().reload));
        if (inv.reloadLeft === 0) {
          const a = ammo[inv.current];
          const take = Math.min(def().mag - a.mag, a.reserve);
          a.mag += take;
          a.reserve -= take;
        }
      }
      flash.visible = inv.flashLeft > 0;
      if (flash.visible) flash.rotation.z = inv.flashLeft * 40;
      flashLight.intensity = inv.flashLeft > 0 ? 20 : 0;
    },
  };
}
