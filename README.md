# CCTV Detect

**Live Demo:** https://bilalajmad.github.io/cctv-detect-ai/

Real-time CCTV object detection that runs entirely in your browser. Powered by YOLO26s via onnxruntime-web, with inference offloaded to a Web Worker for zero main-thread blocking. No server, no cloud, no API keys.

![Demo](demo.gif)

## Features

- **Object detection** — YOLO26s (80 COCO classes), adjustable confidence and IoU (NMS) thresholds
- **Heatmap** — Real-time density map of detection centers (Gaussian splats, slow decay)
- **Thermal view** — Pseudo-thermal colorization (Ironbow LUT), motion-aware boost
- **Flashlight** — Fullscreen white overlay; camera stays clear; click anywhere to dismiss
- **Zones** — Draw intrusion, line-crossing, loitering, and crowd-counting zones on the video
- **Alerts** — Real-time alert panel with severity levels and bounded history
- **CCTV recording** — Record annotated video (WebM, 12fps, 0.4 Mbps) and download
- **Centroid tracking** — Persistent track IDs with dwell-time
- **Mobile-ready** — Responsive from 320px to 2560px, touch-friendly, low battery
- **Offline-capable** — Model and runtime cached; works without network after first load

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Main Thread)                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Camera       │  │ Render Loop  │  │ UI (React)       │  │
│  │ (getUserMedia)│  │ Canvas 60fps │  │ Sidebar/Controls │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         │  ImageData       │  lastDetsRef                    │
│         ▼                 ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Web Worker (off-main-thread)                      │    │
│  │  onnxruntime-web (WASM) → YOLO26s inference       │    │
│  │  Letterbox preprocess → NMS postprocess            │    │
│  └─────────────────────────────────────────────────────┘    │
│         │                                                    │
│         │  Detection[]                                       │
│         ▼                                                    │
│  CentroidTracker → HeatmapGrid → Alerts → UI state           │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 5 |
| Styling | Vanilla CSS (CSS variables, no Tailwind) |
| Inference | onnxruntime-web 1.31 (WASM, Web Worker) |
| Model | YOLO26s (ONNX, 38MB, 80 COCO classes) |
| Testing | Vitest 2 + jsdom |
| Linting | ESLint 9 (flat config) + @typescript-eslint |

### Project Structure

```
cctv-detection-web/
├── src/
│   ├── App.tsx          # Main app, camera, render loop, UI, worker comms
│   ├── worker.ts        # Web Worker: ONNX inference + NMS + letterbox
│   ├── types.ts         # Zone, Alert, Detection types
│   ├── tracker.ts       # CentroidTracker (persistent IDs, dwell time)
│   ├── heatmap.ts       # HeatmapGrid (Gaussian splats, decay, render)
│   ├── nms.ts           # NMS + IoU + CLASS_NAMES (testable)
│   ├── ErrorBoundary.tsx # React error boundary
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles
├── public/
│   ├── models/yolo26s.onnx   # YOLO model (~38MB)
│   └── ort/                  # ORT WASM runtime (~44MB)
├── src/nms.test.ts          # Unit tests (6 tests)
├── vitest.config.ts         # Test config
├── .eslintrc.cjs            # ESLint config
├── vite.config.ts           # Vite config
├── package.json
└── README.md
```

## Installation

### Prerequisites
- Node.js 18+ (LTS recommended)
- npm, pnpm, or yarn

### Auto-download (postinstall)
Running 
pm install automatically:
1. Copies the ONNX Runtime WASM files from 
ode_modules/onnxruntime-web/dist to public/ort/
2. Downloads yolo26s.onnx (~38MB) from the GitHub release to public/models/

If the download fails (network/firewall), download manually from:
https://github.com/BilalAjmad/cctv-detect-ai/releases/download/v1.0.0/yolo26s.onnx
and place it in public/models/yolo26s.onnx.

