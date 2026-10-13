<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import { registerOverlay } from "../../lib/overlay.js";
import { navigate } from "../../lib/router.js";
import { refreshNotifications, session } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";

defineProps({ offset: { type: Number, default: 284 } });
const emit = defineEmits(["close"]);

const filter = ref("all");
const loading = ref(false);
const FILTERS = [
  { id: "all", label: "Todas" },
  { id: "unread", label: "Nao lidas" },
  { id: "rpa", label: "RPA" },
  { id: "system", label: "Sistema" }
];

const KIND_STYLE = {
  rpa_success: { icon: "check-circle", class: "bg-emerald-50 text-emerald-600" },
  rpa_failure: { icon: "x-circle", class: "bg-rose-50 text-rose-600" },
  rpa_schedule_skipped: { icon: "alert-triangle", class: "bg-amber-50 text-amber-600" },
  rpa_execution: { icon: "bot", class: "bg-sky-50 text-sky-600" },
  rpa_validation: { icon: "code", class: "bg-violet-50 text-violet-600" }
};

const items = computed(() => session.notifications.filter((item) => {
  if (filter.value === "unread") return !item.readAt;
  if (filter.value === "rpa") return item.kind.startsWith("rpa_");
  if (filter.value === "system") return !item.kind.startsWith("rpa_");
  return true;
}));

async function open(item) {
  if (!item.readAt) {
    await http.patch(`/api/notifications/${item.id}/read`).catch(() => {});
    item.readAt = new Date().toISOString();
    session.unreadCount = Math.max(0, session.unreadCount - 1);
  }
  if (item.targetType === "project" && item.targetId) {
    navigate("sistemas", { projeto: item.targetId, ...(item.metadata?.runId ? { execucao: item.metadata.runId } : {}) });
    emit("close");
  }
}

async function markAll() {
  await http.post("/api/notifications/read-all");
  await refreshNotifications();
}

async function clearRead() {
  await http.del("/api/notifications/read");
  await refreshNotifications();
  toast.info("Notificacoes lidas removidas.");
}

let unregister = null;
onMounted(async () => {
  unregister = registerOverlay(() => emit("close"));
  loading.value = true;
  await refreshNotifications().catch(() => {});
  loading.value = false;
});
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40" @mousedown="emit('close')" />
    <section
      class="fixed bottom-4 z-50 flex max-h-[min(640px,calc(100vh-2rem))] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop animate-slide-up max-lg:left-4"
      :style="{ left: `${offset}px` }"
    >
      <header class="border-b border-slate-100 px-5 pb-3 pt-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="font-semibold text-slate-900">Notificacoes</h3>
            <p class="text-xs text-slate-500">{{ session.unreadCount }} nao lida(s)</p>
          </div>
          <div class="flex gap-1">
            <button type="button" class="btn-ghost btn-sm" :disabled="!session.unreadCount" @click="markAll"><Icon name="check" :size="14" />Ler todas</button>
            <button type="button" class="btn-icon h-8 w-8" title="Remover notificacoes lidas" @click="clearRead"><Icon name="trash" :size="15" /></button>
          </div>
        </div>
        <div class="mt-3 flex gap-1.5">
          <button
            v-for="option in FILTERS"
            :key="option.id"
            type="button"
            class="chip border transition"
            :class="filter === option.id ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
            @click="filter = option.id"
          >
            {{ option.label }}
          </button>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <p v-if="loading && !items.length" class="p-6 text-center text-sm text-slate-400">Carregando...</p>
        <div v-else-if="!items.length" class="flex flex-col items-center gap-2 p-10 text-center text-sm text-slate-400">
          <Icon name="bell" :size="28" class="text-slate-300" />
          Nenhuma notificacao por aqui.
        </div>
        <button
          v-for="item in items"
          v-else
          :key="item.id"
          type="button"
          class="flex w-full items-start gap-3 border-b border-slate-100 px-5 py-3.5 text-left transition hover:bg-slate-50"
          :class="item.readAt ? '' : 'bg-brand-50/40'"
          @click="open(item)"
        >
          <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" :class="KIND_STYLE[item.kind]?.class || 'bg-slate-100 text-slate-500'">
            <Icon :name="KIND_STYLE[item.kind]?.icon || 'info'" :size="16" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-slate-800">{{ item.title }}</span>
            <span class="mt-0.5 line-clamp-2 block text-xs text-slate-500">{{ item.body }}</span>
            <span class="mt-1 block text-[11px] text-slate-400" :title="formatDateTime(item.createdAt)">{{ formatRelative(item.createdAt) }}</span>
          </span>
          <span v-if="!item.readAt" class="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
        </button>
      </div>
    </section>
  </Teleport>
</template>
