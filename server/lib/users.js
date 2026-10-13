export const USER_SELECT = `
  SELECT u.*, d.nome AS departmentName
  FROM users u
  LEFT JOIN departments d ON d.id = u.departmentId
`;

export function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    role: row.role || "user",
    active: Boolean(row.active ?? 1),
    isMaster: Boolean(row.isMaster),
    departmentId: row.departmentId || null,
    departamento: row.departmentName || "",
    foto: row.foto || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt || null
  };
}

export async function loadUser(db, id) {
  return db.get(`${USER_SELECT} WHERE u.id = ?`, id);
}
