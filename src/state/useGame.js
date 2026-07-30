import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { isLegalMove, computeStars } from '../game/rules.js'
import { nextRung } from '../game/leap.js'
import { moveCapFor } from '../game/puzzle.js'
import { defaultStorage } from './storage.js'

// All mutable game state lives here. The reducer is pure; validation happens in
// the action creators (which close over the dictionary + synonym map) so the
// reducer only ever receives already-legal moves or a rejection message.

function freshState(puzzle) {
  return {
    current: puzzle.start,
    path: [puzzle.start],
    movesUsed: 0,
    leapsRemaining: puzzle.leaps,
    leapsUsed: 0,
    status: 'playing', // 'playing' | 'won' | 'lost'
    // Which kind of loss, because they read completely differently to the player
    // and 'lost' alone can't tell them apart: running the cap out is something
    // that happened to you, giving up is something you chose.
    gaveUp: false,
    stars: null,
    message: null,
  }
}

// useReducer's lazy initialiser: rehydrating here rather than in an effect means
// the first render is already correct, so a finished player never sees a
// playable board flash before the result modal replaces it.
function makeInitialState({ puzzle, saved }) {
  // saved.path[0] guards the seam: if the schedule were ever rebuilt under a
  // player mid-game, yesterday's ladder wouldn't start where today's does, and
  // rehydrating it would strand them on a puzzle that no longer exists.
  if (saved?.path?.length && saved.path[0] === puzzle.start) {
    return {
      current: saved.path[saved.path.length - 1],
      path: saved.path,
      movesUsed: saved.movesUsed,
      leapsRemaining: saved.leapsRemaining,
      leapsUsed: saved.leapsUsed,
      status: saved.status,
      gaveUp: saved.gaveUp ?? false, // absent in states saved before give-up shipped
      stars: saved.stars,
      message: null, // transient — never restored
    }
  }
  return freshState(puzzle)
}

function reducer(state, action) {
  switch (action.type) {
    case 'APPLY_MOVE': {
      const { word, isLeap, par, moveCap, end } = action
      const path = [...state.path, word]
      const movesUsed = state.movesUsed + 1
      const leapsUsed = state.leapsUsed + (isLeap ? 1 : 0)
      const leapsRemaining = state.leapsRemaining - (isLeap ? 1 : 0)

      let status = 'playing'
      let stars = null
      if (word === end) {
        status = 'won'
        stars = computeStars({ steps: movesUsed, par, leapsUsed, solved: true })
      } else if (movesUsed >= moveCap) {
        status = 'lost'
        stars = 0
      }

      return {
        ...state,
        current: word,
        path,
        movesUsed,
        leapsUsed,
        leapsRemaining,
        status,
        stars,
        message: null,
      }
    }
    // Needed even with the cap back, because the cap only counts moves that
    // land: a player stranded on a one-way word (see puzzle.js) makes no moves,
    // so it never runs out and their day would never resolve. This is the exit.
    case 'GIVE_UP':
      return { ...state, status: 'lost', gaveUp: true, stars: 0, message: null }
    case 'REJECT':
      return { ...state, message: action.message }
    case 'CLEAR_MESSAGE':
      return { ...state, message: null }
    case 'RESET':
      return freshState(action.puzzle)
    default:
      return state
  }
}

export function useGame(puzzle, dictSet, { dayNumber, storage = defaultStorage } = {}) {
  const [state, dispatch] = useReducer(
    reducer,
    { puzzle, saved: dayNumber == null ? null : storage.load(dayNumber) },
    makeInitialState,
  )
  const moveCap = moveCapFor(puzzle.par)

  // Write through on every change, not just on finish — see storage.js.
  useEffect(() => {
    if (dayNumber == null) return
    storage.save(dayNumber, state)
  }, [state, dayNumber, storage])

  // Where a leap would take you, or null when there is nowhere to go — no tokens
  // left, or the only rung remaining is END, which a leap never hands over.
  //
  // Note this depends on the PATH, not the current word: the target is the rung
  // after the furthest you've reached, so wandering doesn't move it.
  const leapTarget = useMemo(() => {
    if (state.leapsRemaining <= 0) return null
    return nextRung(puzzle.solution, state.path)
  }, [puzzle.solution, state.path, state.leapsRemaining])

  const submitWord = useCallback(
    (raw) => {
      if (state.status !== 'playing') return
      const word = String(raw || '').trim().toUpperCase()
      const check = isLegalMove(word, {
        current: state.current,
        path: state.path,
        dictSet,
        leapTargets: [], // typed moves are letter-swaps only; leaps go via the menu
      })
      if (!check.ok) {
        dispatch({ type: 'REJECT', message: check.reason })
        return
      }
      dispatch({ type: 'APPLY_MOVE', word, isLeap: false, par: puzzle.par, moveCap, end: puzzle.end })
    },
    [state.status, state.current, state.path, dictSet, puzzle, moveCap]
  )

  // Takes no argument: there is exactly one place a leap can go, so the player
  // is spending a token rather than picking from a menu.
  const useLeap = useCallback(() => {
    if (state.status !== 'playing') return
    if (!leapTarget) {
      dispatch({ type: 'REJECT', message: 'No leap available.' })
      return
    }
    const check = isLegalMove(leapTarget, {
      current: state.current,
      path: state.path,
      dictSet,
      leapTargets: [leapTarget],
    })
    if (!check.ok || !check.isLeap) {
      dispatch({ type: 'REJECT', message: check.reason || 'No leap available.' })
      return
    }
    dispatch({
      type: 'APPLY_MOVE',
      word: leapTarget,
      isLeap: true,
      par: puzzle.par,
      moveCap,
      end: puzzle.end,
    })
  }, [state.status, state.current, state.path, leapTarget, dictSet, puzzle, moveCap])

  const giveUp = useCallback(() => {
    if (state.status !== 'playing') return
    dispatch({ type: 'GIVE_UP' })
  }, [state.status])

  const clearMessage = useCallback(() => dispatch({ type: 'CLEAR_MESSAGE' }), [])

  // Under one-play-per-day this is the cheat button, so it is not wired to any
  // shipping UI — "Play again" is gone. It survives as a dev-only escape hatch
  // because without it the reducer can't be exercised by hand.
  const reset = useCallback(() => {
    if (!import.meta.env.DEV) return
    if (dayNumber != null) storage.clear()
    dispatch({ type: 'RESET', puzzle })
  }, [puzzle, dayNumber, storage])

  return {
    ...state,
    moveCap,
    movesLeft: moveCap - state.movesUsed,
    leapTarget,
    submitWord,
    useLeap,
    giveUp,
    clearMessage,
    reset,
  }
}
