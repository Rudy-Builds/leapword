// Must run under a DST-observing timezone to be meaningful:
//   TZ=America/New_York node --test src/game/
import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import {
  FIRST_LONG_DAY,
  dayNumber,
  formatCountdown,
  isLongDay,
  msUntilNextPuzzle,
  puzzleForDay,
  streamIndexForDay,
  weekdayForDay,
  wordLengthForDay,
} from './daily.js'

const at = (y, m, d, h = 12) => new Date(y, m, d, h)

describe('dayNumber', () => {
  test('the epoch is #1', () => {
    assert.equal(dayNumber(at(2026, 6, 16)), 1)
  })

  test('counts forward', () => {
    assert.equal(dayNumber(at(2026, 6, 17)), 2)
    assert.equal(dayNumber(at(2026, 7, 15)), 31)
  })

  test('is stable across the whole local day', () => {
    const hours = [0, 1, 6, 12, 18, 23]
    const ns = hours.map((h) => dayNumber(at(2026, 6, 20, h)))
    assert.deepEqual(new Set(ns), new Set([5]))
  })

  test('before the epoch goes <= 0 rather than throwing', () => {
    assert.equal(dayNumber(at(2026, 6, 15)), 0)
    assert.ok(dayNumber(at(2020, 0, 1)) < 0)
  })

  // The reason dayNumber routes local Y/M/D through Date.UTC instead of diffing
  // two local Dates: across a DST boundary a local day is 23 or 25 hours, so a
  // naive diff/86400000 lands on x.958 or x.041 and floor() skips or repeats a
  // puzzle. These would fail on the naive implementation.
  describe('DST', () => {
    test('fall back — 25-hour day (US, 2026-11-01)', () => {
      const oct31 = dayNumber(at(2026, 9, 31))
      assert.equal(dayNumber(at(2026, 10, 1)), oct31 + 1)
      assert.equal(dayNumber(at(2026, 10, 2)), oct31 + 2)
    })

    test('spring forward — 23-hour day (US, 2026-03-08)', () => {
      const mar7 = dayNumber(at(2026, 2, 7))
      assert.equal(dayNumber(at(2026, 2, 8)), mar7 + 1)
      assert.equal(dayNumber(at(2026, 2, 9)), mar7 + 2)
    })

    test('no day is skipped or repeated across a whole year', () => {
      const seen = []
      for (let d = new Date(2026, 6, 16); d < new Date(2027, 6, 16); d.setDate(d.getDate() + 1)) {
        seen.push(dayNumber(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)))
      }
      const expected = seen.map((_, i) => i + 1)
      assert.deepEqual(seen, expected)
    })
  })
})

describe('msUntilNextPuzzle', () => {
  test('always in (0, 25h] — never negative, never lies', () => {
    for (const d of [at(2026, 10, 1, 0), at(2026, 10, 1, 23), at(2026, 2, 8, 3)]) {
      const ms = msUntilNextPuzzle(d)
      assert.ok(ms > 0, `${d} gave ${ms}`)
      assert.ok(ms <= 25 * 3600_000)
    }
  })
})

describe('formatCountdown', () => {
  test('shrinks its shape as it closes in', () => {
    assert.equal(formatCountdown(6 * 3600_000 + 12 * 60_000), '6h 12m')
    assert.equal(formatCountdown(12 * 60_000), '12m')
    assert.equal(formatCountdown(48_000), '48s')
    assert.equal(formatCountdown(0), '0s')
  })

  test('clamps negatives rather than rendering "-1s"', () => {
    assert.equal(formatCountdown(-5000), '0s')
  })
})

// The calendar these all hang off: #1 is Thursday 2026-07-16, so #4, #11, #18…
// are the Sundays and #3, #10, #17… are the Saturdays. FIRST_LONG_DAY (#17) is
// the first day of the five-letter weekend. Every weekend day before it shipped
// as a four-letter puzzle and must stay that way.
describe('weekdayForDay', () => {
  test('#1 is a Thursday, and the week turns from there', () => {
    assert.equal(weekdayForDay(1), 4)
    assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map(weekdayForDay), [5, 6, 0, 1, 2, 3, 4])
  })

  test('agrees with the real calendar for a whole year', () => {
    for (let n = 1; n <= 365; n++) {
      const d = new Date(Date.UTC(2026, 6, 16) + (n - 1) * 86400000)
      assert.equal(weekdayForDay(n), d.getUTCDay(), `#${n} (${d.toISOString().slice(0, 10)})`)
    }
  })

  test('stays in 0..6 for a clock set before the epoch', () => {
    for (const n of [0, -1, -7, -1000]) {
      const w = weekdayForDay(n)
      assert.ok(Number.isInteger(w) && w >= 0 && w <= 6, `n=${n} gave ${w}`)
    }
  })
})

describe('isLongDay / wordLengthForDay', () => {
  test('the already-published weekend days stay four letters', () => {
    // Saturdays #3 and #10, Sundays #4 and #11 — all played and shared as
    // four-letter puzzles before the weekend went long.
    for (const n of [3, 4, 10, 11]) {
      assert.ok([0, 6].includes(weekdayForDay(n)), `#${n} should be a weekend day`)
      assert.equal(isLongDay(n), false, `#${n} was published as four letters`)
      assert.equal(wordLengthForDay(n), 4)
    }
  })

  test('#17 is the first five-letter day, and it is a Saturday', () => {
    assert.equal(FIRST_LONG_DAY, 17)
    assert.equal(weekdayForDay(17), 6)
    assert.equal(isLongDay(17), true)
    assert.equal(wordLengthForDay(17), 5)
    // And the Sunday right after it, so the pair is contiguous.
    assert.equal(weekdayForDay(18), 0)
    assert.equal(isLongDay(18), true)
  })

  test('every weekend day after it is long, and no weekday ever is', () => {
    for (let n = 1; n <= 400; n++) {
      const wd = weekdayForDay(n)
      const weekendFromCutover = (wd === 0 || wd === 6) && n >= FIRST_LONG_DAY
      assert.equal(isLongDay(n), weekendFromCutover, `#${n}`)
      assert.equal(wordLengthForDay(n), weekendFromCutover ? 5 : 4, `#${n}`)
    }
  })
})

