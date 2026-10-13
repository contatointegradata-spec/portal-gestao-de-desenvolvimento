<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { registerOverlay } from "../../lib/overlay.js";
import Icon from "./Icon.vue";

const props = defineProps({
  title: { type: String, default: "" },
  subtitle: { type: String, default: "" },
  size: { type: String, default: "md" },
  closable: { type: Boolean, default: true },
  bodyClass: { type: String, default: "p-6" }
});
const emit = defineEmits(["close"]);

const widths = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl", full: "max-w-[96vw]" };

let unregister = null;
onMounted(() => {
  unregister = registerOverlay(() => props.closable && emit("close"));
});
onBeforeUnmount(() => unregister?.());
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-[2px] animate-fade-in sm:p-6" @mousedown.self="closable && emit('close')">
      <div class="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up" :class="widths[size] || widths.md" role="dialog" aria-modal="true">
        <header v-if="title || $slots.header" class="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <slot name="header">
            <div class="min-w-0">
              <h2 class="truncate text-lg font-semibold text-slate-900">{{ title }}</h2>
              <p v-if="subtitle" class="mt-0.5 text-sm text-slate-500">{{ subtitle }}</p>
            </div>
          </slot>
          <button v-if="closable" type="button" class="btn-icon -mr-2" title="Fechar (Esc)" @click="emit('close')">
            <Icon name="x" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto scrollbar-thin" :class="bodyClass">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-3">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
