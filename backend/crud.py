"""Operacoes comuns aos cadastros: listar com busca, obter, inativar e reativar."""

from typing import Literal, TypeVar

from fastapi import HTTPException
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from banco import Base
from tabelas import Status

Registro = TypeVar("Registro", bound=Base)
Direcao = Literal["asc", "desc"]


def listar(
    sessao: Session,
    modelo: type[Registro],
    *,
    busca: str | None,
    campos_busca: list[InstrumentedAttribute],
    status: Status | None,
    ordem: InstrumentedAttribute,
    direcao: Direcao,
    filtros: list = (),
    consulta: Select | None = None,
) -> list[Registro]:
    """Sem status informado traz so os ATIVOS (o "TODOS" da tela).

    A busca aceita mais de um termo: cada termo precisa aparecer em algum dos campos.
    `consulta` permite partir de um select com joins, para buscar em outra tabela.
    """
    consulta = (consulta if consulta is not None else select(modelo)).where(
        modelo.status == (status or Status.ATIVO), *filtros
    )
    for termo in (busca or "").split():
        consulta = consulta.where(or_(*(c.icontains(termo, autoescape=True) for c in campos_busca)))
    return list(sessao.scalars(consulta.order_by(ordem.desc() if direcao == "desc" else ordem)))


def obter(sessao: Session, modelo: type[Registro], id_: int, nao_encontrado: str) -> Registro:
    registro = sessao.get(modelo, id_)
    if registro is None:
        raise HTTPException(status_code=404, detail=nao_encontrado)
    return registro


def definir_status(sessao: Session, registro: Registro, status: Status) -> Registro:
    """Cadastros nao sao excluidos: o DELETE inativa e o reativar volta para ATIVO."""
    registro.status = status
    sessao.commit()
    return registro
