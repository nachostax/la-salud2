// ── KITCHEN TAB — meal picker, frequently eaten, and a shopping list
// built from whatever's currently picked ─────────────────────────────────
function renderKitchen() {
  const freqEl = document.getElementById('kitchen-frequent');
  const shopEl = document.getElementById('kitchen-shopping');
  const sizeEl = document.getElementById('kitchen-size-toggle');
  const tierRowEl = document.getElementById('kitchen-tier-row');
  const bundleSelEl = document.getElementById('kitchen-bundle-select');
  const pickedEl = document.getElementById('kitchen-picked');
  if (!freqEl || !shopEl) return;

  // Mode toggle (single meal vs bundles) reflects whatever was last set,
  // including on first render after reopening the tab or app.
  if (document.getElementById('kmode-single')) setKitchenMode(S.kitchen.mode || 'single');

  // Size toggle pills
  if (sizeEl) {
    sizeEl.innerHTML = ['small','regular','large'].map(s =>
      `<button class="kitchen-size-btn${(S.kitchen.size||'regular')===s?' active':''}" onclick="setKitchenSize('${s}')">${KITCHEN_SIZE_LABEL[s]}</button>`
    ).join('');
  }

  // Time-tier row (single-meal mode)
  if (tierRowEl && !tierRowEl.childElementCount) {
    tierRowEl.innerHTML = KITCHEN_TIERS.map(t =>
      `<div class="kitchen-tier-btn" data-key="${t.key}" onclick="selectKitchenTier('${t.key}')">${t.label}</div>`
    ).join('');
    if (S.kitchen.activeTier) selectKitchenTier(S.kitchen.activeTier);
  }

  // Bundle wheel (bundle mode) — populated once, doesn't need rebuilding per render
  if (bundleSelEl && !bundleSelEl.dataset.populated) {
    bundleSelEl.innerHTML = '<option value="">Choose a bundle…</option>' +
      KITCHEN_BUNDLES.map(b => `<option value="${b.id}">${b.label}</option>`).join('');
    bundleSelEl.dataset.populated = '1';
  }

  // Picked meals list — compact pills, works the same regardless of
  // whether they arrived via single-meal picks or a bundle.
  const checkedMeals = MEAL_LIBRARY.filter(m => S.kitchen.checked[m.id]);
  if (pickedEl) {
    if (!checkedMeals.length) {
      pickedEl.innerHTML = '<div class="kitchen-picked-empty">Nothing picked yet.</div>';
    } else {
      pickedEl.innerHTML = checkedMeals.map(m => {
        const kcal = scaledMacro(m,'kcal'), p = scaledMacro(m,'protein'), c = scaledMacro(m,'carbs'), f = scaledMacro(m,'fat');
        return `<div class="kitchen-picked-item">
          <div class="kitchen-picked-top">
            <span class="kitchen-picked-name">${m.name}</span>
            <span class="kitchen-picked-time">${m.prep}′</span>
            <button class="kitchen-picked-remove" onclick="removeKitchenPick('${m.id}')">✕</button>
          </div>
          <div class="kitchen-picked-macros">${kcal} kcal · P${p}g C${c}g F${f}g${m.gazpacho?' · + gazpacho':''}</div>
          <div class="kitchen-picked-ing">${m.ingredients.join(' · ')}</div>
        </div>`;
      }).join('');
    }
  }

  // Frequently eaten — moved below the picker, above the shopping list.
  let freqHtml = '';
  ['gabi','nacho'].forEach(person => {
    const counts = new Map();
    S.entries.filter(e=>e.record_type==='meal' && e.person===person).forEach(e => {
      counts.set(e.meal, (counts.get(e.meal)||0) + 1);
    });
    const frequent = [...counts.entries()].filter(([,c])=>c>=3).sort((a,b)=>b[1]-a[1]);
    const label = person==='gabi' ? 'Gabi' : 'Nacho';
    if (!frequent.length) {
      freqHtml += `<div style="font-size:12px;color:var(--mist);margin:8px 0">${label}: nothing logged 3+ times yet.</div>`;
    } else {
      freqHtml += `<div style="font-size:12px;color:var(--mist);margin:10px 0 4px">${label}</div>` +
        frequent.map(([meal,c]) => `<div class="meal-entry"><div class="meal-entry-top"><span class="meal-name">${meal}</span><span style="font-size:11px;color:var(--mist)">${c}×</span></div></div>`).join('');
    }
  });
  freqEl.innerHTML = freqHtml;

  // Shopping list = ingredients of whatever's picked, deduped, plus
  // gazpacho if any picked meal calls for it, plus the standing snack staples.
  const ingredientSet = new Set();
  let anyGazpacho = false;
  checkedMeals.forEach(m => { m.ingredients.forEach(i => ingredientSet.add(i)); if (m.gazpacho) anyGazpacho = true; });

  let shopRows = [];
  if (!checkedMeals.length) {
    shopRows.push('Pick a meal or a bundle above to build a list here.');
  } else {
    shopRows = [...ingredientSet].sort();
    if (anyGazpacho) shopRows.push('Gazpacho (Mercadona, brik)');
    shopRows.push('— snacks —');
    shopRows.push('Fruta de temporada', 'Yogur natural o griego (Hacendado)', 'Frutos secos (almendras, nueces)', 'Hummus y crudités (zanahoria, pepino)');
  }
  shopEl.innerHTML = shopRows.map(r => r.startsWith('—')
    ? `<div style="font-size:11px;color:var(--mist);letter-spacing:1.5px;text-transform:uppercase;margin:10px 0 4px;font-family:'JetBrains Mono',monospace">${r.replace(/—/g,'').trim()}</div>`
    : `<div style="font-size:13px;color:var(--sand);padding:5px 0;border-bottom:1px solid var(--clay)">${r}</div>`
  ).join('');
  window.__shoppingListText = shopRows.filter(r=>!r.startsWith('—')).join('\n');
  window.__checkedMealsForSchedule = checkedMeals;
}
function copyShoppingList() {
  if (!window.__shoppingListText) { showToast('Nothing picked yet'); return; }
  copyText(window.__shoppingListText, 'Shopping list copied');
}

