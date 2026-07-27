// Builds the daily puzzle schedule: public/schedule/<len>.json
//
// The schedule is a COMMITTED ARTIFACT, not a build output. Puzzle #42 must mean
// the same thing forever — someone shared "Leapword #42 ⭐⭐⭐" and a screenshot
// of it shouldn't quietly become a lie because we re-ran a script. So this file
// lives in public/, is checked into git, and diffs readably in review.
//
// Usage:
//   node scripts/build-schedule.mjs 4              # append-only (default)
//   node scripts/build-schedule.mjs 5              # the Sunday stream
//   node scripts/build-schedule.mjs 4 --rebuild --force
//   node scripts/build-schedule.mjs 4 --dry-run    # print stats, write nothing
//
// Word length selects the STREAM (see STREAMS below): 4 is the everyday puzzle,
// 5 is Sundays only.
//
// No PRNG, no shuffle: candidates carry a total order (worstRank, start, end)
// and scheduling is deterministic greedy, so the same inputs always produce the
// same schedule. That's cheaper than seeding a generator and just as stable.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { EXAMPLE_LADDER } from '../src/game/example.js'
import { BLOCKED } from './blocklist.mjs'
import { ROOT, bfs, loadVocab, makeNeighbors, pathBetween, write } from './lib/words.mjs'

const WORD_LEN = Number(process.argv[2]) || 4
if (WORD_LEN < 3 || WORD_LEN > 6) throw new Error(`unsupported word length: ${WORD_LEN}`)

const argv = process.argv.slice(3)
const MODE = argv.includes('--rebuild') ? 'rebuild' : 'extend'
const FORCE = argv.includes('--force')
const DRY = argv.includes('--dry-run')

const GENERATOR_VERSION = 1
const EPOCH = '2026-07-16' // Leapword #1. Must never move.
const LEAPS = 2

const PAR_MIN = 4
const PAR_MAX = 6

// Two streams, and the split is forced rather than stylistic.
//
// The daily stream runs every day and is indexed by day number: entry i is day
// i+1, forever. The Sunday stream runs only on Sundays from `firstDay` onward
// and is indexed by SUNDAY ORDINAL — entry 0 is the first five-letter Sunday,
// entry 1 the next, and so on.
//
// Indexing the Sunday stream by absolute day number instead would be simpler and
// is not possible: covering the same ~16 years would need 6000 entries to show
// 855 of them, and the five-letter graph yields 4743 candidate puzzles in total.
// Ordinal indexing needs only the 855 and every one of them gets played.
//
// The daily stream keeps absolute indexing, which is why turning Sundays over to
// this stream did not move a single already-published four-letter day. It now
// skips one entry in seven, so its 6000 days of content spans ~19 years instead
// of ~16. That is the whole cost.
const STREAMS = {
  4: {
    cadence: 'daily',
    firstDay: 1,
    target: 6000, // ~16 years
    // 7-day difficulty ramp, indexed by (dayIndex % 7). EPOCH's weekday is
    // printed at build time so this stays honest if EPOCH ever changes.
    parPattern: [4, 4, 5, 4, 5, 6, 4],
  },
  5: {
    cadence: 'sunday',
    // Puzzle #18 — Sunday 2026-08-02, the first Sunday after the feature shipped.
    // Deliberately NOT #4 or #11, which are Sundays that were already published
    // as four-letter puzzles. Moving them would rewrite days people have played
    // and shared, which is the thing this file exists to prevent. Must never
    // move: src/game/daily.js asserts against it.
    firstDay: 18,
    target: 900, // 900 Sundays ~ 17 years, so the stream outlives the daily one
    // Indexed by Sunday ordinal, so this is a 7-WEEK ramp rather than a 7-day
    // one. Weighted easier than the daily pattern on purpose: five letters is
    // already the difficulty spike, and stacking a par-6 pattern on top of it is
    // how Sunday stops being the fun one. Four par-4s, two par-5s, one par-6.
    parPattern: [4, 5, 4, 5, 4, 6, 4],
  },
}

const STREAM = STREAMS[WORD_LEN]
if (!STREAM) throw new Error(`no stream configured for ${WORD_LEN}-letter puzzles`)

const POOL_TARGET = STREAM.target

