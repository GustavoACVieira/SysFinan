"""Categorias de despesa: as classificacoes do tipo DESPESA (C002_CLASSIFICACAO).

As 9 padrao entram no banco na primeira subida (tabelas.semear); o agent usa as ativas
na classificacao e pode sugerir outras, criadas ao lancar a nota (lancamento.py).
Todo acesso do agent passa pelo RepositorioCategorias.
"""

import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from banco import SessionLocal
from models import Categoria, CategoriaDespesa
from tabelas import Classificacao, Status, TipoClassificacao

EXEMPLOS_PADRAO = {
    CategoriaDespesa.INSUMOS_AGRICOLAS: "sementes, fertilizantes, defensivos agrícolas, corretivos",
    CategoriaDespesa.MANUTENCAO_E_OPERACAO: (
        "combustíveis e lubrificantes; peças, parafusos e componentes mecânicos; "
        "manutenção de máquinas e equipamentos; pneus, filtros, correias; "
        "ferramentas e utensílios"
    ),
    CategoriaDespesa.RECURSOS_HUMANOS: "mão de obra temporária; salários e encargos",
    CategoriaDespesa.SERVICOS_OPERACIONAIS: (
        "frete e transporte; colheita terceirizada; secagem e armazenagem; "
        "pulverização e aplicação"
    ),
    CategoriaDespesa.INFRAESTRUTURA_E_UTILIDADES: (
        "energia elétrica; arrendamento de terras; construções e reformas; "
        "materiais de construção"
    ),
    CategoriaDespesa.ADMINISTRATIVAS: (
        "honorários contábeis, advocatícios e agronômicos; despesas bancárias e financeiras"
    ),
    CategoriaDespesa.SEGUROS_E_PROTECAO: (
        "seguro agrícola; seguro de ativos (máquinas/veículos); seguro prestamista"
    ),
    CategoriaDespesa.IMPOSTOS_E_TAXAS: "ITR, IPTU, IPVA, INCRA-CCIR",
    CategoriaDespesa.INVESTIMENTOS: (
        "aquisição de máquinas e implementos; de veículos; de imóveis; infraestrutura rural"
    ),
}

TAMANHO_NOME = (3, 40)


def formatar_nome(nome: str) -> str:
    return re.sub(r"\s+", " ", nome).strip().upper()


def chave(nome: str) -> str:
    """Forma de comparacao: sem acento, sem pontuacao e no singular."""
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    palavras = re.sub(r"[^A-Z0-9]+", " ", sem_acento.upper()).split()
    return " ".join(_singular(p) for p in palavras if p not in _LIGACOES)


_LIGACOES = {"E", "DE", "DA", "DO", "DAS", "DOS"}
# Do mais especifico ao mais geral.
_PLURAIS = (
    ("OES", "AO"),
    ("AES", "AO"),
    ("EIS", "EL"),
    ("AIS", "AL"),
    ("RES", "R"),
    ("ZES", "Z"),
    ("S", ""),
)


def _singular(palavra: str) -> str:
    if len(palavra) <= 3:
        return palavra
    for plural, singular in _PLURAIS:
        if palavra.endswith(plural):
            return palavra[: -len(plural)] + singular
    return palavra


def buscar_equivalente(
    sessao: Session, tipo: TipoClassificacao, descricao: str
) -> Classificacao | None:
    """Classificacao do tipo com o mesmo nome, ignorando acento, pontuacao e plural."""
    procurada = chave(descricao)
    candidatas = sessao.scalars(select(Classificacao).where(Classificacao.tipo == tipo))
    return next((c for c in candidatas if chave(c.descricao) == procurada), None)


class RepositorioCategorias:

    @staticmethod
    def _categoria(classificacao: Classificacao) -> Categoria:
        return Categoria(
            nome=classificacao.descricao,
            descricao=EXEMPLOS_PADRAO.get(classificacao.descricao, ""),
            padrao=classificacao.descricao in EXEMPLOS_PADRAO,
            ativa=classificacao.status is Status.ATIVO,
        )

    # --- consultas -----------------------------------------------------------

    def listar(self) -> list[Categoria]:
        with SessionLocal() as sessao:
            despesas = sessao.scalars(
                select(Classificacao)
                .where(Classificacao.tipo == TipoClassificacao.DESPESA)
                .order_by(Classificacao.idClassificacao)
            )
            return [self._categoria(c) for c in despesas]

    def ativas(self) -> list[Categoria]:
        return [c for c in self.listar() if c.ativa]

    def buscar(self, nome: str) -> Categoria | None:
        with SessionLocal() as sessao:
            existente = buscar_equivalente(sessao, TipoClassificacao.DESPESA, nome)
            return self._categoria(existente) if existente else None

    # --- alteracoes ----------------------------------------------------------

    def definir_ativa(self, nome: str, ativa: bool) -> Categoria:
        with SessionLocal() as sessao:
            existente = buscar_equivalente(sessao, TipoClassificacao.DESPESA, nome)
            if existente is None:
                raise KeyError(nome)
            existente.status = Status.ATIVO if ativa else Status.INATIVO
            sessao.commit()
            return self._categoria(existente)


repositorio = RepositorioCategorias()
