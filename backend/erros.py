"""Erros de validacao (422) em portugues, num texto so.

O front mostra `detail` quando ele e texto; a lista padrao do FastAPI (em ingles)
viraria so "Falha (HTTP 422)".
"""

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Tipo do erro do Pydantic -> mensagem; {chaves} vem do `ctx` do erro.
MENSAGENS = {
    "missing": "campo obrigatório",
    "string_too_short": "informe ao menos {min_length} caractere(s)",
    "string_too_long": "use no máximo {max_length} caracteres",
    "too_short": "informe ao menos {min_length} item(ns)",
    "too_long": "informe no máximo {max_length} item(ns)",
    "greater_than": "deve ser maior que {gt}",
    "greater_than_equal": "deve ser maior ou igual a {ge}",
    "less_than": "deve ser menor que {lt}",
    "less_than_equal": "deve ser menor ou igual a {le}",
    "decimal_max_places": "use no máximo {decimal_places} casas decimais",
    "decimal_max_digits": "use no máximo {max_digits} dígitos",
    "decimal_whole_digits": "use no máximo {whole_digits} dígitos antes da vírgula",
    "decimal_parsing": "informe um número válido",
    "decimal_type": "informe um número válido",
    "float_parsing": "informe um número válido",
    "float_type": "informe um número válido",
    "int_parsing": "informe um número inteiro",
    "int_type": "informe um número inteiro",
    "int_from_float": "informe um número inteiro",
    "bool_parsing": "informe verdadeiro ou falso",
    "bool_type": "informe verdadeiro ou falso",
    "date_parsing": "data inválida (use AAAA-MM-DD)",
    "date_from_datetime_parsing": "data inválida (use AAAA-MM-DD)",
    "date_from_datetime_inexact": "informe só a data, sem horário",
    "date_type": "data inválida (use AAAA-MM-DD)",
    "string_type": "informe um texto",
    "list_type": "informe uma lista",
    "dict_type": "formato inválido",
    "model_type": "formato inválido",
    "model_attributes_type": "formato inválido",
    "json_invalid": "JSON inválido",
    "enum": "valor inválido; use {expected}",
    "literal_error": "valor inválido; use {expected}",
}


def _mensagem(erro: dict) -> str:
    contexto = erro.get("ctx") or {}
    if erro["type"] == "value_error" and "error" in contexto:
        return str(contexto["error"])  # nossas regras ja levantam ValueError em portugues
    if contexto.get("min_length") == 1 and erro["type"] in ("string_too_short", "too_short"):
        return "não pode ficar vazio" if erro["type"] == "string_too_short" else "informe ao menos um"
    modelo = MENSAGENS.get(erro["type"])
    if modelo is None:
        return erro["msg"]
    if "expected" in contexto:
        contexto = {**contexto, "expected": str(contexto["expected"]).replace(" or ", " ou ")}
    try:
        return modelo.format(**contexto)
    except (KeyError, IndexError):
        return erro["msg"]


def _campo(local: tuple) -> str:
    """('body', 'parcelas', 1, 'valorParcela') -> 'parcelas nº 2 › valorParcela'."""
    partes = []
    for parte in local:
        if parte in ("body", "query", "path", "header"):
            continue
        partes.append(f"nº {parte + 1}" if isinstance(parte, int) else str(parte))
    return " › ".join(partes).replace(" › nº", " nº")


def descrever(erros: list[dict]) -> str:
    linhas = []
    for erro in erros:
        # No JSON invalido, o loc traz a posicao do caractere, nao um campo.
        campo = "" if erro["type"] == "json_invalid" else _campo(tuple(erro.get("loc", ())))
        linhas.append(f"{campo}: {_mensagem(erro)}" if campo else _mensagem(erro))
    return "; ".join(dict.fromkeys(linhas))


async def tratar_validacao(_: Request, erro: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": descrever(erro.errors())})
