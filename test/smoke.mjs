// 离线冒烟测试：用假的 window.__ModuleLoader__ / React / ctx 跑一遍 lib/client.js。
// 断言：注册进对话区的两个 slot、等待态不渲染、shown 态渲染大幅问候卡。
//
//   node test/smoke.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const sandbox = {
  window: {
    __ModuleLoader__: null,
    localStorage: {
      _v: {},
      getItem(k) { return this._v[k] ?? null },
      setItem(k, v) { this._v[k] = String(v) }
    },
    sessionStorage: {
      _v: {},
      getItem(k) { return this._v[k] ?? null },
      setItem(k, v) { this._v[k] = String(v) }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2
  },
  document: {
    visibilityState: 'visible',
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  console
}
sandbox.window.__ModuleLoader__ = {
  load(definition) {
    sandbox.window.__definition = definition
  }
}
vm.runInNewContext(code, sandbox)
const definition = sandbox.window.__definition

const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  if (!ok) throw new Error('FAILED: ' + label + (detail ? ' — ' + detail : ''))
}

check('loader id 是包名', definition.id === 'dsh-whale-greeting', String(definition.id))

const VIEW = {
  phase: 'shown',
  kind: 'hello',
  content: { headline: '晚上好，主人。', body: '今天辛苦了，我把桌面收拾好了，随时可以开工。' }
}

// 假 React：useState 依次返回 [view, 0, false]，其余按默认值。
function fakeReact(view) {
  const states = [view, 0, false]
  let i = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      const value = i < states.length
        ? states[i]
        : (typeof initial === 'function' ? initial() : initial)
      i += 1
      return [value, () => {}]
    },
    useEffect: () => undefined,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
    reset() { i = 0 }
  }
}

const load = (view) => {
  const react = fakeReact(view)
  const plugin = definition.factory((name) => {
    if (name === 'react') return react
    throw new Error('unexpected require: ' + name)
  })
  return { plugin, react }
}

