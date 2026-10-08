"""
Finishes a pandoc-built DOCX for docs/export/build.ts (standard library only).

    python3 docs/export/docx_post.py in.docx out.docx --title "…" --subject "…" --author "…" --date 2026-10-20

1. Replaces the @@FUNDBUN_TOC@@ marker paragraph with a real Word table-of-contents field (TOC \\o "1-2" \\h \\z \\u),
   pre-filled with the document's Heading 1/2 entries as clickable links, so the contents page is never empty.
   The field is marked dirty: Word offers to update it on open, which adds the page numbers.
2. Makes table header rows repeat across pages and keeps rows from splitting.
3. Sets the document properties (title, subject, author, dates).
"""
import argparse
import html
import os
import re
import shutil
import sys
import tempfile
import zipfile

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
TEXT_WIDTH_TWIPS = 9638  # A4 (11906) minus 2 × 2.0 cm margins (2 × 1134)

MARKER_RE = re.compile(r'<w:p>\s*<w:r>\s*<w:t>@@FUNDBUN_TOC@@</w:t>\s*</w:r>\s*</w:p>')
PARA_RE = re.compile(r'<w:p\b[^>]*>.*?</w:p>', re.S)
HEADING_RE = re.compile(r'<w:pStyle w:val="Heading([12])"\s*/>')
BOOKMARK_RE = re.compile(r'<w:bookmarkStart\b[^>]*w:name="([^"]+)"[^>]*/>')
TEXT_RE = re.compile(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', re.S)


def headings(xml):
    """(level, text, bookmark) for every Heading 1/2 paragraph, in order. pandoc puts the heading's bookmark either
    inside the paragraph or immediately before it (section wrappers)."""
    out = []
    for m in PARA_RE.finditer(xml):
        para = m.group(0)
        h = HEADING_RE.search(para)
        if not h:
            continue
        text = html.unescape(''.join(TEXT_RE.findall(para))).strip()
        if not text:
            continue
        bm = BOOKMARK_RE.search(para)
        name = bm.group(1) if bm else None
        if not name:
            before = xml[max(0, m.start() - 600):m.start()]
            prev = BOOKMARK_RE.findall(before)
            tail = before[before.rfind('<w:bookmarkStart'):] if prev else ''
            # only a bookmark that directly precedes this paragraph (nothing but bookmarks/whitespace in between)
            if prev and re.fullmatch(r'(\s*<w:bookmarkStart\b[^>]*/>\s*)+', tail):
                name = prev[-1]
        out.append((int(h.group(1)), text, name))
    return out


def esc(s):
    return html.escape(s, quote=False)


def toc_xml(entries):
    """The TOC as an SDT with one field spanning the entry paragraphs (begin in the first, end in the last)."""
    begin = (
        '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    )
    end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    paras = []
    if not entries:
        entries = [(1, 'Right-click and choose Update Field to build the contents.', None)]
    for i, (level, text, anchor) in enumerate(entries):
        ppr = (
            f'<w:pPr><w:pStyle w:val="TOC{level}"/>'
            f'<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="{TEXT_WIDTH_TWIPS}"/></w:tabs></w:pPr>'
        )
        run = f'<w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'
        if anchor:
            run = f'<w:hyperlink w:anchor="{esc(anchor)}" w:history="1">{run}</w:hyperlink>'
        paras.append(f'<w:p>{ppr}{begin if i == 0 else ""}{run}{end if i == len(entries) - 1 else ""}</w:p>')
    return (
        '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/>'
        '</w:docPartObj></w:sdtPr><w:sdtContent>'
        '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>'
        + ''.join(paras)
        + '</w:sdtContent></w:sdt>'
    )


def repeat_table_headers(xml):
    """First row of every table repeats on each page; rows never split across pages."""
    def fix_table(m):
        tbl = m.group(0)
        first = re.search(r'<w:tr\b[^>]*>', tbl)
        if not first:
            return tbl
        head_end = first.end()
        trpr = re.match(r'\s*<w:trPr>(.*?)</w:trPr>', tbl[head_end:], re.S)
        if trpr:
            if '<w:tblHeader' not in trpr.group(1):
                inner = trpr.group(1) + '<w:tblHeader/>'
                tbl = tbl[:head_end] + tbl[head_end:].replace(trpr.group(0), f'<w:trPr>{inner}</w:trPr>', 1)
        else:
            tbl = tbl[:head_end] + '<w:trPr><w:tblHeader/></w:trPr>' + tbl[head_end:]
        # cantSplit on every row
        def cant_split(r):
            row = r.group(0)
            if '<w:cantSplit' in row:
                return row
            if re.match(r'<w:tr\b[^>]*>\s*<w:trPr>', row):
                return re.sub(r'<w:trPr>', '<w:trPr><w:cantSplit/>', row, count=1)
            return re.sub(r'(<w:tr\b[^>]*>)', r'\1<w:trPr><w:cantSplit/></w:trPr>', row, count=1)
        return re.sub(r'<w:tr\b[^>]*>.*?</w:tr>', cant_split, tbl, flags=re.S)
    return re.sub(r'<w:tbl>.*?</w:tbl>', fix_table, xml, flags=re.S)


def core_props(xml, title, subject, author, date):
    def put(tag, value, xml):
        value = esc(value)
        if re.search(f'<{tag}[ >]', xml) or f'<{tag}/>' in xml:
            xml = re.sub(f'<{tag}(?: [^>]*)?/>', f'<{tag}>{value}</{tag}>', xml)
            return re.sub(f'(<{tag}(?: [^>]*)?>).*?(</{tag}>)', lambda m: m.group(1) + value + m.group(2), xml, flags=re.S)
        return xml.replace('</cp:coreProperties>', f'<{tag}>{value}</{tag}></cp:coreProperties>')
    xml = put('dc:title', title, xml)
    xml = put('dc:subject', subject, xml)
    xml = put('dc:creator', author, xml)
    xml = put('cp:keywords', 'FundBun; FinTechathon 2026; International AI Track; Topic A', xml)
    stamp = f'{date}T00:00:00Z'
    for tag in ('dcterms:created', 'dcterms:modified'):
        if f'<{tag}' in xml:
            xml = re.sub(f'(<{tag}[^>]*>).*?(</{tag}>)', lambda m: m.group(1) + stamp + m.group(2), xml, flags=re.S)
        else:
            xml = xml.replace(
                '</cp:coreProperties>',
                f'<{tag} xsi:type="dcterms:W3CDTF">{stamp}</{tag}></cp:coreProperties>',
            )
    if 'xmlns:xsi=' not in xml:
        xml = xml.replace('<cp:coreProperties ', '<cp:coreProperties xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ', 1)
    if 'xmlns:dcterms=' not in xml:
        xml = xml.replace('<cp:coreProperties ', '<cp:coreProperties xmlns:dcterms="http://purl.org/dc/terms/" ', 1)
    return xml


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dest')
    ap.add_argument('--title', required=True)
    ap.add_argument('--subject', default='')
    ap.add_argument('--author', default='')
    ap.add_argument('--date', default='2026-10-20')
    a = ap.parse_args()

    with zipfile.ZipFile(a.src) as zin:
        items = [(i, zin.read(i.filename)) for i in zin.infolist()]

    out_items = []
    toc_entries = 0
    for info, data in items:
        if info.filename == 'word/document.xml':
            xml = data.decode('utf-8')
            if not MARKER_RE.search(xml):
                sys.exit('docx_post: TOC marker not found in word/document.xml')
            entries = headings(xml)
            toc_entries = len(entries)
            xml = MARKER_RE.sub(lambda _m: toc_xml(entries), xml, count=1)
            xml = repeat_table_headers(xml)
            data = xml.encode('utf-8')
        elif info.filename == 'docProps/core.xml':
            data = core_props(data.decode('utf-8'), a.title, a.subject, a.author, a.date).encode('utf-8')
        out_items.append((info, data))

    with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
        tmp_path = tmp.name
    with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info, data in out_items:
            # [Content_Types].xml first, as Word expects; fixed timestamps keep rebuilds byte-stable
            zi = zipfile.ZipInfo(info.filename, date_time=(2026, 10, 20, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zout.writestr(zi, data)
    os.chmod(tmp_path, 0o644)  # NamedTemporaryFile is 0600; the export is meant to be shared
    shutil.move(tmp_path, a.dest)
    print(f'docx_post: {a.dest} · contents entries: {toc_entries}')


if __name__ == '__main__':
    main()
