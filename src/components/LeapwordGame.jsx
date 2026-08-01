import React, { useEffect, useState } from 'react'
import { isLongDay } from '../game/daily.js'
import { useGame } from '../state/useGame.js'
import { useStreak } from '../state/useStreak.js'
import { hasSeenHelp, markHelpSeen, recordCompletion } from '../state/storage.js'
import { PuzzleHeader } from './PuzzleHeader.jsx'
import { WordChain } from './WordChain.jsx'
import { ActiveWordTiles } from './ActiveWordTiles.jsx'
import { LeapPanel } from './LeapPanel.jsx'
import { GiveUpButton } from './GiveUpButton.jsx'
import { ResultModal } from './ResultModal.jsx'
import { HelpModal } from './HelpModal.jsx'

export function LeapwordGame({ puzzle, dictSet, number, isArchive = false, today, onPlayToday, onOpenArchive, challenge = null }) {
  // Archive/challenge plays are ephemeral and off the streak: a null dayNumber
  // turns off both the day-scoped progress save (a refresh just restarts it,
  // harmless off-cycle) and the streak recording, while `number` still drives the
  // #N shown and shared. The daily passes its real number through unchanged.
  const storeDay = isArchive ? null : number
  const game = useGame(puzzle, dictSet, { dayNumber: storeDay })
  // Reads the streak once on mount and records the result when a daily game ends.
  const streak = useStreak(storeDay, game.status)

  // Record the result to the completion log the moment a game ends — daily OR
  // archive, since both complete a puzzle (only the daily also feeds the streak).
  // Idempotent: recordCompletion keeps the best star, so a refresh or a replay of
  // an archive puzzle is safe to re-fire.
  useEffect(() => {
    if (game.status === 'won' || game.status === 'lost') {
      recordCompletion(number, game.stars ?? 0)
    }
  }, [game.status, game.stars, number])

  // Any landed move (typed or leapt) disarms. A confirm is a question about the
  // word you're standing on; once you've moved, it's asking about the wrong one.
  useEffect(() => {
    setArmed(null)
  }, [game.path.length])
  // The rules used to be opt-in behind a button no first-timer had a reason to
  // press. Lazy initialiser: hasSeenHelp touches localStorage, so it must not
  // run on every render. This component is keyed by day and remounts at
  // midnight, which re-runs this — by then the flag is set, so it stays shut.
  const [helpOpen, setHelpOpen] = useState(() => !hasSeenHelp())
  // The result modal auto-opens on finish, but can now be dismissed to admire the
  // finished board. Kept here (not in the modal) because the board needs a way
  // back to it — Share lives inside. Resets per puzzle via the key={number} remount.
  const [resultOpen, setResultOpen] = useState(true)
  // Which of the two row controls is showing its confirm: null | 'leap' |
  // 'giveup'. Lives here because they share a row — see the .actions block.
  const [armed, setArmed] = useState(null)
  const playing = game.status === 'playing'
  const isWeekend = isLongDay(number)

  // Marked on close rather than on open: dismissing it is the signal they've
  // read it, so refreshing with it still up shows it again. Idempotent, so a
  // manual open/close later just rewrites the same flag.
  const closeHelp = () => {
    markHelpSeen()
    setHelpOpen(false)
  }

  return (
    <>
      <div className="game">
        <header className="topbar">
          <h1 className="brand">
            Leapword <span className="brand-sub">daily word ladder</span>
          </h1>
          {/* Persistent, always-reachable entry to the archive — its proper home,
              not the once-a-day result modal (which only nudges toward it). Sits
              in the topbar's spare right edge; hidden with the topbar when the
              keyboard is up (.vp-tiny), which is fine — you don't browse mid-move. */}
          <button
            className="help-btn archive-btn"
            type="button"
            aria-label="Past puzzles"
            title="Past puzzles"
            onClick={onOpenArchive}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M3 9h18M8 2v4M16 2v4" />
            </svg>
          </button>
        </header>

        {/* A challenge link gets its own bar: the friend's numbers are the
            reason this visitor is here, so while they play it outranks the
            archive bar (one bar, not a stack — phone rows are scarce). Numbers
            only, never words: the path stays sealed until their run ends. */}
        {playing && challenge && (
          <div className="archive-bar challenge-bar">
            <span>
              🎯 A friend solved #{number} in {challenge.steps}
              {challenge.leapsUsed > 0 &&
                ` · ${challenge.leapsUsed} ${challenge.leapsUsed === 1 ? 'leap' : 'leaps'}`}
              {' · '}
              {'⭐'.repeat(challenge.stars)} — beat their path
            </span>
          </div>
        )}

        {/* Off-cycle play arrived via a shared "/N" link. Name it as a past
            puzzle so the streak's absence isn't a surprise, and give a one-tap
            way back to today's real daily. Yields to the challenge bar during
            play; returns once the game ends and the bar's job is done. */}
        {isArchive && !(playing && challenge) && (
          <div className="archive-bar">
            <span>
              Leapword #{number} · a past {isWeekend ? 'weekend' : 'puzzle'}
            </span>
            <button type="button" className="archive-today" onClick={onPlayToday}>
              Play today’s #{today} →
            </button>
          </div>
        )}

        {/* There used to be a bar here announcing the longer weekend word. It
            was a standing banner on two days in seven — noise on the board every
            weekend to explain something the tile count already shows. The rule
            lives in How to play instead, where the other rules are. */}

        <PuzzleHeader
          start={puzzle.start}
          end={puzzle.end}
          par={puzzle.par}
          movesUsed={game.movesUsed}
          moveCap={game.moveCap}
          leapsRemaining={game.leapsRemaining}
          onHelp={() => setHelpOpen(true)}
        />

        <WordChain path={game.path} end={puzzle.end} leapSteps={game.leapSteps} />

        {playing && (
          <div className="play">
            {/* Both ways out of the current word, on one row. Give up cost a
                whole footer row of its own before — 44px held all game for a
                decision almost nobody makes — and beside Leap it costs the
                width of a square. That's what let it back onto the board
                permanently instead of surfacing only near the cap.

                Only one may be armed: each replaces the row with its own
                confirm, and two would be fighting over it. The board holds that
                state rather than the buttons, and drops it after every move so
                a confirm can't outlive the position it was asked about. */}
            <div className="actions">
              {armed !== 'giveup' && (
                <LeapPanel
                  target={game.leapTarget}
                  leapsRemaining={game.leapsRemaining}
                  onLeap={game.useLeap}
                  armed={armed === 'leap'}
                  onArm={() => setArmed('leap')}
                  onDisarm={() => setArmed(null)}
                />
              )}
              {armed !== 'leap' && (
                <GiveUpButton
                  onGiveUp={game.giveUp}
                  armed={armed === 'giveup'}
                  onArm={() => setArmed('giveup')}
                  onDisarm={() => setArmed(null)}
                />
              )}
            </div>

            {/* Last in the column, nearest the keyboard it summons. */}
            <ActiveWordTiles
              current={game.current}
              onSubmit={game.submitWord}
              onEdit={game.clearMessage}
              message={game.message}
            />
          </div>
        )}

        {/* Finished, with the result dismissed: the way back to it (Share, stars,
            and the par line all live in the modal). Sits where the input was. */}
        {!playing && !resultOpen && (
          <div className="play">
            <button className="result-reopen" type="button" onClick={() => setResultOpen(true)}>
              See result
            </button>
          </div>
        )}
      </div>

      {/* Fixed overlays live outside .game so that no transform/filter/contain
          added there later can capture them into a 460px column. */}
      {!playing && resultOpen && (
        <ResultModal
          status={game.status}
          gaveUp={game.gaveUp}
          stars={game.stars}
          path={game.path}
          start={puzzle.start}
          end={puzzle.end}
          par={puzzle.par}
          leapsUsed={game.leapsUsed}
          leapSteps={game.leapSteps}
          solution={puzzle.solution}
          number={number}
          challenge={challenge}
          streak={isArchive ? undefined : streak}
          isArchive={isArchive}
          today={today}
          onPlayToday={onPlayToday}
          onOpenArchive={onOpenArchive}
          onClose={() => setResultOpen(false)}
          onHelp={() => setHelpOpen(true)}
        />
      )}

      {/* Renders after ResultModal, and that order is load-bearing: both
          overlays are z-index 10, so paint order falls back to the DOM. Put
          help first and the result modal covers it — the ? would look dead. */}
      {helpOpen && (
        <HelpModal
          par={puzzle.par}
          moveCap={game.moveCap}
          onClose={closeHelp}
        />
      )}
    </>
  )
}
