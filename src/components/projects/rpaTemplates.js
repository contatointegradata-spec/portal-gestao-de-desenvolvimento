export const RPA_TEMPLATES = {
  python: [
    {
      id: "browser",
      label: "Navegador (Playwright)",
      code: `"""
Modelo de RPA com navegador — Python
Helper disponivel: rpa.log / rpa.success / rpa.warn / rpa.error / rpa.progress
                   rpa.screenshot(page, "legenda") / rpa.save_output(nome, conteudo)
"""
from playwright.sync_api import sync_playwright


def main():
    rpa.log("Iniciando automacao")
    with sync_playwright() as p:
        browser = p.chromium.launch()  # headless/visivel e definido nas configuracoes do RPA
        page = browser.new_page()
        page.goto("https://example.com")
        rpa.screenshot(page, "Pagina inicial")

        titulo = page.title()
        rpa.success(f"Titulo da pagina: {titulo}")
        browser.close()


if __name__ == "__main__":
    main()
`
    },
    {
      id: "excel",
      label: "Planilha de entrada (Excel)",
      code: `"""
Modelo de RPA com planilha — Python
O primeiro arquivo de entrada chega em rpa.input_file (e tambem em sys.argv[1]).
Todos os arquivos enviados ficam na pasta de trabalho: rpa.files
"""
import pandas as pd


def main():
    if not rpa.input_file:
        rpa.error("Envie a planilha na aba 'Arquivos' do RPA.")
        raise SystemExit(1)

    df = pd.read_excel(rpa.input_file)
    df.columns = [str(coluna).strip() for coluna in df.columns]
    total = len(df)
    rpa.log(f"{total} registro(s) carregado(s)")

    for indice, linha in enumerate(df.to_dict("records"), start=1):
        # processe cada linha aqui
        rpa.progress(indice, total, f"Processando registro {indice}/{total}")

    # Gera um arquivo de saida (disponivel para download no historico)
    rpa.save_output("resultado.csv", df.to_csv(index=False))
    rpa.success("Processamento concluido")


if __name__ == "__main__":
    main()
`
    }
  ],
  javascript: [
    {
      id: "browser",
      label: "Navegador (Playwright)",
      code: `/**
 * Modelo de RPA com navegador — JavaScript
 * Helper global: rpa.log / rpa.success / rpa.warn / rpa.error / rpa.progress
 *                rpa.screenshot(page, "legenda") / rpa.saveOutput(nome, conteudo)
 */
const { chromium } = require("playwright");

async function main() {
  rpa.log("Iniciando automacao");
  const browser = await chromium.launch(); // headless/visivel e definido nas configuracoes do RPA
  const page = await browser.newPage();
  await page.goto("https://example.com");
  await rpa.screenshot(page, "Pagina inicial");

  const titulo = await page.title();
  rpa.success(\`Titulo da pagina: \${titulo}\`);
  await browser.close();
}

module.exports = main;
`
    },
    {
      id: "excel",
      label: "Planilha de entrada (Excel)",
      code: `/**
 * Modelo de RPA com planilha — JavaScript
 * O primeiro arquivo de entrada chega em rpa.inputFile (e em process.argv[2]).
 */
const XLSX = require("xlsx");

async function main() {
  if (!rpa.inputFile) throw new Error("Envie a planilha na aba 'Arquivos' do RPA.");

  const workbook = XLSX.readFile(rpa.inputFile);
  const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  rpa.log(\`\${linhas.length} registro(s) carregado(s)\`);

  linhas.forEach((linha, indice) => {
    // processe cada linha aqui
    rpa.progress(indice + 1, linhas.length, \`Processando registro \${indice + 1}/\${linhas.length}\`);
  });

  rpa.saveOutput("resultado.json", JSON.stringify(linhas, null, 2));
  rpa.success("Processamento concluido");
}

module.exports = main;
`
    }
  ]
};
