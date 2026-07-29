// 저장소 스캔 — 파일 수집·심볼 추출·동명 파일 충돌 탐지
// 왜 이 방식인가: AI 에이전트가 엉뚱한 파일을 고치는 사고의 최대 원인은
// "이름이 같거나 거의 같은 파일이 여러 디렉터리에 흩어져 있는 것"이다.
// 그래서 파싱(AST)보다 먼저 '이름 충돌'을 1급 지표로 계산한다. 빠르고, 언어를 안 가리고,
// 사용자가 자기 저장소에서 즉시 문제를 눈으로 확인할 수 있다.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, basename, sep } from 'node:path'

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv',
])

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.rs',
  '.java', '.kt', '.php', '.cs', '.swift', '.vue', '.svelte',
])

/** 생성물·자동생성 파일은 지도에서 노이즈다 (수십만 줄짜리 타입 정의 등) */
const GENERATED_HINT = /(\.d\.ts$|generated|__generated__|\.min\.js$|\.pb\.go$)/i

/**
 * git 저장소라면 추적 파일 목록을 정본으로 쓴다.
 * 왜: .gitignore를 직접 해석하면 규칙(부정 패턴·중첩 ignore)이 어긋나 아카이브·빌드
 * 산출물이 섞이고, 지도의 숫자가 부풀어 곧바로 신뢰를 잃는다. git이 이미 정답을 안다.
 */
function gitTrackedFiles(root) {
  try {
    const { execFileSync } = require$('node:child_process')
    const out = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--exclude-standard'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    const list = out.split('\n').filter(Boolean)
    return list.length ? list : null
  } catch { return null }
}

// ESM에서 동기 require가 필요한 지점만 국소적으로 만든다 (의존성 0 유지)
import { createRequire } from 'node:module'
const require$ = createRequire(import.meta.url)

export function collectFiles(root, { maxFiles = 60000 } = {}) {
  const tracked = gitTrackedFiles(root)
  if (tracked) {
    const files = []
    for (const rel of tracked) {
      if (files.length >= maxFiles) break
      const ext = extname(rel)
      if (!CODE_EXT.has(ext)) continue
      if (GENERATED_HINT.test(rel)) continue
      if (rel.split('/').some((p) => DEFAULT_IGNORE.has(p))) continue
      const abs = join(root, rel)
      let size = 0, lines = 0
      try {
        const st = statSync(abs)
        size = st.size
        if (size < 2_000_000) lines = readFileSync(abs, 'utf8').split('\n').length
      } catch { continue }
      files.push({ path: rel, abs, ext, size, lines })
    }
    return files
  }
  const files = []
  const walk = (dir) => {
    if (files.length >= maxFiles) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.claude') {
        if (DEFAULT_IGNORE.has(e.name)) continue
      }
      if (DEFAULT_IGNORE.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        const ext = extname(e.name)
        if (!CODE_EXT.has(ext)) continue
        if (GENERATED_HINT.test(full)) continue
        let size = 0, lines = 0
        try {
          const st = statSync(full)
          size = st.size
          if (size < 2_000_000) lines = readFileSync(full, 'utf8').split('\n').length
        } catch { continue }
        files.push({ path: relative(root, full), abs: full, ext, size, lines })
      }
    }
  }
  walk(root)
  return files
}

/**
 * 이름 충돌 탐지.
 * - collision: 파일명이 완전히 동일한데 경로가 다른 것 (approvals.ts × 4개 앱)
 * - risk: 그중 내용까지 비슷하면 "고칠 파일을 잘못 고를" 확률이 가장 높다
 */
export function findAmbiguities(files) {
  const byName = new Map()
  for (const f of files) {
    const name = basename(f.path)
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(f)
  }
  const ambiguities = []
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    // page.tsx / index.ts 처럼 프레임워크 규약상 당연히 반복되는 이름은 별도 등급
    const conventional = /^(index|page|layout|route|main|mod|__init__|setup)\./.test(name)
    const sizes = group.map((g) => g.lines)
    const spread = Math.max(...sizes) - Math.min(...sizes)
    const similar = sizes.length > 1 && spread <= Math.max(40, Math.max(...sizes) * 0.25)
    ambiguities.push({
      name,
      count: group.length,
      conventional,
      similar,
      severity: conventional ? 'low' : similar ? 'high' : 'medium',
      files: group.map((g) => ({ path: g.path, lines: g.lines })),
    })
  }
  const rank = { high: 0, medium: 1, low: 2 }
  return ambiguities.sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count)
}

/** 내보내는 심볼 추출 — 정규식 기반(정확도보다 속도·언어 무관성 우선) */
const EXPORT_PATTERNS = [
  /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
  /export\s+(?:const|let|var|class)\s+([A-Za-z0-9_$]+)/g,
  /export\s+default\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
  /^\s*def\s+([A-Za-z0-9_]+)/gm,
  /^\s*class\s+([A-Za-z0-9_]+)/gm,
  /^func\s+([A-Za-z0-9_]+)/gm,
]

export function extractSymbols(file) {
  let src
  try { src = readFileSync(file.abs, 'utf8') } catch { return [] }
  if (src.length > 800_000) return []
  const out = new Set()
  for (const re of EXPORT_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(src)) !== null) {
      if (m[1] && m[1].length > 1) out.add(m[1])
      if (out.size > 200) break
    }
  }
  return [...out]
}

/** 최상위 모듈(앱·패키지) 단위로 묶는다 — 사람이 말하는 단위와 맞춘다 */
export function groupModules(files) {
  const mods = new Map()
  for (const f of files) {
    const parts = f.path.split(sep)
    // apps/www/... · packages/ui/... 같은 모노레포 규약을 우선 인식
    let key
    if ((parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'services') && parts[1]) {
      key = `${parts[0]}/${parts[1]}`
    } else {
      key = parts.length > 1 ? parts[0] : '(root)'
    }
    if (!mods.has(key)) mods.set(key, { name: key, files: 0, lines: 0, paths: [] })
    const m = mods.get(key)
    m.files += 1
    m.lines += f.lines
    if (m.paths.length < 4000) m.paths.push(f)
  }
  return [...mods.values()].sort((a, b) => b.files - a.files)
}
