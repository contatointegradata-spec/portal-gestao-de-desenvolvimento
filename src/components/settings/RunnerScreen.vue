<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { streamEvents } from "../../lib/api.js";
import Icon from "../ui/Icon.vue";

// Tela ao vivo de um servidor de execucao: o agente so transmite enquanto este componente esta aberto.
const props = defineProps({
  runnerId: { type: String, required: true },
  runnerName: { type: String, default: "" }
});

const frame = ref(null);
const status = ref(null);
const connection = ref("connecting"); // connecting | live | lost
const now = ref(Date.now());
let controller = null;
let clock = null;
let retry = null;

const ageSeconds = computed(() => (frame.value ? Math.max(0, Math.round((now.value - new Date(frame.value.ts).getTime()) / 1000)) : null));
const stale = computed(() => ageSeconds.value !== null && ageSeconds.value > 10);
const unavailable = computed(() => status.value && !status.value.available);

async function connect() {
  controller?.abort();
  controller = new AbortController();
  connection.value = "connecting";
  try {
    await streamEvents(`/api/runners/${props.runnerId}/screen/stream`, {
      status: (data) => {
        connection.value = "live";
        status.value = data;
      },
      frame: (data) => {
        connection.value = "live";
        frame.value = data;
      }
    }, controller.signal);
    connection.value = "lost";
  } catch (err) {
    if (err.name === "AbortError") return;
    connection.value = "lost";
    status.value = { available: false, message: err.message };
  }
  // Reconecta sozinho (ex.: plataforma reiniciada).
  retry = setTimeout(connect, 5000);
}

onMounted(() => {
  connect();
  clock = setInterval(() => { now.value = Date.now(); }, 1000);
});

onBeforeUnmount(() => {
  controller?.abort();
  clearInterval(clock);
  clearTimeout(retry);
});
</script>

<template>
  <div class="relative h-full w-full overflow-hidden bg-slate-950">
    <img
      v-if="frame"
      :src="frame.image"
      :alt="`Tela de ${runnerName}`"
      class="absolute inset-0 h-full w-full object-contain transition"
      :class="unavailable || stale ? 'opacity-40 grayscale' : ''"
    />

    <div v-if="!frame || unavailable" class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon v-if="!unavailable" name="loader" :size="28" class="animate-spin text-slate-400" />
      <Icon v-else name="alert-triangle" :size="28" class="text-amber-400" />
      <p class="max-w-lg text-sm" :class="unavailable ? 'text-amber-200' : 'text-slate-300'">
        {{ unavailable ? status.message : connection === "connecting" ? "Conectando..." : "Aguardando a primeira imagem do agente..." }}
      </p>
    </div>

    <div class="absolute left-3 top-3 flex items-center gap-2">
      <span v-if="frame && !unavailable && !stale" class="chip bg-rose-500/90 py-0.5 text-xs text-white"><span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Ao vivo</span>
      <span v-else-if="stale && !unavailable" class="chip bg-amber-500/90 py-0.5 text-xs text-white">Sem atualizacao ha {{ ageSeconds }}s</span>
      <span v-if="connection === 'lost'" class="chip bg-slate-700 py-0.5 text-xs text-slate-200">Reconectando...</span>
    </div>
    <div v-if="frame?.width" class="absolute bottom-2 right-3 font-mono text-[10px] text-slate-400/80">{{ runnerName }} · {{ frame.width }}x{{ frame.height }}</div>
  </div>
</template>
