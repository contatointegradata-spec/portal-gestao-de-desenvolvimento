<script setup>
import { computed, provide, reactive, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { navigate } from "../../lib/router.js";
import { apiState, isDirty, reloadTree, setEnvironment } from "../../stores/apiWorkspace.js";
import { isManager } from "../../stores/session.js";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";
import TreeNode from "./TreeNode.vue";

const emit = defineEmits(["select", "new-request", "new-folder", "action", "open-settings", "open-environments", "import"]);

const search = ref("");
const expanded = ref(new Set());
const drag = reactive({ item: null, type: null, overId: null, position: null });

const collection = computed(() => apiState.current?.collection);
const storageKey = computed(() => `gestao_api_tree_${collection.value?.id}`);

watch(() => collection.value?.id, () => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey.value) || "null");
    expanded.value = new Set(Array.isArray(stored) ? stored : (apiState.current?.folders || []).map((folder) => folder.id));
  } catch {
    expanded.value = new Set((apiState.current?.folders || []).map((folder) => folder.id));
  }
}, { immediate: true });

function persistExpanded() {
  try { localStorage.setItem(storageKey.value, JSON.stringify([...expanded.value])); } catch { /* ignore */ }
}

function toggle(folderId, force) {
  const next = new Set(expanded.value);
  const open = force ?? !next.has(folderId);
  if (open) next.add(folderId);
  else next.delete(folderId);
  expanded.value = next;
  persistExpanded();
}

const bySort = (a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, "pt-BR");

const tree = computed(() => {
  if (!apiState.current) return [];
  const term = search.value.trim().toLowerCase();
  const { folders, requests } = apiState.current;
  const matches = (request) => !term || `${request.name} ${request.url} ${request.method}`.toLowerCase().includes(term);
  const build = (parentId) => {
    const folderNodes = folders.filter((folder) => (folder.parentId || null) === parentId).sort(bySort)
      .map((folder) => ({ type: "folder", item: folder, children: build(folder.id) }))
      .filter((node) => !term || node.children.length || node.item.name.toLowerCase().includes(term));
    const requestNodes = requests.filter((request) => (request.folderId || null) === parentId && matches(request)).sort(bySort)
      .map((request) => ({ type: "request", item: request, children: [] }));
    return [...folderNodes, ...requestNodes];
  };
  return build(null);
});

// ─── Arrastar e soltar ────────────────────────────────────────────────────────
function isDescendant(folderId, possibleAncestorId) {
  let current = apiState.current.folders.find((folder) => folder.id === folderId);
  for (let depth = 0; current && depth < 30; depth += 1) {
    if (current.id === possibleAncestorId) return true;
    current = apiState.current.folders.find((folder) => folder.id === current.parentId);
  }
  return false;
}

async function performDrop(targetNode, position) {
  const dragged = drag.item;
  const draggedType = drag.type;
  resetDrag();
  if (!dragged || (targetNode && targetNode.item.id === dragged.id)) return;

  let parentId = null;
  if (position === "into") parentId = targetNode.item.id;
  else if (targetNode) parentId = targetNode.type === "folder" ? targetNode.item.parentId || null : targetNode.item.folderId || null;

  const payload = { folders: [], requests: [] };
  if (draggedType === "folder") {
    if (parentId && (parentId === dragged.id || isDescendant(parentId, dragged.id))) {
      toast.warn("Nao e possivel mover uma pasta para dentro dela mesma.");
      return;
    }
    const siblings = apiState.current.folders.filter((folder) => (folder.parentId || null) === parentId && folder.id !== dragged.id).sort(bySort);
    let index = siblings.length;
    if (targetNode?.type === "folder" && position !== "into") index = siblings.findIndex((folder) => folder.id === targetNode.item.id) + (position === "after" ? 1 : 0);
    siblings.splice(index, 0, dragged);
    payload.folders = siblings.map((folder, order) => ({ id: folder.id, parentId, sortOrder: order }));
  } else {
    const siblings = apiState.current.requests.filter((request) => (request.folderId || null) === parentId && request.id !== dragged.id).sort(bySort);
    let index = siblings.length;
    if (targetNode?.type === "request") index = siblings.findIndex((request) => request.id === targetNode.item.id) + (position === "after" ? 1 : 0);
    siblings.splice(index, 0, dragged);
    payload.requests = siblings.map((request, order) => ({ id: request.id, folderId: parentId, sortOrder: order }));
  }
  if (parentId) toggle(parentId, true);
  try {
    await http.post(`/api/apis/collections/${collection.value.id}/reorder`, payload);
    await reloadTree();
    if (draggedType === "request" && apiState.drafts[dragged.id]) {
      apiState.drafts[dragged.id].folderId = parentId;
      if (apiState.originals[dragged.id]) apiState.originals[dragged.id].folderId = parentId;
    }
  } catch (err) {
    toast.error(err.message);
  }
}

