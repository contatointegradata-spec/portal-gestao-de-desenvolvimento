export const ROLE_LABELS = { super_admin: "Super Admin", admin: "Admin", user: "Usuario" };

export const PROJECT_STATUS = {
  ativo: { label: "Ativo", class: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" },
  desenvolvimento: { label: "Em desenvolvimento", class: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200" },
  manutencao: { label: "Manutencao", class: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200" },
  arquivado: { label: "Arquivado", class: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200" }
};

export const PROJECT_CATEGORIES = { interno: "Interno", cliente: "Cliente", pessoal: "Pessoal", estudo: "Estudo" };

export const RUN_STATUS = {
  running: { label: "Em execucao", class: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200", dot: "bg-sky-500" },
  success: { label: "Sucesso", class: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200", dot: "bg-emerald-500" },
  error: { label: "Falhou", class: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200", dot: "bg-rose-500" },
  timeout: { label: "Tempo esgotado", class: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200", dot: "bg-amber-500" },
  cancelled: { label: "Cancelada", class: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200", dot: "bg-slate-400" },
  interrupted: { label: "Interrompida", class: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200", dot: "bg-amber-500" }
};

export const TRIGGER_LABELS = { manual: "Manual", schedule: "Agendada", test: "Teste", validate: "Validacao" };

export const WEEKDAYS = [
  { value: 1, short: "Seg", label: "Segunda" },
  { value: 2, short: "Ter", label: "Terca" },
  { value: 3, short: "Qua", label: "Quarta" },
  { value: 4, short: "Qui", label: "Quinta" },
  { value: 5, short: "Sex", label: "Sexta" },
  { value: 6, short: "Sab", label: "Sabado" },
  { value: 0, short: "Dom", label: "Domingo" }
];

export const METHOD_COLORS = {
  GET: "text-emerald-600",
  POST: "text-amber-600",
  PUT: "text-sky-600",
  PATCH: "text-violet-600",
  DELETE: "text-rose-600",
  HEAD: "text-slate-500",
  OPTIONS: "text-fuchsia-600"
};

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("pt-BR");
}

export function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatRelative(value) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return future ? "em instantes" : "agora mesmo";
  if (minutes < 60) return future ? `em ${minutes} min` : `ha ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `em ${hours} h` : `ha ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return future ? `em ${days} dia(s)` : `ha ${days} dia(s)`;
  return formatDate(value);
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return "-";
  const value = Number(ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

export function normalizeUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `http://${value}`;
}

export function scheduleSummary(schedule) {
  if (!schedule || schedule.mode === "manual") return "Execucao manual";
  if (schedule.mode === "dates") return `${schedule.dates.length} data(s) agendada(s)`;
  const days = schedule.weekdays.length === 7 ? "todos os dias" : schedule.weekdays.length === 5 && !schedule.weekdays.includes(0) && !schedule.weekdays.includes(6)
    ? "dias uteis" : WEEKDAYS.filter((day) => schedule.weekdays.includes(day.value)).map((day) => day.short).join(", ");
  return `${schedule.times.join(", ")} · ${days}`;
}
