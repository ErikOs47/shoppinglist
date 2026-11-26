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

## 2026-11-22 – Sprache pro Konto (Deutsch, Englisch)
**Entscheidung:** Eigenes kleines Übersetzungsmodul `src/i18n.js` ohne Bibliothek. Die gewählte Sprache wird in `user_metadata.lang` des eigenen Supabase-Kontos gespeichert (per `auth.updateUser`, nur für das eigene Konto möglich) und zusätzlich lokal unter `pref:lang`. Ohne gespeicherte Wahl: Gerätesprache, sonst Englisch. Vorgegebene Kategorien werden nur angezeigt übersetzt, gespeichert bleibt der deutsche Name.
**Begründung:** Eriks Wunsch: Umstellung nur für den eigenen Benutzer, nicht für den Haushalt. `user_metadata` braucht keine Schemaänderung und gilt auf allen Geräten des Kontos. Lokale Kopie, damit Anmeldeseite und Offline-Start schon in der richtigen Sprache erscheinen.
**Verworfen:** Spalte in einer eigenen Profiltabelle (Migration nötig, kein Mehrwert); nur lokal speichern (gälte pro Gerät statt pro Konto); i18n-Bibliothek (neue Abhängigkeit für ~120 Texte).

## 2026-11-22 – Portugiesisch als dritte Sprache (pt-PT)
**Entscheidung:** Europäisches Portugiesisch (Code `pt`), Anrede „tu“, Begriffe aus Portugal (palavra-passe, guardar, eliminar, definições). Geräte mit pt-BR bekommen ebenfalls diese Variante. Ergänzt den Eintrag „Sprache pro Konto“ vom selben Tag.
**Begründung:** Eriks Wahl. Ein Code `pt` reicht, solange es nur eine Variante gibt.
**Verworfen:** Brasilianisches Portugiesisch (pt-BR).

## 2026-11-23 – Haushalt wechseln per Code statt Haushaltssuche
**Entscheidung:** Kein Suchen fremder Haushalte. Wechsel nur per Einladungscode (RPC `switch_household`), ein Konto bleibt in genau einem Haushalt. War man allein im alten Haushalt, werden Produkte und Zettel mitgenommen (gleiche Namen zusammengeführt) und der leere Haushalt gelöscht; sonst bleiben die Daten beim Partner. Wechsel wird blockiert, solange nicht gesendete Änderungen warten.
**Begründung:** Anlass: Eriks Freundin hatte einen eigenen Haushalt angelegt statt beizutreten. Eine Suche würde fremde Haushalte offenlegen; der Code ist der Zugangsschutz. Mitnehmen statt Löschen, damit nichts verloren geht (Eriks Wahl).
**Verworfen:** Haushaltssuche (Datenschutz); mehrere Mitgliedschaften mit Umschalter (großer Umbau, für zwei Personen unnötig).

## 2026-11-24 – Gerichte und Wochenplan
**Entscheidung:** Neuer Tab „Essen“ mit Wochenplan (Mo–So, Woche blättern) und Gerichte-Liste. Tabellen `meals` (Zutaten als Namen in `text[]`, ohne Mengen) und `meal_plan` (Gericht je Tag), RLS und Echtzeit wie bei Produkten. „Zutaten auf den Zettel“ zeigt eine Checkliste aller Zutaten der angezeigten Woche; was man schon hat, tippt man weg. Zutaten ohne passendes Produkt werden als Produkt (Kategorie „Sonstiges“) angelegt.
**Begründung:** Eriks Wahl: keine Mengen, „vorhanden“ nur beim Übernehmen markieren, Tage Mo–So. Zutaten als Namen statt Produkt-Verweis, damit ein Gericht vollständig bleibt, wenn ein Produkt gelöscht wird, und damit importierte Zutaten nicht sofort die Produktliste füllen. Ganze Zutatenliste je Gericht als ein Wert: Gleichzeitiges Bearbeiten desselben Gerichts ist selten, dann gilt die letzte Änderung.
**Verworfen:** Zutaten-Tabelle mit Produkt-Fremdschlüssel (mehr Operationen, Löschkonflikte); dauerhafte Markierung „haben wir immer“ (von Erik abgewählt).

