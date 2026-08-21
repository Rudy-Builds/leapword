// Builds the daily puzzle schedule: public/schedule/<len>.json
//
// The schedule is a COMMITTED ARTIFACT, not a build output. Puzzle #42 must mean
// the same thing forever — someone shared "Leapword #42 ⭐⭐⭐" and a screenshot
// of it shouldn't quietly become a lie because we re-ran a script. So this file
// lives in public/, is checked into git, and diffs readably in review.
//
// Usage:
//   node scripts/build-schedule.mjs 4                    # append-only (default)
//   node scripts/build-schedule.mjs 5                    # the weekend stream
//   node scripts/build-schedule.mjs 4 --revise-from 40   # keep #1-39, redraw the rest
//   node scripts/build-schedule.mjs 4 --rebuild --force
//   node scripts/build-schedule.mjs 4 --dry-run          # print stats, write nothing
//
// Word length selects the STREAM (see STREAMS below): 4 is the everyday puzzle,
// 5 is the weekend.
//
// THREE write modes, and the middle one exists because the other two cannot do
// the job between them. `--extend` only appends, so once the file holds its full
// target it is a no-op: editing the difficulty pattern under it changes nothing
// at all, silently. `--rebuild` redraws every day, including the ones people
// have already played and shared. Neither can express "harder from here on",
// which is the only shape a difficulty change can take on a schedule that
// promises #42 means the same thing forever.
//
// `--revise-from N` is that shape. Entries serving days before N are copied
// through untouched; everything from N onward is redrawn with the current
// pattern; and N is checked against the calendar so it cannot name a day anyone
// on earth could already be playing (see REVISE_MARGIN_DAYS). History is still
// immutable — the boundary just stops being "the end of the file".
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
const reviseAt = argv.indexOf('--revise-from')
const REVISE_FROM = reviseAt === -1 ? null : Number(argv[reviseAt + 1])
if (reviseAt !== -1 && !Number.isInteger(REVISE_FROM)) {
  throw new Error('--revise-from needs a puzzle number, e.g. --revise-from 40')
}
const MODE = argv.includes('--rebuild') ? 'rebuild' : REVISE_FROM !== null ? 'revise' : 'extend'
const FORCE = argv.includes('--force')
const DRY = argv.includes('--dry-run')

// v2: the weekly ramp moved up a detour and `relax` stopped reaching for the
// easiest cell in the game when supply runs short. Both change which puzzle a
// given slot draws, so a v1 prefix and a v2 suffix may only meet where
// --revise-from puts the seam on purpose — never by appending.
const GENERATOR_VERSION = 2
const EPOCH = '2026-07-16' // Leapword #1. Must never move.
const LEAPS = 2

const dayToDate = (n) =>
  new Date(Date.parse(EPOCH) + (n - 1) * 86400000).toISOString().slice(0, 10)
const weekdayOf = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
/** Puzzle #n's weekday, Monday-first: 0 = Monday .. 6 = Sunday. */
const mondayIndexOf = (n) => (new Date(Date.parse(EPOCH) + (n - 1) * 86400000).getUTCDay() + 6) % 7

/** Today's puzzle number in UTC. Used only to police --revise-from. */
const utcDayNumber = () => Math.floor((Date.now() - Date.parse(EPOCH)) / 86400000) + 1

/**
 * How far into the future --revise-from has to reach before it is safe.
 *
 * Puzzles roll over at LOCAL midnight (src/game/daily.js explains why), so three
 * day numbers are live at any instant: a player in UTC+14 is already on UTC
 * today + 1 while one in UTC-12 is still on UTC today - 1. The first number
 * nobody on earth can be playing is therefore UTC today + 2. Anything closer
 * would redraw a puzzle out from under someone mid-game, which is the precise
 * betrayal the append-only rule exists to prevent — so this is a floor, not a
 * default, and it is enforced rather than documented. Give yourself more than
 * the minimum in practice: the revision still has to be reviewed and deployed.
 */
const REVISE_MARGIN_DAYS = 2

// Checked here rather than beside the freeze index it guards, because it needs
// nothing but the clock and it is the mistake people will actually make. Two
// minutes of BFS before "you can't revise yesterday" would be two minutes of
// nothing.
if (MODE === 'revise') {
  const today = utcDayNumber()
  const earliest = today + REVISE_MARGIN_DAYS
  if (REVISE_FROM < earliest) {
    throw new Error(
      `--revise-from ${REVISE_FROM} could redraw a puzzle someone is already ` +
        `playing. Today is #${today} in UTC, and local midnight puts three day ` +
        `numbers in play at once, so the earliest revisable day is #${earliest}.`,
    )
  }
}

