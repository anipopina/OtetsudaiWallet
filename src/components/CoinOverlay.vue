<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { createSimulation, settings, type ExchangeMode } from '../coins/physics';
import { drawCoins } from '../coins/draw';
import { listenToMotion } from '../coins/motion';
const props = defineProps<{ balance: number; unit: string; easy: boolean; motionPermission: Promise<boolean> }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const canvas = ref<HTMLCanvasElement>();
const omitted = ref(0);
const motionActive = ref(false);
const exchangeMode = ref<ExchangeMode>(1);
const coinCount = ref(0);
const modeLabel = computed(() => exchangeMode.value === 1 ? (props.easy ? 'いちばんすくない' : '最少枚数') : exchangeMode.value === 2 ? (props.easy ? 'すこしおおめ' : '少し多め') : (props.easy ? 'たくさん' : '多め'));
let exchange = () => {};
let disposed = false;
let cleanup = () => {};
onMounted(() => {
  const modal = dialog.value!, element = canvas.value!;
  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  modal.showModal();
  const ctx = element.getContext('2d')!;
  let width = element.clientWidth, height = element.clientHeight;
  let simulation = createSimulation(props.balance, width, height, exchangeMode.value);
  coinCount.value = simulation.coins.length;
  let gravity = { x: settings.gravity.x, y: settings.gravity.y };
  omitted.value = simulation.omitted;
  let stopMotion = () => {};
  void props.motionPermission.then(granted => {
    if (!granted || disposed) return;
    stopMotion = listenToMotion((x, y) => { gravity = { x, y }; simulation.setGravity(x, y); }, () => { motionActive.value = true; });
  });
  const resize = () => {
    width = element.clientWidth; height = element.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    simulation.resize(width, height);
  };
  const observer = new ResizeObserver(resize); observer.observe(element); resize();
  let pointer: number | null = null;
  exchange = () => {
    exchangeMode.value = exchangeMode.value === 4 ? 1 : exchangeMode.value === 1 ? 2 : 4;
    if (pointer !== null && element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
    pointer = null;
    simulation.destroy();
    simulation = createSimulation(props.balance, width, height, exchangeMode.value);
    simulation.setGravity(gravity.x, gravity.y);
    omitted.value = simulation.omitted;
    coinCount.value = simulation.coins.length;
  };
  const point = (event: PointerEvent) => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const down = (event: PointerEvent) => {
    if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (simulation.grab(point(event))) { pointer = event.pointerId; element.setPointerCapture(pointer); }
  };
  const move = (event: PointerEvent) => { if (pointer === event.pointerId) simulation.move(point(event)); };
  const up = (event: PointerEvent) => { if (pointer === event.pointerId) { simulation.release(); pointer = null; } };
  element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up); element.addEventListener('lostpointercapture', up);
  let frame = 0, last = 0, accumulator = 0;
  const tick = (time: number) => {
    if (!document.hidden) {
      accumulator += last ? Math.min(time - last, 50) : 0;
      while (accumulator >= 1000 / 60) { simulation.step(); accumulator -= 1000 / 60; }
      drawCoins(ctx, simulation.coins, width, height);
    }
    last = time; frame = requestAnimationFrame(tick);
  };
  const visibility = () => { simulation.release(); pointer = null; last = 0; accumulator = 0; };
  document.addEventListener('visibilitychange', visibility);
  frame = requestAnimationFrame(tick);
  cleanup = () => {
    disposed = true; stopMotion();
    cancelAnimationFrame(frame); observer.disconnect(); simulation.destroy();
    document.removeEventListener('visibilitychange', visibility);
    element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up); element.removeEventListener('lostpointercapture', up);
    modal.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus();
  };
});
onUnmounted(() => cleanup());
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="coin-dialog" aria-labelledby="coin-title" @cancel.prevent="emit('close')" @click="($event.target === dialog) && emit('close')">
      <div class="coin-dialog-header">
        <div><h2 id="coin-title">{{ easy ? 'コインをみる' : 'コインを見る' }}</h2></div>
        <button class="secondary coin-dialog-button" autofocus @click="emit('close')">{{ easy ? 'とじる' : '閉じる' }} ×</button>
      </div>
      <div class="coin-box">
        <div class="coin-box-caption">
          <p class="coin-amount">{{ balance.toLocaleString('ja-JP') }} <span>{{ unit }}</span></p>
          <p class="coin-instructions">コインをつかんで、うごかしてみよう！<template v-if="motionActive"><br />かたむけると、コインがうごくよ！</template></p>
        </div>
        <canvas ref="canvas" aria-label="つかんでうごかせるコイン" />
        <p v-if="balance === 0" class="coin-empty">まだコインがないよ。<br />おてつだいをして、ためてみよう！</p>
      </div>
      <div class="coin-exchange">
        <button class="secondary coin-dialog-button" :disabled="balance === 0" @click="exchange">{{ easy ? 'りょうがえ' : '両替' }}</button>
        <span role="status">{{ modeLabel }} · {{ coinCount }}{{ easy ? 'まい' : '枚' }}</span>
      </div>
      <p v-if="omitted" class="coin-help">{{ easy ? 'コインがたくさんあるので、いちぶをみせているよ。' : 'コインがたくさんあるため、一部を表示しています。' }}</p>
    </dialog>
  </Teleport>
</template>
<style scoped>
.coin-dialog { width: min(680px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); margin: auto; padding: 20px; border: 0; border-radius: 22px; background: #fffaf0; color: #294537; overflow: auto; box-sizing: border-box; }
.coin-dialog-button { margin-top: 0; }
.coin-dialog::backdrop { background: #10241caa; }
.coin-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { margin: 0; font-size: 22px; } button { min-height: 44px; flex-shrink: 0; }
.coin-exchange { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 14px; font-size: 13px; }
.coin-help { font-size: 13px; margin: 20px 0 16px; }
.coin-box { position: relative; border-radius: 16px; overflow: hidden; margin-top: 16px; background: #eee3cd; box-shadow: inset 0 0 20px #9e896030; }
.coin-box-caption { position: absolute; inset: 20px 20px auto; pointer-events: none; color: #385442; }
.coin-amount { margin: 0; font-size: clamp(32px, 8vw, 48px); font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.coin-amount span { font-size: .5em; }
.coin-instructions { margin: 12px 0 0; font-size: 13px; line-height: 1.6; }
canvas { position: relative; display: block; width: 100%; height: clamp(220px, calc(100dvh - 220px), 640px); touch-action: none; cursor: grab; } canvas:active { cursor: grabbing; }
.coin-empty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: #294537; pointer-events: none; }
@media(max-width: 480px) { .coin-dialog { padding: 20px; } h2 { font-size: 19px; } }
</style>
