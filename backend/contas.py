"""Registrar Contas: contas a pagar e a receber (T001_MOVIMENTOCONTAS + T002_PARCELACONTAS).

Regras:
- conta a pagar: uma ou mais classificacoes do tipo DESPESA;
- conta a receber: uma ou mais classificacoes do tipo RECEITA;
- uma ou mais parcelas, com datas de vencimento distintas;
- a soma das parcelas e igual ao valor total;
- pessoas e classificacoes INATIVAS nao podem ser usadas;
- a mesma nota da mesma pessoa so pode ser registrada uma vez.
"""

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

import crud
from banco import obter_sessao
from classificacoes import ClassificacaoSaida
from pessoas import PessoaSaida
from seguranca import exigir_login
from tabelas import (
    Classificacao,
    MovimentoContas,
    ParcelaContas,
    Pessoa,
    Status,
    TipoClassificacao,
    TipoMovimento,
    TipoPessoa,
)

router = APIRouter(prefix="/contas", tags=["Contas"], dependencies=[Depends(exigir_login)])

NAO_ENCONTRADA = "Conta não encontrada."

# O que cada tipo de conta exige da pessoa e das classificacoes.
PESSOA_DO_TIPO = {TipoMovimento.APAGAR: TipoPessoa.FORNECEDOR, TipoMovimento.ARECEBER: TipoPessoa.CLIENTE}
CLASSIFICACAO_DO_TIPO = {
    TipoMovimento.APAGAR: TipoClassificacao.DESPESA,
    TipoMovimento.ARECEBER: TipoClassificacao.RECEITA,
}

Valor = Decimal  # entrada com no maximo 2 casas, como a coluna DECIMAL(12,2)


def _reais(valor: Decimal) -> str:
    return f"{valor:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


class ParcelaEntrada(BaseModel):
    dataVencimento: date
    valorParcela: Valor = Field(gt=0, max_digits=12, decimal_places=2)


class ContaEntrada(BaseModel):
    """Sem status: o CREATE grava ATIVO e o UPDATE nao o altera."""

    tipo: TipoMovimento
    numeroNotaFiscal: str | None = Field(default=None, max_length=20)
    dataEmissao: date
    descricao: str | None = None
    valorTotal: Valor = Field(gt=0, max_digits=12, decimal_places=2)
    idFornecedorCliente: int = Field(description="FORNECEDOR na conta a pagar; CLIENTE na a receber")
    idFaturado: int
    idClassificacoes: list[int] = Field(
        min_length=1, description="DESPESAS na conta a pagar; RECEITAS na a receber"
    )
    parcelas: list[ParcelaEntrada] = Field(min_length=1)

    @field_validator("idClassificacoes")
    @classmethod
    def _sem_repetidas(cls, ids: list[int]) -> list[int]:
        return list(dict.fromkeys(ids))

    @field_validator("parcelas")
    @classmethod
    def _vencimentos_distintos(cls, parcelas: list[ParcelaEntrada]) -> list[ParcelaEntrada]:
        datas = [p.dataVencimento for p in parcelas]
        if len(set(datas)) != len(datas):
            raise ValueError("As parcelas devem ter datas de vencimento distintas.")
        return sorted(parcelas, key=lambda p: p.dataVencimento)

    @model_validator(mode="after")
    def _soma_igual_ao_total(self) -> "ContaEntrada":
        soma = sum(p.valorParcela for p in self.parcelas)
        if soma != self.valorTotal:
            raise ValueError(
                f"A soma das parcelas (R$ {_reais(soma)}) é diferente do "
                f"valor total (R$ {_reais(self.valorTotal)})."
            )
        return self


class ParcelaSaida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    idParcelaContas: int
    identificacao: str
    dataVencimento: date
    valorParcela: float


class ContaSaida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    idMovimentoContas: int
    tipo: TipoMovimento
    numeroNotaFiscal: str | None
    dataEmissao: date
    descricao: str | None
    valorTotal: float
    status: Status
    fornecedorCliente: PessoaSaida
    faturado: PessoaSaida
    classificacoes: list[ClassificacaoSaida]
    parcelas: list[ParcelaSaida]


