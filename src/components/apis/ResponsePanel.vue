<script setup>
import { computed, ref, watch } from "vue";
import { http, saveBlob } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { formatBytes, formatDateTime, formatDuration, formatRelative, METHOD_COLORS } from "../../lib/format.js";
import { isManager } from "../../stores/session.js";
import CodeEditor from "../ui/CodeEditor.vue";
import Icon from "../ui/Icon.vue";

const props = defineProps({
  requestId: { type: String, required: true },
  response: { type: Object, default: null },
  sending: { type: Boolean, default: false }
});
const emit = defineEmits(["resend"]);

const tab = ref("body");
const bodyMode = ref("pretty");
const history = ref([]);
const historyLoading = ref(false);
const historyEntry = ref(null);

const shown = computed(() => historyEntry.value || props.response);
const isHistory = computed(() => Boolean(historyEntry.value));

watch(() => props.response?.receivedAt, () => {
  historyEntry.value = null;
  if (tab.value === "history") tab.value = "body";
  if (history.value.length) loadHistory();
});

const statusClass = computed(() => {
  const code = shown.value?.statusCode;
  if (!code) return "bg-rose-100 text-rose-700";
  if (code < 300) return "bg-emerald-100 text-emerald-700";
  if (code < 400) return "bg-sky-100 text-sky-700";
  if (code < 500) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
});

