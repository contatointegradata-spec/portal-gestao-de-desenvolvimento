<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { downloadFile, http, saveBlob, streamEvents } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { formatBytes, formatDateTime, formatDuration, formatTime, RUN_STATUS, TRIGGER_LABELS } from "../../lib/format.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import RunnerScreen from "../settings/RunnerScreen.vue";

const props = defineProps({
  runId: { type: String, required: true },
  projectName: { type: String, default: "" }
});
const emit = defineEmits(["close", "finished"]);

const status = ref("running");
const events = ref([]);
const screenshot = ref(null);
const liveView = ref(null); // { port, url } quando o servidor transmite a tela do navegador (noVNC)
const viewMode = ref("live"); // live | screenshots
const startedAt = ref(null);
const detail = ref(null);
const connection = ref("connecting"); // connecting | live | closed | lost
const elapsed = ref(0);
const levelFilter = ref("all");
const autoScroll = ref(true);
const terminal = ref(null);
const cancelling = ref(false);
const name = ref(props.projectName);
const runnerName = ref(""); // servidor remoto onde o robo roda ("" = servidor da plataforma)
const runnerId = ref("");
let controller = null;
let timer = null;

const isRunning = computed(() => status.value === "running");
const liveViewUrl = computed(() => {
  if (!liveView.value) return "";
  const base = (liveView.value.url || `${window.location.protocol}//${window.location.hostname}:${liveView.value.port}`).replace(/\/+$/, "");
  // Atras de proxy num subcaminho (ex.: https://dominio/live-view) o websocket do noVNC tambem fica nele.
  const prefix = new URL(base, window.location.href).pathname.replace(/^\/+|\/+$/g, "");
  const wsPath = prefix ? `&path=${encodeURIComponent(`${prefix}/websockify`)}` : "";
  return `${base}/vnc.html?autoconnect=true&view_only=true&resize=scale&reconnect=true&show_dot=true${wsPath}`;
});
// Ao vivo: noVNC do Docker ou a tela do servidor remoto transmitida pelo agente.
const hasLive = computed(() => isRunning.value && (Boolean(liveViewUrl.value) || Boolean(runnerId.value)));
const showLive = computed(() => hasLive.value && viewMode.value === "live");
const statusInfo = computed(() => RUN_STATUS[status.value] || RUN_STATUS.running);
const lastProgress = computed(() => [...events.value].reverse().find((event) => event.level === "progress" && event.total));
const errorCount = computed(() => events.value.filter((event) => event.level === "error").length);
const visibleEvents = computed(() => {
  const list = levelFilter.value === "all" ? events.value
    : levelFilter.value === "errors" ? events.value.filter((event) => event.level === "error" || event.level === "warn")
      : events.value.filter((event) => event.level === "action" || event.level === "progress");
  return list.slice(-2000);
});

const LEVEL_CLASS = {
  error: "text-rose-400",
  warn: "text-amber-300",
  success: "text-emerald-400",
  action: "text-sky-300",
  progress: "text-violet-300",
  info: "text-slate-300"
};

function legacyEvents(run) {
  const lines = [];
  for (const line of String(run.stdout || "").split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed.level && parsed.level !== "screenshot") lines.push(parsed);
      continue;
    } catch { /* texto */ }
    lines.push({ level: "info", message: text, ts: run.createdAt });
  }
  for (const line of String(run.stderr || "").split("\n").filter(Boolean)) lines.push({ level: "error", message: line, ts: run.finishedAt });
  return lines;
}

function applySnapshot(data) {
  name.value = data.projectName || name.value;
  status.value = data.status;
  startedAt.value = data.startedAt || data.createdAt;
  if (data.liveView) liveView.value = data.liveView;
  if (data.runnerName) runnerName.value = data.runnerName;
  if (data.runnerId) runnerId.value = data.runnerId;
  events.value = Array.isArray(data.events) ? data.events : legacyEvents(data);
  // Mantem a captura recebida ao vivo (com URL); a salva no banco so e usada ao abrir execucoes antigas.
  if (data.lastScreenshot && !screenshot.value?.image) {
    screenshot.value = typeof data.lastScreenshot === "string" ? { image: data.lastScreenshot, label: "Ultima captura da execucao", url: "" } : data.lastScreenshot;
  }
  if (data.status !== "running") detail.value = data;
}

async function connect() {
  controller?.abort();
  controller = new AbortController();
  connection.value = "connecting";
  let finished = false;
  try {
    await streamEvents(`/api/runs/${props.runId}/stream`, {
      snapshot: (data) => {
        connection.value = "live";
        applySnapshot(data);
      },
      log: (event) => events.value.push(event),
      screenshot: (data) => { screenshot.value = data; },
      liveview: (data) => { liveView.value = data; },
      done: (data) => {
        finished = true;
        const wasRunning = status.value === "running";
        applySnapshot({ ...data, events: data.events || events.value });
        detail.value = data;
        status.value = data.status;
        if (wasRunning) {
          emit("finished", data);
          if (data.status === "success") toast("Execucao concluida com sucesso.");
          else if (data.status === "cancelled") toast.info("Execucao cancelada.");
          else toast.error(`Execucao ${RUN_STATUS[data.status]?.label.toLowerCase() || "com falha"}.`);
        }
      }
    }, controller.signal);
    connection.value = finished ? "closed" : "lost";
  } catch (err) {
    if (err.name === "AbortError") return;
    connection.value = "lost";
    toast.error(err.message);
  }
}

