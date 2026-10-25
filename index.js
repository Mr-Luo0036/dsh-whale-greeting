// Host half of dsh-whale-greeting.
//
// 插件的工作全在浏览器里，但 Host 侧要留四条路：
//   1. /plugins/dsh-whale-greeting/status.json —— 回答"宿主这一半到底装没装"；
//   2. /plugins/dsh-whale-greeting/diag       —— 浏览器每次亮出问候时打一条诊断，
//      写进临时目录的 dsh-whale-greeting-diag.jsonl，没有控制台也能看见走到了哪一步。
//   3. /plugins/dsh-whale-greeting/avatar/... —— 表情包头像（assets/avatars/*.png），
//      浏览器每次问候随机取一张。
//   4. /plugins/dsh-whale-greeting/voice/...  —— 语音问候的音频（assets/voice/*.mp3），
//      音色是从参考素材里克隆出来的，由构建期生成，这里只负责按名字发出去。
//
// 浏览器那半有没有真的跑，由页面里的 `dsh-whale-greeting:diag` 与这条 diag 一起回答 ——
// 两边分开看，才不会把"bundle 没加载"和"加载了但没显示"混成一个问题。
//
// 客户端 bundle 只有在某条 entry 被 loader 装载时才进页面，所以这个 entry 仍然必要。

import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.6.1'
const DIAG_FILE = join(tmpdir(), 'dsh-whale-greeting-diag.jsonl')
const DIAG_MAX_LINES = 80
const DIAG_MAX_BODY = 4096
const AVATAR_DIR = fileURLToPath(new URL('./assets/avatars/', import.meta.url))
const AVATAR_PREFIX = '/plugins/dsh-whale-greeting/avatar/'
const AVATAR_NAME = /^[a-z0-9_-]+\.png$/
const VOICE_DIR = fileURLToPath(new URL('./assets/voice/', import.meta.url))
const VOICE_PREFIX = '/plugins/dsh-whale-greeting/voice/'
const VOICE_NAME = /^[a-z0-9_-]+\.mp3$/

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > DIAG_MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function shortText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

async function appendDiag(entry) {
  let lines = []
  try {
    lines = (await readFile(DIAG_FILE, 'utf8')).split('\n').filter(Boolean)
  } catch (error) {
    lines = []
  }
  lines.push(JSON.stringify(entry))
  if (lines.length > DIAG_MAX_LINES) lines = lines.slice(-DIAG_MAX_LINES)
  await writeFile(DIAG_FILE, lines.join('\n') + '\n', 'utf8')
}

export const name = 'dsh-whale-greeting'

export const inject = ['webServer']

export function apply(ctx) {
  const startedAt = new Date().toISOString()
  const server = ctx.webServer

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/plugins/dsh-whale-greeting/status.json',
    handler: (req, res) => {
      const body = JSON.stringify({
        ok: true,
        host: 'mounted',
        pid: process.pid,
        startedAt,
        now: new Date().toISOString(),
        version: VERSION
      })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(body)
    }
  }))

  ctx.effect(() => server.register({
    kind: 'exact',
    path: '/plugins/dsh-whale-greeting/diag',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('POST only')
        return
      }
      try {
        const body = await readJsonBody(req)
        await appendDiag({
          at: new Date().toISOString(),
          stage: shortText(body.stage, 40) || 'unknown',
          detail: shortText(body.detail, 80),
          w: Number.isFinite(body.w) ? Math.round(body.w) : undefined,
          h: Number.isFinite(body.h) ? Math.round(body.h) : undefined,
          dpr: Number.isFinite(body.dpr) ? body.dpr : undefined
        })
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('bad diag')
      }
    }
  }))

  // 随机头像：浏览器每次问候从这里取一张表情包头像（名字来自构建时注入的白名单）。
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: '/plugins/dsh-whale-greeting/avatar',
    handler: async (req, res) => {
      const pathname = (req.url ?? '').split('?')[0]
      const name = pathname.slice(AVATAR_PREFIX.length)
      if (!AVATAR_NAME.test(name)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('unknown avatar')
        return
      }
      try {
        const bytes = await readFile(join(AVATAR_DIR, name))
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400'
        })
        res.end(bytes)
      } catch (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('missing avatar')
      }
    }
  }))

  // 语音问候：浏览器按语音包清单取具体一句的音频。
  // 名字来自构建时注入的清单，所以这里只做形状校验，不认目录里的其它文件。
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: '/plugins/dsh-whale-greeting/voice',
    handler: async (req, res) => {
      const pathname = (req.url ?? '').split('?')[0]
      const name = pathname.slice(VOICE_PREFIX.length)
      if (!VOICE_NAME.test(name)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('unknown voice clip')
        return
      }
      try {
        const bytes = await readFile(join(VOICE_DIR, name))
        res.writeHead(200, {
          'content-type': 'audio/mpeg',
          // 语音包随版本变，不常换：浏览器缓存一周，省得每次问候都重新拉。
          'content-length': bytes.length,
          'cache-control': 'public, max-age=604800'
        })
        res.end(bytes)
      } catch (error) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('missing voice clip')
      }
    }
  }))
}
