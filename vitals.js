// Module-level flag: persists POTATES breakdown open/closed state across
// Day/Week/Month re-renders (can't touch state.js — kept here instead).
let _scoreExpanded = false;

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
// ── MOVEMENT TARGETS — single source of truth ──────────────────────────────
// Used by BOTH potatesScoreForPerson() (the score breakdown) and the
// Movement summary card in renderVitals() (the wk-block bars), so the two
// can never drift apart by reading target settings differently.
// Defaults: Steps 7000/day | Zone2 150min/wk | Mobility 2 sessions/wk × 15min
// HIIT & Strength read from the session-based settings (settings.js), not
// the legacy minute-based movementTargets — that schema is stale.
function movementTargetsFor(person) {
  const mt = (S.settings && S.settings.movementTargets && S.settings.movementTargets[person]) || {};
  const ss = S.settings || {};
  return {
    TARGET_ZONE2:     mt.zone2_min_week        || 150,
    TARGET_HIIT_SESS: ss.hiitSessions?.[person]     ?? 1,
    TARGET_HIIT_MINS: ss.hiitMins?.[person]         ?? 30,
    TARGET_STR_SESS:  ss.strengthSessions?.[person] ?? 3,
    TARGET_MOB_SESS:  mt.mobility_sessions_week || 2,
    TARGET_MOB_MIN:   mt.mobility_min_session   || 15,
    TARGET_STEPS:     mt.steps_day              || 7000,
  };
}

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
  const {
    TARGET_ZONE2, TARGET_HIIT_SESS, TARGET_HIIT_MINS, TARGET_STR_SESS,
    TARGET_MOB_SESS, TARGET_MOB_MIN, TARGET_STEPS
  } = movementTargetsFor(person);

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
  const stepsPts = activeDays.size===0 ? null : Math.min(5, Math.round(Math.max(0,(avgSteps-2000)/(TARGET_STEPS-2000))*5));

  let zone2Min = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      ((e.workout_type==='Cardio'&&(e.intensity==='Zone2'||e.intensity==='Medium'))||e.workout_type==='Cardio-Zone2'))
      .forEach(w=>{ zone2Min+=(w.duration_min||0); });
  });
  const zone2Pts = (zone2Min===0&&activeDays.size===0) ? null : Math.min(5,Math.round((zone2Min/Math.max(1,TARGET_ZONE2*wf))*5));

  // HIIT: count sessions of at least 20min (lenient floor under the 30min
  // target) as "achieved". Score scales to 5pts based on sessions achieved
  // vs sessions targeted — not a proportional minutes tally.
  const HIIT_MIN_FLOOR = Math.min(20, TARGET_HIIT_MINS * 0.66);
  let hiitMin = 0, hiitSessionsAchieved = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      (e.workout_type==='HIIT'||e.workout_type==='Cardio-HIIT'||e.workout_type==='VO2Max'||
      (e.workout_type==='Cardio'&&e.intensity==='HIIT')))
      .forEach(w=>{
        hiitMin += (w.duration_min||0);
        if ((w.duration_min||0) >= HIIT_MIN_FLOOR) hiitSessionsAchieved++;
      });
  });
  const hiitSessTarget = Math.max(1, TARGET_HIIT_SESS * wf);
  const vo2maxPts = (hiitMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round((hiitSessionsAchieved/hiitSessTarget)*5));

  let strengthMin = 0, strengthSessionsLogged = 0;
  dates.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&e.workout_type==='Strength')
      .forEach(w=>{ strengthMin+=(w.duration_min||0); strengthSessionsLogged++; });
  });
  const strengthSessTarget = Math.max(1, TARGET_STR_SESS * wf);
  const strengthPts = (strengthMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round((strengthSessionsLogged/strengthSessTarget)*5));

  let totMobMin = 0;
  activeDays.forEach(d => {
    dayCache.get(d).filter(e=>e.record_type==='workout'&&
      (e.workout_type==='Mobility'||e.workout_type==='Stretching'||e.workout_type==='Yoga'))
      .forEach(w=>{ totMobMin+=(w.duration_min||0); });
  });
  const avgMobMin = totMobMin / nD;
  const mobilityTarget = (TARGET_MOB_SESS * TARGET_MOB_MIN) / 7; // convert weekly session target to per-day average
  const mobilityPts = (totMobMin===0&&activeDays.size===0) ? null : Math.min(5,Math.round(Math.max(0,avgMobMin/mobilityTarget)*5));

  const moveSubs = { stepsPts, zone2Pts, vo2maxPts, strengthPts, mobilityPts };
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
    moveDetail:{stepsPts:stepsPts??0,zone2Pts:zone2Pts??0,vo2maxPts:vo2maxPts??0,strengthPts:strengthPts??0,mobilityPts:mobilityPts??0},
    moveData:{avgSteps:Math.round(avgSteps),zone2Min:Math.round(zone2Min),hiitMin:Math.round(hiitMin),hiitSessionsAchieved,strengthMin:Math.round(strengthMin),strengthSessionsLogged,avgMobMin:Math.round(avgMobMin)},
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
  return `<div class="wk-block">
    <div class="meals-label" style="font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:2px;color:var(--terra);text-transform:uppercase;margin-bottom:4px">🩸 Lows today</div>
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
    <div class="box-title">Micronutrients</div>
    ${microHtml}
  </div>`;
}

