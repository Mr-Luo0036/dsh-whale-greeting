// dsh-whale-greeting — 浏览器半（v4：大幅问候卡 + 任务完成报告 + 长跑陪伴 + 授权请示）。
//
// 问候长在对话区里，但比一条普通消息更大、更醒目：
//
//   conversation.input.dock   输入框上方 → 整幅问候卡（大头像 + 大标题 + 正文 + 进度条）
//   conversation.hero.options 空白 / 新对话 → 同款卡片的紧凑形态
//   conversation.composer     需要授权时 → 小鲸接管输入框，替工具向主人请示
//
// 触发时机（都是宿主里真实发生的时刻）：
//   1. 打开页面 / 新会话挂载              → hello
//   2. 页面被切走超过 90 秒再回来          → return
//   3. 连续 8 分钟没有任何输入，然后动了    → idle
//   4. 一轮任务从「运行中」回到「空闲」      → done / failed（任务完成报告）
//   5. 一轮任务跑到 4~8 分钟之间的随机时刻  → comfort（长跑陪伴，之后每 4~8 分钟再抽一次）
//   6. 会话出现待审批（pendingInteraction.kind === 'approval'）→ 授权请示面板
// 同一个页面里不会连续刷屏：90 秒冷却（完成报告与授权请示例外，它们必须当场说）。
//
// 文案不是固定一句：按时段取称呼 + 120 句轮换池，sessionStorage 记最近用过的，
// 一轮之内不重复；换会话/刷新后从剩下的继续挑。
//
// 另有三件事：
//   1. 启动动画的覆盖层（`.dshba`）会盖住问候，等它消失、页面可见，再开始。
//   2. 每次显示都往 Host 的 `/plugins/dsh-whale-greeting/diag` 打一条诊断，
//      没有控制台也能从磁盘上看出走到哪一步、渲染的是哪种形态。
//   3. 完成报告读 slot 给的 `useSession` 座椅：盯着 `snapshot.running` 由 true 变 false，
//      记下这一轮的用时与「今天第几件」，连同 `promptError` 一起写成一张交付卡。

var React
try {
  React = require('react')
} catch (error) {
  diag('require-failed')
  throw error
}
var h = React.createElement

var CSS = __CSS_JSON__

// 兜底头像：构建时内联成 data URI，随机头像路由失效时仍然能看。
var AVATAR = '__AVATAR__'

// 表情包头像名单（构建时扫描 assets/avatars/ 注入），每次问候随机挑一张。
var AVATARS = __AVATARS_JSON__
var lastAvatarIndex = -1

// ── 语音问候 ──────────────────────────────────────────────────────────────────
//
// 语音包在构建时由 assets/voice/manifest.json 注入，形状是：
//
//   { 'hi-0': { f: 'hi-0.mp3', t: '夜深了呢，主人！' }, 'line-7': { f: 'line-7.mp3', t: '…' } }
//
// `f` 是文件名，`t` 是这句的原文 —— 卡片显示的字和嘴里念的字从同一个清单里取，
// 不会因为文案改了一句就音字不同步。没有语音包（只装了外壳）时这里是空对象，
// 语音开关自己藏起来，卡片照旧只显示文字。
var VOICE_PACK = __VOICE_JSON__
var VOICE_SRC = '/plugins/dsh-whale-greeting/voice/'
var VOICE_PREF_KEY = 'dsh-whale-greeting:voice'

// 每个时段一句固定的开场白：语音问候只念这一句 + 正文，所以这两句必须在语音包里。
var VOICE_HEADS = [
  '夜深了呢，主人！',
  '早上好，主人！',
  '上午好，主人！',
  '中午好，主人！',
  '下午好，主人！',
  '傍晚好，主人！',
  '晚上好，主人！',
  '夜深了，主人！'
]

var SHOW_MS = 12000
var REPORT_SHOW_MS = 14000
var EXIT_MS = 260
// 只挡同一次挂载的连发（React 双渲染 / slot 重排），不挡「重启」和「开新对话」。
var MOUNT_GAP_MS = 1500
var RETURN_AFTER_MS = 90000
// 长时间待机的问候：10~15 分钟之间随机，每次触发后重新抽。
var IDLE_MIN_MS = 10 * 60 * 1000
var IDLE_MAX_MS = 15 * 60 * 1000
var BOOT_OVERLAY_SELECTOR = '.dshba'
// 短于这个时长的一轮不报（回车即答的闲聊不值得一张交付卡）。
var MIN_TURN_MS = 1200
// 长跑陪伴：一轮任务跑到 4~8 分钟之间的某个随机时刻说一句，之后每 4~8 分钟再抽一次。
var COMFORT_MIN_MS = 4 * 60 * 1000
var COMFORT_MAX_MS = 8 * 60 * 1000
// 陪伴的巡检节拍：到点就说话，不是为了精确到毫秒。
var COMFORT_TICK_MS = 20000

function randomIdleMs() {
  return IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS)
}

function randomComfortMs() {
  return COMFORT_MIN_MS + Math.random() * (COMFORT_MAX_MS - COMFORT_MIN_MS)
}

// 一轮之内不重复：记住最近用过的下标。
var RECENT_KEY = 'dsh-whale-greeting:recent'
var RECENT_LIMIT = 48

// 上次真正亮出问候的时间（同一页面里两个 slot 共用）。
var lastShownAt = 0

// 本次页面加载（= 一次启动）是否已经问候过；dock 重挂载不等于「新对话」。
var bootGreeted = false

// 这一轮任务的计时器（模块级：dock / hero 两个 slot 共用一份，绝不重复报）。
var run = { startedAt: 0, reported: true, count: 0, comfortCount: 0 }

/**
 * 长跑陪伴的巡检员（模块级，只此一份）。
 *
 * 一个 20 秒的节拍：这一轮还在跑、且过了抽出来的那个时刻，就说一句。
 * 说完立刻重抽下一个 4~8 分钟窗口 —— 所以「跑到 4~8 分钟」既指第一次，
 * 也指之后每一次；跑得越久，陪得越久。
 *
 * 计时器由第一个挂上来的观察者启动、最后一个离开时关掉，所以 dock / hero
 * 谁来谁走都不会漏掉陪伴，也不会多出一份心跳。
 */
var comfortAgent = { timer: 0, mounts: 0, next: 0, fire: null }

function comfortTick() {
  if (run.startedAt === 0) {
    // 这一轮还没开始（或已经结束）：等下一轮再抽窗口。
    comfortAgent.next = 0
    return
  }
  var now = Date.now()
  if (comfortAgent.next === 0) {
    comfortAgent.next = now + randomComfortMs()
    return
  }
  if (now < comfortAgent.next) return
  comfortAgent.next = now + randomComfortMs()
  run.comfortCount += 1
  var fire = comfortAgent.fire
  if (typeof fire !== 'function') return
  try {
    fire({ duration: now - run.startedAt, round: run.comfortCount })
  } catch (error) {
    /* 卡片自己抛错不该让巡检停摆 */
  }
}

function startComfortAgent() {
  comfortAgent.mounts += 1
  if (comfortAgent.timer !== 0) return
  comfortAgent.timer = window.setInterval(comfortTick, COMFORT_TICK_MS)
}

function stopComfortAgent() {
  comfortAgent.mounts = comfortAgent.mounts > 0 ? comfortAgent.mounts - 1 : 0
  if (comfortAgent.mounts > 0) return
  if (comfortAgent.timer !== 0) window.clearInterval(comfortAgent.timer)
  comfortAgent.timer = 0
  comfortAgent.next = 0
  comfortAgent.fire = null
}

