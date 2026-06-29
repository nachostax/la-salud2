// ── TABS ───────────────────────────────────────────────────────────────────
function moveNavIndicator(el) {
  const ind = document.getElementById('bnav-indicator');
  if (!ind || !el) return;
  if (el.id === 'hdr-settings-btn') { ind.classList.add('hidden'); return; }
  ind.classList.remove('hidden');
  const nav = document.getElementById('bnav');
  const navRect = nav.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  ind.style.width = r.width + 'px';
  ind.style.transform = 'translateX(' + (r.left - navRect.left) + 'px)';
}
function openSettingsTab(el) {
  el.classList.add('spun');
  showSec('settings', el);
}
// Left-to-right order of the main nav for slide-direction purposes.
// Settings (now a header icon, not a row tab) isn't in the row, so it's
// treated as living off the right edge — opening it always slides in from
// the right, and going from Settings to any tab always slides in from the
// left. Physical row order is: Vitals, Progress, Log (center), Kitchen,
// Workout — this array must always match the DOM order of .bnav-tab in
// index.html, since swipe-gesture neighbour lookups and the sliding
// indicator both depend on the two staying in sync.
const SEC_ORDER = ['vitals','history','log','kitchen','workout'];
let lastSecName = 'vitals';
function secIndex(name) {
  const i = SEC_ORDER.indexOf(name);
  return i === -1 ? SEC_ORDER.length : i; // settings sorts after history
}
function showSec(name, el) {
  const fromIdx = secIndex(lastSecName);
  const toIdx = secIndex(name);
  const dir = toIdx === fromIdx ? null : (toIdx > fromIdx ? 'right' : 'left');
  const stage = document.getElementById('sec-stage');
  const outgoing = document.querySelector('.sec.active');
  const target = document.getElementById('sec-' + name);

  document.querySelectorAll('.bnav-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  moveNavIndicator(el);

  // Bottom-nav tabs (Vitals/Kitchen/Workout/Log/Progress) are a different
  // navigation layer than the Settings sub-screen stack (Profile/Targets/
  // History/etc). Landing on a bottom-nav tab always means we've left that
  // stack, so currentSubSec must be cleared here — otherwise it can go
  // stale (e.g. set by a prior Settings→History visit) and later get
  // replayed by setPerson()'s "re-render whatever sub-screen is open" logic,
  // which yanks the user into Settings even though they're sitting on the
  // Progress tab.
  currentSubSec = null;

  const finishSwap = () => {
    document.querySelectorAll('.sec').forEach(s => s.classList.remove(
      'active','sec-out','sec-in','sec-out-left','sec-out-right','sec-in-left','sec-in-right'
    ));
    target.classList.add('active');
    if (stage) { stage.classList.remove('sec-transitioning'); stage.style.height = ''; }
  };

  if (!dir || !outgoing || outgoing === target) {
    // Same tab re-tapped, or nothing to animate from (e.g. first load) —
    // just swap instantly, no slide.
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
    target.classList.add('active');
  } else {
    // Lock the stage's height to whichever panel is taller so neither
    // absolutely-positioned panel causes it to collapse mid-transition.
    target.classList.add('active');
    const outH = outgoing.offsetHeight, inH = target.offsetHeight;
    if (stage) stage.style.height = Math.max(outH, inH) + 'px';
    target.classList.remove('active');

    if (stage) stage.classList.add('sec-transitioning');
    outgoing.classList.add('sec-out', dir === 'right' ? 'sec-out-left' : 'sec-out-right');
    target.classList.add('active','sec-in', dir === 'right' ? 'sec-in-right' : 'sec-in-left');
    target.addEventListener('animationend', finishSwap, { once: true });
  }

  lastSecName = name;
  document.body.classList.toggle('settings-active', name === 'settings');
  // Update header title: fade out, swap text, fade in
  const _titleLabels = { vitals:'Vitals', log:'Log', kitchen:'Kitchen', workout:'Workout', history:'Progress', settings:'Settings' };
  const _newLabel = _titleLabels[name] || name;
  const titleEl = document.getElementById('hdr-section-title');
  if (titleEl && titleEl.textContent !== _newLabel) {
    titleEl.classList.remove('title-entering');
    titleEl.classList.add('title-hidden');
    setTimeout(() => {
      titleEl.textContent = _newLabel;
      titleEl.classList.remove('title-hidden');
      void titleEl.offsetWidth; // force reflow so animation restarts
      titleEl.classList.add('title-entering');
      titleEl.addEventListener('animationend', () => titleEl.classList.remove('title-entering'), { once: true });
    }, 350);
  }
  if (name !== 'settings') {
    const gear = document.getElementById('hdr-settings-btn');
    if (gear) gear.classList.remove('spun');
  }
  const hdr = document.getElementById('main-hdr');
  if (hdr) {
    if (name === 'vitals') {
      hdr.classList.remove('hdr-collapsed');
    } else {
      hdr.classList.add('hdr-collapsed');
    }
  }
  if (name === 'kitchen') renderKitchen();
  if (name === 'history') renderProgress();
  if (name === 'settings') renderSettingsBody();
}

// ── SETTINGS SUB-SCREENS ─────────────────────────────────────────────────
// Lightweight sibling to showSec(), for screens reached only through the
// Settings menu (Profile, Targets, History-via-menu, API Key & Sync,
// Notifications) and for navigating back to the Settings menu itself.
// Deliberately does NOT touch bnav-tab active state or the sliding
// indicator — the gear icon stays the "active" bottom-nav tab the whole
// time the person is anywhere inside Settings, sub-screen or not, which
// is exactly what should happen since they never left Settings.
// Also deliberately does NOT update lastSecName/SEC_ORDER bookkeeping —
// that bookkeeping is only for the swipeable top-level tabs.
const SUBSEC_TITLES = { settings:'Settings', profile:'Profile', targets:'Targets', history:'History', apikey:'API Key & Sync', notifications:'Notifications', quicklog:'Quick Log Edits' };
// Maps a sub-screen name to its actual DOM id, for the rare cases where they
// differ — currently only 'history', whose div is sec-settings-history so it
// doesn't collide with the bottom-nav Progress tab's sec-history.
const SUBSEC_DOM_IDS = { history: 'sec-settings-history' };
// Tracks whichever sub-screen is currently open (null if none), so that
// switching person via togglePerson()/setPerson() can re-render whatever
// sub-screen the person is looking at right now.
let currentSubSec = null;

// Sub-screen navigation stack — used to know whether a transition is a
// forward push (new item onto stack → slide in from right) or a back pop
// (returning to parent → slide out to right). 'settings' is always the root.
const _subsecStack = ['settings'];

function showSubSec(name, opts) {
  // opts.instant = true skips animation (used by person-switch re-renders).
  const instant = opts && opts.instant;
  const domId = SUBSEC_DOM_IDS[name] || ('sec-' + name);
  const target = document.getElementById(domId);
  if (!target) return;

  const outgoing = document.querySelector('.sec.active');

  // ── Content data-load first (so the panel is populated before it slides in)
  if (name === 'profile' || name === 'targets') renderMission();
  if (name === 'targets') {
    const sg = (S.settings && S.settings.stepGoal) || {};
    const wg = (S.settings && S.settings.waterGoal) || {};
    const wog = (S.settings && S.settings.workoutGoal) || {};
    ['gabi','nacho'].forEach(p => {
      const stepEl = document.getElementById('set-steps-'+p);
      if (stepEl && sg[p] != null) stepEl.value = sg[p];
      const waterEl = document.getElementById('set-water-'+p);
      if (waterEl && wg[p] != null) waterEl.value = wg[p];
      const workEl = document.getElementById('set-workouts-'+p);
      if (workEl && wog[p] != null) workEl.value = wog[p];
    });
  }
  if (name === 'history') renderHistory();
  if (name === 'settings') { currentSubSec = null; renderSettingsBody(); }
  if (name === 'apikey') renderApiKeyBody();
  if (name === 'quicklog') renderQuickLogBody();

  // Determine push vs pop by checking whether we're going deeper or back.
  // Going to 'settings' is always a pop (back to root).
  const isBack = (name === 'settings') || (
    _subsecStack.length >= 2 && _subsecStack[_subsecStack.length - 2] === name
  );

  // Update the header title
  const titleEl = document.getElementById('hdr-section-title');
  const newLabel = SUBSEC_TITLES[name] || name;
  if (titleEl && titleEl.textContent !== newLabel) {
    titleEl.classList.remove('title-entering');
    titleEl.classList.add('title-hidden');
    setTimeout(() => {
      titleEl.textContent = newLabel;
      titleEl.classList.remove('title-hidden');
      void titleEl.offsetWidth;
      titleEl.classList.add('title-entering');
      titleEl.addEventListener('animationend', () => titleEl.classList.remove('title-entering'), { once: true });
    }, 190); // fires mid-slide so text is fresh when panel arrives
  }

  currentSubSec = (name === 'settings') ? null : name;

  // ── Update nav stack
  if (isBack) {
    // Pop until we reach `name`; handles multi-level back (unlikely but safe).
    while (_subsecStack.length > 1 && _subsecStack[_subsecStack.length - 1] !== name) {
      _subsecStack.pop();
    }
  } else {
    _subsecStack.push(name);
  }

  // ── Instant swap (no animation) — first load or person-switch re-render
  if (instant || !outgoing || outgoing === target) {
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
    target.classList.add('active');
    return;
  }

  // ── Animated push / pop
  const stage = document.getElementById('sec-stage');
  const outH = outgoing.offsetHeight, inH = target.offsetHeight;
  if (stage) stage.style.height = Math.max(outH, inH) + 'px';

  const pushInClass  = isBack ? 'subsec-pop-in'   : 'subsec-push-in';
  const pushOutClass = isBack ? 'subsec-pop-out'   : 'subsec-push-out';

  // Prep: put target into the flow (positioned on top) so its height is
  // measurable but hide it off screen.
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  target.classList.add('active', 'subsec-in');
  outgoing.classList.add('subsec-out');
  if (stage) stage.classList.add('subsec-transitioning');

  // Trigger animation classes next frame so the browser sees the "before" state
  requestAnimationFrame(() => {
    outgoing.classList.add(pushOutClass);
    target.classList.add(pushInClass);

    const cleanup = () => {
      document.querySelectorAll('.sec').forEach(s => s.classList.remove(
        'subsec-in','subsec-out','subsec-push-in','subsec-push-out',
        'subsec-pop-in','subsec-pop-out'
      ));
      if (stage) { stage.classList.remove('subsec-transitioning'); stage.style.height = ''; }
    };
    target.addEventListener('animationend', cleanup, { once: true });
  });
}

// ── SWIPE-TO-NAVIGATE ─────────────────────────────────────────────────────
(function initSwipeNav() {
  const stage = document.getElementById('sec-stage');
  if (!stage) return;
  const THRESHOLD_PX = 70;
  const THRESHOLD_VEL = 0.5;
  // active   = a touch is down and we haven't bailed yet
  // decided  = we've confirmed this is a horizontal gesture and started visuals
  // bailed   = confirmed vertical scroll — ignore moves but keep active=true so onEnd is a no-op
  let active = false, decided = false, bailed = false;
  let startX = 0, startY = 0, lastX = 0, lastT = 0, vel = 0;
  let curName, curIdx, prevName, nextName, curEl, prevEl, nextEl, stageW;
  // Tracks whether a settle animation is in flight so we don't read stale tab state
  let settling = false;

  function getNeighbours() {
    curName = lastSecName;
    curIdx = secIndex(curName);
    prevName = curIdx > 0 ? SEC_ORDER[curIdx - 1] : null;
    nextName = curIdx < SEC_ORDER.length - 1 ? SEC_ORDER[curIdx + 1] : null;
    curEl = document.getElementById('sec-' + curName);
  }

  function onStart(e) {
    if (settling || lastSecName === 'settings') return;
    const t = e.touches ? e.touches[0] : e;
    startX = lastX = t.clientX; startY = t.clientY; lastT = performance.now(); vel = 0;
    active = true; decided = false; bailed = false;
    _lastDragTitle = lastSecName; // reset so first threshold-cross fires
  }

  let _savedScrollY = 0;

  function beginDragVisuals() {
    getNeighbours();
    stageW = stage.getBoundingClientRect().width;
    prevEl = prevName ? document.getElementById('sec-' + prevName) : null;
    nextEl = nextName ? document.getElementById('sec-' + nextName) : null;
    _savedScrollY = window.scrollY;
    stage.classList.add('sec-transitioning','sec-dragging');
    curEl.classList.add('active','sec-drag-cur');
    const heights = [curEl.offsetHeight];
    if (prevEl) { prevEl.classList.add('active','sec-drag-prev'); heights.push(prevEl.offsetHeight); }
    if (nextEl) { nextEl.classList.add('active','sec-drag-next'); heights.push(nextEl.offsetHeight); }
    stage.style.height = Math.max(...heights) + 'px';
    setDragX(0);
    window.scrollTo(0, _savedScrollY);
  }

  // _indSettling: when true, _updateIndicatorForDrag must NOT reset transition
  // (the settle() call has already set it and owns the animation).
  let _indSettling = false;

  function setDragX(dx) {
    if (!prevEl) dx = Math.min(dx, 0);
    if (!nextEl) dx = Math.max(dx, 0);
    curEl.style.transform = `translateX(${dx}px)`;
    if (prevEl) prevEl.style.transform = `translateX(${dx - stageW}px)`;
    if (nextEl) nextEl.style.transform = `translateX(${dx + stageW}px)`;
    _updateIndicatorForDrag(dx);
  }

  let _lastDragTitle = null; // tracks which title is currently showing during drag

  function _updateIndicatorForDrag(dx) {
    const ind = document.getElementById('bnav-indicator');
    if (!ind || !stageW) return;
    const nav = document.getElementById('bnav');
    if (!nav) return;
    const tabs = [...nav.querySelectorAll('.bnav-tab')];
    const curTabIdx = tabs.findIndex(t => t.classList.contains('active'));
    if (curTabIdx < 0) return;
    const navRect = nav.getBoundingClientRect();
    const frac = dx / stageW;

    const fromTab = tabs[curTabIdx];
    let toTab = null;
    if (frac > 0 && curTabIdx > 0) toTab = tabs[curTabIdx - 1];
    else if (frac < 0 && curTabIdx < tabs.length - 1) toTab = tabs[curTabIdx + 1];

    // Only kill the transition when we're in live-drag mode (not during settle).
    if (!_indSettling) ind.style.transition = 'none';

    if (!toTab) {
      const r = fromTab.getBoundingClientRect();
      ind.style.width = r.width + 'px';
      ind.style.transform = 'translateX(' + (r.left - navRect.left) + 'px)';
      return;
    }

    const p = Math.min(1, Math.abs(frac));
    const rFrom = fromTab.getBoundingClientRect();
    const rTo   = toTab.getBoundingClientRect();
    ind.style.width     = (rFrom.width + (rTo.width - rFrom.width) * p) + 'px';
    ind.style.transform = 'translateX(' + ((rFrom.left - navRect.left) + ((rTo.left - navRect.left) - (rFrom.left - navRect.left)) * p) + 'px)';

    // Update header title live at 50% drag threshold
    const _titleLabels = { vitals:'Vitals', log:'Log', kitchen:'Kitchen', workout:'Workout', history:'Progress' };
    const titleEl = document.getElementById('hdr-section-title');
    if (titleEl && toTab) {
      const targetName = (toTab.getAttribute('onclick')||'').match(/'(\w+)'/)?.[1];
      const showName = p > 0.5 ? targetName : curName;
      if (showName && showName !== _lastDragTitle) {
        _lastDragTitle = showName;
        titleEl.classList.add('title-hidden');
        setTimeout(() => {
          titleEl.textContent = _titleLabels[showName] || showName;
          titleEl.classList.remove('title-hidden');
        }, 150);
      }
    }
  }

  function onMove(e) {
    if (!active || bailed) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // too small to classify
      if (Math.abs(dy) > Math.abs(dx) * 1.5) { bailed = true; return; } // clearly vertical
      decided = true;
      beginDragVisuals();
    }
    const now = performance.now();
    if (now > lastT) vel = (t.clientX - lastX) / (now - lastT);
    lastX = t.clientX; lastT = now;
    if (e.cancelable) e.preventDefault();
    setDragX(dx);
  }

  function settle(target, committedDx) {
    const dur = 0.26;
    const ease = 'cubic-bezier(.4,0,.2,1)';
    const tr = `transform ${dur}s ${ease}`;
    curEl.style.transition = tr;
    if (prevEl) prevEl.style.transition = tr;
    if (nextEl) nextEl.style.transition = tr;

    // Let the indicator animate in perfect sync with the panels.
    const ind = document.getElementById('bnav-indicator');
    if (ind) {
      _indSettling = true;
      ind.style.transition = `transform ${dur}s ${ease}, width ${dur}s ${ease}`;
    }

    settling = true;
    requestAnimationFrame(() => setDragX(target));

    setTimeout(() => {
      curEl.style.transition = '';
      if (prevEl) prevEl.style.transition = '';
      if (nextEl) nextEl.style.transition = '';
      _indSettling = false;
      if (ind) ind.style.transition = '';
      settling = false;
      cleanupDragVisuals(committedDx);
    }, dur * 1000 + 20);
  }

  function cleanupDragVisuals(committedDx) {
    stage.classList.remove('sec-transitioning','sec-dragging');
    stage.style.height = '';
    [curEl, prevEl, nextEl].forEach(el => {
      if (el) { el.style.transform = ''; el.classList.remove('sec-drag-cur','sec-drag-prev','sec-drag-next'); }
    });
    if (committedDx > 0 && prevEl) finalizeNav(prevName);
    else if (committedDx < 0 && nextEl) finalizeNav(nextName);
    else { document.querySelectorAll('.sec').forEach(s => s.classList.remove('active')); curEl.classList.add('active'); }
  }

  function finalizeNav(name) {
    document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
    document.getElementById('sec-' + name).classList.add('active');
    lastSecName = name;
    // Same fix as showSec(): landing on a bottom-nav tab via swipe also
    // means we've left the Settings sub-screen stack, so clear it here too.
    currentSubSec = null;
    const tab = document.querySelector(`.bnav-tab[onclick*="'${name}'"]`);
    document.querySelectorAll('.bnav-tab').forEach(t => t.classList.remove('active'));
    if (tab) { tab.classList.add('active'); moveNavIndicator(tab); }
    const hdr = document.getElementById('main-hdr');
    if (hdr) { if (name === 'vitals') hdr.classList.remove('hdr-collapsed'); else hdr.classList.add('hdr-collapsed'); }
    // Title only needs updating if drag didn't already cross 50% and set it
    const _titleLabels = { vitals:'Vitals', log:'Log', kitchen:'Kitchen', workout:'Workout', history:'Progress' };
    const titleEl2 = document.getElementById('hdr-section-title');
    if (titleEl2 && _lastDragTitle !== name) {
      _lastDragTitle = name;
      titleEl2.classList.add('title-hidden');
      setTimeout(() => {
        titleEl2.textContent = _titleLabels[name] || name;
        titleEl2.classList.remove('title-hidden');
      }, 150);
    }
    if (name === 'kitchen') renderKitchen();
    if (name === 'history') renderProgress();
  }

  function onEnd() {
    if (!active) return;
    active = false;
    if (!decided || bailed) return;
    const dx = lastX - startX;
    const committing = Math.abs(dx) > THRESHOLD_PX || Math.abs(vel) > THRESHOLD_VEL;
    if (committing && dx > 0 && prevEl) settle(stageW, 1);
    else if (committing && dx < 0 && nextEl) settle(-stageW, -1);
    else settle(0, 0);
  }

  stage.addEventListener('touchstart', onStart, { passive: true });
  stage.addEventListener('touchmove', onMove, { passive: false });
  stage.addEventListener('touchend', onEnd);
  stage.addEventListener('touchcancel', onEnd);
  stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') onStart(e); });
  window.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') onMove(e); });
  window.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') onEnd(e); });
})();

