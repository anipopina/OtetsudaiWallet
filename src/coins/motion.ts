// Device axes are fixed to the device; canvas axes follow the screen rotation.
export function screenGravity(x: number | null, y: number | null, angle: number) {
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const radians = angle * Math.PI / 180;
  const gx = -x / 9.81, gy = y / 9.81;
  const rotated = { x: gx * Math.cos(radians) - gy * Math.sin(radians), y: gx * Math.sin(radians) + gy * Math.cos(radians) };
  const scale = Math.max(1, Math.hypot(rotated.x, rotated.y));
  return { x: rotated.x / scale, y: rotated.y / scale };
}
export function listenToMotion(setGravity: (x: number, y: number) => void, onActive: () => void) {
  let previous: { x: number; y: number } | null = null;
  const listener = (event: DeviceMotionEvent) => {
    if (document.hidden) return;
    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration) return;
    const legacyAngle = (window as Window & { orientation?: number }).orientation;
    const gravity = screenGravity(acceleration.x, acceleration.y, screen.orientation?.angle ?? legacyAngle ?? 0);
    if (!gravity) return;
    // Smooth sensor noise while keeping tilting responsive.
    previous = previous ? { x: previous.x + (gravity.x - previous.x) * .25, y: previous.y + (gravity.y - previous.y) * .25 } : gravity;
    setGravity(previous.x, previous.y); onActive();
  };
  window.addEventListener('devicemotion', listener);
  return () => window.removeEventListener('devicemotion', listener);
}

// Call directly from the opening button click: Safari requires user activation.
export function requestMotionAccess(): Promise<boolean> {
  if (!window.isSecureContext || typeof window.DeviceMotionEvent === 'undefined') return Promise.resolve(false);
  const motion = window.DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
  try {
    return motion.requestPermission ? motion.requestPermission().then(result => result === 'granted').catch(() => false) : Promise.resolve(true);
  } catch { return Promise.resolve(false); }
}
