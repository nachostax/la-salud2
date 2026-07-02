// ── WATER: BACKDATE LOG ───────────────────────────────────────────────────
// One unified flow (matches the Meal/Workout tabs' "📅 Backdate Log"):
// pick a date, then the MAIN water buttons above (+500/-250/+250/+750/+1000)
// accumulate into a pending in-memory total for that date instead of writing
// to today. Submit commits the pending total as a single water entry for the
// picked date. Replaces the old dual "tap retro buttons / type+Set amount"
// UIs, neither of which behaved like the main water buttons.
let waterRetroPendingMl = 0;

function isWaterBackdating() {
  const row = document.getElementById('wtr-retro-row');
  return !!(row && row.style.display !== 'none');
}

function getWaterRetroDate() {
  const input = document.getElementById('wtr-retro-date-input');
  return (input && input.value) ? input.value : todayStr();
}

function toggleWaterRetroDate() {
  const row = document.getElementById('wtr-retro-row');
  if (!row) return;
  const opening = row.style.display === 'none';
  row.style.display = opening ? 'flex' : 'none';
  if (opening) {
    const dateInput = document.getElementById('wtr-retro-date-input');
    if (dateInput && !dateInput.value) {
      const d = new Date(); d.setDate(d.getDate() - 1);
      dateInput.value = toLocalDateStr(d);
    }
    waterRetroPendingMl = 0;
    syncWaterRetroPendingUI();
    renderWater();
  } else {
    clearWaterRetroDate();
  }
}

function clearWaterRetroDate() {
  const row = document.getElementById('wtr-retro-row');
  const pendingRow = document.getElementById('wtr-retro-pending-row');
  const dateInput = document.getElementById('wtr-retro-date-input');
  if (row) row.style.display = 'none';
  if (pendingRow) pendingRow.style.display = 'none';
  if (dateInput) dateInput.value = '';
  waterRetroPendingMl = 0;
  syncWaterResetNote();
  renderWater();
}

function onWaterRetroDateChange() {
  waterRetroPendingMl = 0;
  syncWaterRetroPendingUI();
  renderWater();
}

function syncWaterRetroPendingUI() {
  const pendingRow = document.getElementById('wtr-retro-pending-row');
  const dateLabel = document.getElementById('wtr-retro-pending-date');
  const amountLabel = document.getElementById('wtr-retro-pending-amount');
  if (pendingRow) pendingRow.style.display = 'flex';
  if (dateLabel) dateLabel.textContent = getWaterRetroDate();
  if (amountLabel) amountLabel.textContent = waterRetroPendingMl + ' ml';
  syncWaterResetNote();
}

// While backdating, swap the "Resets every day at midnight" note for a
// clear reminder of which date the buttons above are currently feeding —
// the main affordance the bug report asked for: same buttons, different
// destination, with no ambiguity about which one is active.
function syncWaterResetNote() {
  const note = document.getElementById('water-reset-note');
  if (!note) return;
  note.textContent = isWaterBackdating()
    ? 'Logging for ' + getWaterRetroDate() + ' — tap the buttons above, then Submit'
    : 'Resets every day at midnight';
}

function submitWaterRetroAmount() {
  if (waterRetroPendingMl <= 0) { showToast('Tap the water buttons above to add an amount first'); return; }
  const date = getWaterRetroDate();
  const person = S.currentPerson;
  const current = getWaterMlForEntry(getWaterEntry(person, date));
  setWaterMlForDate(person, date, current + waterRetroPendingMl);
  showToast('Logged ' + waterRetroPendingMl + ' ml for ' + date);
  // Stay in backdating mode (same date) so multiple entries can be logged
  // in a row — just reset the pending total back to 0, same as the giant
  // number resetting after a normal day rolls over.
  waterRetroPendingMl = 0;
  syncWaterRetroPendingUI();
  renderWater();
}

// Same write path as setWaterMl(), generalised to take an explicit date
// instead of always today — setWaterMl() itself is left untouched so the
// main Water tab keeps behaving exactly as before for today's entry.
function setWaterMlForDate(person, date, ml) {
  const amount = Math.max(0, ml);
  let e = getWaterEntry(person, date);
  if (e) { e.ml = amount; }
  else { e = { id: Date.now()+Math.random(), record_type:'water', person, date, ml: amount, logged_at: new Date().toTimeString().slice(0,5) }; S.entries.push(e); }
  checkDailyTargets(person, date);
  save();
  if (date === todayStr()) renderWater();
}

// ── PARSE AI OUTPUT (meals + workouts) ────────────────────────────────────
function normaliseLine(line) {
  const obj = {};
  const pairs = line.split('|').slice(1);
  pairs.forEach(p => {
    const [k, ...rest] = p.split(':');
    const v = rest.join(':').trim();
    if (!k || v === undefined || v === '') return;
    const key = k.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    // Time and Notes must stay strings even if they contain digits —
    // e.g. "10:25" was being coerced to the number 1025, which then
    // crashed downstream code expecting a string with .split(':').
    if (key === 'time' || key === 'notes') { obj[key] = v; return; }
    const num = parseFloat(v.replace(/[^\d.\-]/g,''));
    obj[key] = (!isNaN(num) && /\d/.test(v)) ? num : v;
  });
  return obj;
}

// Guards against malformed AI output ever reaching stored history. A "meal"
// name that's just digits/punctuation, blank, or a single character is
// almost always a parsing artifact (e.g. the AI split "4 mejillones" into
// a separate line with just "4" as the name) — never a real food item.
// Returns true if this looks like a genuine food entry worth keeping.
function isPlausibleMealName(name) {
  const n = (name || '').toString().trim();
  if (n.length < 3) return false;
  if (/^[\d\s.,;:%-]+$/.test(n)) return false; // digits/punctuation only
  if (!/[a-zA-ZÀ-ÿ]/.test(n)) return false; // must contain actual letters
  return true;
}

