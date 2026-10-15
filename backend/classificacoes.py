"""Manter Classificação: tipos de receita e de despesa (C002_CLASSIFICACAO)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

import crud
from banco import obter_sessao
from categorias import buscar_equivalente, formatar_nome
from seguranca import exigir_login
from tabelas import Classificacao, Status, TipoClassificacao

router = APIRouter(
    prefix="/classificacoes", tags=["Classificações"], dependencies=[Depends(exigir_login)]
)

NAO_ENCONTRADA = "Classificação não encontrada."


class ClassificacaoEntrada(BaseModel):
    """Sem status: o CREATE grava ATIVO e o UPDATE nao o altera."""

    tipo: TipoClassificacao
    descricao: str = Field(min_length=1, max_length=100)

    @field_validator("descricao")
    @classmethod
    def _formatar(cls, valor: str) -> str:
        if not (formatada := formatar_nome(valor)):
            raise ValueError("Informe a descrição.")
        return formatada


class ClassificacaoSaida(ClassificacaoEntrada):
    model_config = ConfigDict(from_attributes=True)

    idClassificacao: int
    status: Status


def _garantir_unica(
    sessao: Session, dados: ClassificacaoEntrada, id_atual: int | None = None
) -> None:
    """Mesmo criterio do agent: 'COMBUSTÍVEIS' e 'COMBUSTIVEL' sao a mesma classificacao."""
    existente = buscar_equivalente(sessao, dados.tipo, dados.descricao)
    if existente is not None and existente.idClassificacao != id_atual:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Já existe a {dados.tipo.value} “{existente.descricao}” "
                f"(ID {existente.idClassificacao}, {existente.status.value})."
            ),
        )


ORDENS = {
    "idClassificacao": Classificacao.idClassificacao,
    "tipo": Classificacao.tipo,
    "descricao": Classificacao.descricao,
}


@router.get("", response_model=list[ClassificacaoSaida])
def listar_classificacoes(
    busca: str | None = None,
    tipo: TipoClassificacao | None = None,
    status: Status | None = None,
    ordem: Literal["idClassificacao", "tipo", "descricao"] = "descricao",
    direcao: crud.Direcao = "asc",
    sessao: Session = Depends(obter_sessao),
) -> list[Classificacao]:
    """Busca na descrição. Sem `status`, traz só as ATIVAS."""
    return crud.listar(
        sessao,
        Classificacao,
        busca=busca,
        campos_busca=[Classificacao.descricao],
        status=status,
        ordem=ORDENS[ordem],
        direcao=direcao,
        filtros=[Classificacao.tipo == tipo] if tipo else [],
    )


@router.get("/{id_classificacao}", response_model=ClassificacaoSaida)
def obter_classificacao(
    id_classificacao: int, sessao: Session = Depends(obter_sessao)
) -> Classificacao:
    return crud.obter(sessao, Classificacao, id_classificacao, NAO_ENCONTRADA)


@router.post("", response_model=ClassificacaoSaida, status_code=201)
def criar_classificacao(
    dados: ClassificacaoEntrada, sessao: Session = Depends(obter_sessao)
) -> Classificacao:
    _garantir_unica(sessao, dados)
    classificacao = Classificacao(**dados.model_dump(), status=Status.ATIVO)
    sessao.add(classificacao)
    sessao.commit()
    return classificacao


@router.put("/{id_classificacao}", response_model=ClassificacaoSaida)
def editar_classificacao(
    id_classificacao: int, dados: ClassificacaoEntrada, sessao: Session = Depends(obter_sessao)
) -> Classificacao:
    classificacao = crud.obter(sessao, Classificacao, id_classificacao, NAO_ENCONTRADA)
    _garantir_unica(sessao, dados, id_atual=id_classificacao)
    for campo, valor in dados.model_dump().items():
        setattr(classificacao, campo, valor)
    sessao.commit()
    return classificacao


@router.delete("/{id_classificacao}", response_model=ClassificacaoSaida)
def inativar_classificacao(
    id_classificacao: int, sessao: Session = Depends(obter_sessao)
) -> Classificacao:
    """Exclusão lógica: a classificação fica INATIVA (e sai das opções do agent)."""
    return crud.definir_status(
        sessao, crud.obter(sessao, Classificacao, id_classificacao, NAO_ENCONTRADA), Status.INATIVO
    )


@router.put("/{id_classificacao}/reativar", response_model=ClassificacaoSaida)
def reativar_classificacao(
    id_classificacao: int, sessao: Session = Depends(obter_sessao)
) -> Classificacao:
    return crud.definir_status(
        sessao, crud.obter(sessao, Classificacao, id_classificacao, NAO_ENCONTRADA), Status.ATIVO
    )
