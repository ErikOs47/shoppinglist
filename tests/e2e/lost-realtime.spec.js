// Verlorene Realtime-Ereignisse: B bleibt verbunden, bekommt aber keine
// Datenänderungen über den WebSocket. Der regelmäßige Abgleich (30 s) muss
// die Änderung von A trotzdem anzeigen.

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

test('regelmäßiger Abgleich holt Änderungen, deren Realtime-Ereignis verloren ging', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // B: WebSocket durchreichen, aber Datenänderungen vom Server verwerfen.
  let dropped = 0;
  await b.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === 'string' && m.includes('"postgres_changes"') && m.includes('"data"')) {
        dropped++;
        return;
      }
      ws.send(m);
    });
  });

  await signUp(a, `lost-a-${run}@example.com`);
  await a.getByLabel('Name').fill('Zuhause');
  await a.getByRole('button', { name: 'Haushalt anlegen' }).click();
  await a.getByRole('button', { name: 'Einstellungen' }).click();
  const code = (await a.getByTestId('invite-code').textContent()).trim();
  await a.locator('#sheet').getByRole('button', { name: 'Fertig' }).click();

  await signUp(b, `lost-b-${run}@example.com`);
  await b.getByLabel('Code').fill(code);
  await b.getByRole('button', { name: 'Beitreten' }).click();
  await expect(b.getByTestId('sync')).toHaveText('Live');

  // A legt ein Produkt auf den Zettel
  await a.getByRole('tab', { name: 'Produkte' }).click();
  await a.getByRole('button', { name: 'Produkt hinzufügen' }).click();
  await a.locator('#sheet').getByLabel('Name').fill('Kaffee');
  await a.locator('#sheet').getByRole('button', { name: 'Hinzufügen' }).click();
  const added = Date.now();

  const itemB = b.locator('[data-testid=item][data-name="Kaffee"]');
  // Ohne Realtime nicht sofort da …
  await b.waitForTimeout(3000);
  await expect(itemB).toHaveCount(0);
  expect(dropped).toBeGreaterThan(0); // Ereignisse kamen an und wurden verworfen

  // … aber spätestens nach dem nächsten Abgleich (30 s + Puffer)
  await expect(itemB).toBeVisible({ timeout: 40_000 });
  expect(Date.now() - added).toBeLessThan(40_000);

  await Promise.all([ctxA.close(), ctxB.close()]);
});
