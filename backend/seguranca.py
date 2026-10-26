"""Login do administrador e sessoes da API (em memoria).

A sessao acaba no que vier primeiro:
- inatividade: SYSFINAN_INATIVIDADE_MIN minutos sem nenhuma requisicao autenticada (padrao 30);
- limite absoluto: 8 horas depois do login, mesmo com uso continuo.
"""

import os
import secrets
import time
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

USUARIO_PADRAO = "admin"
SENHA_PADRAO = "cruzeiro"
DURACAO_SESSAO = 8 * 60 * 60  # segundos
INATIVIDADE_PADRAO = 30  # minutos


@dataclass
class _Registro:
    limite: float  # fim das 8 h, contado do login
    ultimo_uso: float  # ultima requisicao autenticada


_sessoes: dict[str, _Registro] = {}  # token -> registro
_bearer = HTTPBearer(auto_error=False)


def tempo_inatividade() -> int:
    """Segundos sem uso que encerram a sessao."""
    try:
        minutos = int(os.getenv("SYSFINAN_INATIVIDADE_MIN", INATIVIDADE_PADRAO))
    except ValueError:
        minutos = INATIVIDADE_PADRAO
    return max(minutos, 1) * 60


class Credenciais(BaseModel):
    usuario: str
    senha: str


class Sessao(BaseModel):
    token: str
    inatividadeSegundos: int


def autenticar(credenciais: Credenciais) -> Sessao:
    usuario = os.getenv("SYSFINAN_USUARIO", USUARIO_PADRAO)
    senha = os.getenv("SYSFINAN_SENHA", SENHA_PADRAO)

    usuario_ok = secrets.compare_digest(credenciais.usuario.encode(), usuario.encode())
    senha_ok = secrets.compare_digest(credenciais.senha.encode(), senha.encode())
    if not (usuario_ok and senha_ok):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos.")

    agora = time.time()
    token = secrets.token_urlsafe(32)
    _sessoes[token] = _Registro(limite=agora + DURACAO_SESSAO, ultimo_uso=agora)
    return Sessao(token=token, inatividadeSegundos=tempo_inatividade())


def encerrar(token: str) -> None:
    _sessoes.pop(token, None)


def exigir_login(
    credenciais: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Valida o token e renova a contagem de inatividade."""
    token = credenciais.credentials if credenciais else None
    registro = _sessoes.get(token) if token else None
    agora = time.time()

    if registro is None or agora > registro.limite:
        motivo = "Sessão expirada. Entre novamente."
    elif agora - registro.ultimo_uso > tempo_inatividade():
        motivo = "Sessão encerrada por inatividade. Entre novamente."
    else:
        registro.ultimo_uso = agora
        return token

    if token:
        _sessoes.pop(token, None)
    raise HTTPException(
        status_code=401, detail=motivo, headers={"WWW-Authenticate": "Bearer"}
    )