// ── COOKING SCHEDULE PROMPT — copies the picked shopping list plus a
// ready-to-paste prompt for any AI model to turn into a cooking schedule ──
// ── "WHAT SHOULD WE EAT RIGHT NOW" — one live suggestion, no library,
// grounded in today's actual remaining budget for both people ─────────────
let hungryTier = '10';
function setHungryTier(t) {
  hungryTier = t;
  ['10','20','30','35plus'].forEach(k => document.getElementById('hungry-tier-'+k).classList.toggle('active', k===t));
}
let hungryMode = 'couple';
function setHungryMode(m) {
  hungryMode = m;
  document.getElementById('hungry-mode-couple').classList.toggle('active', m === 'couple');
  document.getElementById('hungry-mode-solo').classList.toggle('active', m === 'solo');
  refreshHungryModeSoloLabel();
}
function refreshHungryModeSoloLabel() {
  const el = document.getElementById('hungry-mode-solo-label');
  if (el) el.textContent = 'Just me (' + (S.currentPerson === 'gabi' ? 'Gabi' : 'Nacho') + ')';
}
let aiAssistMode = 'couple';
function setAIAssistMode(m) {
  aiAssistMode = m;
  document.getElementById('ai-assist-mode-couple').classList.toggle('active', m === 'couple');
  document.getElementById('ai-assist-mode-solo').classList.toggle('active', m === 'solo');
  refreshAIAssistModeSoloLabel();
}
function refreshAIAssistModeSoloLabel() {
  const el = document.getElementById('ai-assist-mode-solo-label');
  if (el) el.textContent = 'Just me (' + (S.currentPerson === 'gabi' ? 'Gabi' : 'Nacho') + ')';
}
function remainingBudgetToday(person) {
  const m = S.mission[person] || {};
  const eaten = S.entries.filter(e => e.record_type==='meal' && e.person===person && e.date===todayStr() && !e.hypo_correction);
  const sumField = f => eaten.reduce((a,e)=>a+(e[f]||0),0);
  return {
    kcal: Math.max(0, (m.kcal||0) - sumField('calories')),
    protein_g: Math.max(0, (m.protein||0) - sumField('protein_g')),
    carbs_g: Math.max(0, (m.carbs||0) - sumField('carbs_g')),
    fat_g: Math.max(0, (m.fat||0) - sumField('fat_g'))
  };
}
async function runHungryNow() {
  const btn = document.getElementById('hungry-btn');
  const out = document.getElementById('hungry-result');
  if (!getGeminiKey()) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--sand)">No Gemini API key yet — add one in <span style="color:var(--ochre);cursor:pointer;text-decoration:underline" onclick="openSettings()">Settings</span>.</div></div>`;
    return;
  }
  setBtnThinking(btn, true, 'Thinking…');
  try {
    const nacho = remainingBudgetToday('nacho');
    const gabi = remainingBudgetToday('gabi');
    const now = new Date();
    const timeStr = now.toTimeString().slice(0,5);
    const maxMin = hungryTier === '35plus' ? 60 : parseInt(hungryTier);
    const hungryFocus = (document.getElementById('hungry-focus').value || '').trim();
    const focusLine = hungryFocus ? `\n\nExtra context from us: ${hungryFocus}` : '';
    let prompt;
    if (hungryMode === 'solo') {
      const me = remainingBudgetToday(S.currentPerson);
      const meName = S.currentPerson === 'gabi' ? 'Gabi' : 'Nacho';
      const meNote = S.currentPerson === 'gabi' ? " I'm Type 1 diabetic — I track net carbs carefully." : '';
      prompt = `I'm in Valencia, Spain, deciding what to eat right now — just for myself. I shop at Mercadona.

It's currently ${timeStr}. I have up to ${maxMin} minutes to shop/prep/cook (if 60, that means 35+ minutes is fine).

My remaining budget for the REST OF TODAY (already accounts for what I've eaten):
- ${meName}: ${me.kcal} kcal, ${me.protein_g}g protein, ${me.carbs_g}g carbs, ${me.fat_g}g fat left${meNote}

Suggest exactly ONE meal I can buy at Mercadona and cook within the time limit, sized for one person. Give: the meal name, a short ingredient list (Mercadona-realistic), prep time, and approximate kcal/protein/carbs/fat. Keep it to one tight paragraph plus the ingredient list — no alternatives, no chit-chat, no questions.${focusLine}`;
    } else {
      prompt = `We're a couple in Valencia, Spain, deciding what to eat right now — we almost always eat together, one shared meal. We shop at Mercadona.

It's currently ${timeStr}. We have up to ${maxMin} minutes to shop/prep/cook (if 60, that means 35+ minutes is fine).

Remaining budget for the REST OF TODAY (already accounts for what's been eaten):
- Gabi (Type 1 diabetic — tracks net carbs carefully): ${gabi.kcal} kcal, ${gabi.protein_g}g protein, ${gabi.carbs_g}g carbs, ${gabi.fat_g}g fat left
- Nacho: ${nacho.kcal} kcal, ${nacho.protein_g}g protein, ${nacho.carbs_g}g carbs, ${nacho.fat_g}g fat left

Since we eat the same meal together, the portion must fit inside whichever of us has LESS room left — do not exceed either person's remaining kcal or carbs.

Suggest exactly ONE meal we can buy at Mercadona and cook within the time limit. Give: the meal name, a short ingredient list (Mercadona-realistic), prep time, and approximate kcal/protein/carbs/fat per portion. Keep it to one tight paragraph plus the ingredient list — no alternatives, no chit-chat, no questions.${focusLine}`;
    }
    const text = await askGemini(prompt);
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div class="trend-card-title">Right now</div><div style="font-size:13px;color:var(--sand);line-height:1.6">${renderMarkdown(text)}</div></div>`;
  } catch(e) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--sand)">Could not reach Gemini — check your key and connection.</div></div>`;
  } finally {
    setBtnThinking(btn, false, "I'm hungry — suggest something");
  }
}

