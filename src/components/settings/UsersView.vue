<script setup>
import { computed, onMounted, ref } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, promptDialog, toast } from "../../lib/feedback.js";
import { formatRelative, ROLE_LABELS } from "../../lib/format.js";
import { isSuperAdmin, loadDirectory, session } from "../../stores/session.js";
import Avatar from "../ui/Avatar.vue";
import Dropdown from "../ui/Dropdown.vue";
import EmptyState from "../ui/EmptyState.vue";
import Icon from "../ui/Icon.vue";
import UserFormModal from "./UserFormModal.vue";

const tab = ref("users");
const search = ref("");
const roleFilter = ref("all");
const statusFilter = ref("all");
const loading = ref(false);
const formUser = ref(undefined); // undefined = fechado, null = novo, objeto = edicao

const users = computed(() => session.users);
const stats = computed(() => ({
  total: users.value.length,
  active: users.value.filter((user) => user.active).length,
  managers: users.value.filter((user) => user.role !== "user").length,
  inactive: users.value.filter((user) => !user.active).length
}));

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return users.value.filter((user) => (roleFilter.value === "all" || user.role === roleFilter.value)
    && (statusFilter.value === "all" || (statusFilter.value === "active" ? user.active : !user.active))
    && (!term || `${user.nome} ${user.email} ${user.departamento}`.toLowerCase().includes(term)));
});

function canEdit(user) {
  return isSuperAdmin.value || (user.role === "user" && !user.isMaster);
}

