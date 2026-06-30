// ── STATE ──────────────────────────────────────────────────────────────────
let S = {
  mission: {
    gabi:  { weight:70, height:165, age:29, sex:'female',
              activityLevel:'moderate', manualOverrideUntil:null,
              goal3kg:-3, goal1yWeight:64,
              kcal:1450, protein:100, carbs:130, fat:45 },
    nacho: { weight:71, height:172, age:30, sex:'male',
              activityLevel:'moderate', manualOverrideUntil:null,
              goal3kg:-2, goal1yWeight:68,
              kcal:1950, protein:145, carbs:175, fat:55 }
  },
  entries: [],   // meals AND workouts, distinguished by record_type
  weightLog: [], // { id, person, date, kg }
  currentPerson: 'gabi',
  period: 'day',
  settings: {
    waterGoal: { gabi: 1750, nacho: 1750 },
    movementTargets: {
      gabi:  { zone2_min_week: 150, vo2max_min_week: 30, strength_min_week: 90, mobility_sessions_week: 2, mobility_min_session: 15, steps_day: 10000 },
      nacho: { zone2_min_week: 150, vo2max_min_week: 30, strength_min_week: 90, mobility_sessions_week: 2, mobility_min_session: 15, steps_day: 10000 }
    },
    hypoKit: { gabi: '2 cookies (~12.5g sugar)', nacho: '' },
    hypoMacros: { gabi: { calories: 50, carbs_g: 13 } } // quick estimate for 12.5g sugar; edit in Settings for exact numbers
  },
  dailyTargets: {}, // dailyTargets[person][date] = { water:bool, steps:bool, workout:bool }
  treatTokens: { gabi: 0, nacho: 0 },
  kitchen: { library: [], checked: {}, size: 'regular', mode: 'single', activeTier: null }
};

// Dates are computed from LOCAL time, not UTC, so logging just after local
// midnight files under today's date correctly (Valencia is UTC+1/+2).
// todayStr() is a function (not a cached const) so it can't go stale if the
// app/tab is left open across midnight.
// Reads the Gemini key saved in Settings (localStorage). No hardcoded
// fallback — each of you enters your own key once on your own device.
function getGeminiKey() {
  return localStorage.getItem('gemini_api_key');
}

function pad2(n) { return String(n).padStart(2,'0'); }
function toLocalDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function todayStr() { return toLocalDateStr(new Date()); }
function logDateStr(panel) {
  const el = document.getElementById(panel==='wk' ? 'retro-date-input-wk' : 'retro-date-input');
  return (el && el.value) ? el.value : todayStr();
}
function logTimeStr(panel) {
  const el = document.getElementById(panel==='wk' ? 'retro-time-input-wk' : 'retro-time-input');
  return (el && el.value) ? el.value : new Date().toTimeString().slice(0,5);
}
const STORAGE_KEY = 'la-salud-state-v3';

// ── MULTI-TAB LOCK (localStorage-based, works across PWA/browser/mobile) ───
// BroadcastChannel is unreliable on iOS PWAs and fires across preview iframes
// on the same origin. We use localStorage + StorageEvent instead: each tab
// writes a heartbeat key every 4s, and reads whether any OTHER tab_id is
// actively heartbeating. If yes → show blocking overlay. When the other tab
// closes its heartbeat expires (missed for >6s) → auto-unlock.
(function() {
  const TAB_ID    = 'tab-' + Math.random().toString(36).slice(2);
  const HB_KEY    = 'la-salud-tab-hb';   // JSON: { id, ts }
  const EXPIRE_MS = 6000;   // tab considered gone if heartbeat > 6s old
  let   locked    = false;
  let   hbTimer   = null;

  function showLock() {
    if (locked) return;
    locked = true;
    const el = document.getElementById('tab-lock-overlay');
    if (el) el.classList.add('visible');
  }
  function hideLock() {
    if (!locked) return;
    locked = false;
    const el = document.getElementById('tab-lock-overlay');
    if (el) el.classList.remove('visible');
  }

  function writeHeartbeat() {
    try { localStorage.setItem(HB_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() })); } catch(e) {}
  }

  function checkForOtherTab() {
    try {
      const raw = localStorage.getItem(HB_KEY);
      if (!raw) { hideLock(); return; }
      const hb = JSON.parse(raw);
      const alive = hb.id !== TAB_ID && (Date.now() - hb.ts) < EXPIRE_MS;
      if (alive) showLock(); else hideLock();
    } catch(e) { hideLock(); }
  }

  // Write our own heartbeat, then check if anyone else is alive
  writeHeartbeat();
  // Stagger slightly so two simultaneous opens don't both see "no other tab"
  setTimeout(() => {
    checkForOtherTab();
    // Keep heartbeat alive every 4s
    hbTimer = setInterval(() => { writeHeartbeat(); checkForOtherTab(); }, 4000);
  }, 200);

  // StorageEvent fires in OTHER tabs when localStorage changes — instant unlock
  window.addEventListener('storage', e => {
    if (e.key === HB_KEY) checkForOtherTab();
  });

  // When we leave, clear our heartbeat so other tabs unlock immediately
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Don't clear — we might just be switching apps briefly.
      // The heartbeat will expire naturally if we never come back.
    } else {
      writeHeartbeat();
      setTimeout(checkForOtherTab, 100);
    }
  });
  window.addEventListener('beforeunload', () => {
    clearInterval(hbTimer);
    // Only clear if WE are the active heartbeat owner
    try {
      const raw = localStorage.getItem(HB_KEY);
      if (raw) {
        const hb = JSON.parse(raw);
        if (hb.id === TAB_ID) localStorage.removeItem(HB_KEY);
      }
    } catch(e) {}
  });
})();

