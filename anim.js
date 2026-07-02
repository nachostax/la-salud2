// ════════════════════════════════════════════════════════════════════════
// ANIM.JS — all JS-driven animation logic lives here, in one place.
// Pairs with anim.css, which holds the keyframes these functions key off.
// Loaded after ui.js (so setPerson/togglePerson/showSec already exist) and
// after the bottom nav markup is in the DOM.
//
// Sections:
//   1. Sky canvas — background gradient + stars, person-switch crossfade
//   2. Person switch orchestration — patches togglePerson() to drive the
//      #sec-stage slide (anim.css) in sync with the sky crossfade
//   3. Log FAB overlay — expanding circle spawned on tapping "+"
// ════════════════════════════════════════════════════════════════════════

// ── 1. SKY CANVAS ──────────────────────────────────────────────────────────
(function initSky() {
  const canvas = document.getElementById('sky-canvas');
  if (!canvas) return;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const ctx  = canvas.getContext('2d');

  // Gabi: deep night blue, faint cool moonlight glow top-right
  // Nacho: deep dark brown, faint warm amber glow top-right
  const THEMES = {
    gabi: {
      // 24 stops: deep night navy, very subtle lightening toward bottom
      bg: [
        '#07090f','#07091100','#08091200','#080a1300',
        '#080a1400','#090b1500','#090b1600','#090c1700',
        '#090c1800','#0a0d1900','#0a0d1a00','#0a0e1b00',
        '#0a0e1c00','#0b0f1d00','#0b0f1d00','#0b101e00',
        '#0c101f00','#0c112000','#0c112100','#0d122200',
        '#0d122200','#0d132300','#0e132400','#0e1424',
      ].map(c => c.replace(/00$/, '')),  // strip accidental zeros
      glow:      [80, 125, 175],
      glowAlpha: 0.32,
    },
    nacho: {
      // 24 stops: very deep warm dark brown, barely perceptible warmth
      bg: [
        '#0c0906','#0d0a07','#0e0a07','#0f0b08',
        '#0f0b08','#100c09','#110c09','#110d0a',
        '#120d0a','#120e0b','#130e0b','#130f0c',
        '#140f0c','#14100d','#15100d','#15110e',
        '#16110e','#16120f','#17120f','#171310',
        '#181310','#181411','#191411','#1a1512',
      ],
      glow:      [200, 138, 60],
      glowAlpha: 0.30,
    },
  };

  let currentPerson = 'gabi';

  // ── STARS — generated once, stable positions, Gabi only ──────────────────
  let STARS = [];
  function buildStars() {
    const W = canvas.width  / DPR;
    const H = canvas.height / DPR;
    STARS = [];
    const N = 82;
    let seed = 0x4f1bb3d2;
    function rnd() { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; }
    for (let i = 0; i < N; i++) {
      const x = rnd() * W;
      const yNorm = Math.pow(rnd(), 2.2);
      const y = yNorm * H * 0.78;
      const r = 0.4 + rnd() * 0.85;
      const baseAlpha = (0.18 + rnd() * 0.42) * (1 - yNorm * 0.6);
      const phase = rnd() * Math.PI * 2;
      const speed = (0.35 + rnd() * 0.7) * (Math.PI * 2) / (3 + rnd() * 6);
      STARS.push({ x, y, r, baseAlpha, phase, speed });
    }
    STARS.push({
      x: W * 0.52, y: H * 0.28, r: 0.8, baseAlpha: 0.72,
      phase: 1.2, speed: (Math.PI * 2) / 11, northStar: true,
    });
  }

  function resize() {
    canvas.width  = window.innerWidth  * DPR;
    canvas.height = window.innerHeight * DPR;
    buildStars();
  }
  window.addEventListener('resize', () => { resize(); drawStatic(currentPerson); });
  resize();

  function drawDawn(alpha) {
    const W = canvas.width  / DPR;
    const H = canvas.height / DPR;
    ctx.save();
    ctx.globalAlpha = alpha * 0.38;
    const dawn = ctx.createLinearGradient(0, H * 0.72, 0, H);
    dawn.addColorStop(0,   'rgba(0,0,0,0)');
    dawn.addColorStop(0.55,'rgba(58,32,52,0.18)');
    dawn.addColorStop(0.80,'rgba(88,46,68,0.28)');
    dawn.addColorStop(1.0, 'rgba(110,58,72,0.22)');
    ctx.fillStyle = dawn;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.restore();
  }

  function drawStars(alpha, t) {
    if (alpha <= 0) return;
    ctx.save();
    for (const s of STARS) {
      const flicker = 0.65 + 0.22 * Math.sin(s.phase + t * s.speed)
                           + 0.13 * Math.sin(s.phase * 1.7 + t * s.speed * 1.6);
      const a = s.baseAlpha * flicker * alpha;
      if (a <= 0.01) continue;

      if (s.northStar) {
        const spikeLen = 8 + 2 * Math.sin(s.phase + t * s.speed);
        const spikeA = a * 0.19;
        [[1,0],[0,1]].forEach(([dx, dy]) => {
          const sg = ctx.createLinearGradient(
            s.x - dx*spikeLen, s.y - dy*spikeLen,
            s.x + dx*spikeLen, s.y + dy*spikeLen
          );
          sg.addColorStop(0,    'rgba(170,200,255,0)');
          sg.addColorStop(0.38, `rgba(185,215,255,${(spikeA*0.5).toFixed(3)})`);
          sg.addColorStop(0.5,  `rgba(200,225,255,${spikeA.toFixed(3)})`);
          sg.addColorStop(0.62, `rgba(185,215,255,${(spikeA*0.5).toFixed(3)})`);
          sg.addColorStop(1,    'rgba(170,200,255,0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = sg;
          const hw = dx ? spikeLen : 0.8;
          const hh = dy ? spikeLen : 0.8;
          ctx.fillRect(s.x - hw, s.y - hh, hw*2, hh*2);
        });

        const haloR = 7 + 1.5 * Math.sin(s.phase + t * s.speed);
        const halo = ctx.createRadialGradient(s.x, s.y, s.r * 1.2, s.x, s.y, haloR);
        halo.addColorStop(0,   `rgba(190,215,255,${(a * 0.15).toFixed(3)})`);
        halo.addColorStop(1,   'rgba(160,195,255,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  let starAlpha = 1;
  let starTick  = null;

  function startStarLoop() {
    if (starTick) return;
    let loopStart = null;
    function loop(ts) {
      if (!loopStart) loopStart = ts;
      const t = (ts - loopStart) / 1000;
      if (starAlpha <= 0) { starTick = null; return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(DPR, DPR);
      drawBg(currentPerson, 1);
      drawGlow(currentPerson, 1, 0);
      if (starAlpha > 0) {
        drawDawn(starAlpha);
        drawStars(starAlpha, t);
      }
      ctx.restore();
      starTick = requestAnimationFrame(loop);
    }
    starTick = requestAnimationFrame(loop);
  }

  function stopStarLoop() {
    if (starTick) { cancelAnimationFrame(starTick); starTick = null; }
  }

  function drawBg(person, alpha) {
    const th = THEMES[person];
    const W  = canvas.width / DPR;
    const H  = canvas.height / DPR;
    ctx.save();
    ctx.globalAlpha = alpha;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    const stops = [
      [0.00, th.bg[0]],  [0.04, th.bg[1]],  [0.08, th.bg[2]],
      [0.12, th.bg[3]],  [0.17, th.bg[4]],  [0.22, th.bg[5]],
      [0.27, th.bg[6]],  [0.32, th.bg[7]],  [0.37, th.bg[8]],
      [0.42, th.bg[9]],  [0.47, th.bg[10]], [0.52, th.bg[11]],
      [0.57, th.bg[12]], [0.62, th.bg[13]], [0.67, th.bg[14]],
      [0.72, th.bg[15]], [0.77, th.bg[16]], [0.82, th.bg[17]],
      [0.87, th.bg[18]], [0.91, th.bg[19]], [0.94, th.bg[20]],
      [0.97, th.bg[21]], [0.99, th.bg[22]], [1.00, th.bg[23]],
    ];
    stops.forEach(([s, c]) => bg.addColorStop(s, c));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawGlow(person, alpha, yOffset) {
    const th = THEMES[person];
    const W  = canvas.width / DPR;
    const H  = canvas.height / DPR;
    const oy = yOffset || 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    const [r, g, b] = th.glow;
    const cx     = W  * 1.35;
    const cy     = oy + H * 0.28;
    const radius = H  * 1.3;
    const glow   = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    [[0.00,1.00],[0.06,0.95],[0.12,0.86],[0.20,0.72],[0.28,0.56],
     [0.38,0.38],[0.48,0.22],[0.58,0.12],[0.68,0.06],[0.78,0.02],
     [0.90,0.005],[1.00,0]
    ].forEach(([s, a]) => {
      glow.addColorStop(s, `rgba(${r},${g},${b},${(th.glowAlpha * a).toFixed(4)})`);
    });
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawStatic(person) {
    stopStarLoop();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(DPR, DPR);
    drawBg(person, 1);
    drawGlow(person, 1, 0);
    if (person === 'gabi') {
      starAlpha = 1;
      drawDawn(1);
      drawStars(1, 0);
      startStarLoop();
    } else {
      starAlpha = 0;
    }
    ctx.restore();
  }

  window._skyDrawStatic = function(person) {
    currentPerson = person;
    drawStatic(person);
  };

  // Animate:
  //   Background — pure crossfade, both anchored at y=0, no slide.
  //   Glow ball  — outgoing slides UP off screen, incoming rises from below.
  //   Stars/dawn — fade in when arriving at Gabi, fade out when leaving.
  window.animateSkySwitch = function(outPerson, inPerson) {
    stopStarLoop();
    currentPerson = inPerson;
    const DURATION = 1050;
    let start = null;
    let loopT = 0;
    let lastTs = null;
    function frame(ts) {
      if (!start) { start = ts; lastTs = ts; }
      const dt = (ts - lastTs) / 1000;
      loopT += dt;
      lastTs = ts;
      const p    = Math.min((ts - start) / DURATION, 1);
      const ease = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2, 3)/2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(DPR, DPR);

      const H = canvas.height / DPR;

      drawBg(outPerson, 1 - ease);
      drawBg(inPerson,  ease);

      const outGlowY = -ease * H;
      const inGlowY  = H * (1 - ease);
      drawGlow(outPerson, 1 - ease, outGlowY);
      drawGlow(inPerson,  ease,     inGlowY);

      if (outPerson === 'gabi') {
        starAlpha = 1 - ease;
        drawDawn(starAlpha);
        drawStars(starAlpha, loopT);
      } else if (inPerson === 'gabi') {
        starAlpha = ease;
        drawDawn(starAlpha);
        drawStars(starAlpha, loopT);
      }

      ctx.restore();

      if (p < 1) requestAnimationFrame(frame);
      else drawStatic(inPerson);
    }
    requestAnimationFrame(frame);
  };

  window.addEventListener('load', () => {
    currentPerson = (window.S && S.currentPerson) || 'gabi';
    starAlpha = currentPerson === 'gabi' ? 1 : 0;
    drawStatic(currentPerson);
  });
})();

// ── 2. PERSON SWITCH ORCHESTRATION ───────────────────────────────────────
// Patches togglePerson() (originally defined in ui.js as a thin wrapper
// around setPerson()) so that toggling also drives the sky crossfade above
// and the #sec-stage slide-out/slide-in (keyframes in anim.css). The
// underlying setPerson() data-swap logic in ui.js is untouched — we only
// wrap the toggle entry point, not the state-setting function itself.
(function patchTogglePerson() {
  const _original = window.setPerson;
  if (!_original) return;

  let switching = false;

  window.togglePerson = function() {
    if (switching) return;
    switching = true;

    const outPerson = S.currentPerson || 'gabi';
    const inPerson  = outPerson === 'gabi' ? 'nacho' : 'gabi';
    const stage     = document.getElementById('sec-stage');

    // Sky crossfades
    if (window.animateSkySwitch) window.animateSkySwitch(outPerson, inPerson);

    function removeClasses() {
      if (stage) stage.classList.remove('person-slide-out', 'person-slide-in');
    }
    function unlock() {
      removeClasses();
      switching = false;
    }
    const safetyTimer = setTimeout(unlock, 1200);

    if (stage) {
      removeClasses();
      void stage.offsetWidth;
      stage.classList.add('person-slide-out');
    }

    setTimeout(() => {
      _original(inPerson);
      if (stage) {
        stage.classList.remove('person-slide-out');
        void stage.offsetWidth;
        stage.classList.add('person-slide-in');
        stage.addEventListener('animationend', () => {
          clearTimeout(safetyTimer);
          unlock();
        }, { once: true });
      } else {
        clearTimeout(safetyTimer);
        unlock();
      }
    }, 480);
  };
})();

// ── 3. LOG FAB OVERLAY ───────────────────────────────────────────────────
// Tapping the "+" (Log tab) spawns a plain circle overlay (NOT the SVG
// icon itself) that expands while fading out on its own timeline (anim.css)
// — so it visibly "fills" partway before dissolving.
//
// Why a capture-phase listener instead of editing showSec()/onclick: the
// bottom-nav "+" button's existing onclick="showSec('log',this)" (set in
// index.html) is left completely untouched. We attach our own listener on
// the SAME element in the CAPTURE phase, which always runs first
// regardless of listener order, so this fires before showSec() does
// anything. We never call showSec() ourselves and never
// preventDefault/stopPropagation it — we just run alongside it. If this
// section is deleted, showSec() keeps working exactly as before (normal
// slide), nothing breaks.
(function initLogFabAnim() {
  function spawnLogFabOverlay(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Size the circle so its scale(1) state reaches roughly 65% of the
    // way to the farthest viewport edge — not the full diagonal. Combined
    // with the fade finishing before the expand (see anim.css), this
    // means the circle visibly dissolves before it would reach the edge
    // of the screen, instead of growing edge-to-edge while still opaque.
    const dx = Math.max(cx, window.innerWidth - cx);
    const dy = Math.max(cy, window.innerHeight - cy);
    const radius = Math.sqrt(dx * dx + dy * dy) * 0.65;
    const diameter = radius * 2;

    let overlay = document.getElementById('log-fab-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'log-fab-overlay';
    overlay.style.left = cx + 'px';
    overlay.style.top = cy + 'px';
    overlay.style.width = diameter + 'px';
    overlay.style.height = diameter + 'px';
    document.body.appendChild(overlay);

    void overlay.offsetWidth;
    overlay.classList.add('log-fab-run');

    overlay.addEventListener('animationend', () => {
      overlay.remove();
    }, { once: false });
    setTimeout(() => { if (overlay && overlay.parentNode) overlay.remove(); }, 1200);
  }

  function init() {
    const logTab = document.querySelector('.bnav-tab[onclick*="showSec(\'log\'"]');
    if (!logTab) return;
    logTab.addEventListener('click', () => {
      const secLog = document.getElementById('sec-log');
      if (secLog && secLog.classList.contains('active')) return;
      spawnLogFabOverlay(logTab.querySelector('.bnav-log-icon') || logTab);
    }, { capture: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
