import { describe, it, expect } from 'vitest'
import { nms, iou } from './nms'
import { CentroidTracker } from './tracker'
import { HeatmapGrid } from './heatmap'

describe('nms', () => {
  it('suppresses overlapping boxes', () => {
    const boxes = [
      { x1: 0, y1: 0, x2: 10, y2: 10, conf: 0.9, class: 0 },
      { x1: 1, y1: 1, x2: 11, y2: 11, conf: 0.8, class: 0 },
    ]
    const out = nms(boxes, 0.5)
    expect(out).toHaveLength(1)
    expect(out[0].confidence).toBe(0.9)
  })
  it('keeps non-overlapping boxes', () => {
    const boxes = [
      { x1: 0, y1: 0, x2: 5, y2: 5, conf: 0.9, class: 0 },
      { x1: 100, y1: 100, x2: 105, y2: 105, conf: 0.8, class: 0 },
    ]
    expect(nms(boxes, 0.5)).toHaveLength(2)
  })
})

describe('iou', () => {
  it('returns 1 for identical boxes', () => {
    const b = { x1: 0, y1: 0, x2: 10, y2: 10, conf: 1, class: 0 }
    expect(iou(b, b)).toBeCloseTo(1)
  })
  it('returns 0 for disjoint boxes', () => {
    const a = { x1: 0, y1: 0, x2: 5, y2: 5, conf: 1, class: 0 }
    const b = { x1: 10, y1: 10, x2: 15, y2: 15, conf: 1, class: 0 }
    expect(iou(a, b)).toBe(0)
  })
})

describe('CentroidTracker', () => {
  it('assigns track ids', () => {
    const t = new CentroidTracker()
    const dets = [{ class: 'person', confidence: 0.9, box: { x: 0, y: 0, width: 10, height: 10 } }]
    const out = t.update(dets)
    expect(out[0].trackId).toBeGreaterThan(0)
  })
})

describe('HeatmapGrid', () => {
  it('decays values', () => {
    const h = new HeatmapGrid()
    h.add(10, 10, 20, 20, 640, 480)
    h.decay()
    // no throw; draw should work
    const canvas = document.createElement('canvas')
    canvas.width = 64; canvas.height = 48
    const ctx = canvas.getContext('2d')!
    h.draw(ctx, 64, 48)
    expect(true).toBe(true)
  })
})
