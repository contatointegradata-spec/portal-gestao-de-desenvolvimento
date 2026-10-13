<script setup>
import { computed, ref } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, toast } from "../../lib/feedback.js";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";

const props = defineProps({
  runner: { type: Object, required: true },
  token: { type: String, default: "" }
});
const emit = defineEmits(["close", "token"]);

const currentToken = ref(props.token);
const serverUrl = ref(window.location.origin);
const regenerating = ref(false);

const tokenText = computed(() => currentToken.value || "COLE_O_TOKEN_AQUI");
const installScript = computed(() => [
  "New-Item -ItemType Directory -Force C:\\GestaoRPA | Out-Null",
  "Set-Location C:\\GestaoRPA",
  `Invoke-WebRequest -Uri "${serverUrl.value}/api/agent/download" -OutFile gestao-rpa-agent.cjs`,
  `node gestao-rpa-agent.cjs install --server ${serverUrl.value} --token ${tokenText.value}`
].join("\n"));
const pythonDeps = "pip install playwright pandas openpyxl pillow mss\npython -m playwright install chromium";
const nodeDeps = "cd C:\\GestaoRPA\nnpm install playwright\nnpx playwright install chromium";

function copy(text, label) {
  navigator.clipboard?.writeText(text).then(() => toast.info(`${label} copiado.`)).catch(() => toast.error("Nao foi possivel copiar."));
}

async function regenerate() {
  const ok = await confirmDialog({
    title: "Gerar novo token?",
    message: "O token atual deixa de funcionar imediatamente: o agente ja instalado fica offline ate ser reinstalado com o novo token.",
    confirmText: "Gerar novo token",
    danger: true
  });
  if (!ok) return;
  regenerating.value = true;
  try {
    const result = await http.post(`/api/runners/${props.runner.id}/token`);
    currentToken.value = result.token;
    emit("token", result);
    toast("Novo token gerado.");
  } catch (err) {
    toast.error(err.message);
  } finally {
    regenerating.value = false;
  }
}
</script>

