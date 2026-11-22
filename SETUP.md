# Einrichtung und Deployment

Zeitaufwand ca. 20 Minuten. Du brauchst: ein GitHub-Konto (Repo liegt dort) und ein kostenloses Supabase-Konto. Veröffentlicht wird über GitHub Pages; GitHub baut die App dabei automatisch.

## 1. Supabase-Projekt anlegen

1. Auf <https://supabase.com> anmelden → **New project**.
2. Name z. B. `einkauf`, sicheres Datenbank-Passwort vergeben (wird für die App nicht gebraucht, aber aufheben), Region **Frankfurt (eu-central-1)**.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

## 2. Datenbankschema einspielen

**Variante A – ohne Installation (empfohlen):**

1. Im Projekt links **SQL Editor** öffnen → **New query**.
2. Den kompletten Inhalt von [`supabase/migrations/20261121000000_init.sql`](supabase/migrations/20261121000000_init.sql) einfügen → **Run**.
3. Erwartet: „Success. No rows returned“.

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
| Änderungen kommen beim anderen nicht an | Schritt 2 vollständig ausgeführt? Die letzte Zeile schaltet Realtime ein. App einmal schließen und neu öffnen. |
| Supabase meldet E-Mail-Limit | Der eingebaute Mailversand von Supabase ist stark begrenzt. Für zwei Personen reicht er, sonst eigenen SMTP-Server eintragen (Authentication → Emails → SMTP). |
