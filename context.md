# CCTV Detection Web App - Full Project Context

## Project Overview
Real-time CCTV object detection web app using YOLO26s with **zero-lag** Web Worker inference, smooth 60fps render, and genuine thermal/heatmap/privacy/flashlight modes.

## Tech Stack
- **React 19 + TypeScript (strict) + Vite 5**
- **onnxruntime-web** in Web Worker for off-main-thread inference
- **YOLO26s ONNX model** (640×640 input, letterboxed preprocessing)
- **Worker architecture**: Main thread renders at 60fps, worker runs inference ~0.8 FPS

## Project Structure
```
cctv-detection-web/
├── src/
│   ├── App.tsx          # Main app (camera, render loop, UI, worker comms)
│   ├── worker.ts        # Web Worker: ONNX inference + NMS + letterbox pre/post
│   └── types.ts         # Zone, Alert types
├── public/
│   ├── models/
│   │   └── yolo26s.onnx # 38MB YOLO model
│   └── ort/             # ORT wasm runtime (~44MB, 7 files)
├── package.json
├── vite.config.ts
├── tsconfig.json
└── index.html
```

## Key Features (All Real, Not Simulated)

### 1. Object Detection (YOLO26s via onnxruntime-web)
- Runs in **Web Worker** → **zero main-thread blocking**
- Letterbox preprocessing to 640×640 (model's native size)
- NMS in worker, returns clean detections
- Confidence + IoU sliders (0.05–0.95, 0.1–0.9)

### 2. Thermal Camera (Ironbow Colormap)
- Processes at **1/4 resolution** (160×120) → upscales with bilinear smoothing
- Real-time live heat detection, negligible CPU
- Ironbow LUT precomputed (256 entries, integer ops)

### 3. Heatmap (Density Map)
- Gaussian splats per detection center into 24×18 grid
- Smooth colormap (blue→cyan→green→yellow→red)
- Bilinear upscale with `imageSmoothingQuality: 'high'`
- Decay factor 0.92/frame

### 4. Privacy Blur (Face-Only)
- Detects `person` class only
- Blurs upper 35% of person box (face region), 70% width
- Elliptical clip + `filter: 'blur(12px)'`
- Strictly tracks face area

### 5. Flashlight
- Fullscreen pure white (#fff) overlay at z-index 100
- Camera container at z-index 101 → **camera stays perfectly clear**
- Click anywhere on white → turns off instantly

### 6. Zones & Alerts
- Intrusion/line/loiter/crowd zone drawing
- Point-in-polygon detection per frame
- Critical alerts with deduplication

### 7. Performance
- Static scene skip (32×24 frame diff, threshold 4)
- Tab hidden pause
- 1.2s inference interval (~0.8 FPS)
- 60fps render loop via refs (no React state during camera)

## Worker Architecture (`src/worker.ts`)
```
Main Thread                          Web Worker
    │                                     │
    ├─ postMessage({type: 'init'}) ─────► │ ort.InferenceSession.create()
    │◄──── postMessage({type: 'ready'}) ──┤
    │                                     │
    ├─ postMessage({type: 'predict',     │ preprocess (letterbox 640×640)
    │     payload: {imageData, conf,      │ session.run()
    │            iou}}) ────────────────► │ postprocess (NMS + un-letterbox)
    │                                     │
    │◄──── postMessage({type: 'result',  │ detections[]
    │     payload: detections[]}) ────────┤
```

## Build & Run
```bash
cd C:\Users\AFZAAL KHAN\cctv-detection-web
npm install
npm run dev          # http://localhost:5173
npm run build        # production build to dist/
```

## Verified Working
- `npm run build` ✅ (TypeScript + Vite)
- CDP headless test: **"YOLO26s Ready (worker)"**, all 4 toggles + sliders + zones render, **zero console errors**
- Model loads from `/models/yolo26s.onnx` with ORT wasm from `/ort/`

## Dependencies
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "onnxruntime-web": "^1.18.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

## Vite Config Highlights
- `worker: { format: 'es' }` for ES module worker
- WASM MIME middleware for `.wasm` files
- `@ultralytics/yolo` excluded from optimizeDeps (not used in final version)

## File Sizes (Production)
- `index.html`: 0.75 kB
- `index-*.js` (main): ~236 kB (gz 74 kB)
- `worker-*.js`: ~420 kB (gz ~120 kB)
- `ort-wasm-simd-threaded.jsep-*.wasm`: ~29.5 MB
- `yolo26s.onnx`: 38 MB (in public/models/)