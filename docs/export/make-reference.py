"""
Builds docs/export/reference.docx — the pandoc reference document that gives the DOCX exports FundBun's look.

    python3 docs/export/make-reference.py            (needs pandoc and python-docx: pip install python-docx)

It starts from pandoc's own default reference.docx (so every style pandoc emits exists) and restyles it:
headings in Georgia (a safe stand-in for Fraunces, which Word users won't have), body in Calibri 11 pt, soy-ink text,
yuan-gold heading accents, comfortable spacing, a light-bordered table style, A4 pages with a footer and page numbers,
plus the custom paragraph styles build.ts uses for the cover, figure rows and captions. The result is committed, so
`npm run docs:export` only needs this script when the styling changes.
"""
import copy
import os
import subprocess
import sys
import tempfile

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'reference.docx')

# brand palette (src/ui/styles/tokens.css)
SOY_900 = '24180F'   # text
SOY_700 = '5B4636'   # secondary text
BAMBOO_600 = '8F6232'  # H2, links (5.6:1 on white)
YUAN_500 = 'E3A21A'  # gold accent (rules, borders)
YUAN_600 = 'B97F09'  # gold text accents (kicker, H3 numbers)
CREAM_100 = 'FFF4E3'  # table header / code shading
DOUGH_200 = 'F6E7CC'
RULE = 'E6D3B3'      # light table borders

SERIF = 'Georgia'
SANS = 'Calibri'
MONO = 'Consolas'


def rgb(hex6):
    return RGBColor.from_string(hex6)


def set_fonts(rpr_owner, family):
    """Explicit fonts on a style's run properties (removes pandoc's theme-font references)."""
    rpr = rpr_owner.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.insert(0, fonts)
    for attr in list(fonts.attrib):
        del fonts.attrib[attr]
    for k in ('w:ascii', 'w:hAnsi', 'w:cs'):
        fonts.set(qn(k), family)
    fonts.set(qn('w:eastAsia'), 'PingFang SC')


def clear_color_theme(style):
    rpr = style.element.get_or_add_rPr()
    color = rpr.find(qn('w:color'))
    if color is not None:
        for attr in ('w:themeColor', 'w:themeShade', 'w:themeTint'):
            if color.get(qn(attr)) is not None:
                del color.attrib[qn(attr)]


def style_run(style, family=None, size=None, color=None, bold=None, italic=None, caps=None, spacing=None):
    if family:
        set_fonts(style.element, family)
    f = style.font
    if size is not None:
        f.size = Pt(size)
    if color is not None:
        f.color.rgb = rgb(color)
        clear_color_theme(style)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if caps is not None:
        f.all_caps = caps
    if spacing is not None:  # character spacing in twentieths of a point
        rpr = style.element.get_or_add_rPr()
        sp = rpr.find(qn('w:spacing'))
        if sp is None:
            sp = OxmlElement('w:spacing')
            rpr.append(sp)
        sp.set(qn('w:val'), str(spacing))


def style_par(style, before=None, after=None, line=None, align=None, keep_next=None, indent_left=None, page_break_before=None):
    pf = style.paragraph_format
    if before is not None:
        pf.space_before = Pt(before)
    if after is not None:
        pf.space_after = Pt(after)
    if line is not None:
        pf.line_spacing = line
    if align is not None:
        pf.alignment = align
    if keep_next is not None:
        pf.keep_with_next = keep_next
    if indent_left is not None:
        pf.left_indent = indent_left
    if page_break_before is not None:
        pf.page_break_before = page_break_before


def border(ppr_owner, side, color, size=8, space=4, val='single'):
    """A paragraph border (size in eighths of a point)."""
    ppr = ppr_owner.get_or_add_pPr()
    bdr = ppr.find(qn('w:pBdr'))
    if bdr is None:
        bdr = OxmlElement('w:pBdr')
        ppr.append(bdr)
    el = OxmlElement(f'w:{side}')
    el.set(qn('w:val'), val)
    el.set(qn('w:sz'), str(size))
    el.set(qn('w:space'), str(space))
    el.set(qn('w:color'), color)
    bdr.append(el)


def shade(ppr_owner, fill):
    ppr = ppr_owner.get_or_add_pPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill)
    ppr.append(shd)


