// Erzeugt die PNG-Icons aus einem SVG. Einmalig: node scripts/make-icons.mjs
import { chromium } from 'playwright';

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#34c759"/><stop offset="1" stop-color="#1fa347"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
    <rect x="136" y="96" width="240" height="320" rx="36" fill="#fff"/>
    <g stroke="#1fa347" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M176 176l20 20 36-40"/><path d="M256 180h80"/>
      <path d="M176 256l20 20 36-40"/><path d="M256 260h80"/>
    </g>
    <g stroke="#c7c7cc" stroke-width="22" stroke-linecap="round"><path d="M186 344h0"/><path d="M256 340h80"/></g>
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
