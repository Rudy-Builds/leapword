// A puzzle, hydrated from one line of a schedule.
//
// A schedule (public/schedule/4.json for the everyday puzzle, 5.json for
// Sundays) stores each puzzle as its path and nothing else — "KIND FIND FINE
// FIVE GIVE". Everything else is derivable, so storing it would just be a chance
// to disagree with itself:
//
//   start === path[0]         end === path.at(-1)
//   par   === path.length-1   solution IS the path
//
// The generator guarantees par is a TRUE optimum: the shortest route on the full
// typeable dictionary is exactly as short as this common-words-only route, so
// nobody can beat par by knowing an obscure word. See scripts/build-schedule.mjs.

/**
 * @param {string} line  space-separated path, e.g. "KIND FIND FINE FIVE GIVE"
 * @param {{leaps: number}} schedule  file-level constants
 */
export function puzzleFromPath(line, { leaps }) {
  const path = line.split(' ')
  return {
    wordLength: path[0].length,
    start: path[0],
    end: path[path.length - 1],
    par: path.length - 1,
    leaps, // leap tokens available
    // Revealed on a loss, so it has to be real data rather than a comment.
    solution: path,
  }
}

// Move cap = par + 4 (streak-breaking threshold from the design doc).
//
// Note what it does NOT do: rescue a player with no legal move. The cap only
// advances when a move lands, so someone stranded on a one-way word (ALSO's only
// neighbour in the whole dictionary is ALTO, and 136 other typeable words are
// the same shape) never burns it down. Give up is the exit for that — see
// GiveUpButton — and it is the only reason a run can end unsolved with moves
// still on the clock.
export const moveCapFor = (par) => par + 4
