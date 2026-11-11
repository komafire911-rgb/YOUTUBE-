"""本の図解を同じデザインで作るための部品集。

使い方(例):
    import sys; sys.path.insert(0, '/home/user/YOUTUBE-/book/tools')
    import figkit as K
    K.steps('ch1_01', 'タイトル', [('見出し','説明'), ...], caption='下の一言', avatar='rinji')

すべて 1376x768 の JPEG を book/images/ に保存し、保存先のパスを返す。
文字は自動で折り返し・縮小する。1枚の文字は少なめに(目安: 1要素15字×3行まで)。
アバター: rinji / rinji_tired / rinji_step / guard / brain
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'images')
KIT = os.path.join(OUT, 'kit')
FONT = os.path.join(os.path.dirname(BASE), 'assets', 'fonts', 'NotoSansJP-Bold.ttf')

W, H = 1376, 768
BG = (222, 241, 251)
INK = (34, 34, 34)
SUB = (90, 90, 90)
BROWN = (80, 42, 22)
CREAM = (252, 246, 231)
COLORS = [(78, 160, 210), (240, 140, 60), (150, 100, 200), (90, 170, 120), (220, 90, 100)]
GRAY = (130, 130, 140)
_fc = {}


def F(s):
    if s not in _fc:
        _fc[s] = ImageFont.truetype(FONT, s)
    return _fc[s]


def _wrap(d, text, size, maxw):
    """日本語を幅で折り返す(行頭禁則の簡易処理つき)。改行 \\n は尊重。"""
    lines = []
    for para in text.split('\n'):
        cur = ''
        for ch in para:
            if d.textlength(cur + ch, font=F(size)) > maxw and cur:
                if ch in '、。」』)!?ー・':
                    cur += ch
                    continue
                lines.append(cur)
                cur = ch
            else:
                cur += ch
        lines.append(cur)
    return lines


def text_box(d, box, text, size=30, color=INK, align='center', valign='center', spacing=1.45, min_size=16):
    """箱の中に収まるように、折り返し・縮小して描く。"""
    x0, y0, x1, y1 = box
    s = size
    while True:
        lines = _wrap(d, text, s, x1 - x0)
        lh = int(s * spacing)
        if lh * len(lines) <= (y1 - y0) or s <= min_size:
            break
        s -= 1
    total = lh * len(lines)
    y = y0 + ((y1 - y0 - total) // 2 if valign == 'center' else 0)
    for ln in lines:
        w = d.textlength(ln, font=F(s))
        x = x0 + ((x1 - x0 - w) / 2 if align == 'center' else 0)
        d.text((x, y), ln, font=F(s), fill=color)
        y += lh
    return s


def head_line(d, box, text, size=36, color=INK, min_size=20):
    """見出し: まず1行に収まるまで縮め、それでも無理なら折り返す。"""
    x0, y0, x1, y1 = box
    s = size
    while d.textlength(text, font=F(s)) > (x1 - x0) and s > min_size:
        s -= 1
    if d.textlength(text, font=F(s)) <= (x1 - x0):
        w = d.textlength(text, font=F(s))
        d.text((x0 + (x1 - x0 - w) / 2, y0 + (y1 - y0 - s * 1.3) / 2), text, font=F(s), fill=color)
        return s
    return text_box(d, box, text, size=size, color=color)


NAMES = {'rinji': 'りんじ', 'rinji_tired': 'りんじ', 'rinji_step': 'りんじ', 'guard': '警備員', 'brain': 'かみき'}


def _canvas(bg=BG):
    im = Image.new('RGB', (W, H), bg)
    return im, ImageDraw.Draw(im)


def _title(d, title, y=26, size=48, color=INK):
    text_box(d, (60, y, W - 60, y + 70), title, size=size, color=color)


def _caption(d, caption, color=INK):
    if caption:
        text_box(d, (80, 670, W - 80, 750), caption, size=30, color=color)


def _avatar(im, name, xy, size=170):
    if not name:
        return
    a = Image.open(os.path.join(KIT, name + '.png')).convert('RGBA').resize((size, size), Image.LANCZOS)
    sh = Image.new('L', (size + 30, size + 30), 0)
    ImageDraw.Draw(sh).ellipse((15, 20, size + 15, size + 25), fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(8))
    im.paste((140, 165, 185), (xy[0] - 15, xy[1] - 15), sh)
    im.paste(a, xy, a)


def _card(d, box, fill='white', outline=(170, 190, 205), radius=22, width=3):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def _save(im, name):
    path = os.path.join(OUT, name + '.jpg')
    im.save(path, quality=90)
    return path


# ---------- 部品 ----------

def opener(name, label, title, phrase, avatar='rinji'):
    """章の扉: 章番号・章題・決めフレーズ。"""
    im, d = _canvas(CREAM)
    d.rounded_rectangle((70, 70, 330, 130), radius=30, fill=BROWN)
    text_box(d, (70, 72, 330, 128), label, size=32, color='white')
    text_box(d, (70, 160, 1000, 330), title, size=56, color=BROWN, align='left')
    d.line((70, 360, 1000, 360), fill=(214, 190, 160), width=4)
    _card(d, (70, 400, 1000, 640), fill='white', outline=(214, 190, 160), radius=30, width=4)
    d.text((100, 400), '“', font=F(90), fill=(230, 200, 160))
    text_box(d, (130, 430, 960, 615), phrase, size=40, color=INK)
    _avatar(im, avatar, (1060, 300), size=250)
    text_box(d, (70, 680, 1306, 740), 'やる気があってもなくても、今日、5分だけ。', size=24, color=(150, 110, 80))
    return _save(im, name)


def steps(name, title, items, caption=None, avatar=None):
    """手順(1→2→3): items=[(見出し, 説明), ...] 2〜4個。"""
    im, d = _canvas()
    _title(d, title)
    n = len(items)
    right = W - (230 if avatar else 60)
    gap = 40
    bw = (right - 60 - gap * (n - 1)) // n
    for i, (h, desc) in enumerate(items):
        x = 60 + i * (bw + gap)
        c = COLORS[i % len(COLORS)]
        _card(d, (x, 130, x + bw, 640))
        d.ellipse((x + bw // 2 - 34, 150, x + bw // 2 + 34, 218), fill=c)
        text_box(d, (x + bw // 2 - 34, 150, x + bw // 2 + 34, 218), str(i + 1), size=38, color='white')
        head_line(d, (x + 16, 240, x + bw - 16, 330), h, size=36, color=c)
        text_box(d, (x + 24, 350, x + bw - 24, 610), desc, size=32, color=SUB)
        if i < n - 1:
            ax = x + bw + 6
            d.polygon([(ax, 365), (ax + gap - 12, 385), (ax, 405)], fill=(110, 140, 170))
    if avatar:
        _avatar(im, avatar, (W - 210, 470), size=170)
    _caption(d, caption)
    return _save(im, name)


def compare(name, title, left, right, caption=None):
    """比較: left/right = (見出し, [項目...], 'bad'|'good')。"""
    im, d = _canvas()
    _title(d, title)
    for i, (h, items, kind) in enumerate([left, right]):
        x = 60 + i * 640
        c = GRAY if kind == 'bad' else COLORS[0]
        mark = '×' if kind == 'bad' else '○'
        _card(d, (x, 120, x + 616, 650), outline=c, width=5)
        d.rounded_rectangle((x, 120, x + 616, 195), radius=22, fill=c)
        d.rectangle((x, 170, x + 616, 195), fill=c)
        head_line(d, (x + 20, 124, x + 596, 192), h, size=36, color='white')
        y = 220
        step = min(140, (620 - y) // max(1, len(items)))
        for it in items:
            d.text((x + 30, y + (step - 10) // 2 - 26), mark, font=F(38), fill=c)
            text_box(d, (x + 90, y, x + 590, y + step - 10), it, size=32, color=INK, align='left')
            y += step
    _caption(d, caption)
    return _save(im, name)


def flow(name, title, nodes, caption=None, loop=False, avatar=None):
    """流れ図: nodes=[(見出し, 説明), ...] を矢印でつなぐ。loop=True で最後から最初へ戻る矢印。"""
    im, d = _canvas()
    _title(d, title)
    n = len(nodes)
    right = W - (230 if avatar else 60)
    gap = 70
    bw = (right - 60 - gap * (n - 1)) // n
    top, bot = 170, 520
    for i, (h, desc) in enumerate(nodes):
        x = 60 + i * (bw + gap)
        c = COLORS[i % len(COLORS)]
        d.rounded_rectangle((x, top, x + bw, bot), radius=40, fill='white', outline=c, width=6)
        head_line(d, (x + 16, top + 30, x + bw - 16, top + 120), h, size=42, color=c)
        text_box(d, (x + 20, top + 130, x + bw - 20, bot - 20), desc, size=32, color=SUB)
        if i < n - 1:
            ax = x + bw + 10
            d.line((ax, (top + bot) // 2, ax + gap - 30, (top + bot) // 2), fill=(110, 140, 170), width=8)
            d.polygon([(ax + gap - 34, (top + bot) // 2 - 18), (ax + gap - 14, (top + bot) // 2), (ax + gap - 34, (top + bot) // 2 + 18)], fill=(110, 140, 170))
    if loop and n > 1:
        y = bot + 40
        x0, x1 = 60 + bw // 2, 60 + (n - 1) * (bw + gap) + bw // 2
        d.line((x1, bot + 8, x1, y), fill=(110, 140, 170), width=6)
        d.line((x0, y, x1, y), fill=(110, 140, 170), width=6)
        d.line((x0, y, x0, bot + 24), fill=(110, 140, 170), width=6)
        d.polygon([(x0 - 16, bot + 30), (x0, bot + 8), (x0 + 16, bot + 30)], fill=(110, 140, 170))
    if avatar:
        _avatar(im, avatar, (W - 210, 440), size=170)
    _caption(d, caption)
    return _save(im, name)


def card(name, title, lines, footer=None):
    """まとめカード(保存・共有用): 3行のまとめ。"""
    im, d = _canvas(CREAM)
    _card(d, (60, 50, W - 60, H - 50), fill='white', outline=(214, 190, 160), radius=36, width=6)
    d.rounded_rectangle((100, 85, 420, 145), radius=30, fill=BROWN)
    text_box(d, (100, 87, 420, 143), 'この章のまとめ', size=30, color='white')
    text_box(d, (440, 80, W - 100, 150), title, size=34, color=BROWN, align='left')
    y = 185
    for i, ln in enumerate(lines):
        c = COLORS[i % len(COLORS)]
        d.ellipse((110, y + 20, 170, y + 80), fill=c)
        text_box(d, (110, y + 20, 170, y + 80), str(i + 1), size=32, color='white')
        text_box(d, (195, y, W - 120, y + 100), ln, size=34, color=INK, align='left')
        y += 125
    if footer:
        text_box(d, (100, 610, W - 280, 690), footer, size=26, color=(150, 110, 80), align='left')
    _avatar(im, 'brain', (W - 260, 540), size=150)
    return _save(im, name)


def day_card(name, day, line, avatar='rinji', note=None):
    """りんじの30日: Dayの一言カード。"""
    im, d = _canvas()
    d.rounded_rectangle((60, 60, 360, 140), radius=40, fill=COLORS[1])
    text_box(d, (60, 62, 360, 138), f'Day {day}', size=46, color='white')
    text_box(d, (400, 70, W - 60, 140), 'りんじくんの30日', size=36, color=BROWN, align='left')
    _avatar(im, avatar, (90, 230), size=300)
    # 吹き出し
    d.rounded_rectangle((460, 210, W - 70, 560), radius=40, fill='white', outline=(170, 190, 205), width=4)
    d.polygon([(462, 360), (410, 400), (462, 420)], fill='white')
    d.line((462, 360, 410, 400), fill=(170, 190, 205), width=4)
    d.line((410, 400, 462, 420), fill=(170, 190, 205), width=4)
    text_box(d, (500, 240, W - 110, 530), line, size=40, color=INK)
    if note:
        text_box(d, (100, 610, W - 100, 700), note, size=28, color=SUB)
    return _save(im, name)


def talk(name, title, lines):
    """会話の吹き出し: lines=[(話者, 文)] 話者は 'rinji'/'guard'/'brain'/'rinji_tired' 等。2〜4行。"""
    im, d = _canvas()
    _title(d, title, size=40)
    n = len(lines)
    h = (620 - 120) // n
    y = 120
    for i, (who, txt) in enumerate(lines):
        left = (i % 2 == 0)
        av = 120
        ax = 70 if left else W - 70 - av
        ay = y + (h - av) // 2 - 12
        _avatar(im, who, (ax, ay), size=av)
        head_line(d, (ax - 20, ay + av + 2, ax + av + 20, ay + av + 34), NAMES.get(who, ''), size=22, color=SUB)
        box = (230, y + 10, W - 140, y + h - 10) if left else (140, y + 10, W - 230, y + h - 10)
        _card(d, box, fill='white' if left else (255, 247, 236), radius=30)
        text_box(d, (box[0] + 30, box[1] + 10, box[2] - 30, box[3] - 10), txt, size=32, color=INK)
        y += h
    return _save(im, name)


def quote(name, phrase, sub=None, avatar='brain'):
    """決めフレーズを大きく見せる1枚(シェア用)。"""
    im, d = _canvas(CREAM)
    _card(d, (80, 90, W - 80, H - 90), fill='white', outline=(214, 190, 160), radius=40, width=6)
    d.text((120, 70), '“', font=F(140), fill=(230, 200, 160))
    text_box(d, (160, 160, W - 300, 520), phrase, size=58, color=BROWN)
    if sub:
        text_box(d, (160, 540, W - 300, 640), sub, size=28, color=SUB)
    _avatar(im, avatar, (W - 290, 440), size=190)
    return _save(im, name)
