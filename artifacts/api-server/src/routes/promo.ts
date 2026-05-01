import { Router } from "express";
import puppeteer from "puppeteer";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";
import { logger } from "../lib/logger";

const execFileAsync = promisify(execFile);
const router = Router();

const TOTAL_MS   = 165_000; // 17 scenes ≈ 2 m 45 s
const CACHE_FILE = path.join(os.tmpdir(), "streamvault-promo.mp4");
const PROMO_URL  = "http://localhost:80/streamvault-promo/";

type Status = "idle" | "generating" | "ready" | "error";

let status: Status  = "idle";
let progress        = 0;
let errorMsg        = "";

async function generateVideo() {
  if (status === "generating" || status === "ready") return;
  status   = "generating";
  progress = 0;
  errorMsg = "";

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promo-frames-"));
  let frameCount = 0;

  try {
    logger.info("Starting promo video generation with puppeteer");

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Retry navigation — streamvault-promo might still be starting
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await page.goto(PROMO_URL, { waitUntil: "networkidle0", timeout: 20_000 });
        break;
      } catch {
        if (attempt === 4) throw new Error(`Could not load ${PROMO_URL}`);
        logger.warn(`Navigation attempt ${attempt + 1} failed, retrying…`);
        await new Promise(r => setTimeout(r, 5_000));
      }
    }

    // Allow animations to initialise
    await new Promise(r => setTimeout(r, 3_000));

    const client = await page.createCDPSession();

    client.on("Page.screencastFrame", async ({ data, sessionId }) => {
      const framePath = path.join(tmpDir, `frame-${String(frameCount++).padStart(6, "0")}.jpg`);
      try { fs.writeFileSync(framePath, Buffer.from(data, "base64")); } catch { /* skip */ }
      try { await client.send("Page.screencastFrameAck", { sessionId }); } catch { /* skip */ }
    });

    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: 82,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 2, // ~15 fps from a 30-fps source
    });

    // Track progress while recording
    const started = Date.now();
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - started;
      progress = Math.min(85, Math.round((elapsed / TOTAL_MS) * 85));
    }, 2_000);

    await new Promise(r => setTimeout(r, TOTAL_MS + 3_000));

    clearInterval(progressInterval);
    progress = 86;

    await client.send("Page.stopScreencast");
    await browser.close();

    logger.info({ frameCount }, "Screencast complete — encoding MP4");
    progress = 88;

    if (frameCount === 0) throw new Error("No frames captured — is the promo page loading?");

    // Write ffmpeg concat list so we don't rely on sequential naming
    const listFile = path.join(tmpDir, "frames.txt");
    const lines: string[] = [];
    for (let i = 0; i < frameCount; i++) {
      const f = path.join(tmpDir, `frame-${String(i).padStart(6, "0")}.jpg`);
      if (fs.existsSync(f)) {
        lines.push(`file '${f}'`);
        lines.push("duration 0.0667"); // 1/15 s per frame
      }
    }
    fs.writeFileSync(listFile, lines.join("\n"));

    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "22",
      "-movflags", "+faststart",
      "-pix_fmt", "yuv420p",
      CACHE_FILE,
    ]);

    progress = 100;
    status   = "ready";
    logger.info({ file: CACHE_FILE }, "Promo MP4 ready");
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : String(err);
    status   = "error";
    logger.error({ err }, "Promo video generation failed");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** Status check — polled by the download page */
router.get("/promo/status", (_req, res) => {
  res.json({ status, progress, errorMsg });
});

/** Kick off generation (idempotent) */
router.post("/promo/generate", (_req, res) => {
  if (status === "idle" || status === "error") {
    generateVideo().catch(e => logger.error({ err: e }, "generateVideo error"));
  }
  res.json({ status, progress });
});

/** Download the finished MP4 */
router.get("/promo/video.mp4", (req, res) => {
  if (status === "ready" && fs.existsSync(CACHE_FILE)) {
    const stat = fs.statSync(CACHE_FILE);
    res.setHeader("Content-Type",        "video/mp4");
    res.setHeader("Content-Length",      stat.size);
    res.setHeader("Content-Disposition", 'attachment; filename="streamvault-premium-promo.mp4"');
    fs.createReadStream(CACHE_FILE).pipe(res);
    return;
  }
  res.status(202).json({ status, progress, errorMsg,
    message: status === "generating"
      ? `Generating… ${progress}% — poll /api/promo/status`
      : "POST /api/promo/generate to start",
  });
});

export default router;
