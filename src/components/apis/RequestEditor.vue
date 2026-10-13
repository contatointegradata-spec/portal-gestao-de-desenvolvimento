<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { METHOD_COLORS } from "../../lib/format.js";
import { replaceQuery } from "../../lib/router.js";
import {
  apiState, currentEnvironment, discardDraft, ensureRequestLoaded, folderPath, forgetRequest, inheritedAuth, isDirty, reloadTree, saveRequest, sendRequest
} from "../../stores/apiWorkspace.js";
import { isManager } from "../../stores/session.js";
import CodeEditor from "../ui/CodeEditor.vue";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";
import KeyValueEditor from "../ui/KeyValueEditor.vue";
import Modal from "../ui/Modal.vue";
import AuthEditor from "./AuthEditor.vue";
import ResponsePanel from "./ResponsePanel.vue";
import { collectVariables, toCurl } from "./curl.js";

const props = defineProps({ requestId: { type: String, required: true } });
const emit = defineEmits(["open-environments", "changed"]);

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const LAYOUT_KEY = "gestao_api_layout";
const tab = ref("params");
const saving = ref(false);
const loading = ref(true);
const loadError = ref("");
const curlModal = ref(false);
const curlText = ref("");
const layout = ref(readLayout());

function readLayout() {
  try { return localStorage.getItem(LAYOUT_KEY) || "auto"; } catch { return "auto"; }
}
watch(layout, (value) => { try { localStorage.setItem(LAYOUT_KEY, value); } catch { /* ignore */ } });

const draft = computed(() => apiState.drafts[props.requestId]);
const dirty = computed(() => isDirty(props.requestId));
const sending = computed(() => Boolean(apiState.sending[props.requestId]));
const response = computed(() => apiState.responses[props.requestId]);
const path = computed(() => folderPath(draft.value?.folderId));
const inherited = computed(() => inheritedAuth(draft.value?.folderId));

const counts = computed(() => ({
  params: (draft.value?.queryParams || []).filter((item) => item.enabled !== false && item.key).length,
  headers: (draft.value?.headers || []).filter((item) => item.enabled !== false && item.key).length,
  rules: (draft.value?.postResponse || []).filter((item) => item.enabled !== false).length
}));

const variables = computed(() => {
  if (!draft.value) return [];
  const environment = currentEnvironment();
  const known = new Map((environment?.variables || []).filter((item) => item.enabled !== false).map((item) => [item.key, item]));
  return collectVariables(draft.value).map((name) => ({
    name,
    dynamic: name.startsWith("$"),
    found: name.startsWith("$") || known.has(name),
    secret: known.get(name)?.secret || false,
    value: known.get(name)?.secret ? "" : known.get(name)?.value || ""
  }));
});
const missingVariables = computed(() => variables.value.filter((item) => !item.found));

