// Which puzzle is "today", how long until the next one, and what shape it is.
//
// Shape lives here rather than in its own module because it is the same
// question: a day number is the only input, this file owns the epoch that day
// numbers are counted from, and every rule below is arithmetic on that one
// constant. Splitting it out would mean either a second copy of the epoch or an
// import cycle with this file.
//
// Local midnight, not UTC — matching Wordle. The countdown has to read "next
// puzzle in 6h" against the player's own clock; under UTC a US-West player's
// puzzle would flip at 5pm, which makes the countdown look broken at exactly the
// moment it's most visible.
//
// The accepted cost: #N isn't globally simultaneous. For up to a day a player in
// NZ is on #42 while one in California is still on #41, so a shared card names a
// start/end the recipient hasn't reached yet. Those two words are the public part
// of the puzzle (they're in the header before you play, not the answer), so it
// leaks little — and a countdown that lies would be worse.

import { puzzleFromPath } from './puzzle.js'

const DAY_MS = 86400000

/** 2026-07-16 is Leapword #1. Must never move: it defines what every #N means.
 * Exported so Boot can assert the schedule was generated against the same
 * epoch — a regenerated schedule with a shifted epoch would silently hand
 * everyone the wrong day's puzzle. */
export const EPOCH_ISO = '2026-07-16'
// Date-only ISO strings parse as UTC midnight per spec, so this equals
// Date.UTC(2026, 6, 16) — one constant, two representations.
const EPOCH_UTC = Date.parse(EPOCH_ISO)

/**
 * Today's puzzle number, counting from 1.
 *
 * Local Y/M/D components are fed through Date.UTC so both sides of the
 * subtraction are exact multiples of 86400000. Diffing two local `new Date(y,m,d)`
 * values would break across a DST boundary, where a day is 23 or 25 hours —
 * hence Date.UTC here and Math.round (not floor) below.
 */
export function dayNumber(now = new Date()) {
  const localMidnightAsUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((localMidnightAsUTC - EPOCH_UTC) / DAY_MS) + 1
}

/** Milliseconds until local midnight. */
export function msUntilNextPuzzle(now = new Date()) {
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextMidnight.getTime() - now.getTime()
}

/** "6h 12m" / "12m" / "48s" — the shape shrinks as it gets close. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

// ---------------------------------------------------------------------------
// Puzzle shape: weekends are longer.
// ---------------------------------------------------------------------------

/** Monday to Friday. */
export const SHORT_LEN = 4
/** Saturdays and Sundays, from FIRST_LONG_DAY on. */
export const LONG_LEN = 5

/**
 * #17 — Saturday 2026-08-01, the first day of the five-letter weekend.
 *
 * Weekend days before it stay four letters forever. They were published, played
 * and shared as four-letter puzzles, and a rule that reached backwards would
 * turn every archive row and every screenshot of them into a lie — the same
 * reason build-schedule.mjs treats the schedule as append-only. So the rule is
 * "weekends from #17", not "weekends".
 *
 * It moved here from #18 exactly once, when the weekend was still one day wide
 * and nothing had ever been served from the five-letter stream — its first
 * Sunday was still in the future, so no published day changed. That window is
 * closed now.
 *
 * Must never move, for the reason above: shifting it re-points every five-letter
 * day at a different puzzle. schedule/5.json carries the same number as
 * `firstDay` and Boot asserts the two agree.
 */
export const FIRST_LONG_DAY = 17

// Thursday (4). Derived, not written down, so it cannot drift from EPOCH_ISO.
const EPOCH_WEEKDAY = new Date(EPOCH_UTC).getUTCDay()

/** Day of the week puzzle #n falls on, 0 = Sunday .. 6 = Saturday. */
export function weekdayForDay(n) {
  return (((n - 1 + EPOCH_WEEKDAY) % 7) + 7) % 7
}

/** Is #n one of the long weekend puzzles? 0 = Sunday, 6 = Saturday. */
export function isLongDay(n) {
  if (n < FIRST_LONG_DAY) return false
  const wd = weekdayForDay(n)
  return wd === 6 || wd === 0
}

export function wordLengthForDay(n) {
  return isLongDay(n) ? LONG_LEN : SHORT_LEN
}

/**
 * Where #n sits inside its own stream — the two are indexed differently, and
 * that asymmetry is deliberate (see STREAMS in scripts/build-schedule.mjs).
 *
 * The everyday stream is indexed by day number, unchanged from before Sundays
 * split off. That is what guarantees no already-published four-letter day moved:
 * #12 is schedule/4.json entry 11 today, tomorrow and in 2043. It simply skips
 * an entry each Sunday now.
 *
 * The weekend stream is indexed by weekend ordinal — two entries per week,
 * Saturday then Sunday: #17 is entry 0, #18 is entry 1, #24 is entry 2.
 *
 * FIRST_LONG_DAY is a Saturday, so `k` counts days from a Saturday and `k % 7`
 * is 0 for Saturdays and 1 for Sundays — which is exactly the offset inside the
 * week's pair. Anything else can't reach here, because isLongDay already said no.
 */
export function streamIndexForDay(n) {
  if (!isLongDay(n)) return n - 1
  const k = n - FIRST_LONG_DAY
  return 2 * Math.floor(k / 7) + (k % 7)
}

/**
 * The puzzle for day `n`, drawn from whichever stream that day belongs to.
 *
 * @param {number} n
 * @param {Record<number, object>} schedules  loaded schedules, keyed by word length
 *
 * Wraps rather than running off the end, so a player in 2043 gets a repeat
 * instead of a white screen. The double-modulo keeps the index positive if `n`
 * is somehow <= 0 — a clock set before the epoch shouldn't crash the app either.
 */
export function puzzleForDay(n, schedules) {
  const schedule = schedules[wordLengthForDay(n)]
  if (!schedule) throw new Error(`no ${wordLengthForDay(n)}-letter schedule loaded for #${n}`)
  const len = schedule.paths.length
  const i = ((streamIndexForDay(n) % len) + len) % len
  return puzzleFromPath(schedule.paths[i], schedule)
}
