/**
 * Exports the three written submission documents to Word and PDF, branded, from their Markdown sources.
 *
 *   npm run docs:export                                  → docs/export/out/
 *   npm run docs:export -- --out ../submission           (any folder; existing files are replaced)
 *   npm run docs:export -- --only evidence               (technical | security | evidence, comma-separated)
 *   npm run docs:export -- --no-zip --no-pdf --keep-html (skip the evidence zip / PDFs; keep the HTML for QA)
 *
 * docs/TECHNICAL.md            → InternationalAI-FundBun-TechnicalDocument.docx / .pdf
 * docs/SECURITY_SELF_ASSESSMENT.md → InternationalAI-FundBun-SecuritySelfAssessment.docx / .pdf
 * docs/EXECUTION_EVIDENCE.md   → InternationalAI-FundBun-ExecutionEvidence.docx / .pdf
 * evidence/latest/             → InternationalAI-FundBun-ExecutionEvidence-Logs.zip
 *
 * DOCX: pandoc with docs/export/reference.docx (styles from make-reference.py), a cover page (wordmark, the official
 * template's title lines, title, header table, team, date), a Word TOC field pre-filled with the headings
 * (docx_post.py; Word refreshes page numbers on open), images embedded from docs/assets.
 * PDF: pandoc → standalone HTML (template.html + print.css with the self-hosted Fraunces / DM Sans) → Playwright
 * page.pdf on system Chrome (channel 'chrome'), A4, page numbers from CSS @page margin boxes. A second pass fills
 * the contents page's page numbers from the first render's text (pdftotext, when installed).
 *
 * Needs pandoc ≥ 3 and python3 on PATH, system Chrome for the PDFs, and `zip` for the evidence archive.
 * Repository-relative links become github.com/odripads/fundbun links, so they work outside the repo.
 */
import { chromium, type Browser } from 'playwright'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXPORT_DIR = dirname(fileURLToPath(import.meta.url))
const DOCS = resolve(EXPORT_DIR, '..')
const ROOT = resolve(DOCS, '..')
const REPO_URL = 'https://github.com/odripads/fundbun'
const SUBMISSION_DATE = '2026-10-20'
const DATE_LONG = '20 October 2026'
const TEAM = [
  'Team FundBun · Odri Prince Sembiring (team leader), Universitas Gadjah Mada',
  'Nadine Griselda, Universitas Airlangga',
]
const FILE_PREFIX = 'InternationalAI-FundBun-'

interface DocSpec {
  key: 'technical' | 'security' | 'evidence'
  src: string
  file: string
  /** cover title and running footer */
  title: string
  /** the official template's second title line */
  track: string
  subtitle: string
  /** the official template's third title line */
  note: string
}

const DOCS_SPEC: DocSpec[] = [
  {
    key: 'technical',
    src: 'TECHNICAL.md',
    file: 'TechnicalDocument',
    title: 'Technical Document',
    track: 'International AI Track | Technical Document',
    subtitle: 'System architecture, agent design, core algorithms, security design, deployment and testing',
    note: 'Required material for the International AI Track. Completed in English.',
  },
  {
    key: 'security',
    src: 'SECURITY_SELF_ASSESSMENT.md',
    file: 'SecuritySelfAssessment',
    title: 'Security Self-assessment',
    track: 'International AI Track | Security Self-assessment',
    subtitle: 'Permission model, security tests, data and privacy, known risks',
    note: 'Optional supporting material. Completed in English.',
  },
  {
    key: 'evidence',
    src: 'EXECUTION_EVIDENCE.md',
    file: 'ExecutionEvidence',
    title: 'Execution Evidence',
    track: 'International AI Track | Execution Evidence',
    subtitle: 'Sandbox operation logs, metrics, and how to reproduce them',
    note: 'Optional supporting material for operation logs or on-chain transaction evidence (Topic A: sandbox logs and the demo video).',
  },
]

// ───────────────────────────── CLI ─────────────────────────────

