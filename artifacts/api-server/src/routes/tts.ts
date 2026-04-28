import { Router } from "express";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";

const router = Router();

const VALID_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

// POST /api/tts
// Body: { text: string, voice?: string }
// Returns: audio/mpeg (mp3)
router.post("/tts", async (req, res) => {
  const { text, voice = "onyx" } = req.body as { text?: string; voice?: string };

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  if (text.length > 2000) {
    res.status(400).json({ error: "text too long (max 2000 chars)" });
    return;
  }

  const safeVoice = VALID_VOICES.has(voice) ? voice : "onyx";

  try {
    const audioBuffer = await textToSpeech(
      text.trim(),
      safeVoice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      "mp3",
    );

    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(audioBuffer);
  } catch (err) {
    console.error("TTS generation error:", err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});

export default router;
