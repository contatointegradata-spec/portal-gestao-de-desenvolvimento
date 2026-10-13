import { computed, reactive } from "vue";
import { authState, http, onUnauthorized, setToken } from "../lib/api.js";

export const session = reactive({
  ready: false,
  user: null,
  users: [],
  departments: [],
  notifications: [],
  unreadCount: 0,
  activeRuns: []
});

export const isManager = computed(() => ["super_admin", "admin"].includes(session.user?.role));
export const isSuperAdmin = computed(() => session.user?.role === "super_admin");

let notificationTimer = null;
let runsTimer = null;

onUnauthorized(() => {
  if (!session.user) return;
  clearSession();
  window.dispatchEvent(new CustomEvent("session-expired"));
});

function clearSession() {
  setToken("");
  stopPolling();
  Object.assign(session, { user: null, users: [], departments: [], notifications: [], unreadCount: 0, activeRuns: [] });
}

export async function bootstrapSession() {
  try {
    if (authState.token) {
      const { user } = await http.get("/api/auth/me");
      session.user = user;
      await afterLogin();
    }
  } catch {
    clearSession();
  } finally {
    session.ready = true;
  }
}

async function afterLogin() {
  await Promise.allSettled([loadDirectory(), refreshNotifications(), refreshActiveRuns()]);
  startPolling();
}

export async function login(email, password) {
  const data = await http.post("/api/auth/login", { email, password });
  setToken(data.token);
  session.user = data.user;
  await afterLogin();
  return data.user;
}

export async function logout() {
  try {
    await http.post("/api/auth/logout");
  } catch {
    // sessao ja expirada
  }
  clearSession();
}

export function updateCurrentUser(user) {
  session.user = user;
  const index = session.users.findIndex((item) => item.id === user.id);
  if (index >= 0) session.users[index] = user;
}

export async function loadDirectory() {
  if (!isManager.value) {
    session.users = session.user ? [session.user] : [];
    session.departments = [];
    return;
  }
  const [users, departments] = await Promise.all([http.get("/api/users"), http.get("/api/departments")]);
  session.users = users;
  session.departments = departments;
}

export async function refreshNotifications() {
  if (!session.user) return;
  const data = await http.get("/api/notifications");
  session.notifications = data.items;
  session.unreadCount = data.unreadCount;
}

export async function refreshActiveRuns() {
  if (!session.user) return;
  session.activeRuns = await http.get("/api/runs/active");
}

function startPolling() {
  stopPolling();
  notificationTimer = setInterval(() => refreshNotifications().catch(() => {}), 30000);
  runsTimer = setInterval(() => refreshActiveRuns().catch(() => {}), 8000);
}

function stopPolling() {
  clearInterval(notificationTimer);
  clearInterval(runsTimer);
  notificationTimer = null;
  runsTimer = null;
}
