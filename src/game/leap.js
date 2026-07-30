// Where a leap takes you.
//
// Replaces the synonym map this used to use. A synonym is chosen by MEANING, and
// what a stuck player needs is chosen by POSITION — measured over year one, a
// synonym leap moved you further from the target 74% of the time, offered
// nothing at all on 532 answer-path words, and in 12 cases dropped you somewhere
// the end word could not be reached from at all. Spending your scarce resource
// usually made your position worse.
//
// So a leap is now a rung: it puts you one step further along the answer than
// you have ever been.

/**
 * The word a leap would move you to, or null if a leap isn't available.
 *
 * "Furthest you've ever been" rather than "earliest word you haven't used" —
 * the latter sends a player standing on rung 4 back to rung 1, which is a
 * punishment dressed as a rescue.
 *
 * Two properties fall out of indexing by the furthest rung, and both matter:
 *
 *   It can never strand you. If your furthest rung is `i`, then no answer word
 *   past `i` can be in your path — if one were, IT would be the furthest. So
 *   everything from `i+1` on is provably unused, and landing on `i+1` always
 *   leaves a complete, legal route home.
 *
 *   It can never go backwards, so wandering is never punished twice.
 *
 * @param {string[]} solution  the answer, START first and END last
 * @param {string[]} path      what the player has actually played, START first
 */
export function nextRung(solution, path) {
  let furthest = 0
  for (let i = 0; i < solution.length; i++) {
    if (path.includes(solution[i])) furthest = i
  }

  // Never hand over the win: the last move is always the player's. This costs
  // them almost nothing, because END is on screen for the whole game — a player
  // one rung out can already see the target is a letter away.
  const next = furthest + 1
  if (next >= solution.length - 1) return null

  return solution[next]
}
