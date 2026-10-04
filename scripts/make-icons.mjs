// Renders icons/icon-*.png from an inline SVG. Run: node scripts/make-icons.mjs
import { chromium } from 'playwright';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="#7048e8"/>
  <path d="M30 96 L84 42" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  <path d="M58 40 H86 V68" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="94" cy="94" r="14" fill="#ffd43b"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: `extension/icons/icon-${size}.png`, omitBackground: true });
}
await browser.close();
