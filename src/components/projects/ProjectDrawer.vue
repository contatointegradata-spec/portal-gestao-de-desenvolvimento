<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import {
  formatDateTime, formatDuration, formatRelative, normalizeUrl, PROJECT_CATEGORIES, PROJECT_STATUS, RUN_STATUS, scheduleSummary, TRIGGER_LABELS
} from "../../lib/format.js";
import { isManager, session } from "../../stores/session.js";
import Avatar from "../ui/Avatar.vue";
import CodeEditor from "../ui/CodeEditor.vue";
import Drawer from "../ui/Drawer.vue";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";
import FilesManager from "./FilesManager.vue";

const props = defineProps({ projectId: { type: String, required: true } });
const emit = defineEmits(["close", "edit", "run", "open-run", "duplicate", "remove", "updated"]);

const project = ref(null);
const loading = ref(true);
const error = ref("");
const tab = ref("geral");
const runs = ref([]);
const runsLoading = ref(false);
const runFilter = ref("all");
const validation = ref(null);
const validating = ref(false);

const isRpa = computed(() => project.value?.systemType === "rpa");
const running = computed(() => session.activeRuns.some((run) => run.projectId === props.projectId));
const filteredRuns = computed(() => runFilter.value === "all" ? runs.value : runs.value.filter((run) => runFilter.value === "failed" ? ["error", "timeout", "interrupted"].includes(run.status) : run.status === runFilter.value));
const successRate = computed(() => {
  const finished = runs.value.filter((run) => run.status !== "running" && run.status !== "cancelled");
  if (!finished.length) return null;
  return Math.round((finished.filter((run) => run.status === "success").length / finished.length) * 100);
});

const menu = computed(() => isManager.value ? [
  { label: "Duplicar", icon: "copy", action: () => emit("duplicate", project.value) },
  { divider: true },
  { label: "Excluir", icon: "trash", danger: true, action: () => emit("remove", project.value) }
] : []);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    project.value = await http.get(`/api/projects/${props.projectId}`);
    if (isRpa.value) loadRuns();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadRuns() {
  runsLoading.value = true;
  try {
    runs.value = await http.get(`/api/projects/${props.projectId}/runs?limit=100`);
  } catch (err) {
    toast.error(err.message);
  } finally {
    runsLoading.value = false;
  }
}

async function validate() {
  validating.value = true;
  try {
    const result = await http.post(`/api/projects/${props.projectId}/validate`);
    validation.value = result;
    project.value = { ...project.value, ...result.project, code: project.value.code, files: project.value.files };
    emit("updated", result.project);
  } catch (err) {
    toast.error(err.message);
  } finally {
    validating.value = false;
  }
}

function onFilesChanged(list) {
  project.value.files = list;
  emit("updated", { id: project.value.id, fileCount: list.length });
}

watch(() => props.projectId, load);
watch(running, (now, before) => {
  if (before && !now) load();
  else if (now) loadRuns();
});
onMounted(load);
</script>

