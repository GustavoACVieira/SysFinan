# SysFinan — Projeto Administrativo-Financeiro

Sistema administrativo-financeiro desenvolvido para a disciplina **ESW424 — Prática de
Engenharia de Software** (Universidade de Rio Verde).

A avaliação N2 é dividida em duas etapas:

| Etapa | Entrega | Peso |
|-------|------------|------|
| 1ª etapa | 29/09/2026 | 35% |
| 2ª etapa | 27/10/2026 | 45% |

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

## Etapa 1 — extração

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
| 4 | Classificação | `EsquemaClassificacao` | Ao menos uma categoria ativa, ou uma nova válida (feita só com o texto já extraído, sem reenviar o PDF) |
| 5 | Consolidação | `NotaFiscalExtraida` | Redundância: repete todas as verificações sobre a nota montada e revalida o JSON final contra o esquema completo |

Redundância e verificação (`backend/agents/agent1/verificacao.py`):

- Se uma etapa é reprovada, o Agent a **refaz informando ao modelo os motivos da reprovação**
  (até 2 tentativas). Se continuar reprovada, o pipeline para ali e as etapas seguintes
  ficam como *não executadas*.
- Pontos que não impedem a etapa (ex.: dígitos verificadores de CNPJ/CPF que não conferem,
  comuns em notas de teste) viram **avisos** no relatório.
- Cada chamada percorre a cadeia de modelos (3.5 Flash-Lite → 3.1 Flash-Lite → 3.5 Flash): se o preferido
  estiver sobrecarregado (HTTP 5xx), sem cota (HTTP 429 — a cota do Gemini é separada por
  modelo) ou não responder em 90 s, usa o próximo. Só um modelo atende cada chamada.

Desempenho:

- Raciocínio (`thinking_level`) `MEDIUM` em todas as etapas: o padrão do Gemini 3 (`HIGH`)
  deixava a extração lenta, e `LOW` pensava pouco para a classificação.
- Quando um modelo reserva atende, as chamadas seguintes começam por ele durante 5 minutos,
  em vez de esbarrar de novo no preferido que acabou de falhar.
- Não há repetição no mesmo modelo: um modelo sobrecarregado demora para devolver o 503, e
  repetir nele só dobraria a espera — a cadeia de reservas é quem dá a resiliência.

> **Cota do plano gratuito:** 20 requisições por dia **por modelo**. Cada extração faz ao
> menos 4 (uma por etapa com IA), então a cadeia de 4 modelos comporta cerca de 20 extrações
> por dia. Para uso contínuo, ative o faturamento no Google AI Studio.

Documento que não é nota fiscal:

- Antes de chamar o Gemini, o texto embutido do PDF (via `pypdf`) é conferido em busca de
  termos que toda nota traz ("DANFE", "NOTA FISCAL", "CHAVE DE ACESSO"...). Sem eles, a
  extração para na hora, sem gastar cota.
- PDF escaneado (sem texto) segue para a etapa de identificação, que também pergunta ao Gemini
  se o documento é uma nota fiscal (campo `ehNotaFiscal`, fora do JSON final).
- Nos dois casos o agent levanta `DocumentoInvalido` e a API responde `422` com a mensagem
  "O arquivo enviado não é uma nota fiscal (DANFE)". Arquivo que nem é PDF recebe `400`.

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

### Categorias criadas pelo agent

As categorias são as classificações do tipo `DESPESA` em `C002_CLASSIFICACAO`: as 9 padrão
entram no banco na primeira subida e o agent usa as que estiverem ativas. Além delas, o agent
pode **criar uma categoria nova** — como exceção, quando nenhuma categoria ativa representa a
despesa. A partir daí ela vale para as próximas notas e entra na lista enviada ao Gemini
(no prompt, as 9 padrão vão com exemplos; as criadas, só com o nome).

- **Onde fica:** no banco. Todo acesso do agent passa por `RepositorioCategorias`
  (`backend/categorias.py`).
