export const SEGMENT_LENGTH = 44;
export const MAX_PLAYERS = 8;
export const TICK_RATE = 30;

export const CHARACTERS = [
  { id: 'eren', name: 'Eren', role: 'The Fighter', trait: 'Breakneck speed', detail: '+5% running speed', color: '#826044', accent: '#72886a', hair: '#352b24', skin: '#e3b08b', speed: 1.05, handling: 1, gasUse: 1 },
  { id: 'mikasa', name: 'Mikasa', role: 'The Natural', trait: 'Aerial control', detail: '+18% steering response', color: '#444747', accent: '#a95146', hair: '#24282b', skin: '#e6b595', speed: 1, handling: 1.18, gasUse: 1 },
  { id: 'armin', name: 'Armin', role: 'The Strategist', trait: 'Efficient gear', detail: '−22% ODM gas usage', color: '#c6a265', accent: '#708d97', hair: '#d3b779', skin: '#edc19d', speed: 1, handling: 1, gasUse: 0.78 },
  { id: 'levi', name: 'Levi', role: 'The Captain', trait: 'Elite endurance', detail: 'Slower titan approach', color: '#434e43', accent: '#d4d4c2', hair: '#292b29', skin: '#dfb396', speed: 1.02, handling: 1.08, gasUse: 0.94 },
];

export const freshInput = () => ({ left: false, right: false, grapple: false, boost: false });

export function characterFor(id) {
  return CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
}

export function cleanName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 14) || 'Scout';
}

export function hash(seed, index, salt = 0) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export function createRunner(id, name, character = 'eren', slot = 0) {
  return {
    id,
    name: cleanName(name),
    character: characterFor(character).id,
    x: ((slot % 4) - 1.5) * 2.2,
    y: 1.1,
    distance: 0,
    vx: 0,
    speed: 0,
    gas: 100,
    lives: 3,
    score: 0,
    bonus: 0,
    supplies: 0,
    combo: 1,
    level: 1,
    threat: 76,
    boostTime: 0,
    grapple: false,
    grappleSide: slot % 2 ? 1 : -1,
    invincible: 0,
    hitCooldown: 0,
    alive: true,
    finished: false,
    collected: [],
    lastObstacle: -1,
    elapsed: 0,
  };
}

export function getSegment(seed, index) {
  const obstacles = [];
  const pickups = [];
  const lanes = [-6.5, 0, 6.5];
  for (let row = 0; row < 2; row += 1) {
    const distance = index * SEGMENT_LENGTH + 13 + row * 21;
    const safeLane = Math.floor(hash(seed, index, row + 10) * 3);
    const doubleObstacleChance = Math.min(0.9, 0.45 + Math.floor(index * SEGMENT_LENGTH / 500) * 0.07);
    const obstacleCount = index < 1 ? (row === 0 ? 1 : 0) : hash(seed, index, row + 20) < doubleObstacleChance ? 2 : 1;
    const blockedLanes = [0, 1, 2].filter((lane) => lane !== safeLane).slice(0, obstacleCount);
    for (let lane = 0; lane < 3; lane += 1) {
      if (!blockedLanes.includes(lane)) continue;
      const random = hash(seed, index, row * 7 + lane + 30);
      const type = random > 0.72 ? 'gate' : random > 0.4 ? 'cart' : 'crates';
      obstacles.push({
        id: index * 10 + row * 3 + lane,
        x: lanes[lane],
        distance,
        type,
        width: type === 'gate' ? 4.6 : type === 'cart' ? 3.6 : 2.9,
        height: type === 'gate' ? 2.7 : type === 'cart' ? 1.75 : 2.1,
      });
    }
    const pickupLane = lanes[safeLane];
    const roll = hash(seed, index, row + 50);
    const type = index > 4 && index % 19 === 0 && row === 0 ? 'heart' : roll > 0.78 ? 'boost' : roll > 0.35 ? 'gas' : 'supply';
    pickups.push({
      id: index * 2 + row,
      x: pickupLane,
      distance: index * SEGMENT_LENGTH + 7 + row * 21,
      y: row === 1 && index % 3 === 0 ? 4.8 : 1.65,
      type,
    });
  }
  return { obstacles, pickups };
}

