// Tests the SHIPPED schedules, not a fixture.
//
// public/schedule/*.json are committed artifacts that a script regenerates, and
// the failure they invite is silent: a schedule that parses fine but is indexed
// differently than the app assumes serves real puzzles on the wrong days, and
// nothing throws. Boot re-checks the headline fields at runtime; this checks
// them in CI, before anyone deploys, along with the things Boot can't afford to
// verify on every load — that all 900 Sunday paths are genuine word ladders
// whose every word is typeable.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, describe } from 'node:test'
import { EPOCH_ISO, FIRST_LONG_DAY, LONG_LEN, SHORT_LEN, isLongDay } from './daily.js'
import { isOneLetterDiff } from './rules.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const load = async (rel) => JSON.parse(await readFile(resolve(ROOT, rel), 'utf8'))

const schedules = {
  [SHORT_LEN]: await load(`public/schedule/${SHORT_LEN}.json`),
  [LONG_LEN]: await load(`public/schedule/${LONG_LEN}.json`),
}

describe('shipped schedules', () => {
  for (const len of [SHORT_LEN, LONG_LEN]) {
    describe(`${len}.json`, () => {
      const schedule = schedules[len]

      test('declares the length and epoch the app expects', () => {
        assert.equal(schedule.wordLength, len)
        assert.equal(schedule.epoch, EPOCH_ISO)
        assert.ok(schedule.paths.length > 0)
      })

      test('every path is a real ladder of same-length words', async () => {
        const dict = new Set(await load(`public/dict/${len}.json`))
        for (const [i, line] of schedule.paths.entries()) {
          const path = line.split(' ')
          const where = `${len}.json entry ${i}: ${line}`
          assert.ok(path.length >= 2, where)
          assert.ok(
            path.every((w) => w.length === len && dict.has(w)),
            `${where} — has a word that is the wrong length or not typeable`,
          )
          assert.equal(new Set(path).size, path.length, `${where} — repeats a word`)
          for (let j = 1; j < path.length; j++) {
            assert.ok(isOneLetterDiff(path[j - 1], path[j]), `${where} — ${path[j - 1]}→${path[j]}`)
          }
        }
      })

      test('no puzzle is scheduled twice', () => {
        const seen = new Set()
        for (const line of schedule.paths) {
          const p = line.split(' ')
          const key = [p[0], p.at(-1)].sort().join('-')
          assert.ok(!seen.has(key), `${key} is scheduled more than once in ${len}.json`)
          seen.add(key)
        }
      })
    })
  }

  test('the everyday stream is a daily stream', () => {
    assert.equal(schedules[SHORT_LEN].cadence, 'daily')
    assert.equal(schedules[SHORT_LEN].firstDay, 1)
  })

  // The schedules are public and spoil the game outright, so each one opens
  // with a note asking whoever found it not to ruin it for everyone. Its being
  // FIRST is the whole point — that's what makes it the first thing anyone
  // sees — and a key that only matters for its position is exactly the kind
  // that a later edit reorders without noticing.
  test('each schedule opens with the note to whoever found it', () => {
    for (const len of [SHORT_LEN, LONG_LEN]) {
      const keys = Object.keys(schedules[len])
      assert.equal(keys[0], 'READ_THIS_FIRST', `${len}.json buries the note at index ${keys.indexOf('READ_THIS_FIRST')}`)
      const text = schedules[len].READ_THIS_FIRST.join(' ')
      assert.match(text, /github\.com\/Rudy-Builds\/leapword/, `${len}.json note lost the repo link`)
      assert.ok(text.length > 200, `${len}.json note looks truncated`)
    }
  })

  test('the Sunday stream declares its cadence and start day', () => {
    assert.equal(schedules[LONG_LEN].cadence, 'sunday')
    assert.equal(schedules[LONG_LEN].firstDay, FIRST_LONG_DAY)
  })

  test('the Sunday stream outlives the everyday one', () => {
    // Otherwise Sundays start wrapping to repeats while weekdays are still fresh.
    const lastDay = FIRST_LONG_DAY + (schedules[LONG_LEN].paths.length - 1) * 7
    assert.ok(
      lastDay >= schedules[SHORT_LEN].paths.length,
      `Sundays run out at #${lastDay}, weekdays at #${schedules[SHORT_LEN].paths.length}`,
    )
  })

  test('every start and end word the game will ever show is clean', async () => {
    // The blocklist is build-time only and never shipped, so import it from
    // scripts/ — this is the assertion it exists for. Interiors are deliberately
    // exempt (see blocklist.mjs); only the public words are checked.
    const { BLOCKED } = await import('../../scripts/blocklist.mjs')
    for (const len of [SHORT_LEN, LONG_LEN]) {
      for (const [i, line] of schedules[len].paths.entries()) {
        const p = line.split(' ')
        for (const w of [p[0], p.at(-1)]) {
          assert.ok(!BLOCKED.has(w), `${len}.json entry ${i} shows ${w} publicly`)
        }
      }
    }
  })

  test('no leap the game offers is a blocked word', async () => {
    // A leap now hands over the next word of the ANSWER (src/game/leap.js), so
    // interiors stopped being private to your own ladder — the game says them
    // out loud. That makes this the strict version of the test above: every
    // word of every path, not just the two public ones.
    //
    // Days #1-16 were published under the old synonym leap and are frozen by
    // the append-only rule, so they are exempt; #12 routes through one.
    const { BLOCKED } = await import('../../scripts/blocklist.mjs')
    const PUBLISHED_UNDER_OLD_LEAP = 16
    for (const len of [SHORT_LEN, LONG_LEN]) {
      for (const [i, line] of schedules[len].paths.entries()) {
        if (len === SHORT_LEN && i < PUBLISHED_UNDER_OLD_LEAP) continue
        for (const w of line.split(' ')) {
          assert.ok(!BLOCKED.has(w), `${len}.json entry ${i} would let a leap offer ${w}`)
        }
      }
    }
  })

  // A spot-check that the wiring adds up end to end: the day the feature goes
  // live must produce a five-letter puzzle, and the Sunday before it must not.
  test('#18 is five letters and #11 is still four', () => {
    assert.equal(isLongDay(18), true)
    assert.equal(schedules[LONG_LEN].paths[0].split(' ')[0].length, 5)
    assert.equal(isLongDay(11), false)
    assert.equal(schedules[SHORT_LEN].paths[10].split(' ')[0].length, 4)
  })
})