- **Só no lançamento:** a extração apenas **sugere** a categoria (em `categoriaCriada`); ela é
  criada no banco quando a nota é lançada (2ª etapa). Extração que falhou ou não foi lançada não
  deixa categoria para trás.
- **Sem duplicatas:** nomes são comparados sem acento, pontuação ou plural — "Combustíveis",
  "COMBUSTIVEL" e "combustível" são a mesma categoria, e a existente é reaproveitada.
- **Por cautela:** se o agent já enquadrou a nota em alguma categoria existente, uma sugestão de
  categoria nova é descartada (e registrada como aviso).
- **Inativar/reativar:** pela tela **Tipos de despesa** (menu Classificação) ou pelas rotas `/classificacoes`
  — seguindo a regra de que cadastros não se excluem. Uma categoria inativa, padrão ou criada,
  sai das opções do agent e **não pode ser recriada** por ele.

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

## Etapa 2 — análise e lançamento da nota

Depois da extração, o JSON da nota (formato acima) é enviado para:

1. **`POST /contas/analisar`** — consulta no banco e informa, para a tela:
   - **FORNECEDOR**: procurado pelo CNPJ entre as pessoas do tipo FORNECEDOR;
   - **FATURADO**: procurado pelo CPF entre as do tipo FATURADO (sem CPF na nota, pelo nome);
   - **DESPESA**: cada classificação da nota, entre as do tipo DESPESA (sem acento/plural).

   ```json
   {
     "fornecedor": { "razaoSocial": "IGUAÇU MAQUINAS LTDA", "documento": "11.111.111/0001-00", "existe": false, "id": null, "status": null },
     "faturado": { "razaoSocial": "BELTRANO DA SILVA", "documento": "999.999.999-99", "existe": true, "id": 19, "status": "ATIVO" },
     "despesas": [{ "descricao": "MANUTENÇÃO E OPERAÇÃO", "existe": true, "id": 22, "status": "ATIVO" }],
     "contaJaLancada": null
   }
   ```

   `status` mostra se o cadastro encontrado está INATIVO (não pode ser usado no lançamento) e
   `contaJaLancada` traz o ID da conta, se esta nota deste fornecedor já foi lançada.

2. **`POST /contas/lancar`** — numa transação só:
   1. cria o FORNECEDOR, se não existir;
   2. cria o FATURADO, se não existir;
   3. cria as DESPESAS que não existirem;
   4. cria o movimento (`T001_MOVIMENTOCONTAS`, tipo APAGAR) e suas parcelas
      (`T002_PARCELACONTAS`, identificação `ÚNICA` quando há uma), ligado às despesas
      (`R001_T001_C002`);
   5. responde `{ "mensagem": "Registro lançado com sucesso.", "conta": { ... } }`.

   A conta passa pelas mesmas regras do `POST /contas` (vencimentos distintos, soma das parcelas
   igual ao total...). Se algo falhar, a resposta é `422` com o motivo e **nada** fica gravado.

### Na tela (Lançar nota fiscal)

Assim que a extração termina, o painel **Análise no banco de dados** chama `/contas/analisar` e
mostra, como no enunciado:

```
FORNECEDOR                    FATURADO                  DESPESA
IGUAÇU MAQUINAS LTDA          BELTRANO DA SILVA         MANUTENÇÃO E OPERAÇÃO
CNPJ: 11.111.111/0001-00      CPF: 999.999.999-99       EXISTE – ID: 22
NÃO EXISTE (vermelho)         EXISTE – ID: 19
```

Abaixo, a lista do que o lançamento vai fazer (cadastrar o que não existe, usar o que existe e
registrar a conta com suas parcelas) e o botão **Lançar registro**. Ao lançar, a tela informa
**"Registro lançado com sucesso."** com os IDs da conta, do fornecedor, do faturado, das
despesas (marcando o que foi cadastrado agora) e as parcelas, e um atalho para a conta em
**Contas a pagar**.

