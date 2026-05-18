let ws = null;
let micStream = null;
let recorder = null;
let recordedChunks = [];

let audioCtx = null;
let workletNode = null;

let outputCtx = null;
let nextPlayTime = 0;

let isRunning = false;
let isAgentSpeaking = false;
let agentSpeakingTimeout = null;

const SAMPLE_RATE_OUT = 16000;
const CHUNK_SAMPLES = 1600;

const THRESHOLD_IDLE = 0.002;
const THRESHOLD_AGENT_SPEAKING = 0.04;

let pcmBuffer = [];

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

const debugLogEl = document.getElementById("debugLog");

let debugCounter = 0;

function debugLog(message) {
  if (!debugLogEl) return;

  debugCounter++;

  debugLogEl.textContent =
    `[${debugCounter}] ${message}\n` +
    debugLogEl.textContent;

  const lines = debugLogEl.textContent
    .split("\n")
    .slice(0, 25);

  debugLogEl.textContent = lines.join("\n");
}

function updateStatus(message, type = "default") {
  statusEl.textContent = `Status: ${message}`;
  statusEl.className = type;
}

function getEchoMode() {
  return document.querySelector(
    'input[name="echoMode"]:checked'
  )?.value || "threshold";
}

function calculateRMS(floatSamples) {
  let sum = 0;

  for (let i = 0; i < floatSamples.length; i++) {
    sum += floatSamples[i] * floatSamples[i];
  }

  return Math.sqrt(sum / floatSamples.length);
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i++) {
    let sample = Math.max(-1, Math.min(1, float32Array[i]));

    view.setInt16(
      i * 2,
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff,
      true
    );
  }

  return new Uint8Array(buffer);
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunkSize)
    );
  }

  return btoa(binary);
}

function downsampleTo16k(input, inputSampleRate) {
  if (inputSampleRate === SAMPLE_RATE_OUT) {
    return input;
  }

  const ratio = inputSampleRate / SAMPLE_RATE_OUT;

  const outputLength = Math.floor(input.length / ratio);

  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = Math.floor(i * ratio);
    output[i] = input[sourceIndex];
  }

  return output;
}

function sendPcmChunk(floatSamples) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const echoMode = getEchoMode();

  if (isAgentSpeaking && echoMode === "mute") {
    return;
  }

  if (echoMode === "threshold") {
    const rms = calculateRMS(floatSamples);

    const threshold = isAgentSpeaking
      ? THRESHOLD_AGENT_SPEAKING
      : THRESHOLD_IDLE;

    debugLog(
      `RMS=${rms.toFixed(5)} threshold=${threshold} speaking=${isAgentSpeaking}`
    );

    if (rms < threshold) {
      return;
    }
  }

  const pcm16 = floatTo16BitPCM(floatSamples);

  const base64Audio = arrayBufferToBase64(
    pcm16.buffer
  );

  ws.send(JSON.stringify({
    user_audio_chunk: base64Audio
  }));
}

function handleInputSamples(samples, inputSampleRate) {
  const downsampled = downsampleTo16k(
    samples,
    inputSampleRate
  );

  for (const sample of downsampled) {
    pcmBuffer.push(sample);

    if (pcmBuffer.length >= CHUNK_SAMPLES) {
      const chunk = new Float32Array(
        pcmBuffer.slice(0, CHUNK_SAMPLES)
      );

      pcmBuffer = pcmBuffer.slice(CHUNK_SAMPLES);

      sendPcmChunk(chunk);
    }
  }
}

function playPcm16Base64(base64Audio) {
  isAgentSpeaking = true;

  const binary = atob(base64Audio);

  const byteLength = binary.length;

  const bytes = new Uint8Array(byteLength);

  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const sampleCount = bytes.length / 2;

  const floatSamples = new Float32Array(sampleCount);

  const view = new DataView(bytes.buffer);

  for (let i = 0; i < sampleCount; i++) {
    floatSamples[i] =
      view.getInt16(i * 2, true) / 32768;
  }

  if (!outputCtx) {
    outputCtx = new AudioContext();
    nextPlayTime = outputCtx.currentTime;
  }

  const audioBuffer = outputCtx.createBuffer(
    1,
    sampleCount,
    SAMPLE_RATE_OUT
  );

  audioBuffer.copyToChannel(floatSamples, 0);

  const source = outputCtx.createBufferSource();

  source.buffer = audioBuffer;

  source.connect(outputCtx.destination);

  const startTime = Math.max(
    outputCtx.currentTime,
    nextPlayTime
  );

  source.start(startTime);

  nextPlayTime =
    startTime + audioBuffer.duration;

  clearTimeout(agentSpeakingTimeout);

  const remainingMs = Math.max(
    300,
    (nextPlayTime - outputCtx.currentTime) * 1000 + 250
  );

  agentSpeakingTimeout = setTimeout(() => {
    isAgentSpeaking = false;
  }, remainingMs);
}

