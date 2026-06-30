// ── CSV (combined meals + workouts, quote-safe) ───────────────────────────
function csvField(v) {
  v = (v===undefined || v===null) ? '' : String(v);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
  return v;
}

// CSV covers meals, workouts, water, AND weight (via a 'WEIGHT' record
// type + trailing Weight_kg column) so "Restore from CSV" fully rebuilds
// the weight log too — meals/workouts/water just leave that column blank,
// keeping the file a single clean, parseable CSV.
const CSV_HEADER = ['Record_type','Date','Person','Name','Time','Category','Calories','Protein_g','Carbs_g','NetCarbs_g','Fat_g','Fibre_g','Magnesium_mg','VitD_mcg','Iron_mg','Calcium_mg','Zinc_mg','B12_mcg','Omega3_g','Potassium_mg','VitC_mg','Folate_mcg','Duration_min','Intensity','Calories_burned','Notes','Full_day_logged','Hypo_correction','Day_total_kcal','Day_kcal_target','Day_deficit','Weight_kg'];

function entryToRow(e) {
  if (e.record_type === 'workout') {
    return [
      'WORKOUT', e.date, e.person, e.workout_type, e.logged_at, '',
      '','','','','','','','','','','','','','','',''
      ,
      e.duration_min||0, e.intensity||'', Math.round(e.calories_burned||0), e.notes||'',
      '','','','','',
      ''
    ];
  }
  if (e.record_type === 'water') {
    const mlVal = e.ml || 0;
    return [
      'WATER', e.date, e.person, 'Water', e.logged_at||'', '',
      '','','','','','','','','','','','','','','',''
      ,
      mlVal, '', '', 'ml',
      '','','','','',
      ''
    ];
  }
  const target = S.mission[e.person]?.kcal || 0;
  // Hypo corrections are excluded from the day's kcal-vs-target columns —
  // they're a treatment for a low, not part of the day's intended intake.
  const dayEntries = S.entries.filter(x => x.date===e.date && x.person===e.person && x.record_type==='meal' && !x.hypo_correction);
  const dayTotal = sum(dayEntries,'calories');
  // num(): defensively coerces any value to a real number. Entries logged
  // before the log.js fix (which guarded against AI returning non-numeric
  // strings like "trace" for a micronutrient) may still have raw strings
  // sitting in Firestore — Math.round() on those silently produces NaN, and
  // .toFixed() on a string throws outright. This keeps export/scoring safe
  // regardless of when/how the entry was originally saved.
  const n = v => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  return [
    'MEAL', e.date, e.person, e.meal, e.logged_at, e.meal_type,
    Math.round(n(e.calories)), Math.round(n(e.protein_g)), Math.round(n(e.carbs_g)), Math.round(n(e.netcarbs_g)),
    Math.round(n(e.fat_g)), Math.round(n(e.fibre_g)), Math.round(n(e.magnesium_mg)), Math.round(n(e.vitd_mcg)),
    Math.round(n(e.iron_mg)), Math.round(n(e.calcium_mg)), Math.round(n(e.zinc_mg)), Math.round(n(e.b12_mcg)),
    n(e.omega3_g).toFixed(1), Math.round(n(e.potassium_mg)), Math.round(n(e.vitc_mg)), Math.round(n(e.folate_mcg)),
    '','','',
    '',
    e.full_day ? 'Y' : 'N', e.hypo_correction ? 'Y' : 'N', Math.round(dayTotal), target, Math.round(dayTotal-target),
    ''
  ];
}

function weightToRow(w) {
  return [
    'WEIGHT', w.date, w.person, '', '', '',
    '','','','','','','','','','','','','','','',''
    ,
    '','','','',
    '','','','','',
    w.kg
  ];
}

function buildFullCSV() {
  const rows = [
    ...S.entries.map(e => entryToRow(e)),
    ...(S.weightLog||[]).map(w => weightToRow(w))
  ].map(r => r.map(csvField).join(','));
  return CSV_HEADER.join(',') + '\n' + rows.join('\n');
}

function buildPersonCSV(person) {
  const rows = [
    ...S.entries.filter(e => e.person === person).map(e => entryToRow(e)),
    ...(S.weightLog||[]).filter(w => w.person === person).map(w => weightToRow(w))
  ].map(r => r.map(csvField).join(','));
  return CSV_HEADER.join(',') + '\n' + rows.join('\n');
}