const layoutClass = computed(() => {
  if (layout.value === "horizontal") return "grid-cols-2 grid-rows-1";
  if (layout.value === "vertical") return "grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)]";
  return "grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-2 2xl:grid-rows-1";
});

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    await ensureRequestLoaded(props.requestId);
  } catch (err) {
    loadError.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!isManager.value || !dirty.value || saving.value) return;
  if (!draft.value.name.trim()) {
    toast.error("Informe o nome da requisicao.");
    return;
  }
  saving.value = true;
  try {
    await saveRequest(props.requestId);
    toast("Requisicao salva.");
  } catch (err) {
    toast.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function send(forceTokenRefresh = false) {
  if (sending.value) return;
  if (!draft.value.url.trim()) {
    toast.error("Informe a URL da requisicao.");
    return;
  }
  try {
    const result = await sendRequest(props.requestId, { forceTokenRefresh });
    const failed = (result.extraction || []).filter((item) => !item.ok);
    if (failed.length) toast.warn(`Extracao: ${failed[0].variable} — ${failed[0].error}`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function discard() {
  const ok = await confirmDialog({ title: "Descartar alteracoes?", message: "A requisicao volta para a ultima versao salva.", confirmText: "Descartar", danger: true });
  if (ok) discardDraft(props.requestId);
}

function formatJson() {
  try {
    draft.value.bodyContent = JSON.stringify(JSON.parse(draft.value.bodyContent), null, 2);
  } catch {
    toast.error("O corpo nao e um JSON valido.");
  }
}

async function copyCurl() {
  const inheritedConfig = draft.value.authType === "inherit" ? { type: inherited.value.type, config: {} } : null;
  const text = toCurl(draft.value, inheritedConfig);
  try {
    await navigator.clipboard.writeText(text);
    toast("Comando cURL copiado.");
  } catch {
    curlText.value = text;
    curlModal.value = "view";
  }
}

async function importCurl() {
  try {
    const parsed = await http.post("/api/apis/parse-curl", { command: curlText.value });
    Object.assign(draft.value, {
      method: parsed.method,
      url: parsed.url,
      queryParams: parsed.queryParams,
      headers: parsed.headers,
      bodyType: parsed.bodyType,
      bodyContent: parsed.bodyContent,
      formFields: parsed.formFields,
      authType: parsed.authType === "none" ? draft.value.authType : parsed.authType,
      authConfig: parsed.authType === "none" ? draft.value.authConfig : parsed.authConfig,
      settings: { ...draft.value.settings, insecureTls: parsed.settings.insecureTls || draft.value.settings.insecureTls }
    });
    curlModal.value = false;
    curlText.value = "";
    toast("cURL aplicado. Revise e salve a requisicao.");
  } catch (err) {
    toast.error(err.message);
  }
}

async function duplicate() {
  try {
    const copy = await http.post(`/api/apis/requests/${props.requestId}/duplicate`);
    await reloadTree();
    replaceQuery({ req: copy.id });
    apiState.selectedRequestId = copy.id;
    await ensureRequestLoaded(copy.id);
  } catch (err) {
    toast.error(err.message);
  }
}

async function remove() {
  const ok = await confirmDialog({ title: `Excluir "${draft.value.name}"?`, message: "A requisicao e seu historico serao removidos.", confirmText: "Excluir", danger: true });
  if (!ok) return;
  try {
    await http.del(`/api/apis/requests/${props.requestId}`);
    forgetRequest(props.requestId);
    replaceQuery({ req: undefined });
    await reloadTree();
  } catch (err) {
    toast.error(err.message);
  }
}

function addRule() {
  draft.value.postResponse = [...(draft.value.postResponse || []), { id: crypto.randomUUID?.() || String(Date.now()), enabled: true, source: "body", path: "", variable: "", secret: false }];
}

function removeRule(index) {
  draft.value.postResponse = draft.value.postResponse.filter((_, ruleIndex) => ruleIndex !== index);
}

const menu = computed(() => [
  { label: "Copiar como cURL", icon: "copy", action: copyCurl },
  { label: "Importar cURL nesta requisicao", icon: "import", action: () => { curlText.value = ""; curlModal.value = "import"; } },
  ...(isManager.value ? [
    { divider: true },
    { label: "Duplicar", icon: "copy", action: duplicate },
    { label: "Excluir", icon: "trash", danger: true, action: remove }
  ] : [])
]);

function onKeydown(event) {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    send();
  } else if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
}

onMounted(() => {
  load();
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="loading && !draft" class="flex h-full items-center justify-center text-sm text-slate-400"><Icon name="loader" class="mr-2 animate-spin" />Carregando requisicao...</div>
  <div v-else-if="loadError" class="p-8 text-sm text-rose-700">{{ loadError }}</div>

  <div v-else-if="draft" class="flex h-full flex-col">
    <!-- Cabecalho -->
    <div class="flex items-center gap-3 border-b border-slate-200 px-5 py-2.5">
      <div class="min-w-0 flex-1">
        <p v-if="path.length" class="flex items-center gap-1 truncate text-[11px] text-slate-400">
          <Icon name="folder" :size="11" />{{ path.join(" / ") }}
        </p>
        <input v-model="draft.name" class="w-full truncate bg-transparent text-base font-semibold text-slate-900 outline-none focus:underline focus:decoration-brand-300" :readonly="!isManager" maxlength="200" />
      </div>
      <span v-if="dirty" class="chip bg-amber-50 text-amber-700">Nao salvo</span>
      <button v-if="dirty" type="button" class="btn-ghost btn-sm" @click="discard">Descartar</button>
      <button v-if="isManager" type="button" class="btn-secondary btn-sm" :disabled="!dirty || saving" title="Salvar (Ctrl+S)" @click="save">
        <Icon :name="saving ? 'loader' : 'save'" :size="14" :class="saving ? 'animate-spin' : ''" />Salvar
      </button>
      <div class="hidden items-center rounded-lg border border-slate-200 p-0.5 lg:flex">
        <button v-for="option in [{ id: 'auto', icon: 'layout-grid', title: 'Layout automatico' }, { id: 'vertical', icon: 'list', title: 'Resposta abaixo' }, { id: 'horizontal', icon: 'panel-left', title: 'Resposta ao lado' }]" :key="option.id" type="button" class="rounded-md p-1" :class="layout === option.id ? 'bg-slate-100 text-slate-800' : 'text-slate-400'" :title="option.title" @click="layout = option.id">
          <Icon :name="option.icon" :size="14" />
        </button>
      </div>
      <Dropdown :items="menu" :width="250" />
    </div>

    <!-- Barra de URL -->
    <div class="border-b border-slate-200 px-5 py-3">
      <div class="flex gap-2">
        <div class="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <select v-model="draft.method" class="border-r border-slate-200 bg-slate-50 px-3 font-mono text-sm font-bold outline-none" :class="METHOD_COLORS[draft.method]">
            <option v-for="method in METHODS" :key="method" :value="method">{{ method }}</option>
          </select>
          <input v-model="draft.url" class="min-w-0 flex-1 px-3 py-2.5 font-mono text-sm outline-none" placeholder="{{baseUrl}}/recurso ou https://api.exemplo.com/v1/..." spellcheck="false" @keydown.enter.prevent="send()" />
        </div>
        <button type="button" class="btn-primary px-6" :disabled="sending" title="Enviar (Ctrl+Enter)" @click="send()">
          <Icon :name="sending ? 'loader' : 'send'" :size="16" :class="sending ? 'animate-spin' : ''" />{{ sending ? "Enviando" : "Enviar" }}
        </button>
      </div>
      <div v-if="variables.length" class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span class="text-slate-400">Variaveis:</span>
        <span
          v-for="variable in variables"
          :key="variable.name"
          class="chip font-mono"
          :class="variable.dynamic ? 'bg-violet-50 text-violet-700' : variable.found ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'"
          :title="variable.dynamic ? 'Variavel dinamica' : variable.found ? (variable.secret ? 'Segredo definido no ambiente' : variable.value) : 'Nao definida no ambiente selecionado'"
        >
          <Icon v-if="variable.secret" name="lock" :size="10" />{{ variable.name }}
        </span>
        <button v-if="missingVariables.length" type="button" class="font-medium text-brand-700 hover:underline" @click="emit('open-environments')">
          {{ apiState.environmentId ? "Definir no ambiente" : "Selecionar ambiente" }}
        </button>
      </div>
    </div>

    <!-- Requisicao / Resposta -->
    <div class="grid min-h-0 flex-1" :class="layoutClass">
      <section class="flex min-h-0 flex-col border-slate-200" :class="layout === 'horizontal' ? 'border-r' : 'border-b 2xl:border-b-0 2xl:border-r'">
        <nav class="flex gap-1 overflow-x-auto border-b border-slate-100 px-4">
          <button v-for="item in [
            { id: 'params', label: 'Params', count: counts.params },
            { id: 'headers', label: 'Headers', count: counts.headers },
            { id: 'body', label: 'Body', badge: draft.bodyType !== 'none' },
            { id: 'auth', label: 'Auth', badge: draft.authType !== 'inherit' && draft.authType !== 'none' },
            { id: 'post', label: 'Pos-resposta', count: counts.rules },
            { id: 'settings', label: 'Configuracoes', badge: draft.settings?.insecureTls },
            { id: 'docs', label: 'Docs', badge: Boolean(draft.description) }
          ]" :key="item.id" type="button" class="tab flex items-center gap-1.5" :class="tab === item.id ? 'tab-active' : ''" @click="tab = item.id">
            {{ item.label }}
            <span v-if="item.count" class="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">{{ item.count }}</span>
            <span v-else-if="item.badge" class="h-1.5 w-1.5 rounded-full bg-brand-500" />
          </button>
        </nav>

        <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
          <div v-if="tab === 'params'">
            <KeyValueEditor v-model="draft.queryParams" key-placeholder="Parametro" value-placeholder="Valor" />
            <p class="hint mt-2">Parametros enviados na query string. Use <code class="font-mono" v-text="'{{variavel}}'" /> para valores do ambiente.</p>
          </div>

          <div v-else-if="tab === 'headers'">
            <KeyValueEditor v-model="draft.headers" key-placeholder="Header" value-placeholder="Valor" />
            <p class="hint mt-2">User-Agent, Accept e Content-Type sao definidos automaticamente quando nao informados.</p>
          </div>

          <div v-else-if="tab === 'body'" class="space-y-3">
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="option in [{ id: 'none', label: 'Nenhum' }, { id: 'json', label: 'JSON' }, { id: 'text', label: 'Texto' }, { id: 'xml', label: 'XML' }, { id: 'form_urlencoded', label: 'Form URL Encoded' }, { id: 'multipart', label: 'Multipart' }]"
                :key="option.id"
                type="button"
                class="rounded-lg border px-3 py-1 text-xs font-semibold"
                :class="draft.bodyType === option.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
                @click="draft.bodyType = option.id"
              >
                {{ option.label }}
              </button>
              <button v-if="draft.bodyType === 'json'" type="button" class="btn-ghost btn-sm ml-auto" @click="formatJson"><Icon name="code" :size="14" />Formatar JSON</button>
            </div>
            <CodeEditor v-if="['json', 'text', 'xml'].includes(draft.bodyType)" v-model="draft.bodyContent" :language="draft.bodyType === 'json' ? 'json' : 'text'" :dark="false" min-height="260px" @run="send()" @save="save" />
            <KeyValueEditor v-else-if="['form_urlencoded', 'multipart'].includes(draft.bodyType)" v-model="draft.formFields" key-placeholder="Campo" value-placeholder="Valor" />
            <p v-else class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">Esta requisicao nao envia corpo.</p>
          </div>

          <div v-else-if="tab === 'auth'">
            <AuthEditor v-model:type="draft.authType" v-model:config="draft.authConfig" :inherited="inherited" />
          </div>

          <div v-else-if="tab === 'post'" class="space-y-3">
            <p class="text-sm text-slate-600">Salve valores da resposta em variaveis do ambiente selecionado — por exemplo, o token retornado pelo login para usar nas proximas requisicoes com <code class="font-mono text-xs" v-text="'{{token}}'" />.</p>
            <div v-if="draft.postResponse?.length" class="overflow-hidden rounded-xl border border-slate-200">
              <div class="grid grid-cols-[32px_120px_minmax(0,1fr)_minmax(0,1fr)_60px] items-center gap-2 bg-slate-50 px-2 py-2 text-[11px] font-semibold uppercase text-slate-500">
                <span /><span>Origem</span><span>Caminho</span><span>Variavel</span><span />
              </div>
              <div v-for="(rule, index) in draft.postResponse" :key="rule.id" class="grid grid-cols-[32px_120px_minmax(0,1fr)_minmax(0,1fr)_60px] items-center gap-2 border-t border-slate-100 px-2 py-1.5">
                <input v-model="rule.enabled" type="checkbox" class="mx-auto h-4 w-4 accent-brand-600" />
                <select v-model="rule.source" class="input input-sm">
                  <option value="body">Corpo JSON</option>
                  <option value="header">Header</option>
                  <option value="status">Status</option>
                </select>
                <input v-model="rule.path" class="input input-sm font-mono" :placeholder="rule.source === 'header' ? 'x-session-id' : rule.source === 'status' ? '(nao se aplica)' : 'data.access_token'" :disabled="rule.source === 'status'" />
                <input v-model="rule.variable" class="input input-sm font-mono" placeholder="token" />
                <div class="flex justify-end gap-0.5">
                  <button type="button" class="rounded p-1" :class="rule.secret ? 'text-amber-600' : 'text-slate-300 hover:text-slate-600'" :title="rule.secret ? 'Salvo como segredo' : 'Salvar como segredo'" @click="rule.secret = !rule.secret"><Icon name="lock" :size="14" /></button>
                  <button type="button" class="rounded p-1 text-slate-300 hover:text-rose-600" @click="removeRule(index)"><Icon name="trash" :size="14" /></button>
                </div>
              </div>
            </div>
            <button type="button" class="btn-soft btn-sm" @click="addRule"><Icon name="plus" :size="14" />Adicionar regra</button>
            <p class="hint">Caminhos aceitos: <code class="font-mono">access_token</code>, <code class="font-mono">data.token</code>, <code class="font-mono">items[0].id</code>.</p>
          </div>

          <div v-else-if="tab === 'settings'" class="max-w-xl space-y-4">
            <div>
              <label class="label">Tempo limite (segundos)</label>
              <input :value="Math.round((draft.settings?.timeoutMs || 30000) / 1000)" type="number" min="1" max="300" class="input w-40" @input="draft.settings = { ...draft.settings, timeoutMs: Number($event.target.value) * 1000 }" />
            </div>
            <label class="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
              <input :checked="draft.settings?.followRedirects !== false" type="checkbox" class="mt-0.5 h-4 w-4 accent-brand-600" @change="draft.settings = { ...draft.settings, followRedirects: $event.target.checked }" />
              <span><span class="block text-sm font-medium text-slate-800">Seguir redirecionamentos</span><span class="text-xs text-slate-500">Segue respostas 301/302/303/307/308 (ate 5 saltos).</span></span>
            </label>
            <label class="flex items-start gap-3 rounded-xl border p-3" :class="draft.settings?.insecureTls ? 'border-amber-300 bg-amber-50' : 'border-slate-200'">
              <input :checked="draft.settings?.insecureTls" type="checkbox" class="mt-0.5 h-4 w-4 accent-amber-600" @change="draft.settings = { ...draft.settings, insecureTls: $event.target.checked }" />
              <span><span class="block text-sm font-medium text-slate-800">Ignorar verificacao de certificado SSL</span><span class="text-xs text-slate-500">Somente para ambientes de homologacao com certificado expirado ou autoassinado.</span></span>
            </label>
          </div>

          <div v-else-if="tab === 'docs'">
            <label class="label">Documentacao da requisicao</label>
            <textarea v-model="draft.description" rows="10" class="input" placeholder="Descreva o objetivo, parametros esperados, exemplos de resposta, contato do responsavel pela API..." :readonly="!isManager" />
          </div>
        </div>
      </section>

      <ResponsePanel :request-id="requestId" :response="response" :sending="sending" @resend="send" />
    </div>

    <Modal v-if="curlModal" :title="curlModal === 'import' ? 'Importar cURL' : 'Comando cURL'" size="lg" @close="curlModal = false">
      <p v-if="curlModal === 'import'" class="mb-3 text-sm text-slate-500">Cole um comando cURL (ex.: "Copy as cURL" do navegador). Metodo, URL, headers, corpo e autenticacao serao aplicados nesta requisicao.</p>
      <textarea v-model="curlText" rows="12" class="input font-mono text-xs" :readonly="curlModal !== 'import'" placeholder="curl -X POST https://..." />
      <template #footer>
        <button type="button" class="btn-secondary" @click="curlModal = false">Fechar</button>
        <button v-if="curlModal === 'import'" type="button" class="btn-primary" :disabled="!curlText.trim()" @click="importCurl"><Icon name="import" :size="16" />Aplicar</button>
      </template>
    </Modal>
  </div>
</template>
