(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const demoDeposits = [
    { id: 'dep-jul27', amount_cents: 1349325, created_ts: 1753497600000, finalized_ts: 1753501200000, status: 'applied', type: 'crypto' },
    { id: 'dep-jul26', amount_cents: 2998500, created_ts: 1753411200000, finalized_ts: 1753414800000, status: 'applied', type: 'crypto' },
    { id: 'dep-jul22a', amount_cents: 2998500, created_ts: 1753065600000, finalized_ts: 1753069200000, status: 'applied', type: 'crypto' },
    { id: 'dep-jul22b', amount_cents: 2486, created_ts: 1753065600000, finalized_ts: 1753069200000, status: 'applied', type: 'crypto' },
    { id: 'dep-dec16', amount_cents: 10000, created_ts: 1734307200000, finalized_ts: 1734310800000, status: 'applied', type: 'debit' },
  ];

  const demoWithdrawals = [
    { id: 'wd-jul28a', amount_cents: 1639100, fee_cents: 0, created_ts: 1753584000000, finalized_ts: 1753587600000, status: 'applied', type: 'crypto' },
    { id: 'wd-jul28b', amount_cents: 1639100, fee_cents: 0, created_ts: 1753584000000, finalized_ts: 1753587600000, status: 'applied', type: 'crypto' },
    { id: 'wd-jul28c', amount_cents: 1900000, fee_cents: 0, created_ts: 1753584000000, finalized_ts: 1753587600000, status: 'applied', type: 'crypto' },
    { id: 'wd-jul28d', amount_cents: 1900000, fee_cents: 0, created_ts: 1753584000000, finalized_ts: null, status: 'failed', type: 'crypto' },
    { id: 'wd-jul28e', amount_cents: 5178000, fee_cents: 0, created_ts: 1753584000000, finalized_ts: null, status: 'failed', type: 'wire' },
    { id: 'wd-jul27', amount_cents: 3000000, fee_cents: 0, created_ts: 1753497600000, finalized_ts: 1753501200000, status: 'applied', type: 'wire' },
    { id: 'wd-jul22a', amount_cents: 2811420, fee_cents: 0, created_ts: 1753065600000, finalized_ts: 1753069200000, status: 'applied', type: 'wire' },
    { id: 'wd-jul22b', amount_cents: 2811420, fee_cents: 0, created_ts: 1753065600000, finalized_ts: null, status: 'failed', type: 'wire' },
  ];

  let deposits = [];
  let withdrawals = [];
  let isDemo = false;

  const fmt$ = (cents) => '$' + (Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTs = (ms) => ms ? new Date(Number(ms)).toLocaleString() : '-';
  const statusClass = (s) => s === 'applied' ? 'applied' : (s === 'failed' ? 'failed' : '');

  function sum(rows, field, statuses) {
    return rows.reduce((s, r) => s + ((!statuses || statuses.includes(r.status)) ? Number(r[field] || 0) : 0), 0);
  }

  function renderRows(tbody, cells, colspan) {
    if (!cells.length) { tbody.innerHTML = `<tr><td colspan='${colspan}' style='color:#64748b'>No records.</td></tr>`; return; }
    tbody.innerHTML = cells.map((c) => `<tr>${c}</tr>`).join('');
  }

  function filterRows(rows) {
    const type = $('#filter-type').value;
    const status = $('#filter-status').value;
    const from = $('#filter-from').valueAsNumber;
    const to = $('#filter-to').valueAsNumber;
    const q = $('#filter-search').value.trim().toLowerCase();
    return rows.filter((r) => {
      if (type && r.type !== type) return false;
      if (status && r.status !== status) return false;
      if (from && r.created_ts < from) return false;
      if (to && r.created_ts > to + 86400000) return false;
      if (q && !r.id.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const col = $('#sort-col').value;
    const dir = $('#sort-dir').value === 'desc' ? -1 : 1;
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const av = a[col] ?? 0;
      const bv = b[col] ?? 0;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function renderDeposits() {
    const rows = sortRows(filterRows(deposits));
    const cells = rows.map((r) => `
      <td class='mono'>${r.id}</td>
      <td class='right mono'>${r.amount_cents}</td>
      <td class='right green'>+${fmt$(r.amount_cents)}</td>
      <td class='mono'>${fmtTs(r.created_ts)}</td>
      <td class='mono'>${fmtTs(r.finalized_ts)}</td>
      <td class='${statusClass(r.status)}'>${r.status || '-'}</td>
      <td>${r.type || '-'}</td>
    `);
    renderRows($('#deposits'), cells, 7);
  }

  function renderWithdrawals() {
    const rows = sortRows(filterRows(withdrawals));
    const cells = rows.map((r) => `
      <td class='mono'>${r.id}</td>
      <td class='right mono'>${r.amount_cents}</td>
      <td class='right red'>-${fmt$(r.amount_cents)}</td>
      <td class='right mono'>${r.fee_cents ?? '-'}</td>
      <td class='right'>${r.fee_cents !== undefined ? fmt$(r.fee_cents) : '-'}</td>
      <td class='mono'>${fmtTs(r.created_ts)}</td>
      <td class='mono'>${fmtTs(r.finalized_ts)}</td>
      <td class='${statusClass(r.status)}'>${r.status || '-'}</td>
      <td>${r.type || '-'}</td>
    `);
    renderRows($('#withdrawals'), cells, 9);
  }

  function renderSummary() {
    const depTotal = sum(deposits, 'amount_cents');
    const withTotal = sum(withdrawals, 'amount_cents');
    const withFees = sum(withdrawals, 'fee_cents');
    const withApplied = sum(withdrawals, 'amount_cents', ['applied']);
    const withFailed = sum(withdrawals, 'amount_cents', ['failed']);
    const net = depTotal - withApplied;

    $('#summary').innerHTML = `
      <div class='kpi'><div class='label'>Deposits</div><div class='value green'>+${fmt$(depTotal)}</div></div>
      <div class='kpi'><div class='label'>Withdrawals</div><div class='value red'>-${fmt$(withTotal)}</div></div>
      <div class='kpi'><div class='label'>Withdrawal fees</div><div class='value gold'>${fmt$(withFees)}</div></div>
      <div class='kpi'><div class='label'>Applied withdrawals</div><div class='value white'>${fmt$(withApplied)}</div></div>
      <div class='kpi'><div class='label'>Failed withdrawals</div><div class='value red'>${fmt$(withFailed)}</div></div>
      <div class='kpi'><div class='label'>Net applied flow</div><div class='value' style='color:${net >= 0 ? '#00d4aa' : '#ff416c'}'>${net >= 0 ? '+' : '-'}${fmt$(Math.abs(net))}</div></div>
    `;
    $('#summary').style.display = 'grid';
  }

  function renderChart() {
    const svg = $('#chart');
    const events = [
      ...deposits.map((r) => ({ ts: Number(r.created_ts), delta: Number(r.amount_cents || 0) })),
      ...withdrawals.filter((r) => r.status === 'applied').map((r) => ({ ts: Number(r.created_ts), delta: -Number(r.amount_cents || 0) })),
    ].filter((e) => e.ts).sort((a, b) => a.ts - b.ts);
    if (!events.length) { svg.innerHTML = ''; return; }
    const balances = [];
    let bal = 0;
    for (const e of events) { bal += e.delta; balances.push({ ts: e.ts, bal }); }
    const minTs = balances[0].ts;
    const maxTs = balances[balances.length - 1].ts;
    const minBal = Math.min(...balances.map((b) => b.bal), 0);
    const maxBal = Math.max(...balances.map((b) => b.bal), 0);
    const w = svg.clientWidth || 600;
    const h = 120;
    const pad = 10;
    const x = (ts) => pad + (ts - minTs) / ((maxTs - minTs) || 1) * (w - 2 * pad);
    const y = (val) => h - pad - (val - minBal) / ((maxBal - minBal) || 1) * (h - 2 * pad);
    const points = balances.map((b) => `${x(b.ts)},${y(b.bal)}`).join(' ');
    const zeroY = y(0);
    svg.innerHTML = `
      <line x1='${pad}' y1='${zeroY}' x2='${w - pad}' y2='${zeroY}' stroke='rgba(255,255,255,0.1)' stroke-dasharray='4' />
      <polyline points='${points}' fill='none' stroke='#00d4aa' stroke-width='2' />
    `;
  }

  function exportCSV() {
    const d = sortRows(filterRows(deposits));
    const w = sortRows(filterRows(withdrawals));
    const rows = [
      ['type', 'id', 'amount_cents', 'fee_cents', 'created_at', 'finalized_at', 'status', 'kind'],
      ...d.map((r) => ['deposit', r.id, r.amount_cents, 0, new Date(r.created_ts).toISOString(), r.finalized_ts ? new Date(r.finalized_ts).toISOString() : '', r.status, r.type]),
      ...w.map((r) => ['withdrawal', r.id, r.amount_cents, r.fee_cents || 0, new Date(r.created_ts).toISOString(), r.finalized_ts ? new Date(r.finalized_ts).toISOString() : '', r.status, r.type]),
    ];
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kalshi-funding.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadData() {
    const status = $('#status');
    const loadBtn = $('#load');
    if (isDemo) {
      deposits = [...demoDeposits];
      withdrawals = [...demoWithdrawals];
      status.textContent = 'Demo data loaded.';
      renderAll();
      return;
    }
    if (loadBtn) loadBtn.disabled = true;
    status.textContent = 'Calling Kalshi via local proxy...';
    try {
      const [dRes, wRes] = await Promise.all([fetch('/api/deposits'), fetch('/api/withdrawals')]);
      if (!dRes.ok) throw new Error('Deposits: ' + await dRes.text());
      if (!wRes.ok) throw new Error('Withdrawals: ' + await wRes.text());
      deposits = await dRes.json();
      withdrawals = await wRes.json();
      status.textContent = `${deposits.length} deposits, ${withdrawals.length} withdrawals loaded.`;
      renderAll();
    } catch (e) {
      status.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      if (loadBtn) loadBtn.disabled = false;
    }
  }

  function renderAll() {
    renderDeposits();
    renderWithdrawals();
    renderSummary();
    renderChart();
  }

  function init() {
    isDemo = new URLSearchParams(location.search).has('demo');
    $('#env').textContent = isDemo ? 'demo' : 'live';
    $('#base').textContent = isDemo ? 'sample-data' : 'https://external-api.demo.kalshi.co/trade-api/v2';
    $('#mode-banner').style.display = isDemo ? 'block' : 'none';
    const loadBtn = $('#load');
    if (loadBtn) {
      loadBtn.style.display = isDemo ? 'none' : 'inline-block';
      loadBtn.addEventListener('click', loadData);
    }
    $('#export').addEventListener('click', exportCSV);
    $$('.filter, .sort').forEach((el) => el.addEventListener('change', renderAll));
    $$('.filter').forEach((el) => el.addEventListener('input', renderAll));
    if (isDemo) loadData();
  }

  document.addEventListener('DOMContentLoaded', init);
})();