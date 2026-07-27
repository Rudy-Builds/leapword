import React from 'react'
import { isLongDay, puzzleForDay } from '../game/daily.js'
import { loadCompletions } from '../state/storage.js'

// A star row for a played puzzle: filled pips for stars earned, hollow for the
// rest. Three hollow pips reads as "attempted, didn't solve" — distinct from an
// unplayed puzzle, which shows "Play" instead of any pips.
function Pips({ stars }) {
  return (
    <span className="archive-pips" aria-label={`${stars} of 3 stars`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={`pip ${n <= stars ? 'on' : ''}`}>
          ★
        </span>
      ))}
    </span>
  )
}

/**
 * The past-puzzles index: every puzzle from #1 to yesterday, newest first, each
 * showing its start→end and your result from the local completion log. Today's
 * puzzle is deliberately absent — it's played on the main screen, and listing it
 * here would offer a second, streak-free way to play the very puzzle the streak
 * is about. Tapping a row opens it in archive-play mode (Boot routes "/N").
 */
export function ArchivePage({ today, schedules, onOpen, onClose }) {
  const completions = loadCompletions()
  const days = []
  for (let n = today - 1; n >= 1; n--) days.push(n)

  return (
    <div className="archive">
      <header className="archive-top">
        <button className="help-btn" type="button" aria-label="Back to today" onClick={onClose}>
          ←
        </button>
        <h1 className="archive-title">Past puzzles</h1>
      </header>

      {days.length === 0 ? (
        <p className="archive-empty">
          No past puzzles yet — today’s is the first ever. A new one lands every day, and
          they’ll pile up here.
        </p>
      ) : (
        <ul className="archive-list">
          {days.map((n) => {
            const puzzle = puzzleForDay(n, schedules)
            const stars = completions[n]
            const played = stars != null
            return (
              <li key={n}>
                <button className="archive-row" type="button" onClick={() => onOpen(n)}>
                  <span className="archive-n">
                    #{n}
                    {/* The longer words are self-evident once you read the row;
                        the tag is for scanning the column and finding them. */}
                    {isLongDay(n) && <span className="archive-sun">SUN</span>}
                  </span>
                  <span className="archive-words">
                    {puzzle.start} <span className="archive-arrow">→</span> {puzzle.end}
                  </span>
                  {played ? <Pips stars={stars} /> : <span className="archive-play">Play</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
