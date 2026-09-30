"""API de extração de dados de nota fiscal (1ª etapa)."""

import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from google.genai import errors as genai_errors
from pydantic import BaseModel

load_dotenv(Path(__file__).with_name(".env"))

import categorias  # noqa: E402
from agents.agent1.manipulacao_dados import (  # noqa: E402
    Agent1,
    ChaveInvalida,
    VerificacaoIndisponivel,
    chave_recusada,
)
from models import Categoria, ResultadoExtracao, SituacaoCategoria  # noqa: E402
from seguranca import Credenciais, Sessao, autenticar, encerrar, exigir_login  # noqa: E402

TAMANHO_MAXIMO = 20 * 1024 * 1024  # limite de PDF enviado inline ao Gemini

app = FastAPI(title="SysFinan — Extração de Nota Fiscal", version="0.1.0")

# No Render, FRONTEND_URL recebe a URL publica do front.
ORIGENS_PERMITIDAS = [
    origem.strip().rstrip("/")
    for origem in os.getenv(
        "FRONTEND_URL", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origem.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENS_PERMITIDAS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

agent1 = Agent1()
_chave_verificada_em: str | None = None


class NovaChaveApi(BaseModel):
    chave: str


class StatusChaveApi(BaseModel):
    informada: bool
    mascara: str | None = None
    verificadaEm: str | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def status_chave() -> StatusChaveApi:
    chave = agent1.api_key
    if not chave:
        return StatusChaveApi(informada=False)
    return StatusChaveApi(
        informada=True, mascara=f"••••{chave[-4:]}", verificadaEm=_chave_verificada_em
    )


@app.post("/login", response_model=Sessao)
def login(credenciais: Credenciais) -> Sessao:
    return autenticar(credenciais)


@app.post("/logout", status_code=204)
def logout(token: str = Depends(exigir_login)) -> None:
    encerrar(token)


@app.get("/chave-api", response_model=StatusChaveApi, dependencies=[Depends(exigir_login)])
def obter_chave_api() -> StatusChaveApi:
    return status_chave()


@app.put("/chave-api", response_model=StatusChaveApi, dependencies=[Depends(exigir_login)])
def salvar_chave_api(nova: NovaChaveApi) -> StatusChaveApi:
    global _chave_verificada_em
    chave = nova.chave.strip()
    if not chave:
        raise HTTPException(status_code=400, detail="Informe a chave da API.")
    try:
        Agent1.verificar_api_key(chave)
    except ChaveInvalida as erro:
        raise HTTPException(status_code=400, detail=str(erro)) from erro
    except VerificacaoIndisponivel as erro:
        raise HTTPException(status_code=503, detail=str(erro)) from erro

    # Fica so em memoria: nao e gravada em disco e se perde quando o servidor reinicia.
    agent1.definir_api_key(chave)
    _chave_verificada_em = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return status_chave()


@app.delete("/chave-api", response_model=StatusChaveApi, dependencies=[Depends(exigir_login)])
def remover_chave_api() -> StatusChaveApi:
    global _chave_verificada_em
    agent1.definir_api_key(None)
    _chave_verificada_em = None
    return status_chave()


@app.get("/categorias", response_model=list[Categoria], dependencies=[Depends(exigir_login)])
def listar_categorias() -> list[Categoria]:
    return categorias.repositorio.listar()


@app.put(
    "/categorias/situacao", response_model=Categoria, dependencies=[Depends(exigir_login)]
)
def alterar_situacao_categoria(situacao: SituacaoCategoria) -> Categoria:
    try:
        return categorias.repositorio.definir_ativa(situacao.nome, situacao.ativa)
    except ValueError as erro:
        raise HTTPException(status_code=400, detail=str(erro)) from erro
    except KeyError as erro:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.") from erro


@app.post(
    "/extrair", response_model=ResultadoExtracao, dependencies=[Depends(exigir_login)]
)
async def extrair(arquivo: UploadFile = File(...)) -> ResultadoExtracao:
    """Recebe o PDF da nota fiscal e devolve os dados extraídos pelo Agent1."""
    if not agent1.api_key_informada:
        raise HTTPException(
            status_code=400, detail="Informe a chave da API do Gemini antes de extrair."
        )
    if arquivo.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Envie um arquivo PDF.")

    conteudo = await arquivo.read()
    if len(conteudo) > TAMANHO_MAXIMO:
        raise HTTPException(status_code=413, detail="O PDF deve ter no máximo 20 MB.")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporario:
        temporario.write(conteudo)
        caminho = Path(temporario.name)

    try:
        # A chamada ao Gemini é bloqueante: roda fora do event loop.
        return await run_in_threadpool(agent1.extrair_dados, caminho)
    except RuntimeError as erro:
        raise HTTPException(status_code=500, detail=str(erro)) from erro
    except genai_errors.ClientError as erro:
        if chave_recusada(erro):
            detalhe = "Chave do Gemini inválida ou sem permissão. Verifique a chave cadastrada."
        elif erro.code == 429:
            detalhe = (
                "Cota da API do Gemini esgotada em todos os modelos. Aguarde a renovação "
                "(por minuto e por dia no plano gratuito) ou use uma chave com faturamento."
            )
        else:
            detalhe = f"Requisição recusada pelo Gemini: {erro.message}"
        raise HTTPException(status_code=502, detail=detalhe) from erro
    except genai_errors.ServerError as erro:
        raise HTTPException(
            status_code=503, detail="Gemini indisponível no momento. Tente novamente."
        ) from erro
    except httpx.TimeoutException as erro:
        raise HTTPException(
            status_code=504, detail="Nenhum modelo do Gemini respondeu a tempo. Tente novamente."
        ) from erro
    except Exception as erro:
        raise HTTPException(
            status_code=502, detail=f"Falha ao extrair os dados: {erro}"
        ) from erro
    finally:
        caminho.unlink(missing_ok=True)
