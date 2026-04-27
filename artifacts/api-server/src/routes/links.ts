import { Router } from "express";
import { db, linksTable } from "@workspace/db";
import { eq, desc, sum } from "drizzle-orm";
import { CreateLinkBody, GetLinkByIdParams, DeleteLinkParams } from "@workspace/api-zod";
import { nanoid } from "nanoid";

const linksRouter = Router();

function generateSlug(): string {
  return nanoid(7);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

linksRouter.get("/links", async (req, res) => {
  const links = await db
    .select()
    .from(linksTable)
    .orderBy(desc(linksTable.createdAt));
  res.json(links.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

linksRouter.post("/links", async (req, res) => {
  const parsed = CreateLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { originalUrl, customSlug } = parsed.data;

  if (!isValidUrl(originalUrl)) {
    res.status(400).json({ error: "Invalid URL — please include http:// or https://" });
    return;
  }

  const slug = customSlug?.trim() || generateSlug();

  const existing = await db
    .select()
    .from(linksTable)
    .where(eq(linksTable.slug, slug))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "That custom slug is already taken. Please choose another." });
    return;
  }

  const [link] = await db
    .insert(linksTable)
    .values({ originalUrl, slug })
    .returning();

  res.status(201).json({ ...link, createdAt: link.createdAt.toISOString() });
});

linksRouter.get("/links/stats", async (req, res) => {
  const [totalLinksResult] = await db
    .select({ count: db.$count(linksTable) })
    .from(linksTable);

  const clicksResult = await db
    .select({ total: sum(linksTable.clicks) })
    .from(linksTable);

  const topLinks = await db
    .select()
    .from(linksTable)
    .orderBy(desc(linksTable.clicks))
    .limit(5);

  res.json({
    totalLinks: Number(totalLinksResult?.count ?? 0),
    totalClicks: Number(clicksResult[0]?.total ?? 0),
    topLinks: topLinks.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })),
  });
});

linksRouter.get("/links/:id", async (req, res) => {
  const parsed = GetLinkByIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [link] = await db
    .select()
    .from(linksTable)
    .where(eq(linksTable.id, parsed.data.id))
    .limit(1);

  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }

  res.json({ ...link, createdAt: link.createdAt.toISOString() });
});

linksRouter.delete("/links/:id", async (req, res) => {
  const parsed = DeleteLinkParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [deleted] = await db
    .delete(linksTable)
    .where(eq(linksTable.id, parsed.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Link not found" });
    return;
  }

  res.json({ success: true });
});

export default linksRouter;
