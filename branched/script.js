/**
 * script.js — SIMID 1.2 Creative: Travel Vibe Matcher
 *
 * Architecture:
 *  SimidProtocol  — handles all postMessage transport (exact IAB pattern)
 *  TravelCreative — business logic, UI, branching narrative
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   SIMID PROTOCOL — faithful port of IAB's simid_protocol.js
   Key rules that make IMA work:
     1. All outbound messages must be JSON.stringify'd
     2. Creative generates its own UUID session ID
     3. Only process inbound messages whose sessionId matches ours
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
  PLAY:        'Media:play',
  PAUSE:       'Media:pause',
  TIME_UPDATE: 'Media:timeupdate',
  ENDED:       'Media:ended',
};

const CreativeMessage = {
  CLICK_THRU:    'Creative:clickThru',
  REQUEST_PAUSE: 'Creative:requestPause',
  REQUEST_PLAY:  'Creative:requestPlay',
  REQUEST_STOP:  'Creative:requestStop',
  REPORT_TRACKING: 'Creative:reportTracking',
};

const EventsThatRequireResponse = [
  PlayerMessage.INIT,
  PlayerMessage.START_CREATIVE,
  PlayerMessage.AD_SKIPPED,
  PlayerMessage.AD_STOPPED,
  PlayerMessage.FATAL_ERROR,
  CreativeMessage.REQUEST_PAUSE,
  CreativeMessage.REQUEST_PLAY,
  CreativeMessage.CLICK_THRU,
  ProtocolMessage.CREATE_SESSION,
];

class SimidProtocol {
  constructor() {
    this.listeners_          = {};
    this.resolutionListeners_ = {};
    this.sessionId_          = '';
    this.nextMessageId_      = 1;
    this.target_             = window.parent;
    window.addEventListener('message', this.receiveMessage.bind(this), false);
  }

  /* Generate a v4 UUID — required by IMA for session validation */
  generateSessionId_() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b).map(v => ('0' + v.toString(16)).slice(-2));
    this.sessionId_ = [
      h.slice(0,4), h.slice(4,6), h.slice(6,8), h.slice(8,10), h.slice(10)
    ].map(s => s.join('')).join('-');
  }

  /* Send any message — MUST be JSON.stringify'd or IMA drops it */
  sendMessage(type, args) {
    const messageId = this.nextMessageId_++;
    const namespacedType = type === ProtocolMessage.CREATE_SESSION
      ? type : 'SIMID:' + type;

    const msg = {
      sessionId: this.sessionId_,
      messageId,
      type:      namespacedType,
      timestamp: Date.now(),
      args:      args || {},
    };

    if (EventsThatRequireResponse.includes(type)) {
      return new Promise((resolve, reject) => {
        this.resolutionListeners_[messageId] = { resolve, reject };
        this.target_.postMessage(JSON.stringify(msg), '*');
      });
    }

    this.target_.postMessage(JSON.stringify(msg), '*');
    return Promise.resolve();
  }

  resolve(incomingMsg, value) {
    this.target_.postMessage(JSON.stringify({
      sessionId: this.sessionId_,
      messageId: this.nextMessageId_++,
      type:      ProtocolMessage.RESOLVE,
      timestamp: Date.now(),
      args:      { messageId: incomingMsg.messageId, value: value || {} },
    }), '*');
  }

  reject(incomingMsg, value) {
    this.target_.postMessage(JSON.stringify({
      sessionId: this.sessionId_,
      messageId: this.nextMessageId_++,
      type:      ProtocolMessage.REJECT,
      timestamp: Date.now(),
      args:      { messageId: incomingMsg.messageId, value: value || {} },
    }), '*');
  }

  addListener(type, cb) {
    (this.listeners_[type] = this.listeners_[type] || []).push(cb);
  }

  receiveMessage(event) {
    if (!event || !event.data) return;
    let d;
    try { d = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
    catch (_) { return; }
    if (!d || !d.type) return;

    const { sessionId, type } = d;

    /* Session validation — only process ours or the resolve/reject to createSession */
    const isCreating   = this.sessionId_ === '' && type === ProtocolMessage.CREATE_SESSION;
    const sessionMatch = sessionId === this.sessionId_;
    if (!isCreating && !sessionMatch) return;

    /* Protocol-level: resolve / reject to our outbound messages */
    if (type === ProtocolMessage.RESOLVE || type === ProtocolMessage.REJECT) {
      const correlatingId = d.args && d.args.messageId;
      const listener = this.resolutionListeners_[correlatingId];
      if (listener) {
        type === ProtocolMessage.RESOLVE
          ? listener.resolve(d.args.value)
          : listener.reject(d.args.value);
        delete this.resolutionListeners_[correlatingId];
      }
      return;
    }

    /* SIMID namespaced messages */
    if (type === ProtocolMessage.CREATE_SESSION) {
      this.sessionId_ = d.sessionId;
      this.resolve(d);
    }

    const specificType = type.startsWith('SIMID:') ? type.slice(6) : type;
    (this.listeners_[specificType] || []).forEach(cb => cb(d));
  }

  createSession() {
    this.generateSessionId_();
    this.sendMessage(ProtocolMessage.CREATE_SESSION)
      .then(() => console.log('[SIMID] session established:', this.sessionId_))
      .catch(() => console.warn('[SIMID] session rejected'));
  }
}


