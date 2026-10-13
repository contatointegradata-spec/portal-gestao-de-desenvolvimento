<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import Icon from "./Icon.vue";

/**
 * Menu de acoes. items: [{ label, icon, action, danger, disabled, divider }]
 * O menu e posicionado em "fixed" para nao ser cortado por containers com overflow.
 */
const props = defineProps({
  items: { type: Array, default: () => [] },
  icon: { type: String, default: "more-vertical" },
  buttonClass: { type: String, default: "btn-icon h-8 w-8" },
  title: { type: String, default: "Mais acoes" },
  width: { type: Number, default: 208 }
});

const open = ref(false);
const trigger = ref(null);
const position = ref({ top: 0, left: 0 });

function close() {
  open.value = false;
  window.removeEventListener("scroll", close, true);
  window.removeEventListener("resize", close);
}

async function toggle() {
  if (open.value) return close();
  const rect = trigger.value.getBoundingClientRect();
  const estimatedHeight = props.items.length * 38 + 12;
  const top = rect.bottom + estimatedHeight > window.innerHeight ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4;
  const left = Math.min(Math.max(8, rect.right - props.width), window.innerWidth - props.width - 8);
  position.value = { top, left };
  open.value = true;
  await nextTick();
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
}

function run(item) {
  if (item.disabled) return;
  close();
  item.action?.();
}

onBeforeUnmount(close);
</script>

<template>
  <button ref="trigger" type="button" :class="buttonClass" :title="title" @click.stop="toggle">
    <slot><Icon :name="icon" :size="16" /></slot>
  </button>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70]" @mousedown="close" @contextmenu.prevent="close">
      <div
        class="fixed rounded-xl border border-slate-200 bg-white p-1 shadow-pop animate-fade-in"
        :style="{ top: `${position.top}px`, left: `${position.left}px`, width: `${width}px` }"
        @mousedown.stop
      >
        <template v-for="(item, index) in items" :key="index">
          <div v-if="item.divider" class="my-1 h-px bg-slate-100" />
          <button
            v-else
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40"
            :class="item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'"
            :disabled="item.disabled"
            @click="run(item)"
          >
            <Icon v-if="item.icon" :name="item.icon" :size="15" />
            <span class="truncate">{{ item.label }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
