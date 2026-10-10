import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
function compressPng(buffer) {
  const chunks = []; const imageData = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const chunk = buffer.subarray(offset, offset + length + 12);
    if (chunk.toString('ascii', 4, 8) === 'IDAT') imageData.push(chunk.subarray(8, 8 + length));
    else chunks.push(chunk);
    offset += length + 12;
  }
  const data = deflateSync(inflateSync(Buffer.concat(imageData)), { level: 9 });
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write('IDAT', 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([buffer.subarray(0, 8), ...chunks.slice(0, -1), chunk, chunks.at(-1)]);
}
// Optional input/output directories allow preparing edited variants without touching originals.
const inputDirectory = process.argv[2] ?? 'tmp';
const outputDirectory = process.argv[3] ?? 'src/assets/coins';
const values = [1, 5, 10, 50, 100, 500];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await mkdir(outputDirectory, { recursive: true });
  for (const value of values) {
    const source = (await readFile(`${inputDirectory}/coin-${value}.png`)).toString('base64');
    const result = await page.evaluate(async ({ source, value }) => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = pixels;
      // Sample solid silhouettes row by row, ignoring low-alpha dust and isolated pixels.
      const rows = [];
      for (let y = 0; y < height; y++) {
        let left = width, right = -1;
        for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 200) { left = Math.min(left, x); right = x; }
        if (right - left > width * .3) rows.push({ y, left, right });
      }
      const widest = Math.max(...rows.map(row => row.right - row.left));
      const middleRows = rows.filter(row => row.right - row.left > widest * .985);
      const cx = middleRows.reduce((sum, row) => sum + (row.left + row.right) / 2, 0) / middleRows.length;
      const cy = middleRows.reduce((sum, row) => sum + row.y, 0) / middleRows.length;
      // Fit the circle to robust per-row silhouette edges. This independently measures each coin.
      const edges = rows.filter(row => Math.abs(row.y - cy) < widest * .4);
      const radii = edges.flatMap(row => [Math.hypot(row.left - cx, row.y - cy), Math.hypot(row.right - cx, row.y - cy)]).sort((a,b) => a-b);
      const radius = radii[Math.floor(radii.length / 2)];
      let hole = null;
      if (value === 50) {
        const centerY = Math.round(cy), centerX = Math.round(cx);
        let left = centerX, right = centerX, top = centerY, bottom = centerY;
        while (left > 0 && data[(centerY * width + left - 1) * 4 + 3] < 128) left--;
        while (right < width - 1 && data[(centerY * width + right + 1) * 4 + 3] < 128) right++;
        while (top > 0 && data[((top - 1) * width + centerX) * 4 + 3] < 128) top--;
        while (bottom < height - 1 && data[((bottom + 1) * width + centerX) * 4 + 3] < 128) bottom++;
        hole = { x: (left + right) / 2, y: (top + bottom) / 2, radius: ((right-left) + (bottom-top)) / 4 };
        if (hole.radius < radius * .05 || hole.radius > radius * .3) throw new Error('Invalid 50 coin hole');
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const outer = Math.max(0, Math.min(1, radius + .5 - Math.hypot(x - cx, y - cy)));
        const inner = hole ? Math.max(0, Math.min(1, Math.hypot(x - hole.x, y - hole.y) - hole.radius + .5)) : 1;
        data[i + 3] = Math.round(255 * outer * inner);
        if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0;
      }
      context.putImageData(pixels, 0, 0);
      // 192px comfortably exceeds the 52px maximum coin diameter at DPR 2.
      const output = document.createElement('canvas'); output.width = output.height = 192;
      const target = output.getContext('2d'); target.imageSmoothingQuality = 'high';
      const diameter = radius * 2;
      target.drawImage(canvas, cx - radius, cy - radius, diameter, diameter, 0, 0, 192, 192);
      return { png: output.toDataURL('image/png').split(',')[1], measurement: { value, width, height, cx, cy, radius, hole } };
    }, { source, value });
    await writeFile(`${outputDirectory}/coin-${value}.png`, compressPng(Buffer.from(result.png, 'base64')));
    console.log(JSON.stringify(result.measurement));
  }
} finally { await browser.close(); }
