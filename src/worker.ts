// Web Worker: YOLO inference with onnxruntime-web (off-main-thread)
import * as ort from 'onnxruntime-web'
import { nms, type RawBox } from './nms'

const INPUT_W = 640
const INPUT_H = 640
const NUM_CLASSES = 80

let session: ort.InferenceSession | null = null
let inputName = ''
let outputNames: readonly string[] = []

async function initSession() {
  if (session) return
  const base = typeof location !== 'undefined' ? location.origin : ''
  ort.env.wasm.wasmPaths = `${base}/ort/`
  const modelUrl = '/models/yolo26s.onnx'
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableMemPattern: false,
    enableCpuMemArena: false,
  })
  inputName = session.inputNames[0]
  outputNames = session.outputNames
}

function preprocess(imgData: ImageData): ort.Tensor {
  const { width, height, data } = imgData
  const out = new Float32Array(3 * INPUT_H * INPUT_W)
  const scale = Math.min(INPUT_W / width, INPUT_H / height)
  const newW = Math.round(width * scale)
  const newH = Math.round(height * scale)
  const padX = (INPUT_W - newW) >> 1
  const padY = (INPUT_H - newH) >> 1
  const padVal = 114 / 255
  out.fill(padVal)
  const scaleX = width / newW
  const scaleY = height / newH
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcX = (x + 0.5) * scaleX - 0.5
        const srcY = (y + 0.5) * scaleY - 0.5
        const x0 = Math.max(0, Math.min(width - 1, Math.floor(srcX)))
        const y0 = Math.max(0, Math.min(height - 1, Math.floor(srcY)))
        const x1 = Math.min(x0 + 1, width - 1)
        const y1 = Math.min(y0 + 1, height - 1)
        const dx = srcX - x0
        const dy = srcY - y0
        const i00 = (y0 * width + x0) * 4 + c
        const i10 = (y0 * width + x1) * 4 + c
        const i01 = (y1 * width + x0) * 4 + c
        const i11 = (y1 * width + x1) * 4 + c
        const v00 = data[i00]
        const v10 = data[i10]
        const v01 = data[i01]
        const v11 = data[i11]
        const v0 = v00 + (v10 - v00) * dx
        const v1 = v01 + (v11 - v01) * dx
        const val = v0 + (v1 - v0) * dy
        const dstX = padX + x
        const dstY = padY + y
        out[c * INPUT_H * INPUT_W + dstY * INPUT_W + dstX] = val / 255.0
      }
    }
  }
  return new ort.Tensor('float32', out, [1, 3, INPUT_H, INPUT_W])
}

function postprocess(output: ort.Tensor, confThreshold: number, iouThreshold: number, origW: number, origH: number) {
  const data = output.data as Float32Array
  const dims = output.dims
  const numAnchors = dims[2]
  const scale = Math.min(INPUT_W / origW, INPUT_H / origH)
  const newW = Math.round(origW * scale)
  const newH = Math.round(origH * scale)
  const padX = (INPUT_W - newW) >> 1
  const padY = (INPUT_H - newH) >> 1
  const boxes: RawBox[] = []
  for (let i = 0; i < numAnchors; i++) {
    let maxConf = 0
    let maxClass = 0
    for (let c = 0; c < NUM_CLASSES; c++) {
      const conf = data[(4 + c) * numAnchors + i]
      if (conf > maxConf) { maxConf = conf; maxClass = c }
    }
    if (maxConf < confThreshold) continue
    const cx = data[0 * numAnchors + i]
    const cy = data[1 * numAnchors + i]
    const w = data[2 * numAnchors + i]
    const h = data[3 * numAnchors + i]
    const x1 = ((cx - w / 2) - padX) / scale
    const y1 = ((cy - h / 2) - padY) / scale
    const x2 = ((cx + w / 2) - padX) / scale
    const y2 = ((cy + h / 2) - padY) / scale
    boxes.push({ x1, y1, x2, y2, conf: maxConf, class: maxClass })
  }
  return nms(boxes, iouThreshold)
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data
  if (type === 'init') {
    try {
      await initSession()
      self.postMessage({ type: 'ready' })
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) })
    }
  } else if (type === 'predict') {
    if (!session) {
      self.postMessage({ type: 'error', payload: 'Session not initialized' })
      return
    }
    try {
      const { imageData, conf, iou } = payload
      const tensor = preprocess(imageData)
      const feeds = { [inputName]: tensor }
      const results = await session.run(feeds, outputNames)
      const output = results[outputNames[0]]
      const detections = postprocess(output, conf, iou, imageData.width, imageData.height)
      self.postMessage({ type: 'result', payload: detections })
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) })
    }
  }
}

declare const self: {
  onmessage: (e: MessageEvent) => void
  postMessage: (msg: unknown) => void
}
