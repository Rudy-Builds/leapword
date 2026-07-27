import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LeapwordGame } from './components/LeapwordGame.jsx'
import { ArchivePage } from './components/ArchivePage.jsx'
import { LegalPage } from './components/LegalPage.jsx'
import { decodeChallenge } from './game/challenge.js'
import {
  EPOCH_ISO,
  FIRST_LONG_DAY,
  LONG_LEN,
  SHORT_LEN,
  puzzleForDay,
  wordLengthForDay,
} from './game/daily.js'
import { useDayNumber } from './state/useDayNumber.js'
import { useRoute } from './state/useRoute.js'
import { useViewportHeight } from './state/useViewportHeight.js'
import './styles/app.css'

/**
 * fetch + parse, with an error a human can act on.
 *
 * wrangler.jsonc sets not_found_handling: single-page-application, so a missing
 * asset doesn't 404 — it serves index.html with a 200. Left alone, a half-shipped
 * deploy surfaces as "Unexpected token '<'", which names neither the file nor the
 * cause. Checking the content type turns that into something debuggable.
 */
async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    throw new Error(`${url} returned ${type || 'no content-type'}, not JSON — incomplete deploy?`)
  }
  return res.json()
}

// Fetched assets, kept for the life of the tab.
//
// The load effect re-runs when the played puzzle changes length — opening a
// five-letter Sunday from the archive needs that day's dictionary, which a
// four-letter session never fetched. Without this cache, walking back and forth
// between a Sunday and a weekday would re-download both dictionaries every time.
// Failures are evicted so a retry is a real retry rather than a cached rejection.
const assetCache = new Map()
function getJson(url) {
  if (!assetCache.has(url)) {
    assetCache.set(
      url,
      fetchJson(url).catch((e) => {
        assetCache.delete(url)
        throw e
      }),
    )
  }
  return assetCache.get(url)
}

/** Both shipped streams. Schedules are small and the archive lists days from both. */
const LENGTHS = [SHORT_LEN, LONG_LEN]

/**
 * A schedule that disagrees with the app about how it is indexed still renders
 * perfectly plausible puzzles — just on the wrong days, silently. Every field
 * the client uses to pick an entry is therefore checked against the constant it
 * is supposed to match, and a mismatch is fatal rather than absorbed.
 */
function checkSchedule(schedule, wordLength) {
  const where = `schedule/${wordLength}.json`
  if (schedule.wordLength !== wordLength) {
    throw new Error(`${where} declares ${schedule.wordLength}-letter puzzles`)
  }
  // dayNumber() counts from EPOCH_ISO; a schedule indexes its paths from its
  // own epoch. If they ever disagree, every player silently gets the wrong
  // day's puzzle — fail loudly instead.
  if (schedule.epoch !== EPOCH_ISO) {
    throw new Error(`${where} epoch is ${schedule.epoch}, app expects ${EPOCH_ISO}`)
  }
  // 4.json predates the stream split and carries no cadence; 'daily' is the
  // only thing it could ever have meant. See build-schedule.mjs.
  const cadence = schedule.cadence ?? 'daily'
  const expected = wordLength === LONG_LEN ? 'sunday' : 'daily'
  if (cadence !== expected) {
    throw new Error(`${where} is a '${cadence}' stream, app indexes it as '${expected}'`)
  }
  if (cadence === 'sunday' && schedule.firstDay !== FIRST_LONG_DAY) {
    throw new Error(`${where} starts at #${schedule.firstDay}, app expects #${FIRST_LONG_DAY}`)
  }
  return schedule
}

