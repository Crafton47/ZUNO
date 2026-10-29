'use strict';
(() => {
  const hero = document.querySelector('.auth-hero');
  const mascot = document.querySelector('.mascot-button');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 701px)');
  let frame = 0;
  hero.addEventListener('pointermove', event => {
    if (reduced.matches || !desktop.matches || frame) return;
    frame = requestAnimationFrame(() => {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty('--px', `${(event.clientX - rect.left - rect.width / 2) * .025}px`);
      hero.style.setProperty('--py', `${(event.clientY - rect.top - rect.height / 2) * .018}px`);
      frame = 0;
    });
  });
  hero.addEventListener('pointerleave', () => {
    hero.style.setProperty('--px', '0px'); hero.style.setProperty('--py', '0px');
  });
  let greeting;
  mascot.addEventListener('click', () => {
    mascot.dataset.mascotState = 'happy';
    document.querySelector('.hello-note').textContent = 'right here with you. ↗';
    clearTimeout(greeting);
    greeting = setTimeout(() => { mascot.dataset.mascotState = ''; }, 2200);
  });
})();