// Variety is a SCHEDULING property, not a pool-membership property.
//
// The tempting alternative — a global "no word may appear in more than N pool
// entries" cap — was tried and is actively harmful: it permanently discards tens
// of thousands of good puzzles to prevent two similar ones landing near each
// other, and because greedy-by-quality spends the budget on short par-4 paths
// first, it starves the par 5/6 mix entirely. Adjacency is about TIME, so fix it
// in time: keep the whole pool, and refuse to schedule a puzzle that reuses any
// word from the last WINDOW days.
const WINDOW = 30
const LOOKAHEAD = 40000 // how far down the quality-sorted bucket to scan per day

// Blocked words are allowed as INTERIORS (they're private to your own ladder),
// but only as a last resort: if an equal-par route exists that avoids them, the
// search takes it. That preference is free — 94% of pairs have a clean route —
// and it stops the quality sort from actively SEEKING profanity, which it
// otherwise does: it ranks paths by their rarest word, and SHIT (rank 284) is
// common, so `STOP SHOP SHIP SHIT SUIT QUIT` scored better than clean rivals.
//
// Flip this to false for zero blocked interiors anywhere. Measured cost: none.
// Both settings schedule the full 6000 days with 0 par-pattern fallbacks; true
// leaves ~180 of 6000 (~10 in year one), false leaves 0.
const ALLOW_BLOCKED_INTERIORS = true

const PAR_PATTERN = STREAM.parPattern

const SCHEDULE_PATH = `public/schedule/${WORD_LEN}.json`
const META_PATH = `public/schedule/${WORD_LEN}.meta.json`

/**
 * null ONLY when the file genuinely isn't there (a first run). Anything else —
 * malformed JSON, bad permissions — throws.
 *
 * Swallowing those would be catastrophic rather than convenient: --extend reads
 * this file to decide what history to preserve, so a corrupt schedule that
 * parsed as "no schedule" would silently regenerate all 6000 days and overwrite
 * it, which is the precise thing the append-only design exists to prevent.
 */
