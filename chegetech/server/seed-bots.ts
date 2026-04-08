import { initializeDatabase, getDb } from "./storage";
import { bots } from "@shared/schema";
import { eq } from "drizzle-orm";

const SEED_BOTS = [
  {
    name: "Atassa-MD",
    description: "A powerful multi-device WhatsApp bot with 200+ commands, auto-reply, group management, media tools, and AI chat features.",
    repoUrl: "https://github.com/chegeez1/Atassa-MD",
    imageUrl: "",
    price: 70,
    features: ["200+ Commands", "Auto-Reply", "Group Management", "Media Downloader", "AI Chat", "Anti-link Protection"],
    requiresSessionId: true,
    requiresDbUrl: false,
    category: "Multi-Purpose",
    active: true,
  },
  {
    name: "Gifted-MD",
    description: "Feature-rich WhatsApp bot with entertainment commands, sticker maker, YouTube downloader, and group tools.",
    repoUrl: "https://github.com/chegeez1/Gifted-MD",
    imageUrl: "",
    price: 70,
    features: ["Sticker Maker", "YouTube Download", "Group Tools", "Fun Commands", "Media Player", "Auto-Status View"],
    requiresSessionId: true,
    requiresDbUrl: false,
    category: "Multi-Purpose",
    active: true,
  },
];

async function seed() {
  await initializeDatabase();
  const db = getDb();

  for (const bot of SEED_BOTS) {
    const existing = await db.select().from(bots).where(eq(bots.name, bot.name));
    if (existing.length === 0) {
      await db.insert(bots).values({ ...bot, features: JSON.stringify(bot.features) });
      console.log(`Seeded bot: ${bot.name}`);
    } else {
      console.log(`Bot already exists: ${bot.name}`);
    }
  }
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
