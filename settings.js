// ── TRENDS (Progress tab, always expanded — no toggle) ─────────────────────
// renderTrends() itself is defined below; it's called directly by
// renderProgress() (vitals.js) whenever the Progress tab is shown or its
// underlying data changes. No open/close state to manage anymore.

// ── SETTINGS OVERLAY ──────────────────────────────────────────────────────
// Plain-language, no macro/calorie typing required from either person — the
// app stays "not intelligent" on purpose, so every field here is a simple
// number or short text, never a calculation they have to do themselves.
function openSettings() {
  openSettingsTab(document.getElementById('hdr-settings-btn'));
}
function closeSettings() {
  // No-op now that Settings is a normal tab (nothing to "close" into) —
  // kept so any old onclick="closeSettings()" references don't error.
}
function renderSettingsBody() {
  document.getElementById('settings-body').innerHTML = `
    <button class="btn btn-primary" style="width:100%;margin-top:6px" onclick="saveSettings()">Save settings</button>
  `;
}

// ── TARGETS (dynamic, active-person-only) ─────────────────────────────────
// Called by showSubSec('targets') in ui.js.
// Renders a single mission-block for S.currentPerson, preserving existing
// field IDs (g-kcal / n-kcal etc.) so that calculateMyIntake() and
// renderActivityControls() continue to work unchanged.
function renderTargetsBody() {
  const p = S.currentPerson;
  const pfx = p === 'gabi' ? 'g' : 'n';
  const name = p === 'gabi' ? 'Gabi' : 'Nacho';
  const color = p === 'gabi' ? 'var(--gabi-c)' : 'var(--nacho-c)';
  const m = S.mission[p] || {};
  const s = S.settings;

  const water = s[`waterGoal_${p}`] || s.waterGoal?.[p] || (p === 'gabi' ? 1750 : 2000);
  const cardioSessions  = s.cardioSessions?.[p]  ?? 3;
  const cardioMins      = s.cardioMins?.[p]      ?? 30;
  const hiitSessions    = s.hiitSessions?.[p]    ?? 1;
  const hiitMins        = s.hiitMins?.[p]        ?? 30;
  const strengthSessions= s.strengthSessions?.[p]?? 3;
  const mobilitySessions= s.mobilitySessions?.[p]?? 5;
  const mobilityMins    = s.mobilityMins?.[p]    ?? 15;

  const el = document.getElementById('targets-body');
  if (!el) return;
  el.innerHTML = `
    <div class="mission-block visible" data-person="${p}">
      <div class="mission-title" style="font-size:18px">
        <div class="dot" style="background:${color}"></div>${name}
      </div>

      <div style="font-family:'Inter',sans-serif;font-weight:600;font-size:13px;letter-spacing:1px;color:var(--mist);text-transform:uppercase;margin:14px 0 10px">Calorie Target</div>

      <div class="mfield">
        <label>3-month goal (this drives your calorie target)</label>
        <select id="${pfx}-goal3kg" onchange="renderActivityControls('${p}')"></select>
      </div>
      <div class="mfield">
        <label>1-year goal weight</label>
        <select id="${pfx}-goal1y"></select>
      </div>
      <div id="${pfx}-calc-breakdown" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mist);margin:8px 0;line-height:1.6"></div>
      <button type="button" class="btn btn-save" style="width:100%;margin-bottom:14px" onclick="calculateMyIntake('${p}')">Calculate Calories</button>
      <div id="${pfx}-ai-assist-wrap"><!-- AI Assist injected by calculateMyIntake --></div>

      <div class="mfield"><label>Daily calorie target (kcal)</label><input type="number" id="${pfx}-kcal" value="${m.kcal||''}" placeholder="${p==='gabi'?'1450':'1950'}"></div>
      <div class="mfield"><label>Protein target (g)</label><input type="number" id="${pfx}-protein" value="${m.protein||''}" placeholder="${p==='gabi'?'100':'145'}"></div>
      <div class="mfield"><label>Carbs target (g)</label><input type="number" id="${pfx}-carbs" value="${m.carbs||''}" placeholder="${p==='gabi'?'130':'175'}"></div>
      <div class="mfield"><label>Fat target (g)</label><input type="number" id="${pfx}-fat" value="${m.fat||''}" placeholder="${p==='gabi'?'45':'55'}"></div>
      <div class="mfield"><label>Steps target</label><input type="number" id="set-steps-${p}" value="${m.stepsTarget||''}" placeholder="10000"></div>
    </div>

    <div style="font-family:'Inter',sans-serif;font-weight:600;font-size:13px;letter-spacing:1px;color:var(--mist);text-transform:uppercase;margin:18px 0 10px">Daily &amp; Weekly Targets</div>

    <div class="mfield" style="margin-bottom:8px">
      <label>Daily water (ml)</label>
      <input type="number" id="set-water-${p}" value="${water}" placeholder="${p==='gabi'?'1750':'2000'}">
    </div>

    <div style="font-size:12px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin:10px 0 6px">Cardio</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="mfield" style="margin:0"><label style="font-size:10px">Sessions/week</label><input type="number" id="set-cardio-sessions-${p}" value="${cardioSessions}" placeholder="3"></div>
      <div class="mfield" style="margin:0"><label style="font-size:10px">Minutes each</label><input type="number" id="set-cardio-mins-${p}" value="${cardioMins}" placeholder="30"></div>
    </div>

    <div style="font-size:12px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin:0 0 6px">HIIT <span style="font-size:10px;opacity:0.7">(VO₂MAX)</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="mfield" style="margin:0"><label style="font-size:10px">Sessions/week</label><input type="number" id="set-hiit-sessions-${p}" value="${hiitSessions}" placeholder="1"></div>
      <div class="mfield" style="margin:0"><label style="font-size:10px">Minutes each</label><input type="number" id="set-hiit-mins-${p}" value="${hiitMins}" placeholder="30"></div>
    </div>

    <div style="font-size:12px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin:0 0 6px">Strength</div>
    <div class="mfield" style="margin-bottom:10px">
      <label style="font-size:10px">Sessions/week</label>
      <input type="number" id="set-strength-sessions-${p}" value="${strengthSessions}" placeholder="3">
    </div>

    <div style="font-size:12px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin:0 0 6px">Mobility</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div class="mfield" style="margin:0"><label style="font-size:10px">Sessions/week</label><input type="number" id="set-mobility-sessions-${p}" value="${mobilitySessions}" placeholder="5"></div>
      <div class="mfield" style="margin:0"><label style="font-size:10px">Minutes each</label><input type="number" id="set-mobility-mins-${p}" value="${mobilityMins}" placeholder="15"></div>
    </div>

    <button class="btn btn-save" style="width:100%;margin-top:6px" onclick="saveTargets()">Save</button>
    <div id="mission-saved" style="display:none;text-align:center;padding:10px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--sage);letter-spacing:2px;margin-top:6px">SAVED</div>
  `;

  // Re-populate goal dropdowns now that the elements exist in the DOM.
  if (typeof populateGoalDropdowns === 'function') populateGoalDropdowns(p);
  if (typeof renderActivityControls === 'function') renderActivityControls(p);
}