// Coerces any value (number, numeric string, non-numeric string, undefined)
// into a guaranteed real number. Used for every numeric meal field so a
// stray non-numeric string from AI parsing (see normaliseLine's fallback)
// can never reach S.entries and silently turn into NaN downstream.
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Maps free-text AI-extracted workout type + intensity into the app's
// canonical scheme (Walking/Cardio[Zone2|HIIT]/Strength/Mobility), so
// AI-logged workouts get correctly classified by the Potate score —
// previously raw.type/raw.intensity were stored as-is (e.g. "Cycling" /
// "High"), which never matched the Zone2/HIIT pillar checks and silently
// fell through both buckets.
function normaliseAIWorkout(rawType, rawIntensity) {
  const t = (rawType || '').toLowerCase();
  const i = (rawIntensity || '').toLowerCase();

  const STRENGTH_WORDS = ['strength','weights','weight training','lifting','gym','resistance'];
  const MOBILITY_WORDS = ['mobility','stretch','yoga'];
  const WALK_WORDS = ['walk','walking','steps'];
  const CARDIO_WORDS = ['run','running','jog','cycling','bike','biking','swim','swimming',
    'rowing','elliptical','cardio','hiit','spin','interval'];

  let workoutType = rawType || 'Workout';
  let intensity = '';

  if (WALK_WORDS.some(w => t.includes(w))) {
    workoutType = 'Walking';
  } else if (STRENGTH_WORDS.some(w => t.includes(w))) {
    workoutType = 'Strength';
  } else if (MOBILITY_WORDS.some(w => t.includes(w))) {
    workoutType = 'Mobility';
  } else if (CARDIO_WORDS.some(w => t.includes(w)) || i) {
    // Any cardio-flavoured activity (or anything carrying an intensity at
    // all) is filed under Cardio, with intensity mapped to Zone2/HIIT:
    // High/Hard/Intense → HIIT, everything else (Low/Medium/easy/steady) → Zone2.
    workoutType = 'Cardio';
    intensity = (i.includes('high') || i.includes('hard') || i.includes('intense') || i === 'hiit')
      ? 'HIIT' : 'Zone2';
  }

  return { workoutType, intensity };
}

function parseAIOutput(text) {
  const results = [];
  const rejected = [];
  const lines = text.trim().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    const head = line.trim().match(/^(GABI|NACHO|MEAL|WORKOUT)/i);
    if (!head) return;
    const tag = head[1].toUpperCase();

    if (tag === 'WORKOUT') {
      const raw = normaliseLine(line);
      const personField = (raw.person || S.currentPerson || 'gabi').toString().toLowerCase();
      const people = personField === 'both' ? ['gabi','nacho'] : [personField];
      const { workoutType, intensity } = normaliseAIWorkout(raw.type, raw.intensity);
      people.forEach(person => {
        if (person !== 'gabi' && person !== 'nacho') return;
        results.push({
          id: Date.now() + Math.random(),
          record_type: 'workout',
          person,
          date: logDateStr('wk'),
          workout_type: workoutType,
          duration_min: num(raw.duration ?? raw.duration_min),
          intensity,
          calories_burned: num(raw.calories_burned ?? raw.caloriesburned),
          notes: raw.notes || '',
          logged_at: logTimeStr('wk')  // always actual device time, never AI-guessed
        });
      });
      return;
    }

    // MEAL line — either a generic "MEAL" tag (assigned to whoever is
    // currently selected in the app) or an explicit GABI/NACHO tag, kept
    // for backward compatibility and for manual overrides.
    const person = (tag === 'MEAL') ? (S.currentPerson || 'gabi') : tag.toLowerCase();
    const raw = normaliseLine(line);
    // Always use actual device time — the AI's Time field is ignored entirely
    // because it guesses from photo context and is unreliable.
    const nowTime = new Date().toTimeString().slice(0,5);
    const hour = new Date().getHours();
    // Hypo correction (fast sugar + slow carb for a low blood-sugar episode):
    // still logged as a meal for nutrition tracking, but excluded from the
    // calorie-vs-target math everywhere that's calculated. Recognised via a
    // "Hypo: yes/true/1" field on the line, OR the meal name containing the
    // word "hypo" or "correction" as a fallback if the field is missing.
    const hypoField = (raw.hypo ?? raw.hypo_correction ?? '').toString().toLowerCase();
    const isHypo = ['yes','true','1','y'].includes(hypoField) ||
      /\b(hypo|correction)\b/i.test(raw.meal || '');

    // Daily supplement stack (magnesium/ashwagandha/multivitamin etc.):
    // tagged as "vitamins" rather than the usual time-of-day meal label,
    // so it reads correctly under the meal name regardless of what time
    // it's logged or backfilled at.
    const isVitamins = /\b(vitamin|multivitamin|ashwagandha)\b/i.test(raw.meal || '');

    if (!isPlausibleMealName(raw.meal)) {
      rejected.push(line.trim());
      return;
    }

    results.push({
      id: Date.now() + Math.random(),
      record_type: 'meal',
      person,
      date: logDateStr('meal'),
      meal: raw.meal || 'Meal',
      meal_type: isVitamins ? 'vitamins' : (hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 19 ? 'dinner' : 'snack'),
      logged_at: logTimeStr('meal'),  // always actual device time, never AI-guessed
      // num(): every numeric meal field MUST be a real number, never a raw
      // string. normaliseLine() falls back to storing the raw string when it
      // can't confidently parse a value out of the AI's text (e.g. "trace",
      // "N/A", or any non-numeric reply) — left unguarded here, that string
      // flows straight into S.entries and poisons every downstream sum
      // (micronutrient averages, the POTATES score) with NaN the moment any
      // arithmetic touches it. parseFloat(...)||0 guarantees a number no
      // matter what shape the raw value arrives in.
      calories: num(raw.calories),
      protein_g: num(raw.protein ?? raw.protein_g),
      carbs_g: num(raw.carbs ?? raw.carbs_g),
      netcarbs_g: num(raw.netcarbs ?? raw.netcarbs_g ?? raw.carbs ?? raw.carbs_g),
      fat_g: num(raw.fat ?? raw.fat_g),
      fibre_g: num(raw.fibre ?? raw.fibre_g),
      magnesium_mg: num(raw.magnesium ?? raw.magnesium_mg),
      vitd_mcg: num(raw.vitd ?? raw.vitd_mcg),
      iron_mg: num(raw.iron ?? raw.iron_mg),
      calcium_mg: num(raw.calcium ?? raw.calcium_mg),
      zinc_mg: num(raw.zinc ?? raw.zinc_mg),
      b12_mcg: num(raw.b12 ?? raw.b12_mcg),
      omega3_g: num(raw.omega3 ?? raw.omega3_g),
      potassium_mg: num(raw.potassium ?? raw.potassium_mg),
      vitc_mg: num(raw.vitc ?? raw.vitc_mg),
      folate_mcg: num(raw.folate ?? raw.folate_mcg),
      hypo_correction: isHypo,
      full_day: false
    });
  });
  results.rejected = rejected;
  return results;
}

// ── ADD ENTRY ──────────────────────────────────────────────────────────────
function commitEntries(parsed) {
  // Stamp day_kcal_target once per person per day — on the first entry logged
  // that day. Subsequent entries that day inherit the already-stamped value.
  // The scorer falls back to today's live target when this is absent (intentional,
  // for older entries), but stamping here means the snapshot is accurate over time.
  const stamped = parsed.map(e => {
    if (e.record_type !== 'meal') return e;
    const alreadyStamped = S.entries.some(x =>
      x.record_type === 'meal' && x.person === e.person && x.date === e.date && x.day_kcal_target > 0
    );
    if (alreadyStamped) return e;
    const target = S.mission[e.person] && S.mission[e.person].kcal;
    return target ? { ...e, day_kcal_target: target } : e;
  });
  S.entries.push(...stamped);
}

