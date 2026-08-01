import React from 'react'

// Surrender, behind a confirm.
//
// It has to exist at all because the move cap only counts moves that LAND: a
// player stranded on a one-way word (see puzzle.js) makes no moves, so the cap
// never burns down and their day would otherwise never resolve. This is the
// exit, and it's the only way a run ends unsolved with moves still on the clock.
//
// A skull rather than the words "Give up", because it shares a row with Leap now
// instead of holding a footer row of its own — which is what let it come back to
// the board permanently rather than appearing only once the cap got close. The
// label lives in aria-label/title, since an emoji is not a name.
//
// Still two-step, and that's the whole point of it being small: one tap arms,
// a second confirms. A player pressing this is ending a run they can't undo, and
// unlike every other control here that decision isn't recoverable by playing on.
// Armed state is owned by the board — see LeapPanel for why.
export function GiveUpButton({ onGiveUp, armed, onArm, onDisarm }) {
  if (!armed) {
    return (
      <button
        className="giveup-icon"
        type="button"
        aria-label="Give up"
        title="Give up"
        onClick={onArm}
      >
        <span aria-hidden="true">☠️</span>
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
        <button className="giveup" type="button" onClick={onDisarm}>
          Keep playing
        </button>
      </div>
    </div>
  )
}
