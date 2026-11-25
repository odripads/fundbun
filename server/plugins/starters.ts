import type { PluginStarter } from '../../src/core/plugins/types'

export const STARTER_PLUGINS: readonly PluginStarter[] = [
  {
    id: 'coffee-tea-tracker',
    name: 'Coffee & Tea Counter',
    description: 'Counts cups bought this month, average per cup, favorite cafe, and 7-day cadence.',
    slot: 'dashboard',
    wide: false,
    icon: 'coffee',
    code: `function render(root, data, h) {
  root.textContent = '';
  var month = data.month;
  var cups = data.transactions.filter(function (t) {
    return t.category === 'coffee_tea' && t.date.slice(0, 7) === month;
  });
  var total = cups.reduce(function (sum, t) { return sum + t.amount; }, 0);
  var avg = cups.length ? Math.round(total / cups.length) : 0;

  var byShop = Object.create(null);
  for (var i = 0; i < cups.length; i++) {
    var name = cups[i].merchant || 'Cafe';
    byShop[name] = (byShop[name] || 0) + 1;
  }
  var favShop = 'None yet';
  var favCount = 0;
  for (var shop in byShop) {
    if (byShop[shop] > favCount) {
      favCount = byShop[shop];
      favShop = shop;
    }
  }

  var goal = data.goals[0];
  var eqText = goal && goal.price > 0
    ? Math.max(1, Math.round((total / goal.price) * 100)) + '% of ' + goal.name
    : cups.length + ' orders in ' + month;

  var recent = [];
  for (var d = 6; d >= 0; d--) {
    var dt = new Date(data.today + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - d);
    var iso = dt.toISOString().slice(0, 10);
    var dayTotal = 0;
    for (var j = 0; j < cups.length; j++) {
      if (cups[j].date === iso) dayTotal += cups[j].amount;
    }
    recent.push({ iso: iso, day: iso.slice(8), amount: dayTotal });
  }
  var maxDay = recent.reduce(function (m, r) { return Math.max(m, r.amount); }, 1);

  root.appendChild(
    h.el('div', { class: 'cw-wrap' },
      h.el('div', { class: 'cw-top' },
        h.el('div', null,
          h.el('div', { class: 'cw-big' }, String(cups.length) + ' cup' + (cups.length === 1 ? '' : 's')),
          h.el('div', { class: 'cw-sub' }, h.money(total) + ' total · ' + eqText)
        ),
        h.el('span', { class: 'cw-pill' }, avg ? 'Avg ' + h.money(avg) : 'No cups yet')
      ),
      h.el('div', { class: 'cw-bars' },
        recent.map(function (r) {
          var heightPct = r.amount > 0 ? Math.max(18, Math.round((r.amount / maxDay) * 100)) : 8;
          return h.el('div', { class: 'cw-col', title: r.iso + ': ' + h.money(r.amount) },
            h.el('div', { class: 'cw-bar', 'data-empty': r.amount === 0 ? 'true' : 'false', style: { height: heightPct + '%' } }),
            h.el('span', { class: 'cw-day' }, r.day)
          );
        })
      ),
      h.el('div', { class: 'cw-foot' },
        h.el('span', null, 'Favorite stop: ' + favShop + (favCount ? ' (' + favCount + 'x)' : '')),
        h.el('span', null, '7-day strip')
      )
    )
  );
}`,
    css: `.cw-wrap { display: grid; gap: 12px; }
.cw-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.cw-big { font-family: var(--font-display); font-size: 1.55rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text); }
.cw-sub { font-size: 0.8rem; color: var(--text-3); margin-top: 2px; }
.cw-pill { padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 650; background: var(--accent-soft); color: var(--accent-text); white-space: nowrap; }
.cw-bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; align-items: end; height: 64px; padding: 8px 10px; border-radius: var(--r-md); background: var(--bg-sunken); }
.cw-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%; }
.cw-bar { width: 100%; max-width: 22px; border-radius: 6px; background: var(--accent); transition: height 160ms ease; }
.cw-bar[data-empty="true"] { background: var(--border); }
.cw-day { font-size: 0.68rem; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cw-foot { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--text-2); font-weight: 560; }`,
  },
  {
    id: 'weekend-vs-weekday',
    name: 'Weekend vs Weekday',
    description: 'Compares your Mon-Fri workweek pace with Sat-Sun spending this month.',
    slot: 'dashboard',
    wide: false,
    icon: 'calendar',
    code: `function render(root, data, h) {
  root.textContent = '';
  var month = data.month;
  var monthTxns = data.transactions.filter(function (t) {
    return t.date.slice(0, 7) === month;
  });

  var weekdaySum = 0;
  var weekendSum = 0;
  var weekdayDays = Object.create(null);
  var weekendDays = Object.create(null);
  var weekendShops = Object.create(null);

  for (var i = 0; i < monthTxns.length; i++) {
    var t = monthTxns[i];
    var dow = new Date(t.date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) {
      weekendSum += t.amount;
      weekendDays[t.date] = true;
      var shop = t.merchant || 'Merchant';
      weekendShops[shop] = (weekendShops[shop] || 0) + t.amount;
    } else {
      weekdaySum += t.amount;
      weekdayDays[t.date] = true;
    }
  }

  var wdCount = Object.keys(weekdayDays).length;
  var weCount = Object.keys(weekendDays).length;
  var wdAvg = wdCount ? Math.round(weekdaySum / wdCount) : 0;
  var weAvg = weCount ? Math.round(weekendSum / weCount) : 0;
  var total = weekdaySum + weekendSum;
  var wePct = total ? h.pct(weekendSum, total) : 0;
  var wdPct = total ? 100 - wePct : 50;

  var leaderName = 'None yet';
  var leaderAmt = 0;
  for (var m in weekendShops) {
    if (weekendShops[m] > leaderAmt) {
      leaderAmt = weekendShops[m];
      leaderName = m;
    }
  }

  root.appendChild(
    h.el('div', { class: 'ww-wrap' },
      h.el('div', { class: 'ww-stats' },
        h.el('div', { class: 'ww-box' },
          h.el('span', { class: 'ww-kicker' }, 'Mon - Fri'),
          h.el('strong', { class: 'ww-amt' }, h.money(weekdaySum)),
          h.el('span', { class: 'ww-avg' }, wdAvg ? h.money(wdAvg) + '/active day' : 'No spend days')
        ),
        h.el('div', { class: 'ww-box' },
          h.el('span', { class: 'ww-kicker' }, 'Sat - Sun'),
          h.el('strong', { class: 'ww-amt ww-we' }, h.money(weekendSum)),
          h.el('span', { class: 'ww-avg' }, weAvg ? h.money(weAvg) + '/active day' : 'No weekend spend')
        )
      ),
      h.el('div', { class: 'ww-track', role: 'img', 'aria-label': 'Weekday ' + wdPct + '%, Weekend ' + wePct + '%' },
        h.el('div', { class: 'ww-fill-wd', style: { width: wdPct + '%' } }),
        h.el('div', { class: 'ww-fill-we', style: { width: (100 - wdPct) + '%' } })
      ),
      h.el('div', { class: 'ww-foot' },
        h.el('span', null, 'Weekend share: ' + wePct + '%'),
        h.el('span', null, leaderAmt ? 'Top weekend: ' + leaderName + ' (' + h.money(leaderAmt) + ')' : 'Waiting for Sat/Sun data')
      )
    )
  );
}`,
    css: `.ww-wrap { display: grid; gap: 12px; }
.ww-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ww-box { display: grid; gap: 3px; padding: 10px 12px; border-radius: var(--r-md); background: var(--bg-sunken); }
.ww-kicker { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
.ww-amt { font-family: var(--font-display); font-size: 1.15rem; color: var(--text); font-variant-numeric: tabular-nums; }
.ww-we { color: var(--accent-text); }
.ww-avg { font-size: 0.74rem; color: var(--text-3); }
.ww-track { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--surface-2); }
.ww-fill-wd { background: var(--under); height: 100%; }
.ww-fill-we { background: var(--accent); height: 100%; }
.ww-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 0.78rem; color: var(--text-2); }`,
  },
  {
    id: 'burn-rate-gauge',
    name: 'Daily Burn-Rate Pace',
    description: 'Tracks your daily spending speed vs safe daily allowance and 7-day trend.',
    slot: 'dashboard',
    wide: true,
    icon: 'gauge',
    code: `function render(root, data, h) {
  root.textContent = '';
  var summary = data.summary;
  if (!summary) {
    root.appendChild(h.el('p', { class: 'br-empty' }, 'No monthly summary is ready yet.'));
    return;
  }

  var dayNum = Math.max(1, Number(data.today.slice(8, 10)) || 1);
  var burnPerDay = Math.round(summary.spent / dayNum);
  var safeDaily = Math.max(0, summary.safePerDay);
  var remaining = Math.max(0, summary.target - summary.spent);
  var ratio = safeDaily > 0 ? Math.round((burnPerDay / safeDaily) * 100) : (burnPerDay > 0 ? 150 : 0);
  var clamped = Math.max(4, Math.min(100, Math.round((ratio / 150) * 100)));
  var statusTone = ratio <= 95 ? 'steady' : ratio <= 115 ? 'warm' : 'hot';
  var statusLabel = ratio <= 95 ? 'Steady daily pace' : ratio <= 115 ? 'Close to daily cap' : 'Running fast this month';

  var points = [];
  for (var i = 6; i >= 0; i--) {
    var dt = new Date(data.today + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - i);
    var iso = dt.toISOString().slice(0, 10);
    var spentDay = 0;
    for (var j = 0; j < data.transactions.length; j++) {
      if (data.transactions[j].date === iso) spentDay += data.transactions[j].amount;
    }
    points.push({ iso: iso, amount: spentDay });
  }
  var maxPt = points.reduce(function (m, p) { return Math.max(m, p.amount, safeDaily); }, 1);
  var w = 240;
  var ht = 44;
  var poly = points.map(function (p, idx) {
    var x = Math.round((idx / 6) * (w - 8) + 4);
    var y = Math.round(ht - 6 - (p.amount / maxPt) * (ht - 12));
    return x + ',' + y;
  }).join(' ');

  root.appendChild(
    h.el('div', { class: 'br-wrap' },
      h.el('div', { class: 'br-metrics' },
        h.el('div', { class: 'br-cell' },
          h.el('span', { class: 'br-lbl' }, 'Actual burn'),
          h.el('strong', { class: 'br-val' }, h.money(burnPerDay) + '/day')
        ),
        h.el('div', { class: 'br-cell' },
          h.el('span', { class: 'br-lbl' }, 'Safe allowance'),
          h.el('strong', { class: 'br-val' }, h.money(safeDaily) + '/day')
        ),
        h.el('div', { class: 'br-cell' },
          h.el('span', { class: 'br-lbl' }, summary.daysLeft + ' days left'),
          h.el('strong', { class: 'br-val' }, h.money(remaining) + ' room')
        ),
        h.el('span', { class: 'br-status', 'data-tone': statusTone }, statusLabel)
      ),
      h.el('div', { class: 'br-bottom' },
        h.el('div', { class: 'br-gauge' },
          h.el('div', { class: 'br-gauge-bar', 'data-tone': statusTone, style: { width: clamped + '%' } })
        ),
        h.el('svg', { class: 'br-spark', viewBox: '0 0 ' + w + ' ' + ht, width: String(w), height: String(ht), 'aria-hidden': 'true' },
          h.el('polyline', { points: poly, fill: 'none', stroke: 'var(--accent)', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
        )
      )
    )
  );
}`,
    css: `.br-wrap { display: grid; gap: 12px; }
.br-empty { margin: 0; color: var(--text-3); font-size: 0.85rem; }
.br-metrics { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.br-cell { display: grid; gap: 2px; min-width: 110px; }
.br-lbl { font-size: 0.72rem; color: var(--text-3); font-weight: 620; }
.br-val { font-family: var(--font-display); font-size: 1.15rem; color: var(--text); font-variant-numeric: tabular-nums; }
.br-status { margin-left: auto; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 680; }
.br-status[data-tone="steady"] { background: var(--under-soft); color: var(--under-text); }
.br-status[data-tone="warm"] { background: var(--warn-soft); color: var(--warn-text); }
.br-status[data-tone="hot"] { background: var(--over-soft); color: var(--over-text); }
.br-bottom { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.br-gauge { flex: 1 1 220px; height: 10px; border-radius: 999px; background: var(--bg-sunken); overflow: hidden; }
.br-gauge-bar { height: 100%; border-radius: 999px; }
.br-gauge-bar[data-tone="steady"] { background: var(--under); }
.br-gauge-bar[data-tone="warm"] { background: var(--warn); }
.br-gauge-bar[data-tone="hot"] { background: var(--over); }
.br-spark { flex: 0 0 auto; border-radius: var(--r-sm); background: var(--bg-sunken); padding: 2px; }`,
  },
]
