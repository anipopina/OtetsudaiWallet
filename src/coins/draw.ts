import type { Coin } from './physics';
import coin1 from '../assets/coins/coin-1-v2.png';
import coin5 from '../assets/coins/coin-5-v2.png';
import coin10 from '../assets/coins/coin-10-v2.png';
import coin50 from '../assets/coins/coin-50-v2.png';
import coin100 from '../assets/coins/coin-100-v2.png';
import coin500 from '../assets/coins/coin-500-v2.png';
export type CoinImages = Map<number, HTMLImageElement>;
let loadedImages: Promise<CoinImages> | undefined;
export function loadCoinImages(): Promise<CoinImages> {
  return loadedImages ??= Promise.all([
    [1, coin1], [5, coin5], [10, coin10], [50, coin50], [100, coin100], [500, coin500],
  ].map(async ([value, url]) => {
    const image = new Image();
    image.src = String(url);
    await image.decode();
    return [Number(value), image] as const;
  })).then(entries => new Map(entries)).catch(error => { loadedImages = undefined; throw error; });
}
export function drawCoins(ctx: CanvasRenderingContext2D, coins: Coin[], width: number, height: number, images: CoinImages) {
  ctx.clearRect(0, 0, width, height);
  for (const coin of [...coins].sort((a, b) => a.layer - b.layer || a.body.id - b.body.id)) {
    const image = images.get(coin.type.value);
    if (!image) continue;
    const { body, radius: r, layer } = coin;
    ctx.save(); ctx.translate(body.position.x, body.position.y); ctx.rotate(body.angle);
    ctx.shadowColor = '#21140860'; ctx.shadowBlur = 3 + layer * 2; ctx.shadowOffsetY = 2 + layer;
    // Draw only the PNG: filling a disk underneath would hide the transparent 50 hole.
    ctx.drawImage(image, -r, -r, r * 2, r * 2);
    ctx.restore();
  }
}
