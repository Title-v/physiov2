import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmaLandmarkFilter } from '../../shared/ai/LandmarkFilters.js';

const point = (x, y, visibility = 0.99) => ({ x, y, z: 0, visibility });

test('EMA landmark filter passes the first frame through', () => {
  const filter = createEmaLandmarkFilter({ alpha: 0.5 });
  const frame = [point(0.1, 0.2), point(0.3, 0.4)];
  const smoothed = filter.smooth(frame);

  assert.notEqual(smoothed, frame);
  assert.deepEqual(smoothed, frame);
});

test('EMA landmark filter smooths subsequent visible frames', () => {
  const filter = createEmaLandmarkFilter({ alpha: 0.5 });
  filter.smooth([point(0, 0)]);
  const smoothed = filter.smooth([point(1, 1, 0.9)]);

  assert.equal(smoothed[0].x, 0.5);
  assert.equal(smoothed[0].y, 0.5);
  assert.equal(smoothed[0].visibility, 0.9);
});

test('EMA landmark filter reset clears previous state', () => {
  const filter = createEmaLandmarkFilter({ alpha: 0.5 });
  filter.smooth([point(0, 0)]);
  filter.smooth([point(1, 1)]);
  filter.reset();

  assert.deepEqual(filter.smooth([point(1, 1)]), [point(1, 1)]);
});

test('low-visibility frame does not poison the next visible smoothing baseline', () => {
  const filter = createEmaLandmarkFilter({ alpha: 0.5, minVisibility: 0.5 });
  filter.smooth([point(0, 0, 0.99)]);
  const lowVisibility = filter.smooth([point(1, 1, 0.1)]);
  const visibleAgain = filter.smooth([point(1, 1, 0.99)]);

  assert.equal(lowVisibility[0].x, 1);
  assert.equal(lowVisibility[0].visibility, 0.1);
  assert.equal(visibleAgain[0].x, 0.5);
  assert.equal(visibleAgain[0].y, 0.5);
});
