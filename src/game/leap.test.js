import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nextRung } from './leap.js'

const SOL = ['FISH', 'WISH', 'WISE', 'RISE', 'ROSE', 'ROLE', 'ROLL']

describe('nextRung', () => {
  test('on the answer, it hands you the next rung', () => {
    assert.equal(nextRung(SOL, ['FISH']), 'WISH')
    assert.equal(nextRung(SOL, ['FISH', 'WISH']), 'WISE')
    assert.equal(nextRung(SOL, ['FISH', 'WISH', 'WISE', 'RISE']), 'ROSE')
  })

  test('off the answer, it puts you back on at the rung after your furthest', () => {
    // WASH is a wrong turn and not on the answer at all, so it has no bearing on
    // the target — the furthest rung reached is still WISH.
    assert.equal(nextRung(SOL, ['FISH', 'WISH', 'WASH']), 'WISE')
  })

  test('it never goes backwards, however scrambled the route in', () => {
    // Reached ROSE without ever playing WISH, WISE or RISE. "Earliest unused"
    // would send them to WISH — rung 1, from rung 4. This is the case that rule
    // got wrong.
    assert.equal(nextRung(SOL, ['FISH', 'DISH', 'DOSE', 'ROSE']), 'ROLE')
  })

  test('it is unavailable when the only rung left is the end word', () => {
    assert.equal(nextRung(SOL, ['FISH', 'WISH', 'WISE', 'RISE', 'ROSE', 'ROLE']), null)
    // Same when ROLE was reached off-path: the guard is about the target, not
    // about how tidily you got there.
    assert.equal(nextRung(SOL, ['FISH', 'MOLE', 'ROLE']), null)
  })

  test('the target is always a word the player has not used', () => {
    // The property the whole rule rests on: nothing past the furthest rung can
    // already be in the path, so a leap can never collide with the no-repeats
    // rule and can never strand anyone.
    const paths = [
      ['FISH'],
      ['FISH', 'WISH', 'WASH'],
      ['FISH', 'WISH', 'WISE'],
      ['FISH', 'DISH', 'DOSE', 'ROSE'],
    ]
    for (const path of paths) {
      const target = nextRung(SOL, path)
      assert.ok(target, `expected a leap for ${path.join(' ')}`)
      assert.ok(!path.includes(target), `${target} was already used`)
      // And the rest of the answer after it is untouched, so a route home exists.
      const rest = SOL.slice(SOL.indexOf(target))
      for (const w of rest) assert.ok(!path.includes(w), `${w} was already used`)
    }
  })

  test('a two-rung answer offers no leap at all — every rung is the end', () => {
    assert.equal(nextRung(['COLD', 'CORD'], ['COLD']), null)
  })
})
