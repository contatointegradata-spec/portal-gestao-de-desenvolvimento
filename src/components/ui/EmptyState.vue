<script setup>
import Icon from "./Icon.vue";

defineProps({
  icon: { type: String, default: "sparkles" },
  title: { type: String, required: true },
  description: { type: String, default: "" }
});
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
    <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
      <Icon :name="icon" :size="22" />
    </div>
    <h3 class="mt-4 text-base font-semibold text-slate-800">{{ title }}</h3>
    <p v-if="description" class="mt-1 max-w-md text-sm text-slate-500">{{ description }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