def identificar_parcelas(vencimentos: list[tuple[date, Decimal]]) -> list[ParcelaContas]:
    """ÚNICA quando ha uma parcela; 1/3, 2/3, 3/3... quando ha mais (em ordem de vencimento)."""
    total = len(vencimentos)
    return [
        ParcelaContas(
            identificacao="ÚNICA" if total == 1 else f"{numero}/{total}",
            dataVencimento=data,
            valorParcela=valor,
        )
        for numero, (data, valor) in enumerate(sorted(vencimentos), start=1)
    ]


def _pessoa(sessao: Session, id_pessoa: int, tipo: TipoPessoa, papel: str) -> Pessoa:
    pessoa = sessao.get(Pessoa, id_pessoa)
    if pessoa is None:
        raise HTTPException(status_code=422, detail=f"{papel}: pessoa ID {id_pessoa} não encontrada.")
    if pessoa.tipo is not tipo:
        raise HTTPException(
            status_code=422,
            detail=f"{papel}: a pessoa ID {id_pessoa} é {pessoa.tipo.value}, e não {tipo.value}.",
        )
    if pessoa.status is Status.INATIVO:
        raise HTTPException(
            status_code=422,
            detail=(
                f"{papel}: {pessoa.razaoSocial} (ID {id_pessoa}) está INATIVO. "
                "Reative o cadastro para usá-lo."
            ),
        )
    return pessoa


def _classificacoes(
    sessao: Session, ids: list[int], tipo: TipoClassificacao
) -> list[Classificacao]:
    encontradas = {
        c.idClassificacao: c
        for c in sessao.scalars(select(Classificacao).where(Classificacao.idClassificacao.in_(ids)))
    }
    if faltando := [i for i in ids if i not in encontradas]:
        raise HTTPException(
            status_code=422, detail=f"Classificação não encontrada: ID {', '.join(map(str, faltando))}."
        )
    if outras := [c for c in encontradas.values() if c.tipo is not tipo]:
        raise HTTPException(
            status_code=422,
            detail=(
                f"A conta só aceita classificações do tipo {tipo.value}: "
                + ", ".join(f"{c.descricao} (ID {c.idClassificacao}) é {c.tipo.value}" for c in outras)
                + "."
            ),
        )
    if inativas := [c for c in encontradas.values() if c.status is Status.INATIVO]:
        raise HTTPException(
            status_code=422,
            detail=(
                "Classificação INATIVA: "
                + ", ".join(f"{c.descricao} (ID {c.idClassificacao})" for c in inativas)
                + ". Reative o cadastro para usá-la."
            ),
        )
    return [encontradas[i] for i in ids]


def buscar_nota(
    sessao: Session, tipo: TipoMovimento, id_fornecedor_cliente: int, numero: str
) -> MovimentoContas | None:
    """Conta (ativa ou inativa) ja registrada com a mesma nota da mesma pessoa."""
    return sessao.scalar(
        select(MovimentoContas).where(
            MovimentoContas.tipo == tipo,
            MovimentoContas.idFornecedorCliente == id_fornecedor_cliente,
            MovimentoContas.numeroNotaFiscal == numero,
        )
    )


def preencher(sessao: Session, conta: MovimentoContas, dados: ContaEntrada) -> None:
    """Valida as referencias e copia os dados para a conta (sem mexer no status)."""
    if dados.numeroNotaFiscal:
        # A mesma nota lancada duas vezes seria paga (ou cobrada) em dobro.
        existente = buscar_nota(sessao, dados.tipo, dados.idFornecedorCliente, dados.numeroNotaFiscal)
        if existente is not None and existente is not conta:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A nota {dados.numeroNotaFiscal} desta pessoa já foi registrada "
                    f"(conta ID {existente.idMovimentoContas}, {existente.status.value})."
                ),
            )
    conta.fornecedorCliente = _pessoa(
        sessao, dados.idFornecedorCliente, PESSOA_DO_TIPO[dados.tipo], "Fornecedor/Cliente"
    )
    conta.faturado = _pessoa(sessao, dados.idFaturado, TipoPessoa.FATURADO, "Faturado")
    conta.classificacoes = _classificacoes(
        sessao, dados.idClassificacoes, CLASSIFICACAO_DO_TIPO[dados.tipo]
    )
    conta.tipo = dados.tipo
    conta.numeroNotaFiscal = dados.numeroNotaFiscal
    conta.dataEmissao = dados.dataEmissao
    conta.descricao = dados.descricao
    conta.valorTotal = dados.valorTotal

    if conta.parcelas:
        # Remove as antigas antes de inserir as novas: a mesma data pode voltar.
        conta.parcelas.clear()
        sessao.flush()
    conta.parcelas = identificar_parcelas(
        [(p.dataVencimento, p.valorParcela) for p in dados.parcelas]
    )


