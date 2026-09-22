"""API de extração de dados de nota fiscal (1ª etapa)."""

import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from agents.agent1.manipulacao_dados import Agent1  # noqa: E402
from models import NotaFiscalExtraida  # noqa: E402

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

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporario:
        temporario.write(await arquivo.read())
        caminho = Path(temporario.name)

    try:
        return agent1.extrair_dados(caminho)
    except RuntimeError as erro:
        raise HTTPException(status_code=500, detail=str(erro)) from erro
    except Exception as erro:
        raise HTTPException(
            status_code=502, detail=f"Falha ao extrair os dados: {erro}"
        ) from erro
    finally:
        caminho.unlink(missing_ok=True)
