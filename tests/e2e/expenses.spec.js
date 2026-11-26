// Ausgaben: Betrag beim „Einkauf abschließen“, Nachtragen, Bearbeiten,
// Löschen, Wochen-/Monatssummen, Verlauf; zwei Personen, Echtzeit, offline.

import { test, expect } from '@playwright/test';

const run = Date.now();

async function signUp(page, email) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Neues Konto erstellen' }).click();
  await page.getByLabel('E-Mail').fill(email);
  await page.getByLabel('Passwort').fill('geheim123');
  await page.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByRole('heading', { name: 'Haushalt' })).toBeVisible();
}

/** Lokales Datum 'YYYY-MM-DD' (wie die App). */
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const today = new Date();
const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const lastWeekDay = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 2); // Samstag der Vorwoche

/** Betrag wie angezeigt (de-DE: „23,40 €“ mit geschütztem Leerzeichen). */
const money = (s) => new RegExp(s.replace(',', ',') + '\\s€');

async function addExpense(page, { amount, note, date }) {
  await page.getByRole('button', { name: 'Ausgabe hinzufügen' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Betrag').fill(amount);
  if (date) await sheet.getByLabel('Datum').fill(date);
  if (note) await sheet.getByLabel('Notiz').fill(note);
  await sheet.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(sheet).not.toBeVisible();
}

const expenses = (page) => page.locator('[data-testid=expense]');

test('Ausgaben erfassen und auswerten', async ({ browser }) => {
  test.setTimeout(150_000);
  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));

  await signUp(a, `exp-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Kasse');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await expect(a.getByTestId('sync')).toHaveText('Live');
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();
  await signUp(b, `exp-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // Leerer Tab
  await b.getByRole('tab', { name: 'Ausgaben' }).click();
  await expect(b.getByText('Noch keine Ausgaben')).toBeVisible();

  // --- Einkauf abschließen mit Betrag ---------------------------------------
  await a.getByRole('tab', { name: 'Produkte' }).click();
  await a.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await a.locator('#sheet').getByLabel('Name').fill('Milch');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await a.locator('[data-testid=item][data-name=Milch] .row-main').click();
  await a.getByTestId('finish').click();
  const dlg = a.locator('#sheet');
  await dlg.getByLabel('Bezahlt (optional)').fill('abc');
  await dlg.getByRole('button', { name: 'Abschließen' }).click();
  await expect(dlg.locator('#f-error')).toHaveText('Bitte einen Betrag eingeben, z. B. 23,40.');
  await expect(dlg).toBeVisible(); // bleibt offen
  await dlg.getByLabel('Bezahlt (optional)').fill('23,40');
  await dlg.getByLabel('Bezahlt (optional)').press('Enter');
  await expect(a.locator('#toast')).toHaveText(/Einkauf abgeschlossen, 23,40\s€ eingetragen/);

  // B sieht die Ausgabe in Echtzeit
  await expect(b.getByTestId('stat-week')).toContainText(money('23,40'));
  await expect(expenses(b)).toHaveCount(1);
  await expect(expenses(b).first()).toContainText('Einkauf');

  // --- B trägt nach: diese Woche und Vorwoche ---------------------------------
  await addExpense(b, { amount: '5,1', note: 'Bäcker' });
  await expect(b.getByTestId('stat-week')).toContainText(money('28,50'));
  await addExpense(b, { amount: '10', note: 'Markt', date: iso(lastWeekDay) });
  await expect(b.getByTestId('stat-week')).toContainText(money('28,50')); // Vorwoche zählt nicht
  await expect(b.getByTestId('stat-week')).toContainText(/Vorwoche: 10,00\s€/);
  const sameMonth = lastWeekDay.getMonth() === today.getMonth();
  await expect(b.getByTestId('stat-month')).toContainText(money(sameMonth ? '38,50' : '28,50'));

  // A sieht alles, ungültiger Betrag im Formular wird abgelehnt
  await a.getByRole('tab', { name: 'Ausgaben' }).click();
  await expect(a.getByTestId('stat-week')).toContainText(money('28,50'));
  await a.getByRole('button', { name: 'Ausgabe hinzufügen' }).click();
  await a.locator('#sheet').getByLabel('Betrag').fill('0');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(a.locator('#x-error')).toHaveText('Bitte einen Betrag eingeben, z. B. 23,40.');
  await a.locator('#sheet [data-close]').click();

  // --- Bearbeiten: Bäcker 5,10 → 6,00 -----------------------------------------
  await a.getByRole('button', { name: /^Bäcker vom .* bearbeiten$/ }).click();
  await expect(a.locator('#sheet').getByLabel('Betrag')).toHaveValue('5,10');
  await a.locator('#sheet').getByLabel('Betrag').fill('6');
  await a.locator('#sheet').getByRole('button', { name: 'Sichern' }).click();
  await expect(a.getByTestId('stat-week')).toContainText(money('29,40'));
  await expect(b.getByTestId('stat-week')).toContainText(money('29,40'));

  // --- Verlauf: Vorwoche antippen zeigt Betrag und Einträge dieser Woche -------
  await expect(a.getByTestId('bar')).toHaveCount(8);
  await expect(a.getByTestId('chart-caption')).toContainText(money('29,40')); // aktuelle Woche vorgewählt
  await a.getByTestId('bar').nth(6).click();
  await expect(a.getByTestId('chart-caption')).toContainText(money('10,00'));
  await expect(expenses(a)).toHaveCount(1);
  await expect(expenses(a).first()).toContainText('Markt');
  await a.getByRole('tab', { name: 'Monate' }).click();
  await expect(a.getByTestId('bar')).toHaveCount(6);
  await expect(a.getByTestId('chart-caption')).toContainText(money(sameMonth ? '39,40' : '29,40'));
  await a.getByRole('tab', { name: 'Wochen' }).click();

  // --- Löschen: per Sheet mit Rückfrage --------------------------------------------
  await a.getByRole('button', { name: /^Bäcker vom .* bearbeiten$/ }).click();
  await a.locator('#sheet').getByRole('button', { name: 'Ausgabe löschen' }).click();
  await a.locator('#confirm').getByRole('button', { name: 'Löschen' }).click();
  await expect(a.getByTestId('stat-week')).toContainText(money('23,40'));
  await expect(b.getByTestId('stat-week')).toContainText(money('23,40'));

  // --- Abschließen ohne Betrag trägt nichts ein ------------------------------------
  await a.getByRole('tab', { name: 'Einkaufszettel' }).click();
  await a.locator('[data-testid=suggestion]').first().click(); // Milch wieder drauf
  await a.locator('[data-testid=item][data-name=Milch] .row-main').click();
  await a.getByTestId('finish').click();
  await a.locator('#sheet').getByRole('button', { name: 'Abschließen' }).click();
  await expect(a.locator('#toast')).toHaveText('Einkauf abgeschlossen');
  await a.getByRole('tab', { name: 'Ausgaben' }).click();
  await expect(expenses(a)).toHaveCount(1);

  // --- Offline nachtragen, danach Abgleich -----------------------------------------
  await ctxB.setOffline(true);
  await addExpense(b, { amount: '3,20', note: 'Kiosk' });
  await expect(b.getByTestId('stat-week')).toContainText(money('26,60'));
  await expect(b.getByTestId('sync')).toContainText('Offline');
  await ctxB.setOffline(false);
  await expect(b.getByTestId('sync')).toHaveText('Live', { timeout: 20_000 });
  await expect(a.getByTestId('stat-week')).toContainText(money('26,60'));

  // Nach Neuladen unverändert
  await a.reload();
  await expect(a.getByTestId('stat-week')).toContainText(money('26,60'));

  expect(errors).toEqual([]);
  await Promise.all([ctxA.close(), ctxB.close()]);
});
