<script setup>
import { reactive, ref } from "vue";
import { http, saveBlob } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { isManager } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import AuthEditor from "./AuthEditor.vue";

const props = defineProps({
  mode: { type: String, default: "create" },
  collection: { type: Object, default: null }
});
const emit = defineEmits(["close", "saved", "deleted"]);

const tab = ref("geral");
const saving = ref(false);
const error = ref("");
const form = reactive({
  name: props.collection?.name || "",
  description: props.collection?.description || "",
  scope: props.collection?.scope || "external",
  authType: props.collection?.authType || "none",
  authConfig: { ...(props.collection?.authConfig || {}) }
});

async function save() {
  error.value = "";
  if (!form.name.trim()) {
    error.value = "Informe o nome da colecao.";
    return;
  }
  saving.value = true;
  try {
    const payload = { name: form.name.trim(), description: form.description.trim(), scope: form.scope, authType: form.authType, authConfig: form.authConfig };
    const saved = props.mode === "create"
      ? await http.post("/api/apis/collections", payload)
      : await http.patch(`/api/apis/collections/${props.collection.id}`, payload);
    toast(props.mode === "create" ? "Colecao criada." : "Colecao atualizada.");
    emit("saved", saved, props.mode);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function exportCollection() {
  try {
    const data = await http.get(`/api/apis/collections/${props.collection.id}/export`);
    saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${props.collection.name.replace(/[^\w-]+/g, "_")}.postman_collection.json`);
    toast("Colecao exportada no formato Postman v2.1 (sem segredos).");
  } catch (err) {
    toast.error(err.message);
  }
}

async function remove() {
  const ok = await confirmDialog({
    title: `Excluir a colecao "${props.collection.name}"?`,
    message: `Serao removidas ${props.collection.requestCount} requisicao(oes), ${props.collection.folderCount} pasta(s), ${props.collection.environmentCount} ambiente(s) e todo o historico. Esta acao nao pode ser desfeita.`,
    confirmText: "Excluir colecao",
    danger: true
  });
  if (!ok) return;
  try {
    await http.del(`/api/apis/collections/${props.collection.id}`);
    toast("Colecao excluida.");
    emit("deleted");
  } catch (err) {
    toast.error(err.message);
  }
}
</script>

<template>
  <Modal :title="mode === 'create' ? 'Nova colecao de API' : 'Configuracoes da colecao'" :subtitle="mode === 'create' ? 'Agrupe requisicoes de um mesmo sistema ou fornecedor.' : collection?.name" size="lg" @close="emit('close')">
    <nav v-if="mode !== 'create'" class="-mt-2 mb-5 flex gap-1 border-b border-slate-100">
      <button type="button" class="tab" :class="tab === 'geral' ? 'tab-active' : ''" @click="tab = 'geral'">Geral</button>
      <button type="button" class="tab" :class="tab === 'auth' ? 'tab-active' : ''" @click="tab = 'auth'">Autenticacao</button>
    </nav>

    <div v-show="tab === 'geral'" class="space-y-4">
      <div>
        <label class="label">Nome *</label>
        <input v-model="form.name" class="input" placeholder="Ex.: API SGU, CRM JMJ, Piramide" :readonly="!isManager" autofocus />
      </div>
      <div>
        <label class="label">Descricao</label>
        <textarea v-model="form.description" rows="3" class="input" placeholder="Para que serve, contato do fornecedor, link da documentacao..." :readonly="!isManager" />
      </div>
      <div>
        <label class="label">Tipo de API</label>
        <div class="grid gap-2 sm:grid-cols-2">
          <button v-for="option in [{ id: 'internal', label: 'Interna', description: 'Sistemas internos / rede interna', icon: 'server' }, { id: 'external', label: 'Externa', description: 'Fornecedores e servicos de terceiros', icon: 'globe' }]" :key="option.id" type="button" class="flex items-start gap-3 rounded-xl border p-3 text-left" :class="form.scope === option.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'" :disabled="!isManager" @click="form.scope = option.id">
            <Icon :name="option.icon" :size="18" class="mt-0.5 text-slate-500" />
            <span><span class="block text-sm font-semibold text-slate-800">{{ option.label }}</span><span class="text-xs text-slate-500">{{ option.description }}</span></span>
          </button>
        </div>
      </div>
      <div v-if="mode !== 'create' && isManager" class="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button type="button" class="btn-secondary btn-sm" @click="exportCollection"><Icon name="download" :size="14" />Exportar (Postman v2.1)</button>
        <button type="button" class="btn-danger-soft btn-sm" @click="remove"><Icon name="trash" :size="14" />Excluir colecao</button>
      </div>
    </div>

    <div v-if="mode !== 'create' && tab === 'auth'">
      <p class="mb-4 text-sm text-slate-500">Autenticacao padrao da colecao. Pastas e requisicoes com "Herdar" usam esta configuracao.</p>
      <AuthEditor v-model:type="form.authType" v-model:config="form.authConfig" :allow-inherit="false" :readonly="!isManager" />
    </div>

    <template #footer>
      <p v-if="error" class="mr-auto text-sm text-rose-700">{{ error }}</p>
      <button type="button" class="btn-secondary" @click="emit('close')">{{ isManager ? "Cancelar" : "Fechar" }}</button>
      <button v-if="isManager" type="button" class="btn-primary" :disabled="saving" @click="save">{{ saving ? "Salvando..." : mode === "create" ? "Criar colecao" : "Salvar" }}</button>
    </template>
  </Modal>
</template>
