# Gestao de Sistemas Unimed — Documentacao tecnica (v2.0)

Plataforma interna com tres modulos:

| Modulo | O que faz |
| --- | --- |
| **Gestao de desenvolvimento** | Catalogo de sistemas e automacoes RPA (Python/JavaScript) com execucao ao vivo, arquivos de entrada/saida, agendamento e historico. |
| **API / Plugins** | Cliente de APIs estilo Postman/Insomnia: colecoes, pastas aninhadas, ambientes, variaveis, heranca de autenticacao, OAuth 2.0, extracao pos-resposta, historico, import/export. |
| **Configuracoes** | Perfil, usuarios/departamentos e documentacao de uso (dentro da plataforma). |

> O modulo de **chamados foi removido** na v2.0 (tabelas e notificacoes sao apagadas pela migracao).
> A documentacao de uso para os usuarios fica em **Configuracoes › Documentacao**.

---

## Como rodar

```bash
npm install
npm run dev          # API (5174) + Vite (5173) — acesse http://localhost:5173
npm run build        # gera dist/ (servido pela API em producao)
npm start            # somente a API, servindo dist/ em http://localhost:5174
npm test             # teste de migracao + teste de fumaca (backend completo)
```

Requisitos: Node 20+, Python 3 com `pandas`, `openpyxl` e `playwright` (para RPAs Python) e navegadores do Playwright instalados.

> **Windows:** se o `node_modules` vier de um container Linux, rode `npm rebuild sqlite3`.

### Docker

`docker compose up -d --build` — a imagem instala Python/Playwright, sobe o Xvfb (navegador visivel virtual) e a API.
O volume `./:/app` monta o codigo; o banco fica em `data/` (`DB_PATH=data/gestao_dev_unimed.sqlite`).
Rode `npm run build` no host antes de subir para atualizar o frontend.

---

## Variaveis de ambiente (`.env`)

Veja `.env.example`. Principais:

| Variavel | Uso |
| --- | --- |
| `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_FROM` | Envio do codigo de recuperacao de senha (Gmail). |
| `DB_PATH` | Caminho do SQLite (padrao `data/gestao_dev_unimed.sqlite`). |
| `APP_SECRET_KEY` | Chave de criptografia das credenciais de API. Sem ela, o servidor gera `data/.gestao-secret.key`. **Faca backup junto com o banco** — sem a chave, os segredos salvos nao podem ser lidos. |
| `MASTER_EMAIL`, `MASTER_NAME`, `MASTER_PASSWORD` | Usuario master. So cria se nao existir; **nunca redefine a senha** de um master existente. Sem `MASTER_PASSWORD`, uma senha temporaria e exibida no log na criacao. |
| `APP_TIMEZONE` | Fuso do agendador (padrao `America/Sao_Paulo`). |
| `PYTHON_BIN` | Executavel do Python (auto: `python`/`py -3` no Windows, `python3` no Linux). |
| `RPA_MAX_CONCURRENT`, `RPA_DEFAULT_TIMEOUT_SECONDS`, `RPA_MAX_TIMEOUT_SECONDS`, `RPA_MAX_FILE_MB`, `RPA_HEADLESS` | Limites do motor RPA. |

As variaveis sensiveis (`MAIL_*`, `APP_SECRET_KEY`, `MASTER_*`, `DB_PATH`) **nao sao repassadas** aos scripts RPA.

---

## Arquitetura

```
server/
  index.js              bootstrap, rotas, estaticos, erros, desligamento
  config.js             leitura do .env
  db.js                 schema-alvo + migracoes versionadas (schema_migrations)
  lib/                  auth (sessoes/papeis), security (hash, AES-256-GCM, rate limit), mailer, notificacoes
  routes/               auth, users, departments, notifications, projects, runs, apis
  rpa/
    runner.js           execucoes: fila por RPA, streaming, cancelamento, timeout, artefatos
    scheduler.js        agendador (30s, fuso configuravel, deduplicacao por horario)
    schedule.js         formato de agenda v2 + calculo da proxima execucao
    interpreters.js     descoberta do Python/Node + diagnostico
    wrappers/           wrapper.py / wrapper.cjs (instrumentam Playwright e logs)
  apis/
    executor.js         motor HTTP (variaveis, auth, OAuth2 com cache, redirects, gzip/br)
    secrets.js          mascaramento/criptografia de credenciais
    transfer.js         import Postman/Insomnia/cURL e export Postman
src/
  App.vue               shell (menu lateral recolhivel + telas)
  lib/                  api (fetch/SSE/upload), router (hash), format, feedback, overlay
  stores/               session, apiWorkspace
  components/           layout, auth, projects, apis, settings, ui
scripts/
  smoke-test.mjs        teste de fumaca ponta a ponta (servidor + servidor HTTP de eco)
  migration-test.mjs    teste de regressao das migracoes a partir de um banco legado
  merge-legacy-data.mjs consolidacao de bancos legados
```

