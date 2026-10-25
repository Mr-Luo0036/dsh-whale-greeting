# 语音包怎么来的

`assets/voice/` 里那 156 个 mp3 不是手工录的，也不是「拿一段视频克隆」的近似音色，
而是用肥鱼官方声库 **FeiyuVoice-CosyVoice3**（cute F6）逐句合成的 —— 也就是
AstrBot 插件 [`astrbot_plugin_feiyu_voice`](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice)
里 `/肥鱼说话` 用的同一套模型、同一个参考音。

| 件 | 从哪来 |
|---|---|
| 文本 | `node extract_texts.mjs ../../src/client.js texts.json` —— 从 `src/client.js` 的四个文案数组里抠，保证「卡片上写的」和「耳朵里念的」同源 |
| 声库 | [FeiyuVoice-CosyVoice3](https://huggingface.co/Esmerubphire/FeiyuVoice-CosyVoice3)（Hugging Face / ModelScope 同名仓库），约 7 GB：`models/Fun-CosyVoice3-0.5B-2512/`、`models/feiyu_cute_F6_0040.pt`、`references/cute_N01.wav`；本机在 `E:\deepseek\models\FeiyuVoice-CosyVoice3` |
| 推理代码 | [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) @ `074ca6d`，含 `third_party/Matcha-TTS` 子模块；本机在 `E:\deepseek\models\CosyVoice-pinned` |
| AstrBot 插件本体 | 只作声库/服务端的出处存档：`E:\deepseek\tools\astrbot-plugin-feiyu-voice`（Python 插件，dsh 加载不了，别放进 `plugins/`） |

> 注意：`E:\deepseek\plugins\`（也就是 `dsh-home/plugins`）是 dsh 的插件源码目录，只有带
> `package.json` + `index.js` + `cordis.patch.yml` 的 cordis 包才该放那儿。AstrBot 的 Python 插件
> 放进去也不会出现在 dsh 的「已安装插件」里 —— 列表读的是 `profiles/desktop/package.json` 的
> `dependencies` 与 `dsh.profile.bundles`。

## 跑一遍

```sh
# 1. 文案（改动 src/client.js 之后都要重跑）
node extract_texts.mjs ../../src/client.js texts.json

# 2. 合成：默认读 assets/voice/manifest.json 里已有的进展，可以断点续跑
python feiyu_gen.py \
  --texts texts.json \
  --out ../../assets/voice \
  --manifest ../../assets/voice/manifest.json \
  --pkg  E:/deepseek/models/FeiyuVoice-CosyVoice3 \
  --repo E:/deepseek/models/CosyVoice-pinned

# 3. 重建浏览器半（把 manifest 注入 lib/client.js）
node ../../build.mjs
```

`--keys hi-4,line-7` 只重跑几句，`--force` 覆盖已有文件，`--speed 0.95` 念慢一点。

## 音色微调（默认就开着）

官方 cute 参考音的基频中位数是 292 Hz，但 CosyVoice3 念短句时会往下塌到 250 Hz 左右，
听感一下子成熟了好几岁。所以脚本在合成之后多做一步 **Praat PSOLA**（`praat-parselmouth`）：

```sh
--formant 1.10        # 共振峰放大倍数，越大越细、越"薄"
--pitch-median 300    # 目标基频中位数（Hz），0 = 不动
```

时长不变，也不会有相位声码器那种金属感；权重、prompt、文本一个都没改，属于「在官方声库上
稍微改动」。当前这套包就是 `formant ×1.10 + f0 → 300 Hz`，对着 B 站《人是猫》那条里大肥鱼的
音域校的。再往上还有 330 / 360 Hz 两档试过（会越来越萝莉，也更容易发飘），
`--pitch-median 330 --formant 1.15` 就是那一档。

## 环境说明（Windows）

这台机器上是**原生 Windows** 跑的，没走 WSL：

- Python 3.13 + torch 2.7.1+cu126（RTX 4060 Laptop，8 GB 够用，`fp16=False`）
- 依赖装在单独的 `cv-site` 目录里，跟 F5 那套环境互不干扰；`lightning` / `pyworld` / `modelscope`
  只有训练路径会用到，用空实现占位，推理链路不受影响
- `wetext` 没装，CosyVoice 的前端会退化成「只做标点清洗、不做数字转写」——这些问候文案
  里没有数字，所以没有问题；真要念数字的话把 `wetext` 装上即可（需要 kaldifst）
- 变调用的是 `praat-parselmouth`（装在同一个 site 里），纯 numpy 输入输出，不调 ffmpeg

参考音 `cute_N01.wav` 约 3 秒，参考文本是「我已经准备好了，我们开始吧。」，
合成时 `prompt_text` 前面带 `You are a helpful assistant.<|endofprompt|>` 前缀 —— 和声库
自带 `infer.py` 里的参数完全一致，所以音色和官方插件对得上。
