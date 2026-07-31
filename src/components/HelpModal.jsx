import React from 'react'
import { EXAMPLE_LADDER as EXAMPLE } from '../game/example.js'

// This ladder must never be a real puzzle — see src/game/example.js. Each step
// changes exactly one letter, same as the real rules.

// Index of the letter that changed from the previous word, for highlighting.
function changedIndex(prev, word) {
  if (!prev) return -1
  for (let i = 0; i < word.length; i++) if (prev[i] !== word[i]) return i
  return -1
}

export function HelpModal({ par, moveCap, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal help"
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">How to play</h2>

        <div className="help-body">
          <p>
            {/* Same orange as the changed letters below, so the rule and the
                example read as one thing. */}
            Change <b className="hl">one letter at a time</b> to turn the start word into the
            target word. Every step has to be a real word.
          </p>

          <div className="help-example">
            {EXAMPLE.map((word, i) => {
              const hl = changedIndex(EXAMPLE[i - 1], word)
              return (
                <React.Fragment key={word}>
                  {i > 0 && <span className="arrow">→</span>}
                  <span>
                    {word.split('').map((ch, j) => (
                      <span className={j === hl ? 'hl' : ''} key={j}>
                        {ch}
                      </span>
                    ))}
                  </span>
                </React.Fragment>
              )
            })}
          </div>

          <dl className="help-terms">
            <div className="help-term">
              <dt>Par</dt>
              <dd>The fewest steps possible. This puzzle’s par is {par}.</dd>
            </div>
            <div className="help-term">
              <dt>Moves</dt>
              <dd>
                You get {moveCap}: par plus four. Run out and the puzzle locks.
              </dd>
            </div>
            {/* Directly under Moves, because it spends one — the cost only
                makes sense next to the budget it comes out of. */}
            <div className="help-term">
              <dt>Leaps ⤳</dt>
              <dd>Moves you to the next word of the answer. Costs a move and a star.</dd>
            </div>
            {/* Two rules in one entry, both about the shape of the day rather
                than how you play it. The weekend line was briefly its own term
                and before that a banner on the board — a standing notice two
                days in seven, to explain something the tile count already
                shows. Nowhere else does the game say the rest of this, and it's
                the rule people collide with: there's no "play again", so losing
                looks broken unless you already knew it was one attempt. */}
            <div className="help-term">
              <dt>One a day</dt>
              <dd>
                Everyone gets the same ladder, and you get one go at it. A new one lands
                at midnight. Weekends are five letters.
              </dd>
            </div>
          </dl>

          <div className="help-stars">
            <div className="help-star-row">
              <span className="pips">★★★</span>
              <span>par, no leaps</span>
            </div>
            <div className="help-star-row">
              <span className="pips">★★</span>
              <span>one over par, or one leap</span>
            </div>
            <div className="help-star-row">
              <span className="pips">★</span>
              <span>solved before the cap</span>
            </div>
          </div>

          {/* A mailto, not bare text: on a phone an unlinked address is a
              copy-by-hand chore and the feedback never gets sent. */}
          <p className="help-feedback">
            Hope you enjoyed it! Any feedback? Just email me at{' '}
            <a href="mailto:rudybuilds@pm.me">rudybuilds@pm.me</a>
          </p>

          {/* The site's only always-reachable home for the legal pages — the
              game board itself is a full-viewport, keyboard-aware layout with no
              room for a standing footer, and Help opens for every new player.
              Plain anchors: a full nav to a rarely-visited page is fine, and it
              keeps this leaf component from needing the router threaded in. */}
          <p className="help-links">
            <a href="/privacy">Privacy</a>
            <span aria-hidden="true"> · </span>
            <a href="/terms">Terms</a>
          </p>
        </div>

        <button className="submit" type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  )
}
