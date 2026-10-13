<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { http, uploadFile } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import { PROJECT_CATEGORIES, PROJECT_STATUS } from "../../lib/format.js";
import { resizeImage } from "../../lib/image.js";
import { session } from "../../stores/session.js";
import CodeEditor from "../ui/CodeEditor.vue";
import Dropdown from "../ui/Dropdown.vue";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import TagInput from "../ui/TagInput.vue";
import FilesManager from "./FilesManager.vue";
import ScheduleEditor from "./ScheduleEditor.vue";
import { RPA_TEMPLATES } from "./rpaTemplates.js";

const props = defineProps({ project: { type: Object, default: null } });
const emit = defineEmits(["close", "saved"]);

const isEdit = computed(() => Boolean(props.project?.id));
const tab = ref("geral");
const saving = ref(false);
const errorMessage = ref("");
const validation = ref(null);
const validating = ref(false);
const editor = ref(null);
const files = ref(props.project?.files || []);
const pendingFiles = ref([]);

function initialForm(project) {
  return {
    nome: project?.nome || "",
    descricao: project?.descricao || "",
    url: project?.url || "",
    repositorio: project?.repositorio || "",
    status: project?.status || "ativo",
    categoria: project?.categoria || "interno",
    tecnologias: [...(project?.tecnologias || [])],
    screenshot: project?.screenshot || "",
    observacoes: project?.observacoes || "",
    systemType: project?.systemType || "common",
    responsibleUserId: project?.responsibleUserId || session.user.id,
    department: project?.department || session.user.departamento || "",
    language: project?.language || "python",
    code: project?.code || "",
    schedule: project?.schedule ? JSON.parse(JSON.stringify(project.schedule)) : { version: 2, mode: "manual", times: [], weekdays: [0, 1, 2, 3, 4, 5, 6], dates: [] },
    // timeoutSeconds = 0 no servidor significa "sem limite de tempo".
    noTimeout: project?.timeoutSeconds === 0,
    timeoutMinutes: Math.round((project?.timeoutSeconds || 600) / 60 * 10) / 10,
    browserMode: project?.browserMode || "auto",
    runnerId: project?.runnerId || ""
  };
}

const form = reactive(initialForm(props.project));
const snapshot = JSON.stringify(form);
const isRpa = computed(() => form.systemType === "rpa");
const dirty = computed(() => JSON.stringify(form) !== snapshot || pendingFiles.value.length > 0);

const responsibleOptions = computed(() => session.users.filter((user) => user.active || user.id === form.responsibleUserId).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
const departmentNames = computed(() => session.departments.map((item) => item.nome));
const MAX_TIMEOUT_MINUTES = 1440;
const timeoutPresets = [10, 30, 60, 120, 240, 480];

// Servidores de execucao (Configuracoes › Servidores RPA). "" = servidor da plataforma.
const runners = ref([]);
const selectedRunner = computed(() => runners.value.find((runner) => runner.id === form.runnerId) || null);
onMounted(async () => {
  try {
    runners.value = await http.get("/api/runners");
  } catch {
    runners.value = [];
  }
});
const technologySuggestions = ["Vue", "React", "Angular", "Node.js", "Python", "Django", "FastAPI", "Flutter", "Dart", "Java", ".NET", "PHP", "Docker", "PostgreSQL", "Oracle", "SQL Server", "HTML", "TypeScript"];

const tabs = computed(() => [
  { id: "geral", label: "Informacoes gerais", icon: "info" },
  ...(isRpa.value ? [
    { id: "automacao", label: "Automacao", icon: "code" },
    { id: "arquivos", label: `Arquivos (${isEdit.value ? files.value.length : pendingFiles.value.length})`, icon: "file" },
    { id: "execucao", label: "Agendamento", icon: "calendar" }
  ] : [])
]);

watch(() => form.responsibleUserId, (id) => {
  const owner = session.users.find((user) => user.id === id);
  if (owner?.departamento && !form.department) form.department = owner.departamento;
});

watch(() => form.language, () => {
  validation.value = null;
});

async function onScreenshot(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    form.screenshot = await resizeImage(file, { maxWidth: 1280, maxHeight: 800, quality: 0.8 });
  } catch (err) {
    toast.error(err.message);
  }
}

async function applyTemplate(template) {
  if (form.code.trim()) {
    const ok = await confirmDialog({ title: "Substituir o codigo atual?", message: `O editor recebera o modelo "${template.label}".`, confirmText: "Substituir" });
    if (!ok) return;
  }
  form.code = template.code;
  validation.value = null;
}

