/**
 * Consolida bancos legados em um banco novo, ja migrado para o schema atual.
 *
 *   node scripts/merge-legacy-data.mjs --base <banco-principal> [--extra <banco-complementar>] [--out data/gestao_dev.sqlite] [--force]
 *
 * - base:  banco mais recente (usuarios, departamentos, sistemas, APIs).
 * - extra: banco complementar; sistemas que nao existem na base sao copiados
 *          junto com arquivos de entrada e historico de execucoes.
 * Os arquivos de origem nunca sao alterados (o script trabalha em copias).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Modo interno: apenas migra um banco (executado em processo separado).
if (args[0] === "--migrate-only") {
  process.env.DB_PATH = args[1];
  const { initDb, closeDb } = await import("../server/db.js");
  await initDb();
  await closeDb();
  process.exit(0);
}

const base = getArg("--base");
const extra = getArg("--extra");
const out = path.resolve(root, getArg("--out") || "data/gestao_dev.sqlite");
if (!base || !fs.existsSync(base)) {
  console.error("Informe --base com o caminho de um banco existente.");
  process.exit(1);
}
if (fs.existsSync(out)) {
  if (!args.includes("--force")) {
    console.error(`O destino ${out} ja existe. Use --force para substituir (uma copia de seguranca sera criada).`);
    process.exit(1);
  }
  const backup = `${out}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(out, backup);
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${out}${suffix}`, { force: true });
  console.log(`Backup do destino anterior: ${backup}`);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(base, out);

function migrate(file) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--migrate-only", file], { stdio: "inherit", cwd: root });
  if (result.status !== 0) throw new Error(`Falha ao migrar ${file}`);
}

console.log(`Migrando base -> ${out}`);
migrate(out);

if (extra && fs.existsSync(extra)) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gestao-merge-"));
  const extraCopy = path.join(tempDir, "extra.sqlite");
  fs.copyFileSync(extra, extraCopy);
  console.log(`Migrando banco complementar (copia temporaria)`);
  migrate(extraCopy);

  const sqlite3 = (await import("sqlite3")).default;
  const { open } = await import("sqlite");
  const target = await open({ filename: out, driver: sqlite3.Database });
  const source = await open({ filename: extraCopy, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  await target.exec("PRAGMA foreign_keys = ON;");

  const copyRows = async (table, rows) => {
    for (const row of rows) {
      const columns = Object.keys(row);
      await target.run(
        `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ...columns.map((column) => row[column])
      );
    }
  };

  const projects = await source.all("SELECT * FROM projects");
  let imported = 0;
  for (const project of projects) {
    if (await target.get("SELECT id FROM projects WHERE id = ?", project.id)) continue;
    if (project.responsibleUserId && !(await target.get("SELECT id FROM users WHERE id = ?", project.responsibleUserId))) project.responsibleUserId = null;
    if (project.departmentId && !(await target.get("SELECT id FROM departments WHERE id = ?", project.departmentId))) project.departmentId = null;
    await copyRows("projects", [project]);
    await copyRows("project_files", await source.all("SELECT * FROM project_files WHERE projectId = ?", project.id));
    await copyRows("project_runs", await source.all("SELECT * FROM project_runs WHERE projectId = ?", project.id));
    console.log(`  + Sistema importado: ${project.nome}`);
    imported += 1;
  }
  await source.close();
  await target.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`${imported} sistema(s) importado(s) do banco complementar.`);
}

console.log(`\nBanco consolidado: ${out}`);