// ── STORAGE ────────────────────────────────────────────────────────────────
// localStorage = instant local cache (app stays usable offline, no flicker).
// Firestore   = shared source of truth between Gabi's and Nacho's phones.
// Pattern: render from local instantly on open, then merge in whatever the
// cloud has, then every change pushes the merged result back up. A live
// listener (onSnapshot) means the OTHER phone's edits also arrive without
// needing to reopen the app.
let cloudReady = false;     // true once the first cloud snapshot has arrived
let suppressPush = false;   // true while applying a cloud snapshot, to avoid
                             // immediately re-pushing what we just received

// Returns S without entries/weightLog — those are never cached locally.
// Firebase is canonical; caching them causes deleted entries to reappear.
function _stateForStorage() {
  const { entries, weightLog, ...rest } = S; // eslint-disable-line no-unused-vars
  return rest;
}

function saveLocalOnly() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateForStorage())); } catch(e) {}
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateForStorage())); } catch(e) {}
  if (S.usingSubcollections) pushEntriesToSubcollections();
  pushToCloud();
}

// Post-migration write path: each entry/weight row is its own doc, keyed by
// id, so two phones writing at once just overwrite their own docs rather
// than racing on one giant array field.
//
// IMPORTANT: This function only WRITES entries that are in S.entries.
// It must NEVER be called during a delete operation — doing so would
// re-write the just-deleted doc back to Firebase before deleteDoc() wins
// the race. Deletes go through deleteEntry() / deleteWeight() / clearHistory()
// which call deleteDoc() directly and then pushToCloud() (not this function).
function pushEntriesToSubcollections() {
  if (!window.__firebaseSync) return;
  const { db, collection, doc, setDoc } = window.__firebaseSync;
  S.entries.forEach(e => {
    const clean = stripUndefined(e);
    try {
      setDoc(doc(collection(db,'la-salud','sharedData','entries'), String(e.id)), clean)
        .catch(err => console.error('[sync] entry write failed', e.id, err));
    } catch (err) {
      console.error('[sync] entry setDoc threw synchronously', e.id, err);
    }
  });
  (S.weightLog||[]).forEach(w => {
    const clean = stripUndefined(w);
    try {
      setDoc(doc(collection(db,'la-salud','sharedData','weightLog'), String(w.id)), clean)
        .catch(err => console.error('[sync] weight write failed', w.id, err));
    } catch (err) {
      console.error('[sync] weight setDoc threw synchronously', w.id, err);
    }
  });
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      S = { ...S, ...JSON.parse(raw) };
      S.currentPerson = 'gabi';
      // Always clear entries and weightLog — Firebase is the sole source of
      // truth. Never seed from localStorage; stale cache is what causes
      // deleted entries to reappear on next load.
      S.entries   = [];
      S.weightLog = [];
    }
  } catch(e) {}
}

