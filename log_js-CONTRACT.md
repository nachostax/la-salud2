# log.js — extraction notes & contract

Extracted verbatim from `index.html` lines 3063–4465 (the original, un-split
monolith). No renaming, no logic changes. Covers: AI-output parsing, meal
logging, Submit Log, Log mode toggle, quick log, kitchen/cooking schedule,
hungry-now, workouts, water.

## Load order requirement
`log.js` must load **after** any module(s) that define `S`, and after any
module defining the helper functions listed below — it assumes they already
exist on `window` when it runs (classic global-script style, no
import/export). Suggested tag:

```html
<script src="state.js"></script>
<script src="ui.js"></script>
<!-- ...other modules... -->
<script src="log.js"></script>
```

The original `init()` call (wherever it lives, e.g. `settings.js` per your
other team's setup) must run only after **all** scripts have loaded, since
it likely calls into render functions defined across several of these files.

## What log.js defines (47 top-level functions + module state)
Functions: `normaliseLine`, `isPlausibleMealName`, `parseAIOutput`,
`commitEntries`, `applyFullDayStatus`, `submitLog`, `setLogMode`,
`quickLogMeal`, `quickLogCoffee`, `quickLogMultivitamins`,
`syncHypoQuickBtn`, `scaledMacro`, `setKitchenSize`, `setKitchenMode`,
`selectKitchenTier`, `pickFromTier`, `pickBundle`, `removeKitchenPick`,
`pickVariedTrio`, `renderKitchen`, `copyShoppingList`, `setHungryTier`,
`setHungryMode`, `refreshHungryModeSoloLabel`, `setAIAssistMode`,
`refreshAIAssistModeSoloLabel`, `remainingBudgetToday`,
`buildCookingSchedulePrompt`, `copyCookingSchedulePrompt`, `burnEstimate`,
`burnEstimateFromSteps`, `selectCardioSub`, `selectWorkoutType`,
`setWalkBy`, `submitWorkout`, `buildOtherWorkoutPrompt`, `submitLogBoth`,
`logWorkoutBoth`, `burnEstimateForPerson`, `renderTodayWorkouts`,
`getWaterGoal`, `getWaterEntry`, `getWaterMlForEntry`, `getWaterMl`,
`setWaterMl`, `addWaterMl`, `renderWater`

Module-level state (declared inside log.js, used only within it):
`currentLogMode`, `QUICK_MEALS`, `MEAL_LIBRARY`, `KITCHEN_SIZE_MULT`,
`KITCHEN_SIZE_LABEL`, `KITCHEN_BUNDLES`, `KITCHEN_TIERS`, `hungryTier`,
`hungryMode`, `aiAssistMode`, `WORKOUT_METS`, `selectedWorkoutType`,
`walkBy`, `selectedCardioSub`, `mealLogForBoth`, `workoutLogForBoth`

Any HTML `onclick="someLogFunction()"` handlers referencing the names above
will keep working unchanged as long as these stay as plain global function
declarations (not wrapped in an IIFE or ES module).

## What log.js needs from OTHER modules (must exist as globals before log.js runs)
- `S` — the shared state object (`S.entries`, `S.currentPerson`,
  `S.dailyTargets`, `S.settings`, etc.) — from `state.js`
- `entryKey(entry)` — from `state.js`
- `save()`, `saveLocalOnly()` — from `state.js`
- `todayStr()`, `logDateStr()`, `logTimeStr()` — from `state.js` (date utils)
- `checkDailyTargets(person, date)` — from `state.js` (defined right after
  log.js's original boundary, at old line 4468 — confirm it lands in
  `state.js` or wherever, but NOT duplicated into log.js)
- `entriesFor(person, dates, type)` — from `state.js` (defined just *before*
  log.js's original boundary, at old line 3044 — same caution: must exist
  exactly once, not duplicated)
- `sumField(...)` — sum helper, likely `state.js` or a `utils.js`
- `showToast(msg)`, `setBtnThinking(btn, bool)`, `animateCountTo(el, val, opts)`,
  `renderMarkdown(md)`, `copyText(text)` — from `ui.js`
- `renderLogTab()`, `renderVitals()` — from `ui.js` (cross-tab re-render calls)
- `openSettings()` — from `settings.js`
- `getGeminiKey()`, `askGemini(prompt)` — Gemini AI integration, likely a
  dedicated `ai.js` or inside `settings.js`
- `deleteEntry(...)`, `syncFullDayCheckbox(...)` — possibly `ui.js` or `state.js`
- `submitLogAuto(...)`, `submitOtherWorkout(...)`, `runCookingSchedule(...)`,
  `runHungryNow(...)` — these are *called* from inside log.js but not
  *defined* in this 3063–4465 range. **Double-check with the other team
  exactly where these live** — if they intended these to be IN log.js,
  something was lost in their boundary cut; if intentionally elsewhere,
  confirm the file and load order.

## ⚠️ Open risk
I extracted this range in isolation, without visibility into the other
team's actual `state.js`/`ui.js`/`settings.js` files (only a photo showing
their conversation, not their code). The dependency list above is my best
reconstruction from the source. Before merging into the real repo, someone
needs to confirm every name in "What log.js needs from OTHER modules"
actually exists, exactly once, with a matching signature, in the final
module set — otherwise you'll get `ReferenceError`s or duplicate-declaration
clashes at runtime.

