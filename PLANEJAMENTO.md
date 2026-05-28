# 🚀 Sistema de Gestão de Desenvolvimentos

## 📋 Visão Geral

Sistema interno para catalogar e gerenciar todos os projetos desenvolvidos, permitindo acesso rápido, organização e visualização de informações importantes sobre cada desenvolvimento.

---

## 🎯 Objetivos

- Centralizar todos os links e informações dos sistemas desenvolvidos
- Facilitar o acesso rápido aos projetos
- Organizar por categorias, tecnologias e status
- Manter histórico visual dos desenvolvimentos
- Permitir busca e filtragem eficiente

---

## ✨ Funcionalidades Principais

### 1. **Dashboard Principal**
- Grid responsivo de cards (3 colunas desktop, 2 tablet, 1 mobile)
- Cards com hover effects e transições suaves
- Preview de screenshot em cada card
- Badge de status colorido
- Tags de tecnologias utilizadas

### 2. **Sistema de Busca e Filtros**
- Busca por nome ou descrição (em tempo real)
- Filtros por:
  - Status (Ativo, Desenvolvimento, Manutenção, Arquivado)
  - Tecnologia (React, Node.js, Python, PHP, etc)
  - Categoria (Interno, Cliente, Pessoal, Estudo)
  - Data de criação
- Limpar todos os filtros com um clique

### 3. **Cadastro de Projetos**
- Modal ou página dedicada para adicionar novo projeto
- Campos do formulário:
  - Nome do projeto *
  - Descrição curta *
  - URL de acesso *
  - Repositório (GitHub/GitLab)
  - Status *
  - Tecnologias (seleção múltipla) *
  - Categoria *
  - Upload de screenshot
  - Observações/notas
  - Data de criação (automática)

### 4. **Upload de Screenshots**
- Drag and drop ou click to upload
- Preview antes de salvar
- Suporte para PNG, JPG, WebP
- Crop/redimensionamento opcional
- Placeholder caso não tenha imagem

### 5. **Detalhes do Projeto**
- Modal expandido ao clicar no card
- Todas as informações completas
- Screenshot em tamanho maior
- Botões de ação:
  - Abrir sistema (link externo)
  - Abrir repositório
  - Editar informações
  - Excluir projeto

---

## 🎨 Design System

### Paleta de Cores

**Tema Escuro (Principal)**
- Background: `#0f172a` (slate-900)
- Cards: `#1e293b` (slate-800)
- Hover Cards: `#334155` (slate-700)
- Texto Principal: `#f1f5f9` (slate-100)
- Texto Secundário: `#94a3b8` (slate-400)
- Accent: `#3b82f6` (blue-500)

**Badges de Status**
- 🟢 Ativo: `#10b981` (green-500)
- 🟡 Desenvolvimento: `#f59e0b` (amber-500)
- 🔵 Manutenção: `#3b82f6` (blue-500)
- ⚫ Arquivado: `#6b7280` (gray-500)

### Tipografia
- Fonte Principal: Inter ou System UI
- Títulos: 600-700 weight
- Corpo: 400-500 weight
- Tamanhos: 12px-24px

### Componentes

#### Card do Projeto
```
┌─────────────────────────────┐
│  [Screenshot Preview]       │
│                             │
│  📦 Nome do Projeto         │
│  Descrição curta...         │
│                             │
│  🟢 Status  [Tags Tech]     │
│  📅 Criado em: XX/XX/XXXX   │
│                             │
│  [Abrir] [Detalhes]         │
└─────────────────────────────┘
```

#### Barra de Busca e Filtros
```
┌────────────────────────────────────────┐
│ 🔍 Buscar projetos...                  │
└────────────────────────────────────────┘

[Status ▾] [Tecnologia ▾] [Categoria ▾] [+ Novo Projeto]
```

---

## 🛠️ Stack Tecnológica

### Frontend
- **React** 18+ (com Hooks)
- **Tailwind CSS** para estilização
- **Lucide React** para ícones
- **LocalStorage API** para persistência (inicialmente)

### Futuras Melhorias
- Backend com Node.js/Express
- Banco de dados (PostgreSQL/MongoDB)
- Upload real de imagens (Cloudinary/S3)
- Autenticação de usuário
- Export/Import de dados

---

## 📐 Estrutura de Dados

### Modelo de Projeto

```javascript
{
  id: "uuid-v4",
  nome: "Sistema de Vendas",
  descricao: "Sistema completo para gestão de vendas e estoque",
  url: "https://vendas.exemplo.com",
  repositorio: "https://github.com/usuario/sistema-vendas",
  status: "ativo", // ativo | desenvolvimento | manutencao | arquivado
  tecnologias: ["React", "Node.js", "PostgreSQL"],
  categoria: "cliente", // interno | cliente | pessoal | estudo
  screenshot: "base64_ou_url",
  observacoes: "Cliente solicitou melhorias no módulo X",
  dataCriacao: "2025-03-06T10:30:00Z",
  dataAtualizacao: "2025-03-06T10:30:00Z"
}
```

