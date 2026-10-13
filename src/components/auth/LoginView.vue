<script setup>
import { reactive, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { login } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";
import logoUrl from "../../assets/favicon_unimed.webp";

const LAST_EMAIL_KEY = "gestao_last_email";

function readLastEmail() {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) || "";
  } catch {
    return "";
  }
}

const mode = ref("login"); // login | forgot-email | forgot-code | forgot-password
const loading = ref(false);
const error = ref("");
const info = ref("");
const showPassword = ref(false);
const form = reactive({ email: readLastEmail(), password: "" });
const recovery = reactive({ email: "", code: "", password: "", confirm: "" });

function switchMode(next) {
  mode.value = next;
  error.value = "";
  info.value = "";
}

async function submitLogin() {
  error.value = "";
  if (!form.email.trim() || !form.password) {
    error.value = "Informe email e senha.";
    return;
  }
  loading.value = true;
  try {
    await login(form.email.trim(), form.password);
    try { localStorage.setItem(LAST_EMAIL_KEY, form.email.trim()); } catch { /* ignore */ }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function requestCode() {
  error.value = "";
  if (!recovery.email.trim()) {
    error.value = "Informe o email cadastrado.";
    return;
  }
  loading.value = true;
  try {
    const data = await http.post("/api/auth/forgot-password", { email: recovery.email.trim() });
    info.value = data.message;
    mode.value = "forgot-code";
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function verifyCode() {
  error.value = "";
  if (!/^\d{6}$/.test(recovery.code.trim())) {
    error.value = "O codigo possui 6 digitos.";
    return;
  }
  loading.value = true;
  try {
    await http.post("/api/auth/verify-reset-code", { email: recovery.email.trim(), code: recovery.code.trim() });
    info.value = "";
    mode.value = "forgot-password";
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function resetPassword() {
  error.value = "";
  if (recovery.password !== recovery.confirm) {
    error.value = "As senhas nao conferem.";
    return;
  }
  loading.value = true;
  try {
    await http.post("/api/auth/reset-password", { email: recovery.email.trim(), code: recovery.code.trim(), novaSenha: recovery.password });
    toast("Senha redefinida. Entre com a nova senha.");
    form.email = recovery.email.trim();
    form.password = "";
    Object.assign(recovery, { email: "", code: "", password: "", confirm: "" });
    switchMode("login");
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <section class="relative hidden overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div class="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div class="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-lime-400/10 blur-3xl" />
      <div class="relative flex items-center gap-3">
        <img :src="logoUrl" alt="Unimed" class="h-10 w-10 rounded-xl bg-white p-1" />
        <div>
          <p class="text-xs uppercase tracking-[0.3em] text-brand-200">Unimed Patos de Minas</p>
          <p class="font-semibold">Gestao de Sistemas</p>
        </div>
      </div>
      <div class="relative max-w-lg">
        <h1 class="font-brand text-4xl font-black leading-tight">Desenvolvimento, automacoes e integracoes em um so lugar.</h1>
        <ul class="mt-8 space-y-4 text-brand-100">
          <li class="flex items-start gap-3"><Icon name="layout-grid" class="mt-0.5 text-brand-300" />Catalogo e gestao das aplicacoes da cooperativa.</li>
          <li class="flex items-start gap-3"><Icon name="bot" class="mt-0.5 text-brand-300" />Robos RPA em Python ou JavaScript com execucao ao vivo e agendamento.</li>
          <li class="flex items-start gap-3"><Icon name="plug" class="mt-0.5 text-brand-300" />Cliente de APIs internas e externas com credenciais protegidas.</li>
        </ul>
      </div>
      <p class="relative text-xs text-brand-200/70">Acesso restrito a colaboradores autorizados.</p>
    </section>

    <section class="flex items-center justify-center px-4 py-10 sm:px-8">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <img :src="logoUrl" alt="Unimed" class="h-10 w-10 rounded-xl border border-slate-200 bg-white p-1" />
          <p class="font-semibold text-slate-800">Gestao de Sistemas · Unimed</p>
        </div>

        <form v-if="mode === 'login'" class="space-y-4" @submit.prevent="submitLogin">
          <div>
            <h2 class="text-2xl font-semibold text-slate-900">Entrar</h2>
            <p class="mt-1 text-sm text-slate-500">Use seu email corporativo e senha.</p>
          </div>
          <div>
            <label class="label" for="email">Email</label>
            <input id="email" v-model="form.email" type="email" class="input" autocomplete="username" placeholder="nome@unimedpatosdeminas.com.br" autofocus />
          </div>
          <div>
            <label class="label" for="password">Senha</label>
            <div class="relative">
              <input id="password" v-model="form.password" :type="showPassword ? 'text' : 'password'" class="input pr-10" autocomplete="current-password" />
              <button type="button" class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600" :title="showPassword ? 'Ocultar senha' : 'Mostrar senha'" @click="showPassword = !showPassword">
                <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
              </button>
            </div>
          </div>
          <p v-if="error" class="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700"><Icon name="alert-circle" :size="16" class="mt-0.5" />{{ error }}</p>
          <button type="submit" class="btn-primary w-full py-2.5" :disabled="loading">
            <Icon v-if="loading" name="loader" class="animate-spin" :size="16" />
            {{ loading ? "Entrando..." : "Entrar" }}
          </button>
          <button type="button" class="w-full text-center text-sm font-medium text-brand-700 hover:underline" @click="recovery.email = form.email; switchMode('forgot-email')">
            Esqueci minha senha
          </button>
        </form>

        <div v-else class="space-y-4">
          <button type="button" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800" @click="switchMode('login')">
            <Icon name="arrow-left" :size="16" /> Voltar ao login
          </button>
          <div>
            <h2 class="text-2xl font-semibold text-slate-900">Recuperar senha</h2>
            <div class="mt-3 flex gap-1.5">
              <span v-for="step in 3" :key="step" class="h-1.5 flex-1 rounded-full" :class="step <= { 'forgot-email': 1, 'forgot-code': 2, 'forgot-password': 3 }[mode] ? 'bg-brand-500' : 'bg-slate-200'" />
            </div>
          </div>

          <form v-if="mode === 'forgot-email'" class="space-y-4" @submit.prevent="requestCode">
            <p class="text-sm text-slate-500">Enviaremos um codigo de 6 digitos para o seu email, valido por 10 minutos.</p>
            <div>
              <label class="label">Email cadastrado</label>
              <input v-model="recovery.email" type="email" class="input" autofocus />
            </div>
            <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
            <button type="submit" class="btn-primary w-full" :disabled="loading">{{ loading ? "Enviando..." : "Enviar codigo" }}</button>
          </form>

          <form v-else-if="mode === 'forgot-code'" class="space-y-4" @submit.prevent="verifyCode">
            <p class="text-sm text-slate-500">{{ info || "Digite o codigo recebido por email." }}</p>
            <div>
              <label class="label">Codigo de verificacao</label>
              <input v-model="recovery.code" inputmode="numeric" maxlength="6" class="input text-center font-mono text-lg tracking-[0.6em]" placeholder="000000" autofocus />
            </div>
            <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
            <button type="submit" class="btn-primary w-full" :disabled="loading">{{ loading ? "Validando..." : "Validar codigo" }}</button>
            <button type="button" class="w-full text-center text-sm text-slate-500 hover:text-slate-800" :disabled="loading" @click="requestCode">Reenviar codigo</button>
          </form>

          <form v-else class="space-y-4" @submit.prevent="resetPassword">
            <div>
              <label class="label">Nova senha</label>
              <input v-model="recovery.password" type="password" class="input" autocomplete="new-password" autofocus />
              <p class="hint">Minimo de 8 caracteres, com letras e numeros.</p>
            </div>
            <div>
              <label class="label">Confirmar nova senha</label>
              <input v-model="recovery.confirm" type="password" class="input" autocomplete="new-password" />
            </div>
            <p v-if="error" class="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
            <button type="submit" class="btn-primary w-full" :disabled="loading">{{ loading ? "Salvando..." : "Salvar nova senha" }}</button>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
