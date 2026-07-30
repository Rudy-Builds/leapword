import React, { useState } from 'react'

// Surrender, behind a confirm.
//
// It has to exist at all because there is no move cap (see puzzle.js): reaching
// END is otherwise the only terminal state, so without this a stuck player's day
// never resolves — no result, no answer, no countdown to tomorrow.
//
// It also has to be hard to hit by accident, which is the whole reason for the
// two-step. One tap arms it, a second confirms; anything else disarms. A player
// pressing it is ending a run they can't undo, and unlike every other control
// here that decision isn't recoverable by playing on.
//
// Deliberately quiet — the same ghost treatment as "See result", not the solid
// fill Share gets. It's an exit, and an exit should never look like the thing to
// do next.
export function GiveUpButton({ onGiveUp }) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button className="giveup" type="button" onClick={() => setArmed(true)}>
        Give up
      </button>
    )
  }

  return (
    <div className="giveup-confirm">
      {/* Says what it costs, not "are you sure". Deliberately does NOT promise
          the answer: the par line is withheld on a give-up, so the old wording
          ("show the answer and end today's run") was a straight lie. */}
      <span className="giveup-ask">End today’s run? You won’t see the answer.</span>
      <div className="giveup-actions">
        <button className="giveup giveup-yes" type="button" onClick={onGiveUp}>
          Give up
        </button>
        <button className="giveup" type="button" onClick={() => setArmed(false)}>
          Keep playing
        </button>
      </div>
    </div>
  )
}
