#!/bin/bash
set -e
# 使い方: bash book/kindle/build.sh  (原稿 book/manuscript/*.md から docx・epub・pdf と全文mdを作り直す)
B=/home/user/YOUTUBE-/book; M=$B/manuscript; K=$B/kindle
cd $M
FILES="00_*.md 01_*.md 02_*.md 03_*.md 04_*.md 05_*.md 06_*.md 07_*.md 08_*.md 09_*.md 10_*.md"
# 図番号を出現順に振り直す
python3 -I - $FILES <<'PY'
import re,sys
n=0
for fn in sys.argv[1:]:
    t=open(fn,encoding='utf-8').read()
    def rep(m):
        global n; n+=1; return f'![図{n} '
    t=re.sub(r'!\[図\d* ?',rep,t); open(fn,'w',encoding='utf-8').write(t)
print('figures:',n)
PY
OUT="$K/『やる気がなくても動ける脳科学の5分習慣』_Kindle原稿"
pandoc $K/meta.yaml $FILES -f markdown+pipe_tables --strip-comments -o "$OUT.docx" --resource-path=. 2>&1 | grep -v -i "translation\|Abstract\|ja.yaml" || true
pandoc $K/meta.yaml $FILES -f markdown+pipe_tables --strip-comments -o "$OUT.epub" --toc --toc-depth=1 --split-level=1 --css=$K/epub.css --resource-path=. 2>&1 | grep -v -i "translation\|Abstract\|ja.yaml" || true
python3 -I - "$OUT.docx" <<'PY'
import sys
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
fn=sys.argv[1]; d=Document(fn)
def setfont(st,size=None):
    f=st.font; f.name='游明朝'
    rpr=st.element.get_or_add_rPr(); rf=rpr.find(qn('w:rFonts'))
    if rf is None: rf=OxmlElement('w:rFonts'); rpr.insert(0,rf)
    for a in ('w:ascii','w:hAnsi','w:eastAsia','w:cs'): rf.set(qn(a),'游明朝')
    for a in ('w:asciiTheme','w:hAnsiTheme','w:eastAsiaTheme','w:cstheme'):
        if rf.get(qn(a)) is not None: del rf.attrib[qn(a)]
    if size: f.size=Pt(size)
sizes={'heading 1':18,'heading 2':14,'heading 3':12,'title':22,'subtitle':14}
for s in d.styles:
    n=s.name.lower()
    if s.type!=1: continue
    if n in sizes: setfont(s,sizes[n])
    elif n in('normal','body text','first paragraph','compact','block text','author','date'): setfont(s,10.5 if n!='author' else 12)
    if n.startswith('heading') or n in('title','subtitle','author'): s.font.color.rgb=RGBColor(0,0,0)
    if n=='heading 1': s.paragraph_format.page_break_before=True
    if n in('captioned figure','figure'):
        pf=s.paragraph_format; pf.alignment=WD_ALIGN_PARAGRAPH.CENTER; pf.keep_with_next=True; pf.space_before=Pt(10); pf.space_after=Pt(2)
    if n=='image caption':
        setfont(s,9); s.font.italic=False; s.font.color.rgb=RGBColor(0x55,0x55,0x55)
        pf=s.paragraph_format; pf.alignment=WD_ALIGN_PARAGRAPH.CENTER; pf.space_after=Pt(12)
for p in d.paragraphs:
    if p._p.xpath('.//w:drawing'): p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.keep_with_next=True
d.save(fn); print('images:',len(d.inline_shapes))
PY
cd $K && rm -f *.pdf && soffice --headless --convert-to pdf --outdir "$K" "$OUT.docx" >/dev/null 2>&1; pdfinfo *.pdf | grep Pages
cd $M && { for f in $FILES; do sed 's#\.\./images/#images/#g' "$f"; printf '\n\n---\n\n'; done; } > $B/全文_原稿v3_完成版.md
rm -f $B/全文_原稿v2_イラスト入り.md
ls -la $K
