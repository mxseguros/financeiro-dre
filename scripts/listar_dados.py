from supabase import create_client
from _config import SUPABASE_URL, SERVICE_KEY

sb = create_client(SUPABASE_URL, SERVICE_KEY)

print("=== USUARIOS ===")
r = sb.table("usuarios").select("id,nome,email,role,ativo").order("nome").execute()
for u in r.data:
    status = "ATIVO " if u["ativo"] else "INATIVO"
    print(f"  [{u['role']:10}] {status} | {u['nome']:35} | {u['email']}")

print()
print("=== BANCOS ===")
r = sb.table("bancos").select("id,nome,ativo").order("nome").execute()
for b in r.data:
    status = "ATIVO " if b["ativo"] else "INATIVO"
    print(f"  {status} | {b['nome']}")

print()
print("=== CENTROS DE CUSTO ===")
r = sb.table("centros_custo").select("id,nome,codigo,ativo").order("nome").execute()
for c in r.data:
    print(f"  {c['codigo']:12} | {c['nome']}")

print()
print("=== TIPOS DE LANCAMENTO ===")
r = sb.table("tipos_lancamento").select("id,nome,natureza,ativo").order("natureza,nome").execute()
for t in r.data:
    status = "ATIVO " if t["ativo"] else "INATIVO"
    print(f"  [{t['natureza']:8}] {status} | {t['nome']}")

print()
print("=== DESPESAS (todas) ===")
r = sb.table("despesas").select("id,descricao,valor,competencia,status").order("criado_em", desc=True).limit(50).execute()
if r.data:
    for d in r.data:
        print(f"  [{d.get('status','?'):10}] {d.get('competencia','?'):8} R${float(d.get('valor',0)):>10.2f} | {str(d.get('descricao',''))[:60]}")
else:
    print("  Nenhuma despesa encontrada")

print()
print("=== RECEITAS (todas) ===")
r = sb.table("receitas").select("id,descricao,valor,competencia").order("criado_em", desc=True).limit(50).execute()
if r.data:
    for rc in r.data:
        print(f"  {rc.get('competencia','?'):8} R${float(rc.get('valor',0)):>10.2f} | {str(rc.get('descricao',''))[:60]}")
else:
    print("  Nenhuma receita encontrada")
