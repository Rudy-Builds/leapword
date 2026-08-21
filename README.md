<div align="center">

<a href="https://leapword.app">
  <img src="public/og.png" alt="Leapword — daily word ladder. KIND · FIND · FINE · FIVE · GIVE" width="600" />
</a>

# Leapword

**A daily word ladder. Climb from one word to another, one letter at a time.**

[**▶ Play today's puzzle →**](https://leapword.app)

[![Play](https://img.shields.io/badge/play-leapword.app-6ea8fe?style=flat-square)](https://leapword.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-57cc8a?style=flat-square)](LICENSE)
[![No backend](https://img.shields.io/badge/backend-none%2C%20fully%20static-b98cff?style=flat-square)](#-for-the-curious-how-its-wired)

</div>

---

## 🪜 How to play

You get a **START** word and an **END** word of the same length, plus **par** — the fewest moves it takes.

```
COLD → CORD → CARD → WARD → WARM
```

The rules fit on a napkin:

- **Change exactly one letter** each move, landing on a real word.
- **No repeats** — you can't reuse a word already on your ladder.
- **Reach END** within **par + 4** moves, or the puzzle locks as unsolved.
- **Stuck?** Spend a **leap** ⤳ and the game walks you one word further along the answer than you have ever been. **Two per puzzle**, and each costs a move *and* a star. It never hands over the last word — the win is always yours to type.
- **Properly stuck?** ☠️ ends the run. It exists because a ladder can dead-end on a word with no legal neighbour, and the move cap only counts moves that land. Giving up doesn't show you the answer; only the board beating you earns the par line.
- **Weekends are five letters**, weekdays four. Difficulty climbs Monday → Friday — par 5 on Monday up to par 7 by Friday — and Saturday resets to easy before Sunday, the longest ladder the game builds.

Then you get a Wordle-style card to share — no spoilers, just your path:

```
Leapword #12 ⭐⭐ · 🔥7
MORE → GIVE in 4 · par 4
🟩🟪🟩🟩
https://leapword.app/12?c=MTJNT1ZFTE9WRUxJVkVHSVZF
```

🟩 a letter swap · 🟪 a leap · 🟥 the run stopping short · ⭐ your stars for the day.

That link is a **dare, not a boast**: a winning card carries your ladder *sealed* in the URL. Whoever opens it sees your numbers before they play, and your actual words only once their own run has ended.

### ⭐ Stars

| You did… | Stars |
|---|---|
| Par, no leaps | ⭐⭐⭐ |
| One over par, or par with one leap | ⭐⭐ |
| Solved it at all | ⭐ |
| Ran out of moves, or gave up | none — the card prints no score, and the streak breaks |

**One puzzle a day**, the same for everyone, resetting at your local midnight — with a countdown to the next one and an archive of every puzzle so far. Keep a streak going. 🔥

---

## 🔍 For the curious: how it's wired

Leapword is a small, deliberately-built React app, and the code is meant to be read. If you like puzzles about *making* puzzles, there's a fair bit to enjoy here — most of it in service of one stubborn constraint:

> **Puzzle #42 has to mean the same thing forever.** Someone shared their score for it.

That single promise shapes a surprising amount of the design:

- **The whole game is static — no backend.** The client ships a word list and a one-letter-diff check; that's all it needs to referee a move. No ladder graph, no BFS, no server round-trip to play a move.
- **A leap is a rung, not a synonym — and the data is why.** Leaps used to jump you to a synonym of your current word, chosen by *meaning*, when what a stuck player needs is chosen by *position*. Measured over a year of schedule: a synonym leap moved you **further from the target 74% of the time**, offered nothing at all on 532 answer-path words, and in 12 cases dropped you somewhere END couldn't be reached from at all. Your scarce resource usually made things worse. Now a leap puts you on the rung after the furthest you've reached — which provably can't strand you and can't send you backwards. ([`src/game/leap.js`](src/game/leap.js) carries the proof.)
- **That means the answer ships to the client, and the repo says so rather than pretending otherwise.** A leap walks the solution and a loss reveals the par line, so the schedule is in the browser; [`public/schedule/4.json`](public/schedule/4.json) therefore opens with a note to whoever goes looking. Serving one day at a time from a Worker is the open piece of work here.
- **The leak that actually travels is closed structurally, not politely.** [`src/game/share.js`](src/game/share.js) has no parameter for the solution — it *can't* print the par line, because the answer isn't in scope. The function signature is the guarantee; a `// don't leak this` comment would not be. The challenge code in a winning URL is sealed the same way: derived numbers before you play, words only after. ([`src/game/challenge.js`](src/game/challenge.js))
- **The blocklist went from taste to load-bearing when leaps changed.** Blocked words were always fine as *interiors* — private to your own ladder, and banning them cost par its optimality. But a leap now puts an interior word in the player's mouth, which is the exact thing the blocklist exists to prevent. Interiors are gated too now; 197 future four-letter days and 54 weekend days had been routing through one.
- **The daily schedule is a committed artifact, not a build output.** 6000 weekday puzzles and 1768 weekend ones live in the repo — about two decades of play. The generator is *append-only* by default and refuses to rewrite history without an explicit `--rebuild --force`, because rewriting day 42 would betray everyone who already played it.
- **"Append-only" left no way to change the game.** `--extend` only appends, so once the file holds its full 6000 days it is a no-op — editing the difficulty ramp under it changed *nothing at all*, silently. `--rebuild` redraws every day, including ones people have played and shared. Between them they could express "more of the same" and "betray everyone", and nothing else. `--revise-from 40` is the missing shape: entries serving days before #40 are copied through untouched, everything after is redrawn with the current pattern, and the boundary is checked against the calendar — puzzles roll over at *local* midnight, so three day numbers are live at any instant and the floor is UTC today + 2. History stayed immutable; it just stopped being defined as "the end of the file". A test pins the frozen prefix so CI catches a reach-back even if the clock lies.
- **Difficulty is `(par, detour)`, not par alone.** `detour` is how many moves *beyond* the letters that differ between START and END the dictionary forces on you. At detour 0, "make it look more like the target" solves the puzzle with no lookahead — which makes a detour-0 day not an easy puzzle so much as an absent one. The week used to open on one. It now runs **5·1 → 5·2 → 6·2 → 6·3 → 7·3**: every weekday moved up a tier, no weekday is detour 0, and none is par 4 either. Friday needed a par ceiling of 7 to have anywhere to stand.
- **The week can only be as hard as the dictionary is deep.** A weekday slot needs ~857 puzzles to run 17 years without repeating itself, and at four letters exactly **six** `(par, detour)` cells clear that bar: `4·0` 17325, `4·1` 14672, `5·1` 24100, `5·2` 2807, `6·2` 8177, `7·3` 1439. Everything else is a rounding error — `6·3` holds 327, `4·2` 322, `5·3` 90, `8·4` 185. So a five-day ramp that both increases every day *and* never runs dry has to be five of those six, which pins Monday to par 4 and caps Friday at `7·3`. Making **every** day harder than that means deliberately spending a scarce cell, and the only real question is where. It went on Thursday: `6·3` holds four years, and when it empties Thursday settles back onto `6·2` — exactly where Thursday used to be, so nothing ever gets easier. Spending it on Friday instead (`8·4`, 185 puzzles) was measurably worse: it empties in three months and its fallbacks land in Thursday's cell, so the two collide and the strict ramp survives 37% of weeks against 56%.
- **The binding constraint is the vocabulary, not the ladder graph.** Puzzles may only route through the ~1100 four-letter words ranked inside the top 10k by spoken frequency, which is what keeps them to words people actually know. Lift that to 20k and nine cells clear the bar instead of six — `8·4` among them — and every weekday could rise again with room to spare. The cost is that the median rarest word in a puzzle roughly doubles in obscurity, from about rank 8000 to 16000. That is a question about what counts as a fair puzzle rather than a scheduling one, so the cutoff is left where it is and the ramp is built against it.
- **The hardest day of the week was scheduled as the easiest puzzle in the game.** When a `(par, detour)` cell runs dry the scheduler degrades to a neighbouring one. Its last resort scanned `par 4` first and `detour 0` first — so once five-letter par 6 ran out, Sunday fell straight to the *easiest* cell the game has: **438 of 884 Sundays were par 4**, 256 of those detour 0, 173 of them inside the first decade. Nothing reported it, because by the only measure being taken nothing had gone wrong — the stream never *starved*. It just answered the wrong question, one cell at a time, for a decade. Degradation now walks a single ordered list of cells outward from the one that was asked for, harder side first, so a starved Sunday works down through par 6, then par 5, and reaches par 4 only if everything harder is genuinely gone. No Sunday is par 4 any more.
- **Every move is saved, not just the result** — otherwise a mid-game refresh would be a free retry. ([`src/state/storage.js`](src/state/storage.js))
- **Five-letter weekends were added without moving a single published day.** They run as a *second stream* (`schedule/5.json`) indexed by weekend ordinal, while the everyday stream keeps indexing by day number and simply skips Saturdays and Sundays. So no four-letter day changed — and the rule starts at #17 rather than reaching back over weekends that had already been played as four-letter puzzles. Same promise, applied to a feature that could easily have broken it.

The game logic is pure and trivially testable, so you can read exactly how a move, a leap, and a star are decided:

```bash
npm test    # share text, challenge codes, leaps, day maths, streaks, star scoring — no browser needed
```

### The map

| File | What lives there |
|---|---|
| [`src/game/rules.js`](src/game/rules.js) | Pure move validation + star scoring. The runtime needs only a word `Set` and a char-diff. |
| [`src/game/leap.js`](src/game/leap.js) | Where a leap takes you: the rung after the furthest you've reached — never backwards, never stranding, never the win itself. |
| [`src/game/puzzle.js`](src/game/puzzle.js) | Hydrates a puzzle from one schedule line. `start`, `end`, `par`, `solution` are all *derived* from the path, so they can't disagree with it. Also the move cap (par + 4). |
| [`src/game/daily.js`](src/game/daily.js) | Which puzzle is today, and how long it is. Local midnight (like Wordle) so the countdown reads true against your own clock; weekends from #17 come from the five-letter stream. |
| [`src/game/share.js`](src/game/share.js) | The share card — the spoiler-proof one described above. |
| [`src/game/challenge.js`](src/game/challenge.js) | The sealed beat-my-path code a winning card carries in its URL, and the forgery checks on the way back in. |
| [`src/game/streak.js`](src/game/streak.js) · [`completions.js`](src/game/completions.js) | The streak (pure, idempotent, resets on a loss) and the per-puzzle star log the archive reads. |
| [`src/state/useGame.js`](src/state/useGame.js) | Reducer holding path / moves / leaps / status — including which steps were leapt to, since that can no longer be re-derived from the words. |
| [`src/state/storage.js`](src/state/storage.js) | Today's progress, saved every move. |
| [`src/components/`](src/components/) | Header, word chain, editable tiles, the leap + give-up row, result modal. |
| [`scripts/build-schedule.mjs`](scripts/build-schedule.mjs) | Candidate search, the `(par, detour)` weekly ramp, and the daily schedule. |
| [`scripts/build-assets.mjs`](scripts/build-assets.mjs) | The dictionary. |
| [`scripts/blocklist.mjs`](scripts/blocklist.mjs) | Words a puzzle may not use — start, end *and* interiors, now that a leap can hand an interior word to the player. |

---

## 🛠 Run it yourself

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # pure unit tests
```

### Rebuild the puzzle data (optional)

```bash
npm run build:schedule     # public/schedule/{4,5}.json — fast, 2 fetches + BFS
npm run build:assets       # public/dict/ — the typeable word list
npm run build:icons        # public/og.png + apple-touch-icon.png (needs Chrome)
```

Each script takes a word length, e.g. `node scripts/build-schedule.mjs 5`, and the length picks the stream: **4 is the weekday puzzle, 5 is the weekend.** Use `--dry-run` to see the stats without writing, and remember: the schedule is append-only history. `build-schedule` won't touch an existing day without being told to, and there are only two ways to tell it — `--revise-from <day>`, which redraws the future from a day it has checked nobody can be playing yet, and `--rebuild --force`, which redraws everything and owes an apology to whoever played #42.

```bash
node scripts/build-schedule.mjs 4 --revise-from 40 --dry-run   # what would change, and from when
```

---

## 🗺 Roadmap

Shipped: streaks, deep-linked share cards, sealed beat-my-path challenge links, a past-puzzles archive, five-letter weekends, the `(par, detour)` difficulty ramp, a way to redraw the schedule's future without touching its past, and leaps that actually help.

Next: serving the schedule a day at a time from a Cloudflare Worker, so future answers stop riding along with today's. Deferred (and sketched out in the design doc): Supabase + anonymous auth, cross-device sync, and widening the length rotation past the current 4/5 split — five letters is the practical ceiling, since the ladder graph shatters into islands at six.

---

## 📚 Data sources

- **[ENABLE](https://github.com/dolph/dictionary)** — the word list (`public/dict/`). Public domain, by Alan Beale.
- **[FrequencyWords](https://github.com/hermitdave/FrequencyWords)** (MIT) — OpenSubtitles frequency ranks, used at build time to keep puzzles to words people actually know.

The **[Datamuse API](https://www.datamuse.com/api/)** used to supply the synonym map behind leaps. Leaps walk the answer now, so the sweep, the map and the ~56KB it shipped are all gone.

---

## 📄 License

Copyright © 2026 Rudy Dogum ([Rudy-Builds](https://github.com/Rudy-Builds)).

Licensed under the **MIT License** — see [LICENSE](LICENSE). Use it, learn from it, build on it, with attribution. The name "Leapword," its logo, and its visual identity are the creator's and aren't covered by the license.

<div align="center">

**[Go play →](https://leapword.app)**

</div>