---

## 📱 Layout Responsivo

### Desktop (>1024px)
- Grid de 3 colunas
- Sidebar com filtros
- Cards com 300px de largura

### Tablet (768px - 1024px)
- Grid de 2 colunas
- Filtros colapsáveis
- Cards adaptados

### Mobile (<768px)
- Grid de 1 coluna
- Menu hambúrguer
- Cards full-width
- Filtros em modal

---

## 🚀 Roadmap de Desenvolvimento

### Fase 1 - MVP (Atual)
- ✅ Planejamento e estrutura
- ⏳ Interface básica com cards
- ⏳ Sistema de busca
- ⏳ Filtros por status e tecnologia
- ⏳ Cadastro de projetos
- ⏳ LocalStorage para persistência

### Fase 2 - Melhorias
- Upload real de screenshots
- Edição de projetos
- Exclusão com confirmação
- Export de dados em JSON
- Temas claro/escuro

### Fase 3 - Avançado
- Backend com API
- Banco de dados
- Autenticação
- Multi-usuário
- Analytics e estatísticas

---

## 🎯 Casos de Uso

### Cenário 1: Adicionar novo projeto
1. Usuário clica em "+ Novo Projeto"
2. Preenche o formulário
3. Faz upload de screenshot
4. Salva o projeto
5. Card aparece no dashboard

### Cenário 2: Buscar projeto específico
1. Usuário digita na barra de busca
2. Lista filtra em tempo real
3. Encontra o projeto desejado
4. Clica para ver detalhes ou acessar

### Cenário 3: Filtrar por tecnologia
1. Usuário seleciona "React" no filtro
2. Sistema mostra apenas projetos React
3. Pode combinar com outros filtros

---

## 📊 Métricas de Sucesso

- Todos os projetos catalogados em um único lugar
- Tempo de acesso reduzido (< 5 segundos para encontrar qualquer projeto)
- Interface intuitiva (sem necessidade de treinamento)
- 100% responsivo em todos os dispositivos

---

## 🔒 Considerações de Segurança

- Validação de URLs antes de salvar
- Sanitização de inputs
- Proteção contra XSS
- (Futuro) Autenticação e autorização
- (Futuro) Criptografia de dados sensíveis

---

## 📝 Notas Adicionais

- Sistema será usado internamente inicialmente
- Possibilidade de expansão para equipe maior
- Interface deve ser rápida e fluida
- Priorizar usabilidade sobre complexidade

---

**Documento criado em:** 06/03/2026
**Última atualização:** 06/03/2026
**Versão:** 1.0

---

## Melhorias implementadas em 06/03/2026

### Autenticacao e acesso
- Adicionada tela de login com botao `Entrar`.
- Implementado logout com botao `Sair` no cabecalho e no painel do usuario.
- Sessao baseada em token com expiracao (7 dias), validada no backend.
- Rotas de projetos protegidas por autenticacao.

### Banco de dados de usuarios
- Criada tabela `users` com os campos:
  - `id`, `nome`, `email` (unico), `passwordHash`, `passwordSalt`, `foto`, `tema`, `createdAt`, `updatedAt`, `lastLoginAt`.
- Criada tabela `user_sessions` para controle de sessao:
  - `tokenHash`, `userId`, `createdAt`, `expiresAt`.
- Seed de usuario padrao (somente quando nao houver usuario):
  - `admin@unimed.local` / `admin123`.

### Painel de configuracoes do usuario
- Painel de configuracoes com:
  - upload/atualizacao de foto do usuario,
  - alternancia de tema claro/escuro,
  - redefinicao de senha.
- Redefinicao de senha invalida sessoes ativas e exige novo login.

### Tema claro/escuro
- Tema persistido por usuario no banco (`users.tema`).
- Botao de alternancia de tema no cabecalho e no painel.
- Ajuste do design system para usar variaveis CSS no Tailwind (`tailwind.config.js` + `src/main.css`).

### Endpoints adicionados
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `PUT /api/users/me/theme`
- `PUT /api/users/me/photo`
- `PUT /api/users/me/password`

### Observacao de seguranca
- Recomenda-se trocar a senha do usuario padrao no primeiro acesso.

### Recuperacao de senha por e-mail
- Adicionado botao `Recuperar senha` na tela de login.
- Fluxo de solicitacao de reset com envio de link por e-mail (Gmail SMTP com App Password).
- Implementado endpoint de redefinicao por token com expiracao de 30 minutos.
- Link de reset abre a tela de nova senha via query string `?resetToken=...`.
- Botao e formulario `Criar conta` na tela de login com campos: nome, email, senha e confirmar senha.
- Endpoint `POST /api/auth/register` para cadastro de novos usuarios.
- Envio de email de boas-vindas automatico apos criacao da conta.
