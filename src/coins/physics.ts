import Matter from 'matter-js';
const { Bodies, Body, Composite, Engine, Constraint } = Matter;
export const settings = {
  layers: 4, variation: .1, riseSpeed: 6, fallSpeed: 1.5,
  checkInterval: 150, intervalVariation: .15, cooldown: 450, fallCooldown: 180, margin: 2, fallMargin: .5,
  gravity: { x: 0, y: 1, scale: .001 }, maxCoins: 180,
};
// Tune density with radius: larger coins gain mass gradually and settle more firmly.
export const coinTypes = [
  { value: 1, radius: 17, density: .0011, frictionAir: .022, friction: .11, frictionStatic: .28, restitution: .12, color: '#d9dedf', ink: '#536064' },
  { value: 5, radius: 19, density: .0024, frictionAir: .026, friction: .14, frictionStatic: .34, restitution: .11, color: '#d9bb60', ink: '#765b22' },
  { value: 10, radius: 21, density: .0025, frictionAir: .029, friction: .16, frictionStatic: .38, restitution: .1, color: '#bf805b', ink: '#633e29' },
  { value: 50, radius: 22, density: .0026, frictionAir: .031, friction: .18, frictionStatic: .42, restitution: .09, color: '#c5cdd0', ink: '#515c63' },
  { value: 100, radius: 24, density: .0027, frictionAir: .034, friction: .2, frictionStatic: .46, restitution: .08, color: '#dce1e5', ink: '#56616c' },
  { value: 500, radius: 26, density: .0028, frictionAir: .038, friction: .22, frictionStatic: .5, restitution: .065, color: '#d9ce9c', ink: '#71633c' },
];
export type Coin = { body: Matter.Body; type: typeof coinTypes[number]; radius: number; layer: number; nextCheck: number; interval: number };
const vary = (base: number, ratio = settings.variation) => base * (1 + (Math.random() * 2 - 1) * ratio);
const category = (layer: number) => 1 << (layer + 1);
export type ExchangeMode = 1 | 2 | 4;
export function denominations(balance: number, multiple: ExchangeMode = 4) {
  let remaining = Math.max(0, Math.floor(balance));
  const result: typeof coinTypes = [];
  // Prefer a handful of smaller coins over a single high denomination.
  for (const type of [...coinTypes].reverse()) {
    while (remaining >= type.value && result.length < settings.maxCoins) {
      if (type.value > 1 && remaining < type.value * multiple) break;
      result.push(type); remaining -= type.value;
    }
  }
  return { types: result, omitted: remaining };
}
export function createSimulation(balance: number, width: number, height: number, multiple: ExchangeMode = 4) {
  const engine = Engine.create();
  Object.assign(engine.gravity, settings.gravity);
  const plan = denominations(balance, multiple);
  const coins: Coin[] = [];
  let walls: Matter.Body[] = [];
  const drags = new Map<number, Matter.Constraint>();
  function resize(w: number, h: number) {
    width = w; height = h;
    release();
    for (const wall of walls) Composite.remove(engine.world, wall);
    const options = { isStatic: true, collisionFilter: { category: 1, mask: 0xffffffff } };
    walls = [Bodies.rectangle(w / 2, -40, w + 160, 80, options), Bodies.rectangle(w / 2, h + 40, w + 160, 80, options), Bodies.rectangle(-40, h / 2, 80, h + 160, options), Bodies.rectangle(w + 40, h / 2, 80, h + 160, options)];
    Composite.add(engine.world, walls);
    for (const coin of coins) Body.setPosition(coin.body, { x: Math.max(coin.radius, Math.min(w - coin.radius, coin.body.position.x)), y: Math.max(coin.radius, Math.min(h - coin.radius, coin.body.position.y)) });
  }
  resize(width, height);
  for (const type of plan.types) {
    const radius = vary(type.radius, .025);
    const layer = coins.length % settings.layers;
    let x = radius, y = radius;
    for (let attempt = 0; attempt < 100; attempt++) {
      x = radius + Math.random() * (width - radius * 2);
      y = radius + Math.random() * (height - radius * 2);
      if (!coins.some(c => c.layer === layer && Math.hypot(c.body.position.x - x, c.body.position.y - y) < c.radius + radius + settings.margin)) break;
    }
    const body = Bodies.circle(x, y, radius, {
      density: vary(type.density), frictionAir: vary(type.frictionAir), friction: vary(type.friction), frictionStatic: vary(type.frictionStatic), restitution: vary(type.restitution),
      collisionFilter: { category: category(layer), mask: category(layer) | 1 },
    });
    Body.setAngle(body, Math.random() * Math.PI * 2);
    Body.setVelocity(body, { x: vary(2, 1), y: vary(2, 1) });
    Body.setAngularVelocity(body, vary(.025, 1));
    coins.push({ body, type, radius, layer, nextCheck: Math.random() * settings.checkInterval, interval: vary(settings.checkInterval, settings.intervalVariation) });
    Composite.add(engine.world, body);
  }
  function release(pointerId?: number) {
    if (pointerId === undefined) {
      for (const constraint of drags.values()) Composite.remove(engine.world, constraint);
      drags.clear();
    } else {
      const constraint = drags.get(pointerId);
      if (constraint) Composite.remove(engine.world, constraint);
      drags.delete(pointerId);
    }
  }
  return {
    coins, omitted: plan.omitted, resize,
    setGravity(x: number, y: number) { engine.gravity.x = x; engine.gravity.y = y; },
    grab(point: Matter.Vector, pointerId = 0) {
      release(pointerId);
      const coin = [...coins].sort((a, b) => b.layer - a.layer || b.body.id - a.body.id).find(c => Math.hypot(point.x - c.body.position.x, point.y - c.body.position.y) <= c.radius);
      if (!coin || [...drags.values()].some(constraint => constraint.bodyB === coin.body)) return false;
      const drag = Constraint.create({ pointA: point, bodyB: coin.body, pointB: { x: point.x - coin.body.position.x, y: point.y - coin.body.position.y }, stiffness: .18, damping: .12, length: 0 });
      drags.set(pointerId, drag);
      Composite.add(engine.world, drag); return true;
    },
    move(point: Matter.Vector, pointerId = 0) { const drag = drags.get(pointerId); if (drag) drag.pointA = { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) }; },
    release,
    step() {
      Engine.update(engine, 1000 / 60);
      const now = engine.timing.timestamp;
      for (const coin of coins) {
        if (now < coin.nextCheck) continue;
        coin.nextCheck = now + coin.interval;
        const target = coin.body.speed > settings.riseSpeed ? coin.layer + 1 : coin.body.speed < settings.fallSpeed ? coin.layer - 1 : coin.layer;
        if (target < 0 || target >= settings.layers || target === coin.layer) continue;
        const descending = target < coin.layer;
        const margin = descending ? settings.fallMargin : settings.margin;
        if (coins.some(other => other !== coin && other.layer === target && Math.hypot(other.body.position.x - coin.body.position.x, other.body.position.y - coin.body.position.y) < other.radius + coin.radius + margin)) continue;
        coin.layer = target;
        coin.body.collisionFilter.category = category(target);
        coin.body.collisionFilter.mask = category(target) | 1;
        coin.nextCheck = now + (descending ? settings.fallCooldown : settings.cooldown);
      }
    },
    destroy() { release(); Composite.clear(engine.world, false); Engine.clear(engine); },
  };
}
