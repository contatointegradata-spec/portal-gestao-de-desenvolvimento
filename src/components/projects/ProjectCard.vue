<script setup>
import { computed } from "vue";
import { formatDateTime, formatRelative, normalizeUrl, PROJECT_STATUS, RUN_STATUS, scheduleSummary } from "../../lib/format.js";
import Avatar from "../ui/Avatar.vue";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";

const props = defineProps({ project: { type: Object, required: true } });
const emit = defineEmits(["open", "run", "edit", "duplicate", "remove"]);

const isRpa = computed(() => props.project.systemType === "rpa");
const running = computed(() => Boolean(props.project.activeRunId));
const lastRun = computed(() => RUN_STATUS[running.value ? "running" : props.project.lastRunStatus] || null);
const techs = computed(() => props.project.tecnologias || []);

const menu = computed(() => {
  if (!props.project.permissions?.canEdit) return [];
  return [
    { label: "Editar", icon: "edit", action: () => emit("edit", props.project) },
    { label: "Duplicar", icon: "copy", action: () => emit("duplicate", props.project) },
    { divider: true },
    { label: "Excluir", icon: "trash", danger: true, action: () => emit("remove", props.project) }
  ];
});
</script>

<template>
  <article
    class="card group flex cursor-pointer flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
    :class="running ? 'ring-2 ring-sky-300' : ''"
    @click="emit('open', project)"
  >
    <div class="relative h-32 overflow-hidden bg-gradient-to-br" :class="isRpa ? 'from-slate-800 to-brand-900' : 'from-brand-50 to-emerald-100'">
      <img v-if="project.screenshot" :src="project.screenshot" :alt="project.nome" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
      <div v-else class="flex h-full items-center justify-center">
        <Icon :name="isRpa ? 'bot' : 'layout-grid'" :size="40" :class="isRpa ? 'text-brand-300/60' : 'text-brand-600/30'" />
      </div>
      <div class="absolute left-3 top-3 flex gap-1.5">
        <span class="chip bg-white/90 text-slate-700 shadow-sm backdrop-blur">
          <Icon :name="isRpa ? 'bot' : 'layout-grid'" :size="12" />{{ isRpa ? "RPA" : "Sistema" }}
        </span>
        <span v-if="isRpa" class="chip bg-slate-900/80 font-mono text-white">{{ project.language === "javascript" ? "JS" : "Python" }}</span>
      </div>
      <span v-if="running" class="chip absolute right-3 top-3 bg-sky-500 text-white shadow"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Executando</span>
    </div>

    <div class="flex flex-1 flex-col gap-3 p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="truncate font-semibold text-slate-900" :title="project.nome">{{ project.nome }}</h3>
          <p class="mt-0.5 line-clamp-2 text-sm text-slate-500">{{ project.descricao }}</p>
        </div>
        <span class="chip shrink-0" :class="PROJECT_STATUS[project.status]?.class">{{ PROJECT_STATUS[project.status]?.label || project.status }}</span>
      </div>

      <div class="flex items-center gap-2 text-xs text-slate-500">
        <Avatar :name="project.ownerName" size="h-6 w-6 text-[10px]" />
        <span class="truncate">{{ project.ownerName || "Sem responsavel" }}</span>
        <span v-if="project.department" class="text-slate-300">•</span>
        <span v-if="project.department" class="truncate">{{ project.department }}</span>
      </div>

      <div v-if="!isRpa && techs.length" class="flex flex-wrap gap-1">
        <span v-for="tech in techs.slice(0, 4)" :key="tech" class="chip bg-slate-100 text-slate-600">{{ tech }}</span>
        <span v-if="techs.length > 4" class="chip bg-slate-100 text-slate-500">+{{ techs.length - 4 }}</span>
      </div>

      <div v-if="isRpa" class="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
        <div class="flex items-center gap-2 text-slate-600">
          <Icon name="calendar" :size="14" class="text-slate-400" />
          <span class="truncate">{{ scheduleSummary(project.schedule) }}</span>
        </div>
        <div v-if="project.nextRunAt" class="flex items-center gap-2 text-slate-600" :title="formatDateTime(project.nextRunAt)">
          <Icon name="clock" :size="14" class="text-slate-400" />
          Proxima: {{ formatRelative(project.nextRunAt) }}
        </div>
        <div class="flex items-center gap-2" :title="project.lastRunOutput">
          <span class="h-2 w-2 rounded-full" :class="lastRun?.dot || 'bg-slate-300'" />
          <span v-if="lastRun" class="text-slate-600">{{ lastRun.label }}<template v-if="!running && project.lastRunAt"> · {{ formatRelative(project.lastRunAt) }}</template></span>
          <span v-else class="text-slate-400">Nunca executado</span>
        </div>
      </div>

      <div class="mt-auto flex items-center gap-2 pt-1" @click.stop>
        <template v-if="isRpa">
          <button v-if="project.permissions?.canRun" type="button" class="btn-sm flex-1" :class="running ? 'btn-soft' : 'btn-primary'" :disabled="project.status === 'arquivado'" @click="emit('run', project)">
            <Icon :name="running ? 'activity' : 'play'" :size="14" />{{ running ? "Acompanhar" : "Executar" }}
          </button>
          <button type="button" class="btn-secondary btn-sm flex-1" @click="emit('open', project)"><Icon name="history" :size="14" />Detalhes</button>
        </template>
        <template v-else>
          <a :href="normalizeUrl(project.url)" target="_blank" rel="noopener noreferrer" class="btn-primary btn-sm flex-1"><Icon name="external-link" :size="14" />Abrir</a>
          <button type="button" class="btn-secondary btn-sm flex-1" @click="emit('open', project)"><Icon name="info" :size="14" />Detalhes</button>
        </template>
        <Dropdown v-if="menu.length" :items="menu" />
      </div>
    </div>
  </article>
</template>
