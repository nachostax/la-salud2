// ── ENTRY DETAIL — fullscreen meal viewer + editor ──────────────────────
// Owns all logic for the fullscreen meal detail/edit panel, wired in from
// both the Log tab (today's list) and the History tab (past day cards).
// Only meal entries (record_type:'meal') are supported — workouts have no
// detail view per spec.

const MEAL_TYPE_LABEL = { breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack', vitamins:'Vitamins' };

// Full-day RDA targets for micronutrients — same table/labels/Gabi-iron
// exception used in vitals.js's micronutrient trend card, so "% of full day
// target" here matches what Vitals already shows elsewhere.
const ED_RDA = {
  magnesium_mg:{label:'Magnesium',  rda:375},  vitd_mcg:{label:'Vitamin D',   rda:15},
  iron_mg:     {label:'Iron',       rda:8},    calcium_mg:{label:'Calcium',  rda:1000},
  zinc_mg:     {label:'Zinc',       rda:10},   b12_mcg:{label:'B12',         rda:2.4},
  omega3_g:    {label:'Omega-3',    rda:1.6},  potassium_mg:{label:'Potassium', rda:3500},
  vitc_mg:     {label:'Vitamin C',  rda:80},   folate_mcg:{label:'Folate',   rda:400}
};

// Scratch state for the panel currently open — null when closed.
let _edId = null;        // id of the entry currently shown (meal detail)
let _edMode = 'view';    // 'view' | 'edit' (meal detail)

// Day-detail scratch state — separate from the meal-detail state above so
// the same panel can hold either view without the two stepping on each
// other. _eddReturnTo remembers "this meal was opened from a day view" so
// closing the meal detail goes back to the day instead of closing the
// whole panel.
let _eddPerson = null;   // person currently shown in day detail
let _eddDate = null;     // date (YYYY-MM-DD) currently shown in day detail
let _eddMode = 'view';   // 'view' | 'edit' (day detail)
let _eddReturnTo = null; // {person, date} to reopen when a meal opened from
                          // within a day view is backed/closed out of — null
                          // when the meal/day was opened directly (Log tab,
                          // History header) with nothing to return to.

function _edFindEntry(id) {
  return S.entries.find(e => e.id === id && e.record_type === 'meal');
}

// ── Panel animation helpers ───────────────────────────────────────────────
// The #entry-detail-panel itself only animates when the whole panel opens
// or closes (push in from right, pop out to right). When navigating between
// views *inside* an already-open panel (day → meal → back to day), we
// animate only the inner content using a temporary sliding overlay so the
// panel itself stays put and the "underneath" view is always already there.

function _edpShow() {
  const panel = document.getElementById('entry-detail-panel');
  if (!panel) return;
  panel.classList.remove('edp-pop-out','edp-push-in');
  panel.style.display = 'block';
  void panel.offsetWidth;
  panel.classList.add('edp-push-in');
  panel.addEventListener('animationend', () => panel.classList.remove('edp-push-in'), { once: true });
}

function _edpHide(onDone) {
  const panel = document.getElementById('entry-detail-panel');
  if (!panel) { if (onDone) onDone(); return; }
  panel.classList.remove('edp-push-in','edp-pop-out');
  void panel.offsetWidth;
  panel.classList.add('edp-pop-out');
  panel.addEventListener('animationend', () => {
    panel.classList.remove('edp-pop-out');
    if (onDone) onDone();
  }, { once: true });
}

// Inner-panel pop: render destination content immediately into #entry-detail-inner,
// then slide a snapshot of the old content out to the right over it.
// Result: destination is already "behind", old view peels away to reveal it.
function _edpInnerPop(renderFn) {
  const inner = document.getElementById('entry-detail-inner');
  if (!inner) { renderFn(); return; }

  // Snapshot current content into an absolutely-positioned overlay
  const panel = document.getElementById('entry-detail-panel');
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:absolute',
    'top:0','left:0','right:0','bottom:0',
    'z-index:5',
    'background:var(--soil)',
    'overflow-y:auto',
    '-webkit-overflow-scrolling:touch',
  ].join(';');
  overlay.innerHTML = inner.innerHTML;
  if (panel) panel.appendChild(overlay);

  // Render destination into inner immediately (sits behind overlay)
  renderFn();

  // Animate overlay out to the right
  void overlay.offsetWidth;
  overlay.style.transition = 'transform 0.34s cubic-bezier(.32,.72,0,1)';
  overlay.style.transform = 'translateX(100%)';
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
}

