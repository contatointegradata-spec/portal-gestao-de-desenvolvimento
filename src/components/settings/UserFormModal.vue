<script setup>
import { computed, reactive, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { ROLE_LABELS } from "../../lib/format.js";
import { isSuperAdmin, session } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";

const props = defineProps({ user: { type: Object, default: null } });
const emit = defineEmits(["close", "saved"]);

const isEdit = computed(() => Boolean(props.user));
const isSelf = computed(() => props.user?.id === session.user.id);
const isMasterTarget = computed(() => Boolean(props.user?.isMaster));
const canEditIdentity = computed(() => isSuperAdmin.value);
const canEditRole = computed(() => isSuperAdmin.value && !isMasterTarget.value && !isSelf.value);
const canEditCredentials = computed(() => !isMasterTarget.value || session.user.isMaster);

const saving = ref(false);
const error = ref("");
const form = reactive({
  nome: props.user?.nome || "",
  email: props.user?.email || "",
  role: props.user?.role || "user",
  departamento: props.user?.departamento || "",
  senha: "",
  confirmar: ""
});

const departmentNames = computed(() => session.departments.map((item) => item.nome));

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const random = crypto.getRandomValues(new Uint32Array(10));
  const password = `${Array.from(random, (value) => chars[value % chars.length]).join("")}7`;
  form.senha = password;
  form.confirmar = password;
  navigator.clipboard?.writeText(password).then(() => toast.info("Senha gerada e copiada para a area de transferencia.")).catch(() => {});
}

async function save() {
  error.value = "";
  if (!form.nome.trim() || !form.email.trim()) {
    error.value = "Nome e email sao obrigatorios.";
    return;
  }
  if (!isEdit.value && !form.senha) {
    error.value = "Defina a senha inicial.";
    return;
  }
  if (form.senha && form.senha !== form.confirmar) {
    error.value = "As senhas nao conferem.";
    return;
  }
  saving.value = true;
  try {
    if (isEdit.value) {
      const payload = {};
      if (canEditIdentity.value && form.nome.trim() !== props.user.nome) payload.nome = form.nome.trim();
      if (canEditCredentials.value && form.email.trim().toLowerCase() !== props.user.email) payload.email = form.email.trim();
      if (canEditRole.value && form.role !== props.user.role) payload.role = form.role;
      if (canEditIdentity.value && form.departamento.trim() !== (props.user.departamento || "")) payload.departamento = form.departamento.trim();
      if (canEditCredentials.value && form.senha) payload.novaSenha = form.senha;
      if (!Object.keys(payload).length) {
        emit("close");
        return;
      }
      await http.patch(`/api/users/${props.user.id}`, payload);
      toast("Usuario atualizado.");
    } else {
      await http.post("/api/users", { nome: form.nome.trim(), email: form.email.trim(), role: form.role, departamento: form.departamento.trim(), senha: form.senha });
      toast("Usuario criado.");
    }
    emit("saved");
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="isEdit ? 'Editar usuario' : 'Novo usuario'" :subtitle="isEdit ? user.email : 'O usuario recebe acesso imediato com a senha definida.'" size="md" @close="emit('close')">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
      <div class="md:col-span-2">
        <label class="label">Nome completo</label>
        <input v-model="form.nome" class="input" :disabled="isEdit && !canEditIdentity" />
      </div>
      <div class="md:col-span-2">
        <label class="label">Email</label>
        <input v-model="form.email" type="email" class="input" :disabled="isEdit && !canEditCredentials" autocomplete="off" />
      </div>
      <div>
        <label class="label">Perfil</label>
        <select v-model="form.role" class="input" :disabled="isEdit ? !canEditRole : !isSuperAdmin">
          <option v-for="(label, key) in ROLE_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
        <p v-if="isEdit && isMasterTarget" class="hint">O perfil do master e fixo.</p>
        <p v-else-if="isEdit && isSelf" class="hint">Voce nao pode alterar o proprio perfil.</p>
      </div>
      <div>
        <label class="label">Departamento</label>
        <input v-model="form.departamento" list="user-departments" class="input" :disabled="isEdit && !canEditIdentity" />
        <datalist id="user-departments"><option v-for="name in departmentNames" :key="name" :value="name" /></datalist>
      </div>
      <template v-if="canEditCredentials">
        <div class="md:col-span-2 flex items-center justify-between border-t border-slate-100 pt-4">
          <p class="text-sm font-semibold text-slate-800">{{ isEdit ? "Redefinir senha (opcional)" : "Senha inicial" }}</p>
          <button type="button" class="btn-ghost btn-sm" @click="generatePassword"><Icon name="key" :size="14" />Gerar senha</button>
        </div>
        <div>
          <label class="label">{{ isEdit ? "Nova senha" : "Senha" }}</label>
          <input v-model="form.senha" type="text" class="input font-mono" autocomplete="new-password" />
        </div>
        <div>
          <label class="label">Confirmar</label>
          <input v-model="form.confirmar" type="text" class="input font-mono" autocomplete="new-password" />
        </div>
        <p class="hint md:col-span-2 -mt-2">Minimo de 8 caracteres com letras e numeros.{{ isEdit ? " As sessoes abertas do usuario serao encerradas." : "" }}</p>
      </template>
      <p v-else class="md:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Somente o proprio usuario master altera o email e a senha dele.</p>
      <button type="submit" class="hidden" />
    </form>
    <template #footer>
      <p v-if="error" class="mr-auto text-sm text-rose-700">{{ error }}</p>
      <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="save">{{ saving ? "Salvando..." : isEdit ? "Salvar" : "Criar usuario" }}</button>
    </template>
  </Modal>
</template>
