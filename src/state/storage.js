// Today's progress, persisted so the daily is one play.
//
// We save on EVERY move, not just on win/loss. Saving only the final result
// would make a mid-game refresh a free retry, which is the most obvious cheat
// available and would make one-play-per-day unenforceable — and therefore make a
// shared score meaningless.
//
// None of this is tamper-proof. A cleared localStorage or a fresh browser is a
// new attempt and there is no way to stop that without a backend. That's fine:
// cheating costs you a star nobody is checking.

import { DEFAULT_STREAK, nextStreak } from '../game/streak.js'
import { mergeCompletion } from '../game/completions.js'

const KEY = 'leapword:v1:progress'
// Its own key, not a field on the progress payload: that one is day-scoped and
// overwritten every midnight, so a flag stored in it would forget the player has
// ever seen the help and re-open it every morning.
const HELP_SEEN_KEY = 'leapword:v1:help-seen'
// Same reasoning, load-bearing for the streak: kept OUT of the day-scoped
// progress payload, which is wiped every midnight. A streak stored there would
// reset to zero every night — the exact bug this key exists to avoid.
const STREAK_KEY = 'leapword:v1:streak'
// The completion log the archive reads: puzzle number -> best stars. Also its own
// key (persists across days), and separate from the streak — an archive solve
// completes a puzzle without touching the daily streak.
const COMPLETIONS_KEY = 'leapword:v1:completions'
// The theme *preference*: 'light' or 'dark' when the player has overridden, or
// absent to follow the device. Kept in sync with the pre-paint script in
// index.html, which reads this same key before React loads.
const THEME_KEY = 'leapword:v1:theme'
const VERSION = 1

/**
 * Every access is wrapped. localStorage throws in Safari private mode, under
 * quota pressure, and when a browser blocks third-party storage — and a storage
 * exception must never white-screen a word game. On failure we return null and
 * the session simply lives in memory for the day.
 */
function read() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const defaultStorage = {
  /** Saved state for day `n`, or null for a fresh play. */
  load(n) {
    const saved = read()
    if (!saved) return null
    // A shape we no longer understand is discarded, never migrated.
    if (saved.v !== VERSION) return null
    // Yesterday's game is not today's game.
    if (saved.n !== n) return null
    return saved
  },

  save(n, state) {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          v: VERSION,
          n,
          // Exactly enough to re-render ResultModal AND rebuild the share text.
          // `current` is omitted: it's always path.at(-1).
          status: state.status,
          // Without this a reload turns "Gave up" into "Out of moves" — the two
          // losses render differently and only this tells them apart.
          gaveUp: state.gaveUp,
          path: state.path,
          movesUsed: state.movesUsed,
          leapsUsed: state.leapsUsed,
          leapsRemaining: state.leapsRemaining,
          stars: state.stars,
          finishedAt: state.status === 'playing' ? null : Date.now(),
        }),
      )
    } catch {
      // Degrade to in-memory. Nothing to do and nothing worth telling the user.
    }
  },

  clear() {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* no-op */
    }
  },
}

// A persisted streak we can't make sense of is discarded, not trusted: a NaN
// `current` or a string `lastDay` would poison every future comparison in
// nextStreak. Anything off-shape falls back to a fresh streak.
function sanitizeStreak(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STREAK }
  const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
  return {
    current: count(raw.current),
    max: count(raw.max),
    lastDay: Number.isFinite(raw.lastDay) ? Math.floor(raw.lastDay) : null,
    played: count(raw.played),
    wins: count(raw.wins),
  }
}

/** The lifetime streak, or a fresh one if never played or storage is blocked. */
export function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY)
    return sanitizeStreak(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_STREAK }
  }
}

/**
 * Fold today's result into the stored streak and persist it. Idempotent: called
 * again for a day already counted, it writes nothing (nextStreak hands back the
 * same reference) and returns the streak unchanged. Returns the streak either way.
 */
export function recordDailyResult(day, won) {
  const prev = loadStreak()
  const next = nextStreak(prev, { day, won })
  if (next === prev) return prev // this day is already counted — nothing to write
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(next))
  } catch {
    // In-memory for the session; degrades like every other write in this module.
  }
  return next
}

// Drop any entry that isn't a positive integer key mapping to a 0-3 star value —
// a poisoned log would render as garbage rows in the archive.
function sanitizeCompletions(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(k)
    const s = Number(v)
    if (Number.isInteger(n) && n > 0 && Number.isInteger(s) && s >= 0 && s <= 3) out[n] = s
  }
  return out
}

/** The completion log ({ [puzzleNumber]: bestStars }), or empty if never played. */
export function loadCompletions() {
  try {
    const raw = localStorage.getItem(COMPLETIONS_KEY)
    return sanitizeCompletions(raw ? JSON.parse(raw) : null)
  } catch {
    return {}
  }
}

/**
 * Fold a finished puzzle's result into the log, keeping the best star. Idempotent
 * — a result that doesn't beat the stored one writes nothing. Records both daily
 * and archive finishes; only the daily also touches the streak.
 */
export function recordCompletion(number, stars) {
  const prev = loadCompletions()
  const next = mergeCompletion(prev, number, stars)
  if (next === prev) return prev // no improvement — nothing to write
  try {
    localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(next))
  } catch {
    // In-memory for the session; degrades like every other write here.
  }
  return next
}

/**
 * Whether the player has ever dismissed the help. Kept out of `defaultStorage`
 * because that object is injected into useGame as the game-progress store, and
 * this isn't game progress.
 *
 * Throws read as false, so blocked storage shows the help every visit rather
 * than never — annoying beats a player who never learns the rules.
 */
export function hasSeenHelp() {
  try {
    return localStorage.getItem(HELP_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markHelpSeen() {
  try {
    localStorage.setItem(HELP_SEEN_KEY, '1')
  } catch {
    /* no-op */
  }
}

/**
 * The stored theme preference: 'light', 'dark', or 'system' (the default, which
 * follows the device). Anything unrecognised — or blocked storage — reads as
 * 'system', so a broken read simply falls back to matching the OS.
 */
export function loadThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** 'system' is stored as absence, so the key only ever holds an explicit choice. */
export function saveThemePref(pref) {
  try {
    if (pref === 'light' || pref === 'dark') localStorage.setItem(THEME_KEY, pref)
    else localStorage.removeItem(THEME_KEY)
  } catch {
    /* no-op */
  }
}