const PAR_MIN = 4
const PAR_MAX = 6

// Two streams, and the split is forced rather than stylistic.
//
// The daily stream runs every day and is indexed by day number: entry i is day
// i+1, forever. The weekend stream runs only on Saturdays and Sundays from
// `firstDay` onward and is indexed by WEEKEND ORDINAL — entry 0 is the first
// five-letter Saturday, entry 1 the Sunday after it, and so on.
//
// Indexing the weekend stream by absolute day number instead would be simpler
// and is not possible: covering the same span would need 6000 entries to show
// the ~1714 weekend days among them, and the five-letter graph yields only 4241
// candidate puzzles in total. Ordinal indexing needs 1768 and plays every one.
//
// The daily stream keeps absolute indexing, which is why turning weekends over
// to this stream did not move a single already-published four-letter day. It now
// skips two entries in seven, so its 6000 days of content spans ~23 years
// instead of ~16. That is the whole cost.

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
    // Every step raises exactly one axis and they alternate — par, detour, par,
    // detour — so the week is monotone and each day differs from the last in one
    // legible way.
    //
    // The ramp used to open on [4, 0], and detour 0 is the one shape that needs
    // no lookahead at all: every move can fix a wrong letter without disturbing a
    // right one, so "make it look more like the target" simply solves it. That
    // was the week's free day. It is gone — Monday is still the gentlest slot by
    // a clear margin (par 4, one letter of misdirection) but it is a puzzle now,
    // and NO served weekday draws detour 0 any more.
    //
    // Friday's [6, 3] deliberately outruns its supply: only 327 four-letter
    // puzzles qualify, against 851 Fridays. `relax` covers the gap with [6, 4]
    // (11 more) and then [6, 2] — exactly where Friday used to sit. Measured on
    // the result: Fridays hold detour 3 or better until 2030-11-08, and 298 of
    // the first decade's 516 of them clear detour 2. So the top of the week is a
    // tier harder for the years that matter and decays into the old behaviour
    // rather than starving.
    //
    // Everything below Friday is comfortably supplied; [5, 2] is the tightest at
    // 2807 against ~857 Wednesdays.
    //
    // Sat/Sun slots are never SERVED from this stream, but the scheduler still
    // spends a candidate on them to keep entry i pointing at day i+1. They sit in
    // [4, 0] — which no served day wants now, so it is a pure dumping ground
    // rather than a bucket they have to share with Monday.
    //          Mon     Tue     Wed     Thu     Fri     [Sat]   [Sun]
    pattern: [[4, 1], [5, 1], [5, 2], [6, 2], [6, 3], [4, 0], [4, 0]],
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
    // "Easy" still has to mean a puzzle, though, so Saturday moved [4, 0] ->
    // [4, 1] for the same reason Monday did: detour 0 solves itself. Par 4 — the
    // part that IS the reset — is untouched. Supply is 901 for ~884 Saturdays, so
    // later ones lean on [4, 2] and [4, 0] via `relax`, always inside par 4.
    //
    // Sunday is the hardest thing the game can produce, and on five letters that
    // is a ceiling rather than a boast: par 6 is the top of the search and only
    // 694 five-letter puzzles reach it at all (398 at detour 1, 268 at detour 2,
    // 27 at detour 3, 1 at detour 4). Sunday spends the hardest of those first
    // and there is nothing above them to ask for.
    //
    // Supply is the cost, and it binds early: 268 puzzles at [6, 2] against 884
    // Sundays, so `relax` is carrying this slot from year one, not decorating it.
    // It holds every Sunday at par 6 through entry 344 — about three and a half
    // years — and lands the remainder on par 5.
    //
    // What happened after par 6 ran out used to be the whole problem, and it was
    // invisible from here: the old cascade dropped Sunday to PAR 4 for 438 of the
    // 884, 173 of them in the first decade. See `relax`.
    patternIndex: 'weekend',
    //          Sat     Sun
    pattern: [[4, 1], [6, 2]],
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

const bucketKey = (par, detour) => `${par}:${detour}`

// Every (par, detour) cell the search can produce, in ONE total difficulty
// order — the same order the weekly ramp above is written in, so "harder" means
// a single thing in this file rather than two things that can drift apart.
//
// detour = par - hamming, and hamming runs 1..WORD_LEN for two distinct words of
// this length, so the cells for a given par are exactly par-WORD_LEN .. par-1.
// Cells the graph happens not to populate are harmless: `take` returns null for
// an empty bucket and the walk moves on.
const CELLS = []
for (let par = PAR_MIN; par <= PAR_MAX; par++) {
  for (let d = Math.max(0, par - WORD_LEN); d <= par - 1; d++) CELLS.push([par, d])
}
const CELL_INDEX = new Map(CELLS.map(([par, d], i) => [bucketKey(par, d), i]))

