// ════════════════════════════════════════════════════════════════════════
// LOG FAB ANIMATION — standalone, independent module.
// To remove entirely: delete this <script> tag from index.html (and the
// matching log-fab-anim.css <link>). Nothing else in the app calls into
// this file or depends on it — it only listens, it never gets called.
//
// Why a capture-phase listener instead of editing showSec()/onclick:
// the bottom-nav "+" button's existing onclick="showSec('log',this)" is
// left completely untouched. We attach our own listener on the SAME
// element in the CAPTURE phase, which always runs first regardless of
// listener order, so this fires before showSec() does anything. We never
// call showSec() ourselves and never preventDefault/stopPropagation it —
// we just run alongside it. If this file is deleted, showSec() keeps
// working exactly as before (normal slide), nothing breaks.
// ════════════════════════════════════════════════════════════════════════

(function () {
  function spawnLogFabOverlay(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Size the circle so its scale(1) state comfortably covers the full
    // viewport diagonal from the button's position.
    const dx = Math.max(cx, window.innerWidth - cx);
    const dy = Math.max(cy, window.innerHeight - cy);
    const radius = Math.sqrt(dx * dx + dy * dy);
    const diameter = radius * 2;

    let overlay = document.getElementById('log-fab-overlay');
    if (overlay) overlay.remove(); // clear any leftover from a rapid re-tap

    overlay = document.createElement('div');
    overlay.id = 'log-fab-overlay';
    overlay.style.left = cx + 'px';
    overlay.style.top = cy + 'px';
    overlay.style.width = diameter + 'px';
    overlay.style.height = diameter + 'px';
    document.body.appendChild(overlay);

    // Force layout so the browser registers the start state before we
    // add the class that kicks off the animation (otherwise it can skip
    // straight to the end state with no visible transition).
    void overlay.offsetWidth;
    overlay.classList.add('log-fab-run');

    overlay.addEventListener('animationend', () => {
      overlay.remove();
    }, { once: false });
    // Safety net in case animationend doesn't fire for any reason
    // (e.g. tab backgrounded mid-animation).
    setTimeout(() => { if (overlay && overlay.parentNode) overlay.remove(); }, 1200);
  }

  function initLogFabAnim() {
    const logTab = document.querySelector('.bnav-tab[onclick*="showSec(\'log\'"]');
    if (!logTab) return;
    logTab.addEventListener('click', () => {
      spawnLogFabOverlay(logTab.querySelector('.bnav-log-icon') || logTab);
    }, { capture: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogFabAnim);
  } else {
    initLogFabAnim();
  }
})();