- Cadastro encontrado mas **INATIVO**: aparece com o botão **Reativar**; o lançamento só é
  liberado depois de reativá-lo.
- Nota **já lançada** para o mesmo fornecedor: aviso com o ID da conta e o botão fica bloqueado,
  para não pagar em dobro.
- A categoria nova sugerida pelo agent aparece em DESPESA como NÃO EXISTE, com a descrição
  sugerida, e é cadastrada no lançamento.

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
│   ├── seguranca.py                    # Login do admin e sessões (token Bearer, inatividade)
│   ├── banco.py                        # Conexão com o MySQL (SQLAlchemy) e sessões
│   ├── tabelas.py                      # Tabelas do banco e seed das categorias padrão
│   ├── crud.py                         # Listar/buscar, inativar e reativar (comum aos cadastros)
│   ├── pessoas.py                      # Manter Pessoas: rotas /pessoas
│   ├── classificacoes.py               # Manter Classificação: rotas /classificacoes
│   ├── contas.py                       # Registrar Contas a pagar/receber: rotas /contas
│   ├── erros.py                        # Erros de validação (422) em português
│   ├── lancamento.py                   # 2ª etapa: analisar e lançar a nota extraída
│   ├── sql/criar_banco.sql             # Cria o schema e o usuário no MySQL (rodar no Workbench)
│   ├── categorias.py                   # Categorias de despesa do agent (RepositorioCategorias)
│   ├── agents/
│   │   └── agent1/
│   │       ├── __init__.py
│   │       ├── manipulacao_dados.py    # class Agent1 -> extrair_dados(file_path)
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
│   │   ├── App.tsx                     # Login ou área logada: menu lateral e telas (#endereço)
│   │   ├── Login.tsx                   # Tela de login
│   │   ├── Marca.tsx                   # Símbolo da marca em SVG (cores seguem o tema do app)
│   │   ├── ChaveApi.tsx                # Janela de cadastro da chave do Gemini
│   │   ├── Janela.tsx                  # Janela modal reutilizável (<dialog>)
│   │   ├── Confirmacao.tsx             # Janela de confirmação (exclusão lógica)
│   │   ├── Cabecalho.tsx               # Título e subtítulo de cada tela (e o "← Voltar")
│   │   ├── Extracao.tsx                # Upload do PDF, JSON extraído e análise da nota
│   │   ├── AnaliseNota.tsx             # 2ª etapa: EXISTE/NÃO EXISTE no banco e lançamento
│   │   ├── Etapas.tsx                  # Relatório das etapas (painel desativado no Extracao.tsx)
│   │   ├── Listagem.tsx                # Tabela dos cadastros: busca, Todos, Inativos, ordenação
│   │   ├── Pessoas.tsx                 # Manter Pessoas: fornecedores, clientes e faturados
│   │   ├── Classificacoes.tsx          # Manter Classificação: tipos de receita e de despesa
│   │   ├── Contas.tsx                  # Registrar Contas: a pagar e a receber, com parcelas
│   │   ├── formatos.ts                 # Datas, R$, máscara de CPF/CNPJ e vencimentos
│   │   ├── useInatividade.ts           # Logout por inatividade (aviso e renovação da sessão)
│   │   ├── api.ts                      # Chamadas à API (com o token da sessão)
│   │   └── types.ts                    # Contratos da nota fiscal, cadastros, contas e análise
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
| Variáveis | `DATABASE_URL`, `FRONTEND_URL` e, opcionalmente, `GEMINI_MODEL`, `SYSFINAN_USUARIO`, `SYSFINAN_SENHA` |

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

> A chave da API não é salva em lugar nenhum: é informada pela tela a cada vez que o servidor
> sobe e fica só na memória. As sessões de login também são perdidas quando o serviço
> gratuito hiberna — basta entrar de novo.

---

## Configurar o banco (MySQL)

A API precisa de um **MySQL Server 8** (o Workbench é só o cliente):

