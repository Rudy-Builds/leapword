import React, { useEffect, useRef, useState } from 'react'

// The next word as editable letter tiles. The input starts EMPTY each move so
// you can just start typing (the current word shows as a faint hint in the
// tiles). A hidden-but-focusable input captures keystrokes and stays focused —
// including right after Enter — so you never have to click back in.
//
// .ghost-input is absolutely positioned over the tiles at opacity 0, so a tap
// lands on the input itself. That's a real user gesture, which is why the
// keyboard opens on iOS even though programmatic focus() there does nothing.
export function ActiveWordTiles({ current, onSubmit, onEdit, message }) {
  const len = current.length
  const [draft, setDraft] = useState('')
  // Starts false: iOS ignores autoFocus and programmatic focus() outside a user
  // gesture, so on a phone we genuinely are not focused until the player taps.
  // (true was a lie that also lit the fake caret on an unfocused input.) On
  // desktop the mount effect's focus() fires onFocus during commit, so this
  // flips to true before first paint — no flash.
  const [focused, setFocused] = useState(false)
  const inputRef = useRef(null)

  const focus = () => inputRef.current?.focus({ preventScroll: true })

  // Fresh, empty, focused input for every new move — just type.
  useEffect(() => {
    setDraft('')
    focus()
  }, [current])

  // A rejected word stays in the tiles so a one-letter typo can be fixed in
  // place. Keep the caret at the end (rather than selecting the whole draft) so
  // backspace deletes one letter at a time — the player nibbles the mistake off
  // instead of losing the whole word to a single keystroke.
  useEffect(() => {
    if (!message) return
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [message])

  const handleChange = (e) => {
    const cleaned = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, len)
    setDraft(cleaned)
    onEdit?.()
  }

  const submit = () => onSubmit(draft)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="active">
      {/* One slot for the prompt and the rejection message — never both. */}
      <div className={`active-label ${message ? 'error' : ''}`} role="status">
        {message || (focused ? 'Your move' : 'Tap to type')}
      </div>

      <div className="active-row">
        <div className="tile-input" onClick={focus}>
          {Array.from({ length: len }).map((_, i) => {
            const ch = draft[i] || ''
            const changed = ch && ch !== current[i]
            const isCaret = focused && i === draft.length
            return (
              <span
                className={`tile input ${changed ? 'changed' : ''} ${isCaret ? 'caret' : ''}`}
                key={i}
              >
                {ch || <span className="ghost-letter">{current[i]}</span>}
              </span>
            )
          })}
          <input
            ref={inputRef}
            className="ghost-input"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            maxLength={len}
            aria-label="Next word"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            enterKeyHint="go"
          />
        </div>

        <button
          className="submit"
          type="button"
          // Keep focus in the input so the next word can be typed straight away.
          // The focus() in onClick also runs inside a user gesture, which is what
          // lets iOS re-open the keyboard if it had dismissed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            submit()
            focus()
          }}
        >
          Enter
        </button>
      </div>
    </div>
  )
}
