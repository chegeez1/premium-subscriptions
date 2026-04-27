import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { db, linksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.get("/r/:slug", async (req, res) => {
  const { slug } = req.params;
  const [link] = await db
    .select()
    .from(linksTable)
    .where(eq(linksTable.slug, slug))
    .limit(1);

  if (!link) {
    res.status(404).send("Link not found");
    return;
  }

  await db
    .update(linksTable)
    .set({ clicks: sql`${linksTable.clicks} + 1` })
    .where(eq(linksTable.id, link.id));

  res.redirect(301, link.originalUrl);
});

export default app;