const templateMenu = computed(() => RPA_TEMPLATES[form.language].map((template) => ({ label: template.label, icon: "sparkles", action: () => applyTemplate(template) })));

async function validateCode() {
  if (!form.code.trim()) {
    validation.value = { ok: false, message: "Escreva o codigo antes de validar." };
    return;
  }
  validating.value = true;
  try {
    validation.value = await http.post("/api/projects/validate-code", { language: form.language, code: form.code });
    if (!validation.value.ok && validation.value.line) editor.value?.goToLine(validation.value.line);
  } catch (err) {
    validation.value = { ok: false, message: err.message };
  } finally {
    validating.value = false;
  }
}

function clientErrors() {
  const errors = [];
  if (!form.nome.trim()) errors.push(["geral", "Informe o nome do sistema."]);
  if (!form.descricao.trim()) errors.push(["geral", "Informe a descricao."]);
  if (!form.responsibleUserId) errors.push(["geral", "Selecione o usuario responsavel."]);
  if (!isRpa.value && !form.url.trim()) errors.push(["geral", "Informe a URL de acesso do sistema."]);
  if (!isRpa.value && !form.tecnologias.length) errors.push(["geral", "Informe ao menos uma tecnologia."]);
  if (isRpa.value && !form.code.trim()) errors.push(["automacao", "Informe o codigo do RPA (use um dos modelos para comecar)."]);
  if (isRpa.value && form.schedule.mode === "daily" && !form.schedule.times.length) errors.push(["execucao", "Informe ao menos um horario de execucao."]);
  if (isRpa.value && form.schedule.mode === "dates" && !form.schedule.dates.length) errors.push(["execucao", "Informe ao menos uma data de execucao."]);
  const timeout = Number(form.timeoutMinutes);
  if (isRpa.value && !form.noTimeout && (!timeout || timeout < 0.2 || timeout > MAX_TIMEOUT_MINUTES)) {
    errors.push(["execucao", `O tempo limite deve ficar entre 0,2 e ${MAX_TIMEOUT_MINUTES} minutos (24h), ou marque "Sem limite de tempo".`]);
  }
  return errors;
}

async function save() {
  errorMessage.value = "";
  const errors = clientErrors();
  if (errors.length) {
    tab.value = errors[0][0];
    errorMessage.value = errors[0][1];
    return;
  }
  if (isEdit.value && props.project.systemType === "rpa" && !isRpa.value) {
    const ok = await confirmDialog({
      title: "Converter RPA em sistema comum?",
      message: "O codigo, os arquivos de entrada e o agendamento do RPA serao removidos. O historico de execucoes sera mantido.",
      confirmText: "Converter",
      danger: true
    });
    if (!ok) return;
  }

  const payload = {
    nome: form.nome.trim(),
    descricao: form.descricao.trim(),
    url: form.url.trim(),
    repositorio: form.repositorio.trim(),
    status: form.status,
    categoria: form.categoria,
    tecnologias: form.tecnologias,
    screenshot: form.screenshot,
    observacoes: form.observacoes.trim(),
    systemType: form.systemType,
    responsibleUserId: form.responsibleUserId,
    department: form.department.trim(),
    ...(isRpa.value ? {
      language: form.language,
      code: form.code,
      schedule: form.schedule,
      timeoutSeconds: form.noTimeout ? 0 : Math.round(Number(form.timeoutMinutes) * 60),
      browserMode: form.browserMode,
      runnerId: form.runnerId || null
    } : {})
  };

  saving.value = true;
  try {
    let saved = isEdit.value
      ? await http.patch(`/api/projects/${props.project.id}`, payload)
      : await http.post("/api/projects", payload);

    if (pendingFiles.value.length) {
      const failures = [];
      for (const file of pendingFiles.value) {
        try {
          await uploadFile(`/api/projects/${saved.id}/files`, file);
        } catch (err) {
          failures.push(`${file.name}: ${err.message}`);
        }
      }
      if (failures.length) toast.error(`Alguns arquivos nao foram enviados:\n${failures.join("\n")}`, 10000);
      saved = await http.get(`/api/projects/${saved.id}`);
    }
    toast(isEdit.value ? "Sistema atualizado." : "Sistema criado.");
    emit("saved", saved);
  } catch (err) {
    errorMessage.value = err.message;
    if (/codigo|linguagem/i.test(err.message)) tab.value = "automacao";
    else if (/horario|data|agend|tempo limite|navegador/i.test(err.message)) tab.value = "execucao";
    else tab.value = "geral";
  } finally {
    saving.value = false;
  }
}

