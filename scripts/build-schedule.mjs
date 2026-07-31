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

const dayToDate = (n) =>
  new Date(Date.parse(EPOCH) + (n - 1) * 86400000).toISOString().slice(0, 10)
const weekdayOf = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
/** Puzzle #n's weekday, Monday-first: 0 = Monday .. 6 = Sunday. */
const mondayIndexOf = (n) => (new Date(Date.parse(EPOCH) + (n - 1) * 86400000).getUTCDay() + 6) % 7

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
// Difficulty is (par, detour), not par alone.
//
// detour = par - (letters that differ between START and END). Since one move
// changes one letter, you need at least that many moves; detour is how many
// EXTRA the dictionary forces on you. At detour 0 every move can fix a wrong
// letter and never touch a right one, so "make it look more like the target"
// solves it with no lookahead. Each unit of detour is a move where that instinct
// is actively wrong. Measured over the old schedule, 82% of days were detour 0
// or 1 — which is why the game read as easy despite the par ramp.
//
// The two are NOT independent, which bounds what a pattern can ask for:
// par >= (letters that differ) always, and two words one letter apart are
// adjacent (par 1). So par 4 -> detour 0-2, par 5 -> detour 1-3, par 6 -> 2-4.
//
// Supply per (par, detour) is wildly uneven, and two cells look usable but are
// not: four-letter par-4/detour-2 holds 322 puzzles (6 years) and par-5/detour-3
// holds 90 (one year). The patterns below route around both.
const STREAMS = {
  4: {
    cadence: 'weekday', // Mon-Fri; Sat and Sun come from the five-letter stream
    firstDay: 1,
    target: 6000,
    patternIndex: 'weekday',
    // Written MONDAY-FIRST and indexed by the puzzle's real weekday.
    //
    // The obvious `PATTERN[dayIndex % 7]` is what shipped first and it is wrong:
    // it anchors slot 0 to EPOCH's weekday, and EPOCH is a Thursday. That rotated
    // the whole ramp four days — Monday drew the par-5 and Sunday drew the
    // easiest slot in the week.
    //
    // Every step raises par or detour, so the week is monotone. Sat/Sun slots are
    // never SERVED from this stream but the scheduler still spends a candidate on
    // them, so they sit in the cheapest bucket rather than burning a scarce one.
    //          Mon     Tue     Wed     Thu     Fri     [Sat]   [Sun]
    pattern: [[4, 0], [4, 1], [5, 1], [5, 2], [6, 2], [4, 0], [4, 0]],
  },
  5: {
    cadence: 'weekend', // Saturdays and Sundays
    // #17 — Saturday 2026-08-01. Nothing had ever been served from this stream
    // when it moved here from #18 (its first Sunday was still in the future), so
    // no published day changed. Must never move now: daily.js asserts on it.
    firstDay: 17,
    target: 1768, // 2 days/week ~ 17 years, so the stream outlives the daily one
    // Consecutive entries alternate Saturday, Sunday, Saturday, Sunday — so this
    // is a two-entry pattern indexed by parity, not a weekday lookup.
    //
    // Saturday resets to easy on purpose. The letter count going up is its own
    // difficulty jump and its own signal that a new mode started, so the weekend
    // is a second ramp rather than a continuation of the weekday one — the same
    // reason a crossword's Sunday is the biggest grid but not the hardest.
    //
    // Sunday is the hardest thing the game can produce. Supply is the cost:
    // five-letter par-6/detour-2 is only 268 puzzles, so strict adherence runs
    // ~5 years before `take` starts relaxing detour within par 6 (694 total,
    // ~13 years). It degrades rather than starving.
    patternIndex: 'weekend',
    //          Sat     Sun
    pattern: [[4, 0], [6, 2]],
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
// Now false, and it is no longer a preference — it is load-bearing.
//
// A leap used to draw from a synonym map that was gated against the blocklist.
// It now hands the player the next word of the ANSWER (see src/game/leap.js),
// so an interior word is no longer private to your own ladder: the game will
// actively put it in your mouth, which is the exact thing blocklist.mjs exists
// to stop. 197 future four-letter days and 54 Sundays routed through one.
//
// Measured cost of turning it off: none. Both settings schedule the full 6000
// days with 0 par-pattern fallbacks.
const ALLOW_BLOCKED_INTERIORS = false

const PATTERN = STREAM.pattern
const hamming = (a, b) => {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

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
      byKey.set(key, {
        start: src,
        end: dst,
        par: d,
        detour: d - hamming(src, dst),
        path,
        worstRank,
        clean,
      })
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
console.log(`  by (par,detour): ${JSON.stringify(hist(candidates.map((c) => `${c.par}d${c.detour}`)))}`)
console.log(`  routes through a blocked interior: ${candidates.filter((c) => !c.clean).length}`)

// ---------------------------------------------------------------------------
// 2. Schedule.
// ---------------------------------------------------------------------------
// Bucketed by (par, detour) rather than par alone, because par alone does not
// describe difficulty — see the note above STREAMS.
const bucketKey = (par, detour) => `${par}:${detour}`
const buckets = new Map()
for (const c of candidates) {
  const k = bucketKey(c.par, c.detour)
  if (!buckets.has(k)) buckets.set(k, { list: [], cursor: 0 })
  buckets.get(k).list.push(c)
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

function take(par, detour, day) {
  const b = buckets.get(bucketKey(par, detour))
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

// `day` below is the 0-based array index, so the puzzle number is day + 1.
//
// The weekday stream looks the pattern up by real weekday. The weekend stream's
// entries alternate Saturday, Sunday, Saturday, Sunday, so parity IS the day.
const patternSlotFor =
  STREAM.patternIndex === 'weekday'
    ? (day) => mondayIndexOf(day + 1)
    : (day) => day % PATTERN.length

const paths = [...kept]
let starvedAt = null
const fallbacks = []

for (let day = kept.length; day < POOL_TARGET; day++) {
  const [wantPar, wantDetour] = PATTERN[patternSlotFor(day)]
  let c = take(wantPar, wantDetour, day)
  if (!c) {
    // Degrade, don't starve — and degrade in the order that preserves the most
    // of the day's character. Detour first, holding par: a Sunday that slips
    // from par-6/detour-2 to par-6/detour-1 is still the week's hardest day,
    // where dropping to par 4 would not be. Only then give up par as well.
    //
    // This is load-bearing rather than theoretical: five-letter par-6/detour-2
    // holds 268 puzzles, about five years of Sundays, so the relaxation starts
    // firing long before the stream runs out.
    for (const d of [wantDetour - 1, wantDetour + 1, wantDetour - 2, wantDetour + 2]) {
      if (d >= 0 && (c = take(wantPar, d, day))) break
    }
    if (!c) {
      outer: for (const par of [4, 5, 6]) {
        for (let d = 0; d <= 4; d++) if ((c = take(par, d, day))) break outer
      }
    }
    if (c) fallbacks.push({ day, want: `${wantPar}d${wantDetour}`, got: `${c.par}d${c.detour}` })
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
console.log(`  by detour: ${JSON.stringify(hist(scheduled.map((c) => c.detour)))}`)
console.log(
  `  worstRank: max ${Math.max(...scheduled.map((c) => c.worstRank))} overall, ` +
    `${Math.max(...yearOne.map((c) => c.worstRank))} across year one`,
)
console.log(`  pattern fallbacks: ${fallbacks.length}`)
if (fallbacks.length) {
  // Which day slipped matters more than how many did: a run of them on one
  // weekday means that cell is under-supplied and the pattern wants rethinking.
  const firstAt = fallbacks[0]
  console.log(
    `    first at entry ${firstAt.day} (wanted ${firstAt.want}, got ${firstAt.got})` +
      `; by want: ${JSON.stringify(hist(fallbacks.map((f) => f.want)))}`,
  )
}
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

console.log(
  STREAM.patternIndex === 'weekday'
    ? `  pattern is weekday-indexed, Monday first (epoch ${EPOCH} is a ${weekdayOf(EPOCH)})`
    : `  pattern alternates [Sat, Sun] by entry parity`,
)
if (STREAM.cadence === 'weekend') {
  // Entry 0 is the first Saturday, entry 1 the Sunday after it, and so on — two
  // entries per week. The assertion is the thing that keeps that arithmetic
  // honest: get it wrong and every weekend day points at the wrong puzzle.
  const first = dayToDate(STREAM.firstDay)
  const lastDay = STREAM.firstDay + Math.floor((paths.length - 1) / 2) * 7 + ((paths.length - 1) % 2)
  console.log(
    `  weekend stream: entry 0 is #${STREAM.firstDay} (${first}, a ${weekdayOf(first)}), ` +
      `entry ${paths.length - 1} is ${dayToDate(lastDay)} (a ${weekdayOf(dayToDate(lastDay))})`,
  )
  if (weekdayOf(first) !== 'Saturday') {
    throw new Error(`firstDay #${STREAM.firstDay} is a ${weekdayOf(first)}, not a Saturday`)
  }
}

// ---------------------------------------------------------------------------
// 3. Emit.
// ---------------------------------------------------------------------------

// A note to whoever opens this file, and the reason it's first.
//
// The schedule is public and always will be — it's a static site, the answers
// have to reach the browser somehow, and pretending otherwise would be security
// theatre. So the honest move is to assume someone curious will find it and to
// talk to them when they do, rather than to hide it badly.
//
// JSON has no comments, so it has to be a real field. `write()` emits the file
// as a single line, which means the first key is literally the first thing
// anyone sees — in the raw file, in DevTools, in a browser's JSON viewer. It
// costs ~450 bytes on a 179 KB file and every reader is a person we'd rather
// have as a contributor than as a spoiler.
const READ_THIS_FIRST = [
  'Congratulations — you found every answer. Genuinely: nice digging.',
  '',
  'Now please don’t ruin it for everyone else.',
  '',
  'Leapword is one puzzle a day, and everybody plays the same one. That’s the',
  'entire point of it, and a leaked answer is the one thing that can’t be',
  'un-leaked. So keep these to yourself.',
  '',
  'The game is open source so people can learn from it and enjoy it — you’re',
  'very welcome in here. Better yet, build on it: fork it, improve it, send a',
  'pull request. Making the game better beats spoiling it every time.',
  '',
  'https://github.com/Rudy-Builds/leapword',
  '',
  'Thank you. — Rudy',
]

if (DRY) {
  console.log('\n--dry-run: nothing written')
  console.log('\nfirst 20:')
  for (const p of paths.slice(0, 20)) console.log('  ', p)
} else {
  await write(
    SCHEDULE_PATH,
    {
      // First, deliberately. See above.
      READ_THIS_FIRST,
      v: 1,
      epoch: EPOCH,
      wordLength: WORD_LEN,
      // How the client turns a day number into an index here. Shipped so the
      // app can assert it agrees rather than assume — a stream read with the
      // wrong indexing serves plausible puzzles on the wrong days, which is the
      // failure mode nobody notices.
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
    pattern: PATTERN,
    ...sources,
    generatedAt: new Date().toISOString(),
  })
}