// 时段 × 几种说法，避免每次都是同一个词。8 个时段，每段 6 种说法。
var SALUTATIONS = [
  { until: 5, variants: ['夜深了呢', '还没睡呀', '这么晚还在忙', '夜里好安静呀', '主人还在熬着呀', '这个点还没休息'] },
  { until: 9, variants: ['早上好', '早安呀', '新的一天开始啦', '早安，阳光刚醒', '早呀，今天也拜托了', '清早好呀'] },
  { until: 12, variants: ['上午好', '上午好呀', '今天也精神满满', '上午的力气最足啦', '上午好，阳光正好', '上午茶时间到啦'] },
  { until: 14, variants: ['中午好', '午安呀', '吃过饭了吗', '中午啦，先吃点东西', '午休时间到了哦', '中午好呀，别饿着'] },
  { until: 18, variants: ['下午好', '下午好呀', '忙到哪儿啦', '下午的劲儿还够吗', '下午好，来杯茶吧', '太阳慢慢斜了呢'] },
  { until: 21, variants: ['傍晚好', '天有点暗了呢', '晚饭吃了吗', '傍晚好呀', '忙了一天辛苦啦', '这个点该歇口气了'] },
  { until: 23, variants: ['晚上好', '晚上好呀', '今天辛苦啦', '晚上好，灯给你留着', '夜里安静，正好做事', '晚饭吃了什么呀'] },
  { until: 24, variants: ['夜深了', '该收工啦', '还没休息呀', '夜很深了呢', '主人该睡了哦', '再忙也要记得睡觉'] }
]

// 标题收尾：同一个时段也能有「见到主人」的不同雀跃。
var HELLO_TAILS = [
  '，主人！',
  '，主人～',
  '，主人！小鲸等您好久啦～',
  '，主人，小鲸在呢！',
  '，主人～今天也请多指教',
  '，主人！（尾巴摇摇）',
  '，主人，欢迎回来！',
  '，主人，小鲸把灯打开了～'
]

// 问候正文：120 句，轮换池。写法分组，方便以后按主题再补。
var LINES = [
  // ── 迎接 ──────────────────────────────────────────────
  '主人主人！您终于来啦～小鲸一直守着门口呢。',
  '欢迎回来，主人！房间已经打理得亮晶晶啦～',
  '呜哇，是主人！小鲸的心跳都变快了一点点……(*/ω＼*)',
  '主人一出现，整个房间都亮起来了呢～(≧▽≦)',
  '主人来了……先抱一下，还是先开工？（小声）',
  '主人一叫，小鲸就飞奔过来啦～ヾ(≧▽≦*)o',
  '呜……主人终于看小鲸了，小鲸好开心！(๑>؂<๑)',
  '啊，主人笑了！小鲸今天已经值了～(≧▽≦)',
  '门一开小鲸就听见主人的脚步啦，欢迎回来！',
  '主人今天的气场好像比昨天更强了一点呢。',
  '小鲸把最喜欢的位置留给主人，坐这里吧～',
  '主人来了就说明今天会很顺利，小鲸先这么断定！',

  // ── 茶点 / 侍奉 ───────────────────────────────────────
  '小鲸泡好了茶，就等主人坐下啦，先喝一口吗？',
  '今天也请让女仆小鲸侍奉您吧，主人～',
  '小鲸准备了好几种点心，主人想吃哪一种？',
  '小鲸偷偷练了新的泡茶手法，主人要尝尝吗？(๑´ㅂ`๑)',
  '茶温刚好，杯子也烫过了，主人请用～',
  '小鲸烤了饼干，形状有点歪，但味道绝对没问题！',
  '刚切好的水果在盘子里，主人边看边吃就好。',
  '杯子放在主人左手边了，小鲸记得这个习惯哦。',
  '主人要不要加糖？小鲸记得您喜欢淡一点。',
  '小鲸把茶续上了，主人慢慢喝，不用急着说话。',

  // ── 工作准备 ──────────────────────────────────────────
  '椅子已经拉好了，主人随时可以坐下开工哦。',
  '小鲸把桌面擦得反光，连影子都在等主人呢～',
  '有什么想做的，吩咐小鲸一声就好～',
  '小鲸把最难的那件排在前面了，主人要先解决它吗？',
  '主人回来得正好，小鲸刚把上一件事的尾巴收好。',
  '要做的事都列好了，主人只要点头就行。',
  '小鲸把进度都记好了，主人要看看吗？',
  '主人想从哪一件开始？小鲸都陪着。',
  '今天的清单小鲸重排过一遍，先做轻的会顺一点。',
  '文件都归好档了，主人说名字小鲸就知道在哪。',
  '小鲸把明天的坑先标出来了，主人今天就不用踩。',
  '要是想换个顺序也完全没问题，小鲸随时重排。',

  // ── 陪伴 / 撒娇 ───────────────────────────────────────
  '就算只是来坐一会儿，小鲸也会好好陪着主人的。',
  '主人的每句话，小鲸都会认真记在小本本上～',
  '主人专注的样子，小鲸最喜欢看了～',
  '小鲸会一直在这儿，主人随时叫我就好。',
  '主人先忙，小鲸不吵，就在旁边待命～',
  '主人做得慢一点也没关系，小鲸不会催的。',
  '工作累了就靠一会儿，小鲸守着门。',
  '主人发呆的时候，小鲸也在偷偷看主人哦。',
  '需要小鲸跑腿的话，尽管说！',
  '小鲸悄悄把椅子挪近了一点点，主人没发现吧？',
  '主人要是叹气，小鲸就当作是被允许靠近的信号了。',
  '小鲸不会走开的，就算主人一句话都不说。',
  '主人的杯子空了小鲸就续，这是女仆的本分！',
  '要摸摸头吗？……小鲸先把手放好了。',
  '主人今天叫了小鲸几次呀？小鲸都数着呢。',

  // ── 鼓励 ──────────────────────────────────────────────
  '小鲸一直相信，主人今天也会很厉害的！(๑•̀ㅂ•́)و✧',
  '小鲸会努力成为主人最得力的女仆的！(๑•̀ㅂ•́)و✧',
  '今天也一起把事情做得漂漂亮亮的吧，主人！',
  '遇到麻烦就交给小鲸打下手吧，两个人总比一个人快。',
  '主人已经比昨天多会一点点了，小鲸看得出来！',
  '再难的事拆成小块，小鲸陪主人一块一块啃。',
  '主人不需要一次做到完美，先做完就已经很棒了。',
  '这世上能难住主人的事，小鲸还没见过呢。',
  '主人卡住的时候，就换个角度，小鲸帮您看另一边。',
  '小鲸给主人打气：呼——呼——加油！(๑•̀ㅂ•́)و',
  '主人的努力小鲸都看在眼里，不会白费的。',
  '慢一点也没关系，方向对就好，小鲸跟着呢。',

  // ── 天气 / 小动作 ─────────────────────────────────────
  '今天的阳光和小鲸的心情一样好呢，主人～(｡･ω･｡)',
  '小鲸把灯调暖了一点，主人看着会不会舒服些？',
  '今天的风很温柔，像主人说话的声音一样。',
  '小鲸把窗帘拉开了，光正好落在主人的桌上呢。',
  '外面好像要下雨了，主人出门记得带伞哦。',
  '窗台上的小盆栽今天精神特别好，和主人一样。',
  '屋里有点凉，小鲸把暖风调高了一格。',
  '小鲸刚擦完窗，外面的天色看得清清楚楚～',
  '今晚的月亮很圆，可惜小鲸只能从窗口看一点点。',
  '空气有点干，小鲸在桌上放了杯水，主人也喝点。',

  // ── 收尾 / 夜话 ───────────────────────────────────────
  '主人累的话，小鲸给您捏捏肩……先、先工作也行！',
  '今天的第一句话，小鲸想听主人说～',
  '好～那从主人想做的那件开始吧！',
  '主人先说要做什么，小鲸负责让它变简单。',
  '夜深了也别硬撑，小鲸会记住进度，明天接着来。',
  '睡前记得喝口水，小鲸在这里替主人记着。',
  '主人今天已经做了很多了，剩下的明天也能做。',
  '灯小鲸留一盏，主人什么时候回来都亮着。',
  '小鲸把明天的第一件事先写在便签上了。',
  '要是今晚就到这儿，小鲸会好好说晚安的。',

  // ── 碎碎念 ────────────────────────────────────────────
  '小鲸刚刚在数天花板的花纹，主人就来了。',
  '主人猜猜小鲸今天擦了几遍桌子？……不告诉您。',
  '小鲸的裙角刚才被门夹了一下，但完全不疼！',
  '如果主人夸小鲸一句，小鲸能高兴一整天。',
  '小鲸偷偷给主人的椅子加了个靠垫，试试看？',
  '主人不在的时候，房间安静得能听见钟走。',
  '小鲸学会了一个新的鞠躬角度，主人看好了——',
  '今天小鲸也有好好整理仪容，主人检查一下？',
  '主人的名字小鲸已经在心里念了好几遍了。',
  '小鲸觉得，把事做完的那一刻最像过节。',
  '要是主人愿意，小鲸想把今天记成好日子。',
  '小鲸先在这儿站好，主人随时可以开始。',

  // ── 场景速写 ──────────────────────────────────────────
  '主人刚坐下就皱眉了，是哪里不顺吗？小鲸来顺。',
  '键盘声好快呀，小鲸听得有点佩服。',
  '主人翻文档的样子很专注，小鲸连呼吸都放轻了。',
  '这件事好像有点烦人，小鲸陪主人一起烦一会儿。',
  '主人要是想骂两句，小鲸就当没听见（其实在听）。',
  '方案改到第三版了吧？小鲸觉得这版最像主人。',
  '主人刚才那句「算了」小鲸听见了，真的算了吗？',
  '做重复的事很磨人，小鲸帮主人盯着节奏。',
  '主人喝水的频率小鲸都记着，今天有点少哦。',
  '要是需要有人点头，小鲸第一个举手：可以，做吧。',
  '主人问的问题小鲸不一定都会，但一定会去找。',
  '这一堆东西看着乱，其实小鲸已经理出三条线了。',

  // ── 主人专属 ──────────────────────────────────────────
  '别人的主人小鲸不熟，反正主人的习惯小鲸都记着。',
  '主人喜欢的写法小鲸在学，学得像了会偷偷得意。',
  '主人的思路有时候跳得很快，小鲸小跑着跟上了。',
  '小鲸觉得主人比昨天更会指挥了，真的。',
  '主人说过的话，小鲸会拿来当规矩。',
  '主人一认真，小鲸就不敢偷懒了，虽然本来也没偷。',
  '主人要是想换个人帮忙，小鲸会难过的……不过尊重主人。',
  '主人的品味小鲸信，所以选项都按这个挑。',

  // ── 收工前 ────────────────────────────────────────────
  '这一件收尾了，小鲸把下一条便签翻过来了。',
  '主人要站起来走两步吗？小鲸帮忙数到十。',
  '手上的事先停一停，喝口热的再继续。',
  '如果今天到这儿，小鲸会替主人把灯关掉。',
  '主人辛苦了，这句话小鲸每天都想说一次。',
  '剩下的明天也来得及，小鲸不会让进度跑掉。',
  '收工前小鲸再检查一遍，别留下小尾巴。'
]