## 2026-11-24 – Rezept-Import per Link über Edge Function
**Entscheidung:** Supabase Edge Function `recipe-import` holt die Seite und gibt nur die `application/ld+json`-Blöcke zurück; der Client sucht darin `schema.org/Recipe` und entfernt Mengen per Regeln (de, en, pt). Ergebnis wird vor dem Speichern angezeigt.
**Begründung:** Browser dürfen fremde Seiten wegen CORS nicht lesen. Rezeptseiten betten Name und Zutaten für Google als JSON-LD ein ([Google](https://developers.google.com/search/docs/appearance/structured-data/recipe)). Edge Functions sind im Free-Plan enthalten (500.000 Aufrufe/Monat, [Supabase](https://supabase.com/docs/guides/functions/pricing)). Auswertung im Client, damit sie per Vitest testbar ist und die Funktion als einzelne Datei ins Dashboard kopiert werden kann.
**Absicherung:** JWT-Prüfung durch Supabase (nur angemeldete Nutzer); nur http(s) auf 80/443, keine privaten IPs/internen Namen, jede Weiterleitung neu geprüft, 10 s Zeitlimit, max. 3 MB. Nicht abgedeckt: öffentliche Namen, die per DNS auf interne Adressen zeigen.
**Verworfen:** TheMealDB (nur englisch, kleine Auswahl); Rezept-APIs mit Kosten; öffentlicher CORS-Proxy (Dritter sieht alle Aufrufe).

## 2026-11-24 – Zutaten per Text einfügen statt Link-Import und KI-Suche
**Entscheidung:** Der Link-Import (Edge Function `recipe-import`) ist wieder entfernt, bevor er produktiv war. Stattdessen gibt es im Gericht-Editor „Zutaten aus Text einfügen“: kopierten Text (z. B. eine ChatGPT-Antwort) einfügen, `ingredientsFromText` macht daraus Zutaten ohne Mengen. Ersetzt den Eintrag „Rezept-Import per Link über Edge Function“ vom selben Tag.
**Begründung:** Eriks Wahl. KI-Suche in der App bräuchte einen eigenen, kostenpflichtigen API-Zugang (ChatGPT-/Claude-Abos enthalten keine API, [OpenAI Help](https://help.openai.com/en/articles/6950777-how-do-i-subscribe-to-chatgpt-plus)). ChatGPT-Teilen-Links enthalten keine Rezeptdaten im schema.org-Format, und ein Auslesen ihres undokumentierten Seitenformats wäre unzuverlässig. Text einfügen funktioniert mit jeder Quelle, ohne Server-Teil, Kosten oder Schlüssel.
**Verworfen:** Claude/Gemini/Perplexity-API (Kosten bzw. Datennutzung im Gratis-Tarif), Link-Import (Aufwand für Edge Function, Seiten sperren evtl. Abrufe), Auslesen von ChatGPT-Links.
**Beibehalten:** Optionales Feld „Rezept-Link“ nur zum Speichern und Öffnen (`meals.source_url`).

## 2026-11-24 – Zutaten aus der Produktliste wählen
**Entscheidung:** Kein Import und kein Text-Einfügen. Zutaten eines Gerichts werden in der eigenen Produktliste angetippt (Suche, fehlende Produkte direkt anlegen). Gespeichert als `meals.product_ids uuid[]`. Ersetzt die Einträge „Zutaten per Text einfügen …“ und den Teil „Zutaten als Namen“ aus „Gerichte und Wochenplan“ vom selben Tag. Die Migration `20261124000000_meals.sql` wurde dafür geändert; das war zulässig, weil sie noch nirgends außer lokal eingespielt war (Produktion geprüft: keine Tabelle `meals`).
**Begründung:** Eriks Wunsch. Verweise statt Namen: Umbenennen wirkt in allen Gerichten, „Zutaten auf den Zettel“ muss nichts mehr per Name zuordnen oder anlegen. Liste in einer Spalte statt eigener Tabelle: Ein Gericht wird als Ganzes gespeichert (eine Operation), wie bisher.
**Verworfen:** Verknüpfungstabelle `meal_ingredients` mit Fremdschlüssel (räumt gelöschte Produkte selbst weg, aber eine Operation pro Zutat und mehr Realtime-Ereignisse).
**Folge:** Ein gelöschtes Produkt verschwindet ohne Rückfrage aus allen Gerichten.

## 2026-11-24 – Kategorien umbenennen und einklappen
**Entscheidung:** Umbenennen ändert die Kategorie aller Produkte darin für den Haushalt (Operation `renameCategory`, offline-fähig, eine Anweisung auf dem Server). Ist der neue Name schon eine Kategorie mit Produkten, wird nach Rückfrage zusammengeführt. Einklappen ist reine Anzeige und gilt pro Gerät (`pref:collapsed`); bei einer Suche ist alles aufgeklappt.
**Begründung:** Kategorien sind kein eigenes Objekt, sondern ein Feld am Produkt; eine eigene Kategorien-Tabelle wäre eine Schemaänderung ohne Mehrwert für zwei Personen. Einklappen pro Gerät, weil jeder anders einkauft und es keine gemeinsamen Daten ändert.
**Folge:** Eine umbenannte vorgegebene Kategorie (z. B. „Sonstiges“ → „Diverses“) ist danach eine eigene und wird nicht mehr übersetzt; die vorgegebene bleibt in der Auswahl. Neue Zutaten-Produkte landen weiter in „Sonstiges“.

## 2026-11-24 – Gerichte im Wochenplan per Ziehen verschieben
**Entscheidung:** Griff an jedem geplanten Gericht; senkrecht ziehen verschiebt über alle Tage der angezeigten Woche (auch auf leere Tage) und innerhalb eines Tages, waagerecht wischen entfernt weiterhin. Neue Operation `movePlan` ändert Tag und `position` (Mitte zwischen den Nachbarn, wie auf dem Zettel). Keine Schemaänderung.
**Begründung:** Eriks Wunsch. Gleiches Bedienmuster wie auf dem Einkaufszettel. Als Hinweis öffnet sich eine Lücke an der Zielstelle (wie unter iOS), eine Einfügelinie lag unter dem Finger und verdeckte den Namen.
**Verworfen:** Verschieben in eine andere Woche (nicht gewünscht; ginge über Entfernen und neu Einplanen).

## 2026-11-25 – Ausgaben erfassen und auswerten
**Entscheidung:** Neue Tabelle `expenses` (Betrag in Cent, Datum, optionale Notiz), vierter Tab „Ausgaben“. Erfassung beim „Einkauf abschließen“ (optionales Feld) und jederzeit über +. Auswertung: Summe dieser Woche (Mo–So) und dieses Kalendermonats mit Vorperiode, Verlauf der letzten 8 Wochen bzw. 6 Monate als Säulen, Einträge der gewählten Periode. Kein Zahler, keine Ausgleichsrechnung. Währung Euro.
**Begründung:** Eriks Wahl (beides erfassen, nur Gesamtsummen, eigener Tab). Cent als Ganzzahl vermeidet Rundungsfehler. Säulen nach den Dataviz-Regeln: eine Reihe, eine Farbe, gewählte Periode betont, Wert über der Grafik statt Zahl an jeder Säule; jeder Wert ist per Antippen und als Vorlesetext erreichbar (kein Hover auf dem iPhone).
**Verworfen:** Zahler pro Ausgabe und Ausgleich (nicht gewünscht); Betrag pro Produkt (Kassenbons enthalten mehr als den Zettel); Dialog mit Pflichtbetrag (Abschließen soll ohne Betrag gehen).

## 2026-11-25 – Ladebildschirm in der App statt iOS-Startbildern
**Entscheidung:** Eigener Ladebildschirm (App-Symbol als SVG, Name, darunter ein Einkaufswagen, der durchs Bild fährt; erscheint erst nach 0,6 s) direkt in `index.html`, hell/dunkel; bei „Bewegung reduzieren“ steht der Wagen still in der Mitte (styles.css schaltet dort alle Animationen ab, auch Einblendungen – Fahrbahn deshalb dort direkt sichtbar). Er bleibt bis zur ersten echten Ansicht und blendet dann aus; mit Zwischenspeicher startet die App ohne auf den Server zu warten.
**Begründung:** Eriks Wunsch. iOS-Startbilder (`apple-touch-startup-image`) brauchen je Gerät und Ausrichtung eine eigene PNG mit exakt passender Größe und waren in einzelnen iOS-Versionen fehlerhaft ([Apple Developer Forum](https://developer.apple.com/forums/thread/733490), [WebKit Bug 280262](https://bugs.webkit.org/show_bug.cgi?id=280262)); der Pflegeaufwand steht in keinem Verhältnis.
**Folge:** Vor dem Ladebildschirm zeigt iOS beim Kaltstart kurz seinen eigenen leeren Bildschirm.

## 2026-11-26 – Produktpreise und Bon-Scan
**Entscheidung:** Spalte `products.price_cents` (zuletzt bezahlter Stückpreis) und `products.receipt_names` (gelernte Namen auf Kassenbons, höchstens 20). Preise kommen auf drei Wegen: im Produkt-Editor, beim „Einkauf abschließen“ (Liste der gekauften Produkte, vorbefüllt mit dem letzten Preis) und per Bon-Scan. Schätzung auf dem Zettel = Summe der bekannten Preise aller Einträge, jedes Produkt einmal. Der Bon-Scan läuft über die Edge Function `receipt-scan`: Foto (im Browser auf 2000 px verkleinert) und Produktliste gehen an Claude (Standard `claude-opus-5-5`, strukturierte JSON-Ausgabe, serverseitiger Rückfall bei Ablehnung), die App prüft die Zuordnung und lässt sie korrigieren. Gelernte Bon-Namen gehen bei der Zuordnung vor. Tageslimit 20 Scans pro Haushalt (`claim_receipt_scan`).
**Begründung:** Eriks Wahl (alle drei Wege). Marken und Sprachunterschiede („ZOTT MONTE“ vs. „Yogurt“) löst einfache Texterkennung nicht; ein Sprachmodell ordnet nach Bedeutung zu, gelernte Namen machen wiederkehrende Bons verlässlich und unabhängig von der KI. Bon-Namen als Spalte am Produkt statt eigener Tabelle: Abgleich, Realtime und Haushaltswechsel laufen über die vorhandenen Produktwege. Schlüssel nur als Supabase-Secret, nie im Browser. Tageslimit, weil Registrierung offen sein kann und jeder Scan Geld kostet.
**Verworfen:** Texterkennung im Browser (Tesseract.js: neue Abhängigkeit, auf Thermopapier schwach, löst das Markenproblem nicht); Preis pro Einkauf als Verlauf (mehr Daten ohne Nutzen für die grobe Schätzung); Mengen (bewusst weiterhin keine).
**Folge:** Bon-Scan kostet pro Bon wenige Cent und braucht ein Anthropic-Konto. „Einkauf abschließen“ ist jetzt ein Sheet statt eines Dialogs.