// Same identity used by the existing CSV restore/dedup logic, so merges are
// consistent whether data arrives via CSV file or via the cloud.
function entryKey(e) {
  if (e.record_type === 'water') return entrySignature('WATER', e.date, e.person, 'Water', e.logged_at||'');
  return entrySignature(
    e.record_type === 'workout' ? 'WORKOUT' : 'MEAL',
    e.date, e.person,
    e.record_type === 'workout' ? e.workout_type : e.meal,
    e.logged_at
  );
}

// Merge two entry arrays without duplicating or losing anything either
// phone logged, even if both added entries while offline.
function mergeEntries(localEntries, cloudEntries) {
  const byKey = new Map();
  localEntries.forEach(e => byKey.set(entryKey(e), e));
  cloudEntries.forEach(e => {
    const k = entryKey(e);
    if (!byKey.has(k)) byKey.set(k, e);
  });
  return Array.from(byKey.values());
}

// Firestore's setDoc() THROWS SYNCHRONOUSLY (not a rejected promise) if any
// field anywhere in the payload — however deeply nested — is `undefined`.
// Because it throws before returning a promise, a normal .catch() never
// even attaches, so the error escapes as a raw uncaught exception instead
// of our usual showToast()/setSyncStatus('offline') handling. That's the
// "Function setDoc() called with invalid data" popup.
// stripUndefined() recursively removes any undefined value (and logs exactly
// where it found one, once, to the console) so a single stray field never
// blocks the entire sync again.
function stripUndefined(value, path) {
  path = path || 'root';
  if (value === undefined) {
    console.warn('[sync] stripped undefined field at', path);
    return null;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v, i) => stripUndefined(v, path + '[' + i + ']'));
  }
  const out = {};
  Object.keys(value).forEach(k => {
    out[k] = stripUndefined(value[k], path + '.' + k);
  });
  return out;
}

function pushToCloud() {
  if (suppressPush) return;
  if (!window.__firebaseSync) return;
  const { sharedDocRef, setDoc } = window.__firebaseSync;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setSyncStatus('offline');
    return;
  }

  // Build the parent-doc payload. In subcollections mode entries/weightLog
  // live in their own subcollections; only settings/mission/etc go here.
  const payload = stripUndefined(S.usingSubcollections ? {
    mission: S.mission,
    settings: S.settings || {},
    dailyTargets: S.dailyTargets || {},
    treatTokens: S.treatTokens || {},
    kitchenChecked: (S.kitchen && S.kitchen.checked) || {},
    kitchenSize: (S.kitchen && S.kitchen.size) || 'regular',
    updatedAt: Date.now()
  } : {
    entries: S.entries,
    mission: S.mission,
    weightLog: S.weightLog || [],
    settings: S.settings || {},
    dailyTargets: S.dailyTargets || {},
    treatTokens: S.treatTokens || {},
    kitchenChecked: (S.kitchen && S.kitchen.checked) || {},
    kitchenSize: (S.kitchen && S.kitchen.size) || 'regular',
    updatedAt: Date.now()
  });

  setSyncStatus('pending');
  try {
    const writeOpts = S.usingSubcollections ? { merge: true } : undefined;
    (writeOpts ? setDoc(sharedDocRef, payload, writeOpts) : setDoc(sharedDocRef, payload))
      .then(() => {
        // Write confirmed by server — immediately re-poll so the UI reflects
        // the authoritative server state (e.g. after a delete)
        setTimeout(_fetchFromServer, 300);
      })
      .catch(() => setSyncStatus('offline'));
  } catch (e) {
    console.error('[sync] setDoc threw synchronously:', e);
    setSyncStatus('offline');
  }
}

let _currentSyncState = null; // tracked so other code (auto-reconnect on
                               // visibility/online events) can check the
                               // current state without re-parsing DOM text.
