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

// ─── CC Checker (Luhn + BIN lookup) ─────────────────────────────────────────

function luhnValid(number: string): boolean {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

toolsRouter.post("/tools/cc/check", async (req, res) => {
  const parsed = CheckCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid card details" });
    return;
  }

  const { number, month, year, cvv } = parsed.data;
  const clean = number.replace(/\D/g, "");
  const cardStr = `${clean}|${month}|${year}|${cvv}`;

  // Luhn check first
  if (!luhnValid(clean)) {
    res.json({
      status: "Dead",
      message: "Invalid card number (Luhn check failed)",
      card: cardStr,
      bank: "",
      type: "",
      category: "",
      country: "",
      emoji: "",
    });
    return;
  }

  // BIN lookup via antipublic
  const bin = clean.slice(0, 6);
  try {
    const binRes = await fetch("https://bins.antipublic.cc/bins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([bin]),
    });

    if (binRes.ok) {
      const binData = (await binRes.json()) as Array<{
        bin?: string;
        brand?: string;
        country?: string;
        country_name?: string;
        country_flag?: string;
        bank?: string;
        level?: string;
        type?: string;
      }>;
      const b = binData[0] ?? {};
      res.json({
        status: "Live",
        message: `Luhn valid · BIN ${bin} matched (${b.brand ?? "Unknown"})`,
        card: cardStr,
        bank: b.bank ?? "",
        type: b.type ?? "",
        category: b.level ?? "",
        country: b.country_name ?? "",
        emoji: b.country_flag ?? "",
      });
    } else {
      // BIN not found but Luhn passes
      res.json({
        status: "Live",
        message: "Luhn valid · BIN not in database",
        card: cardStr,
        bank: "",
        type: "",
        category: "",
        country: "",
        emoji: "",
      });
    }
  } catch {
    res.json({
      status: "Live",
      message: "Luhn valid · BIN lookup unavailable",
      card: cardStr,
      bank: "",
      type: "",
      category: "",
      country: "",
      emoji: "",
    });
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

// ─── Bulk CC Checker ─────────────────────────────────────────────────────────

toolsRouter.post("/tools/cc/bulk-check", async (req, res) => {
  const { cards } = req.body as { cards?: string[] };
  if (!Array.isArray(cards) || cards.length === 0) {
    res.status(400).json({ error: "cards array required" });
    return;
  }
  const limited = cards.slice(0, 50).map((c) => c.trim()).filter(Boolean);

  const results = await Promise.allSettled(
    limited.map(async (entry) => {
      const parts = entry.split(/[|/ ]+/);
      const [num, month = "01", year = "26", cvv = "000"] = parts;
      const clean = (num ?? "").replace(/\D/g, "");
      if (!clean) return { card: entry, status: "Invalid", message: "No card number", bank: "", type: "", category: "", country: "", emoji: "" };

      if (!luhnValid(clean)) {
        return { card: entry, status: "Dead", message: "Luhn check failed", bank: "", type: "", category: "", country: "", emoji: "" };
      }

      const bin = clean.slice(0, 6);
      try {
        const binRes = await fetch("https://bins.antipublic.cc/bins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([bin]),
        });
        if (binRes.ok) {
          const binData = (await binRes.json()) as Array<{ bin?: string; brand?: string; country_name?: string; country_flag?: string; bank?: string; level?: string; type?: string }>;
          const b = binData[0] ?? {};
          return { card: `${clean}|${month}|${year}|${cvv}`, status: "Live", message: `BIN ${bin} · ${b.brand ?? "Unknown"}`, bank: b.bank ?? "", type: b.type ?? "", category: b.level ?? "", country: b.country_name ?? "", emoji: b.country_flag ?? "" };
        }
      } catch { /* fall through */ }
      return { card: `${clean}|${month}|${year}|${cvv}`, status: "Live", message: "Luhn valid · BIN unknown", bank: "", type: "", category: "", country: "", emoji: "" };
    })
  );

  const data = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { card: limited[i], status: "Error", message: String((r as PromiseRejectedResult).reason), bank: "", type: "", category: "", country: "", emoji: "" }
  );

  res.json({ results: data, live: data.filter((d) => d.status === "Live").length, dead: data.filter((d) => d.status === "Dead").length, total: data.length });
});

// ─── Mail Generator ───────────────────────────────────────────────────────────

const DISPOSABLE_DOMAINS = [
  "yopmail.com", "guerrillamail.com", "sharklasers.com", "guerrillamailblock.com",
  "grr.la", "guerrillamail.info", "guerrillamail.biz", "guerrillamail.de",
  "mailnull.com", "spamgourmet.com", "trashmail.com", "throwam.com",
  "dispostable.com", "mailexpire.com", "fakeinbox.com", "getonemail.com",
  "spamoff.de", "tempinbox.com", "throwam.com", "mailsac.com",
];

const ADJECTIVES = ["quick", "bright", "silent", "cool", "dark", "fast", "sharp", "bold", "slick", "clean", "smart", "wild"];
const NOUNS = ["tiger", "storm", "hawk", "wolf", "blade", "fox", "raven", "ghost", "pixel", "byte", "nova", "flux"];
const NAMES = ["alex", "james", "sam", "ryan", "chris", "jordan", "morgan", "taylor", "casey", "riley", "drew", "sage", "avery", "quinn", "blake"];

function randomUsername(format: string): string {
  const rnd = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const num = () => String(Math.floor(Math.random() * 9000) + 1000);
  switch (format) {
    case "name_num": return rnd(NAMES) + num();
    case "word_word": return rnd(ADJECTIVES) + rnd(NOUNS);
    case "word_word_num": return rnd(ADJECTIVES) + rnd(NOUNS) + Math.floor(Math.random() * 99 + 1);
    case "random": {
      const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      return Array.from({ length: 8 + Math.floor(Math.random() * 4) }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    }
    default: return rnd(NAMES) + num();
  }
}

toolsRouter.post("/tools/mail/generate", (req, res) => {
  const { count: rawCount = 10, domain = "random", format = "name_num" } = req.body as { count?: number; domain?: string; format?: string };
  const count = Math.min(Math.max(Number(rawCount) || 10, 1), 100);

  const emails: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = domain === "random" ? DISPOSABLE_DOMAINS[Math.floor(Math.random() * DISPOSABLE_DOMAINS.length)] : (domain || DISPOSABLE_DOMAINS[0]);
    emails.push(`${randomUsername(format)}@${d}`);
  }

  res.json({ emails, count: emails.length });
});

export default toolsRouter;
