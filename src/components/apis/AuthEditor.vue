<script setup>
import { computed, ref } from "vue";
import { SECRET_MASK } from "../../stores/apiWorkspace.js";
import Icon from "../ui/Icon.vue";

const props = defineProps({
  type: { type: String, default: "none" },
  config: { type: Object, default: () => ({}) },
  allowInherit: { type: Boolean, default: true },
  inherited: { type: Object, default: null },
  readonly: { type: Boolean, default: false }
});
const emit = defineEmits(["update:type", "update:config"]);

const AUTH_OPTIONS = [
  { id: "inherit", label: "Herdar", description: "Usa a autenticacao da pasta ou da colecao" },
  { id: "none", label: "Nenhuma", description: "Requisicao sem autenticacao" },
  { id: "bearer", label: "Bearer Token", description: "Header Authorization: Bearer <token>" },
  { id: "basic", label: "Basic Auth", description: "Usuario e senha codificados em Base64" },
  { id: "api_key", label: "API Key", description: "Chave enviada em header ou query" },
  { id: "oauth2", label: "OAuth 2.0", description: "Token obtido automaticamente e reutilizado ate expirar" }
];
const LABELS = Object.fromEntries(AUTH_OPTIONS.map((option) => [option.id, option.label]));

const options = computed(() => AUTH_OPTIONS.filter((option) => props.allowInherit || option.id !== "inherit"));
const revealed = ref(new Set());

function setType(type) {
  if (props.readonly || type === props.type) return;
  emit("update:type", type);
  const defaults = {
    bearer: { token: "", prefix: "Bearer" },
    basic: { username: "", password: "" },
    api_key: { key: "", value: "", in: "header" },
    oauth2: { grantType: "client_credentials", tokenUrl: "", clientId: "", clientSecret: "", scope: "", audience: "", username: "", password: "", credentialsLocation: "basic_auth_header", headerPrefix: "Bearer" }
  };
  emit("update:config", defaults[type] || {});
}

function set(field, value) {
  emit("update:config", { ...props.config, [field]: value });
}

function isSecretSaved(field) {
  return props.config[field] === SECRET_MASK;
}

