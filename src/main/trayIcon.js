'use strict';
// Draws a tiny clock (hands at 10:10) as a macOS template image, so it
// adapts to light/dark menu bars without shipping an image file.
const { nativeImage } = require('electron');

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function createTrayIcon() {
  const S = 36; // 18pt @2x
  const c = S / 2;
  const R = S / 2 - 2;
  const ring = 3.4;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const hand = (deg, len) => [c, c, c + Math.sin(toRad(deg)) * len, c - Math.cos(toRad(deg)) * len];
  const hands = [hand(60, R * 0.62), hand(-60, R * 0.45)];
  const SUB = 4;
  const buf = Buffer.alloc(S * S * 4);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hits = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const px = x + (sx + 0.5) / SUB;
          const py = y + (sy + 0.5) / SUB;
          const d = Math.hypot(px - c, py - c);
          if ((d <= R && d >= R - ring) || d <= 2.4 || hands.some((h) => segDist(px, py, ...h) <= 1.5)) hits++;
        }
      }
      const i = (y * S + x) * 4;
      buf[i + 3] = Math.round((hits / (SUB * SUB)) * 255); // BGRA, black with alpha
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

module.exports = { createTrayIcon };
