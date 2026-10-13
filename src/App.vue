<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppSidebar from "./components/layout/AppSidebar.vue";
import LoginView from "./components/auth/LoginView.vue";
import ProjectsView from "./components/projects/ProjectsView.vue";
import FeedbackHost from "./components/ui/FeedbackHost.vue";

// Telas secundarias carregadas sob demanda (reduz o carregamento inicial).
const ApiWorkspace = defineAsyncComponent(() => import("./components/apis/ApiWorkspace.vue"));
const ProfileView = defineAsyncComponent(() => import("./components/settings/ProfileView.vue"));
const UsersView = defineAsyncComponent(() => import("./components/settings/UsersView.vue"));
const RunnersView = defineAsyncComponent(() => import("./components/settings/RunnersView.vue"));
const DocsView = defineAsyncComponent(() => import("./components/settings/DocsView.vue"));
import Icon from "./components/ui/Icon.vue";
import { toast } from "./lib/feedback.js";
import { route } from "./lib/router.js";
import { bootstrapSession, isManager, session } from "./stores/session.js";

const SIDEBAR_KEY = "gestao_sidebar_collapsed";
const collapsed = ref(readCollapsed());
const mobileOpen = ref(false);

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

watch(collapsed, (value) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
  } catch {
    // armazenamento indisponivel
  }
});

const view = computed(() => {
  const [first, second] = route.segments;
  if (first === "apis") return "apis";
  if (first === "config") {
    if (second === "usuarios") return isManager.value ? "users" : "profile";
    if (second === "servidores") return isManager.value ? "runners" : "profile";
    if (second === "documentacao") return "docs";
    return "profile";
  }
  return "projects";
});

const viewTitle = computed(() => ({
  projects: "Gestao de desenvolvimento",
  apis: "API / Plugins",
  profile: "Meu perfil",
  users: "Usuarios",
  runners: "Servidores RPA",
  docs: "Documentacao"
}[view.value]));

watch(() => route.path, () => {
  mobileOpen.value = false;
});

function onSessionExpired() {
  toast.warn("Sua sessao expirou. Entre novamente.");
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && session.user) {
    event.preventDefault();
    collapsed.value = !collapsed.value;
  }
}

onMounted(() => {
  bootstrapSession();
  window.addEventListener("session-expired", onSessionExpired);
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("session-expired", onSessionExpired);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <FeedbackHost />

  <div v-if="!session.ready" class="flex min-h-screen items-center justify-center">
    <div class="flex items-center gap-3 text-sm text-slate-500">
      <Icon name="loader" class="animate-spin text-brand-600" />
      Carregando plataforma...
    </div>
  </div>

  <LoginView v-else-if="!session.user" />

  <div v-else class="flex h-screen overflow-hidden">
    <AppSidebar v-model:collapsed="collapsed" :mobile-open="mobileOpen" @close-mobile="mobileOpen = false" />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button type="button" class="btn-icon" title="Abrir menu" @click="mobileOpen = true"><Icon name="menu" /></button>
        <span class="font-semibold text-slate-800">{{ viewTitle }}</span>
      </header>

      <main class="min-h-0 flex-1" :class="view === 'apis' ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin'">
        <ProjectsView v-if="view === 'projects'" />
        <ApiWorkspace v-else-if="view === 'apis'" />
        <ProfileView v-else-if="view === 'profile'" />
        <UsersView v-else-if="view === 'users'" />
        <RunnersView v-else-if="view === 'runners'" />
        <DocsView v-else-if="view === 'docs'" />
      </main>
    </div>
  </div>
</template>