function applyFullDayStatus() {
  // markDayComplete() is now the single source of truth for full_day status;
  // Submit Log no longer reads a separate checkbox (removed — it was a stray
  // leftover from the old "That's all I ate today" flow). Just report
  // whatever the day's current full_day state already is.
  const today = entriesFor(S.currentPerson, [todayStr()], 'meal');
  return today.length > 0 && today.some(e => e.full_day);
}

// ── MARK DAY AS COMPLETE — top-of-panel button, decoupled from Submit Log ──
// Toggles full_day immediately on tap, independent of whether there's
// anything in the paste box. Drives the same full_day field the checkbox
// and Submit Log flow use, so they all stay in sync no matter which one
// the person reaches for.
function markDayComplete() {
  const today = entriesFor(S.currentPerson, [todayStr()], 'meal');
  const wasFull = today.length > 0 && today.some(e => e.full_day);
  const next = !wasFull;

  if (!today.length) {
    const modeMsg = currentLogMode === 'meal'
      ? 'Log at least one meal today before marking the day complete'
      : 'Log at least one meal today before marking the day complete (switch to Meal to add one)';
    showToast(modeMsg);
    return;
  }

  S.entries.forEach(e => {
    if (e.date === todayStr() && e.person === S.currentPerson && e.record_type === 'meal') e.full_day = next;
  });

  save();
  renderVitals();
  renderLogTab();
  syncFullDayCheckbox();
  if (next) {
    const badge = document.getElementById('mark-complete-badge');
    if (badge) {
      badge.classList.remove('check-bounce');
      void badge.getBoundingClientRect();
      badge.classList.add('check-bounce');
    }
  }
  showToast(next ? 'Day marked complete' : 'Full-day mark removed');
}

// Reflects full_day state on the top button itself — badge + label + color
// swap when the day's already marked, so tapping again clearly reads as
// undo. Now lives outside any one mode panel (global to the whole Log tab),
// so this runs regardless of which of Meal/Workout/Water is currently open.
function syncMarkCompleteBtn() {
  const btn = document.getElementById('mark-complete-btn');
  const badge = document.getElementById('mark-complete-badge');
  const label = document.getElementById('mark-complete-label');
  if (!btn) return;
  const today = entriesFor(S.currentPerson, [todayStr()], 'meal');
  const isFull = today.length > 0 && today.some(e => e.full_day);
  if (label) label.textContent = isFull ? 'Day complete — tap to undo' : 'Day Complete';
  if (badge) badge.textContent = isFull ? '✓' : '🏆';
  btn.style.background = isFull ? 'var(--bark)' : 'var(--sage)';
  btn.style.color = isFull ? 'var(--sage)' : 'var(--soil)';
  btn.style.border = isFull ? '1px solid var(--sage)' : 'none';
  btn.classList.toggle('mark-complete-glow', isFull);
}


