import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
// Use the edited rim as a brightness reference; retain original RGB detail and alpha.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const value of [1, 5, 10, 50, 100, 500]) {
    const original = (await readFile(`src/assets/coins/backup/coin-${value}.png`)).toString('base64');
    const edited = (await readFile(`tmp/coin-rim-prepared/coin-${value}.png`)).toString('base64');
    const result = await page.evaluate(async ({ original, edited }) => {
      const read = async source => {
        const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 192;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return { canvas, context, pixels: context.getImageData(0,0,192,192) };
      };
      const base = await read(original), reference = await read(edited);
      const data = base.pixels.data, ref = reference.pixels.data;
      const smooth = (value, start, end) => { const t = Math.max(0, Math.min(1, (value-start)/(end-start))); return t*t*(3-2*t); };
      let changed = 0;
      for (let y=0; y<192; y++) for (let x=0; x<192; x++) {
        const i=(y*192+x)*4, dx=(x-95.5)/96, dy=(y-95.5)/96;
        if (!data[i+3] || ref[i+3] < 200) continue;
        const weight=smooth(Math.hypot(dx,dy),.86,.97)*smooth(dy,0,.5);
        if (!weight) continue;
        const luminance = a => .2126*a[i]+.7152*a[i+1]+.0722*a[i+2];
        const lift=Math.min(65, Math.max(0,luminance(ref)-luminance(data)))*weight;
        for(let channel=0;channel<3;channel++) data[i+channel]=Math.min(255,Math.round(data[i+channel]+lift));
        if (lift>=1) changed++;
      }
      base.context.putImageData(base.pixels,0,0);
      return { png: base.canvas.toDataURL('image/png').split(',')[1], changed };
    }, { original, edited });
    if (!result.changed) throw new Error(`No rim change for ${value}`);
    await writeFile(`src/assets/coins/coin-${value}-v2.png`,Buffer.from(result.png,'base64'));
    console.log(`${value}: softened ${result.changed} rim pixels; original face and alpha preserved`);
  }
} finally { await browser.close(); }
