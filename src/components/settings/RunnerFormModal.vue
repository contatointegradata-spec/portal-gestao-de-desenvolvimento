<script setup>
import { computed, reactive, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";

const props = defineProps({ runner: { type: Object, default: null } });
const emit = defineEmits(["close", "saved"]);

const isEdit = computed(() => Boolean(props.runner));
const saving = ref(false);
const error = ref("");
const showPassword = ref(false);
const form = reactive({
  nome: props.runner?.nome || "",
  hostname: props.runner?.hostname || "",
  username: props.runner?.username || "",
  password: "",
  clearPassword: false,
  descricao: props.runner?.descricao || "",
  active: props.runner ? props.runner.active : true
});

async function save() {
  error.value = "";
  if (!form.nome.trim() || !form.hostname.trim()) {
    error.value = "Nome e hostname/IP sao obrigatorios.";
    return;
  }
  const payload = {
    nome: form.nome.trim(),
    hostname: form.hostname.trim(),
    username: form.username.trim(),
    descricao: form.descricao.trim(),
    active: form.active
  };
  // Na edicao, senha vazia mantem a atual.
  if (form.password) payload.password = form.password;
  else if (isEdit.value && form.clearPassword) payload.password = "";

  saving.value = true;
  try {
    if (isEdit.value) {
      const runner = await http.patch(`/api/runners/${props.runner.id}`, payload);
      toast("Servidor atualizado.");
      emit("saved", { runner });
    } else {
      const result = await http.post("/api/runners", payload);
      toast("Servidor cadastrado. Instale o agente para conecta-lo.");
      emit("saved", result);
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="isEdit ? 'Editar servidor' : 'Novo servidor de execucao'" :subtitle="isEdit ? runner.hostname : 'Servidor onde os robos vao rodar (ex.: maquina Windows acessada por RDP).'" size="md" @close="emit('close')">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
      <div>
        <label class="label">Nome</label>
        <input v-model="form.nome" class="input" placeholder="RPA - SRV 2" maxlength="80" />
      </div>
      <div>
        <label class="label">Hostname / IP</label>
        <input v-model="form.hostname" class="input font-mono" placeholder="SRV-RPA02" />
      </div>

      <div class="md:col-span-2 border-t border-slate-100 pt-4">
        <p class="flex items-center gap-2 text-sm font-semibold text-slate-800"><Icon name="key" :size="15" />Login do servidor</p>
        <p class="hint">Mesmo usuario usado na conexao RDP (mRemoteNG). O robo roda na sessao desse usuario, com o navegador visivel na area de trabalho.</p>
      </div>
      <div>
        <label class="label">Usuario</label>
        <input v-model="form.username" class="input font-mono" placeholder="dominio\rpa.usuario" autocomplete="off" />
      </div>
      <div>
        <label class="label">Senha <span class="font-normal text-slate-400">(opcional)</span></label>
        <div class="relative">
          <input
            v-model="form.password"
            :type="showPassword ? 'text' : 'password'"
            class="input pr-10"
            :placeholder="isEdit && runner.hasPassword ? '•••••••• (mantida)' : ''"
            autocomplete="new-password"
          />
          <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" :title="showPassword ? 'Ocultar' : 'Mostrar'" @click="showPassword = !showPassword">
            <Icon :name="showPassword ? 'eye-off' : 'eye'" :size="16" />
          </button>
        </div>
        <label v-if="isEdit && runner.hasPassword && !form.password" class="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <input v-model="form.clearPassword" type="checkbox" class="accent-brand-600" />Remover senha salva
        </label>
      </div>
      <p class="md:col-span-2 -mt-2 flex items-start gap-1.5 text-xs text-slate-500">
        <Icon name="lock" :size="12" class="mt-0.5 shrink-0" />
        A senha fica criptografada e nunca e exibida de novo. Ela e so referencia de acesso: o agente se autentica na plataforma por token, nao por senha.
      </p>

      <div class="md:col-span-2">
        <label class="label">Descricao</label>
        <textarea v-model="form.descricao" class="input min-h-[70px]" placeholder="Ex.: Servidor Roberty · Windows Server 2019" />
      </div>
      <label v-if="isEdit" class="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
        <input v-model="form.active" type="checkbox" class="accent-brand-600" />
        Servidor ativo (desativado, ele nao recebe execucoes)
      </label>
    </form>

    <template #footer>
      <p v-if="error" class="mr-auto flex items-center gap-2 text-sm text-rose-700"><Icon name="alert-circle" :size="16" />{{ error }}</p>
      <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="save">
        <Icon :name="saving ? 'loader' : 'save'" :size="16" :class="saving ? 'animate-spin' : ''" />
        {{ saving ? "Salvando..." : isEdit ? "Salvar" : "Cadastrar servidor" }}
      </button>
    </template>
  </Modal>
</template>
