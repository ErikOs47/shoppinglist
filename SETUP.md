# Einrichtung und Deployment

Zeitaufwand ca. 20 Minuten. Du brauchst: ein GitHub-Konto (Repo liegt dort) und ein kostenloses Supabase-Konto. Veröffentlicht wird über GitHub Pages; GitHub baut die App dabei automatisch.

## 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> anmelden → **New project**.
2. Name z. B. `einkauf`, sicheres Datenbank-Passwort vergeben (wird für die App nicht gebraucht, aber aufheben), Region **Frankfurt (eu-central-1)**.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

## 2. Datenbankschema einspielen

**Variante A – ohne Installation (empfohlen):**

1. Im Projekt links **SQL Editor** öffnen → **New query**.
2. Den kompletten Inhalt von [`supabase/migrations/20261121000000_init.sql`](supabase/migrations/20261121000000_init.sql) einfügen → **Run**. Erwartet: „Success. No rows returned“.
3. Inhalt löschen, dann genauso [`supabase/migrations/20261122000000_explicit_grants.sql`](supabase/migrations/20261122000000_explicit_grants.sql) einfügen → **Run**. Diese Datei gibt die Tabellen für die App frei. Neue Supabase-Projekte tun das seit Mai 2026 nicht mehr automatisch ([Supabase Changelog](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)). Ohne sie meldet die App „Keine Verbindung“ bzw. „Keine Berechtigung“.
4. Ebenso [`supabase/migrations/20261122100000_order_favorites_history.sql`](supabase/migrations/20261122100000_order_favorites_history.sql) ausführen (Reihenfolge, Favoriten, Kaufhistorie). Bei Neueinrichtung alle Dateien aus `supabase/migrations/` in Namensreihenfolge ausführen.

**Variante B – per CLI** (im Projektordner):

```bash
npm install
npx supabase login
npx supabase link --project-ref <projekt-ref>   # steht in der Projekt-URL
npx supabase db push
```

Das Schema enthält Tabellen, RLS-Regeln, die Funktionen zum Anlegen/Beitreten eines Haushalts und schaltet Realtime für Produkte und Einkaufszettel ein.

## 3. Anmeldung konfigurieren

Unter **Authentication**:

- **Sign In / Providers → Email**: aktiviert lassen. „Confirm email“ bleibt an. Beide müssen ihre E-Mail einmal per Link bestätigen.
- **URL Configuration → Site URL**: die Adresse der App eintragen: `https://<dein-github-name>.github.io/shoppinglist/` (klein geschrieben, mit `/` am Ende). Ohne diesen Eintrag führt der Bestätigungslink ins Leere.

## 4. URL und Schlüssel kopieren

Am schnellsten: im Projekt oben auf **Connect** klicken. Dort stehen die Project URL und der Publishable key.

