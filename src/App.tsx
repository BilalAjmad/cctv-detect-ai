import { useState, useRef, useEffect } from 'react'
import type { Zone, Alert, Detection } from './types'
import { CentroidTracker } from './tracker'
import { HeatmapGrid } from './heatmap'

const THERMAL_LUT: [number, number, number][] = (() => {
  const lut: [number, number, number][] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r = 0, g = 0, b = 0
    if (t < 0.14) { r = 0; g = 0; b = 0.3 + t * 3.5 }
    else if (t < 0.28) { r = 0; g = (t - 0.14) * 7.1; b = 0.8 + (t - 0.14) * 1.4 }
    else if (t < 0.42) { r = 0; g = 0.5 + (t - 0.28) * 3.6; b = 1.0 - (t - 0.28) * 7.1 }
    else if (t < 0.57) { r = (t - 0.42) * 6.7; g = 1.0; b = 0 }
    else if (t < 0.71) { r = 1.0; g = 1.0 - (t - 0.57) * 7.1; b = 0 }
    else if (t < 0.85) { r = 1.0; g = (t - 0.71) * 1.4; b = 0 }
    else { r = 1.0; g = 0.2 + (t - 0.85) * 5.3; b = 0.2 + (t - 0.85) * 5.3 }
    lut.push([Math.min(255, r * 255) | 0, Math.min(255, g * 255) | 0, Math.min(255, b * 255) | 0])
  }
  return lut
})()

let _prevThermal: Uint8ClampedArray | null = null
function applyThermal(imgData: ImageData): void {
  const d = imgData.data
  const W = imgData.width, H = imgData.height
  const cur = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i++) cur[i] = d[i]
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    let motion = 0
    if (_prevThermal) {
      motion = (Math.abs(d[i] - _prevThermal[i]) + Math.abs(d[i+1] - _prevThermal[i+1]) + Math.abs(d[i+2] - _prevThermal[i+2])) / (3 * 255)
    }
    // boost luminance where motion detected (live heat/activity)
    const boost = Math.min(1, lum / 255 + motion * 1.6)
    const idx = Math.min(255, (boost * 255) | 0)
    const [r, g, b] = THERMAL_LUT[idx]
    const px = (i >> 2) % W, py = (i >> 2) / W | 0
    const vx = px / W - 0.5, vy = py / H - 0.5
    const vig = 1.0 - Math.sqrt(vx * vx + vy * vy) * 0.7
    const v = vig < 0.3 ? 0.3 : vig
    d[i] = (r * v) | 0
    d[i + 1] = (g * v) | 0
    d[i + 2] = (b * v) | 0
  }
  _prevThermal = cur
}

