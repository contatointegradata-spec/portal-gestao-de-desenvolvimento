<script setup>
import { computed, ref } from "vue";
import { formatRelative } from "../../lib/format.js";
import { navigate } from "../../lib/router.js";
import { apiState, loadCollections } from "../../stores/apiWorkspace.js";
import { isManager } from "../../stores/session.js";
import EmptyState from "../ui/EmptyState.vue";
import Icon from "../ui/Icon.vue";

const emit = defineEmits(["create", "import"]);
const search = ref("");
const scope = ref("all");

const AUTH_LABELS = { none: "Sem autenticacao", bearer: "Bearer Token", basic: "Basic Auth", api_key: "API Key", oauth2: "OAuth 2.0" };

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return apiState.collections.filter((item) => (scope.value === "all" || item.scope === scope.value)
    && (!term || `${item.name} ${item.description}`.toLowerCase().includes(term)));
});

const totals = computed(() => ({
  collections: apiState.collections.length,
  requests: apiState.collections.reduce((sum, item) => sum + item.requestCount, 0),
  internal: apiState.collections.filter((item) => item.scope === "internal").length,
  external: apiState.collections.filter((item) => item.scope === "external").length
}));
</script>

<template>
  <div class="h-full overflow-y-auto scrollbar-thin">
    <div class="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="section-title">API / Plugins</p>
          <h1 class="page-title mt-1">Colecoes de API</h1>
          <p class="mt-1 text-sm text-slate-500">Consulte e gerencie APIs internas e externas com pastas, ambientes, variaveis e credenciais protegidas.</p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary" :disabled="apiState.collectionsLoading" @click="loadCollections"><Icon name="refresh" :size="16" :class="apiState.collectionsLoading ? 'animate-spin' : ''" /></button>
          <button v-if="isManager" type="button" class="btn-secondary" @click="emit('import')"><Icon name="import" :size="16" />Importar</button>
          <button v-if="isManager" type="button" class="btn-primary" @click="emit('create')"><Icon name="plus" :size="16" />Nova colecao</button>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="card p-4"><p class="text-xs text-slate-500">Colecoes</p><p class="mt-1 text-2xl font-semibold">{{ totals.collections }}</p></div>
        <div class="card p-4"><p class="text-xs text-slate-500">Requisicoes</p><p class="mt-1 text-2xl font-semibold">{{ totals.requests }}</p></div>
        <div class="card p-4"><p class="flex items-center gap-1.5 text-xs text-slate-500"><Icon name="server" :size="13" />Internas</p><p class="mt-1 text-2xl font-semibold">{{ totals.internal }}</p></div>
        <div class="card p-4"><p class="flex items-center gap-1.5 text-xs text-slate-500"><Icon name="globe" :size="13" />Externas</p><p class="mt-1 text-2xl font-semibold">{{ totals.external }}</p></div>
      </div>

      <div class="mt-6 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[240px] flex-1">
          <Icon name="search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="search" type="search" class="input pl-9" placeholder="Buscar colecao" />
        </div>
        <div class="flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            v-for="option in [{ id: 'all', label: 'Todas' }, { id: 'internal', label: 'Internas' }, { id: 'external', label: 'Externas' }]"
            :key="option.id"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium"
            :class="scope === option.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            @click="scope = option.id"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="apiState.collectionsLoading && !apiState.collections.length" class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="index in 3" :key="index" class="card h-40 animate-pulse bg-slate-100/60" />
      </div>
      <EmptyState
        v-else-if="!filtered.length"
        class="mt-6"
        icon="plug"
        :title="apiState.collections.length ? 'Nenhuma colecao encontrada' : 'Nenhuma colecao de API'"
        :description="apiState.collections.length ? 'Ajuste a busca ou o filtro.' : 'Crie uma colecao para organizar requisicoes em pastas, ou importe do Postman, Insomnia ou cURL.'"
      >
        <template v-if="isManager && !apiState.collections.length">
          <button type="button" class="btn-primary" @click="emit('create')"><Icon name="plus" :size="16" />Nova colecao</button>
          <button type="button" class="btn-secondary" @click="emit('import')"><Icon name="import" :size="16" />Importar</button>
        </template>
      </EmptyState>
      <div v-else class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <button
          v-for="collection in filtered"
          :key="collection.id"
          type="button"
          class="card group flex flex-col p-5 text-left transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
          @click="navigate(`apis/${collection.id}`)"
        >
          <div class="flex items-start justify-between gap-3">
            <span class="flex h-10 w-10 items-center justify-center rounded-xl" :class="collection.scope === 'internal' ? 'bg-brand-50 text-brand-600' : 'bg-sky-50 text-sky-600'">
              <Icon :name="collection.scope === 'internal' ? 'server' : 'globe'" :size="20" />
            </span>
            <span class="chip" :class="collection.scope === 'internal' ? 'bg-brand-50 text-brand-700' : 'bg-sky-50 text-sky-700'">{{ collection.scope === "internal" ? "Interna" : "Externa" }}</span>
          </div>
          <h3 class="mt-4 truncate font-semibold text-slate-900 group-hover:text-brand-700">{{ collection.name }}</h3>
          <p class="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">{{ collection.description || "Sem descricao." }}</p>
          <div class="mt-4 flex flex-wrap gap-1.5 text-xs">
            <span class="chip bg-slate-100 text-slate-600"><Icon name="send" :size="11" />{{ collection.requestCount }} req.</span>
            <span class="chip bg-slate-100 text-slate-600"><Icon name="folder" :size="11" />{{ collection.folderCount }}</span>
            <span class="chip bg-slate-100 text-slate-600"><Icon name="sliders" :size="11" />{{ collection.environmentCount }} amb.</span>
            <span v-if="collection.authType !== 'none'" class="chip bg-amber-50 text-amber-700"><Icon name="lock" :size="11" />{{ AUTH_LABELS[collection.authType] }}</span>
          </div>
          <p class="mt-4 text-xs text-slate-400">Atualizada {{ formatRelative(collection.updatedAt) }}</p>
        </button>
      </div>
    </div>
  </div>
</template>