// Inner-panel push: slide new content in from the right over the current content.
function _edpInnerPush(renderFn) {
  const inner = document.getElementById('entry-detail-inner');
  const panel = document.getElementById('entry-detail-panel');
  if (!inner || !panel) { renderFn(); return; }

  // Create overlay starting off-screen right, render new content into it
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:absolute',
    'top:0','left:0','right:0','bottom:0',
    'z-index:5',
    'background:var(--soil)',
    'overflow-y:auto',
    '-webkit-overflow-scrolling:touch',
    'transform:translateX(100%)',
  ].join(';');
  panel.appendChild(overlay);

  // Temporarily redirect render into overlay
  const realId = inner.id;
  inner.id = '__edp_bg';
  overlay.id = realId;
  renderFn();
  overlay.id = '';
  inner.id = realId;

  // Slide overlay in from right
  void overlay.offsetWidth;
  overlay.style.transition = 'transform 0.34s cubic-bezier(.32,.72,0,1)';
  overlay.style.transform = 'translateX(0)';
  overlay.addEventListener('transitionend', () => {
    inner.innerHTML = overlay.innerHTML;
    overlay.remove();
  }, { once: true });
}


// Every nutrient field that scales proportionally with portion size. Kept
// in one place so the edit-mode slider and the save path treat the same
// set of fields consistently.
const ED_SCALABLE_FIELDS = [
  'calories','protein_g','carbs_g','netcarbs_g','fat_g','fibre_g',
  'magnesium_mg','vitd_mcg','iron_mg','calcium_mg','zinc_mg','b12_mcg',
  'omega3_g','potassium_mg','vitc_mg','folate_mcg'
];

// Legacy entries (pre-standardisation) stored meal_type as a number rather
// than a string key — map those back onto the modern string keys so every
// lookup against MEAL_TYPE_LABEL / typeOpts below works the same regardless
// of when the entry was logged.
const MEAL_TYPE_LEGACY = { 1:'breakfast', 2:'lunch', 3:'dinner', 4:'snack', 5:'vitamins' };

function openEntryDetail(entryId) {
  const e = _edFindEntry(entryId);
  if (!e) return;
  if (typeof e.meal_type === 'number') {
    e.meal_type = MEAL_TYPE_LEGACY[e.meal_type] || 'snack';
  }
  const panel = document.getElementById('entry-detail-panel');
  const panelOpen = panel && panel.style.display === 'block';
  _eddReturnTo = (panelOpen && _eddPerson && _eddDate) ? { person: _eddPerson, date: _eddDate } : null;
  _edId = entryId;
  _edMode = 'view';
  if (panelOpen) {
    // Panel already open (opening meal from day detail) — push content inside panel
    _edpInnerPush(() => _edRenderView(e));
  } else {
    _edRenderView(e);
    _edpShow();
  }
}

function closeEntryDetail() {
  if (_eddReturnTo) {
    // Returning to day detail — pop meal content away inside the panel,
    // revealing the day content already rendered beneath.
    const { person, date } = _eddReturnTo;
    _eddReturnTo = null;
    _eddPerson = person;
    _eddDate = date;
    _eddMode = 'view';
    _edpInnerPop(() => _eddRenderView());
    return;
  }
  // No day to return to — close the whole panel
  _edpHide(() => {
    const panel = document.getElementById('entry-detail-panel');
    if (panel) panel.style.display = 'none';
    const inner = document.getElementById('entry-detail-inner');
    if (inner) inner.innerHTML = '';
    _edId = null;
    _edMode = 'view';
  });
}

// ── shared bits ──────────────────────────────────────────────────────────
function _edPersonColor(person) {
  return person === 'gabi' ? 'var(--gabi-c)' : 'var(--nacho-c)';
}

function _edIronRda(person) {
  return person === 'gabi' ? 18 : ED_RDA.iron_mg.rda;
}