async function cancel() {
  const ok = await confirmDialog({ title: "Cancelar execucao?", message: "O robo e o navegador serao encerrados imediatamente.", confirmText: "Cancelar execucao", cancelText: "Voltar", danger: true });
  if (!ok) return;
  cancelling.value = true;
  try {
    await http.post(`/api/runs/${props.runId}/cancel`);
  } catch (err) {
    toast.error(err.message);
  } finally {
    cancelling.value = false;
  }
}

function downloadLogs() {
  const text = events.value.map((event) => `[${event.ts ? formatDateTime(event.ts) : ""}] [${event.level}] ${event.message}`).join("\n");
  saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `execucao-${props.runId.slice(0, 8)}.log`);
}

function downloadArtifact(artifact) {
  downloadFile(`/api/runs/${props.runId}/artifacts/${artifact.id}/download`, artifact.fileName).catch((err) => toast.error(err.message));
}

watch(() => events.value.length, async () => {
  if (!autoScroll.value) return;
  await nextTick();
  if (terminal.value) terminal.value.scrollTop = terminal.value.scrollHeight;
});

onMounted(() => {
  connect();
  timer = setInterval(() => {
    if (startedAt.value && isRunning.value) elapsed.value = Date.now() - new Date(startedAt.value).getTime();
  }, 1000);
});

onBeforeUnmount(() => {
  controller?.abort();
  clearInterval(timer);
});
</script>

