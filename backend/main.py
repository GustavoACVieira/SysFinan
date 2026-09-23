"""API de extração de dados de nota fiscal (1ª etapa)."""

import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from google.genai import errors as genai_errors

load_dotenv()

from agents.agent1.manipulacao_dados import Agent1  # noqa: E402
from models import NotaFiscalExtraida  # noqa: E402

TAMANHO_MAXIMO = 20 * 1024 * 1024  # limite de PDF enviado inline ao Gemini

app = FastAPI(title="SysFinan — Extração de Nota Fiscal", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

agent1 = Agent1()


@app.post("/extrair", response_model=NotaFiscalExtraida)
async def extrair(arquivo: UploadFile = File(...)) -> NotaFiscalExtraida:
    """Recebe o PDF da nota fiscal e devolve os dados extraídos pelo Agent1."""
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
        if erro.code in (401, 403):
            detalhe = "Chave do Gemini inválida ou sem permissão. Verifique a GEMINI_API_KEY."
        elif erro.code == 429:
            detalhe = "Limite de uso da API do Gemini atingido. Tente novamente em instantes."
        else:
            detalhe = f"Requisição recusada pelo Gemini: {erro.message}"
        raise HTTPException(status_code=502, detail=detalhe) from erro
    except genai_errors.ServerError as erro:
        raise HTTPException(
            status_code=503, detail="Gemini indisponível no momento. Tente novamente."
        ) from erro
    except Exception as erro:
        raise HTTPException(
            status_code=502, detail=f"Falha ao extrair os dados: {erro}"
        ) from erro
    finally:
        caminho.unlink(missing_ok=True)
