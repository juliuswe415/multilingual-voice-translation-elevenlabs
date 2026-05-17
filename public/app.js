import { Conversation } from "@elevenlabs/client";

let conversation = null;
let isStarting = false;

let micStream = null;
let recorder = null;
let recordedChunks = [];

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

function updateStatus(message, type = "default") {
  statusEl.textContent = `Status: ${message}`;
  statusEl.className = type;
}

function startLocalRecording(stream) {
  recordedChunks = [];

  if (!MediaRecorder.isTypeSupported("audio/webm")) {
    updateStatus("Warning: audio/webm recording may not be supported", "error");
  }

  recorder = new MediaRecorder(stream);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    if (!recordedChunks.length) return;

    const blob = new Blob(recordedChunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);

    const oldLink = document.getElementById("recordingDownloadLink");
    if (oldLink) oldLink.remove();

    const a = document.createElement("a");
    a.id = "recordingDownloadLink";
    a.href = url;
    a.download = `mic-test-${Date.now()}.webm`;
    a.textContent = "Download recorded mic audio";
    a.style.display = "block";
    a.style.marginTop = "15px";
    a.style.textAlign = "center";

    document.querySelector(".container").appendChild(a);
  };

  recorder.start();
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

    const authResponse = await fetch("/api/get-signed-url");

    if (!authResponse.ok) {
      const errorData = await authResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to get signed URL (${authResponse.status})`);
    }

    const { signedUrl } = await authResponse.json();

    if (!signedUrl) {
      throw new Error("No signed URL received");
    }

    updateStatus("Requesting microphone access...", "default");

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    startLocalRecording(micStream);

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
        stopLocalMicAndRecording();
      },

      onDisconnect: () => {
        isStarting = false;
        conversation = null;
        updateStatus("Disconnected", "default");
        startBtn.textContent = "Start Translation";
        startBtn.disabled = false;
        stopLocalMicAndRecording();
      }
    });
  } catch (error) {
    isStarting = false;
    updateStatus(`Error: ${error.message}`, "error");
    conversation = null;
    startBtn.disabled = false;
    startBtn.textContent = "Start Translation";
    stopLocalMicAndRecording();
  }
}

function stopLocalMicAndRecording() {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  recorder = null;

  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
}

async function stopConversation() {
  if (!conversation) {
    stopLocalMicAndRecording();
    return;
  }

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

    stopLocalMicAndRecording();
  } catch (error) {
    conversation = null;
    updateStatus("Translation ended", "default");
    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;

    stopLocalMicAndRecording();
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
