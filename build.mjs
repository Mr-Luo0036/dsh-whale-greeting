// Build: src/client.js + src/style.css + assets/avatar.png  ->  lib/client.js
// 同时生成 preview.html（同一份 CSS、同一张头像），用来离线看效果。
//
//   node build.mjs
//
// 浏览器半不 import 任何东西（React 由页面的模块表给），所以"构建"只是把
// 源码塞进宿主约定的 loader 外壳里，不做打包。
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const css = readFileSync(join(root, 'src', 'style.css'), 'utf8')
const avatar = readFileSync(join(root, 'assets', 'avatar.png')).toString('base64')
const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')

const avatarsDir = join(root, 'assets', 'avatars')
const avatars = existsSync(avatarsDir)
  ? readdirSync(avatarsDir).filter((name) => name.endsWith('.png')).sort()
  : []

// 语音包清单：assets/voice/manifest.json 由克隆脚本产出，形状
//   { voice, notes, clips: { 'hi-0': { f: 'hi-0.mp3', t: '夜深了呢，主人！' }, ... } }
// 没有语音包就把空对象注进去 —— 浏览器半看到空包会自动藏掉喇叭开关。
const voiceManifestPath = join(root, 'assets', 'voice', 'manifest.json')
let voiceClips = {}
if (existsSync(voiceManifestPath)) {
  const manifest = JSON.parse(readFileSync(voiceManifestPath, 'utf8'))
  const raw = manifest && typeof manifest.clips === 'object' && manifest.clips !== null ? manifest.clips : {}
  // 只把浏览器真正要用的两项带进去：文件名和原文。清单里给人和脚本看的字段（发音文本、
  // 生成时间之类）不进 bundle。
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value.f === 'string') voiceClips[key] = { f: value.f, t: String(value.t ?? '') }
  }
}

if (source.includes('return module.exports; } });')) {
  throw new Error('build: src/client.js already carries the loader tail; it is source, not a bundle')
}
if (!source.includes('__CSS_JSON__') || !source.includes('__AVATAR__') || !source.includes('__AVATARS_JSON__') || !source.includes('__VOICE_JSON__')) {
  throw new Error('build: placeholders missing from src/client.js')
}

const body = source
  .replace('__AVATARS_JSON__', JSON.stringify(avatars))
  .replace('__VOICE_JSON__', JSON.stringify(voiceClips))
  .replace('__CSS_JSON__', JSON.stringify(css))
  .replace('__AVATAR__', 'data:image/png;base64,' + avatar)

const head = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(pkg.name) + ', factory: (require) => {\n'
  + 'var module = { exports: {} }; var exports = module.exports;\n'
const tail = '\nreturn module.exports; } });\n'

mkdirSync(join(root, 'lib'), { recursive: true })
const bundle = head + body + tail
writeFileSync(join(root, 'lib', 'client.js'), bundle)
console.log('build: lib/client.js ' + bundle.length + ' chars (avatar ' + avatar.length + ' b64 chars, ' + avatars.length + ' random avatars, ' + Object.keys(voiceClips).length + ' voice clips)')

const card = (variant, phase, headline, bodyText, kind = 'hello', tag = '鲸鱼女仆 · 小鲸', extra = '') => `
  <div class="dshg" data-phase="${phase}" data-variant="${variant}" data-kind="${kind}" data-voice-controls="true">
    <span class="dshg-orbit" aria-hidden="true"></span>
    <div class="dshg-portrait">
      <img class="dshg-avatar" src="assets/avatar.png" alt="" />
      <span class="dshg-spark" aria-hidden="true"></span>
    </div>
    <div class="dshg-copy">
      <div class="dshg-title">
        <span class="dshg-hi">${headline.replace('主人', '<span class="dshg-master">主人</span>')}</span>
        <span class="dshg-tag">${tag}</span>
      </div>
      <p class="dshg-line">${bodyText}</p>
      ${extra}
    </div>
    <button class="dshg-voice" type="button" data-voice="on" aria-label="关闭语音问候" aria-pressed="true" title="语音问候：开（点一下关掉）">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 9.4h3.3L12 5.6v12.8L7.3 14.6H4z" fill="currentColor"/><path d="M15.3 8.7a4.7 4.7 0 0 1 0 6.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
    <button class="dshg-close" type="button" aria-label="关闭问候">&times;</button>
    <span class="dshg-progress" aria-hidden="true"><i style="width:38%"></i></span>
  </div>`