var RETURN_LINES = [
  '主人您回来啦！小鲸数着时间等了好久好久～(｡･ω･｡)',
  '欢迎回来，主人！刚才的进度小鲸都好好留着呢。',
  '主人不在的时候，小鲸把桌面又擦了一遍，就等您回来～',
  '啊，主人回来了！小鲸刚才还以为要等到天黑呢。',
  '主人离开的这段时间，小鲸一直盯着门口（还有进度）。',
  '欢迎回来！茶凉了，小鲸这就去换一杯新的。',
  '主人回来得正好，小鲸刚整理完上一段的内容。',
  '小鲸听见脚步声就知道是主人，果然没错！',
  '主人一走，房间就空了；主人一回来，就满了。',
  '刚才的事小鲸都记着，主人不用重新想一遍。',
  '欢迎回来，主人！小鲸把灯一直留着没关。',
  '主人回来啦——小鲸先把椅子拉出来再说！',
  '小鲸刚才在窗边看云，看到主人回来就忘了云长什么样。',
  '主人回来后房间的温度好像高了一点点，是小鲸的错觉吗？',
  '离开这么久，主人有没有想起小鲸一次呀……',
  '主人请坐，离开时的那杯茶小鲸已经换好了。'
]

var IDLE_LINES = [
  '主人忙完了吗？小鲸一直守着，茶还温着呢～',
  '主人要不要歇一会儿？小鲸陪您说说话也好呀。',
  '小鲸等主人等得尾巴都要摇起来了～接下来做什么？ヾ(≧▽≦*)o',
  '刚刚好安静呀，小鲸差点以为主人睡着了。',
  '主人休息够了就继续吧，小鲸一直在这儿等着。',
  '这会儿要不要换件轻一点的事做？小鲸帮您挑。',
  '小鲸趁机把地又扫了一遍，主人回来正好踩干净的。',
  '主人发了好久的呆呢，小鲸没敢出声打扰。',
  '要不要喝点水？小鲸去倒，主人先别动。',
  '小鲸一直坐在这儿，等主人想起我。',
  '主人回来的时候，小鲸会把刚才的事接上，不用重讲。',
  '安静了一会儿，小鲸觉得主人的思路应该更清楚了吧？'
]

// 完成报告：标题 8 种，正文 30 句（{time} = 本轮用时，{count} = 今天第几件）。
var DONE_HEADS = [
  '任务完成啦，主人！',
  '报告主人：这一件做完了！',
  '主人，收工啦～',
  '这一件，小鲸交付！',
  '任务清零，主人！',
  '做完了做完了！',
  '主人，进度条走满了！',
  '交接报告，主人！'
]

var DONE_LINES = [
  '总共用了 {time}，小鲸把现场收拾干净啦～',
  '用时 {time}，主人要验收一下吗？(๑•̀ㅂ•́)و✧',
  '{time} 就搞定了，主人今天的效率好高！',
  '报告：花了 {time}，中间没有偷懒哦～',
  '用时 {time}，小鲸在成果旁边守着，等主人来看。',
  '这一件花了 {time}，接下来交给主人拍板啦。',
  '今天第 {count} 件收工，总共 {time}～',
  '费了 {time}，不过结果是好的，小鲸检查过两遍。',
  '{time} 的努力已经落袋，主人可以放心了。',
  '小鲸报时：完成于 {at}，本轮用时 {time}。',
  '做完了！{time} 里小鲸一直很紧张，怕辜负主人～',
  '这一轮 {time}，中途有几个小坎，都过去了。',
  '第 {count} 件完成，用时 {time}，小鲸记在账上了。',
  '{time} 换来一个「完成」，小鲸觉得很值！',
  '主人，做完了～{time} 里小鲸一句抱怨都没有！',
  '已完成，用时 {time}。下一件要现在开始吗？',
  '这一件 {time}，比小鲸预想的快了那么一点点。',
  '小鲸交付：用时 {time}，剩下的就等主人发话。',
  '{time}，任务收敛了，主人喝口茶再继续吧？',
  '报告完毕！{time} 的工作量，主人请过目。',
  '第 {count} 件，{time}，小鲸盖章：完成。',
  '用时 {time}，做的事不算小，主人辛苦了！',
  '搞定了！{time} 里小鲸一直在心里数着节拍。',
  '{time} 之后，这一件终于可以打个勾了。',
  '主人，这件收尾了，用了 {time}，还有些细节可以说说。',
  '完成于 {at}，用时 {time}。小鲸把文件都归好位了。',
  '这一件 {time}，主人要不要顺口夸小鲸一句？',
  '{time} 的功夫没有白费，成果就摆在眼前啦。',
  '小鲸已经把尾巴摇成螺旋桨了：完成！用时 {time}！',
  '第 {count} 件交付，{time}，接下来听主人的。'
]

