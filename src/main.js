import './style.css';
import { io } from 'socket.io-client';
import { CityWorld } from './world.js';
import { AudioEngine } from './audio.js';
import { portrait } from './portraits.js';
import { CHARACTERS, characterFor, cleanName, createRunner, freshInput, stepRunner } from '../shared/game.js';

const $ = (selector) => document.querySelector(selector);
const socket = io();
const audio = new AudioEngine();
const world = new CityWorld($('#world'));
const keys = new Set();
const touchInput = freshInput();
const state = {
  screen: 'menu', selected: localStorage.getItem('wall-runners-character') || 'eren',
  room: null, playerId: null, local: null, seed: 1, startAt: 0,
  remotes: new Map(), spectating: false, watching: false, resultSaved: false,
  mouseGrapple: false, boostQueued: false, localBoostPending: false, toastTimer: null, lastCountdown: null,
};
if (!CHARACTERS.some((character) => character.id === state.selected)) state.selected = 'eren';
$('#name-input').value = localStorage.getItem('wall-runners-name') || '';
$('#personal-best').textContent = `${Number(localStorage.getItem('wall-runners-best') || 0).toLocaleString()} M`;

function show(element, visible) { element.hidden = !visible; }
function setScreen(screen) {
  state.screen = screen;
  show($('#menu-screen'), screen === 'menu');
  show($('#lobby-screen'), screen === 'lobby');
  show($('#hud'), screen === 'playing');
  show($('#results-screen'), false);
  show($('#pause-screen'), false);
  document.body.classList.toggle('playing', screen === 'playing' || screen === 'results');
  if (screen !== 'playing') show($('#countdown'), false);
}

function toast(message) {
  const element = $('#event-toast');
  clearTimeout(state.toastTimer);
  element.textContent = message;
  element.hidden = false;
  element.style.animation = 'none';
  void element.offsetWidth;
  element.style.animation = '';
  state.toastTimer = setTimeout(() => { element.hidden = true; }, 1750);
}

function updateSoundIcon() {
  $('#sound-button use').setAttribute('href', audio.muted ? '#icon-muted' : '#icon-volume');
  $('#sound-button').setAttribute('aria-label', audio.muted ? 'Turn sound on' : 'Mute sound');
}

