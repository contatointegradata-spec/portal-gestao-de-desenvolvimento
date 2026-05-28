
<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";

const apiBase = "/api";
const TOKEN_KEY = "gestao_auth_token";
const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  user: "Usuario"
};
const TICKET_CATEGORY_LABELS = {
  solicitacao: "Solicitacao",
  duvida: "Duvida",
  incidente: "Incidente",
  outro: "Outro"
};
const TICKET_PRIORITY_LABELS = {
  baixa: "Baixa",
  media: "Media",
  alta: "Alta",
  critica: "Critica"
};
const TICKET_STATUS_LABELS = {
  aberto: "Aberto",
  em_tratamento: "Em tratamento",
  aguardando_resposta_usuario: "Aguardando resposta do usuario",
  resolvido: "Resolvido",
  encerrado: "Encerrado"
};
const TICKETS_PER_PAGE = 5;
const USERS_PER_PAGE = 10;

const authLoading = ref(true);
const authToken = ref(localStorage.getItem(TOKEN_KEY) || "");
const authUser = ref(null);
const authError = ref("");
const authSubmitting = ref(false);
const showForgot = ref(false);
const forgotSubmitting = ref(false);
const forgotError = ref("");
const forgotMessage = ref("");
const forgotPreviewLink = ref("");
const resetToken = ref("");
const resetSubmitting = ref(false);
const resetError = ref("");
const resetMessage = ref("");
const userFormOpen = ref(false);
const userFormMode = ref("create");
const userFormError = ref("");
const userFormMessage = ref("");
const projectDetailsId = ref("");
const projectDetailsOpen = ref(false);
const projectLogsOpen = ref(false);
const projectLogsId = ref("");
const projectRuns = ref([]);
const projectLogsLoading = ref(false);
const expandedRunId = ref(null);

const loginForm = reactive({ email: "kelvensilva.unimed@gmail.com", password: "" });
const forgotForm = reactive({ 
  email: "", 
  code: "", 
  novaSenha: "", 
  confirmarSenha: "", 
  step: 1 // 1: Email, 2: Code, 3: New Password
});

const settingsOpen = ref(false);
const settingsTab = ref("profile");
const settingsState = reactive({
  message: "",
  passwordError: "",
  passwordMessage: "",
  passwordSaving: false,
  passwordForm: { senhaAtual: "", novaSenha: "", confirmarSenha: "" }
});

const projects = ref([]);
const projectState = ref({});
const tickets = ref([]);
const ticketsLoading = ref(false);
const ticketsError = ref("");
const ticketQuery = ref("");
const ticketStatusFilter = ref("all");
const ticketCategoryFilter = ref("all");
const ticketSystemTypeFilter = ref("all");
const ticketPage = ref(1);
const userPage = ref(1);
const userActionsMenu = ref("");
const ticketFormOpen = ref(false);
const ticketFormError = ref("");
const ticketFormSubmitting = ref(false);
const ticketDetailsOpen = ref(false);
const ticketDetailsLoading = ref(false);
const ticketDetailsError = ref("");
const ticketDetails = ref(null);
const ticketMessages = ref([]);
const ticketReply = ref("");
const ticketReplySubmitting = ref(false);
const ticketStatusDraft = ref("aberto");
const ticketAssignedDraft = ref("");
const ticketPriorityDraft = ref("media");
const ticketResolutionDraft = ref("");
const ticketUpdateSubmitting = ref(false);
const ticketActionsMenuOpen = ref(false);
const notifications = ref([]);
const notificationsOpen = ref(false);
const notificationsLoading = ref(false);
const notificationFilter = ref("all");
const localRoles = ref({});
const departments = ref([]);
let notificationsPoller = null;

const loading = ref(false);
const error = ref("");
const query = ref("");
const formOpen = ref(false);
const formMode = ref("create");
const editingId = ref("");
const formError = ref("");
const projectTypeFilter = ref("all");

const form = reactive({
  nome: "",
  descricao: "",
  url: "",
  repositorio: "",
  systemType: "common",
  status: "ativo",
  categoria: "interno",
  tecnologias: "",
  screenshot: "",
  observacoes: "",
  ownerEmail: "",
  department: "",
  language: "javascript",
  code: "",
  rpaFile: "",
  rpaFileName: "",
  scheduleMode: "manual",
  scheduleHours: "",
  scheduleDates: "",
  rpaFiles: []
});

const userForm = reactive({
  nome: "",
  email: "",
  role: "user",
  departamento: "",
  senha: "",
  confirmarSenha: "",
  originalEmail: ""
});

const ticketForm = reactive({
  titulo: "",
  descricao: "",
  categoria: "solicitacao",
  prioridade: "media",
  projectId: "",
  systemType: "common"
});

const filteredProjects = computed(() => {
  const value = query.value.trim().toLowerCase();
  const scope = getVisibleProjects(projects.value);
  return scope.filter((project) => {
    const projectType = getProjectMeta(project.id).systemType || project.systemType || "common";
    const matchesQuery = !value
      || project.nome.toLowerCase().includes(value)
      || project.descricao.toLowerCase().includes(value)
      || (project.ownerName || "").toLowerCase().includes(value)
      || (project.department || "").toLowerCase().includes(value);
    const matchesType = projectTypeFilter.value === "all" || projectTypeFilter.value === projectType;
    return matchesQuery && matchesType;
  });
});

const currentRole = computed(() => authUser.value?.role || "user");
const currentProfile = computed(() => localRoles.value[(authUser.value?.email || "").trim().toLowerCase()] || {});
const currentDisplayName = computed(() => currentProfile.value.nome || authUser.value?.nome || "");
const currentDepartment = computed(() => currentProfile.value.departamento || authUser.value?.departmentNome || "");
const canManageUsers = computed(() => ["super_admin", "admin"].includes(currentRole.value));
const canCreateUsers = computed(() => currentRole.value === "super_admin");
const canDeleteUsers = computed(() => currentRole.value === "super_admin");
const canManageProjects = computed(() => ["super_admin", "admin"].includes(currentRole.value));
const canManageTickets = computed(() => ["super_admin", "admin"].includes(currentRole.value));
const canEditUserIdentity = computed(() => currentRole.value === "super_admin" || userFormMode.value === "create");
const canEditUserRole = computed(() => currentRole.value === "super_admin");
const assignableTicketUsers = computed(() => Object.values(localRoles.value).filter((user) => ["super_admin", "admin"].includes(user.role)));
const settingsTabs = computed(() => [
  { id: "profile", label: "Perfil" },
  { id: "users", label: "Usuarios" },
  { id: "documentation", label: "Documentacao" }
]);
const summaryStats = computed(() => {
  const visible = getVisibleProjects(projects.value);
  const common = visible.filter((project) => getProjectMeta(project.id).systemType !== "rpa").length;
  const rpa = visible.filter((project) => getProjectMeta(project.id).systemType === "rpa").length;
  return {
    visible: visible.length,
    common,
    rpa,
    users: Object.keys(localRoles.value).length
  };
});
const selectedProject = computed(() => (projectDetailsId.value ? getProjectById(projectDetailsId.value) : null));
const filteredTickets = computed(() => {
  const search = ticketQuery.value.trim().toLowerCase();
  return tickets.value.filter((ticket) => {
    const matchesStatus = ticketStatusFilter.value === "all" || ticket.status === ticketStatusFilter.value;
    const matchesCategory = ticketCategoryFilter.value === "all" || ticket.categoria === ticketCategoryFilter.value;
    const matchesSearch = !search
      || String(ticket.number).includes(search)
      || (ticket.titulo || "").toLowerCase().includes(search)
      || (ticket.descricao || "").toLowerCase().includes(search)
      || (ticket.requesterName || "").toLowerCase().includes(search);
    return matchesStatus && matchesCategory && matchesSearch;
  });
});
const ticketSummary = computed(() => ({
  total: tickets.value.length,
  abertos: tickets.value.filter((ticket) => ["aberto", "em_tratamento", "aguardando_resposta_usuario"].includes(ticket.status)).length,
  resolvidos: tickets.value.filter((ticket) => ticket.status === "resolvido").length,
  encerrados: tickets.value.filter((ticket) => ticket.status === "encerrado").length
}));
const totalTicketPages = computed(() => Math.max(1, Math.ceil(filteredTickets.value.length / TICKETS_PER_PAGE)));
const paginatedTickets = computed(() => {
  const safePage = Math.min(ticketPage.value, totalTicketPages.value);
  const start = (safePage - 1) * TICKETS_PER_PAGE;
  return filteredTickets.value.slice(start, start + TICKETS_PER_PAGE);
});
const unreadNotificationsCount = computed(() => notifications.value.filter((item) => !item.readAt).length);
const filteredNotifications = computed(() => {
  if (notificationFilter.value === "all") return notifications.value;
  return notifications.value.filter((item) => notificationGroup(item) === notificationFilter.value);
});

const totalUserPages = computed(() => Math.max(1, Math.ceil(visibleUsers().length / USERS_PER_PAGE)));
const paginatedUsers = computed(() => {
  const safePage = Math.min(userPage.value, totalUserPages.value);
  const start = (safePage - 1) * USERS_PER_PAGE;
  return visibleUsers().slice(start, start + USERS_PER_PAGE);
});

onMounted(async () => {
  const params = new URLSearchParams(window.location.search);
  resetToken.value = params.get("resetToken") || "";

  if (!authToken.value) {
    authLoading.value = false;
    return;
  }

  try {
    const me = await requestAuth(`${apiBase}/auth/me`);
    authUser.value = me.user;
    await fetchDirectory();
    await Promise.all([fetchProjects(), fetchTickets(), fetchNotifications()]);
    startNotificationsPolling();
  } catch {
    clearAuth();
  } finally {
    authLoading.value = false;
  }
});

onUnmounted(() => {
  stopNotificationsPolling();
});

watch([ticketQuery, ticketStatusFilter, ticketCategoryFilter], () => {
  ticketPage.value = 1;
});

watch(totalTicketPages, (nextTotal) => {
  if (ticketPage.value > nextTotal) {
    ticketPage.value = nextTotal;
  }
});

function clearAuth() {
  authToken.value = "";
  authUser.value = null;
  localStorage.removeItem(TOKEN_KEY);
  projects.value = [];
  settingsOpen.value = false;
  settingsTab.value = "profile";
  formOpen.value = false;
  userFormOpen.value = false;
  projectDetailsOpen.value = false;
  ticketFormOpen.value = false;
  ticketDetailsOpen.value = false;
  ticketDetails.value = null;
  ticketMessages.value = [];
  ticketReply.value = "";
  ticketStatusDraft.value = "aberto";
  ticketAssignedDraft.value = "";
  ticketPriorityDraft.value = "media";
  ticketResolutionDraft.value = "";
  notificationsOpen.value = false;
  localRoles.value = {};
  departments.value = [];
  projectState.value = {};
  tickets.value = [];
  notifications.value = [];
  stopNotificationsPolling();
}

function getVisibleProjects(list) {
  return list.map(mergeProjectData);
}

function mergeProjectData(project) {
  const state = getProjectState(project.id);
  return {
    ...project,
    ...state,
    systemType: project.systemType || "common",
    ownerEmail: project.ownerEmail || "",
    ownerName: project.ownerName || authUser.value?.nome || "",
    department: project.department || "",
    language: project.language || "javascript",
    code: project.code || "",
    scheduleMode: project.scheduleMode || "manual",
    scheduleHours: project.scheduleHours || "",
    scheduleDates: project.scheduleDates || "",
    lastValidation: state.lastValidation || "",
    lastExecution: state.lastExecution || cleanRpaOutput(project.lastRunOutput) || "",
    lastTestResult: state.lastTestResult || "",
    executionStatus: state.executionStatus || "idle",
    rpaFile: project.rpaFile || "",
    rpaFileName: project.rpaFileName || ""
  };
}

function getProjectMeta(projectId) {
  const project = projects.value.find((item) => item.id === projectId);
  return project ? mergeProjectData(project) : {};
}

function getProjectState(projectId) {
  return projectState.value[projectId] || {};
}

function getProjectById(projectId) {
  const raw = projects.value.find((project) => project.id === projectId);
  return raw ? mergeProjectData(raw) : null;
}

async function fetchDirectory() {
  const currentEmail = (authUser.value?.email || "").trim().toLowerCase();
  const baseProfile = {
    id: authUser.value?.id || "",
    email: currentEmail,
    nome: authUser.value?.nome || "",
    role: authUser.value?.role || "user",
    departamento: authUser.value?.departmentNome || "",
    senhaDefinida: true
  };

  localRoles.value = currentEmail ? { [currentEmail]: baseProfile } : {};
  departments.value = baseProfile.departamento ? [baseProfile.departamento] : [];

  if (["super_admin", "admin"].includes(currentRole.value)) {
    const [users, departmentRows] = await Promise.all([
      requestAuth(`${apiBase}/users`),
      requestAuth(`${apiBase}/departments`)
    ]);

    localRoles.value = Object.fromEntries(
      users.map((user) => [
        user.email,
        {
          id: user.id,
          email: user.email,
          nome: user.nome,
          role: user.role,
          departamento: user.departamento || "",
          senhaDefinida: true
        }
      ])
    );

    departments.value = departmentRows.map((department) => department.nome);
  }
}

async function requestAuth(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken.value}`
    }
  });

  if (response.status === 401) {
    clearAuth();
    throw new Error("Sessao expirada. Entre novamente.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const validationError = Array.isArray(data.errors) && data.errors.length
      ? `Campos invalidos: ${data.errors.join(", ")}`
      : "";
    throw new Error(data.error || validationError || "Erro na requisicao.");
  }

  if (response.status === 204) return null;
  return response.json();
}

async function login() {
  authError.value = "";
  authSubmitting.value = true;

  try {
    const response = await fetch(`${apiBase}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginForm.email.trim(), password: loginForm.password })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Falha no login.");
    }

    const data = await response.json();
    authToken.value = data.token;
    authUser.value = data.user;
    localStorage.setItem(TOKEN_KEY, data.token);
    await fetchDirectory();
    await Promise.all([fetchProjects(), fetchTickets(), fetchNotifications()]);
    startNotificationsPolling();
  } catch (err) {
    authError.value = err.message || "Erro de autenticacao.";
  } finally {
    authSubmitting.value = false;
    authLoading.value = false;
  }
}

async function requestForgotPassword() {
  forgotError.value = "";
  forgotMessage.value = "";
  forgotSubmitting.value = true;

  try {
    const response = await fetch(`${apiBase}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forgotForm.email.trim() })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Falha ao solicitar recuperacao.");
    }

    forgotMessage.value = "Codigo de recuperacao enviado para o seu email.";
    forgotForm.step = 2;
  } catch (err) {
    forgotError.value = err.message || "Erro ao solicitar recuperacao.";
  } finally {
    forgotSubmitting.value = false;
  }
}

async function verifyResetCode() {
  forgotError.value = "";
  forgotSubmitting.value = true;

  try {
    const response = await fetch(`${apiBase}/auth/verify-reset-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        email: forgotForm.email.trim(),
        code: forgotForm.code.trim() 
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Codigo invalido ou expirado.");
    }

    forgotForm.step = 3;
    forgotMessage.value = "Codigo validado. Digite sua nova senha.";
  } catch (err) {
    forgotError.value = err.message || "Codigo invalido.";
  } finally {
    forgotSubmitting.value = false;
  }
}

