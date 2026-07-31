// node --test src/game/
import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { compareToChallenge, decodeChallenge, encodeChallenge } from './challenge.js'

const KIND_GIVE = ['KIND', 'FIND', 'FINE', 'FIVE', 'GIVE']
const PUZZLE = { start: 'KIND', end: 'GIVE', par: 4, leaps: 2 }
const DICT = new Set(['KIND', 'FIND', 'FINE', 'FIVE', 'GIVE', 'NICE', 'GOOD', 'MIND'])
const ctx = { puzzle: PUZZLE, dictSet: DICT }

describe('encodeChallenge', () => {
  test('emits only URL-safe characters — the code rides a query string raw', () => {
    for (const path of [KIND_GIVE, ['KIND', 'NICE', 'GIVE'], ['KIND', 'MIND', 'FIND', 'FINE', 'FIVE', 'GIVE']]) {
      assert.match(encodeChallenge(path), /^[A-Za-z0-9_-]+$/)
    }
  })

  test('drops START and strips padding — the recipient’s puzzle already knows where it begins', () => {
    // The leading 0 is the leap count; see encodeChallenge.
    const expected = btoa('0FINDFINEFIVEGIVE')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    assert.equal(encodeChallenge(KIND_GIVE, []), expected)
    assert.ok(!encodeChallenge(KIND_GIVE, []).includes('='))
  })
})

describe('decodeChallenge', () => {
  test('round-trips a clean par run, deriving steps, leaps and stars', () => {
    const c = decodeChallenge(encodeChallenge(KIND_GIVE), ctx)
    assert.deepEqual(c, { path: KIND_GIVE, steps: 4, leapsUsed: 0, leapSteps: [], stars: 3 })
  })

  test('a leap — a step that is not a one-letter change — is re-derived, and costs a star', () => {
    // FIND -> FIVE changes two letters: a leap. 3 steps beats par, minus one leap = 2★.
    const c = decodeChallenge(encodeChallenge(['KIND', 'FIND', 'FIVE', 'GIVE'], [2]), ctx)
    assert.deepEqual(c, { path: ['KIND', 'FIND', 'FIVE', 'GIVE'], steps: 3, leapsUsed: 1, leapSteps: [2], stars: 2 })
  })

  test('junk codes degrade to null, never throw', () => {
    for (const code of ['', 'not!!base64', '%%%', null, undefined, 42]) {
      assert.equal(decodeChallenge(code, ctx), null, `code ${String(code)}`)
    }
  })

  test('decoded text must be A–Z in whole words of the puzzle’s length', () => {
    assert.equal(decodeChallenge(btoa('ABC'), ctx), null) // 3 letters into a 4-letter puzzle
    assert.equal(decodeChallenge(btoa('kindfindfinefivegive'.slice(4)), ctx), null) // lowercase
  })

  test('a ladder that does not end at END is not a challenge for this puzzle', () => {
    assert.equal(decodeChallenge(encodeChallenge(['KIND', 'FIND', 'FINE', 'FIVE']), ctx), null)
  })

  test('repeated words are rejected — same rule the live game enforces', () => {
    assert.equal(
      decodeChallenge(encodeChallenge(['KIND', 'FIND', 'KIND', 'FIND', 'FINE', 'FIVE', 'GIVE']), ctx),
      null,
    )
  })

  test('words outside the dictionary are rejected', () => {
    assert.equal(decodeChallenge(encodeChallenge(['KIND', 'ZIND', 'GIVE']), ctx), null)
  })

  test('more leaps than the puzzle grants is a forgery, not a run', () => {
    // Three non-adjacent jumps against leaps: 2. Declared honestly and still a
    // forgery — the count can't exceed what the puzzle hands out.
    assert.equal(decodeChallenge(encodeChallenge(['KIND', 'NICE', 'GOOD', 'GIVE'], [1, 2, 3]), ctx), null)
  })

  test('a run past the move cap could not have happened — the board locks first', () => {
    // Fabricated one-letter chain: cap is par+4 = 8, this walks 9.
    const words = ['AAAB', 'AAAC', 'AAAD', 'AAAE', 'AAAF', 'AAAG', 'AAAH', 'AAAJ', 'AAAI']
    const fake = {
      puzzle: { start: 'AAAA', end: 'AAAI', par: 4, leaps: 2 },
      dictSet: new Set(['AAAA', ...words]),
    }
    assert.equal(decodeChallenge(encodeChallenge(['AAAA', ...words]), fake), null)
    // The same chain minus one interior step fits the cap and decodes fine.
    const inCap = ['AAAA', ...words.filter((w) => w !== 'AAAJ')]
    assert.equal(decodeChallenge(encodeChallenge(inCap), fake)?.steps, 8)
  })
})

