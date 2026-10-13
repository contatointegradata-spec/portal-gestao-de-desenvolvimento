<script setup>
import { computed } from "vue";
import { formatRelative, normalizeUrl, PROJECT_STATUS, RUN_STATUS, scheduleSummary } from "../../lib/format.js";
import Avatar from "../ui/Avatar.vue";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";

const props = defineProps({ project: { type: Object, required: true } });
const emit = defineEmits(["open", "run", "edit", "duplicate", "remove"]);

const isRpa = computed(() => props.project.systemType === "rpa");
const running = computed(() => Boolean(props.project.activeRunId));
const lastRun = computed(() => RUN_STATUS[running.value ? "running" : props.project.lastRunStatus] || null);
const menu = computed(() => props.project.permissions?.canEdit ? [
  { label: "Editar", icon: "edit", action: () => emit("edit", props.project) },
  { label: "Duplicar", icon: "copy", action: () => emit("duplicate", props.project) },
  { divider: true },
  { label: "Excluir", icon: "trash", danger: true, action: () => emit("remove", props.project) }
] : []);
</script>

<template>
  <div
    class="grid cursor-pointer gap-3 border-b border-slate-100 px-5 py-4 transition last:border-b-0 hover:bg-slate-50 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_120px] lg:items-center lg:gap-4"
    @click="emit('open', project)"
  >
    <div class="flex min-w-0 items-center gap-3">
      <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" :class="isRpa ? 'bg-slate-800 text-brand-300' : 'bg-brand-50 text-brand-600'">
        <Icon :name="isRpa ? 'bot' : 'layout-grid'" :size="18" />
      </div>
      <div class="min-w-0">
        <p class="truncate font-medium text-slate-900">{{ project.nome }}</p>
        <p class="truncate text-xs text-slate-500">{{ isRpa ? (project.language === "javascript" ? "JavaScript" : "Python") : (project.tecnologias || []).join(", ") }}</p>
      </div>
    </div>
    <div class="flex min-w-0 items-center gap-2 text-sm text-slate-600">
      <Avatar :name="project.ownerName" size="h-6 w-6 text-[10px]" />
      <span class="truncate">{{ project.ownerName || "-" }}</span>
    </div>
    <div><span class="chip" :class="PROJECT_STATUS[project.status]?.class">{{ PROJECT_STATUS[project.status]?.label || project.status }}</span></div>
    <div class="min-w-0 text-xs text-slate-500">
      <template v-if="isRpa">
        <p class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" :class="lastRun?.dot || 'bg-slate-300'" />{{ lastRun ? lastRun.label : "Nunca executado" }}<template v-if="!running && project.lastRunAt"> · {{ formatRelative(project.lastRunAt) }}</template></p>
        <p class="mt-0.5 truncate">{{ scheduleSummary(project.schedule) }}</p>
      </template>
      <span v-else class="truncate">{{ project.department || "-" }}</span>
    </div>
    <div class="flex items-center justify-end gap-1" @click.stop>
      <button v-if="isRpa && project.permissions?.canRun" type="button" class="btn-icon h-8 w-8" :class="running ? 'text-sky-600' : 'text-brand-600'" :title="running ? 'Acompanhar execucao' : 'Executar'" :disabled="project.status === 'arquivado'" @click="emit('run', project)">
        <Icon :name="running ? 'activity' : 'play'" :size="16" />
      </button>
      <a v-if="!isRpa" :href="normalizeUrl(project.url)" target="_blank" rel="noopener noreferrer" class="btn-icon h-8 w-8" title="Abrir sistema"><Icon name="external-link" :size="16" /></a>
      <Dropdown v-if="menu.length" :items="menu" />
    </div>
  </div>
</template>