// Auto-fade: once the dot has sat in 'synced' for 5s straight (no writes,
// no reconnects, nothing), it fades out — everything's fine, no need to
// keep showing a dot for it. Any other state (pending/connecting/stuck/
// offline) cancels the fade-out timer and brings the dot back immediately,
// since those are exactly the states the person should be able to see.
let _syncFadeTimer = null;
function setSyncStatus(state) {
  _currentSyncState = state;
  const el = document.getElementById('sync-status');
  if (!el) return;

  // Clear the offline retry timer whenever we successfully leave the offline state
  if (state !== 'offline') {
    if (_offlineRetryTimer) { clearInterval(_offlineRetryTimer); _offlineRetryTimer = null; }
  }

  // Any state change cancels a pending fade-out — only an uninterrupted
  // 5s of 'synced' should ever hide the dot.
  if (_syncFadeTimer) { clearTimeout(_syncFadeTimer); _syncFadeTimer = null; }
  el.style.opacity = '1';

  if (state === 'synced') {
    el.style.color = '#7FFF00'; // acid green — bright, not themed
    el.innerHTML = '●';
    _syncFadeTimer = setTimeout(() => {
      // Only fade if still synced when the timer fires — setSyncStatus
      // would have already cancelled this timer otherwise, but guard
      // anyway in case of any future call-site changes.
      if (_currentSyncState === 'synced') el.style.opacity = '0';
      _syncFadeTimer = null;
    }, 5000);
  } else if (state === 'pending') {
    el.style.color = '#7FFF00';
    el.innerHTML = '●';
  } else if (state === 'connecting') {
    el.style.color = '#888';
    el.innerHTML = '●';
  } else if (state === 'stuck') {
    el.style.color = '#e05252';
    el.innerHTML = '●';
    if (!_offlineRetryTimer) {
      _offlineRetryTimer = setInterval(() => { if (!cloudReady) doSync(); }, 60000);
    }
  } else {
    // offline
    el.style.color = '#e05252';
    el.innerHTML = '●';
    if (!_offlineRetryTimer) {
      _offlineRetryTimer = setInterval(() => { doSync(); }, 60000);
    }
  }
}

// ── CLOUD SYNC ─────────────────────────────────────────────────────────────
// Fresh rewrite. One active listener at a time, tracked by unsub handle.
// doSync() is the single entry point — called on init and on badge tap.
// It waits for __firebaseSync to be ready (the Firebase module loads async),
// then attaches a Firestore onSnapshot listener. Any previous listener is
// torn down first so there's never more than one active.

// _syncUnsub / _syncPoll removed — replaced by _pollTimer / _fetchFromServer polling engine

// ── SYNC ENGINE: cache-free polling via getDocsFromServer ──────────────────
// We deliberately avoid onSnapshot entirely for reading entries/weightLog.
// Firestore's onSnapshot uses a persistent IndexedDB cache that can serve
// stale deleted documents even after they're gone from the server — exactly
// the "deleted entries keep reappearing" bug. getDocsFromServer() bypasses
// the cache completely, always going to the server. We poll every 3s so both
// phones see each other's changes within a few seconds, and after any local
// write we poll immediately so the confirmed state is always what's displayed.
//
// The parent doc (mission/settings) still uses onSnapshot but we gate on
// fromCache so legacy single-doc mode also works correctly.

let _pollTimer        = null;   // setInterval handle for the poll loop
let _pollInFlight     = false;  // prevent overlapping fetches
let _fbWaitTimer      = null;   // polls until __firebaseSync is ready
let _offlineRetryTimer = null;  // auto-retries every 60s while offline
let _lastSyncHash     = null;   // fingerprint of last fetched data, to skip no-op renders
// Once true, renderVitals is allowed to paint even before the first server
// fetch — it draws from whatever is in S (local cache from localStorage).
// This means the UI is never blank while waiting for Firebase to respond.
let _cacheRendered    = false;

// Stable JSON serialisation — sorts object keys recursively so two objects
// with the same data but different key insertion order produce the same string.
// Used for the sync hash to avoid spurious re-renders when Firestore returns
// the same data with shuffled key order.
function _stableStr(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_stableStr).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStr(v[k])).join(',') + '}';
}

