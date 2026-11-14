export class HeatmapGrid {
  private cols = 48
  private rows = 36
  private grid = new Float32Array(this.cols * this.rows)
  private off: HTMLCanvasElement | null = null
  private octx: CanvasRenderingContext2D | null = null

  add(x: number, y: number, w: number, h: number, W: number, H: number) {
    const cx = (x + w / 2) / W * this.cols
    const cy = (y + h / 2) / H * this.rows
    const r = 2.2
    const ri = Math.ceil(r)
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
      const gx = Math.round(cx) + dx, gy = Math.round(cy) + dy
      if (gx < 0 || gx >= this.cols || gy < 0 || gy >= this.rows) continue
      const d2 = dx * dx + dy * dy
      if (d2 > r * r) continue
      const wgt = Math.exp(-d2 / (2 * 1.1 * 1.1))
      this.grid[gy * this.cols + gx] = Math.min(1, this.grid[gy * this.cols + gx] + wgt * 1.0)
    }
  }
  decay() { for (let i = 0; i < this.grid.length; i++) this.grid[i] *= 0.95 }
  private heatColor(t: number): [number, number, number] {
    const c = [
      [10, 30, 90], [0, 120, 200], [0, 200, 120], [180, 220, 0], [255, 90, 0], [255, 30, 30],
    ]
    const s = t * (c.length - 1)
    const i = Math.min(c.length - 2, Math.floor(s))
    const f = s - i
    const a = c[i], b = c[i + 1]
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  }
  draw(ctx: CanvasRenderingContext2D, W: number, H: number) {
    if (!this.off) {
      this.off = document.createElement('canvas')
      this.off.width = this.cols
      this.off.height = this.rows
      this.octx = this.off.getContext('2d')
    }
    const octx = this.octx
    if (!octx) return
    const img = octx.createImageData(this.cols, this.rows)
    for (let i = 0; i < this.grid.length; i++) {
      const v = this.grid[i]
      if (v < 0.01) { img.data[i * 4 + 3] = 0; continue }
      const [r, g, b] = this.heatColor(v)
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b
      img.data[i * 4 + 3] = Math.min(230, v * 255)
    }
    octx.putImageData(img, 0, 0)
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.85
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.off, 0, 0, W, H)
    ctx.restore()
  }
}
