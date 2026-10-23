window.__ModuleLoader__.load({ id: "dsh-whale-greeting", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
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

var CSS = "/* dsh-whale-greeting — 大幅问候卡。只依赖 --dsw-alias-* token 与宿主发布的排版变量。 */\r\n\r\n/* ── 卡片本体（conversation.input.dock：输入框上方） ───────────────────────── */\r\n\r\n.dshg {\r\n  position: relative;\r\n  box-sizing: border-box;\r\n  /* 一张卡只用这一个色：问候走品牌色，交付卡换成成功色，卡住的换成警告色。 */\r\n  --dshg-accent: var(--dsw-alias-brand-primary, #4f9dd9);\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 16px;\r\n  width: 100%;\r\n  max-width: var(--dsh-composer-card-max-width, 44rem);\r\n  margin: 2px auto 6px;\r\n  padding: 15px 44px 16px 15px;\r\n  border-radius: 20px;\r\n  border: 1px solid color-mix(in srgb, var(--dshg-accent, #4f9dd9) 28%, var(--dsw-alias-border-l1, #d9dee7));\r\n  background:\r\n    radial-gradient(130% 170% at 0% 0%, color-mix(in srgb, var(--dshg-accent, #4f9dd9) 20%, transparent) 0%, transparent 58%),\r\n    linear-gradient(135deg, color-mix(in srgb, var(--dshg-accent, #4f9dd9) 8%, var(--dsw-alias-bg-layer-1, #ffffff)) 0%, var(--dsw-alias-bg-layer-1, #ffffff) 64%);\r\n  box-shadow:\r\n    0 18px 40px -22px color-mix(in srgb, var(--dshg-accent, #4f9dd9) 60%, transparent),\r\n    0 1px 0 color-mix(in srgb, #ffffff 26%, transparent) inset;\r\n  overflow: hidden;\r\n  color: var(--dsw-alias-label-primary, #0f1115);\r\n  cursor: pointer;\r\n  transform-origin: 50% 100%;\r\n}\r\n\r\n/* 任务完成报告：整卡换成「交付」的绿色，署名前加一个对勾。 */\r\n.dshg[data-kind='done'] {\r\n  --dshg-accent: var(--dsw-alias-state-success-primary, #17a34a);\r\n}\r\n\r\n.dshg[data-kind='done'] .dshg-tag::before {\r\n  content: '\\2713';\r\n  margin-right: 5px;\r\n  font-weight: 700;\r\n}\r\n\r\n.dshg[data-kind='done'] .dshg-spark {\r\n  animation: dshg-spark 1.1s ease-in-out infinite;\r\n}\r\n\r\n/* 没走完的一轮：同一张卡，换成警告色，语气也软下来。 */\r\n.dshg[data-kind='failed'] {\r\n  --dshg-accent: var(--dsw-alias-state-warn-primary, #d97706);\r\n}\r\n\r\n/* 进场 / 退场：整卡上浮 + 微缩放，头像随后弹出。 */\r\n.dshg[data-phase='enter'] {\r\n  opacity: 0;\r\n  transform: translateY(16px) scale(0.97);\r\n}\r\n\r\n.dshg[data-phase='shown'] {\r\n  opacity: 1;\r\n  transform: none;\r\n  transition:\r\n    opacity 0.38s cubic-bezier(0.22, 0.61, 0.36, 1),\r\n    transform 0.46s cubic-bezier(0.18, 0.9, 0.24, 1.04);\r\n}\r\n\r\n.dshg[data-phase='exit'] {\r\n  opacity: 0;\r\n  transform: translateY(-8px) scale(0.985);\r\n  transition:\r\n    opacity 0.2s ease,\r\n    transform 0.22s ease;\r\n}\r\n\r\n/* 一次性扫光，让卡片亮一下。 */\r\n.dshg::after {\r\n  content: '';\r\n  position: absolute;\r\n  inset: 0;\r\n  background: linear-gradient(\r\n    115deg,\r\n    transparent 32%,\r\n    color-mix(in srgb, #ffffff 52%, transparent) 47%,\r\n    transparent 62%\r\n  );\r\n  transform: translateX(-120%);\r\n  opacity: 0;\r\n  pointer-events: none;\r\n}\r\n\r\n.dshg[data-phase='shown']::after {\r\n  animation: dshg-sweep 1.05s ease-out 0.16s 1;\r\n}\r\n\r\n@keyframes dshg-sweep {\r\n  0% { transform: translateX(-120%); opacity: 0; }\r\n  28% { opacity: 0.5; }\r\n  100% { transform: translateX(120%); opacity: 0; }\r\n}\r\n\r\n/* 角色：圆角方章 + 呼吸光环 */\r\n.dshg-portrait {\r\n  position: relative;\r\n  flex: none;\r\n  width: 82px;\r\n  height: 82px;\r\n}\r\n\r\n.dshg-avatar {\r\n  display: block;\r\n  width: 100%;\r\n  height: 100%;\r\n  border-radius: 26px;\r\n  object-fit: cover;\r\n  background: radial-gradient(circle at 50% 30%, #eaf3ff 0%, #d7e6f8 100%);\r\n  box-shadow:\r\n    0 0 0 2px color-mix(in srgb, var(--dshg-accent, #4f9dd9) 34%, transparent),\r\n    0 10px 22px -10px color-mix(in srgb, var(--dshg-accent, #4f9dd9) 70%, transparent);\r\n  user-select: none;\r\n  -webkit-user-drag: none;\r\n  animation: dshg-bob 4.6s ease-in-out infinite;\r\n}\r\n\r\n@keyframes dshg-bob {\r\n  0%, 100% { transform: translateY(0) rotate(0deg); }\r\n  50% { transform: translateY(-3px) rotate(-1.2deg); }\r\n}\r\n\r\n.dshg-spark {\r\n  position: absolute;\r\n  top: -3px;\r\n  right: -3px;\r\n  width: 12px;\r\n  height: 12px;\r\n  border-radius: 3px;\r\n  background: linear-gradient(135deg, #bfe4ff, var(--dshg-accent, #4f9dd9));\r\n  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 72%, transparent);\r\n  transform: rotate(45deg);\r\n  animation: dshg-spark 3.2s ease-in-out infinite;\r\n}\r\n\r\n@keyframes dshg-spark {\r\n  0%, 100% { opacity: 0.55; transform: rotate(45deg) scale(0.85); }\r\n  50% { opacity: 1; transform: rotate(45deg) scale(1.12); }\r\n}\r\n\r\n/* 背景里的小气泡，慢慢漂 */\r\n.dshg-orbit {\r\n  position: absolute;\r\n  top: 14px;\r\n  right: 96px;\r\n  width: 7px;\r\n  height: 7px;\r\n  border-radius: 50%;\r\n  background: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 34%, transparent);\r\n  box-shadow:\r\n    -22px 46px 0 -1px color-mix(in srgb, var(--dshg-accent, #4f9dd9) 20%, transparent),\r\n    14px 30px 0 -2px color-mix(in srgb, var(--dshg-accent, #4f9dd9) 16%, transparent);\r\n  animation: dshg-drift 7s ease-in-out infinite;\r\n  pointer-events: none;\r\n}\r\n\r\n@keyframes dshg-drift {\r\n  0%, 100% { transform: translateY(0); opacity: 0.75; }\r\n  50% { transform: translateY(-6px); opacity: 1; }\r\n}\r\n\r\n/* 文案 */\r\n.dshg-copy {\r\n  flex: 1 1 auto;\r\n  min-width: 0;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 5px;\r\n}\r\n\r\n.dshg-title {\r\n  display: flex;\r\n  align-items: baseline;\r\n  gap: 10px;\r\n  flex-wrap: wrap;\r\n  min-width: 0;\r\n}\r\n\r\n.dshg-hi {\r\n  font-size: 26px;\r\n  line-height: 1.2;\r\n  font-weight: 650;\r\n  letter-spacing: 0.01em;\r\n  color: var(--dsw-alias-label-primary, #0f1115);\r\n}\r\n\r\n.dshg-master {\r\n  /* 窄容器里也不能把「主人」拆到两行 */\r\n  white-space: nowrap;\r\n  color: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 84%, var(--dsw-alias-label-primary, #0f1115));\r\n}\r\n\r\n.dshg-tag {\r\n  flex: none;\r\n  font-size: 11px;\r\n  line-height: 18px;\r\n  letter-spacing: 0.12em;\r\n  padding: 1px 9px;\r\n  border-radius: 999px;\r\n  border: 1px solid color-mix(in srgb, var(--dshg-accent, #4f9dd9) 26%, transparent);\r\n  background: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 8%, transparent);\r\n  color: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 62%, var(--dsw-alias-label-secondary, #6b7280));\r\n  white-space: nowrap;\r\n}\r\n\r\n.dshg-line {\r\n  margin: 0;\r\n  font-size: 14.5px;\r\n  line-height: 1.6;\r\n  color: var(--dsw-alias-label-secondary, #6b7280);\r\n  display: -webkit-box;\r\n  -webkit-line-clamp: 2;\r\n  -webkit-box-orient: vertical;\r\n  overflow: hidden;\r\n  overflow-wrap: anywhere;\r\n}\r\n\r\n.dshg-close {\r\n  position: absolute;\r\n  top: 9px;\r\n  right: 9px;\r\n  width: 26px;\r\n  height: 26px;\r\n  padding: 0;\r\n  border: 0;\r\n  border-radius: 50%;\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-secondary, #6b7280);\r\n  font-size: 16px;\r\n  line-height: 24px;\r\n  text-align: center;\r\n  cursor: pointer;\r\n  opacity: 0.6;\r\n  transition: opacity 0.15s ease, background 0.15s ease;\r\n}\r\n\r\n.dshg-close:hover,\r\n.dshg-close:focus-visible {\r\n  opacity: 1;\r\n  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 8%, transparent);\r\n}\r\n\r\n.dshg:focus-visible {\r\n  outline: 2px solid color-mix(in srgb, var(--dshg-accent, #4f9dd9) 66%, transparent);\r\n  outline-offset: 2px;\r\n}\r\n\r\n/* 底部余量进度：停住时也停 */\r\n.dshg-progress {\r\n  position: absolute;\r\n  left: 0;\r\n  right: 0;\r\n  bottom: 0;\r\n  height: 2px;\r\n  background: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 10%, transparent);\r\n}\r\n\r\n.dshg-progress i {\r\n  display: block;\r\n  height: 100%;\r\n  width: 0;\r\n  border-radius: 0 2px 2px 0;\r\n  background: linear-gradient(\r\n    90deg,\r\n    color-mix(in srgb, var(--dshg-accent, #4f9dd9) 55%, transparent),\r\n    var(--dshg-accent, #4f9dd9)\r\n  );\r\n  transition: width 0.12s linear;\r\n}\r\n\r\n/* ── 首屏形态（conversation.hero.options）：和输入框上方的大卡同尺寸 ───────── */\r\n\r\n.dshg[data-variant='hero'] {\r\n  width: 100%;\r\n  max-width: min(44rem, 92%);\r\n  margin: 2px auto 6px;\r\n  padding: 15px 44px 16px 15px;\r\n  gap: 16px;\r\n  border-radius: 20px;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-portrait {\r\n  width: 82px;\r\n  height: 82px;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-avatar {\r\n  border-radius: 26px;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-spark {\r\n  width: 12px;\r\n  height: 12px;\r\n  border-radius: 3px;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-hi {\r\n  font-size: 26px;\r\n  font-weight: 700;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-line {\r\n  font-size: 14.5px;\r\n  line-height: 1.6;\r\n  -webkit-line-clamp: 2;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-close {\r\n  top: 10px;\r\n  right: 12px;\r\n  width: 26px;\r\n  height: 26px;\r\n  font-size: 15px;\r\n  line-height: 24px;\r\n}\r\n\r\n.dshg[data-variant='hero'] .dshg-progress {\r\n  height: 2px;\r\n}\r\n\r\n/* 长跑陪伴：同一张卡，换成品牌色与成功色之间的青，安静一点的语气。 */\r\n.dshg[data-kind='comfort'] {\r\n  --dshg-accent: color-mix(\r\n    in srgb,\r\n    var(--dsw-alias-brand-primary, #4f9dd9) 52%,\r\n    var(--dsw-alias-state-success-primary, #17a34a)\r\n  );\r\n}\r\n\r\n.dshg[data-kind='comfort'] .dshg-avatar {\r\n  animation-duration: 6.4s;\r\n}\r\n\r\n/* 授权请示：警告色；卡片不再是「点一下收起」，而是两个确定的答复。 */\r\n.dshg[data-kind='permission'] {\r\n  --dshg-accent: var(--dsw-alias-state-warn-primary, #d97706);\r\n  cursor: default;\r\n}\r\n\r\n.dshg[data-variant='permission'] {\r\n  align-items: flex-start;\r\n  gap: 14px;\r\n  margin: 8px auto 12px;\r\n  padding: 15px 18px 15px 15px;\r\n}\r\n\r\n.dshg[data-variant='permission'] .dshg-portrait {\r\n  width: 64px;\r\n  height: 64px;\r\n}\r\n\r\n.dshg[data-variant='permission'] .dshg-avatar {\r\n  border-radius: 20px;\r\n}\r\n\r\n.dshg[data-variant='permission'] .dshg-hi {\r\n  font-size: 21px;\r\n}\r\n\r\n.dshg[data-variant='permission'] .dshg-line {\r\n  -webkit-line-clamp: 3;\r\n  font-size: 14px;\r\n}\r\n\r\n/* 请示时头像旁边那点光要跳得快些：它在等答复。 */\r\n.dshg[data-variant='permission'] .dshg-spark {\r\n  animation-duration: 1.3s;\r\n}\r\n\r\n.dshg-detail {\r\n  margin-top: 4px;\r\n  max-height: 116px;\r\n  overflow: auto;\r\n  padding: 8px 10px;\r\n  border-radius: 10px;\r\n  border: 1px solid color-mix(in srgb, var(--dshg-accent, #4f9dd9) 22%, transparent);\r\n  background: color-mix(in srgb, var(--dshg-accent, #4f9dd9) 6%, transparent);\r\n  color: var(--dsw-alias-label-secondary, #6b7280);\r\n  font-size: 12px;\r\n  line-height: 1.55;\r\n  overflow-wrap: anywhere;\r\n}\r\n\r\n.dshg-actions {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: flex-end;\r\n  gap: 8px;\r\n  margin-top: 4px;\r\n}\r\n\r\n.dshg-btn {\r\n  flex: none;\r\n  min-width: 76px;\r\n  padding: 6px 14px;\r\n  border-radius: 10px;\r\n  font-size: 13px;\r\n  line-height: 20px;\r\n  font-weight: 600;\r\n  font-family: inherit;\r\n  cursor: pointer;\r\n  transition:\r\n    background 0.15s ease,\r\n    border-color 0.15s ease,\r\n    color 0.15s ease,\r\n    opacity 0.15s ease;\r\n}\r\n\r\n.dshg-btn:disabled {\r\n  cursor: default;\r\n  opacity: 0.55;\r\n}\r\n\r\n.dshg-btn-reject {\r\n  color: var(--dsw-alias-label-secondary, #6b7280);\r\n  background: transparent;\r\n  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 16%, transparent);\r\n}\r\n\r\n.dshg-btn-reject:hover:not(:disabled) {\r\n  color: var(--dsw-alias-state-error-primary, #dc2626);\r\n  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 42%, transparent);\r\n  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 8%, transparent);\r\n}\r\n\r\n.dshg-btn-allow {\r\n  color: #ffffff;\r\n  background: var(--dshg-accent, #d97706);\r\n  border: 1px solid color-mix(in srgb, var(--dshg-accent, #d97706) 80%, #000000);\r\n}\r\n\r\n.dshg-btn-allow:hover:not(:disabled) {\r\n  background: color-mix(in srgb, var(--dshg-accent, #d97706) 84%, #000000);\r\n}\r\n\r\n.dshg-btn:focus-visible {\r\n  outline: 2px solid color-mix(in srgb, var(--dshg-accent, #4f9dd9) 66%, transparent);\r\n  outline-offset: 2px;\r\n}\r\n\r\n@media (prefers-reduced-motion: reduce) {\r\n  .dshg,\r\n  .dshg-avatar,\r\n  .dshg-spark,\r\n  .dshg-orbit {\r\n    animation: none !important;\r\n    transition: opacity 0.2s linear !important;\r\n    transform: none !important;\r\n  }\r\n\r\n  .dshg[data-phase='shown']::after {\r\n    animation: none;\r\n  }\r\n}\r\n"

// 兜底头像：构建时内联成 data URI，随机头像路由失效时仍然能看。
var AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAACyaklEQVR42uy9d7hdVbX3/5lzrrV236f39F4JJVSBBCkKSjcBVBR7FxtYuNck1+5VL/gqFkAUUCCRLlVa6L0EEpKQnpyc3s8uq8w5f3+sfQJ49b733lfvj6tn5DnPk+Sk7L32HGOO8R3f8R0wbuM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buM2buP2JjAx/ghiW716tVq+fDmAjX9nBaz4kz+0ahUAy5YtE2vWrNHjT23c/tfbsmXL1FggkFKQSHhI+Zejhes6+35prR0PIOM3wP/CNy0E73rXu9SaNWsMYNPpFHfffc+RV1215m3tezqPfGnjNt86SZFJ5UBVDrzWFAojctLE+uElR+1/6SU/+O59xVIJa60QQtjxozTuAP8rrHJgAWwqleQLX/jycU88tf7z3d0DJxVKCpGZTKaqHpnMId0UAokApAUTDDLcv4vyyHYOWDjhlpvX/OZDQoi+cSf432vyH+nNrlixQgohbD6ft7/61a+OP2Dx0Xdce9Mjf9w9WH+SajjW1s8+TddMOECLVIuObE4HgavDwNUm8rQNPY2q0TUtB+nGaSeYJ9f3nnrM8WfeZK1tFEKIFStWyPHjNH4DvGlTnqOPPtpZu3ZtZK1tftfyd31n/cah87Q3hXzTLCu9rNE6ktZYISIXrEUbHyEsSkmkFJhKdawBR0rSSoe7Nj3gHnlw24+v/e0vzjdnnqn4k8LYWivWrFkj/0zdYcZuofEjOO4Af/PDb61VgP71zy475NIrVq/Z1a8ntU07zIpUmylpIzxHkDAJK40kUCVMFGBNgBACx0tjVYqytpIgEkL5WAOOkVaXd9pC12ND11/zf45YvHjxxhUrVshVq1aZZcuWqf8kSiRXr14tKg4x7gzjDvC3yfez2az96PnnnXXt1Y9dnMoe2tw244hQOaEslvqJwiE1OtiFYyJcF7QTIGwEkUbgIJ08ociSyDag3Codhr7UaGExJJxAD+95Th28X/Mnfnf1T3++ZMkKZ+3aVRFALpdjeHg4f9NNNx2zfft2JwgC43kek9smyyOOPuKhlpaWvmw2awqFwr70bNWqVWb8SI47wF/z8ItMJmM++MGP/ODG25/4YrrhYGoa54TF0T43GNlN0gzjmOLeltZcZ6Hcd8P+B84fWjBnnmxubiAs+vT1Dchn171i2jv7j+roHDxmWOfq89XTQeYoWkkqldWFrlfkpJrey++6/eqPr1z5oFy5cqn+zGc+c/a6des+JaVsrqurm55KptBRhNaawmiB3t6e7VXV1cUwip4+esnRd65cufIWIYRf+TzGb4JxB/jrFPjpdMq865xlP7zr9vVfaJ7wjiAQRW+0+BK5RNQ1e3brY0cetOCGL37xwvuBTimltfbPn71UKkWxWEy/54Of+djDj7z8zdrmA9Nu9SxrVd6W+l6WCyf1bbnump/PFkKY88477/iurq57PvzhD7N48WIaGhqMoxysNkQ6IgxDBgYG5PYdO3ju2We5/4EH6O3rfepDH/rQuz/2sY9trQATY2mUBcTq1asZT5PG7T+d8y9btkxZa+VFK777g5bJS+zMRR82U2edZvc74MTuD3/409/eu2395FQy+ad/Va1YscKbN2+ZB+B5Htbaquuuvu7gTKZmwblnn/uZz3/s04seWPvYFQcd9W57wNt+qA9bdr2ec/SF9pz3fe45a22LtXa/T3ziE3/87ne/a6y1ge/7OghDG4ahjYLQ+qWyDYPQWmt15SsK/CC8+OKL7bHHHfeStbZ+yZIlzlhgSiQTKKXe4NTjaNP/ohtgrFP6Pxm5KpQG/ZOfXHnsz352zb3FIIPnhYVFi5ouvv63V/5MCNH+pwVo5TUKwHiex3XXXTf35ptv/sSO7duX1NU3LKyrqYkmTpzkrntpPccf+1Z/2qwFibM++HUWHf4+ujo24vfdN7hobmtPLlMz87mnn+W9Z7+XL130RXy/jOskkUKCjbBCxI9cgBSCMAhIpJJ204ZX7YUXXmBu+cPNs4QQ2621zuc+87l3jg4Nf6AcBE9NmjTpsW9//9vr0+l0d6lUGnMExmuGN3H+bR94wPlTR+B/AOcH6O/sXLhg3uL2SZMOtu84+YMP3nbnH5dKKV4f6eWf/p1kMsmvf/3r+YsPOeRnxx9//MjX//nr9oH77redHR22Yrqzu8fOmzXfnnby6Xb+gcfbxcd9y8469Hz7tW98z3Z07rU7d+yxN15zi33i/qesNdYGQcmGkbY6sFYH8S0QhZGNosjqMLLlYslaa+0vfvJLO2v6nOjc9573+LLTl7195ddXfuqdJ77T/suKVfZrX/6a/cD7P2CPPOKo7SefdPI1l/zwksPSqTQAS1jijJ+2N7cjpK216f8pp1uxYoW01qYOO/TgPzQ3ttrzz/+nr772/x/k/iVHtNZ6J5xwwr8cfPDBI9/5znfsnj17rLU2stbqyA+N7/umXC5b3w/Nr375K/vS8y/ZR55ab2cd+GE7/5AP26efX2+stToKrHn2oRfthqc3WmutjaKyjaLQRkFko3JgQz+wURjaKIpsFIQ2KPs2KJbtuudetk8/+ay99trr7Yc//Anb0tQ2fPutdxhrbWit1cViyaxb95L95r98y77l8CPDtxz2luvuuOOOAyq9BDlOanzTHPj4g7DW1lpb+lRx22ObijuffMVaO9VahLVW/g2jvwNw2223ve+Ud55sv/ftb5/DvsbTavWXbgtr7fSlS5c+ddZZZ9mNGzeOHXxTKhRtqVC0Qdm3URRZY4w1xtiwpK011g6NFuzit7zXnnzG563vBzYMIuuXQvv4vc/YJx941trQ2CgqW60DG5ZDa3xtw3Jow6BsdRQ7gvG1HewZtFs2b993y1hrzW233G6HBoZs4AfWL/s2ivTY96K97R3229/8tj1gwf497z773Z/NZrPjB+/N4wCrlbVW2JFdv7DP/c72XXKOLV13oR3euPbisfz8b11vPPHEExN83z9gLN15fdSv3BKOtVZUCuXkCSeccPNFF11kK9HWFIvFOFL7gY3Kvg39wIZ+HLWttXbXlnbb39VvjYnskUtOs7ff+Wgc7UNtR4eK9vF7n7MP3/GELfaXbBQEtlwq26AU2aGeEVsulG0Y+FbrwOowstZYu/GlzXbblh1Wa22DcmhHhwtmz64OY621RmtrjLGRjqzvl21hZNSGQWistdErL6+37zpzmT3kkMMusdY6/2i0Ft6cXBuktTY58srah0euWBbaNWf5weXv1nvvvGTQWjvLWvs3vQX+Es+p4gTqT4p/aa2tPeOMMzo3b96srbWmXC5bXUlP9jlA2bdRENowCKy11m5+eYfd9spua0xoH330aRsG2oaBb62xtrdrwK579FX72F3P2a6dvXFMN9YWhwP78rOb7XDfqI380PrlktVBZIf6Ru1Df3zc9nT3WWviGL998067Z+dea6yxOooR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'

// 表情包头像名单（构建时扫描 assets/avatars/ 注入），每次问候随机挑一张。
var AVATARS = ["bixin.png","buyao.png","deyi.png","ganfan.png","haixiu.png","huachi.png","jiaban.png","jiazai.png","maozhua.png","ok.png","piaole.png","qiurao.png","shengqi.png","shuijiao.png","tangping.png","toukan.png","wenhao.png","wuyu.png","xia.png","xianqi.png","yaoqian.png","yun.png","zaoshanghao.png","zhenjing.png"]
var lastAvatarIndex = -1

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

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
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

function salutationFor(date) {
  var hour = date.getHours()
  for (var i = 0; i < SALUTATIONS.length; i += 1) {
    if (hour < SALUTATIONS[i].until) return pick(SALUTATIONS[i].variants)
  }
  return '你好'
}

/**
 * 从 120 句里挑一句，最近用过的先排除；全用完就重新洗牌。
 * 存储不可用时退化成纯随机，不影响问候。
 */
function pickLine() {
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
  return LINES[index]
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
      avatar: avatar
    }
  }
  if (kind === 'comfort') {
    return {
      headline: pick(COMFORT_HEADS),
      body: fillTemplate(pick(COMFORT_LINES), {
        time: formatDuration(extra === undefined ? 0 : extra.duration)
      }),
      avatar: avatar
    }
  }
  if (kind === 'return') {
    return { headline: '主人，您回来啦！', body: pick(RETURN_LINES), avatar: avatar }
  }
  if (kind === 'idle') {
    return { headline: '主人，小鲸等到您啦！', body: pick(IDLE_LINES), avatar: avatar }
  }
  return { headline: salutationFor(new Date()) + pick(HELLO_TAILS), body: pickLine(), avatar: avatar }
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
    commit({ phase: 'enter', kind: kind, content: buildContent(kind, extra) })
    diag('show:' + variant, kind)
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

return module.exports; } });
