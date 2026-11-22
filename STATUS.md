# Status

**Stand 2026-11-22:** GitHub-Pages-Deployment läuft.  Version 1 fertig und lokal getestet: Produktdatenbank, Einkaufszettel, zwei Konten mit gemeinsamem Haushalt, Echtzeit, Offline, PWA.

## Offen
- Spracheinstellung (de/en) noch nicht in `main`/auf GitHub Pages
- Wischen und Verschieben auf echtem iPhone prüfen (bisher nur Chromium mit Maus)
- Test auf echtem iPhone (Installation, Offline-Start, Rückkehr aus dem Hintergrund)

## Bekannte Einschränkungen
- App-Name „Einkauf“, Manifest und Bestätigungs-Mails von Supabase sind nicht übersetzt
- Kein „Haushalt verlassen“ und kein Passwort-Reset in der App (Reset geht über das Supabase-Dashboard)
- Kein Rückgängig nach „Einkauf abschließen“ oder Löschen (beides fragt vorher nach)
- Verschieben nur per Finger/Maus, nicht per Tastatur/VoiceOver
- Vorschläge beruhen nur auf „Einkauf abschließen“ ab dem 22.11.2026; vorher Gekauftes zählt nicht

## Beobachten
- E2E-Test schlug zweimal im ersten Lauf nach Neustart des lokalen Supabase-Stacks fehl (Realtime-Ereignis kam nicht an). Ursache unklar. Abgesichert durch regelmäßigen Abgleich alle 30 s (Test `tests/e2e/lost-realtime.spec.js`).

## Nächster Schritt
Deployment nach SETUP.md, danach beide iPhones einrichten und eine Woche im Alltag nutzen.
