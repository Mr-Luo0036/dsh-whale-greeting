// 完成报告的闭环测试：不渲染卡片，只驱动「任务观察者」。
//
//   node test/report.mjs
//
// 用假 Session 快照把 running 推成 false，断言：
//   · 只报一次（dock / hero 两个 slot 共用一份计时器，不重复刷屏）
//   · 用时算得对（本轮 running=true 到 false 的间隔）
//   · promptError 出现时走「没走完」这一支
//   · 短的像回车的轮次不报
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const BASE = 1790000000000
let now = BASE
const RealDate = Date
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now)
    else super(...args)
  }
  static now() {
    return now
  }
}

const timers = []
const sandbox = {
  window: {
    __ModuleLoader__: null,
    localStorage: { _v: {}, getItem(k) { return this._v[k] ?? null }, setItem(k, v) { this._v[k] = String(v) } },
    sessionStorage: { _v: {}, getItem(k) { return this._v[k] ?? null }, setItem(k, v) { this._v[k] = String(v) } },
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2
  },
  document: { visibilityState: 'visible', querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} },
  Date: FakeDate,
  console
}
sandbox.Date = FakeDate
sandbox.window.__ModuleLoader__ = { load(definition) { sandbox.window.__definition = definition } }
vm.runInNewContext(code, sandbox)
const definition = sandbox.window.__definition

const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  if (!ok) throw new Error('FAILED: ' + label + (detail ? ' — ' + detail : ''))
}

// 假 React：useEffect 同步执行（等价于「这次渲染提交后跑 effect」），其余照旧。
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(fn) {
      fn()
    },
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn
  }
}

const react = fakeReact()
const plugin = definition.factory((name) => {
  if (name === 'react') return react
  throw new Error('unexpected require: ' + name)
})

const slot = {}
plugin.apply({
  slots: { inject: (_n, f) => f(), register: (o, c) => { slot[o.name] = c; return () => {} } }
})

// 假 Session 快照：观察者只读 running / promptError。
const snap = { running: false, promptError: null }
const useSession = (select) => select(snap)

const seen = []
const tree = slot['conversation.input.dock']({ useSession })
const watcher = tree
check('拿到任务观察者', Boolean(watcher && typeof watcher.type === 'function'))
check('观察者挂上了 onDone', typeof watcher.props.onDone === 'function')
watcher.props.onDone = (info) => seen.push(info)

const tick = () => watcher.type(watcher.props)

// 1) 挂载时是空闲：不报
tick()
check('空闲挂载不报', seen.length === 0, JSON.stringify(seen))

// 2) 一轮任务：running=true → 7 秒后 false
now += 1000
snap.running = true
tick()
check('跑起来时不报', seen.length === 0, JSON.stringify(seen))

now += 7000
snap.running = false
tick()
check('跑完报一次', seen.length === 1, JSON.stringify(seen))
check('用时按本轮间隔算', seen[0]?.duration >= 6800 && seen[0]?.duration <= 7200, String(seen[0]?.duration))
check('记成今天第 1 件', seen[0]?.count === 1, String(seen[0]?.count))
check('没出错就不算失败', seen[0]?.failed === false, String(seen[0]?.failed))

// 3) 另一个 slot 的同款观察者也看到同样的变化：不能再报
tick()
check('同一个 slot 不重复报', seen.length === 1, JSON.stringify(seen))

// 4) 第二轮正常完成 → 第 2 件
now += 1000
snap.running = true
tick()
now += 4000
snap.running = false
tick()
check('第二轮也报', seen.length === 2, JSON.stringify(seen))
check('记成第 2 件', seen[1]?.count === 2, String(seen[1]?.count))

// 5) 出错的一轮：promptError 有值 → failed
now += 500
snap.running = true
tick()
now += 2500
snap.promptError = { error: new Error('boom') }
snap.running = false
tick()
check('出错也报', seen.length === 3, JSON.stringify(seen))
check('出错标成 failed', seen[2]?.failed === true, String(seen[2]?.failed))
snap.promptError = null

// 6) 回车即答（短于 1.2 秒）不报
now += 100
snap.running = true
tick()
now += 300
snap.running = false
tick()
check('极短的一轮不报', seen.length === 3, JSON.stringify(seen))

// 7) 子 Agent 的会话：跑完也不报（主人等的是自己那一轮）
snap.subagent = { address: { mode: 'continuable' } }
now += 1000
snap.running = true
tick()
now += 5000
snap.running = false
tick()
check('子会话不报', seen.length === 3, JSON.stringify(seen))
snap.subagent = null

// 8) 报告之后计时器归零，下一轮重新起表
now += 1000
snap.running = true
tick()
now += 2000
snap.running = false
tick()
check('报告后还能继续报下一轮', seen.length === 4, JSON.stringify(seen))
check('用时跟着新一轮重算', seen[3]?.duration === 2000, String(seen[3]?.duration))

for (const c of checks) console.log((c.ok ? '  ok   ' : '  FAIL ') + c.label + (c.detail ? '  [' + c.detail + ']' : ''))
console.log('\nPASS — ' + checks.length + '/' + checks.length + ' checks')
