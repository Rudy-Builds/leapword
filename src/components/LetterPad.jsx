import React from 'react'

// The touch input surface: an on-screen A–Z pad that replaces the device
// keyboard outright on phones.
//
// Why not the native keyboard: a move changes exactly one letter, but a text
// input asks for the whole word — five taps to enter a one-letter change, on a
// keyboard that costs ~300px plus a 44px accessory bar iOS won't let us remove.
// Measured on a mid-size phone mid-game, that left the ladder — the thing the
// player is actually reasoning about — 94px, or 2.3 rows of a 10-move puzzle.
//
// Enter lives in the bottom row rather than as a button below the tiles, so the
// pad costs no height the old footer wasn't already spending on a Submit the
// iOS keyboard was drawing its own "go" key for anyway.
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM']

export function LetterPad({ onLetter, onEnter, canSubmit }) {
  return (
    <div className="pad" role="group" aria-label="Letters">
      {ROWS.map((row, r) => (
        <div className={`pad-row pad-row-${r + 1}`} key={row}>
          {/* Wordle puts Enter in this slot and so do we — the muscle memory is
              already there. There's no backspace twin on the right because a
              position always holds a letter: you replace it, you never empty
              it. */}
          {r === 2 && (
            <button
              className="pad-key pad-enter"
              type="button"
              disabled={!canSubmit}
              onClick={onEnter}
            >
              Enter
            </button>
          )}
          {row.split('').map((ch) => (
            <button
              className="pad-key"
              type="button"
              key={ch}
              aria-label={ch}
              onClick={() => onLetter(ch)}
            >
              {ch}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