// Checked here, before the fetch and the BFS, so a typo in a pattern costs a
// second rather than the two minutes it takes to reach the scheduler.
for (const [par, d] of PATTERN) {
  if (!CELL_INDEX.has(bucketKey(par, d))) {
    throw new Error(`pattern asks for par ${par}/detour ${d}, impossible at ${WORD_LEN} letters`)
  }
}

/** Which puzzle number stream entry `i` serves. The two streams differ. */
const dayOfEntry =
  STREAM.cadence === 'weekday'
    ? (i) => i + 1
    : (i) => STREAM.firstDay + Math.floor(i / 2) * 7 + (i % 2)

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
const buckets = new Map()
for (const c of candidates) {
  const k = bucketKey(c.par, c.detour)
  if (!buckets.has(k)) buckets.set(k, { list: [], cursor: 0 })
  buckets.get(k).list.push(c)
}

const existing = MODE === 'rebuild' ? null : await readJson(SCHEDULE_PATH)
const kept = existing?.paths ?? []

if (existing) {
  const meta = await readJson(META_PATH)
  // A version mismatch is fatal for --extend, which would butt a new ordering
  // against an old one at whatever index the file happens to end on. It is the
  // POINT of --revise-from, which puts that seam at a day it has just proved
  // nobody can be playing — so there the mismatch is the thing being fixed.
  if (meta && meta.generatorVersion !== GENERATOR_VERSION && MODE !== 'revise') {
    throw new Error(
      `schedule was built by generator v${meta.generatorVersion}, this is ` +
        `v${GENERATOR_VERSION}. Appending would mix incompatible orderings. ` +
        `Use --revise-from <day> to adopt the new generator from a future day ` +
        `onward, or --rebuild --force if you accept rewriting history.`,
    )
  }
  if (existing.epoch !== EPOCH) {
    throw new Error(`epoch moved: schedule says ${existing.epoch}, script says ${EPOCH}`)
  }
} else if (MODE === 'rebuild' && !FORCE) {
  throw new Error('--rebuild rewrites history and needs --force')
} else if (MODE === 'revise') {
  throw new Error(`nothing to revise: ${SCHEDULE_PATH} does not exist`)
}

// How much of the existing file survives this run. --extend keeps all of it by
// definition. --revise-from keeps every entry that serves a day before N, which
// is not the same as "the first N entries": the weekend stream is indexed by
// weekend ordinal, so its entry 8 is #45, not #9.
let freezeIndex = kept.length
if (MODE === 'revise') {
  // REVISE_FROM was already checked against the calendar at parse time.
  freezeIndex = 0
  while (freezeIndex < kept.length && dayOfEntry(freezeIndex) < REVISE_FROM) freezeIndex++
}

// Everything before the boundary is history and is copied through verbatim.
const frozen = kept.slice(0, freezeIndex)
console.log(
  MODE === 'revise'
    ? `\nrevising from #${REVISE_FROM}: entries 0-${freezeIndex - 1} preserved ` +
        `(through #${dayOfEntry(freezeIndex - 1)}), ${kept.length - freezeIndex} redrawn`
    : existing
      ? `\nextending existing schedule (${kept.length} days already fixed)`
      : `\nbuilding from scratch`,
)

const candByKey = new Map(candidates.map((c) => [keyOf(c.start, c.end), c]))

// lastUsed: word -> day index it last appeared on. Pre-seeded from an existing
// schedule so --extend honours the window across the seam.
const lastUsed = new Map()

// Candidates in SCHEDULE order — deliberately not `candidates.filter(c => c.used)`,
// which inherits the quality sort and would make "the first 365" mean "the 365
// best" rather than "year one".
const placed = []

