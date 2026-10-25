// 从 src/client.js 里把文案数组抠出来（纯字面量，直接 eval），
// 供语音克隆脚本使用 —— 卡片显示的字和念出来的声音必须同源。
//
//   node extract_texts.mjs <src/client.js> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'

const [, , srcPath, outPath] = process.argv
const src = readFileSync(srcPath, 'utf8')

function findArray(source, name) {
  const marker = 'var ' + name + ' = ['
  const at = source.indexOf(marker)
  if (at < 0) throw new Error('array not found: ' + name)
  let i = at + marker.length - 1 // 指向 '['
  let depth = 0
  let quote = null
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (quote !== null) {
      if (ch === '\\') { i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
    if (ch === '/' && source[i + 1] === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1; i += 1; continue }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        const literal = source.slice(at + marker.length - 1, i + 1)
        // 字面量里可能有模板/注释，去掉行尾注释再 eval
        return new Function('return ' + literal)()
      }
    }
  }
  throw new Error('unterminated array: ' + name)
}

const out = {
  heads: findArray(src, 'VOICE_HEADS'),
  lines: findArray(src, 'LINES'),
  returns: findArray(src, 'RETURN_LINES'),
  idle: findArray(src, 'IDLE_LINES')
}

for (const [key, value] of Object.entries(out)) {
  if (!Array.isArray(value)) throw new Error('not an array: ' + key)
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') throw new Error('bad item in ' + key + ': ' + JSON.stringify(item))
  }
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log('extracted', Object.entries(out).map(([k, v]) => k + '=' + v.length).join(' '))
