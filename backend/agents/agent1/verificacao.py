"""Verificacao das etapas do Agent1.

Cada verificador devolve (problemas, avisos):
- problemas impedem a etapa de concluir: o agent refaz a etapa informando o que
  estava errado e, se continuar errado, para o pipeline ali;
- avisos sao registrados no relatorio, mas nao seguram a etapa.

Os verificadores sao deterministicos (sem IA): conferem o que o modelo devolveu
contra regras que uma nota fiscal valida sempre respeita.
"""

import re
from datetime import date

from categorias import TAMANHO_NOME
from models import (
    EsquemaFinanceiro,
    EsquemaIdentificacao,
    EsquemaProdutos,
    NotaFiscalExtraida,
)

Resultado = tuple[list[str], list[str]]

TOLERANCIA_VALOR = 0.01  # diferenca de centavos por arredondamento
RE_CNPJ = re.compile(r"^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$")
RE_CPF = re.compile(r"^\d{3}\.\d{3}\.\d{3}-\d{2}$")


# ---------------------------------------------------------------------------
# Utilitarios
# ---------------------------------------------------------------------------


def _digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto)


def formatar_cnpj(valor: str | None) -> str | None:
    """Poe o CNPJ na mascara quando o modelo devolve so os digitos."""
    if valor and len(d := _digitos(valor)) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return valor


def formatar_cpf(valor: str | None) -> str | None:
    if valor and len(d := _digitos(valor)) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return valor


def _dv_cnpj_valido(cnpj: str) -> bool:
    d = [int(c) for c in _digitos(cnpj)]
    for tamanho in (12, 13):
        pesos = list(range(tamanho - 7, 1, -1)) + list(range(9, 1, -1))
        resto = sum(n * p for n, p in zip(d[:tamanho], pesos)) % 11
        if d[tamanho] != (0 if resto < 2 else 11 - resto):
            return False
    return True


def _dv_cpf_valido(cpf: str) -> bool:
    d = [int(c) for c in _digitos(cpf)]
    if len(set(d)) == 1:
        return False
    for tamanho in (9, 10):
        resto = sum(n * p for n, p in zip(d[:tamanho], range(tamanho + 1, 1, -1))) * 10 % 11
        if d[tamanho] != resto % 10:
            return False
    return True


def _data(valor: str | None) -> date | None:
    try:
        return date.fromisoformat(valor) if valor else None
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Verificadores por etapa
# ---------------------------------------------------------------------------


def verificar_identificacao(dados: EsquemaIdentificacao) -> Resultado:
    problemas: list[str] = []
    avisos: list[str] = []
    fornecedor, faturado = dados.fornecedor, dados.faturado

    if not fornecedor.razaoSocial:
        problemas.append("Razão social do fornecedor (emitente) não foi extraída.")

    if not fornecedor.cnpj:
        problemas.append("CNPJ do fornecedor (emitente) não foi extraído.")
    elif not RE_CNPJ.match(fornecedor.cnpj):
        problemas.append(f"CNPJ do fornecedor fora do formato 00.000.000/0000-00: {fornecedor.cnpj}")
    elif not _dv_cnpj_valido(fornecedor.cnpj):
        # Aviso, e nao problema: notas de teste costumam usar CNPJs ficticios.
        avisos.append(f"Dígitos verificadores do CNPJ {fornecedor.cnpj} não conferem.")

    if not faturado.nomeCompleto:
        problemas.append("Nome do faturado (destinatário) não foi extraído.")

    if not faturado.cpf:
        avisos.append("Faturado sem CPF (o destinatário pode ser pessoa jurídica).")
    elif not RE_CPF.match(faturado.cpf):
        problemas.append(f"CPF do faturado fora do formato 000.000.000-00: {faturado.cpf}")
    elif not _dv_cpf_valido(faturado.cpf):
        avisos.append(f"Dígitos verificadores do CPF {faturado.cpf} não conferem.")

    if not dados.numeroNotaFiscal:
        problemas.append("Número da nota fiscal não foi extraído.")

    emissao = _data(dados.dataEmissao)
    if not dados.dataEmissao:
        problemas.append("Data de emissão não foi extraída.")
    elif emissao is None:
        problemas.append(f"Data de emissão fora do formato YYYY-MM-DD: {dados.dataEmissao}")
    elif emissao > date.today():
        avisos.append(f"Data de emissão no futuro: {dados.dataEmissao}")

    return problemas, avisos


def verificar_produtos(dados: EsquemaProdutos) -> Resultado:
    if not dados.descricaoProdutos:
        return ["Nenhum produto/serviço foi extraído da nota."], []
    return [], []


