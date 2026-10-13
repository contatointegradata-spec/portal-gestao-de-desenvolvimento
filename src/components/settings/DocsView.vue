<script setup>
import { onMounted, ref } from "vue";
import { http } from "../../lib/api.js";
import { isManager } from "../../stores/session.js";
import Icon from "../ui/Icon.vue";

const runtime = ref(null);
const runtimeError = ref("");

const SECTIONS = [
  { id: "visao-geral", label: "Visao geral" },
  { id: "perfis", label: "Perfis e permissoes" },
  { id: "sistemas", label: "Gestao de desenvolvimento" },
  { id: "rpa", label: "Automacoes RPA" },
  { id: "rpa-helper", label: "Helper rpa (referencia)" },
  { id: "rpa-agenda", label: "Agendamento e execucao" },
  { id: "rpa-problemas", label: "Solucao de problemas" },
  { id: "apis", label: "API / Plugins" },
  { id: "apis-variaveis", label: "Ambientes e variaveis" },
  { id: "apis-auth", label: "Autenticacao e credenciais" },
  { id: "seguranca", label: "Seguranca" },
  { id: "atalhos", label: "Atalhos de teclado" },
  ...(isManager.value ? [{ id: "ambiente", label: "Ambiente de execucao" }] : []),
  { id: "versao", label: "Notas da versao 2.0" }
];

const PY_EXAMPLE = `from playwright.sync_api import sync_playwright
import pandas as pd

def main():
    df = pd.read_excel(rpa.input_file)          # 1o arquivo de entrada
    rpa.log(f"{len(df)} registros carregados")

    with sync_playwright() as p:
        browser = p.chromium.launch()           # modo visivel/headless vem da configuracao
        page = browser.new_page()
        page.goto("https://rpachallenge.com/")  # captura de tela automatica
        page.click("button:has-text('Start')")
        for i, linha in enumerate(df.to_dict("records"), start=1):
            page.fill("input[ng-reflect-name=labelFirstName]", str(linha["First Name"]))
            # ...
            rpa.progress(i, len(df), f"Registro {i}/{len(df)}")
        rpa.screenshot(page, "Resultado final")
        browser.close()

    rpa.save_output("relatorio.csv", df.to_csv(index=False))
    rpa.success("Concluido")

if __name__ == "__main__":
    main()`;

const JS_EXAMPLE = `const { chromium } = require("playwright");
const XLSX = require("xlsx");

module.exports = async function main(rpa) {
  const wb = XLSX.readFile(rpa.inputFile);
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  rpa.log(\`\${linhas.length} registros\`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("https://example.com");
  await rpa.screenshot(page, "Pagina inicial");
  await browser.close();

  rpa.saveOutput("resultado.json", JSON.stringify(linhas));
  rpa.success("Concluido");
};`;

