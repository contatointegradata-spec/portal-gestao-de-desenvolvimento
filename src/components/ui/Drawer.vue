<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { registerOverlay } from "../../lib/overlay.js";
import Icon from "./Icon.vue";

defineProps({
  width: { type: String, default: "max-w-3xl" }
});
const emit = defineEmits(["close"]);

let unregister = null;
onMounted(() => {
  unregister = registerOverlay(() => emit("close"));
});
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex justify-end bg-slate-950/30 animate-fade-in" @mousedown.self="emit('close')">
      <aside class="flex h-full w-full flex-col bg-white shadow-pop animate-slide-in-right" :class="width">
        <header class="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div class="min-w-0 flex-1"><slot name="header" /></div>
          <button type="button" class="btn-icon -mr-2" title="Fechar (Esc)" @click="emit('close')"><Icon name="x" /></button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto scrollbar-thin"><slot /></div>
        <footer v-if="$slots.footer" class="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
