"""Categorias de despesa: as 9 padrao (fixas) e as criadas pelo agent.

As criadas ficam em backend/dados/categorias.json por enquanto; na migracao para
o MySQL, so o RepositorioCategorias muda.
"""

import json
import os
import re
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from models import Categoria, CategoriaDespesa

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


class RepositorioCategorias:

    def __init__(self, caminho: Path):
        self._caminho = caminho
        self._trava = threading.Lock()

    # --- persistencia ------------------------------------------------------

    def _ler_criadas(self) -> list[Categoria]:
        if not self._caminho.exists():
            return []
        dados = json.loads(self._caminho.read_text(encoding="utf-8"))
        return [Categoria.model_validate(item) for item in dados]

    def _gravar_criadas(self, criadas: list[Categoria]) -> None:
        self._caminho.parent.mkdir(parents=True, exist_ok=True)
        temporario = self._caminho.with_suffix(".tmp")
        conteudo = [c.model_dump(mode="json") for c in criadas]
        temporario.write_text(json.dumps(conteudo, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporario, self._caminho)

    # --- consultas -----------------------------------------------------------

    @staticmethod
    def padrao() -> list[Categoria]:
        return [
            Categoria(nome=c.value, descricao=EXEMPLOS_PADRAO[c], padrao=True, ativa=True)
            for c in CategoriaDespesa
        ]

    def listar(self) -> list[Categoria]:
        with self._trava:
            return self.padrao() + self._ler_criadas()

    def ativas(self) -> list[Categoria]:
        return [c for c in self.listar() if c.ativa]

    def buscar(self, nome: str) -> Categoria | None:
        procurada = chave(nome)
        return next((c for c in self.listar() if chave(c.nome) == procurada), None)

    # --- alteracoes ----------------------------------------------------------

    def criar(self, nome: str, descricao: str, nota_origem: str | None = None) -> Categoria:
        """Cria a categoria; se ja existir uma equivalente, devolve a existente."""
        nome = formatar_nome(nome)
        with self._trava:
            criadas = self._ler_criadas()
            procurada = chave(nome)
            for existente in self.padrao() + criadas:
                if chave(existente.nome) == procurada:
                    return existente
            nova = Categoria(
                nome=nome,
                descricao=descricao.strip(),
                padrao=False,
                ativa=True,
                criadaEm=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                notaOrigem=nota_origem,
            )
            self._gravar_criadas(criadas + [nova])
            return nova

    def definir_ativa(self, nome: str, ativa: bool) -> Categoria:
        procurada = chave(nome)
        if any(chave(c.nome) == procurada for c in self.padrao()):
            raise ValueError("As categorias padrão não podem ser inativadas.")
        with self._trava:
            criadas = self._ler_criadas()
            for categoria in criadas:
                if chave(categoria.nome) == procurada:
                    categoria.ativa = ativa
                    self._gravar_criadas(criadas)
                    return categoria
        raise KeyError(nome)


repositorio = RepositorioCategorias(Path(__file__).with_name("dados") / "categorias.json")
