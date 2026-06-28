// ── RENDER: VITALS ─────────────────────────────────────────────────────────
// ── POTATES SCORE — 0 to 100, two windows (weekly / monthly).
// Five pillars: calorie adherence (35), movement (25), micros (15),
// water (10), logging (10). Score anchors:
//   100 = perfect week across all pillars
//    70 = meaningful effort + real progress toward goal
//    50 = static / not losing weight
//     0 = consistently unhealthy, no effort
//
// Calorie adherence can go negative (down to –50 total) when
// overshooting is severe — this prevents logging from inflating a bad week.
// ──────────────────────────────────────────────────────────────────────────

// Calorie pillar scoring (35 pts), per spec — directional: only OVERSHOOT
// (eating more than target) is penalised by either mechanism below.
// Undershoot (including an occasional planned fast) never costs points here.
//
// Two independent mechanisms run on the (overshoot-only) numbers, and the
// stricter (lower) of the two wins:
//
// MECHANISM A — blowout-count (consistency penalty, floored at 20):
//  - overWeek = max(0, (totKcal-totTarget)/totTarget)
//  - blowoutCount = # days where dayPct > 0.40 (single-day overeating)
//  - 0–1 blowout day AND overWeek <= 0.07  → full 35
//  - 2+ blowout days AND overWeek <= 0.07  → 20–28, scaled by blowout
//    count/severity (consistency penalty even though the week nets out fine)
//  - otherwise → decays from there as overWeek grows and/or more blowout
//    days pile up, but never below 20 — this mechanism alone can't zero
//    the pillar out; see mechanism B for that.
//
// MECHANISM B — chronic-overshoot curve (sustained drift, 0–35, see
// _chronicOvershootScore below): catches the case mechanism A can miss on
// its own — every day moderately over target (e.g. +20%), never crossing
// the 40% single-day blowout line, but consistently working against weight
// loss. This is the only mechanism that can take the pillar below 20.
//   <=7% weekly average over target  -> 35 (full marks, genuinely fine)
//   25% weekly average over target   -> ~17.5 (half marks — still static,
//                                       not losing, but not collapsing)
//   >=35% weekly average over target -> 0
// Power curve (p=1.5) so the drop accelerates past the 7% line rather than
// being linear — "pretty quickly" past the point of being acceptable.
//
// Deliberately NOT mutually exclusive: when blowout days are themselves the
// cause of a bad weekly average, both mechanisms flagging it isn't double
// counting — it's two lenses agreeing, which is the stronger signal.
function _chronicOvershootScore(weekPct) {
  const ZERO_AT = 0.35;
  const FLOOR = 0.07;
  const P = 1.5;
  if (weekPct <= FLOOR) return 35;
  if (weekPct >= ZERO_AT) return 0;
  const frac = (weekPct - FLOOR) / (ZERO_AT - FLOOR);
  return 35 * (1 - Math.pow(frac, P));
}

function _calorieWeekScore(weekPct, dayScores) {
  // Directional: this mechanism is about OVEREATING specifically — a goal of
  // losing weight means undershoot (incl. an occasional planned fast) is not
  // penalised here. weekPct/day pct below 0 never count as "blowouts" or
  // "drift" in this function; clamp to 0 before applying any of this logic.
  const overWeek = Math.max(0, weekPct);
  const blowouts = dayScores.filter(d => d.pct > 0.40);
  const blowoutCount = blowouts.length;

  // Severity of blowouts: how far past 0.40 each one goes, averaged.
  // 0 = barely over the line, larger = deep blowouts. Used only to place
  // the score within the 20–28 band when blowoutCount >= 2.
  const avgOverage = blowoutCount
    ? blowouts.reduce((a,d) => a + (d.pct - 0.40), 0) / blowoutCount
    : 0;

  let blowoutScore;
  // Case 1: clean week, at most one slip — full marks.
  if (blowoutCount <= 1 && overWeek <= 0.07) {
    blowoutScore = 35;
  } else if (blowoutCount >= 2 && overWeek <= 0.07) {
    // Case 2: week nets out fine, but 2+ inconsistent days — scale 20–28.
    // More/worse blowouts push toward 20; exactly 2 mild ones sit near 28.
    const countFactor = Math.min(1, (blowoutCount - 2) / 3);      // 2→0, 5+→1
    const severityFactor = Math.min(1, avgOverage / 0.40);         // +40%over40% → 1
    const severity = Math.max(countFactor, severityFactor);
    blowoutScore = Math.round(28 - severity * 8);
  } else {
    // Case 3: week average has actually drifted past tolerance — decay from
    // the edge of the 20–28 band, so this stays continuous with case 2
    // rather than jumping. Floored at 20: this blowout-count mechanism on
    // its own never drops below 20, no matter how many blowout days there
    // are — going lower than 20 is the chronic-overshoot curve's job
    // (below), which looks at the sustained average rather than day-count.
    const driftBeyond = overWeek - 0.07;            // how far past the 7% line
    const driftFactor = Math.min(1, driftBeyond / 0.33); // fully bottomed out by ~40% drift
    const blowoutFactor = Math.min(1, blowoutCount / 5);  // more bad days = worse
    const severityFactor = Math.min(1, avgOverage / 0.40);
    const decay = Math.max(driftFactor, blowoutFactor * 0.6 + severityFactor * 0.4);
    const startPts = blowoutCount >= 2 ? 28 : 35;
    blowoutScore = Math.max(20, Math.round(startPts * (1 - decay)));
  }

  // Chronic-overshoot check (see _chronicOvershootScore above) runs
  // independently and the stricter (lower) score wins. This is the ONLY
  // path that can take the score below 20 — and that's deliberate: when
  // blowout days are the actual cause of a bad weekly average, both
  // mechanisms correctly flagging the same problem is not double-counting,
  // it's two lenses agreeing, which is the stronger deterrent signal.
  const chronicScore = _chronicOvershootScore(overWeek);
  return Math.max(0, Math.round(Math.min(blowoutScore, chronicScore)));
}

