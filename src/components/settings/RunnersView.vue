<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { formatRelative } from "../../lib/format.js";
import Dropdown from "../ui/Dropdown.vue";
import EmptyState from "../ui/EmptyState.vue";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import RunnerFormModal from "./RunnerFormModal.vue";
import RunnerInstallModal from "./RunnerInstallModal.vue";
import RunnerScreen from "./RunnerScreen.vue";

const REFRESH_MS = 10_000;
const runners = ref([]);
const loading = ref(false);
const formRunner = ref(undefined); // undefined = fechado, null = novo, objeto = edicao
const install = ref(null); // { runner, token }
const screenRunner = ref(null);
let timer = null;

const stats = computed(() => ({
  total: runners.value.length,
  online: runners.value.filter((runner) => runner.online).length,
  running: runners.value.reduce((sum, runner) => sum + runner.runningCount, 0)
}));

function statusOf(runner) {
  if (!runner.active) return { label: "Desativado", class: "bg-slate-200 text-slate-500", dot: "bg-slate-400" };
  if (runner.online) return { label: "Online", class: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500 animate-pulse" };
  if (!runner.lastSeenAt) return { label: "Aguardando agente", class: "bg-amber-50 text-amber-700", dot: "bg-amber-400" };
  return { label: "Offline", class: "bg-rose-50 text-rose-700", dot: "bg-rose-500" };
}

async function refresh({ silent = false } = {}) {
  if (!silent) loading.value = true;
  try {
    runners.value = await http.get("/api/runners");
  } catch (err) {
    if (!silent) toast.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function onSaved(result) {
  formRunner.value = undefined;
  await refresh();
  if (result?.token) install.value = { runner: result.runner, token: result.token };
}

async function toggleActive(runner) {
  const ok = await confirmDialog({
    title: runner.active ? `Desativar ${runner.nome}?` : `Reativar ${runner.nome}?`,
    message: runner.active ? "O servidor deixa de receber execucoes. RPAs vinculados a ele falham ao iniciar ate ser reativado." : "O servidor volta a receber execucoes assim que o agente se conectar.",
    confirmText: runner.active ? "Desativar" : "Reativar",
    danger: runner.active
  });
  if (!ok) return;
  try {
    await http.patch(`/api/runners/${runner.id}`, { active: !runner.active });
    await refresh();
  } catch (err) {
    toast.error(err.message);
  }
}

async function removeRunner(runner) {
  const ok = await confirmDialog({
    title: `Excluir ${runner.nome}?`,
    message: runner.projectCount
      ? `${runner.projectCount} RPA(s) usam este servidor e passarao a rodar no servidor da plataforma. O agente instalado deixa de funcionar.`
      : "O agente instalado neste servidor deixa de funcionar.",
    confirmText: "Excluir servidor",
    danger: true
  });
  if (!ok) return;
  try {
    await http.del(`/api/runners/${runner.id}`);
    await refresh();
    toast("Servidor excluido.");
  } catch (err) {
    toast.error(err.message);
  }
}

function menuFor(runner) {
  return [
    { label: "Ver tela ao vivo", icon: "eye", action: () => { screenRunner.value = runner; } },
    { label: "Editar", icon: "edit", action: () => { formRunner.value = runner; } },
    { label: "Instalar / reinstalar agente", icon: "download", action: () => { install.value = { runner, token: "" }; } },
    { label: runner.active ? "Desativar" : "Reativar", icon: runner.active ? "stop" : "play", action: () => toggleActive(runner) },
    { divider: true },
    { label: "Excluir", icon: "trash", danger: true, action: () => removeRunner(runner) }
  ];
}

onMounted(() => {
  refresh();
  timer = setInterval(() => refresh({ silent: true }), REFRESH_MS);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="section-title">Configuracoes</p>
        <h1 class="page-title mt-1">Servidores de execucao</h1>
        <p class="mt-1 max-w-2xl text-sm text-slate-500">
          Cadastre os servidores onde os robos podem rodar. Cada servidor usa um agente instalado nele, e cada RPA escolhe o servidor na aba Execucao.
        </p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" :disabled="loading" title="Atualizar" @click="refresh()"><Icon name="refresh" :size="16" :class="loading ? 'animate-spin' : ''" /></button>
        <button type="button" class="btn-primary" @click="formRunner = null"><Icon name="plus" :size="16" />Novo servidor</button>
      </div>
    </div>

    <div class="mt-6 grid grid-cols-3 gap-3">
      <div class="card p-4"><p class="text-xs text-slate-500">Servidores</p><p class="mt-1 text-2xl font-semibold">{{ stats.total }}</p></div>
      <div class="card p-4"><p class="text-xs text-slate-500">Online</p><p class="mt-1 text-2xl font-semibold text-emerald-700">{{ stats.online }}</p></div>
      <div class="card p-4"><p class="text-xs text-slate-500">Executando agora</p><p class="mt-1 text-2xl font-semibold text-sky-700">{{ stats.running }}</p></div>
    </div>

    <div class="mt-5 grid gap-4 lg:grid-cols-2">
      <!-- Servidor padrao -->
      <div class="card flex items-start gap-4 p-5">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon name="database" :size="20" /></div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-semibold text-slate-900">Servidor da plataforma</p>
            <span class="chip bg-emerald-50 text-emerald-700"><span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />Online</span>
            <span class="chip bg-slate-100 text-slate-500">padrao</span>
          </div>
          <p class="mt-1 text-sm text-slate-500">Docker onde a plataforma roda. Usado pelos RPAs sem servidor definido; o navegador visivel e transmitido ao vivo na tela de execucao.</p>
        </div>
      </div>

      <div v-for="runner in runners" :key="runner.id" class="card p-5" :class="runner.active ? '' : 'opacity-70'">
        <div class="flex items-start gap-4">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><Icon name="server" :size="20" /></div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate font-semibold text-slate-900">{{ runner.nome }}</p>
              <span class="chip" :class="statusOf(runner).class"><span class="h-1.5 w-1.5 rounded-full" :class="statusOf(runner).dot" />{{ statusOf(runner).label }}</span>
              <span v-if="runner.runningCount" class="chip bg-sky-50 text-sky-700"><Icon name="loader" :size="11" class="animate-spin" />{{ runner.runningCount }} executando</span>
              <span v-if="runner.queuedCount" class="chip bg-violet-50 text-violet-700">{{ runner.queuedCount }} na fila</span>
            </div>
            <p v-if="runner.descricao" class="mt-0.5 truncate text-sm text-slate-500">{{ runner.descricao }}</p>
          </div>
          <button v-if="runner.active" type="button" class="btn-soft btn-sm" :disabled="!runner.online" :title="runner.online ? 'Ver a tela do servidor ao vivo' : 'Agente offline'" @click="screenRunner = runner">
            <Icon name="eye" :size="14" />Ver tela
          </button>
          <Dropdown :items="menuFor(runner)" />
        </div>

        <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div><dt class="text-slate-400">Hostname / IP</dt><dd class="truncate font-mono text-slate-700">{{ runner.hostname }}</dd></div>
          <div><dt class="text-slate-400">Usuario</dt><dd class="flex items-center gap-1 truncate font-mono text-slate-700">{{ runner.username || "-" }}<Icon v-if="runner.hasPassword" name="lock" :size="11" class="text-slate-400" title="Senha salva (criptografada)" /></dd></div>
          <template v-if="runner.agent">
            <div><dt class="text-slate-400">Maquina do agente</dt><dd class="truncate text-slate-700">{{ runner.agent.hostname }} · {{ runner.agent.username }}</dd></div>
            <div><dt class="text-slate-400">Ambiente</dt><dd class="truncate text-slate-700">{{ runner.agent.python || "sem Python" }} · Node {{ runner.agent.node }}</dd></div>
            <div><dt class="text-slate-400">Agente</dt>
              <dd class="text-slate-700">
                v{{ runner.agent.version }}
                <span v-if="runner.agent.version !== runner.latestAgentVersion" class="text-amber-600">(atualizar para v{{ runner.latestAgentVersion }})</span>
              </dd>
            </div>
          </template>
          <div><dt class="text-slate-400">Ultimo contato</dt><dd class="text-slate-700">{{ runner.lastSeenAt ? formatRelative(runner.lastSeenAt) : "nunca" }}</dd></div>
          <div><dt class="text-slate-400">RPAs vinculados</dt><dd class="text-slate-700">{{ runner.projectCount }}</dd></div>
        </dl>

        <div v-if="runner.active && !runner.lastSeenAt" class="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          <Icon name="alert-triangle" :size="14" />O agente ainda nao se conectou.
          <button type="button" class="font-semibold underline" @click="install = { runner, token: '' }">Ver instrucoes de instalacao</button>
        </div>
        <p v-if="runner.agent && runner.active && !runner.agent.python" class="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
          <Icon name="alert-triangle" :size="13" />Python nao encontrado no servidor: robos Python vao falhar.
        </p>
        <p v-else-if="runner.agent && runner.active && runner.agent.screenCapture === false" class="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
          <Icon name="alert-triangle" :size="13" />Tela ao vivo indisponivel: rode <code class="rounded bg-amber-50 px-1 font-mono">pip install pillow mss</code> no servidor.
        </p>
      </div>
    </div>

    <EmptyState
      v-if="!loading && !runners.length"
      class="mt-4"
      icon="server"
      title="Nenhum servidor remoto cadastrado"
      description="Cadastre um servidor (ex.: a maquina Windows que voce acessa pelo mRemoteNG) para rodar robos com o navegador visivel na area de trabalho dele."
    >
      <button type="button" class="btn-primary" @click="formRunner = null"><Icon name="plus" :size="16" />Cadastrar servidor</button>
    </EmptyState>

    <RunnerFormModal v-if="formRunner !== undefined" :runner="formRunner" @close="formRunner = undefined" @saved="onSaved" />
    <Modal v-if="screenRunner" size="full" body-class="p-0" :title="`Tela ao vivo · ${screenRunner.nome}`" :subtitle="`${screenRunner.hostname} · ${screenRunner.username || ''} — somente visualizacao`" @close="screenRunner = null">
      <div class="h-[78vh]"><RunnerScreen :runner-id="screenRunner.id" :runner-name="screenRunner.nome" /></div>
    </Modal>
    <RunnerInstallModal v-if="install" :runner="install.runner" :token="install.token" @token="refresh({ silent: true })" @close="install = null" />
  </div>
</template>