function selectCharacter(id, silent = false) {
  state.selected = characterFor(id).id;
  const character = characterFor(id);
  localStorage.setItem('wall-runners-character', id);
  document.querySelectorAll('[data-character]').forEach((button) => {
    const selected = button.dataset.character === id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#character-trait').textContent = character.trait.toUpperCase();
  $('#character-name').textContent = `${character.name} ${character.id === 'eren' ? 'YEAGER' : character.id === 'mikasa' ? 'ACKERMAN' : character.id === 'armin' ? 'ARLERT' : 'ACKERMAN'}`.toUpperCase();
  $('#character-detail').textContent = character.detail;
  if (state.screen === 'lobby') socket.emit('room:character', id);
  if (!silent) audio.event('click');
}

function buildCharacterSelectors() {
  $('#character-cards').innerHTML = CHARACTERS.map((character, index) => `<button class="character-card" data-character="${character.id}" aria-label="Choose ${character.name}: ${character.detail}" aria-pressed="false">${portrait(character.id)}<span class="card-number">0${index + 1}</span><span class="selected-mark">✓</span><span class="card-name">${character.name}</span></button>`).join('');
  $('#lobby-characters').innerHTML = CHARACTERS.map((character) => `<button class="lobby-character" data-character="${character.id}" aria-label="Choose ${character.name}" aria-pressed="false">${portrait(character.id)}<span>${character.name}</span></button>`).join('');
  document.querySelectorAll('[data-character]').forEach((button) => button.addEventListener('click', () => selectCharacter(button.dataset.character)));
  selectCharacter(state.selected, true);
}

function inviteLink() {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', state.room?.code || '');
  return url.toString();
}

async function copyText(text, confirmation) {
  try {
    await navigator.clipboard.writeText(text);
    toast(confirmation);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    toast(copied ? confirmation : `Room code: ${state.room?.code}`);
  }
}

function renderLobby() {
  if (!state.room || state.screen !== 'lobby') return;
  const { code, players, hostId } = state.room;
  $('#copy-code').textContent = code;
  $('#lobby-count').textContent = `${players.length} / 8`;
  $('#lobby-players').innerHTML = players.map((player) => `<div class="lobby-player">${portrait(player.character)}<div class="lobby-player-name">${escapeHtml(player.name)}<small>${player.id === hostId ? 'SQUAD LEADER' : characterFor(player.character).name.toUpperCase()}</small></div></div>`).join('');
  const host = hostId === state.playerId;
  show($('#start-run'), host);
  show($('#host-waiting'), !host);
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value);
  return element.innerHTML;
}

async function joinRoom(code = '') {
  if (!socket.connected) {
    $('#menu-error').textContent = 'The game server is reconnecting. Please try again in a moment.';
    show($('#menu-error'), true);
    return;
  }
  audio.unlock();
  show($('#menu-error'), false);
  $('#create-room').disabled = true;
  $('#join-room').disabled = true;
  const name = cleanName($('#name-input').value);
  localStorage.setItem('wall-runners-name', name);
  try {
    const response = await new Promise((resolve, reject) => {
      socket.timeout(7000).emit('room:join', { code, name, character: state.selected }, (error, result) => error ? reject(error) : resolve(result));
    });
    if (response.error) throw new Error(response.error);
    state.playerId = response.id;
    state.seed = response.seed;
    state.startAt = response.startAt;
    state.remotes.clear();
    window.history.replaceState({}, '', `?room=${response.code}`);
    if (response.spectating) {
      state.spectating = true;
      state.local = createRunner(response.id, name, state.selected);
      enterPlaying();
      toast('SPECTATING — YOU JOIN THE NEXT RUN');
    } else {
      setScreen('lobby');
      renderLobby();
    }
  } catch (error) {
    $('#menu-error').textContent = error.message || 'Could not connect. Please try again.';
    show($('#menu-error'), true);
  } finally {
    $('#create-room').disabled = false;
    $('#join-room').disabled = false;
  }
}

function enterPlaying() {
  setScreen('playing');
  state.watching = false;
  state.resultSaved = false;
  state.lastCountdown = null;
  $('#hud-room').textContent = state.room?.code || '-----';
  show($('#spectator-notice'), state.spectating);
  $('#hud-portrait').innerHTML = portrait(state.local.character);
  $('#hud-name').textContent = state.local.name.toUpperCase();
  audio.event('start');
}

function startRun({ seed, startAt, players }) {
  const own = players.find((player) => player.id === state.playerId);
  if (!own) return;
  state.seed = seed;
  state.startAt = startAt;
  state.spectating = false;
  state.local = Object.assign(createRunner(own.id, own.name, own.character), own, { collected: [] });
  state.remotes.clear();
  state.boostQueued = false;
  state.localBoostPending = false;
  keys.clear();
  enterPlaying();
  show($('#countdown'), true);
  $('#countdown-label').textContent = 'GEAR UP';
  $('#countdown-number').textContent = '3';
}

function processEvent(event) {
  if (event.type === 'pickup') {
    const messages = { gas: '+ ODM GAS', boost: 'BOOST ACQUIRED', heart: '+ ONE LIFE', supply: '+75 SUPPLIES' };
    toast(messages[event.pickup]);
    audio.event(event.pickup);
  } else if (event.type === 'pace') {
    toast(`PACE ${event.level} — SPEED INCREASED`);
    audio.event('pace');
  } else if (event.type === 'boost') {
    audio.event('boost');
  } else if (event.type === 'hit') {
    $('#damage-flash').classList.remove('flash');
    void $('#damage-flash').offsetWidth;
    $('#damage-flash').classList.add('flash');
    audio.event('hit');
    toast(event.source === 'titan' ? 'TITAN STRIKE — MOVE!' : `${event.lives} ${event.lives === 1 ? 'LIFE' : 'LIVES'} REMAINING`);
    if (navigator.vibrate) navigator.vibrate(80);
  } else if (event.type === 'eliminated') {
    audio.event('eliminated');
  }
}

function showResults() {
  if (state.screen === 'results') return;
  state.screen = 'results';
  state.watching = false;
  show($('#results-screen'), true);
  show($('#pause-screen'), false);
  show($('#hud'), false);
  show($('#countdown'), false);
  const players = (state.room?.players || [state.local]).filter((player) => !player.spectating);
  const sorted = [...players].sort((a, b) => b.distance - a.distance);
  const rank = sorted.findIndex((player) => player.id === state.playerId) + 1;
  const distance = Math.floor(state.local.distance);
  const previousBest = Number(localStorage.getItem('wall-runners-best') || 0);
  if (!state.resultSaved) {
    if (distance > previousBest) localStorage.setItem('wall-runners-best', String(distance));
    state.resultSaved = true;
  }
  $('#personal-best').textContent = `${Math.max(previousBest, distance).toLocaleString()} M`;
  show($('#new-best'), distance > previousBest);
  $('#result-distance').innerHTML = `${distance.toLocaleString()}<small>M</small>`;
  $('#result-supplies').textContent = state.local.supplies;
  $('#result-rank').textContent = `#${rank || 1}`;
  $('#results-title').innerHTML = distance >= 1000 ? 'For humanity.<br />For the squad.' : 'Humanity<br />remembers.';
  $('#results-subtitle').textContent = `${state.local.name} survived ${distance.toLocaleString()} meters beyond the wall.`;
  $('#results-list').innerHTML = sorted.slice(0, 5).map((player, index) => `<div class="result-row"><b>${index + 1}</b><span>${escapeHtml(player.name)}${player.id === state.playerId ? ' (YOU)' : ''}</span><strong>${Math.floor(player.distance).toLocaleString()} M</strong></div>`).join('');
  const roomFinished = state.room?.phase === 'results';
  const host = state.room?.hostId === state.playerId;
  show($('#restart-run'), roomFinished && host);
  show($('#results-waiting'), !(roomFinished && host));
  $('#results-waiting').textContent = roomFinished ? 'Waiting for the squad leader to redeploy…' : 'Your squad is still flying. The next run begins when every scout is out.';
  $('#results-eyebrow').textContent = roomFinished ? 'RUN COMPLETE' : 'SCOUT DOWN';
}

function leaveRoom() {
  socket.emit('room:leave');
  state.room = null;
  state.playerId = null;
  state.local = null;
  state.spectating = false;
  state.remotes.clear();
  keys.clear();
  state.mouseGrapple = false;
  setScreen('menu');
  window.history.replaceState({}, '', window.location.pathname);
}

function currentInput() {
  return {
    left: keys.has('KeyA') || keys.has('ArrowLeft') || touchInput.left,
    right: keys.has('KeyD') || keys.has('ArrowRight') || touchInput.right,
    grapple: keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp') || state.mouseGrapple || touchInput.grapple,
    boost: touchInput.boost,
  };
}

function updateHud(player, players) {
  $('#distance').textContent = Math.floor(player.distance).toLocaleString();
  $('#run-score').textContent = `${String(Math.floor(player.score)).padStart(6, '0')} PTS`;
  $('#run-pace').textContent = `PACE ${String(player.level || 1).padStart(2, '0')} · ${Math.round(player.speed)} M/S`;
  $('#gas-fill').style.width = `${player.gas}%`;
  $('#gas-fill').classList.toggle('low', player.gas < 25);
  $('#gas-value').textContent = `${Math.round(player.gas)}%`;
  $('#lives').innerHTML = [0, 1, 2].map((index) => `<svg class="${index >= player.lives ? 'lost' : ''}" aria-label="${index < player.lives ? 'Life remaining' : 'Life lost'}"><use href="#icon-heart" /></svg>`).join('');
  $('#hud-players').textContent = players.filter((item) => item.alive && !item.spectating).length;
  $('#threat-fill').style.width = `${player.threat}%`;
  $('#titan-distance').textContent = `${Math.round(3 + player.threat * 0.22)} M`;
  $('#titan-warning').classList.toggle('danger', player.threat < 30);
  const grappleStatus = $('#grapple-status');
  grappleStatus.classList.toggle('active', player.grapple);
  grappleStatus.innerHTML = `<span></span> ${player.grapple ? 'ODM CONNECTED' : player.gas < 15 ? 'LOW GAS — RUN TO REFILL' : 'ODM READY'}`;
  const sorted = players.filter((item) => !item.spectating).sort((a, b) => b.distance - a.distance);
  $('#leaderboard-list').innerHTML = sorted.map((item, index) => `<div class="leader-row ${item.id === state.playerId ? 'local' : ''} ${item.alive ? '' : 'out'}"><span class="rank">${index + 1}</span><span class="leader-dot"></span><span class="leader-name">${escapeHtml(item.name)}${item.id === state.playerId ? ' · YOU' : ''}</span><span class="leader-distance">${Math.floor(item.distance)}m</span></div>`).join('');
}

socket.on('connect', () => {
  $('#server-status').innerHTML = '<i></i> SERVER ONLINE';
  $('#server-status').classList.remove('offline');
});
socket.on('disconnect', () => {
  $('#server-status').innerHTML = '<i></i> RECONNECTING';
  $('#server-status').classList.add('offline');
  if (state.screen === 'playing' || state.screen === 'results') toast('CONNECTION LOST — RECONNECTING…');
});
socket.on('connect_error', () => {
  $('#server-status').innerHTML = '<i></i> SERVER OFFLINE';
  $('#server-status').classList.add('offline');
});
socket.on('room', (room) => {
  state.room = room;
  if (state.screen === 'lobby') renderLobby();
  if (room.phase === 'results' && state.spectating) {
    state.spectating = false;
    setScreen('lobby');
    renderLobby();
  }
  if (room.phase === 'results' && (state.screen === 'results' || state.screen === 'playing')) {
    if (state.screen === 'playing' && state.local?.alive) state.local.alive = false;
    if (state.screen === 'results') {
      state.screen = 'playing';
      showResults();
    }
  }
});
socket.on('run:start', startRun);
socket.on('run:state', ({ players }) => {
  if (!state.local || (state.screen !== 'playing' && state.screen !== 'results')) return;
  if (state.room) state.room.players = players;
  for (const player of players) {
    if (player.id === state.playerId) {
      const local = state.local;
      if (state.spectating) continue;
      local.x += (player.x - local.x) * 0.08;
      local.distance += (player.distance - local.distance) * 0.06;
      local.gas += (player.gas - local.gas) * 0.1;
      local.threat += (player.threat - local.threat) * 0.1;
      local.lives = player.lives;
      local.supplies = player.supplies;
      local.score = player.score;
      local.invincible = player.invincible;
      if (player.alive) local.alive = true;
      else {
        local.alive = false;
        local.distance = player.distance;
        local.gas = player.gas;
        local.threat = player.threat;
        showResults();
      }
    } else {
      let remote = state.remotes.get(player.id);
      if (!remote) {
        remote = { current: { ...player }, target: { ...player }, updated: performance.now() };
        state.remotes.set(player.id, remote);
      } else {
        remote.current = { ...remote.interpolated || remote.current };
        remote.target = player;
        remote.updated = performance.now();
      }
    }
  }
  for (const [id, remote] of state.remotes) if (!players.some((player) => player.id === id)) state.remotes.delete(id);
});
socket.on('player:events', ({ id, events }) => {
  if (id !== state.playerId || !state.local || state.spectating) return;
  for (const event of events) {
    if (event.type === 'hit') {
      if (state.local.lives > event.lives) {
        state.local.lives = event.lives;
        state.local.invincible = 2.5;
        processEvent(event);
      }
    } else if (event.type === 'eliminated') {
      if (state.local.alive) { state.local.alive = false; processEvent(event); }
      showResults();
    }
  }
});

$('#create-room').addEventListener('click', () => joinRoom());
$('#join-form').addEventListener('submit', (event) => { event.preventDefault(); joinRoom($('#code-input').value); });
$('#code-input').addEventListener('input', () => { $('#code-input').value = $('#code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#start-run').addEventListener('click', () => {
  audio.unlock();
  socket.emit('room:start', {}, (response) => { if (response?.error) toast(response.error); });
});
$('#restart-run').addEventListener('click', () => socket.emit('room:start', {}, (response) => { if (response?.error) toast(response.error); }));
$('#copy-code').addEventListener('click', () => copyText(state.room?.code || '', 'ROOM CODE COPIED'));
$('#copy-invite').addEventListener('click', () => copyText(inviteLink(), 'SQUAD INVITE COPIED'));
$('#leave-lobby').addEventListener('click', leaveRoom);
$('#results-leave').addEventListener('click', leaveRoom);
$('#leave-run').addEventListener('click', leaveRoom);
$('#brand').addEventListener('click', () => { if (state.screen === 'menu') return; if (state.screen === 'lobby') leaveRoom(); else $('#pause-screen').hidden = false; });
$('#pause-button').addEventListener('click', () => show($('#pause-screen'), true));
$('#resume-run').addEventListener('click', () => show($('#pause-screen'), false));
$('#sound-button').addEventListener('click', () => { audio.toggle(); updateSoundIcon(); });
const openGuide = () => { if (!$('#guide-dialog').open) $('#guide-dialog').showModal(); };
$('#guide-button').addEventListener('click', openGuide);
$('#open-guide').addEventListener('click', openGuide);
$('#close-guide').addEventListener('click', () => $('#guide-dialog').close());
$('#guide-ready').addEventListener('click', () => $('#guide-dialog').close());
$('#guide-dialog').addEventListener('click', (event) => { if (event.target === $('#guide-dialog')) $('#guide-dialog').close(); });

window.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (event.code === 'Escape') {
    if ($('#guide-dialog').open) return;
    if (state.screen === 'playing') show($('#pause-screen'), $('#pause-screen').hidden);
    return;
  }
  if (state.screen !== 'playing' || state.spectating) return;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && !event.repeat) {
    state.boostQueued = true;
    state.localBoostPending = true;
  }
  audio.unlock();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); state.mouseGrapple = false; Object.assign(touchInput, freshInput()); });