<template>
  <Modal size="full" body-class="p-0" @close="emit('close')">
    <template #header>
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <span class="chip py-1 text-sm" :class="statusInfo.class">
          <Icon v-if="isRunning" name="loader" :size="14" class="animate-spin" />
          <Icon v-else :name="status === 'success' ? 'check-circle' : status === 'cancelled' ? 'stop' : 'x-circle'" :size="14" />
          {{ statusInfo.label }}
        </span>
        <div class="min-w-0">
          <h2 class="truncate font-semibold text-slate-900">{{ name || "Execucao RPA" }}</h2>
          <p class="text-xs text-slate-500">
            <template v-if="detail">{{ TRIGGER_LABELS[detail.triggerType] || "Execucao" }} · {{ formatDateTime(detail.createdAt || startedAt) }} · {{ formatDuration(detail.durationMs) }}<template v-if="detail.triggeredByName"> · {{ detail.triggeredByName }}</template><template v-if="runnerName"> · em {{ runnerName }}</template></template>
            <template v-else-if="startedAt">Iniciada as {{ formatTime(startedAt) }} · {{ formatDuration(elapsed) }}<template v-if="runnerName"> · em {{ runnerName }}</template></template>
            <template v-else>Conectando...</template>
          </p>
        </div>
      </div>
    </template>

    <div class="grid min-h-[60vh] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <!-- Navegador espelhado -->
      <section class="flex min-h-[320px] flex-col border-b border-slate-200 bg-slate-100 lg:border-b-0 lg:border-r">
        <div class="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div class="flex gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-rose-400" /><span class="h-2.5 w-2.5 rounded-full bg-amber-400" /><span class="h-2.5 w-2.5 rounded-full bg-emerald-400" /></div>
          <div class="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-slate-100 px-3 py-1 font-mono text-xs text-slate-500">
            <Icon :name="isRunning ? 'loader' : 'lock'" :size="12" :class="isRunning ? 'animate-spin text-sky-500' : ''" />
            <span class="truncate">{{ screenshot?.url || (screenshot?.image ? "Ultima captura registrada" : isRunning ? "Aguardando navegador..." : "Sem navegador nesta execucao") }}</span>
          </div>
          <template v-if="hasLive">
            <span v-if="showLive" class="chip bg-rose-50 py-0.5 text-xs text-rose-600"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />Ao vivo</span>
            <button type="button" class="btn-ghost px-2 py-1 text-xs" :title="showLive ? 'Ver capturas de tela' : 'Ver navegador ao vivo'" @click="viewMode = showLive ? 'screenshots' : 'live'">
              <Icon :name="showLive ? 'image' : 'eye'" :size="14" />{{ showLive ? "Capturas" : "Ao vivo" }}
            </button>
            <a v-if="liveViewUrl" :href="liveViewUrl" target="_blank" rel="noopener" class="btn-ghost px-2 py-1 text-xs" title="Abrir navegador ao vivo em nova aba"><Icon name="external-link" :size="14" /></a>
          </template>
        </div>
        <div class="relative flex-1 overflow-hidden bg-white">
          <div v-if="lastProgress" class="absolute inset-x-0 top-0 z-10 h-1 bg-slate-100">
            <div class="h-full transition-all duration-500" :class="status === 'success' ? 'bg-emerald-500' : status === 'running' ? 'bg-sky-500' : 'bg-rose-500'" :style="{ width: `${lastProgress.percent || 0}%` }" />
          </div>
          <RunnerScreen v-if="showLive && runnerId" :runner-id="runnerId" :runner-name="runnerName" class="absolute inset-0" />
          <iframe v-else-if="showLive" :src="liveViewUrl" title="Navegador do robo ao vivo" class="absolute inset-0 h-full w-full border-0 bg-slate-900" />
          <img v-else-if="screenshot?.image" :src="screenshot.image" :alt="screenshot.label" class="absolute inset-0 h-full w-full object-contain object-top" />
          <div v-else class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300">
            <Icon name="globe" :size="56" :stroke="1" />
            <span class="text-sm">{{ isRunning ? "As capturas de tela aparecem aqui quando o robo usa o navegador." : "Nenhuma captura disponivel." }}</span>
            <span v-if="isRunning && runnerName" class="flex items-center gap-1.5 text-xs text-slate-400"><Icon name="server" :size="13" />O navegador abre na area de trabalho de {{ runnerName }} — acompanhe tambem pelo RDP.</span>
          </div>
          <div v-if="screenshot?.label && !showLive" class="absolute inset-x-0 bottom-0 truncate bg-slate-900/70 px-3 py-1.5 font-mono text-xs text-white">{{ screenshot.label }}</div>
        </div>
      </section>

      <!-- Terminal -->
      <section class="flex min-h-[320px] flex-col bg-[#0d1117]">
        <div class="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
          <Icon name="terminal" :size="14" class="text-slate-500" />
          <button
            v-for="option in [{ id: 'all', label: `Tudo (${events.length})` }, { id: 'actions', label: 'Acoes' }, { id: 'errors', label: `Erros (${errorCount})` }]"
            :key="option.id"
            type="button"
            class="rounded-md px-2 py-0.5 text-xs transition"
            :class="levelFilter === option.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'"
            @click="levelFilter = option.id"
          >
            {{ option.label }}
          </button>
          <label class="ml-auto flex items-center gap-1.5 text-xs text-slate-400"><input v-model="autoScroll" type="checkbox" class="accent-brand-500" />Rolar automaticamente</label>
        </div>
        <div ref="terminal" class="scrollbar-dark max-h-[62vh] flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-5">
          <p v-if="!visibleEvents.length" class="text-slate-500">{{ connection === "connecting" ? "Conectando..." : "Nenhum log." }}</p>
          <div v-for="(event, index) in visibleEvents" :key="index" class="flex gap-2">
            <span class="w-16 shrink-0 text-slate-600">{{ formatTime(event.ts) }}</span>
            <span class="min-w-0 flex-1 whitespace-pre-wrap break-words" :class="LEVEL_CLASS[event.level] || LEVEL_CLASS.info">{{ event.message }}</span>
          </div>
          <p v-if="isRunning && connection === 'live'" class="mt-1 flex items-center gap-1 text-brand-400">$ <span class="animate-pulse">▋</span></p>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="mr-auto flex min-w-0 flex-1 flex-wrap items-center gap-3 text-sm">
        <span v-if="lastProgress" class="font-mono text-xs text-slate-500">{{ lastProgress.current }}/{{ lastProgress.total }} · {{ lastProgress.percent }}%</span>
        <span v-if="connection === 'lost' && isRunning" class="flex items-center gap-2 text-amber-700">
          <Icon name="alert-triangle" :size="15" />Conexao perdida.
          <button type="button" class="font-semibold underline" @click="connect">Reconectar</button>
        </span>
        <span v-if="detail && detail.status !== 'success' && detail.errorMessage" class="max-w-xl truncate text-rose-700" :title="detail.errorMessage">{{ detail.errorMessage.split("\n").at(-1) }}</span>
        <template v-if="detail?.artifacts?.length">
          <span class="text-xs font-medium text-slate-500">Arquivos gerados:</span>
          <button v-for="artifact in detail.artifacts" :key="artifact.id" type="button" class="chip border border-violet-200 bg-violet-50 py-1 text-violet-700 hover:bg-violet-100" @click="downloadArtifact(artifact)">
            <Icon name="download" :size="12" />{{ artifact.fileName }} <span class="text-violet-400">{{ formatBytes(artifact.fileSize) }}</span>
          </button>
        </template>
      </div>
      <button type="button" class="btn-ghost" :disabled="!events.length" @click="downloadLogs"><Icon name="download" :size="16" />Logs</button>
      <button v-if="isRunning" type="button" class="btn-danger-soft" :disabled="cancelling" @click="cancel"><Icon name="stop" :size="16" />Cancelar</button>
      <button type="button" class="btn-secondary" @click="emit('close')">{{ isRunning ? "Continuar em segundo plano" : "Fechar" }}</button>
    </template>
  </Modal>
</template>
