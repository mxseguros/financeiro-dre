"""Client mínimo do supabase-py sobre listas em memória, para testes de service."""
from __future__ import annotations

from types import SimpleNamespace


def uid(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


class _Q:
    def __init__(self, db, tabela):
        self.db, self.tabela, self.filtros, self.op, self.dados = db, tabela, [], "select", None

    def select(self, *_a, count=None, **_k):
        self.contar = count is not None
        return self

    def gte(self, col, val):
        self.filtros.append(lambda r: (r.get(col) or "") >= val)
        return self

    def lte(self, col, val):
        self.filtros.append(lambda r: (r.get(col) or "") <= val)
        return self

    def gt(self, col, val):
        self.filtros.append(lambda r: (r.get(col) or "") > val)
        return self

    def lt(self, col, val):
        # Como no Postgres: NULL < x é falso.
        self.filtros.append(lambda r: r.get(col) is not None and r.get(col) < val)
        return self

    def single(self):
        return self.maybe_single()

    def ilike(self, col, padrao):
        termo = padrao.strip("%").lower()
        self.filtros.append(lambda r: termo in (r.get(col) or "").lower())
        return self

    def or_(self, expr):
        # Formatos usados pelo app: "col.is.null,col.not.in.(a,b)" e listas
        # simples de "col.op.valor" (op: eq, gt, lt, gte, lte, is.null).
        if ".not.in.(" in expr:
            partes = expr.split(",", 1)
            col = partes[0].split(".")[0]
            fora = set(partes[1].split(".not.in.(", 1)[1].rstrip(")").split(","))
            self.filtros.append(lambda r: r.get(col) is None or r.get(col) not in fora)
            return self
        testes = []
        for termo in expr.split(","):
            col, op, val = termo.split(".", 2)
            testes.append((col, op, val))

        def _ok(r):
            for col, op, val in testes:
                v = r.get(col)
                if op == "is" and val == "null" and v is None:
                    return True
                if v is None:
                    continue
                v = str(v)
                if (op == "eq" and v == val) or (op == "gt" and v > val) or (op == "lt" and v < val)                         or (op == "gte" and v >= val) or (op == "lte" and v <= val):
                    return True
            return False
        self.filtros.append(_ok)
        return self

    @property
    def not_(self):
        q = self

        class _Not:
            def is_(self, col, val):
                alvo = None if val == "null" else val
                q.filtros.append(lambda r: r.get(col) is not alvo)
                return q
        return _Not()

    def is_(self, col, val):
        alvo = None if val == "null" else val
        self.filtros.append(lambda r: r.get(col) is alvo)
        return self

    def maybe_single(self):
        self.unico = True
        return self

    def range(self, ini, fim):
        self.fatia = (ini, fim)
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
        if getattr(self, "unico", False):
            return SimpleNamespace(data=dict(alvo[0]) if alvo else None)
        if getattr(self, "fatia", None):
            alvo = alvo[self.fatia[0]:self.fatia[1] + 1]
        return SimpleNamespace(data=[dict(r) for r in alvo], count=len(alvo) if getattr(self, "contar", False) else None)


class _Bucket:
    def __init__(self, db, nome):
        self.db, self.nome = db, nome

    def create_signed_upload_url(self, path):
        return {"signed_url": f"https://s/{path}?token=t", "token": "t", "path": path}

    def create_signed_url(self, path, _exp, *_a):
        return {"signedURL": f"https://s/download/{path}"}

    def upload(self, path, conteudo, *_a):
        self.db.arquivos[path] = conteudo
        return {"path": path}

    def remove(self, paths):
        self.db.removidos.extend(paths)
        return []


class Db:
    def __init__(self, padroes: dict | None = None, **tabelas):
        self.tabelas = tabelas
        self.padroes = padroes or {}
        self.seq = 0
        self.removidos: list[str] = []
        self.arquivos: dict[str, bytes] = {}
        self.funcoes: dict = {}
        self.storage = SimpleNamespace(from_=lambda nome: _Bucket(self, nome))

    def table(self, nome):
        return _Q(self, nome)

    def rpc(self, nome, params):
        resultado = self.funcoes[nome](self, params)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=resultado))
