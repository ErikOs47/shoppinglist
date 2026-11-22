# Projekt: Einkauf (shoppinglist)

## Zweck
Gemeinsame Einkaufsliste als PWA fürs iPhone. Zwei Personen teilen einen Haushalt mit Produktdatenbank und Einkaufszettel, Änderungen erscheinen in Echtzeit beim anderen. Funktioniert offline weiter und gleicht danach ab.

## Technik
- Vanilla JavaScript (ES-Module), kein UI-Framework; Build mit Vite 8
- Backend: Supabase (Postgres 17 mit RLS, Auth per E-Mail/Passwort, Realtime „postgres_changes“), Client `@supabase/supabase-js` 2.x
- PWA: eigener Service Worker (`public/sw.js`), Manifest, Icons
- Tests: Vitest (Kernlogik), pgTAP via `supabase test db` (RLS), Playwright (E2E, zwei Nutzer)
- Ziel: iOS Safari als Home-Bildschirm-App; Desktop-Browser funktionieren ebenfalls

## Befehle
- Starten: `npx supabase start` (Docker), dann `npm run dev`
- Tests: `npm test` · `npm run test:db` · `npm run test:e2e` (in dieser Cloud-Umgebung mit `CHROMIUM_PATH=/opt/pw-browsers/chromium`)
- Build: `npm run build` → `dist/`
- Lokale Env: `.env.local` mit `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (Werte aus `npx supabase status -o env`)

## Struktur
- `src/core/model.js` – reine Datenlogik: Operationen, Snapshot, Duplikatprüfung, Ansichten (kein DOM, kein Netz)
- `src/core/sync.js` – SyncStore: Warteschlange in localStorage, Senden mit Backoff, Konfliktbehandlung
- `src/api.js` – Supabase-Anbindung, Fehlereinordnung (vorübergehend/dauerhaft), Realtime-Abo
- `src/main.js` – App-Steuerung, Anmeldung, Haushalt, Event-Delegation
- `src/ui/views.js` – HTML-Vorlagen (immer über `esc()`), `src/ui/dialogs.js` – Sheet/Alert/Toast
- `supabase/migrations/` – Schema + RLS + RPCs; `supabase/tests/` – pgTAP-Tests
- `tests/unit/`, `tests/e2e/` – Vitest bzw. Playwright
- `SETUP.md` – Einrichtung und Deployment für Erik
- `.github/workflows/deploy-pages.yml` – baut und veröffentlicht auf GitHub Pages (Secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)

## Konventionen
- UI-Texte, Kommentare und Testnamen auf Deutsch; Bezeichner auf Englisch
- Jede Datenänderung läuft als Operation über `store.dispatch()`, nie direkt an Supabase (sonst kein Offline-Schutz)
- IDs für Produkte/Listeneinträge erzeugt der Client (UUID), damit Wiederholungen idempotent sind
- Listeneinträge sind im Client nach `product_id` geschlüsselt (in der DB eindeutig)

## Kritische Bereiche
- `normalizeName()` in `model.js` muss zum DB-Index `products_household_name_uq` passen
- `applyOps()` / `remapProductId()` / `mergeDuplicate()`: Konfliktlogik bei Offline-Duplikaten
- RLS-Policies und `my_household_id()` in der Migration: Änderungen nur mit angepasstem pgTAP-Test
- Service-Worker-Cache: `ignoreVary` ist nötig (siehe Kommentar in `sw.js`); bei Strategieänderung `CACHE`-Version erhöhen

## Nicht anfassen
- Bereits eingespielte Migrationen nicht ändern. Schemaänderungen immer als neue Migrationsdatei, sonst laufen bestehende Datenbanken auseinander.