$('#world').addEventListener('pointerdown', (event) => {
  if (state.screen !== 'playing' || state.spectating || event.pointerType === 'touch') return;
  state.mouseGrapple = true;
  $('#world').setPointerCapture(event.pointerId);
  audio.unlock();
});
$('#world').addEventListener('pointerup', () => { state.mouseGrapple = false; });
$('#world').addEventListener('pointercancel', () => { state.mouseGrapple = false; });
document.querySelectorAll('[data-input]').forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const input = button.dataset.input;
    touchInput[input] = true;
    if (input === 'boost') {
      state.boostQueued = true;
      state.localBoostPending = true;
    }
    button.setPointerCapture(event.pointerId);
    audio.unlock();
  });
  const release = () => { touchInput[button.dataset.input] = false; };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
});

setInterval(() => {
  if (state.screen !== 'playing' || state.spectating || !state.local?.alive) return;
  socket.emit('player:input', { ...currentInput(), boost: state.boostQueued });
  state.boostQueued = false;
}, 50);

buildCharacterSelectors();
updateSoundIcon();
const inviteCode = new URLSearchParams(window.location.search).get('room');
if (inviteCode) $('#code-input').value = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

let lastTime = performance.now();
let accumulator = 0;
function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  let renderPlayer;
  let remotes = [];
  if ((state.screen === 'playing' || state.screen === 'results') && state.local) {
    const active = state.screen === 'playing' && !state.spectating && state.local.alive && Date.now() >= state.startAt;
    if (active) {
      accumulator = Math.min(accumulator + dt, 0.15);
      const input = currentInput();
      const localBoost = state.localBoostPending;
      state.localBoostPending = false;
      while (accumulator >= 1 / 60) {
        const events = stepRunner(state.local, { ...input, boost: localBoost }, 1 / 60, state.seed);
        for (const event of events) processEvent(event);
        accumulator -= 1 / 60;
      }
    }
    const seconds = Math.ceil((state.startAt - Date.now()) / 1000);
    show($('#countdown'), state.screen === 'playing' && seconds > 0);
    if (seconds > 0 && seconds !== state.lastCountdown) {
      $('#countdown-number').textContent = seconds;
      state.lastCountdown = seconds;
    }
    for (const remote of state.remotes.values()) {
      const alpha = Math.min(1, (now - remote.updated) / 110);
      const current = remote.current;
      const target = remote.target;
      const interpolated = { ...target };
      for (const property of ['x', 'y', 'distance', 'gas', 'threat']) interpolated[property] = current[property] + (target[property] - current[property]) * alpha;
      remote.interpolated = interpolated;
      remotes.push(interpolated);
    }
    renderPlayer = state.local;
    if (state.spectating || state.watching) {
      const followed = remotes.find((player) => player.alive) || remotes[0];
      if (followed) renderPlayer = followed;
    }
    const players = state.room?.players || [state.local];
    updateHud(renderPlayer, players);
    audio.update(state.screen === 'playing', state.local.grapple, state.local.boostTime > 0);
  } else {
    audio.update(false, false, false);
  }
  world.lookBack = state.screen === 'playing' && (keys.has('KeyS') || keys.has('ArrowDown'));
  world.update(renderPlayer || {}, remotes, state.seed, dt, renderPlayer ? 'playing' : 'menu');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