type WorkerMsg =
  | { type: 'init' }
  | { type: 'predict'; payload: { imageData: ImageData; conf: number; iou: number } }
  | { type: 'ready' }
  | { type: 'result'; payload: Detection[] }
  | { type: 'error'; payload: string }

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<HTMLDivElement>(null)
  const [camOn, setCamOn] = useState(false)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [fps, setFps] = useState(0)
  const [dets, setDets] = useState<Detection[]>([])
  const [ms, setMs] = useState(0)
  const [conf, setConf] = useState(0.35)
  const [iou, setIou] = useState(0.45)
  const [hm, setHm] = useState(false)
  const [therm, setTherm] = useState(false)
  const [fl, setFl] = useState(false)
  const [recording, setRecording] = useState(false)
  const [zones, setZones] = useState<Zone[]>([])
  const [drawing, setDrawing] = useState<Zone | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])

  const trackerRef = useRef(new CentroidTracker())
  const heatRef = useRef(new HeatmapGrid())
  const fcRef = useRef(0)
  const tfRef = useRef(performance.now())
  const lastDetsRef = useRef<Detection[]>([])
  const rafRef = useRef(0)
  const inferBusyRef = useRef(false)
  const lastFrameRef = useRef<Uint8ClampedArray | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const flRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const lineSideRef = useRef<Map<string, number>>(new Map())
  const loiterAlertedRef = useRef<Set<string>>(new Set())
  const hmRef = useRef(hm)
  const confRef = useRef(conf)
  const iouRef = useRef(iou)
  const zonesRef = useRef(zones)

  useEffect(() => {
    let cancelled = false
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        if (!cancelled) setReady(true)
      } else if (msg.type === 'result') {
        if (!cancelled) {
          const dt = performance.now() - (window as unknown as { __t0: number }).__t0
          setMs(dt)
          const tracked = trackerRef.current.update(
            msg.payload.filter(d => d.confidence >= confRef.current).map(d => ({ class: d.class, confidence: d.confidence, box: d.box }))
          )
          lastDetsRef.current = tracked
          setDets(tracked)
          if (hmRef.current) for (const d of tracked) heatRef.current?.add(d.box.x, d.box.y, d.box.width, d.box.height, 640, 480)

          const newAlerts: Alert[] = []
          for (const z of zonesRef.current) {
            if (!z.enabled) continue
            if (z.type === 'intrusion' && z.points.length >= 3) {
              for (const d of tracked) {
                const cx = d.box.x + d.box.width / 2, cy = d.box.y + d.box.height / 2
                let inz = false
                for (let i = 0, j = z.points.length - 1; i < z.points.length; j = i++) {
                  const pi = z.points[i], pj = z.points[j]
                  if (((pi.y > cy) !== (pj.y > cy)) && (cx < (pj.x - pi.x) * (cy - pi.y) / (pj.y - pi.y) + pi.x)) inz = !inz
                }
                if (inz) {
                  const aid = `alert-${z.id}-${d.trackId}`
                  newAlerts.push({ id: aid, message: `${z.name}: ${d.class} entered`, severity: 'critical', time: Date.now() })
                }
              }
            } else if (z.type === 'line' && z.points.length >= 2) {
              const [a, b] = z.points
              for (const d of tracked) {
                const cx = d.box.x + d.box.width / 2, cy = d.box.y + d.box.height / 2
                const side = Math.sign((b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x))
                const key = `${z.id}-${d.trackId}`
                const prev = lineSideRef.current.get(key)
                if (prev !== undefined && prev !== 0 && side !== 0 && prev !== side) {
                  const aid = `line-${z.id}-${d.trackId}-${Date.now()}`
                  newAlerts.push({ id: aid, message: `${z.name}: ${d.class} crossed line`, severity: 'warn', time: Date.now() })
                }
                if (side !== 0) lineSideRef.current.set(key, side)
              }
            } else if (z.type === 'loiter' && z.points.length >= 3) {
              for (const d of tracked) {
                const cx = d.box.x + d.box.width / 2, cy = d.box.y + d.box.height / 2
                let inz = false
                for (let i = 0, j = z.points.length - 1; i < z.points.length; j = i++) {
                  const pi = z.points[i], pj = z.points[j]
                  if (((pi.y > cy) !== (pj.y > cy)) && (cx < (pj.x - pi.x) * (cy - pi.y) / (pj.y - pi.y) + pi.x)) inz = !inz
                }
                if (inz && d.dwellMs > 10000) {
                  const key = `${z.id}-${d.trackId}`
                  if (!loiterAlertedRef.current.has(key)) {
                    loiterAlertedRef.current.add(key)
                    newAlerts.push({ id: `loiter-${key}`, message: `${z.name}: ${d.class} loitering`, severity: 'warn', time: Date.now() })
                  }
                }
              }
            } else if (z.type === 'crowd' && z.points.length >= 3) {
              let count = 0
              for (const d of tracked) {
                const cx = d.box.x + d.box.width / 2, cy = d.box.y + d.box.height / 2
                let inz = false
                for (let i = 0, j = z.points.length - 1; i < z.points.length; j = i++) {
                  const pi = z.points[i], pj = z.points[j]
                  if (((pi.y > cy) !== (pj.y > cy)) && (cx < (pj.x - pi.x) * (cy - pi.y) / (pj.y - pi.y) + pi.x)) inz = !inz
                }
                if (inz) count++
              }
              if (count >= 5) {
                const aid = `crowd-${z.id}-${Math.floor(Date.now() / 5000)}`
                newAlerts.push({ id: aid, message: `${z.name}: crowd (${count})`, severity: 'critical', time: Date.now() })
              }
            }
          }
          if (newAlerts.length) {
            setAlerts(prev => {
              const ids = new Set(prev.map(a => a.id))
              const merged = [...prev]
              for (const a of newAlerts) if (!ids.has(a.id)) { merged.push(a); ids.add(a.id) }
              return merged.slice(-20)
            })
          }
        }
        inferBusyRef.current = false
      } else if (msg.type === 'error') {
        if (!cancelled) setErr(msg.payload)
        inferBusyRef.current = false
      }
    }
    worker.postMessage({ type: 'init' })
    return () => {
      cancelled = true
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const startCam = async () => {
    try {
      setErr('')
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      if (videoRef.current) {
        videoRef.current.srcObject = s
        await videoRef.current.play()
        setCamOn(true)
      }
    } catch (e) { setErr((e as Error).message) }
  }

  const stopCam = () => {
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOn(false)
    lastDetsRef.current = []
    setDets([])
    inferBusyRef.current = false
    lastFrameRef.current = null
  }

  const startRec = () => {
    const canvas = canvasRef.current
    if (!canvas || !camOn) return
    chunksRef.current = []
    const c = canvas as unknown as { captureStream?: (fps: number) => MediaStream }
    const stream = c.captureStream ? c.captureStream(12) : null
    if (!stream) { setErr('Recording not supported'); return }
    let mr: MediaRecorder
    try {
      mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 400000 })
    } catch {
      try { mr = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 400000 }) } catch { setErr('Recording not supported'); return }
    }
    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'cctv-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    mediaRecorderRef.current = mr
    mr.start(1000)
    setRecording(true)
  }
  const stopRec = () => {
    const mr = mediaRecorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }

  useEffect(() => {
    if (!camOn || !ready) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (cancelled || !workerRef.current || !videoRef.current) return
      const v = videoRef.current
      if (v.readyState < 2) { timer = setTimeout(run, 300); return }
      if (document.hidden) { timer = setTimeout(run, 1200); return }
      if (inferBusyRef.current) { timer = setTimeout(run, 200); return }
      inferBusyRef.current = true
      try {
        const sc = document.createElement('canvas'); sc.width = 32; sc.height = 24
        const sctx = sc.getContext('2d')!
        sctx.drawImage(v, 0, 0, 32, 24)
        const cur = sctx.getImageData(0, 0, 32, 24).data
        let diff = 0
        if (lastFrameRef.current) {
          const prev = lastFrameRef.current
          let sum = 0
          for (let i = 0; i < cur.length; i += 4) sum += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1]) + Math.abs(cur[i + 2] - prev[i + 2])
          diff = sum / ((cur.length / 4) * 3)
        }
        lastFrameRef.current = new Uint8ClampedArray(cur)
        if (diff < 4 && lastDetsRef.current.length > 0) {
          inferBusyRef.current = false
          if (!cancelled) timer = setTimeout(run, 1200)
          return
        }
      } catch { /* ignore */ }

      const off = document.createElement('canvas')
      off.width = v.videoWidth || 640
      off.height = v.videoHeight || 480
      const octx = off.getContext('2d')!
      octx.drawImage(v, 0, 0)
      const imgData = octx.getImageData(0, 0, off.width, off.height)
      ;(window as unknown as { __t0: number }).__t0 = performance.now()
      workerRef.current.postMessage({ type: 'predict', payload: { imageData: imgData, conf, iou } }, [imgData.data.buffer])
      if (!cancelled) timer = setTimeout(run, 1200)
    }
    run()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [camOn, ready, conf, iou, hm, zones])

  useEffect(() => {
    if (!camOn) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0
    const render = () => {
      const v = videoRef.current
      if (v && v.readyState >= 2) {
        const W = canvas.width, H = canvas.height
        ctx.clearRect(0, 0, W, H)
        ctx.drawImage(v, 0, 0, W, H)

        if (hm) {
          heatRef.current?.decay()
          heatRef.current?.draw(ctx, W, H)
        }

        for (const z of zones) {
          if (!z.enabled || z.points.length < 2) continue
          ctx.save()
          ctx.strokeStyle = z.type === 'intrusion' ? 'rgba(239,68,68,0.9)' : z.type === 'line' ? 'rgba(234,179,8,0.9)' : z.type === 'loiter' ? 'rgba(168,85,247,0.9)' : 'rgba(59,130,246,0.9)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(z.points[0].x, z.points[0].y)
          for (let i = 1; i < z.points.length; i++) ctx.lineTo(z.points[i].x, z.points[i].y)
          if (z.type !== 'line') ctx.closePath()
          ctx.stroke()
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.font = 'bold 10px system-ui'
          ctx.fillText(z.name, z.points[0].x + 4, z.points[0].y - 4)
          ctx.restore()
        }
        if (drawing && drawing.points.length > 0) {
          ctx.save()
          ctx.strokeStyle = '#22c55e'
          ctx.lineWidth = 2
          ctx.setLineDash([6, 4])
          ctx.beginPath()
          ctx.moveTo(drawing.points[0].x, drawing.points[0].y)
          for (let i = 1; i < drawing.points.length; i++) ctx.lineTo(drawing.points[i].x, drawing.points[i].y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
        }

        const ds = lastDetsRef.current
        for (let i = 0; i < ds.length; i++) {
          const d = ds[i]
          const color = d.class === 'person' ? '#22c55e' : '#3b82f6'
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.strokeRect(d.box.x, d.box.y, d.box.width, d.box.height)
          ctx.fillStyle = color
          ctx.font = 'bold 11px system-ui'
          const label = `${d.class} ${(d.confidence * 100).toFixed(0)}%`
          const tw = ctx.measureText(label).width
          ctx.fillRect(d.box.x, d.box.y - 16, tw + 6, 16)
          ctx.fillStyle = '#000'
          ctx.fillText(label, d.box.x + 3, d.box.y - 4)
        }

        if (therm) {
          const tw = W >> 2, th = H >> 2
          const smallCanvas = document.createElement('canvas')
          smallCanvas.width = tw; smallCanvas.height = th
          const sctx = smallCanvas.getContext('2d')!
          sctx.drawImage(v, 0, 0, tw, th)
          const small = sctx.getImageData(0, 0, tw, th)
          applyThermal(small)
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = tw; tempCanvas.height = th
          const tctx = tempCanvas.getContext('2d')!
          tctx.putImageData(small, 0, 0)
          ctx.drawImage(tempCanvas, 0, 0, W, H)
          for (let i = 0; i < ds.length; i++) {
            const d = ds[i]
            ctx.strokeStyle = 'rgba(255,255,255,0.85)'
            ctx.lineWidth = 1.5
            ctx.strokeRect(d.box.x, d.box.y, d.box.width, d.box.height)
          }
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => cancelAnimationFrame(raf)
  }, [camOn, dets, hm, therm, zones, drawing])

  useEffect(() => {
    if (!camOn) return
    const loop = () => {
      fcRef.current++
      const n = performance.now()
      if (n - tfRef.current >= 1000) { setFps(fcRef.current); fcRef.current = 0; tfRef.current = n }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [camOn])

  useEffect(() => { flRef.current = fl }, [fl])
  useEffect(() => { hmRef.current = hm }, [hm])
  useEffect(() => { confRef.current = conf }, [conf])
  useEffect(() => { iouRef.current = iou }, [iou])
  useEffect(() => { zonesRef.current = zones }, [zones])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (flRef.current) { setFl(false); return }
      if (!t) return
      const tag = t.tagName
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A' || tag === 'LABEL') return
      setFl(true)
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (!fl) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [fl])

  const clickCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    const r = e.currentTarget.getBoundingClientRect()
    const sx = (e.currentTarget as HTMLCanvasElement).width / r.width
    const sy = (e.currentTarget as HTMLCanvasElement).height / r.height
    setDrawing({ ...drawing, points: [...drawing.points, { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }] })
  }
  const newZone = (t: Zone['type']) => setDrawing({ id: crypto.randomUUID(), name: `Zone ${zones.length + 1}`, type: t, points: [], enabled: true })
  const finishZone = () => { if (drawing && drawing.points.length >= 3) setZones(zs => [...zs, drawing]); setDrawing(null) }
  const removeZone = (id: string) => setZones(zs => zs.filter(z => z.id !== id))
  const toggleZone = (id: string) => setZones(zs => zs.map(z => z.id === id ? { ...z, enabled: !z.enabled } : z))

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0b', color: '#fff', fontFamily: 'system-ui, sans-serif', position: 'relative' }}>
      <header style={{ padding: '10px 16px', borderBottom: '1px solid #27272a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, position: 'relative', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}><span style={{ color: '#22c55e' }}>CCTV</span> Detect</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 9999, background: ready ? '#22c55e' : '#f59e0b', color: '#000', fontWeight: 600 }}>
            {ready ? 'YOLO26s Ready (worker)' : 'Loading model…'}
          </span>
          {err && <span style={{ fontSize: 11, color: '#ef4444' }}>{err}</span>}
        </div>
        <div style={{ fontSize: 11, color: '#71717a' }}>Render: {fps} FPS · Infer: {ms.toFixed(0)}ms · Dets: {dets.length}</div>
      </header>

      {!ready && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,10,11,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div style={{ width: 40, height: 40, border: '3px solid #27272a', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ color: '#a1a1aa', fontSize: 13 }}>Loading YOLO26s model…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      <main style={{ display: 'flex', gap: 12, padding: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <div ref={cameraRef} style={{ position: 'relative', width: '100%', maxWidth: 640, aspectRatio: '4 / 3', background: '#000', borderRadius: 8, overflow: 'hidden', flexShrink: 0, zIndex: 101 }}>
          <video ref={videoRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: camOn ? 'block' : 'none' }} playsInline muted />
          <canvas ref={canvasRef} width={640} height={480} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: camOn ? 'block' : 'none' }} onClick={clickCanvas} />
          {!camOn && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>Camera Off</div>}
        </div>

        <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, position: 'relative', zIndex: 20, maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={startCam} disabled={camOn} style={{ flex: 1, padding: '8px', background: camOn ? '#27272a' : '#22c55e', color: camOn ? '#fff' : '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              {camOn ? 'Running' : 'Start Camera'}
            </button>
            <button onClick={stopCam} disabled={!camOn} style={{ flex: 1, padding: '8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              Stop
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={recording ? stopRec : startRec} disabled={!camOn} style={{ flex: 1, padding: '8px', background: recording ? '#ef4444' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              {recording ? 'Stop Recording' : 'Record CCTV'}
            </button>
            {recording && <span style={{ alignSelf: 'center', fontSize: 10, color: '#ef4444' }}>REC</span>}
          </div>

          <div style={{ background: '#18181b', borderRadius: 6, border: '1px solid #27272a', padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#22c55e' }}>Detection</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#a1a1aa' }}>Confidence: {conf.toFixed(2)}</span>
              <input type="range" min={0.05} max={0.95} step={0.05} value={conf} onChange={e => setConf(parseFloat(e.target.value))} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, color: '#a1a1aa' }}>IoU (NMS): {iou.toFixed(2)}</span>
              <input type="range" min={0.1} max={0.9} step={0.05} value={iou} onChange={e => setIou(parseFloat(e.target.value))} />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(['Heatmap', 'Thermal', 'Flashlight'] as const).map(label => {
              const state = label === 'Heatmap' ? hm : label === 'Thermal' ? therm : fl
              const setter = label === 'Heatmap' ? setHm : label === 'Thermal' ? setTherm : setFl
              return (
                <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 8px', background: '#18181b', borderRadius: 6, border: '1px solid #27272a' }}>
                  <input type="checkbox" checked={state} onChange={e => setter(e.target.checked)} />
                  <span>{label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#71717a' }}>
                    {label === 'Heatmap' ? 'density map' : label === 'Thermal' ? 'Ironbow LUT' : 'fullscreen white (click anywhere)'}
                  </span>
                </label>
              )
            })}
          </div>

          <div style={{ background: '#18181b', borderRadius: 6, border: '1px solid #27272a', padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#22c55e' }}>AI Scene</div>
            <div style={{ fontSize: 11, color: '#e4e4e7' }}>{dets.length > 0 ? dets.map(d => `${d.class} ${(d.confidence * 100).toFixed(0)}%`).join(', ') : 'No detections'}</div>
          </div>

          <div style={{ background: '#18181b', borderRadius: 6, border: '1px solid #27272a', padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Zones</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(['intrusion', 'line', 'loiter', 'crowd'] as const).map(t => (
                <button key={t} onClick={() => newZone(t)} disabled={!!drawing} style={{ flex: 1, minWidth: 50, padding: '4px', fontSize: 9, background: drawing?.type === t ? '#22c55e' : '#27272a', color: drawing?.type === t ? '#000' : '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {drawing && <button onClick={finishZone} style={{ width: '100%', marginTop: 4, padding: '6px', background: '#22c55e', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Finish Zone ({drawing.points.length} pts)</button>}
            {zones.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {zones.map(z => (
                  <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#a1a1aa' }}>
                    <input type="checkbox" checked={z.enabled} onChange={() => toggleZone(z.id)} />
                    <span style={{ flex: 1 }}>{z.type}: {z.name}</span>
                    <button onClick={() => removeZone(z.id)} style={{ background: 'transparent', color: '#ef4444', fontSize: 10, padding: '0 4px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: '#18181b', borderRadius: 6, border: '1px solid #27272a', padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#ef4444' }}>Alerts ({alerts.length})</div>
            <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {alerts.length === 0 && <div style={{ fontSize: 10, color: '#71717a' }}>No alerts</div>}
              {[...alerts].reverse().map(a => (
                <div key={a.id} style={{ fontSize: 10, color: a.severity === 'critical' ? '#ef4444' : a.severity === 'warn' ? '#eab308' : '#a1a1aa' }}>
                  {new Date(a.time).toLocaleTimeString()} · {a.message}
                </div>
              ))}
            </div>
            {alerts.length > 0 && <button onClick={() => setAlerts([])} style={{ marginTop: 4, width: '100%', padding: '4px', background: '#27272a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 9 }}>Clear</button>}
          </div>
        </div>
      </main>

      {fl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#fff', pointerEvents: 'none' }} onClick={() => setFl(false)} />
      )}
    </div>
  )
}
