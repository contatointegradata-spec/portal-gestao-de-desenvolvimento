<script setup>
import { computed, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, promptDialog, toast } from "../../lib/feedback.js";
import { apiState, reloadTree, setEnvironment } from "../../stores/apiWorkspace.js";
import { isManager } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";
import KeyValueEditor from "../ui/KeyValueEditor.vue";
import Modal from "../ui/Modal.vue";

const emit = defineEmits(["close"]);

const selectedId = ref(apiState.environmentId || apiState.current.environments[0]?.id || null);
const variables = ref([]);
const snapshot = ref("[]");
const saving = ref(false);
const revealed = ref(false);

const environments = computed(() => apiState.current.environments);
const selected = computed(() => environments.value.find((item) => item.id === selectedId.value) || null);
const dirty = computed(() => JSON.stringify(variables.value) !== snapshot.value);
const collection = computed(() => apiState.current.collection);

watch(selected, (environment) => {
  variables.value = JSON.parse(JSON.stringify(environment?.variables || []));
  snapshot.value = JSON.stringify(variables.value);
  revealed.value = false;
}, { immediate: true });

async function selectEnvironment(id) {
  if (id === selectedId.value) return;
  if (dirty.value) {
    const ok = await confirmDialog({ title: "Descartar alteracoes?", message: "As variaveis alteradas neste ambiente nao foram salvas.", confirmText: "Descartar", danger: true });
    if (!ok) return;
  }
  selectedId.value = id;
}

async function create() {
  const name = await promptDialog({ title: "Novo ambiente", label: "Nome", placeholder: "Ex.: Producao, Homologacao, Local" });
  if (!name) return;
  try {
    const base = environments.value[0]?.variables?.map((item) => ({ key: item.key, value: item.secret ? "" : item.value, secret: item.secret, enabled: true })) || [];
    const created = await http.post("/api/apis/environments", { collectionId: collection.value.id, name, variables: base });
    await reloadTree();
    selectedId.value = created.id;
    if (!apiState.environmentId) setEnvironment(created.id);
    if (base.length) toast.info("As chaves do primeiro ambiente foram copiadas (segredos em branco).");
  } catch (err) {
    toast.error(err.message);
  }
}

async function rename() {
  const name = await promptDialog({ title: "Renomear ambiente", label: "Nome", value: selected.value.name });
  if (!name) return;
  await http.patch(`/api/apis/environments/${selected.value.id}`, { name });
  await reloadTree();
}

async function remove() {
  const ok = await confirmDialog({ title: `Excluir o ambiente "${selected.value.name}"?`, message: "As variaveis e segredos deste ambiente serao perdidos.", confirmText: "Excluir", danger: true });
  if (!ok) return;
  await http.del(`/api/apis/environments/${selected.value.id}`);
  await reloadTree();
  selectedId.value = environments.value[0]?.id || null;
}

async function makeDefault() {
  await http.patch(`/api/apis/collections/${collection.value.id}`, { activeEnvironmentId: selected.value.id });
  await reloadTree();
  toast("Ambiente padrao da colecao atualizado.");
}

async function reveal() {
  try {
    const data = await http.post("/api/apis/reveal", { target: "environment", id: selected.value.id });
    const byKey = new Map(data.variables.map((item) => [item.key, item.value]));
    variables.value = variables.value.map((item) => (item.secret && byKey.has(item.key) ? { ...item, value: byKey.get(item.key) } : item));
    snapshot.value = JSON.stringify(variables.value);
    revealed.value = true;
  } catch (err) {
    toast.error(err.message);
  }
}

