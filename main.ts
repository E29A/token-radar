// Token radar: a program that reads the sealed DefiLlama snapshot and hands
// in a ranked board of the protocols that still record no token, what each
// one's launch would be worth, and how to farm it.
//
//   node main.ts --input <snapshot.json|directory> [--output <directory>]
//
// The grader mounts the snapshot at /input and a writable /output; outside
// the grader, MAKEFUN_OUTPUT_DIR stands in for /output. Nothing is fetched:
// the snapshot is sealed, and two runs over the same bytes write the same
// bytes. Outputs, in the order they are written:
//   board.json    the ranked board the gate reads
//   data.js       the same radar, as the dashboard's data file
//   dashboard/    the page itself, copied from this repository
//   screenshots/  the three views of it, copied from this repository
//   dossier.json  written last, from the finished output, by the vendored
//                 buildDossier — the scorer rebuilds it and compares bytes

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65_536; // the dossier's text cap, set by the bounty
const PLAIN_IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && args[at + 1] !== undefined) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputPath = flagValue('input', '/input');
const snapshotPath = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotPath)) fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory>`);
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outputDir, { recursive: true });

// The board file carries the gate's fields first, then the record behind
// each row, so a reader of board.json alone can audit the ranking.
const boardFile = {
  as_of: snapshot.as_of,
  model: 'implied = tvl x category multiple (median mcap/tvl of the snapshot\u2019s own tokenised protocols in the category, winsorised, shrunk to the global median, clamped) x momentum (7d TVL change) x seasoning (years tracked with no token), capped at 5 x tvl',
  rows: radar.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
    category: row.category,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    chains: row.chains,
    watchlist: row.watchlist,
  })),
};
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify(boardFile)}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyTree(src, dst).map((name) => `${entry.name}/${name}`));
    } else if (entry.isFile() && statSync(src).isFile()) {
      mkdirSync(to, { recursive: true });
      copyFileSync(src, dst);
      copied.push(entry.name);
    }
  }
  return copied;
}

const pageFiles = copyTree(join(root, 'dashboard'), join(outputDir, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html');
const shots = copyTree(join(root, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images — hand in 3 or 4`);
for (const name of shots) {
  if (!PLAIN_IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// Last, the dossier over the finished output. The caps beyond the text cap
// only refuse; they never shape the bytes, so this is the file the scorer
// rebuilds from the same output and compares.
const dossier = buildDossier(outputDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: scanned ${radar.scanned} protocols as of ${radar.as_of}: ` +
    `${radar.rows.length} pre-token ranked (all ${radar.watchlist_size} watchlist protocols covered), ` +
    `${radar.live.length} already trading set in the reference set, ${radar.aside.length} products set aside\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json (${dossier.length} bytes)\n`,
);
