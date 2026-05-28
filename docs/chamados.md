# Modulo de Chamados

## Objetivo

Centralizar a comunicacao entre solicitantes e administradores dentro da plataforma, com historico de tratativas, estados claros e fechamento rastreavel.

## Papeis

- `Usuario`: abre chamados, acompanha o historico, responde tratativas e pode encerrar um chamado que ja esteja `resolvido`.
- `Admin`: visualiza todos os chamados, responde solicitantes, define prioridade, assume o atendimento e move o ticket no fluxo operacional.
- `Super Admin`: possui os mesmos poderes do `Admin`, alem de manter a administracao geral da plataforma.

## Categorias

- `solicitacao`: nova demanda, acesso, melhoria ou configuracao.
- `duvida`: orientacao funcional, processo ou uso do sistema.
- `incidente`: erro, indisponibilidade, comportamento inesperado ou regressao.
- `outro`: excecoes que nao se encaixam nas categorias anteriores.

## Fluxo de Status

- `aberto`: chamado recem-criado e ainda sem tratamento.
- `em_tratamento`: ticket sendo analisado ou executado por Admin/Super Admin.
- `aguardando_resposta_usuario`: atendimento pausado aguardando informacao adicional do solicitante.
- `resolvido`: solucao aplicada com tratativa final registrada.
- `encerrado`: fechamento definitivo, normalmente pelo solicitante apos validar a resolucao.

## Regras operacionais

- Todo chamado nasce como `aberto`.
- Resposta de Admin/Super Admin em um ticket `aberto` move automaticamente para `em_tratamento`.
- Resposta do solicitante em um ticket `aguardando_resposta_usuario` ou `resolvido` reabre o fluxo em `em_tratamento`.
- Para marcar um ticket como `resolvido` ou `encerrado` via painel administrativo, e obrigatorio informar a tratativa final.
- O solicitante so pode alterar o status de `resolvido` para `encerrado`.
- O historico de mensagens deve registrar contexto, decisao e orientacao final, evitando tratativas fora da plataforma.

## Boas praticas adotadas

- Separacao entre dados do ticket e historico de mensagens para manter rastreabilidade.
- Estados reduzidos e semanticamente claros, evitando fluxos excessivamente complexos.
- Atribuicao opcional a Admin/Super Admin para favorecer ownership do atendimento.
- Uso explicito de `aguardando_resposta_usuario` quando faltar evidencia ou validacao do solicitante.
- Encerramento somente apos confirmacao do usuario ou decisao administrativa bem registrada.

## Validacao tecnica

O smoke test da funcionalidade cobre:

1. Login do super admin.
2. Criacao de um Admin e de um Usuario em banco temporario.
3. Abertura de chamado pelo Usuario.
4. Tratativa pelo Admin com mudanca para `aguardando_resposta_usuario`.
5. Resposta do Usuario reabrindo para `em_tratamento`.
6. Resolucao com tratativa final.
7. Encerramento pelo solicitante.

Execucao local:

```bash
npm run test:tickets
```
