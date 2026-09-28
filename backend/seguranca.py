"""Login do administrador e sessoes da API.

Ha um unico usuario (admin). As sessoes ficam em memoria: reiniciar o servidor
derruba todas e o front volta para a tela de login.
"""

import os
import secrets
import time

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

USUARIO_PADRAO = "admin"
SENHA_PADRAO = "cruzeiro"
DURACAO_SESSAO = 8 * 60 * 60  # segundos

_sessoes: dict[str, float] = {}  # token -> instante de expiracao
_bearer = HTTPBearer(auto_error=False)


class Credenciais(BaseModel):
    usuario: str
    senha: str


class Sessao(BaseModel):
    token: str


def autenticar(credenciais: Credenciais) -> Sessao:
    """Confere usuario e senha e abre uma sessao nova."""
    usuario = os.getenv("SYSFINAN_USUARIO", USUARIO_PADRAO)
    senha = os.getenv("SYSFINAN_SENHA", SENHA_PADRAO)

    # compare_digest evita vazar, pelo tempo de resposta, quantos caracteres batem.
    usuario_ok = secrets.compare_digest(credenciais.usuario.encode(), usuario.encode())
    senha_ok = secrets.compare_digest(credenciais.senha.encode(), senha.encode())
    if not (usuario_ok and senha_ok):
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos.")

    token = secrets.token_urlsafe(32)
    _sessoes[token] = time.time() + DURACAO_SESSAO
    return Sessao(token=token)


def encerrar(token: str) -> None:
    _sessoes.pop(token, None)


def exigir_login(
    credenciais: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> str:
    """Dependencia das rotas protegidas: devolve o token da sessao valida."""
    token = credenciais.credentials if credenciais else None
    expira = _sessoes.get(token) if token else None

    if expira is None or expira < time.time():
        if token:
            _sessoes.pop(token, None)
        raise HTTPException(
            status_code=401,
            detail="Sessão expirada. Entre novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token
