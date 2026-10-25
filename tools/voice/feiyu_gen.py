"""用肥鱼官方声库（FeiyuVoice-CosyVoice3 · cute F6）批量合成问候语音。

    node tools/voice/extract_texts.mjs src/client.js tools/voice/texts.json
    python tools/voice/feiyu_gen.py --texts tools/voice/texts.json \\
        --out assets/voice --manifest assets/voice/manifest.json
    node build.mjs

输入：texts.json（从插件 src/client.js 抠出来的文案）；参考音频与 checkpoint 来自
      肥鱼声库 FeiyuVoice-CosyVoice3（AstrBot 插件 astrbot_plugin_feiyu_voice 配套的那个），
      路径用 --pkg 指过去，CosyVoice 源码用 --repo 指过去（见同目录 README.md）。
输出：<out>/<key>.mp3 + manifest.json（构建时注入到浏览器半）。
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import soundfile as sf

from text_clean import clean_text

DEFAULT_PKG = r"E:\deepseek\models\FeiyuVoice-CosyVoice3"
DEFAULT_REPO = r"E:\deepseek\models\CosyVoice-pinned"
REF_TEXT = "我已经准备好了，我们开始吧。"
PROMPT_PREFIX = "You are a helpful assistant.<|endofprompt|>"

GROUPS = (
    ('heads', 'hi'),
    ('lines', 'line'),
    ('returns', 'ret'),
    ('idle', 'idle'),
)


def build_jobs(texts):
    jobs = []
    for group, prefix in GROUPS:
        for i, text in enumerate(texts[group]):
            jobs.append({'key': '%s-%d' % (prefix, i), 'group': group, 'index': i, 'text': text})
    return jobs


def trim_edges(audio, sr, thresh_db=-45.0, pad=0.05):
    win = max(1, int(sr * 0.02))
    frames = len(audio) // win
    if frames == 0:
        return audio
    rms = np.sqrt((audio[:frames * win].reshape(frames, win) ** 2).mean(axis=1))
    db = 20 * np.log10(rms + 1e-9)
    loud = np.where(db > thresh_db)[0]
    if loud.size == 0:
        return audio
    begin = max(0, loud[0] * win - int(sr * pad))
    end = min(len(audio), (loud[-1] + 1) * win + int(sr * pad))
    return audio[begin:end]


def retune(audio, sr, formant, pitch_median):
    """用 Praat 的 PSOLA 把音高提到 pitch_median、共振峰放大 formant 倍。

    官方 cute F6 声库本身就不低（参考音基频中位数 292 Hz），但短句生成时模型会往下塌
    到 250 Hz 左右，听感就偏成熟。这里不改权重、不改 prompt，只在成片上把音高和共振峰
    拉回参考音的音域 —— 时长不变，也不会有相位声码器那种金属感。
    """
    import parselmouth

    snd = parselmouth.Sound(audio.astype('float64'), sampling_frequency=sr)
    out = parselmouth.praat.call(snd, 'Change gender', 75.0, 700.0, float(formant),
                                 float(pitch_median), 1.0, 1.0)
    return np.asarray(out.values[0], dtype='float32')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--texts', default='texts.json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--label', default='肥鱼声音 · FeiyuVoice-CosyVoice3 cute F6（提音高版）')
    ap.add_argument('--voice-id', default='feiyu-cosyvoice3-cute-p1')
    ap.add_argument('--keys', default='', help='只跑这几个 key（精确匹配，逗号分隔）')
    ap.add_argument('--only', default='', help='只跑匹配的 key 前缀，逗号分隔')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--speed', type=float, default=1.0)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--formant', type=float, default=1.10,
                    help='共振峰放大倍数，1.0 表示不动')
    ap.add_argument('--pitch-median', type=float, default=300.0,
                    help='把音高中位数提到多少 Hz，0 表示不动')
    ap.add_argument('--pkg', default=os.environ.get('FEIYU_PKG', DEFAULT_PKG),
                    help='肥鱼声库目录（FeiyuVoice-CosyVoice3 解包位置）')
    ap.add_argument('--repo', default=os.environ.get('COSYVOICE_REPO', DEFAULT_REPO),
                    help='CosyVoice 源码目录（含 third_party/Matcha-TTS）')
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    pkg = os.path.abspath(args.pkg)
    model_dir = os.path.join(pkg, 'models', 'Fun-CosyVoice3-0.5B-2512')
    ckpt = os.path.join(pkg, 'models', 'feiyu_cute_F6_0040.pt')
    ref = os.path.join(pkg, 'references', 'cute_N01.wav')
    for path in (repo, model_dir, ckpt, ref):
        if not os.path.exists(path):
            raise SystemExit('missing: ' + path)

    texts = json.load(open(args.texts, encoding='utf-8'))
    jobs = build_jobs(texts)
    if args.only:
        prefixes = tuple(p.strip() for p in args.only.split(',') if p.strip())
        jobs = [j for j in jobs if j['key'].startswith(prefixes)]
    if args.keys:
        wanted = [k.strip() for k in args.keys.split(',') if k.strip()]
        order = {k: n for n, k in enumerate(wanted)}
        jobs = sorted([j for j in jobs if j['key'] in order], key=lambda j: order[j['key']])
    if args.limit:
        jobs = jobs[:args.limit]

    os.makedirs(args.out, exist_ok=True)
    engine = 'CosyVoice3 0.5B (肥鱼 cute F6, zero-shot)'
    if args.formant != 1.0 or args.pitch_median > 0:
        engine += ' + Praat 提音高/共振峰 (formant x%.2f, f0 -> %d Hz)' % (args.formant, args.pitch_median)
    manifest = {'voice': args.voice_id, 'label': args.label, 'engine': engine, 'clips': {}}
    if os.path.exists(args.manifest):
        try:
            old = json.load(open(args.manifest, encoding='utf-8'))
            if isinstance(old.get('clips'), dict):
                manifest['clips'] = old['clips']
        except Exception:
            pass

    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    os.environ.setdefault('TRANSFORMERS_OFFLINE', '1')
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    sys.path.insert(0, repo)
    sys.path.append(os.path.join(repo, 'third_party', 'Matcha-TTS'))

    import torch
    from cosyvoice.cli.cosyvoice import AutoModel
    from cosyvoice.utils.common import set_all_random_seed

    torch.set_num_threads(4)
    started = time.time()
    voice = AutoModel(model_dir=model_dir, fp16=False, load_trt=False, load_vllm=False)
    state = torch.load(ckpt, map_location='cpu', weights_only=True)
    voice.model.llm.load_state_dict(state, strict=True)
    del state
    voice.model.llm.eval()
    print('model loaded in %.1fs, sr=%d, text_frontend=%r'
          % (time.time() - started, voice.sample_rate, voice.frontend.text_frontend), flush=True)

    done = 0
    failed = []
    for job in jobs:
        key = job['key']
        mp3 = os.path.join(args.out, key + '.mp3')
        if not args.force and os.path.exists(mp3) and key in manifest['clips']:
            done += 1
            continue

        spoken = clean_text(job['text'])
        t0 = time.time()
        try:
            set_all_random_seed(args.seed)
            with torch.inference_mode():
                chunks = [x['tts_speech'].detach().cpu().numpy()[0]
                          for x in voice.inference_zero_shot(spoken, PROMPT_PREFIX + REF_TEXT, ref,
                                                             stream=False, speed=args.speed, text_frontend=True)]
        except Exception as e:
            failed.append((key, repr(e)))
            print('!! %-10s %s' % (key, repr(e)), flush=True)
            continue
        if not chunks:
            failed.append((key, 'empty'))
            print('!! %-10s 空输出' % key, flush=True)
            continue

        sr = voice.sample_rate
        audio = np.concatenate(chunks).astype('float32').reshape(-1)
        audio = trim_edges(audio, sr)
        peak = float(np.abs(audio).max()) if audio.size else 0.0
        if audio.size < sr * 0.25 or peak < 0.02:
            failed.append((key, 'silent/short'))
            print('!! %-10s 生成失败（时长或电平异常）' % key, flush=True)
            continue
        audio = audio / max(peak, 1e-6) * 0.89
        if args.formant != 1.0 or args.pitch_median > 0:
            audio = retune(audio, sr, args.formant or 1.0, args.pitch_median)
            peak = float(np.abs(audio).max()) or 1.0
            audio = (audio / peak * 0.89).astype('float32')
        sf.write(mp3, audio, sr, format='MP3', compression_level=0.85)

        manifest['clips'][key] = {'f': key + '.mp3', 't': job['text'], 's': spoken}
        manifest['ref'] = {'file': os.path.basename(ref), 'text': REF_TEXT,
                           'formant': args.formant, 'pitch_median': args.pitch_median}
        manifest['generatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        with open(args.manifest, 'w', encoding='utf-8') as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
            fh.write('\n')

        done += 1
        print('ok %-10s %5.2fs  %6.1fKB  %.1fs  %s'
              % (key, time.time() - t0, os.path.getsize(mp3) / 1024.0, len(audio) / sr, spoken), flush=True)

    print('\n完成 %d/%d，失败 %d' % (done, len(jobs), len(failed)), flush=True)
    if failed:
        print('失败列表:', failed, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
