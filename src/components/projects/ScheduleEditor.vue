<script setup>
import { computed, ref } from "vue";
import { WEEKDAYS } from "../../lib/format.js";
import Icon from "../ui/Icon.vue";

const props = defineProps({ modelValue: { type: Object, required: true } });
const emit = defineEmits(["update:modelValue"]);

const newTime = ref("08:00");
const newDateTime = ref("");

const schedule = computed(() => props.modelValue);

function update(patch) {
  emit("update:modelValue", { ...schedule.value, ...patch });
}

function addTime() {
  if (!/^\d{2}:\d{2}$/.test(newTime.value)) return;
  update({ times: [...new Set([...schedule.value.times, newTime.value])].sort() });
}

function removeTime(time) {
  update({ times: schedule.value.times.filter((item) => item !== time) });
}

function toggleDay(day) {
  const days = schedule.value.weekdays.includes(day) ? schedule.value.weekdays.filter((item) => item !== day) : [...schedule.value.weekdays, day];
  update({ weekdays: days.sort() });
}

function addDate() {
  if (!newDateTime.value) return;
  const value = newDateTime.value.replace("T", " ").slice(0, 16);
  update({ dates: [...new Set([...schedule.value.dates, value])].sort() });
  newDateTime.value = "";
}

function removeDate(value) {
  update({ dates: schedule.value.dates.filter((item) => item !== value) });
}

function formatSlot(value) {
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} as ${time}`;
}

const isPast = (value) => new Date(value.replace(" ", "T")).getTime() < Date.now();

const MODES = [
  { id: "manual", label: "Manual", description: "Executa apenas quando alguem clicar em Executar.", icon: "play" },
  { id: "daily", label: "Recorrente", description: "Todos os dias ou em dias da semana escolhidos.", icon: "refresh" },
  { id: "dates", label: "Datas especificas", description: "Execucoes unicas em data e hora definidas.", icon: "calendar" }
];
</script>

<template>
  <div class="space-y-5">
    <div class="grid gap-2 sm:grid-cols-3">
      <button
        v-for="mode in MODES"
        :key="mode.id"
        type="button"
        class="rounded-xl border p-3 text-left transition"
        :class="schedule.mode === mode.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'"
        @click="update({ mode: mode.id })"
      >
        <p class="flex items-center gap-2 text-sm font-semibold text-slate-800"><Icon :name="mode.icon" :size="15" />{{ mode.label }}</p>
        <p class="mt-1 text-xs text-slate-500">{{ mode.description }}</p>
      </button>
    </div>

    <div v-if="schedule.mode === 'daily'" class="space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <label class="label">Horarios</label>
        <div class="flex flex-wrap items-center gap-2">
          <span v-for="time in schedule.times" :key="time" class="chip bg-brand-50 py-1 font-mono text-sm text-brand-800">
            {{ time }}
            <button type="button" class="text-brand-500 hover:text-brand-800" @click="removeTime(time)"><Icon name="x" :size="12" /></button>
          </span>
          <div class="flex items-center gap-1">
            <input v-model="newTime" type="time" class="input input-sm w-28" @keydown.enter.prevent="addTime" />
            <button type="button" class="btn-soft btn-sm" @click="addTime"><Icon name="plus" :size="14" />Adicionar</button>
          </div>
        </div>
        <p v-if="!schedule.times.length" class="hint text-amber-600">Adicione ao menos um horario.</p>
      </div>
      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="label mb-0">Dias da semana</label>
          <div class="flex gap-2 text-xs">
            <button type="button" class="font-medium text-brand-700 hover:underline" @click="update({ weekdays: [1, 2, 3, 4, 5] })">Dias uteis</button>
            <button type="button" class="font-medium text-brand-700 hover:underline" @click="update({ weekdays: [0, 1, 2, 3, 4, 5, 6] })">Todos</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="day in WEEKDAYS"
            :key="day.value"
            type="button"
            class="h-9 w-12 rounded-lg border text-xs font-semibold transition"
            :class="schedule.weekdays.includes(day.value) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
            :title="day.label"
            @click="toggleDay(day.value)"
          >
            {{ day.short }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="schedule.mode === 'dates'" class="space-y-3 rounded-xl border border-slate-200 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <input v-model="newDateTime" type="datetime-local" class="input w-auto" @keydown.enter.prevent="addDate" />
        <button type="button" class="btn-soft" :disabled="!newDateTime" @click="addDate"><Icon name="plus" :size="14" />Adicionar data</button>
      </div>
      <div v-if="schedule.dates.length" class="flex flex-wrap gap-2">
        <span v-for="slot in schedule.dates" :key="slot" class="chip py-1 text-sm" :class="isPast(slot) ? 'bg-slate-100 text-slate-400 line-through' : 'bg-brand-50 text-brand-800'" :title="isPast(slot) ? 'Data ja passou' : ''">
          {{ formatSlot(slot) }}
          <button type="button" class="opacity-60 hover:opacity-100" @click="removeDate(slot)"><Icon name="x" :size="12" /></button>
        </span>
      </div>
      <p v-else class="hint text-amber-600">Adicione ao menos uma data e hora.</p>
    </div>

    <p v-if="schedule.mode !== 'manual'" class="flex items-start gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
      <Icon name="info" :size="14" class="mt-0.5" />
      Horarios no fuso de Brasilia. Se o RPA ainda estiver executando no proximo horario, a execucao agendada e ignorada e os administradores sao notificados.
    </p>
  </div>
</template>