function _edHeader(showEdit) {
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
          <div style="font-family:'Playfair Display',serif;font-size:26px;color:var(--bone);line-height:1">${Math.round(kcal)}</div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-top:2px">kcal</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
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
    <span style="font-size:13px;color:var(--sand);font-family:'JetBrains Mono',monospace">${_edFmtNum(value)}${unit}</span>
  </div>`;
}

function _edFmtNum(n) {
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : String(r);
}

// "this meal / full day target" row — used for both macros and
// micronutrients so the two sections look consistent.
function _edFractionRow(label, value, target, unit, decimals) {
  // Legacy entries sometimes stored macro/micro fields as strings (or other
  // non-numeric values) before logging was standardised — coerce defensively
  // so old entries render instead of throwing on .toFixed().
  value = Number(value) || 0;
  target = Number(target) || 0;
  const valStr = decimals ? value.toFixed(decimals) : _edFmtNum(value);
  const tgtStr = target ? (decimals ? target.toFixed(decimals) : _edFmtNum(target)) : '—';
  const pct = target > 0 ? Math.round((value/target)*100) : null;
  const pctColor = pct === null ? 'var(--mist)' : (pct >= 70 ? 'var(--sage)' : 'var(--terra)');
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--bark)">
    <span style="font-size:12px;color:var(--mist)">${label}</span>
    <span style="font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--sand)">
      ${valStr}${unit} <span style="color:var(--clay)">/</span> ${tgtStr}${unit}
      ${pct !== null ? `<span style="color:${pctColor};margin-left:6px">${pct}%</span>` : ''}
    </span>
  </div>`;
}

function _edMacroFractionsHtml(e) {
  const m = S.mission[e.person] || {};
  return `<div style="padding:14px 16px 0">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">This meal / full day target</div>
    ${_edFractionRow('Kcal', e.calories||0, (m.kcal||0), '')}
    ${_edFractionRow('Protein', e.protein_g||0, (m.protein||0), 'g')}
    ${_edFractionRow('Carbs', e.carbs_g||0, (m.carbs||0), 'g')}
    ${_edFractionRow('Fat', e.fat_g||0, (m.fat||0), 'g')}
  </div>`;
}

function _edMicroFractionsHtml(e) {
  const rows = Object.entries(ED_RDA).map(([key, {label, rda}]) => {
    const rdaActual = key === 'iron_mg' ? _edIronRda(e.person) : rda;
    const decimals = rda < 20 ? 1 : 0;
    return _edFractionRow(label, e[key]||0, rdaActual, '', decimals);
  }).join('');
  return `<div style="padding:14px 16px 0">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">Micronutrients / full day target</div>
    ${rows}
  </div>`;
}

// ── VIEW MODE ────────────────────────────────────────────────────────────
function _edRenderView(e) {
  const color = _edPersonColor(e.person);
  const label = MEAL_TYPE_LABEL[e.meal_type] || '';
  const [y,m,d] = (e.date||'').split('-');
  const dateLabel = (y && m && d) ? new Date(+y,+m-1,+d).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : (e.date||'');

  const html = `
    ${_edHeader(true)}
    <div style="padding:18px 16px 0">
      <div style="font-family:'Playfair Display',serif;font-size:26px;color:var(--bone);line-height:1.15">${e.hypo_correction ? '🩸 ' : ''}${e.meal || e.name || 'Unnamed entry'}</div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
        ${label ? `<span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:${color};text-transform:uppercase;border:1px solid ${color};border-radius:20px;padding:3px 10px">${label}</span>` : ''}
        <span style="font-size:12px;color:var(--mist)">${dateLabel}${e.logged_at ? ' · '+e.logged_at : ''}</span>
      </div>
    </div>
    ${_edDonutHtml(e.calories||0, e.protein_g||0, e.carbs_g||0, e.fat_g||0)}
    ${_edMacroFractionsHtml(e)}
    ${_edMicroFractionsHtml(e)}
    <div style="height:20px"></div>
  `;
  document.getElementById('entry-detail-inner').innerHTML = html;
}

// ── EDIT MODE ────────────────────────────────────────────────────────────
function _edEnterEdit() {
  const e = _edFindEntry(_edId);
  if (!e) return;
  _edMode = 'edit';
  _edRenderEdit(e);
}

function _edCancelEdit() {
  const e = _edFindEntry(_edId);
  if (!e) return;
  _edMode = 'view';
  _edRenderView(e);
}

function _edRenderEdit(e) {
  const typeOpts = ['breakfast','lunch','dinner','snack','vitamins']
    .map(t => `<option value="${t}" ${e.meal_type===t?'selected':''}>${MEAL_TYPE_LABEL[t]}</option>`).join('');

  const fieldStyle = 'width:100%;box-sizing:border-box;background:var(--bark);border:1px solid var(--clay);border-radius:10px;color:var(--sand);padding:8px 10px;font-size:14px;font-family:inherit';

  const html = `
    ${_edHeader(false)}
    <div style="padding:18px 16px 0;display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:block;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:6px">Meal name</label>
        <input type="text" id="ed-f-name" class="themed-field" value="${(e.meal || e.name || 'Unnamed entry').replace(/"/g,'&quot;')}" style="${fieldStyle}">
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
    <div style="height:20px"></div>
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
  _edRenderView(e);
  renderHistory();
  renderVitals();
  renderLogTab();
}