1. Instale o servidor pelo **MySQL Installer for Windows**
   (<https://dev.mysql.com/downloads/installer/>): *MySQL Server 8.x*, Standalone, porta
   `3306`, *Use Strong Password Encryption*, defina a senha do `root` e deixe rodando como
   serviço do Windows (`MySQL80`).
2. No **MySQL Workbench**, crie uma conexão em `localhost:3306` com o usuário `root`, abra
   `backend/sql/criar_banco.sql`, troque a senha de exemplo e execute (⚡). O script cria o
   schema `sysfinan` (utf8mb4) e o usuário `sysfinan`, com acesso só a esse schema.
3. Em `backend/.env`, informe a conexão:

   ```
   DATABASE_URL=mysql+pymysql://sysfinan:<senha>@localhost:3306/sysfinan?charset=utf8mb4
   ```

As tabelas são criadas pela própria API ao subir (`banco.criar_tabelas`), sem script manual.
Para ver o diagrama no Workbench: *Database → Reverse Engineer* no schema `sysfinan`.

### Tabelas

Definidas em `backend/tabelas.py`. Padrão de nomes, cada prefixo com sua própria contagem:

| Prefixo | Uso |
|---------|-----|
| `Exxx` | Domínio: valores fixos de um tipo ou status |
| `Cxxx` | Cadastro |
| `Txxx` | Transação |
| `Rxxx_<tabela>_<tabela>` | Relacionamento N:N entre as duas tabelas do nome |

| Tabela | Campos |
|--------|--------|
| `E001_TIPO_PESSOA` | `idTipoPessoa`, `descricao`: 1 CLIENTE, 2 FORNECEDOR, 3 FATURADO |
| `E002_TIPO_CLASSIFICACAO` | `idTipoClassificacao`, `descricao`: 1 RECEITA, 2 DESPESA |
| `E003_TIPO_MOVIMENTO` | `idTipoMovimento`, `descricao`: 1 APAGAR, 2 ARECEBER |
| `E004_STATUS` | `idStatus`, `descricao`: 1 ATIVO, 2 INATIVO |
| `C001_PESSOAS` | `idPessoas`, `idTipoPessoa`, `razaoSocial`, `fantasia`, `documento` (CNPJ/CPF), `idStatus` |
| `C002_CLASSIFICACAO` | `idClassificacao`, `idTipoClassificacao`, `descricao`, `idStatus` |
| `T001_MOVIMENTOCONTAS` | `idMovimentoContas`, `idTipoMovimento`, `numeroNotaFiscal`, `dataEmissao`, `descricao`, `valorTotal`, `idFornecedorCliente`, `idFaturado`, `idStatus` |
| `T002_PARCELACONTAS` | `idParcelaContas`, `idMovimentoContas`, `identificacao` (ÚNICA, 1/3...), `dataVencimento`, `valorParcela` — vencimentos distintos por movimento |
| `R001_T001_C002` | `idMovimentoContas`, `idClassificacao` — um movimento em um ou mais tipos de despesa/receita |

Cadastros não são excluídos: o `idStatus` passa para INATIVO. Ao subir, a API grava os valores
dos domínios e, na primeira vez, as 9 categorias padrão em `C002_CLASSIFICACAO` como `DESPESA`.

> No Windows, o MySQL guarda os nomes das tabelas em minúsculas (`lower_case_table_names=1`),
> então o Workbench mostra `c001_pessoas`. No Linux (hospedagem) ficam como definidos.

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
| `DATABASE_URL` | Conexão com o banco (ver "Configurar o banco"). Obrigatória: sem ela a API não sobe | — |
| `GEMINI_MODEL` | Modelo(s) preferido(s) do Agent1, separados por vírgula, na frente da cadeia padrão. Deixe vazio para usar só a cadeia padrão | `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.5-flash` |
| `SYSFINAN_USUARIO` | Usuário do login | `admin` |
| `SYSFINAN_SENHA` | Senha do login | `cruzeiro` |
| `SYSFINAN_INATIVIDADE_MIN` | Minutos sem uso que encerram a sessão (logout por inatividade) | `30` |
| `FRONTEND_URL` | URLs do front liberadas no CORS, separadas por vírgula (no Render, a URL pública do front) | `http://localhost:5173,http://127.0.0.1:5173` |

### Endpoints

Todas as rotas, exceto `/login`, `/health` e `/versao`, exigem o cabeçalho `Authorization: Bearer <token>`. As sessões
ficam em memória; reiniciar o servidor exige novo login. Uma sessão acaba no que vier primeiro:

- **Inatividade:** `SYSFINAN_INATIVIDADE_MIN` minutos (padrão 30) sem nenhuma requisição autenticada.
  Cada requisição renova o prazo.
- **Limite absoluto:** 8 horas depois do login, mesmo com uso contínuo.

O `401` traz o motivo em `detail` ("Sessão encerrada por inatividade..." ou "Sessão expirada...").

| Método | Rota | Entrada | Saída |
|--------|------|---------|-------|
| `GET` | `/health` | — | `{ "status": "ok" }` (health check leve, sem chamar o Gemini) |
| `GET` | `/versao` | — | `{ "commit", "alterado" }`: commit em execução (no Render, o do deploy) |
| `POST` | `/login` | JSON `{ "usuario", "senha" }` | `{ "token", "inatividadeSegundos" }` |
| `POST` | `/logout` | — | `204` |
| `POST` | `/sessao/renovar` | — | `204`: renova o prazo de inatividade (o front chama enquanto há uso na tela) |
| `GET` | `/chave-api` | — | `{ "informada": bool, "mascara": "••••abcd" \| null }` |
| `PUT` | `/chave-api` | JSON `{ "chave" }` | Confere a chave no Google (sem gastar cota) e só então a ativa, em memória. `400` se o Google recusar, `503` se não der para verificar |
| `DELETE` | `/chave-api` | — | situação da chave |
| `GET` | `/categorias` | — | Categorias de despesa (padrão e criadas, ativas e inativas). O front usa `/classificacoes` (tela Tipos de despesa) |
| `PUT` | `/categorias/situacao` | JSON `{ "nome", "ativa" }` | Categoria atualizada (inativa ou reativa) |
| `POST` | `/extrair` | `multipart/form-data`, campo `arquivo` (PDF) | `{ "concluida", "etapas": [...], "dados": <JSON no formato acima> \| null }` |
| `GET` | `/pessoas` | Query `busca`, `tipo`, `status`, `ordem`, `direcao` | Lista de pessoas (sem `status`, só as ATIVAS) |
| `GET` | `/pessoas/{id}` | — | Pessoa |
| `POST` | `/pessoas` | JSON `{ "tipo", "razaoSocial", "fantasia", "documento" }` | Pessoa criada, sempre ATIVA (`201`); `409` se o documento já existe para o tipo |
| `PUT` | `/pessoas/{id}` | Mesmo JSON do `POST` | Pessoa editada (o status não muda) |
| `DELETE` | `/pessoas/{id}` | — | Pessoa INATIVA (exclusão lógica) |
| `PUT` | `/pessoas/{id}/reativar` | — | Pessoa ATIVA de novo |
| `GET` | `/classificacoes` | Query `busca`, `tipo`, `status`, `ordem`, `direcao` | Lista de classificações (sem `status`, só as ATIVAS) |
| `GET` | `/classificacoes/{id}` | — | Classificação |
| `POST` | `/classificacoes` | JSON `{ "tipo", "descricao" }` | Classificação criada, sempre ATIVA (`201`); `409` se já existe uma equivalente do mesmo tipo |
| `PUT` | `/classificacoes/{id}` | Mesmo JSON do `POST` | Classificação editada (o status não muda) |
| `DELETE` | `/classificacoes/{id}` | — | Classificação INATIVA (exclusão lógica) |
| `PUT` | `/classificacoes/{id}/reativar` | — | Classificação ATIVA de novo |
| `GET` | `/contas` | Query `busca`, `tipo` (APAGAR/ARECEBER), `status`, `ordem`, `direcao` | Contas com pessoas, classificações e parcelas (sem `status`, só as ATIVAS) |
| `GET` | `/contas/{id}` | — | Conta |
| `POST` | `/contas` | JSON abaixo | Conta registrada, sempre ATIVA (`201`); `422` se quebrar alguma regra |
| `PUT` | `/contas/{id}` | Mesmo JSON do `POST` | Conta editada: substitui classificações e parcelas (o status não muda) |
| `DELETE` | `/contas/{id}` | — | Conta INATIVA (exclusão lógica) |
| `PUT` | `/contas/{id}/reativar` | — | Conta ATIVA de novo |
| `POST` | `/contas/analisar` | JSON da nota extraída | Fornecedor, faturado e despesas: `existe` e `id` de cada um (ver "Etapa 2") |
| `POST` | `/contas/lancar` | JSON da nota extraída | Cria o que falta e lança a conta a pagar (`201`); `422` sem gravar nada se algo falhar |

**Cadastros** (`/pessoas` e os próximos) seguem o mesmo padrão, em `backend/crud.py`:

- **Busca por mais de um termo:** `busca=iguacu maquinas` traz quem tem os dois termos, cada um
  em qualquer dos campos pesquisados. CPF/CNPJ pode ser digitado com ou sem máscara.
- **TODOS:** sem `status`, a lista traz só os ATIVOS; `status=INATIVO` mostra os inativos.
- **Ordenação por coluna:** `ordem=<campo>` e `direcao=asc|desc`.
- **Status nunca vem do formulário:** o `POST` grava ATIVO e o `PUT` não o altera; só o
  `DELETE` (inativa) e o `/reativar` mexem nele.

**Registrar conta** (`POST /contas`):

```json
{
  "tipo": "APAGAR",
  "numeroNotaFiscal": "000.084.682",
  "dataEmissao": "2025-09-19",
  "descricao": "GRAXA DE POLIUREIA MP SD 400G; KIT DA BUCHA",
  "valorTotal": 3086.75,
  "idFornecedorCliente": 1,
  "idFaturado": 2,
  "idClassificacoes": [2],
  "parcelas": [{ "dataVencimento": "2025-10-17", "valorParcela": 3086.75 }]
}
```

- Conta a pagar: `idFornecedorCliente` é um FORNECEDOR e as classificações são DESPESAS.
  Conta a receber: um CLIENTE e RECEITAS. `idFaturado` é sempre um FATURADO.
- Uma ou mais classificações e uma ou mais parcelas, com **datas de vencimento distintas**.
- A soma das parcelas precisa ser igual ao `valorTotal`.
- Pessoas e classificações **INATIVAS não podem ser usadas** (`422`); reative o cadastro antes.
- A mesma nota (`numeroNotaFiscal`) da mesma pessoa só pode ser registrada uma vez (`409`),
  para não pagar ou cobrar em dobro.
- A `identificacao` da parcela é gerada: `ÚNICA` quando há uma; `1/3`, `2/3`, `3/3`... em ordem
  de vencimento quando há mais.

Erros de validação (`422`) vêm em português, num texto só em `detail`, com o campo e o
problema — ex.: `"parcelas nº 1 › valorParcela: use no máximo 2 casas decimais"`.

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
declarado em `frontend/src/types.ts`. Na classificação, o esquema é montado na hora com as
categorias ativas como enumeração: o Gemini só consegue devolver nomes da lista, e a única
saída para algo novo é o campo `novaCategoria`.

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
um menu lateral leva às telas, agrupadas como no enunciado (no celular, ele abre pelo botão
**Menu**). Cada tela tem seu endereço (`#fornecedores`, `#contas-pagar`...), então o voltar do
navegador funciona:

| Grupo | Telas |
|-------|-------|
| Lançamento | **Lançar nota fiscal** — extração (1ª etapa), análise e lançamento (2ª etapa) |
| Pessoas (Manter Pessoas) | **Fornecedores**, **Clientes**, **Faturados** |
| Classificação (Manter Classificação) | **Tipos de receita**, **Tipos de despesa** |
| Contas (Registrar Contas) | **Contas a pagar**, **Contas a receber** |

A extração continua montada ao trocar de tela: o resultado (e uma extração em andamento) não se
perde ao consultar um cadastro e voltar.

### Telas de cadastro e de contas

Seguem a recomendação de layout do enunciado:

- **Tabela vazia ao abrir.** Os registros só carregam pela **Busca** ou por **Todos**.
- **Todos** traz os registros com status ATIVO.
- **Busca por mais de um elemento:** os termos separados por espaço precisam aparecer todos
  (ex.: `iguacu maquinas`); CPF/CNPJ pode ser digitado sem máscara.
- **Indexação por coluna:** clicar no título sublinhado ordena por ela (▲/▼), no back-end.
- **Duas ações na tabela: Editar / Excluir.** O Excluir é lógico: pede confirmação e muda o
  status para INATIVO.
- **Status oculto** no formulário: o cadastro grava ATIVO e a edição não mexe nele.
- **Reativar:** o botão **Inativos** lista os registros inativos (com a busca, se houver), e
  neles a ação passa a ser **Reativar**.

No formulário de conta, o fornecedor (ou cliente) e o faturado são escolhidos entre os ativos.
As classificações são marcadas (uma ou mais) e as parcelas são linhas com vencimento e valor:
**+ Adicionar parcela** sugere o mês seguinte e **Dividir o total igualmente** reparte o valor.
A soma é conferida com o total enquanto se digita, e o back-end valida tudo de novo ao salvar.

### Logout por inatividade

O front acompanha mouse, teclado, rolagem e toque. Parado, mostra no último minuto o aviso
**"Sem atividade: você será desconectado em N s"** com o botão **Continuar conectado** (qualquer
movimento também cancela) e, esgotado o prazo, sai e mostra na tela de login *"Sessão encerrada
por inatividade"*. Enquanto há uso sem requisições (ex.: lendo uma tela), ele renova a sessão no
back-end no máximo uma vez por minuto. O front encerra um pouco antes do back-end (1 min), para o
aviso nunca prometer um tempo que o servidor já não dá.

A última atividade fica no `localStorage`, compartilhada entre as abas, e vale também ao reabrir:
fechar o navegador e voltar depois do prazo exige novo login.

### Chave da API e versão

O botão **Chave API**, no rodapé do menu, mostra a situação da chave (bolinha verde = **Ativa**,
vermelha = **Não informada**). Ao clicar, abre uma janela com os 4 últimos caracteres da chave,
onde é possível cadastrar, substituir ou remover a chave. O botão
**EXTRAIR DADOS** só fica liberado com a chave informada.

Abaixo do botão **Entrar** aparece a versão: o commit do GitHub em que o front e a API estão
rodando (no Render, o do deploy, via `RENDER_GIT_COMMIT`), como texto. Se front e
API estiverem em commits diferentes, aparece o aviso "versões diferentes". Localmente, um `*`
indica alterações ainda não commitadas.

Se alguma etapa for reprovada, a tela mostra em qual etapa a extração parou e por quê. O
relatório completo das etapas continua na resposta da API (`etapas`); o painel que o exibia
está comentado em `Extracao.tsx`.

O front envia o PDF em `multipart/form-data` (campo `arquivo`) para `POST {VITE_API_URL}/extrair`,
exibe na tela o JSON devolvido e, em seguida, a análise no banco (ver "Etapa 2").

---

## Critérios de avaliação (1ª etapa)

- 40% — Uso do Agent conforme estrutura
- 30% — Conteúdo do JSON
- 30% — Assertividade na classificação da despesa
