<script setup>
import { computed, reactive, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { formatDateTime, ROLE_LABELS } from "../../lib/format.js";
import { resizeImage } from "../../lib/image.js";
import { session, updateCurrentUser } from "../../stores/session.js";
import Avatar from "../ui/Avatar.vue";
import Icon from "../ui/Icon.vue";

const user = computed(() => session.user);
const photoSaving = ref(false);
const passwordSaving = ref(false);
const passwordError = ref("");
const passwords = reactive({ current: "", next: "", confirm: "" });

const PERMISSIONS = {
  super_admin: ["Cria, edita, ativa/desativa e remove usuarios", "Gerencia sistemas, RPAs e colecoes de API", "Visualiza e revela credenciais de API"],
  admin: ["Gerencia sistemas, RPAs e colecoes de API", "Altera email e senha de usuarios comuns", "Visualiza e revela credenciais de API"],
  user: ["Visualiza os sistemas sob sua responsabilidade", "Executa os RPAs sob sua responsabilidade", "Consulta e envia requisicoes das colecoes de API"]
};

const checks = computed(() => [
  { label: "8 ou mais caracteres", ok: passwords.next.length >= 8 },
  { label: "Letras", ok: /[A-Za-z]/.test(passwords.next) },
  { label: "Numeros", ok: /\d/.test(passwords.next) },
  { label: "Maiusculas e minusculas", ok: /[a-z]/.test(passwords.next) && /[A-Z]/.test(passwords.next), optional: true },
  { label: "Simbolo", ok: /[^A-Za-z0-9]/.test(passwords.next), optional: true }
]);
const strength = computed(() => checks.value.filter((item) => item.ok).length);

async function onPhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  photoSaving.value = true;
  try {
    const foto = await resizeImage(file, { maxWidth: 320, maxHeight: 320, square: true, quality: 0.85 });
    const { user: updated } = await http.put("/api/users/me/photo", { foto });
    updateCurrentUser(updated);
    toast("Foto atualizada.");
  } catch (err) {
    toast.error(err.message);
  } finally {
    photoSaving.value = false;
  }
}

async function removePhoto() {
  const { user: updated } = await http.put("/api/users/me/photo", { foto: "" });
  updateCurrentUser(updated);
}

async function changePassword() {
  passwordError.value = "";
  if (!passwords.current || !passwords.next) {
    passwordError.value = "Preencha a senha atual e a nova senha.";
    return;
  }
  if (passwords.next !== passwords.confirm) {
    passwordError.value = "A confirmacao nao confere com a nova senha.";
    return;
  }
  passwordSaving.value = true;
  try {
    await http.put("/api/users/me/password", { senhaAtual: passwords.current, novaSenha: passwords.next });
    Object.assign(passwords, { current: "", next: "", confirm: "" });
    toast("Senha alterada. As demais sessoes foram encerradas.");
  } catch (err) {
    passwordError.value = err.message;
  } finally {
    passwordSaving.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
    <p class="section-title">Configuracoes</p>
    <h1 class="page-title mt-1">Meu perfil</h1>

    <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section class="card p-6">
        <div class="flex flex-col items-center text-center">
          <div class="relative">
            <Avatar :name="user.nome" :photo="user.foto" size="h-28 w-28 text-3xl" rounded="rounded-3xl" />
            <label class="absolute -bottom-2 -right-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700" title="Alterar foto">
              <Icon :name="photoSaving ? 'loader' : 'camera'" :size="16" :class="photoSaving ? 'animate-spin' : ''" />
              <input type="file" accept="image/*" class="hidden" @change="onPhoto" />
            </label>
          </div>
          <button v-if="user.foto" type="button" class="mt-3 text-xs text-slate-400 hover:text-rose-600" @click="removePhoto">Remover foto</button>
          <h2 class="mt-4 text-xl font-semibold text-slate-900">{{ user.nome }}</h2>
          <p class="text-sm text-slate-500">{{ user.email }}</p>
          <div class="mt-3 flex flex-wrap justify-center gap-1.5">
            <span class="chip bg-brand-50 text-brand-700">{{ ROLE_LABELS[user.role] }}</span>
            <span v-if="user.isMaster" class="chip bg-amber-50 text-amber-700"><Icon name="crown" :size="12" />Usuario master</span>
            <span class="chip bg-slate-100 text-slate-600">{{ user.departamento || "Sem departamento" }}</span>
          </div>
        </div>
        <dl class="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-slate-500">Ultimo acesso</dt><dd class="font-medium text-slate-800">{{ formatDateTime(user.lastLoginAt) }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-slate-500">Conta criada em</dt><dd class="font-medium text-slate-800">{{ formatDateTime(user.createdAt) }}</dd></div>
        </dl>
        <div class="mt-5 rounded-xl bg-slate-50 p-4">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Seu perfil permite</p>
          <ul class="mt-2 space-y-1.5 text-sm text-slate-700">
            <li v-for="item in PERMISSIONS[user.role]" :key="item" class="flex items-start gap-2"><Icon name="check" :size="15" class="mt-0.5 text-brand-600" />{{ item }}</li>
          </ul>
        </div>
      </section>

      <form class="card p-6" @submit.prevent="changePassword">
        <h2 class="flex items-center gap-2 text-base font-semibold text-slate-900"><Icon name="lock" :size="18" />Alterar senha</h2>
        <p class="mt-1 text-sm text-slate-500">Por seguranca, as outras sessoes abertas serao encerradas.</p>
        <div class="mt-5 space-y-4">
          <div>
            <label class="label">Senha atual</label>
            <input v-model="passwords.current" type="password" class="input" autocomplete="current-password" />
          </div>
          <div>
            <label class="label">Nova senha</label>
            <input v-model="passwords.next" type="password" class="input" autocomplete="new-password" />
            <div class="mt-2 flex gap-1">
              <span v-for="index in 5" :key="index" class="h-1.5 flex-1 rounded-full" :class="index <= strength ? (strength <= 2 ? 'bg-rose-400' : strength <= 3 ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-200'" />
            </div>
            <ul class="mt-2 grid grid-cols-2 gap-1 text-xs">
              <li v-for="check in checks" :key="check.label" class="flex items-center gap-1.5" :class="check.ok ? 'text-emerald-700' : check.optional ? 'text-slate-400' : 'text-slate-500'">
                <Icon :name="check.ok ? 'check-circle' : 'info'" :size="12" />{{ check.label }}<span v-if="check.optional" class="text-slate-300">(recomendado)</span>
              </li>
            </ul>
          </div>
          <div>
            <label class="label">Confirmar nova senha</label>
            <input v-model="passwords.confirm" type="password" class="input" autocomplete="new-password" />
          </div>
        </div>
        <p v-if="passwordError" class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ passwordError }}</p>
        <button type="submit" class="btn-primary mt-5" :disabled="passwordSaving">{{ passwordSaving ? "Salvando..." : "Alterar senha" }}</button>
      </form>
    </div>
  </div>
</template>
