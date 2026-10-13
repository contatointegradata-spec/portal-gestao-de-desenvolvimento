<script setup>
import { computed, reactive, ref } from "vue";
import { http } from "../../lib/api.js";
import { toast } from "../../lib/feedback.js";
import { inheritedAuth } from "../../stores/apiWorkspace.js";
import Modal from "../ui/Modal.vue";
import AuthEditor from "./AuthEditor.vue";

const props = defineProps({ folder: { type: Object, required: true } });
const emit = defineEmits(["close", "saved"]);

const saving = ref(false);
const form = reactive({
  name: props.folder.name,
  description: props.folder.description || "",
  authType: props.folder.authType || "inherit",
  authConfig: { ...(props.folder.authConfig || {}) }
});
const inherited = computed(() => inheritedAuth(props.folder.parentId));

async function save() {
  if (!form.name.trim()) {
    toast.error("Informe o nome da pasta.");
    return;
  }
  saving.value = true;
  try {
    await http.patch(`/api/apis/folders/${props.folder.id}`, { ...form, name: form.name.trim() });
    toast("Pasta atualizada.");
    emit("saved");
  } catch (err) {
    toast.error(err.message);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="Configuracoes da pasta" :subtitle="folder.name" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <div class="grid gap-4 md:grid-cols-2">
        <div>
          <label class="label">Nome</label>
          <input v-model="form.name" class="input" />
        </div>
        <div>
          <label class="label">Descricao</label>
          <input v-model="form.description" class="input" placeholder="Opcional" />
        </div>
      </div>
      <div class="border-t border-slate-100 pt-4">
        <p class="mb-3 text-sm font-semibold text-slate-800">Autenticacao da pasta</p>
        <p class="mb-4 text-xs text-slate-500">Todas as requisicoes e subpastas com "Herdar" usam esta autenticacao — ideal para agrupar endpoints que usam o mesmo token.</p>
        <AuthEditor v-model:type="form.authType" v-model:config="form.authConfig" :inherited="inherited" />
      </div>
    </div>
    <template #footer>
      <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="save">{{ saving ? "Salvando..." : "Salvar" }}</button>
    </template>
  </Modal>
</template>
