'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SIMID PROTOCOL  (same three rules: stringify, UUID, session-validate)
═══════════════════════════════════════════════════════════════════ */

const ProtocolMessage = {
  CREATE_SESSION: 'createSession',
  RESOLVE:        'resolve',
  REJECT:         'reject',
};

const PlayerMessage = {
  INIT:           'Player:init',
  START_CREATIVE: 'Player:startCreative',
  AD_SKIPPED:     'Player:adSkipped',
  AD_STOPPED:     'Player:adStopped',
  FATAL_ERROR:    'Player:fatalError',
  RESIZE:         'Player:resize',
};

const MediaMessage = {
  TIME_UPDATE: 'Media:timeupdate',
  PLAY:        'Media:play',
  PAUSE:       'Media:pause',
  ENDED:       'Media:ended',
};

const CreativeMessage = {
  CLICK_THRU:      'Creative:clickThru',
  REQUEST_PAUSE:   'Creative:requestPause',
  REQUEST_PLAY:    'Creative:requestPlay',
  REQUEST_STOP:    'Creative:requestStop',
  REPORT_TRACKING: 'Creative:reportTracking',
};

const MustResolve = [
  PlayerMessage.INIT, PlayerMessage.START_CREATIVE,
  PlayerMessage.AD_SKIPPED, PlayerMessage.AD_STOPPED, PlayerMessage.FATAL_ERROR,
  CreativeMessage.REQUEST_PAUSE, CreativeMessage.REQUEST_PLAY,
  CreativeMessage.CLICK_THRU, ProtocolMessage.CREATE_SESSION,
];

class SimidProtocol {
  constructor() {
    this.listeners_           = {};
    this.resolutionListeners_ = {};
    this.sessionId_           = '';
    this.nextMessageId_       = 1;
    this.target_              = window.parent;
    window.addEventListener('message', this.receiveMessage.bind(this), false);
  }

  generateSessionId_() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b).map(v => ('0' + v.toString(16)).slice(-2));
    this.sessionId_ = [
      h.slice(0,4), h.slice(4,6), h.slice(6,8), h.slice(8,10), h.slice(10),
    ].map(s => s.join('')).join('-');
  }

  sendMessage(type, args) {
    const messageId = this.nextMessageId_++;
    const nsType = type === ProtocolMessage.CREATE_SESSION ? type : 'SIMID:' + type;
    const msg = { sessionId: this.sessionId_, messageId, type: nsType, timestamp: Date.now(), args: args || {} };

    if (MustResolve.includes(type)) {
      return new Promise((resolve, reject) => {
        this.resolutionListeners_[messageId] = { resolve, reject };
        this.target_.postMessage(JSON.stringify(msg), '*');
      });
    }
    this.target_.postMessage(JSON.stringify(msg), '*');
    return Promise.resolve();
  }

  resolve(msg, value) {
    this.target_.postMessage(JSON.stringify({
      sessionId: this.sessionId_,
      messageId: this.nextMessageId_++,
      type:      ProtocolMessage.RESOLVE,
      timestamp: Date.now(),
      args:      { messageId: msg.messageId, value: value || {} },
    }), '*');
  }

  addListener(type, cb) {
    (this.listeners_[type] = this.listeners_[type] || []).push(cb);
  }

  receiveMessage(event) {
    if (!event?.data) return;
    let d;
    try { d = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
    catch (_) { return; }
    if (!d?.type) return;

    const { sessionId, type } = d;
    const isCreating   = this.sessionId_ === '' && type === ProtocolMessage.CREATE_SESSION;
    const sessionMatch = sessionId === this.sessionId_;
    if (!isCreating && !sessionMatch) return;

    if (type === ProtocolMessage.RESOLVE || type === ProtocolMessage.REJECT) {
      const id = d.args?.messageId;
      const fn = this.resolutionListeners_[id];
      if (fn) { type === ProtocolMessage.RESOLVE ? fn.resolve(d.args.value) : fn.reject(d.args.value); delete this.resolutionListeners_[id]; }
      return;
    }

    if (type === ProtocolMessage.CREATE_SESSION) {
      this.sessionId_ = d.sessionId;
      this.resolve(d);
    }

    const specific = type.startsWith('SIMID:') ? type.slice(6) : type;
    (this.listeners_[specific] || []).forEach(cb => cb(d));
  }

  createSession() {
    this.generateSessionId_();
    this.sendMessage(ProtocolMessage.CREATE_SESSION)
      .then(() => console.log('[SIMID] session ok:', this.sessionId_))
      .catch(() => console.warn('[SIMID] session rejected'));
  }
}


