// node --test src/game/
import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { decodeChallenge } from './challenge.js'
import { SHARE_URL, buildShareText, buildTileRow, challengeUrl, puzzleUrl } from './share.js'

const KIND_GIVE = ['KIND', 'FIND', 'FINE', 'FIVE', 'GIVE']

// The card minus its sealed challenge code — what a recipient can actually READ
// in a chat. The spoiler tests assert against this: the code is the player's own
// path by design (see challenge.js), not a leak, and base64 can coincidentally
// contain word-shaped substrings.
const readable = (card) => card.replace(/\?c=[A-Za-z0-9_-]+/, '')

describe('buildTileRow', () => {
  test('one tile per move, not per word', () => {
    assert.equal([...buildTileRow(KIND_GIVE)].length, KIND_GIVE.length - 1)
  })

  test('letter-swaps are green', () => {
    assert.equal(buildTileRow(KIND_GIVE), '🟩🟩🟩🟩')
  })

  // Positions, not geometry. A leap now lands on the next rung of the answer,
  // which from the answer is a one-letter move — indistinguishable in the path
  // from a typed one, which is exactly how every purple tile went missing.
  test('a leapt-to step is purple', () => {
    assert.equal(buildTileRow(['KIND', 'FIND', 'SEEK', 'SEEM'], [2]), '🟩🟪🟩')
  })

  test('a one-letter step is still purple when it was leapt to', () => {
    assert.equal(buildTileRow(['KIND', 'FIND', 'FINE', 'FIVE'], [2]), '🟩🟪🟩')
  })

  test('a multi-letter step is green when it was not', () => {
    // Geometry alone would have called this a leap. Only the record decides.
    assert.equal(buildTileRow(['KIND', 'NICE', 'GOOD'], []), '🟩🟩')
  })

  test('all-leap path', () => {
    assert.equal(buildTileRow(['KIND', 'NICE', 'GOOD'], [1, 2]), '🟪🟪')
  })

  test('no moves yet', () => {
    assert.equal(buildTileRow(['KIND']), '')
  })
})

