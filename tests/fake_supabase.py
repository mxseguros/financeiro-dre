"""Client mínimo do supabase-py sobre listas em memória, para testes de service."""
from __future__ import annotations

from types import SimpleNamespace


def uid(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


class _Q:
    def __init__(self, db, tabela):
        self.db, self.tabela, self.filtros, self.op, self.dados = db, tabela, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filtros.append(lambda r: r.get(col) == val)
        return self

    def neq(self, col, val):
        self.filtros.append(lambda r: r.get(col) != val)
        return self

    def in_(self, col, vals):
        vals = list(vals)
        self.filtros.append(lambda r: r.get(col) in vals)
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, _n):
        return self

    def insert(self, dados):
        self.op, self.dados = "insert", dados
        return self

    def update(self, dados):
        self.op, self.dados = "update", dados
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        linhas = self.db.tabelas.setdefault(self.tabela, [])
        alvo = [r for r in linhas if all(f(r) for f in self.filtros)]
        if self.op == "insert":
            novos = self.dados if isinstance(self.dados, list) else [self.dados]
            criados = []
            for d in novos:
                self.db.seq += 1
                nova = {**self.db.padroes.get(self.tabela, {}), "id": uid(1000 + self.db.seq), **d}
                linhas.append(nova)
                criados.append(nova)
            return SimpleNamespace(data=criados)
        if self.op == "update":
            for r in alvo:
                r.update(self.dados)
            return SimpleNamespace(data=alvo)
        if self.op == "delete":
            self.db.tabelas[self.tabela] = [r for r in linhas if r not in alvo]
            return SimpleNamespace(data=alvo)
        return SimpleNamespace(data=[dict(r) for r in alvo])


class _Bucket:
    def __init__(self, db, nome):
        self.db, self.nome = db, nome

    def create_signed_upload_url(self, path):
        return {"signed_url": f"https://s/{path}?token=t", "token": "t", "path": path}

    def create_signed_url(self, path, _exp):
        return {"signedURL": f"https://s/download/{path}"}

    def remove(self, paths):
        self.db.removidos.extend(paths)
        return []


class Db:
    def __init__(self, padroes: dict | None = None, **tabelas):
        self.tabelas = tabelas
        self.padroes = padroes or {}
        self.seq = 0
        self.removidos: list[str] = []
        self.storage = SimpleNamespace(from_=lambda nome: _Bucket(self, nome))

    def table(self, nome):
        return _Q(self, nome)
