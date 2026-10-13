<script setup>
import { initials } from "../../lib/format.js";

defineProps({
  name: { type: String, default: "" },
  photo: { type: String, default: "" },
  size: { type: String, default: "h-9 w-9 text-xs" },
  rounded: { type: String, default: "rounded-full" }
});
</script>

<template>
  <img v-if="photo" :src="photo" :alt="name" class="shrink-0 object-cover" :class="[size, rounded]" />
  <div v-else class="flex shrink-0 items-center justify-center bg-brand-100 font-semibold text-brand-800" :class="[size, rounded]">
    {{ initials(name) }}
  </div>
</template>