// Saves all targets fields for the active person only.
// NOTE TO TEAM D — showSubSec() navigation bug (ui.js):
//   Rapid back-taps cause _subsecStack to desync and the 'subsec-transitioning'
//   class gets permanently stuck on the stage element, breaking all further nav.
//   Fix in showSubSec() before adding transition classes:
//     1. Always remove 'subsec-transitioning' from the stage first.
//     2. Clear all animation classes from both outgoing and target elements.
//     3. Guard against outgoing === target (same section re-triggered — early return).
//   This ensures each transition starts from a clean slate regardless of tap speed.
function saveTargets() {
  const p = S.currentPerson;
  const pfx = p === 'gabi' ? 'g' : 'n';
  const m = S.mission[p];

  const v = id => {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) || undefined : undefined;
  };
  const sv = id => {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
  };

  if (v(`${pfx}-kcal`)    !== undefined) m.kcal    = v(`${pfx}-kcal`);
  if (v(`${pfx}-protein`) !== undefined) m.protein = v(`${pfx}-protein`);
  if (v(`${pfx}-carbs`)   !== undefined) m.carbs   = v(`${pfx}-carbs`);
  if (v(`${pfx}-fat`)     !== undefined) m.fat     = v(`${pfx}-fat`);

  const stepsEl = document.getElementById(`set-steps-${p}`);
  if (stepsEl && stepsEl.value) m.stepsTarget = parseFloat(stepsEl.value) || m.stepsTarget;

  const goalEl = document.getElementById(`${pfx}-goal3kg`);
  if (goalEl && goalEl.value) m.goal3kg = parseFloat(goalEl.value);
  const goal1yEl = document.getElementById(`${pfx}-goal1y`);
  if (goal1yEl && goal1yEl.value) m.goal1yWeight = parseFloat(goal1yEl.value);

  // Water
  const waterEl = document.getElementById(`set-water-${p}`);
  if (waterEl && waterEl.value) {
    if (!S.settings.waterGoal) S.settings.waterGoal = {};
    S.settings.waterGoal[p] = parseFloat(waterEl.value) || (p === 'gabi' ? 1750 : 2000);
  }

  // Workout breakdown targets
  const ensureKey = key => { if (!S.settings[key]) S.settings[key] = {}; };
  const saveField = (settingsKey, elId) => {
    const el = document.getElementById(elId);
    if (el && el.value) { ensureKey(settingsKey); S.settings[settingsKey][p] = parseFloat(el.value); }
  };

  saveField('cardioSessions',   `set-cardio-sessions-${p}`);
  saveField('cardioMins',       `set-cardio-mins-${p}`);
  saveField('hiitSessions',     `set-hiit-sessions-${p}`);
  saveField('hiitMins',         `set-hiit-mins-${p}`);
  saveField('strengthSessions', `set-strength-sessions-${p}`);
  saveField('mobilitySessions', `set-mobility-sessions-${p}`);
  saveField('mobilityMins',     `set-mobility-mins-${p}`);

  save();
  renderVitals();

  const savedEl = document.getElementById('mission-saved');
  if (savedEl) { savedEl.style.display = 'block'; setTimeout(() => savedEl.style.display = 'none', 2000); }
  showToast('Targets saved ✓');
}

