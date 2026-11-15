// The map: EMBERYARD, a dusk decommissioned kiln yard. Three lanes (west, mid, east)
// run south to north into two plant sites, A in the north-west by the old kiln and B
// in the north-east among container stacks, joined by a south and a north connector.
// Every solid is a box: the same boxes are the player/bot colliders and the surfaces
// bullets stop on. Sites, spawns, hold points and the bot waypoint graph are data
// this module hands to the match and the bots, so the map is described exactly once.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'ember' || name === 'bone' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, { collide = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter. The yard is 48 x 48 m; walls are 5 m so nothing leaves.
  box(49, 0.4, 49, 0, -0.2, 0, 'ground');
  box(0.5, 5, 49, -24.2, 2.5, 0, 'surface');
  box(0.5, 5, 49, 24.2, 2.5, 0, 'surface');
  box(49, 5, 0.5, 0, 2.5, -24.2, 'surface');
  box(49, 5, 0.5, 0, 2.5, 24.2, 'surface');

  // Lane dividers between west/mid and mid/east, each with a door gap at z -8..-2
  // (the north connector) so lanes can be crossed under pressure.
  for (const side of [-1, 1]) {
    const x = side * 6;
    box(0.6, 4.2, 10, x, 2.1, -13, 'concrete'); // z -18..-8
    box(0.6, 4.2, 14, x, 2.1, 5, 'concrete'); // z -2..12
    box(0.6, 4.2, 8, x, 2.1, 20, 'concrete'); // z 16..24 (spawn pockets)
  }
  // South connector wall at z = 12: two segments between the lanes, so all three
  // lanes (west x -16, mid x 0, east x 16) pass through open gaps.
  box(10, 4.2, 0.6, -8, 2.1, 12, 'concrete');
  box(10, 4.2, 0.6, 8, 2.1, 12, 'concrete');
  // North wall above mid at z = -14, with a single mid door.
  box(9, 4.2, 0.6, -15.5, 2.1, -14, 'concrete');
  box(9, 4.2, 0.6, 15.5, 2.1, -14, 'concrete');
  box(3.4, 4.2, 0.6, -2.7, 2.1, -14, 'concrete');
  box(3.4, 4.2, 0.6, 2.7, 2.1, -14, 'concrete');

  // Site A: the old kiln, a squat furnace block with a chimney, plus crates.
  box(4.4, 3.4, 4.4, -15, 1.7, -17, 'surface');
  box(1.4, 3.2, 1.4, -15, 5, -17, 'surface');
  box(2.2, 1.1, 2.2, -10.5, 0.55, -12.5, 'concrete');
  box(1.6, 1.1, 1.6, -20, 0.55, -11, 'concrete');
  box(1.6, 2.2, 1.6, -20.5, 1.1, -20, 'surface');
  // Site B: container stacks.
  box(5.6, 2.4, 2.4, 14, 1.2, -18, 'ember');
  box(5.6, 2.4, 2.4, 14.6, 3.6, -18, 'surface');
  box(2.4, 2.4, 5.2, 20, 1.2, -13, 'concrete');
  box(1.6, 1.1, 1.6, 10, 0.55, -11.5, 'concrete');
  box(1.6, 1.1, 1.6, 19, 0.55, -20.5, 'concrete');

  // Mid: a broken silo base and low cover, so mid is fought over, not stared down.
  box(2.6, 2.6, 2.6, 0, 1.3, -6, 'surface');
  box(1.6, 1.1, 1.6, -2.8, 0.55, 2.5, 'concrete');
  box(1.6, 1.1, 1.6, 2.8, 0.55, 2.5, 'concrete');
  box(3.2, 1.1, 1.4, 0, 0.55, 8.5, 'concrete');

  // Lane cover: crates and barriers that break the long sightlines into peeks.
  const cover = [
    [1.6, 1.1, 1.6, -16, 0.55, 2, 'concrete'],
    [1.6, 2.2, 1.6, -15, 1.1, -4.5, 'surface'],
    [2.6, 1.1, 1.4, -11, 0.55, 7.5, 'concrete'],
    [1.6, 1.1, 1.6, 16, 0.55, 2, 'concrete'],
    [1.6, 2.2, 1.6, 15, 1.1, -4.5, 'surface'],
    [2.6, 1.1, 1.4, 11, 0.55, 7.5, 'concrete'],
    [1.4, 1.1, 1.4, -3.4, 0.55, 18.5, 'concrete'],
    [1.4, 1.1, 1.4, 3.4, 0.55, 18.5, 'concrete'],
    [1.6, 1.1, 1.6, -16, 0.55, -20.5, 'concrete'],
    [2.2, 1.1, 1.2, 0, 0.55, -19.5, 'concrete'],
  ];
  for (const args of cover) box(...args);

  // Painted site rings and lane stripes: flat, non-colliding, purely read by eye.
  function flat(width, depth, x, z, material, y = 0.02) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }
  flat(9, 0.5, -14, -9.6, 'ember');
  flat(9, 0.5, 14, -9.6, 'ember');
  flat(0.5, 9, -9.6, -14.5, 'ember');
  flat(0.5, 9, 9.6, -14.5, 'ember');
  flat(0.4, 20, 0, 2, 'bone');
  flat(14, 0.4, 0, 12.6, 'bone');

  // Light: low warm sun from the south-west, cool sky fill, ember glow at the sites
  // and a teal glow at attack spawn, so each end of the map reads at a glance.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.bone), new THREE.Color(PALETTE.ground), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.bone), 2.4);
  sun.position.set(-16, 26, 18);
  sun.target.position.set(2, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.7);
  fill.position.set(14, 12, -16);
  scene.add(fill);
  for (const [x, z] of [[-14, -15], [14, -15]]) {
    const glow = new THREE.PointLight(new THREE.Color(PALETTE.ember), 60, 18, 1.8);
    glow.position.set(x, 3.4, z);
    scene.add(glow);
  }
  const spawnGlow = new THREE.PointLight(new THREE.Color(PALETTE.teal), 40, 16, 1.8);
  spawnGlow.position.set(0, 3.4, 20);
  scene.add(spawnGlow);

  const sites = [
    { id: 'A', center: new THREE.Vector3(-14, 0, -14.5), radius: 5.2, plant: new THREE.Vector3(-12.6, 0, -15.5) },
    { id: 'B', center: new THREE.Vector3(14, 0, -14.5), radius: 5.2, plant: new THREE.Vector3(11.8, 0, -15.2) },
  ];

  const spawns = {
    attack: [
      new THREE.Vector3(0, 0, 21), new THREE.Vector3(-2.4, 0, 20), new THREE.Vector3(2.4, 0, 20),
      new THREE.Vector3(-1.2, 0, 22.4), new THREE.Vector3(1.2, 0, 22.4),
    ],
    defense: [
      new THREE.Vector3(-16, 0, -21.5), new THREE.Vector3(-11, 0, -21), new THREE.Vector3(0, 0, -20.5),
      new THREE.Vector3(11, 0, -21), new THREE.Vector3(16, 0, -21.5),
    ],
  };

  // Defender hold points per assignment, and the waypoint graph the bots walk.
  const holds = {
    A: [new THREE.Vector3(-19, 0, -19), new THREE.Vector3(-9.5, 0, -18.5)],
    B: [new THREE.Vector3(19, 0, -19.5), new THREE.Vector3(9.5, 0, -18)],
    mid: [new THREE.Vector3(-2.5, 0, -16.5), new THREE.Vector3(2.5, 0, -11)],
  };

  const waypoints = [
    [0, 21], [-3, 17], [3, 17], [0, 13.5],
    [-16, 15], [-16, 8], [-16, 1], [-16, -5], [-13, -8.5],
    [16, 15], [16, 8], [16, 1], [16, -5], [13, -8.5],
    [0, 8], [0, 3], [0, -3], [0, -10.5], [0, -16], [0, -20.5],
    [-4.5, -5], [4.5, -5], [-4.5, 6], [4.5, 6],
    [-14, -11], [-12.6, -15.5], [-19, -13], [-19, -19], [-9.5, -18.5], [-16, -21.5],
    [14, -11], [11.8, -15.2], [19, -13], [19, -19.5], [9.5, -18], [16, -21.5],
    [-10, -20.5], [10, -20.5], [-16, -14], [16, -14],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));

  return { colliders, shootables, group, sites, spawns, holds, waypoints };
}
