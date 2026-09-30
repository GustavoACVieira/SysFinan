"""Agent1 — responsavel por ler o PDF da nota fiscal e devolver os dados estruturados.

A extracao e feita em etapas (ver etapas.py). O agent so avanca para a proxima
quando a atual e aprovada pela verificacao; no fim, a consolidacao verifica a
nota completa.
"""

import logging
import os
import time
from pathlib import Path

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import ValidationError

import categorias
from models import NotaFiscalExtraida, ResultadoExtracao, StatusEtapa, VerificacaoEtapa

from .etapas import ETAPAS, ID_CONSOLIDACAO, TITULO_CONSOLIDACAO, Contexto, Etapa
from .verificacao import verificar_consolidacao

logger = logging.getLogger(__name__)

# Do preferido para os reservas; cai para o proximo quando um esta sobrecarregado.
MODELOS_PADRAO = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)
TENTATIVAS_HTTP = 1
TIMEOUT_MS = 90_000
# Depois que um reserva atende, as chamadas seguintes comecam por ele durante este tempo.
FIXAR_RESERVA_POR_S = 300
TENTATIVAS_ETAPA = 2
# O 429 fica de fora: a cota e por modelo, entao passamos direto ao proximo.
STATUS_REPETIVEIS = [408, 500, 502, 503, 504]
COTA_ESGOTADA = 429
TIMEOUT_VERIFICACAO_MS = 15_000


class ChaveInvalida(Exception):
    """O Google recusou a chave da API."""


class VerificacaoIndisponivel(Exception):
    """Nao foi possivel falar com o Google para conferir a chave."""


def _ms(inicio: float) -> int:
    return round((time.perf_counter() - inicio) * 1000)


