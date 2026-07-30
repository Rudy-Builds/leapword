// Offline asset builder for Leapword.
//
// Produces:
//   public/dict/<len>.json  — the VALIDITY list: every word you're allowed to type
//
// It used to also produce public/syn/<len>.json, a Datamuse rel_syn sweep over
// every valid word, to feed the leap menu. A leap now walks the answer instead
// (src/game/leap.js), so the map, the sweep and the ~56KB it shipped are all
// gone — this script is one fetch and one write again.
//
// Vocabulary tiers and their sources are documented in scripts/lib/words.mjs.
// No external deps — Node 18+ global fetch.
//
// Usage: node scripts/build-assets.mjs 4

import { loadVocab, write } from './lib/words.mjs'

const WORD_LEN = Number(process.argv[2]) || 4
if (WORD_LEN < 3 || WORD_LEN > 6) throw new Error(`unsupported word length: ${WORD_LEN}`)

console.log(`building ${WORD_LEN}-letter assets`)

const { validWords } = await loadVocab(WORD_LEN)

// Never filtered by the blocklist: this is the tier par is measured on, and the
// tier the player may type from. If it's a real word, it counts.
await write(`public/dict/${WORD_LEN}.json`, validWords)
