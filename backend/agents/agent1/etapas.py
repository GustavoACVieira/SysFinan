"""Etapas do Agent1: cada uma tem seu esquema Pydantic, sua instrucao e seu verificador.

O agent executa as etapas na ordem de ETAPAS e so passa para a proxima quando a
atual e aprovada pela verificacao (ver verificacao.py).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from google.genai import types
from pydantic import BaseModel, Field, create_model

import categorias
from models import (
    EsquemaFinanceiro,
    EsquemaIdentificacao,
    EsquemaProdutos,
    NovaCategoria,
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
dos produtos (e, como apoio, do ramo do fornecedor), escolhendo entre as categorias
cadastradas:

{categorias}

- Considere a finalidade da compra em uma propriedade rural, não apenas o nome do item.
- Devolva a categoria que melhor representa a nota como um todo (normalmente uma só).
  Inclua mais de uma apenas quando a nota misturar itens de categorias claramente distintas.

Criação de categoria (exceção, não regra):
- Use SEMPRE uma categoria da lista quando alguma representar a despesa, mesmo que de forma
  aproximada. As categorias são propositalmente amplas.
- Somente se NENHUMA categoria da lista servir, deixe tiposDespesa vazio e preencha
  novaCategoria com um nome curto em MAIÚSCULAS, no estilo das existentes, e uma descrição
  do que entra nela. Em qualquer outro caso, novaCategoria deve ser null.

Exemplos:
- Compra de óleo diesel -> MANUTENÇÃO E OPERAÇÃO
- Graxa, rolamentos, buchas e peças de reposição -> MANUTENÇÃO E OPERAÇÃO
- Compra de material hidráulico -> INFRAESTRUTURA E UTILIDADES
- Cimento, tijolos, telhas -> INFRAESTRUTURA E UTILIDADES
- Sementes de soja, adubo, herbicida, calcário -> INSUMOS AGRÍCOLAS
- Trator, plantadeira ou caminhão novos -> INVESTIMENTOS
- Frete de grãos -> SERVIÇOS OPERACIONAIS
"""


def instrucao_classificacao() -> str:
    """Instrucao com as categorias ativas no momento (padrao + criadas pelo agent)."""
    ativas = categorias.repositorio.ativas()
    return INSTRUCAO_CLASSIFICACAO.format(
        categorias="\n".join(f"- {c.nome}: {c.descricao}" for c in ativas)
    )


def esquema_classificacao() -> type[BaseModel]:
    """Esquema enviado ao Gemini, montado na hora com as categorias ativas.

    As categorias entram como enumeracao: o Gemini so consegue devolver nomes da lista.
    A saida para algo novo e o campo novaCategoria, tratado em _normalizar_classificacao.
    """
    nomes = [c.nome for c in categorias.repositorio.ativas()]
    Opcoes = Enum("CategoriaAtiva", {f"C{i}": nome for i, nome in enumerate(nomes)}, type=str)
    return create_model(
        "EsquemaClassificacao",
        tiposDespesa=(
            list[Opcoes],
            Field(description="Categorias da lista que representam a despesa da nota"),
        ),
        novaCategoria=(
            NovaCategoria | None,
            Field(
                default=None,
                description="Somente se NENHUMA categoria da lista servir; caso contrario, null",
            ),
        ),
    )


class ClassificacaoVerificada(BaseModel):
    """Classificacao depois da normalizacao: o que a verificacao da etapa recebe."""

    tiposDespesa: list[str]
    novaCategoria: NovaCategoria | None = None
    # Apenas para a verificacao; nao seguem para a nota.
    categoriaInativa: str | None = Field(default=None, exclude=True)
    observacoes: list[str] = Field(default_factory=list, exclude=True)


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


