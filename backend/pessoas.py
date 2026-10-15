"""Manter Pessoas: clientes, fornecedores e faturados (C001_PESSOAS)."""

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

import crud
from banco import obter_sessao
from seguranca import exigir_login
from tabelas import Pessoa, Status, TipoPessoa

router = APIRouter(prefix="/pessoas", tags=["Pessoas"], dependencies=[Depends(exigir_login)])


def formatar_documento(documento: str) -> str | None:
    """Poe o CPF (11 digitos) ou CNPJ (14) na mascara; None se nao for nenhum dos dois."""
    digitos = re.sub(r"\D", "", documento)
    if len(digitos) == 11:
        return f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
    if len(digitos) == 14:
        return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:8]}/{digitos[8:12]}-{digitos[12:]}"
    return None


class PessoaEntrada(BaseModel):
    """Sem status: o CREATE grava ATIVO e o UPDATE nao o altera."""

    tipo: TipoPessoa
    razaoSocial: str = Field(min_length=1, max_length=150)
    fantasia: str | None = Field(default=None, max_length=150)
    documento: str = Field(description="CPF ou CNPJ, com ou sem máscara")

    @field_validator("razaoSocial")
    @classmethod
    def _limpar_razao(cls, valor: str) -> str:
        if not (limpo := " ".join(valor.split())):
            raise ValueError("Informe a razão social.")
        return limpo

    @field_validator("fantasia")
    @classmethod
    def _limpar_fantasia(cls, valor: str | None) -> str | None:
        return " ".join(valor.split()) or None if valor else None

    @field_validator("documento")
    @classmethod
    def _mascarar(cls, valor: str) -> str:
        if (formatado := formatar_documento(valor)) is None:
            raise ValueError("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).")
        return formatado


class PessoaSaida(PessoaEntrada):
    model_config = ConfigDict(from_attributes=True)

    idPessoas: int
    status: Status


def buscar_por_documento(sessao: Session, tipo: TipoPessoa, documento: str) -> Pessoa | None:
    """Ativa ou inativa, a mesma pessoa (tipo + documento) so pode existir uma vez."""
    return sessao.scalar(select(Pessoa).where(Pessoa.tipo == tipo, Pessoa.documento == documento))


def _garantir_unica(sessao: Session, dados: PessoaEntrada, id_atual: int | None = None) -> None:
    existente = buscar_por_documento(sessao, dados.tipo, dados.documento)
    if existente is not None and existente.idPessoas != id_atual:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe {dados.tipo.value} com o documento {dados.documento} "
                f"(ID {existente.idPessoas}, {existente.status.value})."
            ),
        )


NAO_ENCONTRADA = "Pessoa não encontrada."

ORDENS = {
    "idPessoas": Pessoa.idPessoas,
    "tipo": Pessoa.tipo,
    "razaoSocial": Pessoa.razaoSocial,
    "fantasia": Pessoa.fantasia,
    "documento": Pessoa.documento,
}


@router.get("", response_model=list[PessoaSaida])
def listar_pessoas(
    busca: str | None = None,
    tipo: TipoPessoa | None = None,
    status: Status | None = None,
    ordem: Literal["idPessoas", "tipo", "razaoSocial", "fantasia", "documento"] = "razaoSocial",
    direcao: crud.Direcao = "asc",
    sessao: Session = Depends(obter_sessao),
) -> list[Pessoa]:
    """Busca em razão social, fantasia e documento. Sem `status`, traz só as ATIVAS."""
    # CPF/CNPJ digitado sem mascara tambem encontra a pessoa.
    termos = [formatar_documento(t) or t for t in (busca or "").split()]
    return crud.listar(
        sessao,
        Pessoa,
        busca=" ".join(termos),
        campos_busca=[Pessoa.razaoSocial, Pessoa.fantasia, Pessoa.documento],
        status=status,
        ordem=ORDENS[ordem],
        direcao=direcao,
        filtros=[Pessoa.tipo == tipo] if tipo else [],
    )


@router.get("/{id_pessoa}", response_model=PessoaSaida)
def obter_pessoa(id_pessoa: int, sessao: Session = Depends(obter_sessao)) -> Pessoa:
    return crud.obter(sessao, Pessoa, id_pessoa, NAO_ENCONTRADA)


@router.post("", response_model=PessoaSaida, status_code=201)
def criar_pessoa(dados: PessoaEntrada, sessao: Session = Depends(obter_sessao)) -> Pessoa:
    _garantir_unica(sessao, dados)
    pessoa = Pessoa(**dados.model_dump(), status=Status.ATIVO)
    sessao.add(pessoa)
    sessao.commit()
    return pessoa


@router.put("/{id_pessoa}", response_model=PessoaSaida)
def editar_pessoa(
    id_pessoa: int, dados: PessoaEntrada, sessao: Session = Depends(obter_sessao)
) -> Pessoa:
    pessoa = crud.obter(sessao, Pessoa, id_pessoa, NAO_ENCONTRADA)
    _garantir_unica(sessao, dados, id_atual=id_pessoa)
    for campo, valor in dados.model_dump().items():
        setattr(pessoa, campo, valor)
    sessao.commit()
    return pessoa


@router.delete("/{id_pessoa}", response_model=PessoaSaida)
def inativar_pessoa(id_pessoa: int, sessao: Session = Depends(obter_sessao)) -> Pessoa:
    """Exclusão lógica: a pessoa fica INATIVA."""
    return crud.definir_status(
        sessao, crud.obter(sessao, Pessoa, id_pessoa, NAO_ENCONTRADA), Status.INATIVO
    )


@router.put("/{id_pessoa}/reativar", response_model=PessoaSaida)
def reativar_pessoa(id_pessoa: int, sessao: Session = Depends(obter_sessao)) -> Pessoa:
    return crud.definir_status(
        sessao, crud.obter(sessao, Pessoa, id_pessoa, NAO_ENCONTRADA), Status.ATIVO
    )