function buildCookingSchedulePrompt() {
  const checked = window.__checkedMealsForSchedule || [];
  const size = S.kitchen.size || 'regular';
  if (!checked.length) {
    return `I haven't picked any meals yet in my kitchen app — ask me what I feel like eating this week, then suggest a simple Mediterranean cooking schedule for two people having two meals a day (no breakfast) plus snacks, using ingredients available at a Mercadona supermarket.`;
  }
  const mealLines = checked.map(m => {
    const kcal = Math.round(m.kcal * KITCHEN_SIZE_MULT[size]);
    return `- ${m.name} (${m.prep} min prep, ~${kcal} kcal/portion, size: ${KITCHEN_SIZE_LABEL[size]})\n  Ingredients: ${m.ingredients.join(', ')}${m.gazpacho ? '\n  Usually served with a glass of gazpacho on the side.' : ''}`;
  }).join('\n');
  const shoppingList = window.__shoppingListText || '';
  return `I'm planning meals for two people (Gabi and Nacho) who eat two meals a day (no breakfast) plus snacks, shopping mainly at Mercadona. We've picked the following meals to cook from, sized "${KITCHEN_SIZE_LABEL[size]}":

${mealLines}

Full shopping list for these meals:
${shoppingList}

Please write a detailed cooking schedule that:
1. Spreads these meals sensibly across the days they'd realistically be eaten (assume we're starting tomorrow), accounting for which ingredients spoil fastest (fish/seafood/fresh herbs first, cured meats and tinned/jarred things last).
2. For each day, says which meal is lunch and which is dinner, and notes any prep that can be batched ahead (e.g. boiling eggs, cooking a tray of chicken, soaking lentils) to save time later in the week.
3. Flags anything that freezes well if we won't get to it in time.
4. Keeps total prep time reasonable on weeknights — favour the quicker dishes midweek and save anything 35+ minutes for a day with more time.
5. Mentions when to have the gazpacho (which meals it pairs with) and when to restock snacks (fruit, yogurt, nuts, hummus).

Keep it practical and concise — a day-by-day plan, not a full recipe book.`;
}
function copyCookingSchedulePrompt() {
  copyText(buildCookingSchedulePrompt(), 'Prompt copied');
  const btn = document.getElementById('chef-btn');
  if (!btn) return;
  btn.textContent = 'Paste onto any AI for full instructions';
  btn.classList.add('chef-clicked');
  clearTimeout(btn._resetTimer);
  btn._resetTimer = setTimeout(() => {
    btn.textContent = "Let's cook it! 👨‍🍳";
    btn.classList.remove('chef-clicked');
  }, 4000);
}
async function runCookingSchedule() {
  const btn = document.getElementById('chef-btn');
  const out = document.getElementById('chef-result');
  if (!getGeminiKey()) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--sand)">No Gemini API key yet — add one in <span style="color:var(--ochre);cursor:pointer;text-decoration:underline" onclick="openSettings()">Settings</span>, or <span style="color:var(--ochre);cursor:pointer;text-decoration:underline" onclick="copyCookingSchedulePrompt()">copy the prompt</span> to paste elsewhere instead.</div></div>`;
    return;
  }
  setBtnThinking(btn, true, 'Cooking up a plan…');
  try {
    const text = await askGemini(buildCookingSchedulePrompt());
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div class="trend-card-title">Cooking schedule</div><div style="font-size:13px;color:var(--sand);line-height:1.6">${renderMarkdown(text)}</div></div>`;
  } catch(e) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--terra)">${e.message || 'Could not reach Gemini.'}</div></div>`;
  } finally {
    setBtnThinking(btn, false, "Let's cook it! 👨‍🍳");
  }
}