function renderVitals() {
  // Block render only if we have neither server data nor local cache to show.
  // Once _cacheRendered is set (by init after load()), we paint from whatever
  // is in S — giving instant content from localStorage while Firebase loads.
  // The first successful _fetchFromServer will re-render with server data.
  if (!cloudReady && !_cacheRendered) {
    const el = document.getElementById('vitals-body');
    if (el) el.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--mist);font-family:\'Space Grotesk\',sans-serif;font-size:12px;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
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
  const heroLabel = S.period === 'day' ? 'Today' : 'avg kcal / day';
  const isToday = S.period === 'day';
  const todayFull = isToday && fullDates.has(todayStr());

  // ── 2-segment bar ──
  // Under target: single fill at (consumed / target) %.
  // Over target:  base fill = (target / consumed) %, red overflow to the right.
  // 100% always = total consumed, so the bar never truncates.
  const consumed = Math.round(heroKcal);
  const target   = m.kcal || 1;
  const isOver   = consumed > target;
  let barHtml;
  if (!isOver) {
    const pct = target ? Math.round((consumed / target) * 100) : 0;
    barHtml = `<div class="deficit-bar">
      <div class="deficit-fill" data-target-pct="${pct}" style="width:0%;background:var(--ochre)"></div>
    </div>`;
  } else {
    // base fill occupies (target/consumed)% — that's "100% of target" visually
    const basePct  = Math.round((target   / consumed) * 100);
    const overPct  = 100 - basePct;
    barHtml = `<div class="deficit-bar deficit-bar-over">
      <div class="deficit-fill-base"  style="width:${basePct}%;background:var(--ochre)"></div>
      <div class="deficit-fill-over"  style="width:${overPct}%;background:var(--status-red)"></div>
    </div>`;
  }
  const pct = isOver ? 100 : (target ? Math.round((consumed / target) * 100) : 0);

  // ── +/- kcal line ──
  // goal3kg < 0 → trying to lose; > 0 → trying to gain; 0/null → maintenance.
  const goal3kg    = m.goal3kg || 0;
  const isLosing   = goal3kg < 0;
  const isGaining  = goal3kg > 0;
  const kcalDiff   = Math.round(Math.abs(consumed - target));
  const overThresh = target * 0.25; // >25% over = significantly over

  let statusColor;
  if (isOver) {
    if (isLosing)        statusColor = kcalDiff > overThresh ? 'var(--status-red)' : 'var(--status-orange)';
    else if (isGaining)  statusColor = 'var(--status-green)';
    else                 statusColor = 'var(--status-orange)';
  } else {
    if (isLosing)        statusColor = 'var(--status-green)';
    else if (isGaining)  statusColor = kcalDiff > overThresh ? 'var(--status-red)' : 'var(--status-orange)';
    else                 statusColor = 'var(--status-green)';
  }

  // Muted adherence-hue for the big kcal hero number itself (Step 14,
  // extended per client request to the Calories card's own big number,
  // not just the Potates score digits). Same over/under-target ×
  // losing/gaining branching as statusColor above, mapped onto the
  // --adh-* muted ladder instead — kept as a separate variable since
  // statusColor stays on the vivid --status-* palette and continues to
  // drive the +/- Kcal status line untouched. Falls back to plain bone
  // when there's nothing logged yet, so "0" doesn't render as a false
  // "on target" green.
  let heroNumColor;
  if (isOver) {
    if (isLosing)        heroNumColor = kcalDiff > overThresh ? 'var(--adh-poor)' : 'var(--adh-warn)';
    else if (isGaining)  heroNumColor = 'var(--adh-great)';
    else                 heroNumColor = 'var(--adh-warn)';
  } else {
    if (isLosing)        heroNumColor = 'var(--adh-great)';
    else if (isGaining)  heroNumColor = kcalDiff > overThresh ? 'var(--adh-poor)' : 'var(--adh-warn)';
    else                 heroNumColor = 'var(--adh-great)';
  }
  if (consumed <= 0) heroNumColor = 'var(--bone)';

  let kcalLine = '';
  if (isToday && consumed > 0) {
    const label = isOver
      ? `+${kcalDiff} Kcal`
      : `${kcalDiff} Kcal Left`;
    kcalLine = `<div class="kcal-status-line" style="color:${statusColor}">${label}</div>`;
  }

  let deltaBlock = '';
  if (isToday) {
    // "Marked as a full day" confirms completion alongside the checkmark
    // icon in day-card-hdr; nothing is shown for in-progress days — the
    // old "Incomplete day — not all meals logged" note added noise and
    // was removed (Step 6 Task 1). Hypo-correction count is intentionally
    // NOT repeated here; renderLowsPanel already lists every correction
    // with times below the hero card, so it's the single source for that.
    deltaBlock = todayFull
      ? `${kcalLine}<div class="deficit-note">Marked as a full day</div>`
      : kcalLine;
  } else if (avgDelta !== null) {
    const deltaColor = avgDelta > 100 ? 'var(--terra)' : avgDelta < -100 ? 'var(--ochre)' : 'var(--sage)';
    deltaBlock = `<div class="deficit-label" style="color:${deltaColor};font-size:18px">${avgDelta>=0?'+':''}${Math.round(avgDelta)} kcal</div>`;
  } else {
    deltaBlock = `<div class="deficit-note" style="margin-top:6px">No fully-logged days in this period yet.</div>`;
  }

  // Hero number shown as logged/target fraction (Today) or avg (Week/Month).
  const heroNumId = 'hero-kcal-' + person;
  const heroFraction = isToday
    ? `<span id="${heroNumId}" data-target-num="${Math.round(heroKcal)}" style="color:${heroNumColor};transition:color .4s">0</span><span class="hero-frac-sep">/</span><span class="hero-frac-target">${m.kcal}</span>`
    : `<span id="${heroNumId}" data-target-num="${Math.round(heroKcal)}" style="color:${heroNumColor};transition:color .4s">0</span>`;

  // ── macro donut ──
  // Same calorie-contribution calc as before: protein/carbs/fat averaged
  // per logged day (or just today's totals when S.period === 'day'), then
  // expressed as a % of total macro-calories for the conic-gradient ring.
  const nDaysDonut = isToday ? 1 : (daysWithEntries.size || 1);
  const donutMeals = isToday ? meals : avgMeals;
  const protein = sum(donutMeals,'protein_g') / nDaysDonut, carbs = sum(donutMeals,'carbs_g') / nDaysDonut, fat = sum(donutMeals,'fat_g') / nDaysDonut;
  const displayKcal = isToday ? totalKcal : Math.round(sum(donutMeals,'calories') / nDaysDonut);
  const pKcal = protein*4, cKcal = carbs*4, fKcal = fat*9;
  const macroTotal = pKcal+cKcal+fKcal;
  let donutBg = S.currentPerson === 'gabi' ? 'var(--gabi-moon-edge)' : 'var(--clay)';
  if (macroTotal > 0) {
    const p1 = (pKcal/macroTotal*100).toFixed(1);
    const p2 = (p1*1 + cKcal/macroTotal*100).toFixed(1);
    donutBg = `conic-gradient(var(--sage) 0% ${p1}%, var(--ochre) ${p1}% ${p2}%, #8B6BC0 ${p2}% 100%)`;
  }
  const donutHtml = `
    <div class="donut-block">
      <div class="donut-row">
        <div class="donut-wrap">
          <div class="donut" style="background:${donutBg}"></div>
          <div class="donut-hole">
            <div class="donut-hole-kcal">${displayKcal}</div>
            <div class="donut-hole-lbl">kcal</div>
          </div>
        </div>
        <div class="donut-legend">
          <div class="legend-item"><div class="legend-dot" style="background:var(--sage)"></div><span class="legend-txt">Protein</span><span class="legend-val">${Math.round(protein)} / ${m.protein||'—'}g</span></div>
          <div style="height:1px;background:var(--mist);opacity:0.2;margin:3px 0"></div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--ochre)"></div><span class="legend-txt">Carbs</span><span class="legend-val">${Math.round(carbs)} / ${m.carbs||'—'}g</span></div>
          <div style="height:1px;background:var(--mist);opacity:0.2;margin:3px 0"></div>
          <div class="legend-item"><div class="legend-dot" style="background:#8B6BC0"></div><span class="legend-txt">Fat</span><span class="legend-val">${Math.round(fat)} / ${m.fat||'—'}g</span></div>
        </div>
      </div>
    </div>`;

  const checkmarkSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  // day-card-hdr: use conditional class instead of :empty so whitespace
  // doesn't prevent the collapse when there's no checkmark.
  const heroHtml = `
    <div class="day-card">
      ${isToday && todayFull
        ? `<div class="day-card-hdr"><div class="day-card-check" title="Day complete">${checkmarkSvg}</div></div>`
        : ''}
      <div class="day-card-body">
        <div class="box-title">Calories</div>
        ${daysWithEntries.size === 0 && S.period !== 'day'
          ? `<div style="color:var(--mist);font-size:13px;padding:8px 0">Log meals to see your ${S.period}ly averages.</div>`
          : `<div class="big-kcal ${isToday ? 'big-kcal-today' : 'big-kcal-period'}">${heroFraction}<span class="big-kcal-label">${heroLabel}</span></div>
        ${barHtml}
        ${deltaBlock}
        ${donutHtml}`}
      </div>
    </div>`;

  // ── workout tally ──
  // Mirrors the exact same 5 movement pillars used by the Potate score
  // (Walking/Zone2-Cardio/HIIT/Strength/Mobility) so the bars here always
  // match the score breakdown. Points themselves are never shown here —
  // only counts/minutes/steps for the period.
  let wkHtml = '';
  if (workouts.length) {
    let walkSteps = 0, walkCount = 0;
    let cardioMin = 0, cardioCount = 0;
    let hiitMin = 0, hiitCount = 0, hiitSessionsAchieved = 0;
    let strengthMin = 0, strengthCount = 0;
    let mobMin = 0, mobCount = 0;

    // Same targets the Potates score breakdown reads (movementTargetsFor is
    // the single shared source — see its definition above
    // potatesScoreForPerson) so these bars and that breakdown can never
    // show a different picture of "logged vs target" again.
    const {
      TARGET_ZONE2, TARGET_HIIT_SESS, TARGET_HIIT_MINS, TARGET_STR_SESS,
      TARGET_MOB_SESS, TARGET_MOB_MIN, TARGET_STEPS
    } = movementTargetsFor(person);
    const HIIT_MIN_FLOOR = Math.min(20, TARGET_HIIT_MINS * 0.66);

    workouts.forEach(w => {
      const t = w.workout_type;
      if (t === 'Walking') { walkSteps += (w.steps_logged||0); walkCount++; }
      else if (t === 'HIIT' || t === 'Cardio-HIIT' || t === 'VO2Max' || (t === 'Cardio' && w.intensity === 'HIIT')) {
        hiitMin += (w.duration_min||0); hiitCount++;
        if ((w.duration_min||0) >= HIIT_MIN_FLOOR) hiitSessionsAchieved++;
      }
      else if ((t === 'Cardio' && (w.intensity === 'Zone2' || w.intensity === 'Medium')) || t === 'Cardio-Zone2') { cardioMin += (w.duration_min||0); cardioCount++; }
      else if (t === 'Strength') { strengthMin += (w.duration_min||0); strengthCount++; }
      else if (t === 'Mobility' || t === 'Stretching' || t === 'Yoga') { mobMin += (w.duration_min||0); mobCount++; }
    });

    // Same active-days / week-fraction scaling potatesScoreForPerson uses
    // for this same date range, so a bar at 100% here means the exact same
    // thing "5/5" means in the score breakdown.
    const activeDays = new Set(dates.filter(d =>
      meals.some(e=>e.date===d) || workouts.some(e=>e.date===d)
    ));
    const nD = activeDays.size || 1;
    const wf = nD / 7;

    const avgSteps = walkSteps / nD;
    const stepsPct = Math.max(0, Math.min(1, (avgSteps-2000)/(TARGET_STEPS-2000)));
    const zone2Pct = Math.max(0, Math.min(1, cardioMin/Math.max(1,TARGET_ZONE2*wf)));
    const hiitPct = Math.max(0, Math.min(1, hiitSessionsAchieved/Math.max(1,TARGET_HIIT_SESS*wf)));
    const strengthPct = Math.max(0, Math.min(1, strengthCount/Math.max(1,TARGET_STR_SESS*wf)));
    const mobilityTarget = (TARGET_MOB_SESS * TARGET_MOB_MIN) / 7;
    const avgMobMin = mobMin / nD;
    const mobilityPct = Math.max(0, Math.min(1, mobilityTarget>0 ? avgMobMin/mobilityTarget : 0));

    const pillars = [
      { label:'Walking',  count: walkCount,     pct: stepsPct,    valText: walkSteps ? walkSteps.toLocaleString()+' steps' : '' },
      { label:'Cardio',   count: cardioCount,   pct: zone2Pct,    valText: cardioMin ? cardioCount+'× · '+cardioMin+'min' : '' },
      { label:'HIIT',     count: hiitCount,     pct: hiitPct,     valText: hiitMin ? hiitCount+'× · '+hiitMin+'min' : '' },
      { label:'Strength', count: strengthCount, pct: strengthPct, valText: strengthMin ? strengthCount+'× · '+strengthMin+'min' : '' },
      { label:'Mobility', count: mobCount,      pct: mobilityPct, valText: mobMin ? mobCount+'× · '+mobMin+'min' : '' },
    ].filter(p => p.count > 0);
    const lines = pillars.map(p => `
      <div class="wk-line"><span>${p.label}</span><span class="wk-count">${p.valText}</span></div>
      <div class="wk-bar-bg"><div class="wk-bar-fill" style="width:${Math.round(p.pct*100)}%"></div></div>
    `).join('');
    wkHtml = `<div class="wk-block">
      <div class="box-title">Movement</div>
      <div class="wk-row">${lines}</div>
    </div>`;
  } else {
    wkHtml = `<div class="wk-block"><div class="box-title">Movement</div><div style="color:var(--mist);font-size:13px">No workouts logged in this period yet.</div></div>`;
  }

  // ── water card (Step 10) ──
  // Same .wk-block/.wk-line/.wk-bar-fill markup as Movement, so it reads as
  // the same kind of "logged vs target" card. Deliberately NOT computed
  // independently the way Movement's bars originally were (see Step 9) —
  // this uses the exact same inputs (getWaterGoal/getWaterEntry/
  // getWaterMlForEntry) and the exact same day-counting rule (a day counts
  // only if a meal was logged that day) and the exact same today-exclusion
  // as PILLAR 4 in potatesScoreForPerson, so this bar and the Water score
  // row can never show a different picture of the same data. Always
  // rendered uncollapsed — no separate expand/collapse state for this card.
  let waterHtml = '';
  {
    const waterDates = dates.filter(d => d !== todayStr());
    const wGoal = getWaterGoal(person);
    let wHit = 0, wTotal = 0;
    waterDates.forEach(date => {
      if (!meals.some(e => e.date === date)) return;
      wTotal++;
      if (getWaterMlForEntry(getWaterEntry(person, date)) >= wGoal) wHit++;
    });
    const waterPct = wTotal > 0 ? wHit / wTotal : 0;
    waterHtml = wTotal > 0
      ? `<div class="wk-block">
          <div class="box-title">Water</div>
          <div class="wk-row">
            <div class="wk-line"><span>Water</span><span class="wk-count">${wHit} of ${wTotal} days hit goal</span></div>
            <div class="wk-bar-bg"><div class="wk-bar-fill" style="width:${Math.round(waterPct*100)}%"></div></div>
          </div>
        </div>`
      : `<div class="wk-block"><div class="box-title">Water</div><div style="color:var(--mist);font-size:13px">No water data logged in this period yet.</div></div>`;
  }

  // Calories + Micronutrients are bunched into one visual group (Step 7
  // Task 3) — micro card can return '' when there isn't enough complete-day
  // data yet, so the divider/wrapper is only added when there's actually
  // a second section to separate from the hero card.
  const microCardHtml = renderMicronutrientsCard(person);
  const caloriesMicroHtml = microCardHtml
    ? `<div class="calories-micro-group">${heroHtml}<div class="calories-micro-divider"></div>${microCardHtml}</div>`
    : heroHtml;

  document.getElementById('vitals-body').innerHTML = renderPotatesHero() + caloriesMicroHtml + wkHtml + waterHtml + renderLowsPanel(person, todayStr());
  // hdr-date now lives in the header (row 2, next to the section title —
  // see index.html/#hdr-tab-row), not inside vitals-body. This used to
  // inject its own duplicate <div id="hdr-date"> here, which — since it
  // came first in DOM order — silently won every getElementById('hdr-date')
  // lookup below, leaving the real header date permanently empty and
  // showing this one, styled by the old #vitals-body-era CSS, in the
  // wrong place instead. Populating the header's element directly now.
  const dateEl = document.getElementById('hdr-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).toUpperCase();
  }
  requestAnimationFrame(() => {
    // Exclude .pbd-bar-fill (breakdown rows) here — those should only ever
    // animate from 0 on the user's first click to expand (handled in
    // toggleScoreBreakdown). On every other render (e.g. a Day/Week/Month
    // switch while already expanded) they jump straight to their final
    // width with no replay.
    document.querySelectorAll('#vitals-body .deficit-fill[data-target-pct]:not(.pbd-bar-fill)').forEach(bar => {
      requestAnimationFrame(() => { bar.style.width = bar.dataset.targetPct + '%'; });
    });
    if (_scoreExpanded) {
      document.querySelectorAll('#vitals-body .pbd-bar-fill[data-target-pct]').forEach(bar => {
        bar.style.transition = 'none';
        bar.style.width = bar.dataset.targetPct + '%';
        // restore transition next frame so a later genuine toggle still animates
        requestAnimationFrame(() => { bar.style.transition = ''; });
      });
    }
    document.querySelectorAll('#vitals-body [data-target-num]').forEach(numEl => {
      animateCountTo(numEl, numEl.dataset.targetNum, { duration: 500 });
    });
  });
}