def get_or_add(doc, name, kind=WD_STYLE_TYPE.PARAGRAPH, base=None):
    try:
        return doc.styles[name]
    except KeyError:
        st = doc.styles.add_style(name, kind)
        if base is not None:
            st.base_style = doc.styles[base]
        st.quick_style = True
        return st


def restyle_table(doc):
    """pandoc's tables use the table style "Table": light rules, cream header row, roomy cells, 9.5 pt text."""
    st = doc.styles['Table']
    el = st.element
    tblPr = el.find(qn('w:tblPr'))
    for child in list(tblPr):
        if child.tag in (qn('w:tblBorders'), qn('w:tblCellMar')):
            tblPr.remove(child)
    borders = OxmlElement('w:tblBorders')
    for side, val in (('top', 'single'), ('left', 'nil'), ('bottom', 'single'), ('right', 'nil'), ('insideH', 'single'), ('insideV', 'single')):
        b = OxmlElement(f'w:{side}')
        b.set(qn('w:val'), val)
        if val != 'nil':
            b.set(qn('w:sz'), '4')
            b.set(qn('w:space'), '0')
            b.set(qn('w:color'), RULE)
        borders.append(b)
    tblPr.append(borders)
    mar = OxmlElement('w:tblCellMar')
    for side, w in (('top', 50), ('left', 90), ('bottom', 50), ('right', 90)):
        m = OxmlElement(f'w:{side}')
        m.set(qn('w:w'), str(w))
        m.set(qn('w:type'), 'dxa')
        mar.append(m)
    tblPr.append(mar)
    # table text: 9.5 pt, tight spacing
    rpr = el.find(qn('w:rPr'))
    if rpr is None:
        rpr = OxmlElement('w:rPr')
        el.insert(list(el).index(tblPr), rpr)
    for tag, val in (('w:sz', '19'), ('w:szCs', '19')):
        e = OxmlElement(tag)
        e.set(qn('w:val'), val)
        rpr.append(e)
    # header row: cream fill, bold, gold rule underneath
    for old in el.findall(qn('w:tblStylePr')):
        el.remove(old)
    first = OxmlElement('w:tblStylePr')
    first.set(qn('w:type'), 'firstRow')
    frpr = OxmlElement('w:rPr')
    b = OxmlElement('w:b')
    frpr.append(b)
    color = OxmlElement('w:color')
    color.set(qn('w:val'), SOY_900)
    frpr.append(color)
    first.append(frpr)
    tcPr = OxmlElement('w:tcPr')
    tcb = OxmlElement('w:tcBorders')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:space'), '0')
    bottom.set(qn('w:color'), YUAN_500)
    tcb.append(bottom)
    tcPr.append(tcb)
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), CREAM_100)
    tcPr.append(shd)
    va = OxmlElement('w:vAlign')
    va.set(qn('w:val'), 'bottom')
    tcPr.append(va)
    first.append(tcPr)
    el.append(first)


def add_footer(doc):
    """A4, margins, a cover page without footer, then "FundBun · … | page N" on every other page."""
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.0)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.2)
    sec.header_distance = Cm(1.0)
    sec.footer_distance = Cm(1.0)
    sec.different_first_page_header_footer = True
    text_width = sec.page_width - sec.left_margin - sec.right_margin

    footer = sec.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0]
    p.style = doc.styles['Footer']
    p.paragraph_format.tab_stops.add_tab_stop(text_width, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.SPACES)
    border(p._p, 'top', RULE, size=4, space=6)
    r = p.add_run('FundBun')
    r.bold = True
    r.font.color.rgb = rgb(SOY_900)
    p.add_run('  ·  FinTechathon 2026 · International AI Track · Topic A').font.color.rgb = rgb(SOY_700)
    p.add_run('\t')
    run = p.add_run()
    for kind, text in (('begin', None), (None, ' PAGE '), ('separate', None), (None, '2'), ('end', None)):
        if kind:
            fc = OxmlElement('w:fldChar')
            fc.set(qn('w:fldCharType'), kind)
            run._r.append(fc)
        elif text.strip() == 'PAGE':
            it = OxmlElement('w:instrText')
            it.set(qn('xml:space'), 'preserve')
            it.text = text
            run._r.append(it)
        else:
            t = OxmlElement('w:t')
            t.text = text
            run._r.append(t)
    run.font.color.rgb = rgb(SOY_900)
    run.bold = True
    # empty first-page footer (the cover)
    sec.first_page_footer.is_linked_to_previous = False