Alternativ:
- **Project URL**: Sie lautet immer `https://<project-ref>.supabase.co`. Den `<project-ref>` siehst du in der Adresszeile des Browsers, wenn du im Dashboard bist: `supabase.com/dashboard/project/<project-ref>`. Steht auch unter **Integrations → Data API**.
- **Publishable key** (`sb_publishable_…`): **Project Settings → API Keys**. Den älteren „anon“-Key nicht mehr verwenden, Supabase schaltet ihn ab ([Supabase: API keys](https://supabase.com/docs/guides/getting-started/api-keys)).

Project URL → wird `VITE_SUPABASE_URL`, Publishable key → wird `VITE_SUPABASE_ANON_KEY`.

Der Publishable key ist öffentlich und landet bewusst im Browser. Geschützt sind die Daten durch die RLS-Regeln. Den **Secret key** (`sb_secret_…`) niemals eintragen.

## 5. App veröffentlichen (GitHub Pages)

Die App muss vor dem Veröffentlichen gebaut werden. Das erledigt der Workflow `.github/workflows/deploy-pages.yml` bei jedem Push auf `main` automatisch. Einmalig einrichten:

1. **Pull Request mergen**, damit Code und Workflow in `main` liegen.
2. Im Repo **Settings → Pages** → unter „Build and deployment“ bei **Source** „**GitHub Actions**“ wählen (nicht „Deploy from a branch“, sonst werden die ungebauten Dateien veröffentlicht → leerer Bildschirm).
3. Im Repo **Settings → Secrets and variables → Actions → New repository secret**, zweimal:
   - Name `VITE_SUPABASE_URL`, Wert: Project URL aus Schritt 4
   - Name `VITE_SUPABASE_ANON_KEY`, Wert: Publishable/anon key aus Schritt 4
4. Tab **Actions** → links „**Deploy auf GitHub Pages**“ → **Run workflow** → **Run workflow**.
5. Nach 1–2 Minuten ist der Lauf grün. Die App liegt unter `https://<dein-github-name>.github.io/shoppinglist/`.

Ist der Lauf rot, zeigt er den Grund an (z. B. „Secrets … fehlen“). Nach Ändern eines Secrets den Workflow erneut starten (Punkt 4), denn die Werte werden beim Build eingebaut.

Alternativ geht jeder Static-Hoster mit Build-Schritt (Vercel, Netlify, Cloudflare Pages): Build Command `npm run build`, Ausgabeordner `dist`, die beiden Werte als Umgebungsvariablen.

## 6. Auf dem iPhone installieren

1. Die App-URL in **Safari** öffnen (nicht in Chrome o. ä.).
2. **Teilen**-Symbol → **Zum Home-Bildschirm** → **Hinzufügen**.
3. Ab jetzt immer über das Icon starten. Nur so läuft sie im Vollbild, und iOS löscht die Offline-Daten nicht nach 7 Tagen ohne Nutzung ([WebKit: Tracking Prevention](https://webkit.org/tracking-prevention/)).

## 7. Erste Nutzung (zwei Personen)

1. **Person A**: „Neues Konto erstellen“ → E-Mail bestätigen → anmelden → **Haushalt anlegen**.
2. Person A: oben rechts das Personen-Symbol → **Einladungscode** → „Code teilen“.
3. **Person B**: Konto erstellen → bestätigen → anmelden → Code eingeben → **Beitreten**.
4. Fertig. Ein Haushalt nimmt höchstens zwei Personen auf. Danach ist der Code wertlos, auch wenn er weitergegeben wird.

**Empfohlen danach:** in Supabase unter **Authentication → Sign In / Providers** „Allow new users to sign up“ ausschalten. Dann kann niemand Fremdes mehr Konten anlegen.

## 8. Essen: Gerichte und Wochenplan (Update)

Für den Tab „Essen“ braucht die Datenbank zwei neue Tabellen. Wer schon eingerichtet hat, macht nur diesen einen Schritt:

- Im Supabase-Projekt **SQL Editor → New query** den Inhalt von [`supabase/migrations/20261124000000_meals.sql`](supabase/migrations/20261124000000_meals.sql) einfügen → **Run**. Erwartet: „Success. No rows returned“.

Die Reihenfolge zum Mergen des Pull Requests ist egal: Produkte und Zettel laufen auch ohne die neuen Tabellen weiter, nur Gerichte lassen sich dann nicht speichern.

**Zutaten wählen:** Im Gericht die Zutaten in der Produktliste antippen (Suche oben). Fehlt ein Produkt, legt „„…“ als Produkt anlegen“ es unter „Sonstiges“ an. Umbenennen eines Produkts ändert es in allen Gerichten mit.

## 9. Ausgaben (Update)

Für den Tab „Ausgaben“ braucht die Datenbank eine neue Tabelle:

- Im Supabase-Projekt **SQL Editor → New query** den Inhalt von [`supabase/migrations/20261125000000_expenses.sql`](supabase/migrations/20261125000000_expenses.sql) einfügen → **Run**. Erwartet: „Success. No rows returned“.

Die Reihenfolge zum Mergen ist egal: Ohne die Tabelle läuft alles andere weiter, nur Ausgaben lassen sich nicht speichern (Meldung verweist auf diesen Schritt).

**Bedienung:** Beim „Einkauf abschließen“ den bezahlten Betrag eintragen (optional) oder im Tab „Ausgaben“ über **+** nachtragen. Antippen bearbeitet, nach links wischen löscht. Beträge in Euro.

## 10. Preise (Update)

Für Preise im Produkt, die Kosten-Schätzung auf dem Zettel und den Bon-Scan braucht die Datenbank zwei neue Spalten:

- Im Supabase-Projekt **SQL Editor → New query** den Inhalt von [`supabase/migrations/20261126000000_prices.sql`](supabase/migrations/20261126000000_prices.sql) einfügen → **Run**. Erwartet: „Success. No rows returned“.

Reihenfolge egal: Ohne das Update lädt die App wie bisher, nur Preise lassen sich nicht speichern (Meldung verweist auf diesen Schritt).

**Bedienung:**
- Preis im Produkt (Tab „Produkte“ → Stift) eintragen, leer = unbekannt.
- Auf dem Zettel steht oben „ca. 12,30 € · 2 ohne Preis“, sobald ein Preis bekannt ist (jedes Produkt einmal, die App kennt keine Mengen).
- „Einkauf abschließen“ zeigt die gekauften Produkte mit ihrem letzten Preis; was abweicht, überschreiben.

## 11. Bon-Scan (optional, kostenpflichtig)

Der Bon-Scan schickt das Foto an Claude (Anthropic). Claude liest die Positionen und ordnet sie euren Produkten zu, auch bei Marken („ZOTT MONTE“) und englischen Produktnamen. Unsichere Zuordnungen sind mit „prüfen“ markiert und lassen sich per Auswahlliste ändern; die App merkt sich danach, wie das Produkt auf dem Bon heißt.

**Kosten:** Anthropic rechnet nach Tokens ab. Mit dem voreingestellten Modell Claude Opus 5.5 (4 $ / 20 $ je 1 Mio. Tokens Ein-/Ausgabe) geschätzt etwa 5–10 Cent pro Bon (nicht gemessen; der größte Unsicherheitsfaktor ist, wie viel das Modell „nachdenkt“). Günstiger: Secret `RECEIPT_MODEL` = `claude-haiku-5-5` (0,10 $ / 0,50 $), dafür evtl. schwächere Zuordnung. Pro Haushalt höchstens 20 Scans am Tag (in der Datenbank begrenzt).

1. **Anthropic-Konto:** auf [platform.claude.com](https://platform.claude.com/) anmelden, Guthaben bzw. Zahlung einrichten. Unter [Spend limits](https://platform.claude.com/settings/spend-limits) die Monatsgrenze prüfen.
2. **API-Schlüssel:** [API keys](https://platform.claude.com/settings/keys) → **Create key**, dabei einen **Workspace** auswählen (z. B. Default). Ohne Workspace verlangt die API eine zusätzliche Kopfzeile, die die Funktion nicht sendet ([Anthropic: Get your API key](https://platform.claude.com/docs/en/get-api-key)). Der Schlüssel (`sk-ant-…`) wird nur einmal angezeigt.
3. **Schlüssel in Supabase hinterlegen:** im Supabase-Projekt **Edge Functions → Secrets** → Key `ANTHROPIC_API_KEY`, Value = der Schlüssel → **Save**. Nicht in den Code, nicht in GitHub, nicht in einen Chat.
4. **Funktion bereitstellen:** Ordner `supabase/functions/receipt-scan` (drei Dateien) als Edge Function `receipt-scan` mit **JWT-Prüfung aus** bereitstellen. Wege:
   - Claude bitten, sie über die Supabase-Verbindung bereitzustellen, oder
   - mit der Supabase-CLI: `npx supabase login`, dann `npx supabase functions deploy receipt-scan --project-ref <Projekt-ID> --use-api --no-verify-jwt`.
   Die JWT-Prüfung ist aus, weil die Funktion selbst prüft: Ohne gültige Anmeldung und Haushalt bricht sie ab, bevor Claude gefragt wird.
5. **Testen:** Tab „Ausgaben“ → Kamera-Symbol → **Bon scannen**.

Meldung „Bon-Scan ist noch nicht eingerichtet“ = Funktion nicht bereitgestellt oder Secret fehlt.

**Datenschutz:** Das Foto (verkleinert) und eure Produktliste gehen an Anthropic. Auf dem Bon stehen u. a. Markt, Uhrzeit und ggf. die letzten Kartenziffern.

## Gut zu wissen

- **Supabase Free pausiert Projekte** nach etwa einer Woche ohne Aktivität, mit E-Mail-Warnung vorher. Bei normaler Nutzung der App passiert das nicht. Ein pausiertes Projekt lässt sich im Dashboard wieder starten ([Supabase: Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).
- **Offline:** Änderungen werden auf dem Gerät gespeichert und automatisch gesendet, sobald wieder Netz da ist. Oben links steht dann „Offline · n Änderungen warten“. Für den allerersten Start und die Anmeldung braucht man Internet.
- **Abmelden** mit noch nicht gesendeten Änderungen fragt nach. Die Änderungen bleiben auf dem Gerät und werden nach der nächsten Anmeldung gesendet.

## Lokale Entwicklung und Tests

Voraussetzungen: Node.js 20+, Docker (für den lokalen Supabase-Stack).

```bash
npm install
npx supabase start              # lokale DB + Auth + Realtime; gibt URL und anon key aus
cp .env.example .env.local      # Werte aus der Ausgabe eintragen (API_URL, ANON_KEY)
npm run dev                     # http://localhost:5173
```

| Befehl | Prüft |
| --- | --- |
| `npm test` | Kernlogik: Sync-Warteschlange, Offline, Konflikte, Ansichten (Vitest) |
| `npm run test:db` | RLS-Regeln und Datenintegrität direkt in Postgres (pgTAP) |
| `npm run test:e2e` | Zwei Personen in getrennten Browsern: Echtzeit, Gleichzeitigkeit, Offline (Playwright, braucht `supabase start` und `.env.local`) |

Ist Chromium nicht über Playwright installiert, einen vorhandenen Browser angeben: `CHROMIUM_PATH=/pfad/zu/chromium npm run test:e2e`.

## Fehlersuche

| Symptom | Ursache / Lösung |
| --- | --- |
| Schwarzer/weißer leerer Bildschirm oder „App startet nicht“ | Es wurden die Quelldateien statt des Builds veröffentlicht (z. B. GitHub Pages direkt aus dem Repo). Unter Settings → Pages die Source auf „GitHub Actions“ stellen (Schritt 5). |
| „Falsche Supabase-Einstellung“ | `VITE_SUPABASE_URL` ist falsch, sie muss mit `https://` beginnen und auf `.supabase.co` enden. Secret korrigieren und Workflow neu starten (Schritt 5). |
| „Nicht eingerichtet“ beim Öffnen | Secrets fehlten beim Build → eintragen und Workflow neu starten (Schritt 5) |
| Bestätigungslink öffnet falsche Seite | Site URL in Supabase (Schritt 3) stimmt nicht |
| „Bitte zuerst die E-Mail bestätigen“ | Link in der Bestätigungsmail anklicken (ggf. Spam-Ordner) |
| „Keine Verbindung“ / „Keine Berechtigung“, obwohl Internet da ist | Zweite SQL-Datei aus Schritt 2 (`…_explicit_grants.sql`) fehlt → im SQL Editor ausführen |
| Änderungen kommen beim anderen nicht an | Schritt 2 vollständig ausgeführt? Die letzte Zeile schaltet Realtime ein. App einmal schließen und neu öffnen. |
| Tab „Essen“: Gericht speichern meldet „Datenbank nicht eingerichtet“ | `…_meals.sql` aus Schritt 8 im SQL Editor ausführen |
| Tab „Ausgaben“: Speichern meldet fehlendes Datenbank-Update | `…_expenses.sql` aus Schritt 9 im SQL Editor ausführen |
| Preis speichern meldet fehlendes Datenbank-Update | `…_prices.sql` aus Schritt 10 im SQL Editor ausführen |
| „Bon-Scan ist noch nicht eingerichtet“ / „nicht erreichbar“ | Schritt 11: Funktion `receipt-scan` bereitstellen und Secret `ANTHROPIC_API_KEY` setzen |
| „Bon konnte nicht gelesen werden“ | Foto unscharf/schräg, oder Anthropic-Guthaben leer bzw. Schlüssel ungültig (Supabase → Edge Functions → receipt-scan → Logs) |
| Supabase meldet E-Mail-Limit | Der eingebaute Mailversand von Supabase ist stark begrenzt. Für zwei Personen reicht er, sonst eigenen SMTP-Server eintragen (Authentication → Emails → SMTP). |