class Agent1:
    """Agent responsável pela extração dos dados da nota fiscal via Gemini."""

    def __init__(self, api_key: str | None = None, modelo: str | None = None):
        # A chave nao vem do ambiente: e informada pela tela e fica so em memoria.
        self._api_key = api_key
        self._modelos = self._montar_cadeia(modelo or os.getenv("GEMINI_MODEL"))
        self._client: genai.Client | None = None
        self._reserva_fixada: str | None = None
        self._reserva_ate = 0.0

    @staticmethod
    def _montar_cadeia(preferido: str | None) -> tuple[str, ...]:
        """Modelo(s) de GEMINI_MODEL na frente, seguidos dos demais como reserva."""
        if not preferido:
            return MODELOS_PADRAO
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
        self._api_key = api_key or None
        self._client = None

    @staticmethod
    def verificar_api_key(chave: str) -> None:
        """Confere a chave no Google listando modelos (nao gera texto nem gasta cota)."""
        client = genai.Client(
            api_key=chave,
            http_options=types.HttpOptions(
                timeout=TIMEOUT_VERIFICACAO_MS,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
        try:
            next(iter(client.models.list(config={"page_size": 1})), None)
        except genai_errors.APIError as erro:
            if chave_recusada(erro):
                raise ChaveInvalida(
                    "Chave inválida: o Google recusou esta chave. Confira se ela foi copiada inteira."
                ) from erro
            if erro.code == COTA_ESGOTADA:
                return  # a chave autenticou; so a cota que acabou
            raise VerificacaoIndisponivel(
                "Não foi possível verificar a chave agora (Gemini indisponível). Tente novamente."
            ) from erro
        except httpx.HTTPError as erro:
            raise VerificacaoIndisponivel(
                "Não foi possível verificar a chave agora (sem resposta do Google). Tente novamente."
            ) from erro

    def _obter_client(self) -> genai.Client:
        if self._client is None:
            if not self._api_key:
                raise RuntimeError(
                    "Chave da API do Gemini não informada. Cadastre-a na tela de configuração."
                )
            self._client = genai.Client(
                api_key=self._api_key,
                http_options=types.HttpOptions(
                    timeout=TIMEOUT_MS,
                    retry_options=types.HttpRetryOptions(
                        attempts=TENTATIVAS_HTTP, http_status_codes=STATUS_REPETIVEIS
                    ),
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
                relatorio += [self._nao_executada(e.id, e.titulo) for e in ETAPAS[indice + 1 :]]
                relatorio.append(self._nao_executada(ID_CONSOLIDACAO, TITULO_CONSOLIDACAO))
                return ResultadoExtracao(concluida=False, etapas=relatorio)

        verificacao, nota = self._consolidar(contexto)
        relatorio.append(verificacao)
        if verificacao.status is not StatusEtapa.CONCLUIDA:
            return ResultadoExtracao(concluida=False, etapas=relatorio)

        # So salva a categoria nova depois que a nota inteira foi aprovada.
        criada = None
        if proposta := contexto.get("novaCategoria"):
            criada = categorias.repositorio.criar(
                proposta["nome"], proposta["descricao"], nota_origem=nota.numeroNotaFiscal
            )
            logger.info("Categoria criada pelo agent: %s", criada.nome)
        return ResultadoExtracao(concluida=True, etapas=relatorio, dados=nota, categoriaCriada=criada)

    def _executar_etapa(
        self, etapa: Etapa, pdf: types.Part, contexto: Contexto
    ) -> VerificacaoEtapa:
        """Roda a etapa até ela ser aprovada na verificação ou acabarem as tentativas."""
        inicio = time.perf_counter()
        esquema = etapa.esquema()
        config = types.GenerateContentConfig(
            system_instruction=etapa.instrucao(),
            response_mime_type="application/json",
            response_schema=esquema,
            thinking_config=types.ThinkingConfig(thinking_level=etapa.pensamento),
        )
        problemas: list[str] = []
        avisos: list[str] = []
        modelo: str | None = None

        for tentativa in range(1, TENTATIVAS_ETAPA + 1):
            pedido = etapa.pedido(contexto)
            if problemas:
                pedido += (
                    "\n\nATENÇÃO: a leitura anterior desta etapa foi reprovada na verificação "
                    "pelos motivos abaixo. Releia o documento com cuidado e corrija:\n"
                    + "\n".join(f"- {p}" for p in problemas)
                )
            conteudo = [pdf, pedido] if etapa.usa_pdf else [pedido]

            resposta, modelo = self._gerar_com_fallback(conteudo, config)
            dados = resposta.parsed
            if not isinstance(dados, esquema):
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
        validas = {c.nome for c in categorias.repositorio.ativas()}
        if proposta := contexto.get("novaCategoria"):
            validas.add(proposta["nome"])
        try:
            nota = NotaFiscalExtraida.model_validate(contexto)
            problemas, _ = verificar_consolidacao(nota, validas)
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

    def _ordem_modelos(self) -> tuple[str, ...]:
        reserva = self._reserva_fixada
        if reserva is None or time.monotonic() > self._reserva_ate:
            return self._modelos
        inicio = self._modelos.index(reserva)
        return self._modelos[inicio:] + self._modelos[:inicio]

    def _gerar_com_fallback(
        self, conteudo: list, config: types.GenerateContentConfig
    ) -> tuple[types.GenerateContentResponse, str]:
        """Percorre a cadeia de modelos ate um responder; devolve a resposta e o modelo.

        Troca de modelo em 5xx, 429 e timeout. Erros de chave ou de requisicao
        invalida sobem direto, porque trocar de modelo nao resolveria.
        """
        client = self._obter_client()
        ultimo_erro: Exception | None = None

        for modelo in self._ordem_modelos():
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
            except httpx.TimeoutException as erro:
                logger.warning("Modelo %s nao respondeu a tempo; tentando o proximo.", modelo)
                ultimo_erro = erro
                continue

            if modelo == self._modelos[0]:
                self._reserva_fixada = None
            else:
                logger.info("Chamada atendida pelo modelo reserva %s; fixando-o.", modelo)
                self._reserva_fixada = modelo
                self._reserva_ate = time.monotonic() + FIXAR_RESERVA_POR_S
            return resposta, modelo

        raise ultimo_erro  # type: ignore[misc]


def chave_recusada(erro: genai_errors.APIError) -> bool:
    # Chave invalida tambem volta como 400 ("API key not valid"), nao so 401/403.
    return erro.code in (401, 403) or (erro.code == 400 and "API key" in (erro.message or ""))