// Core per-person scorer. Returns a rich breakdown object.
function potatesScoreForPerson(person, dates) {
  // Today is always partial/in-progress (the day isn't over, eating/logging
  // isn't finished) — never let it influence the score. This is a hard
  // exclusion applied once, here, so every pillar below inherits it
  // automatically rather than each pillar needing its own today-guard.
  dates = dates.filter(d => d !== todayStr());

  const RDA = {
    magnesium_mg:375, vitd_mcg:15, iron_mg:8, calcium_mg:1000,
    zinc_mg:10, b12_mcg:2.4, omega3_g:1.6, potassium_mg:3500,
    vitc_mg:80, folate_mcg:400
  };

  // Pull each date's entries for this person ONCE — every pillar below reads
  // from this cache instead of re-scanning the full S.entries array per date.
  // Same data, same filters, just fetched once. See groupEntriesByPersonDate.
  const grouped = groupEntriesByPersonDate(S.entries);
  const dayCache = new Map();
  dates.forEach(d => dayCache.set(d, grouped.get(person+'|'+d) || []));

  // ── PILLAR 1: Calorie adherence (35 pts) ──────────────────────────────
  // Week average vs target, penalised for inconsistent (>40%-off) days.
  // See _calorieWeekScore for the exact rule.
  const dayScores = [];
  let totKcal = 0, totTarget = 0;
  dates.forEach(date => {
    const dm = dayCache.get(date).filter(e =>
      e.record_type==='meal' && !e.hypo_correction
    );
    if (!dm.length) return;
    const kcal = dm.reduce((a,e) => a+(e.calories||0), 0);
    const snap = dm.find(e => e.day_kcal_target > 0);
    // No saved target snapshot for this day → fall back to the saved mission
    // target (S.mission[person].kcal). This matches exactly what the UI display
    // uses for the "+209 kcal vs target" line, keeping scorer and display consistent.
    // calculateDailyTarget() is intentionally NOT used here — it can drift from
    // the saved target as workout data changes, producing a different baseline
    // than what was shown to the user on that day.
    const live = S.mission[person] && S.mission[person].kcal;
    const target = (snap && snap.day_kcal_target) || live;
    if (!target) return;
    totKcal += kcal; totTarget += target;
    dayScores.push({ date, pct: (kcal-target)/target });
  });
  const weekPct = totTarget > 0 ? (totKcal - totTarget) / totTarget : 0;
  const calPts = dayScores.length ? _calorieWeekScore(weekPct, dayScores) : 0;

  // ── PILLAR 2: Movement (25 pts — 5 sub-pillars × 5 pts) ───────────────
  // Targets scale proportionally to active days logged.
  // Steps 7000/day | Zone2 150min/wk | HIIT 30min/wk | Strength 90min/wk | Mobility 5min/day
  const activeDays = new Set();
  dates.forEach(d => {
    if (dayCache.get(d).some(e => e.record_type==='meal'||e.record_type==='workout')) activeDays.add(d);
  });
  const nD = activeDays.size || 1;
  const wf = nD / 7;

  let totSteps = 0;
  activeDays.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&e.workout_type==='Walking')
      .forEach(w=>{ totSteps+=(w.steps_logged||0); });
  });
  const avgSteps = totSteps / nD;
  const stepsPts = activeDays.size===0 ? null : Math.min(5, Math.round(Math.max(0,(avgSteps-2000)/(7000-2000))*5));

  let zone2Min = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      ((e.workout_type==='Cardio'&&(e.intensity==='Zone2'||e.intensity==='Medium'))||e.workout_type==='Cardio-Zone2'))
      .forEach(w=>{ zone2Min+=(w.duration_min||0); });
  });
  const zone2Pts = (zone2Min===0&&activeDays.size===0) ? null : Math.min(5,Math.round((zone2Min/Math.max(1,150*wf))*5));

  let hiitMin = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      ((e.workout_type==='Cardio'&&e.intensity==='HIIT')||e.workout_type==='Cardio-HIIT'||e.workout_type==='HIIT'))
      .forEach(w=>{ hiitMin+=(w.duration_min||0); });
  });
  const hiitPts = (hiitMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round((hiitMin/Math.max(1,30*wf))*5));

  let strengthMin = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&e.workout_type==='Strength')
      .forEach(w=>{ strengthMin+=(w.duration_min||0); });
  });
  const strengthPts = (strengthMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round((strengthMin/Math.max(1,90*wf))*5));

  let totMobMin = 0;
  activeDays.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      (e.workout_type==='Mobility'||e.workout_type==='Stretching'||e.workout_type==='Yoga'))
      .forEach(w=>{ totMobMin+=(w.duration_min||0); });
  });
  const avgMobMin = totMobMin / nD;
  const mobilityPts = (totMobMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round(Math.max(0,avgMobMin/5)*5));

  const moveSubs = { stepsPts, zone2Pts, hiitPts, strengthPts, mobilityPts };
  const moveActiveKeys = Object.keys(moveSubs).filter(k=>moveSubs[k]!==null);
  const moveRaw = moveActiveKeys.reduce((a,k)=>a+moveSubs[k],0);
  const moveMax = moveActiveKeys.length * 5;
  const movePtsScaled = moveActiveKeys.length===0 ? null : Math.round((moveRaw/Math.max(1,moveMax))*25);

  // ── PILLAR 3: Micronutrients (15 pts) ─────────────────────────────────
  const microKeys = Object.keys(RDA);
  let microSum=0, microDays=0;
  dates.forEach(date => {
    const dm = dayCache.get(date).filter(e=>e.record_type==='meal'&&e.full_day);
    if (!dm.length) return;
    const hits = microKeys.map(key => {
      const rdaV = (key==='iron_mg'&&person==='gabi') ? 18 : RDA[key];
      let tot = dm.reduce((a,e)=>a+(e[key]||0),0);
      if (key==='vitd_mcg') tot += VITD_SUN_CREDIT_MCG;
      return Math.min(1, tot/rdaV);
    });
    microSum += hits.reduce((a,v)=>a+v,0)/hits.length;
    microDays++;
  });
  const microPts = microDays>0 ? Math.round((microSum/microDays)*15) : null;

  // ── PILLAR 4: Water (10 pts) ───────────────────────────────────────────
  let wHit=0, wTotal=0;
  const wGoal = getWaterGoal(person);
  dates.forEach(date => {
    if (!dayCache.get(date).some(e=>e.record_type==='meal')) return;
    wTotal++;
    if (getWaterMlForEntry(getWaterEntry(person,date)) >= wGoal) wHit++;
  });
  const waterPts = wTotal>0 ? Math.round((wHit/wTotal)*10) : null;

  // ── PILLAR 5: Logging quality (10 pts) — per person ───────────────────
  let logSum=0, logDays=0;
  dates.forEach(date => {
    const dm = dayCache.get(date).filter(e=>e.record_type==='meal');
    if (!dm.length) return;
    logDays++;
    const full = dm.some(e=>e.full_day), two = dm.length>=2;
    logSum += full ? 1.0 : two ? 0.5 : 0.1;
  });
  const logPts = logDays>0 ? Math.round((logSum/logDays)*10) : 0;

  // ── Assemble — only pillars with data count toward denominator ─────────
  const pillars = [
    {pts:calPts,           max:35, has:dayScores.length>0},
    {pts:movePtsScaled??0, max:25, has:movePtsScaled!==null},
    {pts:microPts??0,      max:15, has:microPts!==null},
    {pts:waterPts??0,      max:10, has:waterPts!==null},
    {pts:logPts,           max:10, has:logDays>0},
  ];
  const availMax = pillars.filter(p=>p.has).reduce((a,p)=>a+p.max,0)||100;
  const rawSum   = pillars.filter(p=>p.has).reduce((a,p)=>a+p.pts,0);
  const total    = Math.max(-50, Math.min(100, availMax<100 ? Math.round((rawSum/availMax)*100) : rawSum));

  return {
    total, availableMax:availMax,
    calPts, movePts:movePtsScaled??0,
    moveDetail:{stepsPts:stepsPts??0,zone2Pts:zone2Pts??0,hiitPts:hiitPts??0,strengthPts:strengthPts??0,mobilityPts:mobilityPts??0},
    moveData:{avgSteps:Math.round(avgSteps),zone2Min:Math.round(zone2Min),hiitMin:Math.round(hiitMin),strengthMin:Math.round(strengthMin),avgMobMin:Math.round(avgMobMin)},
    microPts:microPts??0, waterPts:waterPts??0, waterHitDays:wHit, waterTotalDays:wTotal,
    logPts, logDays,
    hasData:{cal:dayScores.length>0,move:movePtsScaled!==null,micro:microPts!==null,water:waterPts!==null}
  };
}

