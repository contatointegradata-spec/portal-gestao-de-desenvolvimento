import { getDb } from "../db.js";
import { parseJson } from "../lib/http.js";
import { notifyManagers } from "../lib/notifications.js";
import { getActiveRunForProject, startRun } from "./runner.js";
import { dueSlots, normalizeSchedule } from "./schedule.js";

const TICK_MS = 30 * 1000;
let timer = null;
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const db = await getDb();
    const projects = await db.all("SELECT * FROM projects WHERE systemType = 'rpa' AND status <> 'arquivado' AND scheduleConfig IS NOT NULL");
    const now = new Date();
    for (const project of projects) {
      const schedule = normalizeSchedule(parseJson(project.scheduleConfig, {}));
      for (const slot of dueSlots(schedule, now)) {
        const already = await db.get(
          "SELECT id FROM project_runs WHERE projectId = ? AND triggerType = 'schedule' AND triggerValue = ?",
          project.id, slot
        );
        if (already) continue;

        if (getActiveRunForProject(project.id)) {
          // Registra o slot como ignorado para nao tentar novamente.
          await db.run(
            `INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, errorMessage, createdAt, finishedAt, durationMs)
             VALUES (lower(hex(randomblob(16))), ?, NULL, 'schedule', ?, ?, 'cancelled', 'Agendamento ignorado: o RPA ja estava em execucao.', ?, ?, 0)`,
            project.id, slot, project.runtimeLanguage, now.toISOString(), now.toISOString()
          );
          await notifyManagers({
            kind: "rpa_schedule_skipped",
            title: `Agendamento ignorado: ${project.nome}`,
            body: `O horario ${slot} foi ignorado porque o RPA ainda estava em execucao.`,
            targetType: "project",
            targetId: project.id
          });
          continue;
        }

        try {
          await startRun({ project, triggerType: "schedule", triggerValue: slot, userId: null });
          console.log(`[scheduler] ${project.nome} iniciado (slot ${slot}).`);
        } catch (error) {
          await db.run(
            `INSERT INTO project_runs (id, projectId, triggeredByUserId, triggerType, triggerValue, language, status, errorMessage, createdAt, finishedAt, durationMs)
             VALUES (lower(hex(randomblob(16))), ?, NULL, 'schedule', ?, ?, 'error', ?, ?, ?, 0)`,
            project.id, slot, project.runtimeLanguage, `Falha ao iniciar execucao agendada: ${error.message}`, now.toISOString(), now.toISOString()
          );
          await notifyManagers({
            kind: "rpa_failure",
            title: `Falha no agendamento: ${project.nome}`,
            body: error.message,
            targetType: "project",
            targetId: project.id
          }, project.responsibleUserId ? [project.responsibleUserId] : []);
        }
        break; // um slot por projeto por ciclo
      }
    }
  } catch (error) {
    console.error("[scheduler] Falha no ciclo:", error);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 5000).unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