### Motor RPA

1. `POST /api/projects/:id/runs` cria o registro (`running`) e inicia o processo em uma pasta temporaria.
2. Arquivos de entrada (BLOB) sao gravados na pasta; o primeiro e passado como argumento (`sys.argv[1]` / `process.argv[2]`) e em `RPA_INPUT_FILE`.
3. O wrapper carrega o script do usuario como arquivo separado (numeros de linha corretos), instrumenta o Playwright e converte `print`/`console.log` em JSON.
4. `GET /api/runs/:id/stream` (SSE) envia `snapshot`, `log`, `screenshot` e `done`. Fechar a tela nao interrompe a execucao.
5. Ao terminar: status (`success`/`error`/`timeout`/`cancelled`), logs estruturados, ultima captura e artefatos de `RPA_OUTPUT_DIR` sao gravados; administradores e o responsavel sao notificados.
6. Cancelamento/timeout encerram a arvore de processos (`taskkill /T` no Windows, grupo de processos no Linux). Execucoes "running" ao reiniciar viram `interrupted`.

### Banco de dados e migracoes

- Migracoes idempotentes em `server/db.js` (tabela `schema_migrations`), aplicadas na inicializacao.
- Convertem bancos legados: remocao de chamados, `project_files` base64 → BLOB, `projects.rpaFile` → `project_files`, agenda v1 → v2, APIs legadas (`apis`/`api_requests`/`api_request_runs`) → colecoes com segredos criptografados.
- Consolidacao usada na v2.0 (a partir dos bancos antigos da raiz):

```bash
npm run db:merge-legacy -- --base gestao_dev_unimed.backup-pre-tickets-removal-20260923165235 --extra gestao_dev_unimed
```

  O backup de 23/09 foi a base (dados mais recentes); os RPAs de teste do banco de abril foram trazidos com planilhas e historico. Os arquivos originais nao sao alterados.

---

## Regras de negocio (resumo)

- Perfis: **Super Admin** (tudo), **Admin** (gerencia sistemas/APIs; altera email/senha de Usuarios), **Usuario** (ve e executa os RPAs sob sua responsabilidade; usa APIs sem ver segredos).
- Master: sempre Super Admin ativo; nao pode ser desativado/removido/rebaixado; so ele altera o proprio email/senha.
- Senhas: minimo 8 caracteres com letras e numeros; login bloqueado por 15 min apos 8 falhas; codigo de recuperacao valido por 10 min e invalidado apos 5 tentativas.
- Sistema comum exige URL e tecnologias; RPA exige linguagem e codigo. RPA arquivado nao executa.
- Uma execucao por RPA por vez; limite global de execucoes simultaneas; horario agendado ocupado e ignorado e notificado.
- Credenciais de API (senhas, tokens, client secrets, API keys, variaveis secretas) sao criptografadas e nunca voltam ao navegador; so Admin/Super Admin podem revelar.

---

## Operacao e seguranca

- **Backup:** copie `data/gestao_dev_unimed.sqlite` **e** `data/.gestao-secret.key` (ou guarde o `APP_SECRET_KEY`).
- **Senha de app do Gmail:** ela ficou versionada no historico do git (versao anterior de `server/index.js`). Gere uma nova senha de app no Google, revogue a antiga e atualize o `.env`.
- Diagnostico do ambiente RPA (Python, bibliotecas, fuso, email): **Configuracoes › Documentacao › Ambiente de execucao** (Admin/Super Admin) ou `GET /api/system/runtime`.