function potatesScoreForWindow(dates) {
  return potatesScoreForPerson(S.currentPerson, dates).total;
}
function potatesWeeklyScore()  { return potatesScoreForWindow(dateRangeFor('week')); }
function potatesMonthlyScore() { return potatesScoreForWindow(dateRangeFor('month')); }
function checkTreatTokenStreak() {
  // Awards a treat token when the weekly Potates Score hits 70+
  // (the "meaningful effort + real progress" anchor). Uses the same
  // sustained-for-a-week check as before to avoid one-off spikes.
  const today7 = potatesWeeklyScore();
  if (today7 < 70) return;
  // Token already tracked in S.treatTokens; award once per qualifying week
  // by checking a last-awarded date stamp to avoid double-counting.
  const lastAward = S.treatTokens.lastAwardDate;
  if (lastAward === todayStr()) return;
  const sevenDaysAgo = (() => { const d=new Date(); d.setDate(d.getDate()-7); return toLocalDateStr(d); })();
  if (lastAward && lastAward > sevenDaysAgo) return; // already awarded this week
  S.treatTokens.gabi = (S.treatTokens.gabi||0); // tokens are shared/household, kept as one counter below
  S.treatTokens.shared = (S.treatTokens.shared||0) + 1;
  S.treatTokens.lastAwardDate = todayStr();
  showToast('🎉 Treat token unlocked!');
}
function useTreatToken() {
  if (!S.treatTokens.shared) { showToast('No treat tokens yet'); return; }
  S.treatTokens.shared -= 1;
  save();
  renderVitals();
  showToast('Treat used — enjoy it, no moralising 🙂');
}

