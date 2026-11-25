// Toast, Bestätigungsdialog und Sheet auf Basis von <dialog>.

import { esc } from './views.js';
import { t } from '../i18n.js';

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
export function confirmDialog({ title, message = '', confirmText = t('ok'), cancelText = t('cancel'), destructive = false }) {
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
 * Alert mit einem Eingabefeld. Liefert den eingegebenen Text (auch leer) bei
 * Bestätigung, null bei Abbruch. `validate(text)` gibt eine Fehlermeldung
 * zurück oder null; bei Fehler bleibt der Dialog offen.
 */
export function promptDialog({
  title,
  message = '',
  label,
  placeholder = '',
  inputmode = 'text',
  confirmText = t('ok'),
  cancelText = t('cancel'),
  validate = () => null,
}) {
  const dlg = document.getElementById('confirm');
  dlg.innerHTML = `
    <form method="dialog" novalidate>
      <div class="alert-text"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
        <label class="alert-field"><span>${esc(label)}</span>
          <input name="value" inputmode="${esc(inputmode)}" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done" /></label>
        <p class="error alert-error" aria-live="polite"></p>
      </div>
      <div class="alert-buttons">
        <button type="button" data-r="0">${esc(cancelText)}</button>
        <button type="submit" data-r="1" class="strong">${esc(confirmText)}</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const input = form.value;
  const err = dlg.querySelector('.alert-error');
  return new Promise((resolve) => {
    const done = (r) => {
      dlg.close();
      resolve(r);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const problem = validate(input.value);
      if (problem) {
        err.textContent = problem;
        input.focus();
        return;
      }
      done(input.value);
    });
    dlg.querySelector('[data-r="0"]').addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(null);
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