def _normalizar_classificacao(dados: Any) -> ClassificacaoVerificada:
    """Converte a resposta do Gemini e resolve a categoria nova, se ele propos uma.

    - equivalente a uma existente e ativa ("Combustiveis" x "COMBUSTIVEL"): usa a existente;
    - equivalente a uma inativada pelo admin: marca, e a verificacao reprova a etapa;
    - nota ja classificada em categorias existentes: descarta a proposta, por cautela.
    """
    tipos = [t.value if isinstance(t, Enum) else str(t) for t in dados.tiposDespesa]
    resultado = ClassificacaoVerificada(tiposDespesa=list(dict.fromkeys(tipos)))
    proposta = dados.novaCategoria
    if proposta is None or not proposta.nome.strip():
        return resultado

    nome = categorias.formatar_nome(proposta.nome)
    if resultado.tiposDespesa:
        resultado.observacoes.append(
            f"O agent sugeriu a categoria “{nome}”, mas a nota já se enquadra em categorias "
            "existentes; nada foi criado."
        )
        return resultado

    existente = categorias.repositorio.buscar(nome)
    if existente is None:
        resultado.novaCategoria = NovaCategoria(nome=nome, descricao=proposta.descricao.strip())
        resultado.tiposDespesa.append(nome)
    elif existente.ativa:
        resultado.observacoes.append(
            f"A categoria sugerida “{nome}” já existe como “{existente.nome}”; foi usada a existente."
        )
        resultado.tiposDespesa.append(existente.nome)
    else:
        resultado.categoriaInativa = existente.nome
    return resultado


# ---------------------------------------------------------------------------
# Definicao das etapas
# ---------------------------------------------------------------------------

Contexto = dict[str, Any]  # campos ja aprovados nas etapas anteriores


@dataclass(frozen=True)
class Etapa:
    id: str
    titulo: str
    # Funcoes, e nao valores fixos: a classificacao monta os dois na hora, com as
    # categorias ativas naquele momento.
    esquema: Callable[[], type[BaseModel]]
    instrucao: Callable[[], str]
    usa_pdf: bool  # a classificacao trabalha so com o texto ja extraido
    pedido: Callable[[Contexto], str]
    verificar: Callable[[Any, Contexto], Resultado]
    normalizar: Callable[[Any], Any] = field(default=lambda dados: dados)
    # Quanto o Gemini 3 "pensa" antes de responder. MEDIUM equilibra cuidado e tempo: o
    # padrao dele (HIGH) deixava a extracao lenta e LOW pensava pouco para a classificacao.
    pensamento: types.ThinkingLevel = types.ThinkingLevel.MEDIUM


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
        esquema=lambda: EsquemaIdentificacao,
        instrucao=lambda: INSTRUCAO_IDENTIFICACAO,
        usa_pdf=True,
        pedido=lambda _: "Extraia a identificação desta nota fiscal.",
        verificar=lambda dados, _: verificar_identificacao(dados),
        normalizar=_normalizar_identificacao,
    ),
    Etapa(
        id="produtos",
        titulo="Produtos",
        esquema=lambda: EsquemaProdutos,
        instrucao=lambda: INSTRUCAO_PRODUTOS,
        usa_pdf=True,
        pedido=lambda _: "Extraia a descrição dos produtos desta nota fiscal.",
        verificar=lambda dados, _: verificar_produtos(dados),
        normalizar=_normalizar_produtos,
    ),
    Etapa(
        id="financeiro",
        titulo="Financeiro (parcelas e valor total)",
        esquema=lambda: EsquemaFinanceiro,
        instrucao=lambda: INSTRUCAO_FINANCEIRO,
        usa_pdf=True,
        pedido=lambda _: "Extraia o valor total e as parcelas desta nota fiscal.",
        # A data de emissao aprovada na etapa 1 serve para conferir os vencimentos.
        verificar=lambda dados, contexto: verificar_financeiro(dados, contexto["dataEmissao"]),
        normalizar=_normalizar_financeiro,
    ),
    Etapa(
        id="classificacao",
        titulo="Classificação da despesa",
        esquema=esquema_classificacao,
        instrucao=instrucao_classificacao,
        usa_pdf=False,
        pedido=_pedido_classificacao,
        verificar=lambda dados, _: verificar_classificacao(dados),
        normalizar=_normalizar_classificacao,
    ),
)

ID_CONSOLIDACAO = "consolidacao"
TITULO_CONSOLIDACAO = "Consolidação (verificação cruzada da nota completa)"
