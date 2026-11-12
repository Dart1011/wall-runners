import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  MAX_PLAYERS, TICK_RATE, cleanName, characterFor, createRunner,
  freshInput, publicRunner, roomCode, stepRunner, findAttackTarget, applyStrike,
} from './shared/game.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: false } });
const rooms = new Map();
const port = Number(process.env.PORT) || 3000;

if (process.env.NODE_ENV === 'production') {
  app.use(express.static('dist'));
  app.get('/{*path}', (req, res) => res.sendFile('dist/index.html', { root: process.cwd() }));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: [...room.players.values()].map(publicRunner),
  };
}

function emitLobby(room) {
  io.to(room.code).emit('room', publicRoom(room));
}

function getRoom(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return null;
  const player = room.players.get(socket.id);
  return player ? { room, player } : null;
}

function startRun(room) {
  room.phase = 'running';
  room.seed = Math.floor(Math.random() * 2147483647);
  room.startAt = Date.now() + 3600;
  room.lastTick = Date.now();
  let slot = 0;
  for (const player of room.players.values()) {
    const next = createRunner(player.id, player.name, player.character, slot);
    room.players.set(player.id, next);
    room.inputs.set(player.id, freshInput());
    slot += 1;
  }
  io.to(room.code).emit('run:start', {
    seed: room.seed,
    startAt: room.startAt,
    players: [...room.players.values()].map(publicRunner),
  });
  emitLobby(room);
}

io.on('connection', (socket) => {
  socket.on('room:join', (options = {}, reply = () => {}) => {
    const requested = String(options.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (socket.data.room) return reply({ error: 'Already in a room.' });
    let code = requested;
    if (!code) {
      do { code = roomCode(); } while (rooms.has(code));
    }
    const room = rooms.get(code) || {
      code, hostId: socket.id, phase: 'lobby', players: new Map(), inputs: new Map(), seed: 1, startAt: 0, lastTick: Date.now(),
    };
    if (room.players.size >= MAX_PLAYERS) return reply({ error: 'This squad is full. Try another room.' });
    if (requested && !rooms.has(code)) return reply({ error: 'Room not found. Check the code and try again.' });
    const player = createRunner(socket.id, cleanName(options.name), characterFor(options.character).id, room.players.size);
    player.spectating = room.phase === 'running';
    room.players.set(socket.id, player);
    room.inputs.set(socket.id, freshInput());
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    reply({ ok: true, code, id: socket.id, seed: room.seed, startAt: room.startAt, spectating: player.spectating });
    emitLobby(room);
  });

  socket.on('room:character', (character) => {
    const context = getRoom(socket);
    if (!context || context.room.phase !== 'lobby') return;
    context.player.character = characterFor(character).id;
    emitLobby(context.room);
  });

  socket.on('room:start', (_, reply = () => {}) => {
    const context = getRoom(socket);
    if (!context) return;
    if (context.room.hostId !== socket.id) return reply({ error: 'Only the squad leader can start the run.' });
    if (context.room.phase === 'running') return reply({ error: 'The squad is still in the field.' });
    startRun(context.room);
    reply({ ok: true });
  });

  socket.on('player:input', (input = {}) => {
    const context = getRoom(socket);
    if (!context) return;
    context.room.inputs.set(socket.id, {
      left: input.left === true,
      right: input.right === true,
      grapple: input.grapple === true,
      boost: input.boost === true,
    });
  });

  socket.on('player:attack', (_, reply = () => {}) => {
    const context = getRoom(socket);
    if (!context) return reply({ ok: false, message: 'Not in a squad.' });
    const { room, player: attacker } = context;
    if (room.phase !== 'running' || Date.now() < room.startAt || !attacker.alive || attacker.spectating) return reply({ ok: false, message: 'You cannot attack right now.' });
    if (attacker.attackCooldown > 0) return reply({ ok: false, message: 'Blade recharging.' });
    if (attacker.blades < 1) return reply({ ok: false, message: 'Collect a blade power-up first.' });
    const target = findAttackTarget(attacker, [...room.players.values()], room.seed);
    if (!target) return reply({ ok: false, message: 'No opponent in line of sight.' });
    applyStrike(attacker, target);
    const events = [{ type: 'hit', source: 'scout', attacker: attacker.name, lives: target.lives }];
    if (!target.alive) events.push({ type: 'eliminated' });
    io.to(room.code).emit('player:events', { id: target.id, events });
    io.to(room.code).emit('combat:event', {
      attackerId: attacker.id,
      targetId: target.id,
      attackerName: attacker.name,
      targetName: target.name,
      attacker: publicRunner(attacker),
      target: publicRunner(target),
    });
    reply({ ok: true, blades: attacker.blades, cooldown: attacker.attackCooldown });
  });

  socket.on('voice:join', (_, reply = () => {}) => {
    const context = getRoom(socket);
    if (!context) return reply({ error: 'Join a squad before enabling voice.' });
    const peers = [...context.room.players.keys()].filter((id) => id !== socket.id && io.sockets.sockets.get(id)?.data.voice);
    socket.data.voice = true;
    reply({ ok: true, peers });
    socket.to(context.room.code).emit('voice:peer-join', { id: socket.id });
  });

  socket.on('voice:signal', ({ to, description, candidate } = {}) => {
    const context = getRoom(socket);
    if (!context || !socket.data.voice || typeof to !== 'string') return;
    const target = io.sockets.sockets.get(to);
    if (!context.room.players.has(to) || !target?.data.voice) return;
    target.emit('voice:signal', { from: socket.id, description, candidate });
  });

  socket.on('voice:leave', () => {
    const context = getRoom(socket);
    if (context) leaveVoice(socket, context.room);
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

function leaveVoice(socket, room) {
  if (!socket.data.voice) return;
  socket.data.voice = false;
  socket.to(room.code).emit('voice:peer-leave', { id: socket.id });
}

function leaveRoom(socket) {
  const context = getRoom(socket);
  if (!context) return;
  const { room } = context;
  leaveVoice(socket, room);
  room.players.delete(socket.id);
  room.inputs.delete(socket.id);
  socket.leave(room.code);
  socket.data.room = null;
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  if (room.phase === 'running' && ![...room.players.values()].some((player) => player.alive && !player.spectating)) {
    room.phase = 'results';
  }
  emitLobby(room);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase !== 'running') continue;
    if (now < room.startAt) continue;
    const dt = Math.min(0.1, Math.max(0.001, (now - room.lastTick) / 1000));
    room.lastTick = now;
    for (const player of room.players.values()) {
      if (player.spectating) continue;
      const input = room.inputs.get(player.id) || freshInput();
      const events = stepRunner(player, input, dt, room.seed);
      room.inputs.set(player.id, { ...input, boost: false });
      if (events.length) io.to(room.code).emit('player:events', { id: player.id, events });
    }
    if (![...room.players.values()].some((player) => player.alive && !player.spectating)) room.phase = 'results';
  }
}, 1000 / TICK_RATE);

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase === 'running') {
      io.to(room.code).emit('run:state', { now: Date.now(), players: [...room.players.values()].map(publicRunner) });
    } else {
      emitLobby(room);
    }
  }
}, 100);

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Wall Runners is ready at http://localhost:${port}`);
});
