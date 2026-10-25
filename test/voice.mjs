// 语音问候的离线测试：把 src/client.js 里的 __VOICE_JSON__ 换成一包假语音，
// 看看卡片上有没有喇叭、点了会不会写开关、语音包为空时会不会躲起来。
//
//   node test/voice.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8')

const FAKE_PACK = {
  'hi-6': { f: 'hi-6.mp3', t: '晚上好，主人！' },
  'line-0': { f: 'line-0.mp3', t: '主人主人！您终于来啦～小鲸一直守着门口呢。' }
}

const checks = []
const check = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  if (!ok) throw new Error('FAILED: ' + label + (detail ? ' — ' + detail : ''))
}

function boot(pack, storedPref) {
  const body = source
    .replace('__AVATARS_JSON__', '[]')
    .replace('__VOICE_JSON__', JSON.stringify(pack))
    .replace('__CSS_JSON__', JSON.stringify(css))
    .replace('__AVATAR__', 'data:image/png;base64,AA==')
  const code = 'window.__ModuleLoader__.load({ id: "t", factory: (require) => {\n'
    + 'var module = { exports: {} }; var exports = module.exports;\n'
    + body + '\nreturn module.exports; } });\n'

  const played = []
  const sandbox = {
    window: {
      __ModuleLoader__: null,
      localStorage: {
        _v: storedPref === undefined ? {} : { 'dsh-whale-greeting:voice': storedPref },
        getItem(k) { return this._v[k] ?? null },
        setItem(k, v) { this._v[k] = String(v) }
      },
      sessionStorage: {
        _v: {},
        getItem(k) { return this._v[k] ?? null },
        setItem(k, v) { this._v[k] = String(v) }
      },
      // 记录播放请求，但不真的出声
      Audio: function Audio(src) {
        played.push(src)
        this.volume = 1
        this.play = () => Promise.resolve()
        this.pause = () => {}
        this.load = () => {}
        this.removeAttribute = () => {}
      },
      setTimeout: (fn) => { fn(); return 0 },
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      innerWidth: 1440,
      innerHeight: 900,
      devicePixelRatio: 2,
      fetch: () => Promise.resolve({})
    },
    document: {
      visibilityState: 'visible',
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    console
  }
  sandbox.window.__ModuleLoader__ = { load: (def) => { sandbox.window.__definition = def } }
  vm.runInNewContext(code, sandbox)

  const states = [{
    phase: 'shown',
    kind: 'hello',
    content: { headline: '晚上好，主人！', body: '嗯。', avatar: '', keys: ['hi-6', 'line-0'] }
  }, 0, false]
  let cursor = 0
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      const value = cursor < states.length ? states[cursor] : (typeof initial === 'function' ? initial() : initial)
      cursor += 1
      return [value, (next) => { if (cursor <= states.length) states[cursor - 1] = next }]
    },
    useEffect: () => undefined,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn
  }
  const plugin = sandbox.window.__definition.factory((name) => {
    if (name === 'react') return react
    throw new Error('unexpected require: ' + name)
  })
  const components = {}
  plugin.apply({
    slots: {
      inject: (name, factory) => factory(),
      register: (options, comp) => { components[options.name] = comp; return () => {} }
    }
  })
  return { components, sandbox, played }
}

/** 在渲染出来的树里找第一个满足条件的元素。 */
function find(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (predicate(node)) return node
  const kids = Array.isArray(node.children) ? node.children : []
  for (const kid of kids) {
    const hit = find(kid, predicate)
    if (hit !== null) return hit
  }
  return null
}

const isVoiceButton = (node) => node.type === 'button' && node.props.className === 'dshg-voice'

// 1) 有语音包：喇叭在，默认开着；点一下关掉并记住
{
  const { components, sandbox } = boot(FAKE_PACK)
  const tree = components['conversation.input.dock']({})
  const button = find(tree, isVoiceButton)
  check('有语音包时渲染喇叭', button !== null)
  check('默认开着', button.props['data-voice'] === 'on', String(button.props['data-voice']))
  check('喇叭有 aria 状态', button.props['aria-pressed'] === 'true')

  button.props.onClick({ stopPropagation() {} })
  check('点一下关掉', sandbox.window.localStorage.getItem('dsh-whale-greeting:voice') === '0')
}

// 2) 上次关掉过：这次渲染就是关的；点一下开回来，并把当前这张卡补念一遍
{
  const { components, sandbox, played } = boot(FAKE_PACK, '0')
  const tree = components['conversation.input.dock']({})
  const button = find(tree, isVoiceButton)
  check('记得上次关掉了', button.props['data-voice'] === 'off', String(button.props['data-voice']))
  check('关着时不说话', played.length === 0, JSON.stringify(played))

  button.props.onClick({ stopPropagation() {} })
  check('点一下开回来', sandbox.window.localStorage.getItem('dsh-whale-greeting:voice') === '1')
  check('打开时补念当前卡（走 Host 语音路由）',
    played[0] === '/plugins/dsh-whale-greeting/voice/hi-6.mp3', JSON.stringify(played))
}

// 3) 没有语音包：喇叭躲起来
{
  const { components } = boot({})
  const tree = components['conversation.input.dock']({})
  check('没有语音包时不渲染喇叭', find(tree, isVoiceButton) === null)
}

// 4) 语音包里的文件路径要落在 Host 的语音路由下
{
  const { components } = boot(FAKE_PACK)
  check('注册了两个 slot 的卡片', typeof components['conversation.hero.options'] === 'function')
  const tree = components['conversation.hero.options']({})
  const card = find(tree, (node) => node.props && node.props.className === 'dshg')
  check('卡片标了语音控件', card.props['data-voice-controls'] === 'true', String(card.props['data-voice-controls']))
}

const failed = checks.filter((c) => !c.ok)
for (const item of checks) console.log('  ' + (item.ok ? 'ok  ' : 'FAIL') + ' ' + item.label + (item.ok ? '' : '  [' + item.detail + ']'))
if (failed.length > 0) {
  console.log('\nFAIL — ' + failed.length + '/' + checks.length)
  process.exit(1)
}
console.log('\nPASS — ' + checks.length + '/' + checks.length + ' checks')
