# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/E29A/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/E29A/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. The program reads a sealed DefiLlama snapshot of every
protocol at or above $5M TVL, finds the ones that still record no token, ranks
them by what a launch would be worth if the record stayed as it is, and hands
in a dashboard: the ranked board, a detail view per protocol with the model's
working shown, filters and sorting, and a concrete farm plan for every row.

## The model

No protocol is priced by name. For each protocol on the board:

```
implied value = TVL × category multiple × momentum × seasoning, capped at 5 × TVL
```

- **Category multiple** — the median market-cap/TVL of the snapshot's own
  tokenised protocols in the same category (the launches that already
  happened, pricing the ones that have not), each ratio winsorised to
  [0.005, 10], shrunk toward the global median with weight 5, clamped to
  [0.05, 1.5]. A category with no traded comparable uses the global median.
- **Momentum** — 1 + 0.75 × the 7-day TVL change, change clamped to ±40%.
- **Seasoning** — 1 + 0.07 per year tracked with no token recorded, up to
  6 years. Unknown listing dates and unreported changes are neutral.

The board applies the watchlist's own product screen at every TVL, not only
above the $50M floor: protocols that record no token but are bridges, staking
or wrapped products of tokens that already trade, exchange venues, or later
versions of a family are set aside, and protocols whose token already trades
form a separate reference set. Neither group is ranked as a launch. On this
snapshot: 758 scanned, 198 ranked, all 40 watchlist protocols covered, 416
already trading, 144 set aside.

Farm plans are generated per protocol from its category, chains and size:
a category core loop (swaps and LP for a DEX, supply-and-borrow discipline
for lending, vault duration for curators, onboarding and a full cycle for
RWA, and so on), a second-chain loop where the protocol runs on several
chains, tranche scaling for the top of the board, and bookkeeping — each
step with what it costs and how long it takes.

## Run it

Node 22, standard library only:

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (built with the vendored `vendor/makefun-board.ts`) into the
output directory. The run is deterministic: the same snapshot writes the
same bytes. Open `out/dashboard/index.html` to use the radar — it renders
with no network. Views are linkable: `?cat=Dexs`, `?slug=gauntlet`,
`?status=live`, `?wl=1`.

Implied values are this radar's own claim from the snapshot, not a
prediction that any token will be issued. A protocol here *records* no
token; that is DefiLlama's record, not proof none exists.

<sub>Entered on [make.fun](https://make.fun/?ref=360dry7e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
