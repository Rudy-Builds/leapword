// Pure game logic. No React, no I/O — trivially unit-testable.
// The client needs only these primitives at runtime: a word-validity Set and a
// one-letter-diff check. No ladder graph or BFS ships to the browser.

/** Is `word` a real dictionary word? */
export function isValidWord(word, dictSet) {
  return dictSet.has(word)
}

/** True when a and b are the same length and differ in exactly one position. */
export function isOneLetterDiff(a, b) {
  if (a.length !== b.length) return false
  let diffs = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diffs++
    if (diffs > 1) return false
  }
  return diffs === 1
}

/**
 * Validate a proposed move. A move is legal when the candidate is a real word,
 * hasn't already been used in the path, and is either a single-letter change
 * from the current word OR one of the offered leap targets.
 *
 * Returns { ok: boolean, reason?: string, isLeap?: boolean }.
 */
export function isLegalMove(nextWord, { current, path, dictSet, leapTargets = [] }) {
  if (!nextWord || nextWord.length !== current.length) {
    return { ok: false, reason: `Enter a ${current.length}-letter word.` }
  }
  if (nextWord === current) {
    return { ok: false, reason: 'That’s the same word.' }
  }
  if (path.includes(nextWord)) {
    return { ok: false, reason: 'You’ve already used that word.' }
  }
  const isLeap = leapTargets.includes(nextWord)
  if (!isLeap && !isOneLetterDiff(current, nextWord)) {
    return { ok: false, reason: 'Change exactly one letter.' }
  }
  if (!isValidWord(nextWord, dictSet)) {
    return { ok: false, reason: 'Not in the word list.' }
  }
  return { ok: true, isLeap }
}

/**
 * Star score.
 *  - steps: number of moves taken to reach END (letter-swaps + leaps).
 *  - par: optimal step count.
 *  - leapsUsed: how many leap tokens were spent.
 *  - solved: reached END within the move cap. The two ways not to are running
 *    the cap out and giving up; neither scores.
 *
 * Efficiency sets the base, then each leap costs a star — the doc's "Costs a
 * star, not a fail". The doc's table reads as a contradiction ("1 leap used → 2"
 * vs "solved within cap, any leaps → 1"); a per-leap penalty is what reconciles
 * the two, since "1 leap → 2" only ever meant an otherwise-par run.
 *
 *  3 ★ — par, no leaps
 *  2 ★ — one over par, or par with one leap
 *  1 ★ — solved at all (leaps never drag a finished run to 0)
 *  0 ★ — unsolved (cap exceeded, or gave up)
 *
 * Reading it as a floor instead of a penalty (`|| leapsUsed === 1`) made a leap
 * guarantee 2 ★ no matter how many moves the rest of the run took, which made
 * leaping strictly better than playing well.
 *
 * par is measured on the same word list the player may type, so steps < par
 * shouldn't happen — but score it as a clean 3 rather than dropping to 2 if a
 * leap shortcut or a generation slip ever makes it possible.
 */
export function computeStars({ steps, par, leapsUsed, solved }) {
  if (!solved) return 0
  const base = steps <= par ? 3 : steps <= par + 1 ? 2 : 1
  return Math.max(1, base - leapsUsed)
}
