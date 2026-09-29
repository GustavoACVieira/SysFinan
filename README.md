# SysFinan — Projeto Administrativo-Financeiro

Sistema administrativo-financeiro desenvolvido para a disciplina **ESW424 — Prática de
Engenharia de Software** (Universidade de Rio Verde).

A avaliação N2 é dividida em duas etapas:

| Etapa | Entrega | Peso |
|-------|------------|------|
| 1ª etapa | 29/09/2026 | 35% |
| 2ª etapa | 28/10/2026 | 45% |

---

## Funcionalidades previstas

- Manter Fornecedor
- Manter Cliente
- Manter Faturado
- Manter Tipo de Receita
- Manter Tipo de Despesa
- Registrar Contas a Pagar
- Registrar Contas a Receber

### Regras de negócio

- Cadastros **não podem ser excluídos**.
- Cadastros devem ser **INATIVADOS**.
- Deve ser possível **REATIVAR** um registro inativo.
- Um registro de contas a pagar pode ser classificado em **um ou mais Tipos de Despesa**.
- Um registro de contas a receber pode ser classificado em **um ou mais Tipos de Receita**.
- Um registro de contas a pagar ou a receber pode ter **uma ou mais parcelas**, com datas de
  vencimento distintas.

---

## Etapa 1 (escopo atual)

Processador de PDF que utiliza um **Agent** (Gemini) para extrair os dados de uma nota fiscal
(CONTAS A PAGAR) e devolver o resultado em **JSON**.

Fluxo: o usuário entra com o login de administrador, informa a chave da API do Gemini
(se ainda não estiver cadastrada), carrega o PDF da nota fiscal na interface web, aciona o botão
**EXTRAIR DADOS**, o Agent processa o documento em etapas verificadas e o JSON é exibido na tela.

### Extração em etapas

Cada etapa tem seu próprio esquema Pydantic (em `backend/models.py`) e é uma chamada
separada ao Gemini. O Agent **só passa para a próxima etapa quando a atual é aprovada pela
verificação**:

| # | Etapa | Esquema | O que a verificação exige |
|---|-------|---------|---------------------------|
| 1 | Identificação | `EsquemaIdentificacao` | Razão social e CNPJ do fornecedor, nome do faturado, número e data de emissão; CNPJ/CPF e data no formato certo |
| 2 | Produtos | `EsquemaProdutos` | Ao menos um produto |
| 3 | Financeiro | `EsquemaFinanceiro` | Valor total positivo, ao menos uma parcela, parcelas com valor e **soma das parcelas = valor total** |
| 4 | Classificação | `EsquemaClassificacao` | Ao menos uma das 9 categorias (feita só com o texto já extraído, sem reenviar o PDF) |
| 5 | Consolidação | `NotaFiscalExtraida` | Redundância: repete todas as verificações sobre a nota montada e revalida o JSON final contra o esquema completo |

Redundância e verificação (`backend/agents/agent1/verificacao.py`):

- Se uma etapa é reprovada, o Agent a **refaz informando ao modelo os motivos da reprovação**
  (até 2 tentativas). Se continuar reprovada, o pipeline para ali e as etapas seguintes
  ficam como *não executadas*.
- Pontos que não impedem a etapa (ex.: dígitos verificadores de CNPJ/CPF que não conferem,
  comuns em notas de teste) viram **avisos** no relatório.
- Cada chamada percorre a cadeia de modelos Flash (3.8 → 3.7 → 3.6 → 3.5): se o preferido
  estiver sobrecarregado (HTTP 5xx), sem cota (HTTP 429 — a cota do Gemini é separada por
  modelo) ou não responder em 90 s, usa o próximo. Só um modelo atende cada chamada.

Desempenho:

- Raciocínio (`thinking_level`) `MEDIUM` em todas as etapas: o padrão do Gemini 3 (`HIGH`)
  deixava a extração lenta, e `LOW` pensava pouco para a classificação.
- Quando um modelo reserva atende, as chamadas seguintes começam por ele durante 5 minutos,
  em vez de esbarrar de novo no preferido que acabou de falhar. O diagnóstico de
  funcionamento ignora essa fixação, para detectar quando o preferido volta.
- Não há repetição no mesmo modelo: um modelo sobrecarregado demora para devolver o 503, e
  repetir nele só dobraria a espera — a cadeia de reservas é quem dá a resiliência.

