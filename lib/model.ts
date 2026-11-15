// The token radar's model: which protocols still record no token, what a launch
// would be worth if the record stayed as it is, and what to do about each one.
//
// Everything on the board is derived from the snapshot's own ten fields. No
// protocol is named in this file: the multiples come from the snapshot's own
// tokenised protocols, the screen is the watchlist's own product rule applied
// at every TVL instead of only above the floor, and the farm plans are built
// from each protocol's category, chains and size. Rerun the program on a
// future snapshot and the same code finds launches that do not exist yet.
//
// The value model, in one line:
//   implied = TVL x category multiple x momentum factor x seasoning factor,
//   capped at 5 x TVL.
// - The category multiple is the median market-cap/TVL ratio of the snapshot's
//   own tokenised protocols in the same category, each ratio winsorised to
//   [0.005, 10] (a token worth more than 10x its protocol's TVL prices
//   something else), shrunk toward the global median with weight 5 so a
//   category with one shaky comparable cannot run away, then clamped to
//   [0.05, 1.5]. A category with no tokenised comparable uses the global
//   median outright.
// - The momentum factor is 1 + 0.75 x clamp(change_7d, -40, +40) / 100: a
//   strong week lifts the claim by at most 30%, a bad one cuts at most 30%,
//   and an unreported change is neutral.
// - The seasoning factor is 1 + 0.07 per year the protocol has been tracked
//   with no token recorded, up to 6 years: a protocol that has run for years
//   and still records no token has the users, and the launch, of a survivor.
//   An unknown listing date is neutral, never a penalty.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Multiple {
  category: string;
  comps: number; // tokenised protocols with a usable market cap in this category
  raw: number | null; // their median mcap/TVL, winsorised; null when comps is 0
  used: number; // the multiple the model applies after shrinkage and clamping
}

export interface Breakdown {
  multiple: number;
  base: number; // TVL x multiple, before the two factors
  momentum: number; // the growth factor applied
  seasoning: number; // the age factor applied
  years: number | null; // years tracked with no token recorded
  capped: boolean; // the 5 x TVL sanity cap bit
  implied: number; // whole dollars
}

export interface Row extends Breakdown {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  tvl_usd: number;
  change_7d: number | null;
  chains: string[];
  listed_at: string | null;
  watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  ratio: number | null; // mcap/TVL where both are recorded
}

export interface AsideRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  scanned: number;
  watchlist_size: number;
  multiples: Multiple[];
  global_multiple: number;
  rows: Row[];
  live: LiveRow[];
  aside: AsideRow[];
}

// ---------------------------------------------------------------- constants

const WINSOR_LO = 0.005;
const WINSOR_HI = 10;
const SHRINK_WEIGHT = 5;
const MULTIPLE_LO = 0.05;
const MULTIPLE_HI = 1.5;
const MOMENTUM_SLOPE = 0.75;
const MOMENTUM_CLAMP = 40;
const SEASON_PER_YEAR = 0.07;
const SEASON_MAX_YEARS = 6;
const CAP_TIMES_TVL = 5;

// Categories that are products of another protocol or a venue, never a launch
// of their own — the watchlist rule's list, reused at every TVL.
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_HEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

const UNCATEGORISED = 'Uncategorised';
const categoryOf = (p: Protocol): string => p.category ?? UNCATEGORISED;
const hasTokenRecord = (p: Protocol): boolean => p.gecko_id !== null || p.symbol !== null;

// ---------------------------------------------------------------- snapshot

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected as_of, protocols and watchlist');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: a protocol is missing slug, name, tvl_usd or chains`);
    }
  }
  return raw;
}

// ------------------------------------------------------- the product screen

/**
 * Why a protocol that records no token is still not a launch candidate, or
 * null when it is one. Mirrors the watchlist's own exclusions; the snapshot
 * carries no parent field, so the screen reads category and name only.
 */
export function asideReason(p: Protocol): string | null {
  if (PRODUCT_CATEGORIES.has(categoryOf(p))) {
    return p.category === 'CEX'
      ? 'A centralised exchange venue, not a protocol waiting on a launch of its own.'
      : `A ${categoryOf(p).toLowerCase()} product of assets whose tokens already trade; its value rides on theirs.`;
  }
  if (PRODUCT_WORD.test(p.name)) return 'Its name marks it as a wrapped or staked product of a token that already trades.';
  if (VERSION_TAIL.test(p.name)) return 'A later version of a protocol family; the family launch, if any, belongs to the original.';
  if (EXCHANGE_HEAD.test(p.name)) return 'An exchange-branded product; any token is the exchange\u2019s, not this product\u2019s.';
  return null;
}