window.addEventListener('resize', () => {
  const active = document.querySelector('.bnav-tab.active');
  if (active) moveNavIndicator(active);
});
window.addEventListener('load', () => {
  const active = document.querySelector('.bnav-tab.active');
  if (active) moveNavIndicator(active);
});
const PRESSABLE_SEL = '.btn, .ptog, .seg-opt, .kitchen-size-btn, .kitchen-tier-btn, .wk-type-btn, .meal-delete, .kitchen-picked-remove, .weight-hist-del, .trends-close, .hist-day-hdr, .user-id-toggle';
document.addEventListener('pointerdown', e => {
  const el = e.target && e.target.closest && e.target.closest(PRESSABLE_SEL);
  if (el) el.classList.add('press-fx');
});
['pointerup','pointercancel','pointerleave'].forEach(evt => {
  document.addEventListener(evt, e => {
    const el = e.target && e.target.closest && e.target.closest(PRESSABLE_SEL);
    if (el) el.classList.remove('press-fx');
  });
});

// ── PERSON TOGGLE ──────────────────────────────────────────────────────────
function setPerson(p) {
  S.currentPerson = p;
  // Legacy ptog support (any remaining instances)
  document.querySelectorAll('.ptog[data-person]').forEach(el => {
    const active = el.dataset.person === p;
    el.className = 'ptog' + (active ? (p === 'gabi' ? ' active-g' : ' active-n') : '');
  });
  // New user-id-toggle widgets — update all instances
  const primary   = p === 'gabi' ? 'Gabi' : 'Nacho';
  const secondary = p === 'gabi' ? 'Nacho' : 'Gabi';
  document.querySelectorAll('.user-id-toggle').forEach(el => {
    el.className = el.className.replace(/person-(gabi|nacho)/g, '') + ' person-' + p;
    const pr = el.querySelector('.user-id-primary, .uid-primary-m');
    const sc = el.querySelector('.user-id-secondary, .uid-secondary-m');
    if (pr) pr.textContent = primary;
    if (sc) sc.textContent = secondary;
    // Quick decisive "snap" on every switch, on every instance of the toggle.
    el.classList.remove('uid-switch-fx');
    // Force reflow so the animation restarts even if it's still mid-run.
    void el.offsetWidth;
    el.classList.add('uid-switch-fx');
    el.addEventListener('animationend', () => el.classList.remove('uid-switch-fx'), { once:true });
  });
  // Body tint
  document.body.className = document.body.className.replace(/person-(gabi|nacho)/g, '') + ' person-' + p;
  // Sub-header name pair — swap which name is "active" styled
  const nameGabi = document.getElementById('psh-name-gabi');
  const nameNacho = document.getElementById('psh-name-nacho');
  if (nameGabi && nameNacho) {
    nameGabi.className = 'psh-name ' + (p === 'gabi' ? 'psh-active-g' : 'psh-inactive');
    nameNacho.className = 'psh-name ' + (p === 'nacho' ? 'psh-active-n' : 'psh-inactive');
  }
  // Also sync the settings-screen person toggle
  const sNameGabi = document.getElementById('settings-psh-name-gabi');
  const sNameNacho = document.getElementById('settings-psh-name-nacho');
  if (sNameGabi && sNameNacho) {
    sNameGabi.className = 'psh-name ' + (p === 'gabi' ? 'psh-active-g' : 'psh-inactive');
    sNameNacho.className = 'psh-name ' + (p === 'nacho' ? 'psh-active-n' : 'psh-inactive');
  }
  // Refresh solo-mode labels to show current person name
  refreshAIAssistModeSoloLabel();
  refreshHungryModeSoloLabel();
  // Mission blocks
  renderMission();
  // History re-renders filtered
  saveLocalOnly();
  renderVitals();
  renderLogTab();
  syncFullDayCheckbox();
  syncHypoQuickBtn();
  if (currentLogMode === 'water') renderWater();
  if (currentLogMode === 'workout') renderTodayWorkouts();
  renderHistory();
  renderProgress();
  // Fix 2: if a Settings sub-screen (Profile, Targets, History, etc.) is
  // currently open, re-render it so its person-specific content (weight,
  // targets, filtered history) updates too — showSubSec() already re-runs
  // the right render function for whichever sub-screen this is.
  if (currentSubSec) showSubSec(currentSubSec, { instant: true });
}

