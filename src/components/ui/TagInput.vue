<script setup>
import { ref } from "vue";
import Icon from "./Icon.vue";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: "Digite e pressione Enter" },
  suggestions: { type: Array, default: () => [] }
});
const emit = defineEmits(["update:modelValue"]);
const draft = ref("");
const listId = `tags-${Math.random().toString(36).slice(2)}`;

function add(value = draft.value) {
  const parts = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return;
  const next = [...props.modelValue];
  for (const part of parts) {
    if (!next.some((item) => item.toLowerCase() === part.toLowerCase())) next.push(part);
  }
  emit("update:modelValue", next);
  draft.value = "";
}

function remove(index) {
  emit("update:modelValue", props.modelValue.filter((_, itemIndex) => itemIndex !== index));
}

function onKeydown(event) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    add();
  } else if (event.key === "Backspace" && !draft.value && props.modelValue.length) {
    remove(props.modelValue.length - 1);
  }
}
</script>

<template>
  <div class="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
    <span v-for="(tag, index) in modelValue" :key="tag" class="chip bg-brand-50 text-brand-800">
      {{ tag }}
      <button type="button" class="text-brand-500 hover:text-brand-800" @click="remove(index)"><Icon name="x" :size="12" /></button>
    </span>
    <input
      v-model="draft"
      :list="suggestions.length ? listId : undefined"
      class="min-w-[140px] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400"
      :placeholder="modelValue.length ? '' : placeholder"
      @keydown="onKeydown"
      @blur="add()"
    />
    <datalist v-if="suggestions.length" :id="listId">
      <option v-for="item in suggestions" :key="item" :value="item" />
    </datalist>
  </div>
</template>