// ── DAY DETAIL — fullscreen day summary ─────────────────────────────────
// Same #entry-detail-panel overlay as the meal detail above, just a
// different renderer. Totals every meal logged for person+date and shows
// it against that person's daily mission target; each meal underneath is
// its own tappable row that opens the existing meal detail view.

function _eddFindDayMeals(person, date) {
  return S.entries.filter(e =>
    e.record_type === 'meal' && e.person === person && e.date === date && !e.hypo_correction
  );
}

function openDayDetail(person, date) {
  _eddPerson = person;
  _eddDate = date;
  _eddMode = 'view';
  _eddReturnTo = null;
  const panel = document.getElementById('entry-detail-panel');
  const panelOpen = panel && panel.style.display === 'block';
  if (panelOpen) {
    // Already inside the panel (shouldn't normally happen via this path,
    // but guard it) — just re-render in place.
    _eddRenderView();
  } else {
    _eddRenderView();
    _edpShow();
  }
}

function closeDayDetail() {
  _edpHide(() => {
    const panel = document.getElementById('entry-detail-panel');
    if (panel) panel.style.display = 'none';
    const inner = document.getElementById('entry-detail-inner');
    if (inner) inner.innerHTML = '';
    _eddPerson = null;
    _eddDate = null;
    _eddMode = 'view';
  });
}

function _eddHeader(showEdit) {
  const editBtn = showEdit
    ? `<button onclick="_eddEnterEdit()" style="background:none;border:none;color:var(--ochre);font-size:20px;cursor:pointer;padding:0;line-height:1">✎</button>`
    : `<span style="width:20px;display:inline-block"></span>`;
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:18px 16px 0">
    <button onclick="closeDayDetail()" style="background:none;border:none;color:rgba(255,255,255,0.75);font-size:22px;cursor:pointer;padding:0;line-height:1">‹</button>
    ${editBtn}
  </div>`;
}

// Meal row inside the day list. In edit mode each row also gets a ×
// delete button (same deleteHistoryEntry used in History), and tapping
// the row itself still opens that meal's own detail view either way.
function _eddMealRowHtml(e, editing) {
  const label = MEAL_TYPE_LABEL[e.meal_type] || '';
  const name = e.meal || e.name || '—';
  const deleteBtn = editing
    ? `<button class="meal-delete" onclick="event.stopPropagation();_eddDeleteMeal(${e.id})" title="Delete entry">×</button>`
    : '';
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:10px 16px;border-bottom:1px solid var(--bark);cursor:pointer" onclick="openEntryDetail(${e.id})">
    <div>${label?`<span style="font-size:10px;color:var(--mist);font-family:'JetBrains Mono',monospace;letter-spacing:1px;margin-right:6px">${label.toUpperCase()}</span>`:''}<span style="font-size:13px;color:var(--sand)">${name}</span></div>
    <span style="display:flex;align-items:center;flex-shrink:0;margin-left:8px">
      <span style="font-size:12px;color:var(--mist)">${e.calories?Math.round(e.calories)+' kcal':''}</span>
      ${deleteBtn}
    </span>
  </div>`;
}