function togglePerson() {
  setPerson(S.currentPerson === 'gabi' ? 'nacho' : 'gabi');
}

function renderMission() {
  const p = S.currentPerson || 'gabi';
  document.querySelectorAll('.mission-block[data-person]').forEach(el => {
    el.classList.toggle('visible', el.dataset.person === p);
  });
}

// Targets screen's Save button. The actual calorie/macro/weight-goal save
// logic still lives in saveMission() (defined in data.js — untouched here);
// this just additionally persists the steps-target field, which used to be
// saved by the old single Settings screen's saveSettings() and now lives on
// the Targets sub-screen instead.
function saveTargets() {
  ['gabi','nacho'].forEach(p => {
    const el = document.getElementById('set-steps-'+p);
    const st = el ? parseFloat(el.value) : NaN;
    if (!isNaN(st)) S.settings.stepGoal[p] = st;
    // Daily goals
    const wEl = document.getElementById('set-water-'+p);
    const woEl = document.getElementById('set-workouts-'+p);
    const w = wEl ? parseFloat(wEl.value) : NaN;
    const wo = woEl ? parseFloat(woEl.value) : NaN;
    if (!isNaN(w)) S.settings.waterGoal[p] = w;
    if (!isNaN(wo)) S.settings.workoutGoal[p] = wo;
  });
  saveMission();
}

