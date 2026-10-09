import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { createSimulation, denominations, settings } from '../src/coins/physics';
for (const balance of [0, 1, 5, 30, 1250, 1000000000000]) {
  const plan = denominations(balance);
  assert.equal(plan.types.reduce((sum, type) => sum + type.value, 0) + plan.omitted, balance);
  assert.ok(plan.types.length <= settings.maxCoins);
  const simulation = createSimulation(balance, 350, 450);
  for (let i = 0; i < 600; i++) simulation.step();
  for (const coin of simulation.coins) {
    assert.ok(Number.isFinite(coin.body.position.x));
    assert.ok(coin.body.position.x >= coin.radius - 3 && coin.body.position.x <= 350 - coin.radius + 3);
    assert.ok(coin.body.position.y >= coin.radius - 3 && coin.body.position.y <= 450 - coin.radius + 3);
    assert.equal(coin.body.collisionFilter.mask, coin.body.collisionFilter.category! | 1);
  }
  simulation.destroy();
}
const simulation = createSimulation(2, 350, 450);
const [coin, blocker] = simulation.coins;
Matter.Body.setPosition(coin.body, { x: 80, y: 80 });
Matter.Body.setPosition(blocker.body, { x: 80, y: 80 });
Matter.Body.setVelocity(coin.body, { x: 8, y: 0 });
coin.nextCheck = 0; blocker.nextCheck = Infinity;
simulation.step();
assert.equal(coin.layer, 0, 'occupied next layer blocks ascent');
Matter.Body.setPosition(blocker.body, { x: 280, y: 350 });
coin.nextCheck = 0;
simulation.step();
assert.equal(coin.layer, 1, 'fast coin ascends one layer');
assert.ok(coin.nextCheck >= settings.cooldown, 'layer change has cooldown');
Matter.Body.setVelocity(coin.body, { x: 0, y: 0 });
coin.nextCheck = 0;
simulation.step();
assert.equal(coin.layer, 0, 'slow coin descends into vacant lower layer');
simulation.destroy();
console.log('Coin totals, limits, stability, boundaries and layer transitions passed');

const { screenGravity } = await import('../src/coins/motion');
assert.deepEqual(screenGravity(0, 9.81, 0), { x: -0, y: 1 });
assert.equal(screenGravity(null, 0, 0), null);
assert.equal(screenGravity(NaN, 0, 0), null);
assert.ok(screenGravity(9.81, 0, 0)!.x < -.99);
assert.ok(screenGravity(0, 9.81, 90)!.x < -.99);
assert.ok(screenGravity(0, 9.81, 180)!.y < -.99);
assert.ok(screenGravity(0, 9.81, 270)!.x > .99);
assert.ok(Math.hypot(...Object.values(screenGravity(100, 100, 0)!)) <= 1.000001);
const gravitySimulation = createSimulation(1, 350, 450);
const falling = gravitySimulation.coins[0].body;
Matter.Body.setPosition(falling, { x: 175, y: 150 });
Matter.Body.setVelocity(falling, { x: 0, y: 0 });
for (let i = 0; i < 20; i++) gravitySimulation.step();
assert.ok(falling.position.y > 150, 'default gravity pulls down');
gravitySimulation.setGravity(-1, 0);
Matter.Body.setVelocity(falling, { x: 0, y: 0 });
for (let i = 0; i < 20; i++) gravitySimulation.step();
assert.ok(falling.position.x < 175, 'sensor gravity can pull sideways');
gravitySimulation.destroy();
console.log('Default gravity, sensor axes, screen rotation and acceleration limits passed');

for (const mode of [1, 2, 4] as const) {
  for (const balance of [0, 5, 30, 1250, 1000000000000]) {
    const plan = denominations(balance, mode);
    assert.equal(plan.types.reduce((sum, type) => sum + type.value, 0) + plan.omitted, balance);
    assert.ok(plan.types.length <= settings.maxCoins);
  }
}
assert.deepEqual(denominations(1250, 1).types.map(type => type.value), [500, 500, 100, 100, 50]);
assert.equal(denominations(1250, 2).types.length, 19);
assert.equal(denominations(1250, 4).types.length, 43);
// Compare the optimized count against a dynamic-programming minimum.
const minimum = [0];
for (let value = 1; value <= 2000; value++) {
  minimum[value] = 1 + Math.min(...[1, 5, 10, 50, 100, 500].filter(coin => coin <= value).map(coin => minimum[value - coin]));
  assert.equal(denominations(value, 1).types.length, minimum[value]);
}
console.log('Exchange modes preserve totals and mode 1 minimizes coin counts');

const settling = createSimulation(4, 350, 450);
settling.setGravity(0, 0);
for (const [index, coin] of settling.coins.entries()) {
  Matter.Body.setPosition(coin.body, { x: 70 + index * 70, y: 120 });
  Matter.Body.setVelocity(coin.body, { x: 1, y: 0 });
  coin.nextCheck = 0;
}
for (let frame = 0; frame < 60; frame++) settling.step();
assert.ok(settling.coins.every(coin => coin.layer === 0), 'gently moving coins settle through all layers to the bottom');
const bottomCoin = settling.coins[0];
Matter.Body.setVelocity(bottomCoin.body, { x: 5, y: 0 });
bottomCoin.nextCheck = 0;
settling.step();
assert.equal(bottomCoin.layer, 0, 'moderate motion keeps coins in the bottom layer');
settling.destroy();
console.log('Bottom-layer settling and resistance to unnecessary ascent passed');
