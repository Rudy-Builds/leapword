import React, { useEffect, useRef, useState } from 'react'
import { LetterPad } from './LetterPad.jsx'

// Two ways to enter a move, chosen by pointer type, sharing nothing but the
// tile row's look:
//
//   fine pointer (desktop)  — type the whole word into an empty row. Fast when
//                             you have a real keyboard, and unchanged from the
//                             original design.
//   coarse pointer (touch)  — the row starts as the word you're standing on;
//                             tap a tile to arm a position, tap a letter on the
//                             in-page pad to replace it, Enter to commit. Two or
//                             three taps instead of five, and no device keyboard
//                             at all — see LetterPad.jsx for why that matters.
//
// The two are separate components rather than one with a branch because each
// owns its own hooks. Switching modes remounts, which resets the draft — that
// only happens if a pointer type appears mid-game, where a cleared draft is the
// least of it.

// Read once at mount: pointer type does not meaningfully change mid-session, and
// making it reactive would remount the input under anyone with a hybrid device.
// The query-param override is for testing both modes on one machine — a desktop
// browser reports `fine` no matter how the window is sized.
function useLetterPad() {
  const [pad] = useState(() => {
    const override = new URLSearchParams(window.location.search).get('input')
    if (override === 'pad') return true
    if (override === 'type') return false
    return window.matchMedia?.('(pointer: coarse)').matches ?? false
  })
  return pad
}

export function ActiveWordTiles(props) {
  return useLetterPad() ? <PadTiles {...props} /> : <TypedTiles {...props} />
}

// One slot for the prompt and the rejection message — never both, and two
// stacked 12px lines cost ~28px where it's scarcest.
function Label({ message, fallback }) {
  return (
    <div className={`active-label ${message ? 'error' : ''}`} role="status">
      {message || fallback}
    </div>
  )
}

/* ---------- Touch: tap a tile, tap a letter ---------- */

function PadTiles({ current, onSubmit, onEdit, message, paused = false }) {
  const len = current.length
  // The draft starts as the word you're on, not empty: the move IS the word
  // you're standing on with one letter swapped, so that's what the row shows.
  // It also retires the old ghost-letter hint, which rendered the current word
  // at 30% opacity in tiles identical to real input — reliably read as
  // pre-filled, and one tap from "That's the same word."
  const [draft, setDraft] = useState(current)
  // Position 0 is armed from the start so the pad is live on the first tap.
  // Arming nothing would be more honest about there being no default, but it
  // buys a dead state at the top of every single move.
  const [pos, setPos] = useState(0)

  // A rejected word leaves `current` untouched, so this deliberately does not
  // fire on a rejection — the bad draft stays in the tiles and one more letter
  // tap fixes it, the same forgiveness the typed mode gets.
  useEffect(() => {
    setDraft(current)
    setPos(0)
  }, [current])

  const changed = draft !== current

  const setLetter = (ch) => {
    setDraft((d) => d.slice(0, pos) + ch + d.slice(pos + 1))
    onEdit?.()
  }

  const submit = () => {
    if (changed) onSubmit(draft)
  }

  // A physical keyboard still drives the pad — an iPad with a case, or a phone
  // with one paired. There is no focusable input in this mode (that's the whole
  // point: a focused input is what summons the device keyboard), so the listener
  // has to be on the window. `paused` is the Help modal being open: without it,
  // typing behind the modal would silently rewrite the draft.
  useEffect(() => {
    if (paused) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'ArrowLeft') {
        setPos((p) => Math.max(0, p - 1))
      } else if (e.key === 'ArrowRight') {
        setPos((p) => Math.min(len - 1, p + 1))
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault()
        setLetter(e.key.toUpperCase())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="active">
      <Label message={message} fallback="Change one letter" />

      <div className="active-row">
        <div className="tile-input" role="group" aria-label="Your move">
          {Array.from({ length: len }).map((_, i) => {
            const ch = draft[i]
            return (
              <button
                type="button"
                className={`tile input slot ${ch !== current[i] ? 'changed' : ''} ${
                  i === pos ? 'selected' : ''
                }`}
                key={i}
                aria-label={`Letter ${i + 1}: ${ch}`}
                aria-pressed={i === pos}
                onClick={() => setPos(i)}
              >
                {ch}
              </button>
            )
          })}
        </div>
      </div>

      <LetterPad onLetter={setLetter} onEnter={submit} canSubmit={changed} />
    </div>
  )
}

/* ---------- Desktop: type the word ---------- */

// The next word as editable letter tiles. The input starts EMPTY each move so
// you can just start typing (the current word shows as a faint hint in the
// tiles). A hidden-but-focusable input captures keystrokes and stays focused —
// including right after Enter — so you never have to click back in.
//
// .ghost-input is absolutely positioned over the tiles at opacity 0, so a click
// lands on the input itself.
function TypedTiles({ current, onSubmit, onEdit, message }) {
  const len = current.length
  const [draft, setDraft] = useState('')
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
      <Label message={message} fallback={focused ? 'Your move' : 'Click to type'} />

      <div className="active-row">
        <div className="tile-input" onClick={focus}>
          {Array.from({ length: len }).map((_, i) => {
            const ch = draft[i] || ''
            const changed = ch && ch !== current[i]
            const isCaret = focused && i === draft.length
            return (
              <span
                className={`tile input ${changed ? 'changed' : ''} ${isCaret ? 'selected' : ''}`}
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