async function requestClose() {
  if (dirty.value && !saving.value) {
    const ok = await confirmDialog({ title: "Descartar alteracoes?", message: "As alteracoes nao salvas serao perdidas.", confirmText: "Descartar", danger: true });
    if (!ok) return;
  }
  emit("close");
}
</script>

<template>
  <Modal size="xl" body-class="p-0" @close="requestClose">
    <template #header>
      <div class="min-w-0">
        <p class="section-title">{{ isEdit ? "Editar sistema" : "Novo sistema" }}</p>
        <h2 class="mt-0.5 truncate text-lg font-semibold text-slate-900">{{ form.nome || (isRpa ? "Nova automacao RPA" : "Novo sistema") }}</h2>
      </div>
    </template>

    <div class="border-b border-slate-100 px-6 pt-4">
      <div class="mb-4 grid gap-2 sm:grid-cols-2">
        <button
          v-for="option in [{ id: 'common', label: 'Sistema', description: 'Aplicacao web/desktop catalogada com link de acesso', icon: 'layout-grid' }, { id: 'rpa', label: 'Automacao RPA', description: 'Robo em Python ou JavaScript executado pela plataforma', icon: 'bot' }]"
          :key="option.id"
          type="button"
          class="flex items-start gap-3 rounded-xl border p-3 text-left transition"
          :class="form.systemType === option.id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'"
          @click="form.systemType = option.id; tab = 'geral'"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" :class="form.systemType === option.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'"><Icon :name="option.icon" :size="18" /></span>
          <span>
            <span class="block text-sm font-semibold text-slate-800">{{ option.label }}</span>
            <span class="block text-xs text-slate-500">{{ option.description }}</span>
          </span>
        </button>
      </div>
      <nav class="-mb-px flex gap-1 overflow-x-auto">
        <button v-for="item in tabs" :key="item.id" type="button" class="tab flex items-center gap-1.5" :class="tab === item.id ? 'tab-active' : ''" @click="tab = item.id">
          <Icon :name="item.icon" :size="14" />{{ item.label }}
        </button>
      </nav>
    </div>

    <div class="p-6">
      <!-- GERAL -->
      <div v-show="tab === 'geral'" class="grid gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <label class="label">Nome *</label>
          <input v-model="form.nome" class="input" maxlength="120" placeholder="Ex.: Portal do Beneficiario" />
        </div>
        <div class="md:col-span-2">
          <label class="label">Descricao *</label>
          <textarea v-model="form.descricao" rows="3" class="input" placeholder="O que o sistema faz e para quem" />
        </div>
        <div>
          <label class="label">URL de acesso {{ isRpa ? "(opcional)" : "*" }}</label>
          <input v-model="form.url" class="input" placeholder="https://sistema.unimedpatosdeminas.com.br" />
        </div>
        <div>
          <label class="label">Repositorio</label>
          <input v-model="form.repositorio" class="input" placeholder="https://github.com/..." />
        </div>
        <div>
          <label class="label">Responsavel *</label>
          <select v-model="form.responsibleUserId" class="input">
            <option v-for="user in responsibleOptions" :key="user.id" :value="user.id">{{ user.nome }} — {{ user.email }}{{ user.active ? "" : " (inativo)" }}</option>
          </select>
          <p class="hint">O responsavel visualiza o sistema{{ isRpa ? " e pode executar o RPA" : "" }}.</p>
        </div>
        <div>
          <label class="label">Departamento</label>
          <input v-model="form.department" list="project-departments" class="input" placeholder="Ex.: Tecnologia" />
          <datalist id="project-departments"><option v-for="name in departmentNames" :key="name" :value="name" /></datalist>
        </div>
        <div>
          <label class="label">Status</label>
          <select v-model="form.status" class="input">
            <option v-for="(status, key) in PROJECT_STATUS" :key="key" :value="key">{{ status.label }}</option>
          </select>
          <p v-if="form.status === 'arquivado' && isRpa" class="hint text-amber-600">RPAs arquivados nao executam agendamentos.</p>
        </div>
        <div>
          <label class="label">Categoria</label>
          <select v-model="form.categoria" class="input">
            <option v-for="(label, key) in PROJECT_CATEGORIES" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <label class="label">Tecnologias {{ isRpa ? "(opcional)" : "*" }}</label>
          <TagInput v-model="form.tecnologias" :suggestions="technologySuggestions" placeholder="Digite e pressione Enter (ex.: Vue, Node.js)" />
        </div>
        <div class="md:col-span-2">
          <label class="label">Imagem de capa</label>
          <div class="flex items-center gap-4">
            <div class="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              <img v-if="form.screenshot" :src="form.screenshot" alt="Capa" class="h-full w-full object-cover" />
              <div v-else class="flex h-full items-center justify-center text-slate-300"><Icon name="image" :size="28" /></div>
            </div>
            <div class="flex flex-wrap gap-2">
              <label class="btn-secondary btn-sm cursor-pointer"><Icon name="upload" :size="14" />{{ form.screenshot ? "Trocar imagem" : "Enviar imagem" }}<input type="file" accept="image/*" class="hidden" @change="onScreenshot" /></label>
              <button v-if="form.screenshot" type="button" class="btn-ghost btn-sm text-rose-600" @click="form.screenshot = ''"><Icon name="trash" :size="14" />Remover</button>
              <p class="hint w-full">A imagem e redimensionada automaticamente.</p>
            </div>
          </div>
        </div>
        <div class="md:col-span-2">
          <label class="label">Observacoes</label>
          <textarea v-model="form.observacoes" rows="2" class="input" placeholder="Informacoes adicionais, contatos, links de documentacao..." />
        </div>
      </div>

      <!-- AUTOMACAO -->
      <div v-if="isRpa" v-show="tab === 'automacao'" class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex rounded-xl border border-slate-200 bg-white p-1">
            <button v-for="option in [{ id: 'python', label: 'Python' }, { id: 'javascript', label: 'JavaScript' }]" :key="option.id" type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium" :class="form.language === option.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'" @click="form.language = option.id">{{ option.label }}</button>
          </div>
          <Dropdown :items="templateMenu" button-class="btn-secondary btn-sm" :width="240" title="Inserir modelo">
            <Icon name="sparkles" :size="14" />Modelos
          </Dropdown>
          <button type="button" class="btn-secondary btn-sm" :disabled="validating" @click="validateCode">
            <Icon :name="validating ? 'loader' : 'check-circle'" :size="14" :class="validating ? 'animate-spin' : ''" />Validar sintaxe
          </button>
          <span class="ml-auto hidden text-xs text-slate-400 sm:block"><span class="kbd">Tab</span> indenta · <span class="kbd">Ctrl</span>+<span class="kbd">S</span> salva</span>
        </div>

        <div v-if="validation" class="flex items-start gap-2 rounded-xl px-3 py-2 text-sm" :class="validation.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'">
          <Icon :name="validation.ok ? 'check-circle' : 'x-circle'" :size="16" class="mt-0.5" />
          <div class="min-w-0">
            <p>{{ validation.message }}<button v-if="validation.line" type="button" class="ml-2 font-semibold underline" @click="editor?.goToLine(validation.line)">ir para a linha {{ validation.line }}</button></p>
            <p v-if="validation.details" class="mt-1 font-mono text-xs">{{ validation.details }}</p>
            <p v-for="warning in validation.warnings || []" :key="warning" class="mt-1 flex items-center gap-1 text-amber-700"><Icon name="alert-triangle" :size="13" />{{ warning }}</p>
          </div>
        </div>

        <CodeEditor
          ref="editor"
          v-model="form.code"
          :language="form.language"
          min-height="420px"
          max-height="60vh"
          :placeholder="form.language === 'python' ? '# Escreva o codigo do robo ou use um modelo' : '// Escreva o codigo do robo ou use um modelo'"
          @save="save"
        />
        <p class="text-xs text-slate-500">
          O helper <code class="rounded bg-slate-100 px-1 font-mono">rpa</code> fica disponivel automaticamente: logs, progresso, capturas de tela e arquivos de saida. Veja exemplos em Configuracoes › Documentacao.
        </p>
      </div>

      <!-- ARQUIVOS -->
      <div v-if="isRpa" v-show="tab === 'arquivos'" class="space-y-3">
        <p class="text-sm text-slate-600">
          Os arquivos sao copiados para a pasta de trabalho a cada execucao. O primeiro arquivo e passado ao script em
          <code class="rounded bg-slate-100 px-1 font-mono text-xs">{{ form.language === "python" ? "rpa.input_file / sys.argv[1]" : "rpa.inputFile / process.argv[2]" }}</code>.
        </p>
        <FilesManager
          :project-id="isEdit ? project.id : ''"
          :files="files"
          :pending="pendingFiles"
          @update:files="files = $event"
          @update:pending="pendingFiles = $event"
        />
      </div>

      <!-- EXECUCAO -->
      <div v-if="isRpa" v-show="tab === 'execucao'" class="space-y-6">
        <ScheduleEditor v-model="form.schedule" />
        <div class="border-t border-slate-100 pt-5">
          <label class="label">Servidor de execucao</label>
          <select v-model="form.runnerId" class="input md:max-w-md">
            <option value="">Servidor da plataforma (Docker)</option>
            <option v-for="runner in runners" :key="runner.id" :value="runner.id" :disabled="!runner.active && runner.id !== form.runnerId">
              {{ runner.nome }} · {{ runner.hostname }} — {{ !runner.active ? "desativado" : runner.online ? "online" : "offline" }}
            </option>
          </select>
          <p v-if="selectedRunner" class="hint flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full" :class="selectedRunner.online ? 'bg-emerald-500' : 'bg-rose-500'" />
            {{ selectedRunner.online ? "Agente conectado." : "Agente offline: a execucao so inicia quando o agente estiver rodando no servidor." }}
            O robo roda na sessao de {{ selectedRunner.username || "usuario do servidor" }}; acompanhe o navegador pelo RDP (mRemoteNG).
          </p>
          <p v-else class="hint">
            Cadastre outros servidores em Configuracoes › Servidores RPA.
          </p>
        </div>
        <div class="grid gap-4 border-t border-slate-100 pt-5 md:grid-cols-2">
          <div>
            <label class="label">Tempo limite por execucao (minutos)</label>
            <input v-model.number="form.timeoutMinutes" type="number" min="0.2" :max="MAX_TIMEOUT_MINUTES" step="1" class="input" :disabled="form.noTimeout" />
            <div v-if="!form.noTimeout" class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="minutes in timeoutPresets"
                :key="minutes"
                type="button"
                class="chip border py-0.5 transition"
                :class="form.timeoutMinutes === minutes ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'"
                @click="form.timeoutMinutes = minutes"
              >
                {{ minutes >= 60 ? `${minutes / 60}h` : `${minutes} min` }}
              </button>
            </div>
            <label class="mt-2 flex items-center gap-2 text-sm text-slate-700">
              <input v-model="form.noTimeout" type="checkbox" class="accent-brand-600" />Sem limite de tempo
            </label>
            <p class="hint">{{ form.noTimeout ? "O robo roda ate terminar. Voce ainda pode cancelar a execucao manualmente." : "Ao atingir o limite, o robo e o navegador sao encerrados (status Tempo esgotado)." }}</p>
          </div>
          <div>
            <label class="label">Navegador durante a execucao</label>
            <select v-model="form.browserMode" class="input">
              <template v-if="selectedRunner">
                <option value="auto">Visivel na area de trabalho do servidor</option>
                <option value="headless">Oculto (headless) — mais rapido</option>
                <option value="visible">Sempre visivel</option>
              </template>
              <template v-else>
                <option value="auto">Automatico (visivel, transmitido ao vivo na plataforma)</option>
                <option value="headless">Oculto (headless) — mais rapido</option>
                <option value="visible">Sempre visivel (transmitido ao vivo)</option>
              </template>
            </select>
            <p v-if="selectedRunner" class="hint">O navegador abre na area de trabalho de {{ selectedRunner.nome }}. Na plataforma voce acompanha logs e capturas de tela.</p>
            <p v-else class="hint">O robo roda no servidor: no modo visivel, o navegador dele e transmitido ao vivo na tela de execucao. No modo oculto, voce acompanha por capturas de tela.</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <p v-if="errorMessage" class="mr-auto flex items-center gap-2 text-sm text-rose-700"><Icon name="alert-circle" :size="16" />{{ errorMessage }}</p>
      <button type="button" class="btn-secondary" @click="requestClose">Cancelar</button>
      <button type="button" class="btn-primary" :disabled="saving" @click="save">
        <Icon :name="saving ? 'loader' : 'save'" :size="16" :class="saving ? 'animate-spin' : ''" />
        {{ saving ? "Salvando..." : isEdit ? "Salvar alteracoes" : "Criar sistema" }}
      </button>
    </template>
  </Modal>
</template>
