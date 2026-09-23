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

Fluxo: o usuário carrega o PDF da nota fiscal na interface web, aciona o botão
**EXTRAIR DADOS**, o Agent processa o documento e o JSON é exibido na tela.

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
│   ├── main.py                         # FastAPI: POST /extrair
│   ├── models.py                       # Contrato do JSON (Pydantic)
│   ├── agents/
│   │   └── agent1/
│   │       ├── __init__.py
│   │       └── manipulacao_dados.py    # class Agent1 -> extrair_dados(file_path)
│   ├── requirements.txt
│   └── .env
├── frontend/                           # Interface web (TypeScript + React + Vite)
│   ├── src/
│   │   ├── App.tsx                     # Tela de upload do PDF e exibição do JSON
│   │   ├── api.ts                      # Chamada ao endpoint de extração
│   │   └── types.ts                    # Contrato do JSON da nota fiscal
│   └── package.json
├── README.md
└── .gitignore
```

---

## Como executar o back-end

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
# informe a GEMINI_API_KEY em backend/.env
uvicorn main:app --reload
```

A API sobe em `http://localhost:8000` e a documentação interativa em
`http://localhost:8000/docs`.

> Execute o `uvicorn` a partir da pasta `backend/`: é ela que coloca o pacote `agents` no
> caminho de importação.

Variáveis de ambiente:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `GEMINI_API_KEY` | Chave da API do Gemini | — (obrigatória) |
| `GEMINI_MODEL` | Modelo utilizado pelo Agent1 | `gemini-3.8-flash` |

### Endpoint

| Método | Rota | Entrada | Saída |
|--------|------|---------|-------|
| `POST` | `/extrair` | `multipart/form-data`, campo `arquivo` (PDF) | JSON no formato acima |

O `main.py` apenas recebe o arquivo e delega ao agente, conforme a estrutura de Agents:

```python
from agents.agent1.manipulacao_dados import Agent1

agent1 = Agent1()
dados = agent1.extrair_dados(caminho_do_pdf)
```

O `Agent1` envia o PDF ao Gemini com `response_schema` gerado a partir dos modelos Pydantic de
`models.py` — o mesmo contrato declarado em `frontend/src/types.ts` — e a classificação da
despesa é restrita às 9 categorias pela enumeração `CategoriaDespesa`.

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

O front envia o PDF em `multipart/form-data` (campo `arquivo`) para `POST {VITE_API_URL}/extrair`
e exibe na tela o JSON devolvido.

---

## Critérios de avaliação (1ª etapa)

- 40% — Uso do Agent conforme estrutura
- 30% — Conteúdo do JSON
- 30% — Assertividade na classificação da despesa