// ── QUICK LOG EDITS ────────────────────────────────────────────────────────
function renderQuickLogBody() {
  const p = S.currentPerson;
  const qm = window.QUICK_MEALS || {};
  const coffee = qm.coffee || {};
  const vitamins = qm.multivitamins || {};
  const s = S.settings;

  document.getElementById('quicklog-body').innerHTML = `
    ${p === 'nacho' ? `
    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:6px">☕ Nacho's coffee</div>

      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <label style="font-size:13px;color:var(--sand)">Include honey</label>
        <input type="checkbox" id="ql-nacho-coffee-honey" ${(s.quickLogOverrides?.nacho?.coffeeHoney !== false) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--nacho-c)">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div class="mfield" style="margin:0"><label style="font-size:10px">kcal</label><input type="number" id="ql-nacho-coffee-cal" value="${(s.quickLogOverrides?.nacho?.coffee?.calories) ?? coffee.nacho?.calories ?? 55}" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">carbs g</label><input type="number" id="ql-nacho-coffee-carbs" value="${(s.quickLogOverrides?.nacho?.coffee?.carbs_g) ?? coffee.nacho?.carbs_g ?? 10}" style="margin:0"></div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveQuickLogCoffee()">Save coffee</button>
    </div>
    ` : ''}

    ${p === 'gabi' ? `
    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:6px">🩸 Gabi's hypo correction</div>

      <input type="text" id="ql-hypokit" value="${s.hypoKit?.gabi||''}" placeholder="e.g. 2 cookies (~12.5g sugar)" style="margin-bottom:8px">
      <div style="display:flex;gap:6px">
        <input type="number" id="ql-hypokcal" value="${s.hypoMacros?.gabi?.calories ?? 50}" placeholder="kcal" style="margin-bottom:0">
        <input type="number" id="ql-hypocarbs" value="${s.hypoMacros?.gabi?.carbs_g ?? 13}" placeholder="carbs g" style="margin-bottom:0">
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveQuickLogHypo()">Save hypo correction</button>
    </div>
    ` : ''}

    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:6px">💊 ${p === 'gabi' ? 'Gabi' : 'Nacho'}'s vitamins</div>

      <div class="mfield" style="margin-bottom:8px"><label>Meal name / label</label><input type="text" id="ql-vit-name" value="${(s.quickLogOverrides?.[p]?.vitamins?.meal) ?? vitamins[p]?.meal ?? 'Vitamins'}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <div class="mfield" style="margin:0"><label style="font-size:10px">kcal</label><input type="number" id="ql-vit-cal" value="${(s.quickLogOverrides?.[p]?.vitamins?.calories) ?? vitamins[p]?.calories ?? 18}" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">carbs g</label><input type="number" id="ql-vit-carbs" value="${(s.quickLogOverrides?.[p]?.vitamins?.carbs_g) ?? vitamins[p]?.carbs_g ?? 4.3}" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">protein g</label><input type="number" id="ql-vit-protein" value="${(s.quickLogOverrides?.[p]?.vitamins?.protein_g) ?? vitamins[p]?.protein_g ?? 0}" step="0.1" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">magnesium mg</label><input type="number" id="ql-vit-mag" value="${(s.quickLogOverrides?.[p]?.vitamins?.magnesium_mg) ?? vitamins[p]?.magnesium_mg ?? 175}" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">vit D mcg</label><input type="number" id="ql-vit-vitd" value="${(s.quickLogOverrides?.[p]?.vitamins?.vitd_mcg) ?? vitamins[p]?.vitd_mcg ?? 2.1}" step="0.1" style="margin:0"></div>
        <div class="mfield" style="margin:0"><label style="font-size:10px">B12 mcg</label><input type="number" id="ql-vit-b12" value="${(s.quickLogOverrides?.[p]?.vitamins?.b12_mcg) ?? vitamins[p]?.b12_mcg ?? 2.2}" step="0.1" style="margin:0"></div>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveQuickLogVitamins()">Save vitamins</button>
    </div>
  `;
}

function saveQuickLogCoffee() {
  if (!S.settings.quickLogOverrides) S.settings.quickLogOverrides = {};
  if (!S.settings.quickLogOverrides.nacho) S.settings.quickLogOverrides.nacho = {};
  const hasHoney = document.getElementById('ql-nacho-coffee-honey').checked;
  const cal = parseFloat(document.getElementById('ql-nacho-coffee-cal').value);
  const carbs = parseFloat(document.getElementById('ql-nacho-coffee-carbs').value);
  S.settings.quickLogOverrides.nacho.coffeeHoney = hasHoney;
  S.settings.quickLogOverrides.nacho.coffee = {
    meal: hasHoney ? 'Coffee with milk and honey' : 'Coffee with milk',
    calories: isNaN(cal) ? (hasHoney ? 55 : 30) : cal,
    protein_g: 2, carbs_g: isNaN(carbs) ? (hasHoney ? 10 : 3) : carbs,
    netcarbs_g: isNaN(carbs) ? (hasHoney ? 10 : 3) : carbs,
    fat_g: 1, fibre_g: 0, magnesium_mg: 8, vitd_mcg: 0, iron_mg: 0.1,
    calcium_mg: 50, zinc_mg: 0.1, b12_mcg: 0.2, omega3_g: 0, potassium_mg: 90, vitc_mg: 0, folate_mcg: 2
  };
  // Apply override to the live QUICK_MEALS object
  if (window.QUICK_MEALS) window.QUICK_MEALS.coffee.nacho = { ...S.settings.quickLogOverrides.nacho.coffee };
  save();
  showToast(hasHoney ? 'Coffee with honey saved ✓' : 'Coffee without honey saved ✓');
}

function saveQuickLogHypo() {
  const desc = document.getElementById('ql-hypokit').value;
  const cal = parseFloat(document.getElementById('ql-hypokcal').value);
  const carbs = parseFloat(document.getElementById('ql-hypocarbs').value);
  S.settings.hypoKit.gabi = desc;
  if (!S.settings.hypoMacros) S.settings.hypoMacros = {};
  S.settings.hypoMacros.gabi = { calories: isNaN(cal) ? 50 : cal, carbs_g: isNaN(carbs) ? 13 : carbs };
  save();
  syncHypoQuickBtn();
  showToast('Hypo correction saved ✓');
}

