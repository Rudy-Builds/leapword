import React from 'react'
import { ThemeToggle } from './ThemeToggle.jsx'

// Mini tile row used for the start/end words in the header.
function MiniWord({ word, tone }) {
  return (
    <div className={`miniword ${tone}`}>
      {word.split('').map((ch, i) => (
        <span className="minitile" key={i}>
          {ch}
        </span>
      ))}
    </div>
  )
}

export function PuzzleHeader({ start, end, par, movesUsed, moveCap, leapsRemaining, onHelp }) {
  // "1/8 moves" reads like a progress bar, but the cap ends the run. Rather than
  // spend words saying so, the fraction goes red as it runs out.
  const low = moveCap - movesUsed <= 2

  return (
    <div className="header">
      {/* Source order matches the visual columns (help left, theme right) so the
          grid places all three in one row and tab order runs left-to-right. Help
          lives here rather than in the topbar for two reasons: it sits beside the
          very terms it explains, and the topbar is display:none at .vp-tiny —
          which hid help exactly when the keyboard was up. */}
      <button className="help-btn" type="button" aria-label="How to play" onClick={onHelp}>
        ?
      </button>

      <div className="header-main">
        {/* Ten tiles and an arrow have to fit the same middle column four-letter
            days fill with eight. Left alone they wrap, which strands the arrow
            at the end of the first line. */}
        <div className={`header-words ${start.length > 4 ? 'long' : ''}`}>
          <MiniWord word={start} tone="start" />
          <span className="arrow">→</span>
          <MiniWord word={end} tone="end" />
        </div>
        <div className="header-stats">
          <span className="stat">
            <b>{par}</b> par
          </span>
          <span className={`stat ${low ? 'spent' : ''}`}>
            <b>{movesUsed}</b>/{moveCap} moves
          </span>
          <span className="stat">
            <b>{leapsRemaining}</b> {leapsRemaining === 1 ? 'leap' : 'leaps'} ⤳
          </span>
        </div>
      </div>

      <ThemeToggle />
    </div>
  )
}
