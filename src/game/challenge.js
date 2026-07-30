// The challenge link: a share URL that carries the sharer's own ladder.
//
// There is no backend, so the only place a friend's path can travel is the URL
// itself. It rides as base64url of the concatenated step words — a SEAL, not a
// secret: anyone determined can decode it, but nobody gets spoiled by glancing
// at a link in a group chat. The client honours the seal by showing only the
// derived numbers (steps, leaps, stars) before you play, and the actual words
// only after your own run ends — see ResultModal.
//
// Only the path is encoded. Steps, leaps and stars are all re-derived from it on
// the receiving side, the same way WordChain and share.js re-derive leaps from
// isOneLetterDiff instead of persisting a flag: one source of truth, nothing in
// the URL to disagree with itself.
//
// Only WINS become challenges. A loss has no move count to beat, and share.js
// already refuses to brag a streak on a loss for the same reason.

import { isOneLetterDiff, computeStars } from './rules.js'
import { moveCapFor } from './puzzle.js'

// btoa/atob are byte-safe here because the alphabet is strictly A–Z. The +/
// characters still need swapping: base64 emits them freely and a bare + dies in
// some chat apps' link detection.
const toBase64Url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

/**
 * @param {string[]} path  the sharer's full ladder, START first — their own
 *   moves, same contract as buildShareText. START is dropped before encoding
 *   (the recipient's puzzle already knows it); everything after is fixed-width,
 *   so no separators are needed.
 * @param {number} leapsUsed  how many of those steps were leaps.
 *
 * The leap count has to be carried explicitly and used not to be. It became
 * unrecoverable when leaps stopped being synonym jumps: a leap now moves you to
 * the next rung of the answer, and when you are already on the answer that is
 * one letter away — identical in the path to a move you typed. Left inferred, a
 * two-leap 1 ★ run decoded as a spotless 3 ★.
 *
 * A leading digit is unambiguous because the old payload was strictly A–Z, so
 * codes shared before this still decode (their count is inferred, as it was).
 */
export function encodeChallenge(path, leapsUsed = 0) {
  return toBase64Url(`${leapsUsed}${path.slice(1).join('')}`)
}

/**
 * Decode and validate a challenge code against the puzzle it claims to be for.
 *
 * Returns { path, steps, leapsUsed, stars } or null. Null is deliberately the
 * only failure mode: a mangled or hand-edited code should degrade to a plain
 * archive/daily play, never an error screen — the puzzle underneath is intact.
 *
 * Validation mirrors the live rules (real dictionary words, no repeats, each
 * step a one-letter swap or a leap, within the move cap, ends at END). It can't
 * prove the leaps were *offered* — the synonym menu isn't re-checked — but a
 * forged brag is a social problem, not a crash; shape is what matters here.
 */
export function decodeChallenge(code, { puzzle, dictSet }) {
  if (typeof code !== 'string' || code === '') return null

  let letters
  try {
    letters = fromBase64Url(code)
  } catch {
    return null
  }

  // Leading digit = the sharer's leap count. Absent on codes minted before leaps
  // became rung-walks, where inferring it from the path was still sound.
  let declaredLeaps = null
  if (/^[0-9]/.test(letters)) {
    declaredLeaps = Number(letters[0])
    letters = letters.slice(1)
  }

  const len = puzzle.start.length
  if (!/^[A-Z]+$/.test(letters) || letters.length % len !== 0) return null

  const words = []
  for (let i = 0; i < letters.length; i += len) words.push(letters.slice(i, i + len))

  const steps = words.length
  if (steps < 1 || steps > moveCapFor(puzzle.par)) return null
  if (words[words.length - 1] !== puzzle.end) return null

  const path = [puzzle.start, ...words]
  if (new Set(path).size !== path.length) return null

  // A step that isn't a one-letter swap can only have been a leap, so this is a
  // floor on the count rather than the count itself.
  let mustHaveLeapt = 0
  for (let i = 1; i < path.length; i++) {
    if (!dictSet.has(path[i])) return null
    if (!isOneLetterDiff(path[i - 1], path[i])) mustHaveLeapt++
  }
  const leapsUsed = declaredLeaps ?? mustHaveLeapt
  // Claiming fewer leaps than the path proves is the one lie worth catching:
  // it is the direction that flatters the sharer's score.
  if (leapsUsed < mustHaveLeapt) return null
  if (leapsUsed > puzzle.leaps) return null

  return {
    path,
    steps,
    leapsUsed,
    stars: computeStars({ steps, par: puzzle.par, leapsUsed, solved: true }),
  }
}

/**
 * The verdict, from the player's side: 'won' | 'lost' | 'tied'.
 *
 * Stars first, then steps, then leaps — the same hierarchy computeStars already
 * encodes, so the compare can never call a 1★ scrape a win over a clean 3★.
 * Steps break a star tie because par ties are common and "I did it in fewer" is
 * the whole conversation; leaps break a step tie because an unaided ladder
 * should edge out an assisted one. A player who didn't solve at all lost —
 * challenges only ever encode wins, so the friend's side is always a solve.
 */
export function compareToChallenge({ status, stars, steps, leapsUsed }, challenge) {
  if (status !== 'won') return 'lost'
  if (stars !== challenge.stars) return stars > challenge.stars ? 'won' : 'lost'
  if (steps !== challenge.steps) return steps < challenge.steps ? 'won' : 'lost'
  if (leapsUsed !== challenge.leapsUsed) return leapsUsed < challenge.leapsUsed ? 'won' : 'lost'
  return 'tied'
}