describe('streamIndexForDay', () => {
  test('the everyday stream is still indexed by day number', () => {
    // #17 is now a weekend day, so it belongs to the other stream — #16 and #19
    // stand in for the weekday side of the cutover.
    for (const n of [1, 2, 3, 4, 11, 12, 16, 19, 100]) {
      assert.equal(streamIndexForDay(n), n - 1, `#${n}`)
    }
  })

  // This is the regression that matters most: every four-letter day, past and
  // future, must resolve to the same schedule entry it did before the weekend
  // split off. Anything else silently reshuffles days people have already played.
  test('no four-letter day moved when the weekend split off', () => {
    for (let n = 1; n <= 2000; n++) {
      if (!isLongDay(n)) assert.equal(streamIndexForDay(n), n - 1, `#${n} moved`)
    }
  })

  test('the weekend stream counts weekend days in pairs, not weeks', () => {
    assert.equal(streamIndexForDay(17), 0) // Sat
    assert.equal(streamIndexForDay(18), 1) // Sun
    assert.equal(streamIndexForDay(24), 2) // Sat, the following week
    assert.equal(streamIndexForDay(25), 3) // Sun
    assert.equal(streamIndexForDay(31), 4)
  })

  test('every weekend index is a whole number, in order, with no gaps', () => {
    const seen = []
    for (let n = 1; n <= 5000; n++) if (isLongDay(n)) seen.push(streamIndexForDay(n))
    assert.ok(seen.every(Number.isInteger), 'produced a fractional index')
    assert.deepEqual(seen, seen.map((_, i) => i))
  })

  test('Saturdays take even indexes and Sundays odd, so the pattern can alternate', () => {
    // build-schedule.mjs indexes the weekend pattern by parity — if this ever
    // drifted, every Saturday would serve the Sunday puzzle and vice versa.
    for (let n = FIRST_LONG_DAY; n <= 2000; n++) {
      if (!isLongDay(n)) continue
      const even = streamIndexForDay(n) % 2 === 0
      assert.equal(even, weekdayForDay(n) === 6, `#${n}`)
    }
  })
})

describe('puzzleForDay', () => {
  const schedules = {
    4: {
      leaps: 2,
      paths: ['KIND FIND FINE FIVE GIVE', 'WAIT WANT WENT SENT SEND', 'COOL FOOL FOOD GOOD GOLD'],
    },
    5: {
      leaps: 2,
      paths: ['MOVED LOVED LIVED LIKED LIKES', 'THESE THOSE WHOSE WHOLE WHILE'],
    },
  }

  test('day 1 is the first path', () => {
    const p = puzzleForDay(1, schedules)
    assert.equal(p.start, 'KIND')
    assert.equal(p.end, 'GIVE')
    assert.equal(p.par, 4)
    assert.equal(p.leaps, 2)
    assert.deepEqual(p.solution, ['KIND', 'FIND', 'FINE', 'FIVE', 'GIVE'])
  })

  test('wraps past the end instead of returning undefined', () => {
    assert.equal(puzzleForDay(4, schedules).start, 'KIND')
    assert.equal(puzzleForDay(3001, schedules).start, 'KIND')
  })

  test('a clock set before the epoch still returns a puzzle', () => {
    for (const n of [0, -1, -7, -1000]) {
      assert.ok(puzzleForDay(n, schedules).start, `n=${n} produced nothing`)
    }
  })

  test('par is always path length minus one', () => {
    for (let n = 1; n <= 6; n++) {
      const p = puzzleForDay(n, schedules)
      assert.equal(p.par, p.solution.length - 1)
      assert.equal(p.start, p.solution[0])
      assert.equal(p.end, p.solution.at(-1))
    }
  })

  test('draws the weekend from the five-letter stream, Saturday then Sunday', () => {
    assert.equal(puzzleForDay(17, schedules).start, 'MOVED') // Sat, entry 0
    assert.equal(puzzleForDay(18, schedules).start, 'THESE') // Sun, entry 1
    // ...and wraps within its own stream, not the other one.
    assert.equal(puzzleForDay(24, schedules).start, 'MOVED') // Sat, entry 2 -> wraps
  })

  test('every word of a long day really is five letters', () => {
    for (const n of [17, 18]) {
      const p = puzzleForDay(n, schedules)
      assert.equal(p.wordLength, 5, `#${n}`)
      assert.ok(p.solution.every((w) => w.length === 5), `#${n}`)
    }
  })

  test('the published weekend days still come from the four-letter stream', () => {
    // Entry (n-1) of the everyday stream, wrapped — #4 → 3 % 3, #11 → 10 % 3.
    assert.equal(puzzleForDay(4, schedules).start, 'KIND')
    assert.equal(puzzleForDay(11, schedules).start, 'WAIT')
    for (const n of [3, 4, 10, 11]) assert.equal(puzzleForDay(n, schedules).wordLength, 4)
  })

  test('names the missing stream rather than dying on undefined', () => {
    assert.throws(() => puzzleForDay(17, { 4: schedules[4] }), /5-letter schedule/)
  })
})