frozen.forEach((line, day) => {
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

/**
 * The nearest cell to the one the pattern asked for, when that cell is spent.
 *
 * Walks outward through CELLS and takes the first candidate that lands, trying
 * the HARDER side of each step before the easier one. Both halves of that matter,
 * and the cascade this replaced got both of them wrong:
 *
 *   - It relaxed detour DOWNWARD first, so a Sunday that could not have [6, 2]
 *     preferred [6, 1] over [6, 3] — stepping away from the day's character
 *     while a harder puzzle sat right there unused.
 *   - Its last resort scanned `par 4` and then `detour 0`, so once par 6 ran dry
 *     the hardest day of the week fell straight to the EASIEST cell the game
 *     has. That was not theoretical. It put par 4 on 438 of the 884 scheduled
 *     Sundays — half of them — 256 at detour 0 and 173 of them inside the first
 *     decade, on the day the README calls the hardest thing the game can build.
 *     Nothing reported it, because nothing had gone wrong by the only measure
 *     being taken: the stream never starved. It just answered the wrong
 *     question, one cell at a time, for a decade.
 *
 * One ordered walk makes both cases fall out of the same rule, and leaves no
 * cliff to fall off: a starved Sunday now works down through par 6, then par 5,
 * and only reaches par 4 if everything harder is genuinely gone.
 *
 * Slots that want an EASY cell degrade upward under the same rule, which is the
 * right way round — it can only fire where supply is short, and supply is only
 * short at the hard end.
 */
function relax(par, detour, day) {
  const base = CELL_INDEX.get(bucketKey(par, detour))
  for (let step = 1; step < CELLS.length; step++) {
    for (const i of [base + step, base - step]) {
      if (i < 0 || i >= CELLS.length) continue
      const c = take(...CELLS[i], day)
      if (c) return c
    }
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

const paths = [...frozen]
let starvedAt = null
const fallbacks = []

for (let day = frozen.length; day < POOL_TARGET; day++) {
  const [wantPar, wantDetour] = PATTERN[patternSlotFor(day)]
  let c = take(wantPar, wantDetour, day)
  if (!c) {
    // Degrade, don't starve — see `relax` for the order and why it is that one.
    c = relax(wantPar, wantDetour, day)
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

const drawn = paths.length - frozen.length
const scheduled = placed.filter(Boolean)
const yearOne = placed.slice(0, 365).filter(Boolean)
const dirty = scheduled.filter((c) => !c.clean)
console.log(`\nscheduled ${paths.length} days (${frozen.length} preserved, ${drawn} drawn)`)
console.log(`  by par: ${JSON.stringify(hist(scheduled.map((c) => c.par)))}`)
console.log(`  by detour: ${JSON.stringify(hist(scheduled.map((c) => c.detour)))}`)
console.log(
  `  worstRank: max ${Math.max(...scheduled.map((c) => c.worstRank))} overall, ` +
    `${Math.max(...yearOne.map((c) => c.worstRank))} across year one`,
)
console.log(`  pattern fallbacks: ${fallbacks.length} of ${drawn} drawn`)
if (fallbacks.length) {
  // WHICH slot slipped and WHEN matter more than how many did. A count alone
  // can't tell a pattern that deliberately outruns a scarce cell (Friday's
  // [6, 3], ~6 years in) from one that is mis-specified and slips on day one, so
  // print the first slip per want, as a date — the unit the decision is in.
  const firstOf = new Map()
  for (const f of fallbacks) if (!firstOf.has(f.want)) firstOf.set(f.want, f)
  for (const [want, f] of firstOf) {
    const n = fallbacks.filter((x) => x.want === want).length
    console.log(
      `    ${want}: ${n} slips, first at entry ${f.day} ` +
        `(${dayToDate(dayOfEntry(f.day))}) -> ${f.got}`,
    )
  }
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
  const lastDay = dayOfEntry(paths.length - 1)
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
  // The schedule is append-only, so the times its future got redrawn are the
  // one thing git history can tell you and the artifact cannot. Record them
  // here, append-only in their own right: which day the seam sits on, and what
  // pattern took over from it. Someone reading a puzzle they think is
  // mis-tiered should be able to find out which generator drew it.
  //
  // Re-running the same revision is a re-run, not a second revision — otherwise
  // "rebuild it yourself and check you get the same file" grows the log every
  // time someone does it. Identical consecutive entries collapse.
  const prevMeta = await readJson(META_PATH)
  const priorRevisions = prevMeta?.revisions ?? []
  const last = priorRevisions.at(-1)
  const isRerun =
    last && last.from === REVISE_FROM && JSON.stringify(last.pattern) === JSON.stringify(PATTERN)
  await write(META_PATH, {
    generatorVersion: GENERATOR_VERSION,
    epoch: EPOCH,
    cadence: STREAM.cadence,
    firstDay: STREAM.firstDay,
    count: paths.length,
    window: WINDOW,
    pattern: PATTERN,
    revisions: [
      ...(isRerun ? priorRevisions.slice(0, -1) : priorRevisions),
      ...(MODE === 'revise'
        ? [
            {
              from: REVISE_FROM,
              preserved: frozen.length,
              generatorVersion: GENERATOR_VERSION,
              pattern: PATTERN,
              at: new Date().toISOString(),
            },
          ]
        : []),
    ],
    ...sources,
    generatedAt: new Date().toISOString(),
  })
}
