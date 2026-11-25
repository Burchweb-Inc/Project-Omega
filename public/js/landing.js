const landingTour = document.querySelector('[data-landing-tour]');
const tourSteps = [...document.querySelectorAll('[data-tour-step]')];
const tourScreens = [...document.querySelectorAll('[data-tour-screen]')];
const currentLabel = document.querySelector('[data-tour-label]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const landingAuthLink = document.querySelector('[data-landing-auth-link]');

if (landingAuthLink) {
  try {
    if (localStorage.getItem('lockin-signed-in-before') === 'true') {
      landingAuthLink.href = '/login';
      landingAuthLink.querySelector('[data-landing-auth-label]').textContent = 'Sign in';
    }
  } catch (error) {
    console.warn('[LockIn] Could not read this device sign-in history.', error);
  }
}

function initializeLandingReveals() {
  const landingPage = document.querySelector('[data-landing-page]');
  const revealElements = [...document.querySelectorAll('[data-landing-reveal]')];
  if (!landingPage || !revealElements.length) return;

  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  revealElements.forEach((element) => {
    const siblings = [...element.parentElement.children].filter((sibling) => sibling.hasAttribute('data-landing-reveal'));
    const stagger = Math.min(siblings.indexOf(element) * 90, 270);
    element.style.setProperty('--landing-reveal-delay', `${stagger}ms`);
  });

  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      currentObserver.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  landingPage.classList.add('landing-motion-enabled');
  revealElements.forEach((element) => observer.observe(element));
}

let framePending = false;
let lenis;

function updateTour() {
  if (!landingTour || !tourSteps.length || !tourScreens.length) return;

  let activeIndex = 0;
  if (!reducedMotion.matches) {
    const centers = tourSteps.map((step) => {
      const bounds = step.getBoundingClientRect();
      return window.scrollY + bounds.top + bounds.height / 2;
    });
    const viewportCenter = window.scrollY + window.innerHeight * 0.52;
    activeIndex = centers.reduce((active, center, index) => viewportCenter >= center ? index : active, 0);
  }
  activeIndex = Math.min(activeIndex, tourScreens.length - 1);

  tourSteps.forEach((step, index) => {
    const active = index === activeIndex;
    step.classList.toggle('is-active', active);
    if (active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  tourScreens.forEach((screen, index) => {
    screen.classList.toggle('is-active', index === activeIndex);
    screen.classList.toggle('is-past', index < activeIndex);
  });
  if (currentLabel) currentLabel.textContent = tourSteps[activeIndex]?.dataset.tourLabel || '';
}

function scheduleTourUpdate() {
  if (framePending) return;
  framePending = true;
  window.requestAnimationFrame(() => {
    framePending = false;
    updateTour();
  });
}

initializeLandingReveals();
window.addEventListener('scroll', scheduleTourUpdate, { passive: true });
window.addEventListener('resize', scheduleTourUpdate, { passive: true });
updateTour();

async function enableSmoothScroll() {
  if (reducedMotion.matches) return;

  try {
    const { default: Lenis } = await import('https://cdn.jsdelivr.net/npm/lenis@1.3.28/+esm');
    if (reducedMotion.matches) return;
    lenis = new Lenis({ autoRaf: true, anchors: true });
    lenis.on('scroll', scheduleTourUpdate);
    window.addEventListener('pagehide', () => lenis?.destroy(), { once: true });
  } catch (error) {
    console.error('[LockIn] Lenis could not load; using native scrolling.', error);
  }
}

void enableSmoothScroll();
