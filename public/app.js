import { Conversation } from "@elevenlabs/client";

// Language names for prompts
const languageNames = {
  en: "English",
  ru: "Russian",
  zh: "Chinese",
  es: "Spanish"
};

// Generate first message with specific source and destination languages
function getFirstMessage(sourceLangName, destLangName, destLangCode) {
  const messages = {
    en: `I will translate from ${sourceLangName} to ${destLangName}. Speak in ${sourceLangName} and I will respond in ${destLangName} only.`,
    ru: `Я буду переводить с ${sourceLangName === "English" ? "английского" : sourceLangName} на ${destLangName === "Russian" ? "русский" : destLangName}. Говорите на ${sourceLangName === "English" ? "английском" : sourceLangName}, я отвечу только на ${destLangName === "Russian" ? "русском" : destLangName}.`,
    zh: `我将从${sourceLangName === "English" ? "英语" : sourceLangName}翻译到${destLangName === "Chinese" ? "中文" : destLangName}。请说${sourceLangName === "English" ? "英语" : sourceLangName}，我只用${destLangName === "Chinese" ? "中文" : destLangName}回答。`,
    es: `Soy un traductor. Traduciré de ${sourceLangName === "English" ? "inglés" : sourceLangName} a ${destLangName === "Spanish" ? "español" : destLangName}. Habla en ${sourceLangName === "English" ? "inglés" : sourceLangName}, yo responderé SOLO en ${destLangName === "Spanish" ? "español" : destLangName}. Nunca respondas en inglés, siempre en ${destLangName === "Spanish" ? "español" : destLangName}.`
  };
  return messages[destLangCode] || messages.en;
}

let conversation = null;
let isStarting = false;
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const sourceLanguageSelect = document.getElementById("sourceLanguageSelect");
const destinationLanguageSelect = document.getElementById("destinationLanguageSelect");
const voiceTypeRadios = document.querySelectorAll('input[name="voiceType"]');

function updateStatus(message, type = "default") {
  statusEl.textContent = `Status: ${message}`;
  statusEl.className = type;
}

async function startTalkingToAI() {
  if (isStarting) {
    return;
  }

  try {
    isStarting = true;
    
    // Ensure no existing conversation
    if (conversation) {
      try {
        await conversation.end();
      } catch (e) {
        // Ignore cleanup errors
      }
      conversation = null;
    }

    const sourceLang = sourceLanguageSelect.value;
    const destLang = destinationLanguageSelect.value;

    // Validate same language
    if (sourceLang === destLang) {
      updateStatus("Source and destination languages must be different", "error");
      isStarting = false;
      return;
    }

    const sourceLangName = languageNames[sourceLang];
    const destLangName = languageNames[destLang];

    if (!sourceLangName || !destLangName) {
      updateStatus("Language not supported", "error");
      isStarting = false;
      return;
    }

    updateStatus("Getting authentication...", "default");
    startBtn.disabled = true;

    const selectedVoiceType = document.querySelector('input[name="voiceType"]:checked').value;
    const agentType = selectedVoiceType === 'my-voice' ? 'agent1' : 'agent2';

    const authResponse = await fetch(`/api/get-signed-url?agentType=${agentType}`);
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

    updateStatus("Connecting to translator...", "default");

conversation = await Conversation.startSession({
  signedUrl: signedUrl,

  overrides: {
    agent: {

      prompt: {
        prompt: `You are a real-time translator.
Translate from ${sourceLangName} to ${destLangName}.
Only output translated speech.`
      }
    }
  },

  onConnect: () => {
    isStarting = false;
        updateStatus(`Ready - Speak in ${sourceLangName}, I'll translate to ${destLangName}`, "active");
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
  if (!conversation) {
    return;
  }

  try {
    startBtn.disabled = true;
    
    // Try to end the session properly
    if (typeof conversation.end === 'function') {
      await conversation.end();
    } else if (typeof conversation.endSession === 'function') {
      await conversation.endSession();
    }
    
    conversation = null;
    updateStatus("Translation ended", "default");
    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;
  } catch (error) {
    // Force cleanup even if end() fails
    conversation = null;
    updateStatus("Translation ended", "default");
    startBtn.textContent = "Start Translation";
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", async () => {
  // Prevent clicking while starting
  if (isStarting) {
    return;
  }
  
  if (conversation) {
    await stopConversation();
  } else {
    await startTalkingToAI();
  }
});

// Stop translation when language dropdowns or voice type change
sourceLanguageSelect.addEventListener("change", async () => {
  if (conversation) {
    await stopConversation();
  }
});

destinationLanguageSelect.addEventListener("change", async () => {
  if (conversation) {
    await stopConversation();
  }
});

voiceTypeRadios.forEach(radio => {
  radio.addEventListener("change", async () => {
    if (conversation) {
      await stopConversation();
    }
  });
});
