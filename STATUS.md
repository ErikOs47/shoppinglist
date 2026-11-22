# Status

**Stand 2026-11-21:** Version 1 fertig und lokal getestet: Produktdatenbank, Einkaufszettel, zwei Konten mit gemeinsamem Haushalt, Echtzeit, Offline, PWA.

## Offen
- Deployment auf echtes Supabase + GitHub Pages durch Erik (Anleitung: SETUP.md); Workflow ist lokal simuliert, aber noch nie auf GitHub gelaufen
- Test auf echtem iPhone (Installation, Offline-Start, Rückkehr aus dem Hintergrund)

## Bekannte Einschränkungen
- Kein „Haushalt verlassen“ und kein Passwort-Reset in der App (Reset geht über das Supabase-Dashboard)
- Kein Rückgängig nach „Einkauf abschließen“ oder Löschen (beides fragt vorher nach)
- Einzelne Artikel lassen sich auf dem Zettel nur im Modus „Bearbeiten“ entfernen (kein Wischen)

## Beobachten
- E2E-Test schlug zweimal im ersten Lauf nach Neustart des lokalen Supabase-Stacks fehl (Realtime-Ereignis kam nicht an). Ursache unklar. Abgesichert durch regelmäßigen Abgleich alle 30 s (Test `tests/e2e/lost-realtime.spec.js`).

## Nächster Schritt
Deployment nach SETUP.md, danach beide iPhones einrichten und eine Woche im Alltag nutzen.
