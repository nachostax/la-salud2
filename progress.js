// ── PROGRESS (bottom-nav tab) — trends & evolution ──────────────────────────

function renderProgress() {
  if (!cloudReady && !_cacheRendered) {
    const el = document.getElementById('trends-content');
    if (el) el.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--mist);font-family:\'Space Grotesk\',sans-serif;font-size:12px;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
    return;
  }
  renderTrends();
}

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
// Breaks a coords array (with null gaps) into contiguous segments and
// builds the line + fill path strings. Shared by makeSVGLine (static
// render) and the period-switch animation loop (interpolated frames) so
// both draw gaps identically.
function buildLineAndFill(coords, height) {
  const segments = [];
  let current = [];
  coords.forEach(c => {
    if (c == null) { if (current.length) segments.push(current); current = []; }
    else current.push(c);
  });
  if (current.length) segments.push(current);
  const linePath = segments.map(seg => smoothPath(seg)).join(' ');
  const fillPath = segments.map(seg => {
    const p = smoothPath(seg);
    const lastX = seg[seg.length-1].x, firstX = seg[0].x;
    return `${p} L ${lastX.toFixed(1)},${height} L ${firstX.toFixed(1)},${height} Z`;
  }).join(' ');
  return { linePath, fillPath };
}

function makeSVGLine(points, color, width, height, target, yAxisMin, unitMode, fixedRange) {
  if (points.length < 2) return { svg:`<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}"></svg>`, labelsHtml:'' };
  const vals = points.map(p=>p.y).filter(v=>v!=null);
  if (!vals.length) return { svg:`<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}"></svg>`, labelsHtml:'' };
  let minV, maxV;
  if (fixedRange) { minV = fixedRange.min; maxV = fixedRange.max; }
  else { minV = Math.min(...vals); maxV = Math.max(...vals); }
  if (target!=null) { minV = Math.min(minV, target); maxV = Math.max(maxV, target); }
  const rawRange = maxV - minV || 1;
  // Extra headroom top/bottom so the smoothed curve's overshoot near sharp
  // turns never gets clipped by the viewBox edges.
  const breathing = rawRange * 0.18;
  minV -= breathing; maxV += breathing;
  const range = maxV - minV || 1;
  const padX = 6, padY = 10;
  // x position is based on the point's index in the FULL date range (even
  // for gaps) so every card's timeline lines up identically; y is null
  // for gap days, which we simply skip when drawing.
  const coords = points.map((p,i) => p.y==null ? null : {
    x: padX + (i/(points.length-1)) * (width - padX*2),
    y: padY + (1 - (p.y - minV)/range) * (height - padY*2),
    date: p.x
  });
  const { linePath, fillPath } = buildLineAndFill(coords, height);
  const gid = 'grad-' + color.replace(/[^a-z0-9]/g,'');
  let targetLine = '';
  let targetLabelY = null;
  if (target!=null) {
    const ty = padY + (1 - (target - minV)/range) * (height - padY*2);
    targetLine = `<line x1="${padX}" y1="${ty.toFixed(1)}" x2="${(width-padX).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" stroke-width="0.75" stroke-opacity="0.55" stroke-dasharray="4,3"/>`;
    targetLabelY = ty;
  }
  // ── AXIS LABELS — rendered as plain HTML text OUTSIDE the SVG (see
  // caller), positioned via % so they never get warped by the chart's
  // scaleX period-switch animation, which only targets the SVG element.
  // Values are compacted (15000 → 15K, 3547 → 3.5K) and, for water,
  // shown in litres instead of ml. ──
  function fmtAxisVal(v) {
    if (v == null) return '';
    if (unitMode === 'L') {
      const l = v / 1000;
      return (Math.round(l*10)/10) + 'L';
    }
    if (Math.abs(v) >= 1000) {
      const k = v / 1000;
      return (Math.abs(k % 1) > 0.001 ? k.toFixed(1) : Math.round(k)) + 'K';
    }
    const r = Math.round(v * 10) / 10;
    return (Math.abs(r % 1) > 0.001) ? r.toFixed(1) : String(Math.round(r));
  }
  const labels = [];
  const bottomLabelVal = yAxisMin != null ? yAxisMin : 0;
  labels.push({ x: padX, y: height - padY + 3, anchor:'start', text: fmtAxisVal(bottomLabelVal) });
  if (targetLabelY != null) {
    const labelY = targetLabelY < padY + 9 ? targetLabelY + 11 : targetLabelY - 3;
    labels.push({ x: padX, y: labelY, anchor:'start', text: fmtAxisVal(target) });
  }
  // ── PEAK OVERSHOOT LABEL (optional) ──
  // If any logged point is significantly over target (>20%), call it out
  // on the right side. Only the single highest point gets a label.
  if (target != null && target > 0) {
    let peakIdx = -1, peakVal = -Infinity;
    points.forEach((p, i) => { if (p.y!=null && p.y > target * 1.2 && p.y > peakVal) { peakVal = p.y; peakIdx = i; } });
    if (peakIdx !== -1) {
      const peakY = coords[peakIdx].y;
      const labelY = peakY < padY + 9 ? peakY + 11 : peakY - 5;
      labels.push({ x: width - padX, y: labelY, anchor:'end', text: fmtAxisVal(peakVal) });
    }
  }
  const labelsHtml = labels.map(l =>
    `<span class="mc-axis-label" style="left:${(l.x/width*100).toFixed(2)}%;top:${(l.y/height*100).toFixed(2)}%;text-align:${l.anchor==='end'?'right':'left'};transform:translate(${l.anchor==='end'?'-100%':'0'},-100%)">${l.text}</span>`
  ).join('');
  const svg = `<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" data-h="${height}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path class="mc-fill" d="${fillPath}" fill="url(#${gid})" />
    ${targetLine}
    <path class="mc-line" d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${coords.filter(c=>c).map(c => `<circle class="mc-dot" data-date="${c.date}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2" fill="${color}"/>`).join('')}
  </svg>`;
  return { svg, labelsHtml };
}

