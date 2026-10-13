# Gestão de Desenvolvimento - Integradata — Documentacao tecnica (v2.0)

Produto **Integradata**, com tres modulos:

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

`docker compose up -d --build` — a imagem compila o frontend (Vite), instala Python/Playwright, sobe o Xvfb (navegador visivel virtual) e a API.
O banco e a chave de criptografia ficam em `data/` (volume `./data:/app/data`, `DB_PATH=data/gestao_dev.sqlite`).
As portas sao publicadas em `127.0.0.1` por padrao; defina `APP_BIND=0.0.0.0` no `.env` para expor direto na rede.

> Instalacoes antigas: se `data/gestao_dev_unimed.sqlite` existir e `data/gestao_dev.sqlite` nao, o servidor continua usando o arquivo antigo automaticamente (ou renomeie-o).

---

## Deploy automatico (CI/CD → VPS Hostinger)

Mesmo modelo do Clinic Pro:

| Workflow | Quando | O que faz |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Pull requests e pushes fora da `main` | `npm ci`, `npm test`, `npm run build`. |
| `.github/workflows/deploy.yml` | Todo push na `main` (ou manual) | Testa → publica a imagem em `ghcr.io/contatointegradata-spec/portal-gestao-de-desenvolvimento` (`:<sha>` e `:latest`) → entra na VPS via SSH, faz `git reset --hard origin/main`, `docker compose pull` e `up -d`, e aguarda o healthcheck. |

**Configuracao (uma unica vez):**

1. **Chave SSH dedicada ao deploy** (o GitHub nao deixa ler secrets ja salvos, entao nao da para copiar os do Clinic Pro).
   No terminal da VPS (hPanel da Hostinger › VPS › Terminal do navegador):

   ```bash
   ssh-keygen -t ed25519 -C "deploy-gestao-dev" -f ~/.ssh/gestao_dev_deploy -N ""
   cat ~/.ssh/gestao_dev_deploy.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
   whoami                       # -> VPS_USER
   curl -4 -s ifconfig.me; echo # -> VPS_HOST
   cat ~/.ssh/gestao_dev_deploy # -> VPS_SSH_KEY (copie tudo, inclusive as linhas BEGIN/END)
   rm ~/.ssh/gestao_dev_deploy  # depois de salvar o secret; a autorizacao (.pub) continua valendo
   ```
2. **Secrets do repositorio** (Settings › Secrets and variables › Actions):
   - `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (valores do passo anterior)
   - opcional `VPS_APP_DIR_GESTAO` (padrao `/opt/gestao-dev-integradata`). No primeiro deploy o repositorio e clonado nesse diretorio automaticamente.
3. **`.env` na VPS** em `<VPS_APP_DIR_GESTAO>/.env` (ver `.env.example`): `MASTER_EMAIL`, `MASTER_PASSWORD`, `MAIL_*`, `APP_SECRET_KEY`, `FRONTEND_URL`, `RPA_LIVE_VIEW_URL`. O `.env` nunca e sobrescrito pelo deploy.
4. **Dominio / nginx:** o nginx do Clinic Pro ja ocupa as portas 80/443 da VPS. Copie o bloco `deploy/nginx-gestao-dev.conf` para o `nginx.conf` do Clinic Pro (ajustando o `server_name`) e aponte o DNS do subdominio para a VPS. O container entra na rede `integradata_proxy` (`deploy/docker-compose.vps.yml`) e o nginx o alcanca por `gestao-dev-integradata`.

O endpoint `GET /api/health` devolve `release` com o commit publicado, para conferir a versao no ar.
Deploy manual de emergencia (na VPS): `docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml pull && docker compose -f docker-compose.yml -f deploy/docker-compose.vps.yml up -d`.

---

## Variaveis de ambiente (`.env`)

Veja `.env.example`. Principais:

| Variavel | Uso |
| --- | --- |
| `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_FROM` | Envio do codigo de recuperacao de senha (Gmail). |
| `DB_PATH` | Caminho do SQLite (padrao `data/gestao_dev.sqlite`). |
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
npm run db:merge-legacy -- --base <backup-do-banco-principal> --extra <banco-complementar>
```

  O banco base fornece os dados mais recentes; RPAs do banco complementar sao trazidos com planilhas e historico. Os arquivos originais nao sao alterados.

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

- **Backup:** copie `data/gestao_dev.sqlite` **e** `data/.gestao-secret.key` (ou guarde o `APP_SECRET_KEY`).
- **Senha de app do Gmail:** ela ficou versionada no historico do git (versao anterior de `server/index.js`). Gere uma nova senha de app no Google, revogue a antiga e atualize o `.env`.
- Diagnostico do ambiente RPA (Python, bibliotecas, fuso, email): **Configuracoes › Documentacao › Ambiente de execucao** (Admin/Super Admin) ou `GET /api/system/runtime`.
