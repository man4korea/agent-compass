#!/usr/bin/env node
// repo-atlas CLI — 저장소를 훑어 AI 에이전트용 지도(.atlas/)를 만든다.
// 설계 의도: 설치·설정·계정이 필요 없어야 한다. npx 한 줄로 자기 저장소의
// 위험(동명 파일·중복 심볼)을 즉시 눈으로 보게 만드는 것이 이 도구의 판매 논리다.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { collectFiles, findAmbiguities, extractSymbols, groupModules } from '../src/scan.mjs'
import { renderAtlas, renderModulePage, renderReport } from '../src/emit.mjs'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const root = resolve(args.find((a) => !a.startsWith('-')) || process.cwd())
const outDir = join(root, '.atlas')
const jsonOnly = flag('--json')
const checkOnly = flag('--check')

const t0 = Date.now()
const files = collectFiles(root)
if (!files.length) {
  console.error('repo-atlas: no source files found. Run inside a code repository.')
  process.exit(1)
}

const symbolsByFile = new Map()
const symbolIndex = new Map()
for (const f of files) {
  const syms = extractSymbols(f)
  if (!syms.length) continue
  symbolsByFile.set(f.path, syms)
  for (const s of syms) {
    if (!symbolIndex.has(s)) symbolIndex.set(s, [])
    const arr = symbolIndex.get(s)
    if (arr.length < 12) arr.push(f.path)
  }
}

const modules = groupModules(files)
const ambiguities = findAmbiguities(files)
const report = renderReport({ files, modules, ambiguities, symbolIndex })
report.elapsedMs = Date.now() - t0

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

if (!checkOnly) {
  mkdirSync(join(outDir, 'modules'), { recursive: true })
  writeFileSync(
    join(outDir, 'ATLAS.md'),
    renderAtlas({ repoName: basename(root), files, modules, ambiguities, symbolIndex }),
  )
  for (const m of modules.slice(0, 30)) {
    const safe = m.name.replace(/[\\/]/g, '__')
    writeFileSync(join(outDir, 'modules', `${safe}.md`), renderModulePage(m, symbolsByFile))
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
}

const risky = report.ambiguousHigh + report.ambiguousMedium
console.log('')
console.log(`  repo-atlas — ${basename(root)}`)
console.log(`  ${report.files.toLocaleString()} files · ${report.lines.toLocaleString()} lines · ${report.modules} modules · ${report.elapsedMs}ms`)
console.log('')
console.log(`  ⚠  ${risky} ambiguous filenames  (${report.ambiguousHigh} high risk)`)
console.log(`  ⚠  ${report.duplicatedSymbols.toLocaleString()} duplicated exported symbols`)
if (report.worst.length) {
  console.log('')
  console.log('  Most likely to be edited by mistake:')
  for (const w of report.worst) console.log(`    - ${w.name} × ${w.count} copies`)
}
console.log('')
if (!checkOnly) console.log(`  Map written to .atlas/ATLAS.md — point your agent at it.`)
console.log('')