async function refresh() {
  loading.value = true;
  try {
    await loadDirectory();
  } catch (err) {
    toast.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function toggleActive(user) {
  const ok = await confirmDialog({
    title: user.active ? `Desativar ${user.nome}?` : `Reativar ${user.nome}?`,
    message: user.active ? "O usuario perde o acesso imediatamente e as sessoes abertas sao encerradas. Os dados sao mantidos." : "O usuario volta a acessar a plataforma com a senha atual.",
    confirmText: user.active ? "Desativar" : "Reativar",
    danger: user.active
  });
  if (!ok) return;
  try {
    await http.patch(`/api/users/${user.id}`, { active: !user.active });
    await refresh();
    toast(user.active ? "Usuario desativado." : "Usuario reativado.");
  } catch (err) {
    toast.error(err.message);
  }
}

async function removeUser(user) {
  const ok = await confirmDialog({
    title: `Excluir ${user.nome}?`,
    message: "Esta acao e definitiva. Sistemas sob responsabilidade dele ficarao sem responsavel. Prefira desativar se quiser manter o historico.",
    confirmText: "Excluir usuario",
    danger: true
  });
  if (!ok) return;
  try {
    const result = await http.del(`/api/users/${user.id}`);
    await refresh();
    toast(result.orphanedProjects ? `Usuario excluido. ${result.orphanedProjects} sistema(s) ficaram sem responsavel.` : "Usuario excluido.");
  } catch (err) {
    toast.error(err.message);
  }
}

function menuFor(user) {
  const items = [];
  if (canEdit(user)) items.push({ label: "Editar", icon: "edit", action: () => { formUser.value = user; } });
  if (isSuperAdmin.value && !user.isMaster && user.id !== session.user.id) {
    items.push({ label: user.active ? "Desativar" : "Reativar", icon: user.active ? "user-x" : "user-check", action: () => toggleActive(user) });
    items.push({ divider: true }, { label: "Excluir", icon: "trash", danger: true, action: () => removeUser(user) });
  }
  return items;
}

async function onSaved() {
  formUser.value = undefined;
  await refresh();
}

// ─── Departamentos ────────────────────────────────────────────────────────────
async function createDepartment() {
  const nome = await promptDialog({ title: "Novo departamento", label: "Nome" });
  if (!nome) return;
  try {
    await http.post("/api/departments", { nome });
    await refresh();
  } catch (err) {
    toast.error(err.message);
  }
}

async function renameDepartment(department) {
  const nome = await promptDialog({ title: "Renomear departamento", label: "Nome", value: department.nome });
  if (!nome) return;
  try {
    await http.patch(`/api/departments/${department.id}`, { nome });
    await refresh();
  } catch (err) {
    toast.error(err.message);
  }
}

async function removeDepartment(department) {
  const ok = await confirmDialog({
    title: `Excluir o departamento "${department.nome}"?`,
    message: `${department.userCount} usuario(s) e ${department.projectCount} sistema(s) ficarao sem departamento.`,
    confirmText: "Excluir",
    danger: true
  });
  if (!ok) return;
  try {
    await http.del(`/api/departments/${department.id}`);
    await refresh();
  } catch (err) {
    toast.error(err.message);
  }
}

onMounted(refresh);
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="section-title">Configuracoes</p>
        <h1 class="page-title mt-1">Usuarios e acessos</h1>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" :disabled="loading" @click="refresh"><Icon name="refresh" :size="16" :class="loading ? 'animate-spin' : ''" /></button>
        <button v-if="isSuperAdmin && tab === 'users'" type="button" class="btn-primary" @click="formUser = null"><Icon name="user-plus" :size="16" />Novo usuario</button>
        <button v-if="tab === 'departments'" type="button" class="btn-primary" @click="createDepartment"><Icon name="plus" :size="16" />Novo departamento</button>
      </div>
    </div>

    <nav class="mt-6 flex gap-1 border-b border-slate-200">
      <button type="button" class="tab" :class="tab === 'users' ? 'tab-active' : ''" @click="tab = 'users'">Usuarios ({{ stats.total }})</button>
      <button type="button" class="tab" :class="tab === 'departments' ? 'tab-active' : ''" @click="tab = 'departments'">Departamentos ({{ session.departments.length }})</button>
    </nav>

    <template v-if="tab === 'users'">
      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card p-4"><p class="text-xs text-slate-500">Total</p><p class="mt-1 text-2xl font-semibold">{{ stats.total }}</p></div>
        <div class="card p-4"><p class="text-xs text-slate-500">Ativos</p><p class="mt-1 text-2xl font-semibold text-emerald-700">{{ stats.active }}</p></div>
        <div class="card p-4"><p class="text-xs text-slate-500">Administradores</p><p class="mt-1 text-2xl font-semibold">{{ stats.managers }}</p></div>
        <div class="card p-4"><p class="text-xs text-slate-500">Inativos</p><p class="mt-1 text-2xl font-semibold text-slate-400">{{ stats.inactive }}</p></div>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <div class="relative min-w-[220px] flex-1">
          <Icon name="search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="search" type="search" class="input pl-9" placeholder="Buscar por nome, email ou departamento" />
        </div>
        <select v-model="roleFilter" class="input w-auto">
          <option value="all">Todos os perfis</option>
          <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
        <select v-model="statusFilter" class="input w-auto">
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      <EmptyState v-if="!filtered.length" class="mt-5" icon="users" title="Nenhum usuario encontrado" />
      <div v-else class="card mt-5 overflow-hidden">
        <div class="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_120px_140px_48px] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
          <span>Usuario</span><span>Departamento</span><span>Perfil</span><span>Status</span><span>Ultimo acesso</span><span />
        </div>
        <div
          v-for="user in filtered"
          :key="user.id"
          class="grid items-center gap-3 border-b border-slate-100 px-5 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_140px_120px_140px_48px] md:gap-4"
          :class="user.active ? '' : 'bg-slate-50/60'"
        >
          <div class="flex min-w-0 items-center gap-3">
            <Avatar :name="user.nome" :photo="user.foto" :class="user.active ? '' : 'opacity-50 grayscale'" />
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 truncate text-sm font-medium" :class="user.active ? 'text-slate-900' : 'text-slate-400'">
                {{ user.nome }}
                <Icon v-if="user.isMaster" name="crown" :size="13" class="text-amber-500" title="Usuario master" />
                <span v-if="user.id === session.user.id" class="chip bg-slate-100 text-[10px] text-slate-500">voce</span>
              </p>
              <p class="truncate text-xs text-slate-500">{{ user.email }}</p>
            </div>
          </div>
          <span class="truncate text-sm text-slate-600">{{ user.departamento || "-" }}</span>
          <span><span class="chip" :class="user.role === 'super_admin' ? 'bg-violet-50 text-violet-700' : user.role === 'admin' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'">{{ ROLE_LABELS[user.role] }}</span></span>
          <span><span class="chip" :class="user.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-500'">{{ user.active ? "Ativo" : "Inativo" }}</span></span>
          <span class="text-xs text-slate-500">{{ user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Nunca acessou" }}</span>
          <div class="flex justify-end"><Dropdown v-if="menuFor(user).length" :items="menuFor(user)" /></div>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-500">
        <Icon name="info" :size="12" class="inline" />
        {{ isSuperAdmin ? "O usuario master nao pode ser desativado, removido ou ter o perfil alterado." : "Como Admin, voce pode alterar email e senha de usuarios com perfil Usuario." }}
      </p>
    </template>

    <template v-else>
      <EmptyState v-if="!session.departments.length" class="mt-6" icon="users" title="Nenhum departamento" />
      <div v-else class="card mt-6 divide-y divide-slate-100">
        <div v-for="department in session.departments" :key="department.id" class="flex items-center gap-4 px-5 py-3">
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-900">{{ department.nome }}</p>
            <p class="text-xs text-slate-500">{{ department.userCount }} usuario(s) · {{ department.projectCount }} sistema(s)</p>
          </div>
          <button type="button" class="btn-icon h-8 w-8" title="Renomear" @click="renameDepartment(department)"><Icon name="edit" :size="15" /></button>
          <button type="button" class="btn-icon h-8 w-8 hover:text-rose-600" title="Excluir" @click="removeDepartment(department)"><Icon name="trash" :size="15" /></button>
        </div>
      </div>
    </template>

    <UserFormModal v-if="formUser !== undefined" :user="formUser" @close="formUser = undefined" @saved="onSaved" />
  </div>
</template>
