const { spawn } = require('node:child_process')
const WebSocket = require('ws')
const http = require('node:http')

const url = 'http://localhost:5173/'

const child = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=9236', url
], { stdio: 'ignore' })

const msgs = []

function fetchJSON(p) {
  return new Promise(resolve => {
    http.get(`http://127.0.0.1:9236/${p}`, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve([]) } })
    }).on('error', () => resolve([]))
  })
}

async function main() {
  let tab
  for (let i = 0; i < 40; i++) {
    const tabs = await fetchJSON('json/list')
    tab = tabs.find(t => t.type === 'page')
    if (tab) break
    await new Promise(r => setTimeout(r, 500))
  }
  if (!tab) { console.log('NO TAB'); process.exit(1) }

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params) => new Promise(resolve => {
    const m = JSON.stringify({ id: ++id, method, params })
    pending.set(id, resolve)
    ws.send(m)
  })

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    } else if (msg.method === 'Console.consoleAPICalled') {
      msgs.push(msg.params.args.map(a => a.value || a.description || '').join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      msgs.push('EXC: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || 'unknown'))
    }
  })

  ws.on('open', async () => {
    await send('Runtime.enable')
    await send('Console.enable')
    await send('Page.enable')

    await new Promise(r => setTimeout(r, 60000))

    const r = await send('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,300)', returnByValue: true })
    console.log('PAGE TEXT:')
    console.log(r.result.value || '(empty)')
    console.log('---')
    console.log('CONSOLE:')
    console.log(msgs.join('\n') || '(none)')

    ws.close()
    child.kill()
    process.exit(0)
  })

  ws.on('error', e => { console.log('WS ERR', e.message); process.exit(1) })
}

main().catch(e => { console.log('ERR', e.message); process.exit(1) })
setTimeout(() => { console.log('TIMEOUT'); console.log('CONSOLE:'); console.log(msgs.join('\n') || '(none)'); child.kill(); process.exit(1) }, 90000)