// Positions the sliding underline indicator under the currently-active
// prog-period-opt span. Must be called after the DOM has been written
// (offsetLeft/offsetWidth require a layout pass — use rAF after innerHTML
// sets, or call directly when only classes changed without a re-render).
// Mirrors the moveNavIndicator() pattern from ui.js.
function positionPeriodIndicator() {
  const bar  = document.querySelector('.prog-period-bar');
  const ind  = document.getElementById('prog-period-indicator');
  const active = bar && bar.querySelector('.prog-period-opt.active');
  if (!bar || !ind || !active) return;
  const barRect    = bar.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  ind.style.width     = activeRect.width + 'px';
  ind.style.transform = 'translateX(' + (activeRect.left - barRect.left) + 'px)';
}

function _resamplePath(coords, n) {
  const m = coords.length;
  if (m < 2) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = (i/(n-1)) * (m-1);
    const lo = Math.floor(f), hi = Math.min(lo+1, m-1), t = f - lo;
    out.push({ x: coords[lo].x + (coords[hi].x-coords[lo].x)*t, y: coords[lo].y + (coords[hi].y-coords[lo].y)*t });
  }
  return out;
}
function _easeOutCubic(t) { return 1 - Math.pow(1-t, 3); }

function setProgressPeriod(period) {
  if (period === (S.progressPeriod || 'month')) return;
  // Capture each dot's CURRENT position (by date), plus the raw curve's
  // coordinate list, before the re-render swaps the DOM out from under
  // us — this is what lets a specific day slide from where it was to
  // where it lands, and the area/line genuinely follow it, instead of
  // the chart just scaling or crossfading as a blob.
  const oldByChart = Array.from(document.querySelectorAll('#trends-content .mini-chart')).map(chart => {
    const dotMap = new Map();
    const coords = [];
    chart.querySelectorAll('circle.mc-dot').forEach(c => {
      const p = { cx:+c.getAttribute('cx'), cy:+c.getAttribute('cy') };
      dotMap.set(c.dataset.date, p);
      coords.push({ x:p.cx, y:p.cy });
    });
    return { dotMap, coords };
  });
  S.progressPeriod = period;
  renderTrends();
  const newCharts = document.querySelectorAll('#trends-content .mini-chart');
  newCharts.forEach((chart, i) => {
    const old = oldByChart[i];
    if (!old) return;
    const dots = chart.querySelectorAll('circle.mc-dot');
    const newCoords = Array.from(dots).map(c => ({ x:+c.getAttribute('cx'), y:+c.getAttribute('cy') }));
    const line = chart.querySelector('.mc-line');
    const fill = chart.querySelector('.mc-fill');
    const svgEl = chart.querySelector('.mini-chart-svg');
    const height = svgEl ? +svgEl.dataset.h || 80 : 80;
    const finalLineD = line ? line.getAttribute('d') : null;
    const finalFillD = fill ? fill.getAttribute('d') : null;
    const N = 24;
    const oldR = _resamplePath(old.coords, N);
    const newR = _resamplePath(newCoords, N);
    const canMorph = oldR && newR && line && fill;

    // Dots: slide each matched date in a straight line from old → new.
    dots.forEach(dot => {
      const date = dot.dataset.date;
      const newCx = +dot.getAttribute('cx'), newCy = +dot.getAttribute('cy');
      const prev = old.dotMap.get(date);
      if (prev) {
        dot.style.transition = 'none';
        dot.style.transform = `translate(${(prev.cx-newCx).toFixed(1)}px,${(prev.cy-newCy).toFixed(1)}px)`;
        requestAnimationFrame(() => {
          dot.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1)';
          dot.style.transform = 'translate(0,0)';
        });
      } else {
        dot.style.opacity = '0';
        requestAnimationFrame(() => { dot.style.transition = 'opacity .32s ease-out'; dot.style.opacity = '1'; });
      }
    });

    if (canMorph) {
      // Area/line: tween the resampled curve frame-by-frame so the fill
      // visibly follows the dots, then snap to the exact final path
      // (with its real gap segments) once the motion settles.
      const duration = 320;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now-start)/duration);
        const e = _easeOutCubic(t);
        const frame = oldR.map((p,idx) => ({
          x: p.x + (newR[idx].x-p.x)*e,
          y: p.y + (newR[idx].y-p.y)*e
        }));
        const { linePath, fillPath } = buildLineAndFill(frame, height);
        line.setAttribute('d', linePath);
        fill.setAttribute('d', fillPath);
        if (t < 1) requestAnimationFrame(step);
        else { line.setAttribute('d', finalLineD); fill.setAttribute('d', finalFillD); }
      }
      requestAnimationFrame(step);
    } else {
      // Fallback (too few points to morph meaningfully): plain crossfade.
      [line, fill].forEach(p => {
        if (!p) return;
        p.style.opacity = '0';
        requestAnimationFrame(() => { p.style.transition = 'opacity .3s ease-out'; p.style.opacity = '1'; });
      });
    }
  });
}