function saveQuickLogVitamins() {
  const p = S.currentPerson;
  if (!S.settings.quickLogOverrides) S.settings.quickLogOverrides = {};
  if (!S.settings.quickLogOverrides[p]) S.settings.quickLogOverrides[p] = {};
  const name = document.getElementById('ql-vit-name').value.trim() || 'Vitamins';
  const cal = parseFloat(document.getElementById('ql-vit-cal').value);
  const carbs = parseFloat(document.getElementById('ql-vit-carbs').value);
  const protein = parseFloat(document.getElementById('ql-vit-protein').value);
  const mag = parseFloat(document.getElementById('ql-vit-mag').value);
  const vitd = parseFloat(document.getElementById('ql-vit-vitd').value);
  const b12 = parseFloat(document.getElementById('ql-vit-b12').value);
  const vitOverride = {
    meal: name,
    calories: isNaN(cal) ? 18 : cal,
    protein_g: isNaN(protein) ? 0.1 : protein,
    carbs_g: isNaN(carbs) ? 4.3 : carbs,
    netcarbs_g: isNaN(carbs) ? 4.3 : carbs,
    fat_g: 0, fibre_g: 0,
    magnesium_mg: isNaN(mag) ? 175 : mag,
    vitd_mcg: isNaN(vitd) ? 2.1 : vitd,
    iron_mg: 0, calcium_mg: 0,
    zinc_mg: 1.5, b12_mcg: isNaN(b12) ? 2.2 : b12,
    omega3_g: 0, potassium_mg: 0, vitc_mg: 12, folate_mcg: 83.3
  };
  S.settings.quickLogOverrides[p].vitamins = vitOverride;
  // Apply override to the live QUICK_MEALS object
  if (window.QUICK_MEALS) window.QUICK_MEALS.multivitamins[p] = { ...vitOverride };
  save();
  showToast('Vitamins updated ✓');
}