/* ═══════════════════════════════════════════════════════════════════
   TRAVEL CREATIVE — branching narrative logic
═══════════════════════════════════════════════════════════════════ */

const DEALS = {
  city: [
    { dest: '🗼 Tokyo',       price: 'From $420 return', url: 'https://example.com/tokyo' },
    { dest: '🗽 New York',    price: 'From $380 return', url: 'https://example.com/nyc'   },
  ],
  nature: [
    { dest: '🌴 Bali',        price: 'From $510 return', url: 'https://example.com/bali'    },
    { dest: '🧊 Iceland',     price: 'From $490 return', url: 'https://example.com/iceland' },
  ],
};

class TravelCreative {
  constructor(protocol) {
    this.protocol        = protocol;
    this.pauseTriggered  = false;
    this.choiceMade      = false;
    this.adDuration      = 30;

    this.overlay  = document.getElementById('choice-overlay');
    this.sidebar  = document.getElementById('sidebar');
    this.progress = document.getElementById('progress-bar');

    this.bindSimidEvents();
    this.bindUIEvents();
  }

  /* ── SIMID event bindings ─────────────────────────────────────── */
  bindSimidEvents() {
    const p = this.protocol;

    p.addListener(PlayerMessage.INIT, (d) => {
      const env = d.args?.environmentData || {};
      this.adDuration = env.videoDuration || 30;
      console.log('[Creative] Player:init — duration:', this.adDuration);
      p.resolve(d);
    });

    p.addListener(PlayerMessage.START_CREATIVE, (d) => {
      console.log('[Creative] Player:startCreative — ad running');
      p.resolve(d);
    });

    p.addListener(MediaMessage.TIME_UPDATE, (d) => {
      const t   = d.args?.currentTime || 0;
      const dur = d.args?.duration || this.adDuration || 1;

      /* Progress bar */
      if (this.progress) {
        this.progress.style.width = Math.min(100, (t / dur) * 100) + '%';
      }

      /* Branch point at 4 seconds */
      if (!this.pauseTriggered && !this.choiceMade && t >= 4) {
        this.pauseTriggered = true;
        this.showChoiceOverlay();
      }
    });

    p.addListener(MediaMessage.PLAY, () => {
      console.log('[Creative] Media:play');
    });

    p.addListener(MediaMessage.PAUSE, () => {
      console.log('[Creative] Media:pause');
    });

    p.addListener(PlayerMessage.RESIZE, (d) => {
      /* Layout is fully responsive via CSS — nothing to do except log */
      console.log('[Creative] Player:resize', d.args);
    });

    p.addListener(PlayerMessage.AD_STOPPED, (d) => {
      p.resolve(d);
      this.teardown();
    });

    p.addListener(PlayerMessage.AD_SKIPPED, (d) => {
      p.resolve(d);
      this.teardown();
    });

    p.addListener(PlayerMessage.FATAL_ERROR, (d) => {
      p.resolve(d);
      this.teardown();
    });
  }