const contentType = computed(() => String(shown.value?.contentType || shown.value?.headers?.["content-type"] || ""));
const isJson = computed(() => {
  if (/json/i.test(contentType.value)) return true;
  const text = String(shown.value?.body ?? shown.value?.responseBody ?? "").trim();
  return (text.startsWith("{") || text.startsWith("[")) && (() => { try { JSON.parse(text); return true; } catch { return false; } })();
});
const isHtml = computed(() => /html/i.test(contentType.value));
const isImage = computed(() => /^image\//i.test(contentType.value) && shown.value?.bodyEncoding === "base64");
const rawBody = computed(() => (isHistory.value ? shown.value?.responseBody : shown.value?.body) || "");
const prettyBody = computed(() => {
  if (!isJson.value) return rawBody.value;
  try { return JSON.stringify(JSON.parse(rawBody.value), null, 2); } catch { return rawBody.value; }
});
const headersList = computed(() => Object.entries((isHistory.value ? shown.value?.responseHeaders : shown.value?.headers) || {}));
const requestHeaders = computed(() => Object.entries((isHistory.value ? shown.value?.requestHeaders : shown.value?.request?.headers) || {}));

async function loadHistory() {
  historyLoading.value = true;
  try {
    history.value = await http.get(`/api/apis/requests/${props.requestId}/history`);
  } catch (err) {
    toast.error(err.message);
  } finally {
    historyLoading.value = false;
  }
}

async function openHistory(entry) {
  try {
    const detail = await http.get(`/api/apis/history/${entry.id}`);
    historyEntry.value = { ...detail, size: detail.responseSize, contentType: detail.responseHeaders?.["content-type"] || "" };
    tab.value = "body";
  } catch (err) {
    toast.error(err.message);
  }
}

async function clearHistory() {
  await http.del(`/api/apis/requests/${props.requestId}/history`);
  history.value = [];
}

async function copyBody() {
  try {
    await navigator.clipboard.writeText(bodyMode.value === "pretty" ? prettyBody.value : rawBody.value);
    toast("Resposta copiada.");
  } catch {
    toast.error("Nao foi possivel copiar.");
  }
}

function downloadBody() {
  const extension = isJson.value ? "json" : isHtml.value ? "html" : /xml/i.test(contentType.value) ? "xml" : "txt";
  if (shown.value?.bodyEncoding === "base64") {
    const bytes = Uint8Array.from(atob(rawBody.value), (char) => char.charCodeAt(0));
    saveBlob(new Blob([bytes], { type: contentType.value }), "resposta.bin");
  } else {
    saveBlob(new Blob([bodyMode.value === "pretty" ? prettyBody.value : rawBody.value], { type: "text/plain;charset=utf-8" }), `resposta.${extension}`);
  }
}

watch(tab, (value) => {
  if (value === "history" && !history.value.length) loadHistory();
});
</script>

<template>
  <section class="flex min-h-0 flex-col bg-slate-50/40">
    <!-- Barra de status -->
    <div class="flex min-h-[48px] flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
      <template v-if="sending">
        <Icon name="loader" :size="16" class="animate-spin text-sky-500" /><span class="text-sm text-slate-500">Aguardando resposta...</span>
      </template>
      <template v-else-if="shown">
        <span v-if="isHistory" class="chip bg-violet-100 text-violet-700"><Icon name="history" :size="11" />Historico · {{ formatDateTime(shown.createdAt) }}</span>
        <span class="chip py-1 font-mono text-xs font-bold" :class="statusClass">{{ shown.statusCode ? `${shown.statusCode} ${shown.statusText || ""}` : "Erro" }}</span>
        <span class="flex items-center gap-1 text-xs text-slate-500"><Icon name="clock" :size="12" />{{ formatDuration(shown.durationMs) }}</span>
        <span class="flex items-center gap-1 text-xs text-slate-500"><Icon name="database" :size="12" />{{ formatBytes(shown.size ?? shown.responseSize) }}</span>
        <span v-if="!isHistory && shown.auth?.type && shown.auth.type !== 'none'" class="chip bg-amber-50 text-amber-700" :title="`Autenticacao: ${shown.auth.source}`"><Icon name="lock" :size="11" />{{ shown.auth.source }}<template v-if="shown.auth.tokenFromCache"> · token em cache</template></span>
        <span v-if="!isHistory && shown.environmentName" class="chip bg-slate-100 text-slate-600"><Icon name="sliders" :size="11" />{{ shown.environmentName }}</span>
        <div class="ml-auto flex items-center gap-1">
          <button v-if="isHistory" type="button" class="btn-ghost btn-sm" @click="historyEntry = null">Voltar a ultima resposta</button>
          <button v-if="!isHistory && shown.auth?.type === 'oauth2'" type="button" class="btn-ghost btn-sm" title="Solicitar novo token OAuth2 e reenviar" @click="emit('resend', true)"><Icon name="refresh" :size="13" />Renovar token</button>
        </div>
      </template>
      <span v-else class="text-sm text-slate-400">Resposta</span>
    </div>

    <nav class="flex gap-1 border-b border-slate-100 px-4">
      <button type="button" class="tab" :class="tab === 'body' ? 'tab-active' : ''" @click="tab = 'body'">Corpo</button>
      <button type="button" class="tab" :class="tab === 'headers' ? 'tab-active' : ''" @click="tab = 'headers'">Headers <span v-if="headersList.length" class="text-xs text-slate-400">({{ headersList.length }})</span></button>
      <button type="button" class="tab" :class="tab === 'request' ? 'tab-active' : ''" @click="tab = 'request'">Enviado</button>
      <button type="button" class="tab" :class="tab === 'history' ? 'tab-active' : ''" @click="tab = 'history'">Historico</button>
    </nav>

    <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
      <!-- CORPO -->
      <template v-if="tab === 'body'">
        <div v-if="!shown && !sending" class="flex h-full flex-col items-center justify-center gap-3 py-10 text-center text-sm text-slate-400">
          <Icon name="send" :size="32" :stroke="1.3" />
          <p>Envie a requisicao para ver a resposta.</p>
          <p class="text-xs"><span class="kbd">Ctrl</span> + <span class="kbd">Enter</span></p>
        </div>

        <div v-else-if="shown && !shown.statusCode && (shown.errorMessage)" class="space-y-3">
          <div class="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <Icon name="x-circle" :size="18" class="mt-0.5" />
            <div>
              <p class="font-semibold">A requisicao nao obteve resposta</p>
              <p class="mt-1">{{ shown.errorMessage }}</p>
            </div>
          </div>
          <p class="text-xs text-slate-500">A requisicao e executada pelo servidor da plataforma: APIs internas precisam estar acessiveis a partir dele.</p>
        </div>

        <div v-else-if="shown" class="space-y-3">
          <div v-if="!isHistory && shown.unresolvedVariables?.length" class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Icon name="alert-triangle" :size="14" class="mt-0.5" />Variaveis nao resolvidas: <span class="font-mono">{{ shown.unresolvedVariables.join(", ") }}</span>
          </div>
          <div v-if="!isHistory && shown.extraction?.length" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <p class="mb-1 font-semibold text-slate-600">Variaveis extraidas</p>
            <p v-for="item in shown.extraction" :key="item.variable" class="flex items-center gap-2" :class="item.ok ? 'text-emerald-700' : 'text-rose-700'">
              <Icon :name="item.ok ? 'check' : 'x'" :size="12" /><span class="font-mono">{{ item.variable }}</span><span class="truncate text-slate-500">{{ item.ok ? item.value : item.error }}</span>
            </p>
          </div>
          <div v-if="!isHistory && shown.redirects?.length" class="text-xs text-slate-500">
            <Icon name="arrow-right" :size="12" class="inline" /> {{ shown.redirects.length }} redirecionamento(s) · URL final: <span class="font-mono">{{ shown.finalUrl }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-1">
            <button v-for="mode in [{ id: 'pretty', label: 'Formatado' }, { id: 'raw', label: 'Bruto' }, ...(isHtml || isImage ? [{ id: 'preview', label: 'Visualizar' }] : [])]" :key="mode.id" type="button" class="rounded-md px-2.5 py-1 text-xs font-medium" :class="bodyMode === mode.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'" @click="bodyMode = mode.id">{{ mode.label }}</button>
            <span v-if="shown.truncated" class="chip bg-amber-50 text-amber-700">Resposta truncada em 10 MB</span>
            <div class="ml-auto flex gap-1">
              <button type="button" class="btn-icon h-8 w-8" title="Copiar" @click="copyBody"><Icon name="copy" :size="15" /></button>
              <button type="button" class="btn-icon h-8 w-8" title="Baixar" @click="downloadBody"><Icon name="download" :size="15" /></button>
            </div>
          </div>

          <template v-if="bodyMode === 'preview'">
            <img v-if="isImage" :src="`data:${contentType};base64,${rawBody}`" alt="Resposta" class="max-w-full rounded-lg border border-slate-200" />
            <iframe v-else :srcdoc="rawBody" sandbox="" class="h-[50vh] w-full rounded-lg border border-slate-200 bg-white" title="Visualizacao HTML" />
          </template>
          <p v-else-if="shown.bodyEncoding === 'base64'" class="rounded-lg bg-white px-4 py-6 text-center text-sm text-slate-500">Conteudo binario ({{ contentType || "desconhecido" }}). Use o botao de download.</p>
          <p v-else-if="!rawBody" class="rounded-lg bg-white px-4 py-6 text-center text-sm text-slate-400">Resposta sem corpo.</p>
          <CodeEditor v-else-if="bodyMode === 'pretty' && isJson" :model-value="prettyBody" language="json" readonly :dark="false" min-height="200px" />
          <pre v-else class="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">{{ bodyMode === "pretty" ? prettyBody : rawBody }}</pre>
        </div>
      </template>

      <!-- HEADERS -->
      <template v-else-if="tab === 'headers'">
        <p v-if="!headersList.length" class="py-8 text-center text-sm text-slate-400">Sem headers.</p>
        <table v-else class="w-full text-xs">
          <tbody>
            <tr v-for="[key, value] in headersList" :key="key" class="border-b border-slate-100">
              <td class="w-1/3 py-1.5 pr-3 align-top font-mono font-semibold text-slate-600">{{ key }}</td>
              <td class="break-all py-1.5 font-mono text-slate-700">{{ Array.isArray(value) ? value.join(", ") : value }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ENVIADO -->
      <template v-else-if="tab === 'request'">
        <p v-if="!shown" class="py-8 text-center text-sm text-slate-400">Nada enviado ainda.</p>
        <div v-else class="space-y-3 text-xs">
          <p class="break-all font-mono"><span class="font-bold" :class="METHOD_COLORS[(isHistory ? shown.method : shown.request?.method)]">{{ isHistory ? shown.method : shown.request?.method }}</span> {{ isHistory ? shown.url : shown.request?.url }}</p>
          <table class="w-full">
            <tbody>
              <tr v-for="[key, value] in requestHeaders" :key="key" class="border-b border-slate-100">
                <td class="w-1/3 py-1.5 pr-3 font-mono font-semibold text-slate-600">{{ key }}</td>
                <td class="break-all py-1.5 font-mono text-slate-700">{{ value }}</td>
              </tr>
            </tbody>
          </table>
          <pre v-if="isHistory ? shown.requestBody : shown.request?.body" class="whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-white p-3 font-mono">{{ isHistory ? shown.requestBody : shown.request?.body }}</pre>
          <p class="flex items-center gap-1 text-slate-500"><Icon name="shield" :size="12" />Valores sensiveis (Authorization, chaves de API, cookies) sao mascarados.</p>
        </div>
      </template>

      <!-- HISTORICO -->
      <template v-else>
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs text-slate-500">Ultimos 100 envios desta requisicao</p>
          <div class="flex gap-1">
            <button type="button" class="btn-ghost btn-sm" :disabled="historyLoading" @click="loadHistory"><Icon name="refresh" :size="13" /></button>
            <button v-if="isManager && history.length" type="button" class="btn-ghost btn-sm text-rose-600" @click="clearHistory">Limpar</button>
          </div>
        </div>
        <p v-if="historyLoading && !history.length" class="py-6 text-center text-sm text-slate-400">Carregando...</p>
        <p v-else-if="!history.length" class="py-6 text-center text-sm text-slate-400">Nenhum envio registrado.</p>
        <button
          v-for="entry in history"
          :key="entry.id"
          type="button"
          class="flex w-full items-center gap-3 border-b border-slate-100 px-2 py-2 text-left text-xs hover:bg-white"
          @click="openHistory(entry)"
        >
          <span class="w-12 shrink-0 rounded px-1.5 py-0.5 text-center font-mono font-bold" :class="!entry.statusCode ? 'bg-rose-100 text-rose-700' : entry.statusCode < 300 ? 'bg-emerald-100 text-emerald-700' : entry.statusCode < 500 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'">{{ entry.statusCode || "ERR" }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-slate-600">{{ entry.method }} {{ entry.url }}</span>
            <span class="block text-slate-400">{{ entry.executedByName || "-" }} · {{ formatRelative(entry.createdAt) }} · {{ formatDuration(entry.durationMs) }}</span>
          </span>
        </button>
      </template>
    </div>
  </section>
</template>