function setPeriod(p) {
  S.period = p;
  ['day','week','month'].forEach(k => document.getElementById('per-'+k).classList.toggle('active', k===p));
  saveLocalOnly();
  renderVitals();
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function sum(arr, key) { return arr.reduce((a,b) => a + (parseFloat(b[key])||0), 0); }

// ── COUNT-UP NUMBER ANIMATION ────────────────────────────────────────────
// Animates a number from its currently-displayed value up (or down) to a
// target, eased the same way the bars next to it fill — so a score or
// kcal total visibly "races" into place in sync with its progress bar,
// instead of just popping to the final value.
// el: the DOM node whose textContent is the plain number (no extra markup).
// target: final integer value.
// opts.duration: ms, should match the paired bar's transition duration.
// opts.formatter: optional fn(roundedValue) -> string for custom display.
function animateCountTo(el, target, opts) {
  if (!el) return;
  const duration = (opts && opts.duration) || 500;
  const formatter = (opts && opts.formatter) || (v => String(v));
  const from = parseFloat(el.dataset.countVal !== undefined ? el.dataset.countVal : el.textContent.replace(/[^\d.-]/g,'')) || 0;
  target = Number(target) || 0;
  if (from === target) {
    el.textContent = formatter(target);
    el.dataset.countVal = target;
    return;
  }
  cancelAnimationFrame(el._countRAF);
  const start = performance.now();
  // ease-out cubic — matches the decelerating feel of the CSS "ease" bars
  const ease = t => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const val = from + (target - from) * ease(p);
    el.textContent = formatter(Math.round(val));
    if (p < 1) {
      el._countRAF = requestAnimationFrame(tick);
    } else {
      el.textContent = formatter(target);
      el.dataset.countVal = target;
    }
  }
  el._countRAF = requestAnimationFrame(tick);
}

function dateRangeFor(period) {
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  const out = [];
  for (let i=0; i<days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(toLocalDateStr(d));
  }
  return out;
}

function entriesFor(person, dates, type) {
  const set = new Set(dates);
  return S.entries.filter(e => e.person === person && set.has(e.date) && e.record_type === type);
}

// Groups all entries by "person|date" so per-day lookups don't require
// re-scanning the full S.entries array. Build once per render, then use
// .get(person+'|'+date) (returns [] if none) instead of S.entries.filter(...).
function groupEntriesByPersonDate(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = e.person + '|' + e.date;
    let bucket = map.get(k);
    if (!bucket) { bucket = []; map.set(k, bucket); }
    bucket.push(e);
  }
  return map;
}

