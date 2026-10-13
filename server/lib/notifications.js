import crypto from "node:crypto";
import { getDb } from "../db.js";
import { truncate } from "./http.js";

export async function createNotifications(recipientIds, payload) {
  const ids = [...new Set((recipientIds || []).filter(Boolean))];
  if (!ids.length) return;
  const db = await getDb();
  const now = new Date().toISOString();
  for (const recipientUserId of ids) {
    await db.run(
      `INSERT INTO notifications (id, recipientUserId, kind, title, body, targetType, targetId, metadata, readAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      crypto.randomUUID(),
      recipientUserId,
      payload.kind || "system",
      truncate(payload.title || "Atualizacao", 300),
      truncate(payload.body || "", 1000),
      payload.targetType || "",
      payload.targetId || "",
      JSON.stringify(payload.metadata || {}),
      now
    );
  }
}

/** Notifica todos os admins/super admins ativos e, opcionalmente, usuarios extras. */
export async function notifyManagers(payload, extraRecipientIds = []) {
  const db = await getDb();
  const rows = await db.all("SELECT id FROM users WHERE active = 1 AND role IN ('super_admin', 'admin')");
  await createNotifications([...rows.map((row) => row.id), ...extraRecipientIds], payload);
}
