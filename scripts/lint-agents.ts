/**
 * FundBun's zero-dependency TypeScript AST linter (inspired by dmmulroy/anti-slop and Factory-AI/eslint-plugin).
 * Every violation prints the exact rule id, location, reason, and concrete remediation so coding agents fix
 * architectural and anti-slop drift directly without adding external lint dependencies.
 */
import ts from 'typescript'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface LintViolation {
  rule: string
  file: string
  line: number
  column: number
  message: string
  fix: string
}

export interface LintReport {
  filesScanned: number
  violations: LintViolation[]
}

const TEST_OR_FIXTURE = /\.test\.tsx?$|\.spec\.tsx?$|__fixtures__/
const UI_UNDER_FORBIDDEN = /\bunder\s+(target|budget)\b/i

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/')
}

function isProdFile(relPath: string): boolean {
  return !TEST_OR_FIXTURE.test(relPath)
}

function collectFiles(rootDir: string, relDir: string, out: string[]): void {
  const fullDir = join(rootDir, relDir)
  let names: string[]
  try {
    names = readdirSync(fullDir).sort()
  } catch {
    return
  }
  for (const name of names) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const rel = relDir ? `${relDir}/${name}` : name
    const st = statSync(join(rootDir, rel))
    if (st.isDirectory()) collectFiles(rootDir, rel, out)
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(rel)
  }
}

function isAsConst(node: ts.AsExpression | ts.TypeAssertion): boolean {
  return ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'const'
}

function hasObjectKeyword(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false
  if (typeNode.kind === ts.SyntaxKind.ObjectKeyword) return true
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.some((t) => t.kind === ts.SyntaxKind.ObjectKeyword)
  }
  return false
}

function resolveImportTarget(fromRel: string, spec: string): string {
  const p = toPosix(spec)
  if (!p.startsWith('.')) return p
  return posix.normalize(posix.join(posix.dirname(toPosix(fromRel)), p))
}

function scanHasComment(text: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  let tok = scanner.scan()
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (tok === ts.SyntaxKind.SingleLineCommentTrivia || tok === ts.SyntaxKind.MultiLineCommentTrivia) return true
    tok = scanner.scan()
  }
  return false
}

function findTsSuppressionComments(sf: ts.SourceFile, add: (line: number, col: number, rule: string, message: string, fix: string) => void): void {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sf.text)
  let tok = scanner.scan()
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (tok === ts.SyntaxKind.SingleLineCommentTrivia || tok === ts.SyntaxKind.MultiLineCommentTrivia) {
      const comment = scanner.getTokenText()
      if (/^\/\/\s*@ts-(ignore|nocheck)\b|^\/\*\*?\s*@ts-(ignore|nocheck)\b/i.test(comment)) {
        const pos = sf.getLineAndCharacterOfPosition(scanner.getTokenStart())
        add(
          pos.line + 1,
          pos.character + 1,
          'anti-slop/no-ts-suppression',
          `Avoid TypeScript suppression comment in production code (${comment.trim()}).`,
          'Fix the underlying type narrowing or use an explicit boundary check instead of suppressing tsc.',
        )
      }
    }
    tok = scanner.scan()
  }
}

