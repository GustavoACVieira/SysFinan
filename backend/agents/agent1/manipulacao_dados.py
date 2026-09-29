"""Agent1 — responsavel por ler o PDF da nota fiscal e devolver os dados estruturados.

A extracao e feita em etapas (ver etapas.py), cada uma com seu esquema Pydantic.
O agent so avanca para a proxima etapa quando a atual e aprovada pela
verificacao; se reprovar, a etapa e refeita informando o que estava errado e,
se continuar reprovada, o pipeline para ali. No fim, a consolidacao repete todas
as verificacoes sobre a nota completa (redundancia).
"""

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, ValidationError

from models import (
    NotaFiscalExtraida,
    ResultadoExtracao,
    SaudeAgent,
    StatusEtapa,
    StatusModelo,
    TesteGeracao,
    VerificacaoEtapa,
)

from .etapas import ETAPAS, ID_CONSOLIDACAO, TITULO_CONSOLIDACAO, Contexto, Etapa
from .verificacao import verificar_consolidacao

logger = logging.getLogger(__name__)

# Cadeia do melhor Flash para o mais disponivel. Os modelos mais novos vivem
# sobrecarregados (HTTP 503), entao caimos para o seguinte em vez de falhar.
MODELOS_PADRAO = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)
# Poucas tentativas HTTP por modelo: quem da resiliencia aqui e a cadeia de fallback,
# e repetir muito no mesmo modelo sobrecarregado so aumenta a espera do usuario.
TENTATIVAS_HTTP = 2
# Quantas vezes uma etapa pode ser executada ate ser aprovada na verificacao.
TENTATIVAS_ETAPA = 2
# Erros repetidos no mesmo modelo. O 429 (cota) fica de fora: a cota do Gemini e
# separada por modelo, entao em vez de insistir no esgotado passamos ao proximo.
STATUS_REPETIVEIS = [408, 500, 502, 503, 504]
COTA_ESGOTADA = 429


def _ms(inicio: float) -> int:
    return round((time.perf_counter() - inicio) * 1000)


class _Ping(BaseModel):
    ok: bool


