/* Token Radar page: renders window.RADAR (written by main.ts from the same
   board the gate reads) as a sortable, filterable board with a detail view
   per protocol and the value model's working. No network, no framework. */
'use strict';
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => n === null ? '—' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(0) + 'K' : '$' + n;
const pct = (n) => n === null ? '<span class="flat">—</span>' : `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat'}">${n > 0 ? '+' : ''}${n.toFixed(1)}%</span>`;
const mult = (n) => n.toFixed(2) + '×';
const pills = (chains) => chains.slice(0, 3).map((c) => `<span class="pill">${esc(c)}</span>`).join('') + (chains.length > 3 ? `<span class="pill">+${chains.length - 3}</span>` : '');

/* State: the URL is the state, so every view a reader can reach by clicking
   or filtering can also be linked — ?cat=Dexs, ?slug=gauntlet and so on. */
const params = new URLSearchParams(location.search);
const state = {
  status: params.get('status') || 'board',
  q: params.get('q') || '',
  cat: params.get('cat') || '',
  chain: params.get('chain') || '',
  min: Number(params.get('min') || 0),
  wl: params.get('wl') === '1',
  slug: params.get('slug') || '',
  sort: params.get('sort') || 'rank',
  dir: params.get('dir') === 'desc' ? -1 : 1,
};
function syncUrl() {
  const p = new URLSearchParams();
  if (state.status !== 'board') p.set('status', state.status);
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain);
  if (state.min) p.set('min', String(state.min));
  if (state.wl) p.set('wl', '1');
  if (state.slug) p.set('slug', state.slug);
  history.replaceState(null, '', p.toString() ? '?' + p : location.pathname);
}

/* Filter option lists come from the data itself, never hand-kept. */
for (const c of [...new Set([...R.rows, ...R.live, ...R.aside].map((r) => r.category))].sort()) $('fCat').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
for (const c of [...new Set([...R.rows, ...R.live, ...R.aside].flatMap((r) => r.chains))].sort()) $('fChain').insertAdjacentHTML('beforeend', `<option>${esc(c)}</option>`);
$('fStatus').value = state.status; $('q').value = state.q; $('fCat').value = state.cat;
$('fChain').value = state.chain; $('fMin').value = String(state.min); $('fWl').checked = state.wl;

$('stats').innerHTML = [
  [R.as_of, 'snapshot date'],
  [R.scanned, 'protocols scanned'],
  [R.rows.length, 'pre-token ranked'],
  [`${R.rows.filter((r) => r.watchlist).length}/${R.watchlist_size}`, 'watchlist covered'],
  [R.live.length, 'already trading'],
  [R.aside.length, 'products set aside'],
].map(([b, i]) => `<div class="chip"><b>${b}</b><i>${i}</i></div>`).join('');

const matches = (r) => {
  const text = (r.name + ' ' + r.slug + ' ' + (r.chains || []).join(' ')).toLowerCase();
  return (!state.q || text.includes(state.q.toLowerCase()))
    && (!state.cat || r.category === state.cat)
    && (!state.chain || (r.chains || []).includes(state.chain))
    && r.tvl_usd >= state.min
    && (!state.wl || r.watchlist);
};
const by = (key, dir) => (a, b) => {
  const x = a[key], y = b[key];
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
};

const COLUMNS = {
  board: [
    ['rank', '#', 'num sortable'], ['name', 'Protocol', 'sortable'], ['category', 'Category', ''],
    ['chains', 'Chains', ''], ['tvl_usd', 'TVL', 'num sortable'], ['change_7d', '7d', 'num sortable'],
    ['multiple', 'Multiple', 'num sortable'], ['implied_value_usd', 'Implied value', 'num sortable'],
  ],
  live: [
    ['name', 'Protocol', 'sortable'], ['symbol', 'Symbol', ''], ['category', 'Category', ''],
    ['tvl_usd', 'TVL', 'num sortable'], ['mcap_usd', 'Market cap', 'num sortable'], ['ratio', 'Mcap / TVL', 'num sortable'],
  ],
  aside: [
    ['name', 'Protocol', 'sortable'], ['category', 'Category', ''], ['tvl_usd', 'TVL', 'num sortable'], ['reason', 'Why set aside', ''],
  ],
};

function rowHtml(r) {
  if (state.status === 'live') return `<tr data-slug=""><td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)}</span></td>
    <td>${r.symbol ? `<span class="badge sym">${esc(r.symbol)}</span>` : '<span class="flat">no mcap recorded</span>'}</td><td>${esc(r.category)}</td>
    <td class="num">${money(r.tvl_usd)}</td><td class="num">${money(r.mcap_usd)}</td><td class="num">${r.ratio === null ? '—' : mult(r.ratio)}</td></tr>`;
  if (state.status === 'aside') return `<tr data-slug=""><td class="name"><b>${esc(r.name)}</b><span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category)}</td><td class="num">${money(r.tvl_usd)}</td><td>${esc(r.reason)}</td></tr>`;
  return `<tr data-slug="${esc(r.slug)}"><td class="rank">${r.rank}</td>
    <td class="name"><b>${esc(r.name)}</b>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<span class="slug">${esc(r.slug)}</span></td>
    <td>${esc(r.category)}</td><td>${pills(r.chains)}</td><td class="num">${money(r.tvl_usd)}</td>
    <td class="num">${pct(r.change_7d)}</td><td class="num">${mult(r.multiple)}</td><td class="imp">${money(r.implied_value_usd)}</td></tr>`;
}

