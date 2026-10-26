"""Importa dados/catalogo.json e as fotos de imagens/ para o Supabase.

Uso (na pasta do projeto):  python scripts/importar.py

Pode ser executado várias vezes: atualiza o que já existe, sem duplicar.
Usa a SUPABASE_SECRET_KEY do arquivo .env (só roda neste computador).
Só usa a biblioteca padrão do Python.
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BUCKET = "catalogo"
TIPOS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def ler_env():
    env = {}
    for linha in (RAIZ / ".env").read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            chave, valor = linha.split("=", 1)
            env[chave.strip()] = valor.strip()
    for chave in ("SUPABASE_URL", "SUPABASE_SECRET_KEY"):
        if not env.get(chave):
            sys.exit(f"Falta {chave} no arquivo .env")
    return env


ENV = ler_env()
URL = ENV["SUPABASE_URL"].rstrip("/")
CHAVE = ENV["SUPABASE_SECRET_KEY"]


def chamar(metodo, caminho, corpo=None, cabecalhos=None):
    dados = corpo
    if corpo is not None and not isinstance(corpo, bytes):
        dados = json.dumps(corpo).encode("utf-8")
    h = {"apikey": CHAVE, "Authorization": f"Bearer {CHAVE}", "Content-Type": "application/json"}
    h.update(cabecalhos or {})
    for tentativa in range(1, 6):
        req = urllib.request.Request(URL + caminho, data=dados, method=metodo, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                texto = r.read().decode("utf-8")
                return json.loads(texto) if texto else None
        except urllib.error.HTTPError as e:
            # Instabilidade passageira do servidor: espera e tenta de novo.
            if e.code in (429, 500, 502, 503, 504) and tentativa < 5:
                time.sleep(2 * tentativa)
                continue
            sys.exit(f"Erro {e.code} em {metodo} {caminho}: {e.read().decode('utf-8', 'replace')[:300]}")
        except urllib.error.URLError:
            if tentativa < 5:
                time.sleep(2 * tentativa)
                continue
            raise


def upsert(tabela, linhas, conflito):
    return chamar(
        "POST",
        f"/rest/v1/{tabela}?on_conflict={conflito}",
        linhas,
        {"Prefer": "resolution=merge-duplicates,return=representation"},
    )


def enviar_foto(arquivo_local, destino):
    arquivo = RAIZ / arquivo_local
    tipo = TIPOS.get(arquivo.suffix.lower())
    if not arquivo.is_file() or not tipo:
        print(f"  ! foto não encontrada ou formato inválido: {arquivo_local}")
        return None
    chamar(
        "POST",
        f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(destino)}",
        arquivo.read_bytes(),
        {"Content-Type": tipo, "x-upsert": "true", "Cache-Control": "3600"},
    )
    return destino


def contar(tabela, filtro=""):
    req = urllib.request.Request(
        f"{URL}/rest/v1/{tabela}?select=id{filtro}",
        method="HEAD",
        headers={"apikey": CHAVE, "Authorization": f"Bearer {CHAVE}", "Prefer": "count=exact"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Range"].split("/")[-1])


def main():
    catalogo = json.loads((RAIZ / "dados" / "catalogo.json").read_text(encoding="utf-8"))
    negocio = catalogo["negocio"]

    print("1/4 Configurações...")
    chamar(
        "PATCH",
        "/rest/v1/configuracoes?id=eq.1",
        {
            "nome": negocio["nome"],
            "slogan": negocio["slogan"],
            "whatsapp_orcamentos": negocio["whatsapp_orcamentos"],
            "whatsapp_exibicao": negocio["whatsapp_exibicao"],
            "telefone_secundario": negocio.get("telefone_secundario", ""),
        },
    )

    print("2/4 Categorias...")
    categorias = upsert(
        "categorias",
        [{"nome": c["nome"], "icone": c["icone"], "tipo": c["tipo"], "ordem": c["ordem"]} for c in catalogo["categorias"]],
        "nome",
    )
    id_por_nome = {c["nome"]: c["id"] for c in categorias}

    print(f"3/4 Produtos e fotos ({len(catalogo['produtos'])})...")
    produtos = []
    for i, p in enumerate(catalogo["produtos"], 1):
        if p["categoria"] not in id_por_nome:
            sys.exit(f"Produto {p['id']} com categoria desconhecida: {p['categoria']}")
        imagem = enviar_foto(p["imagem"], f"produtos/{Path(p['imagem']).name}") if p.get("imagem") else None
        produtos.append(
            {
                "id": p["id"],
                "categoria_id": id_por_nome[p["categoria"]],
                "nome": p["nome"],
                "descricao": p.get("descricao", ""),
                "imagem": imagem,
                "ativo": p.get("ativo", True),
                "ordem": p["ordem"],
            }
        )
        if i % 25 == 0:
            print(f"   {i} fotos enviadas")
    upsert("produtos", produtos, "id")

    print(f"4/4 Inspirações ({len(catalogo['inspiracoes'])})...")
    inspiracoes = [
        {
            "id": f["id"],
            "imagem": enviar_foto(f["imagem"], f"inspiracoes/{Path(f['imagem']).name}"),
            "legenda": f.get("legenda", ""),
            "ordem": f["ordem"],
        }
        for f in catalogo["inspiracoes"]
    ]
    upsert("inspiracoes", inspiracoes, "id")

    print("\nResumo no banco:")
    print(f"  Categorias ......: {contar('categorias')} (galeria: {contar('categorias', '&tipo=eq.galeria')})")
    print(f"  Produtos ........: {contar('produtos')} (ativos: {contar('produtos', '&ativo=is.true')})")
    print(f"  Inspirações .....: {contar('inspiracoes')}")


if __name__ == "__main__":
    main()