describe('compareToChallenge', () => {
  const friend = { path: KIND_GIVE, steps: 4, leapsUsed: 0, stars: 3 }

  test('stars decide first', () => {
    assert.equal(compareToChallenge({ status: 'won', stars: 3, steps: 4, leapsUsed: 0 }, { ...friend, stars: 2 }), 'won')
    assert.equal(compareToChallenge({ status: 'won', stars: 1, steps: 4, leapsUsed: 0 }, friend), 'lost')
  })

  test('a star tie falls to fewer steps', () => {
    assert.equal(compareToChallenge({ status: 'won', stars: 2, steps: 4, leapsUsed: 1 }, { ...friend, stars: 2, steps: 5 }), 'won')
  })

  test('a step tie falls to fewer leaps — unaided edges out assisted', () => {
    assert.equal(compareToChallenge({ status: 'won', stars: 2, steps: 5, leapsUsed: 0 }, { ...friend, stars: 2, steps: 5, leapsUsed: 1 }), 'won')
  })

  test('identical results are a tie', () => {
    assert.equal(compareToChallenge({ status: 'won', stars: 3, steps: 4, leapsUsed: 0 }, friend), 'tied')
  })

  test('not solving is a loss — the friend’s side is always a solve', () => {
    assert.equal(compareToChallenge({ status: 'lost', stars: 0, steps: 8, leapsUsed: 0 }, friend), 'lost')
  })
})

describe('leap counts survive the round trip', () => {
  const ctx = {
    puzzle: { start: 'HELP', end: 'WALK', par: 4, leaps: 2 },
    dictSet: new Set(['HELP', 'HELL', 'WELL', 'WALL', 'WALK', 'HELD']),
  }
  const PATH = ['HELP', 'HELL', 'WELL', 'WALL', 'WALK']

  test('an on-path leap is invisible in the path, so the count rides along', () => {
    // Every step here is a one-letter swap, so nothing about the words reveals
    // that two of them were leaps. Before the count was carried, this decoded
    // as a spotless 3 ★.
    const got = decodeChallenge(encodeChallenge(PATH, [1, 2]), ctx)
    assert.equal(got.leapsUsed, 2)
    assert.equal(got.stars, 1)
  })

  test('a clean run still reads clean', () => {
    const got = decodeChallenge(encodeChallenge(PATH, []), ctx)
    assert.equal(got.leapsUsed, 0)
    assert.equal(got.stars, 3)
  })

  test('codes minted before the count existed still decode', () => {
    // Old format: no leading digit, count inferred from non-adjacent steps.
    const legacy = btoa(PATH.slice(1).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const got = decodeChallenge(legacy, ctx)
    assert.equal(got.leapsUsed, 0)
    assert.equal(got.steps, 4)
  })

  test('claiming fewer leaps than the path proves is rejected', () => {
    // HELP → WELL is a two-letter jump: it can only have been a leap, so a
    // declared count of 0 is a lie in the direction that flatters the sharer.
    const forged = ['HELP', 'WELL', 'WALL', 'WALK']
    assert.equal(decodeChallenge(encodeChallenge(forged, []), ctx), null)
    assert.equal(decodeChallenge(encodeChallenge(forged, [1]), ctx)?.leapsUsed, 1)
  })

  test('claiming more leaps than the puzzle grants is rejected', () => {
    assert.equal(decodeChallenge(encodeChallenge(PATH, [1, 2, 3]), ctx), null)
  })
})