async function submitResetPassword() {
  forgotError.value = "";
  forgotMessage.value = "";

  if (!forgotForm.novaSenha || !forgotForm.confirmarSenha) {
    forgotError.value = "Preencha todos os campos.";
    return;
  }

  if (forgotForm.novaSenha !== forgotForm.confirmarSenha) {
    forgotError.value = "As senhas nao conferem.";
    return;
  }

  forgotSubmitting.value = true;
  try {
    const response = await fetch(`${apiBase}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: forgotForm.email.trim(),
        code: forgotForm.code.trim(),
        novaSenha: forgotForm.novaSenha
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Erro ao redefinir senha.");
    }

    forgotMessage.value = "Senha redefinida com sucesso. Entre com a nova senha.";
    setTimeout(() => {
      showForgot.value = false;
      forgotForm.step = 1;
      forgotForm.email = "";
      forgotForm.code = "";
      forgotForm.novaSenha = "";
      forgotForm.confirmarSenha = "";
    }, 2000);
  } catch (err) {
    forgotError.value = err.message || "Erro ao redefinir senha.";
  } finally {
    forgotSubmitting.value = false;
  }
}

async function logout() {
  try {
    await requestAuth(`${apiBase}/auth/logout`, { method: "POST" });
  } catch {
    // noop
  } finally {
    clearAuth();
  }
}

async function fetchProjects() {
  loading.value = true;
  error.value = "";
  try {
    projects.value = await requestAuth(`${apiBase}/projects`);
  } catch (err) {
    error.value = err.message || "Erro ao carregar projetos.";
  } finally {
    loading.value = false;
  }
}

async function fetchTickets() {
  ticketsLoading.value = true;
  ticketsError.value = "";
  try {
    const params = new URLSearchParams();
    if (ticketStatusFilter.value !== "all") params.append("status", ticketStatusFilter.value);
    if (ticketCategoryFilter.value !== "all") params.append("categoria", ticketCategoryFilter.value);
    if (ticketSystemTypeFilter.value !== "all") params.append("systemType", ticketSystemTypeFilter.value);
    if (ticketQuery.value) params.append("search", ticketQuery.value);

    tickets.value = await requestAuth(`${apiBase}/tickets?${params.toString()}`);
  } catch (err) {
    ticketsError.value = err.message || "Erro ao carregar chamados.";
  } finally {
    ticketsLoading.value = false;
  }
}

async function fetchNotifications() {
  notificationsLoading.value = true;
  try {
    notifications.value = await requestAuth(`${apiBase}/notifications`);
  } finally {
    notificationsLoading.value = false;
  }
}

function startNotificationsPolling() {
  stopNotificationsPolling();
  notificationsPoller = window.setInterval(() => {
    if (authToken.value) fetchNotifications().catch(() => {});
  }, 30000);
}

function stopNotificationsPolling() {
  if (notificationsPoller) {
    clearInterval(notificationsPoller);
    notificationsPoller = null;
  }
}

async function markNotificationRead(notification) {
  if (!notification?.id || notification.readAt) return;
  const response = await requestAuth(`${apiBase}/notifications/${notification.id}/read`, {
    method: "PATCH"
  });
  notifications.value = notifications.value.map((item) => (item.id === notification.id ? response.notification : item));
}

async function markAllNotificationsRead() {
  await requestAuth(`${apiBase}/notifications/read-all`, { method: "POST" });
  const now = new Date().toISOString();
  notifications.value = notifications.value.map((item) => ({ ...item, readAt: item.readAt || now }));
}

async function openNotification(notification) {
  await markNotificationRead(notification);
  notificationsOpen.value = false;
  if (notification.targetType === "ticket" && notification.targetId) {
    await openTicketDetails({ id: notification.targetId });
    return;
  }
  if (notification.targetType === "project" && notification.targetId) {
    if (!projects.value.find((item) => item.id === notification.targetId)) {
      await fetchProjects();
    }
    projectDetailsId.value = notification.targetId;
    projectDetailsOpen.value = true;
  }
}

function openCreateTicket() {
  ticketForm.titulo = "";
  ticketForm.descricao = "";
  ticketForm.categoria = "solicitacao";
  ticketForm.prioridade = "media";
  ticketForm.projectId = "";
  ticketForm.systemType = "common";
  ticketFormError.value = "";
  ticketFormOpen.value = true;
}

async function saveTicket() {
  ticketFormError.value = "";
  if (!ticketForm.titulo.trim() || !ticketForm.descricao.trim()) {
    ticketFormError.value = "Titulo e descricao sao obrigatorios.";
    return;
  }

  ticketFormSubmitting.value = true;
  try {
    await requestAuth(`${apiBase}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo: ticketForm.titulo.trim(),
        descricao: ticketForm.descricao.trim(),
        categoria: ticketForm.categoria,
        prioridade: ticketForm.prioridade,
        projectId: ticketForm.projectId || null,
        department: currentDepartment.value || ""
      })
    });
    ticketFormOpen.value = false;
    await Promise.all([fetchTickets(), fetchNotifications()]);
  } catch (err) {
    ticketFormError.value = err.message || "Erro ao abrir chamado.";
  } finally {
    ticketFormSubmitting.value = false;
  }
}

async function openTicketDetails(ticket) {
  ticketDetailsLoading.value = true;
  ticketDetailsError.value = "";
  ticketDetailsOpen.value = true;
  ticketDetails.value = null;
  ticketMessages.value = [];
  ticketReply.value = "";
  try {
    const data = await requestAuth(`${apiBase}/tickets/${ticket.id}`);
    ticketDetails.value = data.ticket;
    ticketMessages.value = data.messages || [];
    syncTicketDrafts(data.ticket);
  } catch (err) {
    ticketDetailsError.value = err.message || "Erro ao carregar chamado.";
  } finally {
    ticketDetailsLoading.value = false;
  }
}

function syncTicketDrafts(ticket) {
  ticketStatusDraft.value = ticket?.status || "aberto";
  ticketAssignedDraft.value = ticket?.assignedUserId || "";
  ticketPriorityDraft.value = ticket?.prioridade || "media";
  ticketResolutionDraft.value = ticket?.resolutionSummary || "";
}

async function sendTicketReply() {
  if (!ticketDetails.value?.id || !ticketReply.value.trim()) return;
  
  // Se for admin e nao escolheu acao especifica, o padrao e aguardar usuario
  const status = canManageTickets.value ? 'aguardando_resposta_usuario' : 'em_tratamento';
  await submitReplyWithStatus(status);
}

async function sendAdminReply(action) {
  if (!ticketDetails.value?.id || !ticketReply.value.trim()) {
    alert("Por favor, escreva uma mensagem descrevendo a acao.");
    return;
  }
  
  const status = action === 'validate' ? 'resolvido' : 'encerrado';
  await submitReplyWithStatus(status);
  ticketActionsMenuOpen.value = false;
}

async function acceptAdjustment() {
  if (!ticketDetails.value?.id) return;
  ticketReply.value = "Ajuste aceito. O chamado pode ser encerrado.";
  await submitReplyWithStatus('encerrado');
}

async function rejectAdjustment() {
  if (!ticketDetails.value?.id) return;
  ticketReply.value = "Usuario negou ajuste, chamado pendente de tratativa.";
  await submitReplyWithStatus('em_tratamento');
}

async function submitReplyWithStatus(status) {
  ticketReplySubmitting.value = true;
  ticketDetailsError.value = "";
  try {
    const data = await requestAuth(`${apiBase}/tickets/${ticketDetails.value.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        body: ticketReply.value.trim(),
        status: status 
      })
    });
    ticketDetails.value = data.ticket;
    ticketMessages.value = data.messages || [];
    ticketReply.value = "";
    syncTicketDrafts(data.ticket);
    await Promise.all([fetchTickets(), fetchNotifications()]);
  } catch (err) {
    ticketDetailsError.value = err.message || "Erro ao enviar resposta.";
  } finally {
    ticketReplySubmitting.value = false;
  }
}

async function updateTicket() {
  if (!ticketDetails.value?.id) return;
  ticketUpdateSubmitting.value = true;
  ticketDetailsError.value = "";
  try {
    const payload = {
      status: ticketStatusDraft.value,
      assignedUserId: ticketAssignedDraft.value || null,
      prioridade: ticketPriorityDraft.value,
      resolutionSummary: ticketResolutionDraft.value.trim(),
      note: "Atualizacao de tratativa."
    };
    const data = await requestAuth(`${apiBase}/tickets/${ticketDetails.value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    ticketDetails.value = data.ticket;
    ticketMessages.value = data.messages || [];
    syncTicketDrafts(data.ticket);
    await Promise.all([fetchTickets(), fetchNotifications()]);
    alert("Chamado atualizado com sucesso!");
  } catch (err) {
    const msg = err.message || "Erro ao atualizar chamado.";
    ticketDetailsError.value = msg;
    alert(msg);
  } finally {
    ticketUpdateSubmitting.value = false;
  }
}

async function closeResolvedTicket() {
  if (!ticketDetails.value?.id) return;
  ticketUpdateSubmitting.value = true;
  ticketDetailsError.value = "";
  try {
    const data = await requestAuth(`${apiBase}/tickets/${ticketDetails.value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "encerrado", note: "Chamado encerrado pelo solicitante." })
    });
    ticketDetails.value = data.ticket;
    ticketMessages.value = data.messages || [];
    syncTicketDrafts(data.ticket);
    await Promise.all([fetchTickets(), fetchNotifications()]);
  } catch (err) {
    ticketDetailsError.value = err.message || "Erro ao encerrar chamado.";
  } finally {
    ticketUpdateSubmitting.value = false;
  }
}

function handlePhotoChange(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = async () => {
    settingsState.message = "";
    try {
      const data = await requestAuth(`${apiBase}/users/me/photo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foto: String(reader.result || "") })
      });
      authUser.value = data.user;
      settingsState.message = "Foto atualizada.";
    } catch (err) {
      settingsState.message = err.message || "Erro ao atualizar foto.";
    }
  };
  reader.readAsDataURL(file);
}

function handleScreenshotChange(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.onload = () => {
    form.screenshot = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function handleRpaFilesChange(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  files.forEach((file) => {
    if (file.size > 10 * 1024 * 1024) {
      alert(`Arquivo ${file.name} e muito grande (max 10MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      form.rpaFiles.push({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fileName: file.name,
        fileContent: String(reader.result || ""),
        fileSize: file.size
      });
    };
    reader.readAsDataURL(file);
  });
}

function removeRpaFile(fileId) {
  form.rpaFiles = form.rpaFiles.filter(f => f.id !== fileId);
}

async function changePassword() {
  const { senhaAtual, novaSenha, confirmarSenha } = settingsState.passwordForm;
  settingsState.passwordError = "";
  settingsState.passwordMessage = "";

  if (!senhaAtual || !novaSenha || !confirmarSenha) {
    settingsState.passwordError = "Preencha todos os campos.";
    return;
  }
  if (novaSenha !== confirmarSenha) {
    settingsState.passwordError = "Confirmacao de senha invalida.";
    return;
  }

  settingsState.passwordSaving = true;
  try {
    await requestAuth(`${apiBase}/users/me/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senhaAtual, novaSenha })
    });

    settingsState.passwordMessage = "Senha redefinida. Entre novamente.";
    settingsState.passwordForm.senhaAtual = "";
    settingsState.passwordForm.novaSenha = "";
    settingsState.passwordForm.confirmarSenha = "";
    setTimeout(() => logout(), 1000);
  } catch (err) {
    settingsState.passwordError = err.message || "Erro ao redefinir senha.";
  } finally {
    settingsState.passwordSaving = false;
  }
}

function openCreate() {
  formMode.value = "create";
  editingId.value = "";
  resetForm();
  formOpen.value = true;
}

function openEdit(project) {
  formMode.value = "edit";
  editingId.value = project.id;
  form.nome = project.nome;
  form.descricao = project.descricao;
  form.url = project.url;
  form.repositorio = project.repositorio || "";
  form.systemType = getProjectMeta(project.id).systemType || "common";
  form.status = project.status;
  form.categoria = project.categoria;
  form.tecnologias = (project.tecnologias || []).join(", ");
  form.screenshot = project.screenshot || "";
  form.observacoes = project.observacoes || "";
  form.ownerEmail = getProjectMeta(project.id).ownerEmail || project.ownerEmail || "";
  form.department = getProjectMeta(project.id).department || project.department || "";
  form.language = getProjectMeta(project.id).language || project.language || "javascript";
  form.code = getProjectMeta(project.id).code || project.code || "";
  form.rpaFile = getProjectMeta(project.id).rpaFile || project.rpaFile || "";
  form.rpaFileName = getProjectMeta(project.id).rpaFileName || project.rpaFileName || "";
  form.scheduleMode = getProjectMeta(project.id).scheduleMode || project.scheduleMode || "manual";
  form.scheduleHours = getProjectMeta(project.id).scheduleHours || project.scheduleHours || "";
  form.scheduleDates = getProjectMeta(project.id).scheduleDates || project.scheduleDates || "";
  form.rpaFiles = project.rpaFiles ? JSON.parse(JSON.stringify(project.rpaFiles)) : [];
  formError.value = "";
  formOpen.value = true;
}

async function openProjectLogs(project) {
  projectLogsId.value = project.id;
  projectLogsOpen.value = true;
  projectLogsLoading.value = true;
  projectRuns.value = [];
  try {
    const data = await requestAuth(`${apiBase}/projects/${project.id}/runs`);
    projectRuns.value = data;
  } catch (err) {
    console.error("Erro ao carregar logs:", err);
  } finally {
    projectLogsLoading.value = false;
  }
}

function resetForm() {
  form.nome = "";
  form.descricao = "";
  form.url = "";
  form.repositorio = "";
  form.systemType = "common";
  form.status = "ativo";
  form.categoria = "interno";
  form.tecnologias = "";
  form.screenshot = "";
  form.observacoes = "";
  form.ownerEmail = authUser.value?.email || "";
  form.department = currentDepartment.value || "";
  form.language = "javascript";
  form.code = "";
  form.rpaFile = "";
  form.rpaFileName = "";
  form.scheduleMode = "manual";
  form.scheduleHours = "";
  form.scheduleDates = "";
  form.rpaFiles = [];
  formError.value = "";
}

function payloadFromForm() {
  const tecnologias = form.tecnologias
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    nome: form.nome.trim(),
    descricao: form.descricao.trim(),
    url: form.url.trim(),
    repositorio: form.repositorio.trim(),
    systemType: form.systemType,
    status: form.status,
    tecnologias,
    categoria: form.categoria,
    screenshot: form.screenshot,
    observacoes: form.observacoes.trim(),
    ownerEmail: form.ownerEmail.trim().toLowerCase(),
    department: form.department.trim(),
    language: form.systemType === "rpa" ? form.language : "",
    code: form.systemType === "rpa" ? form.code : "",
    rpaFile: form.systemType === "rpa" ? form.rpaFile : "",
    rpaFileName: form.systemType === "rpa" ? form.rpaFileName : "",
    rpaFiles: form.systemType === "rpa" ? form.rpaFiles : [],
    scheduleMode: form.systemType === "rpa" ? form.scheduleMode : "manual",
    scheduleHours: form.systemType === "rpa" ? form.scheduleHours : "",
    scheduleDates: form.systemType === "rpa" ? form.scheduleDates : ""
  };
}

