<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { PROJECT_STATUS } from "../../lib/format.js";
import { replaceQuery, route } from "../../lib/router.js";
import { isManager, refreshActiveRuns, session } from "../../stores/session.js";
import EmptyState from "../ui/EmptyState.vue";
import Icon from "../ui/Icon.vue";
import ProjectCard from "./ProjectCard.vue";
import ProjectRow from "./ProjectRow.vue";
import RunMonitor from "./RunMonitor.vue";

// Formulario e detalhes usam o editor de codigo (carregado sob demanda).
const ProjectDrawer = defineAsyncComponent(() => import("./ProjectDrawer.vue"));
const ProjectFormModal = defineAsyncComponent(() => import("./ProjectFormModal.vue"));

const VIEW_KEY = "gestao_projects_view";
const projects = ref([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref("all");
const departmentFilter = ref("all");
const sortBy = ref("updated");
const viewMode = ref(readViewMode());

const formOpen = ref(false);
const editingProject = ref(null);
const drawerProjectId = ref(null);
const monitor = ref(null); // { runId, projectName }

function readViewMode() {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

watch(viewMode, (value) => {
  try { localStorage.setItem(VIEW_KEY, value); } catch { /* ignore */ }
});

const typeFilter = computed({
  get: () => (route.query.tipo === "rpa" ? "rpa" : route.query.tipo === "sistema" ? "common" : "all"),
  set: (value) => replaceQuery({ tipo: value === "rpa" ? "rpa" : value === "common" ? "sistema" : undefined })
});

const departments = computed(() => [...new Set(projects.value.map((item) => item.department).filter(Boolean))].sort());

const stats = computed(() => {
  const list = projects.value;
  const rpas = list.filter((item) => item.systemType === "rpa");
  return {
    total: list.length,
    common: list.filter((item) => item.systemType !== "rpa").length,
    active: list.filter((item) => item.status === "ativo").length,
    rpa: rpas.length,
    scheduled: rpas.filter((item) => item.schedule?.mode !== "manual").length,
    running: session.activeRuns.length,
    failures: rpas.filter((item) => ["error", "timeout", "interrupted"].includes(item.lastRunStatus)).length
  };
});

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  const list = projects.value.filter((item) => {
    if (typeFilter.value !== "all" && item.systemType !== typeFilter.value) return false;
    if (statusFilter.value !== "all" && item.status !== statusFilter.value) return false;
    if (departmentFilter.value !== "all" && item.department !== departmentFilter.value) return false;
    if (!term) return true;
    return [item.nome, item.descricao, item.ownerName, item.department, ...(item.tecnologias || [])].some((value) => String(value || "").toLowerCase().includes(term));
  });
  const sorters = {
    updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
    name: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    lastRun: (a, b) => String(b.lastRunAt || "").localeCompare(String(a.lastRunAt || ""))
  };
  return [...list].sort(sorters[sortBy.value]);
});

const hasFilters = computed(() => search.value || statusFilter.value !== "all" || departmentFilter.value !== "all" || typeFilter.value !== "all");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    projects.value = await http.get("/api/projects");
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function upsert(project) {
  const index = projects.value.findIndex((item) => item.id === project.id);
  if (index >= 0) projects.value[index] = { ...projects.value[index], ...project };
  else projects.value.unshift(project);
}

function clearFilters() {
  search.value = "";
  statusFilter.value = "all";
  departmentFilter.value = "all";
  typeFilter.value = "all";
}

function openCreate() {
  editingProject.value = null;
  formOpen.value = true;
}

async function openEdit(project) {
  try {
    editingProject.value = await http.get(`/api/projects/${project.id}`);
    formOpen.value = true;
  } catch (err) {
    toast.error(err.message);
  }
}

const drawerKey = ref(0);

function onSaved(project) {
  upsert(project);
  formOpen.value = false;
  drawerProjectId.value = project.id;
  drawerKey.value += 1;
  replaceQuery({ projeto: project.id });
}

function openDrawer(project) {
  drawerProjectId.value = project.id;
  replaceQuery({ projeto: project.id });
}

function closeDrawer() {
  drawerProjectId.value = null;
  replaceQuery({ projeto: undefined, execucao: undefined });
}

async function runProject(project) {
  if (project.activeRunId) {
    monitor.value = { runId: project.activeRunId, projectName: project.nome };
    return;
  }
  try {
    const { runId } = await http.post(`/api/projects/${project.id}/runs`);
    upsert({ id: project.id, activeRunId: runId, lastRunStatus: "running" });
    monitor.value = { runId, projectName: project.nome };
    refreshActiveRuns().catch(() => {});
  } catch (err) {
    if (err.status === 409 && err.data?.runId) {
      monitor.value = { runId: err.data.runId, projectName: project.nome };
      return;
    }
    toast.error(err.message);
  }
}

function openRun(runId, projectName) {
  monitor.value = { runId, projectName };
}

async function onRunFinished(run) {
  refreshActiveRuns().catch(() => {});
  try {
    const project = await http.get(`/api/projects/${run.projectId}`);
    upsert(project);
  } catch { /* sistema removido */ }
}

async function duplicateProject(project) {
  try {
    const copy = await http.post(`/api/projects/${project.id}/duplicate`);
    upsert(copy);
    toast(`"${copy.nome}" criado. O agendamento da copia fica manual.`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function deleteProject(project) {
  const ok = await confirmDialog({
    title: `Excluir "${project.nome}"?`,
    message: project.systemType === "rpa"
      ? "O codigo, os arquivos de entrada, o agendamento e todo o historico de execucoes serao removidos. Esta acao nao pode ser desfeita."
      : "O sistema sera removido do catalogo. Esta acao nao pode ser desfeita.",
    confirmText: "Excluir",
    danger: true
  });
  if (!ok) return;
  try {
    await http.del(`/api/projects/${project.id}`);
    projects.value = projects.value.filter((item) => item.id !== project.id);
    if (drawerProjectId.value === project.id) closeDrawer();
    toast("Sistema excluido.");
  } catch (err) {
    toast.error(err.message);
  }
}

const cardActions = { run: runProject, edit: openEdit, duplicate: duplicateProject, remove: deleteProject, open: openDrawer };

// Sincroniza a URL (links de notificacao abrem o sistema/execucao)
watch(() => [route.query.projeto, route.query.execucao], ([projectId, runId]) => {
  if (projectId && drawerProjectId.value !== projectId) drawerProjectId.value = projectId;
  if (runId && monitor.value?.runId !== runId) {
    monitor.value = { runId, projectName: projects.value.find((item) => item.id === projectId)?.nome || "" };
    replaceQuery({ execucao: undefined });
  }
}, { immediate: true });

// Mantem o estado "em execucao" dos cards alinhado com o servidor.
watch(() => session.activeRuns.map((run) => run.id).join(","), (current, previous) => {
  const activeByProject = new Map(session.activeRuns.map((run) => [run.projectId, run.id]));
  for (const project of projects.value) {
    const activeRunId = activeByProject.get(project.id) || null;
    if (project.activeRunId && !activeRunId && previous !== undefined) {
      http.get(`/api/projects/${project.id}`).then(upsert).catch(() => {});
    }
    project.activeRunId = activeRunId;
  }
});

onMounted(load);
</script>

<template>
  <div class="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
    <!-- Cabecalho -->
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="section-title">Gestao de desenvolvimento</p>
        <h1 class="page-title mt-1">{{ typeFilter === "rpa" ? "Automacoes RPA" : "Sistemas e automacoes" }}</h1>
        <p class="mt-1 text-sm text-slate-500">
          {{ typeFilter === "rpa" ? "Robos em Python ou JavaScript com execucao ao vivo, arquivos de entrada e agendamento." : "Catalogo das aplicacoes da empresa e dos robos RPA." }}
        </p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" :disabled="loading" @click="load"><Icon name="refresh" :size="16" :class="loading ? 'animate-spin' : ''" />Atualizar</button>
        <button v-if="isManager" type="button" class="btn-primary" @click="openCreate"><Icon name="plus" :size="16" />Novo sistema</button>
      </div>
    </div>

    <!-- Indicadores -->
    <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <button type="button" class="card p-4 text-left transition hover:border-brand-200" @click="typeFilter = 'all'; statusFilter = 'all'">
        <p class="text-xs font-medium text-slate-500">Total</p>
        <p class="mt-1 text-2xl font-semibold text-slate-900">{{ stats.total }}</p>
        <p class="mt-1 text-xs text-slate-400">{{ stats.active }} ativo(s)</p>
      </button>
      <button type="button" class="card p-4 text-left transition hover:border-brand-200" @click="typeFilter = 'common'">
        <p class="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon name="layout-grid" :size="14" />Sistemas</p>
        <p class="mt-1 text-2xl font-semibold text-slate-900">{{ stats.common }}</p>
        <p class="mt-1 text-xs text-slate-400">aplicacoes catalogadas</p>
      </button>
      <button type="button" class="card p-4 text-left transition hover:border-brand-200" @click="typeFilter = 'rpa'">
        <p class="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon name="bot" :size="14" />Automacoes RPA</p>
        <p class="mt-1 text-2xl font-semibold text-slate-900">{{ stats.rpa }}</p>
        <p class="mt-1 text-xs text-slate-400">{{ stats.scheduled }} agendada(s)</p>
      </button>
      <div class="card p-4" :class="stats.running ? 'border-sky-200 bg-sky-50/50' : ''">
        <p class="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon name="activity" :size="14" />Em execucao</p>
        <p class="mt-1 flex items-center gap-2 text-2xl font-semibold" :class="stats.running ? 'text-sky-700' : 'text-slate-900'">
          {{ stats.running }}<span v-if="stats.running" class="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
        </p>
        <p class="mt-1 text-xs text-slate-400">agora</p>
      </div>
      <button type="button" class="card p-4 text-left transition hover:border-rose-200" :class="stats.failures ? 'border-rose-200 bg-rose-50/40' : ''" @click="typeFilter = 'rpa'; sortBy = 'lastRun'">
        <p class="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon name="alert-triangle" :size="14" />Com falha</p>
        <p class="mt-1 text-2xl font-semibold" :class="stats.failures ? 'text-rose-700' : 'text-slate-900'">{{ stats.failures }}</p>
        <p class="mt-1 text-xs text-slate-400">na ultima execucao</p>
      </button>
    </div>

    <!-- Filtros -->
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <div class="relative min-w-[240px] flex-1">
        <Icon name="search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input v-model="search" type="search" class="input pl-9" placeholder="Buscar por nome, descricao, responsavel, departamento ou tecnologia" />
      </div>
      <div class="flex rounded-xl border border-slate-200 bg-white p-1">
        <button
          v-for="option in [{ id: 'all', label: 'Todos' }, { id: 'common', label: 'Sistemas' }, { id: 'rpa', label: 'RPA' }]"
          :key="option.id"
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm font-medium transition"
          :class="typeFilter === option.id ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'"
          @click="typeFilter = option.id"
        >
          {{ option.label }}
        </button>
      </div>
      <select v-model="statusFilter" class="input w-auto">
        <option value="all">Todos os status</option>
        <option v-for="(status, key) in PROJECT_STATUS" :key="key" :value="key">{{ status.label }}</option>
      </select>
      <select v-if="departments.length > 1" v-model="departmentFilter" class="input w-auto">
        <option value="all">Todos os departamentos</option>
        <option v-for="department in departments" :key="department" :value="department">{{ department }}</option>
      </select>
      <select v-model="sortBy" class="input w-auto">
        <option value="updated">Atualizados recentemente</option>
        <option value="name">Nome (A-Z)</option>
        <option value="lastRun">Ultima execucao</option>
      </select>
      <div class="flex rounded-xl border border-slate-200 bg-white p-1">
        <button type="button" class="rounded-lg p-1.5" :class="viewMode === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'" title="Cartoes" @click="viewMode = 'grid'"><Icon name="layout-grid" :size="16" /></button>
        <button type="button" class="rounded-lg p-1.5" :class="viewMode === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'" title="Lista" @click="viewMode = 'list'"><Icon name="list" :size="16" /></button>
      </div>
    </div>

    <p v-if="error" class="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

    <!-- Conteudo -->
    <div v-if="loading && !projects.length" class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <div v-for="index in 6" :key="index" class="card h-72 animate-pulse bg-slate-100/60" />
    </div>

    <EmptyState
      v-else-if="!filtered.length"
      class="mt-6"
      :icon="hasFilters ? 'search' : 'layout-grid'"
      :title="hasFilters ? 'Nenhum resultado para os filtros' : 'Nenhum sistema cadastrado'"
      :description="hasFilters ? 'Ajuste a busca ou limpe os filtros.' : isManager ? 'Cadastre a primeira aplicacao ou automacao RPA.' : 'Voce ainda nao e responsavel por nenhum sistema.'"
    >
      <button v-if="hasFilters" type="button" class="btn-secondary" @click="clearFilters">Limpar filtros</button>
      <button v-else-if="isManager" type="button" class="btn-primary" @click="openCreate"><Icon name="plus" :size="16" />Novo sistema</button>
    </EmptyState>

    <div v-else-if="viewMode === 'grid'" class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <ProjectCard v-for="project in filtered" :key="project.id" :project="project" v-on="cardActions" />
    </div>

    <div v-else class="card mt-6 overflow-hidden">
      <div class="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_120px] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:grid">
        <span>Sistema</span><span>Responsavel</span><span>Status</span><span>Execucao / agenda</span><span class="text-right">Acoes</span>
      </div>
      <ProjectRow v-for="project in filtered" :key="project.id" :project="project" v-on="cardActions" />
    </div>

    <p v-if="filtered.length" class="mt-4 text-center text-xs text-slate-400">{{ filtered.length }} de {{ projects.length }} sistema(s)</p>

    <ProjectFormModal v-if="formOpen" :project="editingProject" @close="formOpen = false" @saved="onSaved" />
    <ProjectDrawer
      v-if="drawerProjectId"
      :key="`${drawerProjectId}-${drawerKey}`"
      :project-id="drawerProjectId"
      @close="closeDrawer"
      @edit="openEdit"
      @run="runProject"
      @open-run="openRun"
      @duplicate="duplicateProject"
      @remove="deleteProject"
      @updated="upsert"
    />
    <RunMonitor v-if="monitor" :run-id="monitor.runId" :project-name="monitor.projectName" @close="monitor = null" @finished="onRunFinished" />
  </div>
</template>
