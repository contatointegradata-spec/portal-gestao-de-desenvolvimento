<script setup>
import { computed, ref, watch } from "vue";
import { confirmDialog } from "../../lib/feedback.js";
import { ROLE_LABELS } from "../../lib/format.js";
import { navigate, route } from "../../lib/router.js";
import { isManager, logout, session } from "../../stores/session.js";
import Avatar from "../ui/Avatar.vue";
import Icon from "../ui/Icon.vue";
import NotificationsPanel from "./NotificationsPanel.vue";
import logoUrl from "../../assets/favicon_unimed.webp";

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  mobileOpen: { type: Boolean, default: false }
});
const emit = defineEmits(["update:collapsed", "close-mobile"]);

const notificationsOpen = ref(false);
const settingsExpanded = ref(route.segments[0] === "config");

// No celular o menu abre sempre expandido.
const compact = computed(() => props.collapsed && !props.mobileOpen);

watch(() => route.segments[0], (first) => {
  if (first === "config") settingsExpanded.value = true;
});

const isProjects = computed(() => route.segments[0] === "sistemas" || !route.segments.length);
const isApis = computed(() => route.segments[0] === "apis");

function isActive(item) {
  if (item.id === "sistemas") return isProjects.value && route.query.tipo !== "rpa";
  if (item.id === "rpa") return isProjects.value && route.query.tipo === "rpa";
  if (item.id === "apis") return isApis.value;
  return route.path === item.path;
}

const sections = computed(() => [
  {
    title: "Gestao de desenvolvimento",
    items: [
      { id: "sistemas", label: "Sistemas", icon: "layout-grid", go: () => navigate("sistemas") },
      { id: "rpa", label: "Automacoes RPA", icon: "bot", go: () => navigate("sistemas", { tipo: "rpa" }), badge: session.activeRuns.length || null, pulse: session.activeRuns.length > 0 }
    ]
  },
  {
    title: "API / Plugins",
    items: [{ id: "apis", label: "Colecoes de API", icon: "plug", go: () => navigate("apis") }]
  }
]);

const settingsItems = computed(() => [
  { path: "config/perfil", label: "Perfil", icon: "user" },
  ...(isManager.value ? [{ path: "config/usuarios", label: "Usuarios", icon: "users" }, { path: "config/servidores", label: "Servidores RPA", icon: "server" }] : []),
  { path: "config/documentacao", label: "Documentacao", icon: "book" }
]);

const settingsActive = computed(() => route.segments[0] === "config");

function toggleSettings() {
  if (compact.value) {
    navigate("config/perfil");
    return;
  }
  settingsExpanded.value = !settingsExpanded.value;
}

async function confirmLogout() {
  const ok = await confirmDialog({ title: "Sair da plataforma?", message: "Sua sessao sera encerrada neste navegador.", confirmText: "Sair" });
  if (ok) await logout();
}

const itemBase = "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition";
function itemClass(active) {
  return active ? "bg-white/15 text-white shadow-inner" : "text-brand-100/80 hover:bg-white/10 hover:text-white";
}
</script>

