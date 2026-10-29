'use strict';
(() => {
  const sections = [...document.querySelectorAll('.legal-section')];
  const links = [...document.querySelectorAll('.contents-panel nav a')];
  const article = document.querySelector('#document');
  const details = document.querySelector('.contents-panel details');
  const mobile = matchMedia('(max-width: 800px)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const setContents = () => { details.open = !mobile.matches; };
  setContents(); mobile.addEventListener('change', setContents);
  let observer;
  function revealSections() {
    observer?.disconnect();
    sections.forEach(section => section.classList.remove('reveal-ready'));
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), { rootMargin: '0px 0px -25px 0px', threshold: 0 });
    sections.forEach(section => { section.classList.add('reveal-ready'); observer.observe(section); });
  }
  revealSections(); reduced.addEventListener('change', revealSections);
  let scheduled = false;
  function updateReading() {
    scheduled = false;
    const start = article.offsetTop;
    const end = start + article.offsetHeight - innerHeight;
    const progress = Math.min(1, Math.max(0, (scrollY - start) / Math.max(1, end - start)));
    document.querySelector('#reading-fill').style.transform = `scaleX(${progress})`;
    document.querySelector('#reading-percent').textContent = `${Math.round(progress * 100)}%`;
    let current = sections[0];
    for (const section of sections) if (section.getBoundingClientRect().top <= 130) current = section;
    if (progress === 1) current = sections.at(-1);
    links.forEach(link => {
      if (link.hash === `#${current.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(updateReading); } }
  addEventListener('scroll', schedule, { passive:true });
  addEventListener('resize', schedule);
  addEventListener('load', schedule);
  document.fonts?.ready.then(schedule);
  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const target = document.querySelector(link.hash);
    if (mobile.matches) details.open = false;
    target.classList.add('is-visible');
    history.pushState(null, '', link.hash);
    target.focus({ preventScroll:true });
    target.scrollIntoView({ behavior:reduced.matches ? 'instant' : 'smooth' });
  }));
  updateReading();
})();
