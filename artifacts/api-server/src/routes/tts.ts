import { Router } from "express";
import { textToSpeech } from "@workspace/integrations-openai-ai-server/audio";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const router = Router();

const VALID_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);

// ─── Disk cache ───────────────────────────────────────────────────────────────
const CACHE_DIR = join(process.cwd(), ".tts-cache");
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// In-flight dedup: voice:text → Promise<Buffer>
const pending = new Map<string, Promise<Buffer>>();

function cacheKey(text: string, voice: string): string {
  return createHash("sha256").update(`${voice}::${text}`).digest("hex");
}

function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.mp3`);
}

async function getOrGenerate(text: string, voice: string): Promise<Buffer> {
  const key = cacheKey(text, voice);
  const path = cachePath(key);

  // 1. Hit: serve from disk instantly
  if (existsSync(path)) return readFileSync(path);

  // 2. In-flight dedup: same request already being fetched
  if (pending.has(key)) return pending.get(key)!;

  // 3. Miss: call OpenAI, save to disk
  const promise = (async () => {
    const buf = await textToSpeech(
      text.trim(),
      voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
      "mp3",
    );
    writeFileSync(path, buf);
    pending.delete(key);
    return buf;
  })();

  pending.set(key, promise);
  return promise;
}

// ─── POST /api/tts ────────────────────────────────────────────────────────────
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
    const buf = await getOrGenerate(text.trim(), safeVoice);
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "public, max-age=2592000"); // 30 days
    res.send(buf);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});

// ─── POST /api/tts/warmup ─────────────────────────────────────────────────────
// Client sends all scripts at once; server pre-generates them in background.
// Responds immediately with 202 — client doesn't wait.
router.post("/tts/warmup", (req, res) => {
  const { scripts, voice = "onyx" } = req.body as {
    scripts?: { key: string; text: string }[];
    voice?: string;
  };

  if (!Array.isArray(scripts) || scripts.length === 0) {
    res.status(400).json({ error: "scripts[] required" });
    return;
  }

  const safeVoice = VALID_VOICES.has(voice) ? voice : "onyx";

  // Fire-and-forget — non-blocking
  for (const { text } of scripts) {
    if (text && text.trim().length > 0 && text.length <= 2000) {
      getOrGenerate(text.trim(), safeVoice).catch((e) =>
        console.warn("warmup failed for", text.slice(0, 40), e?.message),
      );
    }
  }

  res.status(202).json({ queued: scripts.length });
});

// ─── GET /api/tts/status ──────────────────────────────────────────────────────
// Returns which scripts are already cached (for debugging / ready-gating).
router.post("/tts/status", (req, res) => {
  const { scripts, voice = "onyx" } = req.body as {
    scripts?: { key: string; text: string }[];
    voice?: string;
  };

  if (!Array.isArray(scripts)) {
    res.status(400).json({ error: "scripts[] required" });
    return;
  }

  const safeVoice = VALID_VOICES.has(voice) ? voice : "onyx";
  const result: Record<string, boolean> = {};

  for (const { key, text } of scripts) {
    const ck = cacheKey(text.trim(), safeVoice);
    result[key] = existsSync(cachePath(ck));
  }

  res.json({ cached: result });
});

export default router;