// ---------------------------------------------------------------- multiples

const winsorise = (x: number): number => Math.min(WINSOR_HI, Math.max(WINSOR_LO, x));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The comparable set: tokenised protocols whose market cap can price a TVL. */
function comparableRatios(snapshot: Snapshot): Map<string, number[]> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!hasTokenRecord(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const cat = categoryOf(p);
    const list = byCategory.get(cat) ?? [];
    list.push(winsorise(p.mcap_usd / p.tvl_usd));
    byCategory.set(cat, list);
  }
  return byCategory;
}

/** Every category's multiple, derived from the snapshot alone, in name order. */
export function categoryMultiples(snapshot: Snapshot): { multiples: Multiple[]; global: number } {
  const byCategory = comparableRatios(snapshot);
  const all = [...byCategory.values()].flat();
  const global = median(all);
  const multiples: Multiple[] = [];
  const categories = new Set(snapshot.protocols.map(categoryOf));
  for (const category of [...categories].sort()) {
    const ratios = byCategory.get(category) ?? [];
    if (ratios.length === 0) {
      multiples.push({ category, comps: 0, raw: null, used: round4(global) });
      continue;
    }
    const raw = median(ratios);
    const shrunk = (ratios.length * raw + SHRINK_WEIGHT * global) / (ratios.length + SHRINK_WEIGHT);
    multiples.push({ category, comps: ratios.length, raw: round4(raw), used: round4(clamp(shrunk, MULTIPLE_LO, MULTIPLE_HI)) });
  }
  return { multiples, global };
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

// ------------------------------------------------------------------- values

/** Whole days between two YYYY-MM-DD dates, UTC; null when either is absent. */
export function trackedDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const parse = (d: string): number => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y!, m! - 1, day!);
  };
  return Math.round((parse(asOf) - parse(listedAt)) / 86_400_000);
}

/** The model's claim for one pre-token protocol, with its working shown. */
export function impliedValue(p: Protocol, asOf: string, multiple: number): Breakdown {
  const base = p.tvl_usd * multiple;
  const momentum = p.change_7d === null ? 1 : 1 + (MOMENTUM_SLOPE * clamp(p.change_7d, -MOMENTUM_CLAMP, MOMENTUM_CLAMP)) / 100;
  const days = trackedDays(asOf, p.listed_at);
  const years = days === null ? null : Math.max(0, days / 365.25);
  const seasoning = years === null ? 1 : 1 + SEASON_PER_YEAR * Math.min(years, SEASON_MAX_YEARS);
  const raw = base * momentum * seasoning;
  const cap = CAP_TIMES_TVL * p.tvl_usd;
  return {
    multiple,
    base: Math.round(base),
    momentum: round4(momentum),
    seasoning: round4(seasoning),
    years: years === null ? null : round4(years),
    capped: raw > cap,
    implied: Math.max(1, Math.round(Math.min(raw, cap))),
  };
}

// --------------------------------------------------------------- farm plans

interface FarmContext {
  name: string;
  category: string;
  home: string; // first chain, where the gas figures point
  second: string | null; // another chain, when the protocol runs on several
  chains: number;
  gas: string; // the cost of transacting on the home chain
  size: string; // position sizing that fits the protocol's scale
  minutes: string; // a weekly time commitment that fits its scale
}

const L2_CHAINS = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Mode', 'Blast', 'Unichain', 'Ink', 'Soneium', 'Taiko', 'Metis', 'Polygon', 'Polygon zkEVM', 'Boba', 'Fraxtal', 'World Chain', 'Zora', 'Abstract', 'Berachain', 'Sonic', 'Avalanche', 'BNB Chain', 'Gnosis', 'Celo', 'Moonbeam', 'Fantom', 'Cronos', 'Aurora', 'Near', 'Aptos', 'Sui', 'Solana', 'Tron', 'Ton', 'Sei', 'Injective', 'Starknet', 'Manta', 'X Layer', 'Bob', 'Corn', 'Hemi', 'Plume', 'Sophon', 'Swellchain', 'Eclipse', 'Soon', 'Monad']);

function gasBand(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum mainnet gas, roughly $3\u2013$15 per transaction at ordinary congestion';
  if (chain === 'Bitcoin') return 'Bitcoin network fees, roughly $1\u2013$5 per transaction';
  if (L2_CHAINS.has(chain)) return `fees on ${chain}, usually $0.05\u2013$0.60 per transaction`;
  return `fees on ${chain}, usually $0.20\u2013$2 per transaction`;
}

