import { characterFor } from '../shared/game.js';

function illustratedPortrait(id, className = '') {
  const character = characterFor(id);
  const bob = id === 'mikasa';
  const short = id === 'levi';
  const blond = id === 'armin';
  return `<svg class="portrait ${className}" viewBox="0 0 160 180" role="img" aria-label="${character.name} portrait">
    <defs><linearGradient id="bg-${id}" x2="1" y2="1"><stop stop-color="${character.color}"/><stop offset="1" stop-color="#293b32"/></linearGradient></defs>
    <path fill="url(#bg-${id})" d="M0 0h160v180H0z"/>
    <path d="m-15 135 180-80M-20 160 170 72M-10 181l180-80" stroke="#dce6bf" stroke-opacity=".1" stroke-width="18"/>
    <path d="M29 180v-34l25-19h53l27 19v34" fill="#b39a74"/>
    <path d="m48 140 20-16h27l21 16-10 40H53Z" fill="#e4d5b2"/>
    <path d="m45 142-15 8 8 30h24l-6-32m53-6 20 8-8 30h-25l6-32" fill="#786348"/>
    <path d="m52 140 16 7-5 33H42l-4-24m68-16-15 7 6 33h20l5-24" fill="#3d5143"/>
    <path d="m60 149 7 3m32-3-7 3" stroke="#e0d3ac" stroke-width="3"/>
    <path d="M68 113h27v25l-13 8-14-9Z" fill="${character.skin}"/>
    <path d="M48 66q0-37 34-37t35 37v28q-4 29-35 34-29-7-34-34Z" fill="${character.skin}"/>
    <path d="M48 77q-8-7-8 5t10 15m66-20q8-7 8 5t-10 15" fill="${character.skin}"/>
    <path d="m66 111 15 6 18-7q-6 17-18 17t-15-16" fill="#c88f76" opacity=".55"/>
    <path d="m59 78 13-3m18 0 13 3" stroke="${character.hair}" stroke-width="3" stroke-linecap="round"/>
    <path d="M63 84h9m18 0h9" stroke="#313b36" stroke-width="3" stroke-linecap="round"/>
    <path d="m82 84-3 15 7 2" fill="none" stroke="#b98167" stroke-width="2"/>
    <path d="M74 110h15" stroke="#855e51" stroke-width="2" stroke-linecap="round"/>
    ${bob ? `<path d="M45 89q-9-56 36-61 44 4 39 62l-7 25-3-39-16-19-27 3-15 18 2 35Z" fill="${character.hair}"/><path d="M48 57q24-3 44-20l-5 20 24-6-4 18-27-17-32 21Z" fill="${character.hair}"/><path d="m55 131 24 9 24-8 4 11-26 8-28-9Z" fill="${character.accent}"/>` : `<path d="M47 77q-5-39 18-48 39-13 53 27l1 26-12-20-14 5-4-14-14 11-18-2-8 22Z" fill="${character.hair}"/>${short ? `<path d="m48 62 6-21 10-7-5 15m45-6 10 13 2 16-12-13Z" fill="${character.hair}"/>` : ''}${blond ? `<path d="m54 52 16-17 4 14 16-19 3 19 14-6 5 18-22-10-15 8-8-12Z" fill="${character.hair}"/>` : ''}`}
    <path d="m64 155 8 5 5-4-8-4m28 3-8 5-5-4 8-4" fill="none" stroke="#dbe0c6" stroke-width="1.5"/>
    <path d="M0 172h160v8H0z" fill="#17271f" opacity=".3"/>
  </svg>`;
}


export function portrait(id, className = '') {
  const character = characterFor(id);
  return `<span class="portrait photo-portrait ${className}"><span class="portrait-fallback" aria-hidden="true">${illustratedPortrait(id)}</span><img src="/portraits/${character.id}.jpg" alt="${character.name} portrait" loading="eager" decoding="async" onerror="this.remove()" /></span>`;
}