function resetDrag() {
  Object.assign(drag, { item: null, type: null, overId: null, position: null });
}

provide("apiTree", {
  drag,
  expanded,
  canManage: isManager,
  toggle,
  isDirty,
  select: (id) => emit("select", id),
  action: (payload) => emit("action", payload),
  startDrag(node) {
    drag.item = node.item;
    drag.type = node.type;
  },
  dragOver(node, position) {
    drag.overId = node.item.id;
    drag.position = position;
  },
  drop: performDrop,
  endDrag: resetDrag
});

const environmentOptions = computed(() => apiState.current?.environments || []);
const collectionMenu = computed(() => [
  { label: "Nova requisicao", icon: "plus", action: () => emit("new-request") },
  { label: "Nova pasta", icon: "folder-plus", action: () => emit("new-folder") },
  { label: "Importar cURL / Postman / Insomnia", icon: "import", action: () => emit("import") },
  { divider: true },
  { label: "Expandir tudo", icon: "chevron-down", action: () => { expanded.value = new Set(apiState.current.folders.map((folder) => folder.id)); persistExpanded(); } },
  { label: "Recolher tudo", icon: "chevron-up", action: () => { expanded.value = new Set(); persistExpanded(); } }
]);
</script>

<template>
  <aside class="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 xl:w-[320px]">
    <div class="border-b border-slate-200 px-3 pb-3 pt-3">
      <div class="flex items-center gap-1">
        <button type="button" class="btn-icon h-8 w-8" title="Voltar para colecoes" @click="navigate('apis')"><Icon name="arrow-left" :size="16" /></button>
        <button type="button" class="min-w-0 flex-1 rounded-lg px-2 py-1 text-left hover:bg-white" :title="isManager ? 'Configuracoes da colecao' : collection?.name" @click="emit('open-settings')">
          <p class="truncate text-sm font-semibold text-slate-900">{{ collection?.name }}</p>
          <p class="text-[11px] text-slate-500">{{ collection?.scope === "internal" ? "API interna" : "API externa" }} · {{ apiState.current?.requests.length || 0 }} requisicoes</p>
        </button>
        <button v-if="isManager" type="button" class="btn-icon h-8 w-8" title="Configuracoes da colecao" @click="emit('open-settings')"><Icon name="settings" :size="16" /></button>
      </div>

      <div class="mt-3 flex items-center gap-1.5">
        <div class="relative min-w-0 flex-1">
          <Icon name="sliders" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select :value="apiState.environmentId || ''" class="input input-sm pl-8" title="Ambiente usado ao enviar" @change="setEnvironment($event.target.value)">
            <option value="">Sem ambiente</option>
            <option v-for="environment in environmentOptions" :key="environment.id" :value="environment.id">{{ environment.name }}</option>
          </select>
        </div>
        <button type="button" class="btn-secondary btn-sm px-2" title="Ambientes e variaveis" @click="emit('open-environments')"><Icon name="key" :size="14" /></button>
      </div>

      <div class="mt-2 flex items-center gap-1.5">
        <div class="relative min-w-0 flex-1">
          <Icon name="search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="search" type="search" class="input input-sm pl-8" placeholder="Filtrar requisicoes" />
        </div>
        <template v-if="isManager">
          <button type="button" class="btn-primary btn-sm px-2" title="Nova requisicao" @click="emit('new-request')"><Icon name="plus" :size="14" /></button>
          <Dropdown :items="collectionMenu" button-class="btn-secondary btn-sm px-2" :width="260" />
        </template>
      </div>
    </div>

    <div
      class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2"
      @dragover.prevent
      @drop.prevent="drag.item && performDrop(null, 'root')"
    >
      <p v-if="!tree.length" class="px-3 py-6 text-center text-xs text-slate-400">{{ search ? "Nenhuma requisicao encontrada." : "Colecao vazia." }}</p>
      <TreeNode v-for="node in tree" :key="node.item.id" :node="node" :depth="0" :force-open="Boolean(search)" />
      <div v-if="drag.item" class="mt-2 rounded-lg border-2 border-dashed border-brand-300 px-3 py-3 text-center text-xs text-brand-700">Solte aqui para mover para a raiz</div>
    </div>
  </aside>
</template>
