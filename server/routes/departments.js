import crypto from "node:crypto";
import { getDb } from "../db.js";
import { requireManager } from "../lib/auth.js";
import { serializeDepartment } from "../lib/departments.js";
import { asyncRouter, badRequest, boolToInt, conflict, notFound, nowIso, trimText } from "../lib/http.js";

const router = asyncRouter();

const LIST_SQL = `
  SELECT d.*,
    (SELECT COUNT(*) FROM users u WHERE u.departmentId = d.id) AS userCount,
    (SELECT COUNT(*) FROM projects p WHERE p.departmentId = d.id) AS projectCount
  FROM departments d
`;

router.get("/", requireManager, async (_req, res) => {
  const db = await getDb();
  const rows = await db.all(`${LIST_SQL} ORDER BY d.nome COLLATE NOCASE ASC`);
  res.json(rows.map(serializeDepartment));
});

router.post("/", requireManager, async (req, res) => {
  const nome = trimText(req.body?.nome);
  if (!nome) throw badRequest("Nome do departamento e obrigatorio.");
  const db = await getDb();
  if (await db.get("SELECT id FROM departments WHERE nome = ? COLLATE NOCASE", nome)) throw conflict("Ja existe departamento com este nome.");
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    "INSERT INTO departments (id, nome, descricao, ativo, createdByUserId, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?, ?)",
    id, nome, trimText(req.body?.descricao), req.user.id, now, now
  );
  res.status(201).json({ department: serializeDepartment(await db.get(`${LIST_SQL} WHERE d.id = ?`, id)) });
});

router.patch("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const department = await db.get("SELECT * FROM departments WHERE id = ?", req.params.id);
  if (!department) throw notFound("Departamento nao encontrado.");
  const nome = req.body?.nome !== undefined ? trimText(req.body.nome) : department.nome;
  if (!nome) throw badRequest("Nome do departamento e obrigatorio.");
  if (await db.get("SELECT id FROM departments WHERE nome = ? COLLATE NOCASE AND id <> ?", nome, department.id)) throw conflict("Ja existe departamento com este nome.");
  const descricao = req.body?.descricao !== undefined ? trimText(req.body.descricao) : department.descricao || "";
  const ativo = req.body?.ativo === undefined ? department.ativo : boolToInt(req.body.ativo);
  await db.run("UPDATE departments SET nome = ?, descricao = ?, ativo = ?, updatedAt = ? WHERE id = ?", nome, descricao, ativo, nowIso(), department.id);
  res.json({ department: serializeDepartment(await db.get(`${LIST_SQL} WHERE d.id = ?`, department.id)) });
});

router.delete("/:id", requireManager, async (req, res) => {
  const db = await getDb();
  const department = await db.get("SELECT * FROM departments WHERE id = ?", req.params.id);
  if (!department) throw notFound("Departamento nao encontrado.");
  await db.run("DELETE FROM departments WHERE id = ?", department.id);
  res.status(204).send();
});

export default router;