// ── PROGRESS ACTION BUTTON ────────────────────────────────────────────────
// Updates the label and behaviour of the static "Edit History / Log KG"
// button (#progress-action-btn) to match the currently-active category.
// Default category is 'weight', so the button defaults to "Log KG".
function updateProgressActionBtn() {
  const btn = document.getElementById('progress-action-btn');
  if (!btn) return;
  const isWeight = (S.progressCategory || 'weight') === 'weight';
  btn.textContent = isWeight ? 'Log KG' : 'Edit History';
}

function handleProgressActionBtn() {
  const isWeight = (S.progressCategory || 'weight') === 'weight';
  if (isWeight) {
    // Navigate to the Profile sub-screen, then scroll/focus the current
    // person's weight-log input so the action is immediately obvious.
    showSubSec('profile');
    const inputId = (S.currentPerson === 'gabi' ? 'g' : 'n') + '-weight-log';
    setTimeout(() => {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inp.focus();
      }
    }, 120); // small delay lets showSubSec() finish its transition first
  } else {
    openHistoryFromProgress();
  }
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
  updateProgressActionBtn();
}

// The four workout types a person can log, in fixed display order — kept in
// one place so the "always show all four, even at zero" guarantee can't
// silently drift if a type is added/renamed in the logging UI later.
const WORKOUT_TYPES = ['Walking', 'Cardio', 'Strength', 'Mobility'];
const WORKOUT_TYPE_ICON = { Walking:'🚶', Cardio:'🔥', Strength:'💪', Mobility:'🧘' };

// ── STEP 11 PART C — per-type weekly target config ──────────────────────
// HIIT is NOT a separate workout_type in the logging data (confirmed in
// log.js: both the manual logger's Zone2/HIIT picker and normaliseAIWorkout()
// always store HIIT sessions as workout_type:'Cardio' with intensity:'HIIT',
// vs intensity:'Zone2' for regular cardio). So "Cardio" below means
// Zone2-only — it explicitly excludes intensity:'HIIT' entries, which get
// their own bucket. Strength/Mobility entries never carry a meaningful
// intensity value (normaliseAIWorkout only sets it for Cardio), so no
// filtering needed there beyond workout_type.
//
// Target fields confirmed from settings.js (saveTargets()/renderTargetsBody()):
// sessions live at S.settings.<type>Sessions[person], minutes-per-session at
// S.settings.<type>Mins[person] (Strength has no minutes field — sessions
// only, by design). Weekly minutes target = sessions × minutes-per-session.
//
// floorMin is the minimum logged duration for a session to count toward the
// weekly tally at all (Step 11 Part C's "20-min floor rule", 10-min for
// Mobility) — distinct from the minutes-per-session *target*, which is what
// a "full" session should run, not the bar for counting at all.
const ACTIVITY_TYPES = {
  cardio: {
    label: 'Cardio (Zone 2)',
    color: '#C8863A',
    match: e => e.workout_type === 'Cardio' && e.intensity !== 'HIIT',
    floorMin: 20,
    sessionsTarget: p => (S.settings.cardioSessions && S.settings.cardioSessions[p]) ?? 3,
    minsPerSession:  p => (S.settings.cardioMins     && S.settings.cardioMins[p])     ?? 30,
    dualLine: true   // sessions/week AND minutes/week are co-equal targets
  },
  hiit: {
    label: 'HIIT',
    color: '#C4614A',
    match: e => e.workout_type === 'Cardio' && e.intensity === 'HIIT',
    floorMin: 20,
    sessionsTarget: p => (S.settings.hiitSessions && S.settings.hiitSessions[p]) ?? 1,
    minsPerSession:  p => (S.settings.hiitMins     && S.settings.hiitMins[p])     ?? 30,
    dualLine: false
  },
  strength: {
    label: 'Strength',
    color: '#9C8AC4',
    match: e => e.workout_type === 'Strength',
    floorMin: 20,
    sessionsTarget: p => (S.settings.strengthSessions && S.settings.strengthSessions[p]) ?? 3,
    minsPerSession: null, // no minutes target for Strength — sessions only
    dualLine: false
  },
  mobility: {
    label: 'Mobility',
    color: '#7A9E7E',
    match: e => e.workout_type === 'Mobility',
    floorMin: 10, // exception to the 20-min floor rule
    sessionsTarget: p => (S.settings.mobilitySessions && S.settings.mobilitySessions[p]) ?? 5,
    minsPerSession:  p => (S.settings.mobilityMins     && S.settings.mobilityMins[p])     ?? 15,
    dualLine: false
  }
};

// Builds the weekly date-buckets for a given Progress period. Per the
// confirmed design decision: Week = 1 bucket, Month = exactly 4 buckets
// (last 28 days, not 30 — "weekly and monthly display will show the same
// for actions with weekly targets as it will only involve 4 weeks"), and
// Year/Max get weekly buckets too but are flagged for smoothing (rolled up
// to ~13 points) since 52+ raw weekly points is too dense for a phone
// screen. Buckets are ordered oldest → newest to match how every other
// chart in this file builds its point arrays.
function getWeekBuckets(progressPeriod) {
  let totalDays;
  if (progressPeriod === 'week')       totalDays = 7;
  else if (progressPeriod === 'month') totalDays = 28;
  else if (progressPeriod === 'year')  totalDays = 364;
  else                                 totalDays = 1820; // 'max' — ~5yr, 260 weeks pre-smoothing

  const totalWeeks = totalDays / 7;
  const weeks = [];
  for (let w = totalWeeks - 1; w >= 0; w--) {
    const weekDates = [];
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(); dt.setDate(dt.getDate() - (w * 7 + d) - 1);
      weekDates.push(toLocalDateStr(dt));
    }
    weeks.push(weekDates);
  }
  const smooth = (progressPeriod === 'year' || progressPeriod === 'max');
  return { weeks, smooth };
}

