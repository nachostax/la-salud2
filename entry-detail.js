// ── ENTRY DETAIL — fullscreen meal viewer + editor ──────────────────────
// Owns all logic for the fullscreen meal detail/edit panel, wired in from
// both the Log tab (today's list) and the History tab (past day cards).
// Only meal entries (record_type:'meal') are supported — workouts have no
// detail view per spec.

const MEAL_TYPE_LABEL = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', vitamins:'Vitamins' };

// Scratch state for the panel currently open — null when closed.
let _edId = null;        // id of the entry currently shown
let _edMode = 'view';     // 'view' | 'edit'
let _edPortion = 100;     // 0–200, live slider value (display-only until saved)

function _edFindEntry(id) {
  return S.entries.find(e => e.id === id && e.record_type === 'meal');
}

// Every nutrient field that scales proportionally with portion size. Kept
// in one place so the slider (view mode) and the edit-mode save path treat
// the same set of fields consistently.
const ED_SCALABLE_FIELDS = [
  'calories','protein_g','carbs_g','netcarbs_g','fat_g','fibre_g',
  'magnesium_mg','vitd_mcg','iron_mg','calcium_mg','zinc_mg','b12_mcg',
  'omega3_g','potassium_mg','vitc_mg','folate_mcg'
];

function openEntryDetail(entryId) {
  const e = _edFindEntry(entryId);
  if (!e) return;
  _edId = entryId;
  _edMode = 'view';
  _edPortion = 100;
  _edRenderView(e);
  const panel = document.getElementById('entry-detail-panel');
  if (panel) panel.style.display = 'block';
}

function closeEntryDetail() {
  const panel = document.getElementById('entry-detail-panel');
  if (panel) panel.style.display = 'none';
  const inner = document.getElementById('entry-detail-inner');
  if (inner) inner.innerHTML = '';
  _edId = null;
  _edMode = 'view';
  _edPortion = 100;
}

// ── shared bits ──────────────────────────────────────────────────────────
function _edPersonColor(person) {
  return person === 'gabi' ? 'var(--gabi-c)' : 'var(--nacho-c)';
}

function _edHeader(e, showEdit) {
  const editBtn = showEdit
    ? `<button onclick="_edEnterEdit()" style="background:none;border:none;color:var(--ochre);font-size:20px;cursor:pointer;padding:0;line-height:1">✎</button>`
    : `<span style="width:20px;display:inline-block"></span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 16px 0">
    <button onclick="closeEntryDetail()" style="background:none;border:none;color:rgba(255,255,255,0.75);font-size:22px;cursor:pointer;padding:0;line-height:1">‹</button>
    ${editBtn}
  </div>`;
}

// Macro donut — reuses the exact conic-gradient approach from renderProgress()
// in vitals.js: protein = var(--sage), carbs = var(--ochre), fat = var(--terra).
// Built fully inline here since the panel can't depend on the .donut/.legend
// classes living in style.css (kept self-contained, same visual language).
function _edDonutHtml(kcal, protein, carbs, fat) {
  const pKcal = protein*4, cKcal = carbs*4, fKcal = fat*9;
  const macroTotal = pKcal + cKcal + fKcal;
  let bg = 'var(--clay)';
  if (macroTotal > 0) {
    const p1 = (pKcal/macroTotal*100).toFixed(1);
    const p2 = (p1*1 + cKcal/macroTotal*100).toFixed(1);
    bg = `conic-gradient(var(--sage) 0% ${p1}%, var(--ochre) ${p1}% ${p2}%, var(--terra) ${p2}% 100%)`;
  }
  return `
    <div style="display:flex;align-items:center;gap:20px;padding:18px 16px 4px">
      <div style="position:relative;width:120px;height:120px;flex-shrink:0">
        <div style="width:120px;height:120px;border-radius:50%;background:${bg}"></div>
        <div style="position:absolute;inset:14px;border-radius:50%;background:var(--soil);display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div id="ed-kcal-center" style="font-family:'Playfair Display',serif;font-size:26px;color:var(--bone);line-height:1">${Math.round(kcal)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-top:2px">kcal</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px" id="ed-macro-legend">
        ${_edLegendRow('var(--sage)','Protein', protein,'g')}
        ${_edLegendRow('var(--ochre)','Carbs', carbs,'g')}
        ${_edLegendRow('var(--terra)','Fat', fat,'g')}
      </div>
    </div>`;
}