describe('buildShareText', () => {
  const base = { number: 42, start: 'KIND', end: 'GIVE', par: 4, path: KIND_GIVE }

  test('3 stars, par, no leaps', () => {
    assert.equal(
      buildShareText({ ...base, stars: 3, status: 'won' }),
      `Leapword #42 ⭐⭐⭐\nKIND → GIVE in 4 · par 4\n🟩🟩🟩🟩\n${challengeUrl(42, KIND_GIVE)}`,
    )
  })

  test('2 stars, one over par with a leap', () => {
    const path = ['KIND', 'FIND', 'FINE', 'MINE', 'GIVE', 'GIVE']
    const leapSteps = [4, 5]
    assert.equal(
      buildShareText({ ...base, stars: 2, status: 'won', path, leapSteps }),
      `Leapword #42 ⭐⭐\nKIND → GIVE in 5 · par 4\n🟩🟩🟩🟪🟪\n${challengeUrl(42, path, leapSteps)}`,
    )
  })

  test('1 star', () => {
    assert.match(buildShareText({ ...base, stars: 1, status: 'won' }), /^Leapword #42 ⭐\n/)
  })

  test('a loss prints no score and closes the row in red', () => {
    const out = buildShareText({ ...base, stars: 0, status: 'lost' })
    assert.equal(out, `Leapword #42\nKIND → GIVE · par 4\n🟩🟩🟩🟩🟥\n${SHARE_URL}/42`)
    assert.doesNotMatch(out, /in \d/)
    assert.doesNotMatch(out, /⭐/)
    // Hollow stars are gone entirely — they read as a rating, not an absence.
    assert.doesNotMatch(out, /☆/)
    // And no trailing space on line 1 now that the score can be empty.
    assert.equal(out.split('\n')[0], 'Leapword #42')
  })

  test('a win never gets the red tile', () => {
    assert.doesNotMatch(buildShareText({ ...base, stars: 3, status: 'won' }), /🟥/)
  })

  test('always four lines, always ends with the puzzle link', () => {
    for (const status of ['won', 'lost']) {
      const lines = buildShareText({ ...base, stars: 2, status }).split('\n')
      assert.equal(lines.length, 4)
      assert.ok(lines[3].startsWith(`${SHARE_URL}/42`), lines[3])
    }
  })

  test('a win links as a challenge; a loss links plain — no move count to beat', () => {
    const won = buildShareText({ ...base, stars: 3, status: 'won' }).split('\n')[3]
    assert.equal(won, challengeUrl(42, KIND_GIVE))
    assert.match(won, /\?c=[A-Za-z0-9_-]+$/)

    const lost = buildShareText({ ...base, stars: 0, status: 'lost' }).split('\n')[3]
    assert.equal(lost, puzzleUrl(42))
    assert.doesNotMatch(lost, /\?c=/)
  })

  test('the challenge code round-trips to the very path that was shared', () => {
    const out = buildShareText({ ...base, stars: 3, status: 'won' })
    const code = /\?c=([A-Za-z0-9_-]+)/.exec(out)[1]
    const decoded = decodeChallenge(code, {
      puzzle: { start: 'KIND', end: 'GIVE', par: 4, leaps: 2 },
      dictSet: new Set(KIND_GIVE),
    })
    assert.deepEqual(decoded?.path, KIND_GIVE)
  })

  test('the link points at the shared puzzle, not the homepage', () => {
    const out = buildShareText({ ...base, number: 137, stars: 3, status: 'won' })
    assert.ok(out.split('\n')[3].startsWith(`${SHARE_URL}/137?c=`))
  })

  test('a win rides the streak on line 1, still four lines', () => {
    const out = buildShareText({ ...base, stars: 3, status: 'won', streak: 5 })
    assert.equal(out.split('\n')[0], 'Leapword #42 ⭐⭐⭐ · 🔥5')
    assert.equal(out.split('\n').length, 4)
  })

  test('a loss never brags a streak, even if one is passed', () => {
    assert.doesNotMatch(
      buildShareText({ ...base, stars: 0, status: 'lost', streak: 9 }),
      /🔥/,
    )
  })

  test('a zero or absent streak is omitted, leaving the card unchanged', () => {
    assert.doesNotMatch(buildShareText({ ...base, stars: 2, status: 'won', streak: 0 }), /🔥/)
    assert.doesNotMatch(buildShareText({ ...base, stars: 2, status: 'won' }), /🔥/)
  })
})

describe('spoiler guard', () => {
  // The structural guarantee is that buildShareText has no `solution` parameter.
  // This asserts the consequence: nothing a player didn't already walk can leak.
  test('never leaks an interior word the player did not visit', () => {
    const solution = ['STOP', 'SHOP', 'SHIP', 'SHIT', 'SUIT', 'QUIT']
    const playerPath = ['STOP', 'SLOP', 'SLIP', 'SLIT', 'SUIT', 'QUIT']

    const out = readable(
      buildShareText({
        number: 12,
        start: 'STOP',
        end: 'QUIT',
        par: 5,
        path: playerPath,
        stars: 3,
        status: 'won',
      }),
    )

    for (const word of solution.slice(1, -1)) {
      if (playerPath.includes(word)) continue
      assert.ok(!out.includes(word), `leaked par-line word ${word}`)
    }
    assert.ok(!out.includes('SHIT'))
  })

  test('does not print the player’s own interiors either — only tiles and the sealed code', () => {
    const out = buildShareText({
      number: 1,
      start: 'KIND',
      end: 'GIVE',
      par: 4,
      path: KIND_GIVE,
      stars: 3,
      status: 'won',
    })
    for (const interior of KIND_GIVE.slice(1, -1)) {
      assert.ok(!readable(out).includes(interior), `leaked own interior ${interior}`)
    }
  })
})
