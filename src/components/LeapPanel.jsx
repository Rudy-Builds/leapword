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
  const spent = leapsRemaining <= 0
  // Null target with tokens in hand means the only rung left is the end word.
  // The copy stays vague on purpose: "you're one move away" is information the
  // player should be reading off the board, not off a disabled button.
  const disabled = spent || !target

  if (armed && !disabled) {
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

  // The remaining count used to ride along here as "2 left". The header already
  // carries "2 leaps ⤳" and never scrolls away, so this was the same number
  // twice on a screen with no room for it once.
  return (
    <div className="leap">
      <button className="leap-toggle" type="button" disabled={disabled} onClick={onArm}>
        ⤳ Leap
      </button>
      {disabled && (
        <div className="leap-note">{spent ? 'Out of leap tokens.' : 'No leap available.'}</div>
      )}
    </div>
  )
}
