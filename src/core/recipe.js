// Rezept-Import: liest aus den eingebetteten Rezeptdaten einer Webseite
// (schema.org/Recipe als JSON-LD) Name und Zutaten und entfernt die Mengen.
// Kein DOM, kein Netz: Die Edge Function `recipe-import` liefert nur die
// Inhalte der <script type="application/ld+json">-Blöcke.
//
// Format: https://schema.org/Recipe, von Rezeptseiten für Google genutzt
// (https://developers.google.com/search/docs/appearance/structured-data/recipe).

import { cleanName, cleanIngredients } from './model.js';

function isRecipe(node) {
  const type = node?.['@type'];
  return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
}

/** Sucht das erste Recipe-Objekt (auch in Arrays und @graph). */
function findRecipeNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findRecipeNode(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipe(node)) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findRecipeNode(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Mengenangaben am Anfang: Zahlen, Brüche, Bereiche, „ca.“
const NUMBER = String.raw`(?:ca\.?\s*|etwa\s*|approx\.?\s*|about\s*)?(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*[½⅓⅔¼¾⅛])?|[½⅓⅔¼¾⅛])(?:\s*(?:-|–|bis|to|a)\s*(?:\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[½⅓⅔¼¾]))?`;

// Einheiten (de, en, pt). Längere Formen zuerst, sonst trifft „g“ vor „gramm“.
const UNITS = [
  // Deutsch
  'Esslöffel', 'Teelöffel', 'Messerspitzen?', 'Msp\\.?', 'EL', 'TL', 'Prisen?', 'Päckchen', 'Pckg?\\.?', 'Pck\\.?', 'Packungen?',
  'Dosen?', 'Gläser', 'Glas', 'Becher', 'Bund', 'Stücke?', 'Stk\\.?', 'Scheiben?', 'Zehen?', 'Tassen?', 'Handvoll',
  'Spritzer', 'Schuss', 'Zweige?', 'Blätter', 'Blatt', 'Würfel', 'Beutel', 'Flaschen?', 'Tüten?', 'Kopf', 'Köpfe',
  'Kilogramm', 'Gramm', 'Liter', 'Milliliter', 'kg', 'g', 'ml', 'cl', 'dl', 'l',
  // Englisch
  'tablespoons?', 'teaspoons?', 'tbsps?\\.?', 'tsps?\\.?', 'cups?', 'ounces?', 'oz\\.?', 'pounds?', 'lbs?\\.?', 'grams?',
  'kilograms?', 'litres?', 'liters?', 'millilitres?', 'milliliters?', 'pinch(?:es)?', 'cloves?', 'cans?', 'tins?',
  'slices?', 'handfuls?', 'sprigs?', 'bunch(?:es)?', 'packs?', 'packets?', 'pieces?', 'sticks?', 'heads?', 'large', 'medium', 'small',
  // Portugiesisch
  'colheres? de sopa', 'colheres? de chá', 'colheres? de sobremesa', 'colheres?', 'chávenas?', 'copos?', 'latas?',
  'pitadas?', 'dentes?', 'fatias?', 'molhos?', 'raminhos?', 'embalagens?', 'pacotes?', 'q\\.b\\.?',
];
const UNIT = `(?:${UNITS.join('|')})`;
const LEADING = new RegExp(String.raw`^(?:${NUMBER}\s*(?:${UNIT}(?![\p{L}]))?\.?\s*|${UNIT}(?![\p{L}])\.?\s+(?=\p{L}))`, 'iu');
const OF = /^(?:of|de|da|do|das|dos)\s+/i;
const VAGUE_START = /^(?:etwas|einige|wenig|some|a few|a little|um pouco de|algumas?|alguns)\s+/i;
const VAGUE_END = /\s+(?:q\.?\s?b\.?|to taste|as needed|nach (?:Geschmack|Belieben|Bedarf)|zum Abschmecken|a gosto)\.?$/i;

/**
 * Zutat ohne Menge: „500 g Hackfleisch, gemischt“ → „Hackfleisch“,
 * „1 Zwiebel(n)“ → „Zwiebel“, „2 cups flour“ → „Flour“,
 * „200 g de farinha“ → „Farinha“. Liefert '' für reine Hinweise.
 */
export function ingredientName(line) {
  let s = cleanName(decodeEntities(line).replace(/<[^>]*>/g, ' '));
  s = s.replace(/^[-•*–]\s*/, '');
  // Mengen und Einheiten am Anfang entfernen (auch „1 (400 g) Dose …“)
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(LEADING, '').replace(/^\([^)]*\)\s*/, '').replace(OF, '').replace(VAGUE_START, '');
    if (s === before) break;
  }
  // Pluralendungen in Klammern (Chefkoch: „Zwiebel(n)“, „Ei(er)“)
  s = s.replace(/\((?:n|en|e|er|s|es|r)\)/gi, '');
  // Zusätze nach Komma oder in Klammern: „Hackfleisch, gemischt“, „Mehl (Type 405)“
  s = s.split(/\s*[,;]\s*|\s+\(/)[0];
  s = s.replace(/\)$/, '').replace(VAGUE_END, '');
  s = cleanName(s);
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Aus den JSON-LD-Blöcken einer Seite: { name, ingredients } oder null, wenn
 * keine Rezeptdaten gefunden wurden. `ingredients` ohne Mengen und ohne
 * Doppelte; `raw` enthält die Originalzeilen zur Kontrolle.
 */
export function recipeFromJsonLd(blocks) {
  for (const text of blocks ?? []) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      continue; // manche Seiten haben fehlerhafte Blöcke; die übrigen prüfen
    }
    const node = findRecipeNode(data);
    if (!node) continue;
    let lines = node.recipeIngredient ?? node.ingredients ?? [];
    if (!Array.isArray(lines)) lines = [lines];
    const raw = lines.filter((x) => typeof x === 'string').map((x) => cleanName(decodeEntities(x)));
    const name = cleanName(decodeEntities(typeof node.name === 'string' ? node.name : '')).slice(0, 80).trim();
    return { name, ingredients: cleanIngredients(raw.map(ingredientName)), raw };
  }
  return null;
}
