# Status

**Stand 2026-11-24:** Läuft produktiv (GitHub Pages + Supabase), beide Personen im Haushalt „CasaPicanha“. Neu auf Branch, lokal getestet, noch nicht produktiv: Tab „Essen“ (Gerichte mit Zutaten aus der Produktliste, Wochenplan, Zutaten auf den Zettel). Für Produktion nötig: Migration `20261124000000_meals.sql` (SETUP.md Schritt 8).

## Offen
- Übersetzungen (en, pt-PT) nicht muttersprachlich geprüft
- Wischen und Verschieben auf echtem iPhone prüfen (bisher nur Chromium mit Maus)
- Test auf echtem iPhone (Installation, Offline-Start, Rückkehr aus dem Hintergrund)

## Bekannte Einschränkungen
- App-Name „Einkauf“, Manifest und Bestätigungs-Mails von Supabase sind nicht übersetzt
- Kein „Haushalt verlassen“ und kein Passwort-Reset in der App (Reset geht über das Supabase-Dashboard)
- Kein Rückgängig nach „Einkauf abschließen“ oder Löschen (beides fragt vorher nach)
- Verschieben nur per Finger/Maus, nicht per Tastatur/VoiceOver
- Zutaten ohne Mengen; „haben wir“ gilt nur für das jeweilige Übernehmen
- Ein gelöschtes Produkt verschwindet ohne Rückfrage aus allen Gerichten
- Gerichte gleichen Namens werden beim Haushaltswechsel nicht zusammengeführt (Zutaten können verschieden sein)
- Vorschläge beruhen nur auf „Einkauf abschließen“ ab dem 22.11.2026; vorher Gekauftes zählt nicht

## Beobachten
- Supabase-Migrationshistorie (`supabase_migrations.schema_migrations`) kennt nur `order_favorites_history`; die übrigen Migrationen wurden von Hand im SQL Editor ausgeführt. Vor einem `supabase db push` die Historie mit `supabase migration repair` abgleichen, sonst versucht die CLI, bereits eingespielte Migrationen erneut auszuführen.
- Das Einspielen über die Supabase-Verbindung scheiterte am 23.11. dreimal an einer unbeantworteten Bestätigungsfrage; Migrationen dann über den SQL Editor einspielen.
- E2E-Test schlug zweimal im ersten Lauf nach Neustart des lokalen Supabase-Stacks fehl (Realtime-Ereignis kam nicht an). Ursache unklar. Abgesichert durch regelmäßigen Abgleich alle 30 s (Test `tests/e2e/lost-realtime.spec.js`).

## Nächster Schritt
Deployment nach SETUP.md, danach beide iPhones einrichten und eine Woche im Alltag nutzen.
