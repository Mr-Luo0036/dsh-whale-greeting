// 长跑陪伴 + 授权请示的闭环测试：不渲染真 DOM，只驱动时间与选择器。
//
//   node test/comfort.mjs
//
// 断言：
//   · 一轮跑起来后，4~8 分钟之间才说第一次「陪伴」，说完再抽下一个窗口
//   · 没在跑、子 Agent 会话、跑完之后，一声都不出
//   · 授权面板只在 pendingInteraction.kind === 'approval' 且能答复时获选
//   · 面板仍然是两个答复：允许一次 / 拒绝，并原样请求详情 slot
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const MIN = 60 * 1000
const TICK = 20000

let now = 1790000000000
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

const intervals = new Map()
let intervalSeq = 0

const sandbox = {
  window: {
    __ModuleLoader__: null,
    localStorage: { _v: {}, getItem(k) { return this._v[k] ?? null }, setItem(k, v) { this._v[k] = String(v) } },
    sessionStorage: { _v: {}, getItem(k) { return this._v[k] ?? null }, setItem(k, v) { this._v[k] = String(v) } },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: (fn) => { intervalSeq += 1; intervals.set(intervalSeq, fn); return intervalSeq },
    clearInterval: (id) => { intervals.delete(id) },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2
  },
  document: {
    visibilityState: 'visible',
    activeElement: null,
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  Date: FakeDate,
  console
}
sandbox.window.__ModuleLoader__ = { load(definition) { sandbox.window.__definition = definition } }
vm.runInNewContext(code, sandbox)
const definition = sandbox.window.__definition

const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  if (!ok) throw new Error('FAILED: ' + label + (detail ? ' — ' + detail : ''))
}