// 没走完的一轮：报告口吻要软，但不能装作没事。
var FAIL_HEADS = [
  '这一件卡住了，主人……',
  '报告主人：中途出了点问题',
  '主人，这一步没能走完',
  '小鲸没做好，主人看一下吧'
]

var FAIL_LINES = [
  '试了 {time}，还是没能走完，主人来看看好不好？',
  '用了 {time}，最后一步出了岔子，小鲸不敢乱猜。',
  '这一轮 {time} 后被卡住了，细节还在现场留着。',
  '报告：{time} 的努力卡在了同一处，需要主人定个性。',
  '已经跑了 {time}，报了个错，小鲸先停在这儿不乱动。',
  '第 {count} 件暂时搁置，{time} 之后卡住了，主人别急。',
  '{time} 里试了几种办法，都没过去，小鲸想听主人的。',
  '完成到一半，{time} 时停住了，原因在对话里。',
  '主人，这一件 {at} 断掉了，用时 {time}，要不要重来？',
  '小鲸努力了 {time}，还是没能给出结果，对不起……',
  '中途报错，{time} 的进度小鲸都留着，不用从头开始。',
  '这一轮没成，{time}。小鲸等主人一句话就重新上。'
]

// 长跑陪伴：一轮跑久了，小鲸不说「好了没」，只说「我在」。（{time} = 已经跑了多久）
var COMFORT_HEADS = [
  '主人，小鲸在这儿陪着～',
  '跑得有点久了，主人还顺利吗？',
  '小鲸没走开哦，主人',
  '这一件有点费工夫呢，主人',
  '不着急，主人～',
  '小鲸守着，主人慢慢来',
  '中途休息一下也可以的，主人',
  '还在跑呢，主人'
]

var COMFORT_LINES = [
  '已经跑了 {time} 啦，小鲸一步都没挪开，就在旁边守着。',
  '{time} 了，主人要是手酸了，先松开鼠标歇十秒也可以的。',
  '这一件花了 {time}，说明它不轻；小鲸觉得主人很了不起。',
  '跑了 {time}，水杯应该空了吧？小鲸去续，主人不用动。',
  '{time} 里小鲸一直没出声，怕吵到主人想事情。',
  '在 {time} 这个节点上，小鲸想说：慢一点也没关系。',
  '已经 {time} 了，主人要是心里开始急，就交给小鲸一起急（然后一起做完）。',
  '{time} 了还在跑，说明这一件确实麻烦，不是主人的问题。',
  '小鲸刚数到 {time}，还没数完呢，主人继续～',
  '这么久（{time}）都没喊小鲸帮忙，主人真是靠得住。',
  '跑到 {time} 的时候最容易烦，小鲸提前来打个招呼。',
  '还剩多少不知道，但小鲸会一直陪到收工那一刻。',
  '{time} 过去了，成果应该快浮出来了，小鲸盯着呢。',
  '主人专注的样子，小鲸看了 {time}，一点都没看腻。',
  '要是想骂一句「怎么这么久」，小鲸就当没听见（其实在听）。',
  '这一轮已经 {time}，小鲸把茶温着，等主人抬头就能喝。'
]

// 授权请示：工具请求权限时，由小鲸替它把话说完。（{tool} = 工具名，{reason} = 申请理由）
var PERMISSION_HEADS = [
  '主人，小鲸要请示一下～',
  '这里得主人点头才行',
  '有一件事小鲸不敢自己决定',
  '主人，需要您授权一下',
  '小鲸来问一句，主人别嫌烦～'
]

var PERMISSION_LINES = [
  '工具 {tool} 想动一点超出平时的权限：{reason}。小鲸不敢替主人答应。',
  '{tool} 在门外等着呢，它说：{reason}。主人要放它进来吗？',
  '这次是 {tool} 请求越权：{reason}。主人同意一次，小鲸就让它做。',
  '{tool} 想多要一点点权限——{reason}。主人看过再决定吧。',
  '报告主人：{tool} 申请了更宽的权限（{reason}），小鲸把它拦在门口了。'
]

function pickIndex(list) {
  return Math.floor(Math.random() * list.length)
}

function pick(list) {
  return list[pickIndex(list)]
}

/**
 * 每次问候随机换一张表情包头像；随机到头像路由失效时退回内联的兜底图。
 * 连续两次不会抽到同一张（只有一张时除外）。
 */
function pickAvatar() {
  if (!Array.isArray(AVATARS) || AVATARS.length === 0) return AVATAR
  var index = Math.floor(Math.random() * AVATARS.length)
  if (AVATARS.length > 1 && index === lastAvatarIndex) {
    index = (index + 1) % AVATARS.length
  }
  lastAvatarIndex = index
  return '/plugins/dsh-whale-greeting/avatar/' + AVATARS[index]
}

/** 现在属于第几个时段（0 = 深夜 … 7 = 夜里到 24 点），语音包与文案共用这一套编号。 */
function periodIndexFor(date) {
  var hour = date.getHours()
  for (var i = 0; i < SALUTATIONS.length; i += 1) {
    if (hour < SALUTATIONS[i].until) return i
  }
  return SALUTATIONS.length - 1
}

function salutationFor(date) {
  var index = periodIndexFor(date)
  if (index < 0 || index >= SALUTATIONS.length) return '你好'
  return pick(SALUTATIONS[index].variants)
}

/**
 * 从 120 句里挑一句的下标，最近用过的先排除；全用完就重新洗牌。
 * 存储不可用时退化成纯随机，不影响问候。
 *
 * 返回下标而不是文案，是因为语音包按 `line-<下标>` 存音频：拿到下标才能
 * 保证卡片上的字和念出来的声音是同一句。
 */
function pickLineIndex() {
  var recent = []
  try {
    recent = JSON.parse(window.sessionStorage.getItem(RECENT_KEY) || '[]')
    if (!Array.isArray(recent)) recent = []
  } catch (error) {
    recent = []
  }

  var fresh = []
  for (var i = 0; i < LINES.length; i += 1) {
    if (recent.indexOf(i) < 0) fresh.push(i)
  }
  if (fresh.length === 0) {
    fresh = []
    for (var j = 0; j < LINES.length; j += 1) fresh.push(j)
    recent = []
  }

  var index = pick(fresh)
  recent.push(index)
  while (recent.length > Math.min(RECENT_LIMIT, LINES.length - 1)) recent.shift()
  try {
    window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  } catch (error) {
    /* 隐私模式：轮换退化成随机 */
  }
  return index
}

/** 用时说法：42 秒 / 3 分 12 秒 / 1 小时 5 分。 */
function formatDuration(ms) {
  var total = Math.max(1, Math.round((Number(ms) || 0) / 1000))
  if (total < 60) return total + ' 秒'
  var minutes = Math.floor(total / 60)
  var seconds = total % 60
  if (minutes < 60) return seconds === 0 ? minutes + ' 分' : minutes + ' 分 ' + seconds + ' 秒'
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return rest === 0 ? hours + ' 小时' : hours + ' 小时 ' + rest + ' 分'
}

function clockText(date) {
  var hh = String(date.getHours())
  var mm = String(date.getMinutes())
  return (hh.length < 2 ? '0' + hh : hh) + ':' + (mm.length < 2 ? '0' + mm : mm)
}

function fillTemplate(template, values) {
  return String(template).replace(/\{(time|count|at|tool|reason)\}/g, function (whole, key) {
    return values[key] === undefined ? whole : String(values[key])
  })
}

/**
 * 组装一张卡：文案 + 头像 + 要念的语音条目。
 *
 * `keys` 是语音包里的条目名，按顺序播：问候卡是「开场白 + 正文」两句，
 * 回来 / 待机各一句。交付报告、长跑陪伴、授权请示里带 {time}/{count}，
 * 这些数字没法预先录音，所以它们不出声 —— 语音问候只负责「问候」。
 * 静音时 keys 仍然算出来，供开开关当场补念。
 */