<template>
  <Modal title="Instalar o agente" :subtitle="`${runner.nome} · ${runner.hostname}`" size="lg" @close="emit('close')">
    <div class="space-y-6 text-sm text-slate-700">
      <div class="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-900">
        <Icon name="info" :size="18" class="mt-0.5 shrink-0" />
        <p>
          Faca tudo <strong>dentro do servidor</strong>, conectado por RDP com o usuario
          <code class="rounded bg-white/70 px-1 font-mono">{{ runner.username || "do robo" }}</code>.
          O agente sobe junto com o logon desse usuario e abre o navegador do robo na area de trabalho, que voce acompanha pelo mRemoteNG.
        </p>
      </div>

      <!-- Token -->
      <section>
        <h3 class="font-semibold text-slate-900">Token do servidor</h3>
        <div v-if="currentToken" class="mt-2 space-y-2">
          <div class="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <code class="min-w-0 flex-1 break-all font-mono text-xs text-amber-900">{{ currentToken }}</code>
            <button type="button" class="btn-secondary btn-sm" @click="copy(currentToken, 'Token')"><Icon name="copy" :size="14" />Copiar</button>
          </div>
          <p class="flex items-center gap-1.5 text-xs text-amber-700"><Icon name="alert-triangle" :size="13" />Guarde agora: por seguranca o token nao sera exibido novamente.</p>
        </div>
        <div v-else class="mt-2 flex flex-wrap items-center gap-3">
          <p class="text-slate-500">O token so aparece ao cadastrar o servidor. Para reinstalar o agente, gere um novo.</p>
          <button type="button" class="btn-soft btn-sm" :disabled="regenerating" @click="regenerate">
            <Icon :name="regenerating ? 'loader' : 'key'" :size="14" :class="regenerating ? 'animate-spin' : ''" />Gerar novo token
          </button>
        </div>
      </section>

      <!-- Pre-requisitos -->
      <section>
        <h3 class="font-semibold text-slate-900">1. Pre-requisitos (uma vez por servidor)</h3>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-600">
          <li><strong>Node.js 18 ou superior</strong> (LTS em nodejs.org) — roda o agente.</li>
          <li><strong>Python 3</strong> com Playwright (robos em Python) e Pillow/mss (tela ao vivo do servidor), no PowerShell:</li>
        </ul>
        <div class="relative mt-2">
          <pre class="overflow-x-auto rounded-xl bg-[#0d1117] p-4 pr-24 font-mono text-xs leading-5 text-slate-200">{{ pythonDeps }}</pre>
          <button type="button" class="btn-secondary btn-sm absolute right-2 top-2" @click="copy(pythonDeps, 'Comandos')"><Icon name="copy" :size="13" />Copiar</button>
        </div>
        <p class="mt-3 text-slate-600">Para robos em JavaScript (depois do passo 2):</p>
        <div class="relative mt-2">
          <pre class="overflow-x-auto rounded-xl bg-[#0d1117] p-4 pr-24 font-mono text-xs leading-5 text-slate-200">{{ nodeDeps }}</pre>
          <button type="button" class="btn-secondary btn-sm absolute right-2 top-2" @click="copy(nodeDeps, 'Comandos')"><Icon name="copy" :size="13" />Copiar</button>
        </div>
      </section>

      <!-- Instalacao -->
      <section>
        <h3 class="font-semibold text-slate-900">2. Instalar o agente (PowerShell, no servidor)</h3>
        <div class="mt-2 max-w-md">
          <label class="label">Endereco da plataforma visto pelo servidor</label>
          <input v-model="serverUrl" class="input font-mono text-xs" />
          <p class="hint">O servidor precisa alcancar este endereco (so conexao de saida, nenhuma porta aberta nele).</p>
        </div>
        <div class="relative mt-3">
          <pre class="overflow-x-auto rounded-xl bg-[#0d1117] p-4 pr-24 font-mono text-xs leading-5 text-slate-200">{{ installScript }}</pre>
          <button type="button" class="btn-secondary btn-sm absolute right-2 top-2" @click="copy(installScript, 'Script')"><Icon name="copy" :size="13" />Copiar</button>
        </div>
        <p class="mt-2 text-slate-600">
          O comando testa a conexao, configura o inicio automatico no logon do usuario e abre o agente numa janela minimizada
          (<em>Gestao RPA - Agente</em>). Em poucos segundos o servidor aparece como <span class="font-semibold text-emerald-700">Online</span> nesta tela.
        </p>
      </section>

      <!-- Cuidados -->
      <section class="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="flex items-center gap-2 font-semibold text-slate-900"><Icon name="shield" :size="15" />Para o agente continuar online</h3>
        <ul class="mt-2 list-disc space-y-1 pl-5 text-slate-600">
          <li>Para sair do servidor, use o script de desconexao com <code class="rounded bg-white px-1 font-mono text-xs">tscon ... /dest:console</code>: a area de trabalho continua ativa e a <strong>tela ao vivo</strong> segue funcionando. So fechar a aba do mRemoteNG desconecta a sessao: o robo roda, mas a tela fica indisponivel.</li>
          <li><strong>Nao use "Sair"/"Sign out"</strong>: isso encerra a sessao e o agente.</li>
          <li>Se o servidor reiniciar, faca logon de novo com o usuario do robo (ou configure logon automatico) para o agente subir.</li>
          <li>Logs do agente: <code class="rounded bg-white px-1 font-mono text-xs">C:\GestaoRPA\agent.log</code> · teste rapido: <code class="rounded bg-white px-1 font-mono text-xs">node gestao-rpa-agent.cjs test</code></li>
          <li>Para remover: <code class="rounded bg-white px-1 font-mono text-xs">node gestao-rpa-agent.cjs uninstall</code> e feche a janela do agente.</li>
        </ul>
      </section>
    </div>

    <template #footer>
      <button type="button" class="btn-primary" @click="emit('close')">Concluir</button>
    </template>
  </Modal>
</template>