function startLocalRecording(stream) {
  recordedChunks = [];

  recorder = new MediaRecorder(stream);

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    if (!recordedChunks.length) return;

    const blob = new Blob(
      recordedChunks,
      { type: "audio/webm" }
    );

    const url = URL.createObjectURL(blob);

    const oldLink = document.getElementById(
      "recordingDownloadLink"
    );

    if (oldLink) oldLink.remove();

    const a = document.createElement("a");

    a.id = "recordingDownloadLink";
    a.href = url;

    a.download =
      `mic-test-${Date.now()}.webm`;

    a.textContent =
      "Download recorded mic audio";

    a.style.display = "block";
    a.style.marginTop = "15px";
    a.style.textAlign = "center";

    document
      .querySelector(".container")
      .appendChild(a);
  };

  recorder.start();
}

async function createAudioWorklet() {
  const workletCode = `
    class MicProcessor extends AudioWorkletProcessor {
      process(inputs) {
        const input = inputs[0];

        if (input && input[0]) {
          this.port.postMessage(input[0]);
        }

        return true;
      }
    }

    registerProcessor(
      "mic-processor",
      MicProcessor
    );
  `;

  const blob = new Blob(
    [workletCode],
    { type: "application/javascript" }
  );

  const url = URL.createObjectURL(blob);

  await audioCtx.audioWorklet.addModule(url);

  URL.revokeObjectURL(url);
}

async function startTranslator() {
  if (isRunning) return;

  try {
    isRunning = true;

    startBtn.disabled = true;

    updateStatus(
      "Getting ElevenLabs WebSocket URL...",
      "default"
    );

    const authResponse =
      await fetch("/api/get-signed-url");

    if (!authResponse.ok) {
      throw new Error(
        `Failed to get signed URL (${authResponse.status})`
      );
    }

    const { signedUrl } =
      await authResponse.json();

    if (!signedUrl) {
      throw new Error(
        "No signedUrl received"
      );
    }

    debugLog(`signedUrl=${signedUrl}`);

    updateStatus(
      "Requesting microphone...",
      "default"
    );

    micStream =
      await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

    startLocalRecording(micStream);

    updateStatus(
      "Opening ElevenLabs WebSocket...",
      "default"
    );

    ws = new WebSocket(signedUrl);

    ws.onopen = async () => {
      updateStatus(
        "WebSocket connected",
        "active"
      );

      ws.send(JSON.stringify({
        type:
          "conversation_initiation_client_data"
      }));

      audioCtx = new AudioContext();

      await createAudioWorklet();

      const source =
        audioCtx.createMediaStreamSource(
          micStream
        );

      workletNode =
        new AudioWorkletNode(
          audioCtx,
          "mic-processor"
        );

      workletNode.port.onmessage =
        (event) => {
          handleInputSamples(
            event.data,
            audioCtx.sampleRate
          );
        };

      source.connect(workletNode);

      startBtn.textContent =
        "Stop Translation";

      startBtn.disabled = false;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.user_transcript?.text) {
          updateStatus(
            `User: ${msg.user_transcript.text}`,
            "active"
          );
        }

        if (msg.agent_response?.response) {
          updateStatus(
            `AI: ${msg.agent_response.response}`,
            "active"
          );
        }

        if (msg.audio_event?.audio_base_64) {
          playPcm16Base64(
            msg.audio_event.audio_base_64
          );
        }

        if (msg.ping_event?.event_id) {
          ws.send(JSON.stringify({
            type: "pong",
            event_id:
              msg.ping_event.event_id
          }));
        }
      } catch (error) {
        debugLog(
          `WS parse error: ${error.message}`
        );
      }
    };

    ws.onerror = () => {
      updateStatus(
        "WebSocket error",
        "error"
      );

      stopTranslator();
    };

    ws.onclose = () => {
      updateStatus(
        "Disconnected",
        "default"
      );

      stopTranslator();
    };

  } catch (error) {
    updateStatus(
      `Error: ${error.message}`,
      "error"
    );

    stopTranslator();
  }
}

function stopTranslator() {
  isRunning = false;
  isAgentSpeaking = false;

  clearTimeout(agentSpeakingTimeout);

  agentSpeakingTimeout = null;

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  if (outputCtx) {
    outputCtx.close().catch(() => {});
    outputCtx = null;
  }

  if (recorder &&
      recorder.state !== "inactive") {
    recorder.stop();
  }

  recorder = null;

  if (micStream) {
    micStream
      .getTracks()
      .forEach(track => track.stop());

    micStream = null;
  }

  if (ws &&
      ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  ws = null;

  pcmBuffer = [];

  nextPlayTime = 0;

  startBtn.textContent =
    "Start Translation";

  startBtn.disabled = false;
}

startBtn.addEventListener(
  "click",
  async () => {
    if (isRunning) {
      stopTranslator();
    } else {
      await startTranslator();
    }
  }
);