async function save() {
  saving.value = true;
  try {
    await http.patch(`/api/apis/environments/${selected.value.id}`, { variables: variables.value });
    await reloadTree();
    toast("Variaveis salvas.");
  } catch (err) {
    toast.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function requestClose() {
  if (dirty.value && isManager.value) {
    const ok = await confirmDialog({ title: "Descartar alteracoes?", message: "Existem variaveis nao salvas.", confirmText: "Descartar", danger: true });
    if (!ok) return;
  }
  emit("close");
}
</script>

<template>
  <Modal title="Ambientes e variaveis" :subtitle="collection.name" size="xl" body-class="p-0" @close="requestClose">
    <div class="grid min-h-[460px] md:grid-cols-[240px_minmax(0,1fr)]">
      <aside class="border-b border-slate-100 bg-slate-50/60 p-3 md:border-b-0 md:border-r">
        <div class="space-y-1">
          <button
            v-for="environment in environments"
            :key="environment.id"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition"
            :class="environment.id === selectedId ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white'"
            @click="selectEnvironment(environment.id)"
          >
            <Icon name="sliders" :size="14" class="text-slate-400" />
            <span class="min-w-0 flex-1 truncate">{{ environment.name }}</span>
            <span v-if="collection.activeEnvironmentId === environment.id" class="chip bg-brand-50 text-[10px] text-brand-700">padrao</span>
            <span v-if="apiState.environmentId === environment.id" class="h-2 w-2 rounded-full bg-emerald-500" title="Em uso por voce" />
          </button>
          <p v-if="!environments.length" class="px-3 py-4 text-xs text-slate-400">Nenhum ambiente criado.</p>
        </div>
        <button v-if="isManager" type="button" class="btn-soft btn-sm mt-3 w-full" @click="create"><Icon name="plus" :size="14" />Novo ambiente</button>
      </aside>

      <section class="p-5">
        <div v-if="!selected" class="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
          <Icon name="key" :size="28" />
          Crie um ambiente para guardar URLs base, usuarios, tokens e senhas usadas nas requisicoes como <code class="font-mono" v-text="'{{variavel}}'" />.
        </div>
        <template v-else>
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <h3 class="mr-auto text-base font-semibold text-slate-900">{{ selected.name }}</h3>
            <button v-if="apiState.environmentId !== selected.id" type="button" class="btn-secondary btn-sm" @click="setEnvironment(selected.id)"><Icon name="check" :size="14" />Usar este ambiente</button>
            <template v-if="isManager">
              <button v-if="collection.activeEnvironmentId !== selected.id" type="button" class="btn-ghost btn-sm" title="Ambiente usado por padrao por todos os usuarios" @click="makeDefault">Tornar padrao</button>
              <button v-if="!revealed && variables.some((item) => item.secret)" type="button" class="btn-ghost btn-sm" @click="reveal"><Icon name="eye" :size="14" />Revelar segredos</button>
              <button type="button" class="btn-icon h-8 w-8" title="Renomear" @click="rename"><Icon name="edit" :size="15" /></button>
              <button type="button" class="btn-icon h-8 w-8 hover:text-rose-600" title="Excluir ambiente" @click="remove"><Icon name="trash" :size="15" /></button>
            </template>
          </div>
          <KeyValueEditor v-model="variables" key-placeholder="Variavel" value-placeholder="Valor" with-secret :readonly="!isManager" />
          <div class="mt-3 space-y-1 text-xs text-slate-500">
            <p class="flex items-center gap-1.5"><Icon name="lock" :size="12" class="text-amber-600" />Variaveis marcadas com cadeado sao criptografadas e nunca exibidas a usuarios comuns.</p>
            <p>Variaveis dinamicas: <code class="font-mono" v-text="'{{$timestamp}} {{$isoTimestamp}} {{$randomUUID}} {{$date}}'" /></p>
          </div>
        </template>
      </section>
    </div>
    <template #footer>
      <span v-if="dirty" class="mr-auto text-sm text-amber-700">Alteracoes nao salvas</span>
      <button type="button" class="btn-secondary" @click="requestClose">Fechar</button>
      <button v-if="isManager && selected" type="button" class="btn-primary" :disabled="!dirty || saving" @click="save">{{ saving ? "Salvando..." : "Salvar variaveis" }}</button>
    </template>
  </Modal>
</template>
