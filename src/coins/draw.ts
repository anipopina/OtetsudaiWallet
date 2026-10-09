import type { Coin } from './physics';
export function drawCoins(ctx: CanvasRenderingContext2D, coins: Coin[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  for (const coin of [...coins].sort((a, b) => a.layer - b.layer || a.body.id - b.body.id)) {
    const { body, radius: r, type, layer } = coin;
    ctx.save(); ctx.translate(body.position.x, body.position.y); ctx.rotate(body.angle);
    ctx.shadowColor = '#21140860'; ctx.shadowBlur = 3 + layer * 2; ctx.shadowOffsetY = 2 + layer;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = type.color; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = type.ink; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r - 3, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff90'; ctx.stroke();
    ctx.fillStyle = type.ink; ctx.font = `bold ${r * .72}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (type.value === 5 || type.value === 50) {
      ctx.fillText(String(type.value), 0, -r * .42);
      ctx.beginPath(); ctx.arc(0, r * .24, r * .2, 0, Math.PI * 2); ctx.fillStyle = '#564438'; ctx.fill(); ctx.strokeStyle = type.ink; ctx.stroke();
    } else ctx.fillText(String(type.value), 0, 1);
    ctx.restore();
  }
}