export function stepRunner(runner, input, dt, seed) {
  if (!runner.alive) return [];
  const events = [];
  const character = characterFor(runner.character);
  runner.elapsed += dt;
  runner.invincible = Math.max(0, runner.invincible - dt);
  runner.hitCooldown = Math.max(0, runner.hitCooldown - dt);
  runner.boostTime = Math.max(0, runner.boostTime - dt);

  if (input.boost && runner.gas >= 25 && runner.boostTime <= 0.05) {
    runner.gas -= 25;
    runner.boostTime = 1.65;
    runner.threat = Math.min(100, runner.threat + 15);
    events.push({ type: 'boost' });
  }

  runner.grapple = Boolean(input.grapple && runner.gas > 0.5);
  const direction = Number(Boolean(input.right)) - Number(Boolean(input.left));
  if (runner.grapple) {
    if (direction) runner.grappleSide = direction;
    runner.gas = Math.max(0, runner.gas - 12 * character.gasUse * dt);
    runner.threat = Math.min(100, runner.threat + 5.2 * dt);
    const targetHeight = 4.8 + Math.sin(runner.elapsed * 5) * 0.55;
    runner.y += (targetHeight - runner.y) * Math.min(1, dt * 5.5);
    runner.vx += runner.grappleSide * 3.5 * dt;
  } else {
    runner.gas = Math.min(100, runner.gas + 13 * dt);
    runner.y -= 10 * dt;
    if (runner.y <= 1.1) runner.y = 1.1;
  }

  const steering = 46 * character.handling * (runner.grapple ? 1.15 : 1);
  runner.vx += direction * steering * dt;
  runner.vx *= Math.exp(-5.2 * dt);
  runner.x += runner.vx * dt;
  if (Math.abs(runner.x) > 9.6) {
    runner.x = Math.sign(runner.x) * 9.6;
    runner.vx *= -0.25;
  }

  const baseSpeed = 19 + runner.distance / 400;
  runner.speed = baseSpeed * character.speed + (runner.grapple ? 4.5 : 0) + (runner.boostTime > 0 ? 14 : 0);
  const previousDistance = runner.distance;
  runner.distance += runner.speed * dt;
  const previousLevel = runner.level;
  runner.level = 1 + Math.floor(runner.distance / 500);
  if (runner.level > previousLevel) events.push({ type: 'pace', level: runner.level });
  runner.score = Math.floor(runner.distance + runner.supplies * 75 + runner.bonus);
  const pressure = 0.78 + (runner.level - 1) * 0.12;
  runner.threat = Math.max(0, runner.threat - pressure * (runner.character === 'levi' ? 0.82 : 1) * dt);

  const hurt = (source) => {
    if (runner.invincible > 0) return;
    runner.lives -= 1;
    runner.invincible = 2.5;
    runner.hitCooldown = 1.1;
    runner.threat = source === 'titan' ? 60 : Math.max(26, runner.threat - 22);
    runner.combo = 1;
    runner.boostTime = 0;
    runner.gas = Math.max(runner.gas, 28);
    events.push({ type: 'hit', source, lives: runner.lives });
    if (runner.lives <= 0) {
      runner.alive = false;
      runner.finished = true;
      events.push({ type: 'eliminated' });
    }
  };

  if (runner.threat <= 0) hurt('titan');

  if (runner.hitCooldown <= 0 && runner.alive) {
    const firstSegment = Math.max(0, Math.floor(previousDistance / SEGMENT_LENGTH) - 1);
    const lastSegment = Math.floor(runner.distance / SEGMENT_LENGTH) + 1;
    for (let index = firstSegment; index <= lastSegment; index += 1) {
      for (const obstacle of getSegment(seed, index).obstacles) {
        if (obstacle.id === runner.lastObstacle) continue;
        const crossed = previousDistance <= obstacle.distance + 1.15 && runner.distance >= obstacle.distance - 1.15;
        if (crossed && Math.abs(runner.x - obstacle.x) < obstacle.width / 2 + 0.48 && runner.y < obstacle.height + 0.8) {
          runner.lastObstacle = obstacle.id;
          hurt('obstacle');
          break;
        }
      }
    }
  }

  const currentSegment = Math.floor(runner.distance / SEGMENT_LENGTH);
  for (let index = Math.max(0, currentSegment - 1); index <= currentSegment + 1; index += 1) {
    for (const pickup of getSegment(seed, index).pickups) {
      if (runner.collected.includes(pickup.id)) continue;
      if (Math.abs(runner.distance - pickup.distance) < 1.8 && Math.abs(runner.x - pickup.x) < 1.5 && Math.abs(runner.y - pickup.y) < 2.1) {
        runner.collected.push(pickup.id);
        if (runner.collected.length > 50) runner.collected.shift();
        if (pickup.type === 'gas') runner.gas = Math.min(100, runner.gas + 42);
        if (pickup.type === 'boost') runner.boostTime = Math.max(runner.boostTime, 2.2);
        if (pickup.type === 'heart') runner.lives = Math.min(3, runner.lives + 1);
        runner.supplies += 1;
        runner.combo = Math.min(5, runner.combo + 0.25);
        runner.bonus += Math.floor(75 * (runner.combo - 1));
        events.push({ type: 'pickup', pickup: pickup.type, lives: runner.lives });
      }
    }
  }
  return events;
}

export function publicRunner(runner) {
  return {
    id: runner.id,
    name: runner.name,
    character: runner.character,
    x: runner.x,
    y: runner.y,
    vx: runner.vx,
    distance: runner.distance,
    speed: runner.speed,
    gas: runner.gas,
    lives: runner.lives,
    score: runner.score,
    supplies: runner.supplies,
    level: runner.level,
    threat: runner.threat,
    grapple: runner.grapple,
    grappleSide: runner.grappleSide,
    boostTime: runner.boostTime,
    alive: runner.alive,
    invincible: runner.invincible,
    spectating: Boolean(runner.spectating),
  };
}

export function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 5; index += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
