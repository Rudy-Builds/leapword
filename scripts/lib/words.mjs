// Shared vocabulary + ladder-graph primitives.
//
// Extracted so the two builders can run independently: build-assets.mjs needs a
// slow unattended Datamuse sweep for synonyms, while build-schedule.mjs only
// needs these two fetches and some BFS, and wants to be re-runnable in seconds.
//
// No external deps — Node 18+ global fetch.

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Default frequency cutoff for "a puzzle may route through this". Streams can
// ask for a different one (see STREAMS in build-schedule.mjs); the typeable tier
// ignores it entirely.
export const COMMON_CUT = 10000

// ENABLE is the curated dictionary Scrabble and most word games use. It matters:
// a scraped "all English words" list is full of proper nouns, acronyms and junk
// (ABEL, ACLU, ABBR, ACCT), which are not words.
const REAL_WORDS_URL = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt'
const FREQ_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt'

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

export const write = async (relPath, data, count) => {
  const full = resolve(ROOT, relPath)
  await mkdir(dirname(full), { recursive: true })
  const json = JSON.stringify(data)
  await writeFile(full, json)
  const n = count ?? (Array.isArray(data) ? data.length : Object.keys(data).length)
  console.log(`wrote ${relPath} (${n} entries, ${(json.length / 1024).toFixed(1)} KB)`)
}

/**
 * Two tiers of vocabulary, doing two different jobs:
 *
 *   valid  (~3.9k 4-letter) — what the player may type. If it's a real word, it
 *     counts: the whole ENABLE dictionary, no frequency filter. par is measured
 *     on THIS graph, so par is a true optimum nobody can beat with an obscure
 *     word. Nothing may ever filter this tier.
 *   common (~1.1k at the default cut) — what a puzzle path may route through.
 *
 * Both are sorted by frequency rank, so `common` is a prefix of `valid`, and
 * `commonCut` only ever moves where that prefix ends — never what is typeable.
 */
export async function loadVocab(wordLen, commonCut = COMMON_CUT) {
  console.log('fetching ENABLE dictionary + frequency list…')
  const [realRaw, freqRaw] = await Promise.all([
    fetch(REAL_WORDS_URL).then((r) => r.text()),
    fetch(FREQ_URL).then((r) => r.text()),
  ])

  const real = new Set()
  for (const line of realRaw.split('\n')) {
    const w = line.trim().toUpperCase()
    if (w.length === wordLen && /^[A-Z]+$/.test(w)) real.add(w)
  }

  const rank = new Map()
  freqRaw.split('\n').forEach((line, i) => {
    const w = line.split(' ')[0]?.trim().toUpperCase()
    if (w && !rank.has(w)) rank.set(w, i)
  })

  const rankOf = (w) => rank.get(w) ?? Infinity
  // Explicit total order. Sorting by rank alone leaves ties (every word absent
  // from the frequency list ranks Infinity) resolved by Array.sort's
  // implementation, which would make the schedule non-reproducible.
  const byRank = (a, b) => rankOf(a) - rankOf(b) || (a < b ? -1 : a > b ? 1 : 0)

  const validWords = [...real].sort(byRank)
  const commonWords = validWords.filter((w) => rankOf(w) < commonCut)

  console.log(`  validity: ${validWords.length} words (typeable — every real word)`)
  console.log(`  common:   ${commonWords.length} words (rank < ${commonCut}; puzzle paths route through these)`)

  return {
    validWords,
    commonWords,
    validSet: new Set(validWords),
    rankOf,
    sources: { enableSha: sha(realRaw), freqSha: sha(freqRaw), commonCut },
  }
}

/** Wildcard-bucket adjacency for a letter ladder. O(n) build, O(1)-ish lookup. */
export function makeNeighbors(words, wordLen) {
  const buckets = new Map()
  for (const w of words) {
    for (let i = 0; i < wordLen; i++) {
      const pat = w.slice(0, i) + '*' + w.slice(i + 1)
      if (!buckets.has(pat)) buckets.set(pat, [])
      buckets.get(pat).push(w)
    }
  }
  return (w) => {
    const out = new Set()
    for (let i = 0; i < wordLen; i++) {
      const bucket = buckets.get(w.slice(0, i) + '*' + w.slice(i + 1))
      if (!bucket) continue
      for (const n of bucket) if (n !== w) out.add(n)
    }
    return out
  }
}

export function bfs(src, neighbors) {
  const dist = new Map([[src, 0]])
  const prev = new Map()
  const q = [src]
  for (let head = 0; head < q.length; head++) {
    const w = q[head]
    for (const n of neighbors(w)) {
      if (dist.has(n)) continue
      dist.set(n, dist.get(w) + 1)
      prev.set(n, w)
      q.push(n)
    }
  }
  return { dist, prev }
}

export function pathBetween(prev, src, dst) {
  const path = [dst]
  let cur = dst
  while (cur !== src) {
    cur = prev.get(cur)
    path.unshift(cur)
  }
  return path
}