// Computes the weekly %-of-target series for one activity type. Missing
// weeks read as 0% (no skip/interpolate) per Part C's explicit instruction
// — a visible dip to 0 is the whole point (shows trips, illness, etc.).
function buildActivitySeries(type, person, progressPeriod, entries) {
  const cfg = ACTIVITY_TYPES[type];
  const { weeks, smooth } = getWeekBuckets(progressPeriod);
  const grouped = groupEntriesByPersonDate(entries);

  let weeklyPct = weeks.map(weekDates => {
    let sessions = 0, minutes = 0;
    weekDates.forEach(d => {
      (grouped.get(person + '|' + d) || [])
        .filter(e => e.record_type === 'workout' && cfg.match(e))
        .forEach(e => {
          const dur = e.duration_min || 0;
          if (dur >= cfg.floorMin) { sessions++; minutes += dur; }
        });
    });
    const sessionsTarget = cfg.sessionsTarget(person) || 0;
    const minsTarget = cfg.minsPerSession ? (cfg.minsPerSession(person) || 0) * sessionsTarget : 0;
    return {
      sessionsPct: sessionsTarget > 0 ? (sessions / sessionsTarget) * 100 : 0,
      minutesPct:  minsTarget > 0 ? (minutes / minsTarget) * 100 : null,
      sessions, minutes
    };
  });

  // Year/Max: roll every 4 consecutive weekly points into 1 averaged point
  // (~13 readable points instead of 52+).
  if (smooth) {
    const rolled = [];
    for (let i = 0; i < weeklyPct.length; i += 4) {
      const chunk = weeklyPct.slice(i, i + 4);
      const avgSessions = chunk.reduce((a, b) => a + b.sessionsPct, 0) / chunk.length;
      const mVals = chunk.filter(c => c.minutesPct != null).map(c => c.minutesPct);
      const avgMinutes = mVals.length ? mVals.reduce((a, b) => a + b, 0) / mVals.length : null;
      rolled.push({ sessionsPct: avgSessions, minutesPct: avgMinutes });
    }
    weeklyPct = rolled;
  }

  const avgSessionsPct = weeklyPct.length
    ? weeklyPct.reduce((a, b) => a + b.sessionsPct, 0) / weeklyPct.length
    : 0;

  return { series: weeklyPct, avgSessionsPct };
}

// Single- or dual-line % chart for the Activity redesign (Step 11 Part C).
// Reuses the same smoothing/curve approach as makeSVGLine() but supports
// a second overlaid series (Cardio's sessions% + minutes% lines) and fixes
// the y-axis to 0–100%+ (target is always 100%, per the normalised-%
// design) rather than makeSVGLine()'s data-driven min/max — kept as a
// separate function rather than overloading makeSVGLine() so every
// existing single-series caller (Weight/Calories/etc.) is untouched.
function makeActivitySVG(seriesArr, width, height) {
  const padX = 6, padY = 10;
  const allVals = seriesArr.flatMap(s => s.points.map(p => p.y)).concat([100]);
  let maxV = Math.max(100, ...allVals);
  maxV *= 1.12; // headroom so a >100% peak doesn't clip the top edge
  const minV = 0;
  const range = maxV - minV || 1;

  function coordsFor(points) {
    if (points.length < 2) return null;
    return points.map((p, i) => ({
      x: padX + (i / (points.length - 1)) * (width - padX * 2),
      y: padY + (1 - (p.y - minV) / range) * (height - padY * 2)
    }));
  }
  function smoothPath(pts) {
    let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
      const t = 0.15;
      const cp1x = p1.x + (p2.x - p0.x) * t, cp1y = p1.y + (p2.y - p0.y) * t;
      const cp2x = p2.x - (p3.x - p1.x) * t, cp2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const targetY = padY + (1 - (100 - minV) / range) * (height - padY * 2);
  const targetLine = `<line x1="${padX}" y1="${targetY.toFixed(1)}" x2="${(width - padX).toFixed(1)}" y2="${targetY.toFixed(1)}" stroke="rgba(255,255,255,0.4)" stroke-width="0.75" stroke-opacity="0.55" stroke-dasharray="4,3"/>`;

  let paths = '';
  seriesArr.forEach(s => {
    const coords = coordsFor(s.points);
    if (!coords) return;
    paths += `<path d="${smoothPath(coords)}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    paths += coords.map(c => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2" fill="${s.color}"/>`).join('');
  });

  const bottomY = height - padY + 3;
  const axisLabels = `
    <text x="${padX}" y="${bottomY.toFixed(1)}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="start">0%</text>
    <text x="${padX}" y="${(targetY - 3).toFixed(1)}" font-size="9" fill="rgba(255,255,255,0.35)" text-anchor="start">100%</text>`;

  return `<svg class="mini-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    ${targetLine}
    ${paths}
    ${axisLabels}
  </svg>`;
}