// ── API KEY & SYNC (moved out of the old single Settings screen) ───────────
function renderApiKeyBody() {
  const hasGeminiKeySaved = !!localStorage.getItem('gemini_api_key');
  document.getElementById('apikey-body').innerHTML = `
    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:10px">Automatic food sorting</div>

      <div id="gemini-key-saved-view" class="themed-soil-box" style="display:${hasGeminiKeySaved?'flex':'none'};align-items:center;justify-content:space-between;background:var(--soil);border:1px solid var(--sage);border-radius:3px;padding:9px 11px">
        <span style="font-size:13px;color:var(--sage)">✓ Key saved on this device</span>
        <button type="button" class="btn btn-secondary weight-log-btn" onclick="editGeminiKey()">Change</button>
      </div>
      <div id="gemini-key-edit-view" class="weight-log-row" style="display:${hasGeminiKeySaved?'none':'flex'}">
        <input type="password" id="set-gemini-key" value="${localStorage.getItem('gemini_api_key')||''}" placeholder="Gemini API key">
        <button type="button" class="btn btn-secondary weight-log-btn" onclick="saveGeminiKeyOnly()">Save</button>
      </div>
    </div>
    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:10px">Storage migration</div>
      <div id="migrate-status" style="font-size:13px;color:var(--mist);margin-bottom:8px"></div>
      <button class="btn btn-secondary" id="migrate-btn" onclick="runStorageMigration()">Storage migration (checking…)</button>
    </div>
    <div class="trend-card">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:10px">Backup & recovery</div>

      <label class="file-btn">
        Restore from CSV
        <input type="file" accept=".csv,text/csv" onchange="restoreFromCSV(event)">
      </label>
    </div>
    <div class="trend-card" style="border-color:var(--terra)">
      <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;margin-bottom:10px;color:var(--terra)">Migrate data</div>

      <button class="btn btn-secondary" onclick="copyMigrationBundle()">Copy migration bundle</button>
      <button class="btn btn-secondary" onclick="exportMigrationBundle()" style="margin-top:8px">Download migration bundle (.txt)</button>
      <button class="btn btn-secondary" onclick="downloadAppSource()" style="margin-top:8px">Download app source (.html)</button>
    </div>
  `;
  renderMigrateButtonState();
}
function saveGeminiKeyOnly() {
  const val = document.getElementById('set-gemini-key').value.trim();
  localStorage.setItem('gemini_api_key', val);
  if (val) {
    document.getElementById('gemini-key-edit-view').style.display = 'none';
    document.getElementById('gemini-key-saved-view').style.display = 'flex';
  }
  showToast(val ? 'Key saved' : 'Key cleared');
}
function editGeminiKey() {
  document.getElementById('gemini-key-saved-view').style.display = 'none';
  const editView = document.getElementById('gemini-key-edit-view');
  editView.style.display = 'flex';
  document.getElementById('set-gemini-key').focus();
}
function saveSettings() {
  save();
  renderWater();
  showToast('Settings saved');
}
function quickLogHypo() {
  const desc = (S.settings.hypoKit.gabi || document.getElementById('set-hypokit-gabi')?.value || '2 cookies').trim() || '2 cookies';
  const macros = (S.settings.hypoMacros && S.settings.hypoMacros.gabi) || { calories: 50, carbs_g: 13 };
  const date = logDateStr('meal');
  const now = logTimeStr('meal');
  S.entries.push({
    id: Date.now()+Math.random(), record_type:'meal', person:'gabi', date,
    meal: desc, meal_type: 'snack', logged_at: now,
    calories: macros.calories, protein_g:0, carbs_g: macros.carbs_g, netcarbs_g: macros.carbs_g, fat_g:0, fibre_g:0,
    magnesium_mg:0, vitd_mcg:0, iron_mg:0, calcium_mg:0, zinc_mg:0, b12_mcg:0,
    omega3_g:0, potassium_mg:0, vitc_mg:0, folate_mcg:0, hypo_correction:true, full_day:false
  });
  save();
  renderVitals(); renderLogTab(); syncHypoQuickBtn();
  showToast('Low logged — ' + desc + (date !== todayStr() ? ' for ' + date : ''));
  const overlay = document.getElementById('settings-overlay');
  if (overlay && overlay.classList.contains('open')) closeSettings();
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

function renderTrends() {
  const el = document.getElementById('trends-body');
  if (!el) return;
  const wl = S.weightLog || [];
  const entries = S.entries || [];
  const person = S.currentPerson;
  const themeClass = person==='gabi' ? 'tc-gabi' : 'tc-nacho';
  const color = person==='gabi' ? '#6BA3C8' : '#C8863A';

  // Get last 30 days date range
  const dates = [];
  for (let i=29;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    dates.push(toLocalDateStr(d));
  }

  // Fetch each day's entries for this person ONCE — the calorie/protein/water
  // blocks below each used to re-scan the full entries array per day; they
  // now read from this cache and apply their own specific sub-filters to it.
  const grouped = groupEntriesByPersonDate(entries);
  const dayEntriesCache = new Map();
  dates.forEach(d => dayEntriesCache.set(d, grouped.get(person+'|'+d) || []));

  let html = '';

  // ── WEIGHT CHART ──
  {
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
  {
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
  {
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
  {
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

  // ── TARGET HIT RATE (steps / workouts / water — last 30 days) ──
  {
    const targets = dates.map(d => (S.dailyTargets[person]&&S.dailyTargets[person][d]) || {});
    const pct = key => Math.round((targets.filter(t=>t[key]).length / dates.length) * 100);
    html += `<div class="trend-card">
      <div class="trend-card-title ${themeClass}">Target hit rate, last 30 days</div>
      <div class="trend-stat-row">
        <div class="trend-stat"><div class="trend-stat-val">${pct('steps')}%</div><div class="trend-stat-lbl">Steps</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${pct('workout')}%</div><div class="trend-stat-lbl">Workout</div></div>
        <div class="trend-stat"><div class="trend-stat-val">${pct('water')}%</div><div class="trend-stat-lbl">Water</div></div>
      </div>
    </div>`;
  }

  // ── WORKOUT FREQUENCY ──
  {
    const pw = entries.filter(e=>e.record_type==='workout'&&e.person===person);
    if (pw.length) {
      const last30 = pw.filter(w=>dates.includes(w.date));
      const byType = {};
      pw.forEach(w=>{ byType[w.workout_type]=(byType[w.workout_type]||0)+1; });
      const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0];
      const totalBurn = Math.round(last30.reduce((a,b)=>a+(b.calories_burned||0),0));

      html += `<div class="trend-card">
        <div class="trend-card-title ${themeClass}">Workouts (last 30 days)</div>
        <div class="trend-stat-row">
          <div class="trend-stat">
            <div class="trend-stat-val">${last30.length}</div>
            <div class="trend-stat-lbl">Sessions</div>
          </div>
          <div class="trend-stat">
            <div class="trend-stat-val">${totalBurn}</div>
            <div class="trend-stat-lbl">kcal burned</div>
          </div>
          <div class="trend-stat">
            <div class="trend-stat-val" style="font-size:14px">${topType?topType[0]:'—'}</div>
            <div class="trend-stat-lbl">Top type</div>
          </div>
        </div>
      </div>`;
    }
  }

  el.innerHTML = html || '<div class="empty-state">Not enough data yet.<br>Keep logging meals and weight.</div>';
}

// ── XLSX EXPORT ───────────────────────────────────────────────────────────
// Uses SheetJS (xlsx) loaded from CDN
function exportXLSX() {
  if (typeof XLSX === 'undefined') {
    // Load SheetJS dynamically then retry
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => buildAndDownloadXLSX();
    s.onerror = () => showToast('Could not load XLSX library');
    document.head.appendChild(s);
  } else {
    buildAndDownloadXLSX();
  }
}

function buildAndDownloadXLSX() {
  const wb = XLSX.utils.book_new();
  const entries = S.entries || [];
  const wl = S.weightLog || [];

  // ── TAB 1: All meals ──
  const mealRows = entries.filter(e=>e.record_type==='meal').map(e => ({
    Date: e.date, Person: e.person, Meal: e.meal, Time: e.logged_at,
    Type: e.meal_type, Calories: Math.round(e.calories||0),
    Protein_g: Math.round(e.protein_g||0), Carbs_g: Math.round(e.carbs_g||0),
    NetCarbs_g: Math.round(e.netcarbs_g||0), Fat_g: Math.round(e.fat_g||0),
    Fibre_g: Math.round(e.fibre_g||0), Magnesium_mg: Math.round(e.magnesium_mg||0),
    VitD_mcg: Math.round(e.vitd_mcg||0), Iron_mg: Math.round(e.iron_mg||0),
    Calcium_mg: Math.round(e.calcium_mg||0), Zinc_mg: Math.round(e.zinc_mg||0),
    B12_mcg: Math.round(e.b12_mcg||0), Omega3_g: parseFloat((e.omega3_g||0).toFixed(1)),
    Potassium_mg: Math.round(e.potassium_mg||0), VitC_mg: Math.round(e.vitc_mg||0),
    Folate_mcg: Math.round(e.folate_mcg||0), Full_day: e.full_day?'Y':'N',
    Hypo_correction: e.hypo_correction?'Y':'N'
  }));
  const ws1 = XLSX.utils.json_to_sheet(mealRows);
  styleSheet(ws1, mealRows.length);
  XLSX.utils.book_append_sheet(wb, ws1, 'Meals');

  // ── TAB 2: Daily summaries (complete days only) ──
  const allDates = [...new Set(entries.map(e=>e.date))].sort();
  const summaryRows = [];
  allDates.forEach(d => {
    ['gabi','nacho'].forEach(person => {
      const dm = entries.filter(e=>e.person===person&&e.date===d&&e.record_type==='meal');
      if (!dm.length) return;
      const full = dm.some(e=>e.full_day);
      const target = S.mission[person]?.kcal||0;
      // Hypo corrections are excluded from the calorie target comparison —
      // they're a treatment for a low, not part of the day's intended intake.
      const kcalDm = dm.filter(e=>!e.hypo_correction);
      const totalKcal = Math.round(kcalDm.reduce((a,b)=>a+(b.calories||0),0));
      const hypoCount = dm.length - kcalDm.length;
      summaryRows.push({
        Date: d, Person: person, Full_day: full?'Y':'N',
        Total_kcal: totalKcal, Target_kcal: target,
        Delta_kcal: totalKcal - target,
        Protein_g: Math.round(dm.reduce((a,b)=>a+(b.protein_g||0),0)),
        Carbs_g: Math.round(dm.reduce((a,b)=>a+(b.carbs_g||0),0)),
        Fat_g: Math.round(dm.reduce((a,b)=>a+(b.fat_g||0),0)),
        Meals_logged: dm.length,
        Hypo_corrections: hypoCount
      });
    });
  });
  const ws2 = XLSX.utils.json_to_sheet(summaryRows);
  styleSheet(ws2, summaryRows.length);
  XLSX.utils.book_append_sheet(wb, ws2, 'Daily Summary');

  // ── TAB 3: Weight log ──
  const weightRows = wl.sort((a,b)=>a.date.localeCompare(b.date)).map(w => ({
    Date: w.date, Person: w.person, Weight_kg: w.kg
  }));
  const ws3 = XLSX.utils.json_to_sheet(weightRows.length ? weightRows : [{Date:'',Person:'',Weight_kg:''}]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Weight Log');

  // ── TAB 4: Workouts ──
  const wkRows = entries.filter(e=>e.record_type==='workout').map(e=>({
    Date: e.date, Person: e.person, Type: e.workout_type,
    Duration_min: e.duration_min||0, Intensity: e.intensity||'',
    Calories_burned: Math.round(e.calories_burned||0), Notes: e.notes||''
  }));
  const ws4 = XLSX.utils.json_to_sheet(wkRows.length ? wkRows : [{Date:'',Person:'',Type:''}]);
  XLSX.utils.book_append_sheet(wb, ws4, 'Workouts');

  // ── TAB 5: Micronutrient averages ──
  const microKeys = ['magnesium_mg','vitd_mcg','iron_mg','calcium_mg','zinc_mg','b12_mcg','omega3_g','potassium_mg','vitc_mg','folate_mcg'];
  const RDA_vals = { magnesium_mg:375, vitd_mcg:15, iron_mg:8, calcium_mg:1000, zinc_mg:10, b12_mcg:2.4, omega3_g:1.6, potassium_mg:3500, vitc_mg:80, folate_mcg:400 };
  const microRows = [];
  ['gabi','nacho'].forEach(person => {
    const completeDays = [...new Set(
      entries.filter(e=>e.person===person&&e.record_type==='meal'&&e.full_day).map(e=>e.date)
    )];
    if (!completeDays.length) return;
    const row = { Person: person, Complete_days: completeDays.length };
    microKeys.forEach(k => {
      const avg = completeDays.reduce((acc,d)=>{
        return acc + entries.filter(e=>e.person===person&&e.date===d&&e.record_type==='meal').reduce((a,b)=>a+(b[k]||0),0);
      },0) / completeDays.length;
      const rda = (k==='iron_mg'&&person==='gabi') ? 18 : RDA_vals[k];
      row[k+'_avg'] = parseFloat(avg.toFixed(1));
      row[k+'_%RDA'] = Math.round((avg/rda)*100);
    });
    microRows.push(row);
  });
  const ws5 = XLSX.utils.json_to_sheet(microRows.length ? microRows : [{Person:'',Note:'No complete days logged yet'}]);
  XLSX.utils.book_append_sheet(wb, ws5, 'Micronutrients');

  // ── TAB 6: Mission targets ──
  const missionRows = ['gabi','nacho'].map(person => {
    const m = S.mission[person];
    return {
      Person: person, Weight_kg: m.weight, Height_cm: m.height, Age: m.age,
      Goal_3month: m.goal3kg+'kg', Goal_1year_kg: m.goal1yWeight,
      Activity: m.activityLevel, Daily_kcal: m.kcal,
      Protein_g: m.protein, Carbs_g: m.carbs, Fat_g: m.fat
    };
  });
  const ws6 = XLSX.utils.json_to_sheet(missionRows);
  XLSX.utils.book_append_sheet(wb, ws6, 'Targets');

  // ── TAB 7: Water + daily target hits ──
  const waterRows = entries.filter(e=>e.record_type==='water').sort((a,b)=>a.date.localeCompare(b.date)).map(e => {
    const t = (S.dailyTargets[e.person]&&S.dailyTargets[e.person][e.date]) || {};
    const mlVal = getWaterMlForEntry(e);
    return { Date: e.date, Person: e.person, ml: mlVal, Goal_ml: getWaterGoal(e.person), Water_hit: t.water?'Y':'N', Steps_hit: t.steps?'Y':'N', Workout_hit: t.workout?'Y':'N' };
  });
  const ws7 = XLSX.utils.json_to_sheet(waterRows.length ? waterRows : [{Date:'',Person:'',ml:''}]);
  XLSX.utils.book_append_sheet(wb, ws7, 'Water & Targets');

  XLSX.writeFile(wb, 'la-salud-report-' + todayStr() + '.xlsx');
  showToast('Report downloaded');
}

function styleSheet(ws, rowCount) {
  // Set column widths
  const cols = Object.keys(ws).filter(k=>k[0]!=='!').map(k=>k.replace(/\d/g,''));
  const uniq = [...new Set(cols)];
  ws['!cols'] = uniq.map(()=>({ wch: 14 }));
}

init();
backfillDailyTargets(); renderWeightHistories(); checkGeminiKeyHint();
// Apply any saved quick-log overrides (e.g. Nacho's coffee without honey)
if (typeof applyQuickLogOverrides === 'function') applyQuickLogOverrides();

// ── RETROSPECTIVE DATE / TIME ──────────────────────────────────────────────
function _openRetroRow(rowId, dateId, timeId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  const open = row.style.display === 'flex';
  row.style.display = open ? 'none' : 'flex';
  if (!open) {
    if (!document.getElementById(dateId).value) {
      const d = new Date(); d.setDate(d.getDate()-1);
      document.getElementById(dateId).value = toLocalDateStr(d);
    }
    if (!document.getElementById(timeId).value) document.getElementById(timeId).value = '12:00';
  }
}
function toggleRetroDate()   { _openRetroRow('retro-date-row','retro-date-input','retro-time-input'); }
function toggleRetroDateWk() { _openRetroRow('retro-date-row-wk','retro-date-input-wk','retro-time-input-wk'); }
function clearRetroDate() {
  ['retro-date-input','retro-time-input'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('retro-date-row').style.display = 'none';
}
function clearRetroDateWk() {
  ['retro-date-input-wk','retro-time-input-wk'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('retro-date-row-wk').style.display = 'none';
}

// ── HISTORY VIEW ───────────────────────────────────────────────────────────
let lastHistoryCheckTick = null;
function renderHistory() {
  const el = document.getElementById('history-content');
  if (!cloudReady) {
    if (el) el.innerHTML = '<div style="color:var(--mist);font-size:12px;font-family:\'JetBrains Mono\',monospace;letter-spacing:1px;padding:20px 0">⟳&nbsp;Syncing…</div>';
    return;
  }
  // Remember which day panels are currently open so a re-render (e.g. after
  // deleting an entry) doesn't collapse the day the user is looking at.
  const openIds = new Set(
    Array.from(document.querySelectorAll('.hday-detail-wrap.open')).map(n => n.id)
  );
  const p = S.currentPerson || 'gabi';
  const allDates = [...new Set(S.entries.filter(e=>e.person===p).map(e => e.date))].sort().reverse();
  if (!allDates.length) { el.innerHTML = `<div style="color:var(--mist);font-size:13px">No entries yet for ${p==='gabi'?'Gabi':'Nacho'}.</div>`; return; }
  const mealTypeLabel = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', vitamins:'Vitamins' };

  // Fetch each date's entries for this person ONCE — was doing two full
  // S.entries.filter() passes (meals + workouts) per date, for every date
  // ever logged, every time History rendered.
  const grouped = groupEntriesByPersonDate(S.entries);

  el.innerHTML = allDates.map(date => {
    const [y,m,d] = date.split('-');
    const displayDate = new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const dayEntries = grouped.get(p+'|'+date) || [];
    const summaries = [p].map(person => {
      const meals = dayEntries.filter(e=>e.record_type==='meal'&&!e.hypo_correction);
      const workouts = dayEntries.filter(e=>e.record_type==='workout');
      if (!meals.length && !workouts.length) return null;
      return { person, meals, workouts, kcal: Math.round(meals.reduce((a,e)=>a+(e.calories||0),0)), complete: meals.some(e=>e.full_day) };
    }).filter(Boolean);
    if (!summaries.length) return '';
    const id = 'hday-' + date.replace(/-/g,'');

    const pills = summaries.map(s => {
      const color = s.person==='gabi'?'var(--gabi-c)':'var(--nacho-c)';
      const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:3px;vertical-align:middle"></span>`;
      const items = [s.meals.length?s.kcal+'kcal':'', s.workouts.length?s.workouts.length+'🏋':''].filter(Boolean).join(' · ');
      return `${dot}<span style="color:${color}">${s.person.charAt(0).toUpperCase()+s.person.slice(1)}</span> ${items}${s.complete?' ✓':''}`;
    }).join('<span style="color:var(--clay);margin:0 6px">|</span>');

    const detail = summaries.map(s => {
      const color = s.person==='gabi'?'var(--gabi-c)':'var(--nacho-c)';
      const mealLines = s.meals.map(e => {
        const label = mealTypeLabel[e.meal_type] || '';
        const name = e.meal || e.name || '—';
        return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid var(--bark);cursor:pointer" onclick="openEntryDetail(${e.id})">
          <div>${label?`<span style="font-size:10px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin-right:5px">${label.toUpperCase()}</span>`:''}<span style="font-size:12px;color:var(--sand)">${name}</span></div>
          <span style="display:flex;align-items:center;flex-shrink:0;margin-left:8px">
            <span style="font-size:11px;color:var(--mist)">${e.calories?Math.round(e.calories)+' kcal':''}</span>
            <button class="meal-delete" onclick="event.stopPropagation();deleteHistoryEntry(${e.id})" title="Delete entry">×</button>
          </span>
        </div>`;
      }).join('');
      const workoutLines = s.workouts.map(e => {
        const walkLabel = e.workout_type === 'Walking' && e.steps_logged
          ? ' · ' + e.steps_logged.toLocaleString() + ' steps'
          : e.duration_min ? ' · ' + e.duration_min + 'min' : '';
        return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--bark);cursor:pointer" onclick="openEntryDetail(${e.id})">
          <span style="font-size:12px;color:var(--mist)">🏋 ${e.workout_type||e.type||e.name||'Workout'}${walkLabel}</span>
          <span style="display:flex;align-items:center">
            <span style="font-size:11px;color:var(--mist)">${e.calories_burned?'−'+Math.round(e.calories_burned)+' kcal':''}</span>
            <button class="meal-delete" onclick="event.stopPropagation();deleteHistoryEntry(${e.id})" title="Delete entry">×</button>
          </span>
        </div>`;
      }).join('');
      return `<div style="margin-top:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;font-weight:600;color:${color}">${s.person.charAt(0).toUpperCase()+s.person.slice(1)}${s.meals.length?' · '+s.kcal+' kcal':''}</span>
          <label style="display:flex;align-items:center;gap:5px;cursor:pointer">
            <span style="font-size:10px;color:${s.complete?'var(--sage)':'var(--mist)'}">${s.complete?'Full day ✓':'Incomplete'}</span>
            <input type="checkbox" id="hday-check-${s.person}-${date.replace(/-/g,'')}" ${s.complete?'checked':''} onchange="toggleHistoryFullDay('${s.person}','${date}',this.checked)" style="width:15px;height:15px;accent-color:var(--sage);cursor:pointer">
          </label>
        </div>
        ${mealLines}${workoutLines}
      </div>`;
    }).join('');

    return `<div class="day-card hist-day-card">
      <div class="hist-day-hdr" onclick="toggleHistoryDay('${id}')">
        <span class="hist-day-date" style="cursor:pointer" onclick="event.stopPropagation();openDayDetail('${p}','${date}')">${displayDate}</span>
        <span class="hday-arr" style="font-size:11px;color:var(--mist);cursor:pointer" id="${id}-arr">▸</span>
      </div>
      <div style="padding:6px 12px 8px;font-size:12px;color:var(--mist)">${pills}</div>
      <div class="hday-detail-wrap" id="${id}"><div style="padding:0 12px 10px">${detail}</div></div>
    </div>`;
  }).join('');
  // Restore any panels that were open before the re-render.
  openIds.forEach(id => {
    const wrap = document.getElementById(id);
    const arr  = document.getElementById(id + '-arr');
    if (wrap) wrap.classList.add('open');
    if (arr)  arr.classList.add('open');
  });
  if (lastHistoryCheckTick) {
    const cb = document.getElementById('hday-check-' + lastHistoryCheckTick.person + '-' + lastHistoryCheckTick.date.replace(/-/g,''));
    if (cb) cb.classList.add('check-bounce');
    lastHistoryCheckTick = null;
  }
}

function toggleHistoryDay(id) {
  const wrap = document.getElementById(id), arr = document.getElementById(id+'-arr');
  if (!wrap) return;
  const open = wrap.classList.contains('open');
  if (open) {
    wrap.classList.remove('open');
  } else {
    wrap.classList.add('open');
  }
  if (arr) arr.classList.toggle('open', !open);
}

// Delete a single logged entry from inside the expanded History day view.
// Re-renders History in place (rather than full deleteEntry's tab targets)
// so the day stays open and the list just loses that one row.
function deleteHistoryEntry(id) {
  S.entries = S.entries.filter(e => e.id !== id);

  if (S.usingSubcollections && window.__firebaseSync) {
    // Fire the Firestore delete.  Same reasoning as deleteEntry — do NOT touch
    // localStorage here; let the server-confirmed subcollection snapshot do it.
    const { db, collection, doc, deleteDoc } = window.__firebaseSync;
    deleteDoc(doc(collection(db, 'la-salud', 'sharedData', 'entries'), String(id)))
      .then(() => { setTimeout(_fetchFromServer, 300); }) // re-poll to confirm deletion
      .catch(err => { console.error('[sync] deleteHistoryEntry failed', id, err); showToast('Delete failed — check connection'); _fetchFromServer(); });
  } else {
    save();
  }

  renderHistory();
  renderVitals();
  renderTodayWorkouts();
  showToast('Entry deleted');
}

function toggleHistoryFullDay(person, date, checked) {
  let touched = false;
  S.entries.forEach(e => { if (e.person===person&&e.date===date&&e.record_type==='meal') { e.full_day=checked; touched=true; } });
  if (!touched) return;
  save();
  renderVitals();
  if (checked) lastHistoryCheckTick = { person, date };
  renderHistory();
  showToast(checked ? 'Day marked complete ✓' : 'Full-day mark removed');
}

