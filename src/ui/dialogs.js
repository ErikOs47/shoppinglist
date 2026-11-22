// Toast, Bestätigungsdialog und Sheet auf Basis von <dialog>.

import { esc } from './views.js';

let toastTimer = null;

export function toast(message, { error = false, ms = 3500 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

/** iOS-artiger Alert. Liefert true bei Bestätigung. */
export function confirmDialog({ title, message = '', confirmText = 'OK', cancelText = 'Abbrechen', destructive = false }) {
  const dlg = document.getElementById('confirm');
  dlg.innerHTML = `
    <div class="alert-text"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}</div>
    <div class="alert-buttons">
      <button value="cancel" data-r="0">${esc(cancelText)}</button>
      <button value="ok" data-r="1" class="strong ${destructive ? 'destructive' : ''}">${esc(confirmText)}</button>
    </div>`;
  return new Promise((resolve) => {
    const done = (r) => {
      dlg.close();
      resolve(r);
    };
    dlg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => done(b.dataset.r === '1')));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    }, { once: true });
    dlg.showModal();
  });
}

/**
 * Öffnet das Sheet mit gegebenem HTML. `mount(el, close)` hängt Ereignisse an.
 * Tippen auf den abgedunkelten Hintergrund schließt.
 */
export function openSheet(html, mount) {
  const dlg = document.getElementById('sheet');
  dlg.innerHTML = `<div class="grabber" aria-hidden="true"></div>${html}`;
  const close = () => {
    if (dlg.open) dlg.close();
  };
  dlg.onclick = (e) => {
    if (e.target === dlg) close(); // Klick auf ::backdrop
  };
  mount?.(dlg, close);
  dlg.showModal();
  return close;
}

export function closeSheet() {
  const dlg = document.getElementById('sheet');
  if (dlg.open) dlg.close();
}