// ── LOWS — visible, time-stamped panel of today's low-sugar corrections.
// Not framed as a calorie count against the person; it's a clinical log so
// patterns (time of day, after which meals) are visible to Gabi and her
// endocrinologist, while staying excluded from the calorie target math.
function renderLowsPanel(person, date) {
  if (person !== 'gabi') return ''; // only Gabi logs hypo corrections
  const lows = S.entries.filter(e => e.record_type==='meal' && e.person===person && e.date===date && e.hypo_correction);
  if (!lows.length) return '';
  const rows = lows.sort((a,b)=>(a.logged_at||'').localeCompare(b.logged_at||''))
    .map(e => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0"><span>${e.logged_at||''} · ${e.meal}</span></div>`).join('');
  return `<div class="wk-block" style="border-color:var(--terra)">
    <div class="meals-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--terra);text-transform:uppercase;margin-bottom:4px">🩸 Lows today</div>
    ${rows}
  </div>`;
}

// ── MICRONUTRIENTS — shown directly on Vitals (no extra click needed).
// "See more" stays reserved for evolution-over-time charts only.
// VITD_SUN_CREDIT_MCG: Valencia gets strong, near year-round sun, and skin
// synthesis is a major real source of vitamin D alongside diet — so a 0mcg
// dietary intake isn't actually a 0% day. This is a rough, labelled estimate,
// not a medical figure; adjust it in code if you want it tighter or looser.
const VITD_SUN_CREDIT_MCG = 10;
function renderMicronutrientsCard(person) {
  const entries = S.entries || [];
  const dates = [];
  for (let i=29;i>=0;i--) { const d = new Date(); d.setDate(d.getDate()-i); dates.push(toLocalDateStr(d)); }

  // Fetch each day's meals ONCE — completeDays filter and the per-nutrient
  // average below both read from this cache instead of re-scanning all
  // entries per day per nutrient (was up to 330 full-array scans per call).
  const grouped = groupEntriesByPersonDate(entries);
  const dayMealsCache = new Map();
  dates.forEach(d => {
    const all = grouped.get(person+'|'+d) || [];
    dayMealsCache.set(d, all.filter(e=>e.record_type==='meal'));
  });

  const completeDays = dates.filter(d => {
    const dm = dayMealsCache.get(d);
    return dm.some(e=>e.full_day) && dm.length > 0;
  });
  if (!completeDays.length) return '';

  const RDA = {
    magnesium_mg:{label:'Magnesium',rda:375}, vitd_mcg:{label:'Vitamin D ☼',rda:15},
    iron_mg:{label:'Iron (Gabi:18, Nacho:8)',rda:8}, calcium_mg:{label:'Calcium',rda:1000},
    zinc_mg:{label:'Zinc',rda:10}, b12_mcg:{label:'B12',rda:2.4},
    omega3_g:{label:'Omega-3',rda:1.6}, potassium_mg:{label:'Potassium',rda:3500},
    vitc_mg:{label:'Vitamin C',rda:80}, folate_mcg:{label:'Folate',rda:400}
  };

  const microHtml = Object.entries(RDA).map(([key, {label, rda}]) => {
    const rdaActual = (key==='iron_mg' && person==='gabi') ? 18 : rda;
    let avg = completeDays.reduce((acc,d) => {
      const dm = dayMealsCache.get(d);
      return acc + dm.reduce((a,b)=>a+(b[key]||0),0);
    },0) / completeDays.length;
    if (key === 'vitd_mcg') avg += VITD_SUN_CREDIT_MCG;
    const pct = Math.round((avg/rdaActual)*100);
    const cls = pct < 70 ? 'low' : 'ok';
    return `<div class="trend-micro-row">
      <span class="trend-micro-lbl">${label}</span>
      <span class="trend-micro-val ${cls}">${avg.toFixed(1)} (${pct}% RDA)</span>
    </div>`;
  }).join('');

  return `<div class="trend-card">
    <div class="trend-card-title ${person==='gabi'?'tc-gabi':'tc-nacho'}">${person==='gabi'?'Gabi':'Nacho'} — micronutrients avg (complete days)</div>
    <div style="font-size:11px;color:var(--terra);margin-bottom:8px">Red = below 70% RDA · ☼ Vitamin D incl. +${VITD_SUN_CREDIT_MCG}mcg est. from Valencia sun exposure</div>
    ${microHtml}
    <div style="font-size:11px;color:var(--mist);margin-top:8px">Based on ${completeDays.length} complete day${completeDays.length!==1?'s':''} (last 30)</div>
  </div>`;
}

function renderVitals() {
  // Block render only if we have neither server data nor local cache to show.
  // Once _cacheRendered is set (by init after load()), we paint from whatever
  // is in S — giving instant content from localStorage while Firebase loads.
  // The first successful _fetchFromServer will re-render with server data.
  if (!cloudReady && !_cacheRendered) {
    const el = document.getElementById('vitals-body');
    if (el) el.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--mist);font-family:\'JetBrains Mono\',monospace;font-size:12px;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
    return;
  }
  const person = S.currentPerson;
  const m = S.mission[person];
  const color = person === 'gabi' ? 'var(--gabi-c)' : 'var(--nacho-c)';
  const dates = dateRangeFor(S.period);
  const meals = entriesFor(person, dates, 'meal');
  const workouts = entriesFor(person, dates, 'workout');

  // Hypo corrections (fast sugar + slow carb for a low blood-sugar episode)
  // are real meals for macro/micro purposes, but are never counted against
  // the calorie target — that's the whole point of a correction. Every
  // calorie-vs-target calc below uses kcalMeals; macro/micro/streak displays
  // keep using the full `meals` array.
  const kcalMeals = meals.filter(e => !e.hypo_correction);

  // For week/month averages, today shouldn't count as a "logged day" while
  // it's still in progress — otherwise a half-logged today drags the
  // average down and makes it inconsistent with the full-days-only delta
  // below. Today only counts once it's been marked complete.
  const todayIncomplete = S.period !== 'day' && !meals.some(e => e.date === todayStr() && e.full_day);
  const avgMeals = todayIncomplete ? meals.filter(e => e.date !== todayStr()) : meals;
  const avgKcalMeals = todayIncomplete ? kcalMeals.filter(e => e.date !== todayStr()) : kcalMeals;

  const daysWithEntries = new Set(avgMeals.map(e => e.date));
  const totalKcal = sum(meals, 'calories');
  const totalKcalForTarget = sum(kcalMeals, 'calories');
  const avgKcalPerLoggedDay = daysWithEntries.size ? sum(avgKcalMeals, 'calories') / daysWithEntries.size : 0;

  const fullDates = new Set(meals.filter(e => e.full_day).map(e => e.date));
  let avgDelta = null, avgDeltaCount = 0;
  if (fullDates.size) {
    let acc = 0;
    fullDates.forEach(d => {
      const dayTotal = sum(kcalMeals.filter(e => e.date === d), 'calories');
      acc += (dayTotal - m.kcal);
    });
    avgDelta = acc / fullDates.size;
    avgDeltaCount = fullDates.size;
  }

  // ── hero stat ──
  const heroKcal = S.period === 'day' ? totalKcalForTarget : avgKcalPerLoggedDay;
  const heroLabel = S.period === 'day' ? 'kcal logged today' : 'avg kcal / logged day';
  const pct = m.kcal ? Math.min(100, Math.round((heroKcal / m.kcal) * 100)) : 0;
  const fillColor = pct > 110 ? 'var(--terra)' : pct > 85 ? 'var(--sage)' : 'var(--ochre)';
  const isToday = S.period === 'day';
  const todayFull = isToday && fullDates.has(todayStr());
  const todayHypoCount = isToday ? meals.filter(e => e.date===todayStr() && e.hypo_correction).length : 0;

  let deltaBlock = '';
  if (isToday) {
    const delta = totalKcalForTarget - m.kcal;
    const remaining = m.kcal - totalKcalForTarget;
    const remainingLine = (!todayFull && remaining > 0)
      ? `<div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--sage);margin-bottom:2px">${Math.round(remaining)} kcal remaining today</div>`
      : '';
    deltaBlock = `${remainingLine}<div class="deficit-note">${todayFull ? 'Marked as a full day' : 'Incomplete day — not all meals logged'}${todayHypoCount ? ` · ${todayHypoCount} hypo correction${todayHypoCount>1?'s':''} excluded from target` : ''}</div>`;
  } else if (avgDelta !== null) {
    const deltaColor = avgDelta > 100 ? 'var(--terra)' : avgDelta < -100 ? 'var(--ochre)' : 'var(--sage)';
    deltaBlock = `<div class="deficit-label" style="color:${deltaColor}">${avgDelta>=0?'+':''}${Math.round(avgDelta)} kcal vs target, on average</div>
      <div class="deficit-note">Based on ${avgDeltaCount} fully-logged day${avgDeltaCount!==1?'s':''} in this period · hypo corrections excluded from target</div>`;
  } else {
    deltaBlock = `<div class="deficit-note" style="margin-top:6px">No fully-logged days in this period yet — deficit can't be calculated honestly from partial data.</div>`;
  }

  // Hero number shown as logged/target fraction, using the static base
  // target only — no workout/activity data involved in this calculation.
  const heroNumId = 'hero-kcal-' + person;
  const heroFraction = isToday
    ? `<span id="${heroNumId}" data-target-num="${Math.round(heroKcal)}">0</span><span class="hero-frac-sep">/</span><span class="hero-frac-target">${m.kcal}</span>`
    : `<span id="${heroNumId}" data-target-num="${Math.round(heroKcal)}">0</span>`;

  const heroHtml = `
    <div class="day-card">
      <div class="day-card-hdr">
        <div class="day-card-name"><div class="dot" style="background:${color}"></div><span style="color:${color}">${isToday ? 'Today\'s calories' : (S.period === 'week' ? 'Weekly average' : 'Monthly average')}</span></div>
        <div class="status-tag ${isToday ? (todayFull?'tag-complete':(meals.length?'tag-incomplete':'tag-neutral')) : (daysWithEntries.size?'tag-neutral':'tag-neutral')}">
          ${isToday
            ? (meals.length ? (todayFull ? 'Full day' : meals.length + ' meal' + (meals.length!==1?'s':'') + ' · incomplete') : 'No entries yet')
            : (daysWithEntries.size ? daysWithEntries.size + ' day' + (daysWithEntries.size!==1?'s':'') + ' logged' : 'No data yet')}
        </div>
      </div>
      <div class="day-card-body">
        ${daysWithEntries.size === 0 && S.period !== 'day'
          ? `<div style="color:var(--mist);font-size:13px;padding:8px 0">Log meals to see your ${S.period}ly averages.</div>`
          : `<div class="big-kcal">${heroFraction}<span>${heroLabel}</span></div>
        <div class="deficit-bar"><div class="deficit-fill" data-target-pct="${pct}" style="width:0%;background:${fillColor}"></div></div>
        ${deltaBlock}`}
      </div>
    </div>`;

  // ── workout tally ──
  let wkHtml = '';
  if (workouts.length) {
    const byType = {};
    workouts.forEach(w => {
      const key = w.workout_type || 'Workout';
      if (!byType[key]) byType[key] = { count:0, minutes:0 };
      byType[key].count++;
      byType[key].minutes += (w.duration_min||0);
    });
    const maxCount = Math.max(...Object.values(byType).map(v=>v.count));
    const lines = Object.entries(byType).sort((a,b)=>b[1].count-a[1].count).map(([type,v]) => `
      <div class="wk-line"><span>${type}</span><span class="wk-count">${v.count}× · ${v.minutes}min</span></div>
      <div class="wk-bar-bg"><div class="wk-bar-fill" style="width:${(v.count/maxCount*100)}%"></div></div>
    `).join('');
    wkHtml = `<div class="wk-block">
      <div class="meals-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">Movement · ${S.period}</div>
      <div class="wk-row">${lines}</div>
    </div>`;
  } else {
    wkHtml = `<div class="wk-block"><div class="meals-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">Movement · ${S.period}</div><div style="color:var(--mist);font-size:13px">No workouts logged in this period yet.</div></div>`;
  }

  document.getElementById('vitals-body').innerHTML = renderPotatesHero() + heroHtml + renderMicronutrientsCard(person) + wkHtml + renderLowsPanel(person, todayStr());
  requestAnimationFrame(() => {
    document.querySelectorAll('#vitals-body .deficit-fill[data-target-pct]').forEach(bar => {
      requestAnimationFrame(() => { bar.style.width = bar.dataset.targetPct + '%'; });
    });
    document.querySelectorAll('#vitals-body [data-target-num]').forEach(numEl => {
      animateCountTo(numEl, numEl.dataset.targetNum, { duration: 500 });
    });
  });
}

