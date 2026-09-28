"""Etapas do Agent1: cada uma tem seu esquema Pydantic, sua instrucao e seu verificador.

O agent executa as etapas na ordem de ETAPAS e so passa para a proxima quando a
atual e aprovada pela verificacao (ver verificacao.py).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from models import (
    EsquemaClassificacao,
    EsquemaFinanceiro,
    EsquemaIdentificacao,
    EsquemaProdutos,
)

from .verificacao import (
    Resultado,
    formatar_cnpj,
    formatar_cpf,
    verificar_classificacao,
    verificar_financeiro,
    verificar_identificacao,
    verificar_produtos,
)

# Subcategorias usadas apenas como contexto de classificacao no prompt.
CATEGORIAS = {
    "INSUMOS AGRÍCOLAS": "sementes, fertilizantes, defensivos agrícolas, corretivos",
    "MANUTENÇÃO E OPERAÇÃO": (
        "combustíveis e lubrificantes; peças, parafusos e componentes mecânicos; "
        "manutenção de máquinas e equipamentos; pneus, filtros, correias; "
        "ferramentas e utensílios"
    ),
    "RECURSOS HUMANOS": "mão de obra temporária; salários e encargos",
    "SERVIÇOS OPERACIONAIS": (
        "frete e transporte; colheita terceirizada; secagem e armazenagem; "
        "pulverização e aplicação"
    ),
    "INFRAESTRUTURA E UTILIDADES": (
        "energia elétrica; arrendamento de terras; construções e reformas; "
        "materiais de construção"
    ),
    "ADMINISTRATIVAS": (
        "honorários contábeis, advocatícios e agronômicos; despesas bancárias e financeiras"
    ),
    "SEGUROS E PROTEÇÃO": "seguro agrícola; seguro de ativos (máquinas/veículos); seguro prestamista",
    "IMPOSTOS E TAXAS": "ITR, IPTU, IPVA, INCRA-CCIR",
    "INVESTIMENTOS": (
        "aquisição de máquinas e implementos; de veículos; de imóveis; infraestrutura rural"
    ),
}

BASE = """Você é um agente especialista em notas fiscais eletrônicas brasileiras (DANFE).
A nota fiscal em anexo representa um registro de CONTAS A PAGAR.

A extração é feita em etapas. Nesta etapa, preencha SOMENTE os campos do esquema pedido.
Não invente dados: use apenas o que consta no documento. Se uma informação não constar,
devolva null no campo correspondente.
"""

INSTRUCAO_IDENTIFICACAO = BASE + """
Etapa: IDENTIFICAÇÃO da nota.
- FORNECEDOR é o EMITENTE da nota (bloco "IDENTIFICAÇÃO DO EMITENTE"): razão social,
  nome fantasia (se houver) e CNPJ.
- FATURADO é o DESTINATÁRIO da nota (bloco "DESTINATÁRIO/REMETENTE"): nome e CPF.
- CNPJ no formato 00.000.000/0000-00 e CPF no formato 000.000.000-00.
- numeroNotaFiscal é o número da NF-e como impresso (ex.: 000.084.682).
- dataEmissao no formato YYYY-MM-DD.
"""

INSTRUCAO_PRODUTOS = BASE + """
Etapa: PRODUTOS da nota.
- descricaoProdutos deve conter a descrição de cada item do bloco
  DADOS DOS PRODUTOS/SERVIÇOS, exatamente como está escrita, na ordem da nota.
- Um item por linha da tabela; não inclua códigos, NCM, quantidades nem valores.
"""

INSTRUCAO_FINANCEIRO = BASE + """
Etapa: FINANCEIRO da nota.
- valorTotal é o "VALOR TOTAL DA NOTA".
- Valores como número decimal, usando ponto como separador (ex.: 3086.75).
- As parcelas vêm do bloco FATURA/DUPLICATAS, na ordem dos vencimentos, numeradas a
  partir de 1. Se a nota não tiver esse bloco, devolva uma única parcela com
  valor = valorTotal e a data de vencimento que constar na nota (ou null).
- Datas de vencimento no formato YYYY-MM-DD.
- quantidadeParcelas deve ser igual ao tamanho da lista de parcelas.
"""

INSTRUCAO_CLASSIFICACAO = """Você é um agente especialista em classificação de despesas
de propriedades rurais. Você recebe os dados já extraídos de uma nota fiscal de
CONTAS A PAGAR e deve classificar a despesa.

tiposDespesa NÃO é um campo extraído do documento: interprete-o a partir das descrições
dos produtos (e, como apoio, do ramo do fornecedor), escolhendo entre as categorias:

{categorias}

- Considere a finalidade da compra em uma propriedade rural, não apenas o nome do item.
- Devolva a categoria que melhor representa a nota como um todo (normalmente uma só).
  Inclua mais de uma apenas quando a nota misturar itens de categorias claramente distintas.