<template>
  <Drawer width="max-w-4xl" @close="emit('close')">
    <template #header>
      <div v-if="project" class="flex items-start gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" :class="isRpa ? 'bg-slate-900 text-brand-300' : 'bg-brand-50 text-brand-600'">
          <Icon :name="isRpa ? 'bot' : 'layout-grid'" :size="22" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold text-slate-900">{{ project.nome }}</h2>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="chip" :class="PROJECT_STATUS[project.status]?.class">{{ PROJECT_STATUS[project.status]?.label }}</span>
            <span class="chip bg-slate-100 text-slate-600">{{ isRpa ? `RPA · ${project.language === "javascript" ? "JavaScript" : "Python"}` : "Sistema" }}</span>
            <span v-if="isRpa && project.runnerName" class="chip bg-slate-900 text-white" title="Servidor de execucao"><Icon name="server" :size="11" />{{ project.runnerName }}</span>
            <span v-if="running" class="chip bg-sky-500 text-white"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Executando</span>
          </div>
        </div>
      </div>
      <p v-else class="text-slate-500">Carregando...</p>
    </template>

    <div v-if="loading && !project" class="space-y-3 p-6">
      <div v-for="index in 4" :key="index" class="h-16 animate-pulse rounded-xl bg-slate-100" />
    </div>
    <p v-else-if="error" class="m-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

    <template v-else-if="project">
      <nav class="sticky top-0 z-10 flex gap-1 border-b border-slate-100 bg-white px-6">
        <button type="button" class="tab" :class="tab === 'geral' ? 'tab-active' : ''" @click="tab = 'geral'">Visao geral</button>
        <template v-if="isRpa">
          <button type="button" class="tab" :class="tab === 'execucoes' ? 'tab-active' : ''" @click="tab = 'execucoes'">Execucoes <span class="text-xs text-slate-400">({{ runs.length }})</span></button>
          <button type="button" class="tab" :class="tab === 'codigo' ? 'tab-active' : ''" @click="tab = 'codigo'">Codigo</button>
          <button type="button" class="tab" :class="tab === 'arquivos' ? 'tab-active' : ''" @click="tab = 'arquivos'">Arquivos <span class="text-xs text-slate-400">({{ project.files?.length || 0 }})</span></button>
        </template>
      </nav>

      <!-- VISAO GERAL -->
      <div v-if="tab === 'geral'" class="space-y-6 p-6">
        <img v-if="project.screenshot" :src="project.screenshot" :alt="project.nome" class="max-h-72 w-full rounded-xl border border-slate-200 object-cover" />
        <p class="whitespace-pre-line text-sm leading-relaxed text-slate-700">{{ project.descricao }}</p>

        <div v-if="isRpa" class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-slate-200 p-4">
            <p class="text-xs text-slate-500">Ultima execucao</p>
            <p class="mt-1 flex items-center gap-2 font-semibold text-slate-800">
              <span class="h-2 w-2 rounded-full" :class="RUN_STATUS[running ? 'running' : project.lastRunStatus]?.dot || 'bg-slate-300'" />
              {{ RUN_STATUS[running ? "running" : project.lastRunStatus]?.label || "Nunca executado" }}
            </p>
            <p v-if="project.lastRunAt" class="mt-0.5 text-xs text-slate-400" :title="formatDateTime(project.lastRunAt)">{{ formatRelative(project.lastRunAt) }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 p-4">
            <p class="text-xs text-slate-500">Agendamento</p>
            <p class="mt-1 text-sm font-semibold text-slate-800">{{ scheduleSummary(project.schedule) }}</p>
            <p v-if="project.nextRunAt" class="mt-0.5 text-xs text-slate-400">Proxima: {{ formatDateTime(project.nextRunAt) }}</p>
          </div>
          <div class="rounded-xl border border-slate-200 p-4">
            <p class="text-xs text-slate-500">Taxa de sucesso</p>
            <p class="mt-1 text-sm font-semibold text-slate-800">{{ successRate === null ? "-" : `${successRate}%` }}</p>
            <p class="mt-0.5 text-xs text-slate-400">ultimas {{ runs.length }} execucoes</p>
          </div>
        </div>
        <p v-if="isRpa && project.lastRunOutput" class="rounded-xl bg-slate-50 px-4 py-3 font-mono text-xs text-slate-600">{{ project.lastRunOutput }}</p>

        <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-xs text-slate-500">Responsavel</dt>
            <dd class="mt-1 flex items-center gap-2 font-medium text-slate-800"><Avatar :name="project.ownerName" size="h-6 w-6 text-[10px]" />{{ project.ownerName || "-" }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Departamento</dt>
            <dd class="mt-1 font-medium text-slate-800">{{ project.department || "-" }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Categoria</dt>
            <dd class="mt-1 font-medium text-slate-800">{{ PROJECT_CATEGORIES[project.categoria] || project.categoria }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">Atualizado em</dt>
            <dd class="mt-1 font-medium text-slate-800">{{ formatDateTime(project.updatedAt) }}</dd>
          </div>
          <div v-if="project.url" class="sm:col-span-2">
            <dt class="text-xs text-slate-500">URL</dt>
            <dd class="mt-1"><a :href="normalizeUrl(project.url)" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">{{ project.url }}<Icon name="external-link" :size="13" /></a></dd>
          </div>
          <div v-if="project.repositorio" class="sm:col-span-2">
            <dt class="text-xs text-slate-500">Repositorio</dt>
            <dd class="mt-1"><a :href="normalizeUrl(project.repositorio)" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Icon name="git-branch" :size="13" />{{ project.repositorio }}</a></dd>
          </div>
          <div v-if="project.tecnologias?.length" class="sm:col-span-2">
            <dt class="text-xs text-slate-500">Tecnologias</dt>
            <dd class="mt-1.5 flex flex-wrap gap-1.5"><span v-for="tech in project.tecnologias" :key="tech" class="chip bg-slate-100 text-slate-600">{{ tech }}</span></dd>
          </div>
          <div v-if="project.observacoes" class="sm:col-span-2">
            <dt class="text-xs text-slate-500">Observacoes</dt>
            <dd class="mt-1 whitespace-pre-line text-slate-700">{{ project.observacoes }}</dd>
          </div>
        </dl>
      </div>

      <!-- EXECUCOES -->
      <div v-else-if="tab === 'execucoes'" class="p-6">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <button
            v-for="option in [{ id: 'all', label: 'Todas' }, { id: 'success', label: 'Sucesso' }, { id: 'failed', label: 'Falhas' }, { id: 'cancelled', label: 'Canceladas' }]"
            :key="option.id"
            type="button"
            class="chip border py-1 transition"
            :class="runFilter === option.id ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
            @click="runFilter = option.id"
          >
            {{ option.label }}
          </button>
          <button type="button" class="btn-ghost btn-sm ml-auto" :disabled="runsLoading" @click="loadRuns"><Icon name="refresh" :size="14" :class="runsLoading ? 'animate-spin' : ''" />Atualizar</button>
        </div>
        <div v-if="!filteredRuns.length" class="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Nenhuma execucao registrada.</div>
        <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          <li v-for="run in filteredRuns" :key="run.id">
            <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50" @click="emit('open-run', run.id, project.nome)">
              <span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="[RUN_STATUS[run.status]?.dot || 'bg-slate-300', run.status === 'running' ? 'animate-pulse' : '']" />
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2 text-sm">
                  <span class="font-medium text-slate-800">{{ formatDateTime(run.createdAt) }}</span>
                  <span class="chip" :class="RUN_STATUS[run.status]?.class">{{ RUN_STATUS[run.status]?.label || run.status }}</span>
                  <span class="chip bg-slate-100 text-slate-500">{{ TRIGGER_LABELS[run.triggerType] || run.triggerType }}<template v-if="run.triggerType === 'schedule' && run.triggerValue"> {{ run.triggerValue.split(" ")[1] }}</template></span>
                  <span v-if="run.artifactCount" class="chip bg-violet-50 text-violet-700"><Icon name="file" :size="11" />{{ run.artifactCount }}</span>
                </p>
                <p class="mt-0.5 truncate text-xs text-slate-500">
                  {{ run.triggeredByName || (run.triggerType === "schedule" ? "Agendador" : "-") }} · {{ formatDuration(run.durationMs) }}
                  <template v-if="run.errorMessage && run.status !== 'success'"> · <span class="text-rose-600">{{ run.errorMessage.split("\n").at(-1) }}</span></template>
                </p>
              </div>
              <Icon name="chevron-right" :size="16" class="text-slate-300" />
            </button>
          </li>
        </ul>
      </div>

      <!-- CODIGO -->
      <div v-else-if="tab === 'codigo'" class="space-y-3 p-6">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip bg-slate-900 font-mono text-white">{{ project.language }}</span>
          <span v-if="project.lastValidationStatus" class="chip" :class="project.lastValidationStatus === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">
            {{ project.lastValidationMessage }}
          </span>
          <button v-if="isManager" type="button" class="btn-secondary btn-sm ml-auto" :disabled="validating" @click="validate">
            <Icon :name="validating ? 'loader' : 'check-circle'" :size="14" :class="validating ? 'animate-spin' : ''" />Validar
          </button>
        </div>
        <p v-if="validation && !validation.ok" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ validation.message }}</p>
        <CodeEditor :model-value="project.code" :language="project.language" readonly min-height="360px" max-height="70vh" />
      </div>

      <!-- ARQUIVOS -->
      <div v-else-if="tab === 'arquivos'" class="p-6">
        <FilesManager :project-id="project.id" :files="project.files || []" :readonly="!isManager" @update:files="onFilesChanged" />
      </div>
    </template>

    <template v-if="project" #footer>
      <template v-if="isRpa && project.permissions?.canRun">
        <button type="button" class="btn-primary" :disabled="project.status === 'arquivado'" @click="emit('run', project)">
          <Icon :name="running ? 'activity' : 'play'" :size="16" />{{ running ? "Acompanhar execucao" : "Executar agora" }}
        </button>
      </template>
      <a v-else-if="!isRpa && project.url" :href="normalizeUrl(project.url)" target="_blank" rel="noopener noreferrer" class="btn-primary"><Icon name="external-link" :size="16" />Abrir sistema</a>
      <button v-if="isManager" type="button" class="btn-secondary" @click="emit('edit', project)"><Icon name="edit" :size="16" />Editar</button>
      <div class="ml-auto"><Dropdown v-if="menu.length" :items="menu" /></div>
    </template>
  </Drawer>
</template>