### Windows
```bash
git clone https://github.com/BilalAjmad/cctv-detect-ai.git
cd cctv-detect-ai
npm install
npm run dev          # http://localhost:5173
npm run build        # production build to dist/
npm run test         # unit tests
npm run lint         # ESLint
```

### macOS
```bash
git clone https://github.com/BilalAjmad/cctv-detect-ai.git
cd cctv-detect-ai
npm install
npm run dev
```

### Linux
```bash
git clone https://github.com/BilalAjmad/cctv-detect-ai.git
cd cctv-detect-ai
npm install
npm run dev
```

### Mobile (Android/iOS)
The app is a PWA-ready web app. Open the deployed URL in any mobile browser. For best experience:
- Use Chrome (Android) or Safari (iOS)
- Grant camera permission
- Works in portrait and landscape

### Instant Web Access (No Install)
Open in any browser, no installation needed:
**https://bilalajmad.github.io/cctv-detect-ai/**

The app runs fully client-side. Camera permission required.

## Releases

### Web (Live)
Deploy `dist/` to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). The app works offline after first load (model cached).

### Desktop (Windows/macOS/Linux)
Tauri v2 is pre-configured (src-tauri/). To build:
`ash
npm install -g @tauri-apps/cli
npm run build
tauri build
`
Output: src-tauri/target/release/bundle/ (MSI/NSIS on Windows, DMG on macOS, AppImage on Linux).
Note: Requires Rust toolchain (rustup) and platform SDK.

### Mobile (Android)
Capacitor is not pre-configured. To add:
`ash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync
npx cap open android   # opens Android Studio
`
Requires Android Studio + JDK 17+.
Build APK from Android Studio or ./gradlew assembleRelease.

### Mobile (iOS)
Requires macOS + Xcode:
`ash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap add ios
npx cap sync
npx cap open ios
`

### Mobile
Install as PWA or wrap with Capacitor/Cordova for native app stores.

## Technologies

- **React 18** — UI framework
- **TypeScript** — Strict mode, type safety
- **Vite 5** — Build tool, HMR
- **onnxruntime-web 1.31** — WASM inference engine
- **YOLO26s** — Object detection model (ONNX format)
- **Web Workers** — Off-main-thread inference
- **MediaRecorder API** — CCTV recording
- **Canvas API** — Rendering, heatmap, thermal, privacy blur
- **FaceDetector API** — Native face detection (Chrome/Edge)
- **Vitest 2** — Unit testing
- **jsdom** — DOM testing environment
- **ESLint 9** — Linting (flat config)

## Specialties

- **Zero server dependency** — Everything runs in the browser
- **Real-time inference** — YOLO26s at 0.8 FPS on CPU (WASM)
- **Non-blocking** — Inference in Web Worker, UI stays at 60 FPS
- **Privacy-first** — No data leaves the device; camera feed never uploaded
- **Low battery** — Inference throttled to 1.2s intervals; pauses when tab hidden
- **Lightweight bundle** — ~150KB JS (excluding model/runtime)
- **Accessible** — Keyboard navigation, ARIA labels, focus-visible
- **Responsive** — 320px to 2560px, mobile-first

## Performance

| Metric | Value |
|---|---|
| JS bundle | ~150 KB (gzipped) |
| Model size | 38 MB (YOLO26s ONNX) |
| ORT runtime | 44 MB (WASM) |
| Inference time | ~820ms per frame |
| Render FPS | 60 FPS (main thread) |
| Inference FPS | 0.8 FPS (throttled) |
| First load | ~3-5s (model download) |

## Testing

```bash
npm run test         # Vitest (6 tests)
npm run lint         # ESLint (0 errors)
npm run build        # TypeScript + Vite build
```

## Demo Video

![Demo](demo.gif)

Full 15-second launch video: [demo.mp4](demo.mp4)

## License

MIT

## Credits

- YOLO26s model by Ultralytics
- onnxruntime-web by Microsoft
- Icons and design by the author