// Loads the dictionary, synonym map and schedules, then hands them to the game.
//
// Which dictionary depends on the day being played: Sundays from #18 are five
// letters, everything else is four. The length is computed from the day number
// alone, so all of it still goes out in parallel — nothing waits on the
// schedule to announce its own wordLength, and checkSchedule catches the only
// way that shortcut could be wrong.
//
// Both schedules load regardless, because the archive lists days of both lengths
// side by side and 5.json is 31 KB. The dictionaries are the big files (27 KB
// and 69 KB) and only the played length's is fetched.
function Boot() {
  useViewportHeight()
  const [assets, setAssets] = useState(null)
  const [error, setError] = useState(null)
  const today = useDayNumber()
  const { route, navigate, challenge: challengeReq } = useRoute()

  // A shared "/N" link can name a puzzle that isn't the visitor's today. A future
  // number — a timezone-skewed share from someone a day ahead (see daily.js) —
  // isn't playable early: fall back to today and rewrite the misleading URL to
  // "/" (replace, so it leaves no Back entry). Past and today are handled below.
  const isFuture = route.view === 'day' && route.day > today
  useEffect(() => {
    if (isFuture) navigate('/', { replace: true })
  }, [isFuture, navigate])

  // A past number is an archive/challenge play — the exact puzzle a link named,
  // shown off-cycle. Today (or no request, or the future fallback above) is the
  // real daily. Derived before the load because the day decides which dictionary
  // the load needs.
  const isArchive = route.view === 'day' && route.day < today
  const number = isArchive ? route.day : today
  const wordLength = wordLengthForDay(number)

  useEffect(() => {
    let cancelled = false
    // Cleared per run, not just set on failure. This effect re-runs when the
    // played length changes, so without this a one-off failure fetching the
    // five-letter dictionary would keep the error screen up after the player
    // navigated back to a four-letter day whose assets are already in hand.
    // getJson drops failed entries from its cache, so this really does retry.
    setError(null)
    Promise.all([
      getJson(`/dict/${wordLength}.json`),
      getJson(`/syn/${wordLength}.json`),
      ...LENGTHS.map((len) => getJson(`/schedule/${len}.json`)),
    ])
      .then(([words, synMap, ...loaded]) => {
        if (cancelled) return
        const schedules = Object.fromEntries(
          LENGTHS.map((len, i) => [len, checkSchedule(loaded[i], len)]),
        )
        setAssets({ wordLength, dictSet: new Set(words), synMap, schedules })
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [wordLength])

  // Static content pages, resolved before the asset gate: they need neither the
  // dictionary nor the schedule, so they open instantly and stay reachable even
  // if the game's data fetch is failing. Placed after every hook above so the
  // hook order never changes between a legal route and a game route.
  if (route.view === 'privacy' || route.view === 'terms') {
    return <LegalPage kind={route.view} onHome={() => navigate('/')} onNavigate={navigate} />
  }

  if (error) return <div className="boot">Failed to load: {error}</div>
  // `assets.wordLength !== wordLength` is the moment after navigating from a
  // four-letter day to a five-letter one, when the previous day's dictionary is
  // still in state. Rendering through it would judge a five-letter puzzle
  // against the four-letter word list and reject every legal move.
  if (!assets || assets.wordLength !== wordLength) return <div className="boot">Loading…</div>

  // The past-puzzles index. A full view in place of the game — its own back
  // button returns to today. It spans both streams, hence every schedule.
  if (route.view === 'archive') {
    return (
      <ArchivePage
        today={today}
        schedules={assets.schedules}
        onOpen={(n) => navigate(`/${n}`)}
        onClose={() => navigate('/')}
      />
    )
  }

  // `number` drives what's shown and shared; `isArchive` decides whether it
  // counts toward the streak (LeapwordGame turns persistence off).
  const puzzle = puzzleForDay(number, assets.schedules)

  // The challenge applies only while the visitor is on the exact puzzle its link
  // named (route.day === challengeReq.day covers both an archive #N and a same-day
  // #N === today; the future-fallback above rewrote away any premature one).
  // Decoded here, not in useRoute, because validation needs the puzzle and the
  // dictionary — and an invalid code becomes null, i.e. a plain visit.
  const challenge =
    challengeReq && route.view === 'day' && route.day === challengeReq.day
      ? decodeChallenge(challengeReq.code, { puzzle, dictSet: assets.dictSet })
      : null

  // key={number} remounts when the puzzle changes — at midnight (daily rolls
  // forward) and when navigating between an archive puzzle and today. That's what
  // re-runs useGame's lazy initialiser against the right day's saved progress;
  // without it a tab left open overnight would roll the puzzle but keep the ladder.
  return (
    <LeapwordGame
      key={number}
      number={number}
      isArchive={isArchive}
      today={today}
      onPlayToday={() => navigate('/')}
      onOpenArchive={() => navigate('/archive')}
      puzzle={puzzle}
      dictSet={assets.dictSet}
      synMap={assets.synMap}
      challenge={challenge}
    />
  )
}

// Dev-only guard: main.jsx is the module Vite re-executes on every hot update,
// and calling createRoot twice on the same container warns and double-mounts.
// The root survives updates in import.meta.hot.data; prod runs this once anyway.
const container = document.getElementById('root')
const root = import.meta.hot
  ? (import.meta.hot.data.root ??= createRoot(container))
  : createRoot(container)
root.render(
  <React.StrictMode>
    <Boot />
  </React.StrictMode>,
)