function farmContext(p: Protocol): FarmContext {
  const tvl = p.tvl_usd;
  const big = tvl >= 500_000_000;
  const mid = tvl >= 100_000_000;
  return {
    name: p.name,
    category: categoryOf(p),
    home: p.chains[0] ?? 'Ethereum',
    second: p.chains.length > 1 ? p.chains[1]! : null,
    chains: p.chains.length,
    gas: gasBand(p.chains[0] ?? 'Ethereum'),
    size: big ? '$1,000\u2013$10,000' : mid ? '$250\u2013$2,500' : '$50\u2013$500',
    minutes: big ? '30\u201345 minutes a week' : '15\u201330 minutes a week',
  };
}

/** The core loop for a category family: four concrete steps, in order. */
function coreSteps(p: Protocol, c: FarmContext): string[] {
  const cat = categoryOf(p);
  if (cat === 'Dexs') return [
    `Make ${c.name} your default swap venue on ${c.home} for a month: route ordinary trades through its main pairs in both directions, a few swaps a week, so your wallet shows real volume rather than one burst. Cost: ${c.gas}, plus slippage on each trade.`,
    `Provide liquidity to ${c.name}\u2019s flagship pool with ${c.size}, split between the pool\u2019s two assets, and leave it through at least one full week of fee accrual instead of hopping pools daily. Cost: two approvals and a deposit, about 10 minutes to set up.`,
    `Use one feature beyond plain swaps every week \u2014 a limit order, a second pair, or the protocol\u2019s own router from another interface \u2014 so your history covers the product surface a points program would measure. Time: 5 extra minutes a week.`,
    `Rebalance the LP position when it drifts out of range and claim any fees or points on a fixed weekday; an unmanaged position that sits out of range earns nothing and reads as abandoned. Cost: one transaction a week at ${c.gas}.`,
  ];
  if (cat === 'Lending' || cat === 'Uncollateralized Lending') return [
    `Supply ${c.size} of a blue-chip asset (ETH or a major stablecoin) to ${c.name} on ${c.home} and leave it supplied for a full month; lenders are usually scored on balance over time, not on deposit count. Cost: ${c.gas} for the approval and deposit.`,
    `Borrow a small amount against the position \u2014 no more than 25% of what you supplied \u2014 and repay it in full a week later, twice in the month, keeping the health factor above 1.6 throughout. Cost: interest for the week plus two transactions.`,
    `Hold a continuous supplied balance across a month boundary: scoring snapshots favour wallets that never fully exit, so withdraw in stages and never to zero until a launch is actually announced. Time: one check a week, 5 minutes.`,
    `Turn on every notification ${c.name} offers (liquidation and rate alerts) and keep a buffer of collateral ready; a liquidation on your record is the one outcome that can disqualify a wallet from goodwill distributions. Cost: none.`,
  ];
  if (cat === 'Derivatives' || cat === 'Interest Rate Derivatives') return [
    `Open small perpetual positions on ${c.name} on both sides over a month \u2014 longs and shorts, each no larger than ${c.size} of notional \u2014 so your history reads as a trader, not a one-way bet. Cost: trading fees plus ${c.gas} per open and close.`,
    `Hold at least one position open overnight twice a week and let funding settle on it; protocols weight open interest held through funding windows more than intraday churn. Time: 10 minutes on trading days.`,
    `Place and rest limit orders away from the mid price, then cancel or fill them over the week, so your wallet shows book activity as well as taker flow. Cost: no fee on cancels on most venues, gas only where the chain charges it.`,
    `Close every position flat at month end and withdraw nothing: leaving margin parked in the account between sessions is the behaviour that separates regulars from snapshot tourists. Cost: closing fees only.`,
  ];
  if (cat === 'CDP' || cat === 'CDP Manager' || cat === 'Dual-Token Stablecoin' || cat === 'Stablecoin Issuer' || cat === 'Stablecoin Wrapper' || cat === 'Algo-Stables') return [
    `Deposit ${c.size} of collateral into a ${c.name} vault on ${c.home} and mint its stablecoin at no more than half the maximum loan-to-value, so the position survives an ordinary market drop. Cost: ${c.gas} for deposit and mint.`,
    `Put the minted stablecoin to work inside the same ecosystem \u2014 a stability pool or its flagship liquidity pair \u2014 rather than selling it, and hold the combined position for at least a month. Cost: one more deposit transaction.`,
    `Repay a slice of the minted amount and mint it again a week later, twice over the month, so the vault shows a full borrow-repay cycle instead of a single static mint. Cost: interest accrued plus two transactions.`,
    `Check the vault\u2019s collateral ratio every few days and top up collateral before it drifts toward liquidation; set a calendar reminder, because CDP liquidations are fast and unforgiving. Time: 5 minutes a check, no cost unless you top up.`,
  ];
  if (cat === 'Cross Chain Bridge') return [
    `Bridge a small amount (${c.size} at most) through ${c.name} between ${c.home} and one other chain it serves, once a week for a month, varying the route rather than repeating the cheapest one. Cost: bridge fee plus gas on both chains.`,
    `Leave the bridged funds working at the destination for at least a few days before bridging back; instant round trips are the pattern sybil filters are built to catch. Cost: none beyond patience.`,
    `Use ${c.name} for one transfer you actually need \u2014 funding a wallet or moving to a chain you use \u2014 so part of your history is plainly organic. Cost: the fee you would have paid any bridge.`,
    `Keep the transaction hashes from every crossing in your log; if a points program or retroactive claim opens, route history is the first thing it asks for. Cost: none, 2 minutes a trip.`,
  ];
  if (cat === 'Chain') return [
    `Bridge ${c.size} of assets onto ${c.name}\u2019s chain and keep a balance there for a full quarter; a chain\u2019s own launch rewards the wallets that actually live on it. Cost: bridge fee plus ${c.gas}.`,
    `Run real transactions on the chain every week \u2014 swaps, a lending deposit, an NFT mint \u2014 aiming for activity on at least 8 separate days a month rather than one busy afternoon. Cost: ${c.gas} per transaction.`,
    `Hold a small position in the chain\u2019s flagship applications, not only its bridge: one LP position or lending deposit that stays open between your visits. Cost: one deposit, sized inside your ${c.size} budget.`,
    `Use the native bridge back to ${c.home} once, so your history covers the full round trip; one-way wallets are common, round-trip wallets are the ones that stayed. Cost: bridge fee and gas.`,
  ];
  if (cat === 'RWA') return [
    `Complete ${c.name}\u2019s onboarding and any KYC or accreditation checks early, before sizing anything: RWA platforms gate their best products, and a verified account with history is the asset. Cost: 20\u2013 40 minutes once, no fee.`,
    `Mint or buy a first position of ${c.size} in the flagship asset on ${c.home} and hold it through one full yield or coupon cycle rather than flipping it. Cost: platform spread plus ${c.gas}.`,
    `Reinvest one payout into a second asset on the platform, so your account shows breadth across its catalogue instead of a single test purchase. Cost: the payout amount, plus one transaction.`,
    `Redeem a small part of the position end-to-end once, so you know the exit works and your account records a completed cycle before any launch snapshot matters. Cost: redemption spread, if any, plus gas.`,
  ];
  if (cat === 'Staking Pool' || cat === 'Restaking' || cat === 'Anchor BTC' || cat === 'Decentralized BTC') return [
    `Stake ${c.size} of the underlying asset through ${c.name} on ${c.home} and hold the staking position for at least a full quarter; staking programs score duration as much as size. Cost: ${c.gas} for the stake transaction.`,
    `Where ${c.name} issues a receipt token, put a part of it to work in one integrated market (a lending market or LP) instead of leaving the whole amount idle in the wallet. Cost: one deposit transaction.`,
    `Add to the stake in at least three separate months rather than one lump sum; a ladder of deposits reads as conviction and survives more snapshot dates. Cost: gas per deposit.`,
    `Unstake a small slice once and restake it, so your history includes a full exit and return \u2014 and so you learn the unbonding period before it matters. Cost: gas, plus the unbonding wait.`,
  ];
  // Vaults, yield, curators, allocators and everything else: the deposit loop.
  return [
    `Deposit ${c.size} into ${c.name}\u2019s flagship vault or market on ${c.home} and leave it for a full month; vault-style programs score balance over time, so duration is the position. Cost: ${c.gas} for approval and deposit.`,
    `Split a second deposit across another of ${c.name}\u2019s vaults or markets, so your account shows breadth rather than a single test deposit. Cost: one more deposit, sized inside the same budget.`,
    `Claim or compound rewards on a fixed weekday and keep the receipt token where the protocol\u2019s own app puts it; unclaimed, scattered balances are the ones points programs miss. Cost: one transaction a week.`,
    `Rotate a slice of the position between vaults once a month instead of exiting: internal movement keeps your full history inside ${c.name} while still showing an active, managed account. Cost: withdrawal and deposit gas, twice.`,
  ];
}

