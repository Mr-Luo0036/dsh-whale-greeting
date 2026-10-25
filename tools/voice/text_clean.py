"""把问候文案清洗成「能念」的样子。

卡片上的字保留表情符号（那是给人看的），念的时候要去掉 —— 颜文字、波浪线、
括号里的动作说明（「（小声）」）都不该念出来。
"""
import re

# 括号里的内容一律丢掉：要么是颜文字，要么是动作说明，都不该出声。
_BRACKETS = re.compile(r'[（(【\[「『][^（()）【\[\]】「」『』]*[）)】\]」』]')

# 允许留下的字符：CJK、拉丁字母、数字、以及真正有停顿意义的标点。
_KEEP = re.compile(
    r'[\u3007\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff'
    r'0-9A-Za-z'
    r'，。！？、；：,.!?;:…—]'
)
_SPACES = re.compile(r'\s+')
_DUP_PUNCT = re.compile(r'([，。！？、；：,.!?;:])[，。！？、；：,.!?;:…—]+')
_TAIL = '！？。…,.!?;:，、；：'


def clean_text(text: str) -> str:
    kept = _BRACKETS.sub('', text)
    # 波浪号是语气拖长，直接删掉会把两句黏成一句（「…摇起来了接下来做什么？」），
    # 换成逗号更像说话时的停顿。
    kept = kept.replace('～', '，').replace('~', '，').replace('—', '，')
    kept = ''.join(ch if _KEEP.match(ch) else '' for ch in kept)
    kept = _SPACES.sub('', kept)
    kept = _DUP_PUNCT.sub(r'\1', kept)
    # 颜文字里漏出来的单个拉丁字母（ヾ(≧▽≦*)o 的那个 o）别念。
    kept = re.sub(r'(?<=[\u4e00-\u9fff，。！？…、；：])[A-Za-z]+$', '', kept)
    kept = kept.lstrip(_TAIL + '—')
    # 句尾该是什么标点就是什么：先记住，再削掉尾巴上的标点，最后补回去。
    end_mark = kept[-1] if kept and kept[-1] in '！？…' else ''
    kept = kept.rstrip(_TAIL + '—')
    if kept == '':
        raise ValueError('empty after cleaning: ' + text)
    return kept + (end_mark or '。')


def estimate_seconds(text: str) -> float:
    """估这句话该有多长（秒）。

    F5 自己算时长用的是「参考音频时长 / 参考文本长度 × 生成长度」，一旦参考是英文
    唱的、生成是中文，这个比例会离谱到三四倍（我们实测 4 秒的话生成了 16 秒）。
    所以干脆自己估一个，再用 `fix_duration` 钉住。
    """
    cjk = sum(1 for ch in text if '\u4e00' <= ch <= '\u9fff')
    comma = sum(1 for ch in text if ch in '，、；：,;:')
    end = sum(1 for ch in text if ch in '！？…。.!?')
    seconds = 0.235 * cjk + 0.13 * comma + 0.22 * end + 0.28
    return max(0.9, round(seconds, 2))


if __name__ == '__main__':
    import json
    import sys

    texts = json.load(open(sys.argv[1], encoding='utf-8'))
    for group in ('heads', 'lines', 'returns', 'idle'):
        for item in texts[group]:
            print(clean_text(item))
