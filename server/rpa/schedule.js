import { config } from "../config.js";

export const SCHEDULE_MODES = ["manual", "daily", "dates"];
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const formatted = `${match[1].padStart(2, "0")}:${match[2]}`;
  return TIME_RE.test(formatted) ? formatted : "";
}

function normalizeDateTime(value) {
  const raw = String(value || "").trim().replace("T", " ");
  const [datePart, timePart] = raw.split(/\s+/);
  if (!DATE_RE.test(datePart || "")) return "";
  const time = normalizeTime(timePart || "");
  if (!time) return "";
  const [y, m, d] = datePart.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return "";
  return `${datePart} ${time}`;
}

function toList(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/[,;\n]/);
}

/** Aceita o formato novo (v2) e o legado ({mode: hours|dates, hours, dates}). */
export function normalizeSchedule(input) {
  const source = input && typeof input === "object" ? input : {};
  if (source.version === 2 || SCHEDULE_MODES.includes(source.mode)) {
    const mode = SCHEDULE_MODES.includes(source.mode) ? source.mode : "manual";
    const times = [...new Set(toList(source.times).map(normalizeTime).filter(Boolean))].sort();
    const weekdays = Array.isArray(source.weekdays) && source.weekdays.length
      ? [...new Set(source.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
      : [...ALL_WEEKDAYS];
    const dates = [...new Set(toList(source.dates).map(normalizeDateTime).filter(Boolean))].sort();
    return { version: 2, mode, times, weekdays: weekdays.length ? weekdays : [...ALL_WEEKDAYS], dates };
  }

  // Legado
  const legacyHours = [...new Set(toList(source.hours).map(normalizeTime).filter(Boolean))].sort();
  const legacyDates = toList(source.dates).map((item) => String(item).trim()).filter((item) => DATE_RE.test(item));
  if (source.mode === "hours") {
    return { version: 2, mode: legacyHours.length ? "daily" : "manual", times: legacyHours, weekdays: [...ALL_WEEKDAYS], dates: [] };
  }
  if (source.mode === "dates") {
    const hours = legacyHours.length ? legacyHours : ["08:00"];
    const dates = [...new Set(legacyDates.flatMap((date) => hours.map((hour) => `${date} ${hour}`)))].sort();
    return { version: 2, mode: dates.length ? "dates" : "manual", times: [], weekdays: [...ALL_WEEKDAYS], dates };
  }
  return { version: 2, mode: "manual", times: [], weekdays: [...ALL_WEEKDAYS], dates: [] };
}

export function validateSchedule(schedule) {
  if (schedule.mode === "daily" && !schedule.times.length) return "Informe ao menos um horario para o agendamento diario.";
  if (schedule.mode === "daily" && !schedule.weekdays.length) return "Selecione ao menos um dia da semana.";
  if (schedule.mode === "dates" && !schedule.dates.length) return "Informe ao menos uma data e hora para o agendamento.";
  return "";
}

// ─── Fuso horario ─────────────────────────────────────────────────────────────
const formatterCache = new Map();
function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23"
    }));
  }
  return formatterCache.get(timeZone);
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date = new Date(), timeZone = config.timezone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

/** Converte "YYYY-MM-DD" + "HH:MM" no fuso configurado para um Date (UTC). */
export function zonedToDate(dateStr, timeStr, timeZone = config.timezone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetOf = (instant) => {
    const p = localParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
  };
  let result = guess - offsetOf(guess);
  result = guess - offsetOf(result);
  return new Date(result);
}

/** Chaves de slot ("YYYY-MM-DD HH:MM") vencidas no instante atual (com tolerancia de minutos). */
export function dueSlots(schedule, now = new Date(), toleranceMinutes = 2) {
  if (!schedule || schedule.mode === "manual") return [];
  const slots = [];
  for (let offset = 0; offset <= toleranceMinutes; offset += 1) {
    const parts = localParts(new Date(now.getTime() - offset * 60000));
    const key = `${parts.date} ${parts.time}`;
    if (schedule.mode === "daily" && schedule.weekdays.includes(parts.weekday) && schedule.times.includes(parts.time)) slots.push(key);
    if (schedule.mode === "dates" && schedule.dates.includes(key)) slots.push(key);
  }
  return slots;
}

export function computeNextRun(schedule, now = new Date()) {
  if (!schedule || schedule.mode === "manual") return null;
  if (schedule.mode === "dates") {
    const upcoming = schedule.dates
      .map((item) => {
        const [date, time] = item.split(" ");
        return zonedToDate(date, time);
      })
      .filter((date) => date.getTime() > now.getTime())
      .sort((a, b) => a - b);
    return upcoming[0]?.toISOString() || null;
  }
  for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
    const parts = localParts(new Date(now.getTime() + dayOffset * 86400000));
    if (!schedule.weekdays.includes(parts.weekday)) continue;
    for (const time of schedule.times) {
      const candidate = zonedToDate(parts.date, time);
      if (candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
  }
  return null;
}