// 假 React：useEffect 同步执行，useState 只读不写（断言的是回调不是重渲染）。
function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(fn) {
      const cleanup = fn()
      return cleanup
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

const components = {}
const options = {}
plugin.apply({
  slots: {
    inject: (_n, f) => f(),
    register: (o, c) => {
      options[o.name] = o
      components[o.name] = c
      return () => {}
    }
  }
})

const tickIntervals = () => {
  for (const fn of [...intervals.values()]) fn()
}

// ── 一、长跑陪伴 ─────────────────────────────────────────────────────────

const snap = { running: false, promptError: null, subagent: null }
const useSession = (select) => select(snap)

const comfort = []
const tree = components['conversation.input.dock']({ useSession })
check('拿到任务观察者', Boolean(tree && typeof tree.type === 'function'))
tree.props.onComfort = (info) => comfort.push({ ...info, at: now })
const tick = () => tree.type(tree.props)

tick()
check('观察者挂上后开了一个心跳', intervals.size === 1, String(intervals.size))

// 没在跑的时候，心跳走多久都不出声
for (let i = 0; i < 30; i += 1) {
  now += TICK
  tickIntervals()
}
check('空闲时不出声', comfort.length === 0, JSON.stringify(comfort))

// 一轮跑起来
snap.running = true
tick()
check('跑起来后有起点', comfort.length === 0)

// 前 4 分钟不该说话（窗口下限就是 4 分钟）
for (let i = 0; i < (4 * MIN) / TICK - 1; i += 1) {
  now += TICK
  tickIntervals()
}
check('不到 4 分钟不打扰', comfort.length === 0, JSON.stringify(comfort))

// 推到 9 分钟：第一次陪伴一定落在 4~8 分钟之间（含一个心跳的滞后）
let guard = 0
while (comfort.length === 0 && guard < 400) {
  now += TICK
  tickIntervals()
  guard += 1
}
check('4~8 分钟之间出第一次陪伴', comfort.length === 1, JSON.stringify(comfort))
check('第一次陪伴的用时说得对', comfort[0]?.duration >= 4 * MIN && comfort[0]?.duration <= 8 * MIN + TICK,
  String(comfort[0]?.duration))
check('陪伴带第几轮', comfort[0]?.round === 1, String(comfort[0]?.round))

// 继续跑：第二次陪伴同样在 4~8 分钟之后
guard = 0
while (comfort.length === 1 && guard < 400) {
  now += TICK
  tickIntervals()
  guard += 1
}
check('跑得久就再陪一次', comfort.length === 2, JSON.stringify(comfort))
const gap = comfort[1].at - comfort[0].at
check('第二次也在 4~8 分钟之后', gap >= 4 * MIN && gap <= 8 * MIN + TICK, String(gap))

// 跑完：不再出声
snap.running = false
tick()
const settled = comfort.length
for (let i = 0; i < 60; i += 1) {
  now += TICK
  tickIntervals()
}
check('跑完就不再出声', comfort.length === settled, JSON.stringify(comfort))

// 子 Agent 会话：不陪
snap.subagent = { address: { mode: 'continuable' } }
snap.running = true
tick()
for (let i = 0; i < 600; i += 1) {
  now += TICK
  tickIntervals()
}
check('子会话不陪', comfort.length === settled, JSON.stringify(comfort))
snap.subagent = null
snap.running = false
tick()

// ── 二、授权请示 ─────────────────────────────────────────────────────────

const select = options['conversation.composer']?.select
check('注册了 composer 链', typeof select === 'function')
check('接管时带上详情 slot',
  options['conversation.composer']?.children?.['conversation.approval.detail']?.kind === 'single',
  JSON.stringify(options['conversation.composer']?.children))
check('composer 链没有 id（链靠 select 获选）', options['conversation.composer']?.id === undefined)

const approvable = { kind: 'approval', key: 'approval:1', toolName: 'bash', answer: () => Promise.resolve(), answerable: true }
check('没有待处理交互时不接管', select({ sessionId: 's1', session: {}, pendingInteraction: undefined }) === null)
check('user-questions 的提问不接管', select({ pendingInteraction: { kind: 'question' } }) === null)
check('plan-review 不接管', select({ pendingInteraction: { kind: 'plan-review' } }) === null)
check('拿不到 answer 时让位', select({ pendingInteraction: { kind: 'approval', key: 'k' } }) === null)
check('审批挂起时接管', select({ pendingInteraction: approvable }) === approvable)

// 面板本体
const asked = []
let detailAsked = null
const pending = {
  kind: 'approval',
  key: 'approval:7',
  toolName: 'bash',
  callId: 'call-7',
  reason: '需要写入 /etc/hosts',
  displayReason: { zh: '允许本次操作使用 workspace-write 权限：需要写入 /etc/hosts', en: 'Allow' },
  answerable: true,
  answer: (outcome) => {
    asked.push(outcome)
    return Promise.resolve()
  }
}

const detail = { type: 'div', props: { 'data-fake-detail': 'call-7' }, children: [] }
const tree2 = components['conversation.composer']({
  matched: pending,
  renderSlot: (name, props) => {
    detailAsked = { name, props }
    return detail
  }
})

const flat = JSON.stringify(tree2)
const card = findByClass(tree2, 'dshg')
check('授权面板用同一张卡', Boolean(card))
check('授权面板的 kind 是 permission', card?.props?.['data-kind'] === 'permission', String(card?.props?.['data-kind']))
check('授权面板带 approval key', card?.props?.['data-approval-key'] === 'approval:7', String(card?.props?.['data-approval-key']))
check('授权面板是无障碍 group', card?.props?.role === 'group')
check('署名说在等授权', flat.includes('等待授权 · 小鲸请示'))
check('话里带上工具名', flat.includes('bash'))
check('话里带上申请理由', flat.includes('workspace-write'))
check('请求了详情 slot', detailAsked?.name === 'conversation.approval.detail' && detailAsked?.props?.callId === 'call-7',
  JSON.stringify(detailAsked))

// 理由的本地化：宿主自带面板靠 resolveReason 拿文案，这里也要走同一条路
check('注册时留了 inject 座位', typeof options['conversation.composer']?.inject === 'function')
check('座位里有 resolveReason', typeof options['conversation.composer']?.inject?.().resolveReason === 'function')
const localized = components['conversation.composer']({
  matched: pending,
  renderSlot: () => detail,
  resolveReason: () => '宿主解析出来的理由'
})
check('优先用宿主解析的理由', JSON.stringify(localized).includes('宿主解析出来的理由'))

const stringReason = components['conversation.composer']({
  matched: { ...pending, key: 'approval:9', displayReason: '一条字符串理由' },
  renderSlot: () => detail
})
check('displayReason 是字符串时直接用', JSON.stringify(stringReason).includes('一条字符串理由'))

const bareReason = components['conversation.composer']({
  matched: { ...pending, key: 'approval:10', displayReason: undefined },
  renderSlot: () => detail
})
check('没有 displayReason 时退回 reason', JSON.stringify(bareReason).includes('需要写入 /etc/hosts'))

const allow = findByClass(tree2, 'dshg-btn-allow')
const reject = findByClass(tree2, 'dshg-btn-reject')
check('有「允许一次」按钮', Boolean(allow) && String(allow.children?.[0] ?? '').includes('允许一次'), JSON.stringify(allow?.children))
check('有「拒绝」按钮', Boolean(reject))

allow.props.onClick({ stopPropagation: () => {} })
check('允许一次走 allowed-once', asked[0] === 'allowed-once', JSON.stringify(asked))

// 答复是一次性的：同一块面板不会对第二次点击再发一次（重挂载才会）
reject.props.onClick({ stopPropagation: () => {} })
check('答复只发一次', asked.length === 1, JSON.stringify(asked))

// 换一条审批（新面板）时，拒绝走 rejected
const askedAgain = []
const tree3 = components['conversation.composer']({
  matched: { ...pending, key: 'approval:8', answer: (outcome) => { askedAgain.push(outcome); return Promise.resolve() } },
  renderSlot: () => detail
})
findByClass(tree3, 'dshg-btn-reject').props.onClick({ stopPropagation: () => {} })
check('拒绝走 rejected', askedAgain[0] === 'rejected', JSON.stringify(askedAgain))

// 已经不可答复时按钮禁用
const dead = components['conversation.composer']({
  matched: { ...pending, answerable: false, answer: () => Promise.resolve() },
  renderSlot: () => detail
})
check('不可答复时按钮禁用',
  findByClass(dead, 'dshg-btn-allow')?.props?.disabled === true &&
  findByClass(dead, 'dshg-btn-reject')?.props?.disabled === true)

// 没有 callId 就不去要详情，也不崩
const noCall = components['conversation.composer']({
  matched: { ...pending, callId: undefined },
  renderSlot: () => { throw new Error('不该被调用') }
})
check('没有 callId 时不请求详情', findByClass(noCall, 'dshg') !== null)

// 没有获选对象也不崩（理论上到不了）
check('没有 matched 时返回 null', components['conversation.composer']({}) === null)

function findByClass(node, cls) {
  if (node === null || typeof node !== 'object') return null
  const props = node.props ?? {}
  const className = props.className ?? ''
  if (typeof className === 'string' && className.split(' ').includes(cls)) return node
  const kids = node.children ?? []
  for (const child of kids) {
    const hit = findByClass(child, cls)
    if (hit !== null) return hit
  }
  if (Array.isArray(kids)) {
    for (const child of kids) {
      if (Array.isArray(child)) {
        for (const inner of child) {
          const hit = findByClass(inner, cls)
          if (hit !== null) return hit
        }
      }
    }
  }
  return null
}

for (const c of checks) console.log((c.ok ? '  ok   ' : '  FAIL ') + c.label + (c.detail ? '  [' + c.detail + ']' : ''))
console.log('\nPASS — ' + checks.length + '/' + checks.length + ' checks')
