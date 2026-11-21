import { describe, it, expect, beforeEach } from 'vitest';
import { SyncStore, BackendError } from '../../src/core/sync.js';
import { applyOp, emptySnapshot, cloneSnapshot } from '../../src/core/model.js';

/** Speicher wie localStorage */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: m,
  };
}

/** Fake-Server mit einstellbaren Fehlern */
function fakeBackend() {
  const b = {
    db: emptySnapshot(),
    offline: false,
    failNext: null,
    executed: [],
    async execute(op) {
      if (this.offline) throw new BackendError('transient', 'offline');
      if (this.failNext) {
        const e = this.failNext;
        this.failNext = null;
        throw e;
      }
      this.executed.push(op);
      applyOp(this.db, op);
    },
    async fetchAll() {
      if (this.offline) throw new BackendError('transient', 'offline');
      return cloneSnapshot(this.db);
    },
  };
  return b;
}

let timers;
function makeStore(backend, storage = memoryStorage()) {
  timers = [];
  return new SyncStore({
    backend,
    storage,
    storageKey: 'k',
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
}

const newProduct = (id, name) => ({ type: 'upsertProduct', isNew: true, product: { id, name, category: 'Sonstiges' } });

describe('SyncStore', () => {
  let backend;
  beforeEach(() => {
    backend = fakeBackend();
  });

  it('sendet Operationen der Reihe nach und leert die Schlange', async () => {
    const s = makeStore(backend);
    s.load();
    s.dispatch(newProduct('p1', 'Milch'));
    s.dispatch({ type: 'addToList', id: 'i1', productId: 'p1' });
    await s.flush();
    expect(backend.executed.map((o) => o.type)).toEqual(['upsertProduct', 'addToList']);
    expect(s.pendingCount).toBe(0);
    expect(s.status).toBe('idle');
    expect(s.view.items.p1).toBeDefined();
  });

  it('offline: Änderungen bleiben sichtbar und überstehen einen Neustart', async () => {
    const storage = memoryStorage();
    backend.offline = true;
    const s = makeStore(backend, storage);
    s.load();
    s.dispatch(newProduct('p1', 'Milch'));
    await s.flush();
    expect(s.status).toBe('offline');
    expect(s.view.products.p1.name).toBe('Milch');
    expect(timers).toHaveLength(1); // Wiederholung geplant
    expect(timers[0].ms).toBe(1000);

    // App wird geschlossen und neu geöffnet, wieder online
    backend.offline = false;
    const s2 = makeStore(backend, storage);
    s2.load();
    expect(s2.pendingCount).toBe(1);
    await s2.flush();
    expect(backend.db.products.p1.name).toBe('Milch');
    expect(s2.pendingCount).toBe(0);
  });

  it('Wartezeit zwischen Versuchen wächst bis 30 s', async () => {
    backend.offline = true;
    const s = makeStore(backend);
    s.load();
    s.dispatch(newProduct('p1', 'Milch'));
    for (let i = 0; i < 7; i++) {
      await s.flush();
      timers.at(-1).fn(); // Timer auslösen
      await s.flushing;
    }
    const delays = timers.map((t) => t.ms);
    expect(delays.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 16000, 30000]);
  });

  it('Duplikat beim Nachsenden: wird mit vorhandenem Produkt zusammengeführt', async () => {
    const s = makeStore(backend);
    s.load();
    // Partner hat offline ebenfalls "Milch" angelegt; sein Eintrag kam zuerst an.
    const existing = { id: 'server-milch', name: 'Milch', category: 'Sonstiges' };
    backend.db.products[existing.id] = existing;
    backend.failNext = new BackendError('duplicateName', 'gibt es schon', { existing });
    s.dispatch(newProduct('lokal-milch', 'Milch'));
    s.dispatch({ type: 'addToList', id: 'i1', productId: 'lokal-milch' });
    await s.flush();
    expect(s.pendingCount).toBe(0);
    expect(backend.executed.at(-1)).toMatchObject({ type: 'addToList', productId: 'server-milch' });
    expect(backend.db.items['server-milch']).toBeDefined();
    expect(s.view.products['lokal-milch']).toBeUndefined();
  });

  it('dauerhafter Fehler: Operation wird verworfen und gemeldet, Rest läuft weiter', async () => {
    const s = makeStore(backend);
    const errors = [];
    s.onError((m) => errors.push(m));
    s.load();
    backend.failNext = new BackendError('permanent', 'Keine Berechtigung');
    s.dispatch(newProduct('p1', 'Milch'));
    s.dispatch(newProduct('p2', 'Brot'));
    await s.flush();
    expect(errors).toEqual(['Keine Berechtigung']);
    expect(s.pendingCount).toBe(0);
    expect(backend.db.products.p2).toBeDefined();
  });

  it('unbekannter Fehler (z. B. TypeError) gilt als vorübergehend, nichts geht verloren', async () => {
    const s = makeStore(backend);
    s.load();
    backend.failNext = new TypeError('Failed to fetch');
    s.dispatch(newProduct('p1', 'Milch'));
    await s.flush();
    expect(s.pendingCount).toBe(1);
    expect(s.status).toBe('offline');
  });

  it('Realtime-Ereignis überschreibt keine noch offene eigene Änderung', async () => {
    backend.offline = true;
    const s = makeStore(backend);
    s.server.products.p1 = { id: 'p1', name: 'Milch', category: 'Sonstiges' };
    s.server.items.p1 = { id: 'i1', product_id: 'p1', checked: false };
    s.load();
    s.dispatch({ type: 'setChecked', productId: 'p1', checked: true });
    s.applyRemote('list_items', 'UPDATE', { id: 'i1', product_id: 'p1', checked: false });
    expect(s.view.items.p1.checked).toBe(true);
  });

  it('beschädigter lokaler Speicher wird gemeldet statt abzustürzen', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{kaputt');
    const s = makeStore(backend, storage);
    const errors = [];
    s.onError((m) => errors.push(m));
    s.load();
    expect(errors).toHaveLength(1);
    expect(s.pendingCount).toBe(0);
  });

  it('resync übernimmt den Serverstand, offene Ops bleiben obenauf', async () => {
    backend.db.products.p9 = { id: 'p9', name: 'Käse', category: 'Sonstiges' };
    const s = makeStore(backend);
    s.load();
    backend.offline = true;
    s.dispatch(newProduct('p1', 'Milch'));
    await s.flush();
    backend.offline = false;
    await s.resync();
    expect(Object.keys(s.view.products).sort()).toEqual(['p1', 'p9']);
  });
});
