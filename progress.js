// ── PROGRESS (bottom-nav tab) — trends & evolution ──────────────────────────

function renderProgress() {
  if (!cloudReady && !_cacheRendered) {
    const el = document.getElementById('trends-body');
    if (el) el.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--mist);font-family:\'JetBrains Mono\',monospace;font-size:12px;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
    return;
  }
  renderTrends();
}

function makeSVGLine(points, color, width, height, target) {
  if (points.length < 2) return `<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}"></svg>`;
  const vals = points.map(p=>p.y);
  let minV = Math.min(...vals), maxV = Math.max(...vals);
  if (target!=null) { minV = Math.min(minV, target); maxV = Math.max(maxV, target); }
  const rawRange = maxV - minV || 1;
  // Extra headroom top/bottom so the smoothed curve's overshoot near sharp
  // turns never gets clipped by the viewBox edges.
  const breathing = rawRange * 0.18;
  minV -= breathing; maxV += breathing;
  const range = maxV - minV || 1;
  const padX = 6, padY = 10;
  const coords = points.map((p,i) => ({
    x: padX + (i/(points.length-1)) * (width - padX*2),
    y: padY + (1 - (p.y - minV)/range) * (height - padY*2)
  }));
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i-1,0)];
      const p1 = pts[i];
      const p2 = pts[i+1];
      const p3 = pts[Math.min(i+2, pts.length-1)];
      const t = 0.15; // gentler tension — less overshoot on sharp turns
      const cp1x = p1.x + (p2.x - p0.x) * t;
      const cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t;
      const cp2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }
  const linePath = smoothPath(coords);
  const lastX = coords[coords.length-1].x;
  const fillPath = linePath + ` L ${lastX.toFixed(1)},${height} L ${padX},${height} Z`;
  const gid = 'grad-' + color.replace(/[^a-z0-9]/g,'');
  let targetLine = '';
  if (target!=null) {
    const ty = padY + (1 - (target - minV)/range) * (height - padY*2);
    targetLine = `<line x1="${padX}" y1="${ty.toFixed(1)}" x2="${(width-padX).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" stroke-width="0.75" stroke-opacity="0.55" stroke-dasharray="4,3"/>`;
  }
  return `<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${fillPath}" fill="url(#${gid})" />
    ${targetLine}
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${coords.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2" fill="${color}"/>`).join('')}
  </svg>`;
}

function setProgressPeriod(period) {
  S.progressPeriod = period;
  // Sync the inline period bar buttons (rendered inside #trends-body)
  document.querySelectorAll('.prog-period-opt').forEach(el => {
    const p = el.textContent.trim().toLowerCase();
    el.classList.toggle('active', p === period);
  });
  renderTrends();
}

// Weight / Food / Activity — selected in the header toggle (#hdr-toggle-history).
// Syncs header button active states and re-renders.
function setProgressCategory(category) {
  S.progressCategory = category;
  ['weight','food','activity'].forEach(c => {
    const el = document.getElementById('prog-cat-' + c);
    if (el) el.classList.toggle('active', c === category);
  });
  renderTrends();
}

// The four workout types a person can log, in fixed display order — kept in
// one place so the "always show all four, even at zero" guarantee can't
// silently drift if a type is added/renamed in the logging UI later.
const WORKOUT_TYPES = ['Walking', 'Cardio', 'Strength', 'Mobility'];
const WORKOUT_TYPE_ICON = { Walking:'🚶', Cardio:'🔥', Strength:'💪', Mobility:'🧘' };

function renderTrends() {
  const el = document.getElementById('trends-body');
  if (!el) return;
  const wl = S.weightLog || [];
  const entries = S.entries || [];
  const person = S.currentPerson;
  const themeClass = person==='gabi' ? 'tc-gabi' : 'tc-nacho';
  const color = person==='gabi' ? '#6BA3C8' : '#C8863A';

  // Date range driven by the Week/Month/Year toggle in the header
  // (#hdr-toggle-history). Defaults to 'month' (the original 30-day window)
  // if S.progressPeriod hasn't been set yet.
  const progressPeriod = S.progressPeriod || 'month';
  const progressCategory = S.progressCategory || 'weight';
  const rangeDays = progressPeriod === 'week' ? 7 : progressPeriod === 'year' ? 365 : progressPeriod === 'max' ? 1825 : 30;
  const dates = [];
  for (let i=rangeDays-1;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    dates.push(toLocalDateStr(d));
  }
  const rangeLabel = progressPeriod === 'week' ? 'last 7 days' : progressPeriod === 'year' ? 'last 365 days' : progressPeriod === 'max' ? 'all time' : 'last 30 days';

  // Fetch each day's entries for this person ONCE — the calorie/protein/water
  // blocks below each used to re-scan the full entries array per day; they
  // now read from this cache and apply their own specific sub-filters to it.
  const grouped = groupEntriesByPersonDate(entries);
  const dayEntriesCache = new Map();
  dates.forEach(d => dayEntriesCache.set(d, grouped.get(person+'|'+d) || []));

  // ── Stock-market style period bar — Week / Month / Year / Max ──
  // Renders above the first chart, inside the content area (not the header).
  // Matches the stock-chart aesthetic from the reference screenshots.
  const progressPeriod = S.progressPeriod || 'month';
  const periodBarHtml = `<div class="prog-period-bar">
    <span class="prog-period-opt${progressPeriod==='week'?' active':''}" onclick="setProgressPeriod('week')">Week</span>
    <span class="prog-period-sep">|</span>
    <span class="prog-period-opt${progressPeriod==='month'?' active':''}" onclick="setProgressPeriod('month')">Month</span>
    <span class="prog-period-sep">|</span>
    <span class="prog-period-opt${progressPeriod==='year'?' active':''}" onclick="setProgressPeriod('year')">Year</span>
    <span class="prog-period-sep">|</span>
    <span class="prog-period-opt${progressPeriod==='max'?' active':''}" onclick="setProgressPeriod('max')">Max</span>
  </div>`;

  let html = '';

  // ── WEIGHT CHART ──
  if (progressCategory === 'weight') {
    const wLogs = wl.filter(w=>w.person===person).sort((a,b)=>a.date.localeCompare(b.date));
    const mission = S.mission[person];
    const startW = wLogs.length ? wLogs[0].kg : mission.weight;
    const latestW = wLogs.length ? wLogs[wLogs.length-1].kg : mission.weight;
    const delta = (latestW - startW).toFixed(1);
    const goalW = mission.goal1yWeight || (mission.weight + (mission.goal3kg||0));

    const points = wLogs.map(w=>({x:w.date, y:w.kg}));
    const svg = makeSVGLine(points, color, 320, 80, goalW);
    const labels = wLogs.length >= 2
      ? [wLogs[0].date.slice(5), wLogs[wLogs.length-1].date.slice(5)]
      : ['—','—'];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Weight</div>
      <div class="mini-chart">${svg}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${latestW}</div>
          <div class="trend-stat-lbl">Current kg</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${parseFloat(delta)<0?'var(--sage)':parseFloat(delta)>0?'var(--terra)':'var(--mist)'}">${delta>0?'+':''}${delta}</div>
          <div class="trend-stat-lbl">Change kg</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${goalW}</div>
          <div class="trend-stat-lbl">Goal kg</div>
        </div>
      </div>
      ${wLogs.length < 2 ? '<div style="font-size:12px;color:var(--mist);margin-top:10px">Log more weight entries in Mission to see the chart.</div>' : ''}
    </div>`;
  }

  // ── CALORIE TREND (last 30 days, complete days only) ──
  if (progressCategory === 'food') {
    const target = S.mission[person].kcal;
    const completeDays = dates.map(d => {
      const dayAll = dayEntriesCache.get(d);
      const dayMeals = dayAll.filter(e=>e.record_type==='meal'&&!e.hypo_correction);
      const isComplete = dayAll.some(e=>e.record_type==='meal'&&e.full_day);
      const total = dayMeals.reduce((a,b)=>a+(b.calories||0),0);
      return { date:d, total, isComplete };
    }).filter(d=>d.isComplete&&d.total>0);

    const points = completeDays.map(d=>({x:d.date, y:d.total}));
    const svg = makeSVGLine(points, color, 320, 80, target);
    const avg = completeDays.length ? Math.round(completeDays.reduce((a,b)=>a+b.total,0)/completeDays.length) : 0;
    const avgDelta = avg - target;
    const labels = completeDays.length >= 2
      ? [completeDays[0].date.slice(5), completeDays[completeDays.length-1].date.slice(5)]
      : ['—','—'];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Calories</div>
      <div class="mini-chart">${svg}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${avg||'—'}</div>
          <div class="trend-stat-lbl">Avg kcal</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${target}</div>
          <div class="trend-stat-lbl">Target</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';const p=Math.abs((avg-target)/target*100);return p<=5?'var(--sage)':p<=12?'#8fba6a':p<=25?'var(--ochre)':'var(--terra)';})()}">${(()=>{if(!avg||!target)return'—';const p=Math.abs((avg-target)/target*100);return p<=5?'Impeccable':p<=8?'Excellent':p<=12?'Good':p<=18?'Fair':p<=25?'Off track':p<=35?'Poor':'Very poor';})()}</div>
          <div class="trend-stat-lbl">Avg vs target</div>
        </div>
      </div>
      ${completeDays.length < 3 ? '<div style="font-size:12px;color:var(--mist);margin-top:10px">Not enough complete days yet. Keep logging!</div>' : ''}
    </div>`;
  }

  // ── PROTEIN TREND ──
  if (progressCategory === 'food') {
    const proteinColor = '#7A9E7E';
    const target = S.mission[person].protein;
    const completeDays = dates.map(d => {
      const dayMeals = dayEntriesCache.get(d).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      const total = dayMeals.reduce((a,b)=>a+(b.protein_g||0),0);
      return { date:d, total, isComplete };
    }).filter(d=>d.isComplete&&d.total>0);

    const avg = completeDays.length ? Math.round(completeDays.reduce((a,b)=>a+b.total,0)/completeDays.length) : 0;
    const points = completeDays.map(d=>({x:d.date, y:d.total}));
    const svg = makeSVGLine(points, proteinColor, 320, 80, target);
    const labels = completeDays.length >= 2
      ? [completeDays[0].date.slice(5), completeDays[completeDays.length-1].date.slice(5)]
      : ['—','—'];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Protein</div>
      <div class="mini-chart">${svg}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${avg||'—'}g</div>
          <div class="trend-stat-lbl">Avg daily</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${target}g</div>
          <div class="trend-stat-lbl">Target</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';const p=(avg-target)/target*100;return p>=0?'var(--sage)':p>=-5?'#8fba6a':p>=-15?'var(--ochre)':'var(--terra)';})()}">${(()=>{if(!avg||!target)return'—';const p=(avg-target)/target*100;return p>=5?'Impeccable':p>=0?'On target':p>=-5?'Close':p>=-10?'A bit low':p>=-18?'Low':'Very low';})()}</div>
          <div class="trend-stat-lbl">Avg vs target</div>
        </div>
      </div>
    </div>`;
  }

  // ── WATER TREND ──
  if (progressCategory === 'food') {
    const waterColor = '#5B8DB8';
    const goal = getWaterGoal(person);
    const waterDays = dates.map(d => {
      const e = dayEntriesCache.get(d).find(en=>en.record_type==='water');
      return { date:d, total: getWaterMlForEntry(e) };
    }).filter(d=>d.total>0);
    const avgWaterMl = waterDays.length ? Math.round(waterDays.reduce((a,b)=>a+b.total,0)/waterDays.length) : 0;
    const points = waterDays.map(d=>({x:d.date, y:d.total}));
    const svg = makeSVGLine(points, waterColor, 320, 80, goal);
    const labels = waterDays.length >= 2 ? [waterDays[0].date.slice(5), waterDays[waterDays.length-1].date.slice(5)] : ['—','—'];
    const bestStreak = (() => {
      let best=0, cur=0;
      dates.forEach(d => {
        const e = dayEntriesCache.get(d).find(en=>en.record_type==='water');
        if (getWaterMlForEntry(e) >= goal) { cur++; best=Math.max(best,cur); } else cur=0;
      });
      return best;
    })();
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Water</div>
      <div class="mini-chart">${svg}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${avgWaterMl||'—'} ml</div><div class="trend-stat-lbl">Avg daily</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${goal} ml</div><div class="trend-stat-lbl">Goal</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${bestStreak}</div><div class="trend-stat-lbl">Best streak</div></div>
      </div>
    </div>`;
  }

  // ── TARGET HIT RATE (steps / workouts — last 30 days; water lives on the
  // Water trend card under Food, so it's dropped from here to avoid showing
  // the same stat twice across two different tabs) ──
  if (progressCategory === 'activity') {
    const targets = dates.map(d => (S.dailyTargets[person]&&S.dailyTargets[person][d]) || {});
    const pct = key => Math.round((targets.filter(t=>t[key]).length / dates.length) * 100);
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Target hit rate, ${rangeLabel}</div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${pct('steps')}%</div><div class="trend-stat-lbl">Steps</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${pct('workout')}%</div><div class="trend-stat-lbl">Workout</div></div>
      </div>
    </div>`;
  }

  // ── STEPS ──
  // Steps are logged as Walking-type workout entries (walkBy:'steps'), so
  // this pulls steps_logged off that subset specifically rather than off
  // duration_min, which Walking entries logged by time won't have set.
  if (progressCategory === 'activity') {
    const stepGoal = (S.settings.movementTargets[person]||{}).steps_day || 10000;
    const stepDays = dates.map(d => {
      const dayWalks = dayEntriesCache.get(d).filter(e=>e.record_type==='workout'&&e.workout_type==='Walking');
      const total = dayWalks.reduce((a,b)=>a+(b.steps_logged||0),0);
      return { date:d, total };
    }).filter(d=>d.total>0);
    const avgSteps = stepDays.length ? Math.round(stepDays.reduce((a,b)=>a+b.total,0)/stepDays.length) : 0;
    const points = stepDays.map(d=>({x:d.date, y:d.total}));
    const stepColor = '#9C8AC4';
    const svg = makeSVGLine(points, stepColor, 320, 80, stepGoal);
    const labels = stepDays.length >= 2 ? [stepDays[0].date.slice(5), stepDays[stepDays.length-1].date.slice(5)] : ['—','—'];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Steps</div>
      <div class="mini-chart">${svg}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${avgSteps||'—'}</div><div class="trend-stat-lbl">Avg daily</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${stepGoal}</div><div class="trend-stat-lbl">Goal</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${stepDays.length}</div><div class="trend-stat-lbl">Days logged</div></div>
      </div>
      ${stepDays.length === 0 ? '<div style="font-size:12px;color:var(--mist);margin-top:10px">No steps logged this period. Log Walking by step count to see this chart.</div>' : ''}
    </div>`;
  }

  // ── WORKOUTS, BY TYPE ──
  // Always renders a card for all four workout types (Walking, Cardio,
  // Strength, Mobility), even when a type has zero sessions in range — this
  // is what makes movement visible for whichever of Gabi/Nacho favours a
  // different mix of types instead of one person's untouched types just
  // disappearing from the screen.
  if (progressCategory === 'activity') {
    const pw = entries.filter(e=>e.record_type==='workout'&&e.person===person);
    const last30 = pw.filter(w=>dates.includes(w.date));

    const totalSessions = last30.length;
    const totalBurn = Math.round(last30.reduce((a,b)=>a+(b.calories_burned||0),0));
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Workouts (${rangeLabel})</div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${totalSessions}</div>
          <div class="trend-stat-lbl">Sessions</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${totalBurn}</div>
          <div class="trend-stat-lbl">kcal burned</div>
        </div>
      </div>
    </div>`;

    let typeRows = '';
    WORKOUT_TYPES.forEach(type => {
      const typeSessions = last30.filter(w=>w.workout_type===type);
      const count = typeSessions.length;
      const minutes = Math.round(typeSessions.reduce((a,b)=>a+(b.duration_min||0),0));
      const burn = Math.round(typeSessions.reduce((a,b)=>a+(b.calories_burned||0),0));
      const dimmed = count === 0 ? 'opacity:0.55' : '';
      typeRows += `<div class="trend-stat-row" style="${dimmed}">
        <div class="trend-stat">
          <div class="trend-stat-val" style="font-size:15px">${WORKOUT_TYPE_ICON[type]} ${type}</div>
          <div class="trend-stat-lbl">Type</div>
        </div>
        <div class="trend-stat"><div class="trend-stat-val">${count}</div><div class="trend-stat-lbl">Sessions</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${minutes}</div><div class="trend-stat-lbl">Minutes</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${burn}</div><div class="trend-stat-lbl">kcal</div></div>
      </div>`;
    });
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">By type, ${rangeLabel}</div>
      ${typeRows}
    </div>`;
  }

  el.innerHTML = periodBarHtml + (html || '<div class="empty-state">Not enough data yet.<br>Keep logging meals and weight.</div>');
}