/* ═══════════════════════════════════════════════════════════════════
   GAME CONFIG
═══════════════════════════════════════════════════════════════════ */

const MAX_TAPS   = 10;   // taps needed to fill the glass
const CTA_URL    = 'https://example.com/juici-order';
const SPLATS     = ['💦','🍊','✨','🫧','⚡'];

const FUN_FACTS  = [
  '🍊 One orange gives you a full day of Vitamin C!',
  '💧 Fresh juice is 88% water — stay hydrated!',
  '⚡ Natural sugars hit 3× faster than coffee!',
  '🌿 Cold-pressed juice keeps nutrients for 72 hours.',
];

const FRUITS     = ['🍊','🍋','🍇','🍓','🍍'];


/* ═══════════════════════════════════════════════════════════════════
   JUICE GAME
═══════════════════════════════════════════════════════════════════ */

class JuiceGame {
  constructor(protocol) {
    this.protocol    = protocol;
    this.taps        = 0;
    this.score       = 0;
    this.done        = false;
    this.factIndex   = 0;
    this.adDuration  = 30;
    this.factTimer   = null;

    /* DOM refs */
    this.fruitBtn     = document.getElementById('fruit-btn');
    this.fruitEmoji   = document.getElementById('fruit-emoji');
    this.badge        = document.getElementById('tap-count-badge');
    this.juiceFill    = document.getElementById('juice-fill');
    this.factBanner   = document.getElementById('fact-banner');
    this.scoreVal     = document.getElementById('score-val');
    this.tapPrompt    = document.getElementById('tap-prompt');
    this.rewardScreen = document.getElementById('reward-screen');
    this.progressBar  = document.getElementById('progress-bar');
    this.gameArea     = document.getElementById('game-area');

    this.bindSimid();
    this.bindUI();
  }

  /* ── SIMID bindings ─────────────────────────────────────────── */
  bindSimid() {
    const p = this.protocol;

    p.addListener(PlayerMessage.INIT, d => {
      this.adDuration = d.args?.environmentData?.videoDuration || 30;
      p.resolve(d);
      console.log('[Game] init, duration:', this.adDuration);
    });

    p.addListener(PlayerMessage.START_CREATIVE, d => {
      p.resolve(d);
      console.log('[Game] startCreative — game live');
    });

    p.addListener(MediaMessage.TIME_UPDATE, d => {
      const t   = d.args?.currentTime || 0;
      const dur = d.args?.duration || this.adDuration || 1;
      if (this.progressBar) this.progressBar.style.width = Math.min(100, (t / dur) * 100) + '%';
    });

    p.addListener(PlayerMessage.AD_STOPPED, d => { p.resolve(d); this.teardown(); });
    p.addListener(PlayerMessage.AD_SKIPPED, d => { p.resolve(d); this.teardown(); });
    p.addListener(PlayerMessage.FATAL_ERROR, d => { p.resolve(d); this.teardown(); });
    p.addListener(PlayerMessage.RESIZE,      () => { /* CSS handles responsive layout */ });
  }

  /* ── UI bindings ─────────────────────────────────────────────── */
  bindUI() {
    this.fruitBtn.addEventListener('click',      e => this.onTap(e));
    this.fruitBtn.addEventListener('touchstart', e => { e.preventDefault(); this.onTap(e); }, { passive: false });
    document.getElementById('cta-btn').addEventListener('click', () => this.onCTA());
  }

  /* ── Tap handler ─────────────────────────────────────────────── */
  onTap(e) {
    if (this.done) return;

    this.taps++;
    this.score += 10 + Math.floor(Math.random() * 11); // 10–20 pts per tap

    /* Squeeze animation */
    this.fruitBtn.classList.add('squeeze');
    setTimeout(() => this.fruitBtn.classList.remove('squeeze'), 150);

    /* Ripple */
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    this.fruitBtn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);

    /* Splat particles */
    this.spawnSplats(e);

    /* Update badge & score */
    this.badge.textContent = this.taps;
    this.badge.style.animation = 'none';
    requestAnimationFrame(() => { this.badge.style.animation = ''; });
    this.scoreVal.textContent = this.score;

    /* Fill glass */
    const fillPct = Math.min(100, (this.taps / MAX_TAPS) * 100);
    this.juiceFill.style.height = fillPct + '%';

    /* Swap fruit emoji every 3 taps */
    if (this.taps % 3 === 0) {
      this.fruitEmoji.textContent = FRUITS[Math.floor(Math.random() * FRUITS.length)];
    }