class Agent1:
    """Agent responsável pela extração dos dados da nota fiscal via Gemini."""

    def __init__(self, api_key: str | None = None, modelo: str | None = None):
        self._api_key = api_key or os.getenv("GEMINI_API_KEY")
        self._modelos = self._montar_cadeia(modelo or os.getenv("GEMINI_MODEL"))
        self._client: genai.Client | None = None

    @staticmethod
    def _montar_cadeia(preferido: str | None) -> tuple[str, ...]:
        """Modelo preferido na frente, seguido dos demais como reserva."""
        if not preferido:
            return MODELOS_PADRAO
        # Aceita uma lista explicita separada por virgula em GEMINI_MODEL.
        escolhidos = [m.strip() for m in preferido.split(",") if m.strip()]
        reservas = [m for m in MODELOS_PADRAO if m not in escolhidos]
        return tuple(escolhidos + reservas)

    @property
    def api_key_informada(self) -> bool:
        return bool(self._api_key)

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def definir_api_key(self, api_key: str | None) -> None:
        """Troca a chave em tempo de execucao; o client e recriado na proxima chamada."""
        self._api_key = api_key or None
        self._client = None

    def _obter_client(self) -> genai.Client:
        """Cria o client sob demanda, para a API subir mesmo sem a chave configurada."""
        if self._client is None:
            if not self._api_key:
                raise RuntimeError(
                    "Chave da API do Gemini não informada. Cadastre-a na tela de configuração."
                )
            self._client = genai.Client(
                api_key=self._api_key,
                # Repete a chamada em erros transitórios do Gemini (429, 5xx).
                http_options=types.HttpOptions(
                    retry_options=types.HttpRetryOptions(
                        attempts=TENTATIVAS_HTTP, http_status_codes=STATUS_REPETIVEIS
                    )
                ),
            )
        return self._client

    # -----------------------------------------------------------------------
    # Extracao em etapas
    # -----------------------------------------------------------------------

    def extrair_dados(self, caminho_arquivo: str | Path) -> ResultadoExtracao:
        """Lê o PDF da nota fiscal e devolve os dados estruturados com o relatório das etapas."""
        pdf = types.Part.from_bytes(
            data=Path(caminho_arquivo).read_bytes(), mime_type="application/pdf"
        )
        contexto: Contexto = {}
        relatorio: list[VerificacaoEtapa] = []

        for indice, etapa in enumerate(ETAPAS):
            verificacao = self._executar_etapa(etapa, pdf, contexto)
            relatorio.append(verificacao)

            if verificacao.status is not StatusEtapa.CONCLUIDA:
                # Trava: sem a etapa atual aprovada, nenhuma das seguintes roda.
                relatorio += [self._nao_executada(e.id, e.titulo) for e in ETAPAS[indice + 1 :]]
                relatorio.append(self._nao_executada(ID_CONSOLIDACAO, TITULO_CONSOLIDACAO))
                return ResultadoExtracao(concluida=False, etapas=relatorio)

        verificacao, nota = self._consolidar(contexto)
        relatorio.append(verificacao)
        concluida = verificacao.status is StatusEtapa.CONCLUIDA
        return ResultadoExtracao(
            concluida=concluida, etapas=relatorio, dados=nota if concluida else None
        )

    def _executar_etapa(
        self, etapa: Etapa, pdf: types.Part, contexto: Contexto
    ) -> VerificacaoEtapa:
        """Roda a etapa até ela ser aprovada na verificação ou acabarem as tentativas."""
        inicio = time.perf_counter()
        config = types.GenerateContentConfig(
            system_instruction=etapa.instrucao,
            response_mime_type="application/json",
            response_schema=etapa.esquema,
            # Gemini 3 e otimizado para os valores padrao de amostragem: forcar
            # temperature baixa degrada o raciocinio e pode causar loops.
        )
        problemas: list[str] = []
        avisos: list[str] = []
        modelo: str | None = None

        for tentativa in range(1, TENTATIVAS_ETAPA + 1):
            pedido = etapa.pedido(contexto)
            if problemas:
                # Redundancia: a nova leitura recebe os motivos da reprovacao anterior.
                pedido += (
                    "\n\nATENÇÃO: a leitura anterior desta etapa foi reprovada na verificação "
                    "pelos motivos abaixo. Releia o documento com cuidado e corrija:\n"
                    + "\n".join(f"- {p}" for p in problemas)
                )
            conteudo = [pdf, pedido] if etapa.usa_pdf else [pedido]

            resposta, modelo = self._gerar_com_fallback(conteudo, config)
            dados = resposta.parsed
            if not isinstance(dados, etapa.esquema):
                problemas, avisos = ["O modelo não devolveu um JSON no esquema da etapa."], []
                logger.warning("Etapa %s, tentativa %d: resposta fora do esquema.", etapa.id, tentativa)
                continue

            dados = etapa.normalizar(dados)
            problemas, avisos = etapa.verificar(dados, contexto)
            if not problemas:
                contexto.update(dados.model_dump(mode="json"))
                return VerificacaoEtapa(
                    etapa=etapa.id,
                    titulo=etapa.titulo,
                    status=StatusEtapa.CONCLUIDA,
                    tentativas=tentativa,
                    modelo=modelo,
                    duracaoMs=_ms(inicio),
                    avisos=avisos,
                )
            logger.warning("Etapa %s reprovada na tentativa %d: %s", etapa.id, tentativa, problemas)

        return VerificacaoEtapa(
            etapa=etapa.id,
            titulo=etapa.titulo,
            status=StatusEtapa.FALHOU,
            tentativas=TENTATIVAS_ETAPA,
            modelo=modelo,
            duracaoMs=_ms(inicio),
            problemas=problemas,
            avisos=avisos,
        )

    @staticmethod
    def _consolidar(contexto: Contexto) -> tuple[VerificacaoEtapa, NotaFiscalExtraida | None]:
        """Monta a nota com o que as etapas aprovaram e verifica o conjunto."""
        inicio = time.perf_counter()
        nota: NotaFiscalExtraida | None = None
        try:
            nota = NotaFiscalExtraida.model_validate(contexto)
            problemas, _ = verificar_consolidacao(nota)
        except ValidationError as erro:
            problemas = [f"JSON final fora do esquema: {e['loc']} — {e['msg']}" for e in erro.errors()]

        return (
            VerificacaoEtapa(
                etapa=ID_CONSOLIDACAO,
                titulo=TITULO_CONSOLIDACAO,
                status=StatusEtapa.FALHOU if problemas else StatusEtapa.CONCLUIDA,
                tentativas=1,
                duracaoMs=_ms(inicio),
                problemas=problemas,
            ),
            nota,
        )

    @staticmethod
    def _nao_executada(id_etapa: str, titulo: str) -> VerificacaoEtapa:
        return VerificacaoEtapa(etapa=id_etapa, titulo=titulo, status=StatusEtapa.NAO_EXECUTADA)

    def _gerar_com_fallback(
        self, conteudo: list, config: types.GenerateContentConfig
    ) -> tuple[types.GenerateContentResponse, str]:
        """Percorre a cadeia de modelos ate um responder; devolve a resposta e o modelo.

        Troca de modelo em erro de servidor (5xx, tipicamente sobrecarga) e em cota
        esgotada (429), porque cada modelo tem a sua cota. Erros de chave ou de
        requisicao invalida sobem direto: trocar de modelo nao resolveria e so
        mascararia a causa real.
        """
        client = self._obter_client()
        ultimo_erro: genai_errors.APIError | None = None

        for modelo in self._modelos:
            try:
                resposta = client.models.generate_content(
                    model=modelo, contents=conteudo, config=config
                )
            except genai_errors.APIError as erro:
                if not isinstance(erro, genai_errors.ServerError) and erro.code != COTA_ESGOTADA:
                    raise
                logger.warning("Modelo %s indisponivel (%s); tentando o proximo.", modelo, erro.code)
                ultimo_erro = erro
                continue

            if modelo != self._modelos[0]:
                logger.info("Chamada atendida pelo modelo reserva %s.", modelo)
            return resposta, modelo

        raise ultimo_erro  # type: ignore[misc]

    # -----------------------------------------------------------------------
    # Verificacao de funcionamento
    # -----------------------------------------------------------------------

    def verificar_funcionamento(self) -> SaudeAgent:
        """Diagnostica o agent: chave, modelos da cadeia e uma geração estruturada real."""
        base = {
            "etapas": [e.titulo for e in ETAPAS] + [TITULO_CONSOLIDACAO],
            "verificadoEm": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        if not self._api_key:
            return SaudeAgent(
                status="inoperante",
                mensagem="Chave da API do Gemini não informada.",
                chaveInformada=False,
                **base,
            )

        client = self._obter_client()
        modelos: list[StatusModelo] = []
        for modelo in self._modelos:
            inicio = time.perf_counter()
            try:
                client.models.get(model=modelo)
                modelos.append(StatusModelo(modelo=modelo, disponivel=True, latenciaMs=_ms(inicio)))
            except genai_errors.APIError as erro:
                if chave_recusada(erro):
                    return SaudeAgent(
                        status="inoperante",
                        mensagem="O Gemini recusou a chave da API. Verifique a chave cadastrada.",
                        chaveInformada=True,
                        chaveValida=False,
                        **base,
                    )
                modelos.append(
                    StatusModelo(
                        modelo=modelo, disponivel=False, latenciaMs=_ms(inicio), erro=_resumo(erro)
                    )
                )

        teste = self._testar_geracao()
        preferido_ok = bool(modelos) and modelos[0].disponivel and teste.modelo == self._modelos[0]

        if not teste.sucesso and teste.cotaEsgotada:
            status = "inoperante"
            mensagem = (
                "A cota da chave acabou em todos os modelos. Aguarde a renovação "
                "(por minuto e por dia no plano gratuito) ou use uma chave com faturamento."
            )
        elif not teste.sucesso:
            status, mensagem = "inoperante", "O Gemini não conseguiu gerar uma resposta estruturada."
        elif preferido_ok and all(m.disponivel for m in modelos):
            status, mensagem = "operacional", "Agent funcionando com o modelo preferido."
        else:
            status = "degradado"
            mensagem = f"Agent funcionando, mas atendido pelo modelo reserva {teste.modelo}."
            if preferido_ok:
                mensagem = "Agent funcionando, mas há modelos reserva indisponíveis."

        return SaudeAgent(
            status=status,
            mensagem=mensagem,
            chaveInformada=True,
            chaveValida=True,
            modelos=modelos,
            testeGeracao=teste,
            **base,
        )

    def _testar_geracao(self) -> TesteGeracao:
        """Mesmo caminho das etapas (cadeia de modelos + JSON com esquema), em miniatura."""
        inicio = time.perf_counter()
        config = types.GenerateContentConfig(
            response_mime_type="application/json", response_schema=_Ping
        )
        try:
            resposta, modelo = self._gerar_com_fallback(
                ['Teste de funcionamento. Responda exatamente {"ok": true}.'], config
            )
        except genai_errors.APIError as erro:
            return TesteGeracao(
                sucesso=False,
                latenciaMs=_ms(inicio),
                erro=_resumo(erro),
                cotaEsgotada=erro.code == COTA_ESGOTADA,
            )

        sucesso = isinstance(resposta.parsed, _Ping) and resposta.parsed.ok
        return TesteGeracao(
            sucesso=sucesso,
            modelo=modelo,
            latenciaMs=_ms(inicio),
            erro=None if sucesso else "Resposta fora do esquema esperado.",
        )


def chave_recusada(erro: genai_errors.APIError) -> bool:
    # Chave invalida volta como 400 INVALID_ARGUMENT ("API key not valid"), nao so 401/403.
    return erro.code in (401, 403) or (erro.code == 400 and "API key" in (erro.message or ""))


def _resumo(erro: genai_errors.APIError) -> str:
    if erro.code == COTA_ESGOTADA:
        return "HTTP 429: cota da chave esgotada"
    return f"HTTP {erro.code}: {(erro.message or erro.status or 'erro desconhecido')[:160]}"