> **Cota do plano gratuito:** 20 requisições por dia **por modelo**. Cada extração faz ao
> menos 4 (uma por etapa com IA), então a cadeia de 4 modelos comporta cerca de 20 extrações
> por dia. Para uso contínuo, ative o faturamento no Google AI Studio.

`NotaFiscalExtraida` é a composição dos quatro esquemas das etapas, então o JSON final
continua exatamente no formato abaixo.

### Campos extraídos

- **Fornecedor**: Razão Social, Fantasia, CNPJ
- **Faturado**: Nome Completo, CPF
- Número da Nota Fiscal
- Data de Emissão
- Descrição dos produtos (sem entidade PRODUTOS)
- Quantidade de Parcelas (uma parcela, com estrutura preparada para mais de uma)
- Data de Vencimento
- Valor Total
- Classificação da Despesa (uma por registro, com estrutura preparada para mais de uma)

A **classificação da despesa não é um campo extraído**: ela é interpretada pelo Gemini a partir
da descrição dos produtos da nota. Ex.: compra de óleo diesel → `MANUTENÇÃO E OPERAÇÃO`;
compra de material hidráulico → `INFRAESTRUTURA E UTILIDADES`.

### Categorias de despesa

| Categoria | Exemplos |
|-----------|----------|
| INSUMOS AGRÍCOLAS | Sementes, fertilizantes, defensivos agrícolas, corretivos |
| MANUTENÇÃO E OPERAÇÃO | Combustíveis e lubrificantes; peças, parafusos e componentes mecânicos; manutenção de máquinas e equipamentos; pneus, filtros, correias; ferramentas e utensílios |
| RECURSOS HUMANOS | Mão de obra temporária; salários e encargos |
| SERVIÇOS OPERACIONAIS | Frete e transporte; colheita terceirizada; secagem e armazenagem; pulverização e aplicação |
| INFRAESTRUTURA E UTILIDADES | Energia elétrica; arrendamento de terras; construções e reformas; materiais de construção |
| ADMINISTRATIVAS | Honorários (contábeis, advocatícios, agronômicos); despesas bancárias e financeiras |
| SEGUROS E PROTEÇÃO | Seguro agrícola; seguro de ativos (máquinas/veículos); seguro prestamista |
| IMPOSTOS E TAXAS | ITR, IPTU, IPVA, INCRA-CCIR |
| INVESTIMENTOS | Aquisição de máquinas e implementos; de veículos; de imóveis; infraestrutura rural |

### Formato do JSON retornado

```json
{
  "fornecedor": {
    "razaoSocial": "IGUACU MAQUINAS AGRICOLAS LTDA",
    "fantasia": "IGUACU MAQUINAS",
    "cnpj": "33.656.729/0023-85"
  },
  "faturado": {
    "nomeCompleto": "CICLANO DA SILVA",
    "cpf": "999.999.999-99"
  },
  "numeroNotaFiscal": "000.084.682",
  "dataEmissao": "2025-09-19",
  "descricaoProdutos": [
    "GRAXA DE POLIUREIA MP SD 400G",
    "KIT DA BUCHA",
    "ROLAMENTO DE ESFERAS"
  ],
  "quantidadeParcelas": 1,
  "parcelas": [
    { "numero": 1, "dataVencimento": "2025-10-17", "valor": 3086.75 }
  ],
  "valorTotal": 3086.75,
  "tiposDespesa": ["MANUTENÇÃO E OPERAÇÃO"]
}
```

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Banco de dados | MySQL |
| Framework (API) | FastAPI |
| IA / Agents | Python + Gemini |
| Front-end | TypeScript (React + Vite) |

---

## Estrutura do repositório