Exemplos:
- Compra de óleo diesel -> MANUTENÇÃO E OPERAÇÃO
- Graxa, rolamentos, buchas e peças de reposição -> MANUTENÇÃO E OPERAÇÃO
- Compra de material hidráulico -> INFRAESTRUTURA E UTILIDADES
- Cimento, tijolos, telhas -> INFRAESTRUTURA E UTILIDADES
- Sementes de soja, adubo, herbicida, calcário -> INSUMOS AGRÍCOLAS
- Trator, plantadeira ou caminhão novos -> INVESTIMENTOS
- Frete de grãos -> SERVIÇOS OPERACIONAIS
""".format(
    categorias="\n".join(f"- {nome}: {exemplos}" for nome, exemplos in CATEGORIAS.items())
)


# ---------------------------------------------------------------------------
# Normalizacao: ajustes deterministicos antes de verificar
# ---------------------------------------------------------------------------


def _normalizar_identificacao(dados: EsquemaIdentificacao) -> EsquemaIdentificacao:
    dados.fornecedor.cnpj = formatar_cnpj(dados.fornecedor.cnpj)
    dados.faturado.cpf = formatar_cpf(dados.faturado.cpf)
    return dados


def _normalizar_produtos(dados: EsquemaProdutos) -> EsquemaProdutos:
    dados.descricaoProdutos = [d.strip() for d in dados.descricaoProdutos if d and d.strip()]
    return dados


def _normalizar_financeiro(dados: EsquemaFinanceiro) -> EsquemaFinanceiro:
    for numero, parcela in enumerate(dados.parcelas, start=1):
        parcela.numero = numero
    if len(dados.parcelas) == 1 and dados.parcelas[0].valor is None:
        dados.parcelas[0].valor = dados.valorTotal
    dados.quantidadeParcelas = len(dados.parcelas)
    return dados


def _normalizar_classificacao(dados: EsquemaClassificacao) -> EsquemaClassificacao:
    dados.tiposDespesa = list(dict.fromkeys(dados.tiposDespesa))
    return dados


# ---------------------------------------------------------------------------
# Definicao das etapas
# ---------------------------------------------------------------------------

Contexto = dict[str, Any]  # campos ja aprovados nas etapas anteriores


@dataclass(frozen=True)
class Etapa:
    id: str
    titulo: str
    esquema: type[BaseModel]
    instrucao: str
    usa_pdf: bool  # a classificacao trabalha so com o texto ja extraido
    pedido: Callable[[Contexto], str]
    verificar: Callable[[Any, Contexto], Resultado]
    normalizar: Callable[[Any], Any] = field(default=lambda dados: dados)


def _pedido_classificacao(contexto: Contexto) -> str:
    dados = {
        "fornecedor": contexto["fornecedor"]["razaoSocial"],
        "descricaoProdutos": contexto["descricaoProdutos"],
    }
    return "Classifique a despesa desta nota:\n" + json.dumps(dados, ensure_ascii=False, indent=2)


ETAPAS: tuple[Etapa, ...] = (
    Etapa(
        id="identificacao",
        titulo="Identificação (fornecedor, faturado, número e emissão)",
        esquema=EsquemaIdentificacao,
        instrucao=INSTRUCAO_IDENTIFICACAO,
        usa_pdf=True,
        pedido=lambda _: "Extraia a identificação desta nota fiscal.",
        verificar=lambda dados, _: verificar_identificacao(dados),
        normalizar=_normalizar_identificacao,
    ),
    Etapa(
        id="produtos",
        titulo="Produtos",
        esquema=EsquemaProdutos,
        instrucao=INSTRUCAO_PRODUTOS,
        usa_pdf=True,
        pedido=lambda _: "Extraia a descrição dos produtos desta nota fiscal.",
        verificar=lambda dados, _: verificar_produtos(dados),
        normalizar=_normalizar_produtos,
    ),
    Etapa(
        id="financeiro",
        titulo="Financeiro (parcelas e valor total)",
        esquema=EsquemaFinanceiro,
        instrucao=INSTRUCAO_FINANCEIRO,
        usa_pdf=True,
        pedido=lambda _: "Extraia o valor total e as parcelas desta nota fiscal.",
        # A data de emissao aprovada na etapa 1 serve para conferir os vencimentos.
        verificar=lambda dados, contexto: verificar_financeiro(dados, contexto["dataEmissao"]),
        normalizar=_normalizar_financeiro,
    ),
    Etapa(
        id="classificacao",
        titulo="Classificação da despesa",
        esquema=EsquemaClassificacao,
        instrucao=INSTRUCAO_CLASSIFICACAO,
        usa_pdf=False,
        pedido=_pedido_classificacao,
        verificar=lambda dados, _: verificar_classificacao(dados),
        normalizar=_normalizar_classificacao,
    ),
)

ID_CONSOLIDACAO = "consolidacao"
TITULO_CONSOLIDACAO = "Consolidação (verificação cruzada da nota completa)"
