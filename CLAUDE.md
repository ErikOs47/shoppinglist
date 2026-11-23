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
- `src/core/model.js` – reine Datenlogik: Operationen, Snapshot, Duplikatprüfung, Ansichten, Wochenplan/Zutaten (kein DOM, kein Netz)
- `src/core/recipe.js` – Rezept-Import: schema.org/Recipe aus JSON-LD lesen, Mengen aus Zutaten entfernen
- `src/core/sync.js` – SyncStore: Warteschlange in localStorage, Senden mit Backoff, Konfliktbehandlung
- `src/api.js` – Supabase-Anbindung, Fehlereinordnung (vorübergehend/dauerhaft), Realtime-Abo
- `src/main.js` – App-Steuerung, Anmeldung, Haushalt, Event-Delegation
- `src/ui/views.js` – HTML-Vorlagen (immer über `esc()`), `src/ui/dialogs.js` – Sheet/Alert/Toast
- `src/i18n.js` – Übersetzungen (de, en, pt = europäisches Portugiesisch mit „tu“), `t()`, Anzeigenamen der vorgegebenen Kategorien, Startsprache
- `src/ui/gestures.js` – Wischen zum Löschen (mit Widerstand) und Verschieben per Griff, Pointer-Events
- `supabase/migrations/` – Schema + RLS + RPCs; `supabase/tests/` – pgTAP-Tests
- `supabase/functions/recipe-import/index.ts` – Edge Function: holt Rezeptseiten (CORS-Umweg), gibt nur JSON-LD-Blöcke zurück; eine Datei ohne Imports, damit sie im Dashboard einfügbar ist; Logik per Vitest getestet (`tests/unit/recipe-import.test.js`)
- `tests/unit/`, `tests/e2e/` – Vitest bzw. Playwright
- `SETUP.md` – Einrichtung und Deployment für Erik
- `.github/workflows/deploy-pages.yml` – baut und veröffentlicht auf GitHub Pages (Secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)

## Konventionen
- Kommentare und Testnamen auf Deutsch; Bezeichner auf Englisch
- UI-Texte nie fest in den Code schreiben, sondern über `t('schlüssel')` aus `src/i18n.js`; neue Texte in **allen** Sprachen anlegen (Test `tests/unit/i18n.test.js` prüft Vollständigkeit)
- Sprache gilt pro Konto: `user_metadata.lang` in Supabase Auth, Kopie im Gerät unter `pref:lang`
- Jede Datenänderung läuft als Operation über `store.dispatch()`, nie direkt an Supabase (sonst kein Offline-Schutz)
- IDs für Produkte/Listeneinträge erzeugt der Client (UUID), damit Wiederholungen idempotent sind
- Listeneinträge sind im Client nach `product_id` geschlüsselt (in der DB eindeutig)

## Kritische Bereiche
- `normalizeName()` in `model.js` muss zum DB-Index `products_household_name_uq` passen
- `applyOps()` / `remapProductId()` / `mergeDuplicate()`: Konfliktlogik bei Offline-Duplikaten
- RLS-Policies und `my_household_id()` in der Migration: Änderungen nur mit angepasstem pgTAP-Test
- Gesten: Während Wischen/Verschieben pausiert `render()` (`ui.gesture`), sonst ersetzt ein Realtime-Ereignis die Zeile unter dem Finger. Der Griff entscheidet erst nach 6 px: senkrecht verschieben, waagerecht wischen.
- Zettel-Reihenfolge: `position` (Kommazahl, Mitte zwischen Nachbarn), gleiche Werte nach `created_at`/`id`; „Einkauf abschließen“ läuft über RPC `finish_shopping` (zählt Käufe)
- Service-Worker-Cache: `ignoreVary` ist nötig (siehe Kommentar in `sw.js`); bei Strategieänderung `CACHE`-Version erhöhen

- Gerichte: Zutaten sind Namen (`meals.ingredients text[]`), keine Produkt-Verweise. Erst beim Übernehmen auf den Zettel (`ingredientsToListOps`) wird per `normalizeName` ein Produkt gesucht oder neu angelegt.
- Haushaltswechsel (`switch_household_for`) muss alle Haushaltsdaten mitnehmen. Neue Tabellen mit `household_id` dort ergänzen (zuletzt geändert in `20261124000000_meals.sql`), sonst gehen sie beim Wechsel verloren.
- Neue Tabellen in eigenem Realtime-Kanal und in `fetchAll` mit `{ optional: true }` laden: Fehlt eine Tabelle (Migration noch nicht eingespielt), lehnt Supabase sonst das ganze Abo ab bzw. der ganze Abgleich scheitert (beides getestet).
- Sticky-Kopf/-Fuß in Sheets brauchen `z-index` > 1, weil `.row-inner` `z-index: 1` hat.
- Lokal läuft keine Edge-Runtime (`[edge_runtime] enabled = false`); der Import ist im E2E-Test per `page.route` simuliert.

- Kategorien werden auf Deutsch gespeichert (auch die vorgegebenen) und nur in der Anzeige übersetzt (`categoryLabel`); gespeicherte Namen nicht übersetzen, sonst sehen beide Personen unterschiedliche Daten

## Nicht anfassen
- Bereits eingespielte Migrationen nicht ändern. Schemaänderungen immer als neue Migrationsdatei, sonst laufen bestehende Datenbanken auseinander.
