"""Conexao com o banco (MySQL) e sessoes do SQLAlchemy.

A URL vem de DATABASE_URL, ex.:
mysql+pymysql://sysfinan:senha@localhost:3306/sysfinan?charset=utf8mb4
"""

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Defina DATABASE_URL em backend/.env (ex.: "
        "mysql+pymysql://sysfinan:senha@localhost:3306/sysfinan?charset=utf8mb4)."
    )

# pool_pre_ping: o MySQL derruba conexoes ociosas; testa antes de reaproveitar.
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def obter_sessao() -> Iterator[Session]:
    """Dependencia das rotas: uma sessao por requisicao."""
    with SessionLocal() as sessao:
        yield sessao


def criar_tabelas() -> None:
    """Cria as tabelas que ainda nao existem (chamado ao subir a API)."""
    Base.metadata.create_all(engine)
