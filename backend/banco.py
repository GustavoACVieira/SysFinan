"""Conexao com o banco (MySQL ou PostgreSQL/Neon) e sessoes do SQLAlchemy.

A URL vem de DATABASE_URL, ex.:
mysql+pymysql://sysfinan:senha@localhost:3306/sysfinan?charset=utf8mb4
postgresql://usuario:senha@ep-xxx.sa-east-1.aws.neon.tech/neondb?sslmode=require
"""

import os
import re
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


def _com_driver(url: str) -> str:
    """A URL copiada do Neon (postgresql:// ou postgres://) passa a usar o psycopg 3."""
    return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", url)


DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "Defina DATABASE_URL em backend/.env (ex.: "
        "mysql+pymysql://sysfinan:senha@localhost:3306/sysfinan?charset=utf8mb4)."
    )
DATABASE_URL = _com_driver(DATABASE_URL.strip())

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
    """Cria as tabelas que ainda nao existem e o seed (chamado ao subir a API)."""
    import tabelas  # registra as tabelas no Base (importa banco, por isso fica aqui)

    Base.metadata.create_all(engine)
    with SessionLocal() as sessao:
        tabelas.semear(sessao)