/** One protocol's farm plan: setup, the category loop, breadth, bookkeeping. */
export function farmSteps(p: Protocol, rank: number): string[] {
  const c = farmContext(p);
  const steps: string[] = [
    `Set up a dedicated wallet for ${c.name}, fund it on ${c.home}, and read the protocol\u2019s own docs and points or season page before depositing anything. Cost: ${c.gas} to fund and approve, about 20 minutes once.`,
    ...coreSteps(p, c),
  ];
  if (c.second !== null) {
    steps.push(`Repeat the core loop on ${c.second}, where ${c.name} also runs (${c.chains} chains in all): multi-chain users are scored separately by most points programs, and the second chain is usually the cheaper one to farm. Cost: a bridge fee plus local gas, about 15 minutes.`);
  }
  if (rank <= 25) {
    steps.push(`Scale in tranches: add a second deposit of the same size after two clean weeks, and a third after a month, rather than depositing the full ${c.size} on day one \u2014 a rising balance across snapshots is the strongest signal a farmer can send. Time: ${c.minutes}.`);
  }
  steps.push(`Keep a dated log of every deposit, trade and points balance for ${c.name}, and keep the position open and recently active while launch rumours circulate; snapshots are taken without warning. Cost: 2 minutes a session, no fees.`);
  steps.push(`Never buy a token sold as ${c.name}\u2019s launch from a third party: the record shows no token issued, so anything trading under its name today is not the protocol\u2019s, whatever the seller claims. Cost: the loss this step exists to prevent.`);
  return steps;
}

