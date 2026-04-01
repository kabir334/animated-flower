const VUDOO_CONFIG = {
	containerId: "vudoo-app-container",
};

const sdkUrls = {
	AU: "https://vudoo.io/sdk/shoppable",
	US: "https://us.vudoo.io/sdk/shoppable",
	UK: "https://uk.vudoo.io/sdk/shoppable",
	EU: "https://eu.vudoo.io/sdk/shoppable",
};

let CTALink = null

function log(msg, obj = "") {
	console.log(
		`%c[SIMID DEBUG]%c ${msg}`,
		"color: #00ff00; font-weight: bold",
		"color: #fff",
		obj
	);
}

let sessionId = btoa(Math.random()).substring(0, 16);
let msgId = 1;

function send(type, args = {}, corrId = null) {
	const isProtocol =
		type === "resolve" || type === "reject" || type === "createSession";
	const name = isProtocol ? type : "SIMID:Creative:" + type;

	const msg = {
		sessionId: sessionId,
		messageId: msgId++,
		type: name,
		timestamp: Date.now(),
		version: "1.0",
		args: args,
	};

	// For resolves, the player NEEDS the original messageId in the args
	if (corrId) {
		msg.args = {
			messageId: corrId, // This points back to the Player's message
			value: args,
		};
	}
	window.parent.postMessage(JSON.stringify(msg), "*");
}

window.addEventListener("message", (e) => {
	let data;
	try {
		data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
	} catch (err) {
		return;
	}
	if (!data) return;

	const type = data.type || data.messageName;
	/**
	 * 1. Handshake on Player:init
	 */
	if (type === "SIMID:Player:init") {
		log("Handshake: Resolving Player:init (Video will start now)");
		const adParams = data.args.creativeData.adParameters;

		if (adParams) {
			try {
				const config = JSON.parse(adParams);
				console.log("Received Config from VAST:", config);

				// Update your global VUDOO_CONFIG with this live data
				VUDOO_CONFIG.tagId = config.tagId;
				VUDOO_CONFIG.productId = config.productId;
				VUDOO_CONFIG.region = config.region;
        CTALink = config.CTALink
				log("VUDOO_CONFIG", VUDOO_CONFIG);

        if(config.buttonText) {
				  document.getElementById("shop-btn-entry").innerText = config.buttonText;
        }
			} catch (e) {
				console.error("Failed to parse AdParameters", e);
			}
		}
		send("resolve", {}, data.messageId);
	} else if (type === "SIMID:Player:startCreative") {

	/**
	 * 2. SHOW UI: Player:startCreative
	 * The player sends this once the video actually begins.
	 */
		send("resolve", {}, data.messageId);
		document.getElementById("shop-btn-entry").style.display = "block";
	} else if (data.messageId && type.startsWith("SIMID:Player:")) {

	/**
	 * 3. KEEP-ALIVE: Resolve other player messages
	 * Some players require a resolve for 'resize' or 'log' to keep the ad alive.
	 */
		send("resolve", {}, data.messageId);
	}
});

// ──────────────── UI LOGIC ────────────────

const entryBtn = document.getElementById("shop-btn-entry");
const modal = document.getElementById("modal-overlay");
const closeBtn = document.getElementById("close-modal");
const container = document.getElementById(VUDOO_CONFIG.containerId);

entryBtn.onclick = async () => {
	log("Action: Pause & Load Vudoo App");
	send("requestPause");
	modal.style.display = "flex";
	entryBtn.style.display = "none";

	try {
		const container = document.getElementById(VUDOO_CONFIG.containerId);
		container.innerHTML = "";

		const region = VUDOO_CONFIG.region || "us";
		const sdkUrl = sdkUrls[region.toUpperCase()];

		// 2. DYNAMIC IMPORT (Lazy Load)
		// This only happens once
		const {
			createShoppableApp,
			onShoppableAppClose,
			openShoppableProductPage,
			openShoppableCataloguePage,
		} = await import(sdkUrl);

		const app = createShoppableApp({
			tagId: VUDOO_CONFIG.tagId,
			container: container,
			region: VUDOO_CONFIG.region,
		});

		// Vudoo returns an object that contains the iframe reference.
		if (app && app.iframe) {
			container.appendChild(app.iframe);
		}

    if(VUDOO_CONFIG.productId) {
      log("Opening Product Page: " + VUDOO_CONFIG.productId);
      openShoppableProductPage(app, VUDOO_CONFIG.productId);
    } else {
      openShoppableCataloguePage(app);
    }

		onShoppableAppClose(app, () => {
			modal.style.display = "none";
			entryBtn.style.display = "block";
			send("requestPlay");
			container.innerHTML = "";
		});
	} catch (err) {
		log("Vudoo SDK Error", err);
	}
};

// 2. CLOSE MODAL & RESUME
closeBtn.onclick = () => {
	log("Action: Requesting Play & Closing Modal");
	send("requestPlay"); 
	modal.style.display = "none";
	entryBtn.style.display = "block";

	document.getElementById(VUDOO_CONFIG.containerId).innerHTML = "";
};

// 3. ITEM CLICK (Click-Thru)
window.handleItemClick = (name) => {
  if(!CTALink) {
    return;
  }
	log(`Action: Click-Thru for ${name}`);
	send("reportTracking", { interactionId: name });
	send("clickThru", {
		clickThruUrl: CTALink,
		id: name,
	});
	window.open(CTALink, "_blank");
};

// 4. START HANDSHAKE
send("createSession");
log("Handshake: createSession sent to player.");
