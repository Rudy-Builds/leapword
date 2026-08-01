import React from 'react'

// Spend a leap token.
//
// There is no menu any more. A leap has exactly one destination (see leap.js),
// so there is nothing to choose between — the player is spending a token, not
// picking from a list.
//
// The confirm deliberately does NOT name the word it will move you to. Showing
// it first would make this a free hint: tap, read the answer, cancel, and type
// it yourself for nothing. So the confirm says what it COSTS, and the word is
// what you get for paying.
//
// The armed state is owned by the board, not by this component: Give up shares
// the row, and two confirms open at once would each be trying to hold it.
export function LeapPanel({ target, leapsRemaining, onLeap, armed, onArm, onDisarm }) {
  // Nothing left to spend, or nowhere to spend it: a null target with tokens in
  // hand means the only rung remaining is the end word, which a leap never hands
  // over. Both dead ends now answer on press instead of in a standing label.
  const available = leapsRemaining > 0 && !!target

  if (armed) {
    return (
      <div className="leap confirming">
        <span className="leap-ask">Spend a leap? It moves you one word along.</span>
        <div className="leap-actions">
          <button
            className="leap-toggle leap-yes"
            type="button"
            onClick={() => {
              onDisarm()
              onLeap()
            }}
          >
            ⤳ Leap
          </button>
          <button className="leap-toggle" type="button" onClick={onDisarm}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Two things used to live here and both were the board repeating itself: the
  // remaining count as "2 left", and a note under a greyed-out button saying why
  // it was grey. The header already carries "2 leaps ⤳" and never scrolls away.
  //
  // So the button never disables. Pressing it when there's nothing to spend
  // routes straight to onLeap, which rejects and puts the reason in the message
  // slot the rejected-word feedback already owns — an answer when it's asked
  // for, rather than a standing line of chrome. A dead control couldn't have
  // given that answer anyway; it only ever said "no", never why.
  return (
    <div className="leap">
      <button className="leap-toggle" type="button" onClick={available ? onArm : onLeap}>
        ⤳ Leap
      </button>
    </div>
  )
}