def verificar_financeiro(dados: EsquemaFinanceiro, data_emissao: str | None) -> Resultado:
    problemas: list[str] = []
    avisos: list[str] = []

    if dados.valorTotal is None:
        problemas.append("Valor total da nota não foi extraído.")
    elif dados.valorTotal <= 0:
        problemas.append(f"Valor total da nota deve ser positivo: {dados.valorTotal}")

    if not dados.parcelas:
        problemas.append("Nenhuma parcela foi extraída.")

    emissao = _data(data_emissao)
    for parcela in dados.parcelas:
        rotulo = f"Parcela {parcela.numero}"
        if parcela.valor is None:
            problemas.append(f"{rotulo} sem valor.")
        elif parcela.valor <= 0:
            problemas.append(f"{rotulo} com valor não positivo: {parcela.valor}")

        if parcela.dataVencimento is None:
            avisos.append(f"{rotulo} sem data de vencimento na nota.")
        elif (vencimento := _data(parcela.dataVencimento)) is None:
            problemas.append(
                f"{rotulo} com vencimento fora do formato YYYY-MM-DD: {parcela.dataVencimento}"
            )
        elif emissao and vencimento < emissao:
            avisos.append(f"{rotulo} vence ({parcela.dataVencimento}) antes da emissão.")

    valores = [p.valor for p in dados.parcelas]
    if dados.valorTotal and valores and None not in valores:
        soma = round(sum(valores), 2)  # type: ignore[arg-type]
        if abs(soma - dados.valorTotal) > TOLERANCIA_VALOR:
            problemas.append(
                f"A soma das parcelas ({soma:.2f}) não bate com o valor total "
                f"({dados.valorTotal:.2f})."
            )

    return problemas, avisos


def verificar_classificacao(dados) -> Resultado:
    """Recebe a classificacao normalizada da etapa ou, na consolidacao, a nota completa."""
    problemas: list[str] = []
    avisos: list[str] = list(getattr(dados, "observacoes", []))
    inativa = getattr(dados, "categoriaInativa", None)
    nova = getattr(dados, "novaCategoria", None)

    if inativa:
        problemas.append(
            f"A categoria “{inativa}” foi inativada pelo administrador e não pode ser "
            "recriada; use uma das categorias da lista."
        )
    elif not dados.tiposDespesa:
        problemas.append("Nenhuma categoria de despesa foi atribuída.")

    if nova:
        minimo, maximo = TAMANHO_NOME
        if not minimo <= len(nova.nome) <= maximo:
            problemas.append(
                f"O nome da nova categoria deve ter de {minimo} a {maximo} caracteres: “{nova.nome}”."
            )
        elif not nova.descricao:
            problemas.append(f"A nova categoria “{nova.nome}” precisa de uma descrição.")
        else:
            avisos.append(f"Categoria nova proposta pelo agent: {nova.nome} — {nova.descricao}")

    if len(dados.tiposDespesa) > 2:
        avisos.append(f"Nota classificada em {len(dados.tiposDespesa)} categorias; revise.")
    return problemas, avisos


def verificar_consolidacao(nota: NotaFiscalExtraida, categorias_validas: set[str]) -> Resultado:
    """Redundancia: repete todas as verificacoes sobre a nota ja montada.

    Pega inconsistencias que so aparecem juntando as etapas (ex.: a normalizacao
    final alterar algo) e garante que o JSON entregue respeita o contrato inteiro.
    """
    # Os avisos ja foram registrados nas etapas; aqui so interessam os problemas.
    problemas: list[str] = []
    for encontrados, _avisos in (
        verificar_identificacao(nota),
        verificar_produtos(nota),
        verificar_financeiro(nota, nota.dataEmissao),
        verificar_classificacao(nota),
    ):
        problemas += encontrados

    # Redundancia com a enumeracao da etapa: nenhuma categoria fora das ativas (ou da nova).
    for tipo in nota.tiposDespesa:
        if tipo not in categorias_validas:
            problemas.append(f"Categoria desconhecida ou inativa na nota: “{tipo}”.")

    if nota.quantidadeParcelas != len(nota.parcelas):
        problemas.append(
            f"quantidadeParcelas ({nota.quantidadeParcelas}) diferente do número de "
            f"parcelas ({len(nota.parcelas)})."
        )
    if [p.numero for p in nota.parcelas] != list(range(1, len(nota.parcelas) + 1)):
        problemas.append("Parcelas fora da sequência 1, 2, 3…")

    # Revalida o JSON final contra o esquema completo, como o front vai recebe-lo.
    NotaFiscalExtraida.model_validate(nota.model_dump(mode="json"))

    return problemas, []
