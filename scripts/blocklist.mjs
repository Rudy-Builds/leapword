// Words a PUZZLE may not use. Build-time only — never shipped to the client.
//
// The gate is deliberately narrow, and the narrowness is load-bearing:
//
//   start / end   — BLOCKED. These are public. They sit in the header before you
//                   play, in the share text, and in anything screenshotted into a
//                   group chat. "LOVE → SHIT" is the disaster case.
//   leap options  — BLOCKED, as both key and target. A leap button is the game
//                   putting a word in your mouth; it should never offer one of
//                   these. (Today it ships TOOL→DICK, BLUE→SEXY, BULL→CRAP.)
//   interiors     — ALLOWED. Passing through a rude word on your own ladder is
//                   private, mildly funny, and nobody's business but yours.
//   typing        — ALLOWED, always. This list never touches the validity tier.
//
// Why interiors and typing stay free: `validWords` is the tier par is measured
// on. Filtering it would change distValid, inflate measured par, and silently
// break the "par is a true optimum" guarantee puzzle.js promises. Filtering
// `commonWords` (the routing tier) would drag interiors down with it for no
// gain. Gating only the start/end selection costs us ~44 of ~1139 common words
// and leaves the pool essentially untouched.
//
// This is a denylist, and denylists leak. Review new scheduled entries.
//
// Covers BOTH shipped lengths. Sundays are five letters (see src/game/daily.js),
// and a list that only knew about four silently gated nothing on the day the
// puzzle is longest. That was not hypothetical: BITCH ranks 614, well inside the
// common tier that start/end words are drawn from, and Datamuse was live-offering
// FUNNY→QUEER, KITTY→PUSSY, CHICK→WENCH and FAIRY→QUEER as leap buttons.

// Hate slurs. The four-letter ones are all rarer than the common-tier cutoff, so
// none can reach a start/end slot — they're here for the synonym gate and so the
// list stays correct if the cutoff ever moves. GYPSY and NAZIS are the
// exceptions: both are common enough to be scheduled, and both are the plural of
// something already blocked at four.
const SLURS = `
  KIKE SPIC COON GOOK WOPS FAGS DYKE DAGO MICK ABOS GYPS POMS WOGS HUNS
  NAZI JEWS HOMO JISM
  KIKES SPICS COONS GOOKS DAGOS MICKS HONKY CHINK DYKES FAGGY FAGOT HOMOS
  JEWED POMMY GOYIM NAZIS GYPSY QUEER POOVE
`

// Profanity and scatology. SHIT(96) and FUCK(106) are among the 110 most common
// four-letter words in English, which is exactly why no frequency floor can
// filter them and only an explicit list will do. BITCH(614) is the five-letter
// case that proves the same point: it is comfortably common enough to be picked
// as a start or an end word, so "BITCH → ..." sits in the header and the share
// card until this list says otherwise.
//
// ASSES is donkeys and nothing else, but it is not read that way on a card.
const PROFANITY = `
  FUCK SHIT CUNT PISS TWAT ARSE CRAP TURD POOP FART PUKE SNOT BARF
  FUCKS SHITS CUNTS TWATS ARSES CRAPS TURDS POOPS FARTS PUKES BARFS SNOTS
  BITCH ASSES
`

// Sexual. BOOB and SHAG have innocent senses (a fool; a rug) but read as the
// other thing on a card someone screenshots.
const SEXUAL = `
  DICK COCK TITS SLUT ANUS ORGY BOOB SHAG PORN HUMP
  DICKS COCKS TITTY BOOBS SLUTS PORNO HUMPS SHAGS BONER VULVA SEMEN SPERM
  PUBES PENIS PUSSY WHORE HORNY PRICK FANNY NOOKY
`

// Contemptuous terms for a woman. Not profane, not slurs against a protected
// class, so they'd survive every other category — but they only ever reach a
// player as a leap button, and "the game putting a word in your mouth" is the
// exact thing the leap gate exists for. Datamuse offers both as synonyms of
// CHICK.
//
// SKIRT is the one that got away, and is deliberately NOT here: it shows up in
// the same CHICK entry, but it is also the correct synonym in DODGE→SKIRT and
// EVADE→SKIRT (to skirt an issue). The bad thing is the pairing, not the word,
// and this list only knows how to block words. Blocking it would delete two good
// leaps to fix one weak one.
const DEROGATORY = `
  WENCH BIDDY
`

// Sexual violence. Categorically different from the ordinary violence words
// below — there is no innocent reading.
const VIOLENCE = `
  RAPE RAPES RAPED RAPER
`

// Hard drugs only. WEED, COKE, PILL, JUNK and HIGH are deliberately absent:
// a weed is a plant, a coke is a soft drink, and blocking them would delete
// good puzzles to solve nothing.
const DRUGS = `
  METH DOPE METHS DOPES JUNKY
`

// Deliberately NOT blocked, so nobody "fixes" this later:
//
//   KILL(79) DEAD(83) DIED(160) DIES(452) SHOT(154) HANG(196) STAB(721)
//   BOMB(322) GUNS(328) AMMO(1013) MAIM GORE SLAY
//     Ordinary English. LIVE → DEAD is a genuinely good word ladder and this
//     is a word game, not a content filter.
//
//   HELL(87) DAMN(131) GODS(450)
//     Mild to the point of invisibility.
//
//   SEXY(433) LUST(816) BONE(462) LAID(456) HORN(426)
//     Innuendo at worst. A puzzle answering SEXY is fine.
//
//   JACK(191) BILL(234) MIKE(243) MARK(249) NICK(301) EARL(596) WARD(600)
//   BRAD(572) HART(1003) RAJA(1005) NANCY(3252) RANDY(3309)
//     Read as first names but are all common nouns — a jack lifts a car, a
//     hart is a male deer, a brad is a small nail, a mike is a microphone.
//     Blocking them would remove good puzzles to fix a cosmetic non-problem.
//     NANCY and RANDY carry a second, ruder British sense; the name is the
//     dominant reading and the rude one is defused anyway, because what a leap
//     would have offered for them (QUEER, HORNY) is blocked above.
//
//   BALLS(1626) SCREW(1769) NAKED(1801) SUCKS(2530) BOOTY(7718) BUTTS(8581)
//     The five-letter counterpart of SEXY/LUST/BONE: innuendo at worst, with a
//     dominant innocent sense. Same call, same reason.
//
//   URINE(7063) VOMIT(7404) SWINE(7265) FILTH(7813) TRAMP(7631)
//     Unpleasant, not profane. PUKE and BARF are blocked as slang for the act;
//     these are the clinical or literal words and stay typeable AND schedulable.
//
//   BUTCH(8465) SISSY(9317)
//     Playground taunts rather than slurs against a protected class, and both
//     have ordinary readings (a name; butch as plain adjective). Left in.

export const BLOCKED = new Set(
  [SLURS, PROFANITY, SEXUAL, DEROGATORY, VIOLENCE, DRUGS].join(' ').trim().split(/\s+/),
)

/** Filter a synonym map so no blocked word appears as a key or a target. */
export function cleanSynMap(synMap) {
  const out = {}
  for (const [word, syns] of Object.entries(synMap)) {
    if (BLOCKED.has(word)) continue
    const kept = syns.filter((s) => !BLOCKED.has(s))
    if (kept.length) out[word] = kept // drop keys left with nothing to offer
  }
  return out
}
