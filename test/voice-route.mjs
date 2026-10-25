// Host 侧语音路由的离线测试：假 ctx 把四条路由收下来，直接调 voice 那条的 handler，
// 看它认不认文件、认不认路径。
//
//   node test/voice-route.mjs
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../index.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  if (!ok) throw new Error('FAILED: ' + label + (detail ? ' — ' + detail : ''))
}

const routes = []
apply({
  webServer: {
    register(spec) {
      routes.push(spec)
      return () => {}
    }
  },
  effect(fn) {
    return fn()
  }
})

const voiceRoute = routes.find((r) => r.path === '/plugins/dsh-whale-greeting/voice')
check('注册了语音前缀路由', voiceRoute !== undefined, JSON.stringify(routes.map((r) => r.path)))
check('语音路由是 prefix 型', voiceRoute.kind === 'prefix', voiceRoute.kind)
check('还注册了头像前缀路由', routes.some((r) => r.path === '/plugins/dsh-whale-greeting/avatar'))

async function call(url) {
  const result = { status: 0, headers: {}, body: null }
  const req = { url, method: 'GET', on() {}, destroy() {} }
  const res = {
    writeHead(status, headers) {
      result.status = status
      result.headers = headers ?? {}
    },
    end(body) {
      result.body = body
    }
  }
  await voiceRoute.handler(req, res)
  return result
}

const clipDir = join(root, 'assets', 'voice')
const clips = existsSync(clipDir) ? readdirSync(clipDir).filter((n) => n.endsWith('.mp3')).sort() : []
check('语音包里有 mp3', clips.length > 0, String(clips.length))

const first = await call('/plugins/dsh-whale-greeting/voice/' + clips[0])
check('能取到第一句', first.status === 200, String(first.status))
check('content-type 是 audio/mpeg', first.headers['content-type'] === 'audio/mpeg', JSON.stringify(first.headers))
check('返回的是真音频', first.body !== null && first.body.length > 2000, String(first.body && first.body.length))
check('带一周缓存', String(first.headers['cache-control'] ?? '').includes('max-age=604800'))

const unknown = await call('/plugins/dsh-whale-greeting/voice/nope-404.mp3')
check('不存在的文件 404', unknown.status === 404, String(unknown.status))

const traversal = await call('/plugins/dsh-whale-greeting/voice/../package.json')
check('路径穿越 404', traversal.status === 404, String(traversal.status))

const wav = await call('/plugins/dsh-whale-greeting/voice/hi-0.wav')
check('只发 mp3，其它后缀 404', wav.status === 404, String(wav.status))

const failed = checks.filter((c) => !c.ok)
for (const item of checks) console.log('  ' + (item.ok ? 'ok  ' : 'FAIL') + ' ' + item.label + (item.ok ? '' : '  [' + item.detail + ']'))
if (failed.length > 0) {
  console.log('\nFAIL — ' + failed.length + '/' + checks.length)
  process.exit(1)
}
console.log('\nPASS — ' + checks.length + '/' + checks.length + ' checks（' + clips.length + ' 句语音）')
