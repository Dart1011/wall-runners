import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEGMENT_LENGTH, characterFor, getSegment, hash } from '../shared/game.js';

import { attachScout, loadModel, playScout } from './scout-motion.js';

const clamp = THREE.MathUtils.clamp;

function cobbleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#777b70';
  context.fillRect(0, 0, 256, 256);
  let seed = 42;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let row = 0; row < 12; row += 1) {
    for (let column = -1; column < 8; column += 1) {
      const x = column * 40 + (row % 2) * 20;
      const y = row * 22;
      const shade = Math.floor(112 + random() * 34);
      context.fillStyle = `rgb(${shade + 4},${shade + 5},${shade - 2})`;
      context.fillRect(x + 2, y + 2, 36, 18);
      context.fillStyle = 'rgba(215,213,191,.16)';
      context.fillRect(x + 3, y + 3, 34, 2);
      context.fillStyle = 'rgba(25,33,28,.15)';
      context.fillRect(x + 3, y + 18, 35, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 120);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function plasterTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ddd5be';
  context.fillRect(0, 0, 128, 128);
  for (let index = 0; index < 2000; index += 1) {
    context.fillStyle = `rgba(70,57,38,${Math.random() * 0.09})`;
    context.fillRect(Math.random() * 128, Math.random() * 128, Math.random() * 3 + 1, Math.random() * 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roofGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 0.5, -0.5,
    -0.5, 0, 0.5, 0, 0.5, 0.5, 0.5, 0, 0.5,
    -0.5, 0, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5,
    -0.5, 0, -0.5, 0, 0.5, 0.5, -0.5, 0, 0.5,
    0.5, 0, -0.5, 0.5, 0, 0.5, 0, 0.5, 0.5,
    0.5, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function nameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(19,43,30,.8)';
  context.fillRect(23, 6, 210, 43);
  context.strokeStyle = '#d9eeac';
  context.lineWidth = 1;
  context.strokeRect(23, 6, 210, 43);
  context.fillStyle = '#eff5de';
  context.font = '600 23px sans-serif';
  context.textAlign = 'center';
  context.fillText(name.toUpperCase().slice(0, 14), 128, 35);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.y = 3.1;
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

export class CityWorld {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#adbfaf');
    this.scene.fog = new THREE.Fog('#adbfaf', 62, 245);
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 650);
    this.clock = 0;
    this.demoDistance = 0;
    this.chunks = new Map();
    this.chunkPool = [];
    this.actors = new Map();
    this.materials = {};
    this.geometry = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
      tapered: new THREE.CylinderGeometry(0.72, 1, 1, 8),
      sphere: new THREE.SphereGeometry(1, 10, 7),
      roof: roofGeometry(),
      cone: new THREE.ConeGeometry(1, 1, 5),
      torus: new THREE.TorusGeometry(0.72, 0.045, 5, 20),
      octahedron: new THREE.OctahedronGeometry(0.44),
      banner: new THREE.PlaneGeometry(1.4, 2.3),
      wire: new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-13, 15, -20), new THREE.Vector3(0, 13, -20), new THREE.Vector3(13, 15.5, -20)]),
    };
    this.makeMaterials();
    this.makeLighting();
    this.makeStreet();
    loadModel('Trost_Street').then(({ scene }) => {
      this.trost = scene;
      // Use the existing cobblestone road throughout the city.
      this.trost.getObjectByName('road')?.removeFromParent();
      this.trost.traverse(part => {
        if (part.isMesh) part.castShadow = part.receiveShadow = true;
      });
      this.chunkSeed = undefined;
    }).catch(error => console.warn('Trost street unavailable', error));
    this.localActor = this.makeScout('eren', 'You', false);
    this.scene.add(this.localActor.root);
    this.titan = this.makeTitan();
    this.scene.add(this.titan.root);
    this.makeParticles();
    this.makeSkyline();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
  }

  makeMaterials() {
    const standard = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.93, flatShading: true, ...options });
    const plaster = plasterTexture();
    this.materials = {
      road: standard('#b1b0a0', { map: cobbleTexture(), bumpMap: cobbleTexture(), bumpScale: 0.1 }),
      sidewalk: standard('#b7b2a0'),
      wall: standard('#a29f88', { map: plaster }),
      walls: ['#c7b997', '#c5b58d', '#d3c5a7', '#b5a384', '#cfbea0', '#b6b7a0'].map((color) => standard(color, { map: plaster })),
      roofs: ['#7f4c37', '#88513c', '#694b3b', '#985f44'].map((color) => standard(color)),
      wood: standard('#65513b'),
      woodLight: standard('#9c8058'),
      darkWood: standard('#423e30'),
      glass: standard('#42534b', { roughness: 0.4 }),
      stone: standard('#858d7a'),
      metal: standard('#515c54', { metalness: 0.65, roughness: 0.45 }),
      iron: standard('#343f37', { metalness: 0.5 }),
      green: standard('#344f3d', { side: THREE.DoubleSide }),
      greenLight: standard('#506748', { side: THREE.DoubleSide }),
      canvas: standard('#a79c73', { side: THREE.DoubleSide }),
      canvasGreen: standard('#6d7c62', { side: THREE.DoubleSide }),
      leaves: standard('#536c48'),
      gold: standard('#e0b964', { emissive: '#9f6d24', emissiveIntensity: 0.35, metalness: 0.45 }),
      gas: standard('#b7d994', { emissive: '#6b9d48', emissiveIntensity: 0.3, metalness: 0.35 }),
      red: standard('#c76148', { emissive: '#9f3829', emissiveIntensity: 0.3 }),
      white: standard('#ece8cd'),
      titanSkin: standard('#b48364'),
      titanLight: standard('#ca9d79'),
      titanDark: standard('#895b47'),
      hair: standard('#302f26'),
      eye: standard('#e5d8a6', { emissive: '#c8b259', emissiveIntensity: 0.45 }),
      cableLine: new THREE.LineBasicMaterial({ color: '#3b4335' }),
    };
  }

  mesh(geometry, material, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, shadow = false) {
    const mesh = new THREE.Mesh(geometry, typeof material === 'string' ? this.materials[material] : material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(parent, material, x, y, z, sx, sy, sz, shadow = false) {
    return this.mesh(this.geometry.box, material, parent, x, y, z, sx, sy, sz, shadow);
  }

  cylinder(parent, material, x, y, z, radius, height, shadow = false) {
    return this.mesh(this.geometry.cylinder, material, parent, x, y, z, radius, height, radius, shadow);
  }

  makeLighting() {
    const hemisphere = new THREE.HemisphereLight('#e5e9ce', '#69765a', 2.1);
    this.scene.add(hemisphere);
    this.sun = new THREE.DirectionalLight('#fff0cd', 3.2);
    this.sun.position.set(-38, 65, 28);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -36, right: 36, top: 38, bottom: -30, near: 1, far: 150 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun, this.sun.target);
  }

  makeStreet() {
    this.road = this.mesh(new THREE.PlaneGeometry(22, 700), 'road', this.scene, 0, -0.03, -270);
    this.road.rotation.x = -Math.PI / 2;
    this.road.receiveShadow = true;
    this.box(this.scene, 'sidewalk', -10.8, 0.07, -270, 1.6, 0.2, 700);
    this.box(this.scene, 'sidewalk', 10.8, 0.07, -270, 1.6, 0.2, 700);
    this.box(this.scene, 'stone', -9.95, 0.08, -270, 0.16, 0.24, 700);
    this.box(this.scene, 'stone', 9.95, 0.08, -270, 0.16, 0.24, 700);
    this.landmark = new THREE.Group();
    this.box(this.landmark, 'wall', 0, 16, 0, 78, 32, 5, true);
    this.box(this.landmark, 'darkWood', 0, 5, 2.55, 10, 10, 0.2);
    for (let x = -37; x <= 37; x += 5) this.box(this.landmark, 'wall', x, 33, 0, 3, 2, 5.8);
    for (let x = -6; x <= 6; x += 2) this.box(this.landmark, 'stone', x, 11.5 - Math.abs(x) * 0.35, 2.8, 2.2, 2.3, 0.8);
    this.scene.add(this.landmark);
  }

  makeSkyline() {
    this.clouds = new THREE.Group();
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: '#e1e5ce', transparent: true, opacity: 0.35, fog: true });
    for (let index = 0; index < 13; index += 1) {
      const cloud = this.mesh(this.geometry.sphere, cloudMaterial, this.clouds, (hash(6, index) - 0.5) * 220, 48 + hash(8, index) * 30, -100 - hash(7, index) * 220, 16 + hash(2, index) * 22, 2.2 + hash(1, index) * 3, 7);
      cloud.rotation.z = hash(3, index) * 0.3;
    }
    this.scene.add(this.clouds);
    this.birds = [];
    const birdMaterial = new THREE.LineBasicMaterial({ color: '#4e6052', transparent: true, opacity: 0.6 });
    for (let index = 0; index < 9; index += 1) {
      const bird = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.6, 0, 0), new THREE.Vector3(0, -0.18, 0), new THREE.Vector3(0.6, 0, 0)]), birdMaterial);
      bird.position.set((hash(11, index) - 0.5) * 45, 18 + hash(12, index) * 15, -30 - hash(13, index) * 90);
      this.scene.add(bird);
      this.birds.push(bird);
    }
  }

  clearGroup(group) {
    group.traverse((child) => {
      if (child.userData.bakedGeometry) child.geometry.dispose();
    });
    while (group.children.length) group.remove(group.children[0]);
  }

  bakeChunk(group) {
    const dynamic = new Set(group.userData.pickups.map((item) => item.group));
    const buckets = new Map();
    group.updateMatrixWorld(true);
    const inverse = group.matrixWorld.clone().invert();
    for (const child of [...group.children]) {
      if (dynamic.has(child) || child.isLine) continue;
      child.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
        if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
        if (!buckets.has(mesh.material)) buckets.set(mesh.material, []);
        buckets.get(mesh.material).push(geometry);
      });
      group.remove(child);
    }
    for (const [material, geometries] of buckets) {
      const geometry = mergeGeometries(geometries, false);
      for (const part of geometries) part.dispose();
      if (!geometry) continue;
      const combined = new THREE.Mesh(geometry, material);
      combined.castShadow = true;
      combined.receiveShadow = true;
      combined.userData.bakedGeometry = true;
      group.add(combined);
    }
  }

  buildChunk(index, seed) {
    const group = this.chunkPool.pop() || new THREE.Group();
    this.clearGroup(group);
    group.position.z = -index * SEGMENT_LENGTH;
    group.userData.pickups = [];
    group.userData.anchors = [];
    let district;
    if (this.trost && index % 4 < 2) {
      district = this.trost.clone(true);
      district.scale.set(1.72, 1.12, SEGMENT_LENGTH / 48);
      district.position.z = -SEGMENT_LENGTH / 2;
      district.updateMatrix();
      district.traverse(part => {
        if (part.name.startsWith('Anchor_')) {
          const point = part.getWorldPosition(new THREE.Vector3());
          point.z += group.position.z;
          group.userData.anchors.push(point);
        }
      });
    } else {
      for (const side of [-1, 1]) {
        this.box(group, 'wall', side * 25.5, 11.5, -22, 4, 23, 44);
        for (let z = -2; z > -44; z -= 5) this.box(group, 'wall', side * 25.5, 23.7, z, 4.8, 1.5, 2.7);
        for (let building = 0; building < 2; building += 1) {
          const random = hash(seed, index, building + (side === 1 ? 60 : 30));
          const width = 6.5 + random * 3;
          const height = 8.5 + hash(seed, index, building + 75 + side) * 9;
          const depth = 19.5;
          const z = -11 - building * 22;
          const x = side * (11.6 + width / 2);
          const bracket = new THREE.Vector3(side * 11.2, height - .8, z);
          this.box(group, 'gold', bracket.x, bracket.y, z, .75, .24, .46);
          group.userData.anchors.push(new THREE.Vector3(bracket.x, bracket.y, z + group.position.z));
          const wall = this.materials.walls[Math.floor(random * this.materials.walls.length)];
          this.box(group, wall, x, height / 2, z, width, height, depth, true);
          this.box(group, 'stone', side * 11.52, 0.6, z, 0.24, 1.2, depth);
          const roof = this.mesh(this.geometry.roof, this.materials.roofs[Math.floor(hash(seed, index, building + 95) * 4)], group, x, height, z, width + 0.9, 4.4, depth + 1, true);
          roof.rotation.y = building % 2 && random > 0.5 ? Math.PI / 2 : 0;
          this.box(group, 'wood', side * 11.47, height - 0.15, z, 0.22, 0.28, depth + 0.15);
          for (let floor = 0; floor < Math.floor((height - 1.8) / 3); floor += 1) {
            const y = 3.1 + floor * 3;
            this.box(group, 'wood', side * 11.48, y - 1.2, z, 0.18, 0.16, depth);
            for (const windowZ of [-6, 0, 6]) {
              this.box(group, 'wood', side * 11.45, y, z + windowZ, 0.18, 1.5, 1.1);
              this.box(group, 'glass', side * 11.33, y, z + windowZ, 0.12, 1.22, 0.81);
              this.box(group, 'woodLight', side * 11.22, y, z + windowZ, 0.12, 1.27, 0.07);
              this.box(group, 'woodLight', side * 11.22, y, z + windowZ, 0.12, 0.07, 0.84);
            }
          }
          this.box(group, 'darkWood', side * 11.43, 1.35, z + 2, 0.18, 2.7, 1.4);
          this.box(group, 'woodLight', side * 11.29, 1.35, z + 2, 0.12, 2.4, 0.08);
          const awning = this.box(group, random > 0.5 ? 'canvasGreen' : 'canvas', side * 10.83, 3.05, z + 2, 1.55, 0.12, 3.8);
          awning.rotation.z = side * 0.18;
          this.box(group, 'wood', side * 10.2, 1.5, z + 0.2, 0.08, 3, 0.08);
          this.box(group, 'wood', side * 10.2, 1.5, z + 3.8, 0.08, 3, 0.08);
          if (random > 0.4) {
            this.box(group, 'wood', side * (13 + width / 2), height + 2.4, z - 4, 0.9, 3.1, 1.2);
            this.box(group, 'stone', side * (13 + width / 2), height + 4, z - 4, 1.1, 0.25, 1.4);
          }
          if (random > 0.58) {
            this.box(group, 'wood', side * 10.99, 5.3, z - 4.5, 1.15, 0.18, 3.2);
            for (let rail = -1; rail <= 1; rail += 1) this.box(group, 'iron', side * 10.45, 5.8, z - 4.5 + rail, 0.06, 1, 0.06);
            this.box(group, 'iron', side * 10.45, 6.25, z - 4.5, 0.06, 0.06, 3.2);
          }
        }
        for (const z of [-5, -32]) {
          this.cylinder(group, 'iron', side * 10.55, 2.1, z, 0.065, 4.2);
          this.box(group, 'iron', side * 10.55, 4.2, z, 0.42, 0.6, 0.42);
          this.box(group, 'gold', side * 10.55, 4.2, z + 0.22, 0.25, 0.37, 0.02);
          this.mesh(this.geometry.cone, 'iron', group, side * 10.55, 4.68, z, 0.4, 0.35, 0.4);
        }
        if (hash(seed, index, side + 140) > 0.45) {
          this.cylinder(group, 'wood', side * 10.9, 1.4, -19, 0.17, 2.8);
          this.mesh(this.geometry.sphere, 'leaves', group, side * 10.9, 3.4, -19, 1.25, 1.7, 1.15, true);
          this.mesh(this.geometry.sphere, 'leaves', group, side * 10.5, 4.1, -19, 0.9, 1.1, 0.9);
        }
      }
    }
    if (index % 3 === 0) {
      const cable = new THREE.Line(this.geometry.wire, this.materials.cableLine);
      group.add(cable);
      const banner = this.mesh(this.geometry.banner, 'green', group, 0, 12.3, -20);
      banner.rotation.z = 0.06;
      this.box(group, 'white', 0, 12.4, -19.97, 0.12, 0.85, 0.04);
    }
    const { obstacles, pickups } = getSegment(seed, index);
    for (const obstacle of obstacles) this.makeObstacle(group, obstacle, index);
    for (const pickup of pickups) {
      const item = this.makePickup(group, pickup, index);
      group.userData.pickups.push({ id: pickup.id, group: item, baseY: pickup.y, type: pickup.type });
    }
    this.scene.add(group);
    this.bakeChunk(group);
    if (district) group.add(district);
    return group;
  }

  makeObstacle(parent, obstacle, segment) {
    const group = new THREE.Group();
    group.position.set(obstacle.x, 0, -(obstacle.distance - segment * SEGMENT_LENGTH));
    if (obstacle.type === 'crates') {
      this.box(group, 'woodLight', -0.55, 0.75, 0, 1.3, 1.5, 1.4, true);
      this.box(group, 'wood', 0.6, 0.55, 0.1, 1.1, 1.1, 1.1, true);
      this.box(group, 'woodLight', 0.55, 1.5, 0.1, 1, 0.9, 1, true);
      for (const x of [-0.55, 0.6]) {
        this.box(group, 'darkWood', x, 0.8, 0.72, 1.3, 0.08, 0.05);
        this.box(group, 'darkWood', x, 0.8, -0.72, 1.3, 0.08, 0.05);
      }
    } else if (obstacle.type === 'cart') {
      this.box(group, 'woodLight', 0, 0.8, 0, 2.8, 0.55, 1.7, true);
      this.box(group, 'wood', 0, 1.2, -0.8, 3, 0.65, 0.12);
      this.box(group, 'wood', 0, 1.2, 0.8, 3, 0.65, 0.12);
      for (const x of [-1.1, 1.1]) {
        const wheel = this.mesh(this.geometry.cylinder, 'darkWood', group, x, 0.52, 0.9, 0.52, 0.16);
        wheel.rotation.x = Math.PI / 2;
        this.box(group, 'wood', x, 0.42, -2.1, 0.1, 0.12, 3.1);
      }
      this.mesh(this.geometry.sphere, 'canvas', group, 0.3, 1.3, 0, 0.75, 0.65, 0.6);
    } else {
      for (const x of [-1.8, 1.8]) {
        this.box(group, 'wood', x, 1.35, 0, 0.2, 2.7, 0.22, true);
        this.box(group, 'woodLight', x, 2.8, 0, 0.33, 0.18, 0.35);
      }
      this.box(group, 'woodLight', 0, 1.9, 0, 4.6, 0.6, 0.18, true);
      this.box(group, 'wood', 0, 1.1, 0, 4.6, 0.22, 0.18);
      for (const x of [-1.4, 0, 1.4]) this.box(group, 'white', x, 1.9, 0.11, 0.55, 0.6, 0.04);
    }
    parent.add(group);
  }

  makePickup(parent, pickup, segment) {
    const group = new THREE.Group();
    group.position.set(pickup.x, pickup.y, -(pickup.distance - segment * SEGMENT_LENGTH));
    const ringColor = pickup.type === 'gas' ? 'gas' : pickup.type === 'heart' ? 'red' : 'gold';
    const ring = this.mesh(this.geometry.torus, ringColor, group);
    ring.rotation.x = Math.PI / 2;
    if (pickup.type === 'gas') {
      this.cylinder(group, 'metal', 0, 0, 0, 0.28, 0.85);
      this.cylinder(group, 'gas', 0, 0.15, 0, 0.285, 0.5);
      this.box(group, 'metal', 0, 0.5, 0, 0.23, 0.16, 0.2);
      this.box(group, 'white', 0, 0.1, 0.285, 0.08, 0.32, 0.03);
      this.box(group, 'white', 0, 0.1, 0.285, 0.28, 0.08, 0.03);
    } else if (pickup.type === 'boost') {
      this.mesh(this.geometry.octahedron, 'gold', group);
      const inner = this.mesh(this.geometry.torus, 'white', group, 0, 0, 0, 0.45, 0.45, 0.45);
      inner.rotation.y = Math.PI / 2;
    } else if (pickup.type === 'heart') {
      this.mesh(this.geometry.sphere, 'red', group, -0.19, 0.15, 0, 0.28, 0.28, 0.23);
      this.mesh(this.geometry.sphere, 'red', group, 0.19, 0.15, 0, 0.28, 0.28, 0.23);
      const point = this.mesh(this.geometry.cone, 'red', group, 0, -0.19, 0, 0.4, 0.65, 0.34);
      point.rotation.z = Math.PI;
    } else {
      this.box(group, 'woodLight', 0, 0, 0, 0.65, 0.55, 0.4);
      this.box(group, 'white', 0, 0, 0.22, 0.3, 0.25, 0.03);
      this.box(group, 'green', 0, 0, 0.25, 0.06, 0.22, 0.03);
    }
    parent.add(group);
    return group;
  }

  makeScout(characterId, name, remote = true) {
    const character = characterFor(characterId);
    const root = new THREE.Group();
    const visual = new THREE.Group();
    root.add(visual);
    const jacket = new THREE.MeshStandardMaterial({ color: '#b69d76', roughness: 0.95, flatShading: true });
    const pants = new THREE.MeshStandardMaterial({ color: '#ded5b8', roughness: 1, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: character.skin, roughness: 1, flatShading: true });
    const hair = new THREE.MeshStandardMaterial({ color: character.hair, roughness: 1, flatShading: true });
    this.box(visual, jacket, 0, 1.34, 0, 0.67, 0.78, 0.4, true);
    this.box(visual, 'darkWood', 0, 1.01, 0, 0.66, 0.13, 0.42);
    this.box(visual, 'darkWood', -0.15, 1.36, -0.215, 0.08, 0.78, 0.045).rotation.z = -0.22;
    this.box(visual, 'darkWood', 0.15, 1.36, -0.215, 0.08, 0.78, 0.045).rotation.z = 0.22;
    this.box(visual, 'green', 0, 1.55, 0.235, 0.17, 0.22, 0.04);
    this.box(visual, 'white', 0, 1.56, 0.26, 0.04, 0.18, 0.03);
    this.cylinder(visual, skin, 0, 1.83, 0, 0.1, 0.2);
    this.mesh(this.geometry.sphere, skin, visual, 0, 2.04, -0.015, 0.26, 0.32, 0.25, true);
    this.mesh(this.geometry.sphere, hair, visual, 0, 2.23, 0.01, 0.28, 0.19, 0.27);
    for (let index = 0; index < 5; index += 1) {
      const bang = this.mesh(this.geometry.cone, hair, visual, -0.2 + index * 0.095, 2.18, -0.2, 0.07, 0.2 + (index % 2) * 0.05, 0.07);
      bang.rotation.x = Math.PI;
    }
    this.box(visual, 'iron', -0.09, 2.06, -0.249, 0.044, 0.025, 0.02);
    this.box(visual, 'iron', 0.09, 2.06, -0.249, 0.044, 0.025, 0.02);
    if (characterId === 'mikasa') {
      this.box(visual, hair, -0.23, 2.03, 0.02, 0.1, 0.38, 0.37);
      this.box(visual, hair, 0.23, 2.03, 0.02, 0.1, 0.38, 0.37);
      this.box(visual, 'red', 0, 1.79, 0, 0.44, 0.13, 0.4);
    }
    const legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.18, 0.94, 0);
      this.cylinder(leg, pants, 0, -0.28, 0, 0.13, 0.58, true);
      this.cylinder(leg, 'darkWood', 0, -0.67, 0, 0.105, 0.44, true);
      this.box(leg, 'darkWood', 0, -0.87, -0.08, 0.23, 0.14, 0.4);
      visual.add(leg);
      legs.push(leg);
      this.box(visual, 'metal', side * 0.4, 1.04, 0.03, 0.22, 0.32, 0.44, true);
      this.cylinder(visual, 'metal', side * 0.53, 1.06, 0.06, 0.065, 0.42);
    }
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.4, 1.65, 0);
      this.cylinder(arm, jacket, 0, -0.22, 0, 0.105, 0.48, true);
      this.cylinder(arm, skin, 0, -0.52, 0, 0.07, 0.22);
      this.box(arm, 'metal', 0, -0.4, 0, 0.18, 0.13, 0.18);
      const blade = this.box(arm, 'metal', 0, -0.56, -0.3, 0.045, 0.055, 0.65);
      blade.rotation.x = 0.05;
      visual.add(arm);
      arms.push(arm);
    }
    const capeGeometry = new THREE.PlaneGeometry(0.9, 1.05, 4, 4);
    const cape = this.mesh(capeGeometry, 'green', visual, 0, 1.3, 0.3);
    cape.geometry = capeGeometry;
    const capePositions = capeGeometry.attributes.position;
    for (let index = 0; index < capePositions.count; index += 1) {
      const y = capePositions.getY(index);
      capePositions.setZ(index, (0.525 - y) * 0.35);
    }
    capeGeometry.computeVertexNormals();
    const cableMaterial = new THREE.LineBasicMaterial({ color: '#d5dac4', transparent: true, opacity: 0.88 });
    const cableGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    const cable = new THREE.Line(cableGeometry, cableMaterial);
    cable.frustumCulled = false;
    root.add(cable);
    if (remote) root.add(nameTag(name));
    const actor = { root, visual, legs, arms, cape, cable, characterId, name };
    loadModel(character.name).then(asset => {
      if (root.parent) attachScout(actor, asset);
    }).catch(error => console.warn('Scout model unavailable', error));
    return actor;
  }

  makeTitan() {
    const root = new THREE.Group();
    const visual = new THREE.Group();
    root.add(visual);
    this.mesh(this.geometry.sphere, 'titanSkin', visual, 0, 6.5, 0, 1.55, 2.2, 0.85, true);
    this.mesh(this.geometry.sphere, 'titanLight', visual, -0.68, 7.1, -0.5, 0.87, 0.73, 0.5);
    this.mesh(this.geometry.sphere, 'titanLight', visual, 0.68, 7.1, -0.5, 0.87, 0.73, 0.5);
    for (let index = 0; index < 3; index += 1) {
      this.box(visual, 'titanLight', 0, 6.5 - index * 0.6, -0.75, 1.05, 0.43, 0.28).rotation.z = index % 2 ? 0.03 : -0.03;
    }
    this.cylinder(visual, 'titanDark', 0, 8.25, 0, 0.48, 1.15);
    const head = new THREE.Group();
    head.position.set(0, 9.35, -0.04);
    this.mesh(this.geometry.sphere, 'titanLight', head, 0, 0, 0, 0.87, 1.12, 0.76, true);
    this.mesh(this.geometry.sphere, 'hair', head, 0, 0.67, 0.08, 0.92, 0.58, 0.82);
    for (let index = 0; index < 7; index += 1) {
      const lock = this.mesh(this.geometry.cone, 'hair', head, -0.68 + index * 0.22, 0.6 - (index % 2) * 0.15, -0.58, 0.16, 0.65, 0.16);
      lock.rotation.x = Math.PI + 0.25;
    }
    this.box(head, 'titanDark', 0, -0.05, -0.7, 0.17, 0.42, 0.18);
    for (const side of [-1, 1]) {
      this.box(head, 'titanDark', side * 0.34, 0.27, -0.68, 0.4, 0.16, 0.1).rotation.z = side * 0.2;
      this.box(head, 'eye', side * 0.34, 0.12, -0.746, 0.26, 0.065, 0.05);
    }
    this.box(head, 'titanDark', 0, -0.52, -0.62, 1.15, 0.35, 0.23);
    for (let index = 0; index < 8; index += 1) this.box(head, 'white', -0.48 + index * 0.14, -0.44, -0.755, 0.1, 0.15, 0.035);
    visual.add(head);
    const limbs = [];
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 1.55, 7.4, 0);
      const upper = this.mesh(this.geometry.tapered, 'titanSkin', arm, 0, -1.35, 0, 0.47, 2.7, 0.47, true);
      upper.rotation.z = side * -0.12;
      this.mesh(this.geometry.sphere, 'titanLight', arm, side * 0.12, -2.8, -0.1, 0.42, 0.63, 0.43);
      this.mesh(this.geometry.sphere, 'titanLight', arm, side * 0.14, -3.4, -0.15, 0.48, 0.55, 0.3);
      visual.add(arm);
      limbs.push(arm);
      const leg = new THREE.Group();
      leg.position.set(side * 0.65, 4.85, 0);
      this.mesh(this.geometry.tapered, 'titanSkin', leg, 0, -1.6, 0, 0.66, 3.2, 0.64, true);
      this.mesh(this.geometry.tapered, 'titanLight', leg, 0, -3.75, 0, 0.4, 1.6, 0.4);
      this.mesh(this.geometry.sphere, 'titanSkin', leg, 0, -4.55, -0.3, 0.47, 0.3, 0.83);
      visual.add(leg);
      limbs.push(leg);
    }
    root.scale.setScalar(1.04);
    return { root, visual, head, limbs };
  }

  makeParticles() {
    this.gasCount = 60;
    this.gasData = new Float32Array(this.gasCount * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.gasData, 3));
    this.gasParticles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#d8e5b3', size: 0.065, transparent: true, opacity: 0.65, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.gasParticles.frustumCulled = false;
    this.scene.add(this.gasParticles);
    this.speedData = new Float32Array(70 * 6);
    for (let index = 0; index < 70; index += 1) {
      const x = (hash(5, index) - 0.5) * 21;
      const y = hash(7, index) * 11;
      const z = -hash(9, index) * 55;
      this.speedData.set([x, y, z, x, y, z + 1.5 + hash(10, index) * 2], index * 6);
    }
    const speedGeometry = new THREE.BufferGeometry();
    speedGeometry.setAttribute('position', new THREE.BufferAttribute(this.speedData, 3));
    this.speedLines = new THREE.LineSegments(speedGeometry, new THREE.LineBasicMaterial({ color: '#eef1d4', transparent: true, opacity: 0.22, depthWrite: false }));
    this.speedLines.frustumCulled = false;
    this.scene.add(this.speedLines);
  }

  animateScout(actor, player, time, dt) {
    actor.root.position.set(player.x, player.y - 1.1, -player.distance);
    actor.visual.visible = !(player.invincible > 0 && Math.floor(player.invincible * 12) % 2 === 0);
    actor.visual.rotation.z += ((-player.vx || 0) * -0.027 - actor.visual.rotation.z) * Math.min(1, dt * 8);
    const side = player.grappleSide || 1;
    const oldAnchor = actor.anchor;
    if (!player.grapple) actor.anchor = null;
    else if (!oldAnchor || Math.sign(oldAnchor.x) !== side ||
             oldAnchor.z > actor.root.position.z + 2 || oldAnchor.z < actor.root.position.z - 55) {
      actor.anchor = null;
      let best = Infinity;
      for (const chunk of this.chunks.values()) {
        for (const anchor of chunk.userData.anchors) {
          const ahead = actor.root.position.z - anchor.z;
          if (Math.sign(anchor.x) !== side || ahead < 8 || ahead >= best) continue;
          actor.anchor = anchor;
          best = ahead;
        }
      }
    }
    if (actor.mixer) {
      playScout(actor, player, !!actor.anchor && oldAnchor !== actor.anchor, dt);
    } else {
      const cycle = time * (8 + (player.speed || 20) * 0.16);
      if (player.grapple) {
        actor.arms[0].rotation.x = -1.7 + Math.sin(cycle) * 0.15;
        actor.arms[1].rotation.x = -1.7 - Math.sin(cycle) * 0.15;
        actor.legs[0].rotation.x = 0.55 + Math.sin(cycle * 0.5) * 0.3;
        actor.legs[1].rotation.x = -0.35 - Math.sin(cycle * 0.5) * 0.3;
        actor.visual.rotation.x = -0.18;
      } else {
        actor.arms[0].rotation.x = Math.sin(cycle) * 0.65;
        actor.arms[1].rotation.x = -Math.sin(cycle) * 0.65;
        actor.legs[0].rotation.x = Math.sin(cycle) * 0.75;
        actor.legs[1].rotation.x = -Math.sin(cycle) * 0.75;
        actor.visual.rotation.x = -0.05;
      }
      actor.cape.rotation.x = -0.25 - Math.min(0.65, (player.speed || 20) * 0.015) + Math.sin(time * 11) * 0.07;
    }
    actor.cable.visible = Boolean(actor.anchor);
    if (actor.anchor) {
      const end = actor.anchor;
      const x = end.x - actor.root.position.x;
      const y = end.y - actor.root.position.y;
      const z = end.z - actor.root.position.z;
      const grip = side * .38;
      const positions = actor.cable.geometry.attributes.position;
      positions.setXYZ(0, grip, 1.32, 0);
      positions.setXYZ(1, (x + grip) / 2, (y + 1.32) / 2 - .13, z / 2);
      positions.setXYZ(2, x, y, z);
      positions.needsUpdate = true;
    }
  }

  syncChunks(seed, distance, player) {
    if (this.chunkSeed !== seed) {
      for (const chunk of this.chunks.values()) {
        this.scene.remove(chunk);
        this.chunkPool.push(chunk);
      }
      this.chunks.clear();
      this.localActor.anchor = null;
      for (const actor of this.actors.values()) actor.anchor = null;
      this.chunkSeed = seed;
    }
    const current = Math.floor(distance / SEGMENT_LENGTH);
    const needed = new Set();
    for (let index = Math.max(0, current - 2); index <= current + 9; index += 1) {
      needed.add(index);
      if (!this.chunks.has(index)) this.chunks.set(index, this.buildChunk(index, seed));
      const chunk = this.chunks.get(index);
      for (const item of chunk.userData.pickups) {
        item.group.visible = !player.collected?.includes(item.id);
        item.group.rotation.y = this.clock * 1.8 + item.id;
        item.group.position.y = item.baseY + Math.sin(this.clock * 3 + item.id) * 0.15;
      }
    }
    for (const [index, chunk] of this.chunks) {
      if (!needed.has(index)) {
        this.scene.remove(chunk);
        this.chunks.delete(index);
        this.chunkPool.push(chunk);
      }
    }
    this.road.position.z = -Math.floor(distance / 300) * 300 - 270;
    this.landmark.position.z = -(Math.floor(distance / 450) * 450 + 450);
    this.clouds.position.z = -Math.floor(distance / 200) * 200;
  }

  update(player, remotePlayers = [], seed = 1, dt = 0.016, mode = 'playing') {
    this.clock += dt;
    if (mode === 'menu') {
      this.demoDistance += dt * 4;
      player = { x: 4.4 + Math.sin(this.clock * 0.35) * 0.7, y: 2.1 + Math.sin(this.clock * 1.6) * 0.35, distance: this.demoDistance, speed: 18, grapple: true, grappleSide: 1, invincible: 0, character: 'mikasa' };
      this.titan.root.visible = true;
      this.titan.root.position.set(-4, 0, -this.demoDistance - 62);
      this.titan.root.scale.setScalar(1.2);
    }
    if (this.localActor.characterId !== player.character) {
      this.scene.remove(this.localActor.root);
      this.localActor = this.makeScout(player.character, player.name || 'You', false);
      this.scene.add(this.localActor.root);
    }
    this.syncChunks(seed, player.distance, player);
    this.animateScout(this.localActor, player, this.clock, dt);
    const seen = new Set();
    for (const remote of remotePlayers) {
      if (remote.id === player.id || !remote.alive) continue;
      seen.add(remote.id);
      if (!this.actors.has(remote.id)) {
        const actor = this.makeScout(remote.character, remote.name);
        this.actors.set(remote.id, actor);
        this.scene.add(actor.root);
      }
      const actor = this.actors.get(remote.id);
      if (actor.characterId !== remote.character) {
        this.scene.remove(actor.root);
        const replacement = this.makeScout(remote.character, remote.name);
        this.actors.set(remote.id, replacement);
        this.scene.add(replacement.root);
      }
      this.animateScout(this.actors.get(remote.id), remote, this.clock + 0.2, dt);
    }
    for (const [id, actor] of this.actors) {
      if (!seen.has(id)) {
        this.scene.remove(actor.root);
        this.actors.delete(id);
      }
    }

    if (mode !== 'menu') {
      const threat = player.threat ?? 75;
      this.titan.root.visible = threat < 57 || this.lookBack;
      this.titan.root.scale.setScalar(1.04);
      this.titan.root.position.x += ((player.x * 0.45 - 3.2) - this.titan.root.position.x) * Math.min(1, dt * 1.3);
      this.titan.root.position.z = -player.distance + 3 + threat * 0.13;
      this.titan.head.rotation.y = this.lookBack ? 0 : threat < 32 ? Math.PI * 0.85 : 0;
    }
    const titanCycle = this.clock * 5;
    this.titan.limbs[0].rotation.x = Math.sin(titanCycle) * 0.55 - 0.35;
    this.titan.limbs[1].rotation.x = -Math.sin(titanCycle) * 0.55;
    this.titan.limbs[2].rotation.x = -Math.sin(titanCycle) * 0.55 - 0.35;
    this.titan.limbs[3].rotation.x = Math.sin(titanCycle) * 0.55;
    this.titan.visual.position.y = Math.abs(Math.sin(titanCycle)) * 0.15;
    this.gasParticles.visible = Boolean(player.grapple || player.boostTime > 0);
    for (let index = 0; index < this.gasCount; index += 1) {
      const life = (this.clock * (player.boostTime > 0 ? 2.3 : 1.4) + index / this.gasCount) % 1;
      const side = index % 2 ? -1 : 1;
      this.gasData[index * 3] = player.x + side * 0.45 + (hash(4, index) - 0.5) * life * 1.2;
      this.gasData[index * 3 + 1] = player.y - 0.1 + (hash(5, index) - 0.5) * life;
      this.gasData[index * 3 + 2] = -player.distance + life * 6;
    }
    this.gasParticles.geometry.attributes.position.needsUpdate = true;
    this.speedLines.visible = player.boostTime > 0;
    this.speedLines.position.z = -player.distance;
    this.speedLines.material.opacity = 0.13 + Math.sin(this.clock * 20) * 0.06;
    for (const bird of this.birds) {
      bird.position.x += dt * 1.5;
      bird.position.y += Math.sin(this.clock * 3 + bird.position.z) * dt * 0.2;
      if (bird.position.x > 30) bird.position.x = -30;
      bird.position.z = -player.distance - 35 + ((bird.position.z + player.distance + 35) % 90);
    }
    this.sun.position.z = -player.distance + 25;
    this.sun.target.position.set(0, 0, -player.distance - 15);
    if (mode === 'menu') {
      this.camera.position.set(-5.8, 7.6, -player.distance + 17.5);
      this.camera.lookAt(-1.5, 3.8, -player.distance - 18);
    } else {
      const boost = player.boostTime > 0 ? 1.7 : 0;
      const desired = new THREE.Vector3(player.x * 0.35, 6.3 + player.y * 0.28, -player.distance + 13.5 + boost);
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 5.5));
      this.camera.lookAt(player.x * 0.4, 2.4 + player.y * 0.35, -player.distance - 15);
      if (this.lookBack) {
        this.camera.position.lerp(new THREE.Vector3(player.x * 0.4, 6.5, -player.distance - 18), 1 - Math.exp(-dt * 7));
        this.camera.lookAt(player.x * 0.6, 4.8, -player.distance + 12);
      }
      this.camera.fov += ((player.boostTime > 0 ? 66 : 58) - this.camera.fov) * Math.min(1, dt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  }
}
