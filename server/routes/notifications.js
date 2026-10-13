import { getDb } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { asyncRouter, notFound, nowIso, parseJson } from "../lib/http.js";

const router = asyncRouter();

function serialize(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    targetType: row.targetType || "",
    targetId: row.targetId || "",
    metadata: parseJson(row.metadata, {}),
    readAt: row.readAt || null,
    createdAt: row.createdAt
  };
}

router.get("/", requireAuth, async (req, res) => {
  const db = await getDb();
  const rows = await db.all(
    "SELECT * FROM notifications WHERE recipientUserId = ? ORDER BY createdAt DESC LIMIT 100",
    req.user.id
  );
  const unread = await db.get("SELECT COUNT(*) AS total FROM notifications WHERE recipientUserId = ? AND readAt IS NULL", req.user.id);
  res.json({ items: rows.map(serialize), unreadCount: Number(unread?.total || 0) });
});

router.patch("/:id/read", requireAuth, async (req, res) => {
  const db = await getDb();
  const row = await db.get("SELECT * FROM notifications WHERE id = ? AND recipientUserId = ?", req.params.id, req.user.id);
  if (!row) throw notFound("Notificacao nao encontrada.");
  await db.run("UPDATE notifications SET readAt = COALESCE(readAt, ?) WHERE id = ?", nowIso(), row.id);
  res.json({ notification: serialize(await db.get("SELECT * FROM notifications WHERE id = ?", row.id)) });
});

router.post("/read-all", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("UPDATE notifications SET readAt = ? WHERE recipientUserId = ? AND readAt IS NULL", nowIso(), req.user.id);
  res.status(204).send();
});

router.delete("/read", requireAuth, async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM notifications WHERE recipientUserId = ? AND readAt IS NOT NULL", req.user.id);
  res.status(204).send();
});

export default router;
