// Bon-Scan: Prompt, Antwortschema und Prüfung der Antwort. Reines JavaScript
// ohne Abhängigkeiten, damit Deno (Edge Function) und Vitest es laden können.

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MAX_IMAGE_CHARS = 8_000_000; // Base64, ≈ 6 MB; die App schickt ≈ 0,5 MB
export const MAX_PRODUCTS = 1000;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const SYSTEM_PROMPT = `Du liest Fotos von Kassenbons (meist deutsche Supermärkte) für eine gemeinsame Einkaufsliste.
Ziel: Jede gekaufte Position mit Stückpreis erfassen und, wenn möglich, einem Produkt aus der Produktliste des Haushalts zuordnen.

Regeln für die Positionen:
- Nur gekaufte Waren. Pfand, Leergut, Tragetaschen, Zwischensummen, Summe, Zahlungsart, Rückgeld, MwSt.-Zeilen und Werbetext weglassen.
- Rabatt- oder Preisvorteil-Zeilen nicht als eigene Position, sondern vom Preis der Position darüber abziehen.
- "2 x 0,69" bedeutet quantity 2 und unit_price_cents 69. Gewogene Ware ("0,512 kg x 2,99 EUR/kg  1,53") ist quantity 1 mit unit_price_cents 153.
- text: der Artikeltext so, wie er auf dem Bon steht (ohne Preis und Menge), höchstens 60 Zeichen.
- Preise immer in Cent als ganze Zahl.

Regeln für die Zuordnung (product_id):
- Die Produktliste nennt id, Name, Kategorie und bekannte Bon-Namen. Produktnamen können englisch oder deutsch sein; Bons nennen oft Marken oder Abkürzungen (z. B. "ZOTT MONTE" ist ein Milchdessert, "H-MILCH 1,5%" ist Milch/Milk, "GOUDA JG" ist Käse/Cheese).
- Ordne zu, wenn es dieselbe Art Produkt ist, auch bei anderer Sprache, Marke oder Abkürzung. Steht der Bon-Text unter den bekannten Bon-Namen eines Produkts, nimm dieses.
- Passt kein Produkt, product_id null. Nicht raten, nur weil die Kategorie ähnlich ist.
- sure: true nur, wenn du dir bei der Zuordnung sicher bist; sonst false. Bei product_id null immer false.

Außerdem:
- total_cents: der bezahlte Gesamtbetrag (z. B. "SUMME", "ZU ZAHLEN"), sonst null.
- date: Kaufdatum als YYYY-MM-DD, sonst null.
Ist das Bild kein Kassenbon oder unlesbar, gib eine leere Liste zurück.`;

const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines', 'total_cents', 'date'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'quantity', 'unit_price_cents', 'product_id', 'sure'],
        properties: {
          text: { type: 'string' },
          quantity: { type: 'integer' },
          unit_price_cents: { type: 'integer' },
          product_id: nullable({ type: 'string' }),
          sure: { type: 'boolean' },
        },
      },
    },
    total_cents: nullable({ type: 'integer' }),
    date: nullable({ type: 'string', format: 'date' }),
  },
};

/** Eingabe der App prüfen. Gibt eine Fehlermeldung oder null zurück. */
export function checkRequest(body) {
  if (!body || typeof body !== 'object') return 'body';
  if (typeof body.image !== 'string' || !body.image || body.image.length > MAX_IMAGE_CHARS) return 'image';
  if (!/^[A-Za-z0-9+/]+=*$/.test(body.image)) return 'image';
  if (!MEDIA_TYPES.includes(body.media_type)) return 'media_type';
  return null;
}

/** Produktliste für den Prompt: eine Zeile je Produkt. */
export function productsText(products) {
  const rows = products.slice(0, MAX_PRODUCTS).map((p) => {
    const names = (p.receipt_names ?? []).join('; ');
    return `${p.id} | ${p.name} | ${p.category}${names ? ` | Bon: ${names}` : ''}`;
  });
  return `Produktliste des Haushalts (id | Name | Kategorie | bekannte Bon-Namen):\n${rows.join('\n') || '(leer)'}`;
}

const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Antwort der KI auf das zurückstutzen, was die App erwartet. */
export function cleanResult(raw, productIds) {
  const ids = new Set(productIds);
  const lines = (Array.isArray(raw?.lines) ? raw.lines : [])
    .slice(0, 200)
    .map((l) => {
      const productId = typeof l?.product_id === 'string' && ids.has(l.product_id) ? l.product_id : null;
      return {
        text: String(l?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        quantity: int(l?.quantity, 1, 999) ?? 1,
        unit_price_cents: int(l?.unit_price_cents, 1, 1_000_000),
        product_id: productId,
        sure: Boolean(productId && l?.sure === true),
      };
    })
    .filter((l) => l.text && l.unit_price_cents);
  const date = typeof raw?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null;
  return { lines, total_cents: int(raw?.total_cents, 1, 100_000_000), date };
}