onMounted(async () => {
  if (!isManager.value) return;
  try {
    runtime.value = await http.get("/api/system/runtime");
  } catch (err) {
    runtimeError.value = err.message;
  }
});

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
    <p class="section-title">Configuracoes</p>
    <h1 class="page-title mt-1">Documentacao da plataforma</h1>
    <p class="mt-1 text-sm text-slate-500">Versao 2.0 · Gestao de desenvolvimento, automacoes RPA e cliente de APIs.</p>

    <div class="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav class="hidden lg:block">
        <div class="sticky top-6 space-y-0.5 border-l border-slate-200">
          <button v-for="section in SECTIONS" :key="section.id" type="button" class="-ml-px block w-full border-l-2 border-transparent py-1.5 pl-4 text-left text-sm text-slate-500 hover:border-brand-400 hover:text-slate-900" @click="scrollTo(section.id)">
            {{ section.label }}
          </button>
        </div>
      </nav>

      <article class="prose-docs space-y-12 text-sm leading-relaxed text-slate-700">
        <section id="visao-geral" class="scroll-mt-6">
          <h2>Visao geral</h2>
          <p>A plataforma reune tres frentes do time de desenvolvimento da Unimed Patos de Minas:</p>
          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <div class="rounded-xl border border-slate-200 p-4"><Icon name="layout-grid" class="text-brand-600" /><p class="mt-2 font-semibold text-slate-900">Gestao de desenvolvimento</p><p class="text-xs text-slate-500">Catalogo das aplicacoes com responsavel, departamento, status, tecnologias e links.</p></div>
            <div class="rounded-xl border border-slate-200 p-4"><Icon name="bot" class="text-brand-600" /><p class="mt-2 font-semibold text-slate-900">Automacoes RPA</p><p class="text-xs text-slate-500">Robos em Python ou JavaScript com execucao ao vivo, arquivos, agendamento e historico.</p></div>
            <div class="rounded-xl border border-slate-200 p-4"><Icon name="plug" class="text-brand-600" /><p class="mt-2 font-semibold text-slate-900">API / Plugins</p><p class="text-xs text-slate-500">Cliente de APIs no estilo Postman/Insomnia com pastas, ambientes e credenciais protegidas.</p></div>
          </div>
          <p class="mt-4">O menu lateral pode ser recolhido pelo botao <Icon name="chevrons-left" :size="14" class="inline" /> ou com <span class="kbd">Ctrl</span>+<span class="kbd">B</span>; a preferencia fica salva no navegador.</p>
        </section>

        <section id="perfis" class="scroll-mt-6">
          <h2>Perfis e permissoes</h2>
          <div class="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-500"><tr><th class="px-3 py-2">Acao</th><th class="px-3 py-2">Super Admin</th><th class="px-3 py-2">Admin</th><th class="px-3 py-2">Usuario</th></tr></thead>
              <tbody class="divide-y divide-slate-100">
                <tr><td class="px-3 py-2">Ver sistemas</td><td class="px-3 py-2">Todos</td><td class="px-3 py-2">Todos</td><td class="px-3 py-2">Somente os que e responsavel</td></tr>
                <tr><td class="px-3 py-2">Criar, editar, duplicar e excluir sistemas/RPAs</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Nao</td></tr>
                <tr><td class="px-3 py-2">Executar e cancelar RPA</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Os que e responsavel</td></tr>
                <tr><td class="px-3 py-2">Colecoes de API: consultar e enviar</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Sim (segredos ocultos)</td></tr>
                <tr><td class="px-3 py-2">Colecoes de API: criar, editar, importar, revelar segredos</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Nao</td></tr>
                <tr><td class="px-3 py-2">Criar, ativar/desativar e excluir usuarios, alterar perfis</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Nao</td><td class="px-3 py-2">Nao</td></tr>
                <tr><td class="px-3 py-2">Alterar email e senha de usuarios</td><td class="px-3 py-2">Sim</td><td class="px-3 py-2">Somente perfil Usuario</td><td class="px-3 py-2">Somente a propria senha</td></tr>
              </tbody>
            </table>
          </div>
          <p class="mt-3"><strong>Usuario master:</strong> e sempre Super Admin e ativo; nao pode ser desativado, removido ou ter o perfil alterado, e somente ele altera o proprio email e senha. A senha do master nunca e redefinida automaticamente pelo servidor.</p>
        </section>

        <section id="sistemas" class="scroll-mt-6">
          <h2>Gestao de desenvolvimento</h2>
          <ul>
            <li><strong>Sistema</strong>: aplicacao catalogada — nome, descricao, URL de acesso e ao menos uma tecnologia sao obrigatorios.</li>
            <li><strong>Automacao RPA</strong>: robo executado pela plataforma — codigo Python ou JavaScript obrigatorio; URL e tecnologias sao opcionais.</li>
            <li>Todo sistema tem um <strong>responsavel</strong> (usuario ativo). Usuarios comuns enxergam apenas os sistemas pelos quais sao responsaveis.</li>
            <li>Status: <em>Ativo</em>, <em>Em desenvolvimento</em>, <em>Manutencao</em> e <em>Arquivado</em>. RPAs arquivados nao executam (nem manual nem agendado).</li>
            <li>Filtros por tipo, status e departamento, busca por texto e visualizacao em cartoes ou lista. O link do menu "Automacoes RPA" ja abre filtrado.</li>
            <li>"Duplicar" copia o sistema, o codigo e os arquivos; a copia nasce <em>Em desenvolvimento</em> e com agendamento manual.</li>
            <li>Converter um RPA em sistema comum remove codigo, arquivos e agendamento (o historico e mantido).</li>
          </ul>
        </section>

        <section id="rpa" class="scroll-mt-6">
          <h2>Automacoes RPA</h2>
          <p>Cada execucao roda em uma <strong>pasta temporaria isolada</strong>, removida ao final. O fluxo e:</p>
          <ol>
            <li>Os <strong>arquivos de entrada</strong> sao copiados para a pasta. O primeiro da lista e o <em>principal</em> e chega ao script em <code>rpa.input_file</code> / <code>sys.argv[1]</code> (Python) ou <code>rpa.inputFile</code> / <code>process.argv[2]</code> (JavaScript).</li>
            <li>O script roda dentro de um <em>wrapper</em> que instrumenta o Playwright: cada <code>goto</code> e <code>click</code> gera log e captura de tela exibidos ao vivo.</li>
            <li><code>print()</code> / <code>console.log()</code> viram logs estruturados; mensagens com "erro" ficam em vermelho, "sucesso" em verde.</li>
            <li>Arquivos gravados com <code>rpa.save_output()</code> / <code>rpa.saveOutput()</code> (pasta <code>RPA_OUTPUT_DIR</code>) ficam disponiveis para download no historico (ate 20 arquivos / 50 MB por execucao).</li>
            <li>O resultado depende do <strong>codigo de saida</strong>: 0 = sucesso; qualquer outro valor ou excecao nao tratada = falha. Use <code>raise SystemExit(1)</code> / <code>throw</code> para sinalizar erro.</li>
          </ol>
          <p>Arquivos de entrada: ate 20 por RPA e 25 MB cada. Enviar um arquivo com o mesmo nome substitui o anterior.</p>
          <div class="mt-4 grid gap-4 xl:grid-cols-2">
            <div><p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Exemplo Python</p><pre>{{ PY_EXAMPLE }}</pre></div>
            <div><p class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Exemplo JavaScript</p><pre>{{ JS_EXAMPLE }}</pre></div>
          </div>
          <p class="mt-3">No editor, use o botao <strong>Modelos</strong> para comecar e <strong>Validar sintaxe</strong> para checar o rascunho antes de salvar — a validacao aponta a linha do erro e avisa sobre bibliotecas nao instaladas no servidor.</p>
        </section>

        <section id="rpa-helper" class="scroll-mt-6">
          <h2>Helper <code>rpa</code> (disponivel automaticamente)</h2>
          <div class="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-500"><tr><th class="px-3 py-2">Python</th><th class="px-3 py-2">JavaScript</th><th class="px-3 py-2">Descricao</th></tr></thead>
              <tbody class="divide-y divide-slate-100 font-mono">
                <tr><td class="px-3 py-2">rpa.log(msg)</td><td class="px-3 py-2">rpa.log(msg)</td><td class="px-3 py-2 font-sans">Log informativo (tambem: success, warn, error, action)</td></tr>
                <tr><td class="px-3 py-2">rpa.progress(atual, total, msg)</td><td class="px-3 py-2">rpa.progress(atual, total, msg)</td><td class="px-3 py-2 font-sans">Atualiza a barra de progresso</td></tr>
                <tr><td class="px-3 py-2">rpa.screenshot(page, legenda)</td><td class="px-3 py-2">await rpa.screenshot(page, legenda)</td><td class="px-3 py-2 font-sans">Captura de tela manual</td></tr>
                <tr><td class="px-3 py-2">rpa.save_output(nome, conteudo)</td><td class="px-3 py-2">rpa.saveOutput(nome, conteudo)</td><td class="px-3 py-2 font-sans">Gera arquivo de saida para download</td></tr>
                <tr><td class="px-3 py-2">rpa.input_file / rpa.files</td><td class="px-3 py-2">rpa.inputFile / rpa.files</td><td class="px-3 py-2 font-sans">Arquivo principal / todos os arquivos de entrada</td></tr>
                <tr><td class="px-3 py-2">rpa.output_dir / rpa.work_dir</td><td class="px-3 py-2">rpa.outputDir / rpa.workDir</td><td class="px-3 py-2 font-sans">Pastas de saida e de trabalho</td></tr>
              </tbody>
            </table>
          </div>
          <p class="mt-3">Em JavaScript, o script pode exportar uma funcao (<code>module.exports = async (rpa) =&gt; {...}</code>) ou executar direto. Use <code>require()</code>: com ES Modules (<code>import</code>) o codigo roda, mas sem capturas automaticas. Valores digitados em campos cujo seletor contem "senha", "password", "token" ou "cpf" sao mascarados nos logs.</p>
        </section>

        <section id="rpa-agenda" class="scroll-mt-6">
          <h2>Agendamento e execucao</h2>
          <ul>
            <li><strong>Manual</strong>: executa somente pelo botao Executar.</li>
            <li><strong>Recorrente</strong>: um ou mais horarios, em dias da semana escolhidos (atalhos "Dias uteis" e "Todos").</li>
            <li><strong>Datas especificas</strong>: execucoes unicas em data e hora definidas.</li>
            <li>Horarios no fuso <code>America/Sao_Paulo</code>. O agendador verifica a cada 30 segundos e tolera ate 2 minutos de atraso (ex.: reinicio do servidor).</li>
            <li>Cada horario executa uma unica vez. Se o RPA ainda estiver rodando, o horario e ignorado e os administradores sao notificados.</li>
            <li>Apenas uma execucao por RPA ao mesmo tempo; o servidor limita as execucoes simultaneas totais (padrao 3).</li>
            <li><strong>Tempo limite</strong> configuravel por RPA (padrao 10 min, ate 24h, ou "Sem limite de tempo" para RPAs longos). Ao estourar, o processo e o navegador sao encerrados e a execucao fica como "Tempo esgotado".</li>
            <li>Fechar a janela de acompanhamento nao interrompe o robo ("Continuar em segundo plano"). Um aviso chega nas notificacoes ao terminar, para os administradores e o responsavel.</li>
            <li><strong>Cancelar</strong> encerra imediatamente o processo e todos os processos filhos (inclusive o navegador).</li>
            <li>Execucoes em andamento durante um reinicio do servidor ficam registradas como "Interrompida".</li>
            <li>Navegador: <em>Automatico</em> (visivel no Windows; no Docker, visivel via Xvfb), <em>Oculto</em> (headless) ou <em>Sempre visivel</em>.</li>
          </ul>
        </section>

        <section id="rpa-problemas" class="scroll-mt-6">
          <h2>Solucao de problemas</h2>
          <ul>
            <li><strong>"Python 3 nao foi encontrado"</strong>: instale o Python 3 no servidor ou defina <code>PYTHON_BIN</code> no <code>.env</code> (no Windows o comando padrao e <code>python</code>).</li>
            <li><strong>ModuleNotFoundError</strong>: a biblioteca nao esta instalada no servidor — solicite <code>pip install</code> ao administrador. A validacao de sintaxe ja avisa sobre modulos ausentes.</li>
            <li><strong>Tempo esgotado</strong>: aumente o tempo limite do RPA (ou marque "Sem limite de tempo" em Editar › Execucao) ou reduza esperas fixas (<code>wait_for_timeout</code>).</li>
            <li><strong>Erro de certificado no navegador</strong>: os contextos criados pelo wrapper ja ignoram certificados invalidos.</li>
            <li><strong>Arquivo nao encontrado</strong>: confira a aba Arquivos do RPA; o primeiro arquivo e o principal.</li>
          </ul>
        </section>

        <section id="apis" class="scroll-mt-6">
          <h2>API / Plugins</h2>
          <ul>
            <li><strong>Colecoes</strong> agrupam as requisicoes de um sistema ou fornecedor e sao classificadas como <em>internas</em> ou <em>externas</em>.</li>
            <li><strong>Pastas</strong> podem ser aninhadas. Arraste requisicoes e pastas na arvore para mover ou reordenar.</li>
            <li><strong>Requisicoes</strong>: metodos GET, POST, PUT, PATCH, DELETE, HEAD e OPTIONS; params, headers, corpo (JSON, texto, XML, form-urlencoded, multipart), autenticacao, tempo limite, redirecionamentos e opcao de ignorar SSL.</li>
            <li>As requisicoes sao <strong>executadas pelo servidor</strong> da plataforma — APIs da rede interna funcionam e nao ha problemas de CORS.</li>
            <li>Alteracoes ficam em rascunho (ponto amarelo na arvore) ate <strong>Salvar</strong>. E possivel enviar o rascunho para testar antes de salvar.</li>
            <li><strong>Pos-resposta</strong>: extrai valores da resposta (corpo JSON, header ou status) para variaveis do ambiente — ex.: salvar o <code>access_token</code> do login em <code v-text="'{{token}}'" />.</li>
            <li><strong>Historico</strong>: os ultimos 100 envios de cada requisicao, com status, tempo, headers e corpo (headers sensiveis mascarados).</li>
            <li><strong>Importar</strong>: Postman Collection v2.1, Insomnia v4 (JSON) ou comando cURL. <strong>Exportar</strong>: Postman v2.1, sem segredos. "Copiar como cURL" gera o comando da requisicao atual.</li>
          </ul>
        </section>

        <section id="apis-variaveis" class="scroll-mt-6">
          <h2>Ambientes e variaveis</h2>
          <ul>
            <li>Cada colecao pode ter varios ambientes (Producao, Homologacao...). Use as variaveis em qualquer campo com <code v-text="'{{nome}}'" />.</li>
            <li>O ambiente em uso e escolhido por usuario (fica salvo no navegador). O "ambiente padrao" e o inicial para todos.</li>
            <li>A barra abaixo da URL mostra as variaveis usadas: verde = definida, vermelho = ausente no ambiente selecionado.</li>
            <li>Variaveis dinamicas: <code v-text="'{{$timestamp}}'" />, <code v-text="'{{$timestampMs}}'" />, <code v-text="'{{$isoTimestamp}}'" />, <code v-text="'{{$randomUUID}}'" />, <code v-text="'{{$randomInt}}'" />, <code v-text="'{{$date}}'" />.</li>
            <li>Variaveis com cadeado sao <strong>segredos</strong>: criptografadas e nunca enviadas ao navegador de usuarios comuns.</li>
          </ul>
        </section>

        <section id="apis-auth" class="scroll-mt-6">
          <h2>Autenticacao e credenciais</h2>
          <ul>
            <li>Tipos: Bearer Token, Basic Auth, API Key (header ou query) e OAuth 2.0 (Client Credentials ou Password).</li>
            <li><strong>Heranca</strong>: requisicao com "Herdar" usa a autenticacao da pasta mais proxima que definir uma; se nenhuma definir, usa a da colecao.</li>
            <li>OAuth 2.0: o token e obtido pelo servidor e reutilizado ate expirar. "Renovar token" forca um novo.</li>
            <li>Senhas, tokens, client secrets e valores de API Key sao criptografados (AES-256-GCM) e exibidos como "salvo — digite para substituir". Admins podem revelar os segredos de ambientes quando necessario.</li>
            <li>Evite senhas fixas no corpo da requisicao: prefira <code v-text="'{{senha}}'" /> com a variavel marcada como segredo.</li>
          </ul>
        </section>

        <section id="seguranca" class="scroll-mt-6">
          <h2>Seguranca</h2>
          <ul>
            <li>Senhas com no minimo 8 caracteres, letras e numeros. Alterar a propria senha encerra as outras sessoes.</li>
            <li>Login bloqueado temporariamente apos 8 tentativas invalidas em 15 minutos.</li>
            <li>Recuperacao por codigo de 6 digitos enviado por email, valido por 10 minutos e invalidado apos 5 tentativas erradas.</li>
            <li>Sessoes valem 7 dias. Usuarios desativados perdem o acesso imediatamente.</li>
            <li>Credenciais do servidor (email, chave de criptografia, master) ficam no <code>.env</code> e nao sao repassadas aos scripts RPA.</li>
            <li>A chave de criptografia fica em <code>APP_SECRET_KEY</code> ou em <code>data/.gestao-secret.key</code> — faca backup junto com o banco.</li>
          </ul>
        </section>

        <section id="atalhos" class="scroll-mt-6">
          <h2>Atalhos de teclado</h2>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <p><span class="kbd">Ctrl</span>+<span class="kbd">B</span> Recolher/expandir o menu</p>
            <p><span class="kbd">Esc</span> Fechar janela ou painel</p>
            <p><span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> Enviar requisicao</p>
            <p><span class="kbd">Ctrl</span>+<span class="kbd">S</span> Salvar requisicao / sistema no editor</p>
            <p><span class="kbd">Tab</span> Indentar no editor de codigo</p>
          </div>
        </section>

        <section v-if="isManager" id="ambiente" class="scroll-mt-6">
          <h2>Ambiente de execucao</h2>
          <p v-if="runtimeError" class="text-rose-700">{{ runtimeError }}</p>
          <p v-else-if="!runtime" class="text-slate-400">Verificando interpretadores...</p>
          <div v-else class="mt-3 grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-slate-200 p-4">
              <p class="font-semibold text-slate-900">Python</p>
              <p class="mt-1 text-xs" :class="runtime.python ? 'text-emerald-700' : 'text-rose-700'">{{ runtime.python ? `${runtime.python.version} (${runtime.python.command})` : "Nao encontrado — defina PYTHON_BIN" }}</p>
              <p v-for="(ok, name) in runtime.pythonModules" :key="name" class="mt-1 flex items-center gap-1.5 text-xs" :class="ok ? 'text-slate-600' : 'text-rose-600'"><Icon :name="ok ? 'check' : 'x'" :size="12" />{{ name }}</p>
            </div>
            <div class="rounded-xl border border-slate-200 p-4">
              <p class="font-semibold text-slate-900">Node.js</p>
              <p class="mt-1 text-xs text-emerald-700">{{ runtime.node }} · {{ runtime.platform }}</p>
              <p v-for="(ok, name) in runtime.nodeModules" :key="name" class="mt-1 flex items-center gap-1.5 text-xs" :class="ok ? 'text-slate-600' : 'text-rose-600'"><Icon :name="ok ? 'check' : 'x'" :size="12" />{{ name }}</p>
              <p class="mt-3 text-xs text-slate-500">Fuso: {{ runtime.timezone }} · ate {{ runtime.maxConcurrentRuns }} execucoes simultaneas · email {{ runtime.mailConfigured ? "configurado" : "NAO configurado" }}</p>
            </div>
          </div>
        </section>

        <section id="versao" class="scroll-mt-6">
          <h2>Notas da versao 2.0</h2>
          <ul>
            <li>Novo menu lateral recolhivel com Gestao de desenvolvimento, API/Plugins, perfil, configuracoes, notificacoes e saida.</li>
            <li>Modulo de chamados removido da plataforma.</li>
            <li>Motor RPA reescrito: fila por RPA, cancelamento, tempo limite configuravel, logs com numeros de linha corretos, arquivos de saida, suporte a Windows e UTF-8.</li>
            <li>Arquivos de entrada enviados em binario (sem base64), com progresso, substituicao por nome e download — inclusive na criacao do RPA.</li>
            <li>Agendamento recorrente por dias da semana e datas especificas, no fuso de Brasilia, sem execucoes duplicadas.</li>
            <li>Novo modulo API/Plugins: pastas aninhadas, ambientes, variaveis, heranca de autenticacao, OAuth 2.0 com cache, extracao pos-resposta, historico, importacao/exportacao.</li>
            <li>Credenciais criptografadas, politica de senha, bloqueio por tentativas, usuario master protegido e senhas fora do codigo-fonte.</li>
          </ul>
        </section>
      </article>
    </div>
  </div>
</template>

<style scoped>
.prose-docs :deep(h2) { @apply mb-3 font-brand text-xl font-bold text-slate-900; }
.prose-docs :deep(ul) { @apply mt-2 list-disc space-y-1.5 pl-5; }
.prose-docs :deep(ol) { @apply mt-2 list-decimal space-y-1.5 pl-5; }
.prose-docs :deep(code) { @apply rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-800; }
.prose-docs :deep(pre) { @apply overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-[12px] leading-relaxed text-slate-100; }
</style>