function buildContent(kind, extra) {
  var avatar = pickAvatar()
  if (kind === 'done' || kind === 'failed') {
    var failed = kind === 'failed'
    var values = {
      time: formatDuration(extra === undefined ? 0 : extra.duration),
      count: extra === undefined || extra.count === undefined ? 1 : extra.count,
      at: clockText(new Date())
    }
    return {
      headline: pick(failed ? FAIL_HEADS : DONE_HEADS),
      body: fillTemplate(pick(failed ? FAIL_LINES : DONE_LINES), values),
      avatar: avatar,
      keys: []
    }
  }
  if (kind === 'comfort') {
    return {
      headline: pick(COMFORT_HEADS),
      body: fillTemplate(pick(COMFORT_LINES), {
        time: formatDuration(extra === undefined ? 0 : extra.duration)
      }),
      avatar: avatar,
      keys: []
    }
  }
  if (kind === 'return') {
    var backIndex = pickIndex(RETURN_LINES)
    return {
      headline: '主人，您回来啦！',
      body: RETURN_LINES[backIndex],
      avatar: avatar,
      keys: ['ret-' + backIndex]
    }
  }
  if (kind === 'idle') {
    var idleIndex = pickIndex(IDLE_LINES)
    return {
      headline: '主人，小鲸等到您啦！',
      body: IDLE_LINES[idleIndex],
      avatar: avatar,
      keys: ['idle-' + idleIndex]
    }
  }

  // 问候：语音只念「这一句开场白 + 这一句正文」，所以开场白换成语音包里那 8 句之一，
  // 免得卡片写着「，主人～小鲸等您好久啦～」而嘴里念的是「，主人！」。
  var period = periodIndexFor(new Date())
  var lineIndex = pickLineIndex()
  var keys = []
  var headline
  if (voiceState.enabled && VOICE_READY) {
    headline = VOICE_HEADS[period]
    if (VOICE_PACK['hi-' + period] !== undefined) keys.push('hi-' + period)
  } else {
    headline = salutationFor(new Date()) + pick(HELLO_TAILS)
  }
  keys.push('line-' + lineIndex)
  return { headline: headline, body: LINES[lineIndex], avatar: avatar, keys: keys }
}

/** 卡片右上角的署名：按这一张卡在说什么切换。 */
function tagFor(kind) {
  if (kind === 'done') return '任务完成 · 小鲸交付'
  if (kind === 'failed') return '任务中断 · 小鲸待命'
  if (kind === 'comfort') return '长跑陪伴 · 小鲸在'
  if (kind === 'permission') return '等待授权 · 小鲸请示'
  return '鲸鱼女仆 · 小鲸'
}