// ── RENDER: PROGRESS (bottom-nav tab) ───────────────────────────────────────
// Macro donut moved out of Vitals (Fix 3) — same calorie/macro-contribution
// calc logic as before, just rendered into its own tab's container instead
// of being inlined inside renderVitals(). Reuses the same period (S.period)
// and person (S.currentPerson) state Vitals uses, so switching Day/Week/Month
// or Gabi/Nacho elsewhere stays consistent here too.
function renderProgress() {
  if (!cloudReady && !_cacheRendered) {
    const el = document.getElementById('progress-body');
    if (el) el.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--mist);font-family:\'JetBrains Mono\',monospace;font-size:12px;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
    return;
  }
  const person = S.currentPerson;
  const m = S.mission[person];
  const dates = dateRangeFor(S.period);
  const meals = entriesFor(person, dates, 'meal');

  const isToday = S.period === 'day';
  const todayIncomplete = S.period !== 'day' && !meals.some(e => e.date === todayStr() && e.full_day);
  const avgMeals = todayIncomplete ? meals.filter(e => e.date !== todayStr()) : meals;
  const daysWithEntries = new Set(avgMeals.map(e => e.date));
  const totalKcal = sum(meals, 'calories');

  // ── donut (macros, by calorie contribution) ──
  const nDays = isToday ? 1 : (daysWithEntries.size || 1);
  const donutMeals = isToday ? meals : avgMeals;
  const protein = sum(donutMeals,'protein_g') / nDays, carbs = sum(donutMeals,'carbs_g') / nDays, fat = sum(donutMeals,'fat_g') / nDays;
  const displayKcal = isToday ? totalKcal : Math.round(sum(donutMeals,'calories') / nDays);
  const macroLabel = isToday ? `Macros logged · today` : `Avg macros / logged day · ${S.period}`;
  const pKcal = protein*4, cKcal = carbs*4, fKcal = fat*9;
  const macroTotal = pKcal+cKcal+fKcal;
  let donutBg = S.currentPerson === 'gabi' ? 'var(--gabi-moon-edge)' : 'var(--clay)';
  if (macroTotal > 0) {
    const p1 = (pKcal/macroTotal*100).toFixed(1);
    const p2 = (p1*1 + cKcal/macroTotal*100).toFixed(1);
    donutBg = `conic-gradient(var(--sage) 0% ${p1}%, var(--ochre) ${p1}% ${p2}%, var(--terra) ${p2}% 100%)`;
  }
  const donutHtml = `
    <div class="donut-block">
      <div class="meals-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">${macroLabel}</div>
      <div class="donut-row">
        <div class="donut-wrap">
          <div class="donut" style="background:${donutBg}"></div>
          <div class="donut-hole">
            <div class="donut-hole-kcal">${displayKcal}</div>
            <div class="donut-hole-lbl">kcal</div>
          </div>
        </div>
        <div class="donut-legend">
          <div class="legend-item"><div class="legend-dot" style="background:var(--sage)"></div><span class="legend-txt">Protein</span><span class="legend-val">${Math.round(protein)}g / ${m.protein||'—'}g</span></div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--ochre)"></div><span class="legend-txt">Carbs</span><span class="legend-val">${Math.round(carbs)}g / ${m.carbs||'—'}g</span></div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--terra)"></div><span class="legend-txt">Fat</span><span class="legend-val">${Math.round(fat)}g / ${m.fat||'—'}g</span></div>
        </div>
      </div>
    </div>`;

  document.getElementById('progress-body').innerHTML = donutHtml;
}