function _eddRenderView() {
  const person = _eddPerson, date = _eddDate;
  const meals = _eddFindDayMeals(person, date);
  const m = S.mission[person] || {};

  const totals = meals.reduce((a,e) => {
    a.kcal += e.calories||0; a.protein += e.protein_g||0;
    a.carbs += e.carbs_g||0; a.fat += e.fat_g||0;
    return a;
  }, { kcal:0, protein:0, carbs:0, fat:0 });

  const [y,mo,d] = (date||'').split('-');
  const dateLabel = (y && mo && d) ? new Date(+y,+mo-1,+d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : (date||'');
  const color = _edPersonColor(person);

  const mealRows = meals.length
    ? meals.map(e => _eddMealRowHtml(e, false)).join('')
    : `<div style="padding:16px;font-size:12px;color:var(--mist)">No meals logged for ${person==='gabi'?'Gabi':'Nacho'} this day.</div>`;

  const html = `
    ${_eddHeader(true)}
    <div style="padding:18px 16px 0">
      <div style="font-family:'Playfair Display',serif;font-size:24px;color:var(--bone);line-height:1.15">${dateLabel}</div>
      <div style="margin-top:6px"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:${color};text-transform:uppercase">${person==='gabi'?'Gabi':'Nacho'}</span></div>
    </div>
    ${_edDonutHtml(totals.kcal, totals.protein, totals.carbs, totals.fat)}
    <div style="padding:14px 16px 0">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px">Day total / full day target</div>
      ${_edFractionRow('Kcal', totals.kcal, (m.kcal||0), '')}
      ${_edFractionRow('Protein', totals.protein, (m.protein||0), 'g')}
      ${_edFractionRow('Carbs', totals.carbs, (m.carbs||0), 'g')}
      ${_edFractionRow('Fat', totals.fat, (m.fat||0), 'g')}
    </div>
    <div style="padding:18px 0 0">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px;padding:0 16px">Meals</div>
      ${mealRows}
    </div>
    <div style="height:20px"></div>
  `;
  document.getElementById('entry-detail-inner').innerHTML = html;
}

function _eddEnterEdit() {
  if (!_eddPerson || !_eddDate) return;
  _eddMode = 'edit';
  _eddRenderEdit();
}

function _eddCancelEdit() {
  if (!_eddPerson || !_eddDate) return;
  _eddMode = 'view';
  _eddRenderView();
}

// Day-level edit mode only exposes per-meal delete — no macro editing here,
// per spec (macro/portion editing happens one level down, in the meal
// detail view via the pencil button on each meal).
function _eddRenderEdit() {
  const person = _eddPerson, date = _eddDate;
  const meals = _eddFindDayMeals(person, date);
  const [y,mo,d] = (date||'').split('-');
  const dateLabel = (y && mo && d) ? new Date(+y,+mo-1,+d).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',year:'numeric'}) : (date||'');

  const mealRows = meals.length
    ? meals.map(e => _eddMealRowHtml(e, true)).join('')
    : `<div style="padding:16px;font-size:12px;color:var(--mist)">No meals logged for ${person==='gabi'?'Gabi':'Nacho'} this day.</div>`;

  const html = `
    ${_eddHeader(false)}
    <div style="padding:18px 16px 0">
      <div style="font-family:'Playfair Display',serif;font-size:24px;color:var(--bone);line-height:1.15">${dateLabel}</div>
      <div style="font-size:11px;color:var(--mist);margin-top:6px">Tap × to delete a meal. Tap a meal to edit its details.</div>
    </div>
    <div style="padding:18px 0 0">
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--mist);text-transform:uppercase;margin-bottom:4px;padding:0 16px">Meals</div>
      ${mealRows}
    </div>
    <div style="padding:14px 16px 0">
      <button class="btn btn-secondary" style="width:100%" onclick="_eddCancelEdit()">Done</button>
    </div>
    <div style="height:20px"></div>
  `;
  document.getElementById('entry-detail-inner').innerHTML = html;
}

// Deletes a meal from inside the day-edit view and re-renders the day in
// place (rather than closing the panel), so deleting several meals in a
// row stays fluid.
function _eddDeleteMeal(id) {
  deleteHistoryEntry(id);
  if (_eddPerson && _eddDate) _eddRenderEdit();
}
