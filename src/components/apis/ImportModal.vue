<script setup>
import { computed, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { apiState } from "../../stores/apiWorkspace.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";

const emit = defineEmits(["close", "imported"]);
const content = ref("");
const fileName = ref("");
const target = ref(apiState.current ? "current" : "new");
const importing = ref(false);
const error = ref("");

const detected = computed(() => {
  const text = content.value.trim();
  if (!text) return "";
  if (/^curl(\.exe)?\s/i.test(text)) return "cURL";
  try {
    const json = JSON.parse(text);
    if (json?.info && Array.isArray(json.item)) return "Postman Collection";
    if (json?._type === "export") return "Insomnia v4";
  } catch {
    return "Formato nao reconhecido";
  }
  return "JSON nao reconhecido";
});

async function onFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    toast.error("Arquivo muito grande (maximo 20 MB).");
    return;
  }
  fileName.value = file.name;
  content.value = await file.text();
}

async function submit() {
  error.value = "";
  importing.value = true;
  try {
    const intoCurrent = target.value === "current" && apiState.current;
    const result = await http.post("/api/apis/import", {
      content: content.value,
      ...(intoCurrent ? { targetCollectionId: apiState.current.collection.id } : {})
    });
    toast(`${result.requestCount} requisicao(oes) importada(s) (${result.format}).`);
    emit("imported", { ...result, intoCurrent });
  } catch (err) {
    error.value = err.message;
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <Modal title="Importar requisicoes" subtitle="Postman (Collection v2.1), Insomnia (v4 JSON) ou comando cURL" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <div v-if="apiState.current" class="grid gap-2 sm:grid-cols-2">
        <button type="button" class="rounded-xl border p-3 text-left text-sm" :class="target === 'current' ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200'" @click="target = 'current'">
          <span class="block font-semibold text-slate-800">Nesta colecao</span>
          <span class="text-xs text-slate-500">{{ apiState.current.collection.name }}</span>
        </button>
        <button type="button" class="rounded-xl border p-3 text-left text-sm" :class="target === 'new' ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200'" @click="target = 'new'">
          <span class="block font-semibold text-slate-800">Em nova colecao</span>
          <span class="text-xs text-slate-500">Usa o nome da colecao importada</span>
        </button>
      </div>

      <label class="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm hover:border-brand-400 hover:bg-brand-50/40">
        <Icon name="upload" class="text-brand-600" />
        <span class="flex-1">{{ fileName || "Selecionar arquivo .json exportado" }}</span>
        <input type="file" accept=".json,application/json,.txt" class="hidden" @change="onFile" />
      </label>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="label mb-0">Ou cole o conteudo</label>
          <span v-if="detected" class="chip" :class="/nao/.test(detected) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'">{{ detected }}</span>
        </div>
        <textarea v-model="content" rows="12" class="input font-mono text-xs" placeholder="curl -X GET 'https://api.exemplo.com/v1/itens' -H 'Authorization: Bearer ...'&#10;&#10;ou o JSON exportado do Postman / Insomnia" />
      </div>
      <p class="flex items-start gap-2 text-xs text-slate-500"><Icon name="shield" :size="14" class="mt-0.5 text-emerald-600" />Tokens, senhas e secrets importados sao criptografados. Variaveis usadas em autenticacao sao marcadas como segredo automaticamente.</p>
      <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
    </div>
    <template #footer>
      <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn-primary" :disabled="!content.trim() || importing" @click="submit"><Icon :name="importing ? 'loader' : 'import'" :size="16" :class="importing ? 'animate-spin' : ''" />Importar</button>
    </template>
  </Modal>
</template>