// Weight doesn't get judged against a single daily target like the metrics
// above — it's judged against an expected RATE of change toward the goal
// over the selected period, so it gets its own pacing-specific labels
// ("on pace" / "too slow" / "too fast" / "wrong direction"). Same symmetric
// principle though: drifting too fast is flagged just as much as too slow.
// WEIGHT_PACE_KG_PER_WEEK is a generic placeholder healthy-pace assumption —
// promote this to a per-person setting later if/when one exists.
// STEP 11 PART B: colours migrated from --status-* to the finer --adh-*
// palette so Weight's pacing label shares the same hue-white vocabulary as
// every other trend card. Wording is unchanged — only the colour source.
const WEIGHT_PACE_KG_PER_WEEK = 0.4;
function weightPaceLabel(actualChange, startW, goalW, days) {
  const direction = Math.sign(goalW - startW); // -1 lose, +1 gain, 0 maintain
  if (direction === 0) {
    const a = Math.abs(actualChange);
    if (a <= 0.3) return { label:'On target', color:'var(--adh-great)' };
    if (a <= 1)   return { label:'Drifting', color:'var(--adh-warn)' };
    return { label:'Off target', color:'var(--adh-poor)' };
  }
  const expected = direction * WEIGHT_PACE_KG_PER_WEEK * (days/7);
  const ratio = expected !== 0 ? actualChange/expected : 0;
  if (ratio >= 1.4)  return { label:'Too fast', color:'var(--adh-warn)' };
  if (ratio >= 0.7)  return { label:'On pace', color:'var(--adh-great)' };
  if (ratio >= 0.3)  return { label:'A bit slow', color:'var(--adh-warn)' };
  if (ratio >= -0.2) return { label:'Too slow', color:'var(--adh-warn)' };
  return                    { label:'Wrong direction', color:'var(--adh-poor)' };
}

// ── UNIFIED ADHERENCE LABEL (Step 11 Part A + B) ────────────────────────
// The shared "how close to target" helper described in Step 11 — one
// function, one palette, used by every Progress trend card that fits its
// shape, instead of each card inventing its own scale/wording/colour logic.
//
// STEP 11 PART B — WIRED IN: Calories and Water now call this in 'abs'
// mode (symmetric — too little and too much both move you off target);
// Steps calls it in 'under' mode (extra steps are never penalised). The
// old single-arg adherenceColor()/adherenceLabel(pct) pair (--status-*
// based) has been retired and removed — every call site below now goes
// through getAdherence(), macroAdherence(), or weightPaceLabel().
// Protein/Carbs/Fat use the separate macroAdherence() helper below instead
// (own wording — "On target/Close/A bit low" — since surplus there isn't
// just "fine", it's a genuinely different judgement) and Weight keeps its
// own pacing-based weightPaceLabel() above. Neither is a fit for this
// generic helper, by design, per the Part B inventory.
//
//   pct  = (avg - target) / target * 100   — signed % distance from target
//   mode = 'abs'   → symmetric: distance in EITHER direction is penalised
//                     equally (e.g. Calories, Water — too little and too
//                     much both move you off target).
//          'under' → only being UNDER target is penalised; over is fine
//                     or good (e.g. Steps — extra steps are never bad).
//          'over'  → only being OVER target is penalised; under is fine
//                     (e.g. a strict ceiling).
//
// Tier wording/thresholds below are the Calories 7-tier set from Part B —
// the "Impeccable/Excellent/Good/Fair/Off track/Poor/Very poor" wording
// the client specifically said they liked.
function getAdherence(pct, mode) {
  mode = mode || 'abs';
  let p;
  if (mode === 'under')      p = -pct;   // only "below target" counts as distance
  else if (mode === 'over')  p = pct;    // only "above target" counts as distance
  else                       p = Math.abs(pct); // 'abs' — either direction counts
  p = Math.max(p, 0); // the "good" side of a one-directional mode never penalises

  if (p <= 5)  return { label: 'Impeccable', color: 'var(--adh-great)' };
  if (p <= 8)  return { label: 'Excellent',  color: 'var(--adh-great)' };
  if (p <= 12) return { label: 'Good',       color: 'var(--adh-good)' };
  if (p <= 18) return { label: 'Fair',       color: 'var(--adh-neutral)' };
  if (p <= 25) return { label: 'Off track',  color: 'var(--adh-warn)' };
  if (p <= 35) return { label: 'Poor',       color: 'var(--adh-poor)' };
  return            { label: 'Very poor', color: 'var(--adh-poor)' };
}

// ── STEP 11 PART B — macro-specific wording (Protein/Carbs/Fat) ─────────
// Per the Part B inventory, Protein keeps its own distinct word set rather
// than reusing Calories' "Impeccable/.../Very poor" — surplus isn't
// penalised the way undershooting is, so the judgement reads differently
// ("On target"/"Close"/"Low" instead of "Good"/"Fair"/"Poor"). Carbs and
// Fat were modelled directly on Protein's card (Step 5B), so they share
// this same wording and tier thresholds rather than getAdherence()'s.
// pct is signed: (avg - target) / target * 100 — negative means under.
function macroAdherence(pct) {
  if (pct >= 5)   return { label: 'Impeccable', color: 'var(--adh-great)' };
  if (pct >= 0)   return { label: 'On target',  color: 'var(--adh-great)' };
  if (pct >= -5)  return { label: 'Close',      color: 'var(--adh-good)' };
  if (pct >= -10) return { label: 'A bit low',  color: 'var(--adh-warn)' };
  if (pct >= -18) return { label: 'Low',        color: 'var(--adh-poor)' };
  return                { label: 'Very low',  color: 'var(--adh-poor)' };
}

// ── STEP 11 PART B/C — activity % of weekly target ──────────────────────
// Used by the Workouts summary card's new third stat. Unlike the metrics
// above, this takes an already-normalised 0-100 "% of target achieved"
// value (not a signed distance from target) — the tier thresholds here
// match the Activity redesign's tier list in Part C, reused early since
// the underlying data (days workout target hit, already computed for the
// "Target hit rate" card) is available without needing Part C's full
// per-type weekly-target/week-bucketing work to land first.
function activityAdherence(pctOfTarget) {
  const p = pctOfTarget;
  if (p >= 95) return { label: 'Impeccable', color: 'var(--adh-great)' };
  if (p >= 80) return { label: 'Excellent',  color: 'var(--adh-great)' };
  if (p >= 65) return { label: 'Good',       color: 'var(--adh-good)' };
  if (p >= 50) return { label: 'Fair',       color: 'var(--adh-neutral)' };
  if (p >= 35) return { label: 'Off track',  color: 'var(--adh-warn)' };
  if (p >= 20) return { label: 'Poor',       color: 'var(--adh-poor)' };
  return            { label: 'Very poor', color: 'var(--adh-poor)' };
}