/** Lint a single TypeScript or TSX source string using a path relative to the repo root (e.g. `src/core/app.ts`). */
export function lintSource(code: string, relFilePath: string): LintViolation[] {
  const rel = toPosix(relFilePath)
  const isProd = isProdFile(rel)
  const isUiProd = isProd && rel.startsWith('src/ui/')
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, kind)
  const violations: LintViolation[] = []

  const pushAt = (line: number, column: number, rule: string, message: string, fix: string) => {
    violations.push({ rule, file: rel, line, column, message, fix })
  }

  const report = (node: ts.Node, rule: string, message: string, fix: string) => {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    pushAt(pos.line + 1, pos.character + 1, rule, message, fix)
  }

  if (isProd) findTsSuppressionComments(sf, pushAt)

  function scanReduceBody(node: ts.Node, accName: string): void {
    if ((ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) && ts.isIdentifier(node.expression) && node.expression.text === accName) {
      report(
        node,
        'anti-slop/no-reduce-accumulator-copy',
        `Avoid spreading accumulator "${accName}" inside reduce().`,
        `Mutate "${accName}" directly inside the reducer (or accumulate with a loop) and return "${accName}".`,
      )
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const recv = node.expression.expression
      const m = node.expression.name.text
      if (
        ts.isIdentifier(recv) &&
        recv.text === accName &&
        ['concat', 'slice', 'toSpliced', 'toSorted', 'toReversed', 'with'].includes(m)
      ) {
        report(
          node,
          'anti-slop/no-reduce-accumulator-copy',
          `Avoid copying accumulator "${accName}" via .${m}() inside reduce().`,
          `Mutate the locally owned "${accName}" array in place or use a simple loop.`,
        )
      }
      if (
        ts.isIdentifier(recv) &&
        recv.text === 'Object' &&
        m === 'assign' &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0]) &&
        node.arguments.slice(1).some((a) => ts.isIdentifier(a) && a.text === accName)
      ) {
        report(
          node,
          'anti-slop/no-reduce-accumulator-copy',
          `Avoid Object.assign({}, ${accName}, ...) copying inside reduce().`,
          `Assign properties directly on "${accName}" and return "${accName}".`,
        )
      }
      if (ts.isIdentifier(recv) && recv.text === 'Array' && m === 'from' && node.arguments[0] && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === accName) {
        report(
          node,
          'anti-slop/no-reduce-accumulator-copy',
          `Avoid Array.from(${accName}) copying inside reduce().`,
          `Mutate "${accName}" in place and return "${accName}".`,
        )
      }
    }
    ts.forEachChild(node, (child) => scanReduceBody(child, accName))
  }

  function visit(node: ts.Node): void {
    // 1 & 2. Chained type assertions & `as any` (production code)
    if (isProd && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))) {
      if (node.type.kind === ts.SyntaxKind.AnyKeyword) {
        report(
          node,
          'anti-slop/no-as-any',
          'Avoid "as any" type assertions.',
          'Narrow the value from unknown with runtime guards or use a concrete type.',
        )
      } else if (!isAsConst(node)) {
        let inner = node.expression
        while (ts.isParenthesizedExpression(inner)) inner = inner.expression
        if ((ts.isAsExpression(inner) && !isAsConst(inner)) || ts.isTypeAssertionExpression(inner)) {
          report(
            node,
            'anti-slop/no-chained-type-assertions',
            'Avoid chained type assertions (e.g. "x as unknown as T").',
            'Parse or validate the boundary fields explicitly into the target type.',
          )
        }
      }
    }

    // 3. `object` parameter types (production code)
    if (isProd && ts.isParameter(node) && hasObjectKeyword(node.type)) {
      report(
        node,
        'anti-slop/no-object-parameters',
        'Avoid bare "object" in function parameter types.',
        'Use "unknown" before runtime narrowing or "Record<string, unknown>" after plain-object checks.',
      )
    }

    // 4 & 5 & 7. Call expressions: Reflect.get/apply, module mocking, reduce accumulator copy
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression
      const prop = node.expression.name.text

      if (ts.isIdentifier(obj) && (obj.text === 'vi' || obj.text === 'jest') && ['mock', 'doMock', 'unstable_mockModule'].includes(prop)) {
        report(
          node,
          'anti-slop/no-module-mocking',
          `Avoid module mocking via ${obj.text}.${prop}().`,
          'Inject dependencies via explicit options or parameters instead of patching module globals.',
        )
      }

      if (isProd && ts.isIdentifier(obj) && obj.text === 'Reflect' && (prop === 'apply' || prop === 'get')) {
        report(
          node,
          'anti-slop/no-reflect-apply-or-get',
          `Avoid Reflect.${prop}().`,
          'Use typed function calls or explicit property checks instead of dynamic Reflect helpers.',
        )
      }

      if (isProd && (prop === 'reduce' || prop === 'reduceRight') && node.arguments.length >= 1) {
        const cb = node.arguments[0]
        if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
          const accParam = cb.parameters[0]?.name
          if (accParam && ts.isIdentifier(accParam)) {
            scanReduceBody(cb.body, accParam.text)
          }
        }
      }
    }

    // 6. Avoid `shape` in local symbol names (production code)
    if (isProd) {
      if (
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name &&
        /shape/i.test(node.name.text)
      ) {
        report(
          node.name,
          'anti-slop/no-shape-in-symbol-names',
          `Avoid generic "Shape" naming in symbol "${node.name.text}".`,
          'Name the type or helper by its domain role (e.g. AuditEntry, RawProfile).',
        )
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /shape/i.test(node.name.text)) {
        report(
          node.name,
          'anti-slop/no-shape-in-symbol-names',
          `Avoid generic "shape" naming in variable "${node.name.text}".`,
          'Name the binding by its domain role instead of "shape".',
        )
      }
    }

    // 9. FundBun architectural layer boundaries (production code)
    if (isProd && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveImportTarget(rel, node.moduleSpecifier.text)
      if (rel.startsWith('src/core/') && (target.startsWith('src/ui/') || target === 'src/ui' || target.startsWith('server/') || target === 'server')) {
        report(
          node.moduleSpecifier,
          'fundbun/layer-boundaries',
          `src/core must remain UI- and server-free, but imports "${node.moduleSpecifier.text}".`,
          'Move shared types into src/core/ and inject platform/UI adapters via callbacks.',
        )
      } else if (rel.startsWith('src/ui/') && (target.startsWith('server/') || target === 'server')) {
        report(
          node.moduleSpecifier,
          'fundbun/layer-boundaries',
          `src/ui must not import server code ("${node.moduleSpecifier.text}").`,
          'Talk to the local server through HTTP/AppApi clients in src/core/ instead.',
        )
      }
    }

    // 10. Dangerous HTML / dynamic code execution (production code)
    if (isProd) {
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'dangerouslySetInnerHTML') {
        report(
          node,
          'fundbun/no-dangerous-html-or-eval',
          'Never use dangerouslySetInnerHTML.',
          'Render structured React elements (like Markdown.tsx) instead of injecting raw HTML.',
        )
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
        report(node, 'fundbun/no-dangerous-html-or-eval', 'Never call eval().', 'Use explicit parsers or lookup tables.')
      }
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
        report(node, 'fundbun/no-dangerous-html-or-eval', 'Never construct dynamic functions with new Function().', 'Write static functions instead.')
      }
    }

    // 11. Do not console.log/warn/error immediately before throwing (Factory no-log-exception-with-throw)
    if (isProd && ts.isBlock(node)) {
      const stmts = node.statements
      for (let i = 0; i < stmts.length - 1; i++) {
        const cur = stmts[i]
        const next = stmts[i + 1]
        if (ts.isExpressionStatement(cur) && ts.isThrowStatement(next)) {
          const expr = cur.expression
          if (
            ts.isCallExpression(expr) &&
            ts.isPropertyAccessExpression(expr.expression) &&
            ts.isIdentifier(expr.expression.expression) &&
            expr.expression.expression.text === 'console' &&
            ['log', 'warn', 'error'].includes(expr.expression.name.text)
          ) {
            report(
              cur,
              'fundbun/no-log-before-throw',
              `Avoid logging with console.${expr.expression.name.text}() immediately before throwing.`,
              'Let the thrown Error carry the context so callers log failures once.',
            )
          }
        }
      }
    }

    // 12. No silent empty catch blocks without explanation (production code)
    if (isProd && ts.isCatchClause(node) && node.block.statements.length === 0) {
      if (!scanHasComment(node.block.getText(sf))) {
        report(
          node.block,
          'fundbun/no-empty-catch',
          'Empty catch block hides failures without stating why it is safe to ignore.',
          'Handle the error explicitly or add a brief comment explaining why ignoring it is safe.',
        )
      }
    }

    // 13. Forbidden UI copy rules: no em dashes and never "under target" / "under budget"
    if (
      isUiProd &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node))
    ) {
      const txt = node.text
      if (txt.includes('\u2014')) {
        report(
          node,
          'fundbun/no-forbidden-ui-copy',
          'Do not put em dashes (U+2014) in user-facing UI text.',
          'Use commas, colons, or separate sentences instead.',
        )
      }
      if (UI_UNDER_FORBIDDEN.test(txt)) {
        report(
          node,
          'fundbun/no-forbidden-ui-copy',
          'Do not write "under target" or "under budget" in UI copy.',
          'Use "on target", "left over", or "spent less than your target" instead.',
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return violations
}

/** Run the agent-directing linter across all TypeScript/TSX files in `src/` and `server/`. */
export function lintRepository(rootDir: string = process.cwd()): LintReport {
  const files: string[] = []
  collectFiles(rootDir, 'src', files)
  collectFiles(rootDir, 'server', files)
  const violations: LintViolation[] = []
  for (const rel of files) {
    const code = readFileSync(join(rootDir, rel), 'utf8')
    violations.push(...lintSource(code, rel))
  }
  return { filesScanned: files.length, violations }
}

function runCli(): void {
  const result = lintRepository()
  if (result.violations.length === 0) {
    process.stdout.write(`lint-agents: ${result.filesScanned} files scanned, 0 violations\n`)
    return
  }
  for (const v of result.violations) {
    process.stderr.write(`[${v.rule}] ${v.file}:${v.line}:${v.column} ${v.message}\n  Fix: ${v.fix}\n`)
  }
  process.stderr.write(`\nlint-agents: ${result.violations.length} violation(s) across ${result.filesScanned} files\n`)
  process.exitCode = 1
}

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) runCli()
