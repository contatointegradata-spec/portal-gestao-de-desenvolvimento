import crypto from "node:crypto";
import { trimText } from "./http.js";

/** Resolve departamento por id ou nome; cria pelo nome quando nao existir. */
export async function resolveDepartment(db, payload, actorId = null) {
  const id = trimText(payload?.departmentId);
  const name = trimText(payload?.departmentName ?? payload?.departamento ?? payload?.department);
  if (id) {
    const row = await db.get("SELECT * FROM departments WHERE id = ?", id);
    if (row) return row;
  }
  if (!name) return null;
  const existing = await db.get("SELECT * FROM departments WHERE nome = ? COLLATE NOCASE", name);
  if (existing) return existing;
  const now = new Date().toISOString();
  const newId = crypto.randomUUID();
  await db.run(
    "INSERT INTO departments (id, nome, descricao, ativo, createdByUserId, createdAt, updatedAt) VALUES (?, ?, '', 1, ?, ?, ?)",
    newId, name, actorId, now, now
  );
  return db.get("SELECT * FROM departments WHERE id = ?", newId);
}

export function serializeDepartment(row) {
  return { id: row.id, nome: row.nome, descricao: row.descricao || "", ativo: Boolean(row.ativo ?? 1), userCount: Number(row.userCount || 0), projectCount: Number(row.projectCount || 0) };
}