  /* ── UI event bindings ────────────────────────────────────────── */
  bindUIEvents() {
    document.getElementById('btn-city').addEventListener('click', () => {
      this.onChoice('city');
    });
    document.getElementById('btn-nature').addEventListener('click', () => {
      this.onChoice('nature');
    });
    document.getElementById('sidebar-close').addEventListener('click', () => {
      this.sidebar.classList.remove('open');
    });
  }

  /* ── Show the decision overlay ────────────────────────────────── */
  showChoiceOverlay() {
    /* Ask player to pause video */
    this.protocol.sendMessage(CreativeMessage.REQUEST_PAUSE, {})
      .then(() => console.log('[Creative] video paused for choice'))
      .catch(() => console.warn('[Creative] pause rejected — continuing anyway'));

    this.overlay.classList.add('visible');
    console.log('[Creative] choice overlay shown at 4s');
  }

  /* ── Handle a choice ──────────────────────────────────────────── */
  onChoice(vibe) {
    if (this.choiceMade) return;
    this.choiceMade = true;

    console.log('[Creative] user chose:', vibe);

    /* Hide choice overlay */
    this.overlay.classList.remove('visible');

    /* Report tracking */
    this.protocol.sendMessage(CreativeMessage.REPORT_TRACKING, {
      trackingUrls: [`https://example.com/track?event=vibe_choice&vibe=${vibe}`],
    });

    /* Resume video */
    this.protocol.sendMessage(CreativeMessage.REQUEST_PLAY, {})
      .then(() => console.log('[Creative] video resumed'))
      .catch(() => console.warn('[Creative] play rejected'));

    /* Build and slide in the sidebar */
    this.buildSidebar(vibe);
  }

  /* ── Build sidebar content ────────────────────────────────────── */
  buildSidebar(vibe) {
    const isCity = vibe === 'city';

    /* Theme */
    this.sidebar.className = isCity ? 'city-theme' : 'nature-theme';

    /* Title */
    document.getElementById('sidebar-title').textContent = isCity
      ? '🌆 City Escapes'
      : '🌿 Wild Retreats';

    /* Deal cards */
    const container = document.getElementById('deals-container');
    container.innerHTML = '';

    DEALS[vibe].forEach(deal => {
      const card = document.createElement('div');
      card.className = 'deal-card';
      card.innerHTML = `
        <div class="deal-dest">${deal.dest}</div>
        <div class="deal-price">${deal.price}</div>
        <button class="book-btn">Book Now →</button>
      `;
      card.querySelector('.book-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.onBookNow(deal);
      });
      card.addEventListener('click', () => this.onBookNow(deal));
      container.appendChild(card);
    });

    /* Slide in */
    requestAnimationFrame(() => {
      this.sidebar.classList.add('open');
    });
  }

  /* ── Book Now → clickThru ─────────────────────────────────────── */
  onBookNow(deal) {
    console.log('[Creative] clickThru →', deal.url);
    this.protocol.sendMessage(CreativeMessage.CLICK_THRU, {
      clickThruUrl: deal.url,
      id:           'deal-' + deal.dest,
    }).then(() => {
      window.open(deal.url, '_blank');
    }).catch(() => {
      window.open(deal.url, '_blank');
    });
  }

  /* ── Clean up ─────────────────────────────────────────────────── */
  teardown() {
    this.overlay.classList.remove('visible');
    this.sidebar.classList.remove('open');
    document.getElementById('stage').style.display = 'none';
  }
}


/* ═══════════════════════════════════════════════════════════════════
   BOOTSTRAP
═══════════════════════════════════════════════════════════════════ */
const simidProtocol = new SimidProtocol();
const creative      = new TravelCreative(simidProtocol);

/*
 * createSession() must be called last, synchronously, after all
 * listeners are registered. This sends `createSession` to the player
 * which triggers Player:init. If listeners aren't attached first,
 * the init message arrives before we can handle it.
 */
simidProtocol.createSession();