# Documentacao da Plataforma

## Visao geral

Plataforma interna para:

- catalogo de sistemas
- gestao de usuarios e perfis
- automacoes RPA
- central de chamados entre usuarios e administradores

## Perfis

- `super_admin`: administra toda a plataforma, cria usuarios, altera perfis, exclui usuarios e trata chamados
- `admin`: administra sistemas, altera dados permitidos de usuarios e trata chamados
- `user`: acessa seus sistemas e abre chamados para suporte

## Modulo de chamados

### Objetivo

Permitir comunicacao estruturada entre usuarios e administradores para:

- solicitacoes
- duvidas
- incidentes
- outros assuntos operacionais

### Categorias

- `solicitacao`
- `duvida`
- `incidente`
- `outro`

### Prioridades

- `baixa`
- `media`
- `alta`
- `critica`

### Status

- `aberto`: chamado criado e aguardando primeira tratativa
- `em_tratamento`: chamado em analise ou execucao
- `aguardando_resposta_usuario`: equipe respondeu e depende de retorno do solicitante
- `resolvido`: tratativa concluida pela equipe
- `encerrado`: encerramento final do ticket

### Regras de fluxo

- qualquer usuario autenticado pode abrir chamado
- usuario comum visualiza apenas os proprios chamados
- `admin` e `super_admin` visualizam e tratam todos os chamados
- quando um administrador responde um chamado novo, o status pode seguir para `em_tratamento`
- quando o usuario responde um chamado em `aguardando_resposta_usuario` ou `resolvido`, o fluxo volta para `em_tratamento`
- apenas `admin` e `super_admin` podem definir responsavel, prioridade operacional e tratativa final
- o solicitante pode encerrar um chamado `resolvido`

### Campos principais

- numero sequencial do ticket
- titulo
- descricao inicial
- categoria
- prioridade
- status
- solicitante
- responsavel
- departamento
- projeto vinculado
- tratativa final
- historico de mensagens

## Interface

### Configuracoes

Botao superior que abre modal com:

- `Perfil`
- `Usuarios`
- `Documentacao`

### Chamados

Secao principal com:

- cards-resumo
- filtros por status e categoria
- busca textual
- abertura de novo chamado
- visualizacao detalhada com historico
- painel lateral de tratamento para administradores

## Validacao recomendada

### Fluxo basico

1. entrar com usuario comum
2. abrir chamado
3. entrar com admin
4. assumir chamado, responder e alterar status
5. voltar com usuario comum
6. responder ou encerrar chamado resolvido

### Verificacoes

- usuario comum nao deve ver chamados de terceiros
- apenas admin/super_admin podem alterar tratativa
- apenas super_admin pode excluir usuarios
- mensagens devem aparecer em ordem cronologica
- atualizacao de status deve refletir na lista e no detalhe

## Observacoes operacionais

- o banco SQLite da plataforma persiste os chamados
- mensagens do ticket ficam separadas do registro principal para manter historico de atendimento
- o sistema foi desenhado para crescer com SLA, anexos, notificacoes e base de conhecimento sem quebrar a modelagem atual