const readJson = async (rel) => {
  let raw
  try {
    raw = await readFile(resolve(ROOT, rel), 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error(`cannot read ${rel}: ${e.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`${rel} is not valid JSON (${e.message}). Refusing to overwrite it.`)
  }
}

/** Canonical, direction-independent id for a puzzle: WHAT→THEM === THEM→WHAT. */
const keyOf = (start, end) => (start < end ? `${start}-${end}` : `${end}-${start}`)

// ---------------------------------------------------------------------------
// 1. Candidate search.
// ---------------------------------------------------------------------------
const { validWords, commonWords, rankOf, sources } = await loadVocab(WORD_LEN)

const nbrsValid = makeNeighbors(validWords, WORD_LEN)
const nbrsCommon = makeNeighbors(commonWords, WORD_LEN)
// Third tier, used only to PREFER clean routes — never to measure par.
const nbrsClean = makeNeighbors(
  commonWords.filter((w) => !BLOCKED.has(w)),
  WORD_LEN,
)

// The blocklist gates START/END only. commonWords (the routing tier) and
// validWords (the typeable tier, which par is measured on) stay untouched — see
// blocklist.mjs for why that split is load-bearing.
const starts = commonWords.filter((w) => !BLOCKED.has(w))
console.log(
  `searching from ${starts.length} starts ` +
    `(${commonWords.length - starts.length} blocked)…`,
)

// The help modal shows this ladder complete, every intermediate word included.
// If it were ever scheduled, the help button would become a reveal-answer
// button — so it is excluded from the pool outright rather than trusted to stay
// unpicked by luck.
const EXAMPLE_KEY = keyOf(EXAMPLE_LADDER[0], EXAMPLE_LADDER[EXAMPLE_LADDER.length - 1])

const byKey = new Map() // canonical "A-B" -> best candidate, kills mirror dupes
let rawPairs = 0

for (const src of starts) {
  const { dist: distValid } = bfs(src, nbrsValid)
  const { dist: distCommon, prev: prevCommon } = bfs(src, nbrsCommon)
  const { dist: distClean, prev: prevClean } = bfs(src, nbrsClean)

  for (const [dst, d] of distCommon) {
    if (d < PAR_MIN || d > PAR_MAX) continue
    if (BLOCKED.has(dst)) continue
    // The whole point: a shortcut through some obscure word would make par a lie.
    // Note this is measured against distCommon/distValid, never distClean — the
    // clean tier is a routing preference and must not influence par.
    if (distValid.get(dst) !== d) continue
    rawPairs++

    const clean = distClean.get(dst) === d
    if (!clean && !ALLOW_BLOCKED_INTERIORS) continue
    const path = clean
      ? pathBetween(prevClean, src, dst)
      : pathBetween(prevCommon, src, dst)

    const key = keyOf(src, dst)
    if (key === EXAMPLE_KEY) continue // the help modal's ladder — never a puzzle
    const worstRank = Math.max(...path.map(rankOf))
    const prevBest = byKey.get(key)
    if (!prevBest || worstRank < prevBest.worstRank) {
      byKey.set(key, { start: src, end: dst, par: d, path, worstRank, clean })
    }
  }
}

const candidates = [...byKey.values()].sort(
  (a, b) =>
    a.worstRank - b.worstRank ||
    (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) ||
    (a.end < b.end ? -1 : a.end > b.end ? 1 : 0),
)

const hist = (xs) => xs.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {})
console.log(`\n  raw ordered pairs:  ${rawPairs}`)
console.log(`  canonical (deduped): ${candidates.length}`)
console.log(`  by par: ${JSON.stringify(hist(candidates.map((c) => c.par)))}`)
console.log(`  routes through a blocked interior: ${candidates.filter((c) => !c.clean).length}`)

// ---------------------------------------------------------------------------
// 2. Schedule.
// ---------------------------------------------------------------------------
const buckets = new Map()
for (const c of candidates) {
  if (!buckets.has(c.par)) buckets.set(c.par, { list: [], cursor: 0 })
  buckets.get(c.par).list.push(c)
}

const existing = MODE === 'extend' ? await readJson(SCHEDULE_PATH) : null
const kept = existing?.paths ?? []

if (existing) {
  const meta = await readJson(META_PATH)
  if (meta && meta.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(
      `schedule was built by generator v${meta.generatorVersion}, this is ` +
        `v${GENERATOR_VERSION}. Appending would mix incompatible orderings. ` +
        `Use --rebuild --force if you accept rewriting history.`,
    )
  }
  if (existing.epoch !== EPOCH) {
    throw new Error(`epoch moved: schedule says ${existing.epoch}, script says ${EPOCH}`)
  }
  console.log(`\nextending existing schedule (${kept.length} days already fixed)`)
} else if (MODE === 'rebuild' && !FORCE) {
  throw new Error('--rebuild rewrites history and needs --force')
}

const candByKey = new Map(candidates.map((c) => [keyOf(c.start, c.end), c]))

// lastUsed: word -> day index it last appeared on. Pre-seeded from an existing
// schedule so --extend honours the window across the seam.
const lastUsed = new Map()

// Candidates in SCHEDULE order — deliberately not `candidates.filter(c => c.used)`,
// which inherits the quality sort and would make "the first 365" mean "the 365
// best" rather than "year one".
const placed = []

kept.forEach((line, day) => {
  const words = line.split(' ')
  const c = candByKey.get(keyOf(words[0], words.at(-1)))
  // Mark already-published puzzles used so they can never be picked twice.
  // A miss is fine and means the candidate set moved under a published day
  // (e.g. a blocklist edit); the day still holds, it just can't be re-derived.
  if (c) c.used = true
  placed.push(c ?? null)
  for (const w of words) lastUsed.set(w, day)
})

const fits = (c, day) => c.path.every((w) => day - (lastUsed.get(w) ?? -Infinity) > WINDOW)

function take(par, day) {
  const b = buckets.get(par)
  if (!b) return null
  while (b.cursor < b.list.length && b.list[b.cursor].used) b.cursor++
  for (let i = b.cursor, scanned = 0; i < b.list.length && scanned < LOOKAHEAD; i++, scanned++) {
    const c = b.list[i]
    // Skipped-but-not-used entries stay in place: a candidate blocked by the
    // window today is placeable once its words go cold, so the cursor only
    // advances past entries that are actually spent.
    if (c.used || !fits(c, day)) continue
    c.used = true
    return c
  }
  return null
}

const paths = [...kept]
let starvedAt = null
const fallbacks = []

for (let day = kept.length; day < POOL_TARGET; day++) {
  const wantPar = PAR_PATTERN[day % PAR_PATTERN.length]
  let c = take(wantPar, day)
  if (!c) {
    // Difficulty ramp is a nice-to-have; a gap in the schedule is not. Take any
    // par rather than starve, but record it — a lot of these means the pattern
    // is over-ambitious for the pool.
    for (const par of [4, 5, 6]) if ((c = take(par, day))) break
    if (c) fallbacks.push({ day, wantPar, gotPar: c.par })
  }
  if (!c) {
    starvedAt = day
    break
  }
  for (const w of c.path) lastUsed.set(w, day)
  placed.push(c)
  paths.push(c.path.join(' '))
}

const added = paths.length - kept.length
const scheduled = placed.filter(Boolean)
const yearOne = placed.slice(0, 365).filter(Boolean)
const dirty = scheduled.filter((c) => !c.clean)
console.log(`\nscheduled ${paths.length} days (${added} new)`)
console.log(`  by par: ${JSON.stringify(hist(scheduled.map((c) => c.par)))}`)
console.log(
  `  worstRank: max ${Math.max(...scheduled.map((c) => c.worstRank))} overall, ` +
    `${Math.max(...yearOne.map((c) => c.worstRank))} across year one`,
)
console.log(`  par-pattern fallbacks: ${fallbacks.length}`)
console.log(
  `  blocked interiors: ${dirty.length} of ${scheduled.length} ` +
    `(${yearOne.filter((c) => !c.clean).length} in year one)` +
    (dirty.length ? ` — set ALLOW_BLOCKED_INTERIORS=false for zero, at no cost` : ''),
)
if (starvedAt !== null) {
  console.log(
    `\n  !! STARVED at day ${starvedAt} of ${POOL_TARGET}. ` +
      `Relax WINDOW (${WINDOW}) or widen PAR range before touching quality.`,
  )
}

const dayToDate = (n) =>
  new Date(Date.parse(EPOCH) + (n - 1) * 86400000).toISOString().slice(0, 10)
const weekdayOf = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

console.log(`  epoch ${EPOCH} is a ${weekdayOf(EPOCH)} → PAR_PATTERN[0] lands there`)
if (STREAM.cadence === 'sunday') {
  const first = dayToDate(STREAM.firstDay)
  const last = dayToDate(STREAM.firstDay + (paths.length - 1) * 7)
  console.log(
    `  sunday stream: entry 0 is #${STREAM.firstDay} (${first}, a ${weekdayOf(first)}), ` +
      `entry ${paths.length - 1} is ${last}`,
  )
  if (weekdayOf(first) !== 'Sunday') {
    throw new Error(`firstDay #${STREAM.firstDay} is a ${weekdayOf(first)}, not a Sunday`)
  }
}

// ---------------------------------------------------------------------------
// 3. Emit.
// ---------------------------------------------------------------------------
if (DRY) {
  console.log('\n--dry-run: nothing written')
  console.log('\nfirst 20:')
  for (const p of paths.slice(0, 20)) console.log('  ', p)
} else {
  await write(
    SCHEDULE_PATH,
    {
      v: 1,
      epoch: EPOCH,
      wordLength: WORD_LEN,
      // How the client turns a day number into an index here. Shipped so the
      // app can assert it agrees rather than assume — a stream read with the
      // wrong indexing serves plausible puzzles on the wrong days, which is the
      // failure mode nobody notices. Absent in 4.json, which predates the split
      // and is not being rewritten to add a field; the client reads a missing
      // cadence as 'daily', its only possible meaning.
      cadence: STREAM.cadence,
      firstDay: STREAM.firstDay,
      leaps: LEAPS,
      paths,
    },
    paths.length,
  )
  await write(META_PATH, {
    generatorVersion: GENERATOR_VERSION,
    epoch: EPOCH,
    cadence: STREAM.cadence,
    firstDay: STREAM.firstDay,
    count: paths.length,
    window: WINDOW,
    parPattern: PAR_PATTERN,
    ...sources,
    generatedAt: new Date().toISOString(),
  })
}