// Called once per poll cycle — fetches entries + weightLog directly from
// server, applies them to S, re-renders. Never touches Firestore local cache.
async function _fetchFromServer() {
  if (_pollInFlight || !window.__firebaseSync) return;
  _pollInFlight = true;
  try {
    const { db, collection, doc, getDoc, getDocs } = window.__firebaseSync;
    // getDocsFromServer requires the source option — use getDocs with source override.
    // We import getDocsFromServer via the already-loaded module reference.
    const fs = window.__firebaseSync;
    if (!fs.getDocsFromServer) {
      // Not imported yet — skip this tick
      _pollInFlight = false;
      return;
    }

    // Fetch entries subcollection and parent doc in parallel
    const [entriesSnap, parentSnap] = await Promise.all([
      fs.getDocsFromServer(collection(db, 'la-salud', 'sharedData', 'entries')),
      fs.getDocFromServer(doc(db, 'la-salud', 'sharedData')),
    ]);

    suppressPush = true;

    // Entries: server is authoritative — replace entirely, no merge
    S.entries = entriesSnap.docs.map(d => d.data());

    // Parent doc: settings/mission/etc (no entries/weightLog in subcollection mode)
    if (parentSnap.exists()) {
      const cloud = parentSnap.data();
      if (cloud.mission)      S.mission      = cloud.mission;
      if (cloud.settings)     S.settings     = { ...S.settings, ...cloud.settings };
      if (cloud.dailyTargets) S.dailyTargets = cloud.dailyTargets;
      if (cloud.treatTokens)  S.treatTokens  = cloud.treatTokens;
      if (!S.kitchen) S.kitchen = { library: [], checked: {}, size: 'regular' };
      if (cloud.kitchenChecked) S.kitchen.checked = cloud.kitchenChecked;
      if (cloud.kitchenSize)    S.kitchen.size     = cloud.kitchenSize;
      // Legacy single-doc mode: entries lived on the parent doc
      if (cloud.entries && !S.usingSubcollections) {
        S.entries = cloud.entries;
      }
      // First time we see the parent doc without entries/weightLog → subcollections mode
      if (!S.usingSubcollections && !('entries' in cloud) && !('weightLog' in cloud)) {
        S.usingSubcollections = true;
      }
      if (!cloudReady && !S.usingSubcollections) {
        // Legacy first-run seed
        if (!parentSnap.exists()) pushToCloud();
      }
    } else if (!cloudReady) {
      pushToCloud(); // first ever run — seed from local
    }

    // Also fetch weightLog subcollection
    const wlSnap = await fs.getDocsFromServer(collection(db, 'la-salud', 'sharedData', 'weightLog'));
    S.weightLog = wlSnap.docs.map(d => d.data());

    // ── DATA REPAIR — runs on every load, fixes two related corruptions ──
    //
    // 1) PERSON CASING: some entries (originally from a CSV import that
    //    didn't normalise the person column) ended up stored as
    //    "Nacho"/"NACHO" instead of the lowercase 'nacho' every comparison
    //    in the app expects (entriesFor, groupEntriesByPersonDate, the
    //    POTATES scorer). A casing mismatch makes those entries invisible
    //    everywhere — this was driving Nacho's score to a flat 0.
    //
    // 2) NUMERIC FIELDS AS STRINGS: AI-parsed meal/workout entries could end
    //    up with a numeric field (omega3_g, magnesium_mg, duration_min, etc)
    //    stored as a raw non-numeric string (e.g. "trace") instead of a
    //    number, because normaliseLine() falls back to the raw string when
    //    it can't confidently parse a number out of the AI's reply, and the
    //    `||0` guards at entry-creation time don't catch truthy strings.
    //    Any arithmetic on those fields downstream (micronutrient averages,
    //    the score, CSV export's .toFixed()) then breaks — showing as NaN
    //    in the UI or throwing outright in the CSV export. log.js now
    //    coerces these at creation time, but this repairs anything already
    //    sitting in Firestore from before that fix.
    const NUMERIC_MEAL_FIELDS = ['calories','protein_g','carbs_g','netcarbs_g','fat_g','fibre_g',
      'magnesium_mg','vitd_mcg','iron_mg','calcium_mg','zinc_mg','b12_mcg','omega3_g','potassium_mg',
      'vitc_mg','folate_mcg','day_kcal_target'];
    const NUMERIC_WORKOUT_FIELDS = ['duration_min','calories_burned','steps_logged'];
    const toNum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    let _repaired = false;
    S.entries.forEach(e => {
      if (typeof e.person === 'string') {
        const fixed = e.person.trim().toLowerCase();
        if (fixed !== e.person) { e.person = fixed; _repaired = true; }
      }
      const fields = e.record_type === 'workout' ? NUMERIC_WORKOUT_FIELDS : NUMERIC_MEAL_FIELDS;
      fields.forEach(f => {
        if (e[f] === undefined) return; // absent is fine, don't invent fields
        if (typeof e[f] !== 'number' || isNaN(e[f])) { e[f] = toNum(e[f]); _repaired = true; }
      });
    });
    S.weightLog.forEach(e => {
      if (typeof e.person === 'string') {
        const fixed = e.person.trim().toLowerCase();
        if (fixed !== e.person) { e.person = fixed; _repaired = true; }
      }
    });
    if (_repaired) {
      // Push the corrected data back to the cloud so this is a one-time
      // repair rather than something every device has to redo on load.
      pushToCloud();
      if (S.usingSubcollections) pushEntriesToSubcollections();
    }

    suppressPush = false;

    // Persist mission/settings/etc but NOT entries/weightLog.
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_stateForStorage())); } catch(e) {}

    const wasFirstSync = !cloudReady;
    cloudReady = true;
    setSyncStatus('synced');

    // Only re-render if data actually changed — avoids the visible "flicker"
    // (and donut CSS re-animation) on every poll tick when nothing is different.
    // Hash covers everything that drives the UI: entries, weightLog, mission,
    // kitchen, settings, and dailyTargets. If none of these changed, the poll
    // was a no-op and we skip the render entirely.
    //
    // IMPORTANT: Firestore returns docs in non-deterministic order each fetch,
    // so we sort by id before joining — otherwise identical data produces a
    // different hash every single poll and always triggers a re-render.
    const sortedEntries   = [...S.entries].sort((a,b) => String(a.id) < String(b.id) ? -1 : 1);
    const sortedWeightLog = [...(S.weightLog||[])].sort((a,b) => String(a.id) < String(b.id) ? -1 : 1);
    const newHashParts = {
      e:   sortedEntries.length,
      w:   sortedWeightLog.length,
      em:  sortedEntries.map(x=>x.id).join(','),
      wm:  sortedWeightLog.map(x=>x.id).join(','),
      // Include entry values so an edit (same id, different calories/name) is caught
      ev:  sortedEntries.map(x=>(x.calories||0)+'|'+(x.workout_type||x.meal||'')).join(','),
      wv:  sortedWeightLog.map(x=>x.kg).join(','),
      mis: _stableStr(S.mission),
      kit: _stableStr(S.kitchen),
      set: _stableStr(S.settings),
      tgt: _stableStr(S.dailyTargets),
    };
    const newHash = _stableStr(newHashParts);
    if (wasFirstSync || newHash !== _lastSyncHash) {
      if (!wasFirstSync && _lastSyncHash) {
        console.log('[sync] data changed — re-rendering');
      }
      _lastSyncHash = newHash;
      renderVitals(); renderLogTab(); syncFullDayCheckbox(); renderKitchen();
      loadMissionFields(); renderWeightHistories();
      if (document.getElementById('sec-history') && document.getElementById('sec-history').classList.contains('active')) renderHistory();
    }

  } catch(err) {
    suppressPush = false;
    // Log the full error so we can see what's actually failing in the console
    console.error('[sync] poll failed:', err && err.code, err && err.message, err);
    setSyncStatus('offline');
  } finally {
    _pollInFlight = false;
  }
}

