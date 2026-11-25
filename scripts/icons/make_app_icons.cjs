// Builds the home-screen app icons in public/icons/ from Sam's hiking sketch (the path inside icon.svg).
// Look (Sam, 2026-11-26): dark green background (--bg in src/style.css), white linework, art filling most of the square.
// Run: node scripts/icons/make_app_icons.cjs   (needs Playwright, which is preinstalled in Claude's cloud sessions)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BG = '#133621'; // a touch richer than the app's --bg so it reads as green on the home screen
const LINE = '#ffffff';
const dir = path.join(__dirname, '../../public/icons');
const svgFile = path.join(dir, 'icon.svg');
const pathData = fs.readFileSync(svgFile, 'utf8').match(/<path[^>]* d="([^"]+)"/)[1];

// The sketch's outline box, in its own units (measured with getBBox).
const box = { x: 3.3, y: 13.1, w: 89.3, h: 69.75 };

/** An SVG 96 units square with the art centred and `fill` of the width used. */
function svg(fill) {
  const s = (96 * fill) / box.w;
  const tx = 48 - (box.x + box.w / 2) * s;
  const ty = 48 - (box.y + box.h / 2) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${BG}"/>` +
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})"><path fill="${LINE}" d="${pathData}"/></g></svg>`;
}

const main = svg(0.84); // was about 0.74 with ink on paper
const maskable = svg(0.62); // Android may crop to a circle, so keep inside the safe zone
const small = svg(0.9); // the browser tab icon is tiny, so use all the room

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  async function render(markup, size, name) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: false });
  }
  await render(main, 180, 'apple-touch-icon.png');
  await render(main, 192, 'icon-192.png');
  await render(main, 512, 'icon-512.png');
  await render(maskable, 512, 'icon-maskable-512.png');
  await render(small, 32, 'favicon-32.png');
  fs.writeFileSync(svgFile, main);
  await browser.close();
})();