---

## CHANGE LOG

### 1. New standalone "Day Complete" toggle (`toggleDayComplete`)
**New function added to log.js**, callable directly from a click with no
arguments:

```js
function toggleDayComplete() { ... }
```

It flips `full_day` on all of today's meal entries for the current person,
saves, and re-renders — independent of Submit Log. `renderLogTab()` (outside
log.js) already detects `full_day` and shows the congrats banner +
confetti on its own, so no changes were needed there.

**Required changes OUTSIDE log.js (not made yet — flagging for whoever owns
those files):**

1. **HTML markup** — replace the current checkbox + label:
   ```html
   <input type="checkbox" id="full-day-check" onchange="...">
   <label for="full-day-check">That's everything I ate today — day is done</label>
   ```
   with a single round, centered button, e.g.:
   ```html
   <div style="text-align:center;padding:4px 0 14px">
     <button id="full-day-check" onclick="toggleDayComplete()"
       style="width:120px;height:120px;border-radius:50%;border:none;
              background:var(--bark);color:var(--sand);font-size:14px;
              cursor:pointer">Day complete</button>
   </div>
   ```
   (Exact sizing/colors are placeholders — adjust to match the app's design
   system. Keeping `id="full-day-check"` avoids having to also rewrite
   `syncFullDayCheckbox()`'s selector, see below.)

2. **`syncFullDayCheckbox()`** currently does:
   ```js
   document.getElementById('full-day-check').checked = today.length > 0 && today.some(e => e.full_day);
   ```
   Since the element is no longer a checkbox, `.checked` won't apply visual
   state to a `<button>`. Needs to become something like:
   ```js
   function syncFullDayCheckbox() {
     const today = entriesFor(S.currentPerson, [todayStr()], 'meal');
     const isFull = today.length > 0 && today.some(e => e.full_day);
     const btn = document.getElementById('full-day-check');
     if (btn) btn.classList.toggle('day-complete-active', isFull);
   }
   ```
   plus a CSS rule for `.day-complete-active` (round button visual "on" state).

3. **Old `applyFullDayStatus()`** is left in log.js but no longer called
   from `submitLog()`. It still reads `#full-day-check` as a checkbox
   (`.checked`), which will break once that element becomes a button. Safe
   to delete once nothing else references it — search the other modules
   for `applyFullDayStatus(` before removing.

4. **`submitLog()`** no longer touches full-day status at all. It now only
   handles pasted AI text — if there's no text, it shows "Nothing to
   submit — paste a reply first" and returns early (previously it allowed
   submitting with empty text if only the full-day checkbox changed).

