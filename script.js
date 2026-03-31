class SIMIDCreative {
  constructor() {
    this.sessionId = null;

    window.addEventListener("message", (e) => this.handleMessage(e));
  }

  sendMessage(type, data = {}) {
    parent.postMessage({
      type,
      sessionId: this.sessionId,
      data
    }, "*");
  }

  handleMessage(event) {
    const msg = event.data;

    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "SIMID:Creative:init":
        this.sessionId = msg.sessionId;

        // Tell player we're ready
        this.sendMessage("SIMID:Creative:ready");
        break;

      case "SIMID:Player:startCreative":
        this.startAd();
        break;

      case "SIMID:Media:timeupdate":
        this.startAd();
        break;

      case "SIMID:Player:pause":
        console.log("Paused");
        break;

      case "SIMID:Player:resume":
        console.log("Resumed");
        break;

      case "SIMID:Player:stopCreative":
        this.stopAd();
        break;
    }
  }

  startAd() {
    console.log("Ad started");

    // Show UI
    document.getElementById("overlay").style.display = "flex";
  }

  stopAd() {
    console.log("Ad stopped");
  }

  clickThrough() {
    this.sendMessage("SIMID:Player:openClickThrough", {
      url: "https://google.com"
    });
  }
}

// Init
window.simidCreative = new SIMIDCreative();
