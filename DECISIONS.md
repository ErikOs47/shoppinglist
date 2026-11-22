# Entscheidungen

## 2026-11-21 – Supabase als Backend
**Entscheidung:** Supabase (Postgres + Auth + Realtime), Free-Plan.
**Begründung:** Gefordert waren RLS, Echtzeit und zwei Konten. Supabase liefert alle drei ohne eigenen Server. Die RLS-Regeln laufen direkt in Postgres und sind dort per pgTAP testbar.
**Verworfen:** Firebase (keine RLS im Postgres-Sinn, Security Rules sind ein eigenes Modell), eigener Node-Server mit WebSockets (deutlich mehr Betriebsaufwand).
**Folge:** Das Free-Projekt pausiert nach etwa einer Woche ohne Aktivität (siehe SETUP.md).

## 2026-11-21 – Kein UI-Framework
**Entscheidung:** Vanilla JS mit Vite statt React/Vue.
**Begründung:** Zwei Ansichten und wenige Dialoge. Eine einzige Laufzeitabhängigkeit (`supabase-js`) hält das Projekt einfach wartbar.
**Verworfen:** React (zusätzliche Abhängigkeit und Build-Komplexität ohne nennenswerten Nutzen bei diesem Umfang).

## 2026-11-21 – Offline über Operations-Warteschlange
**Entscheidung:** Jede Änderung wird als Operation in localStorage gespeichert und der Reihe nach gesendet. Die Anzeige ist Server-Snapshot + offene Operationen. IDs erzeugt der Client.
**Begründung:** Nichts geht verloren, wenn die App offline geschlossen wird. Wiederholungen sind idempotent (gleiche ID). Eigene Änderungen werden nicht von älteren Realtime-Ereignissen überschrieben.
**Verworfen:** IndexedDB (robuster bei großen Datenmengen, aber mehr Code; für einige hundert Produkte reicht localStorage). Supabase-eigene Offline-Lösungen gibt es nicht.

## 2026-11-21 – Konfliktregeln
**Entscheidung:**
- Gleicher Produktname von beiden offline angelegt → wird zu einem Produkt zusammengeführt (Server lehnt das zweite ab, der Client biegt Folge-Operationen um).
- Abhaken/Umbenennen: die zuletzt beim Server angekommene Änderung gilt.
- „Einkauf abschließen“ löscht nur Einträge, die serverseitig *noch* abgehakt sind. Hat die andere Person einen Haken gerade entfernt, bleibt der Artikel stehen.
**Begründung:** Für eine Einkaufsliste sind das die erwartbaren Ergebnisse, und keine Variante löscht ungewollt Daten.

## 2026-11-21 – Haushalt mit höchstens zwei Mitgliedern, Beitritt per Code
**Entscheidung:** Einladungscode mit 12 Zeichen (≈ 60 Bit Zufall); Beitritt nur per RPC; maximal zwei Mitglieder.
**Begründung:** Entspricht der Anforderung „zwei Accounts“. Ist der Haushalt voll, nützt ein weitergegebener Code niemandem.
**Verworfen:** Einladung per E-Mail-Link (braucht zuverlässigen Mailversand und mehr Code).

## 2026-11-21 – DELETE-Ereignisse ungefiltert abonniert
**Entscheidung:** INSERT/UPDATE werden per `household_id` gefiltert, DELETE ungefiltert. Unbekannte IDs ignoriert der Client.
**Begründung:** Supabase filtert DELETE-Ereignisse nicht per RLS, und sie enthalten nur den Primärschlüssel ([Supabase: Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)). Ein Client erfährt dadurch höchstens zufällige UUIDs gelöschter Zeilen anderer Haushalte, keine Inhalte.
**Alternative für später:** Supabase „Broadcast from Database“ mit privaten Kanälen pro Haushalt.

## 2026-11-22 – Hosting auf GitHub Pages per Actions-Workflow
**Entscheidung:** GitHub Pages mit Workflow (`.github/workflows/deploy-pages.yml`), der bei jedem Push auf `main` baut und `dist` veröffentlicht. Supabase-Werte kommen aus Repository-Secrets.
**Begründung:** Erik nutzt bereits GitHub Pages; kein weiteres Konto nötig. „Deploy from a branch“ veröffentlicht ungebaute Dateien und zeigt nur einen leeren Bildschirm.
**Verworfen:** Vercel (zusätzliches Konto, sonst gleichwertig).

