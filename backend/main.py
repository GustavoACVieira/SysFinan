"""API de extração de dados de nota fiscal (1ª etapa)."""

import os
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv, set_key
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from google.genai import errors as genai_errors
from pydantic import BaseModel

CAMINHO_ENV = Path(__file__).with_name(".env")
load_dotenv(CAMINHO_ENV)

from agents.agent1.manipulacao_dados import Agent1, chave_recusada  # noqa: E402
from models import ResultadoExtracao, SaudeAgent  # noqa: E402
from seguranca import Credenciais, Sessao, autenticar, encerrar, exigir_login  # noqa: E402

TAMANHO_MAXIMO = 20 * 1024 * 1024  # limite de PDF enviado inline ao Gemini

app = FastAPI(title="SysFinan — Extração de Nota Fiscal", version="0.1.0")

# Sem FRONTEND_URL, libera o Vite local (que atende tanto localhost quanto
# 127.0.0.1). No Render, FRONTEND_URL recebe a URL publica do front.
ORIGENS_PERMITIDAS = [
    origem.strip().rstrip("/")  # "https://x.onrender.com/" nao casaria com o Origin
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


class NovaChaveApi(BaseModel):
    chave: str


class StatusChaveApi(BaseModel):
    informada: bool
    mascara: str | None = None  # só o final da chave, para o usuário reconhecê-la


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def status_chave() -> StatusChaveApi:
    chave = agent1.api_key
    if not chave:
        return StatusChaveApi(informada=False)
    return StatusChaveApi(informada=True, mascara=f"••••{chave[-4:]}")


def gravar_chave(chave: str) -> None:
    """Aplica a chave no Agent1 e grava no .env, para sobreviver a um reinício."""
    agent1.definir_api_key(chave)
    os.environ["GEMINI_API_KEY"] = chave
    CAMINHO_ENV.touch(exist_ok=True)
    set_key(CAMINHO_ENV, "GEMINI_API_KEY", chave, quote_mode="never")


@app.get("/saude/agent", response_model=SaudeAgent, dependencies=[Depends(exigir_login)])
async def saude_agent() -> SaudeAgent:
    """Verifica o funcionamento do Agent1: chave, modelos e uma geração real."""
    return await run_in_threadpool(agent1.verificar_funcionamento)


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
    chave = nova.chave.strip()
    if not chave:
        raise HTTPException(status_code=400, detail="Informe a chave da API.")
    gravar_chave(chave)
    return status_chave()


@app.delete("/chave-api", response_model=StatusChaveApi, dependencies=[Depends(exigir_login)])
def remover_chave_api() -> StatusChaveApi:
    gravar_chave("")
    return status_chave()


@app.post(
    "/extrair", response_model=ResultadoExtracao, dependencies=[Depends(exigir_login)]
)
async def extrair(arquivo: UploadFile = File(...)) -> ResultadoExtracao:
    """Recebe o PDF da nota fiscal e devolve os dados extraídos pelo Agent1.

    A resposta traz o relatório de cada etapa; `dados` só vem preenchido quando
    todas as etapas foram aprovadas na verificação.
    """
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