// 授权请示：同一张卡，多一行详情和两个答复（没有关闭按钮、没有进度条）。
const ask = (headline, bodyText, detail) => `
  <div class="dshg" data-phase="shown" data-variant="permission" data-kind="permission" data-approval-key="preview">
    <span class="dshg-orbit" aria-hidden="true"></span>
    <div class="dshg-portrait">
      <img class="dshg-avatar" src="assets/avatar.png" alt="" />
      <span class="dshg-spark" aria-hidden="true"></span>
    </div>
    <div class="dshg-copy">
      <div class="dshg-title">
        <span class="dshg-hi">${headline.replace('主人', '<span class="dshg-master">主人</span>')}</span>
        <span class="dshg-tag">等待授权 · 小鲸请示</span>
      </div>
      <p class="dshg-line">${bodyText}</p>
      <div class="dshg-detail">${detail}</div>
      <div class="dshg-actions">
        <button class="dshg-btn dshg-btn-reject" type="button">拒绝</button>
        <button class="dshg-btn dshg-btn-allow" type="button">允许一次</button>
      </div>
    </div>
  </div>`

const preview = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8" />
<title>dsh-whale-greeting preview</title>
<link rel="stylesheet" href="src/style.css" />
<style>
  html, body { margin: 0; height: 100%; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
  .row { display: flex; flex-direction: column; height: 100%; }
  .strip { display: flex; flex: 1.35; min-height: 0; }
  .strip.short { flex: 1; }
  .pane {
    position: relative; flex: 1; min-width: 0; overflow: hidden;
    display: flex; flex-direction: column;
    --dsh-composer-card-max-width: 620px;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-base: #eef3fa;
    --dsw-alias-border-l1: #d9dee7;
    --dsw-alias-brand-primary: #4f9dd9;
    --dsw-alias-state-success-primary: #17a34a;
    --dsw-alias-state-warn-primary: #d97706;
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-secondary: #6b7280;
    background: radial-gradient(ellipse at 30% 10%, #f4f7fb 0%, #eaeff7 55%, #e2e8f1 100%);
  }
  .pane.dark {
    --dsw-alias-bg-layer-1: #1f242c;
    --dsw-alias-bg-base: #11141a;
    --dsw-alias-border-l1: #333a45;
    --dsw-alias-brand-primary: #63b3e8;
    --dsw-alias-state-success-primary: #34d399;
    --dsw-alias-state-warn-primary: #fbbf24;
    --dsw-alias-label-primary: #e8eaf0;
    --dsw-alias-label-secondary: #9aa3b2;
    background: radial-gradient(ellipse at 30% 10%, #1b1f27 0%, #14171d 55%, #0f1116 100%);
  }
  .fake-bar {
    height: 40px; flex: none; display: flex; align-items: center; gap: 8px;
    padding: 0 14px; border-bottom: 1px solid rgba(128, 140, 160, .16);
    color: #7b8494; font-size: 11.5px;
  }
  .pane.dark .fake-bar { color: #8b93a1; border-color: rgba(255,255,255,.07); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #cfd6e2; }
  .pane.dark .dot { background: #3a414d; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 18px 12px; }
  .msgs { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
  .msg { max-width: 62%; padding: 8px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.5; color: #3b4350; background: #fff; border: 1px solid rgba(20,30,50,.06); }
  .msg.me { align-self: flex-end; background: #e8f0fb; color: #2b3a4e; }
  .pane.dark .msg { background: #22262e; color: #c3c9d4; border-color: rgba(255,255,255,.06); }
  .pane.dark .msg.me { background: #2c3644; color: #cfd7e3; }
  .dock { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding-top: 10px; flex: none; }
  .meter { flex: none; align-self: flex-start; font-size: 11px; color: #8b95a5; border: 1px solid rgba(20,30,50,.1); border-radius: 999px; padding: 1px 8px; }
  .pane.dark .meter { color: #7d8798; border-color: rgba(255,255,255,.1); }
  .inputbox {
    flex: none; margin-top: 8px; display: flex; align-items: center; justify-content: space-between;
    border-radius: 14px; border: 1px solid rgba(20,30,50,.1); background: #fff;
    padding: 12px 14px; font-size: 13px; color: #9aa3b0;
    max-width: var(--dsh-composer-card-max-width); width: 100%; margin-left: auto; margin-right: auto;
  }
  .pane.dark .inputbox { background: #1d2129; border-color: rgba(255,255,255,.08); color: #6f7787; }
  .hero { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 0 18px 8px; }
  .heroTitle { display: flex; align-items: center; gap: 8px; font-size: 21px; font-weight: 600; color: #2b3442; }
  .pane.dark .heroTitle { color: #e7eaf0; }
  .fish { width: 28px; height: 28px; border-radius: 50%; background: #dfeaf8; }
  .badge { font-size: 10px; font-weight: 500; color: #4f9dd9; border: 1px solid rgba(79,157,217,.4); border-radius: 999px; padding: 0 6px; }
  .heroRow { display: flex; align-items: center; gap: 6px; width: 100%; max-width: var(--dsh-composer-card-max-width); }
  .chip { font-size: 11.5px; color: #6f7a8b; border: 1px solid rgba(20,30,50,.1); border-radius: 8px; padding: 2px 8px; }
  .pane.dark .chip { color: #8b93a1; border-color: rgba(255,255,255,.1); }
  .heroOptions { margin-left: auto; display: flex; align-items: center; gap: 6px; min-width: 0; }
</style>
<body>
  <div class="row">
    <div class="strip">
      <!-- 已有对话：大卡在输入框上方 -->
      <div class="pane">
        <div class="fake-bar"><span class="dot"></span><span>已有对话 · 大幅问候卡（conversation.input.dock）</span></div>
        <div class="body">
          <div class="msgs">
            <div class="msg me">这个问候为什么没出现？</div>
            <div class="msg">它被启动动画的覆盖层盖住了，等覆盖层撤掉，问候已经过期。</div>
          </div>
          ${card('dock', 'shown', '晚上好，主人～', '主人主人！您终于来啦～小鲸一直守着门口呢。')}
          <div class="meter">上下文 12%</div>
          <div class="inputbox"><span>问点什么…</span><span>↑</span></div>
        </div>
      </div>

      <!-- 空白新对话：紧凑卡片在 hero 那一行 -->
      <div class="pane dark">
        <div class="fake-bar"><span class="dot"></span><span>新对话 · 首屏紧凑卡片（conversation.hero.options）</span></div>
        <div class="hero">
          <div class="heroTitle"><span class="fish"></span>探索未至之境<span class="badge">预览版</span></div>
          <div class="heroRow">
            <span class="chip">工作区</span>
            <span class="chip">模型</span>
            <div class="heroOptions">
              ${card('hero', 'shown', '下午好，主人！', '小鲸泡好了茶，就等主人坐下啦～')}
            </div>
          </div>
          <div class="inputbox"><span>问点什么…</span><span>↑</span></div>
        </div>
      </div>
    </div>

    <div class="strip short">
      <!-- 一轮跑完：同一张卡换成交付形态 -->
      <div class="pane">
        <div class="fake-bar"><span class="dot"></span><span>任务完成 · 交付报告（running 由 true 变 false）</span></div>
        <div class="body">
          <div class="msgs">
            <div class="msg me">把这三份日志按日期归档，再给我一份摘要。</div>
            <div class="msg">已归档 3 份（2026-10-19 ~ 10-21），摘要见下方文件。</div>
          </div>
          ${card('dock', 'shown', '任务完成啦，主人！', '总共用了 2 分 10 秒，小鲸把现场收拾干净啦～', 'done', '任务完成 · 小鲸交付')}
          <div class="meter">上下文 18%</div>
          <div class="inputbox"><span>问点什么…</span><span>↑</span></div>
        </div>
      </div>

      <!-- 长跑陪伴：跑到 4~8 分钟之间的随机时刻说一句 -->
      <div class="pane">
        <div class="fake-bar"><span class="dot"></span><span>长跑陪伴 · 跑到 4~8 分钟的随机时刻（kind = comfort）</span></div>
        <div class="body">
          <div class="msgs">
            <div class="msg me">把整个仓库的类型错误一次清掉。</div>
            <div class="msg">正在逐个文件修复……（已处理 42 个）</div>
          </div>
          ${card('dock', 'shown', '跑得有点久了，主人还顺利吗？', '已经跑了 6 分 20 秒啦，小鲸一步都没挪开，就在旁边守着。', 'comfort', '长跑陪伴 · 小鲸在')}
          <div class="meter">上下文 34%</div>
          <div class="inputbox"><span>问点什么…</span><span>↑</span></div>
        </div>
      </div>

      <!-- 需要授权：小鲸接管输入框，替工具请示 -->
      <div class="pane dark">
        <div class="fake-bar"><span class="dot"></span><span>等待授权 · 小鲸接管输入框（conversation.composer）</span></div>
        <div class="body">
          <div class="msgs">
            <div class="msg me">把构建产物也一起提交了。</div>
            <div class="msg">需要提升权限才能写入工作区之外的目录。</div>
          </div>
          ${ask('主人，小鲸要请示一下～', '工具 bash 想动一点超出平时的权限：允许本次操作使用 workspace-write 权限：需要写入 E:/deepseek/build。小鲸不敢替主人答应。', '$ git commit -am "chore: 构建产物"')}
          <div class="meter">上下文 22%</div>
          <div class="inputbox"><span>等待主人决定…</span><span>↑</span></div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`
writeFileSync(join(root, 'preview.html'), preview)
console.log('build: preview.html written')
