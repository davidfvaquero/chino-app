/**
 * Tests for src/extras/draw.js — pure logic only (no DOM).
 * Run: node --test tests/draw-ui.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// We'll test the exported pure functions by importing the module.
// Since the module has DOM dependencies, we test the pure functions
// that are explicitly exported for testing.

// Mock canvas for testing
function createMockCanvas(width = 300, height = 300) {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height };
    },
    style: {},
  };
}

// Mock pointer event
function createPointerEvent(clientX, clientY) {
  return { clientX, clientY, pointerId: 1, button: 0 };
}

describe('draw.js — pure functions', () => {
  let drawModule;

  before(async () => {
    // Import the module - this will load the ES module
    drawModule = await import('../src/extras/draw.js');
  });

  describe('collectPoint', () => {
    it('converts client coords to canvas-relative coords', () => {
      const canvas = createMockCanvas(300, 300);
      const event = createPointerEvent(150, 100);
      const pt = drawModule.collectPoint(event, canvas);
      assert.deepEqual(pt, { x: 150, y: 100 });
    });

    it('handles offset canvas position', () => {
      const canvas = createMockCanvas(300, 300);
      canvas.getBoundingClientRect = () => ({ left: 50, top: 30, width: 300, height: 300 });
      const event = createPointerEvent(200, 180);
      const pt = drawModule.collectPoint(event, canvas);
      assert.deepEqual(pt, { x: 150, y: 150 });
    });
  });

  describe('normaliseStroke', () => {
    it('normalises points to 0..1 box with y DOWN (same as the screen)', () => {
      const canvas = createMockCanvas(300, 300);
      const points = [
        { x: 0, y: 0 },      // top-left -> (0, 0)
        { x: 300, y: 300 },  // bottom-right -> (1, 1)
        { x: 150, y: 150 },  // center -> (0.5, 0.5)
      ];
      const norm = drawModule.normaliseStroke(points, canvas);
      assert.deepEqual(norm[0], [0, 0]);
      assert.deepEqual(norm[1], [1, 1]);
      assert.deepEqual(norm[2], [0.5, 0.5]);
    });

    it('handles single point', () => {
      const canvas = createMockCanvas(200, 200);
      const points = [{ x: 100, y: 100 }];
      const norm = drawModule.normaliseStroke(points, canvas);
      assert.deepEqual(norm, [[0.5, 0.5]]);
    });

    it('returns empty array for empty input', () => {
      const canvas = createMockCanvas(100, 100);
      const norm = drawModule.normaliseStroke([], canvas);
      assert.deepEqual(norm, []);
    });
  });

  describe('prepareForMatch', () => {
    it('filters empty strokes and resamples', () => {
      const strokes = [
        [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]],  // valid stroke
        [],                                       // empty stroke (filtered)
        [[0.5, 0.5], [0.6, 0.6]],                // valid stroke
      ];
      const prepared = drawModule.prepareForMatch(strokes);
      assert.equal(prepared.length, 2);
      // Each stroke should be resampled to N_POINTS (16) points = 32 values
      assert.equal(prepared[0].length, 32);
      assert.equal(prepared[1].length, 32);
    });

    it('returns empty array for all empty strokes', () => {
      const prepared = drawModule.prepareForMatch([[], []]);
      assert.deepEqual(prepared, []);
    });
  });

  describe('fireDrawUsed', () => {
    it('dispatches chino:draw_used on globalThis', () => {
      // In browser, globalThis has addEventListener. In Node, we simulate.
      const originalGlobalThis = globalThis;
      const events = new Map();
      const mockGlobal = {
        addEventListener(type, handler) {
          if (!events.has(type)) events.set(type, []);
          events.get(type).push(handler);
        },
        removeEventListener(type, handler) {
          if (!events.has(type)) return;
          const idx = events.get(type).indexOf(handler);
          if (idx >= 0) events.get(type).splice(idx, 1);
        },
        dispatchEvent(event) {
          const handlers = events.get(event.type) || [];
          for (const h of handlers) h(event);
          return true;
        },
      };
      // Temporarily replace globalThis for this test
      Object.defineProperty(global, 'globalThis', { value: mockGlobal, configurable: true });
      try {
        let fired = false;
        const handler = () => { fired = true; };
        globalThis.addEventListener('chino:draw_used', handler);
        drawModule.fireDrawUsed();
        assert.equal(fired, true);
      } finally {
        Object.defineProperty(global, 'globalThis', { value: originalGlobalThis, configurable: true });
      }
    });
  });
});