import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeStars } from './rules.js'

// computeStars knows nothing about the move cap — it scores whatever step count
// it is handed, and the caller decides whether the run ended solved. These pin
// the bands, the per-leap penalty, and the 1 ★ floor on any finish.
describe('computeStars', () => {
  const run = (over) => (extra = {}) =>
    computeStars({ steps: 6 + over, par: 6, leapsUsed: 0, solved: true, ...extra })

  it('par with no leaps is three stars', () => {
    assert.equal(run(0)(), 3)
  })

  it('one over par is two stars', () => {
    assert.equal(run(1)(), 2)
  })

  it('each leap costs a star', () => {
    assert.equal(run(0)({ leapsUsed: 1 }), 2)
    assert.equal(run(0)({ leapsUsed: 2 }), 1)
  })

  it('a finished run never falls below one star, however many leaps', () => {
    assert.equal(run(0)({ leapsUsed: 5 }), 1)
    assert.equal(run(3)({ leapsUsed: 2 }), 1)
  })

  it('every band past par+1 is one star', () => {
    for (const steps of [8, 9, 10]) {
      assert.equal(computeStars({ steps, par: 6, leapsUsed: 0, solved: true }), 1)
    }
  })

  // Both unsolved endings route through this: running the cap out, and giving
  // up with moves still on the clock.
  it('an unsolved run scores zero however it ended', () => {
    assert.equal(computeStars({ steps: 4, par: 6, leapsUsed: 0, solved: false }), 0)
    assert.equal(computeStars({ steps: 10, par: 6, leapsUsed: 2, solved: false }), 0)
  })

  it('beating par scores a clean three rather than dropping a band', () => {
    assert.equal(computeStars({ steps: 4, par: 6, leapsUsed: 0, solved: true }), 3)
  })
})
