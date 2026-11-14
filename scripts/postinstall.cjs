const fs = require('fs')
const path = require('path')
const https = require('https')

const ROOT = path.resolve(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const ORT_DEST = path.join(PUBLIC, 'ort')
const MODELS_DEST = path.join(PUBLIC, 'models')

function copyOrt() {
  const src = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')
  if (!fs.existsSync(src)) {
    console.log('[postinstall] onnxruntime-web not found, skipping ORT copy')
    return
  }
  fs.mkdirSync(ORT_DEST, { recursive: true })
  const files = fs.readdirSync(src)
  let copied = 0
  for (const f of files) {
    const sp = path.join(src, f)
    const dp = path.join(ORT_DEST, f)
    if (fs.statSync(sp).isFile()) {
      fs.copyFileSync(sp, dp)
      copied++
    }
  }
  console.log(`[postinstall] copied ${copied} ORT files to public/ort/`)
}

function downloadModel() {
  const modelPath = path.join(MODELS_DEST, 'yolo26s.onnx')
  if (fs.existsSync(modelPath)) {
    console.log('[postinstall] model already exists, skipping download')
    return
  }
  fs.mkdirSync(MODELS_DEST, { recursive: true })
  const url = 'https://github.com/BilalAjmad/cctv-detect-ai/releases/download/v1.0.0/yolo26s.onnx'
  console.log('[postinstall] downloading model from', url)
  const file = fs.createWriteStream(modelPath)
  function get(u, redirects) {
    if (redirects > 5) { console.log('[postinstall] too many redirects'); file.close(); try { fs.unlinkSync(modelPath) } catch {}; return }
    https.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location, redirects + 1)
        return
      }
      if (res.statusCode !== 200) {
        console.log('[postinstall] model download failed (status ' + res.statusCode + '). Download manually from:', url)
        file.close()
        try { fs.unlinkSync(modelPath) } catch {}
        return
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        console.log('[postinstall] model downloaded to', modelPath)
      })
    }).on('error', (err) => {
      console.log('[postinstall] model download error:', err.message)
      file.close()
      try { fs.unlinkSync(modelPath) } catch {}
    })
  }
  get(url, 0)
}

copyOrt()
downloadModel()
