// Erzeugt die PNG-Icons aus einem SVG. Einmalig: node scripts/make-icons.mjs
import { chromium } from 'playwright';

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#24735a"/><stop offset="1" stop-color="#123a2d"/>
    </linearGradient>
    <radialGradient id="l" cx="0.3" cy="0.15" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <rect width="512" height="512" fill="url(#l)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})"
     fill="none" stroke="#f6f5f2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 196h212l-16 196a28 28 0 0 1-28 26H194a28 28 0 0 1-28-26z" stroke-width="20"/>
    <path d="M206 196v-22a50 50 0 0 1 100 0v22" stroke-width="20"/>
    <path d="M212 306l32 32 60-64" stroke-width="24"/>
  </g></svg>`;

const out = [
  ['public/icons/apple-touch-icon.png', 180, 0],
  ['public/icons/icon-192.png', 192, 0],
  ['public/icons/icon-512.png', 512, 0],
  ['public/icons/icon-maskable-512.png', 512, 60],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [file, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: false });
}
await browser.close();
