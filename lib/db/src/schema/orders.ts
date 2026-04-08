import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  botId: integer("bot_id").notNull(),
  botName: text("bot_name").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone").notNull(),
  sessionId: text("session_id"),
  dbUrl: text("db_url"),
  mode: text("mode").default("public"),
  timezone: text("timezone").default("Africa/Nairobi"),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"),
  paystackReference: text("paystack_reference"),
  deploymentNotes: text("deployment_notes"),
  herokuAppName: text("heroku_app_name"),
  herokuAppUrl: text("heroku_app_url"),
  deployedAt: timestamp("deployed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