function parseArgs(argv: string[]) {
  const out: { out: string; only: string[] | null; zip: boolean; pdf: boolean; docx: boolean; keepHtml: boolean } = {
    out: join(EXPORT_DIR, 'out'),
    only: null,
    zip: true,
    pdf: true,
    docx: true,
    keepHtml: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') out.out = resolve(process.cwd(), argv[++i])
    else if (a === '--only') out.only = argv[++i].split(',').map((s) => s.trim())
    else if (a === '--no-zip') out.zip = false
    else if (a === '--no-pdf') out.pdf = false
    else if (a === '--no-docx') out.docx = false
    else if (a === '--keep-html') out.keepHtml = true
    else throw new Error(`unknown option ${a}`)
  }
  return out
}

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): string {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, input: opts.input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stderr}`)
  if (r.stderr?.trim()) process.stderr.write(r.stderr.split('\n').filter((l) => l.trim()).map((l) => `  ${cmd}: ${l}\n`).join(''))
  return r.stdout
}

function has(cmd: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0
}

/** iCloud-safe replace: delete, then write once. */
function place(from: string, to: string) {
  if (existsSync(to)) rmSync(to)
  copyFileSync(from, to)
}

// ───────────────────────────── Markdown preprocessing ─────────────────────────────

interface Parts {
  headerTable: string
  body: string
}

/** Splits off the template title block (dropped: the cover carries it) and the header table (moved to the cover). */
function splitFront(md: string): Parts {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^\|\s*Field\s*\|\s*Value\s*\|/.test(l))
  if (start < 0) throw new Error('header table (| Field | Value |) not found')
  let end = start
  while (end < lines.length && lines[end].startsWith('|')) end++
  return { headerTable: lines.slice(start, end).join('\n'), body: lines.slice(end).join('\n') }
}

/** Applies `fn` to the Markdown outside fenced code blocks only. */
function outsideCode(md: string, fn: (chunk: string) => string): string {
  const parts = md.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join('')
}

/** The template's footer note is an instruction to entrants, and `---` rules are replaced by page breaks. */
function dropTemplateChrome(md: string): string {
  return outsideCode(md, (c) =>
    c
      .replace(/^\*Complete this document according to the competition notice\.[^\n]*\*\s*$/m, '')
      .replace(/^---[ \t]*$/gm, ''),
  )
}

/**
 * `## 01 Project Overview` → `## [01]{.num} Project Overview` (styled numeral; the heading id is unchanged).
 * The sources use `#` for the document title (dropped here) and `##` for the template's numbered sections; pandoc
 * runs with --shift-heading-level-by=-1, so those sections become level 1 in Word and in the PDF.
 */
function numberHeadings(md: string): string {
  return outsideCode(md, (c) => c.replace(/^## (\d{2}) (.+)$/gm, '## [$1]{.num} $2'))
}

const REPO_RELATIVE = /^(?![a-z][a-z0-9+.-]*:|#|\/)/i

/** Repository-relative links (relative to docs/) → GitHub URLs; images stay local so they embed. */
function rewriteLinks(md: string): string {
  const toUrl = (target: string) => {
    const [path, hash] = target.split('#')
    const repoPath = posix.normalize(posix.join('docs', path))
    if (repoPath.startsWith('..')) return target
    const kind = path.endsWith('/') ? 'tree' : 'blob'
    return `${REPO_URL}/${kind}/main/${repoPath.replace(/\/$/, '')}${hash ? `#${hash}` : ''}`
  }
  return outsideCode(md, (c) =>
    c
      .replace(/(?<!!)\[((?:[^\][]|\[[^\]]*\])*)\]\(([^)\s]+)\)/g, (m, text: string, target: string) =>
        REPO_RELATIVE.test(target) && !target.startsWith('assets/') ? `[${text}](${toUrl(target)})` : m,
      )
      .replace(/^(\[[^\]]+\]):\s+(\S+)\s*$/gm, (m, label: string, target: string) => (REPO_RELATIVE.test(target) ? `${label}: ${toUrl(target)}` : m)),
  )
}

/** Width of each phone screenshot in a row of n (percent of the text width). */
const ROW_WIDTH: Record<number, number> = { 1: 32, 2: 28, 3: 26 }

/**
 * The repo's figure rows are HTML (so GitHub shows them side by side at a sensible size):
 *   <p align="center"><img src=… width=… alt=…> …</p>  +  <p align="center"><em>caption</em></p>
 * They become pandoc divs: a centred row of sized images ("Figure Row" in Word) and a caption ("Image Caption").
 */