# OOXML is order-sensitive: Word can refuse a file whose pPr / rPr children are out of schema order, and the
# helpers above append. Sort every pPr / rPr (styles, footer) into the order ECMA-376 defines before saving.
PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
             'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
             'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
             'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
             'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange']
RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline',
             'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w',
             'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign',
             'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath']
BDR_ORDER = ['top', 'left', 'bottom', 'right', 'between', 'bar']


def schema_order(root):
    def local(el):
        return el.tag.split('}')[-1]
    for tag, order in (('pPr', PPR_ORDER), ('rPr', RPR_ORDER), ('pBdr', BDR_ORDER)):
        for el in root.iter(qn(f'w:{tag}')):
            kids = list(el)
            kids.sort(key=lambda k: order.index(local(k)) if local(k) in order else len(order))
            for k in kids:
                el.remove(k)
            for k in kids:
                el.append(k)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, 'default.docx')
        subprocess.run(['pandoc', '-o', base, '--print-default-data-file', 'reference.docx'], check=True)
        doc = Document(base)

    # document defaults: Calibri 11, soy ink
    rpr_default = doc.styles.element.find(qn('w:docDefaults')).find(qn('w:rPrDefault')).find(qn('w:rPr'))
    fonts = rpr_default.find(qn('w:rFonts'))
    for attr in list(fonts.attrib):
        del fonts.attrib[attr]
    for k in ('w:ascii', 'w:hAnsi', 'w:cs'):
        fonts.set(qn(k), SANS)
    fonts.set(qn('w:eastAsia'), 'PingFang SC')
    for tag in ('w:sz', 'w:szCs'):
        rpr_default.find(qn(tag)).set(qn('w:val'), '22')
    color = OxmlElement('w:color')
    color.set(qn('w:val'), SOY_900)
    rpr_default.append(color)

    st = doc.styles
    style_run(st['Normal'], SANS, 11, SOY_900)
    style_par(st['Normal'], after=6, line=1.15)
    style_par(st['Body Text'], before=0, after=8, line=1.2)
    style_par(st['First Paragraph'], before=0, after=8, line=1.2)
    style_par(st['Compact'], before=1, after=1, line=1.1)

    # headings: Georgia, soy ink, gold accents
    h1 = st['Heading 1']
    style_run(h1, SERIF, 22, SOY_900, bold=False)
    style_par(h1, before=0, after=14, page_break_before=True, keep_next=True)
    border(h1.element, 'bottom', YUAN_500, size=12, space=6)
    h2 = st['Heading 2']
    style_run(h2, SERIF, 15, BAMBOO_600, bold=False)
    style_par(h2, before=18, after=6, keep_next=True)
    h3 = st['Heading 3']
    style_run(h3, SERIF, 12.5, SOY_900, bold=True)
    style_par(h3, before=14, after=4, keep_next=True)
    h4 = st['Heading 4']
    style_run(h4, SANS, 11, SOY_700, bold=True, italic=False)
    style_par(h4, before=10, after=3, keep_next=True)
    for name in ('Heading 5', 'Heading 6'):
        style_run(st[name], SANS, 10.5, SOY_700, bold=True, italic=False)

    # title block (pandoc's own, in case metadata is used) and the cover styles build.ts uses
    title = st['Title']
    style_run(title, SERIF, 34, SOY_900, bold=False)
    style_par(title, before=6, after=6, line=1.0, align=WD_ALIGN_PARAGRAPH.LEFT)
    for name in ('Title',):
        rpr = st[name].element.get_or_add_rPr()
        for tag in ('w:b', 'w:bCs'):
            e = rpr.find(qn(tag))
            if e is not None:
                rpr.remove(e)
    sub = st['Subtitle']
    style_run(sub, SANS, 13, BAMBOO_600, bold=False, italic=False)
    style_par(sub, before=0, after=18, align=WD_ALIGN_PARAGRAPH.LEFT)
    for name in ('Author', 'Date'):
        style_run(st[name], SANS, 11, SOY_700)
        style_par(st[name], before=0, after=2, align=WD_ALIGN_PARAGRAPH.LEFT)

    logo = get_or_add(doc, 'Cover Logo', base='Normal')
    style_par(logo, before=60, after=36, align=WD_ALIGN_PARAGRAPH.LEFT)
    kicker = get_or_add(doc, 'Cover Kicker', base='Normal')
    style_run(kicker, SANS, 9.5, YUAN_600, bold=True, caps=True, spacing=30)
    style_par(kicker, before=0, after=4)
    track = get_or_add(doc, 'Cover Track', base='Normal')
    style_run(track, SANS, 11, SOY_700)
    style_par(track, before=0, after=30)
    note = get_or_add(doc, 'Cover Note', base='Normal')
    style_run(note, SANS, 10.5, SOY_700, italic=True)
    style_par(note, before=0, after=20)
    meta = get_or_add(doc, 'Cover Meta', base='Normal')
    style_run(meta, SANS, 10, SOY_700)
    style_par(meta, before=18, after=2)

    toc_h = st['TOC Heading']
    style_run(toc_h, SERIF, 22, SOY_900, bold=False)
    style_par(toc_h, before=0, after=14, page_break_before=False)
    toc1 = get_or_add(doc, 'TOC 1', base='Normal')
    style_run(toc1, SANS, 11, SOY_900, bold=True)
    style_par(toc1, before=8, after=2)
    toc2 = get_or_add(doc, 'TOC 2', base='Normal')
    style_run(toc2, SANS, 10.5, SOY_700)
    style_par(toc2, before=0, after=1, indent_left=Cm(0.6))

    # figures and captions
    for name in ('Figure', 'Captioned Figure'):
        style_par(st[name], before=8, after=2, align=WD_ALIGN_PARAGRAPH.CENTER, keep_next=True)
    row = get_or_add(doc, 'Figure Row', base='Normal')
    style_par(row, before=10, after=2, align=WD_ALIGN_PARAGRAPH.CENTER, keep_next=True, line=1.0)
    caption_styles = [s_ for s_ in st if s_.type == WD_STYLE_TYPE.PARAGRAPH and s_.style_id in ('Caption', 'ImageCaption', 'TableCaption')]
    for cap in caption_styles:
        style_run(cap, SANS, 9, SOY_700, italic=True)
        style_par(cap, before=2, after=12, align=WD_ALIGN_PARAGRAPH.CENTER)
    style_par(st['Table Caption'], align=WD_ALIGN_PARAGRAPH.LEFT, before=6, after=4)

    # quotes, code, links
    bt = st['Block Text']
    style_run(bt, SANS, 10.5, SOY_700, italic=False)
    style_par(bt, before=6, after=6)
    border(bt.element, 'left', YUAN_500, size=18, space=8)
    code = get_or_add(doc, 'Source Code', base='Normal')
    style_run(code, MONO, 8.5, SOY_900)
    style_par(code, before=4, after=8, line=1.0)
    shade(code.element, CREAM_100)
    border(code.element, 'left', YUAN_500, size=12, space=6)
    vc = st['Verbatim Char']
    style_run(vc, MONO, 9.5, SOY_700)
    link = st['Hyperlink']
    style_run(link, None, None, BAMBOO_600)
    link.font.underline = True

    footer_style = get_or_add(doc, 'Footer', base='Normal')
    style_run(footer_style, SANS, 8.5, SOY_700)
    style_par(footer_style, before=0, after=0)

    restyle_table(doc)
    add_footer(doc)

    # the sample body pandoc ships is irrelevant (pandoc only reads styles, numbering, headers/footers and sectPr)
    body = doc.element.body
    for child in list(body):
        if child.tag != qn('w:sectPr'):
            body.remove(child)
    doc.add_paragraph('FundBun reference document — styles only.', style='Body Text')

    schema_order(doc.styles.element)
    for part in (doc.sections[0].footer, doc.sections[0].first_page_footer):
        schema_order(part._element)
    schema_order(doc.element)

    props = doc.core_properties
    props.author = 'FundBun'
    props.title = 'FundBun reference styles'
    doc.save(OUT)
    print(f'wrote {os.path.relpath(OUT)}')


if __name__ == '__main__':
    sys.exit(main())
