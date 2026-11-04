// Accessibility helpers: screen-reader announcements, modal focus handling (trap, Esc, restore focus),
// and the shared reduced-motion flag. Keyboard operation of the canvas lives in canvas.js / palette.js /
// inspector.js; this file holds the cross-cutting pieces.
window.SIM = window.SIM || {};

SIM.initA11y = function () {
  const live = document.getElementById('live');
  const modal = document.getElementById('modal');
  const card = document.getElementById('modal-card');
  let lastFocus = null;

  SIM.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (SIM.reducedMotion) document.body.classList.add('reduced-motion');

  // Polite live-region message. Clearing first makes repeated identical messages announce again.
  SIM.announce = function (text) {
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  };

  // Called by the campaign right after a modal opens: remember where focus was, then focus the dialog.
  SIM.focusModal = function () {
    if (!lastFocus || !modal.contains(lastFocus)) lastFocus = document.activeElement;
    const first = card.querySelector('button:not([disabled]), input, textarea, select') || card;
    first.focus();
  };

  // When the modal closes, return focus to what had it.
  new MutationObserver(() => {
    if (modal.hidden && lastFocus && document.contains(lastFocus)) { lastFocus.focus(); lastFocus = null; }
  }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });

  // Esc closes a dismissible dialog; Tab stays inside it.
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      const dismiss = [...card.querySelectorAll('button')].find((b) => /^(Close|Back to the level|Keep playing|Done)$/.test(b.textContent.trim()));
      if (dismiss) { e.preventDefault(); dismiss.click(); }
    } else if (e.key === 'Tab') {
      const items = [...card.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, a[href], summary')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });

  // Small toast for events a sighted player would notice on screen (also announced to screen readers).
  const toasts = document.getElementById('toasts');
  SIM.toast = function (text, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = text;
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => t.remove(), 3200);
  };
};
