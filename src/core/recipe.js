// Zutaten aus eingefügtem Text (z. B. eine Antwort aus ChatGPT, Claude,
// einer Notiz oder einem Messenger): eine Zutat pro Zeile, Mengen,
// Aufzählungszeichen und Überschriften werden entfernt. Kein DOM, kein Netz.

import { cleanName, cleanIngredients } from './model.js';

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

// Überschriften, ab denen keine Zutaten mehr folgen (Zubereitungsschritte)
const STEPS_HEADING = /^(?:zubereitung|anleitung|so geht'?s|schritte|instructions|directions|method|preparation|steps|modo de prepara[çc][ãa]o|prepara[çc][ãa]o)\b/i;

/**
 * Zerlegt eingefügten Text in Zutaten ohne Mengen.
 * - eine Zutat pro Zeile; Aufzählungszeichen, Nummern, Kästchen, Markdown weg
 * - Zeilen mit Doppelpunkt am Ende gelten als Überschrift („Für die Soße:“)
 * - ab „Zubereitung“ / „Instructions“ / „Preparação“ wird abgebrochen
 * - lange Zeilen (Sätze) werden übersprungen
 */
export function ingredientsFromText(text) {
  const out = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    let line = rawLine.replace(/[*_`#>]+/g, ' ').trim(); // Markdown
    // Aufzählung, Kästchen, „1.“ – auch kombiniert wie „- [ ] …“
    for (let i = 0; i < 3; i++) line = line.replace(/^(?:[-–—•·▪◦✓✔☐☑]|\[[ xX]?\]|\d{1,2}[.)])\s*/u, '');
    if (!line) continue;
    if (STEPS_HEADING.test(line)) break;
    if (/:\s*$/.test(line)) continue; // Überschrift
    if (line.length > 80) continue; // eher ein Satz als eine Zutat
    line = ingredientName(line);
    if (line) out.push(line);
  }
  return cleanIngredients(out);
}
