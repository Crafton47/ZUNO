'use strict';
// Controllable vector interpretation of the supplied ZUNO artwork, not an extracted original.
(() => {
  document.querySelectorAll('[data-zuno-character]').forEach((host, index) => {
    const id = 'zuno-' + index;
    host.innerHTML = `<svg class="zuno-character" viewBox="0 0 320 300" role="img" aria-label="ZUNO, a glossy violet companion with orbital rings and an expressive face">
      <defs><radialGradient id="${id}-body" cx="35%" cy="25%" r="78%"><stop stop-color="#bbbcff"/><stop offset=".25" stop-color="#705bff"/><stop offset=".64" stop-color="#372082"/><stop offset=".88" stop-color="#925bff"/><stop offset="1" stop-color="#f5b7e8"/></radialGradient>
      <radialGradient id="${id}-face" cx="50%" cy="28%" r="80%"><stop stop-color="#17143d"/><stop offset=".7" stop-color="#0d0827"/><stop offset="1" stop-color="#522c9b"/></radialGradient>
      <linearGradient id="${id}-ring"><stop stop-color="#39e8ff"/><stop offset=".48" stop-color="#c3b7ff"/><stop offset="1" stop-color="#ff9ee9"/></linearGradient>
      <linearGradient id="${id}-shine" x2=".5" y2="1"><stop stop-color="white" stop-opacity=".95"/><stop offset="1" stop-color="#39e8ff" stop-opacity=".1"/></linearGradient></defs>
      <ellipse class="character-shadow" cx="160" cy="270" rx="75" ry="9" fill="#080713" opacity=".55"/>
      <g class="character-float"><g class="character-breathe">
      <ellipse class="character-orbit-back" cx="160" cy="145" rx="125" ry="52" transform="rotate(-25 160 145)" fill="none" stroke="url(#${id}-ring)" stroke-width="4" opacity=".7"/>
      <circle class="character-body" cx="160" cy="145" r="100" fill="url(#${id}-body)" stroke="#c5afff" stroke-width="2"/>
      <path d="M75 126C77 65 148 36 193 58" fill="none" stroke="url(#${id}-shine)" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="160" cy="150" rx="79" ry="76" fill="url(#${id}-face)"/>
      <path d="M201 71Q224 78 235 103" stroke="url(#${id}-shine)" stroke-width="15" stroke-linecap="round" fill="none"/>
      <path d="M81 168Q86 214 120 230" stroke="#39e8ff" stroke-opacity=".6" stroke-width="6" stroke-linecap="round" fill="none"/>
      <g class="character-face"><g class="character-brows" stroke="#e5d6ff" stroke-width="4" fill="none" stroke-linecap="round"><path class="brow-left" d="M110 114Q122 106 135 111"/><path class="brow-right" d="M185 111Q199 106 210 114"/></g>
      <g class="character-eyes" fill="#e9fcff"><ellipse class="eye-left" cx="123" cy="141" rx="9" ry="16"/><ellipse class="eye-right" cx="197" cy="141" rx="9" ry="16"/><circle cx="126" cy="136" r="3" fill="white"/><circle cx="200" cy="136" r="3" fill="white"/></g>
      <g class="character-happy-eyes" fill="none" stroke="#e5fbff" stroke-width="7" stroke-linecap="round"><path d="M111 144Q123 126 136 144"/><path d="M184 144Q197 126 209 144"/></g>
      <ellipse cx="108" cy="167" rx="11" ry="5" fill="#f5a1eb" opacity=".75"/><ellipse cx="212" cy="167" rx="11" ry="5" fill="#e889ea" opacity=".75"/>
      <path class="character-smile" d="M141 173Q160 193 179 173" fill="none" stroke="#f8c9ef" stroke-width="5" stroke-linecap="round"/>
      <ellipse class="character-mouth" cx="160" cy="181" rx="13" ry="10" fill="#e5b5f4"/><ellipse class="character-mouth-inner" cx="160" cy="179" rx="9" ry="6" fill="#30204d"/>
      </g><path class="character-orbit-front" d="M42 176C63 220 251 180 278 113" transform="rotate(-5 160 145)" fill="none" stroke="url(#${id}-ring)" stroke-width="5" stroke-linecap="round"/>
      <g class="character-sparkles" fill="#f5b7e8"><path d="M48 60l4 12 12 4-12 4-4 12-4-12-12-4 12-4z"/><path d="M268 204l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/><circle cx="257" cy="62" r="4" fill="#39e8ff"/></g>
      </g></g><g class="character-meter" fill="#39e8ff"><rect x="136" y="275" width="7" height="6" rx="3"/><rect x="149" y="275" width="7" height="6" rx="3"/><rect x="162" y="275" width="7" height="6" rx="3"/><rect x="175" y="275" width="7" height="6" rx="3"/></g></svg>`;
  });
})();
