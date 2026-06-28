// ── SPLASH ANIMATION ───────────────────────────────────────────────────────
</script>
<script>
// Splash disabled — reveal app immediately
(function() {
  const splash = document.getElementById('splash');
  if (splash) splash.remove();
  const stage = document.getElementById('sec-stage');
  const bnav  = document.querySelector('.bnav');
  if (stage) stage.style.visibility = '';
  if (bnav)  bnav.style.visibility  = '';
})();
</script>

<script>
// ── SKY CANVAS ───────────────────────────────────────────────────────────────
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
  // Each star: { x, y, r, baseAlpha, phase, speed }
  // More stars toward top (y bias), very sparse toward bottom.
  let STARS = [];
  function buildStars() {
    const W = canvas.width  / DPR;
    const H = canvas.height / DPR;
    STARS = [];
    const N = 82; // 68 * 1.2 — total stars — subtle, not a planetarium
    // Seeded-ish: use a simple deterministic sequence so they're stable across
    // redraws but spread naturally. We borrow a tiny LCG for repeatability.
    let seed = 0x4f1bb3d2; // fresh star map
    function rnd() { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; }
    for (let i = 0; i < N; i++) {
      const x = rnd() * W;
      // Exponential bias toward top: square the random value so most stars
      // cluster in the upper ~40%, very few below 70%
      const yNorm = Math.pow(rnd(), 2.2);
      const y = yNorm * H * 0.78; // never below 78% height
      const r = 0.4 + rnd() * 0.85; // tiny — 0.4 to 1.25 px logical
      // Stars near top are brighter; fade gently toward bottom
      const baseAlpha = (0.18 + rnd() * 0.42) * (1 - yNorm * 0.6);
      const phase = rnd() * Math.PI * 2;
      // Very slow flicker: period 3–9 seconds
      const speed = (0.35 + rnd() * 0.7) * (Math.PI * 2) / (3 + rnd() * 6);
      STARS.push({ x, y, r, baseAlpha, phase, speed });
    }
    // North Star — fixed top-right, slightly brighter but still restrained
    STARS.push({
      x: W * 0.52,
      y: H * 0.28,
      r: 0.8,
      baseAlpha: 0.72,
      phase: 1.2,
      speed: (Math.PI * 2) / 11,
      northStar: true,
    });
  }

  function resize() {
    canvas.width  = window.innerWidth  * DPR;
    canvas.height = window.innerHeight * DPR;
    buildStars(); // rebuild star positions on resize
  }
  window.addEventListener('resize', () => { resize(); drawStatic(currentPerson); });
  resize();

  // Draw the dawn glow at the very bottom — Gabi only, very subtle warm mauve
  function drawDawn(alpha) {
    const W = canvas.width  / DPR;
    const H = canvas.height / DPR;
    ctx.save();
    ctx.globalAlpha = alpha * 0.38; // keep it barely there
    const dawn = ctx.createLinearGradient(0, H * 0.72, 0, H);
    dawn.addColorStop(0,   'rgba(0,0,0,0)');
    dawn.addColorStop(0.55,'rgba(58,32,52,0.18)');
    dawn.addColorStop(0.80,'rgba(88,46,68,0.28)');
    dawn.addColorStop(1.0, 'rgba(110,58,72,0.22)');
    ctx.fillStyle = dawn;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.restore();
  }

  // Draw all stars at time t (seconds), with an overall alpha multiplier
  function drawStars(alpha, t) {
    if (alpha <= 0) return;
    const W = canvas.width  / DPR;
    const H = canvas.height / DPR;
    ctx.save();
    for (const s of STARS) {
      // Gentle sine flicker — two overlapping frequencies for organic feel
      const flicker = 0.65 + 0.22 * Math.sin(s.phase + t * s.speed)
                           + 0.13 * Math.sin(s.phase * 1.7 + t * s.speed * 1.6);
      const a = s.baseAlpha * flicker * alpha;
      if (a <= 0.01) continue;

      if (s.northStar) {
        // Subtle cross/rhomboid spike glow — two thin perpendicular lines
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
          // Draw a thin needle rect along each axis
          const hw = dx ? spikeLen : 0.8; // horizontal spike: wide, narrow
          const hh = dy ? spikeLen : 0.8;
          ctx.fillRect(s.x - hw, s.y - hh, hw*2, hh*2);
        });

        // Very faint radial bloom — barely there, just touches nearby pixels
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

      // Star core (same for all stars)
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Current star alpha — 1 when Gabi, 0 when Nacho, animated during switch
  let starAlpha = 1; // initialised assuming Gabi (corrected on load)
  let starTick  = null; // rAF handle for the star flicker loop

  function startStarLoop() {
    if (starTick) return; // already running
    let loopStart = null;
    function loop(ts) {
      if (!loopStart) loopStart = ts;
      const t = (ts - loopStart) / 1000;
      if (starAlpha <= 0) { starTick = null; return; } // stop when invisible
      // Redraw the whole static frame so stars appear on top correctly
      const W = canvas.width  / DPR;
      const H = canvas.height / DPR;
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

  // Draw only the flat background gradient — always anchored at y=0, no slide.
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

  // Draw only the glow ball — yOffset slides it vertically.
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
    const W = canvas.width / DPR;
    const H = canvas.height / DPR;
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

      const W = canvas.width  / DPR;
      const H = canvas.height / DPR;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(DPR, DPR);

      // ── Background: fade only, no movement ──
      drawBg(outPerson, 1 - ease);
      drawBg(inPerson,  ease);

      // ── Glow balls: slide independently ──
      // Outgoing glow rises and exits upward
      const outGlowY = -ease * H;
      // Incoming glow enters from below
      const inGlowY  = H * (1 - ease);
      drawGlow(outPerson, 1 - ease, outGlowY);
      drawGlow(inPerson,  ease,     inGlowY);

      // ── Stars + dawn: fade out if leaving Gabi, fade in if arriving ──
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

  // Initial draw after DOM ready
  window.addEventListener('load', () => {
    currentPerson = (window.S && S.currentPerson) || 'gabi';
    starAlpha = currentPerson === 'gabi' ? 1 : 0;
    drawStatic(currentPerson);
  });
})();

// ── ANIMATED PERSON SWITCH ────────────────────────────────────────────────────
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

    // Separate concerns: removing classes vs unlocking the flag
    function removeClasses() {
      if (stage) stage.classList.remove('person-slide-out', 'person-slide-in');
    }
    function unlock() {
      removeClasses();
      switching = false;
    }
    // Safety valve — always unlock after 1.2s regardless of animationend
    const safetyTimer = setTimeout(unlock, 1200);

    // Kick off slide-out — only remove classes first, don't touch switching
    if (stage) {
      removeClasses();
      void stage.offsetWidth;
      stage.classList.add('person-slide-out');
    }

    // Midpoint: swap data, slide in
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
</script>
</body>
</html>