function renderTrends() {
  const el = document.getElementById('trends-content');
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
  for (let i=rangeDays;i>=1;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    dates.push(toLocalDateStr(d));
  }

  // Fetch each day's entries for this person ONCE — the calorie/protein/water
  // blocks below each used to re-scan the full entries array per day; they
  // now read from this cache and apply their own specific sub-filters to it.
  const grouped = groupEntriesByPersonDate(entries);
  const dayEntriesCache = new Map();
  dates.forEach(d => dayEntriesCache.set(d, grouped.get(person+'|'+d) || []));

  // All-time dates this person has ANY entry for — used only to compute a
  // fixed y-axis scale (see globalMinMax) so the vertical scale doesn't
  // jump around as you switch Week/Month/Year/Max; it's always anchored
  // to the full history, same as if you were looking at "Max".
  const allPersonDates = Array.from(new Set(
    Array.from(grouped.keys()).filter(k => k.startsWith(person+'|')).map(k => k.slice(person.length+1))
  ));
  function globalMinMax(extractFn) {
    const vals = allPersonDates.map(extractFn).filter(v => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }

  // ── Stock-market style period bar — Week / Month / Year / Max ──
  // The bar itself lives statically in index.html (like #bnav-indicator)
  // so it and its indicator are never destroyed/recreated on re-render —
  // only its active class is synced here. That's what lets the CSS
  // transition slide smoothly from the old position to the new one,
  // instead of snapping in fresh every time (see moveNavIndicator pattern).
  document.querySelectorAll('.prog-period-opt').forEach(o => {
    o.classList.toggle('active', o.dataset.period === progressPeriod);
  });

  let html = '';

  // ── WEIGHT CHART ──
  if (progressCategory === 'weight') {
    const wLogs = wl.filter(w=>w.person===person).sort((a,b)=>a.date.localeCompare(b.date));
    const mission = S.mission[person];
    const startW = wLogs.length ? wLogs[0].kg : mission.weight;
    const latestW = wLogs.length ? wLogs[wLogs.length-1].kg : mission.weight;
    const delta = (latestW - startW).toFixed(1);
    const goalW = mission.goal1yWeight || (mission.weight + (mission.goal3kg||0));
    const pace = wLogs.length >= 2 ? weightPaceLabel(parseFloat(delta), startW, goalW, rangeDays) : { label:'—', color:'var(--mist)' };

    const points = wLogs.map(w=>({x:w.date, y:w.kg}));
    const { svg, labelsHtml } = makeSVGLine(points, color, 320, 80, goalW, startW);
    const labels = wLogs.length >= 2
      ? [wLogs[0].date.slice(5), wLogs[wLogs.length-1].date.slice(5)]
      : ['—','—'];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Weight</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${latestW}</div>
          <div class="trend-stat-lbl">Current kg</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${goalW}</div>
          <div class="trend-stat-lbl">Goal kg</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${pace.color}">${pace.label}</div>
          <div class="trend-stat-lbl">Pace vs goal</div>
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
    });
    const loggedDays = completeDays.filter(d=>d.isComplete&&d.total>0);

    const points = completeDays.map(d=>({x:d.date, y:(d.isComplete&&d.total>0)?d.total:null}));
    const range = globalMinMax(d => {
      const dayAll = grouped.get(person+'|'+d) || [];
      const isComplete = dayAll.some(e=>e.record_type==='meal'&&e.full_day);
      if (!isComplete) return null;
      const total = dayAll.filter(e=>e.record_type==='meal'&&!e.hypo_correction).reduce((a,b)=>a+(b.calories||0),0);
      return total>0 ? total : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, color, 320, 80, target, null, null, range);
    const avg = loggedDays.length ? Math.round(loggedDays.reduce((a,b)=>a+b.total,0)/loggedDays.length) : 0;
    const avgDelta = avg - target;
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Calories</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
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
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';return getAdherence((avg-target)/target*100,'abs').color;})()}">${(()=>{if(!avg||!target)return'—';return getAdherence((avg-target)/target*100,'abs').label;})()}</div>
          <div class="trend-stat-lbl">Avg vs target</div>
        </div>
      </div>
      ${loggedDays.length < 3 ? '<div style="font-size:12px;color:var(--mist);margin-top:10px">Not enough complete days yet. Keep logging!</div>' : ''}
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
    });
    const loggedDays = completeDays.filter(d=>d.isComplete&&d.total>0);

    const avg = loggedDays.length ? Math.round(loggedDays.reduce((a,b)=>a+b.total,0)/loggedDays.length) : 0;
    const points = completeDays.map(d=>({x:d.date, y:(d.isComplete&&d.total>0)?d.total:null}));
    const range = globalMinMax(d => {
      const dayMeals = (grouped.get(person+'|'+d) || []).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      if (!isComplete) return null;
      const total = dayMeals.reduce((a,b)=>a+(b.protein_g||0),0);
      return total>0 ? total : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, proteinColor, 320, 80, target, null, null, range);
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Protein</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
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
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';return macroAdherence((avg-target)/target*100).color;})()}">${(()=>{if(!avg||!target)return'—';return macroAdherence((avg-target)/target*100).label;})()}</div>
          <div class="trend-stat-lbl">Avg vs target</div>
        </div>
      </div>
    </div>`;
  }

  // ── CARBS TREND ── (Step 5B: new card — same pattern as Protein, surplus
  // isn't penalized so it uses 'signed' mode same as Protein/Water/Steps.)
  if (progressCategory === 'food') {
    const carbsColor = '#C9954B';
    const target = S.mission[person].carbs;
    const completeDays = dates.map(d => {
      const dayMeals = dayEntriesCache.get(d).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      const total = dayMeals.reduce((a,b)=>a+(b.carbs_g||0),0);
      return { date:d, total, isComplete };
    });
    const loggedDays = completeDays.filter(d=>d.isComplete&&d.total>0);

    const avg = loggedDays.length ? Math.round(loggedDays.reduce((a,b)=>a+b.total,0)/loggedDays.length) : 0;
    const points = completeDays.map(d=>({x:d.date, y:(d.isComplete&&d.total>0)?d.total:null}));
    const range = globalMinMax(d => {
      const dayMeals = (grouped.get(person+'|'+d) || []).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      if (!isComplete) return null;
      const total = dayMeals.reduce((a,b)=>a+(b.carbs_g||0),0);
      return total>0 ? total : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, carbsColor, 320, 80, target, null, null, range);
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Carbs</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${avg||'—'}g</div>
          <div class="trend-stat-lbl">Avg daily</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${target||'—'}g</div>
          <div class="trend-stat-lbl">Target</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';return macroAdherence((avg-target)/target*100).color;})()}">${(()=>{if(!avg||!target)return'—';return macroAdherence((avg-target)/target*100).label;})()}</div>
          <div class="trend-stat-lbl">Avg vs target</div>
        </div>
      </div>
    </div>`;
  }

  // ── FAT TREND ── (Step 5B: new card — same pattern as Protein/Carbs.)
  if (progressCategory === 'food') {
    const fatColor = '#8B6BC0';
    const target = S.mission[person].fat;
    const completeDays = dates.map(d => {
      const dayMeals = dayEntriesCache.get(d).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      const total = dayMeals.reduce((a,b)=>a+(b.fat_g||0),0);
      return { date:d, total, isComplete };
    });
    const loggedDays = completeDays.filter(d=>d.isComplete&&d.total>0);

    const avg = loggedDays.length ? Math.round(loggedDays.reduce((a,b)=>a+b.total,0)/loggedDays.length) : 0;
    const points = completeDays.map(d=>({x:d.date, y:(d.isComplete&&d.total>0)?d.total:null}));
    const range = globalMinMax(d => {
      const dayMeals = (grouped.get(person+'|'+d) || []).filter(e=>e.record_type==='meal');
      const isComplete = dayMeals.some(e=>e.full_day);
      if (!isComplete) return null;
      const total = dayMeals.reduce((a,b)=>a+(b.fat_g||0),0);
      return total>0 ? total : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, fatColor, 320, 80, target, null, null, range);
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Fat</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat">
          <div class="trend-stat-val">${avg||'—'}g</div>
          <div class="trend-stat-lbl">Avg daily</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val">${target||'—'}g</div>
          <div class="trend-stat-lbl">Target</div>
        </div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avg||!target)return'var(--mist)';return macroAdherence((avg-target)/target*100).color;})()}">${(()=>{if(!avg||!target)return'—';return macroAdherence((avg-target)/target*100).label;})()}</div>
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
    });
    const loggedWaterDays = waterDays.filter(d=>d.total>0);
    const avgWaterMl = loggedWaterDays.length ? Math.round(loggedWaterDays.reduce((a,b)=>a+b.total,0)/loggedWaterDays.length) : 0;
    const points = waterDays.map(d=>({x:d.date, y:d.total>0?d.total:null}));
    const range = globalMinMax(d => {
      const e = (grouped.get(person+'|'+d) || []).find(en=>en.record_type==='water');
      const t = getWaterMlForEntry(e);
      return t>0 ? t : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, waterColor, 320, 80, goal, null, 'L', range);
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Water</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${avgWaterMl||'—'} ml</div><div class="trend-stat-lbl">Avg daily</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${goal} ml</div><div class="trend-stat-lbl">Goal</div></div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avgWaterMl||!goal)return'var(--mist)';return getAdherence((avgWaterMl-goal)/goal*100,'abs').color;})()}">${(()=>{if(!avgWaterMl||!goal)return'—';return getAdherence((avgWaterMl-goal)/goal*100,'abs').label;})()}</div>
          <div class="trend-stat-lbl">Avg vs goal</div>
        </div>
      </div>
    </div>`;
  }

  // NOTE: the old standalone "Target hit rate" card (raw Steps%/Workout%,
  // no chart, no colour) was REMOVED here per explicit decision — it was
  // fully redundant once Steps got its own adherence chip (below) and
  // Workouts got its own adherence chip (further below), each duplicating
  // one of these two numbers in a more informative, charted form.

  // ── STEPS ──
  // Steps are logged as Walking-type workout entries (walkBy:'steps'), so
  // this pulls steps_logged off that subset specifically rather than off
  // duration_min, which Walking entries logged by time won't have set.
  if (progressCategory === 'activity') {
    // BUG FIX (found while scoping Step 11 Part C): this used to read
    // S.settings.movementTargets[person].steps_day, but settings.js never
    // writes to that path — the Steps target field on the Targets screen
    // (set-steps-${p}) saves to S.mission[person].stepsTarget instead (see
    // settings.js saveTargets(), line ~148). The old reference silently fell
    // through to the 10000 fallback every time, ignoring whatever either of
    // you actually configured.
    const stepGoal = S.mission[person].stepsTarget || 10000;
    const stepDays = dates.map(d => {
      const dayWalks = dayEntriesCache.get(d).filter(e=>e.record_type==='workout'&&e.workout_type==='Walking');
      const total = dayWalks.reduce((a,b)=>a+(b.steps_logged||0),0);
      return { date:d, total };
    });
    const loggedStepDays = stepDays.filter(d=>d.total>0);
    const avgSteps = loggedStepDays.length ? Math.round(loggedStepDays.reduce((a,b)=>a+b.total,0)/loggedStepDays.length) : 0;
    const points = stepDays.map(d=>({x:d.date, y:d.total>0?d.total:null}));
    const stepColor = '#9C8AC4';
    const range = globalMinMax(d => {
      const t = (grouped.get(person+'|'+d) || []).filter(e=>e.record_type==='workout'&&e.workout_type==='Walking').reduce((a,b)=>a+(b.steps_logged||0),0);
      return t>0 ? t : null;
    });
    const { svg, labelsHtml } = makeSVGLine(points, stepColor, 320, 80, stepGoal, null, null, range);
    const labels = [dates[0].slice(5), dates[dates.length-1].slice(5)];

    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Steps</div>
      <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
      <div class="chart-labels"><span>${labels[0]}</span><span>${labels[1]}</span></div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${avgSteps||'—'}</div><div class="trend-stat-lbl">Avg daily</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${stepGoal}</div><div class="trend-stat-lbl">Goal</div></div>
        <div class="trend-stat">
          <div class="trend-stat-val" style="color:${(()=>{if(!avgSteps||!stepGoal)return'var(--mist)';return getAdherence((avgSteps-stepGoal)/stepGoal*100,'under').color;})()}">${(()=>{if(!avgSteps||!stepGoal)return'—';return getAdherence((avgSteps-stepGoal)/stepGoal*100,'under').label;})()}</div>
          <div class="trend-stat-lbl">Avg vs goal</div>
        </div>
      </div>
      ${stepDays.length === 0 ? '<div style="font-size:12px;color:var(--mist);margin-top:10px">No steps logged this period. Log Walking by step count to see this chart.</div>' : ''}
    </div>`;
  }

  // ── ACTIVITY TYPE TREND CARDS (Step 11 Part C) ──
  // % of weekly target achieved, bucketed by week (not by day) since every
  // target here is a weekly one. Missing weeks read as 0%, by design — a
  // visible dip is exactly what shows a trip/illness/dip in routine, which
  // raw daily session-count charts couldn't show clearly. Cardio gets two
  // co-equal lines (sessions% + minutes%); HIIT/Strength/Mobility get one.
  if (progressCategory === 'activity') {
    ['cardio', 'hiit', 'strength', 'mobility'].forEach(typeKey => {
      const cfg = ACTIVITY_TYPES[typeKey];
      const { series, avgSessionsPct } = buildActivitySeries(typeKey, person, progressPeriod, entries);
      const adh = activityAdherence(avgSessionsPct);

      const sessionsPoints = series.map((s, i) => ({ x: i, y: s.sessionsPct }));
      let svg, legend = '';
      if (cfg.dualLine) {
        const minutesPoints = series.map((s, i) => ({ x: i, y: s.minutesPct == null ? 0 : s.minutesPct }));
        svg = makeActivitySVG([
          { points: sessionsPoints, color: cfg.color },
          { points: minutesPoints, color: '#E8D5B0' }
        ], 320, 80);
        legend = `<div style="display:flex;gap:14px;font-size:10px;color:var(--mist);margin:4px 0 0;font-family:'Space Grotesk',sans-serif">
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cfg.color};margin-right:4px"></span>Sessions</span>
          <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#E8D5B0;margin-right:4px"></span>Minutes</span>
        </div>`;
      } else {
        svg = makeActivitySVG([{ points: sessionsPoints, color: cfg.color }], 320, 80);
      }

      const sessionsTarget = cfg.sessionsTarget(person) || 0;
      const minsTarget = cfg.minsPerSession ? (cfg.minsPerSession(person) || 0) * sessionsTarget : null;
      const labelsHtml = ''; // makeActivitySVG doesn't produce axis labels like makeSVGLine does

      html += `<div class="trend-card">
        <div class="trend-card-title ${themeClass}">${cfg.label}</div>
        <div class="mini-chart-wrap"><div class="mini-chart">${svg}</div>${labelsHtml}</div>
        ${legend}
        <div class="trend-stat-row">
          <div class="trend-stat">
            <div class="trend-stat-val">${Math.round(avgSessionsPct)}%</div>
            <div class="trend-stat-lbl">Avg sessions/wk</div>
          </div>
          <div class="trend-stat">
            <div class="trend-stat-val">${sessionsTarget}${minsTarget != null ? ` · ${minsTarget}m` : ''}</div>
            <div class="trend-stat-lbl">Target</div>
          </div>
          <div class="trend-stat">
            <div class="trend-stat-val" style="color:${adh.color}">${adh.label}</div>
            <div class="trend-stat-lbl">Adherence</div>
          </div>
        </div>
      </div>`;
    });
  }

  el.innerHTML = html || '<div class="empty-state">Not enough data yet.<br>Keep logging meals and weight.</div>';
  // Reposition in case the bar just became visible (screen switch) or
  // layout shifted. Since the bar/indicator persist across renders now,
  // this doesn't cause a spurious slide-in on category (Weight/Food/
  // Activity) switches — only setProgressPeriod's active-class change
  // actually moves the indicator, and it animates from its real previous spot.
  requestAnimationFrame(positionPeriodIndicator);
  updateProgressActionBtn();
}
