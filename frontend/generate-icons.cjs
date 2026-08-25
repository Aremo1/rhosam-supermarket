// Generate PWA icons from SVG
// Run: node generate-icons.js

const fs = require('fs');
const path = require('path');

// RHoSAM green brand color
const GREEN = '#16a34a';
const DARK = '#15803d';
const WHITE = '#ffffff';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

function generateIconSVG(size) {
  const padding = Math.round(size * 0.15);
  const fontSize = Math.round(size * 0.35);
  const subSize = Math.round(size * 0.12);
  const cartSize = Math.round(size * 0.2);
  const centerY = size / 2;
  const cartY = centerY - cartSize * 0.3;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${GREEN};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${DARK};stop-opacity:1" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.2"/>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="url(#bg)"/>
  <!-- Shopping cart icon -->
  <g transform="translate(${size/2 - cartSize/2}, ${cartY})" fill="none" stroke="${WHITE}" stroke-width="${Math.max(2, Math.round(size * 0.025))}" stroke-linecap="round" stroke-linejoin="round" filter="url(#shadow)">
    <path d="M1 1h3l2.5 13h11L21 5H6"/>
    <circle cx="8" cy="19" r="2" fill="${WHITE}"/>
    <circle cx="17" cy="19" r="2" fill="${WHITE}"/>
  </g>
  <!-- Text -->
  <text x="${size/2}" y="${centerY + cartSize * 0.6}" font-family="Arial, sans-serif" font-weight="800" font-size="${fontSize}" fill="${WHITE}" text-anchor="middle" dominant-baseline="middle" filter="url(#shadow)">RS</text>
  <text x="${size/2}" y="${centerY + cartSize * 0.6 + fontSize * 0.9}" font-family="Arial, sans-serif" font-weight="600" font-size="${subSize}" fill="${WHITE}" text-anchor="middle" dominant-baseline="middle" opacity="0.9">POS</text>
</svg>`;
}

// Also generate screenshot placeholders (wide and narrow)
function generateScreenshotSVG(w, h, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#f3f6f9"/>
  <rect width="${w}" height="48" fill="${GREEN}"/>
  <text x="20" y="30" font-family="Arial" font-size="18" font-weight="700" fill="white">RHoSAM Supermarket POS</text>
  <rect x="20" y="60" width="${w - 40}" height="80" rx="8" fill="white" stroke="#e5e7eb"/>
  <text x="40" y="105" font-family="Arial" font-size="14" fill="#6b7280">${label}</text>
  <rect x="20" y="160" width="${(w - 60) / 2}" height="200" rx="8" fill="white" stroke="#e5e7eb"/>
  <rect x="${(w - 60) / 2 + 40}" y="160" width="${(w - 60) / 2}" height="200" rx="8" fill="white" stroke="#e5e7eb"/>
  <text x="${w/2}" y="${h - 30}" font-family="Arial" font-size="12" fill="#9ca3af" text-anchor="middle">RHoSAM Supermarket POS — PWA Screenshot</text>
</svg>`;
}

const iconsDir = path.join(__dirname, 'public', 'icons');

// Generate PNG icons (as SVG files that will be served)
for (const size of sizes) {
  const svg = generateIconSVG(size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}x${size}.svg`), svg);
  console.log(`Generated icon-${size}x${size}.svg`);
}

// Generate screenshot placeholders
const wideSvg = generateScreenshotSVG(1280, 720, 'Dashboard — Business Intelligence Overview');
const narrowSvg = generateScreenshotSVG(720, 1280, 'Point of Sale — Quick Checkout');
fs.writeFileSync(path.join(iconsDir, 'screenshot-wide.svg'), wideSvg);
fs.writeFileSync(path.join(iconsDir, 'screenshot-narrow.svg'), narrowSvg);
console.log('Generated screenshot placeholders');

console.log('\n✅ Icons generated! Note: For production, convert SVGs to PNG using:');
console.log('   npm install sharp && node convert-icons.js');
console.log('   Or use https://progressive-app.herokuapp.com/');