<template>
  <div v-if="mobileOpen" class="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" @click="emit('close-mobile')" />

  <aside
    class="fixed inset-y-0 left-0 z-40 flex flex-col bg-gradient-to-b from-brand-950 via-brand-900 to-brand-950 text-white transition-all duration-200 lg:static lg:translate-x-0"
    :class="[compact ? 'w-[76px]' : 'w-[272px]', mobileOpen ? 'translate-x-0' : '-translate-x-full']"
  >
    <!-- Marca + recolher -->
    <div class="flex items-center gap-3 px-4 pb-4 pt-5" :class="compact ? 'flex-col' : ''">
      <img :src="logoUrl" alt="Unimed" class="h-10 w-10 shrink-0 rounded-xl bg-white p-1" />
      <div v-if="!compact" class="min-w-0 flex-1">
        <p class="text-[10px] font-semibold uppercase tracking-[0.3em] text-brand-300">Unimed</p>
        <p class="truncate text-sm font-semibold">Gestao de Sistemas</p>
      </div>
      <button
        type="button"
        class="hidden h-8 w-8 items-center justify-center rounded-lg text-brand-200 transition hover:bg-white/10 hover:text-white lg:flex"
        :title="compact ? 'Expandir menu (Ctrl+B)' : 'Recolher menu (Ctrl+B)'"
        @click="emit('update:collapsed', !collapsed)"
      >
        <Icon :name="compact ? 'chevrons-right' : 'chevrons-left'" :size="16" />
      </button>
      <button type="button" class="flex h-8 w-8 items-center justify-center rounded-lg text-brand-200 hover:bg-white/10 lg:hidden" @click="emit('close-mobile')">
        <Icon name="x" :size="16" />
      </button>
    </div>

    <!-- Navegacao principal -->
    <nav class="scrollbar-dark flex-1 space-y-6 overflow-y-auto px-3 pb-4">
      <div v-for="section in sections" :key="section.title">
        <p v-if="!compact" class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-300/80">{{ section.title }}</p>
        <div v-else class="mx-auto mb-2 h-px w-8 bg-white/10" />
        <div class="space-y-1">
          <button
            v-for="item in section.items"
            :key="item.id"
            type="button"
            :class="[itemBase, itemClass(isActive(item)), compact ? 'justify-center px-0' : '']"
            :title="compact ? item.label : ''"
            @click="item.go()"
          >
            <span class="relative">
              <Icon :name="item.icon" :size="19" />
              <span v-if="item.pulse && compact" class="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400 ring-2 ring-brand-900" />
            </span>
            <span v-if="!compact" class="flex-1 truncate text-left">{{ item.label }}</span>
            <span v-if="!compact && item.badge" class="flex items-center gap-1 rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />{{ item.badge }}
            </span>
          </button>
        </div>
      </div>
    </nav>

    <!-- Rodape: usuario, configuracoes, notificacoes, sair -->
    <div class="space-y-1 border-t border-white/10 px-3 py-4">
      <button
        type="button"
        class="mb-2 flex w-full items-center gap-3 rounded-xl bg-white/5 p-2.5 text-left transition hover:bg-white/10"
        :class="compact ? 'justify-center p-1.5' : ''"
        :title="compact ? `${session.user.nome} · ${ROLE_LABELS[session.user.role]}` : 'Abrir meu perfil'"
        @click="navigate('config/perfil')"
      >
        <Avatar :name="session.user.nome" :photo="session.user.foto" size="h-10 w-10 text-sm" class="ring-2 ring-white/20" />
        <div v-if="!compact" class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">{{ session.user.nome }}</p>
          <p class="flex items-center gap-1 text-xs text-brand-200">
            <Icon v-if="session.user.isMaster" name="crown" :size="12" class="text-amber-300" />
            {{ ROLE_LABELS[session.user.role] }}
          </p>
        </div>
      </button>

      <button type="button" :class="[itemBase, itemClass(settingsActive && compact), compact ? 'justify-center px-0' : '']" :title="compact ? 'Configuracoes' : ''" @click="toggleSettings">
        <Icon name="settings" :size="19" />
        <span v-if="!compact" class="flex-1 text-left">Configuracoes</span>
        <Icon v-if="!compact" :name="settingsExpanded ? 'chevron-up' : 'chevron-down'" :size="15" class="text-brand-300" />
      </button>
      <div v-if="settingsExpanded && !compact" class="ml-5 space-y-0.5 border-l border-white/10 pl-3">
        <button
          v-for="item in settingsItems"
          :key="item.path"
          type="button"
          :class="[itemBase, 'py-2', itemClass(route.path === item.path)]"
          @click="navigate(item.path)"
        >
          <Icon :name="item.icon" :size="16" />
          <span>{{ item.label }}</span>
        </button>
      </div>

      <button type="button" :class="[itemBase, itemClass(notificationsOpen), compact ? 'justify-center px-0' : '']" :title="compact ? 'Notificacoes' : ''" @click="notificationsOpen = !notificationsOpen">
        <span class="relative">
          <Icon name="bell" :size="19" :class="session.unreadCount ? 'animate-wiggle' : ''" />
          <span v-if="session.unreadCount && compact" class="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold">{{ session.unreadCount > 99 ? "99+" : session.unreadCount }}</span>
        </span>
        <span v-if="!compact" class="flex-1 text-left">Notificacoes</span>
        <span v-if="!compact && session.unreadCount" class="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold">{{ session.unreadCount > 99 ? "99+" : session.unreadCount }}</span>
      </button>

      <button type="button" :class="[itemBase, 'text-brand-100/80 hover:bg-rose-500/20 hover:text-white', compact ? 'justify-center px-0' : '']" :title="compact ? 'Sair' : ''" @click="confirmLogout">
        <Icon name="log-out" :size="19" />
        <span v-if="!compact">Sair</span>
      </button>
    </div>
  </aside>

  <NotificationsPanel v-if="notificationsOpen" :offset="compact ? 88 : 284" @close="notificationsOpen = false" />
</template>
