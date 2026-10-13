<script setup>
import { computed, nextTick, ref } from "vue";
import Icon from "./Icon.vue";

const SECRET_MASK = "__SECRET_UNCHANGED__";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  keyPlaceholder: { type: String, default: "Chave" },
  valuePlaceholder: { type: String, default: "Valor" },
  readonly: { type: Boolean, default: false },
  withSecret: { type: Boolean, default: false },
  allowBulk: { type: Boolean, default: true }
});
const emit = defineEmits(["update:modelValue"]);

const bulkMode = ref(false);
const bulkText = ref("");
const revealed = ref(new Set());

const rows = computed(() => props.modelValue || []);

function update(list) {
  emit("update:modelValue", list);
}

function setField(index, field, value) {
  const list = rows.value.map((row) => ({ ...row }));
  list[index][field] = value;
  update(list);
}

const container = ref(null);

async function addRow(field, event) {
  const value = event.target.value;
  event.target.value = "";
  update([...rows.value.map((row) => ({ ...row })), { key: "", value: "", enabled: true, ...(props.withSecret ? { secret: false } : {}), [field]: value }]);
  await nextTick();
  const input = container.value?.querySelector(`[data-row="${rows.value.length - 1}"][data-field="${field}"]`);
  if (input) {
    input.focus();
    input.setSelectionRange?.(input.value.length, input.value.length);
  }
}

function removeRow(index) {
  update(rows.value.filter((_, rowIndex) => rowIndex !== index));
}

function toggleSecret(index) {
  const row = rows.value[index];
  const list = rows.value.map((item) => ({ ...item }));
  list[index].secret = !row.secret;
  if (row.secret && row.value === SECRET_MASK) list[index].value = "";
  update(list);
}

function toggleReveal(index) {
  const next = new Set(revealed.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  revealed.value = next;
}

function displayValue(row) {
  return row.value === SECRET_MASK ? "" : row.value;
}

function valuePlaceholderFor(row) {
  if (row.value === SECRET_MASK) return "•••••• (salvo — digite para substituir)";
  return props.valuePlaceholder;
}

function onValueInput(index, event) {
  setField(index, "value", event.target.value);
}

function openBulk() {
  bulkText.value = rows.value
    .filter((row) => row.value !== SECRET_MASK)
    .map((row) => `${row.enabled === false ? "// " : ""}${row.key}: ${row.value}`)
    .join("\n");
  bulkMode.value = true;
}

function applyBulk() {
  const kept = rows.value.filter((row) => row.value === SECRET_MASK);
  const parsed = bulkText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const disabled = line.startsWith("//");
    const clean = disabled ? line.slice(2).trim() : line;
    const separator = clean.indexOf(":");
    return {
      key: separator >= 0 ? clean.slice(0, separator).trim() : clean,
      value: separator >= 0 ? clean.slice(separator + 1).trim() : "",
      enabled: !disabled,
      ...(props.withSecret ? { secret: false } : {})
    };
  }).filter((row) => row.key);
  const keptKeys = new Set(kept.map((row) => row.key));
  update([...kept, ...parsed.filter((row) => !keptKeys.has(row.key))]);
  bulkMode.value = false;
}
</script>

<template>
  <div>
    <div v-if="allowBulk && !readonly" class="mb-2 flex justify-end">
      <button v-if="!bulkMode" type="button" class="text-xs font-medium text-slate-500 hover:text-brand-700" @click="openBulk">Edicao em massa</button>
      <div v-else class="flex gap-3">
        <button type="button" class="text-xs font-medium text-slate-500 hover:text-slate-700" @click="bulkMode = false">Cancelar</button>
        <button type="button" class="text-xs font-semibold text-brand-700" @click="applyBulk">Aplicar</button>
      </div>
    </div>

    <textarea
      v-if="bulkMode"
      v-model="bulkText"
      rows="8"
      class="input font-mono text-xs"
      placeholder="chave: valor&#10;// linha comentada fica desativada"
    />

    <div v-else ref="container" class="overflow-hidden rounded-xl border border-slate-200">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="group grid items-center border-b border-slate-100 last:border-b-0"
        :class="withSecret ? 'grid-cols-[32px_minmax(0,1fr)_minmax(0,1.4fr)_68px]' : 'grid-cols-[32px_minmax(0,1fr)_minmax(0,1.4fr)_36px]'"
      >
        <label class="flex h-full items-center justify-center border-r border-slate-100">
          <input type="checkbox" class="h-4 w-4 accent-brand-600" :checked="row.enabled !== false" :disabled="readonly" @change="setField(index, 'enabled', $event.target.checked)" />
        </label>
        <input
          class="h-9 min-w-0 border-r border-slate-100 bg-transparent px-3 font-mono text-xs outline-none focus:bg-brand-50/40"
          :class="row.enabled === false ? 'text-slate-400 line-through' : 'text-slate-800'"
          :value="row.key"
          :placeholder="keyPlaceholder"
          :readonly="readonly"
          :data-row="index"
          data-field="key"
          @input="setField(index, 'key', $event.target.value)"
        />
        <input
          :data-row="index"
          data-field="value"
          class="h-9 min-w-0 bg-transparent px-3 font-mono text-xs outline-none focus:bg-brand-50/40"
          :class="row.enabled === false ? 'text-slate-400' : 'text-slate-800'"
          :type="row.secret && !revealed.has(index) ? 'password' : 'text'"
          :value="displayValue(row)"
          :placeholder="valuePlaceholderFor(row)"
          :readonly="readonly"
          autocomplete="off"
          @input="onValueInput(index, $event)"
        />
        <div class="flex items-center justify-end gap-0.5 pr-1">
          <template v-if="withSecret">
            <button v-if="row.secret && row.value !== SECRET_MASK" type="button" class="rounded p-1 text-slate-400 hover:text-slate-700" :title="revealed.has(index) ? 'Ocultar' : 'Mostrar'" @click="toggleReveal(index)">
              <Icon :name="revealed.has(index) ? 'eye-off' : 'eye'" :size="14" />
            </button>
            <button type="button" class="rounded p-1" :class="row.secret ? 'text-amber-600' : 'text-slate-300 hover:text-slate-600'" :title="row.secret ? 'Segredo (criptografado)' : 'Marcar como segredo'" :disabled="readonly" @click="toggleSecret(index)">
              <Icon name="lock" :size="14" />
            </button>
          </template>
          <button v-if="!readonly" type="button" class="rounded p-1 text-slate-300 opacity-0 transition hover:text-rose-600 group-hover:opacity-100" title="Remover" @click="removeRow(index)">
            <Icon name="trash" :size="14" />
          </button>
        </div>
      </div>

      <div v-if="!readonly" class="grid items-center bg-slate-50/60" :class="withSecret ? 'grid-cols-[32px_minmax(0,1fr)_minmax(0,1.4fr)_68px]' : 'grid-cols-[32px_minmax(0,1fr)_minmax(0,1.4fr)_36px]'">
        <span class="flex justify-center text-slate-300"><Icon name="plus" :size="14" /></span>
        <input class="h-9 min-w-0 border-r border-slate-100 bg-transparent px-3 font-mono text-xs outline-none" :placeholder="`Adicionar ${keyPlaceholder.toLowerCase()}`" @input="addRow('key', $event)" />
        <input class="h-9 min-w-0 bg-transparent px-3 font-mono text-xs outline-none" :placeholder="valuePlaceholder" @input="addRow('value', $event)" />
        <span />
      </div>
      <p v-else-if="!rows.length" class="px-3 py-3 text-xs text-slate-400">Nenhum item.</p>
    </div>
  </div>
</template>