ORDENS = {
    "idMovimentoContas": MovimentoContas.idMovimentoContas,
    "tipo": MovimentoContas.tipo,
    "numeroNotaFiscal": MovimentoContas.numeroNotaFiscal,
    "dataEmissao": MovimentoContas.dataEmissao,
    "valorTotal": MovimentoContas.valorTotal,
    "fornecedorCliente": Pessoa.razaoSocial,
}
CARREGAR = (
    selectinload(MovimentoContas.fornecedorCliente),
    selectinload(MovimentoContas.faturado),
    selectinload(MovimentoContas.classificacoes),
    selectinload(MovimentoContas.parcelas),
)


@router.get("", response_model=list[ContaSaida])
def listar_contas(
    busca: str | None = None,
    tipo: TipoMovimento | None = None,
    status: Status | None = None,
    ordem: Literal[
        "idMovimentoContas", "tipo", "numeroNotaFiscal", "dataEmissao", "valorTotal", "fornecedorCliente"
    ] = "dataEmissao",
    direcao: crud.Direcao = "desc",
    sessao: Session = Depends(obter_sessao),
) -> list[MovimentoContas]:
    """Busca no nº da nota, na descrição e na razão social do fornecedor/cliente.
    Sem `status`, traz só as ATIVAS."""
    return crud.listar(
        sessao,
        MovimentoContas,
        busca=busca,
        campos_busca=[MovimentoContas.numeroNotaFiscal, MovimentoContas.descricao, Pessoa.razaoSocial],
        status=status,
        ordem=ORDENS[ordem],
        direcao=direcao,
        filtros=[MovimentoContas.tipo == tipo] if tipo else [],
        consulta=select(MovimentoContas)
        .join(MovimentoContas.fornecedorCliente)
        .options(*CARREGAR),
    )


@router.get("/{id_conta}", response_model=ContaSaida)
def obter_conta(id_conta: int, sessao: Session = Depends(obter_sessao)) -> MovimentoContas:
    return crud.obter(sessao, MovimentoContas, id_conta, NAO_ENCONTRADA)


@router.post("", response_model=ContaSaida, status_code=201)
def registrar_conta(dados: ContaEntrada, sessao: Session = Depends(obter_sessao)) -> MovimentoContas:
    conta = MovimentoContas(status=Status.ATIVO)
    preencher(sessao, conta, dados)
    sessao.add(conta)
    sessao.commit()
    return conta


@router.put("/{id_conta}", response_model=ContaSaida)
def editar_conta(
    id_conta: int, dados: ContaEntrada, sessao: Session = Depends(obter_sessao)
) -> MovimentoContas:
    """Substitui os dados, as classificações e as parcelas da conta."""
    conta = crud.obter(sessao, MovimentoContas, id_conta, NAO_ENCONTRADA)
    preencher(sessao, conta, dados)
    sessao.commit()
    return conta


@router.delete("/{id_conta}", response_model=ContaSaida)
def inativar_conta(id_conta: int, sessao: Session = Depends(obter_sessao)) -> MovimentoContas:
    """Exclusão lógica: a conta fica INATIVA."""
    return crud.definir_status(
        sessao, crud.obter(sessao, MovimentoContas, id_conta, NAO_ENCONTRADA), Status.INATIVO
    )


@router.put("/{id_conta}/reativar", response_model=ContaSaida)
def reativar_conta(id_conta: int, sessao: Session = Depends(obter_sessao)) -> MovimentoContas:
    return crud.definir_status(
        sessao, crud.obter(sessao, MovimentoContas, id_conta, NAO_ENCONTRADA), Status.ATIVO
    )
