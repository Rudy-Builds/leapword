// The challenge link: a share URL that carries the sharer's own ladder.
//
// There is no backend, so the only place a friend's path can travel is the URL
// itself. It rides as base64url of the concatenated step words — a SEAL, not a
// secret: anyone determined can decode it, but nobody gets spoiled by glancing
// at a link in a group chat. The client honours the seal by showing only the
// derived numbers (steps, leaps, stars) before you play, and the actual words
// only after your own run ends — see ResultModal.
//
// The path is encoded, plus which of its steps were leaps. Steps and stars are
// still re-derived on the receiving side — one source of truth, nothing in the
// URL to disagree with itself — but leaps cannot be, and this file used to claim
// otherwise. A leap now lands on the next rung of the answer, which from the
// answer is a one-letter move, indistinguishable from a typed one. Inferring it
// scored a two-leap run as spotless and drew none of its purple tiles.
//
// isOneLetterDiff still earns its keep below, as a floor: a step that ISN'T a
// one-letter change can only have been a leap, so a code claiming fewer than the
// path proves is a forgery in the direction that flatters the sharer.
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
 * @param {number[]} leapSteps  path positions arrived at by leaping.
 *
 * Leaps have to be carried explicitly and used not to be. They became
 * unrecoverable when leaps stopped being synonym jumps: a leap now moves you to
 * the next rung of the answer, and when you are already on the answer that is
 * one letter away — identical in the path to a move you typed. Left inferred, a
 * two-leap 1 ★ run decoded as a spotless 3 ★.
 *
 * The header is a count digit followed by that many base-36 positions, so the
 * recipient can mark the right steps rather than only know the total. Both
 * older shapes still decode: a bare A–Z payload predates the header entirely,
 * and a count-only header is told apart by arithmetic — after the digit, a
 * count-only payload is a whole number of words and a positional one is not
 * (leaps per puzzle never reach the word length, so the two can't collide).
 */
export function encodeChallenge(path, leapSteps = []) {
  const idx = [...leapSteps].sort((a, b) => a - b)
  const header = String(idx.length) + idx.map((i) => i.toString(36).toUpperCase()).join('')
  return toBase64Url(`${header}${path.slice(1).join('')}`)
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

  const len = puzzle.start.length

  // Header, if there is one. Absent on codes minted before leaps became
  // rung-walks, where inferring them from the path was still sound.
  let declaredLeaps = null
  let declaredSteps = null
  if (/^[0-9]/.test(letters)) {
    const n = Number(letters[0])
    const rest = letters.slice(1)
    // Positional header when the remainder only divides into whole words after
    // dropping n position characters; count-only when it divides straight away.
    if (n > 0 && rest.length % len !== 0 && (rest.length - n) % len === 0) {
      declaredSteps = [...rest.slice(0, n)].map((c) => parseInt(c, 36))
      if (declaredSteps.some((i) => !Number.isInteger(i) || i < 1)) return null
      letters = rest.slice(n)
    } else {
      letters = rest
    }
    declaredLeaps = n
  }

  if (!/^[A-Z]+$/.test(letters) || letters.length % len !== 0) return null

  const words = []
  for (let i = 0; i < letters.length; i += len) words.push(letters.slice(i, i + len))

  const steps = words.length
  if (steps < 1 || steps > moveCapFor(puzzle.par)) return null
  if (words[words.length - 1] !== puzzle.end) return null

  const path = [puzzle.start, ...words]
  if (new Set(path).size !== path.length) return null

  // A step that isn't a one-letter swap can only have been a leap, so these are
  // a floor rather than the whole truth.
  const forced = []
  for (let i = 1; i < path.length; i++) {
    if (!dictSet.has(path[i])) return null
    if (!isOneLetterDiff(path[i - 1], path[i])) forced.push(i)
  }
  const leapsUsed = declaredLeaps ?? forced.length
  // Claiming fewer leaps than the path proves is the one lie worth catching:
  // it is the direction that flatters the sharer's score.
  if (leapsUsed < forced.length) return null
  if (leapsUsed > puzzle.leaps) return null

  // Positions, when the code carried them. They have to land inside the path and
  // cover every step the geometry already proved was a leap — a code naming the
  // wrong steps would draw the purple tiles in the wrong places.
  let leapSteps = declaredSteps ?? forced
  if (declaredSteps) {
    if (declaredSteps.length !== leapsUsed) return null
    if (new Set(declaredSteps).size !== declaredSteps.length) return null
    if (declaredSteps.some((i) => i >= path.length)) return null
    if (!forced.every((i) => declaredSteps.includes(i))) return null
  }

  return {
    path,
    steps,
    leapsUsed,
    leapSteps,
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
