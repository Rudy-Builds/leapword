// The share card.
//
// SPOILER GUARD, and why this is its own module: buildShareText has no parameter
// for `solution`. It takes `path` — the player's own moves, which they watched
// themselves make. It is therefore not *possible* to leak the par line through
// it. Inline in ResultModal, `puzzle.solution` is in scope and one careless edit
// away from being interpolated into a string that gets pasted into a group chat.
// The type signature is the guarantee; a comment saying "don't leak" is not.
//
// Everything *readable* here is already public before you play: the puzzle
// number, the start and end words (PuzzleHeader shows them), and par (ditto).
// The tile row adds only your own move count and where you leapt. A winning
// card's URL additionally carries your path SEALED as a challenge code — not
// readable at a glance, only revealed by the recipient's client after their own
// run ends. See challenge.js for the seal and its contract.

import { encodeChallenge } from './challenge.js'

export const SHARE_URL = 'https://leapword.app'

// The card links to the exact puzzle, not the homepage. Opened the same day it's
// today's daily anyway; opened later it lands on that specific past puzzle (an
// archive play) instead of a cold, unrelated homepage — see useRoute + Boot.
export const puzzleUrl = (number) => `${SHARE_URL}/${number}`

// A win's link carries the ladder as a dare: the recipient sees your numbers up
// front and your actual words only after they've played — see challenge.js.
export const challengeUrl = (number, path, leapSteps = []) =>
  `${puzzleUrl(number)}?c=${encodeChallenge(path, leapSteps)}`

// Real emoji, not the site's ★/⤳/· glyphs. Those are typographically nicer but
// paste into Slack and iMessage as thin monochrome characters — the colour is
// the entire reason a Wordle grid travels.
const SWAP_TILE = '🟩'
const LEAP_TILE = '🟪'
// Appended when the run ended without reaching END. It's an extra tile rather
// than a recolouring of the last move: the greens are moves that happened and
// stay true, and the red is the run stopping — "I got this far, then didn't".
const UNSOLVED_TILE = '🟥'
const STAR = '⭐'

/**
 * One tile per move: 🟩 letter-swap, 🟪 leap.
 *
 * `leapSteps` holds the path positions that were leapt to, and has to be passed
 * rather than re-derived. This used to test `isOneLetterDiff` on each step,
 * which was sound while a leap meant a synonym jump — always two or more
 * letters different. A leap now moves you to the next rung of the answer, which
 * from the answer is one letter, so every purple tile silently turned green.
 */
export function buildTileRow(path, leapSteps = [], unsolved = false) {
  const leapt = new Set(leapSteps)
  let row = ''
  for (let i = 1; i < path.length; i++) {
    row += leapt.has(i) ? LEAP_TILE : SWAP_TILE
  }
  return unsolved ? row + UNSOLVED_TILE : row
}

/**
 * @param {object} r
 * @param {number} r.number  puzzle number
 * @param {string} r.start
 * @param {string} r.end
 * @param {string[]} r.path  the player's own ladder
 * @param {number} r.par
 * @param {number} r.stars   0-3
 * @param {'won'|'lost'} r.status
 * @param {number} [r.streak]  current day streak; only ever printed on a win
 */
export function buildShareText({ number, start, end, path, par, stars, status, streak, leapSteps = [] }) {
  const won = status === 'won'
  const steps = path.length - 1

  // A loss prints no score at all. It used to show "☆☆☆", meaning zero — but
  // hollow stars next to filled ones on someone else's card read as a rating
  // rather than an absence, and people had to work out which they were looking
  // at. The red tile on the row already says the run didn't land.
  const score = won ? STAR.repeat(stars) : ''

  // The streak rides on line 1 (not its own line) to keep the card four lines —
  // and only on a win: a broken streak is not something you paste into a group
  // chat. `streak > 0` also makes the arg optional, so callers without it (and
  // the 1★/loss cases) are unchanged.
  const flame = won && streak > 0 ? ` · 🔥${streak}` : ''

  const summary = won
    ? `${start} → ${end} in ${steps} · par ${par}`
    : `${start} → ${end} · par ${par}`

  // A win links as a challenge (the path rides sealed in the URL — the loop's
  // whole upgrade from boast to dare). A loss keeps the plain link: there's no
  // move count to beat, and encodeChallenge assumes a path that reached END.
  const url = won ? challengeUrl(number, path, leapSteps) : puzzleUrl(number)

  // `score` is empty on a loss, so the space before it has to go too or line 1
  // ships with a trailing space into every paste.
  const headline = `Leapword #${number}${score ? ` ${score}` : ''}${flame}`

  return [headline, summary, buildTileRow(path, leapSteps, !won), url].join('\n')
}

/**
 * Put `text` wherever the platform puts things.
 *
 * Returns 'shared' | 'cancelled' | 'copied' | 'manual'. Never throws: the caller
 * renders a textarea on 'manual' and, importantly, renders *nothing* on
 * 'cancelled' — dismissing a share sheet is a normal thing to do, not an error.
 */
export async function shareText(text) {
  // Desktop Chrome and Edge expose navigator.share but hand you a clumsy OS
  // dialog, when Ctrl-V into Discord is what people actually want. Touch only.
  const canNativeShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    (navigator.canShare?.({ text }) ?? true) &&
    window.matchMedia?.('(pointer: coarse)').matches

  if (canNativeShare) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // Anything else (share unsupported for this payload, permission policy)
      // falls through to the clipboard rather than dead-ending.
    }
  }

  try {
    // Undefined outside a secure context — notably on http://<lan-ip>:5173, so
    // the 'manual' path below is the one you hit when testing on a real phone
    // over the LAN. It is not dead code.
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'manual'
  }
}
