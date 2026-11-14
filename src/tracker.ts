export interface TrackedDetection {
  class: string
  confidence: number
  box: { x: number; y: number; width: number; height: number }
  trackId: number
  dwellMs: number
}

export class CentroidTracker {
  private hist = new Map<number, { x: number; y: number; c: string; fs: number; ls: number }>()
  private next = 1
  update(dets: { class: string; confidence: number; box: { x: number; y: number; width: number; height: number } }[]): TrackedDetection[] {
    const now = Date.now()
    const u: TrackedDetection[] = []
    for (const d of dets) {
      const cx = d.box.x + d.box.width / 2, cy = d.box.y + d.box.height / 2
      let id: number | undefined, b = Infinity
      for (const [i, h] of this.hist) {
        if (h.c !== d.class) continue
        const dd = Math.hypot(h.x - cx, h.y - cy)
        if (dd < b && dd < 80) { b = dd; id = i }
      }
      if (!id) { id = this.next++; this.hist.set(id, { x: 0, y: 0, c: d.class, fs: now, ls: now }) }
      const h = this.hist.get(id)!
      h.x = cx; h.y = cy; h.ls = now
      u.push({ ...d, trackId: id, dwellMs: now - h.fs })
    }
    for (const [i, h] of this.hist) if (now - h.ls > 60000) this.hist.delete(i)
    return u
  }
  getStats() { const now = Date.now(); return Array.from(this.hist.entries()).map(([i, h]) => ({ id: i, c: h.c, dwellSec: Math.round((now - h.fs) / 1000) })) }
}