// Start the poll loop. Safe to call multiple times — tears down existing loop first.
function _startPollLoop() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _fetchFromServer(); // immediate fetch on attach
  _pollTimer = setInterval(_fetchFromServer, 60000);
}

function doSync() {
  if (_fbWaitTimer) { clearInterval(_fbWaitTimer); _fbWaitTimer = null; }
  setSyncStatus('connecting');

  if (window.__firebaseSync) {
    _startPollLoop();
  } else {
    // Firebase module hasn't finished loading yet — wait up to 15s (slow
    // network) before giving up. The module script calls __onFirebaseReady()
    // when it's done, which starts the poll immediately without waiting here.
    const giveUp = Date.now() + 15000;
    _fbWaitTimer = setInterval(() => {
      if (window.__firebaseSync) {
        clearInterval(_fbWaitTimer); _fbWaitTimer = null;
        _startPollLoop();
      } else if (Date.now() > giveUp) {
        clearInterval(_fbWaitTimer); _fbWaitTimer = null;
        console.warn('[sync] Firebase module never loaded — going offline');
        setSyncStatus('offline');
      }
    }, 300);
  }
}

// Called by the Firebase module script as soon as __firebaseSync is ready —
// skips the polling wait and starts syncing immediately.
window.__onFirebaseReady = function() {
  if (_fbWaitTimer) { clearInterval(_fbWaitTimer); _fbWaitTimer = null; }
  _startPollLoop();
};