// -------------------------------------------------------------------- board

/** The full radar: the ranked board, the live set and the set-aside set. */
export function buildRadar(snapshot: Snapshot): Radar {
  const { multiples, global } = categoryMultiples(snapshot);
  const byCategory = new Map(multiples.map((m) => [m.category, m.used]));
  const watchlist = new Set(snapshot.watchlist);

  const rows: Row[] = [];
  const live: LiveRow[] = [];
  const aside: AsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (hasTokenRecord(p)) {
      live.push({
        slug: p.slug,
        name: p.name,
        symbol: p.symbol,
        category: categoryOf(p),
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        ratio: p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      });
      continue;
    }
    const reason = asideReason(p);
    if (reason !== null) {
      aside.push({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, reason });
      continue;
    }
    const value = impliedValue(p, snapshot.as_of, byCategory.get(categoryOf(p)) ?? global);
    rows.push({
      ...value,
      slug: p.slug,
      name: p.name,
      rank: 0, // assigned after the sort
      implied_value_usd: value.implied,
      farm_steps: [], // filled after the sort, when the rank is known
      category: categoryOf(p),
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      chains: p.chains,
      listed_at: p.listed_at,
      watchlist: watchlist.has(p.slug),
    });
  }

  // Rank is the model's claim: implied value first, then TVL, then the slug,
  // so two runs of the same snapshot order identically down to the last row.
  rows.sort((a, b) => b.implied - a.implied || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
    const protocol = snapshot.protocols.find((p) => p.slug === row.slug)!;
    row.farm_steps = farmSteps(protocol, row.rank);
  });
  live.sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || (a.slug < b.slug ? -1 : 1));
  aside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  return {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    multiples,
    global_multiple: round4(global),
    rows,
    live,
    aside,
  };
}

/** The dashboard's data file: the whole radar as one script assignment. */
export function dataScript(radar: Radar): string {
  // Escape "<" so no protocol name can close the script element early.
  return `window.RADAR = ${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}

/**
 * The gate's board rules, checked before anything is written: a board the
 * scorer would refuse is a bug in the model, and the program says so instead
 * of handing it in. Returns the first problem, or null when the board holds.
 */
export function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4_000) return `the board holds ${rows.length} rows, outside 100 to 4,000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  let previous = Number.POSITIVE_INFINITY;
  let distinct = new Set<number>();
  for (let i = 0; i < byRank.length; i++) {
    const row = byRank[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1 to N (rank ${row.rank} at position ${i + 1})`;
    if (!slugs.has(row.slug)) return `${row.slug} is not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim() === '') return `${row.slug} has an empty name`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has an implied value outside the gate's range`;
    }
    if (row.implied_value_usd > previous) return `${row.slug} is worth more than the row ranked above it`;
    previous = row.implied_value_usd;
    distinct.add(row.implied_value_usd);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps, outside 3 to 12`;
    for (const step of row.farm_steps) {
      const length = step.trim().length;
      if (length < 20 || length > 600) return `${row.slug} has a farm step of ${length} characters, outside 20 to 600`;
    }
  }
  if (distinct.size < 2) return 'every implied value is the same: a board that ranks nothing by value';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
