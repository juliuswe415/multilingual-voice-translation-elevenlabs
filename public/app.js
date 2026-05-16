import { Conversation } from "@elevenlabs/client";

let conversation = null;
let isStarting = false;

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

function updateStatus(message, type = "default") {
  statusEl.textContent = `Status: ${message}`;
  statusEl.className = type;
}

async function startTalkingToAI() {
  if (isStarting) return;

  try {
    isStarting = true;
    startBtn.disabled = true;

    if (conversation) {
      try {
        await conversation.end();
      } catch (e) {}
      conversation = null;
    }

    updateStatus("Getting authentication...", "default");

    const authResponse = await fetch("/api/get-signed-url")

    if (!authResponse.ok) {
      const errorData = await authResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to get signed URL (${authResponse.status})`);
    }

    const { signedUrl } = await authResponse.json();

    if (!signedUrl) {
      throw new Error("No signed URL received");
    }

    updateStatus("Requesting microphone access...", "default");

    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach(track => track.stop());

    updateStatus("Connecting to Slovak → English translator...", "default");

    conversation = await Conversation.startSession({
      signedUrl,

      onConnect: () => {
        isStarting = false;
        updateStatus("Ready - Speak in Slovak, translation will be in English", "active");
        startBtn.textContent = "Stop Translation";
        startBtn.disabled = false;
      },

      onMessage: (message) => {
        updateStatus(`AI: ${message.message}`, "active");
      },

      onError: (error) => {
        isStarting = false;
        updateStatus(`Error: ${error.message || "Connection error"}`, "error");
        conversation = null;
        startBtn.textContent = "Start Translation";
        startBtn.disabled = false;
      },

      onDisconnect: () => {
        isStarting = false;
        conversation = null;
        updateStatus("Disconnected", "default");
        startBtn.textContent = "Start Translation";
        startBtn.disabled = false;
      }
    });
  } catch (error) {
    isStarting = false;
    updateStatus(`Error: ${error.message}`, "error");
    conversation = null;
    startBtn.disabled = false;
    startBtn.textContent = "Start Translation";
  }
}

async function stopConversation() {
  if (!conversation) return;

  try {
    startBtn.disabled = true;

    if (typeof conversation.end === "function") {
      await conversation.end();
    } else if (typeof conversation.endSession === "function") {
      await conversation.endSession();
    }

    conversation = null;
    updateStatus("Translation ended", "default");
    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;
  } catch (error) {
    conversation = null;
    updateStatus("Translation ended", "default");
    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", async () => {
  if (isStarting) return;

  if (conversation) {
    await stopConversation();
  } else {
    await startTalkingToAI();
  }
});
