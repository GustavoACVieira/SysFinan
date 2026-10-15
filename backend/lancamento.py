"""2ª etapa: analisar a nota extraida e lanca-la como conta a pagar.

1. Analisar: consulta no banco se o FORNECEDOR, o FATURADO e cada DESPESA da nota existem.
2. Lancar: cria o que nao existe, registra o movimento (APAGAR) com suas parcelas e
   informa o sucesso. Tudo numa transacao so: se algo falhar, nada fica gravado.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

import erros
from banco import obter_sessao
from categorias import buscar_equivalente, formatar_nome
from contas import ContaEntrada, ContaSaida, buscar_nota, preencher
from models import NotaFiscalExtraida
from pessoas import buscar_por_documento, formatar_documento
from seguranca import exigir_login
from tabelas import (
    Classificacao,
    MovimentoContas,
    Pessoa,
    Status,
    TipoClassificacao,
    TipoMovimento,
    TipoPessoa,
)

router = APIRouter(
    prefix="/contas", tags=["Lançamento da nota"], dependencies=[Depends(exigir_login)]
)


class ConsultaPessoa(BaseModel):
    razaoSocial: str | None
    documento: str | None
    existe: bool
    id: int | None = None
    status: Status | None = None


class ConsultaDespesa(BaseModel):
    descricao: str
    existe: bool
    id: int | None = None
    status: Status | None = None


class Analise(BaseModel):
    """O que a tela mostra: EXISTE – ID: n / NÃO EXISTE, para cada um."""

    fornecedor: ConsultaPessoa
    faturado: ConsultaPessoa
    despesas: list[ConsultaDespesa]
    contaJaLancada: int | None = Field(
        default=None, description="ID da conta, se esta nota deste fornecedor já foi lançada"
    )


class Lancamento(BaseModel):
    mensagem: str
    conta: ContaSaida


def _consultar_pessoa(
    sessao: Session, tipo: TipoPessoa, razao_social: str | None, documento: str | None
) -> ConsultaPessoa:
    documento = (formatar_documento(documento) or documento) if documento else None
    if documento:
        pessoa = buscar_por_documento(sessao, tipo, documento)
    elif razao_social:
        # Nota sem CPF do faturado: procura pelo nome.
        pessoa = sessao.scalar(
            select(Pessoa).where(Pessoa.tipo == tipo, Pessoa.razaoSocial == razao_social).limit(1)
        )
    else:
        pessoa = None
    return ConsultaPessoa(
        razaoSocial=pessoa.razaoSocial if pessoa else razao_social,
        documento=pessoa.documento if pessoa else documento,
        existe=pessoa is not None,
        id=pessoa.idPessoas if pessoa else None,
        status=pessoa.status if pessoa else None,
    )


def _consultar_despesa(sessao: Session, nome: str) -> ConsultaDespesa:
    existente = buscar_equivalente(sessao, TipoClassificacao.DESPESA, nome)
    if existente is None:
        return ConsultaDespesa(descricao=formatar_nome(nome), existe=False)
    return ConsultaDespesa(
        descricao=existente.descricao,
        existe=True,
        id=existente.idClassificacao,
        status=existente.status,
    )


def analisar_nota(sessao: Session, nota: NotaFiscalExtraida) -> Analise:
    fornecedor = _consultar_pessoa(
        sessao, TipoPessoa.FORNECEDOR, nota.fornecedor.razaoSocial, nota.fornecedor.cnpj
    )
    lancada = (
        buscar_nota(sessao, TipoMovimento.APAGAR, fornecedor.id, nota.numeroNotaFiscal)
        if fornecedor.id and nota.numeroNotaFiscal
        else None
    )
    return Analise(
        fornecedor=fornecedor,
        faturado=_consultar_pessoa(
            sessao, TipoPessoa.FATURADO, nota.faturado.nomeCompleto, nota.faturado.cpf
        ),
        despesas=[_consultar_despesa(sessao, d) for d in dict.fromkeys(nota.tiposDespesa)],
        contaJaLancada=lancada.idMovimentoContas if lancada else None,
    )


def _criar_pessoa(
    sessao: Session,
    tipo: TipoPessoa,
    consulta: ConsultaPessoa,
    papel: str,
    fantasia: str | None = None,
) -> int:
    if not consulta.razaoSocial or not formatar_documento(consulta.documento or ""):
        raise HTTPException(
            status_code=422,
            detail=(
                f"{papel} não cadastrado e a nota não traz nome e CPF/CNPJ válidos para "
                f"cadastrá-lo. Cadastre-o em Pessoas e lance de novo."
            ),
        )
    pessoa = Pessoa(
        tipo=tipo,
        razaoSocial=" ".join(consulta.razaoSocial.split()),
        fantasia=fantasia,
        documento=consulta.documento,
        status=Status.ATIVO,
    )
    sessao.add(pessoa)
    sessao.flush()
    return pessoa.idPessoas


def _criar_despesa(sessao: Session, descricao: str) -> int:
    despesa = Classificacao(
        tipo=TipoClassificacao.DESPESA, descricao=descricao, status=Status.ATIVO
    )
    sessao.add(despesa)
    sessao.flush()
    return despesa.idClassificacao


def _reais(valor: float | None) -> Decimal | None:
    return None if valor is None else round(Decimal(str(valor)), 2)


@router.post("/analisar", response_model=Analise)
def analisar(nota: NotaFiscalExtraida, sessao: Session = Depends(obter_sessao)) -> Analise:
    """Informa se o fornecedor, o faturado e cada despesa da nota já existem no banco."""
    return analisar_nota(sessao, nota)


@router.post("/lancar", response_model=Lancamento, status_code=201)
def lancar(nota: NotaFiscalExtraida, sessao: Session = Depends(obter_sessao)) -> Lancamento:
    """Cria o fornecedor, o faturado e as despesas que não existem e lança a conta a pagar."""
    analise = analisar_nota(sessao, nota)

    id_fornecedor = analise.fornecedor.id or _criar_pessoa(
        sessao, TipoPessoa.FORNECEDOR, analise.fornecedor, "Fornecedor", nota.fornecedor.fantasia
    )
    id_faturado = analise.faturado.id or _criar_pessoa(
        sessao, TipoPessoa.FATURADO, analise.faturado, "Faturado"
    )
    ids_despesas = [d.id or _criar_despesa(sessao, d.descricao) for d in analise.despesas]

    try:
        dados = ContaEntrada(
            tipo=TipoMovimento.APAGAR,
            numeroNotaFiscal=nota.numeroNotaFiscal,
            dataEmissao=nota.dataEmissao,
            descricao="; ".join(nota.descricaoProdutos) or None,
            valorTotal=_reais(nota.valorTotal),
            idFornecedorCliente=id_fornecedor,
            idFaturado=id_faturado,
            idClassificacoes=ids_despesas,
            parcelas=[
                {"dataVencimento": p.dataVencimento, "valorParcela": _reais(p.valor)}
                for p in nota.parcelas
            ],
        )
    except ValidationError as erro:
        raise HTTPException(status_code=422, detail=erros.descrever(erro.errors())) from erro

    conta = MovimentoContas(status=Status.ATIVO)
    preencher(sessao, conta, dados)
    sessao.add(conta)
    sessao.commit()
    return Lancamento(mensagem="Registro lançado com sucesso.", conta=conta)