function _edLegendRow(color, label, value, unit) {
  return `<div style="display:flex;align-items:center;gap:7px">
    <div style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0"></div>
    <span style="font-size:12px;color:var(--mist);min-width:54px">${label}</span>
    <span style="font-size:13px;color:var(--sand);font-family:'JetBrains Mono',monospace" data-ed-legend="${label.toLowerCase()}">${_edFmtNum(value)}${unit}</span>
  </div>`;
}

function _edFmtNum(n) {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : String(r);
}

// ── VIEW MODE ────────────────────────────────────────────────────────────
function _edRenderView(e) {
  const color = _edPersonColor(e.person);
  const label = MEAL_TYPE_LABEL[e.meal_type] || '';
  const [y,m,d] = (e.date||'').split('-');
  const dateLabel = (y && m && d) ? new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : (e.date||'');

  const html = `
    ${_edHeader(e, true)}
    <div style="padding:18px 16px 0">
      <div style="font-family:'Playfair Display',serif;font-size:26px;color:var(--bone);line-height:1.15">${e.hypo_correction ? '🩸 ' : ''}${e.meal||'Meal'}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
        ${label ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:${color};text-transform:uppercase;border:1px solid ${color};border-radius:20px;padding:3px 10px">${label}</span>` : ''}
        <span style="font-size:12px;color:var(--mist)">${dateLabel}${e.logged_at ? ' · '+e.logged_at : ''}</span>
      </div>
    </div>
    ${_edDonutHtml(e.calories||0, e.protein_g||0, e.carbs_g||0, e.fat_g||0)}
    <div style="padding:18px 16px 0">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase">Portion size</span>
        <span style="font-size:13px;color:var(--sand)" id="ed-portion-val">100% <span style="color:var(--mist);font-size:11px">(as logged)</span></span>
      </div>
      <input type="range" min="0" max="200" value="100" id="ed-portion-slider" oninput="_edOnPortionInput(this.value)" style="width:100%;accent-color:var(--ochre)">
    </div>
  `;
  document.getElementById('entry-detail-inner').innerHTML = html;
}

// Live, display-only scaling as the portion slider moves in view mode.
// Does not touch S.entries or call save() — purely visual until the user
// commits via edit mode (or a future "apply portion" action).
function _edOnPortionInput(val) {
  const pct = Number(val) || 0;
  _edPortion = pct;
  const e = _edFindEntry(_edId);
  if (!e) return;
  const factor = pct / 100;

  const valEl = document.getElementById('ed-portion-val');
  if (valEl) valEl.innerHTML = pct + '%' + (pct === 100 ? ' <span style="color:var(--mist);font-size:11px">(as logged)</span>' : '');

  const kcalEl = document.getElementById('ed-kcal-center');
  if (kcalEl) kcalEl.textContent = Math.round((e.calories||0) * factor);

  const legend = { protein: e.protein_g||0, carbs: e.carbs_g||0, fat: e.fat_g||0 };
  Object.keys(legend).forEach(key => {
    const span = document.querySelector(`[data-ed-legend="${key}"]`);
    if (span) span.textContent = _edFmtNum(legend[key] * factor) + 'g';
  });
}

// ── EDIT MODE ────────────────────────────────────────────────────────────
function _edEnterEdit() {
  const e = _edFindEntry(_edId);
  if (!e) return;
  _edMode = 'edit';
  _edPortion = 100;
  _edRenderEdit(e);
}

function _edCancelEdit() {
  const e = _edFindEntry(_edId);
  if (!e) return;
  _edMode = 'view';
  _edPortion = 100;
  _edRenderView(e);
}

function _edRenderEdit(e) {
  const typeOpts = ['breakfast','lunch','dinner','snack','vitamins']
    .map(t => `<option value="${t}" ${e.meal_type===t?'selected':''}>${MEAL_TYPE_LABEL[t]}</option>`).join('');

  const fieldStyle = 'width:100%;box-sizing:border-box;background:var(--bark);border:1px solid var(--clay);border-radius:10px;color:var(--sand);padding:8px 10px;font-size:14px;font-family:inherit';

  const html = `
    ${_edHeader(e, false)}
    <div style="padding:18px 16px 0;display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Meal name</label>
        <input type="text" id="ed-f-name" class="themed-field" value="${(e.meal||'').replace(/"/g,'&quot;')}" style="${fieldStyle}">
      </div>
      <div>
        <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Meal type</label>
        <select id="ed-f-type" style="${fieldStyle}">${typeOpts}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div>
          <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Kcal</label>
          <input type="number" id="ed-f-kcal" inputmode="decimal" value="${_edFmtNum(e.calories||0)}" style="${fieldStyle}">
        </div>
        <div>
          <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Protein (g)</label>
          <input type="number" id="ed-f-protein" inputmode="decimal" value="${_edFmtNum(e.protein_g||0)}" style="${fieldStyle}">
        </div>
        <div>
          <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Carbs (g)</label>
          <input type="number" id="ed-f-carbs" inputmode="decimal" value="${_edFmtNum(e.carbs_g||0)}" style="${fieldStyle}">
        </div>
        <div>
          <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Fat (g)</label>
          <input type="number" id="ed-f-fat" inputmode="decimal" value="${_edFmtNum(e.fat_g||0)}" style="${fieldStyle}">
        </div>
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase">Portion size</span>
          <span style="font-size:13px;color:var(--sand)" id="ed-portion-val-edit">100% <span style="color:var(--mist);font-size:11px">(as logged)</span></span>
        </div>
        <input type="range" min="0" max="200" value="100" id="ed-portion-slider-edit" oninput="_edOnPortionInputEdit(this.value)" style="width:100%;accent-color:var(--ochre)">
        <div style="font-size:11px;color:var(--mist);margin-top:6px">Dragging this scales the fields above proportionally from the originally logged amounts.</div>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-secondary" style="flex:1" onclick="_edCancelEdit()">Cancel</button>
        <button class="btn" style="flex:1" onclick="_edSave()">Save</button>
      </div>
    </div>
  `;
  document.getElementById('entry-detail-inner').innerHTML = html;
}

// Edit-mode portion slider: scales the visible kcal/protein/carbs/fat inputs
// (display-only, relative to the entry's original logged values) so they
// can still be hand-tweaked afterward before Save.
function _edOnPortionInputEdit(val) {
  const pct = Number(val) || 0;
  const e = _edFindEntry(_edId);
  if (!e) return;
  const factor = pct / 100;

  const valEl = document.getElementById('ed-portion-val-edit');
  if (valEl) valEl.innerHTML = pct + '%' + (pct === 100 ? ' <span style="color:var(--mist);font-size:11px">(as logged)</span>' : '');

  const kcalEl = document.getElementById('ed-f-kcal');
  if (kcalEl) kcalEl.value = _edFmtNum((e.calories||0) * factor);
  const pEl = document.getElementById('ed-f-protein');
  if (pEl) pEl.value = _edFmtNum((e.protein_g||0) * factor);
  const cEl = document.getElementById('ed-f-carbs');
  if (cEl) cEl.value = _edFmtNum((e.carbs_g||0) * factor);
  const fEl = document.getElementById('ed-f-fat');
  if (fEl) fEl.value = _edFmtNum((e.fat_g||0) * factor);
}

// Commits the edit panel back into S.entries. If the portion slider was
// moved, every nutrient field (not just the four visible macro inputs) is
// scaled from the entry's pre-edit values, so micronutrient totals used
// elsewhere (e.g. Vitals' gap analysis) stay consistent with a scaled meal.
function _edSave() {
  const e = _edFindEntry(_edId);
  if (!e) return;

  const name = (document.getElementById('ed-f-name').value || '').trim() || 'Meal';
  const type = document.getElementById('ed-f-type').value;
  const kcal = parseFloat(document.getElementById('ed-f-kcal').value) || 0;
  const protein = parseFloat(document.getElementById('ed-f-protein').value) || 0;
  const carbs = parseFloat(document.getElementById('ed-f-carbs').value) || 0;
  const fat = parseFloat(document.getElementById('ed-f-fat').value) || 0;

  const portionPct = Number(document.getElementById('ed-portion-slider-edit').value) || 100;
  const factor = portionPct / 100;

  e.meal = name;
  e.meal_type = type;
  e.calories = kcal;
  e.protein_g = protein;
  e.carbs_g = carbs;
  e.fat_g = fat;

  // If the slider moved away from 100, scale every other nutrient field
  // (micronutrients, netcarbs, fibre) from its pre-edit value so the meal's
  // full nutrition profile stays proportionally consistent — only the four
  // fields above are hand-editable directly, the rest follow the slider.
  if (factor !== 1) {
    ED_SCALABLE_FIELDS.forEach(f => {
      if (f === 'calories' || f === 'protein_g' || f === 'carbs_g' || f === 'fat_g') return;
      if (typeof e[f] === 'number') e[f] = e[f] * factor;
    });
  }

  save();
  _edMode = 'view';
  _edPortion = 100;
  _edRenderView(e);
  renderHistory();
  renderVitals();
  renderLogTab();
}
