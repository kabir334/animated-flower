const VUDOO_CONFIG = {
  containerId: 'vudoo-app-container'
};

const sdkUrls = {
  AU: "https://vudoo.io/sdk/shoppable",
  US: "https://us.vudoo.io/sdk/shoppable",
  UK: "https://uk.vudoo.io/sdk/shoppable",
  EU: "https://eu.vudoo.io/sdk/shoppable"
};

function log(msg, obj = "") {
  console.log(`%c[SIMID DEBUG]%c ${msg}`, "color: #00ff00; font-weight: bold", "color: #fff", obj);
}

let sessionId = btoa(Math.random()).substring(0, 16);
let msgId = 1;

function send(type, args = {}, corrId = null) {
  const isProtocol = type === 'resolve' || type === 'reject' || type === 'createSession';
  const name = isProtocol ? type : 'SIMID:Creative:' + type;

  const msg = {
      sessionId: sessionId,
      messageId: msgId++,
      type: name,
      timestamp: Date.now(),
      version: "1.0",
      args: args
  };

  // For resolves, the player NEEDS the original messageId in the args
  if (corrId) {
      msg.args = { 
          messageId: corrId, // This points back to the Player's message
          value: args 
      };
  }

  // log(`>> SENDING: ${name}`, msg);
  window.parent.postMessage(JSON.stringify(msg), "*");
}
window.addEventListener('message', (e) => {
  let data;
  try { 
      data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; 
  } catch (err) { return; }
  if (!data) return;

  // Use a unified name check for both 'type' and 'messageName'
  const type = data.type || data.messageName;
  // log(`<< RECEIVED: ${type}`, data);

  /**
   * 1. THE CRITICAL FIX: Player:init
   * The player hangs here until you resolve this.
   */
  if (type === 'SIMID:Player:init') {
      log("Handshake: Resolving Player:init (Video will start now)");
      const adParams = data.args.creativeData.adParameters;
        
      if (adParams) {
          try {
              // Parse the JSON string from the XML
              const config = JSON.parse(adParams);
              console.log("Received Config from VAST:", config);
              
              // Update your global VUDOO_CONFIG with this live data
              VUDOO_CONFIG.tagId = config.tagId;
              VUDOO_CONFIG.productId = config.productId;
              VUDOO_CONFIG.region = config.region;
              log("VUDOO_CONFIG", VUDOO_CONFIG)
              
              // You can even update UI dynamically
              document.getElementById('shop-btn-entry').innerText = config.buttonText;
          } catch (e) {
              console.error("Failed to parse AdParameters", e);
          }
      }
      send('resolve', {}, data.messageId);
  } 
  
  /**
   * 2. SHOW UI: Player:startCreative
   * The player sends this once the video actually begins.
   */
  else if (type === 'SIMID:Player:startCreative') {
      // log("Handshake: Resolving Player:startCreative");
      send('resolve', {}, data.messageId);
      
      // Reveal the button only after the video is officially running
      document.getElementById('shop-btn-entry').style.display = 'block';
  }

  /**
   * 3. KEEP-ALIVE: Resolve other player messages
   * Some players require a resolve for 'resize' or 'log' to keep the ad alive.
   */
  else if (data.messageId && type.startsWith('SIMID:Player:')) {
      send('resolve', {}, data.messageId);
  }
});
// ──────────────── UI LOGIC ────────────────

const entryBtn = document.getElementById('shop-btn-entry');
const modal = document.getElementById('modal-overlay');
const closeBtn = document.getElementById('close-modal');
const container = document.getElementById(VUDOO_CONFIG.containerId);

entryBtn.onclick = async () => {
    log("Action: Pause & Load Vudoo App");
    send('requestPause'); 
    modal.style.display = 'flex';
    entryBtn.style.display = 'none';

    try {
        const container = document.getElementById(VUDOO_CONFIG.containerId);
        container.innerHTML = ''; // Clear any previous attempts

        log("Initializing Vudoo App...");

        const region = VUDOO_CONFIG.region || 'us';
        const sdkUrl = sdkUrls[region.toUpperCase()];

        log(`Loading SDK for region: ${region}...`);

        // 2. DYNAMIC IMPORT (Lazy Load)
        // This only happens once
        const {
          createShoppableApp,
          onShoppableAppClose,
          openShoppableProductPage,
          openShoppableCataloguePage,
        }= await import(sdkUrl)
        
        log("SDK Loaded successfully");
        
        // Use the instance-based approach to ensure the iframe is caught
        const app = createShoppableApp({
            tagId: VUDOO_CONFIG.tagId,
            container: container,
            region: VUDOO_CONFIG.region
        });

        // Vudoo returns an object that contains the iframe reference.
        // If the container is still empty, we manually append it.
        if (app && app.iframe) {
            container.appendChild(app.iframe);
            log("Manually appended Vudoo iframe.");
        }

        // Delay the product page open slightly to let the app initialize
        setTimeout(() => {
            log("Opening Product Page: " + VUDOO_CONFIG.productId);
            openShoppableProductPage(app, VUDOO_CONFIG.productId);
        }, 500);

    } catch (err) {
        log("Vudoo SDK Error", err);
    }
};

// 2. CLOSE MODAL & RESUME
closeBtn.onclick = () => {
  log("Action: Requesting Play & Closing Modal");
  send('requestPlay'); // Player should resume video
  modal.style.display = 'none';
  entryBtn.style.display = 'block';

  document.getElementById(VUDOO_CONFIG.containerId).innerHTML = '';
};

// 3. ITEM CLICK (Click-Thru)
window.handleItemClick = (name) => {
  log(`Action: Click-Thru for ${name}`);
  send('reportTracking', { interactionId: name });
  send('clickThru', {
      clickThruUrl: 'https://www.adidas.com',
      id: name
  });
  window.open('https://www.adidas.com', '_blank');
};

// 4. START HANDSHAKE
send('createSession');
log("Handshake: createSession sent to player.");
