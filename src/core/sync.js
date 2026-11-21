// Synchronisations-Kern: Server-Snapshot + Warteschlange offener Operationen.
//
// Ablauf: Jede Nutzeraktion wird sofort lokal gespeichert (Warteschlange in
// localStorage) und danach der Reihe nach an den Server geschickt. Schlägt das
// Senden wegen Netzwerkproblemen fehl, bleibt die Operation in der Schlange
// und wird später erneut versucht. So geht offline nichts verloren.
//
// Das Backend wird hereingereicht (siehe src/api.js), damit diese Datei ohne
// Netzwerk testbar ist.

import { applyOp, applyOps, applyServerChange, emptySnapshot, remapProductId } from './model.js';

export class BackendError extends Error {
  /**
   * @param {'transient'|'permanent'|'duplicateName'} kind
   *   transient: später erneut versuchen (offline, Server kurz weg, Token abgelaufen)
   *   permanent: Operation verwerfen und melden
   *   duplicateName: Produktname existiert schon; `existing` enthält die DB-Zeile
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;

export class SyncStore {
  constructor({ backend, storage, storageKey, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.backend = backend;
    this.storage = storage;
    this.storageKey = storageKey;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.server = emptySnapshot();
    this.ops = [];
    this.view = emptySnapshot();
    this.status = 'idle'; // idle | syncing | offline
    this.lastError = null;

    this.listeners = new Set();
    this.errorListeners = new Set();
    this.flushing = null;
    this.retryTimer = null;
    this.retryDelay = RETRY_MIN_MS;
    this.completedOps = 0;
    this.opCounter = 0;
    this.loaded = false;
  }

  // ---- Beobachter --------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onError(fn) {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  emit() {
    this.view = applyOps(this.server, this.ops);
    for (const fn of this.listeners) fn(this);
  }

  reportError(message) {
    this.lastError = message;
    for (const fn of this.errorListeners) fn(message);
  }

  setStatus(s) {
    if (this.status !== s) {
      this.status = s;
      this.emit();
    }
  }

  // ---- Persistenz --------------------------------------------------------

  load() {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.server && Array.isArray(data.ops)) {
          this.server = data.server;
          this.ops = data.ops;
        }
      }
    } catch (e) {
      // Kaputter Cache: Server-Snapshot kommt beim nächsten resync neu.
      // Die Warteschlange ist dann verloren; das melden wir, statt es zu verschweigen.
      this.reportError('Lokaler Speicher war beschädigt und wurde zurückgesetzt.');
    }
    this.loaded = true;
    this.emit();
  }

  persist() {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({ server: this.server, ops: this.ops }));
    } catch (e) {
      // z. B. Speicher voll oder privater Modus. Die App läuft weiter,
      // aber offline Änderungen wären bei einem Neustart weg.
      this.reportError('Änderungen konnten nicht lokal gespeichert werden.');
    }
  }

  // ---- Nutzeraktionen ----------------------------------------------------

  dispatch(op) {
    const stamped = { ...op, opId: `${Date.now()}-${++this.opCounter}`, at: op.at ?? new Date().toISOString() };
    this.ops.push(stamped);
    this.persist();
    this.emit();
    this.flush();
    return stamped;
  }

  get pendingCount() {
    return this.ops.length;
  }

  // ---- Senden ------------------------------------------------------------

  flush() {
    if (this.flushing) return this.flushing;
    if (this.retryTimer) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    this.flushing = this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async runFlush() {
    while (this.ops.length > 0) {
      const op = this.ops[0];
      this.setStatus('syncing');
      try {
        await this.backend.execute(op);
        this.acknowledge(op);
      } catch (err) {
        const kind = err instanceof BackendError ? err.kind : 'transient';
        if (kind === 'transient') {
          this.setStatus('offline');
          this.scheduleRetry();
          return;
        }
        if (kind === 'duplicateName' && op.type === 'upsertProduct' && op.isNew && err.existing) {
          this.mergeDuplicate(op, err.existing);
          continue;
        }
        // Dauerhafter Fehler: Operation verwerfen, damit die Schlange nicht
        // ewig hängt, und den Nutzer informieren.
        this.drop(op);
        this.reportError(err.message || 'Änderung wurde vom Server abgelehnt.');
        this.resync().catch(() => {});
      }
    }
    this.retryDelay = RETRY_MIN_MS;
    this.setStatus('idle');
  }

  acknowledge(op) {
    // Ergebnis gleich in den Server-Snapshot übernehmen, damit die Anzeige
    // nicht kurz zurückspringt, bis das Realtime-Ereignis eintrifft.
    applyOp(this.server, op);
    this.ops = this.ops.filter((o) => o.opId !== op.opId);
    this.completedOps++;
    this.persist();
    this.emit();
  }

  drop(op) {
    this.ops = this.ops.filter((o) => o.opId !== op.opId);
    this.persist();
    this.emit();
  }

  /**
   * Beide haben offline dasselbe Produkt angelegt. Statt einen Fehler zu
   * zeigen, wird das lokale Produkt auf das vorhandene umgebogen; spätere
   * Operationen (z. B. „auf den Zettel“) zielen dann auf das vorhandene.
   */
  mergeDuplicate(op, existing) {
    const localId = op.product.id;
    this.ops = remapProductId(
      this.ops.filter((o) => o.opId !== op.opId),
      localId,
      existing.id,
    );
    this.server.products[existing.id] = { ...existing };
    this.completedOps++;
    this.persist();
    this.emit();
  }

  scheduleRetry() {
    if (this.retryTimer) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      this.flush();
    }, delay);
  }

  /** Bei „online“-Ereignis oder Rückkehr in die App sofort erneut senden. */
  retryNow() {
    this.retryDelay = RETRY_MIN_MS;
    return this.flush();
  }

  // ---- Empfangen ---------------------------------------------------------

  /** Vollständigen Stand vom Server holen. */
  async resync() {
    // Ist während des Ladens eine eigene Operation bestätigt worden, kann die
    // Antwort älter sein als unser Snapshot. Dann einmal neu laden.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = this.completedOps;
      const snapshot = await this.backend.fetchAll();
      if (before === this.completedOps) {
        this.server = snapshot;
        this.persist();
        this.emit();
        return;
      }
    }
    // Nach mehreren Versuchen trotzdem übernehmen; offene Ops liegen ohnehin obenauf.
    this.server = await this.backend.fetchAll();
    this.persist();
    this.emit();
  }

  /** Einzelnes Realtime-Ereignis übernehmen. */
  applyRemote(table, eventType, row, oldRow) {
    this.server = applyServerChange(this.server, table, eventType, row, oldRow);
    this.persist();
    this.emit();
  }
}
