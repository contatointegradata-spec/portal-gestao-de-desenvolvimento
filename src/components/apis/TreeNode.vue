<script setup>
import { computed, inject } from "vue";
import { METHOD_COLORS } from "../../lib/format.js";
import { apiState } from "../../stores/apiWorkspace.js";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
  forceOpen: { type: Boolean, default: false }
});

const tree = inject("apiTree");
const isFolder = computed(() => props.node.type === "folder");
const item = computed(() => props.node.item);
// Requisicoes com rascunho exibem o nome/metodo em edicao.
const label = computed(() => (!isFolder.value && apiState.drafts[item.value.id]?.name) || item.value.name);
const method = computed(() => (!isFolder.value && apiState.drafts[item.value.id]?.method) || item.value.method);
const open = computed(() => props.forceOpen || tree.expanded.value.has(item.value.id));
const selected = computed(() => !isFolder.value && apiState.selectedRequestId === item.value.id);
const dirty = computed(() => !isFolder.value && tree.isDirty(item.value.id));
const sending = computed(() => !isFolder.value && apiState.sending[item.value.id]);
const indicator = computed(() => (tree.drag.overId === item.value.id ? tree.drag.position : null));

const menu = computed(() => {
  if (!tree.canManage.value) return [];
  if (isFolder.value) {
    return [
      { label: "Nova requisicao aqui", icon: "plus", action: () => tree.action({ action: "new-request", type: "folder", item: item.value }) },
      { label: "Nova subpasta", icon: "folder-plus", action: () => tree.action({ action: "new-folder", type: "folder", item: item.value }) },
      { label: "Renomear", icon: "edit", action: () => tree.action({ action: "rename", type: "folder", item: item.value }) },
      { label: "Autenticacao da pasta", icon: "lock", action: () => tree.action({ action: "settings", type: "folder", item: item.value }) },
      { divider: true },
      { label: "Excluir pasta", icon: "trash", danger: true, action: () => tree.action({ action: "delete", type: "folder", item: item.value }) }
    ];
  }
  return [
    { label: "Duplicar", icon: "copy", action: () => tree.action({ action: "duplicate", type: "request", item: item.value }) },
    { label: "Renomear", icon: "edit", action: () => tree.action({ action: "rename", type: "request", item: item.value }) },
    { divider: true },
    { label: "Excluir", icon: "trash", danger: true, action: () => tree.action({ action: "delete", type: "request", item: item.value }) }
  ];
});

function onClick() {
  if (isFolder.value) tree.toggle(item.value.id);
  else tree.select(item.value.id);
}

function onDragStart(event) {
  if (!tree.canManage.value) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.value.id);
  tree.startDrag(props.node);
}

function onDragOver(event) {
  if (!tree.drag.item || tree.drag.item.id === item.value.id) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  let position;
  if (isFolder.value) position = tree.drag.type === "request" ? "into" : ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "into";
  else position = tree.drag.type === "folder" ? "after" : ratio < 0.5 ? "before" : "after";
  tree.dragOver(props.node, position);
}

function onDrop(event) {
  if (!tree.drag.item) return;
  event.preventDefault();
  event.stopPropagation();
  tree.drop(props.node, tree.drag.position || (isFolder.value ? "into" : "after"));
}
</script>

<template>
  <div>
    <div
      class="group relative flex cursor-pointer select-none items-center gap-1.5 rounded-lg py-1.5 pr-1 text-sm transition"
      :class="[
        selected ? 'bg-brand-100/70 text-brand-900' : 'text-slate-700 hover:bg-white',
        indicator === 'into' ? 'bg-brand-50 ring-2 ring-inset ring-brand-400' : ''
      ]"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      :draggable="tree.canManage.value"
      @click="onClick"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="tree.drag.overId === item.id && tree.dragOver({ item: { id: null } }, null)"
      @drop="onDrop"
      @dragend="tree.endDrag()"
    >
      <span v-if="indicator === 'before'" class="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded bg-brand-500" />
      <span v-if="indicator === 'after'" class="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand-500" />

      <template v-if="isFolder">
        <Icon :name="open ? 'chevron-down' : 'chevron-right'" :size="14" class="text-slate-400" />
        <Icon :name="open ? 'folder-open' : 'folder'" :size="16" class="text-amber-500" />
        <span class="min-w-0 flex-1 truncate font-medium">{{ item.name }}</span>
        <Icon v-if="item.authType && item.authType !== 'inherit'" name="lock" :size="12" class="text-amber-600" title="Pasta com autenticacao propria" />
        <span class="text-[10px] text-slate-400">{{ node.children.length }}</span>
      </template>
      <template v-else>
        <span class="w-12 shrink-0 text-right font-mono text-[10px] font-bold" :class="METHOD_COLORS[method] || 'text-slate-500'">{{ method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method }}</span>
        <span class="min-w-0 flex-1 truncate">{{ label }}</span>
        <Icon v-if="sending" name="loader" :size="12" class="animate-spin text-sky-500" />
        <span v-if="dirty" class="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Alteracoes nao salvas" />
      </template>

      <div v-if="menu.length" class="opacity-0 transition group-hover:opacity-100" @click.stop>
        <Dropdown :items="menu" button-class="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700" icon="more-horizontal" />
      </div>
    </div>

    <div v-if="isFolder && open">
      <TreeNode v-for="child in node.children" :key="child.item.id" :node="child" :depth="depth + 1" :force-open="forceOpen" />
      <p v-if="!node.children.length" class="py-1 text-[11px] italic text-slate-400" :style="{ paddingLeft: `${36 + depth * 14}px` }">Pasta vazia</p>
    </div>
  </div>
</template>