```
SysFinan/
├── backend/                            # API e Agents (Python)
│   ├── main.py                         # FastAPI: login, chave da API e POST /extrair
│   ├── models.py                       # Esquemas Pydantic: etapas, nota completa e verificação
│   ├── seguranca.py                    # Login do admin e sessões (token Bearer)
│   ├── agents/
│   │   └── agent1/
│   │       ├── __init__.py
│   │       ├── manipulacao_dados.py    # class Agent1 -> extrair_dados(file_path) e verificar_funcionamento()
│   │       ├── etapas.py               # Ordem das etapas, instruções e esquema de cada uma
│   │       └── verificacao.py          # Regras que aprovam/reprovam cada etapa
│   └── .env
├── frontend/                           # Interface web (TypeScript + React + Vite)
│   ├── public/                         # Servidos na raiz do site, sem passar pelo build
│   │   ├── favicon.svg                 # Favicon principal (acompanha o tema claro/escuro)
│   │   ├── favicon.ico                 # Reserva para navegadores antigos (16/32/48 px)
│   │   ├── apple-touch-icon.png        # Ícone ao salvar na tela inicial do iPhone (180 px)
│   │   ├── icon-192.png, icon-512.png  # Ícones do app instalado (Android/desktop)
│   │   └── site.webmanifest            # Nome e ícones do app instalado
│   ├── src/
│   │   ├── App.tsx                     # Alterna entre login e a área logada
│   │   ├── Login.tsx                   # Tela de login
│   │   ├── Marca.tsx                   # Símbolo da marca em SVG (cores seguem o tema do app)
│   │   ├── ChaveApi.tsx                # Janela de cadastro da chave do Gemini
│   │   ├── SaudeAgent.tsx              # Verificação de funcionamento do agent
│   │   ├── Extracao.tsx                # Upload do PDF e exibição do JSON
│   │   ├── Etapas.tsx                  # Relatório das etapas da extração
│   │   ├── api.ts                      # Chamadas à API (com o token da sessão)
│   │   └── types.ts                    # Contrato do JSON da nota fiscal
│   └── package.json
├── docs/
│   └── marca/                          # Arquivos originais da marca (logo e ícone), para referência
├── requirements.txt                    # Dependências do back-end (na raiz, para o Render)
├── README.md
└── .gitignore
```

## Deploy no Render

O arquivo `render.yaml` define dois serviços no mesmo repositório: a API como Web Service
Python e a interface como Static Site. O deploy da API usa a porta fornecida pelo Render e
escuta em todas as interfaces (`0.0.0.0`); o frontend é publicado a partir de `frontend/dist`.

Ao criar o Blueprint, informe os valores secretos solicitados. Depois que os serviços forem
criados, configure `VITE_API_URL` no serviço `sysfinan-frontend` com a URL pública da API
(por exemplo, `https://sysfinan-api.onrender.com`) e `FRONTEND_URL` no serviço
`sysfinan-api` com a URL pública do frontend. Um novo deploy do frontend é necessário para
embutir a URL da API no build do Vite.

O endpoint de saúde da API é `GET /health`.

### Configuração manual (sem Blueprint)

Se os serviços forem criados à mão no painel do Render, use os mesmos valores do `render.yaml`:

**API — Web Service**

| Campo | Valor |
|-------|-------|
| Root Directory | *(vazio — raiz do repositório)* |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Variáveis | `GEMINI_API_KEY`, `FRONTEND_URL` e, opcionalmente, `GEMINI_MODEL`, `SYSFINAN_USUARIO`, `SYSFINAN_SENHA` |

**Frontend — Static Site**

| Campo | Valor |
|-------|-------|
| Build Command | `npm ci --prefix frontend && npm run build --prefix frontend` |
| Publish Directory | `frontend/dist` |
| Variáveis | `VITE_API_URL` |

Erros comuns ao iniciar a API:

- `Could not import module "main"`: o Start Command rodou na raiz, onde não existe `main.py`
  — falta o `cd backend` (equivalente: `uvicorn main:app --app-dir backend ...`).
- `No open ports detected`: falta `--host 0.0.0.0 --port $PORT`; o padrão do uvicorn
  (`127.0.0.1:8000`) não é visível para o Render.
- Erro de versão do Python no build: defina `PYTHON_VERSION=3.14.7` (a usada no desenvolvimento).

> A chave cadastrada pela tela é gravada no disco do servidor, que no Render é temporário:
> some a cada deploy ou reinício. Para ela ficar permanente, cadastre-a em
> **Environment → GEMINI_API_KEY**. As sessões de login também são perdidas quando o serviço
> gratuito hiberna — basta entrar de novo.

---

## Como executar o back-end

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r ../requirements.txt
uvicorn main:app --reload
```

A API sobe em `http://localhost:8000` e a documentação interativa em
`http://localhost:8000/docs`.

