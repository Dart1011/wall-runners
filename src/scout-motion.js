import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const assets = new Map();
const loader = new GLTFLoader();

export function loadModel(name) {
  if (!assets.has(name)) {
    assets.set(name, loader.loadAsync(`/models/${name}.glb`).catch(error => {
      assets.delete(name);
      throw error;
    }));
  }
  return assets.get(name);
}

export function attachScout(actor, asset) {
  const model = asset.scene.clone(true);
  model.rotation.y = Math.PI;
  model.scale.setScalar(1.28);
  model.traverse(part => { if (part.isMesh) part.castShadow = true; });
  actor.visual.clear();
  actor.visual.add(model);
  actor.hips = model.getObjectByName('Hips');
  actor.cableOrigin = new Vector3();
  actor.mixer = new AnimationMixer(model);
  actor.actions = Object.fromEntries(asset.animations.map(clip => {
    const action = actor.mixer.clipAction(clip);
    if (/^(Catch|Release)/.test(clip.name)) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    return [clip.name, action];
  }));
}

export function playScout(actor, player, caught, dt) {
  // Models face +Z. Turning them toward the course mirrors their local X axis.
  const side = player.grappleSide > 0 ? 'Left' : 'Right';
  const previous = actor.motion || '';
  let next = 'Run';
  const active = actor.actions[previous];
  if (player.grapple) {
    const catching = previous === 'Catch' + side && active.isRunning();
    next = (caught || catching ? 'Catch' : 'Swing') + side;
  } else if (/^(Swing|Catch)/.test(previous)) {
    next = previous.replace(/^(Swing|Catch)/, 'Release');
  } else if (previous.startsWith('Release') && active.isRunning()) {
    next = previous;
  } else if (player.y > 1.22) {
    next = 'Jump';
  }
  if (next !== previous || caught) {
    const action = actor.actions[next];
    action.reset().fadeIn(.08).play();
    if (active && active !== action) active.fadeOut(.08);
    actor.motion = next;
  }
  actor.mixer.update(dt);
}
