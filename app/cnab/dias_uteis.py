"""Dias úteis bancários: feriados nacionais (fixos e móveis) + extras."""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache


def pascoa(ano: int) -> date:
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    dia_sem = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * dia_sem) // 451
    mes = (h + dia_sem - 7 * m + 114) // 31
    dia = (h + dia_sem - 7 * m + 114) % 31 + 1
    return date(ano, mes, dia)


@lru_cache(maxsize=64)
def feriados_nacionais(ano: int) -> frozenset[date]:
    p = pascoa(ano)
    fixos = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15), (12, 25)]
    if ano >= 2024:
        fixos.append((11, 20))   # Consciência Negra (Lei 14.759/2023)
    moveis = [p - timedelta(days=48), p - timedelta(days=47),  # Carnaval (sem expediente bancário)
              p - timedelta(days=2),                           # Sexta-feira Santa
              p + timedelta(days=60)]                          # Corpus Christi
    return frozenset([date(ano, m, d) for m, d in fixos] + moveis)


def eh_dia_util(dia: date, extras: set[date] | frozenset[date] = frozenset()) -> bool:
    return dia.weekday() < 5 and dia not in feriados_nacionais(dia.year) and dia not in extras


def proximo_dia_util(dia: date, extras: set[date] | frozenset[date] = frozenset()) -> date:
    while not eh_dia_util(dia, extras):
        dia += timedelta(days=1)
    return dia
