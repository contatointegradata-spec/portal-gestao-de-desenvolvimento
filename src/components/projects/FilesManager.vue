<script setup>
import { computed, ref } from "vue";
import { downloadFile, http, uploadFile } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { formatBytes, formatDateTime } from "../../lib/format.js";
import Icon from "../ui/Icon.vue";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;

/**
 * Com projectId: envia/remove imediatamente no servidor.
 * Sem projectId: mantem a lista em "pending" (enviada apos salvar o sistema).
 */
const props = defineProps({
  projectId: { type: String, default: "" },
  files: { type: Array, default: () => [] },
  pending: { type: Array, default: () => [] },
  readonly: { type: Boolean, default: false }
});
const emit = defineEmits(["update:files", "update:pending"]);

const dragging = ref(false);
const uploads = ref([]); // { name, progress }
const input = ref(null);

const entries = computed(() => props.projectId
  ? props.files
  : props.pending.map((file) => ({ id: `${file.name}-${file.size}`, fileName: file.name, fileSize: file.size, pendingFile: file })));

function iconFor(name) {
  return /\.(xlsx?|csv)$/i.test(name) ? "file-spreadsheet" : /\.(png|jpe?g|gif|webp)$/i.test(name) ? "image" : /\.(py|js|json|xml|html)$/i.test(name) ? "file-code" : "file";
}

async function handleFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      toast.error(`"${file.name}" excede o limite de 25 MB.`);
      continue;
    }
    const exists = entries.value.find((entry) => entry.fileName === file.name);
    if (!exists && entries.value.length + uploads.value.length >= MAX_FILES) {
      toast.error(`Limite de ${MAX_FILES} arquivos por RPA.`);
      break;
    }
    if (!props.projectId) {
      emit("update:pending", [...props.pending.filter((item) => item.name !== file.name), file]);
      continue;
    }
    const upload = { name: file.name, progress: 0 };
    uploads.value.push(upload);
    try {
      const result = await uploadFile(`/api/projects/${props.projectId}/files`, file, (progress) => { upload.progress = progress; });
      emit("update:files", result.files);
      toast(result.replaced ? `"${file.name}" substituido.` : `"${file.name}" enviado.`);
    } catch (err) {
      toast.error(`${file.name}: ${err.message}`);
    } finally {
      uploads.value = uploads.value.filter((item) => item !== upload);
    }
  }
  if (input.value) input.value.value = "";
}

function onDrop(event) {
  dragging.value = false;
  if (!props.readonly) handleFiles(event.dataTransfer.files);
}

async function remove(entry) {
  if (!props.projectId) {
    emit("update:pending", props.pending.filter((file) => file !== entry.pendingFile));
    return;
  }
  const ok = await confirmDialog({ title: `Remover "${entry.fileName}"?`, message: "O arquivo deixara de ser enviado nas proximas execucoes.", confirmText: "Remover", danger: true });
  if (!ok) return;
  try {
    const result = await http.del(`/api/projects/${props.projectId}/files/${entry.id}`);
    emit("update:files", result.files);
  } catch (err) {
    toast.error(err.message);
  }
}

function download(entry) {
  downloadFile(`/api/projects/${props.projectId}/files/${entry.id}/download`, entry.fileName).catch((err) => toast.error(err.message));
}
</script>

<template>
  <div class="space-y-3">
    <label
      v-if="!readonly"
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition"
      :class="dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/60 hover:border-brand-300 hover:bg-brand-50/40'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <span class="flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm"><Icon name="upload" /></span>
      <span class="text-sm font-medium text-slate-700">Arraste arquivos aqui ou <span class="text-brand-700 underline">selecione</span></span>
      <span class="text-xs text-slate-500">Planilhas, CSV, TXT, JSON, imagens... ate 25 MB cada · arquivo com o mesmo nome e substituido</span>
      <input ref="input" type="file" multiple class="hidden" @change="handleFiles($event.target.files)" />
    </label>

    <div v-for="upload in uploads" :key="upload.name" class="rounded-xl border border-slate-200 px-3 py-2">
      <div class="flex items-center justify-between text-xs text-slate-600"><span class="truncate">{{ upload.name }}</span><span>{{ upload.progress }}%</span></div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div class="h-full bg-brand-500 transition-all" :style="{ width: `${upload.progress}%` }" /></div>
    </div>

    <ul v-if="entries.length" class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
      <li v-for="(entry, index) in entries" :key="entry.id" class="flex items-center gap-3 px-3 py-2.5">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon :name="iconFor(entry.fileName)" :size="17" /></span>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 truncate text-sm font-medium text-slate-800">
            {{ entry.fileName }}
            <span v-if="index === 0" class="chip bg-brand-50 text-[10px] text-brand-700" title="Recebido pelo script em rpa.input_file / sys.argv[1]">principal</span>
            <span v-if="entry.pendingFile" class="chip bg-amber-50 text-[10px] text-amber-700">sera enviado ao salvar</span>
          </p>
          <p class="text-xs text-slate-500">{{ formatBytes(entry.fileSize) }}<template v-if="entry.createdAt"> · {{ formatDateTime(entry.createdAt) }}</template></p>
        </div>
        <button v-if="projectId" type="button" class="btn-icon h-8 w-8" title="Baixar" @click="download(entry)"><Icon name="download" :size="15" /></button>
        <button v-if="!readonly" type="button" class="btn-icon h-8 w-8 hover:text-rose-600" title="Remover" @click="remove(entry)"><Icon name="trash" :size="15" /></button>
      </li>
    </ul>
    <p v-else-if="readonly" class="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">Nenhum arquivo de entrada.</p>
  </div>
</template>