function figureRows(md: string): string {
  const row = /<p align="center">\s*((?:<img\b[^>]*>\s*)+)<\/p>\s*(?:\n\s*<p align="center"><em>([\s\S]*?)<\/em><\/p>)?/g
  return md.replace(row, (_m, imgs: string, caption?: string) => {
    const items = [...imgs.matchAll(/<img\b([^>]*)>/g)].map((m) => {
      const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(m[1])?.[1] ?? ''
      return { src: attr('src'), alt: attr('alt') }
    })
    const w = ROW_WIDTH[items.length] ?? Math.floor(90 / items.length)
    const images = items.map((i) => `![${escapeAlt(i.alt)}](${i.src}){width=${w}%}`).join(' ')
    const cap = caption ? `\n\n::: {.figure-caption custom-style="Image Caption"}\n${caption.trim()}\n:::\n` : '\n'
    // a trailing non-breaking space keeps a lone image inline (not a pandoc figure with the alt text as caption)
    return `::: {.figure-row custom-style="Figure Row"}\n${images}\\ \n:::\n${cap}`
  })
}

function escapeAlt(s: string): string {
  return s.replace(/([[\]*_`\\])/g, '\\$1')
}

/** Full-width figures: diagrams and desktop screenshots fill the text width; diagrams lose the screenshot frame. */
function sizeFigures(md: string): string {
  return outsideCode(md, (c) =>
    c.replace(/^!\[([^\]]*)\]\((assets\/[^)\s]+)\)(?!\{)[ \t]*$/gm, (_m, alt: string, src: string) => {
      const cls = src.includes('/diagrams/') ? ' .diagram' : ''
      return `![${alt}](${src}){width=100%${cls}}`
    }),
  )
}

/** Plain text of a table cell, for width estimates. */
function cellText(cell: string): string {
  return cell
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function splitRow(line: string): string[] {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/)
  return cells.map((c) => c.trim())
}

/**
 * pandoc sizes pipe-table columns by the dashes in the separator row; the sources all use `|---|`, which would give
 * equal columns. Re-weight the dashes from the cell contents so long columns get the room (Word and PDF alike).
 */
function weightTables(md: string): string {
  return outsideCode(md, (c) => {
    const lines = c.split('\n')
    for (let i = 0; i + 1 < lines.length; i++) {
      if (!lines[i].startsWith('|') || !/^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[i + 1])) continue
      let j = i + 2
      while (j < lines.length && lines[j].startsWith('|')) j++
      const rows = [lines[i], ...lines.slice(i + 2, j)].map(splitRow)
      const n = splitRow(lines[i + 1]).length
      const weights = Array.from({ length: n }, (_, k) => {
        const lens = rows.map((r) => cellText(r[k] ?? '').length)
        const max = Math.max(...lens)
        const avg = lens.reduce((a, b) => a + b, 0) / lens.length
        const header = cellText(rows[0][k] ?? '').length
        // a column of paths or rule ids can't wrap mid-token: its longest token is a floor
        const token = Math.max(...rows.map((r) => Math.max(0, ...cellText(r[k] ?? '').split(/\s+/).map((w) => w.length))))
        return Math.max(0.35 * Math.min(max, 90) + 0.65 * avg, header * 0.9, Math.min(token, 26) * 1.05, 4)
      })
      const total = weights.reduce((a, b) => a + b, 0)
      const aligns = splitRow(lines[i + 1])
      lines[i + 1] = `|${weights
        .map((w, k) => {
          const dashes = '-'.repeat(Math.max(3, Math.round((w / total) * 100)))
          const a = aligns[k] ?? ''
          return `${a.startsWith(':') ? ':' : ''}${dashes}${a.endsWith(':') && a.length > 1 ? ':' : ''}`
        })
        .join('|')}|`
      i = j - 1
    }
    return lines.join('\n')
  })
}

function body(md: string): { headerTable: string; content: string } {
  const { headerTable, body: rest } = splitFront(md)
  let content = dropTemplateChrome(rest)
  content = figureRows(content)
  content = sizeFigures(content)
  content = numberHeadings(content)
  content = rewriteLinks(content)
  content = weightTables(content)
  return { headerTable, content: content.replace(/\n{3,}/g, '\n\n').trim() + '\n' }
}

// ───────────────────────────── DOCX ─────────────────────────────

const PAGE_BREAK = '```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```'
const TOC_MARKER = '```{=openxml}\n<w:p><w:r><w:t>@@FUNDBUN_TOC@@</w:t></w:r></w:p>\n```'

function docxMarkdown(spec: DocSpec, headerTable: string, content: string): string {
  const div = (style: string, text: string) => `::: {custom-style="${style}"}\n${text}\n:::`
  return [
    div('Cover Logo', '![FundBun](assets/brand/fundbun-wordmark.png){width=2.5in}\\ '),
    div('Cover Kicker', '2026 FinTechathon · Submission template'),
    div('Cover Track', spec.track),
    div('Title', spec.title),
    div('Subtitle', spec.subtitle),
    div('Cover Note', `*${spec.note}*`),
    weightTables(headerTable),
    div('Cover Meta', `**${TEAM[0]}**\\\n${TEAM.slice(1).join('\\\n')}`),
    div('Cover Meta', `Source code: [github.com/odripads/fundbun](${REPO_URL}) · ${DATE_LONG}`),
    PAGE_BREAK,
    TOC_MARKER,
    content,
  ].join('\n\n')
}

function buildDocx(spec: DocSpec, md: string, tmp: string): string {
  const src = join(tmp, `${spec.key}.docx.md`)
  const raw = join(tmp, `${spec.key}.raw.docx`)
  const out = join(tmp, `${FILE_PREFIX}${spec.file}.docx`)
  writeFileSync(src, md)
  run('pandoc', [
    src, '-f', 'markdown+lists_without_preceding_blankline', '-t', 'docx',
    `--reference-doc=${join(EXPORT_DIR, 'reference.docx')}`,
    `--resource-path=${DOCS}`,
    '--syntax-highlighting=none',
    '--shift-heading-level-by=-1',
    '-o', raw,
  ])
  run('python3', [
    join(EXPORT_DIR, 'docx_post.py'), raw, out,
    '--title', `FundBun — ${spec.title}`,
    '--subject', 'FinTechathon 2026 · International AI Track · Topic A: Personal Finance Assistant',
    '--author', 'Odri Prince Sembiring; Nadine Griselda',
    '--date', SUBMISSION_DATE,
  ])
  return out
}

// ───────────────────────────── HTML → PDF ─────────────────────────────

function yamlString(s: string): string {
  return JSON.stringify(s)
}

function buildHtml(spec: DocSpec, headerTable: string, content: string, tmp: string): string {
  const src = join(tmp, `${spec.key}.html.md`)
  const meta = join(tmp, `${spec.key}.meta.yaml`)
  const out = join(tmp, `${FILE_PREFIX}${spec.file}.html`)
  writeFileSync(src, content)
  writeFileSync(meta, [
    `title: ${yamlString(spec.title)}`,
    `pagetitle: ${yamlString(`FundBun — ${spec.title}`)}`,
    `footer-title: ${yamlString(spec.title)}`,
    `kicker: ${yamlString('2026 FinTechathon · Submission template')}`,
    `track: ${yamlString(spec.track)}`,
    `subtitle: ${yamlString(spec.subtitle)}`,
    `note: ${yamlString(spec.note)}`,
    'author:',
    ...TEAM.map((t) => `  - ${yamlString(t)}`),
    `date: ${yamlString(DATE_LONG)}`,
    `repo: ${yamlString(REPO_URL)}`,
    `repo-label: ${yamlString('github.com/odripads/fundbun')}`,
    `base-url: ${yamlString(`${pathToFileURL(DOCS).href}/`)}`,
    `css-href: ${yamlString('export/print.css')}`,
    'cover-table: |',
    ...weightTables(headerTable).split('\n').map((l) => `  ${l}`),
    '',
  ].join('\n'))
  run('pandoc', [
    src, '-f', 'markdown+lists_without_preceding_blankline', '-t', 'html5', '--standalone',
    `--template=${join(EXPORT_DIR, 'template.html')}`,
    `--metadata-file=${meta}`,
    '--toc', '--toc-depth=2',
    '--syntax-highlighting=none',
    '--shift-heading-level-by=-1',
    '--wrap=none',
    '-o', out,
  ])
  return out
}

/** Page texts of a PDF (pdftotext, form-feed separated), or null when poppler is not installed. */
function pdfPages(pdf: string): string[] | null {
  if (!has('pdftotext')) return null
  const text = run('pdftotext', ['-enc', 'UTF-8', pdf, '-'])
  const pages = text.split('\f')
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop()
  return pages
}

const norm = (s: string) => s.replace(/[­​]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

async function printPdf(browser: Browser, html: string, out: string): Promise<number> {
  const page = await browser.newPage()
  try {
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }))))
    })
    const pdf = () => page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true })
    await pdf()
    // contents page numbers: locate every heading after the contents page, inject, re-print until stable
    for (let pass = 0; pass < 3; pass++) {
      const pages = pdfPages(out)
      if (!pages) return 0
      const entries: string[] = await page.$$eval('nav.toc a', (as) => as.map((a) => (a.querySelector('.toc-label') ?? a).textContent ?? ''))
      // the first entry is a section heading, which always opens a page: the first page (after the contents page)
      // that STARTS with it is where the body begins — a contents page spilling over never starts with entry 1
      const first = norm(entries[0] ?? '')
      let at = pages.findIndex((p, i) => i >= 2 && norm(p).startsWith(first))
      if (at < 0) at = 2
      const numbers = entries.map((label) => {
        const want = norm(label)
        for (let i = at; i < pages.length; i++) {
          if (norm(pages[i]).includes(want)) {
            at = i
            return String(i + 1)
          }
        }
        return ''
      })
      const changed = await page.$$eval('nav.toc a', (as, nums) => {
        let diff = false
        as.forEach((a, k) => {
          let label = a.querySelector('.toc-label')
          if (!label) {
            label = document.createElement('span')
            label.className = 'toc-label'
            while (a.firstChild) label.appendChild(a.firstChild)
            a.appendChild(label)
          }
          let num = a.querySelector('.toc-page')
          if (!num) {
            num = document.createElement('span')
            num.className = 'toc-page'
            a.appendChild(num)
          }
          if (num.textContent !== nums[k]) diff = true
          num.textContent = nums[k]
        })
        return diff
      }, numbers)
      if (!changed) return pages.length
      await pdf()
    }
    return pdfPages(out)?.length ?? 0
  } finally {
    await page.close()
  }
}

// ───────────────────────────── evidence zip ─────────────────────────────

function zipEvidence(outDir: string, tmp: string): string {
  const name = `${FILE_PREFIX}ExecutionEvidence-Logs.zip`
  const staged = join(tmp, name)
  run('zip', ['-X', '-r', '-q', staged, 'latest', '-x', '*.DS_Store'], { cwd: join(ROOT, 'evidence') })
  const dest = join(outDir, name)
  place(staged, dest)
  return dest
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  for (const cmd of ['pandoc', 'python3']) if (!has(cmd)) throw new Error(`${cmd} is required on PATH`)
  if (!existsSync(join(EXPORT_DIR, 'reference.docx'))) run('python3', [join(EXPORT_DIR, 'make-reference.py')])
  mkdirSync(opts.out, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'fundbun-docs-'))
  const specs = DOCS_SPEC.filter((d) => !opts.only || opts.only.includes(d.key))
  const browser = opts.pdf ? await chromium.launch({ channel: 'chrome' }) : null
  const written: string[] = []
  try {
    for (const spec of specs) {
      const md = readFileSync(join(DOCS, spec.src), 'utf8')
      const { headerTable, content } = body(md)
      if (opts.docx) {
        const docx = buildDocx(spec, docxMarkdown(spec, headerTable, content), tmp)
        const dest = join(opts.out, `${FILE_PREFIX}${spec.file}.docx`)
        place(docx, dest)
        written.push(`${relativeOut(dest)}  (${kb(dest)})`)
      }
      if (browser) {
        const html = buildHtml(spec, headerTable, content, tmp)
        const pdf = join(tmp, `${FILE_PREFIX}${spec.file}.pdf`)
        const pages = await printPdf(browser, html, pdf)
        const dest = join(opts.out, `${FILE_PREFIX}${spec.file}.pdf`)
        place(pdf, dest)
        written.push(`${relativeOut(dest)}  (${kb(dest)}${pages ? `, ${pages} pages` : ''})`)
        if (opts.keepHtml) written.push(`${html}  (HTML kept for QA)`)
      }
    }
    if (opts.zip && !opts.only) {
      const zip = zipEvidence(opts.out, tmp)
      written.push(`${relativeOut(zip)}  (${kb(zip)})`)
    }
  } finally {
    await browser?.close()
    if (!opts.keepHtml) rmSync(tmp, { recursive: true, force: true })
  }
  console.log(`docs:export → ${opts.out}\n${written.map((w) => `  ${w}`).join('\n')}`)
}

function kb(path: string): string {
  const size = statSync(path).size
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`
}

function relativeOut(p: string): string {
  const r = relative(process.cwd(), p)
  return r.startsWith('..') ? p : r
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