function renderPotatesHero() {
  const isMonth = S.period === 'month';
  const score = isMonth ? potatesMonthlyScore() : potatesWeeklyScore();
  const label = isMonth ? '30 days' : '7 days';
  checkTreatTokenStreak();
  const tokens = S.treatTokens.shared || 0;
  const barPct = Math.max(0, Math.min(100, score));

  // Color & glow logic
  // numColor drives ONLY the big score digits (#potates-score-num) — a
  // muted, daylight-legible tone from the Step 14 adh-* ladder. scoreColor
  // stays fully saturated and continues to drive the status label, the bar
  // fill, and the glow/opacity/animation, so the glow effect stays vivid
  // even though the number text itself is calmer.
  let scoreColor, numColor, barGlow, barOpacity, statusLabel, barAnim;
  if (score >= 100) {
    scoreColor = 'var(--sage)';
    numColor = 'var(--adh-great)';
    barGlow = '0 0 6px 2px #7ec89a, 0 0 18px 6px #7ec89a, 0 0 38px 12px #4db87888';
    barOpacity = 1;
    statusLabel = 'Legendary';
    barAnim = 'glow-green-strong 2.8s ease-in-out infinite';
  } else if (score >= 90) {
    scoreColor = 'var(--sage)';
    numColor = 'var(--adh-great)';
    barGlow = '0 0 5px 2px #7ec89a, 0 0 14px 5px #7ec89a99';
    barOpacity = 1;
    statusLabel = 'Peak Form';
    barAnim = 'glow-green-medium 3.2s ease-in-out infinite';
  } else if (score >= 70) {
    scoreColor = 'var(--sage)';
    numColor = 'var(--adh-good)';
    barGlow = '0 0 4px 1px #7ec89a66, 0 0 8px 2px #7ec89a44';
    barOpacity = 1;
    statusLabel = 'Good Health';
    barAnim = 'glow-green-subtle 4s ease-in-out infinite';
  } else if (score >= 50) {
    scoreColor = 'var(--ochre)';
    numColor = 'var(--adh-neutral)';
    barGlow = 'none';
    barOpacity = 0.85;
    statusLabel = 'Holding Steady';
    barAnim = 'none';
  } else if (score >= 40) {
    scoreColor = 'var(--ochre)';
    numColor = 'var(--adh-warn)';
    barGlow = 'none';
    barOpacity = 0.55;
    statusLabel = 'Needs Work';
    barAnim = 'none';
  } else if (score >= 20) {
    scoreColor = 'var(--terra)';
    numColor = 'var(--adh-poor)';
    barGlow = '0 0 4px 1px #cc443366, 0 0 10px 3px #cc443344';
    barOpacity = 0.9;
    statusLabel = 'Warning Zone';
    barAnim = 'glow-red-subtle 3.2s ease-in-out infinite';
  } else {
    scoreColor = 'var(--terra)';
    numColor = 'var(--adh-poor)';
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
    '<div class="pbd-section" style="font-family:\'Space Grotesk\',sans-serif;font-size:9px;letter-spacing:1px;color:var(--ochre);text-transform:uppercase;margin:8px 0 4px">' + emoji + ' ' + title + '</div>';
  const bdHtml =
    '<div class="pbd-wrap' + (_scoreExpanded ? ' open' : '') + '" id="potates-breakdown"><div style="margin-top:10px;padding:0 16px;text-align:left">' +
    bdSection('🥗','Food') +
    bdr('Calorie adherence', bd.calPts, 35, !bd.hasData.cal ? 'no data yet' : '') +
    bdr('Micronutrients', bd.microPts, 15, !bd.hasData.micro ? 'needs full-logged days' : '') +
    bdSection('🏃','Movement') +
    bdr('Steps', bd.moveDetail.stepsPts, 5, bd.moveData.avgSteps > 0 ? 'avg ' + bd.moveData.avgSteps.toLocaleString() + ' steps/day' : 'no data') +
    bdr('Zone 2 cardio', bd.moveDetail.zone2Pts, 5, bd.moveData.zone2Min > 0 ? bd.moveData.zone2Min + ' min this period' : 'no data') +
    bdr('HIIT Everywhere', bd.moveDetail.vo2maxPts, 5, bd.moveData.hiitSessionsAchieved > 0 ? bd.moveData.hiitSessionsAchieved + ' session' + (bd.moveData.hiitSessionsAchieved>1?'s':'') + ' this period' : 'no data') +
    bdr('Strength', bd.moveDetail.strengthPts, 5, bd.moveData.strengthSessionsLogged > 0 ? bd.moveData.strengthSessionsLogged + ' session' + (bd.moveData.strengthSessionsLogged>1?'s':'') + ' this period' : 'no data') +
    bdr('Mobility', bd.moveDetail.mobilityPts, 5, bd.moveData.avgMobMin > 0 ? 'avg ' + bd.moveData.avgMobMin + ' min/day' : 'no data') +
    bdSection('💧','Water') +
    bdr('Water', bd.waterPts, 10, bd.hasData.water ? bd.waterHitDays + ' of ' + bd.waterTotalDays + ' days hit goal' : 'no data') +
    bdSection('📋','Logging') +
    bdr('Logging quality', bd.logPts, 10, bd.logDays > 0 ? bd.logDays + ' day' + (bd.logDays!==1?'s':'') + ' logged' : 'nothing yet') +
    (bd.availableMax < 100 ? '<div style="font-size:10px;color:var(--mist);margin-top:6px;font-style:italic">Score scaled to available data (' + bd.availableMax + '/100 pts active)</div>' : '') +
    '</div></div>';
  return `<div class="day-card potates-score-card" style="margin-bottom:10px">
    <div class="day-card-body" style="text-align:center;padding:10px 16px 8px">
      <div class="box-title" style="text-align:left">Potates Score</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;letter-spacing:3px;color:${scoreColor};opacity:0.85;margin-bottom:4px;text-transform:uppercase;transition:color .4s">${statusLabel}</div>
      <div class="big-kcal" style="font-size:28px;margin-bottom:8px"><span id="potates-score-num" data-target-num="${score}" style="color:${numColor};filter:saturate(.55) brightness(1.2);transition:color .4s">0</span><span style="font-size:13px;color:var(--mist)">/100</span></div>
      <div style="display:flex;align-items:center;gap:10px;margin:0 0 6px">
        <div style="position:relative;flex:1">
          <div class="deficit-bar" style="height:5px;margin-bottom:0;overflow:visible">
            <div class="deficit-fill potates-score-bar" data-target-pct="${barPct}" style="height:100%;border-radius:2px;width:0%;background:${scoreColor};box-shadow:${barGlow};opacity:${barOpacity};animation:${barAnim};transition:width .5s ease,opacity .4s ease;"></div>
          </div>
        </div>
        <span id="potates-bd-toggle" class="pbd-arr${_scoreExpanded ? ' open' : ''}" onclick="toggleScoreBreakdown()"></span>
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
  _scoreExpanded = !isOpen;
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