## 2026-11-22 – Regelmäßiger Abgleich alle 30 Sekunden
**Entscheidung:** Zusätzlich zu Realtime lädt die App alle 30 s den vollständigen Stand und sendet wartende Änderungen, aber nur, wenn sie sichtbar und online ist. Gleichzeitige Abgleiche werden zusammengefasst.
**Begründung:** Geht ein Realtime-Ereignis verloren (beobachtet im Test nach Server-Neustart), wäre die Änderung sonst erst beim nächsten Wiederverbinden oder App-Wechsel sichtbar. 30 s sind ein Kompromiss aus Aktualität und Last: zwei kleine Abfragen pro Gerät und halbe Minute.
**Verworfen:** Nur Realtime (keine Absicherung); Abgleich auch im Hintergrund (Akku, iOS friert Hintergrund-Apps ohnehin ein).

## 2026-11-22 – Tabellenrechte ausdrücklich vergeben
**Entscheidung:** Neue Migration `20261122000000_explicit_grants.sql`: entzieht anon/authenticated alle Tabellenrechte und vergibt nur die nötigen (Produkte/Zettel CRUD, Haushalt lesen + Name ändern, Mitglieder lesen). Abgesichert durch pgTAP-Tests auf exakte Rechte.
**Begründung:** Neue Supabase-Projekte vergeben seit 30.05.2026 keine Standardrechte mehr ([Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). Eriks Projekt lieferte deshalb 42501. Der lokale CLI-Stack hat noch die alten Standardrechte, darum fiel es in Tests nicht auf. Durch „erst entziehen, dann vergeben“ verhalten sich alter und neuer Stand gleich.
**Verworfen:** Erste Migration anpassen (laut CLAUDE.md verboten, bereits eingespielt).

## 2026-11-22 – Neues Erscheinungsbild
**Entscheidung:** Eigene, ruhige Gestaltung statt iOS-Standardoptik: warmes Papierweiß / tiefes Anthrazit, ein gedeckter Smaragd-Akzent (#1f6b52, dunkel #5fbf97), Systemschrift, weiche Karten (Radius 18), schwebende Tab-Leiste, dunkle Pillen-Buttons, Fortschrittsbalken auf dem Zettel, neues App-Icon (Tasche mit Haken).
**Begründung:** Wunsch nach „schlicht, modern, elegant, hochwertig“. Ein einziger Akzent und viel Weißraum wirken ruhiger als mehrere Systemfarben.
**Verworfen:** iOS-Standardfarben (wirkten generisch).

## 2026-11-22 – Zettel ohne Kategorien, frei sortierbar
**Entscheidung:** Der Einkaufszettel ist eine durchgehende Liste in eigener Reihenfolge (Spalte `list_items.position`, Kommazahl). Neue Artikel kommen hinten an, Abgehakte gesammelt unten. Kategorien gibt es nur noch im Tab „Produkte“.
**Begründung:** Wunsch von Erik: Reihenfolge selbst bestimmen, Kategorien auf dem Zettel nicht nötig. Kommazahl: Beim Verschieben ändert sich nur eine Zeile, beide Geräte bleiben ohne Neunummerierung konsistent.
**Verworfen:** Sortieren innerhalb von Kategorien; Umschalter (beides von Erik abgelehnt).

## 2026-11-22 – Wischen zum Löschen ohne Rückfrage, mit Widerstand
**Entscheidung:** Von rechts nach links wischen löscht sofort (Produkte-Tab: Produkt; Zettel: nur vom Zettel). Die Zeile folgt dem Finger nur zur Hälfte, ausgelöst wird erst nach 60 % der Zeilenbreite Fingerweg; vorher Rückfedern.
**Begründung:** Eriks Wunsch: sofort, aber versehentliches Löschen durch langen, gedämpften Zug verhindern.
**Verworfen:** Rückfrage-Dialog; sofort + Rückgängig.

## 2026-11-22 – Favoriten gemeinsam, Vorschläge aus Kaufhistorie
**Entscheidung:** `products.favorite` gilt für den Haushalt. Kaufzähler `purchase_count`/`last_purchased_at` werden in der RPC `finish_shopping` hochgezählt (nur tatsächlich entfernte, abgehakte Artikel; Wiederholung zählt nicht doppelt). Vorschläge: bis zu 8 Produkte, nicht auf dem Zettel, nach Anzahl Käufe, dann zuletzt gekauft, dann Name.
**Begründung:** Gemeinsame Datenbank → gemeinsame Favoriten (Erik). Zählen auf dem Server, damit beide Geräte und Offline-Wiederholungen dieselbe Zahl ergeben.
**Verworfen:** Favoriten pro Person (eigene Tabelle nötig).