function renderPotatesHero() {
  const isMonth = S.period === 'month';
  const score = isMonth ? potatesMonthlyScore() : potatesWeeklyScore();
  const label = isMonth ? '30 days' : '7 days';
  checkTreatTokenStreak();
  const tokens = S.treatTokens.shared || 0;
  const barPct = Math.max(0, Math.min(100, score));

  // Color & glow logic
  let scoreColor, barGlow, barOpacity, statusLabel, barAnim;
  if (score >= 100) {
    scoreColor = 'var(--sage)';
    barGlow = '0 0 6px 2px #7ec89a, 0 0 18px 6px #7ec89a, 0 0 38px 12px #4db87888';
    barOpacity = 1;
    statusLabel = 'Legendary';
    barAnim = 'glow-green-strong 2.8s ease-in-out infinite';
  } else if (score >= 90) {
    scoreColor = 'var(--sage)';
    barGlow = '0 0 5px 2px #7ec89a, 0 0 14px 5px #7ec89a99';
    barOpacity = 1;
    statusLabel = 'Peak Form';
    barAnim = 'glow-green-medium 3.2s ease-in-out infinite';
  } else if (score >= 70) {
    scoreColor = 'var(--sage)';
    barGlow = '0 0 4px 1px #7ec89a66, 0 0 8px 2px #7ec89a44';
    barOpacity = 1;
    statusLabel = 'Good Health';
    barAnim = 'glow-green-subtle 4s ease-in-out infinite';
  } else if (score >= 50) {
    scoreColor = 'var(--ochre)';
    barGlow = 'none';
    barOpacity = 0.85;
    statusLabel = 'Holding Steady';
    barAnim = 'none';
  } else if (score >= 40) {
    scoreColor = 'var(--ochre)';
    barGlow = 'none';
    barOpacity = 0.55;
    statusLabel = 'Needs Work';
    barAnim = 'none';
  } else if (score >= 20) {
    scoreColor = 'var(--terra)';
    barGlow = '0 0 4px 1px #cc443366, 0 0 10px 3px #cc443344';
    barOpacity = 0.9;
    statusLabel = 'Warning Zone';
    barAnim = 'glow-red-subtle 3.2s ease-in-out infinite';
  } else {
    scoreColor = 'var(--terra)';
    barGlow = '0 0 5px 2px #cc4433aa, 0 0 16px 6px #cc443377, 0 0 28px 10px #cc443344';
    barOpacity = 1;
    statusLabel = 'Critical';
    barAnim = 'glow-red-strong 2.8s ease-in-out infinite';
  }

  // Landmark markers: position%, label
  const scoreDates = dateRangeFor(isMonth ? 'month' : 'week');
  const bd = potatesScoreForPerson(S.currentPerson, scoreDates);
  const bdr = (lbl, pts, max, note) => {
    const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((pts/max)*100))) : 0;
    return '<div class="pbd-row">' +
      '<div class="pbd-row-top">' +
        '<span class="pbd-lbl">' + lbl + '</span>' +
        '<span class="pbd-note">' + note + '</span>' +
        '<span class="pbd-pts">' + pts + '/' + max + '</span>' +
      '</div>' +
      '<div class="pbd-bar-bg"><div class="deficit-fill pbd-bar-fill" data-target-pct="' + pct + '"></div></div>' +
    '</div>';
  };
  const bdSection = (emoji, title) =>
    '<div class="pbd-section" style="font-family:\'JetBrains Mono\',monospace;font-size:9px;letter-spacing:1px;color:var(--ochre);text-transform:uppercase;margin:8px 0 4px">' + emoji + ' ' + title + '</div>';
  const bdHtml =
    '<div class="pbd-wrap" id="potates-breakdown"><div style="margin-top:10px;padding:0 16px;text-align:left">' +
    bdSection('🥗','Food') +
    bdr('Calorie adherence', bd.calPts, 35, !bd.hasData.cal ? 'no data yet' : '') +
    bdr('Micronutrients', bd.microPts, 15, !bd.hasData.micro ? 'needs full-logged days' : '') +
    bdSection('🏃','Movement') +
    bdr('Steps', bd.moveDetail.stepsPts, 5, bd.moveData.avgSteps > 0 ? 'avg ' + bd.moveData.avgSteps.toLocaleString() + ' steps/day' : 'no data') +
    bdr('Zone 2 cardio', bd.moveDetail.zone2Pts, 5, bd.moveData.zone2Min > 0 ? bd.moveData.zone2Min + ' min this period' : 'no data') +
    bdr('VO₂max / HIIT', bd.moveDetail.hiitPts, 5, bd.moveData.hiitMin > 0 ? bd.moveData.hiitMin + ' min this period' : 'no data') +
    bdr('Strength', bd.moveDetail.strengthPts, 5, bd.moveData.strengthMin > 0 ? bd.moveData.strengthMin + ' min this period' : 'no data') +
    bdr('Mobility', bd.moveDetail.mobilityPts, 5, bd.moveData.avgMobMin > 0 ? 'avg ' + bd.moveData.avgMobMin + ' min/day' : 'no data') +
    bdSection('💧','Water') +
    bdr('Water', bd.waterPts, 10, bd.hasData.water ? bd.waterHitDays + ' of ' + bd.waterTotalDays + ' days hit goal' : 'no data') +
    bdSection('📋','Logging') +
    bdr('Logging quality', bd.logPts, 10, bd.logDays > 0 ? bd.logDays + ' day' + (bd.logDays!==1?'s':'') + ' logged' : 'nothing yet') +
    (bd.availableMax < 100 ? '<div style="font-size:10px;color:var(--mist);margin-top:6px;font-style:italic">Score scaled to available data (' + bd.availableMax + '/100 pts active)</div>' : '') +
    '</div></div>';
  return `<div class="day-card potates-score-card" style="border-color:var(--ochre);margin-bottom:10px">
    <div class="day-card-body" style="text-align:center;padding:10px 0 8px">
      <div class="potates-score-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--ochre);text-transform:uppercase;margin-bottom:4px">Potates Score · ${label}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:18px;letter-spacing:3px;color:${scoreColor};opacity:0.85;margin-bottom:4px;text-transform:uppercase;transition:color .4s">${statusLabel}</div>
      <div class="big-kcal" style="font-size:42px;color:${scoreColor};margin-bottom:8px;transition:color .4s"><span id="potates-score-num" data-target-num="${score}">0</span><span style="font-size:18px;color:var(--mist)">/100</span></div>
      <div style="display:flex;align-items:center;gap:10px;margin:0 16px 6px">
        <div style="position:relative;flex:1">
          <div class="deficit-bar" style="height:5px;margin-bottom:0;overflow:visible">
            <div class="deficit-fill potates-score-bar" data-target-pct="${barPct}" style="height:100%;border-radius:2px;width:0%;background:${scoreColor};box-shadow:${barGlow};opacity:${barOpacity};animation:${barAnim};transition:width .5s ease,opacity .4s ease;"></div>
          </div>
        </div>
        <span id="potates-bd-toggle" class="pbd-arr" onclick="toggleScoreBreakdown()"></span>
      </div>
      ${tokens ? `<button class="btn btn-sage btn-sm" onclick="useTreatToken()" style="margin-top:8px">🎉 Use treat (${tokens})</button>` : ''}
      ${bdHtml}
    </div>
  </div>`;
}

function toggleScoreBreakdown() {
  const panel = document.getElementById('potates-breakdown');
  const arrow = document.getElementById('potates-bd-toggle');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    requestAnimationFrame(() => {
      panel.querySelectorAll('.pbd-bar-fill[data-target-pct]').forEach(bar => {
        requestAnimationFrame(() => { bar.style.width = bar.dataset.targetPct + '%'; });
      });
    });
  }
  if (arrow) arrow.classList.toggle('open', !isOpen);
}