const loaded = load(VIEW)
const plugin = loaded.plugin
check('导出 inject 含 slots', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
check('导出 apply 是函数', typeof plugin.apply === 'function')

const calls = []
const components = {}
const ctx = {
  slots: {
    inject(name, factory) {
      calls.push(['inject', name])
      return factory()
    },
    register(options, comp) {
      calls.push(['register', options.name, options.id, options.order])
      components[options.name] = comp
      return () => {}
    }
  }
}
plugin.apply(ctx)

check('注册输入框上方大卡', calls.some((c) => c[0] === 'inject' && c[1] === 'conversation.input.dock'), JSON.stringify(calls))
check('注册首屏紧凑卡片', calls.some((c) => c[0] === 'inject' && c[1] === 'conversation.hero.options'), JSON.stringify(calls))
check('大卡注册为 list 条目',
  calls.some((c) => c[0] === 'register' && c[1] === 'conversation.input.dock' && c[2] === 'dsh-whale-greeting-card'),
  JSON.stringify(calls))
check('紧凑卡片注册为 list 条目',
  calls.some((c) => c[0] === 'register' && c[1] === 'conversation.hero.options' && c[2] === 'dsh-whale-greeting-hero'),
  JSON.stringify(calls))
check('不再注册 shell.overlay', !calls.some((c) => c[1] === 'shell.overlay'), JSON.stringify(calls))

// 未显示（view 为 null）：什么都不渲染。
const waiting = load(null)
check('未显示时不渲染', components['conversation.input.dock'] && waiting.plugin.apply({
  slots: { inject: (_n, f) => f(), register: (_o, c) => { components.empty = c; return () => {} } }
}) === undefined && components.empty() === null)

// 大卡渲染
loaded.react.reset()
const tree = components['conversation.input.dock']()
const card = tree.children.find((c) => c?.props?.className === 'dshg')
check('大卡存在', Boolean(card))
check('大卡相位是 shown', card?.props['data-phase'] === 'shown', String(card?.props['data-phase']))
check('大卡形态是 dock', card?.props['data-variant'] === 'dock', String(card?.props['data-variant']))
const flatTree = JSON.stringify(tree)
check('样式随组件渲染', flatTree.includes('.dshg-hi'))
check('头像内联为 data URI', flatTree.includes('data:image/png;base64,'))
check('称呼是主人', flatTree.includes('主人'))
check('出现女仆署名', flatTree.includes('鲸鱼女仆'))
check('大卡带无障碍语义', card?.props.role === 'status' && card?.props['aria-live'] === 'polite')
check('大卡含关闭按钮', Boolean(card?.children.find?.((c) => c?.props?.['aria-label'] === '关闭问候')))
check('大卡含进度条', Boolean(card?.children.find?.((c) => c?.props?.className === 'dshg-progress')))

// 首屏紧凑形态
loaded.react.reset()
const heroTree = components['conversation.hero.options']()
const heroCard = heroTree.children.find((c) => c?.props?.className === 'dshg')
check('首屏卡片存在', Boolean(heroCard))
check('首屏形态是 hero', heroCard?.props['data-variant'] === 'hero', String(heroCard?.props['data-variant']))

// 宿主真的会给 props（useSession 座位）：这条路径不能崩，且要挂上任务观察者
const session = { running: false, promptError: null, subagent: null }
const withSeat = load(VIEW)
const seatSlot = {}
withSeat.plugin.apply({
  slots: { inject: (_n, f) => f(), register: (o, c) => { seatSlot[o.name] = c; return () => {} } }
})
const seatTree = seatSlot['conversation.input.dock']({ useSession: (select) => select(session) })
check('带座位渲染是 Fragment', Array.isArray(seatTree?.children), String(seatTree?.type))
const watcher = seatTree.children[0]
check('挂了任务观察者', typeof watcher?.type === 'function')
check('观察者不渲染内容', watcher.type(watcher.props) === null)
check('观察者拿到 onDone', typeof watcher.props.onDone === 'function')
check('观察者拿到 onComfort', typeof watcher.props.onComfort === 'function')

// 任务完成报告：同一张卡，换成 done 的署名与绿色
const DONE = {
  phase: 'shown',
  kind: 'done',
  content: { headline: '任务完成啦，主人！', body: '总共用了 2 分 10 秒，小鲸把现场收拾干净啦～' }
}
const doneSlot = {}
const doneLoaded = load(DONE)
doneLoaded.plugin.apply({
  slots: { inject: (_n, f) => f(), register: (o, c) => { doneSlot[o.name] = c; return () => {} } }
})
doneLoaded.react.reset()
const doneTree = doneSlot['conversation.input.dock']()
const doneCard = doneTree.children.find((c) => c?.props?.className === 'dshg')
check('完成报告渲染同一张卡', Boolean(doneCard))
check('完成报告带 data-kind', doneCard?.props['data-kind'] === 'done', String(doneCard?.props['data-kind']))
const doneFlat = JSON.stringify(doneTree)
check('完成报告署名是交付', doneFlat.includes('任务完成 · 小鲸交付'))
check('完成报告正文在', doneFlat.includes('收拾干净'))

// 文案库与完成报告都进了 bundle
check('轮换池首句在', code.includes('主人主人！您终于来啦～小鲸一直守着门口呢。'))
check('轮换池带收尾句', code.includes('好～那从主人想做的那件开始吧！'))
check('完成文案带用时占位', code.includes('{time}'))
check('完成文案带第几件占位', code.includes('{count}'))
check('没走完的文案在', code.includes('这一件卡住了，主人……'))
check('用时格式化在', code.includes('function formatDuration'))
check('占位符替换在', code.includes('(time|count|at|tool|reason)'))
check('任务观察者盯着 running', code.includes('snapshot.running === true'))
check('任务观察者读 promptError', code.includes('snapshot.promptError'))
check('完成卡用成功色', code.includes('--dshg-accent: var(--dsw-alias-state-success-primary'))
check('卡住卡用警告色', code.includes('--dshg-accent: var(--dsw-alias-state-warn-primary'))
check('随机头像名单在', code.includes('"deyi.png"') && code.includes('"zaoshanghao.png"'))
check('随机头像路由在', code.includes("'/plugins/dsh-whale-greeting/avatar/'"))
check('内容带随机头像字段', code.includes('avatar: avatar'))
check('头像加载失败回落到内联图', code.includes("element.setAttribute('src', AVATAR)"))
{
  const raw = code.split('var AVATARS = ')[1].split('\n')[0].trim().replace(/;$/, '')
  const list = JSON.parse(raw)
  check('随机头像至少 20 张', Array.isArray(list) && list.length >= 20, String(Array.isArray(list) ? list.length : raw.slice(0, 60)))
}
check('轮换记录键在', code.includes("'dsh-whale-greeting:recent'"))
const linesBlock = code.split('var LINES = [')[1].split('\n]\n')[0]
const lineCount = (linesBlock.match(/^\s*'/gm) || []).length
check('轮换池至少 100 句', lineCount >= 100, String(lineCount))
check('bundle 里带覆盖层选择器', code.includes("'.dshba'"), 'BOOT_OVERLAY_SELECTOR')
check('bundle 里带诊断键', code.includes('dsh-whale-greeting:diag'))
check('bundle 里带 Host 诊断路由', code.includes('/plugins/dsh-whale-greeting/diag'))
check('bundle 里带问候三触发', code.includes("'return'") && code.includes("'idle'") && code.includes("'hello'"))
check('bundle 里带报告两形态', code.includes("'done'") && code.includes("'failed'"))

// v4：长跑陪伴 + 授权请示
check('注册了 composer 链', calls.some((c) => c[0] === 'inject' && c[1] === 'conversation.composer'), JSON.stringify(calls))
check('composer 链靠 select 获选', code.includes('select: approvalSelect'))
check('陪伴触发窗口是 4~8 分钟',
  code.includes('var COMFORT_MIN_MS = 4 * 60 * 1000') && code.includes('var COMFORT_MAX_MS = 8 * 60 * 1000'))
check('陪伴靠 20 秒心跳巡检', code.includes('COMFORT_TICK_MS = 20000') && code.includes('function comfortTick'))
check('陪伴卡片带用时占位', code.includes("kind === 'comfort'"))
check('陪伴署名在', code.includes('长跑陪伴 · 小鲸在'))
check('授权署名在', code.includes('等待授权 · 小鲸请示'))
check('授权只认 approval', code.includes("pending.kind !== 'approval'"))
check('授权保留两个答复', code.includes("answer('allowed-once')") && code.includes("answer('rejected')"))
check('授权把详情交给详情 slot', code.includes("renderSlot('conversation.approval.detail'"))
{
  const block = code.split('var COMFORT_LINES = [')[1].split('\n]\n')[0]
  const count = (block.match(/^\s*'/gm) || []).length
  check('陪伴文案至少 12 句', count >= 12, String(count))
}
{
  const block = code.split('var PERMISSION_LINES = [')[1].split('\n]\n')[0]
  const count = (block.match(/^\s*'/gm) || []).length
  check('请示文案至少 4 句', count >= 4, String(count))
}

for (const c of checks) console.log((c.ok ? '  ok   ' : '  FAIL ') + c.label + (c.detail ? '  [' + c.detail + ']' : ''))
console.log('\nPASS — ' + checks.length + '/' + checks.length + ' checks')