    /* Show fun fact every 3 taps */
    if (this.taps % 3 === 0 && this.taps < MAX_TAPS) {
      this.showFact();
    }

    /* Update prompt */
    const remaining = MAX_TAPS - this.taps;
    if (remaining > 0) {
      this.tapPrompt.textContent = remaining === 1
        ? 'One more squeeze! 🔥'
        : `${remaining} more taps to fill your glass!`;
    }

    /* Milestone tracking */
    if (this.taps === 5) {
      this.protocol.sendMessage(CreativeMessage.REPORT_TRACKING, {
        trackingUrls: ['https://example.com/track?event=halfway'],
      });
    }

    /* Win condition */
    if (this.taps >= MAX_TAPS) {
      this.done = true;
      setTimeout(() => this.showReward(), 400);
    }
  }

  /* ── Splat particles ─────────────────────────────────────────── */
  spawnSplats(e) {
    const rect = this.fruitBtn.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const count = 4 + Math.floor(Math.random() * 3);

    for (let i = 0; i < count; i++) {
      const splat = document.createElement('div');
      splat.className = 'splat';
      splat.textContent = SPLATS[Math.floor(Math.random() * SPLATS.length)];
      const angle = (Math.PI * 2 / count) * i + Math.random() * 0.8;
      const dist  = 40 + Math.random() * 50;
      splat.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      splat.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      splat.style.left = cx + 'px';
      splat.style.top  = cy + 'px';
      splat.style.position = 'fixed';
      document.body.appendChild(splat);
      setTimeout(() => splat.remove(), 700);
    }
  }

  /* ── Fun fact ────────────────────────────────────────────────── */
  showFact() {
    clearTimeout(this.factTimer);
    const fact = FUN_FACTS[this.factIndex % FUN_FACTS.length];
    this.factIndex++;
    this.factBanner.textContent = fact;
    this.factBanner.classList.add('show');
    this.factTimer = setTimeout(() => this.factBanner.classList.remove('show'), 2800);
  }

  /* ── Reward screen ───────────────────────────────────────────── */
  showReward() {
    /* Hide game area */
    this.tapPrompt.style.opacity = '0';

    /* Show reward */
    this.rewardScreen.classList.add('show');

    /* Fire confetti */
    this.launchConfetti();

    /* Tracking */
    this.protocol.sendMessage(CreativeMessage.REPORT_TRACKING, {
      trackingUrls: ['https://example.com/track?event=game_complete'],
    });

    /* Pause the video so user can read the promo */
    this.protocol.sendMessage(CreativeMessage.REQUEST_PAUSE, {})
      .catch(() => {});

    console.log('[Game] reward shown — score:', this.score);
  }

  /* ── CTA click ───────────────────────────────────────────────── */
  onCTA() {
    this.protocol.sendMessage(CreativeMessage.CLICK_THRU, {
      clickThruUrl: CTA_URL,
      id:           'order-now',
    }).then(() => window.open(CTA_URL, '_blank'))
      .catch(() => window.open(CTA_URL, '_blank'));
  }

  /* ── Confetti ────────────────────────────────────────────────── */
  launchConfetti() {
    const canvas  = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx     = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth  || window.innerWidth;
    canvas.height = canvas.offsetHeight || window.innerHeight;

    const COLORS  = ['#ff8c00','#ffe066','#ff4500','#ff6eb4','#40d080','#60a0ff'];
    const pieces  = Array.from({ length: 60 }, () => ({
      x:   Math.random() * canvas.width,
      y:   -10 - Math.random() * 100,
      r:   4 + Math.random() * 5,
      c:   COLORS[Math.floor(Math.random() * COLORS.length)],
      dx:  (Math.random() - 0.5) * 3,
      dy:  2 + Math.random() * 3,
      rot: Math.random() * Math.PI * 2,
      drot: (Math.random() - 0.5) * 0.15,
    }));

    let frame;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      pieces.forEach(p => {
        p.x   += p.dx;
        p.y   += p.dy;
        p.rot += p.drot;
        if (p.y < canvas.height + 20) alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      });
      if (alive > 0) frame = requestAnimationFrame(draw);
    };
    draw();
    setTimeout(() => cancelAnimationFrame(frame), 3500);
  }

  /* ── Teardown ────────────────────────────────────────────────── */
  teardown() {
    this.done = true;
    clearTimeout(this.factTimer);
    document.getElementById('stage').style.display = 'none';
  }
}


/* ═══════════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════════ */
const simidProtocol = new SimidProtocol();
const game          = new JuiceGame(simidProtocol);

/* All listeners registered — now kick off the session */
simidProtocol.createSession();