function submitLog() {
  if (aiLogMode === 'auto') { submitLogAuto(); return; }

  const text = document.getElementById('paste-input').value.trim();
  let addedCount = 0;
  let parsed = [];

  if (text) {
    parsed = parseAIOutput(text);
    if (!parsed.length && !parsed.rejected?.length) { showToast('Could not read that — check the format'); return; }
    if (parsed.rejected && parsed.rejected.length) {
      showToast('Skipped ' + parsed.rejected.length + ' unreadable line' + (parsed.rejected.length>1?'s':'') + ' — check the reply and add manually if needed');
    }
    commitEntries(parsed);
    addedCount = parsed.length;
  }

  const wasFullBefore = entriesFor(S.currentPerson, [todayStr()], 'meal').some(e => e.full_day);
  const fullDay = applyFullDayStatus();
  const fullDayChanged = fullDay !== wasFullBefore;

  if (!text && !fullDayChanged) {
    showToast('Nothing to submit — paste a reply or tick/untick the full-day box');
    return;
  }

  save();
  renderVitals();
  renderLogTab();
  syncFullDayCheckbox();
  syncHypoQuickBtn();
  document.getElementById('paste-input').value = '';

  // If 👫 was active: simply log the exact same parsed entries again for the
  // other person — same date, same time, same macros, no re-parsing, no
  // second AI call. Whatever date was selected (today or a retro date) is
  // already stamped on each entry in `parsed`, so the clone inherits it.
  if (mealLogForBoth) {
    const orig = S.currentPerson;
    const other = orig === 'gabi' ? 'nacho' : 'gabi';
    const cloned = parsed.map(e => ({ ...e, id: Date.now() + Math.random(), person: other }));
    cloned.forEach(e => { if (!S.entries.find(x => entryKey(x) === entryKey(e))) S.entries.push(e); });
    mealLogForBoth = false;
    const btn = document.getElementById('log-both-btn');
    const submitBtn = document.getElementById('submit-log-btn');
    if (btn) { btn.style.background = 'var(--bark)'; btn.style.color = 'var(--ochre)'; btn.classList.remove('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Submit Log';
    save(); renderVitals(); renderLogTab();
    showToast('Logged for both ✓');
    return;
  }

  if (addedCount) {
    showToast('Added ' + addedCount + ' item' + (addedCount>1?'s':'') + (fullDayChanged ? (fullDay ? ' · day marked complete' : ' · full-day mark removed') : ''));
  } else {
    showToast(fullDay ? 'Day marked complete' : 'Full-day mark removed');
  }
}

// ── LOG MODE (Meal / Workout / Water) ────────────────────────────────────
let currentLogMode = 'meal';

function setLogMode(mode) {
  currentLogMode = mode;
  ['meal','workout','water'].forEach(m => {
    document.getElementById('log-mode-'+m).classList.toggle('active', m === mode);
    const panel = document.getElementById('log-panel-'+m);
    if (panel) panel.style.display = m === mode ? 'block' : 'none';
  });
  if (mode === 'water') renderWater();
  if (mode === 'workout') renderTodayWorkouts();
}

// ── QUICK LOG: coffee & breakfast ─────────────────────────────────────────
window.QUICK_MEALS = {
  coffee: {
    gabi:  { meal:'Coffee with milk', calories:30, protein_g:2, carbs_g:3, netcarbs_g:3, fat_g:1, fibre_g:0, magnesium_mg:8, vitd_mcg:0, iron_mg:0, calcium_mg:50, zinc_mg:0.1, b12_mcg:0.2, omega3_g:0, potassium_mg:80, vitc_mg:0, folate_mcg:2 },
    nacho: { meal:'Coffee with milk and honey', calories:55, protein_g:2, carbs_g:10, netcarbs_g:10, fat_g:1, fibre_g:0, magnesium_mg:8, vitd_mcg:0, iron_mg:0.1, calcium_mg:50, zinc_mg:0.1, b12_mcg:0.2, omega3_g:0, potassium_mg:90, vitc_mg:0, folate_mcg:2 }
  },
  breakfast: {
    gabi:  { meal:'Usual breakfast', calories:374, protein_g:24, carbs_g:23, netcarbs_g:19, fat_g:21, fibre_g:4, magnesium_mg:38, vitd_mcg:2.2, iron_mg:3, calcium_mg:120, zinc_mg:2.1, b12_mcg:1.2, omega3_g:0.3, potassium_mg:380, vitc_mg:18, folate_mcg:80 },
    nacho: { meal:'Usual breakfast', calories:395, protein_g:24, carbs_g:29, netcarbs_g:25, fat_g:21, fibre_g:4, magnesium_mg:40, vitd_mcg:2.2, iron_mg:3, calcium_mg:120, zinc_mg:2.1, b12_mcg:1.2, omega3_g:0.3, potassium_mg:390, vitc_mg:18, folate_mcg:82 }
  },
  multivitamins: {
    gabi:  { meal:'Vitamins', calories:18, protein_g:0.1, carbs_g:4.3, netcarbs_g:4.3, fat_g:0, fibre_g:0, magnesium_mg:175, vitd_mcg:2.1, iron_mg:0, calcium_mg:0, zinc_mg:1.5, b12_mcg:2.2, omega3_g:0, potassium_mg:0, vitc_mg:12, folate_mcg:83.3 },
    nacho: { meal:'Vitamins', calories:18, protein_g:0.1, carbs_g:4.3, netcarbs_g:4.3, fat_g:0, fibre_g:0, magnesium_mg:175, vitd_mcg:2.1, iron_mg:0, calcium_mg:0, zinc_mg:1.5, b12_mcg:2.2, omega3_g:0, potassium_mg:0, vitc_mg:12, folate_mcg:83.3 }
  }
};
const QUICK_MEALS = window.QUICK_MEALS;

// Apply saved overrides to QUICK_MEALS at startup
function applyQuickLogOverrides() {
  const overrides = S.settings && S.settings.quickLogOverrides;
  if (!overrides) return;
  ['gabi','nacho'].forEach(p => {
    if (!overrides[p]) return;
    if (overrides[p].coffee) QUICK_MEALS.coffee[p] = { ...QUICK_MEALS.coffee[p], ...overrides[p].coffee };
    if (overrides[p].vitamins) QUICK_MEALS.multivitamins[p] = { ...QUICK_MEALS.multivitamins[p], ...overrides[p].vitamins };
  });
}

function quickLogMeal(type) {
  const person = S.currentPerson;
  const date = logDateStr('meal');
  const now = logTimeStr('meal');
  const hour = new Date().getHours();
  const mealType = type === 'multivitamins' ? 'vitamins' : (hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 19 ? 'dinner' : 'snack');
  const people = mealLogForBoth ? [person, person === 'gabi' ? 'nacho' : 'gabi'] : [person];
  people.forEach(p => {
    const data = QUICK_MEALS[type][p];
    const alreadyStamped = S.entries.some(x =>
      x.record_type === 'meal' && x.person === p && x.date === date && x.day_kcal_target > 0
    );
    S.entries.push({
      id: Date.now() + Math.random(),
      record_type: 'meal', person: p,
      date,
      meal: data.meal,
      meal_type: mealType,
      logged_at: now,
      calories: data.calories, protein_g: data.protein_g, carbs_g: data.carbs_g,
      netcarbs_g: data.netcarbs_g, fat_g: data.fat_g, fibre_g: data.fibre_g,
      magnesium_mg: data.magnesium_mg, vitd_mcg: data.vitd_mcg, iron_mg: data.iron_mg,
      calcium_mg: data.calcium_mg, zinc_mg: data.zinc_mg, b12_mcg: data.b12_mcg,
      omega3_g: data.omega3_g, potassium_mg: data.potassium_mg, vitc_mg: data.vitc_mg,
      folate_mcg: data.folate_mcg, hypo_correction: false, full_day: false,
      day_kcal_target: alreadyStamped ? undefined : (S.mission[p] && S.mission[p].kcal) || undefined
    });
  });
  if (mealLogForBoth) {
    mealLogForBoth = false;
    const btn = document.getElementById('log-both-btn');
    const submitBtn = document.getElementById('submit-log-btn');
    if (btn) { btn.style.background = 'var(--bark)'; btn.style.color = 'var(--ochre)'; btn.classList.remove('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Submit Log';
  }
  save();
  renderVitals();
  renderLogTab();
  const data = QUICK_MEALS[type][person];
  showToast(data.meal + ' logged' + (people.length > 1 ? ' for both ✓' : '') + (date !== todayStr() ? ' for ' + date : ''));
}
function quickLogCoffee()        { quickLogMeal('coffee'); }
function quickLogMultivitamins() { quickLogMeal('multivitamins'); }

// ── PREVIOUS MEAL PICKER — Log tab ───────────────────────────────────────
// Lets you re-use anything you've logged before by title, with no typing.
function syncHypoQuickBtn() {
  const hypoBtn = document.getElementById('hypo-quick-btn');
  if (hypoBtn) hypoBtn.style.display = S.currentPerson === 'gabi' ? 'block' : 'none';
}

// ── NATIVE WORKOUT LOGGER ─────────────────────────────────────────────────
const WORKOUT_METS = { Walking: 3.5, Cardio: 7.0, Strength: 5.0, Stretching: 2.5 };

function burnEstimate(type, durationMin) {
  const weight = S.mission[S.currentPerson].weight || 70;
  return Math.round(((WORKOUT_METS[type] || 4) * weight * durationMin) / 60);
}
function burnEstimateFromSteps(steps) {
  const weight = S.mission[S.currentPerson].weight || 70;
  return Math.round(steps * 0.04 * (weight / 70));
}

let selectedWorkoutType = null;
let walkBy = 'steps';

let selectedCardioSub = null;
function selectCardioSub(sub) {
  selectedCardioSub = sub;
  document.querySelectorAll('.wk-cardio-sub-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(sub === 'Zone2' ? 'wk-csub-zone2' : 'wk-csub-hiit');
  if (el) el.classList.add('active');
}
function selectWorkoutType(btn) {
  selectedWorkoutType = btn.dataset.type;
  document.querySelectorAll('.wk-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const isWalking = selectedWorkoutType === 'Walking';
  const isOther   = selectedWorkoutType === 'Other';
  const isCardio  = selectedWorkoutType === 'Cardio';
  document.getElementById('wk-walking-opts').style.display   = isWalking ? 'block' : 'none';
  document.getElementById('wk-cardio-subtype').style.display = isCardio  ? 'block' : 'none';
  document.getElementById('wk-duration-opts').style.display  = (!isWalking && !isOther) ? 'block' : 'none';
  document.getElementById('wk-other-opts').style.display     = isOther ? 'block' : 'none';
  if (!isCardio) { selectedCardioSub = null; document.querySelectorAll('.wk-cardio-sub-btn').forEach(b=>b.classList.remove('active')); }
  document.getElementById('wk-submit-btn').style.display    = 'flex';
  document.getElementById('wk-log-both-btn').style.display  = 'flex';
  // Reset both-flag when picking a new workout type
  workoutLogForBoth = false;
  const btn2 = document.getElementById('wk-log-both-btn');
  const submitBtn = document.getElementById('wk-submit-btn');
  if (btn2) { btn2.style.background = ''; btn2.style.color = ''; }
  if (submitBtn) submitBtn.textContent = 'Log workout';
}

function setWalkBy(mode) {
  walkBy = mode;
  document.getElementById('walk-by-steps').classList.toggle('active', mode === 'steps');
  document.getElementById('walk-by-time').classList.toggle('active', mode === 'time');
  document.getElementById('wk-steps-input').style.display   = mode === 'steps' ? 'block' : 'none';
  document.getElementById('wk-walktime-input').style.display = mode === 'time'  ? 'block' : 'none';
}

function submitWorkout() {
  if (!selectedWorkoutType) { showToast('Pick a workout type first'); return; }
  if (selectedWorkoutType === 'Other') { submitOtherWorkout(); return; }
  const now = logTimeStr('wk');
  let durationMin = 0, caloriesBurned = 0, notes = '';

  if (selectedWorkoutType === 'Walking') {
    if (walkBy === 'steps') {
      const steps = parseInt(document.getElementById('wk-steps').value) || 0;
      if (!steps) { showToast('Enter number of steps'); return; }
      durationMin = Math.round(steps / 130); // ~130 steps/min average pace
      caloriesBurned = burnEstimateFromSteps(steps);
      notes = steps + ' steps';
    } else {
      durationMin = parseInt(document.getElementById('wk-walkduration').value) || 0;
      if (!durationMin) { showToast('Enter duration'); return; }
      caloriesBurned = burnEstimate('Walking', durationMin);
    }
  } else {
    durationMin = parseInt(document.getElementById('wk-duration').value) || 0;
    if (!durationMin) { showToast('Enter duration'); return; }
    caloriesBurned = burnEstimate(selectedWorkoutType, durationMin);
  }

  const wType = selectedWorkoutType;
  const stepsVal = (wType === 'Walking' && walkBy === 'steps') ? (parseInt(document.getElementById('wk-steps').value)||0) : 0;
  if (wType === 'Cardio' && !selectedCardioSub) { showToast('Pick Zone 2 or High Intensity first'); return; }
  const intensityVal = wType === 'Cardio' ? selectedCardioSub : 'Medium';
  const entry = {
    id: Date.now() + Math.random(),
    record_type: 'workout', person: S.currentPerson,
    date: logDateStr('wk'), workout_type: wType,
    duration_min: durationMin, intensity: intensityVal,
    calories_burned: caloriesBurned, notes, logged_at: now,
    steps_logged: stepsVal
  };
  if (!S.entries.find(x => entryKey(x) === entryKey(entry))) S.entries.push(entry);
  checkDailyTargets(S.currentPerson, todayStr());

  // If 👫 was active, clone for the other person too
  if (workoutLogForBoth) {
    const other = S.currentPerson === 'gabi' ? 'nacho' : 'gabi';
    const clone = Object.assign({}, entry, { id: Date.now() + Math.random(), person: other });
    clone.calories_burned = burnEstimateForPerson(other, wType, durationMin, stepsVal);
    if (!S.entries.find(x => entryKey(x) === entryKey(clone))) S.entries.push(clone);
    checkDailyTargets(other, todayStr());
  }

  save();
  renderVitals();
  renderTodayWorkouts();

  const toastMsg = workoutLogForBoth ? (wType + ' logged for both ✓') : (wType + ' logged · ~' + caloriesBurned + ' kcal burned');

  // Reset form and both-flag
  workoutLogForBoth = false;
  document.querySelectorAll('.wk-type-btn').forEach(b => b.classList.remove('selected'));
  selectedWorkoutType = null;
  ['wk-walking-opts','wk-cardio-subtype','wk-duration-opts','wk-other-opts','wk-submit-btn','wk-log-both-btn'].forEach(id => {
    const el = document.getElementById(id); if (el) { el.style.display = 'none'; if (el.tagName === 'BUTTON') { el.disabled = false; el.style.background = ''; el.style.color = ''; } }
  });
  const submitBtn = document.getElementById('wk-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Log workout';
  selectedCardioSub = null;
  document.querySelectorAll('.wk-cardio-sub-btn').forEach(b=>b.classList.remove('active'));
  ['wk-steps','wk-walkduration','wk-duration'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const otherEl = document.getElementById('wk-other-desc'); if (otherEl) otherEl.value = '';
  showToast(toastMsg);
}

// ── OTHER WORKOUT: AI parses free-text description ────────────────────────
async function submitOtherWorkout() {
  const forBoth = workoutLogForBoth;
  const desc = (document.getElementById('wk-other-desc').value || '').trim();
  if (!desc) { showToast('Describe what you did first'); return; }
  const key = getGeminiKey();
  if (!key) { showToast('Add your Gemini API key in Settings first'); return; }
  const btn  = document.getElementById('wk-submit-btn');
  const btn2 = document.getElementById('wk-log-both-btn');
  setBtnThinking(btn, true, 'Thinking…');
  if (btn2) btn2.disabled = true;
  const person = S.currentPerson;
  const weight = S.mission[person].weight || 70;
  const prompt = buildOtherWorkoutPrompt(desc, person, weight, forBoth);
  try {
    const reply = await askGemini(prompt);
    const parsed = parseAIOutput(reply);
    if (!parsed.length) { showToast('Could not parse workout — try being more specific'); return; }
    parsed.forEach(e => { if (!S.entries.find(x => entryKey(x) === entryKey(e))) S.entries.push(e); });
    checkDailyTargets(person, todayStr());
    if (forBoth) {
      const other = person === 'gabi' ? 'nacho' : 'gabi';
      const wOther = S.mission[other].weight || 70;
      const p2 = buildOtherWorkoutPrompt(desc, other, wOther, false);
      try {
        const r2 = await askGemini(p2);
        const p2parsed = parseAIOutput(r2);
        p2parsed.forEach(e => { if (!S.entries.find(x => entryKey(x) === entryKey(e))) S.entries.push(e); });
        checkDailyTargets(other, todayStr());
      } catch(e2) { /* best effort */ }
    }
    save(); renderVitals(); renderTodayWorkouts();
    // Reset
    workoutLogForBoth = false;
    document.querySelectorAll('.wk-type-btn').forEach(b => b.classList.remove('selected'));
    selectedWorkoutType = null;
    ['wk-walking-opts','wk-cardio-subtype','wk-duration-opts','wk-other-opts','wk-submit-btn','wk-log-both-btn'].forEach(id => {
      const el = document.getElementById(id); if (el) { el.style.display = 'none'; if (el.tagName === 'BUTTON') { el.disabled = false; el.style.background = ''; el.style.color = ''; } }
    });
    const submitBtn = document.getElementById('wk-submit-btn');
    if (submitBtn) setBtnThinking(submitBtn, false, 'Log workout');
    selectedCardioSub = null;
    document.querySelectorAll('.wk-cardio-sub-btn').forEach(b=>b.classList.remove('active'));
    const otherEl = document.getElementById('wk-other-desc'); if (otherEl) otherEl.value = '';
    showToast('Workout logged' + (forBoth ? ' for both' : '') + ' ✓');
  } catch(err) {
    showToast('AI error — check your key and connection');
  } finally {
    setBtnThinking(btn, false, 'Log workout');
    if (btn2) btn2.disabled = false;
  }
}

function buildOtherWorkoutPrompt(desc, person, weightKg, forBoth) {
  const personName = person === 'gabi' ? 'Gabi' : 'Nacho';
  const now = logTimeStr('wk');
  return `You are a workout logging assistant. Convert the free-text workout description below into one or more structured log lines. Output ONLY the log line(s) — no explanation, no commentary, no questions, no extra text whatsoever.

PERSON: ${personName} (body weight ~${weightKg}kg)
TIME: ${now}
DESCRIPTION: ${desc}

OUTPUT FORMAT — one line per distinct workout segment:
WORKOUT|person:${person}|type:<type>|duration:<minutes>|intensity:<Low/Medium/High>|calories_burned:<integer>|notes:<brief note>

RULES:
1. "type" must be one of: Walking, Cardio-Zone2, Cardio-HIIT, Strength, Mobility, Cycling, Swimming, Yoga, Other
   — choose the single best match. Cardio-Zone2 = steady aerobic; Cardio-HIIT = intervals/sprints/VO2max. Never invent new type names.
2. "duration" is an integer (minutes). If the description says e.g. "1 hour", output 60.
3. "calories_burned" — estimate using MET × weight × hours. Common METs: Walking=3.5, Cycling=6.0, Cardio=7.0, Strength=5.0, Stretching=2.5, HIIT=9.0, Yoga=2.5, Swimming=7.0, Other=4.0. Round to nearest integer.
4. "intensity" — infer from the description (e.g. "easy" → Low, "hard/intervals/sprint" → High, otherwise Medium).
5. "notes" — a single concise phrase summarising the activity (max 60 chars). Never leave blank.
6. If the description clearly describes two distinct activities (e.g. "30 min run + 15 min stretching"), output TWO lines, one per activity.
7. Output ONLY lines starting with WORKOUT| — no headers, no preamble, no trailing text.
8. Never ask a question. If anything is ambiguous, make your best estimate and proceed.

Example valid output:
WORKOUT|person:gabi|type:Cycling|duration:40|intensity:Medium|calories_burned:280|notes:40 min bike ride moderate pace
WORKOUT|person:gabi|type:Stretching|duration:15|intensity:Low|calories_burned:37|notes:post-ride stretching`;
}

// ── LOG BOTH: re-submit the current meal log for the OTHER person too ──────
// Tracks whether the 👫 button has been pressed (log for both on next submit)
let mealLogForBoth = false;

function submitLogBoth() {
  mealLogForBoth = !mealLogForBoth;
  const btn = document.getElementById('log-both-btn');
  const submitBtn = document.getElementById('submit-log-btn');
  if (mealLogForBoth) {
    if (btn) { btn.style.background = 'var(--ochre)'; btn.style.color = 'var(--bark)'; btn.classList.add('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Submit Log (both)';
  } else {
    if (btn) { btn.style.background = 'var(--bark)'; btn.style.color = 'var(--ochre)'; btn.classList.remove('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Submit Log';
  }
}

// (Removed: an earlier, unused "_submitLogForOther" approach re-ran the AI
// from scratch for the second person. The 👫 toggle now simply clones the
// already-parsed entries instead — see submitLog() and submitLogAuto().)

let workoutLogForBoth = false;

function logWorkoutBoth() {
  workoutLogForBoth = !workoutLogForBoth;
  const btn2 = document.getElementById('wk-log-both-btn');
  const submitBtn = document.getElementById('wk-submit-btn');
  if (workoutLogForBoth) {
    if (btn2) { btn2.style.background = 'var(--ochre)'; btn2.style.color = 'var(--bark)'; btn2.classList.add('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Log workout (both)';
  } else {
    if (btn2) { btn2.style.background = 'var(--bark)'; btn2.style.color = 'var(--ochre)'; btn2.classList.remove('both-active'); }
    if (submitBtn) submitBtn.textContent = 'Log workout';
  }
}

function burnEstimateForPerson(person, type, durationMin, steps) {
  const weight = S.mission[person].weight || 70;
  if (type === 'Walking' && steps > 0) return Math.round(steps * 0.04 * (weight / 70));
  return Math.round(((WORKOUT_METS[type] || 4) * weight * durationMin) / 60);
}

function renderTodayWorkouts() {
  const el = document.getElementById('today-entries-workout');
  if (!el) return;
  const workouts = entriesFor(S.currentPerson, [todayStr()], 'workout');
  if (!workouts.length) {
    el.innerHTML = '<div class="empty-state">No workouts logged today yet.</div>';
    return;
  }
  el.innerHTML = workouts.sort((a,b)=>(a.logged_at||'').localeCompare(b.logged_at||'')).map(e => `
    <div class="meal-entry" onclick="openEntryDetail(${e.id})" style="cursor:pointer">
      <div class="meal-entry-top">
        <span class="meal-name">🏃 ${e.workout_type}</span>
        <button class="meal-delete" onclick="event.stopPropagation();deleteEntry(${e.id})">×</button>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span class="meal-time">${e.duration_min ? e.duration_min+' min' : ''}${e.notes ? ' · '+e.notes : ''} · ${e.logged_at||''}</span>
        <span class="meal-kcal">${e.calories_burned ? Math.round(e.calories_burned)+' kcal burned' : ''}</span>
      </div>
    </div>`).join('');
}

// ── WATER TRACKING ────────────────────────────────────────────────────────
// A real logged entry (record_type:'water'), synced to Firestore and
// exported in CSV/XLSX.
function getWaterGoal(person) { return (S.settings.waterGoal && S.settings.waterGoal[person]) || 1750; }

function getWaterEntry(person, date) {
  return S.entries.find(e => e.record_type==='water' && e.person===person && e.date===date);
}
// Returns ml for a water entry.
function getWaterMlForEntry(e) {
  if (!e) return 0;
  return e.ml || 0;
}
function getWaterMl() {
  return getWaterMlForEntry(getWaterEntry(S.currentPerson, todayStr()));
}
function setWaterMl(ml) {
  const amount = Math.max(0, ml);
  const date = todayStr(), person = S.currentPerson;
  let e = getWaterEntry(person, date);
  if (e) { e.ml = amount; }
  else { e = { id: Date.now()+Math.random(), record_type:'water', person, date, ml: amount, logged_at: new Date().toTimeString().slice(0,5) }; S.entries.push(e); }
  checkDailyTargets(person, date);
  save();
  renderWater();
}
function addWaterMl(delta) {
  if (isWaterBackdating()) {
    waterRetroPendingMl = Math.max(0, waterRetroPendingMl + delta);
    syncWaterRetroPendingUI();
    renderWater();
    return;
  }
  setWaterMl(getWaterMl() + delta);
}

function renderWater() {
  // While backdating, the giant number/bar mirror the in-memory pending
  // total for the picked date instead of today's real total — same widget,
  // same animation, just pointed at a different number until Submit.
  const ml   = isWaterBackdating() ? waterRetroPendingMl : getWaterMl();
  const goal = getWaterGoal(S.currentPerson);
  const pct  = Math.min(100, Math.round((ml / goal) * 100));
  const countEl = document.getElementById('water-count');
  const barEl   = document.getElementById('water-bar-fill');
  const goalEl  = document.getElementById('water-goal-label');
  if (goalEl)  goalEl.textContent  = 'Goal: ' + goal + ' ml';
  if (countEl) animateCountTo(countEl, ml, { duration: 500, formatter: v => v + ' ml' });
  if (barEl) {
    barEl.style.background = pct >= 100 ? 'var(--sage)' : pct >= 50 ? 'var(--ochre)' : 'var(--terra)';
    requestAnimationFrame(() => { barEl.style.width = pct + '%'; });
  }
}

// ── DAILY TARGETS (water / steps / workout) — simple booleans per day,
// synced and exported, used for the Potates Score and target hit rate. ──
function checkDailyTargets(person, date) {
  if (!S.dailyTargets[person]) S.dailyTargets[person] = {};
  const water = getWaterMlForEntry(getWaterEntry(person, date)) >= getWaterGoal(person);
  const dayWorkouts = S.entries.filter(e => e.record_type==='workout' && e.person===person && e.date===date);
  const stepsToday = sum(dayWorkouts.filter(w=>w.workout_type==='Walking'), 'steps_logged') ||
    (dayWorkouts.find(w=>w.notes && /steps/.test(w.notes)) ? parseInt((dayWorkouts.find(w=>w.notes && /steps/.test(w.notes)).notes.match(/\d+/)||[0])[0]) : 0);
  const stepGoal = (S.settings.stepGoal && S.settings.stepGoal[person]) || 10000;
  S.dailyTargets[person][date] = {
    water,
    steps: stepsToday >= stepGoal,
    workout: dayWorkouts.length > 0
  };
}
function backfillDailyTargets() {
  S.entries.filter(e => e.record_type === 'water').forEach(e => {
    if (!S.dailyTargets[e.person] || !S.dailyTargets[e.person][e.date]) {
      checkDailyTargets(e.person, e.date);
    }
  });
}

function addEntryFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = parseAIOutput(e.target.result);
    if (!parsed.length && !parsed.rejected?.length) { showToast('Could not read that — check the format'); return; }
    commitEntries(parsed);
    save();
    renderVitals();
    renderLogTab();
    syncFullDayCheckbox();
    const skipped = parsed.rejected && parsed.rejected.length ? (' · skipped ' + parsed.rejected.length + ' unreadable') : '';
    showToast('Added ' + parsed.length + ' item' + (parsed.length>1?'s':'') + skipped);
  };
  reader.readAsText(file);
  event.target.value = '';
}

function deleteEntry(id) {
  // Remove from local state immediately so the UI updates at once.
  S.entries = S.entries.filter(e => e.id !== id);

  if (S.usingSubcollections && window.__firebaseSync) {
    // Fire the Firestore delete.  Do NOT write to localStorage here — the
    // subcollection onSnapshot (server-confirmed only, fromCache skipped) will
    // receive the authoritative post-delete state and write localStorage then.
    // Writing localStorage now with S.entries (which we just mutated locally)
    // would cache the interim state and could reseed stale data on next load.
    const { db, collection, doc, deleteDoc } = window.__firebaseSync;
    deleteDoc(doc(collection(db, 'la-salud', 'sharedData', 'entries'), String(id)))
      .then(() => { setTimeout(_fetchFromServer, 300); }) // re-poll to confirm deletion
      .catch(err => { console.error('[sync] deleteEntry failed', id, err); showToast('Delete failed — check connection'); _fetchFromServer(); });
  } else {
    // Legacy single-doc mode: save() overwrites the whole entries array.
    save();
  }

  renderVitals();
  renderLogTab();
  renderTodayWorkouts();
}

function syncFullDayCheckbox() {
  syncMarkCompleteBtn();
}

// ── STORAGE USAGE WARNING ─────────────────────────────────────────────────
// The entire shared dataset (every meal/workout/weight entry ever logged)
// lives in ONE Firestore document, which has a hard 1MiB size limit. This
// estimates the document's size locally (same shape pushed in pushToCloud)
// and surfaces a warning well before the limit is hit, pointing at the
// "Migrate data" feature in Vitals.
const FIRESTORE_DOC_LIMIT_BYTES = 1048576; // Firestore hard cap, 1 MiB
function estimatedDocBytes() {
  const payload = JSON.stringify({ entries: S.entries, mission: S.mission, weightLog: S.weightLog||[] });
  try { return new Blob([payload]).size; } catch(e) { return payload.length; } // length is a close-enough fallback for plain ASCII JSON
}
function renderStorageStatus() {
  const el = document.getElementById('storage-status');
  if (!el) return;
  const bytes = estimatedDocBytes();
  const pct = Math.round((bytes / FIRESTORE_DOC_LIMIT_BYTES) * 100);
  if (pct < 70) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const kb = Math.round(bytes/1024);
  const full = pct >= 90;
  el.style.display = 'block';
  el.style.cssText = `display:block;font-size:12px;line-height:1.5;padding:8px 10px;border:1px solid ${full?'var(--terra)':'var(--ochre)'};border-radius:3px;margin-bottom:10px;color:${full?'var(--terra)':'var(--ochre)'}`;
  el.innerHTML = full
    ? `⚠ Storage ${pct}% full (${kb}KB of ~1024KB) — cloud sync may start failing soon. Go to Settings → "Storage migration" to fix this now.`
    : `Storage ${pct}% full (${kb}KB of ~1024KB) — approaching the cloud sync limit. Worth visiting Settings → "Storage migration" soon.`;
}

// ── ONE-TAP FIRESTORE SUBCOLLECTION MIGRATION ────────────────────────────
// Current shape: la-salud/sharedData holds one giant doc with entries[],
// weightLog[], mission as JSON arrays — fine until it nears the 1MiB
// Firestore doc cap. This button is invisible/grey until the doc is over
// 70% full, then turns red and pulses. One tap migrates:
//   la-salud/sharedData/entries/{id}    — one doc per meal/workout/water entry
//   la-salud/sharedData/weightLog/{id}  — one doc per weight entry
//   la-salud/sharedData/mission         — stays as the parent doc's mission
//     field (tiny, rarely changes — no need to split it out)
// After migration, the parent doc's entries/weightLog arrays are cleared
// (mission stays) and S.usingSubcollections flips on; pushToCloud/onSnapshot
// branch on that flag from then on. This is the only place that flag is set.
function renderMigrateButtonState() {
  const btn = document.getElementById('migrate-btn');
  const status = document.getElementById('migrate-status');
  if (!btn) return;
  if (S.usingSubcollections) {
    btn.textContent = 'Already migrated ✓';
    btn.disabled = true;
    btn.classList.remove('migrate-urgent');
    status.textContent = 'This device is using the subcollection storage format.';
    return;
  }
  const bytes = estimatedDocBytes();
  const pct = Math.round((bytes / FIRESTORE_DOC_LIMIT_BYTES) * 100);
  if (pct >= 70) {
    btn.textContent = `⚠ Migrate storage now (${pct}% full)`;
    btn.classList.add('migrate-urgent');
    status.textContent = 'The shared document is getting close to the 1MiB Firestore limit. Tap to migrate — this takes a few seconds and is safe to do anytime.';
  } else {
    btn.textContent = 'Storage migration (not needed yet)';
    btn.classList.remove('migrate-urgent');
    status.textContent = `Currently ${pct}% of the storage limit. Nothing to do.`;
  }
}

async function runStorageMigration() {
  if (S.usingSubcollections) { showToast('Already migrated'); return; }
  if (!window.__firebaseSync) { showToast('Not connected to the cloud right now — try again when online'); return; }
  const { db, collection, doc, writeBatch, setDoc, sharedDocRef, deleteField } = window.__firebaseSync;
  const btn = document.getElementById('migrate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Migrating…'; }
  try {
    // Firestore batches cap at 500 writes — chunk if there's a lot of data.
    const chunks = [];
    const all = [...S.entries.map(e=>({...e, _coll:'entries'})), ...S.weightLog.map(w=>({...w, _coll:'weightLog'}))];
    for (let i=0;i<all.length;i+=450) chunks.push(all.slice(i,i+450));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(item => {
        const { _coll, ...data } = item;
        const ref = doc(collection(db, 'la-salud', 'sharedData', _coll), String(data.id));
        batch.set(ref, data);
      });
      await batch.commit();
    }
    // Clear the old arrays from the parent doc, keep mission on it.
    await setDoc(sharedDocRef, { mission: S.mission, entries: deleteField(), weightLog: deleteField(), updatedAt: Date.now() }, { merge: true });
    S.usingSubcollections = true;
    saveLocalOnly();
    showToast('Migration complete — storage is future-proofed');
  } catch (err) {
    showToast('Migration failed — check connection and try again');
    console.error(err);
  }
  renderMigrateButtonState();
}

// ── RENDER: LOG TAB (today's running list) ────────────────────────────────
function renderLogTab() {
  renderStorageStatus();
  syncMarkCompleteBtn();
  if (!cloudReady) {
    const el = document.getElementById('today-entries');
    if (el) el.innerHTML = '<div class="empty-state" style="color:var(--mist);font-size:12px;font-family:\'Space Grotesk\',sans-serif;letter-spacing:1px">⟳&nbsp;Syncing…</div>';
    return;
  }
  const el = document.getElementById('today-entries');
  const meals = entriesFor(S.currentPerson, [todayStr()], 'meal');
  const workouts = entriesFor(S.currentPerson, [todayStr()], 'workout');
  const all = [...meals, ...workouts].sort((a,b) => (a.logged_at||'').localeCompare(b.logged_at||''));

  const personC = S.currentPerson === 'gabi' ? 'var(--gabi-c)' : 'var(--nacho-c)';
  const todayFull = meals.some(e => e.full_day && e.date === todayStr());
  const showCongrats = todayFull;
  const celebrationHtml = showCongrats ? `<div id="congrats-banner" style="text-align:center;padding:20px 10px 16px;margin-bottom:10px;border-bottom:1px solid var(--clay)">
      <img src="https://raw.githubusercontent.com/nachostax/la-salud/main/potato.gif" alt="🥔" style="width:88px;height:auto;display:block;margin:0 auto 14px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:30px;font-style:italic;color:${personC};letter-spacing:0.5px;line-height:1.1">Congratulations</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:10px;letter-spacing:3px;color:var(--mist);text-transform:uppercase;margin-top:8px;opacity:0.7">Day complete ✦</div>
    </div>` : '';
  const bannerSlot = document.getElementById('congrats-banner-slot');
  if (bannerSlot) bannerSlot.innerHTML = celebrationHtml;

  if (!all.length) {
    el.innerHTML = '<div class="empty-state">Nothing logged for ' + (S.currentPerson==='gabi'?'Gabi':'Nacho') + ' today yet.</div>';
    if (showCongrats) launchConfetti();
    return;
  }

  el.innerHTML = all.map(e => {
    if (e.record_type === 'workout') {
      return `<div class="meal-entry" onclick="openEntryDetail(${e.id})" style="cursor:pointer">
        <div class="meal-entry-top">
          <span class="meal-name">🏃 ${e.workout_type}</span>
          <button class="meal-delete" onclick="event.stopPropagation();deleteEntry(${e.id})">×</button>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span class="meal-time">${e.duration_min ? e.duration_min+' min · ' : ''}${e.intensity||''} · ${e.logged_at||''}</span>
          <span class="meal-kcal">${e.calories_burned ? Math.round(e.calories_burned)+' kcal burned' : ''}</span>
        </div>
      </div>`;
    }
    return `<div class="meal-entry" onclick="openEntryDetail(${e.id})" style="cursor:pointer">
      <div class="meal-entry-top">
        <span class="meal-name">${e.hypo_correction ? '🩸 ' : ''}${e.meal || e.name || 'Unnamed entry'}</span>
        <button class="meal-delete" onclick="event.stopPropagation();deleteEntry(${e.id})">×</button>
      </div>
      <div style="display:flex;justify-content:space-between">
        <span class="meal-time">${e.meal_type||''} · ${e.logged_at||''}${e.hypo_correction ? ' · hypo correction, excluded from target' : ''}</span>
        <span class="meal-kcal">${Math.round(e.calories||0)} kcal</span>
      </div>
    </div>`;
  }).join('');
  if (showCongrats) launchConfetti();
}


// ── AI MODE CHECKBOX SYNC ────────────────────────────────────────────────
// setAIMode() is defined in data.js. This patch wraps it so the manual-mode
// checkbox in index.html stays in sync when setAIMode() is called from any
// direction (including the checkbox's own onchange, which is idempotent).
(function patchSetAIMode() {
  const _orig = window.setAIMode;
  if (typeof _orig !== 'function') return;
  window.setAIMode = function(mode) {
    _orig(mode);
    const cb = document.getElementById('manual-mode-checkbox');
    if (cb) cb.checked = (mode === 'manual');
  };
})();