// Called if the Firebase module import itself throws (no network, ad-blocker).
window.__onFirebaseFailed = function() {
  if (_fbWaitTimer) { clearInterval(_fbWaitTimer); _fbWaitTimer = null; }
  setSyncStatus('offline');
};

// Public entry points
function retryCloudSync() { doSync(); }
function startCloudSync()  { doSync(); }

// Re-poll immediately when coming back to foreground (catches changes made
// on the other phone while this one was asleep / backgrounded)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.__firebaseSync) {
    _fetchFromServer();
  }
});
window.addEventListener('online', () => {
  if (window.__firebaseSync) _fetchFromServer();
});

// Stub — no longer needed but kept so any lingering call sites don't throw
function attachSubcollectionListeners() {}

// ── INIT ───────────────────────────────────────────────────────────────────
function init() {
  load();
  if (!S.settings) S.settings = { waterGoal:{gabi:1750,nacho:1750}, movementTargets:{gabi:{zone2_min_week:150,vo2max_min_week:30,strength_min_week:90,mobility_sessions_week:2,mobility_min_session:15,steps_day:10000},nacho:{zone2_min_week:150,vo2max_min_week:30,strength_min_week:90,mobility_sessions_week:2,mobility_min_session:15,steps_day:10000}}, hypoKit:{gabi:'2 cookies (~12.5g sugar)',nacho:''}, hypoMacros:{gabi:{calories:50,carbs_g:13}} };
  if (!S.settings.movementTargets) S.settings.movementTargets = { gabi:{zone2_min_week:150,vo2max_min_week:30,strength_min_week:90,mobility_sessions_week:2,mobility_min_session:15,steps_day:10000}, nacho:{zone2_min_week:150,vo2max_min_week:30,strength_min_week:90,mobility_sessions_week:2,mobility_min_session:15,steps_day:10000} };
  if (!S.settings.hypoMacros) S.settings.hypoMacros = { gabi: { calories:50, carbs_g:13 } };
  if (!S.dailyTargets) S.dailyTargets = {};
  if (!S.treatTokens) S.treatTokens = { gabi:0, nacho:0 };
  if (!S.kitchen) S.kitchen = { library: [] };
  if (!S.kitchen.checked) S.kitchen.checked = {};
  if (!S.kitchen.size) S.kitchen.size = 'regular';
  if (!S.kitchen.mode) S.kitchen.mode = 'single';
  if (S.kitchen.activeTier === undefined) S.kitchen.activeTier = null;
  document.getElementById('hdr-date').textContent =
    new Date().toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).toUpperCase();
  populateGoalSelects();
  loadMissionFields();
  setPerson(S.currentPerson || 'gabi');
  // Sync sky canvas to initial person (no animation, instant)
  if (window._skyDrawStatic) window._skyDrawStatic(S.currentPerson || 'gabi');
  // Allow renderVitals to paint from local cache immediately — before Firebase
  // responds. The first _fetchFromServer call will re-render with server data
  // if anything has changed (hash check), otherwise the cached view stays put.
  _cacheRendered = true;
  setPeriod('day'); // Vitals always opens on Day regardless of what was last selected
  renderLogTab();
  syncFullDayCheckbox();
  renderKitchen();
  doSync();
  // Last-resort auto-retry: if still not synced after 15s, fire again.
  setTimeout(() => { if (!cloudReady) doSync(); }, 15000);
}

// Builds the scroll-wheel-style <select> options once on load. The 3-month
// goal is a signed delta in 0.5kg steps (-10kg to +10kg covers any realistic
// 3-month target); the 1-year goal is a plain target weight in 0.5kg steps,
// purely motivational, never read by calculateDailyTarget().
function populateGoalSelects() {
  const goalOpts = [];
  for (let kg = -10; kg <= 10; kg += 0.5) {
    const label = kg === 0 ? 'Maintain (0kg)' : (kg > 0 ? `+${kg}kg` : `${kg}kg`);
    goalOpts.push(`<option value="${kg}">${label}</option>`);
  }
  const goalHtml = goalOpts.join('');

  const weightOpts = [];
  for (let kg = 40; kg <= 130; kg += 0.5) {
    weightOpts.push(`<option value="${kg}">${kg}kg</option>`);
  }
  const weightHtml = weightOpts.join('');

  ['g-goal3kg', 'n-goal3kg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = goalHtml;
  });
  ['g-goal1y', 'n-goal1y'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = weightHtml;
  });
}