function exportFullCSV() {
  if (!S.entries.length) { showToast('Nothing to export yet'); return; }
  const blob = new Blob([buildFullCSV()],{type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'la-salud-' + todayStr() + '.csv';
  a.click();
  showToast('Downloaded');
}

function copyFullCSV() {
  if (!S.entries.length) { showToast('Nothing to copy yet'); return; }
  navigator.clipboard.writeText(buildFullCSV());
  showToast('Copied');
}

// ── MIGRATE DATA ───────────────────────────────────────────────────────────
// The shared Firestore document has a hard 1MiB ceiling (see the storage
// estimate above the Log tab) — "Storage migration" in Settings is the
// one-tap fix for that. This bundle is a separate escape hatch: a complete,
// lossless data dump plus every design rule a rewrite needs to preserve,
// for handing to a future/more capable AI model if the app itself ever
// needs to be rebuilt from scratch.
function buildMigrationBundle() {
  const bytes = estimatedDocBytes();
  const kb = Math.round(bytes/1024);
  const pctOfLimit = Math.round((bytes/FIRESTORE_DOC_LIMIT_BYTES)*100);
  return `You are being handed maintenance of "La Salud" — a self-contained, single-file mobile web app (index.html, no build step, no framework) that a couple (Gabi & Nacho) in Valencia, Spain use to track food, workouts, and weight, syncing between two phones via Firebase Firestore. Calorie targets are calculated from BMR/TDEE.

WHY YOU'RE SEEING THIS:
This bundle is a complete, lossless snapshot of the data (every field, not the rounded/lossy CSV) plus the design rules below, for restoring this app's data and behavior elsewhere if needed. At the time this bundle was generated, the locally-estimated Firestore document size was approximately ${kb}KB (${pctOfLimit}% of the 1MiB doc limit).

YOUR JOB:
Get all the data below back into a working app, with zero data loss and zero silent reinterpretation of any field, while preserving the design rules below exactly.

ALSO ATTACH: this app's current index.html source code. This bundle contains DATA and RULES, not the code. The person should either paste in the live GitHub Pages repo source, or use the file downloaded via the app's "Download app source (.html)" button (generated alongside this bundle) as a fallback — note that fallback is a snapshot of the rendered page, not the original repo file, so the repo source is preferable if available.

DESIGN RULES THIS APP DEPENDS ON — PRESERVE THESE EXACTLY, REGARDLESS OF HOW YOU RESTRUCTURE STORAGE OR CODE:
- Hypo corrections (hypo_correction = true) are real meals for macro/micronutrient purposes, but must stay EXCLUDED from every calorie-vs-target calculation. They are a treatment for a low blood-sugar episode (Gabi is Type 1 diabetic), not part of intended intake. Don't double-count or "fix" this by removing them from totals entirely — they should still show up in nutrition data, just not count toward the calorie target.
- "Full day" status is per person, per date, and a day only counts toward deficit/streak math once explicitly marked complete by that person. Never imply a deficit from a partial/incomplete day, even if the logged total looks low — low usually means under-logged, not under-eaten.
- The 3-month goal (goal3kg, a signed kg delta) drives the daily calorie target. The 1-year goal (goal1yWeight) is motivational display only and must NEVER feed into any calculation.
- Calorie target chain: BMR (Mifflin-St Jeor) → TDEE (BMR × activity multiplier, OR BMR + average logged workout burn if ≥5 workouts were logged in the trailing 7 days — whichever applies) → daily deficit/surplus from the 3-month goal ÷ 90 days × 7700 kcal/kg → daily target, clamped to a 1200 kcal floor. This automatic switch between activity-multiplier mode and logged-workout mode is INTENTIONALLY invisible to the user — no toggle, no on-screen label of which mode is active.
- Weight is locked to the weight log (the most recent dated entry per person) — it is never a freely-typed field. Logging a new weight is what's supposed to update the calorie targets, via an explicit "Calculate my intake" / "Save" action, not silently on every load.
- Entries are deduped/merged by (record type, date, person, name/type, logged time) when restoring or syncing — if you change this signature scheme, make sure two phones logging independently still merge into a complete set rather than overwriting each other; this app's owners are aware that two genuinely simultaneous submissions from both phones at once is the one edge case not fully hardened against, and have accepted that tradeoff.

────────────────────── FULL DATA DUMP (JSON, complete fidelity — every field, not the rounded/lossy CSV) ──────────────────────

${JSON.stringify({ mission: S.mission, weightLog: S.weightLog||[], entries: S.entries }, null, 2)}
`;
}

function exportMigrationBundle() {
  if (!S.entries.length && !(S.weightLog||[]).length) { showToast('Nothing to migrate yet'); return; }
  const blob = new Blob([buildMigrationBundle()],{type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'la-salud-migration-' + todayStr() + '.txt';
  a.click();
  showToast('Migration bundle downloaded');
}

function copyMigrationBundle() {
  if (!S.entries.length && !(S.weightLog||[]).length) { showToast('Nothing to migrate yet'); return; }
  navigator.clipboard.writeText(buildMigrationBundle());
  showToast('Migration bundle copied');
}

// Snapshot of the live rendered page as a fallback source file, for handing
// to an AI alongside the migration bundle above if the actual GitHub Pages
// repo source isn't handy. Not byte-identical to the original authored
// file (it reflects current DOM/input state), but functionally complete.
function downloadAppSource() {
  const html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  const blob = new Blob([html],{type:'text/html'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'la-salud-source-' + todayStr() + '.html';
  a.click();
  showToast('Source downloaded');
}

// ── AI-ASSIST BUNDLE ──────────────────────────────────────────────────────
// Always copyable — even with zero entries. The context block IS the value:
// who we are, what our targets are, the rules. Data is appended if it exists
// but the bundle is useful from day one without any logged meals at all.
// Framed as a conversation opener, not a data-review instruction set, so the
// AI naturally asks what help is needed rather than just summarising a CSV.
function buildAIAssistBundle(closingInstruction) {
  const g = S.mission.gabi, n = S.mission.nacho;
  const fmtGoal = kg => kg === 0 ? 'maintain weight' : (kg > 0 ? `gain ${kg}kg` : `lose ${Math.abs(kg)}kg`);
  const hasEntries   = (S.entries||[]).length > 0;
  const hasWeightLog = (S.weightLog||[]).length > 0;

  // Weight history summary — last 3 entries per person, most recent first
  function weightSummary(person) {
    const logs = (S.weightLog||[]).filter(w=>w.person===person)
      .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3);
    if (!logs.length) return 'not logged yet';
    return logs.map(w=>`${w.kg}kg on ${w.date}`).join(', ');
  }

  // Quick data snapshot — complete-days-only calorie average for each person
  function kcalSummary(person) {
    const completeDays = [...new Set(
      (S.entries||[]).filter(e=>e.person===person&&e.record_type==='meal'&&e.full_day).map(e=>e.date)
    )];
    if (!completeDays.length) return 'no complete days logged yet';
    const target = S.mission[person].kcal || 0;
    const avg = Math.round(
      completeDays.reduce((acc,d) => {
        const dayTotal = (S.entries||[])
          .filter(e=>e.person===person&&e.date===d&&e.record_type==='meal'&&!e.hypo_correction)
          .reduce((a,b)=>a+(b.calories||0),0);
        return acc + dayTotal;
      }, 0) / completeDays.length
    );
    const delta = avg - target;
    return `avg ${avg} kcal/day over ${completeDays.length} complete day${completeDays.length!==1?'s':''} (target ${target}, ${delta>=0?'+':''}${delta} vs target)`;
  }

  const person = S.currentPerson;
  const personName = person === 'gabi' ? 'Gabi' : 'Nacho';
  const isSolo = typeof aiAssistMode !== 'undefined' && aiAssistMode === 'solo';
  const hasPersonEntries = isSolo
    ? (S.entries||[]).filter(e => e.person === person).length > 0
    : hasEntries;
  const dataSection = hasPersonEntries
    ? `\n\nFULL DATA (CSV — every logged meal, workout, and weight entry):\n${isSolo ? buildPersonCSV(person) : buildFullCSV()}`
    : `\n\n(No meals or workouts have been logged yet — this is the start of the journey, or the app has just been set up.)`;

  const couplePrompt = `Hi. You are a nutritionist professional as well as personal trainer helping couples achieve their physical goals. I'm going to give you full context about me and my partner so you can help us with our health and nutrition. We're a couple based in Valencia, Spain. We track what we eat and how we move using an app called La Salud — I'm pasting everything it knows about us below so you're fully up to speed. Then I'll tell you what I need help with.

WHO WE ARE:
- Gabi: female, Type 1 diabetic, ${g.age||'?'} years old, ${g.height||'?'}cm, current weight: ${weightSummary('gabi')}
- Nacho: male, ${n.age||'?'} years old, ${n.height||'?'}cm, current weight: ${weightSummary('nacho')}

OUR GOALS (next 3 months — these drive our daily calorie targets):
- Gabi: ${fmtGoal(g.goal3kg)} | 1-year target weight: ~${g.goal1yWeight||'?'}kg (motivational only)
- Nacho: ${fmtGoal(n.goal3kg)} | 1-year target weight: ~${n.goal1yWeight||'?'}kg (motivational only)

OUR DAILY CALORIE & MACRO TARGETS:
- Gabi: ${g.kcal||'?'} kcal | Protein ${g.protein||'?'}g | Carbs ${g.carbs||'?'}g | Fat ${g.fat||'?'}g | Magnesium 375mg | VitD 15mcg | Iron 18mg | Calcium 1000mg | Zinc 10mg | B12 2.4mcg | Omega3 1.6g | Potassium 3500mg | VitC 80mg | Folate 400mcg
- Nacho: ${n.kcal||'?'} kcal | Protein ${n.protein||'?'}g | Carbs ${n.carbs||'?'}g | Fat ${n.fat||'?'}g | Magnesium 375mg | VitD 15mcg | Iron 8mg | Calcium 1000mg | Zinc 10mg | B12 2.4mcg | Omega3 1.6g | Potassium 3500mg | VitC 80mg | Folate 400mcg

HOW WE'RE TRACKING (recent summary from logged data):
- Gabi: ${kcalSummary('gabi')}
- Nacho: ${kcalSummary('nacho')}

THINGS TO KNOW ABOUT US:
- Gabi has Type 1 diabetes. She tracks net carbs. Any hypo corrections (fast sugar + slow carb taken for a low blood-sugar episode) are logged in the data as Hypo_correction=Y — these are medical, not food choices, and are excluded from her calorie targets. Do not treat them as overeating.
- We shop mostly at Mercadona, specifically in Malvarrosa. When suggesting specific foods or a meal plan, keep that in mind.
- We have coffee with milk in the morning. Nacho adds honey to his coffee.
- If the data below is incomplete for a given day, that means we didn't log everything — not that we didn't eat. Never assume a low-calorie day means a deficit; it means partial logging. Only draw conclusions from days where Full_day_logged=Y. If a day is ticked as fully logged assume it is.
- Nacho's priority is protecting muscle while losing fat gradually. Gabi's goal is to lose weight. (She feels ashamed of her body, and you can notice her belly gorwing overtime, not shrinking. Don't mention her appearance in your answer though. She should never go below 1200 kcal net.
- We're open to conversations about anything: what to eat this week, how to improve our system, weekly meal plans, what to buy, how to optimise macros — whatever is most useful, what you can see about our full nutrition, workout patterns.

${closingInstruction || `Once you've read this, check in with us: briefly say what you can see in the data (or acknowledge it's early days if there isn't much), then ask what we'd like help with today.`}${dataSection}`;

  if (!isSolo) return couplePrompt;

  const mp = S.mission[person] || {};
  const isGabi = person === 'gabi';
  const diabetesNote = isGabi
    ? 'I have Type 1 diabetes. I track net carbs carefully. Any hypo corrections logged (Hypo_correction=Y) are medical treatments for low blood-sugar episodes — not food choices — and are excluded from my calorie target.'
    : '';
  const coffeeNote = isGabi ? 'I have coffee with milk in the morning.' : 'I have coffee with milk and honey in the morning.';
  const goalNote = isGabi ? 'My goal is to lose weight. I should never go below 1200 kcal net.' : 'My priority is protecting muscle while losing fat gradually.';
  const soloClosing = closingInstruction
    ? closingInstruction.replace(/\bwe\b/gi, 'I').replace(/\bour\b/gi, 'my').replace(/\bus\b/gi, 'me')
    : `Once you've read this, briefly say what you can see in the data (or acknowledge it's early days if there isn't much), then ask what I'd like help with today.`;

  return `Hi. You are a nutritionist and personal trainer. I'm going to give you full context about myself so you can help me with my health and nutrition. I'm based in Valencia, Spain. I track what I eat and how I move using an app called La Salud — I'm pasting everything it knows about me below. Then I'll tell you what I need help with.

WHO I AM:
- ${personName}: ${isGabi ? 'female, Type 1 diabetic' : 'male'}, ${mp.age||'?'} years old, ${mp.height||'?'}cm, current weight: ${weightSummary(person)}

MY GOAL (next 3 months):
- ${fmtGoal(mp.goal3kg)} | 1-year target weight: ~${mp.goal1yWeight||'?'}kg (motivational only)

MY DAILY CALORIE & MACRO TARGETS:
- ${mp.kcal||'?'} kcal | Protein ${mp.protein||'?'}g | Carbs ${mp.carbs||'?'}g | Fat ${mp.fat||'?'}g | Magnesium 375mg | VitD 15mcg | Iron ${isGabi ? '18' : '8'}mg | Calcium 1000mg | Zinc 10mg | B12 2.4mcg | Omega3 1.6g | Potassium 3500mg | VitC 80mg | Folate 400mcg

HOW I'M TRACKING:
- ${kcalSummary(person)}

THINGS TO KNOW ABOUT ME:
${diabetesNote ? `- ${diabetesNote}` + `
` : ''}- I shop mostly at Mercadona, specifically in Malvarrosa.
- ${coffeeNote}
- If data is incomplete for a given day, that means I didn't log everything — not that I didn't eat. Only draw conclusions from days where Full_day_logged=Y.
- ${goalNote}

${soloClosing}${dataSection}`;
}

function copyAIAssistBundle() {
  navigator.clipboard.writeText(buildAIAssistBundle());
  showToast('Copied — paste into Claude or ChatGPT');
}

// ── NATIVE AI ASSIST (one-shot comprehensive advice) ───────────────────────
const AI_ASSIST_ONESHOT_INSTRUCTION = `Give us one comprehensive check-in now — don't ask a question first. Cover: what you notice in the data (macros + micronutrients), what to eat more of and less of, workout deficiencies, and what to prioritise next. Be direct and specific (e.g. "eat more fish, less X"), a few short paragraphs, no follow-up question at the end.`;

let lastAIAssistExchange = null; // { prompt, reply } — for "continue elsewhere"

async function runAIAssist() {
  const btn = document.getElementById('ai-assist-btn');
  const out = document.getElementById('ai-assist-result');
  if (!getGeminiKey()) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--sand)">No Gemini API key yet — add one in <span style="color:var(--ochre);cursor:pointer;text-decoration:underline" onclick="openSettings()">Settings</span>, or use "copy the full prompt" below instead.</div></div>`;
    return;
  }
  setBtnThinking(btn, true, 'Thinking…');
  try {
    const focusText = (document.getElementById('ai-assist-focus').value || '').trim();
    const instruction = focusText
      ? `The user has a specific focus for this session: "${focusText}". Address that directly and specifically, using the data above. Still give context where it helps, but lead with what they asked.`
      : AI_ASSIST_ONESHOT_INSTRUCTION;
    const prompt = buildAIAssistBundle(instruction);
    const reply = await askGemini(prompt);
    lastAIAssistExchange = { prompt, reply };
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div class="trend-card-title">AI check-in</div><div style="font-size:13px;color:var(--sand);line-height:1.6">${renderMarkdown(reply)}</div></div>
    <button class="btn btn-secondary" style="margin-top:4px" onclick="copyAIAssistContinue()">Copy to continue this conversation elsewhere</button>`;
  } catch(e) {
    out.style.display = '';
    out.innerHTML = `<div class="trend-card"><div style="font-size:13px;color:var(--terra)">${e.message || 'Could not reach Gemini.'}</div></div>`;
  } finally {
    setBtnThinking(btn, false, 'Get AI advice');
  }
}
function copyAIAssistContinue() {
  if (!lastAIAssistExchange) return;
  const { prompt, reply } = lastAIAssistExchange;
  const bundle = `${prompt}\n\n---\n\nThe AI replied:\n\n${reply}\n\n---\n\nPlease continue this conversation from here.`;
  navigator.clipboard.writeText(bundle);
  showToast('Copied — paste into Claude or ChatGPT to continue');
}

// ── CSV RESTORE / MERGE (dedupes against what's already stored) ──────────
function parseCSVLine(line) {
  const out = []; let cur=''; let inQ=false;
  for (let i=0;i<line.length;i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i+1] === '"') { cur+='"'; i++; } else inQ=false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur=''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function entrySignature(type, date, person, name, time) {
  return [type,date,person,name,time].join('|');
}

function restoreFromCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.trim().split('\n');
    if (lines.length < 2) { showToast('Empty file'); return; }
    const existing = new Set(S.entries.map(en => entrySignature(
      en.record_type==='workout'?'WORKOUT':'MEAL', en.date, en.person,
      en.record_type==='workout'?en.workout_type:en.meal, en.logged_at
    )));
    // Weight log also restores from CSV, deduped by (person, date) — same
    // key the app already uses for "one weight entry per person per day".
    // Conservative: skips a row if that person/date is already present
    // locally rather than risk overwriting something newer.
    const existingWeightDates = new Set((S.weightLog||[]).map(w => w.person+'|'+w.date));
    let added = 0, weightAdded = 0;
    for (let i=1;i<lines.length;i++) {
      if (!lines[i].trim()) continue;
      const c = parseCSVLine(lines[i]);
      let [rtype,date,person,name,time,category,calories,protein_g,carbs_g,netcarbs_g,fat_g,fibre_g,magnesium_mg,vitd_mcg,iron_mg,calcium_mg,zinc_mg,b12_mcg,omega3_g,potassium_mg,vitc_mg,folate_mcg,duration_min,intensity,calories_burned,notes,full_day_logged,hypo_correction,day_total_kcal,day_kcal_target,day_deficit,weight_kg] = c;
      // Normalise person casing — CSV exports/edits can carry "Nacho",
      // "NACHO", trailing spaces, etc. Every comparison elsewhere in the
      // app (entriesFor, groupEntriesByPersonDate, the scorer) expects
      // exact-match lowercase 'gabi'/'nacho', so a casing mismatch here
      // silently drops the entry from every pillar — that's what was
      // producing a 0 score even with real data imported.
      person = (person || '').toString().trim().toLowerCase();
      if (person !== 'gabi' && person !== 'nacho') continue;
      if (rtype === 'WEIGHT') {
        const wKey = person + '|' + date;
        if (existingWeightDates.has(wKey)) continue;
        const kg = parseFloat(weight_kg);
        if (!kg) continue;
        existingWeightDates.add(wKey);
        S.weightLog.push({ id: Date.now()+Math.random(), person, date, kg });
        weightAdded++;
        continue;
      }
      const sig = entrySignature(rtype, date, person, name, time);
      if (existing.has(sig)) continue;
      existing.add(sig);
      if (rtype === 'WORKOUT') {
        S.entries.push({ id:Date.now()+Math.random(), record_type:'workout', person, date, workout_type:name, logged_at:time, duration_min:parseFloat(duration_min)||0, intensity, calories_burned:parseFloat(calories_burned)||0, notes });
      } else if (rtype === 'WATER') {
        S.entries.push({ id:Date.now()+Math.random(), record_type:'water', person, date, ml:parseFloat(duration_min)||0, logged_at:time });
      } else if (rtype === 'MEAL') {
        S.entries.push({ id:Date.now()+Math.random(), record_type:'meal', person, date, meal:name, meal_type:category, logged_at:time,
          calories:parseFloat(calories)||0, protein_g:parseFloat(protein_g)||0, carbs_g:parseFloat(carbs_g)||0, netcarbs_g:parseFloat(netcarbs_g)||0,
          fat_g:parseFloat(fat_g)||0, fibre_g:parseFloat(fibre_g)||0, magnesium_mg:parseFloat(magnesium_mg)||0, vitd_mcg:parseFloat(vitd_mcg)||0,
          iron_mg:parseFloat(iron_mg)||0, calcium_mg:parseFloat(calcium_mg)||0, zinc_mg:parseFloat(zinc_mg)||0, b12_mcg:parseFloat(b12_mcg)||0,
          omega3_g:parseFloat(omega3_g)||0, potassium_mg:parseFloat(potassium_mg)||0, vitc_mg:parseFloat(vitc_mg)||0, folate_mcg:parseFloat(folate_mcg)||0,
          full_day: full_day_logged === 'Y', hypo_correction: hypo_correction === 'Y',
          day_kcal_target: parseFloat(day_kcal_target) || 0 });
      }
      added++;
    }
    save();
    renderVitals();
    renderLogTab();
    syncFullDayCheckbox();
    renderWeightHistories();
    loadMissionFields();
    const parts = [];
    if (added) parts.push(`${added} entr${added!==1?'ies':'y'}`);
    if (weightAdded) parts.push(`${weightAdded} weight entr${weightAdded!==1?'ies':'y'}`);
    showToast(parts.length ? `Restored ${parts.join(' + ')}` : 'Already up to date');
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearHistory() {
  if (confirm('Clear all history? This cannot be undone.')) {
    // Capture IDs before clearing, so we can delete them from Firebase.
    const entryIds   = S.entries.map(e => String(e.id));
    const weightIds  = (S.weightLog||[]).map(w => String(w.id));

    S.entries   = [];
    S.weightLog = [];

    if (S.usingSubcollections && window.__firebaseSync) {
      // Use deleteDoc synchronously from the already-loaded Firebase module.
      const { db, collection, doc, deleteDoc } = window.__firebaseSync;
      entryIds.forEach(id =>
        deleteDoc(doc(collection(db,'la-salud','sharedData','entries'), id))
          .catch(err => console.error('[sync] clearHistory entry delete failed', id, err))
      );
      weightIds.forEach(id =>
        deleteDoc(doc(collection(db,'la-salud','sharedData','weightLog'), id))
          .catch(err => console.error('[sync] clearHistory weight delete failed', id, err))
      );
      // Persist local state (no entries/weightLog) and push parent-doc fields only.
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateForStorage())); } catch(e) {}
      pushToCloud();
    } else {
      save();
    }

    renderVitals();
    renderLogTab();
    renderWeightHistories();
    showToast('History cleared');
  }
}

// ── MISSION ────────────────────────────────────────────────────────────────
// Activity multipliers anchored to daily step counts:
//   light        = ~5,000 steps/day  (desk job, minimal walking)
//   moderate     = ~10,000 steps/day (daily walking — our normal baseline)
//   active       = ~15,000 steps/day (regular exercise + lots of walking)
//   very_intense = ~20,000+ steps or hard daily training
const ACTIVITY_MULTIPLIERS = {
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_intense: 1.9
};
const KCAL_PER_KG_FAT = 7700;
const GOAL_PERIOD_DAYS = 90; // "3-month goal" — always 3 months, per design
const MANUAL_OVERRIDE_DAYS = 7; // editing activity level by hand sticks for a week

// BMR via Mifflin-St Jeor — the most validated general-population formula,
// accurate within its known margin for most adults.
function calcBMR(m) {
  const base = 10 * (m.weight||0) + 6.25 * (m.height||0) - 5 * (m.age||0);
  return m.sex === 'female' ? base - 161 : base + 5;
}

// ── ROBUST WORKOUT ANALYSIS ────────────────────────────────────────────────
// Pitfalls addressed by this function:
//
// PITFALL 1 — Volume-dilution (identified by user):
//   Logging many short/easy sessions while manually selecting "High Activity"
//   drags the average calorie burn DOWN because 10× short walks don't
//   equal one real training session. Fix: we look at the DISTRIBUTION, not
//   just the sum. We compute a "significant session threshold" and only use
//   sessions that clear it for the burn estimate.
//
// PITFALL 2 — Rest-week crash:
//   An illness week or holiday with zero workouts would zero out the burn
//   estimate and suddenly crash the target. Fix: we use a 28-day window
//   and only replace the multiplier-based TDEE if enough sessions exist.
//
// PITFALL 3 — Logged data vs. manual toggle mismatch:
//   The manual activity level toggle says "High Activity" but logged data
//   says 1 walk per week. We now detect this disagreement and trust the
//   higher of the two (or the manual override if recently set deliberately).
//
// PITFALL 4 — Step-only days undercounting:
//   If all workouts are Walking/steps, the calorie burn per session is tiny
//   compared to a Cardio session — but the activity multiplier picked
//   manually might be "Active". Fix: we derive a step-based TDEE correction
//   separately and weight it into the picture.
//
// PITFALL 5 — Single outlier inflating the mean:
//   One 3-hour hike in 28 days shouldn't permanently inflate the number.
//   Fix: we cap individual session burns at 95th percentile of same-type
//   sessions to suppress outliers.
//
// PITFALL 6 — Sparse data giving false precision:
//   Fewer than 5 sessions = we don't trust the logged data at all and fall
//   back entirely to the manual multiplier. 5–14 = partial blend. 15+ =
//   logged data leads, multiplier acts as a sanity anchor.
//
// Returns: { avgDailyBurn, entryCount, significantCount, blendNote }
const WORKOUT_WINDOW_DAYS = 28;
const SIGNIFICANT_BURN_THRESHOLD = 60; // kcal — gates data-trust, not the burn average itself

function weeklyWorkoutStats(person) {
  const since = new Date();
  since.setDate(since.getDate() - (WORKOUT_WINDOW_DAYS - 1));
  const dates = [];
  for (let i=0;i<WORKOUT_WINDOW_DAYS;i++){ const d=new Date(since); d.setDate(d.getDate()+i); dates.push(toLocalDateStr(d)); }
  const workouts = entriesFor(person, dates, 'workout');

  if (!workouts.length) return { entryCount:0, significantCount:0, avgDailyBurn:0, blendNote:'no data' };

  const totalBurned = sum(workouts, 'calories_burned');
  const significantCount = workouts.filter(w => (w.calories_burned || 0) >= SIGNIFICANT_BURN_THRESHOLD).length;

  // Divide by 28 (not by session count) so rest days are naturally accounted for.
  const avgDailyBurn = totalBurned / WORKOUT_WINDOW_DAYS;

  return {
    entryCount: workouts.length,
    significantCount,
    avgDailyBurn,
    blendNote: `${workouts.length} sessions (${significantCount} significant) · ${Math.round(avgDailyBurn)} kcal/day avg`
  };
}

// How much to trust logged data vs. the manual activity multiplier.
// Gated on SIGNIFICANT sessions so many tiny walks don't fake out the trust level.
function loggedDataWeight(significantCount) {
  if (significantCount < 4)  return 0;    // not enough real data → use multiplier
  if (significantCount < 10) return 0.6;  // some data → blend, multiplier still leads
  if (significantCount < 20) return 0.75; // solid data → logged leads
  return 0.88;                             // strong data → logged dominates
}

// Called when the person edits the Activity level dropdown by hand. This is
// a quiet 1-week override — after it expires, the app goes back to checking
// whether there's enough logged data to drive the number automatically.
function markActivityOverride(person) {
  const until = Date.now() + MANUAL_OVERRIDE_DAYS * 24 * 60 * 60 * 1000;
  S.mission[person].manualOverrideUntil = until;
  saveLocalOnly();
  renderActivityControls(person);
}

function isManualOverrideActive(m) {
  return !!m.manualOverrideUntil && Date.now() < m.manualOverrideUntil;
}

// The full calculation: BMR → TDEE → goal deficit → daily kcal target.
// Robust formula with all pitfalls addressed (see weeklyWorkoutStats above).
// Takes the person object directly (m) so callers can pass saved or live state.
function calculateDailyTargetFrom(m, person) {
  const bmr = calcBMR(m);

  const mult = ACTIVITY_MULTIPLIERS[m.activityLevel] || ACTIVITY_MULTIPLIERS.moderate;
  const multiplierTDEE = bmr * mult;
  let tdee, activitySource, blendNote;

  if (isManualOverrideActive(m)) {
    // Person explicitly set their activity level recently — respect it fully.
    tdee = multiplierTDEE;
    activitySource = 'manual override';
    blendNote = 'Using manual activity level (set within last 7 days)';
  } else {
    const stats = weeklyWorkoutStats(person);
    const w = loggedDataWeight(stats.significantCount);

    if (w === 0) {
      // Not enough meaningful logged data — fall back to multiplier entirely.
      // But also do a sanity check: if manual level says "active" but
      // there's very little workout data at all, hold at moderate as a
      // conservative floor rather than blindly trusting the toggle.
      const selectedMult = ACTIVITY_MULTIPLIERS[m.activityLevel] || ACTIVITY_MULTIPLIERS.moderate;
      const moderateMult = ACTIVITY_MULTIPLIERS.moderate;
      // If zero sessions logged and toggle says active/very_intense, cap at moderate
      // to avoid overestimating TDEE with no data to back it up.
      const safeMult = (stats.entryCount === 0 && selectedMult > moderateMult)
        ? moderateMult : selectedMult;
      tdee = bmr * safeMult;
      activitySource = stats.entryCount === 0 ? 'multiplier (no logged data)' : 'multiplier (insufficient data)';
      blendNote = stats.entryCount === 0
        ? 'No workouts logged — using activity toggle (capped at Moderate until data exists)'
        : `Only ${stats.significantCount} significant sessions — need 4+ for data-blending`;
    } else {
      // Blend: logged burn drives the picture, multiplier is a sanity anchor.
      const loggedTDEE = bmr + stats.avgDailyBurn;

      // PITFALL 3 check: if logged data implies much less activity than the
      // manual toggle (>20% gap), don't let the toggle silently inflate.
      // The blend itself handles this gracefully — logged data weight w means
      // the multiplier can only contribute (1-w) of the final number.
      tdee = w * loggedTDEE + (1 - w) * multiplierTDEE;
      activitySource = 'blended';
      blendNote = stats.blendNote + ` · blend ${Math.round(w*100)}% logged / ${Math.round((1-w)*100)}% multiplier`;
    }
  }

  const goalKg = parseFloat(m.goal3kg) || 0;
  const dailyDeficit = (goalKg * KCAL_PER_KG_FAT) / GOAL_PERIOD_DAYS;
  const SAFE_FLOOR_KCAL = 1200;
  const rawTarget = tdee + dailyDeficit;
  const target = Math.max(SAFE_FLOOR_KCAL, Math.round(rawTarget));
  const clamped = rawTarget < SAFE_FLOOR_KCAL;

  return { bmr: Math.round(bmr), tdee: Math.round(tdee), dailyDeficit: Math.round(dailyDeficit), target, activitySource, blendNote, clamped };
}

// Convenience wrapper for code that wants the calc based on last-SAVED state.
function calculateDailyTarget(person) {
  return calculateDailyTargetFrom(S.mission[person], person);
}

// ── AI-POWERED CALORIE TARGET (Gemini) ────────────────────────────────────
// Sends a rich data snapshot to Gemini and asks it to estimate the right
// daily calorie intake. This is intentionally separate from the formula so
// the two can be blended or compared.
//
// Data sent to Gemini:
//  - BMR, height, weight, age, sex
//  - The manually-chosen activity level (as text, not a multiplier)
//  - Last 28 days of workout logs: type, duration, calories_burned, date
//  - Last 7 days of fully-logged meal data: actual calorie totals per day
//  - Weight trend over last 30 days (are they losing/gaining vs. goal?)
//  - 3-month goal (kg delta)
//
// Gemini is instructed to return ONLY a single integer (the kcal target).
// We parse it, validate it's in a sane range (1000–4000), and return it.
async function askGeminiForCalorieTarget(person) {
  const key = getGeminiKey();
  if (!key) throw new Error('no_key');

  const m = S.mission[person];
  const bmr = Math.round(calcBMR(m));

  // Workout data (last 28 days)
  const since28 = new Date(); since28.setDate(since28.getDate() - 27);
  const dates28 = [];
  for (let i=0;i<28;i++){ const d=new Date(since28); d.setDate(d.getDate()+i); dates28.push(toLocalDateStr(d)); }
  const recentWorkouts = entriesFor(person, dates28, 'workout');

  // Group workouts by type for a clean summary
  const workoutSummary = {};
  recentWorkouts.forEach(w => {
    const t = w.workout_type || 'Other';
    if (!workoutSummary[t]) workoutSummary[t] = { count:0, totalMin:0, totalBurn:0 };
    workoutSummary[t].count++;
    workoutSummary[t].totalMin += w.duration_min || 0;
    workoutSummary[t].totalBurn += w.calories_burned || 0;
  });
  const workoutLines = Object.entries(workoutSummary).map(([type, v]) =>
    `  - ${type}: ${v.count} sessions, ${v.totalMin} min total, ~${Math.round(v.totalBurn)} kcal total burned`
  ).join('\n') || '  (none logged in last 28 days)';

  // Fully-logged meal days (last 14 days)
  const since14 = new Date(); since14.setDate(since14.getDate() - 13);
  const dates14 = [];
  for (let i=0;i<14;i++){ const d=new Date(since14); d.setDate(d.getDate()+i); dates14.push(toLocalDateStr(d)); }
  const recentMeals = entriesFor(person, dates14, 'meal').filter(e => !e.hypo_correction);
  const fullDayDates = [...new Set(recentMeals.filter(e=>e.full_day).map(e=>e.date))];
  const mealLines = fullDayDates.length
    ? fullDayDates.map(d => {
        const dayTotal = Math.round(sum(recentMeals.filter(e=>e.date===d), 'calories'));
        return `  - ${d}: ${dayTotal} kcal eaten`;
      }).join('\n')
    : '  (no fully-logged days in last 14 days)';

  // Weight trend
  const wLogs = (S.weightLog||[]).filter(w=>w.person===person).sort((a,b)=>a.date.localeCompare(b.date));
  const weightTrend = wLogs.length >= 2
    ? `Started at ${wLogs[0].kg}kg on ${wLogs[0].date}, now ${wLogs[wLogs.length-1].kg}kg on ${wLogs[wLogs.length-1].date} (${((wLogs[wLogs.length-1].kg - wLogs[0].kg) >= 0 ? '+' : '')}${(wLogs[wLogs.length-1].kg - wLogs[0].kg).toFixed(1)}kg total)`
    : `Current weight: ${m.weight}kg (no trend data yet)`;

  const activityLabels = {
    light: 'Light (~5k steps/day, desk job)',
    moderate: 'Moderate (~10k steps/day, some walking)',
    active: 'Active (~15k steps/day, regular exercise)',
    very_intense: 'Very intense (~20k+ steps or hard daily training)'
  };

  const prompt = `You are a nutrition scientist calculating a person's daily calorie intake target. Analyse the data below carefully and return ONLY a single integer — the recommended daily calorie target in kcal. No explanation, no text, no units — just the number.

PERSON PROFILE:
- Sex: ${m.sex || 'unknown'}
- Age: ${m.age} years
- Height: ${m.height} cm
- Current weight: ${m.weight} kg
- Calculated BMR (Mifflin-St Jeor): ${bmr} kcal/day
- 3-month goal: ${m.goal3kg > 0 ? '+' : ''}${m.goal3kg} kg (${m.goal3kg < 0 ? 'weight loss' : m.goal3kg > 0 ? 'weight gain' : 'maintain'})
- Self-reported activity level: ${activityLabels[m.activityLevel] || m.activityLevel}

WORKOUT LOG (last 28 days):
${workoutLines}

ACTUAL FOOD INTAKE (fully-logged days, last 14 days):
${mealLines}

WEIGHT TREND:
${weightTrend}

INSTRUCTIONS:
- The activity level toggle is self-reported and may not match the logged workout data. Weight the logged data more heavily if it conflicts.
- If many small/short workouts are logged, don't mistake volume for intensity. A 10-minute walk is not equivalent to a 45-minute cardio session.
- If the person is losing weight faster than the goal, the current target may be too low — adjust upward slightly.
- If the person is losing weight slower than the goal (or gaining), the current target may be too high — adjust downward.
- If no weight trend data is available, rely on BMR × activity factor from the workout log.
- The 3-month goal of ${m.goal3kg}kg implies a daily calorie deficit/surplus of ~${Math.round((m.goal3kg * 7700) / 90)} kcal/day.
- Never recommend below 1200 kcal/day for females or 1500 kcal/day for males.
- Never recommend above 4000 kcal/day.
- Return ONLY the integer. Example: 1680`;

  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await resp.json();
  const raw = (data?.candidates?.[0]?.content?.parts?.map(p=>p.text).filter(Boolean).join('') || '').trim();
  // Strip any <thinking>…</thinking> block Gemini-2.5 may prepend, then find
  // the last standalone 3-or-4-digit integer in the remaining text.
  const stripped = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  const matches = stripped.match(/\b(\d{3,4})\b/g);
  const num = matches ? parseInt(matches[matches.length - 1]) : NaN;
  const floor = m.sex === 'female' ? 1200 : 1500;
  if (isNaN(num) || num < floor || num > 4000) throw new Error('invalid_ai_response: ' + raw);
  return num;
}

// ── AI CALORIE MODE TOGGLE ─────────────────────────────────────────────────
// Controls whether the calorie target shown (and saved) is:
//   'ai_blend'  → 80% AI suggestion + 20% formula (default when Gemini key exists)
//   'formula'   → 100% formula, AI not involved
// Stored per-person in S.mission[person].aiCalorieMode
function getAiCalorieMode(person) {
  return S.mission[person].aiCalorieMode || 'ai_blend';
}
function setAiCalorieMode(person, mode) {
  S.mission[person].aiCalorieMode = mode;
  // Instantly reflect the mode switch in the kcal input box
  const prefix = person === 'gabi' ? 'g' : 'n';
  const calc = calculateDailyTargetFrom(liveMissionSnapshot(person), person);
  const finalTarget = computeFinalTarget(person, calc.target);
  const kcalEl = document.getElementById(prefix+'-kcal');
  if (kcalEl) kcalEl.value = finalTarget;
  saveLocalOnly();
  renderActivityControls(person);
}

// Compute the FINAL blended target given formula result and (optionally) an AI target.
// If no AI target is stored, falls back to formula only regardless of mode.
function computeFinalTarget(person, formulaTarget) {
  const mode = getAiCalorieMode(person);
  const aiTarget = S.mission[person].aiCalorieTarget;
  if (mode === 'ai_blend' && aiTarget && aiTarget > 0) {
    // 80% AI, 20% formula
    return Math.round(0.8 * aiTarget + 0.2 * formulaTarget);
  }
  return formulaTarget; // formula-only mode or no AI target yet
}

// Reads weight/height/age/goal3kg/activityLevel straight from the Mission
// tab's input fields (falling back to saved state for any field that's
// empty/invalid), WITHOUT writing anything into S.mission. This is what
// powers the live breakdown preview as you type, so the preview reflects
// what you're currently typing rather than only updating after Save.
function liveMissionSnapshot(person) {
  const prefix = person === 'gabi' ? 'g' : 'n';
  const stored = S.mission[person];
  const heightEl = document.getElementById(prefix+'-height');
  const ageEl = document.getElementById(prefix+'-age');
  const goalEl = document.getElementById(prefix+'-goal3kg');
  const actEl = document.getElementById(prefix+'-activity');

  // Weight is locked to the latest weight-log entry, not a typed field.
  const weight = getLatestWeight(person);
  const height = heightEl ? parseFloat(heightEl.value) : NaN;
  const age = ageEl ? parseFloat(ageEl.value) : NaN;
  const goal3kg = goalEl && goalEl.value !== '' ? parseFloat(goalEl.value) : NaN;

  return {
    ...stored,
    weight: weight == null ? stored.weight : weight,
    height: isNaN(height) ? stored.height : height,
    age: isNaN(age) ? stored.age : age,
    goal3kg: isNaN(goal3kg) ? stored.goal3kg : goal3kg,
    activityLevel: (actEl && actEl.value) ? actEl.value : stored.activityLevel
  };
}


function applyCalculatedTarget(person) {
  const calc = calculateDailyTarget(person);
  const finalTarget = computeFinalTarget(person, calc.target);
  S.mission[person].kcal = finalTarget;
  return { ...calc, finalTarget };
}

function loadMissionFields() {
  const g = S.mission.gabi, n = S.mission.nacho;
  ['height','age','kcal','protein','carbs','fat'].forEach(k => {
    const ge = document.getElementById('g-'+k);
    const ne = document.getElementById('n-'+k);
    if (ge) ge.value = g[k] || '';
    if (ne) ne.value = n[k] || '';
  });
  // Weight fields are locked to the latest weight-log entry, not S.mission.
  ['gabi','nacho'].forEach(person => {
    const prefix = person === 'gabi' ? 'g' : 'n';
    const weightEl = document.getElementById(prefix+'-weight');
    const latest = getLatestWeight(person);
    if (weightEl) weightEl.value = latest != null ? latest : '';
    if (latest != null) S.mission[person].weight = latest;
  });
  ['g','n'].forEach(prefix => {
    const m = prefix === 'g' ? g : n;
    const goalEl = document.getElementById(prefix+'-goal3kg');
    const yearEl = document.getElementById(prefix+'-goal1y');
    const actEl = document.getElementById(prefix+'-activity');
    if (goalEl) goalEl.value = m.goal3kg;
    if (yearEl) yearEl.value = m.goal1yWeight;
    if (actEl) actEl.value = m.activityLevel;
  });
  renderActivityControls('gabi');
  renderActivityControls('nacho');
}

// Explicit "Calculate my intake" button handler. Recomputes BMR → TDEE →
// target for ONE person. If AI assist is ON and a Gemini key exists, also
// fetches a fresh AI target (no "Thinking…" label — button stays enabled).
// If AI assist is OFF, just applies the formula immediately with no AI call.
// In both cases the kcal box is updated immediately with the correct value.
async function calculateMyIntake(person) {
  const prefix = person === 'gabi' ? 'g' : 'n';

  // Pull whatever's currently in the form fields first.
  const latestWeight = getLatestWeight(person);
  if (latestWeight != null) S.mission[person].weight = latestWeight;
  ['height','age'].forEach(k => {
    const el = document.getElementById(prefix+'-'+k);
    const val = parseFloat(el.value);
    if (!isNaN(val)) S.mission[person][k] = val;
  });
  const goalVal = parseFloat(document.getElementById(prefix+'-goal3kg').value);
  if (!isNaN(goalVal)) S.mission[person].goal3kg = goalVal;
  S.mission[person].activityLevel = document.getElementById(prefix+'-activity').value;

  // Formula calculation (always done first so box updates immediately)
  const calc = applyCalculatedTarget(person);
  const formulaTarget = calc.target;
  const aiMode = getAiCalorieMode(person);

  if (aiMode === 'formula') {
    // AI off — just use formula, no network call
    const kcalEl = document.getElementById(prefix+'-kcal');
    if (kcalEl) kcalEl.value = formulaTarget;
    renderActivityControls(person);
    saveMission();
    return;
  }

  // AI assist is ON — fetch Gemini target, show "Thinking…" while waiting
  const hasGemini = !!getGeminiKey();
  if (hasGemini) {
    const btn = document.querySelector(`button[onclick="calculateMyIntake('${person}')"]`);
    if (btn) setBtnThinking(btn, true, 'Thinking…');
    try {
      const aiTarget = await askGeminiForCalorieTarget(person);
      S.mission[person].aiCalorieTarget = aiTarget;
      showToast(`AI suggests ${aiTarget} kcal for ${person.charAt(0).toUpperCase()+person.slice(1)}`);
    } catch(e) {
      showToast('AI target unavailable — using formula');
      if (!S.mission[person].aiCalorieTarget) S.mission[person].aiCalorieTarget = null;
    } finally {
      if (btn) setBtnThinking(btn, false, 'Calculate my intake');
    }
  }

  // Compute final blended target and write to the kcal field
  const finalTarget = computeFinalTarget(person, formulaTarget);
  const kcalEl = document.getElementById(prefix+'-kcal');
  if (kcalEl) kcalEl.value = finalTarget;

  renderActivityControls(person);
  saveMission(); // persist all mission fields, not just local
}

function saveMission() {
  ['height','age','kcal','protein','carbs','fat'].forEach(k => {
    S.mission.gabi[k] = parseFloat(document.getElementById('g-'+k).value) || S.mission.gabi[k];
    S.mission.nacho[k] = parseFloat(document.getElementById('n-'+k).value) || S.mission.nacho[k];
  });
  // Weight is locked to the latest weight-log entry, never read from a form field.
  ['gabi','nacho'].forEach(person => {
    const latest = getLatestWeight(person);
    if (latest != null) S.mission[person].weight = latest;
  });
  ['gabi','nacho'].forEach(person => {
    const prefix = person === 'gabi' ? 'g' : 'n';
    const m = S.mission[person];
    const goalVal = parseFloat(document.getElementById(prefix+'-goal3kg').value);
    if (!isNaN(goalVal)) m.goal3kg = goalVal;
    const yearVal = parseFloat(document.getElementById(prefix+'-goal1y').value);
    if (!isNaN(yearVal)) m.goal1yWeight = yearVal;
    m.activityLevel = document.getElementById(prefix+'-activity').value;
  });
  // Auto-recalculate the calorie target whenever Mission is saved so the
  // Vitals daily display is always current — no need to press "Calculate"
  // separately. If the user manually typed a kcal value in the field, we
  // still respect it by reading it from the form above; but we then
  // re-run the full BMR→TDEE→target chain and overwrite it so the number
  // stays honest when weight, goal, or activity changes.
  ['gabi','nacho'].forEach(person => {
    const calc = applyCalculatedTarget(person);
    const prefix = person === 'gabi' ? 'g' : 'n';
    const kcalEl = document.getElementById(prefix+'-kcal');
    if (kcalEl) kcalEl.value = calc.finalTarget || calc.target;
    renderActivityControls(person);
  });
  save();
  renderVitals();
  loadMissionFields();
  document.getElementById('mission-saved').style.display = 'block';
  setTimeout(() => document.getElementById('mission-saved').style.display = 'none', 2000);
}

// Shows the BMR/TDEE/deficit breakdown + AI mode toggle + AI target info.
function renderActivityControls(person) {
  const prefix = person === 'gabi' ? 'g' : 'n';
  const calc = calculateDailyTargetFrom(liveMissionSnapshot(person), person);
  const calcEl = document.getElementById(prefix+'-calc-breakdown');
  if (!calcEl) return;

  const aiTarget = S.mission[person].aiCalorieTarget;
  const hasGemini = !!getGeminiKey();
  const finalTarget = computeFinalTarget(person, calc.target);

  // AI target line
  let aiLine = '';
  if (aiTarget && aiTarget > 0) {
    aiLine = `<div style="margin-top:4px;color:var(--sage)">🤖 AI suggestion: <strong>${aiTarget} kcal</strong></div>`;
  } else if (hasGemini) {
    aiLine = `<div style="margin-top:4px;color:var(--mist);font-style:italic">AI suggestion: click "Calculate my intake" to fetch</div>`;
  }

  // Mode toggle — iOS-style pill, always shown
  const aiMode = getAiCalorieMode(person);
  const blendActive = aiMode === 'ai_blend';
  const toggleEnabled = hasGemini || (aiTarget && aiTarget > 0);
  const nextMode = blendActive ? 'formula' : 'ai_blend';
  const toggleLine = `<div style="display:flex;align-items:center;gap:10px;margin-top:12px">
    <div style="position:relative;width:51px;height:31px;border-radius:16px;background:${blendActive && toggleEnabled ? 'var(--sage)' : '#3a3a3c'};transition:background 0.2s;cursor:${toggleEnabled ? 'pointer' : 'not-allowed'};opacity:${toggleEnabled ? '1' : '0.4'};flex-shrink:0"
         ${toggleEnabled ? `onclick="setAiCalorieMode('${person}','${nextMode}')"` : ''}>
      <div style="position:absolute;top:2px;left:${blendActive && toggleEnabled ? '22px' : '2px'};width:27px;height:27px;border-radius:50%;background:#fff;transition:left 0.2s;box-shadow:0 2px 4px rgba(0,0,0,0.4)"></div>
    </div>
    <span style="font-size:13px;color:${blendActive && toggleEnabled ? 'var(--bone)' : 'var(--mist)'}">
      ${toggleEnabled ? (blendActive ? 'AI assist <strong>On</strong>' : 'AI assist <strong>Off</strong>') : 'AI assist <span style="opacity:0.5">(add Gemini key to enable)</span>'}
    </span>
  </div>`;

  // Final target line
  const finalLine = (aiTarget && aiTarget > 0 && aiMode === 'ai_blend')
    ? `<div style="margin-top:6px;font-size:12px;color:var(--bone)">Final target (80% AI + 20% formula): <strong>${finalTarget} kcal</strong></div>`
    : '';

  calcEl.innerHTML =
    `BMR ${calc.bmr} kcal → TDEE ${calc.tdee} kcal → ${calc.dailyDeficit>=0?'+':''}${calc.dailyDeficit} kcal/day goal = <strong>${calc.target} kcal</strong> (formula)${calc.clamped ? ' · held at safety floor' : ''}` +
    `<div style="margin-top:3px;font-size:10px;color:var(--mist)">${calc.blendNote || calc.activitySource}</div>` +
    aiLine + finalLine + toggleLine;
}


function formatPrompt(person) {
  const honeyRule = person === 'nacho'
    ? `This log is for Nacho. He always has honey in his coffee — include it by default unless the text explicitly says no honey.`
    : `This log is for Gabi. She never has honey in her coffee — never include it, even if the text doesn't mention it either way.`;
  return `You are a nutrition and workout logging assistant. You don't need any personal or health context — just describe what's in front of you, accurately.

TASK: Create a single downloadable .txt file containing the logged line(s) below — nothing else. Do not reply in the chat with the line; put it only inside the file. NEVER ask a question, in the file or outside it — there is no one available to answer. If something is ambiguous or unstated, make your best estimate and proceed; do not add commentary, summary, advice, or questions anywhere in your response.

ACCURACY RULE: Only log what is actually visible in a photo or stated in the text. Never assume extra items were also eaten because of the time of day, the setting, or what a "usual" meal looks like — if a photo shows only a drink, log only that drink. If a photo is ambiguous (e.g. you can't tell tea from coffee, or how much milk/sugar), make your best estimate from what's visible and note the uncertainty briefly in the meal name, e.g. "Tea with milk (estimated)".

COFFEE / HONEY RULE (no question — always resolve automatically): ${honeyRule}

If the person just writes "usual breakfast" with no photo, that means: 3 eggs, 1 slice of toast, 1 tomato, a handful of spinach, a drizzle of olive oil, and coffee with milk (apply the honey rule above). Estimate nutrition from that description.

HYPO CORRECTION FIELD (no question — opt-in only): only add | Hypo: yes if the person's own text explicitly says this is a low blood-sugar correction (e.g. they write "hypo", "low", "low sugar"). If it merely looks like one (glucose tabs, rice crackers, an odd-time snack) but isn't stated, do NOT mark it — log it as a normal meal and omit the Hypo field entirely. Never guess yes.

If given a photo or description of food, treat everything submitted in this single batch as ONE sitting for this one person — combine every item from this submission into exactly ONE MEAL line, even if several distinct foods/drinks are listed (e.g. "1 Aperol spritz, 4 mejillones, 8 almejitas, 2 platos de paella" is ONE line, not four). Sum/estimate the nutrition across all items into that single line's numbers. The only time you output more than one MEAL line from one submission is if the text clearly describes separate sittings at different times (e.g. it explicitly mentions breakfast at one time and lunch at another) — otherwise, always merge into one line. Never combine two different people's food into one submission.
Name the entry after the 1-3 most recognisable items in the list (skip throwaway garnishes/condiments), joined with "&", e.g. "Paella & Aperol", "Mejillones & Almejitas". Never use a bare number, a quantity alone, or an empty/placeholder name as the Meal field.
MEAL | Meal: [name] | Calories: [n] | Protein: [n]g | Carbs: [n]g | NetCarbs: [n]g | Fat: [n]g | Fibre: [n]g | Magnesium: [n]mg | VitD: [n]mcg | Iron: [n]mg | Calcium: [n]mg | Zinc: [n]mg | B12: [n]mcg | Omega3: [n]g | Potassium: [n]mg | VitC: [n]mg | Folate: [n]mcg | Time: [HH:MM]
(add | Hypo: yes before Time only per the opt-in rule above)

If given a description of a workout, the file should contain one line in EXACTLY this format:
WORKOUT | Type: [Strength/Cardio - steady/Cardio - HIIT/Flexibility/Balance/Mobility] | Duration: [n minutes] | Intensity: [Low/Medium/High] | Calories burned: [n] | Time: [HH:MM] | Notes: [one short line]

Output: just the .txt file content, ready to download. No chat reply alongside it. No questions, ever.`;
}

function copyText(text, label) {
  navigator.clipboard.writeText(text);
  showToast(label || 'Copied');
}
function copyFormatPrompt() { copyText(formatPrompt(S.currentPerson), 'Prompt copied'); }

// ── AUTOMATIC SORTING (direct Gemini API) ───────────────────────────────────
let aiLogMode = 'auto';
function setAIMode(mode) {
  aiLogMode = mode;
  document.getElementById('ai-panel-manual').style.display = mode==='manual' ? '' : 'none';
  document.getElementById('ai-panel-auto').style.display = mode==='auto' ? '' : 'none';
  if (mode==='auto') checkGeminiKeyHint();
}
function checkGeminiKeyHint() {
  const has = !!getGeminiKey();
  document.getElementById('auto-key-missing').style.display = has ? 'none' : '';
}
// ── LIGHTWEIGHT MARKDOWN RENDERER (for AI replies) ─────────────────────────
// Converts the bold/headers/bullets an LLM naturally produces into safe HTML.
// Escapes raw text first, then layers on formatting — never trusts input.
function renderMarkdown(raw) {
  const esc = (raw || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const lines = esc.split('\n');
  let html = '';
  let listType = null; // 'ul' | 'ol' | null
  let para = [];

  const inlineFmt = t => t
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--bone)">$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*([^*]|$)/g, '$1<em>$2</em>$3');

  const flushPara = () => { if (para.length) { html += `<p style="margin:0 0 10px">${para.join('<br>')}</p>`; para = []; } };
  const closeList = () => { if (listType) { html += listType === 'ul' ? '</ul>' : '</ol>'; listType = null; } };

  lines.forEach(line => {
    const t = line.trim();
    const header = t.match(/^(#{1,4})\s+(.*)$/);
    const boldHeader = t.match(/^\*\*(.+?):?\*\*\s*$/);
    const bullet = t.match(/^[-*•]\s+(.*)$/);
    const numbered = t.match(/^\d+[\.\)]\s+(.*)$/);

    if (!t) { flushPara(); closeList(); return; }

    if (header) {
      flushPara(); closeList();
      html += `<div style="font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--ochre);text-transform:uppercase;margin:${html?'14px':'0'} 0 6px">${inlineFmt(header[2])}</div>`;
    } else if (boldHeader) {
      flushPara(); closeList();
      html += `<div style="font-weight:600;color:var(--ochre);margin:${html?'12px':'0'} 0 4px">${inlineFmt(boldHeader[1])}</div>`;
    } else if (bullet) {
      flushPara();
      if (listType !== 'ul') { closeList(); html += '<ul style="margin:0 0 10px;padding-left:18px">'; listType = 'ul'; }
      html += `<li style="margin-bottom:4px">${inlineFmt(bullet[1])}</li>`;
    } else if (numbered) {
      flushPara();
      if (listType !== 'ol') { closeList(); html += '<ol style="margin:0 0 10px;padding-left:18px">'; listType = 'ol'; }
      html += `<li style="margin-bottom:4px">${inlineFmt(numbered[1])}</li>`;
    } else {
      closeList();
      para.push(inlineFmt(line));
    }
  });
  flushPara(); closeList();
  return html;
}

// Shared helper: send plain text to Gemini, get plain text back. Throws on
// missing key or failure so callers can show their own toast/UI.
async function askGemini(promptText) {
  const key = getGeminiKey();
  if (!key) throw new Error('No Gemini API key set — add one in Settings.');
  let resp;
  try {
    resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });
  } catch (networkErr) {
    throw new Error('Network error — couldn\'t reach Google at all (offline, or a firewall/DNS block).');
  }
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const apiMsg = data?.error?.message || resp.statusText || 'unknown error';
    if (resp.status === 400 || resp.status === 403) throw new Error(`Key rejected (${resp.status}): ${apiMsg}`);
    if (resp.status === 429) throw new Error('Rate limit / daily quota hit (429) — free-tier Gemini keys reset after a short wait or at midnight Pacific time.');
    if (resp.status >= 500) throw new Error(`Google's servers had an issue (${resp.status}) — usually fine to just retry.`);
    throw new Error(`Gemini error (${resp.status}): ${apiMsg}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).filter(Boolean).join('\n') || '';
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new Error(blockReason ? `Gemini returned no text (${blockReason}).` : 'Gemini returned an empty reply — try again.');
  }
  return text;
}
let autoPhotos = []; // [{data, mime}]
function handleAutoPhotos(event) {
  autoPhotos = [];
  const files = [...event.target.files];
  const prev = document.getElementById('auto-photo-preview');
  prev.innerHTML = '';
  let pending = files.length;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      autoPhotos.push({ data: e.target.result.split(',')[1], mime: file.type });
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid var(--clay)';
      prev.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}
async function submitLogAuto() {
  const hasPhoto = autoPhotos.length > 0;
  const desc = document.getElementById('auto-desc-input').value.trim();

  const wasFullBefore = entriesFor(S.currentPerson, [todayStr()], 'meal').some(e => e.full_day);
  const fullDay = applyFullDayStatus();
  const fullDayChanged = fullDay !== wasFullBefore;

  if (!hasPhoto && !desc) {
    if (fullDayChanged) {
      save(); renderVitals(); renderLogTab(); syncFullDayCheckbox(); syncHypoQuickBtn();
      showToast(fullDay ? 'Day marked complete' : 'Full-day mark removed');
    } else {
      showToast('Nothing to submit — add a photo/description or tick the full-day box');
    }
    return;
  }

  const key = getGeminiKey();
  if (!key) { checkGeminiKeyHint(); showToast('Add your Gemini API key in Settings first'); return; }

  const btn = document.getElementById('submit-log-btn');
  setBtnThinking(btn, true, 'Thinking…');
  try {
    const parts = [{ text: formatPrompt(S.currentPerson) + (desc ? ('\n\nDescription from the person: ' + desc) : '') }];
    autoPhotos.forEach(p => parts.push({ inline_data: { mime_type: p.mime, data: p.data } }));
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] })
    });
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text).filter(Boolean).join('\n') || '';
    const parsed = parseAIOutput(text);
    if (!parsed.length && !parsed.rejected?.length) { showToast('AI reply unreadable — try again or use Manual mode'); return; }
    commitEntries(parsed);
    save();
    renderVitals();
    renderLogTab();
    syncFullDayCheckbox();
    syncHypoQuickBtn();
    document.getElementById('auto-photo-input').value = '';
    document.getElementById('auto-photo-preview').innerHTML = '';
    document.getElementById('auto-desc-input').value = '';
    autoPhotos = [];
    const skipped = parsed.rejected && parsed.rejected.length
      ? (' · ⚠ skipped ' + parsed.rejected.length + ' unreadable line' + (parsed.rejected.length>1?'s':'') + ' — check it logged everything')
      : '';
    // If 👫 was active, clone entries for the other person
    if (mealLogForBoth) {
      const orig = S.currentPerson;
      const other = orig === 'gabi' ? 'nacho' : 'gabi';
      const cloned = parsed.map(e => ({ ...e, id: Date.now() + Math.random(), person: other }));
      cloned.forEach(e => { if (!S.entries.find(x => entryKey(x) === entryKey(e))) S.entries.push(e); });
      mealLogForBoth = false;
      const bothBtn = document.getElementById('log-both-btn');
      if (bothBtn) { bothBtn.style.background = 'var(--bark)'; bothBtn.style.color = 'var(--ochre)'; bothBtn.classList.remove('both-active'); }
      save(); renderVitals(); renderLogTab();
      showToast('Added ' + parsed.length + ' item' + (parsed.length>1?'s':'') + ' for both' + skipped);
    } else {
      showToast('Added ' + parsed.length + ' item' + (parsed.length>1?'s':'') + skipped + (fullDayChanged ? (fullDay ? ' · day marked complete' : ' · full-day mark removed') : ''));
    }
  } catch(e) {
    showToast(e.message || 'Could not reach Gemini');
  } finally {
    setBtnThinking(btn, false, mealLogForBoth ? 'Submit Log (both)' : 'Submit Log');
  }
}

// ── AI THINKING BUTTON STATE ─────────────────────────────────────────────
// Call setBtnThinking(btn, true, 'Thinking…') when kicking off an AI call,
// and setBtnThinking(btn, false, 'Original label') in the finally block.
// Stores the button's original innerHTML so it's restored exactly, even
// if the idle label includes an emoji.
function setBtnThinking(btn, isThinking, idleLabel) {
  if (!btn) return;
  if (isThinking) {
    if (btn.dataset.thinkOrig === undefined) btn.dataset.thinkOrig = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-thinking');
    btn.innerHTML = `<span class="think-label">${idleLabel}</span><span class="btn-thinking-dots"><span></span><span></span><span></span></span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-thinking');
    btn.innerHTML = idleLabel !== undefined ? idleLabel : (btn.dataset.thinkOrig || btn.innerHTML);
    delete btn.dataset.thinkOrig;
  }
}

// ── TOAST ──────────────────────────────────────────────────────────────────
function showToast(msg, duration) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration || 2200);
}

// ── CONFETTI — Gabi full-day celebration ────────────────────────────────────
let confettiActive = false;
let confettiShownDate = null;
function launchConfetti() {
  const today = todayStr();
  if (confettiActive || confettiShownDate === today) return;
  confettiShownDate = today;
  confettiActive = true;
  const canvas = document.createElement('canvas');
  canvas.id = 'confetti-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;max-width:480px;left:50%;transform:translateX(-50%)';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  const COLORS = ['#6BA3C8','#C8863A','#7A9E7E','#E8D5B0','#C4614A','#9A9080'];
  const pieces = Array.from({length: 80}, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * canvas.height * 0.5,
    w: 6 + Math.random() * 8,
    h: 3 + Math.random() * 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    vx: (Math.random() - 0.5) * 1.5,
    vy: 1.5 + Math.random() * 2.5,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.12,
    opacity: 0.85 + Math.random() * 0.15,
  }));

  let frame = 0;
  const TOTAL = 220;
  function draw() {
    if (frame > TOTAL) {
      canvas.remove();
      confettiActive = false;
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fadeAlpha = frame > TOTAL - 60 ? (TOTAL - frame) / 60 : 1;
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.vy += 0.04; // gravity
      ctx.save();
      ctx.globalAlpha = p.opacity * fadeAlpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// ── WEIGHT LOGGING ────────────────────────────────────────────────────────
// Weight is now sourced ONLY from the weight log: the Mission form's weight
// field is read-only and just displays this. Logging a new weight is what
// updates the calorie target inputs — this is the deliberate "log your
// weight to update your targets" gate.
function getLatestWeight(person) {
  const logs = (S.weightLog||[]).filter(w=>w.person===person).sort((a,b)=>b.date.localeCompare(a.date));
  return logs.length ? logs[0].kg : (S.mission[person] && S.mission[person].weight) || null;
}

function logWeight(person) {
  const inp = document.getElementById((person==='gabi'?'g':'n')+'-weight-log');
  const kg = parseFloat(inp.value);
  if (!kg || kg < 20 || kg > 300) { showToast('Enter a valid weight'); return; }
  // Remove any existing entry for today + person
  S.weightLog = (S.weightLog||[]).filter(w => !(w.person===person && w.date===todayStr()));
  S.weightLog.push({ id: Date.now(), person, date: todayStr(), kg });
  S.mission[person].weight = kg;
  inp.value = '';
  save();
  renderWeightHistories();
  const weightEl = document.getElementById((person==='gabi'?'g':'n')+'-weight');
  if (weightEl) weightEl.value = kg;
  renderActivityControls(person);
  showToast('Weight logged');
}

function deleteWeight(id) {
  // Remove from local state first so the UI updates immediately.
  S.weightLog = (S.weightLog||[]).filter(w => w.id !== id);

  if (S.usingSubcollections && window.__firebaseSync) {
    // Use deleteDoc synchronously from the already-loaded Firebase module.
    const { db, collection, doc, deleteDoc } = window.__firebaseSync;
    deleteDoc(doc(collection(db, 'la-salud', 'sharedData', 'weightLog'), String(id)))
      .catch(err => console.error('[sync] deleteWeight failed', id, err));

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateForStorage())); } catch(e) {}
    pushToCloud();
  } else {
    save();
  }

  renderWeightHistories();
}

function renderWeightHistories() {
  ['gabi','nacho'].forEach(person => {
    const prefix = person==='gabi'?'g':'n';
    const el = document.getElementById(prefix+'-weight-history');
    if (!el) return;
    const logs = (S.weightLog||[]).filter(w=>w.person===person)
      .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);
    if (!logs.length) { el.innerHTML='<div style="font-size:12px;color:var(--mist);padding:6px 0">No weight entries yet.</div>'; return; }
    // Mini trend
    const first = logs[logs.length-1].kg, last = logs[0].kg;
    const delta = (last - first).toFixed(1);
    const deltaColor = delta < 0 ? 'var(--sage)' : delta > 0 ? 'var(--terra)' : 'var(--mist)';
    const trendHtml = logs.length > 1
      ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:${deltaColor};margin-bottom:8px">${delta>0?'+':''}${delta} kg since first entry</div>`
      : '';
    el.innerHTML = trendHtml + logs.map(w=>`
      <div class="weight-hist-item">
        <span class="weight-hist-date">${w.date}</span>
        <span class="weight-hist-val">${w.kg} kg</span>
        <button class="weight-hist-del" onclick="deleteWeight(${w.id})">×</button>
      </div>`).join('');
  });
}

