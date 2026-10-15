"""Tabelas do banco (SQLAlchemy). Sao criadas ao subir a API por banco.criar_tabelas.

Padrao de nomes (cada prefixo com sua propria contagem):
- Exxx: dominio (valores fixos de um tipo ou status);
- Cxxx: cadastro;
- Txxx: transacao;
- Rxxx_<tabela>_<tabela>: relacionamento N:N entre as duas tabelas do nome.

Cadastros nao sao excluidos: o DELETE so muda o status para INATIVO.
"""

from datetime import date
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    TypeDecorator,
    UniqueConstraint,
    insert,
    select,
)
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from banco import Base
from models import CategoriaDespesa

# ---------------------------------------------------------------------------
# Dominios (Exxx)
# ---------------------------------------------------------------------------


class TipoPessoa(str, Enum):
    CLIENTE = "CLIENTE"
    FORNECEDOR = "FORNECEDOR"
    FATURADO = "FATURADO"


class TipoClassificacao(str, Enum):
    RECEITA = "RECEITA"
    DESPESA = "DESPESA"


class TipoMovimento(str, Enum):
    APAGAR = "APAGAR"
    ARECEBER = "ARECEBER"


class Status(str, Enum):
    ATIVO = "ATIVO"
    INATIVO = "INATIVO"


def _dominio(nome: str, coluna_id: str, enum: type[Enum]) -> Table:
    """Tabela com os valores do enum; o id e a posicao do valor no enum (1, 2, ...)."""
    tabela = Table(
        nome,
        Base.metadata,
        Column(coluna_id, Integer, primary_key=True, autoincrement=False),
        Column("descricao", String(20), nullable=False, unique=True),
    )
    tabela.info["enum"] = enum
    return tabela


E001_TIPO_PESSOA = _dominio("E001_TIPO_PESSOA", "idTipoPessoa", TipoPessoa)
E002_TIPO_CLASSIFICACAO = _dominio(
    "E002_TIPO_CLASSIFICACAO", "idTipoClassificacao", TipoClassificacao
)
E003_TIPO_MOVIMENTO = _dominio("E003_TIPO_MOVIMENTO", "idTipoMovimento", TipoMovimento)
E004_STATUS = _dominio("E004_STATUS", "idStatus", Status)
DOMINIOS = (E001_TIPO_PESSOA, E002_TIPO_CLASSIFICACAO, E003_TIPO_MOVIMENTO, E004_STATUS)


class EnumPorId(TypeDecorator):
    """Grava o id da tabela de dominio e devolve o membro do enum no Python."""

    impl = Integer
    cache_ok = True

    def __init__(self, enum: type[Enum]):
        super().__init__()
        self.enum = enum

    def process_bind_param(self, valor, dialect):
        return None if valor is None else list(self.enum).index(self.enum(valor)) + 1

    def process_result_value(self, valor, dialect):
        return None if valor is None else list(self.enum)[valor - 1]


def _referencia(dominio: Table, **opcoes) -> Mapped:
    coluna = dominio.primary_key.columns[0]
    return mapped_column(coluna.name, EnumPorId(dominio.info["enum"]), ForeignKey(coluna), **opcoes)


def _status() -> Mapped[Status]:
    return _referencia(E004_STATUS, default=Status.ATIVO, server_default="1")


# ---------------------------------------------------------------------------
# Cadastros (Cxxx)
# ---------------------------------------------------------------------------


class Pessoa(Base):
    __tablename__ = "C001_PESSOAS"
    __table_args__ = (UniqueConstraint("idTipoPessoa", "documento"),)

    idPessoas: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoPessoa] = _referencia(E001_TIPO_PESSOA)
    razaoSocial: Mapped[str] = mapped_column(String(150))
    fantasia: Mapped[str | None] = mapped_column(String(150))
    documento: Mapped[str] = mapped_column(String(18), comment="CNPJ ou CPF, com máscara")
    status: Mapped[Status] = _status()


class Classificacao(Base):
    __tablename__ = "C002_CLASSIFICACAO"
    __table_args__ = (UniqueConstraint("idTipoClassificacao", "descricao"),)

    idClassificacao: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoClassificacao] = _referencia(E002_TIPO_CLASSIFICACAO)
    descricao: Mapped[str] = mapped_column(String(100))
    status: Mapped[Status] = _status()


# ---------------------------------------------------------------------------
# Transacoes (Txxx) e relacionamentos (Rxxx)
# ---------------------------------------------------------------------------

# Um movimento pode ter um ou mais tipos de despesa/receita.
R001_T001_C002 = Table(
    "R001_T001_C002",
    Base.metadata,
    Column(
        "idMovimentoContas",
        ForeignKey("T001_MOVIMENTOCONTAS.idMovimentoContas"),
        primary_key=True,
    ),
    Column("idClassificacao", ForeignKey("C002_CLASSIFICACAO.idClassificacao"), primary_key=True),
)


class MovimentoContas(Base):
    __tablename__ = "T001_MOVIMENTOCONTAS"

    idMovimentoContas: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[TipoMovimento] = _referencia(E003_TIPO_MOVIMENTO)
    numeroNotaFiscal: Mapped[str | None] = mapped_column(String(20))
    dataEmissao: Mapped[date]
    descricao: Mapped[str | None] = mapped_column(Text)
    valorTotal: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    idFornecedorCliente: Mapped[int] = mapped_column(ForeignKey(Pessoa.idPessoas))
    idFaturado: Mapped[int] = mapped_column(ForeignKey(Pessoa.idPessoas))
    status: Mapped[Status] = _status()

    fornecedorCliente: Mapped[Pessoa] = relationship(foreign_keys=[idFornecedorCliente])
    faturado: Mapped[Pessoa] = relationship(foreign_keys=[idFaturado])
    classificacoes: Mapped[list[Classificacao]] = relationship(secondary=R001_T001_C002)
    parcelas: Mapped[list["ParcelaContas"]] = relationship(
        back_populates="movimento",
        cascade="all, delete-orphan",
        order_by="ParcelaContas.dataVencimento",
    )


class ParcelaContas(Base):
    __tablename__ = "T002_PARCELACONTAS"
    # Parcelas de um mesmo movimento vencem em datas distintas.
    __table_args__ = (UniqueConstraint("idMovimentoContas", "dataVencimento"),)

    idParcelaContas: Mapped[int] = mapped_column(primary_key=True)
    idMovimentoContas: Mapped[int] = mapped_column(ForeignKey(MovimentoContas.idMovimentoContas))
    identificacao: Mapped[str] = mapped_column(String(10), comment="ÚNICA, 1/3, 2/3...")
    dataVencimento: Mapped[date]
    valorParcela: Mapped[Decimal] = mapped_column(Numeric(12, 2))

    movimento: Mapped[MovimentoContas] = relationship(back_populates="parcelas")


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------


def semear(sessao: Session) -> None:
    """Grava os valores dos dominios e, na primeira subida, as 9 categorias padrao."""
    for dominio in DOMINIOS:
        coluna = dominio.primary_key.columns[0]
        existentes = set(sessao.scalars(select(coluna)))
        novos = [
            {coluna.name: id_, "descricao": membro.value}
            for id_, membro in enumerate(dominio.info["enum"], start=1)
            if id_ not in existentes
        ]
        if novos:
            sessao.execute(insert(dominio), novos)

    if sessao.scalar(select(Classificacao.idClassificacao).limit(1)) is None:
        sessao.add_all(
            Classificacao(tipo=TipoClassificacao.DESPESA, descricao=c.value)
            for c in CategoriaDespesa
        )
    sessao.commit()
