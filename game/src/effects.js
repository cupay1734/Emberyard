// Transient combat effects: bullet tracers, impact sparks, explosion flashes and a
// pooled debris burst. Everything is pre-allocated and recycled, so a firefight makes
// no per-frame garbage. Camera shake lives here too: main adds trauma, render reads
// the offset.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 40;
const SPARK_COUNT = 24;

export function createEffects(scene) {
  const tracers = [];
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = tracerGeo.clone();
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.bone), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparks = [];
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(PALETTE.ember), size: 0.14, transparent: true, opacity: 0,
    }));
    points.frustumCulled = false;
    points.visible = false;
    scene.add(points);
    sparks.push({ points, velocity: new THREE.Vector3(), life: 0 });
  }

  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 16, 1.6);
  scene.add(blastLight);
  let blastLeft = 0;
  let trauma = 0;
  const shakeOffset = new THREE.Vector3();

  return {
    tracer(from, to, friendly) {
      const slot = tracers.find((t) => t.life <= 0) ?? tracers[0];
      const pos = slot.line.geometry.getAttribute('position');
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, to.x, to.y, to.z);
      pos.needsUpdate = true;
      slot.line.material.color.set(friendly ? PALETTE.teal : PALETTE.ember);
      slot.line.material.opacity = 0.75;
      slot.line.visible = true;
      slot.life = 0.07;
    },
    impact(point) {
      for (let n = 0; n < 3; n += 1) {
        const slot = sparks.find((s) => s.life <= 0);
        if (!slot) return;
        const pos = slot.points.geometry.getAttribute('position');
        pos.setXYZ(0, point.x, point.y, point.z);
        pos.needsUpdate = true;
        slot.velocity.set((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4);
        slot.points.material.opacity = 0.95;
        slot.points.visible = true;
        slot.life = 0.28;
      }
    },
    explosion(point) {
      blastLight.position.copy(point).setY(point.y + 1);
      blastLeft = 0.3;
      blastLight.intensity = 260;
      for (let n = 0; n < 10; n += 1) this.impact(point);
    },
    addTrauma(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    shake() {
      const s = trauma * trauma * 0.09;
      shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0);
      return shakeOffset;
    },
    step(dt) {
      trauma = Math.max(0, trauma - dt * 1.7);
      if (blastLeft > 0) {
        blastLeft -= dt;
        if (blastLeft <= 0) blastLight.intensity = 0;
      }
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.75;
        if (t.life <= 0) t.line.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        const pos = s.points.geometry.getAttribute('position');
        pos.setXYZ(0, pos.getX(0) + s.velocity.x * dt, pos.getY(0) + s.velocity.y * dt, pos.getZ(0) + s.velocity.z * dt);
        s.velocity.y -= 6 * dt;
        pos.needsUpdate = true;
        s.points.material.opacity = Math.max(0, s.life / 0.28) * 0.95;
        if (s.life <= 0) s.points.visible = false;
      }
    },
  };
}