> Execute o `uvicorn` a partir da pasta `backend/`: é ela que coloca o pacote `agents` no
> caminho de importação. A partir da raiz, use `uvicorn main:app --app-dir backend --reload`.

Variáveis de ambiente:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `GEMINI_API_KEY` | Chave da API do Gemini (também pode ser cadastrada pela tela, que grava aqui) | — |
| `GEMINI_MODEL` | Modelo(s) preferido(s) do Agent1, separados por vírgula; os demais Flash servem de reserva | `gemini-3.8-flash` → `3.7` → `3.6` → `3.5` |
| `SYSFINAN_USUARIO` | Usuário do login | `admin` |
| `SYSFINAN_SENHA` | Senha do login | `cruzeiro` |
| `FRONTEND_URL` | URLs do front liberadas no CORS, separadas por vírgula (no Render, a URL pública do front) | `http://localhost:5173,http://127.0.0.1:5173` |

### Endpoints

Todas as rotas, exceto `/login` e `/health`, exigem o cabeçalho `Authorization: Bearer <token>`. As sessões
ficam em memória e duram 8 horas; reiniciar o servidor exige novo login.

| Método | Rota | Entrada | Saída |
|--------|------|---------|-------|
| `GET` | `/health` | — | `{ "status": "ok" }` (health check leve, sem chamar o Gemini) |
| `GET` | `/saude/agent` | — | Diagnóstico do agent: chave válida, disponibilidade de cada modelo e um teste real de geração estruturada |
| `POST` | `/login` | JSON `{ "usuario", "senha" }` | `{ "token" }` |
| `POST` | `/logout` | — | `204` |
| `GET` | `/chave-api` | — | `{ "informada": bool, "mascara": "••••abcd" \| null }` |
| `PUT` | `/chave-api` | JSON `{ "chave" }` | situação da chave (grava em `backend/.env`) |
| `DELETE` | `/chave-api` | — | situação da chave |
| `POST` | `/extrair` | `multipart/form-data`, campo `arquivo` (PDF) | `{ "concluida", "etapas": [...], "dados": <JSON no formato acima> \| null }` |

`dados` só vem preenchido quando todas as etapas são aprovadas; `etapas` traz, para cada uma,
o status (`concluida`, `falhou`, `nao_executada`), as tentativas, o modelo usado, os problemas e
os avisos.

O `main.py` apenas recebe o arquivo e delega ao agente, conforme a estrutura de Agents:

```python
from agents.agent1.manipulacao_dados import Agent1

agent1 = Agent1()
resultado = agent1.extrair_dados(caminho_do_pdf)   # ResultadoExtracao
resultado.dados                                    # NotaFiscalExtraida (JSON acima)
```

Cada etapa usa como `response_schema` o seu esquema Pydantic de `models.py` — o mesmo contrato
declarado em `frontend/src/types.ts` — e a classificação da despesa é restrita às 9 categorias
pela enumeração `CategoriaDespesa`.

---

## Como executar o front-end

```bash
cd frontend
npm install
# ajuste a URL da API de extração em frontend/.env
npm run dev
```

A aplicação sobe em `http://localhost:5173`.

Variável de ambiente:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL base da API que expõe `POST /extrair` | `http://localhost:8000` |

Ao abrir, o front exibe a tela de login (usuário `admin`, senha `cruzeiro`). Depois de entrar,
o botão **Chave API** no cabeçalho mostra a situação da chave (bolinha verde = **Ativa**,
vermelha = **Não informada**). Ao clicar, abre uma janela com os 4 últimos caracteres da chave,
onde é possível cadastrar, substituir ou remover a chave. O botão
**EXTRAIR DADOS** só fica liberado com a chave informada.

O painel **Funcionamento do agent** roda o diagnóstico de `GET /saude/agent` sob demanda e mostra
o status (**Operacional**, **Degradado** ou **Inoperante**), cada modelo da cadeia e o
resultado do teste de geração. Depois da extração, o painel **Etapas da extração** mostra o
relatório de cada etapa.

O front envia o PDF em `multipart/form-data` (campo `arquivo`) para `POST {VITE_API_URL}/extrair`
e exibe na tela o JSON devolvido.

---

## Critérios de avaliação (1ª etapa)

- 40% — Uso do Agent conforme estrutura
- 30% — Conteúdo do JSON
- 30% — Assertividade na classificação da despesa
