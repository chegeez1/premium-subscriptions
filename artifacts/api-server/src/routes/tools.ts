import { Router } from "express";
import { CheckBinParams, CheckCardBody, GenerateCardsBody } from "@workspace/api-zod";

const toolsRouter = Router();

// ─── BIN Checker ────────────────────────────────────────────────────────────

toolsRouter.get("/tools/bin/:bin", async (req, res) => {
  const parsed = CheckBinParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid BIN" });
    return;
  }

  const bin = parsed.data.bin.replace(/\D/g, "").slice(0, 8);

  if (bin.length < 6) {
    res.status(400).json({ error: "BIN must be at least 6 digits" });
    return;
  }

  try {
    const response = await fetch(`https://lookup.binlist.net/${bin}`, {
      headers: { "Accept-Version": "3" },
    });

    if (response.status === 404) {
      res.status(404).json({ error: "BIN not found in database" });
      return;
    }

    if (!response.ok) {
      res.status(502).json({ error: "BIN lookup service unavailable" });
      return;
    }

    const data = (await response.json()) as {
      scheme?: string;
      type?: string;
      brand?: string;
      bank?: { name?: string };
      country?: { name?: string; alpha2?: string; emoji?: string };
    };

    res.json({
      bin,
      scheme: data.scheme ?? "Unknown",
      type: data.type ?? "Unknown",
      brand: data.brand ?? data.scheme ?? "Unknown",
      bank: data.bank?.name ?? "Unknown",
      country: data.country?.name ?? "Unknown",
      countryCode: data.country?.alpha2 ?? "",
      emoji: data.country?.emoji ?? "",
    });
  } catch {
    res.status(502).json({ error: "Failed to reach BIN lookup service" });
  }
});

// ─── CC Checker ─────────────────────────────────────────────────────────────

toolsRouter.post("/tools/cc/check", async (req, res) => {
  const parsed = CheckCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid card details" });
    return;
  }

  const { number, month, year, cvv } = parsed.data;
  const cardStr = `${number}|${month}|${year}|${cvv}`;

  try {
    const response = await fetch("https://api.chkr.cc/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: cardStr }),
    });

    if (!response.ok) {
      res.status(502).json({ error: "Card checker service unavailable" });
      return;
    }

    const data = (await response.json()) as {
      status?: string;
      message?: string;
      card?: {
        card?: string;
        bank?: string;
        type?: string;
        category?: string;
        country?: { name?: string; emoji?: string };
      };
    };

    res.json({
      status: data.status ?? "Unknown",
      message: data.message ?? "",
      card: data.card?.card ?? cardStr,
      bank: data.card?.bank ?? "",
      type: data.card?.type ?? "",
      category: data.card?.category ?? "",
      country: data.card?.country?.name ?? "",
      emoji: data.card?.country?.emoji ?? "",
    });
  } catch {
    res.status(502).json({ error: "Failed to reach card checker service" });
  }
});

// ─── CC Generator (Luhn Algorithm) ──────────────────────────────────────────

const COMMON_BINS: Record<string, string> = {
  visa: "4",
  mastercard: "5",
  amex: "37",
  discover: "6011",
};

const CARD_LENGTHS: Record<string, number> = {
  "37": 15,
  "34": 15,
};

function luhnChecksum(digits: string): number {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum;
}

function generateLuhnValid(prefix: string, totalLength: number): string {
  const stub = prefix.padEnd(totalLength - 1, "0");
  const partial = stub + "0";
  const checksum = luhnChecksum(partial);
  const checkDigit = (10 - (checksum % 10)) % 10;
  const filled = prefix + Array.from(
    { length: totalLength - prefix.length - 1 },
    () => Math.floor(Math.random() * 10)
  ).join("") + checkDigit;
  return filled;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomMonth(): string {
  return String(randomBetween(1, 12)).padStart(2, "0");
}

function randomYear(): string {
  return String(randomBetween(new Date().getFullYear() + 1, new Date().getFullYear() + 5));
}

function randomCvv(prefix: string): string {
  const len = prefix.startsWith("37") || prefix.startsWith("34") ? 4 : 3;
  return String(randomBetween(0, Math.pow(10, len) - 1)).padStart(len, "0");
}

toolsRouter.post("/tools/cc/generate", (req, res) => {
  const parsed = GenerateCardsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { bin: rawBin, count: rawCount, month: fixedMonth, year: fixedYear, cvv: fixedCvv } = parsed.data;
  const count = Math.min(Math.max(Number(rawCount ?? 10), 1), 20);

  // Determine BIN prefix
  let prefix = (rawBin ?? "").replace(/\D/g, "");
  if (!prefix) {
    prefix = COMMON_BINS.visa + String(randomBetween(100, 999));
  }

  // Determine card length
  const twoDigit = prefix.slice(0, 2);
  const cardLength = CARD_LENGTHS[twoDigit] ?? 16;

  const cards = Array.from({ length: count }, () => {
    const number = generateLuhnValid(prefix, cardLength);
    const month = fixedMonth || randomMonth();
    const year = fixedYear || randomYear();
    const cvv = fixedCvv || randomCvv(prefix);
    const formatted = `${number}|${month}|${year}|${cvv}`;
    return { number, month, year, cvv, formatted };
  });

  res.json(cards);
});

export default toolsRouter;
