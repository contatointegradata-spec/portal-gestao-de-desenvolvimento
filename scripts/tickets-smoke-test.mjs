import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gestao-tickets-"));
const dbPath = path.join(tempDir, "tickets-smoke.sqlite");
const port = 5191;
const baseUrl = `http://127.0.0.1:${port}`;

const server = spawn("node", ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    NODE_ENV: "test"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverLogs = "";
server.stdout.on("data", (chunk) => {
  serverLogs += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLogs += chunk.toString();
});

try {
  await waitForServer(`${baseUrl}/api/health`);

  const masterLogin = await postJson(`${baseUrl}/api/auth/login`, {
    email: "kelvensilva.unimed@gmail.com",
    password: "Saladas.2"
  });
  const adminToken = masterLogin.token;
  assert.ok(adminToken, "token do super admin ausente");

  await request(`${baseUrl}/api/users`, {
    method: "POST",
    token: adminToken,
    body: {
      nome: "Admin Tickets",
      email: "admin.tickets@example.com",
      senha: "Admin123!",
      role: "admin",
      departamento: "Tecnologia"
    }
  });

  await request(`${baseUrl}/api/users`, {
    method: "POST",
    token: adminToken,
    body: {
      nome: "Usuario Tickets",
      email: "usuario.tickets@example.com",
      senha: "User123!",
      role: "user",
      departamento: "Tecnologia"
    }
  });

  const requesterLogin = await postJson(`${baseUrl}/api/auth/login`, {
    email: "usuario.tickets@example.com",
    password: "User123!"
  });
  const requesterToken = requesterLogin.token;
  assert.ok(requesterToken, "token do usuario ausente");

  const createdTicket = await request(`${baseUrl}/api/tickets`, {
    method: "POST",
    token: requesterToken,
    body: {
      titulo: "Erro no acesso ao portal",
      descricao: "Ao abrir o sistema recebo erro 500 e preciso de apoio.",
      categoria: "incidente",
      prioridade: "alta"
    }
  });

  assert.equal(createdTicket.ticket.status, "aberto");
  const ticketId = createdTicket.ticket.id;

  const adminTickets = await request(`${baseUrl}/api/tickets`, {
    token: adminToken
  });
  assert.equal(adminTickets.length, 1);
  assert.equal(adminTickets[0].id, ticketId);

  const adminDetail = await request(`${baseUrl}/api/tickets/${ticketId}`, {
    token: adminToken
  });
  assert.equal(adminDetail.messages.length, 1);

  const updatedToWaiting = await request(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    token: adminToken,
    body: {
      status: "aguardando_resposta_usuario",
      prioridade: "critica",
      note: "Preciso do horario exato do erro e um print da tela."
    }
  });
  assert.equal(updatedToWaiting.ticket.status, "aguardando_resposta_usuario");

  const requesterReply = await request(`${baseUrl}/api/tickets/${ticketId}/messages`, {
    method: "POST",
    token: requesterToken,
    body: {
      body: "O erro ocorreu hoje as 09:10 e anexarei a evidência na sequência."
    }
  });
  assert.equal(requesterReply.ticket.status, "em_tratamento");

  const resolved = await request(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    token: adminToken,
    body: {
      status: "resolvido",
      resolutionSummary: "Ajustado o acesso no perfil do usuario e validado com sucesso.",
      note: "Correção aplicada e aguardando confirmacao do solicitante."
    }
  });
  assert.equal(resolved.ticket.status, "resolvido");
  assert.match(resolved.ticket.resolutionSummary, /Ajustado o acesso/i);

  const closed = await request(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    token: requesterToken,
    body: {
      status: "encerrado",
      note: "Validado pelo solicitante."
    }
  });
  assert.equal(closed.ticket.status, "encerrado");

  const finalList = await request(`${baseUrl}/api/tickets`, {
    token: adminToken
  });
  assert.equal(finalList[0].status, "encerrado");

  console.log("Smoke test de chamados concluido com sucesso.");
} finally {
  server.kill("SIGTERM");
  await onceExit(server);
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function waitForServer(url, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // aguarda inicializacao
    }
    await delay(500);
  }
  throw new Error(`Servidor nao respondeu a tempo.\n${serverLogs}`);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Falha em ${url}`);
  }
  return data;
}

async function request(url, { method = "GET", token = "", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Falha em ${method} ${url}`);
  }
  return data;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => resolve(), 2000);
  });
}
