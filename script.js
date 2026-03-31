(function() {
  let sessionId = null;
  let messageCounter = 1;

  // 1. Logic to talk to the Player
  function send(type, args = {}, correlationId = undefined) {
    const msg = {
      sessionId: sessionId,
      messageId: messageCounter++,
      messageName: type,
      timestamp: Date.now(),
      args: args
    };
    if (correlationId !== undefined) msg.correlationId = correlationId;
    window.parent.postMessage(msg, "*");
    console.log(">> TO PLAYER:", type);
  }

  // 2. Logic to listen to the Player
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || !data.messageName) return;

    console.log("<< FROM PLAYER:", data.messageName);

    if (data.sessionId) sessionId = data.sessionId;

    switch (data.messageName) {
      case 'SIMID:Player:init':
        // The IAB protocol MUST resolve init to continue
        send('SIMID:Creative:resolve', {}, data.messageId);
        break;

      case 'SIMID:Player:start':
        // The IAB protocol MUST resolve start to show the ad
        send('SIMID:Creative:resolve', {}, data.messageId);
        document.getElementById('ad-layer').style.display = 'flex';
        break;

      default:
        if (data.messageId) send('SIMID:Creative:resolve', {}, data.messageId);
        break;
    }
  });

  // 3. THE TRIGGER: This starts the whole engine
  // This is what the IAB "Survey" example does inside its constructor
  window.parent.postMessage({
    messageId: messageCounter++,
    messageName: 'SIMID:Creative:createSession',
    timestamp: Date.now(),
    args: {}
  }, "*");
})();