function handleOwnerSelection() {
  const selectedUser = Object.values(localRoles.value).find((user) => user.email === form.ownerEmail);
  if (!selectedUser) return;
  if (!form.department.trim() && selectedUser.departamento) {
    form.department = selectedUser.departamento;
  }
}

async function saveProject() {
  formError.value = "";

  try {
    const payload = payloadFromForm();
    if (!payload.nome || !payload.descricao || !payload.url || payload.tecnologias.length === 0 || !payload.ownerEmail) {
      throw new Error("Nome, descricao, URL, tecnologias e usuario responsavel sao obrigatorios.");
    }

    if (payload.systemType === "rpa" && !payload.code.trim()) {
      throw new Error("Codigo e obrigatorio para Sistema RPA.");
    }

    if (formMode.value === "create") {
      const created = await requestAuth(`${apiBase}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      projects.value.unshift(created);
    } else {
      const updated = await requestAuth(`${apiBase}/projects/${editingId.value}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const index = projects.value.findIndex((project) => project.id === updated.id);
      if (index !== -1) projects.value[index] = updated;
    }

    await fetchDirectory();
    formOpen.value = false;
    resetForm();
  } catch (err) {
    formError.value = err.message || "Erro ao salvar.";
  }
}

async function deleteProject(project) {
  if (!confirm(`Excluir ${project.nome}?`)) return;
  try {
    await requestAuth(`${apiBase}/projects/${project.id}`, { method: "DELETE" });
    projects.value = projects.value.filter((item) => item.id !== project.id);
    const nextState = { ...projectState.value };
    delete nextState[project.id];
    projectState.value = nextState;
  } catch (err) {
    error.value = err.message || "Erro ao excluir.";
  }
}

function openSettings(tab = "profile") {
  settingsTab.value = tab;
  settingsOpen.value = true;
}

function closeSettings() {
  settingsOpen.value = false;
  settingsTab.value = "profile";
  userFormMessage.value = "";
  userFormError.value = "";
}

function openCreateUser() {
  if (!canCreateUsers.value) return;
  openSettings("users");
  userFormMode.value = "create";
  userFormError.value = "";
  userFormMessage.value = "";
  userForm.nome = "";
  userForm.email = "";
  userForm.role = "user";
  userForm.departamento = "";
  userForm.senha = "";
  userForm.confirmarSenha = "";
  userForm.originalEmail = "";
  userFormOpen.value = true;
}

function openEditUser(user) {
  if (!canManageUsers.value) return;
  openSettings("users");
  userFormMode.value = "edit";
  userFormError.value = "";
  userFormMessage.value = "";
  userForm.nome = user.nome || "";
  userForm.email = user.email || "";
  userForm.role = user.role || "user";
  userForm.departamento = user.departamento || "";
  userForm.senha = "";
  userForm.confirmarSenha = "";
  userForm.originalEmail = user.email || "";
  userFormOpen.value = true;
}

async function saveUserProfile() {
  userFormError.value = "";
  userFormMessage.value = "";

  const email = userForm.email.trim().toLowerCase();
  if (!userForm.nome.trim() || !email) {
    userFormError.value = "Nome e email sao obrigatorios.";
    return;
  }

  if (userFormMode.value === "create" && canCreateUsers.value === false) {
    userFormError.value = "Voce nao tem permissao para criar usuarios.";
    return;
  }

  if (userFormMode.value === "create" && (!userForm.senha || userForm.senha !== userForm.confirmarSenha)) {
    userFormError.value = "Defina e confirme a senha.";
    return;
  }

  try {
    const payload = userFormMode.value === "create"
      ? {
          nome: userForm.nome.trim(),
          email,
          role: userForm.role,
          departamento: userForm.departamento.trim(),
          senha: userForm.senha,
          password: userForm.senha
        }
      : {
          email,
          ...(currentRole.value === "super_admin" ? {
            nome: userForm.nome.trim(),
            role: userForm.role,
            departamento: userForm.departamento.trim()
          } : {}),
          ...(userForm.senha ? { novaSenha: userForm.senha, password: userForm.senha } : {})
        };

    if (userFormMode.value === "create") {
      await requestAuth(`${apiBase}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      userFormMessage.value = `Usuario ${email} criado.`;
    } else {
      const target = Object.values(localRoles.value).find((user) => user.email === userForm.originalEmail);
      if (!target?.id) throw new Error("Usuario alvo nao encontrado.");
      await requestAuth(`${apiBase}/users/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      userFormMessage.value = `Usuario ${email} atualizado.`;
    }

    await fetchDirectory();
    userFormOpen.value = false;
  } catch (err) {
    userFormError.value = err.message || "Erro ao salvar usuario.";
  }
}

async function deleteUser(user) {
  if (!canDeleteUsers.value || !user?.id) return;
  if (!confirm(`Excluir ${user.nome || user.email}?`)) return;

  userFormError.value = "";
  userFormMessage.value = "";

  try {
    await requestAuth(`${apiBase}/users/${user.id}`, { method: "DELETE" });
    if (userFormOpen.value && userForm.originalEmail === user.email) {
      userFormOpen.value = false;
    }
    userFormMessage.value = `Usuario ${user.email} excluido.`;
    await fetchDirectory();
  } catch (err) {
    userFormError.value = err.message || "Erro ao excluir usuario.";
  }
}

function visibleUsers() {
  const entries = Object.values(localRoles.value);
  if (currentRole.value === "super_admin") return entries;
  return entries.filter((user) => user.role !== "super_admin");
}

function ticketStatusLabel(status) {
  return TICKET_STATUS_LABELS[status] || "Aberto";
}

function ticketCategoryLabel(category) {
  return TICKET_CATEGORY_LABELS[category] || "Outro";
}

function ticketPriorityLabel(priority) {
  return TICKET_PRIORITY_LABELS[priority] || "Media";
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("pt-BR");
  } catch {
    return value;
  }
}

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

function notificationGroup(notification) {
  if ((notification.kind || "").startsWith("ticket_")) return "tickets";
  if ((notification.kind || "").startsWith("rpa_")) return "rpa";
  return "system";
}

function notificationGroupLabel(group) {
  return {
    all: "Todas",
    tickets: "Chamados",
    rpa: "RPA",
    system: "Sistema"
  }[group] || "Todas";
}

function getProjectCardBadge(project) {
  const meta = getProjectMeta(project.id);
  return meta.systemType === "rpa" ? "Sistema RPA" : "Sistema Comum";
}

function projectScheduleSummary(project) {
  const meta = getProjectMeta(project.id);
  const hours = (meta.scheduleHours || "").split(",").map((value) => value.trim()).filter(Boolean);
  const dates = (meta.scheduleDates || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!hours.length && !dates.length) return "Sem agenda";
  const parts = [];
  if (hours.length) parts.push(`${hours.length} horario(s)`);
  if (dates.length) parts.push(`${dates.length} data(s)`);
  return parts.join(" e ");
}

// ─── Estado do painel de progresso em tempo real ─────────────────────────────
const rpaStreamOpen = ref(false);
const rpaStreamProjectName = ref("");
const rpaStreamLogs = ref([]);   // array de { ts, level, message, ...data }
const rpaStreamStatus = ref("idle"); // idle | running | success | error
const rpaLogContainer = ref(null); // ref para auto-scroll
const rpaScreenshot = ref(null);   // última imagem base64 capturada pelo browser
const rpaScreenshotUrl = ref("");  // URL atual exibida na barra do browser mockado
const rpaScreenshotLabel = ref(""); // label da última ação

// Auto-scroll do painel de logs RPA quando novos logs chegam
watch(rpaStreamLogs, () => {
  if (rpaLogContainer.value) {
    rpaLogContainer.value.scrollTop = rpaLogContainer.value.scrollHeight;
  }
}, { deep: true });

function openRpaStream(projectName) {
  rpaStreamProjectName.value = projectName;
  rpaStreamLogs.value = [];
  rpaStreamStatus.value = "running";
  rpaStreamOpen.value = true;
  rpaScreenshot.value = null;
  rpaScreenshotUrl.value = "";
  rpaScreenshotLabel.value = "";
}

function closeRpaStream() {
  rpaStreamOpen.value = false;
  rpaStreamLogs.value = [];
  rpaStreamStatus.value = "idle";
  rpaScreenshot.value = null;
  rpaScreenshotUrl.value = "";
  rpaScreenshotLabel.value = "";
}

// ─── Execução com streaming SSE ───────────────────────────────────────────────
async function triggerProjectAction(project, action) {
  const meta = getProjectMeta(project.id);
  const isRpa = (meta.systemType || project.systemType) === "rpa";
  if (!isRpa) {
    projectState.value = {
      ...projectState.value,
      [project.id]: {
        ...(projectState.value[project.id] || {}),
        lastTestResult: "Sistema comum nao requer execucao de codigo.",
        executionStatus: "idle"
      }
    };
    return;
  }

  const current = {
    ...(projectState.value[project.id] || {}),
    executionStatus: action
  };

  try {
    if (action === "validate") {
      const response = await requestAuth(`${apiBase}/projects/${project.id}/code/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      current.lastValidation = response.message || "Codigo validado.";
      replaceProject(response.project);
      await fetchNotifications();
    } else {
      // Usa SSE para execução com progresso em tempo real
      await runProjectWithStream(project, action, current);
      return; // runProjectWithStream já atualiza o estado
    }
  } catch (err) {
    if (action === "validate") current.lastValidation = err.message || "Erro ao validar.";
    if (action === "test") current.lastTestResult = err.message || "Erro ao testar.";
    if (action === "run") current.lastExecution = err.message || "Erro ao executar.";
  }

  projectState.value = {
    ...projectState.value,
    [project.id]: current
  };
}

async function runProjectWithStream(project, action, current) {
  openRpaStream(project.nome);

  const triggerType = action === "test" ? "test" : "manual";
  const url = `${apiBase}/projects/${project.id}/run/stream?triggerType=${triggerType}`;

  return new Promise((resolve) => {
    const es = new EventSource(url, {
      // EventSource não suporta headers nativamente — o token é validado via cookie/query
      // Para autenticação, usamos o endpoint com token na query string
    });

    // Reabre com token na URL (workaround para EventSource sem headers)
    es.close();

    // Usa fetch com ReadableStream para suportar Authorization header
    const controller = new AbortController();

    fetch(url, {
      headers: { Authorization: `Bearer ${authToken.value}` },
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        rpaStreamLogs.value.push({ level: "error", message: data.error || "Erro ao iniciar execucao.", ts: new Date().toISOString() });
        rpaStreamStatus.value = "error";
        current.lastExecution = data.error || "Erro ao iniciar execucao.";
        projectState.value = { ...projectState.value, [project.id]: { ...current, executionStatus: "idle" } };
        resolve();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processChunk = async () => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            rpaStreamStatus.value = rpaStreamStatus.value === "running" ? "success" : rpaStreamStatus.value;
            resolve();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop(); // guarda fragmento incompleto

          for (const part of parts) {
            const lines = part.split("\n");
            let eventName = "message";
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
            }

            if (!dataStr) continue;

            try {
              const payload = JSON.parse(dataStr);

              if (eventName === "progress") {
                // Captura qualquer log emitido pelo script (info, action, warn, error, success, progress)
                // Eventos de screenshot são tratados separadamente para atualizar o browser mockado
                if (payload.level === "screenshot") {
                  rpaScreenshot.value = payload.image;
                  rpaScreenshotUrl.value = payload.url || "";
                  rpaScreenshotLabel.value = payload.message || "";
                } else {
                  rpaStreamLogs.value.push(payload);
                }
              } else if (eventName === "done") {
                rpaStreamStatus.value = payload.ok ? "success" : "error";
                if (action === "test") {
                  current.lastTestResult = cleanRpaOutput(payload.stdout) || payload.message || "Teste executado.";
                } else {
                  current.lastExecution = cleanRpaOutput(payload.stdout) || payload.message || `Execucao concluida em ${new Date().toLocaleString("pt-BR")}.`;
                }
                if (payload.project) replaceProject(payload.project);
                await fetchNotifications();
                projectState.value = { ...projectState.value, [project.id]: { ...current, executionStatus: "idle" } };
                resolve();
                return;
              } else if (eventName === "error") {
                rpaStreamStatus.value = "error";
                rpaStreamLogs.value.push({ level: "error", message: payload.message || "Erro desconhecido.", ts: new Date().toISOString() });
                current.lastExecution = payload.message || "Erro ao executar.";
                projectState.value = { ...projectState.value, [project.id]: { ...current, executionStatus: "idle" } };
                resolve();
                return;
              }
            } catch {
              // ignora linha malformada
            }
          }

          processChunk();
        } catch (err) {
          if (err.name !== "AbortError") {
            rpaStreamStatus.value = "error";
            rpaStreamLogs.value.push({ level: "error", message: err.message, ts: new Date().toISOString() });
          }
          resolve();
        }
      };

      processChunk();
    }).catch((err) => {
      rpaStreamStatus.value = "error";
      rpaStreamLogs.value.push({ level: "error", message: err.message || "Falha na conexao.", ts: new Date().toISOString() });
      current.lastExecution = err.message || "Erro ao executar.";
      projectState.value = { ...projectState.value, [project.id]: { ...current, executionStatus: "idle" } };
      resolve();
    });
  });
}

function replaceProject(project) {
  const index = projects.value.findIndex((item) => item.id === project.id);
  if (index !== -1) projects.value[index] = project;
}

/**
 * Converte stdout bruto (JSON estruturado + screenshots) em texto limpo
 * para exibição no card do projeto.
 */
function cleanRpaOutput(rawOutput) {
  if (!rawOutput) return "";
  const lines = String(rawOutput).split("\n");
  const messages = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.level === "screenshot") continue; // ignora screenshots
      if (parsed.message) messages.push(parsed.message);
    } catch {
      messages.push(trimmed);
    }
  }
  // Retorna apenas as últimas 3 mensagens relevantes para o card
  return messages.slice(-3).join(" · ").slice(0, 200);
}

function toggleRunDetails(id) {
  expandedRunId.value = expandedRunId.value === id ? null : id;
}

function getLogStatusColor(status) {
  if (status === 'success') return 'bg-emerald-500';
  if (status === 'error') return 'bg-rose-500';
  return 'bg-amber-500';
}

function getLogStatusBadge(status) {
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  if (status === 'error') return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
  return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
}

function getLogAlertClass(status) {
  if (status === 'success') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
  if (status === 'error') return 'bg-rose-500/10 border-rose-500/20 text-rose-400';
  return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
}

function getLogAlertTitle(status) {
  if (status === 'success') return 'Execucao completa';
  if (status === 'error') return 'Erro critico';
  return 'Aviso';
}

function getLogAlertMessage(run) {
  if (run.status === 'success') return 'Execucao concluida com sucesso';
  if (run.status === 'error') return run.errorMessage || 'Erro ao executar rpa';
  return run.errorMessage || 'Execucao interrompida';
}

function handleSystemTypeChange() {
  if (form.systemType === "rpa") return;
  form.language = "javascript";
  form.code = "";
  form.rpaFile = "";
  form.rpaFileName = "";
  form.scheduleMode = "manual";
  form.scheduleHours = "";
  form.scheduleDates = "";
}

async function handleRpaFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  form.rpaFileName = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    form.rpaFile = ev.target.result;
  };
  reader.readAsDataURL(file);
}
</script>

<template>
  <main v-if="authLoading" class="min-h-screen flex items-center justify-center text-ink-400">Carregando...</main>

  <main v-else-if="!authUser" class="min-h-screen flex items-center justify-center px-4 py-10">
    <div class="w-full max-w-md bg-base-800 border border-[#d9eadf] rounded-[28px] p-7 shadow-soft">
      <p class="text-sm uppercase tracking-[0.24em] text-ink-400">Gestao de Desenvolvimentos</p>

      <form v-if="resetToken" class="mt-2" @submit.prevent="submitResetPassword">
        <h1 class="text-2xl font-semibold text-ink-100">Redefinir senha</h1>
        <p class="text-sm text-ink-400 mt-2">Defina sua nova senha para voltar ao sistema.</p>

        <div class="mt-5 space-y-3">
          <input
            v-model="resetPasswordForm.novaSenha"
            type="password"
            placeholder="Nova senha"
            class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3"
          />
          <input
            v-model="resetPasswordForm.confirmarSenha"
            type="password"
            placeholder="Confirmar nova senha"
            class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3"
          />
        </div>

        <p v-if="resetError" class="mt-3 text-sm text-[#0f5f43]">{{ resetError }}</p>
        <p v-if="resetMessage" class="mt-3 text-sm text-emerald-400">{{ resetMessage }}</p>

        <button type="submit" class="w-full mt-4 py-3 rounded-xl bg-accent-500 text-white font-semibold" :disabled="resetSubmitting">
          {{ resetSubmitting ? "Salvando..." : "Salvar nova senha" }}
        </button>

        <button type="button" class="w-full mt-2 py-3 rounded-xl bg-[#e7f6ed] text-accent-700 font-semibold" @click="resetToken = ''">
          Voltar ao login
        </button>
      </form>

      <form v-else class="mt-2" @submit.prevent="login">
        <h1 class="text-2xl font-brand font-semibold text-ink-100">Entrar</h1>

        <div class="mt-5 space-y-3">
          <input v-model="loginForm.email" type="email" placeholder="Email" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
          <input v-model="loginForm.password" type="password" placeholder="Senha" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        </div>

        <p v-if="authError" class="mt-3 text-sm text-[#0f5f43]">{{ authError }}</p>

        <button type="submit" class="w-full mt-4 py-3 rounded-xl bg-accent-500 text-white font-semibold" :disabled="authSubmitting">
          {{ authSubmitting ? "Entrando..." : "Entrar" }}
        </button>
      </form>

      <div v-if="!resetToken" class="mt-4">
        <button type="button" class="text-sm text-accent-700 underline" @click="showForgot = !showForgot; forgotForm.step = 1; forgotMessage = ''; forgotError = ''">
          {{ showForgot ? "Fechar recuperacao" : "Esqueci minha senha" }}
        </button>

        <div v-if="showForgot" class="mt-4 p-5 rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] shadow-inner">
          <p class="text-xs uppercase tracking-[0.2em] text-ink-400 mb-3">Recuperar Senha</p>
          
          <!-- Step 1: Email -->
          <form v-if="forgotForm.step === 1" class="space-y-3" @submit.prevent="requestForgotPassword">
            <p class="text-xs text-ink-300">Digite seu e-mail para receber o código de 6 dígitos.</p>
            <input
              v-model="forgotForm.email"
              type="email"
              placeholder="Seu email"
              class="w-full rounded-xl bg-white border border-[#d9eadf] px-3 py-3 text-sm focus:border-accent-500 outline-none transition-all"
              required
            />
            <button type="submit" class="w-full py-3 rounded-xl bg-accent-500 text-white font-semibold text-sm hover:bg-accent-600 transition-colors shadow-sm" :disabled="forgotSubmitting">
              {{ forgotSubmitting ? "Enviando..." : "Enviar Código" }}
            </button>
          </form>

          <!-- Step 2: 6-digit Code -->
          <form v-if="forgotForm.step === 2" class="space-y-3" @submit.prevent="verifyResetCode">
            <p class="text-xs text-ink-300">Digite o código enviado para <b>{{ forgotForm.email }}</b></p>
            <input
              v-model="forgotForm.code"
              type="text"
              placeholder="Código de 6 dígitos"
              maxlength="6"
              class="w-full rounded-xl bg-white border border-[#d9eadf] px-3 py-3 text-sm text-center font-mono tracking-[0.5em] focus:border-accent-500 outline-none transition-all"
              required
            />
            <button type="submit" class="w-full py-3 rounded-xl bg-accent-500 text-white font-semibold text-sm hover:bg-accent-600 transition-colors shadow-sm" :disabled="forgotSubmitting">
              {{ forgotSubmitting ? "Validando..." : "Validar Código" }}
            </button>
            <button type="button" class="w-full text-xs text-accent-700 underline" @click="forgotForm.step = 1">Voltar</button>
          </form>

          <!-- Step 3: New Password -->
          <form v-if="forgotForm.step === 3" class="space-y-3" @submit.prevent="submitResetPassword">
            <p class="text-xs text-ink-300">Defina sua nova senha de acesso.</p>
            <input
              v-model="forgotForm.novaSenha"
              type="password"
              placeholder="Nova senha"
              class="w-full rounded-xl bg-white border border-[#d9eadf] px-3 py-3 text-sm focus:border-accent-500 outline-none transition-all"
              required
            />
            <input
              v-model="forgotForm.confirmarSenha"
              type="password"
              placeholder="Confirmar nova senha"
              class="w-full rounded-xl bg-white border border-[#d9eadf] px-3 py-3 text-sm focus:border-accent-500 outline-none transition-all"
              required
            />
            <button type="submit" class="w-full py-3 rounded-xl bg-accent-500 text-white font-semibold text-sm hover:bg-accent-600 transition-colors shadow-sm" :disabled="forgotSubmitting">
              {{ forgotSubmitting ? "Salvando..." : "Salvar Nova Senha" }}
            </button>
          </form>

          <p v-if="forgotError" class="mt-3 text-xs text-[#0f5f43] font-medium">{{ forgotError }}</p>
          <p v-if="forgotMessage" class="mt-3 text-xs text-emerald-600 font-medium">{{ forgotMessage }}</p>
        </div>
      </div>
    </div>
  </main>

  <div v-else class="min-h-screen px-6 lg:px-12 py-8">
    <header class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] items-start">
      <div>
        <p class="text-sm uppercase tracking-[0.3em] text-ink-400">Unimed</p>
        <h1 class="text-3xl font-brand font-semibold text-ink-100">Catalogo de Sistemas</h1>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-base-800 border border-[#d9eadf]">
          <img v-if="authUser.foto" :src="authUser.foto" alt="Foto" class="w-8 h-8 rounded-full object-cover" />
          <div v-else class="w-8 h-8 rounded-full bg-base-700 flex items-center justify-center text-xs text-ink-300">U</div>
          <div>
            <span class="block text-sm text-ink-100">{{ currentDisplayName }}</span>
            <span class="block text-xs text-ink-400">{{ ROLE_LABELS[currentRole] }}</span>
          </div>
        </div>

        <div class="relative">
          <button class="relative flex items-center justify-center rounded-xl border border-[#d9eadf] bg-base-800 px-3 py-2 text-sm text-accent-700" @click="notificationsOpen = !notificationsOpen">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"></path>
              <path d="M10 17a2 2 0 0 0 4 0"></path>
            </svg>
            <span v-if="unreadNotificationsCount" class="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {{ unreadNotificationsCount }}
            </span>
          </button>

          <div v-if="notificationsOpen" class="absolute right-0 z-30 mt-2 w-[min(92vw,380px)] rounded-[24px] border border-[#d9eadf] bg-base-800 p-4 shadow-soft">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Comunicacao</p>
                <h3 class="mt-1 text-lg font-semibold text-ink-100">Notificacoes</h3>
              </div>
              <button class="text-sm text-accent-700" @click="markAllNotificationsRead">Ler todas</button>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <button
                v-for="group in ['all', 'tickets', 'rpa', 'system']"
                :key="group"
                type="button"
                class="rounded-full border px-3 py-1 text-xs font-semibold"
                :class="notificationFilter === group ? 'border-accent-500 bg-[#e7f6ed] text-accent-700' : 'border-[#d9eadf] bg-[#f7fcf9] text-ink-400'"
                @click="notificationFilter = group"
              >
                {{ notificationGroupLabel(group) }}
              </button>
            </div>

            <p v-if="notificationsLoading" class="mt-4 text-sm text-ink-400">Carregando notificacoes...</p>

            <div v-else-if="filteredNotifications.length" class="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              <button
                v-for="notification in filteredNotifications"
                :key="notification.id"
                type="button"
                class="w-full rounded-2xl border p-3 text-left"
                :class="notification.readAt ? 'border-[#d9eadf] bg-[#f7fcf9]' : 'border-accent-500 bg-white'"
                @click="openNotification(notification)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-[11px] uppercase tracking-[0.18em] text-ink-400">{{ notificationGroupLabel(notificationGroup(notification)) }}</p>
                    <p class="text-sm font-semibold text-ink-100">{{ notification.title }}</p>
                    <p class="mt-1 text-sm text-ink-400">{{ notification.body }}</p>
                  </div>
                  <span v-if="!notification.readAt" class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent-500"></span>
                </div>
                <p class="mt-2 text-xs text-ink-400">{{ formatDateTime(notification.createdAt) }}</p>
              </button>
            </div>

            <p v-else class="mt-4 rounded-2xl border border-dashed border-[#d9eadf] bg-[#f7fcf9] p-4 text-sm text-ink-400">
              Nenhuma notificacao para o filtro atual.
            </p>
          </div>
        </div>

        <button class="px-3 py-2 rounded-xl bg-base-800 border border-[#d9eadf] text-sm text-accent-700" @click="openSettings()">
          Configuracoes
        </button>
        <button v-if="canManageProjects" class="px-4 py-2 rounded-xl bg-accent-500 text-white font-semibold" @click="openCreate">+ Novo sistema</button>
        <button class="px-3 py-2 rounded-xl bg-[#e7f6ed] text-accent-700 text-sm font-semibold" @click="logout">Sair</button>
      </div>
    </header>

    <section class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article class="rounded-[24px] bg-base-800 border border-[#d9eadf] p-4 shadow-soft">
        <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Visiveis</p>
        <p class="mt-2 text-3xl font-brand font-semibold">{{ summaryStats.visible }}</p>
      </article>
      <article class="rounded-[24px] bg-base-800 border border-[#d9eadf] p-4 shadow-soft">
        <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Comuns</p>
        <p class="mt-2 text-3xl font-brand font-semibold">{{ summaryStats.common }}</p>
      </article>
      <article class="rounded-[24px] bg-base-800 border border-[#d9eadf] p-4 shadow-soft">
        <p class="text-xs uppercase tracking-[0.25em] text-ink-400">RPA</p>
        <p class="mt-2 text-3xl font-brand font-semibold">{{ summaryStats.rpa }}</p>
      </article>
      <article class="rounded-[24px] bg-base-800 border border-[#d9eadf] p-4 shadow-soft">
        <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Usuarios</p>
        <p class="mt-2 text-3xl font-brand font-semibold">{{ summaryStats.users }}</p>
      </article>
    </section>

    <section class="mt-6">
      <div class="space-y-4">
        <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
          <input v-model="query" type="text" placeholder="Buscar por nome, descricao, responsavel ou departamento" class="rounded-xl bg-base-800 border border-[#d9eadf] px-4 py-3" />
          <select v-model="projectTypeFilter" class="rounded-xl bg-base-800 border border-[#d9eadf] px-4 py-3">
            <option value="all">Todos os sistemas</option>
            <option value="common">Sistema Comum</option>
            <option value="rpa">Sistema RPA</option>
          </select>
          <button class="rounded-xl bg-[#e7f6ed] px-4 py-3 text-accent-700 font-semibold" @click="fetchProjects">Atualizar</button>
        </div>

        <p v-if="error" class="text-[#0f5f43]">{{ error }}</p>
        <p v-if="loading" class="text-ink-400">Carregando projetos...</p>

        <p v-if="!loading && filteredProjects.length === 0" class="rounded-2xl border border-dashed border-[#b7d8c3] bg-white/70 p-6 text-sm text-ink-400">
          Nenhum sistema encontrado para o escopo atual.
        </p>

        <section v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <article v-for="project in filteredProjects" :key="project.id" class="bg-base-800 border border-[#d9eadf] rounded-[24px] overflow-hidden shadow-soft">
            <div class="h-36 bg-[#eef8f2] flex items-center justify-center px-4 text-center">
              <img v-if="project.screenshot" :src="project.screenshot" alt="Preview" class="w-full h-full object-cover" />
              <div v-else class="space-y-1">
                <p class="text-xs uppercase tracking-[0.25em] text-accent-700">{{ getProjectCardBadge(project) }}</p>
                <p class="text-sm text-ink-400">Sem imagem</p>
              </div>
            </div>
            <div class="p-4 space-y-3">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-lg font-semibold text-ink-100">{{ project.nome }}</h3>
                  <p class="text-sm text-ink-400">{{ project.descricao }}</p>
                </div>
                <span class="shrink-0 rounded-full bg-[#e7f6ed] px-3 py-1 text-xs font-semibold text-accent-700">
                  {{ getProjectCardBadge(project) }}
                </span>
              </div>

              <div class="text-xs text-ink-300 flex flex-wrap gap-2">
                <span class="rounded-full bg-white/70 px-2 py-1">{{ project.ownerName || "Sem responsavel" }}</span>
                <span class="rounded-full bg-white/70 px-2 py-1">{{ project.department || "Sem departamento" }}</span>
                <span class="rounded-full bg-white/70 px-2 py-1">{{ project.status }}</span>
              </div>

              <div class="text-xs text-ink-300">{{ (project.tecnologias || []).join(", ") }}</div>

              <div v-if="getProjectMeta(project.id).systemType === 'rpa'" class="rounded-xl bg-[#f7fcf9] border border-[#d9eadf] p-3 text-xs text-ink-400 space-y-2">
                <div class="flex flex-wrap gap-2">
                  <span class="rounded-full bg-white px-2 py-1 text-accent-700 font-medium">{{ getProjectMeta(project.id).language || "javascript" }}</span>
                  <span class="rounded-full bg-white px-2 py-1 text-accent-700 font-medium">{{ projectScheduleSummary(project) }}</span>
                </div>
                <p v-if="projectState[project.id]?.lastExecution" class="text-[11px] text-accent-700">{{ projectState[project.id].lastExecution }}</p>
              </div>

              <div class="flex flex-wrap gap-2">
                <template v-if="getProjectMeta(project.id).systemType === 'rpa'">
                  <button v-if="canManageProjects" class="flex-1 py-2 rounded-lg bg-base-700 text-accent-700 font-semibold text-sm" @click="openEdit(project)">Detalhes</button>
                  <button v-if="canManageProjects" class="flex-1 py-2 rounded-lg bg-accent-600 text-white font-semibold text-sm" @click="triggerProjectAction(project, 'run')">Executar</button>
                  <button class="flex-1 py-2 rounded-lg bg-[#e7f6ed] text-accent-700 font-semibold text-sm" @click="openProjectLogs(project)">Logs</button>
                  <button v-if="canManageProjects" class="flex-1 py-2 rounded-lg bg-accent-500 text-white font-semibold text-sm" @click="deleteProject(project)">Excluir</button>
                </template>
                <template v-else>
                  <a :href="project.url" target="_blank" rel="noreferrer" class="flex-1 text-center py-2 rounded-lg bg-[#e7f6ed] text-accent-700 font-semibold text-sm">Abrir</a>
                  <button v-if="canManageProjects" class="px-3 py-2 rounded-lg bg-base-700 text-accent-700 font-semibold text-sm" @click="openEdit(project)">Editar</button>
                  <button v-if="canManageProjects" class="px-3 py-2 rounded-lg bg-accent-500 text-white font-semibold text-sm" @click="deleteProject(project)">Excluir</button>
                </template>
              </div>
            </div>
          </article>
        </section>
      </div>
    </section>

    <section class="mt-8 rounded-[28px] border border-[#d9eadf] bg-base-800 p-6 shadow-soft">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Chamados</p>
          <h2 class="text-2xl font-brand font-semibold text-ink-100">Central de chamados</h2>
          <p class="mt-2 text-sm text-ink-400">Canal para duvidas, incidentes, solicitacoes e tratativas com administradores.</p>
        </div>
        <button class="rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white" @click="openCreateTicket">Novo chamado</button>
      </div>

      <div class="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-2xl border border-[#d9eadf] bg-[#f7fcf9] p-4">
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Total</p>
          <p class="mt-2 text-3xl font-brand font-semibold text-ink-100">{{ ticketSummary.total }}</p>
        </article>
        <article class="rounded-2xl border border-[#d9eadf] bg-[#f7fcf9] p-4">
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Ativos</p>
          <p class="mt-2 text-3xl font-brand font-semibold text-ink-100">{{ ticketSummary.abertos }}</p>
        </article>
        <article class="rounded-2xl border border-[#d9eadf] bg-[#f7fcf9] p-4">
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Resolvidos</p>
          <p class="mt-2 text-3xl font-brand font-semibold text-ink-100">{{ ticketSummary.resolvidos }}</p>
        </article>
        <article class="rounded-2xl border border-[#d9eadf] bg-[#f7fcf9] p-4">
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Encerrados</p>
          <p class="mt-2 text-3xl font-brand font-semibold text-ink-100">{{ ticketSummary.encerrados }}</p>
        </article>
      </div>

      <div class="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_160px]">
        <input v-model="ticketQuery" type="text" placeholder="Buscar por numero, titulo, descricao ou solicitante" class="rounded-xl bg-[#f7fcf9] border border-[#d9eadf] px-4 py-3" />
        <select v-model="ticketStatusFilter" class="rounded-xl bg-[#f7fcf9] border border-[#d9eadf] px-4 py-3">
          <option value="all">Todos os status</option>
          <option value="aberto">Aberto</option>
          <option value="em_tratamento">Em tratamento</option>
          <option value="aguardando_resposta_usuario">Aguardando usuario</option>
          <option value="resolvido">Resolvido</option>
          <option value="encerrado">Encerrado</option>
        </select>
        <select v-model="ticketCategoryFilter" class="rounded-xl bg-[#f7fcf9] border border-[#d9eadf] px-4 py-3">
          <option value="all">Todas as categorias</option>
          <option value="solicitacao">Solicitacao</option>
          <option value="duvida">Duvida</option>
          <option value="incidente">Incidente</option>
          <option value="outro">Outro</option>
        </select>
        <select v-model="ticketSystemTypeFilter" class="rounded-xl bg-[#f7fcf9] border border-[#d9eadf] px-4 py-3">
          <option value="all">Todos os sistemas</option>
          <option value="common">Comum</option>
          <option value="rpa">RPA</option>
        </select>
        <button class="rounded-xl bg-[#e7f6ed] px-4 py-3 text-accent-700 font-semibold" @click="fetchTickets">Atualizar</button>
      </div>

      <p v-if="ticketsError" class="mt-4 text-sm text-[#0f5f43]">{{ ticketsError }}</p>
      <p v-if="ticketsLoading" class="mt-4 text-sm text-ink-400">Carregando chamados...</p>

      <div v-else-if="filteredTickets.length" class="mt-5 overflow-hidden rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9]">
        <div class="hidden grid-cols-[120px_220px_minmax(0,1fr)_120px_90px_150px] gap-3 border-b border-[#d9eadf] bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-400 lg:grid">
          <span>Id Ticket</span>
          <span>Solicitante</span>
          <span>Descricao</span>
          <span>Data</span>
          <span>Hora</span>
          <span>Status</span>
        </div>

        <div class="divide-y divide-[#d9eadf]">
          <button
            v-for="ticket in paginatedTickets"
            :key="ticket.id"
            type="button"
            class="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-white/70 lg:grid-cols-[120px_220px_minmax(0,1fr)_120px_90px_150px] lg:items-center"
            @click="openTicketDetails(ticket)"
          >
            <div class="lg:hidden">
              <p class="text-[11px] uppercase tracking-[0.18em] text-ink-400">Ticket #{{ ticket.number }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <p class="text-sm font-semibold text-ink-100">{{ ticket.requesterName || authUser.nome }}</p>
                <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent-700">{{ ticketStatusLabel(ticket.status) }}</span>
              </div>
              <p class="mt-2 text-sm text-ink-400">{{ ticket.descricao }}</p>
              <p class="mt-2 text-xs text-ink-400">{{ formatDate(ticket.createdAt) }} {{ formatTime(ticket.createdAt) }}</p>
            </div>

            <span class="hidden text-sm font-semibold text-ink-100 lg:block">#{{ ticket.number }}</span>
            <span class="hidden truncate text-sm text-ink-400 lg:block">{{ ticket.requesterName || authUser.nome }}</span>
            <span class="hidden truncate text-sm text-ink-400 lg:block">{{ ticket.descricao }}</span>
            <span class="hidden text-sm text-ink-400 lg:block">{{ formatDate(ticket.createdAt) }}</span>
            <span class="hidden text-sm text-ink-400 lg:block">{{ formatTime(ticket.createdAt) }}</span>
            <span class="hidden lg:block">
              <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent-700">{{ ticketStatusLabel(ticket.status) }}</span>
            </span>
          </button>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9eadf] bg-white px-4 py-3">
          <p class="text-sm text-ink-400">Pagina {{ ticketPage }} de {{ totalTicketPages }}</p>
          <div class="flex items-center gap-2">
            <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="ticketPage === 1" @click="ticketPage = 1"><<</button>
            <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="ticketPage === 1" @click="ticketPage -= 1"><</button>
            <span class="min-w-20 text-center text-sm text-ink-400">{{ ticketPage }} de {{ totalTicketPages }}</span>
            <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="ticketPage === totalTicketPages" @click="ticketPage += 1">></button>
            <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="ticketPage === totalTicketPages" @click="ticketPage = totalTicketPages">>></button>
          </div>
        </div>
      </div>

      <p v-else-if="!ticketsLoading" class="mt-5 rounded-2xl border border-dashed border-[#d9eadf] bg-white/70 p-6 text-sm text-ink-400">
        Nenhum chamado encontrado para os filtros atuais.
      </p>
    </section>

  </div>

  <div v-if="settingsOpen" class="fixed inset-0 z-40 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4 py-6">
    <div class="bg-base-800 border border-[#d9eadf] rounded-[28px] w-full max-w-6xl max-h-[92vh] overflow-hidden shadow-soft">
      <div class="grid max-h-[92vh] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside class="border-b border-[#d9eadf] bg-[#f7fcf9] p-4 lg:border-b-0 lg:border-r">
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Configuracoes</p>
          <h2 class="mt-2 text-2xl font-brand font-semibold text-ink-100">Painel do usuario</h2>
          <div class="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <button
              v-for="tab in settingsTabs"
              :key="tab.id"
              type="button"
              class="rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition"
              :class="settingsTab === tab.id ? 'border-accent-500 bg-white text-accent-700' : 'border-[#d9eadf] bg-white/70 text-ink-400'"
              @click="settingsTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
        </aside>

        <div class="min-h-0 min-w-0 overflow-y-auto p-4 sm:p-6">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-ink-400">
                {{ settingsTabs.find((tab) => tab.id === settingsTab)?.label }}
              </p>
              <h3 class="mt-2 text-2xl font-brand font-semibold text-ink-100">
                {{
                  settingsTab === "profile"
                    ? "Perfil do usuario"
                    : settingsTab === "users"
                      ? "Gestao de usuarios"
                      : "Documentacao"
                }}
              </h3>
            </div>
            <button type="button" class="rounded-xl border border-[#d9eadf] px-3 py-2 text-sm text-accent-700" @click="closeSettings">Fechar</button>
          </div>

          <div v-if="settingsTab === 'profile'" class="mt-6 space-y-4">
            <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div class="rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-5">
                <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Resumo</p>
                <div class="mt-4 flex items-center gap-4">
                  <img v-if="authUser.foto" :src="authUser.foto" alt="Foto" class="h-20 w-20 rounded-3xl object-cover" />
                  <div v-else class="flex h-20 w-20 items-center justify-center rounded-3xl bg-base-700 text-lg font-semibold text-ink-300">
                    {{ (currentDisplayName || "U").slice(0, 1).toUpperCase() }}
                  </div>
                  <div class="min-w-0">
                    <p class="truncate text-xl font-semibold text-ink-100">{{ currentDisplayName || "Usuario" }}</p>
                    <p class="mt-1 break-all text-sm text-ink-400">{{ authUser.email }}</p>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent-700">{{ ROLE_LABELS[currentRole] }}</span>
                      <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink-400">{{ currentDepartment || "Sem departamento" }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-5">
                <p class="text-sm font-semibold text-ink-100">Foto do usuario</p>
                <p class="mt-2 text-sm text-ink-400">Atualize sua imagem de perfil para identificacao no sistema.</p>
                <input type="file" accept="image/*" class="mt-4 block w-full text-sm text-ink-400" @change="handlePhotoChange" />
                <p v-if="settingsState.message" class="mt-3 text-xs text-accent-700">{{ settingsState.message }}</p>
              </div>
            </div>

            <form class="rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-5" @submit.prevent="changePassword">
              <p class="text-sm font-semibold text-ink-100">Redefinir senha</p>
              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <input v-model="settingsState.passwordForm.senhaAtual" type="password" placeholder="Senha atual" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
                <input v-model="settingsState.passwordForm.novaSenha" type="password" placeholder="Nova senha" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
                <input v-model="settingsState.passwordForm.confirmarSenha" type="password" placeholder="Confirmar senha" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
              </div>

              <p v-if="settingsState.passwordError" class="mt-3 text-xs text-[#0f5f43]">{{ settingsState.passwordError }}</p>
              <p v-if="settingsState.passwordMessage" class="mt-3 text-xs text-accent-700">{{ settingsState.passwordMessage }}</p>

              <button type="submit" class="mt-4 rounded-xl bg-accent-500 px-5 py-3 text-sm font-semibold text-white" :disabled="settingsState.passwordSaving">
                {{ settingsState.passwordSaving ? "Salvando..." : "Salvar nova senha" }}
              </button>
            </form>
          </div>

          <div v-else-if="settingsTab === 'users'" class="mt-6">
            <div v-if="canManageUsers" class="space-y-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-ink-400">Edite usuarios existentes e gerencie acessos conforme o papel logado.</p>
                <button v-if="canCreateUsers" class="rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white" @click="openCreateUser">Novo usuario</button>
              </div>

              <p v-if="userFormError" class="text-sm text-[#0f5f43]">{{ userFormError }}</p>
              <p v-if="userFormMessage" class="text-sm text-accent-700">{{ userFormMessage }}</p>

              <div v-if="visibleUsers().length" class="mt-5 overflow-hidden rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9]">
                <div class="hidden grid-cols-[minmax(0,1fr)_200px_180px_150px_60px] gap-3 border-b border-[#d9eadf] bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-400 lg:grid">
                  <span>Nome / Email</span>
                  <span>Departamento</span>
                  <span>Perfil</span>
                  <span>Status</span>
                  <span></span>
                </div>

                <div class="divide-y divide-[#d9eadf]">
                  <div
                    v-for="user in paginatedUsers"
                    :key="user.email"
                    class="grid w-full gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_200px_180px_150px_60px] lg:items-center"
                  >
                    <!-- Mobile view -->
                    <div class="lg:hidden flex justify-between items-start">
                      <div>
                        <p class="text-sm font-semibold text-ink-100">{{ user.nome }}</p>
                        <p class="text-xs text-ink-400">{{ user.email }}</p>
                        <div class="mt-2 flex flex-wrap gap-2">
                          <span class="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-accent-700">{{ ROLE_LABELS[user.role] }}</span>
                          <span class="text-[10px] text-ink-400">{{ user.departamento || "Sem departamento" }}</span>
                        </div>
                      </div>
                      
                      <div class="relative">
                        <button 
                          class="p-2 rounded-lg hover:bg-white transition-colors"
                          @click="userActionsMenu = userActionsMenu === user.email ? '' : user.email"
                        >
                          <svg viewBox="0 0 24 24" class="w-5 h-5 text-ink-400" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                        </button>
                        <div v-if="userActionsMenu === user.email" class="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-[#d9eadf] bg-white p-1 shadow-lg">
                          <button class="w-full text-left px-3 py-2 text-sm text-ink-100 hover:bg-[#e7f6ed] hover:text-accent-700 rounded-lg transition-colors" @click="openEditUser(user); userActionsMenu = ''">Editar</button>
                          <button v-if="canDeleteUsers && user.email !== authUser.email" class="w-full text-left px-3 py-2 text-sm text-accent-600 hover:bg-accent-50 rounded-lg transition-colors" @click="deleteUser(user); userActionsMenu = ''">Excluir</button>
                        </div>
                      </div>
                    </div>

                    <!-- Desktop view columns -->
                    <div class="hidden lg:block min-w-0">
                      <p class="truncate text-sm font-semibold text-ink-100">{{ user.nome }}</p>
                      <p class="truncate text-xs text-ink-400">{{ user.email }}</p>
                    </div>
                    <span class="hidden lg:block truncate text-sm text-ink-400">{{ user.departamento || "Nao informado" }}</span>
                    <span class="hidden lg:block">
                      <span class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-accent-700">{{ ROLE_LABELS[user.role] }}</span>
                    </span>
                    <span class="hidden lg:block text-xs text-ink-400">
                      {{ user.senhaDefinida ? "Senha definida" : "Sem senha" }}
                    </span>
                    <div class="hidden lg:flex justify-end relative">
                      <button 
                        class="p-1 rounded-lg hover:bg-white transition-colors"
                        @click="userActionsMenu = userActionsMenu === user.email ? '' : user.email"
                      >
                        <svg viewBox="0 0 24 24" class="w-5 h-5 text-ink-400" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                      </button>
                      <div v-if="userActionsMenu === user.email" class="absolute right-0 top-full z-10 mt-1 w-40 rounded-xl border border-[#d9eadf] bg-white p-1 shadow-lg">
                        <button class="w-full text-left px-3 py-2 text-sm text-ink-100 hover:bg-[#e7f6ed] hover:text-accent-700 rounded-lg transition-colors" @click="openEditUser(user); userActionsMenu = ''">Editar</button>
                        <button v-if="canDeleteUsers && user.email !== authUser.email" class="w-full text-left px-3 py-2 text-sm text-accent-600 hover:bg-accent-50 rounded-lg transition-colors" @click="deleteUser(user); userActionsMenu = ''">Excluir</button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- User Pagination -->
                <div class="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9eadf] bg-white px-4 py-3">
                  <p class="text-sm text-ink-400">Pagina {{ userPage }} de {{ totalUserPages }}</p>
                  <div class="flex items-center gap-2">
                    <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="userPage === 1" @click="userPage = 1">
                      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
                    </button>
                    <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="userPage === 1" @click="userPage -= 1">
                      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span class="min-w-16 text-center text-sm text-ink-400 font-medium">{{ userPage }} / {{ totalUserPages }}</span>
                    <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="userPage === totalUserPages" @click="userPage += 1">
                      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                    <button class="rounded-lg border border-[#d9eadf] px-3 py-2 text-sm text-accent-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="userPage === totalUserPages" @click="userPage = totalUserPages">
                      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <p v-else class="rounded-2xl border border-dashed border-[#d9eadf] bg-white/70 p-6 text-sm text-ink-400">
                Nenhum usuario disponivel para este perfil.
              </p>
            </div>

            <div v-else class="rounded-[24px] border border-dashed border-[#d9eadf] bg-[#f7fcf9] p-6 text-sm text-ink-400">
              Apenas Admin e Super Admin podem visualizar a gestao de usuarios.
            </div>
          </div>

          <div v-else class="mt-6 space-y-6 pb-10">
            <!-- Guia de Desenvolvimento RPA -->
            <section class="rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-6 shadow-sm">
              <h4 class="text-lg font-bold text-accent-700 flex items-center gap-2">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14.5 2 14.5 7.5 20 7.5"/></svg>
                Guia de Desenvolvimento RPA
              </h4>
              <p class="mt-3 text-sm text-ink-400 leading-relaxed">
                O motor RPA da plataforma executa scripts em ambientes isolados temporários. Todos os arquivos que você faz upload na aba "Arquivos de Recurso" são colocados diretamente na <b>mesma pasta</b> onde o seu script será executado.
              </p>
              
              <div class="mt-5 grid md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <p class="text-xs font-bold text-ink-300 uppercase tracking-widest">Acesso a Arquivos (Python)</p>
                  <pre class="p-4 rounded-xl bg-[#0d0e12] text-[12px] font-mono text-emerald-400 overflow-x-auto"># Lendo um Excel enviado
import pandas as pd
df = pd.read_excel("meu_arquivo.xlsx")

# Lendo TXT
with open("config.txt", "r") as f:
    data = f.read()</pre>
                </div>
                <div class="space-y-2">
                  <p class="text-xs font-bold text-ink-300 uppercase tracking-widest">Acesso a Arquivos (Node.js)</p>
                  <pre class="p-4 rounded-xl bg-[#0d0e12] text-[12px] font-mono text-emerald-400 overflow-x-auto">// Lendo um Excel enviado
const XLSX = require("xlsx");
const workbook = XLSX.readFile("meu_arquivo.xlsx");

// Lendo TXT
const fs = require("fs");
const data = fs.readFileSync("config.txt", "utf8");</pre>
                </div>
              </div>
            </section>

            <!-- Automação Web (Playwright) -->
            <section class="rounded-[24px] border border-[#d9eadf] bg-white p-6 shadow-sm">
              <h4 class="text-lg font-bold text-ink-100 flex items-center gap-2">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                Automação Web (Playwright)
              </h4>
              <p class="mt-2 text-sm text-ink-400">
                Para automações em navegadores, recomendamos o uso de configurações otimizadas para o ambiente de servidor:
              </p>

              <div class="mt-4 grid md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <p class="text-xs font-bold text-ink-300 uppercase tracking-widest">Exemplo Python</p>
                  <pre class="p-4 rounded-xl bg-base-700 text-[11px] font-mono text-ink-100 overflow-x-auto">browser = p.chromium.launch(
  headless=True,
  args=["--no-sandbox", "--disable-dev-shm-usage"]
)
ctx = browser.new_context(ignore_https_errors=True)
page = ctx.new_page()
page.goto("https://...", timeout=60000)</pre>
                </div>
                <div class="space-y-2">
                  <p class="text-xs font-bold text-ink-300 uppercase tracking-widest">Exemplo JavaScript</p>
                  <pre class="p-4 rounded-xl bg-base-700 text-[11px] font-mono text-ink-100 overflow-x-auto">const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true
});
const page = await ctx.newPage();</pre>
                </div>
              </div>
            </section>

            <!-- Automação Windows/Desktop -->
            <section class="rounded-[24px] border border-[#d9eadf] bg-white p-6 shadow-sm">
              <h4 class="text-lg font-bold text-ink-100 flex items-center gap-2">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                Interação com Windows (Desktop)
              </h4>
              <p class="mt-2 text-sm text-ink-400">
                Para automatizar aplicações que não são web (cliques em ícones, preenchimento de forms desktop, atalhos de teclado), utilize as bibliotecas abaixo:
              </p>

              <div class="mt-4 space-y-4">
                <div class="border-l-4 border-accent-500 pl-4">
                  <p class="text-sm font-bold text-ink-100">Python: PyAutoGUI & OpenCV</p>
                  <p class="text-xs text-ink-400 mt-1">Permite simular teclado, mouse e localizar imagens na tela.</p>
                  <pre class="mt-2 p-3 rounded-xl bg-base-700 text-[11px] font-mono text-ink-100">import pyautogui
# Clique por imagem (precisa subir a imagem do botao)
pos = pyautogui.locateOnScreen('botao_enviar.png')
pyautogui.click(pos)
# Digitar texto e atalhos
pyautogui.write('Olá Mundo!', interval=0.1)
pyautogui.hotkey('ctrl', 's')</pre>
                </div>

                <div class="border-l-4 border-emerald-500 pl-4">
                  <p class="text-sm font-bold text-ink-100">JavaScript: RobotJS / Nut-JS</p>
                  <p class="text-xs text-ink-400 mt-1">Bibliotecas nativas para controle de periféricos via Node.js.</p>
                  <pre class="mt-2 p-3 rounded-xl bg-base-700 text-[11px] font-mono text-ink-100">const robot = require("robotjs");
// Mover e clicar
robot.moveMouse(100, 200);
robot.mouseClick();
// Teclado
robot.typeString("Digitando no Windows...");
robot.keyTap("enter");</pre>
                </div>
              </div>
            </section>

            <!-- Dicas e Boas Práticas -->
            <div class="grid md:grid-cols-2 gap-4">
              <div class="rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-5">
                <p class="text-sm font-semibold text-ink-100">Boas Práticas</p>
                <ul class="mt-3 space-y-2 text-xs text-ink-400 list-disc pl-4">
                  <li>Sempre use <b>Timeouts</b> adequados para evitar processos zumbis.</li>
                  <li>Em automações Windows, use <code class="text-accent-700">pyautogui.PAUSE = 1.0</code> para dar tempo entre as ações.</li>
                  <li>Prefira seletores ID/CSS em Web (Playwright) em vez de cliques por coordenada.</li>
                </ul>
              </div>

              <div class="rounded-[24px] border border-[#d9eadf] bg-base-700 p-5">
                <p class="text-sm font-semibold text-ink-100">Ambiente</p>
                <p class="mt-3 text-xs text-ink-400">
                  O sistema já possui pré-instalado: <b>Pandas, Playwright, OpenPyXL</b> e <b>Nodemailer</b>. Se precisar de bibliotecas extras, solicite ao administrador a instalação via pip/npm no servidor.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-if="ticketFormOpen" class="fixed inset-0 z-40 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4">
    <form class="w-full max-w-2xl rounded-[28px] border border-[#d9eadf] bg-base-800 p-6 shadow-soft" @submit.prevent="saveTicket">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Chamados</p>
          <h2 class="text-2xl font-brand font-semibold text-ink-100">Novo chamado</h2>
        </div>
        <button type="button" class="rounded-xl border border-[#d9eadf] px-3 py-2 text-sm text-accent-700" @click="ticketFormOpen = false">Fechar</button>
      </div>

      <div class="mt-5 grid gap-3 md:grid-cols-2">
        <input v-model="ticketForm.titulo" type="text" placeholder="Titulo do chamado" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3 md:col-span-2" />
        <select v-model="ticketForm.categoria" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
          <option value="solicitacao">Solicitacao</option>
          <option value="duvida">Duvida</option>
          <option value="incidente">Incidente</option>
          <option value="outro">Outro</option>
        </select>
        <select v-model="ticketForm.prioridade" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
          <option value="baixa">Baixa</option>
          <option value="media">Media</option>
          <option value="alta">Alta</option>
          <option value="critica">Critica</option>
        </select>
        <select v-model="ticketForm.projectId" class="rounded-xl bg-base-800 border border-[#d9eadf] px-4 py-3 text-sm focus:border-accent-500 outline-none transition-all">
          <option value="">Sem vinculo com sistema</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.nome }}</option>
        </select>
        <select v-model="ticketForm.systemType" class="rounded-xl bg-base-800 border border-[#d9eadf] px-4 py-3 text-sm focus:border-accent-500 outline-none transition-all">
          <option value="common">Sistema Comum</option>
          <option value="rpa">RPA</option>
        </select>
        <textarea v-model="ticketForm.descricao" rows="6" placeholder="Descreva a necessidade, contexto, impacto e resultado esperado" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3 md:col-span-2"></textarea>
      </div>

      <p v-if="ticketFormError" class="mt-3 text-sm text-[#0f5f43]">{{ ticketFormError }}</p>

      <div class="mt-4 flex gap-2">
        <button type="submit" class="flex-1 rounded-xl bg-accent-500 py-3 font-semibold text-white" :disabled="ticketFormSubmitting">
          {{ ticketFormSubmitting ? "Abrindo..." : "Abrir chamado" }}
        </button>
        <button type="button" class="flex-1 rounded-xl bg-[#e7f6ed] py-3 font-semibold text-accent-700" @click="ticketFormOpen = false">Cancelar</button>
      </div>
    </form>
  </div>

  <div v-if="ticketDetailsOpen" class="fixed inset-0 z-40 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-3 py-3 sm:px-4 sm:py-6">
    <div class="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-[#d9eadf] bg-base-800 shadow-soft">
      <div class="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div class="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div v-if="ticketDetails">
              <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Ticket #{{ ticketDetails.number }}</p>
              <h2 class="mt-2 text-2xl font-brand font-semibold text-ink-100">{{ ticketDetails.titulo }}</h2>
              <div class="mt-3 flex flex-wrap gap-2 text-xs text-ink-300">
                <span class="rounded-full bg-[#f7fcf9] px-3 py-1">{{ ticketStatusLabel(ticketDetails.status) }}</span>
                <span class="rounded-full bg-[#f7fcf9] px-3 py-1">{{ ticketCategoryLabel(ticketDetails.categoria) }}</span>
                <span class="rounded-full bg-[#f7fcf9] px-3 py-1">{{ ticketPriorityLabel(ticketDetails.prioridade) }}</span>
              </div>
            </div>
            <button type="button" class="rounded-xl border border-[#d9eadf] px-3 py-2 text-sm text-accent-700" @click="ticketDetailsOpen = false">Fechar</button>
          </div>

          <p v-if="ticketDetailsError" class="mt-4 text-sm text-[#0f5f43]">{{ ticketDetailsError }}</p>
          <p v-if="ticketDetailsLoading" class="mt-4 text-sm text-ink-400">Carregando chamado...</p>

          <template v-else-if="ticketDetails">
            <div class="mt-5 rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-4 sm:p-5">
              <p class="text-sm font-semibold text-ink-100">Descricao inicial</p>
              <p class="mt-3 whitespace-pre-wrap text-sm text-ink-400">{{ ticketDetails.descricao }}</p>
            </div>

            <div class="mt-5 flex min-h-0 flex-col rounded-[24px] border border-[#d9eadf] bg-[#f7fcf9] p-4 sm:p-5">
              <div class="flex items-center justify-between gap-3">
                <p class="text-sm font-semibold text-ink-100">Conversas e tratativas</p>
                <span class="text-xs text-ink-400">{{ ticketMessages.length }} interacao(oes)</span>
              </div>
              <div class="mt-4 flex-1 space-y-3 overflow-y-auto pr-1 max-h-[34vh] sm:max-h-[42vh] xl:max-h-none">
                <article v-for="message in ticketMessages" :key="message.id" class="rounded-2xl border border-[#d9eadf] bg-white p-4">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p class="text-sm font-semibold text-ink-100">{{ message.authorName || message.authorEmail }}</p>
                      <p class="text-xs text-ink-400">{{ ROLE_LABELS[message.authorRole] || "Usuario" }}</p>
                    </div>
                    <p class="text-xs text-ink-400">{{ formatDateTime(message.createdAt) }}</p>
                  </div>
                  <p class="mt-3 whitespace-pre-wrap text-sm text-ink-400">{{ message.body }}</p>
                  <p v-if="message.fromStatus || message.toStatus" class="mt-2 text-xs text-accent-700">
                    {{ ticketStatusLabel(message.fromStatus) }} -> {{ ticketStatusLabel(message.toStatus) }}
                  </p>
                </article>
              </div>

              <div v-if="ticketDetails.status !== 'encerrado'" class="mt-4 border-t border-[#d9eadf] pt-4">
                <textarea v-model="ticketReply" rows="4" placeholder="Escreva sua resposta ou complemento do chamado" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3"></textarea>
                
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <!-- Admin Actions -->
                  <div v-if="canManageTickets" class="relative flex items-center">
                    <button 
                      type="button" 
                      class="rounded-l-xl bg-accent-500 px-5 py-2.5 font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50" 
                      :disabled="ticketReplySubmitting" 
                      @click="sendTicketReply"
                    >
                      {{ ticketReplySubmitting ? "Enviando..." : "Enviar Resposta" }}
                    </button>
                    <div class="relative">
                      <button 
                        type="button" 
                        class="border-l border-white/20 rounded-r-xl bg-accent-500 px-2 py-2.5 text-white hover:bg-accent-600 transition-colors"
                        @click="ticketActionsMenuOpen = !ticketActionsMenuOpen"
                      >
                        <svg viewBox="0 0 24 24" class="w-5 h-5 transition-transform" :class="{ 'rotate-180': ticketActionsMenuOpen }" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      
                      <div v-if="ticketActionsMenuOpen" class="absolute bottom-full right-0 mb-2 w-48 rounded-2xl border border-[#d9eadf] bg-white p-1.5 shadow-xl ring-1 ring-black/5">
                        <button class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink-100 hover:bg-[#e7f6ed] hover:text-accent-700 transition-colors" @click="sendAdminReply('validate')">
                          Validar Analise
                        </button>
                        <button class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-accent-600 hover:bg-accent-50 transition-colors" @click="sendAdminReply('finalize')">
                          Finalizar Chamado
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Requester Actions -->
                  <template v-else>
                    <button 
                      type="button" 
                      class="rounded-xl bg-accent-500 px-5 py-2.5 font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50" 
                      :disabled="ticketReplySubmitting" 
                      @click="sendTicketReply"
                    >
                      {{ ticketReplySubmitting ? "Enviando..." : "Enviar Resposta" }}
                    </button>
                    
                    <div v-if="ticketDetails.status === 'resolvido'" class="flex gap-2">
                      <button 
                        type="button" 
                        class="rounded-xl bg-emerald-500 px-5 py-2.5 font-semibold text-white hover:bg-emerald-600 transition-colors shadow-sm"
                        @click="acceptAdjustment"
                      >
                        Aceitar Ajuste
                      </button>
                      <button 
                        type="button" 
                        class="rounded-xl bg-accent-600 px-5 py-2.5 font-semibold text-white hover:bg-accent-700 transition-colors shadow-sm"
                        @click="rejectAdjustment"
                      >
                        Rejeitar Ajuste
                      </button>
                    </div>
                  </template>
                </div>
              </div>

              <div v-else class="mt-4 rounded-2xl bg-base-700 p-4 text-center">
                <p class="text-sm font-medium text-ink-400">Este chamado foi encerrado e nao permite novas interacoes.</p>
              </div>
            </div>
          </template>
        </div>

        <aside class="min-h-0 min-w-0 overflow-y-auto border-t border-[#d9eadf] bg-[#f7fcf9] p-4 sm:p-5 xl:border-l xl:border-t-0">
          <template v-if="ticketDetails">
            <div class="space-y-4">
              <div class="rounded-2xl border border-[#d9eadf] bg-white p-4 text-sm text-ink-400">
                <p><strong class="text-ink-100">Solicitante:</strong> {{ ticketDetails.requesterName || ticketDetails.requesterEmail }}</p>
                <p class="mt-2"><strong class="text-ink-100">Email:</strong> {{ ticketDetails.requesterEmail }}</p>
                <p class="mt-2"><strong class="text-ink-100">Departamento:</strong> {{ ticketDetails.departmentName || "Nao informado" }}</p>
                <p class="mt-2"><strong class="text-ink-100">Projeto:</strong> {{ ticketDetails.projectName || "Nao vinculado" }}</p>
                <p class="mt-2"><strong class="text-ink-100">Criado em:</strong> {{ formatDateTime(ticketDetails.createdAt) }}</p>
                <p class="mt-2"><strong class="text-ink-100">Atualizado em:</strong> {{ formatDateTime(ticketDetails.updatedAt) }}</p>
              </div>

              <div v-if="canManageTickets" class="rounded-2xl border border-[#d9eadf] bg-white p-4 shadow-sm">
                <p class="text-sm font-bold text-ink-100 flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-accent-500"></span>
                  Painel de tratamento
                </p>
                <div class="mt-4 space-y-3">
                  <select v-model="ticketStatusDraft" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
                    <option value="aberto">Aberto</option>
                    <option value="em_tratamento">Em tratamento</option>
                    <option value="aguardando_resposta_usuario">Aguardando resposta do usuario</option>
                    <option value="resolvido">Resolvido</option>
                    <option value="encerrado">Encerrado</option>
                  </select>
                  <select v-model="ticketPriorityDraft" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
                    <option value="baixa">Baixa</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                    <option value="critica">Critica</option>
                  </select>
                  <select v-model="ticketAssignedDraft" class="w-full rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
                    <option value="">Sem responsavel definido</option>
                    <option v-for="user in assignableTicketUsers" :key="user.id" :value="user.id">{{ user.nome }} - {{ ROLE_LABELS[user.role] }}</option>
                  </select>
                </div>
                <button type="button" class="mt-4 w-full rounded-xl bg-accent-500 py-3 font-semibold text-white" :disabled="ticketUpdateSubmitting" @click="updateTicket">
                  {{ ticketUpdateSubmitting ? "Salvar Alteracoes" : "Salvar Alteracoes" }}
                </button>
              </div>

              <div v-else class="rounded-2xl border border-[#d9eadf] bg-white p-4 text-sm text-ink-400">
                <p class="font-semibold text-ink-100">Status atual</p>
                <p class="mt-2">{{ ticketStatusLabel(ticketDetails.status) }}</p>
                <p class="mt-3 font-semibold text-ink-100">Tratativa final</p>
                <p class="mt-2 whitespace-pre-wrap">{{ ticketDetails.resolutionSummary || "Ainda sem tratativa final registrada." }}</p>
              </div>
            </div>
          </template>
        </aside>
      </div>
    </div>
  </div>

  <div v-if="userFormOpen" class="fixed inset-0 z-50 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4">
    <form class="bg-base-800 border border-[#d9eadf] rounded-[28px] p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-soft" @submit.prevent="saveUserProfile">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ userFormMode === "create" ? "Novo usuario" : "Editar usuario" }}</h2>
        <button type="button" @click="userFormOpen = false">X</button>
      </div>

      <div class="grid md:grid-cols-2 gap-3 mt-4">
        <input v-model="userForm.nome" type="text" placeholder="Nome*" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" :disabled="!canEditUserIdentity" />
        <input v-model="userForm.email" type="email" placeholder="Email*" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <select v-model="userForm.role" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" :disabled="!canEditUserRole">
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="user">Usuario</option>
        </select>
        <input v-model="userForm.departamento" list="department-options" type="text" placeholder="Departamento" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" :disabled="!canEditUserIdentity" />
        <input v-model="userForm.senha" type="password" :placeholder="userFormMode === 'create' ? 'Senha' : 'Nova senha'" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <input v-model="userForm.confirmarSenha" type="password" :placeholder="userFormMode === 'create' ? 'Confirmar senha' : 'Confirmar nova senha'" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
      </div>
      <p class="mt-3 text-xs text-ink-400">Admin altera email e senha. Super Admin cria usuarios, define perfis e departamento.</p>
      <p v-if="userFormError" class="mt-3 text-sm text-[#0f5f43]">{{ userFormError }}</p>
      <p v-if="userFormMessage" class="mt-2 text-sm text-accent-700">{{ userFormMessage }}</p>

      <div class="mt-4 flex gap-2">
        <button type="submit" class="flex-1 py-3 rounded-xl bg-accent-500 text-white font-semibold">{{ userFormMode === "create" ? "Criar" : "Salvar" }}</button>
        <button type="button" class="flex-1 py-3 rounded-xl bg-[#e7f6ed] text-accent-700 font-semibold" @click="userFormOpen = false">Cancelar</button>
      </div>
    </form>
  </div>

  <div v-if="formOpen" class="fixed inset-0 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4">
    <form class="bg-base-800 border border-[#d9eadf] rounded-[28px] p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-soft" @submit.prevent="saveProject">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ formMode === "create" ? "Novo Sistema" : "Editar Sistema" }}</h2>
        <button type="button" @click="formOpen = false">X</button>
      </div>

      <div class="grid md:grid-cols-2 gap-3 mt-4">
        <input v-model="form.nome" type="text" placeholder="Nome*" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <input v-model="form.url" type="text" placeholder="URL*" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <select v-model="form.systemType" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" @change="handleSystemTypeChange">
          <option value="common">Sistema Comum</option>
          <option value="rpa">Sistema RPA</option>
        </select>
        <select v-model="form.status" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
          <option value="ativo">Ativo</option>
          <option value="desenvolvimento">Desenvolvimento</option>
          <option value="manutencao">Manutencao</option>
          <option value="arquivado">Arquivado</option>
        </select>
        <textarea v-model="form.descricao" rows="3" placeholder="Descricao*" class="md:col-span-2 rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3"></textarea>
        <input v-model="form.tecnologias" type="text" placeholder="Tecnologias separadas por virgula*" class="md:col-span-2 rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <select v-model="form.ownerEmail" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" :disabled="currentRole === 'user'" @change="handleOwnerSelection">
          <option value="">Usuario responsavel</option>
          <option v-for="user in Object.values(localRoles)" :key="user.email" :value="user.email">{{ user.nome || user.email }}</option>
        </select>
        <input v-model="form.department" list="department-options" type="text" placeholder="Departamento" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" :disabled="currentRole === 'user'" />
        <input v-model="form.repositorio" type="text" placeholder="Repositorio" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        <div class="md:col-span-2">
          <div class="relative group">
            <div v-if="!form.screenshot" class="w-full h-32 rounded-2xl border-2 border-dashed border-[#d9eadf] bg-base-700/30 flex flex-col items-center justify-center gap-2 transition-all hover:bg-base-700/50 hover:border-accent-500/50">
              <div class="w-10 h-10 rounded-full bg-accent-500/10 flex items-center justify-center text-accent-500">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <p class="text-sm font-medium text-ink-100">Imagem do Sistema</p>
              <label class="mt-1 px-4 py-1.5 rounded-lg bg-accent-500 text-white text-xs font-semibold cursor-pointer hover:bg-accent-600 transition-colors shadow-sm">
                <span>Selecionar Foto</span>
                <input type="file" accept="image/*" class="hidden" @change="handleScreenshotChange" />
              </label>
            </div>
            
            <div v-else class="relative w-full h-40 rounded-2xl border border-[#d9eadf] bg-base-700 overflow-hidden shadow-inner group">
              <img :src="form.screenshot" alt="Preview" class="w-full h-full object-cover" />
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <label class="p-2 rounded-full bg-white text-accent-700 cursor-pointer hover:scale-110 transition-transform shadow-lg">
                  <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                  </svg>
                  <input type="file" accept="image/*" class="hidden" @change="handleScreenshotChange" />
                </label>
                <button type="button" class="p-2 rounded-full bg-white text-accent-600 hover:scale-110 transition-transform shadow-lg" @click="form.screenshot = ''">
                  <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <select v-model="form.categoria" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
          <option value="interno">Interno</option>
          <option value="cliente">Cliente</option>
          <option value="pessoal">Pessoal</option>
          <option value="estudo">Estudo</option>
        </select>
        <textarea v-model="form.observacoes" rows="2" placeholder="Observacoes" class="md:col-span-2 rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3"></textarea>
      </div>

      <div v-if="form.systemType === 'rpa'" class="mt-5 rounded-2xl bg-[#f7fcf9] border border-[#d9eadf] p-4">
        <p class="text-sm font-semibold text-ink-100">Automacao RPA</p>
        <div class="grid md:grid-cols-2 gap-3 mt-3">
          <select v-model="form.language" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
          </select>
          <select v-model="form.scheduleMode" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3">
            <option value="manual">Manual</option>
            <option value="hours">Por horario</option>
            <option value="dates">Por data</option>
          </select>
          <textarea v-model="form.code" rows="7" placeholder="Codigo do RPA" class="md:col-span-2 rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3 font-mono text-sm"></textarea>
          
          <div class="md:col-span-2 space-y-2">
            <p class="text-xs font-semibold text-ink-300 uppercase tracking-wider">Arquivos de Recurso (Opcional)</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div v-for="file in form.rpaFiles" :key="file.id" class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-[#d9eadf]">
                <div class="flex items-center gap-2 overflow-hidden">
                  <svg viewBox="0 0 24 24" class="w-4 h-4 text-accent-600 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                  <span class="text-xs font-medium text-ink-100 truncate">{{ file.fileName }}</span>
                </div>
                <button type="button" class="text-accent-600 hover:text-accent-700 p-1" @click="removeRpaFile(file.id)">
                  <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              
              <label class="cursor-pointer px-4 py-3 rounded-xl border-2 border-dashed border-[#d9eadf] bg-white/50 text-accent-700 font-semibold text-sm hover:bg-[#e7f6ed] transition-colors flex flex-col items-center justify-center gap-1 group">
                <svg viewBox="0 0 24 24" class="w-5 h-5 text-accent-500 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span class="text-xs">Adicionar Arquivos</span>
                <input type="file" multiple class="hidden" @change="handleRpaFilesChange" />
              </label>
            </div>
            <p class="text-[10px] text-ink-400">Todos os arquivos serao colocados na mesma pasta do script durante a execucao.</p>
          </div>

          <input v-model="form.scheduleHours" type="text" placeholder="Horarios separados por virgula: 08:00, 12:00" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
          <input v-model="form.scheduleDates" type="text" placeholder="Datas separadas por virgula: 2026-03-25, 2026-03-26" class="rounded-xl bg-base-700 border border-[#d9eadf] px-3 py-3" />
        </div>
        <p class="mt-3 text-xs text-ink-400">Validacao e execucao sao disparadas pelo card e podem ser integradas ao backend de automacao.</p>
      </div>

      <button type="button" class="mt-4 text-sm text-accent-700 underline" @click="handleSystemTypeChange">
        Ajustar campos do tipo de sistema
      </button>

      <p v-if="formError" class="text-sm mt-3 text-[#0f5f43]">{{ formError }}</p>

      <div class="mt-4 flex gap-2">
        <button type="submit" class="flex-1 py-3 rounded-xl bg-accent-500 text-white font-semibold">Salvar</button>
        <button type="button" class="flex-1 py-3 rounded-xl bg-[#e7f6ed] text-accent-700 font-semibold" @click="formOpen = false">Cancelar</button>
      </div>
    </form>
  </div>

  <div v-if="projectDetailsOpen && selectedProject" class="fixed inset-0 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4">
    <div class="bg-base-800 border border-[#d9eadf] rounded-[28px] p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-soft">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-semibold">{{ selectedProject.nome }}</h2>
          <p class="text-sm text-ink-400">{{ getProjectCardBadge(selectedProject) }}</p>
        </div>
        <button type="button" @click="projectDetailsOpen = false">X</button>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div class="space-y-4">
          <textarea
            :value="getProjectMeta(selectedProject.id).code || ''"
            rows="16"
            readonly
            class="w-full rounded-2xl bg-base-700 border border-[#d9eadf] px-3 py-3 font-mono text-sm"
          ></textarea>
          <div class="flex flex-wrap gap-2">
            <button v-if="canManageProjects" class="px-3 py-2 rounded-lg bg-accent-600 text-white font-semibold" @click="triggerProjectAction(selectedProject, 'run')">Executar</button>
            <button v-if="canManageProjects" class="px-3 py-2 rounded-lg bg-[#e7f6ed] text-accent-700 font-semibold" @click="openEdit(selectedProject)">Editar</button>
          </div>
        </div>

        <aside class="rounded-2xl bg-[#f7fcf9] border border-[#d9eadf] p-4 text-sm text-ink-400 space-y-3">
          <p><strong class="text-ink-100">Responsavel:</strong> {{ selectedProject.ownerName || "Nao informado" }}</p>
          <p><strong class="text-ink-100">Departamento:</strong> {{ selectedProject.department || "Nao informado" }}</p>
          <p><strong class="text-ink-100">Linguagem:</strong> {{ getProjectMeta(selectedProject.id).language || "javascript" }}</p>
          <p><strong class="text-ink-100">Agenda:</strong> {{ projectScheduleSummary(selectedProject) }}</p>
          <p v-if="projectState[selectedProject.id]?.lastValidation" class="text-accent-700">{{ projectState[selectedProject.id].lastValidation }}</p>
          <p v-if="projectState[selectedProject.id]?.lastTestResult" class="text-accent-700">{{ projectState[selectedProject.id].lastTestResult }}</p>
          <p v-if="projectState[selectedProject.id]?.lastExecution" class="text-accent-700">{{ projectState[selectedProject.id].lastExecution }}</p>
        </aside>
      </div>
    </div>
  </div>

  <datalist id="department-options">
    <option v-for="department in departments" :key="department" :value="department" />
  </datalist>

  <div v-if="projectLogsOpen" class="fixed inset-0 z-50 bg-[#0f5f43]/20 backdrop-blur-sm flex items-center justify-center px-4 py-6">
    <div class="bg-base-800 border border-[#d9eadf] rounded-[28px] w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden shadow-soft">
      <div class="p-6 border-b border-[#d9eadf] flex items-center justify-between bg-white/50">
        <div>
          <p class="text-xs uppercase tracking-[0.25em] text-ink-400">Historico de Execucao</p>
          <h2 class="text-2xl font-brand font-semibold text-ink-100">{{ getProjectById(projectLogsId)?.nome }}</h2>
        </div>
        <button type="button" class="rounded-xl border border-[#d9eadf] px-4 py-2 text-sm font-semibold text-accent-700 hover:bg-[#e7f6ed] transition-colors" @click="projectLogsOpen = false">Fechar</button>
      </div>

      <div class="flex-1 overflow-hidden flex flex-col p-6 space-y-4">
        <div v-if="projectLogsLoading" class="flex-1 flex items-center justify-center">
          <p class="text-ink-400 animate-pulse">Carregando logs...</p>
        </div>
        
        <div v-else-if="projectRuns.length === 0" class="flex-1 flex items-center justify-center border-2 border-dashed border-[#d9eadf] rounded-3xl bg-[#f7fcf9]">
          <p class="text-ink-400">Nenhuma execucao registrada para este sistema.</p>
        </div>

        <div v-else class="flex-1 overflow-y-auto pr-2 custom-scrollbar bg-[#0d0e12] rounded-2xl border border-[#2d2e3a]">
          <div v-for="run in projectRuns" :key="run.id" class="relative group">
            <!-- Linha do Log -->
            <div 
              @click="toggleRunDetails(run.id)"
              class="flex items-center gap-3 py-2 px-4 cursor-pointer hover:bg-[#1e1f26] transition-colors border-b border-[#1e1f26] last:border-0 relative overflow-hidden"
            >
              <!-- Barra lateral de status -->
              <div :class="['absolute left-0 top-0 bottom-0 w-1', getLogStatusColor(run.status)]"></div>
              
              <!-- Icone de Expansao -->
              <div class="w-4 flex justify-center">
                <svg :class="['w-3 h-3 text-[#565867] transition-transform', expandedRunId === run.id ? 'rotate-90' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7" />
                </svg>
              </div>

              <!-- Timestamp -->
              <span class="text-[11px] font-mono text-[#8e8f99] whitespace-nowrap">{{ formatDateTime(run.createdAt) }}</span>
              
              <!-- Nivel/Status -->
              <span :class="['text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border leading-none', getLogStatusBadge(run.status)]">
                {{ run.status === 'success' ? 'info' : run.status === 'error' ? 'error' : 'warn' }}
              </span>

              <!-- Mensagem Curta -->
              <div class="flex-1 truncate font-mono text-[12px] text-[#d8d9da]">
                <span class="text-[#565867]">msg=</span>"<span class="text-[#89ddff]">Execucao {{ run.triggerType }}</span>"
                <span class="text-[#565867] ml-2">trigger=</span>"<span class="text-[#c3e88d]">{{ run.triggerValue || 'manual' }}</span>"
                <span class="text-[#565867] ml-2">id=</span>"<span class="text-[#f78c6c]">{{ run.id.slice(0, 8) }}</span>"
              </div>

              <!-- Duracao -->
              <span v-if="run.durationMs" class="text-[11px] font-mono text-[#565867]">{{ run.durationMs }}ms</span>
            </div>

            <!-- Detalhes Expandidos -->
            <transition name="fade">
              <div v-if="expandedRunId === run.id" class="bg-[#111217] px-12 py-5 border-b border-[#2d2e3a] space-y-5 shadow-inner">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <!-- Info Panel -->
                  <div class="space-y-4">
                    <div :class="['p-3 rounded-xl border text-xs', getLogAlertClass(run.status)]">
                      <p class="font-bold uppercase text-[10px] mb-1 opacity-70">{{ getLogAlertTitle(run.status) }}</p>
                      {{ getLogAlertMessage(run) }}
                    </div>
                    
                    <div class="space-y-3">
                      <p class="text-[10px] font-bold text-[#565867] uppercase tracking-widest">Metadata</p>
                      <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div class="flex flex-col"><span class="text-[#565867]">Linguagem</span> <span class="text-white">{{ run.language }}</span></div>
                        <div class="flex flex-col"><span class="text-[#565867]">Finalizado em</span> <span class="text-white">{{ formatTime(run.finishedAt) }}</span></div>
                        <div class="flex flex-col"><span class="text-[#565867]">ID Completo</span> <span class="text-white text-[9px]">{{ run.id }}</span></div>
                      </div>
                    </div>
                  </div>

                  <!-- Logs Panel -->
                  <div class="space-y-4">
                    <div v-if="run.stdout" class="space-y-2">
                      <p class="text-[10px] font-bold text-[#565867] uppercase tracking-widest">Standard Output (STDOUT)</p>
                      <pre class="p-4 rounded-xl bg-[#0d0e12] border border-[#2d2e3a] text-[11px] font-mono text-emerald-400 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">{{ run.stdout }}</pre>
                    </div>
                    <div v-if="run.stderr" class="space-y-2">
                      <p class="text-[10px] font-bold text-[#565867] uppercase tracking-widest text-rose-400">Standard Error (STDERR)</p>
                      <pre class="p-4 rounded-xl bg-[#0d0e12] border border-rose-500/20 text-[11px] font-mono text-rose-400 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar">{{ run.stderr }}</pre>
                    </div>
                    <div v-if="!run.stdout && !run.stderr" class="py-10 text-center border border-dashed border-[#2d2e3a] rounded-xl">
                      <p class="text-xs text-[#565867]">Nenhum registro de log para esta execucao.</p>
                    </div>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ─── Modal de Execução RPA — estilo UiPath ────────────────────────────── -->
  <transition name="fade">
    <div v-if="rpaStreamOpen" class="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center px-3 py-4">
      <div class="bg-white border border-gray-200 rounded-2xl w-full max-w-4xl flex flex-col overflow-hidden shadow-2xl" style="max-height: 92vh;">

        <!-- ── Header estilo UiPath ── -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white">
          <div class="flex items-center gap-3">
            <!-- Status badge -->
            <div v-if="rpaStreamStatus === 'running'"
              class="flex items-center gap-2 bg-blue-50 text-blue-600 font-semibold text-sm px-3 py-1.5 rounded-full border border-blue-100">
              <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
              Running
            </div>
            <div v-else-if="rpaStreamStatus === 'success'"
              class="flex items-center gap-2 bg-green-50 text-green-600 font-semibold text-sm px-3 py-1.5 rounded-full border border-green-100">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              Completed
            </div>
            <div v-else-if="rpaStreamStatus === 'error'"
              class="flex items-center gap-2 bg-red-50 text-red-600 font-semibold text-sm px-3 py-1.5 rounded-full border border-red-100">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              Failed
            </div>
            <span class="text-sm text-gray-500 font-medium truncate max-w-xs">{{ rpaStreamProjectName }}</span>
          </div>
          <div class="flex items-center gap-3">
            <!-- Download logs -->
            <button
              type="button"
              class="flex items-center gap-1.5 text-blue-600 font-semibold text-sm hover:text-blue-700 transition-colors"
              @click="() => {
                const text = rpaStreamLogs.map(l => `[${l.ts}] [${l.level}] ${l.message}`).join('\n');
                const a = document.createElement('a');
                a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
                a.download = 'rpa-logs.txt';
                a.click();
              }"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              Download logs
            </button>
            <button
              v-if="rpaStreamStatus !== 'running'"
              type="button"
              class="text-gray-400 hover:text-gray-600 transition-colors"
              @click="closeRpaStream"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- ── Browser mockado (área principal) ── -->
        <div class="flex-1 flex flex-col bg-gray-50 border-b border-gray-200 overflow-hidden" style="min-height: 280px; max-height: 420px;">

          <!-- Barra do browser -->
          <div class="flex items-center gap-2 px-3 py-2 bg-[#f1f3f4] border-b border-gray-200 select-none">
            <!-- Botões nav -->
            <div class="flex items-center gap-1 text-gray-400">
              <button class="p-1 rounded hover:bg-gray-200 transition-colors" disabled>
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <button class="p-1 rounded hover:bg-gray-200 transition-colors" disabled>
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
              </button>
              <!-- Spinner de carregamento -->
              <div v-if="rpaStreamStatus === 'running'" class="p-1">
                <svg class="w-3.5 h-3.5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                </svg>
              </div>
              <div v-else class="p-1">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </div>
            </div>
            <!-- Barra de endereço -->
            <div class="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-600 font-mono shadow-sm">
              <svg class="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              <span class="truncate">{{ rpaScreenshotUrl || 'Aguardando navegador...' }}</span>
            </div>
          </div>

          <!-- Área de conteúdo do browser -->
          <div class="flex-1 relative overflow-hidden bg-white">
            <!-- Screenshot ao vivo -->
            <img
              v-if="rpaScreenshot"
              :src="rpaScreenshot"
              class="w-full h-full object-contain object-top"
              :alt="rpaScreenshotLabel"
            />
            <!-- Placeholder enquanto não há screenshot -->
            <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-300">
              <svg class="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/>
              </svg>
              <span v-if="rpaStreamStatus === 'running'" class="text-sm animate-pulse">Iniciando navegador...</span>
              <span v-else class="text-sm">Nenhuma captura disponível</span>
            </div>
            <!-- Label da última ação sobreposto -->
            <div v-if="rpaScreenshot && rpaScreenshotLabel"
              class="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs px-3 py-1.5 font-mono truncate">
              {{ rpaScreenshotLabel }}
            </div>
            <!-- Barra de progresso por registro -->
            <div v-if="rpaStreamLogs.some(l => l.level === 'progress' && l.total)"
              class="absolute top-0 left-0 right-0 h-1 bg-gray-100">
              <div
                class="h-full transition-all duration-500"
                :class="rpaStreamStatus === 'success' ? 'bg-green-500' : 'bg-blue-500'"
                :style="{ width: (rpaStreamLogs.filter(l => l.level === 'progress').at(-1)?.percent || 0) + '%' }"
              ></div>
            </div>
          </div>
        </div>

        <!-- ── Terminal de logs ── -->
        <div class="flex flex-col bg-[#0d0e12]" style="max-height: 220px;">
          <!-- Cabeçalho do terminal -->
          <div class="flex items-center justify-between px-4 py-1.5 bg-[#111217] border-b border-[#2d2e3a]">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-[#ff5f57]"></span>
              <span class="w-2 h-2 rounded-full bg-[#febc2e]"></span>
              <span class="w-2 h-2 rounded-full bg-[#28c840]"></span>
              <span class="text-[10px] text-[#565867] font-mono ml-1">logs</span>
            </div>
            <span class="text-[10px] font-mono text-[#3d3e4a]">{{ rpaStreamLogs.length }} linha{{ rpaStreamLogs.length !== 1 ? 's' : '' }}</span>
          </div>
          <!-- Linhas de log -->
          <div
            ref="rpaLogContainer"
            class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] space-y-[1px] custom-scrollbar"
          >
            <div v-if="rpaStreamLogs.length === 0" class="text-[#565867] py-1 animate-pulse">Aguardando logs...</div>
            <div
              v-for="(entry, idx) in rpaStreamLogs"
              :key="idx"
              class="flex items-start gap-2 leading-5"
            >
              <span class="text-[#3d3e4a] flex-shrink-0 w-14 text-[10px]">{{ entry.ts ? new Date(entry.ts).toLocaleTimeString('pt-BR') : '' }}</span>
              <span class="flex-1 break-all"
                :class="{
                  'text-red-400':    entry.level === 'error',
                  'text-yellow-300': entry.level === 'warn',
                  'text-green-400':  entry.level === 'success',
                  'text-blue-300':   entry.level === 'action',
                  'text-accent-300': entry.level === 'progress',
                  'text-[#c9cad4]':  entry.level === 'info',
                }"
              >{{ entry.message }}</span>
            </div>
            <div v-if="rpaStreamStatus === 'running'" class="flex items-center gap-1 text-accent-400 py-0.5">
              <span>$</span><span class="animate-pulse">▋</span>
            </div>
          </div>
        </div>

        <!-- ── Rodapé ── -->
        <div class="flex items-center justify-between px-4 py-2 bg-white border-t border-gray-100">
          <div class="text-xs text-gray-400 font-mono">
            <span v-if="rpaStreamLogs.some(l => l.level === 'progress' && l.total)">
              {{ rpaStreamLogs.filter(l => l.level === 'progress').at(-1)?.current || 0 }}
              / {{ rpaStreamLogs.filter(l => l.level === 'progress').at(-1)?.total || '?' }} registros
              · {{ rpaStreamLogs.filter(l => l.level === 'progress').at(-1)?.percent || 0 }}%
            </span>
          </div>
          <button
            v-if="rpaStreamStatus !== 'running'"
            type="button"
            class="px-4 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm font-semibold transition-colors"
            @click="closeRpaStream"
          >Fechar</button>
          <span v-else class="text-xs text-blue-500 animate-pulse font-medium">Executando automação...</span>
        </div>

      </div>
    </div>
  </transition>

</template>
