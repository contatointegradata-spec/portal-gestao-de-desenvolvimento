<script setup>
import { nextTick, ref, watch } from "vue";
import { closeDialog, dialog, dismissToast, toasts } from "../../lib/feedback.js";
import Icon from "./Icon.vue";
import Modal from "./Modal.vue";

const input = ref(null);
const TOAST_STYLE = {
  success: { icon: "check-circle", class: "border-emerald-200 bg-white text-emerald-700" },
  error: { icon: "x-circle", class: "border-rose-200 bg-white text-rose-700" },
  warn: { icon: "alert-triangle", class: "border-amber-200 bg-white text-amber-700" },
  info: { icon: "info", class: "border-sky-200 bg-white text-sky-700" }
};

watch(() => dialog.open, async (open) => {
  if (open && dialog.kind === "prompt") {
    await nextTick();
    input.value?.focus();
    input.value?.select();
  }
});
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
      <TransitionGroup enter-from-class="opacity-0 translate-y-2" enter-active-class="transition duration-200" leave-to-class="opacity-0" leave-active-class="transition duration-150">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-pop"
          :class="TOAST_STYLE[item.type]?.class"
          role="status"
        >
          <Icon :name="TOAST_STYLE[item.type]?.icon || 'info'" :size="18" class="mt-0.5" />
          <p class="flex-1 text-slate-700">{{ item.message }}</p>
          <button type="button" class="text-slate-400 hover:text-slate-600" @click="dismissToast(item.id)"><Icon name="x" :size="16" /></button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>

  <Modal v-if="dialog.open" :title="dialog.title" size="sm" @close="closeDialog(false)">
    <p v-if="dialog.message" class="whitespace-pre-line text-sm text-slate-600">{{ dialog.message }}</p>
    <form v-if="dialog.kind === 'prompt'" :class="dialog.message ? 'mt-4' : ''" @submit.prevent="closeDialog(true)">
      <label v-if="dialog.inputLabel" class="label">{{ dialog.inputLabel }}</label>
      <input ref="input" v-model="dialog.inputValue" class="input" :placeholder="dialog.inputPlaceholder" maxlength="200" />
    </form>
    <template #footer>
      <button type="button" class="btn-secondary" @click="closeDialog(false)">{{ dialog.cancelText }}</button>
      <button type="button" :class="dialog.danger ? 'btn-danger' : 'btn-primary'" @click="closeDialog(true)">{{ dialog.confirmText }}</button>
    </template>
  </Modal>
</template>
