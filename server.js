import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.get("/api/get-signed-url", async (req, res) => {
  try {
    // Check if environment variables are set
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "ELEVENLABS_API_KEY is not set in .env file" });
    }

    const agentType = req.query.agentType || 'agent1';
    const agentId = agentType === 'agent1' ? process.env.AGENT_ID : process.env.AGENT_ID2;

    if (!agentId) {
      const envVarName = agentType === 'agent1' ? 'AGENT_ID' : 'AGENT_ID2';
      return res.status(500).json({ error: `${envVarName} is not set in .env file` });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    res.json({ signedUrl: data.signed_url });
  } catch (error) {
    const errorMessage = error.message || "Auth failed";
    res.status(500).json({ error: errorMessage });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