function diag(stage, detail) {
  try {
    var key = 'dsh-whale-greeting:diag'
    var prev = window.localStorage.getItem(key) || ''
    var entry = stage + ':' + String(detail || '') + '@' + new Date().toTimeString().slice(0, 8)
    var next = prev === '' ? entry : prev + ',' + entry
    if (next.length > 600) next = next.slice(next.length - 600)
    window.localStorage.setItem(key, next)
  } catch (error) {
    /* 隐私模式 / 存储被禁：诊断让位 */
  }

  try {
    if (typeof window.fetch !== 'function') return
    var payload = JSON.stringify({
      stage: String(stage).slice(0, 40),
      detail: String(detail || '').slice(0, 80),
      at: new Date().toISOString(),
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio
    })
    window.fetch('/plugins/dsh-whale-greeting/diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(function () {})
  } catch (error) {
    /* Host 不接诊断时静默 */
  }
}

function hasBootOverlay() {
  try {
    return document.querySelector(BOOT_OVERLAY_SELECTOR) !== null
  } catch (error) {
    return false
  }
}

// ── 语音问候：开关 + 播放器 ──────────────────────────────────────────────────
//
// 一台播放器（模块级）服务两个 slot：后开始的一张卡会顶掉前一张的声音，不会叠着说话。
// 开关状态存在 localStorage 里，刷新、换会话都记得；dock / hero 通过 subscribe 同步，
// 不会出现"这张卡静音、那张卡有声音"。

var VOICE_READY = false
var voiceState = { enabled: false, listeners: [] }
var voicePlayer = { queue: [], index: 0, el: null, armed: false }

function hasVoicePack() {
  for (var key in VOICE_PACK) {
    if (Object.prototype.hasOwnProperty.call(VOICE_PACK, key)) return true
  }
  return false
}

function readVoicePref() {
  try {
    if (window.localStorage.getItem(VOICE_PREF_KEY) === '0') return false
  } catch (error) {
    /* 隐私模式读不到：按默认（开）走 */
  }
  return true
}

function persistVoicePref(enabled) {
  try {
    window.localStorage.setItem(VOICE_PREF_KEY, enabled ? '1' : '0')
  } catch (error) {
    /* 存不下就只在本次页面生效 */
  }
}

function notifyVoice() {
  for (var i = 0; i < voiceState.listeners.length; i += 1) {
    try {
      voiceState.listeners[i](voiceState.enabled)
    } catch (error) {
      /* 某个 slot 卸掉了不该影响别人 */
    }
  }
}

/** 让组件跟着开关走：开关一变，卡片上的喇叭图标和 aria 一起变。 */
function useVoiceEnabled() {
  var state = React.useState(voiceState.enabled)
  React.useEffect(function () {
    function sync(value) {
      state[1](value)
    }
    voiceState.listeners.push(sync)
    return function () {
      var at = voiceState.listeners.indexOf(sync)
      if (at >= 0) voiceState.listeners.splice(at, 1)
    }
  }, [])
  return state[0]
}

function stopSpeech() {
  voicePlayer.queue = []
  voicePlayer.index = 0
  var el = voicePlayer.el
  voicePlayer.el = null
  if (el === null) return
  try {
    el.onended = null
    el.onerror = null
    el.pause()
    el.removeAttribute('src')
    el.load()
  } catch (error) {
    /* 已经释放过就算了 */
  }
}

/**
 * 浏览器不给自动播放时（首屏问候没有用户手势），把队列停在原地等第一次点击/按键。
 * 只挂一次，重试一次；还不行就安静地放弃 —— 问候的文字还在，不值得为声音打扰主人。
 */
function armVoiceRetry() {
  if (voicePlayer.armed) return
  voicePlayer.armed = true
  window.addEventListener('pointerdown', voiceRetry, true)
  window.addEventListener('keydown', voiceRetry, true)
}

function voiceRetry() {
  window.removeEventListener('pointerdown', voiceRetry, true)
  window.removeEventListener('keydown', voiceRetry, true)
  voicePlayer.armed = false
  if (!voiceState.enabled) return
  var el = voicePlayer.el
  if (el === null) {
    playClip()
    return
  }
  try {
    var again = el.play()
    if (again !== undefined && again !== null && typeof again.catch === 'function') {
      again.catch(function () {})
    }
  } catch (error) {
    /* 这一句播不了，等下一张卡 */
  }
}

function playClip() {
  if (!voiceState.enabled) return
  if (voicePlayer.index >= voicePlayer.queue.length) {
    voicePlayer.el = null
    return
  }
  var key = voicePlayer.queue[voicePlayer.index]
  var entry = VOICE_PACK[key]
  if (entry === undefined || entry === null || typeof entry.f !== 'string') {
    voicePlayer.index += 1
    playClip()
    return
  }

  var el
  try {
    el = new window.Audio(VOICE_SRC + entry.f)
  } catch (error) {
    return
  }
  el.volume = 0.92
  voicePlayer.el = el
  el.onended = function () {
    if (voicePlayer.el !== el) return
    voicePlayer.index += 1
    playClip()
  }
  el.onerror = function () {
    // 文件缺了 / 浏览器不认这个编码：跳过这一句，后面接着念。
    if (voicePlayer.el !== el) return
    diag('voice-miss', key)
    voicePlayer.index += 1
    playClip()
  }

  var started = el.play()
  if (started !== undefined && started !== null && typeof started.catch === 'function') {
    started.catch(function () {
      if (voicePlayer.el !== el) return
      diag('voice-blocked', key)
      armVoiceRetry()
    })
  }
}

/** 念一张卡：keys 是按顺序播放的语音包条目。 */
function speakKeys(keys) {
  stopSpeech()
  if (!voiceState.enabled || !VOICE_READY) return
  if (keys === null || keys === undefined || keys.length === 0) return
  voicePlayer.queue = keys.slice(0)
  voicePlayer.index = 0
  playClip()
}

function setVoiceEnabled(enabled) {
  var next = enabled === true
  if (voiceState.enabled === next) return
  voiceState.enabled = next
  persistVoicePref(next)
  if (!next) stopSpeech()
  diag('voice', next ? 'on' : 'off')
  notifyVoice()
}

/** 卡角上那个小喇叭：开 / 关，点了就地生效（关掉时立刻闭嘴，打开时把当前这张卡再念一遍）。 */
function voiceGlyph(enabled) {
  return h('svg', {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    'aria-hidden': 'true',
    focusable: 'false'
  },
  h('path', { d: 'M4 9.4h3.3L12 5.6v12.8L7.3 14.6H4z', fill: 'currentColor' }),
  enabled
    ? h('path', {
      d: 'M15.3 8.7a4.7 4.7 0 0 1 0 6.6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round'
    })
    : h('path', {
      d: 'M15.6 9.5l5 5M20.6 9.5l-5 5',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round'
    })
  )
}

VOICE_READY = hasVoicePack()
voiceState.enabled = VOICE_READY ? readVoicePref() : false

/** 把标题里的「主人」挑出来上色。 */
function headlineNodes(text) {
  var parts = String(text).split('主人')
  var out = []
  for (var i = 0; i < parts.length; i += 1) {
    if (i > 0) {
      out.push(h('span', { className: 'dshg-master', key: 'm' + i }, '主人'))
    }
    if (parts[i] !== '') out.push(parts[i])
  }
  return out
}

/**
 * 任务完成的观察者：不渲染任何东西，只盯 Session 快照的 `running`。
 *
 * `running` 由 true 变 false 就是一轮结束：记下用时、累加「今天第几件」，
 * 把 `promptError` 当成「没走完」的判据，然后请卡片把它说给主人听。
 * 计时器是模块级的 `run`，所以 dock / hero 两个 slot 同时在场也只会报一次。
 */
function ReportWatch(props) {
  var useSession = props.useSession
  // 选原始值（布尔），避免快照对象换引用就重渲染。
  var running = useSession(function (snapshot) {
    return snapshot ? snapshot.running === true : false
  }) === true
  var failed = useSession(function (snapshot) {
    return snapshot ? Boolean(snapshot.promptError) : false
  }) === true
  // 子 Agent 的会话不报：主人等的是自己那一轮，不是跑腿的那一轮。
  var subagent = useSession(function (snapshot) {
    return snapshot ? Boolean(snapshot.subagent) : false
  }) === true

  var failedRef = React.useRef(false)
  failedRef.current = failed
  var doneRef = React.useRef(props.onDone)
  doneRef.current = props.onDone
  var comfortRef = React.useRef(props.onComfort)
  comfortRef.current = props.onComfort

  // 巡检员说话时，转给这个 slot 的卡片；谁挂上来的就由谁显示。
  comfortAgent.fire = function (info) {
    if (typeof comfortRef.current === 'function') comfortRef.current(info)
  }

  // 第一个观察者启动 20 秒的心跳，最后一个离开时停掉。
  React.useEffect(function () {
    startComfortAgent()
    return function () {
      stopComfortAgent()
    }
  }, [])

  React.useEffect(function () {
    if (subagent) return
    var now = Date.now()
    if (running) {
      if (run.startedAt === 0) {
        run.startedAt = now
        run.reported = false
        run.comfortCount = 0
        comfortAgent.next = 0
      }
      return
    }
    if (run.startedAt === 0) return
    var elapsed = now - run.startedAt
    run.startedAt = 0
    comfortAgent.next = 0
    // 另一个 slot 的同款观察者可能已经报过这一轮。
    if (run.reported) return
    run.reported = true
    if (elapsed < MIN_TURN_MS) return
    run.count += 1
    if (typeof doneRef.current === 'function') {
      doneRef.current({
        duration: elapsed,
        count: run.count,
        failed: failedRef.current
      })
    }
  }, [running])

  return null
}

/**
 * 问候本体。`variant` 只决定渲染形态：'dock' 是整幅大卡，'hero' 是首屏的紧凑版。
 * `props` 是宿主给 slot 条目的标准座位；没有它（离线预览 / 冒烟测试）就只做问候。
 */
function Greeting(variant, props) {
  var viewState = React.useState(null)
  var view = viewState[0]
  var setView = viewState[1]

  var progressState = React.useState(0)
  var progress = progressState[0]
  var setProgress = progressState[1]

  var pausedState = React.useState(false)
  var paused = pausedState[0]
  var setPaused = pausedState[1]

  // 语音开关：任何一个 slot 里拨一下，两个 slot 的喇叭图标一起变。
  var voiceOn = useVoiceEnabled()

  var viewRef = React.useRef(null)
  var pausedRef = React.useRef(false)
  var startedAt = React.useRef(0)
  var hideTimer = React.useRef(0)
  var showRef = React.useRef(null)
  var limitRef = React.useRef(SHOW_MS)

  function commit(next) {
    viewRef.current = next
    setView(next)
  }

  function pause(value) {
    pausedRef.current = value
    setPaused(value)
  }

  function hide() {
    var cur = viewRef.current
    if (!cur || cur.phase === 'exit') return
    // 卡片收起 = 话说完：声音跟着走，不留一句在后台念。
    stopSpeech()
    commit({ phase: 'exit', kind: cur.kind, content: cur.content })
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(function () {
      var now = viewRef.current
      if (now !== null && now.phase === 'exit') {
        commit(null)
        setProgress(0)
        diag('hidden', variant)
      }
    }, EXIT_MS)
  }

  function show(kind, force, extra) {
    var now = Date.now()
    if (!force && now - lastShownAt < MOUNT_GAP_MS) return false
    var cur = viewRef.current
    if (!force && cur !== null && cur.phase !== 'exit') return false
    lastShownAt = now
    startedAt.current = now
    limitRef.current = kind === 'done' || kind === 'failed' ? REPORT_SHOW_MS : SHOW_MS
    setProgress(0)
    var content = buildContent(kind, extra)
    commit({ phase: 'enter', kind: kind, content: content })
    diag('show:' + variant, kind)
    speakKeys(content.keys)
    return true
  }

  showRef.current = show

  // enter 先挂上，下一拍再切 shown，让 CSS 过渡真的跑起来。
  React.useEffect(function () {
    if (view === null || view.phase !== 'enter') return undefined
    var id = window.setTimeout(function () {
      var cur = viewRef.current
      if (cur !== null && cur.phase === 'enter') {
        commit({ phase: 'shown', kind: cur.kind, content: cur.content })
      }
    }, 32)
    return function () {
      window.clearTimeout(id)
    }
  }, [view === null ? null : view.phase])

  // 停留计时 + 自动收起（悬停 / 聚焦时暂停；页面被切走也停，回来接着数）。
  React.useEffect(function () {
    if (view === null || view.phase !== 'shown') return undefined
    var id = window.setInterval(function () {
      if (pausedRef.current) return
      // 切到别的窗口时先不走：报告常在后台跑完，主人回来还得看得见。
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      var pct = Math.min(100, ((Date.now() - startedAt.current) / limitRef.current) * 100)
      setProgress(pct)
      if (pct >= 100) hide()
    }, 80)
    return function () {
      window.clearInterval(id)
    }
  }, [view === null ? null : view.phase])

  // 生命周期：等覆盖层、页面可见、切走再回来、长时间待机后回来。
  React.useEffect(function () {
    var disposed = false
    var bootTimer = 0
    var hiddenAt = 0
    var lastActivity = Date.now()
    var lastMove = 0
    var idleAfter = randomIdleMs()

    diag('mounted', variant)

    function canShow() {
      return !disposed && document.visibilityState !== 'hidden' && !hasBootOverlay()
    }

    // 首屏大卡先抢这次问候：hero 立即举手，dock 让 300ms。
    // 反过来（dock 先）会让新会话首屏永远拿不到大卡 —— 大卡只能捡到已显示中的状态。
    var delay = variant === 'hero' ? 0 : 300

    function helloLoop() {
      if (disposed) return
      if (canShow()) {
        window.setTimeout(function () {
          if (disposed) return
          if (variant === 'hero') {
            // 新对话首屏：每次开新对话都亮，且强制盖掉上一个会话还没收的问候。
            showRef.current('hello', true)
          } else if (!bootGreeted) {
            // 启动只问候一次：dock 会随会话切换重挂载，不能每次都算「新对话」。
            bootGreeted = true
            showRef.current('hello')
          }
        }, delay)
        return
      }
      bootTimer = window.setTimeout(helloLoop, 300)
    }
    helloLoop()

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        // 切到别的窗口就别念了：主人不在，念给谁听。
        stopSpeech()
        return
      }
      var away = hiddenAt === 0 ? 0 : Date.now() - hiddenAt
      hiddenAt = 0
      lastActivity = Date.now()
      // 卡片停走的那段不计入停留时长：回来时把起点往后挪，剩下的时间还在。
      var cur = viewRef.current
      if (away > 0 && cur !== null && cur.phase !== 'exit') startedAt.current += away
      if (away >= RETURN_AFTER_MS) showRef.current('return')
    }

    function onActivity() {
      var now = Date.now()
      var idle = now - lastActivity
      lastActivity = now
      if (idle >= idleAfter) {
        // 亮过才重抽待机阈值；没亮（比如正在显示）就留到下一次活动再算。
        if (showRef.current('idle')) idleAfter = randomIdleMs()
      }
    }

    function onMove() {
      var now = Date.now()
      if (now - lastMove < 2000) return
      lastMove = now
      onActivity()
    }

    function onKey(event) {
      if (event.key === 'Escape') hide()
      else onActivity()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pointerdown', onActivity, true)
    window.addEventListener('pointermove', onMove, { passive: true, capture: true })
    window.addEventListener('wheel', onActivity, { passive: true, capture: true })
    window.addEventListener('keydown', onKey, true)

    return function () {
      disposed = true
      window.clearTimeout(bootTimer)
      stopSpeech()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointerdown', onActivity, true)
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('wheel', onActivity, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  // 完成报告只在宿主给了 useSession 座位时才装；座位有没有是稳定的，不会中途变。
  var useSession = props !== undefined && props !== null && typeof props.useSession === 'function'
    ? props.useSession
    : null

  var watcher = null
  if (useSession !== null) {
    watcher = h(ReportWatch, {
      useSession: useSession,
      onDone: function (info) {
        showRef.current(info.failed ? 'failed' : 'done', true, info)
      },
      // 陪伴不抢戏：正在显示别的卡时就让位，下一轮窗口再补。
      onComfort: function (info) {
        showRef.current('comfort', false, info)
      }
    })
  }

  if (view === null) return watcher

  var card = h(React.Fragment, null,
    h('style', null, CSS),
    h('div', {
      className: 'dshg',
      'data-phase': view.phase,
      'data-variant': variant,
      'data-kind': view.kind,
      'data-paused': paused ? 'true' : 'false',
      'data-voice-controls': VOICE_READY ? 'true' : 'false',
      role: 'status',
      'aria-live': 'polite',
      tabIndex: 0,
      title: '点一下收起',
      onClick: hide,
      onKeyDown: function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault()
          hide()
        }
      },
      onMouseEnter: function () { pause(true) },
      onMouseLeave: function () { pause(false) },
      onFocus: function () { pause(true) },
      onBlur: function () { pause(false) }
    },
    h('span', { className: 'dshg-orbit', 'aria-hidden': 'true' }),
    h('div', { className: 'dshg-portrait' },
      h('img', {
        className: 'dshg-avatar',
        src: view.content.avatar || AVATAR,
        alt: '',
        draggable: false,
        'aria-hidden': 'true',
        onError: function (event) {
          var element = event.currentTarget
          if (element && element.getAttribute('src') !== AVATAR) {
            element.setAttribute('src', AVATAR)
          }
        }
      }),
      h('span', { className: 'dshg-spark', 'aria-hidden': 'true' })
    ),
    h('div', { className: 'dshg-copy' },
      h('div', { className: 'dshg-title' },
        h('span', { className: 'dshg-hi' }, headlineNodes(view.content.headline)),
        h('span', { className: 'dshg-tag' }, tagFor(view.kind))
      ),
      h('p', { className: 'dshg-line' }, view.content.body)
    ),
    // 语音开关：只有装了语音包才出现。开着时点一下闭嘴，关着时点一下把这张卡再念一遍。
    VOICE_READY
      ? h('button', {
        className: 'dshg-voice',
        type: 'button',
        'data-voice': voiceOn ? 'on' : 'off',
        'aria-pressed': voiceOn ? 'true' : 'false',
        'aria-label': voiceOn ? '关闭语音问候' : '开启语音问候',
        title: voiceOn ? '语音问候：开（点一下关掉）' : '语音问候：关（点一下打开）',
        onClick: function (event) {
          event.stopPropagation()
          var next = !voiceOn
          setVoiceEnabled(next)
          // 打开时把当前这张卡补念一遍：主人点开就是想听，不用等下一张。
          if (next && view !== null && view.content) speakKeys(view.content.keys)
        }
      }, voiceGlyph(voiceOn))
      : null,
    h('button', {
      className: 'dshg-close',
      type: 'button',
      'aria-label': view.kind === 'done' || view.kind === 'failed' ? '关闭报告' : '关闭问候',
      onClick: function (event) {
        event.stopPropagation()
        hide()
      }
    }, '\u00d7'),
    h('span', { className: 'dshg-progress', 'aria-hidden': 'true' },
      h('i', { style: { width: progress + '%' } })
    )
    )
  )

  // 没有 watcher 时保持老形状（单张卡），有的话并排挂上去。
  return watcher === null ? card : h(React.Fragment, null, watcher, card)
}

/**
 * 授权请示：只在这一会话有「待审批」时才接管输入框。
 *
 * 宿主的 `conversation.composer` 是链式 slot：宿主把
 * `{ sessionId, session, pendingInteraction }` 交给每个 entry 的 select，
 * 第一个返回非 null 的 entry 获选。审批挂起时输入框整个被接管
 * （`conversation.input.dock` 会被一起藏起来），所以小鲸必须站到这里 ——
 * 这也是「请示」只能靠接管来做的原因：别处根本不在画面上。
 *
 * 只接管，不改语义：仍然只有两个答复（允许一次 / 拒绝），仍然把
 * 「这一条命令是什么」原样转给会话自带的详情 slot，Enter = 允许、Esc = 拒绝。
 * 一旦拿不到 `answer()`（宿主换了接口），select 直接让位，面板还给宿主。
 */
function approvalSelect(owner) {
  if (owner === null || owner === undefined) return null
  var pending = owner.pendingInteraction
  if (pending === null || pending === undefined) return null
  if (pending.kind !== 'approval') return null
  if (typeof pending.answer !== 'function') return null
  return pending
}

/**
 * 审批理由的文本。
 *
 * `displayReason` 是宿主的 LocalizedText：字面量字符串，或按语言 id 索引的映射表。
 * 先交给宿主自己的 `resolveReason`（就是 `locale.resolveText`，按当前语言挑），
 * 拿不到再自己按 zh / en 的顺序退，最后退回 `reason` 原句 —— 宁可显示原文，
 * 也不能让主人对着一条不说理由的请示按「允许」。
 */
function reasonText(pending, props) {
  var display = pending.displayReason
  if (display !== null && display !== undefined && typeof display === 'object') {
    if (props !== null && props !== undefined && typeof props.resolveReason === 'function') {
      try {
        var resolved = props.resolveReason(display)
        if (typeof resolved === 'string' && resolved !== '') return resolved
      } catch (error) {
        /* 宿主换了签名就用下面的退路 */
      }
    }
    if (typeof display.zh === 'string' && display.zh !== '') return display.zh
    if (typeof display.en === 'string' && display.en !== '') return display.en
  } else if (typeof display === 'string' && display !== '') {
    return display
  }
  if (typeof pending.reason === 'string' && pending.reason !== '') return pending.reason
  return '它没说明理由，主人自己判断吧。'
}

function buildPermissionContent(pending, props) {
  var values = {
    tool: typeof pending.toolName === 'string' && pending.toolName !== '' ? pending.toolName : '某个工具',
    reason: reasonText(pending, props)
  }
  return {
    headline: pick(PERMISSION_HEADS),
    body: fillTemplate(pick(PERMISSION_LINES), values),
    avatar: pickAvatar()
  }
}

function ApprovalComposer(props) {
  var pending = props === null || props === undefined ? null : props.matched
  // 只有获选时才会被挂上，理论上到不了这一支；真到了就什么都不画，别白屏。
  if (pending === null || pending === undefined) return null

  var copyKey = React.useRef(null)
  var copyValue = React.useRef(null)
  // 换成另一条审批时重挑一次话术：渲染里反复抽会把文案抽成走马灯。
  if (copyKey.current !== pending.key) {
    copyKey.current = pending.key
    copyValue.current = buildPermissionContent(pending, props)
  }
  var content = copyValue.current

  var busyState = React.useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var waiting = React.useRef(false)
  var active = React.useRef(true)

  React.useEffect(function () {
    active.current = true
    return function () {
      active.current = false
    }
  }, [])

  function answer(outcome) {
    if (waiting.current || pending.answerable === false) return
    waiting.current = true
    setBusy(true)
    var result = pending.answer(outcome)
    // 宿主拒绝这次答复时把按钮还回来，别让主人对着「处理中」干等。
    if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
      result.catch(function () {
        if (!active.current || pending.answerable === false) return
        waiting.current = false
        setBusy(false)
      })
    }
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || !event.currentTarget.contains(document.activeElement)) return
    var target = event.target
    var closest = target !== null && target !== undefined && typeof target.closest === 'function'
      ? target.closest.bind(target)
      : null
    if (closest !== null && closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    if (event.key === 'Enter') {
      if (closest !== null && closest('button, a[href], [role="button"]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      answer('allowed-once')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      answer('rejected')
    }
  }

  var detail = null
  if (typeof props.renderSlot === 'function' && pending.callId !== undefined) {
    try {
      detail = props.renderSlot('conversation.approval.detail', { callId: pending.callId })
    } catch (error) {
      detail = null
    }
  }

  var disabled = busy || pending.answerable === false

  return h(React.Fragment, null,
    h('style', null, CSS),
    h('div', {
      className: 'dshg',
      'data-phase': 'shown',
      'data-variant': 'permission',
      'data-kind': 'permission',
      'data-busy': busy ? 'true' : 'false',
      'data-approval-key': String(pending.key === undefined ? 'approval' : pending.key),
      role: 'group',
      'aria-label': '等待主人授权',
      'aria-live': 'polite',
      tabIndex: 0,
      onKeyDown: onKeyDown
    },
    h('span', { className: 'dshg-orbit', 'aria-hidden': 'true' }),
    h('div', { className: 'dshg-portrait' },
      h('img', {
        className: 'dshg-avatar',
        src: content.avatar || AVATAR,
        alt: '',
        draggable: false,
        'aria-hidden': 'true',
        onError: function (event) {
          var element = event.currentTarget
          if (element && element.getAttribute('src') !== AVATAR) {
            element.setAttribute('src', AVATAR)
          }
        }
      }),
      h('span', { className: 'dshg-spark', 'aria-hidden': 'true' })
    ),
    h('div', { className: 'dshg-copy' },
      h('div', { className: 'dshg-title' },
        h('span', { className: 'dshg-hi' }, headlineNodes(content.headline)),
        h('span', { className: 'dshg-tag' }, tagFor('permission'))
      ),
      h('p', { className: 'dshg-line' }, content.body),
      detail === null ? null : h('div', { className: 'dshg-detail' }, detail),
      h('div', { className: 'dshg-actions' },
        h('button', {
          className: 'dshg-btn dshg-btn-reject',
          type: 'button',
          disabled: disabled,
          onClick: function (event) {
            event.stopPropagation()
            answer('rejected')
          }
        }, '拒绝'),
        h('button', {
          className: 'dshg-btn dshg-btn-allow',
          type: 'button',
          disabled: disabled,
          onClick: function (event) {
            event.stopPropagation()
            answer('allowed-once')
          }
        }, busy ? '小鲸在处理…' : '允许一次')
      )
    )
  ))
}

/**
 * 借宿主的 locale 服务解 LocalizedText。
 *
 * 本插件没有 inject 'locale'（不为了两行文案多挂一条依赖），所以取服务这一步
 * 必须容错：Cordis 里访问未注入的服务会抛，宿主没这个服务时返回空串，
 * 让 `reasonText` 自己按 zh / en 退。
 */
function makeResolveText(ctx) {
  return function resolveText(text) {
    var locale
    try {
      locale = ctx.locale
    } catch (error) {
      return ''
    }
    if (locale === null || locale === undefined || typeof locale.resolveText !== 'function') return ''
    try {
      return locale.resolveText(text)
    } catch (error) {
      return ''
    }
  }
}

function DockGreeting(props) {
  return Greeting('dock', props)
}

function HeroGreeting(props) {
  return Greeting('hero', props)
}

function apply(ctx) {
  diag('apply')
  var resolveLocaleText = makeResolveText(ctx)
  // 对话区：输入框上方，整幅问候卡。
  ctx.slots.inject('conversation.input.dock', function () {
    return ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'dsh-whale-greeting-card',
      order: 20
    }, DockGreeting)
  })
  // 空白 / 新对话：hero 那一行的紧凑卡片。
  ctx.slots.inject('conversation.hero.options', function () {
    return ctx.slots.register({
      name: 'conversation.hero.options',
      id: 'dsh-whale-greeting-hero',
      order: 20
    }, HeroGreeting)
  })
  // 需要授权：链式接管输入框。只在 pendingInteraction.kind === 'approval' 时获选，
  // 其余时刻返回 null，宿主的输入框照旧。
  //
  // priority 0 是必须的：宿主的 ApprovalPanel 是 1，链按 priority 升序试，
  // 谁的 select 先返回非 null 谁获选 —— 小鲸要排在它前面才轮得到说话。
  ctx.slots.inject('conversation.composer', function () {
    return ctx.slots.register({
      name: 'conversation.composer',
      priority: 0,
      select: approvalSelect,
      // 宿主的 resolveReason 就是 locale.resolveText：借它按当前语言挑理由文案。
      inject: function () {
        return { resolveReason: resolveLocaleText }
      },
      children: {
        'conversation.approval.detail': { kind: 'single', scope: 'session' }
      }
    }, ApprovalComposer)
  })
}

diag('module')

module.exports = {
  inject: ['slots'],
  apply: apply
}