function render() {
  const detail = state.status === 'board' && state.slug ? R.rows.find((r) => r.slug === state.slug) : undefined;
  document.body.classList.toggle('detail', detail !== undefined);
  $('boardView').hidden = detail !== undefined;
  $('detailView').hidden = detail === undefined;
  if (detail) { renderDetail(detail); syncUrl(); return; }
  const source = state.status === 'live' ? R.live : state.status === 'aside' ? R.aside : R.rows;
  const rows = source.filter(matches);
  const sortKey = state.status === 'board' ? state.sort : (state.sort === 'rank' ? 'mcap_usd' : state.sort);
  rows.sort(by(sortKey, state.status === 'board' && state.sort === 'rank' ? 1 : state.dir));
  $('thead').innerHTML = '<tr>' + COLUMNS[state.status].map(([key, label, cls]) =>
    `<th class="${cls}" data-key="${key}">${label}${state.sort === key ? ` <span class="dir">${state.dir === 1 ? '▲' : '▼'}</span>` : ''}</th>`).join('') + '</tr>';
  $('tbody').innerHTML = rows.map(rowHtml).join('');
  $('empty').hidden = rows.length > 0;
  const label = state.status === 'live' ? 'trading protocols' : state.status === 'aside' ? 'set-aside protocols' : 'ranked protocols';
  $('count').textContent = `${rows.length} of ${source.length} ${label}`;
  for (const th of $('thead').querySelectorAll('th.sortable')) th.onclick = () => {
    if (state.sort === th.dataset.key) state.dir *= -1; else { state.sort = th.dataset.key; state.dir = th.dataset.key === 'name' ? 1 : -1; }
    render();
  };
  for (const tr of $('tbody').querySelectorAll('tr[data-slug]')) if (tr.dataset.slug) tr.onclick = () => { state.slug = tr.dataset.slug; render(); };
  syncUrl();
}

function renderDetail(r) {
  const years = r.years === null ? 'listing date unreported' : r.years.toFixed(1) + ' years';
  $('detailView').innerHTML = `
    <button class="back" id="backBtn">← Back to the board</button>
    <div class="d-head"><h2>${esc(r.name)}</h2><span class="slug">${esc(r.slug)}</span>
      ${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<span class="badge sym">Records no token</span></div>
    <div class="d-grid">
      <div class="card"><h3>The record</h3><dl class="kv">
        <dt>Rank</dt><dd>#${r.rank} of ${R.rows.length}</dd>
        <dt>Total value locked</dt><dd>${money(r.tvl_usd)}</dd>
        <dt>TVL change, 7 days</dt><dd>${r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</dd>
        <dt>Category</dt><dd>${esc(r.category)}</dd>
        <dt>Chains</dt><dd>${r.chains.map(esc).join(', ')}</dd>
        <dt>Tracked since</dt><dd>${r.listed_at || 'unreported'}</dd>
        <dt>Time with no token recorded</dt><dd>${years}</dd>
      </dl></div>
      <div class="card"><h3>The model&rsquo;s working</h3><dl class="kv">
        <dt>TVL &times; category multiple ${mult(r.multiple)}</dt><dd>${money(r.base)}</dd>
        <dt>&times; momentum (7d change)</dt><dd>${mult(r.momentum)}</dd>
        <dt>&times; seasoning (years tokenless)</dt><dd>${mult(r.seasoning)}</dd>
        ${r.capped ? '<dt>Sanity cap, 5 &times; TVL</dt><dd>applied</dd>' : ''}
        <dt>Implied value</dt><dd class="big">${money(r.implied_value_usd)}</dd>
        <dt>Implied / TVL</dt><dd>${mult(r.implied_value_usd / r.tvl_usd)}</dd>
      </dl></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Farm plan — before any launch</h3>
      <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
  $('backBtn').onclick = () => { state.slug = ''; render(); };
}

/* The model's multiples, straight from the data the program derived. */
$('multBody').innerHTML = R.multiples.map((m) => `<tr><td>${esc(m.category)}</td><td>${m.comps}</td><td>${m.raw === null ? '—' : mult(m.raw)}</td><td>${mult(m.used)}</td></tr>`).join('');
const compCount = R.multiples.reduce((n, m) => n + m.comps, 0);
$('modelNote').textContent = `Multiples derived from ${compCount} traded comparables in this snapshot; the global median multiple is ${mult(R.global_multiple)}. ${R.aside.length} protocols that record no token were set aside by the product screen and ${R.live.length} already trade; neither group is ranked as a launch.`;

for (const [id, key] of [['fStatus', 'status'], ['fCat', 'cat'], ['fChain', 'chain']]) $(id).onchange = (e) => { state[key] = e.target.value; state.slug = ''; render(); };
$('fMin').onchange = (e) => { state.min = Number(e.target.value); render(); };
$('fWl').onchange = (e) => { state.wl = e.target.checked; render(); };
$('q').oninput = (e) => { state.q = e.target.value; render(); };
render();