function toggleReveal(field) {
  const next = new Set(revealed.value);
  if (next.has(field)) next.delete(field);
  else next.add(field);
  revealed.value = next;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
        :class="type === option.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
        :title="option.description"
        :disabled="readonly"
        @click="setType(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <p v-if="type === 'inherit'" class="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
      <Icon name="git-branch" :size="16" class="text-slate-400" />
      <span v-if="inherited && inherited.type !== 'none'">Usando <strong>{{ LABELS[inherited.type] }}</strong> definida na {{ inherited.source }}.</span>
      <span v-else>Nenhuma autenticacao definida na {{ inherited?.source || "colecao" }}. A requisicao sera enviada sem autenticacao.</span>
    </p>
    <p v-else-if="type === 'none'" class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Nenhum dado de autenticacao sera enviado.</p>

    <div v-else class="grid gap-3 md:grid-cols-2">
      <template v-if="type === 'bearer'">
        <div class="md:col-span-2">
          <label class="label">Token</label>
          <div class="relative">
            <input :value="isSecretSaved('token') ? '' : config.token" :type="revealed.has('token') ? 'text' : 'password'" class="input pr-10 font-mono text-xs" :placeholder="isSecretSaved('token') ? '•••••• salvo — digite para substituir' : 'Token ou {{variavel}}'" :readonly="readonly" autocomplete="off" @input="set('token', $event.target.value)" />
            <button v-if="!isSecretSaved('token')" type="button" class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400" @click="toggleReveal('token')"><Icon :name="revealed.has('token') ? 'eye-off' : 'eye'" :size="15" /></button>
          </div>
        </div>
        <div>
          <label class="label">Prefixo</label>
          <input :value="config.prefix" class="input" placeholder="Bearer" :readonly="readonly" @input="set('prefix', $event.target.value)" />
        </div>
      </template>

      <template v-if="type === 'basic'">
        <div>
          <label class="label">Usuario</label>
          <input :value="config.username" class="input" :readonly="readonly" autocomplete="off" @input="set('username', $event.target.value)" />
        </div>
        <div>
          <label class="label">Senha</label>
          <input :value="isSecretSaved('password') ? '' : config.password" type="password" class="input" :placeholder="isSecretSaved('password') ? '•••••• salva — digite para substituir' : ''" :readonly="readonly" autocomplete="new-password" @input="set('password', $event.target.value)" />
        </div>
      </template>

      <template v-if="type === 'api_key'">
        <div>
          <label class="label">Nome da chave</label>
          <input :value="config.key" class="input font-mono text-xs" placeholder="x-api-key" :readonly="readonly" @input="set('key', $event.target.value)" />
        </div>
        <div>
          <label class="label">Enviar em</label>
          <select :value="config.in" class="input" :disabled="readonly" @change="set('in', $event.target.value)">
            <option value="header">Header</option>
            <option value="query">Query string</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">Valor</label>
          <input :value="isSecretSaved('value') ? '' : config.value" type="password" class="input font-mono text-xs" :placeholder="isSecretSaved('value') ? '•••••• salvo — digite para substituir' : 'Valor ou {{variavel}}'" :readonly="readonly" autocomplete="off" @input="set('value', $event.target.value)" />
        </div>
      </template>

      <template v-if="type === 'oauth2'">
        <div>
          <label class="label">Grant type</label>
          <select :value="config.grantType" class="input" :disabled="readonly" @change="set('grantType', $event.target.value)">
            <option value="client_credentials">Client Credentials</option>
            <option value="password">Password (usuario e senha)</option>
          </select>
        </div>
        <div>
          <label class="label">Envio das credenciais do cliente</label>
          <select :value="config.credentialsLocation" class="input" :disabled="readonly" @change="set('credentialsLocation', $event.target.value)">
            <option value="basic_auth_header">Header Basic Auth</option>
            <option value="body">No corpo da requisicao</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">URL do token</label>
          <input :value="config.tokenUrl" class="input font-mono text-xs" placeholder="https://auth.exemplo.com/oauth2/token" :readonly="readonly" @input="set('tokenUrl', $event.target.value)" />
        </div>
        <div>
          <label class="label">Client ID</label>
          <input :value="config.clientId" class="input font-mono text-xs" :readonly="readonly" autocomplete="off" @input="set('clientId', $event.target.value)" />
        </div>
        <div>
          <label class="label">Client Secret</label>
          <input :value="isSecretSaved('clientSecret') ? '' : config.clientSecret" type="password" class="input font-mono text-xs" :placeholder="isSecretSaved('clientSecret') ? '•••••• salvo — digite para substituir' : ''" :readonly="readonly" autocomplete="new-password" @input="set('clientSecret', $event.target.value)" />
        </div>
        <template v-if="config.grantType === 'password'">
          <div>
            <label class="label">Usuario</label>
            <input :value="config.username" class="input" :readonly="readonly" autocomplete="off" @input="set('username', $event.target.value)" />
          </div>
          <div>
            <label class="label">Senha</label>
            <input :value="isSecretSaved('password') ? '' : config.password" type="password" class="input" :placeholder="isSecretSaved('password') ? '•••••• salva' : ''" :readonly="readonly" autocomplete="new-password" @input="set('password', $event.target.value)" />
          </div>
        </template>
        <div>
          <label class="label">Scope</label>
          <input :value="config.scope" class="input" placeholder="read write" :readonly="readonly" @input="set('scope', $event.target.value)" />
        </div>
        <div>
          <label class="label">Audience (opcional)</label>
          <input :value="config.audience" class="input" :readonly="readonly" @input="set('audience', $event.target.value)" />
        </div>
        <p class="md:col-span-2 flex items-start gap-2 text-xs text-slate-500"><Icon name="info" :size="14" class="mt-0.5" />O token e obtido pelo servidor e reutilizado ate expirar. Use "Renovar token" no painel de resposta para forcar um novo.</p>
      </template>

      <p class="md:col-span-2 flex items-center gap-1.5 text-xs text-slate-500"><Icon name="shield" :size="14" class="text-emerald-600" />Senhas, tokens e secrets sao criptografados no servidor e nunca retornam ao navegador.</p>
    </div>
  </div>
</template>
