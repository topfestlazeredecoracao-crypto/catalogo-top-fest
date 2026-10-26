"""Gera a cópia de reserva do catálogo em site/reserva/.

O site público usa essa cópia se o Supabase estiver fora do ar ou pausado.
Também serve como cópia de segurança das fotos dentro do GitHub.

Uso:  python scripts/gerar_reserva.py
Usa só a chave pública (lida de site/js/config.js) e a biblioteca padrão.
Roda sozinho no GitHub a cada poucos dias (.github/workflows/manter-ativo.yml),
o que também evita que o Supabase gratuito pause por falta de uso.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SITE = RAIZ / "site"
DESTINO = SITE / "reserva"
FOTOS = DESTINO / "fotos"

config = (SITE / "js" / "config.js").read_text(encoding="utf-8")
URL = re.search(r'supabaseUrl:\s*"([^"]+)"', config).group(1).rstrip("/")
CHAVE = re.search(r'supabaseKey:\s*"([^"]+)"', config).group(1)
BUCKET = re.search(r'bucket:\s*"([^"]+)"', config).group(1)


def baixar(url):
    for tentativa in range(1, 6):
        req = urllib.request.Request(url, headers={"apikey": CHAVE})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            # Instabilidade passageira do servidor: espera e tenta de novo.
            temporario = not isinstance(e, urllib.error.HTTPError) or e.code in (429, 500, 502, 503, 504)
            if not temporario or tentativa == 5:
                raise
            time.sleep(3 * tentativa)


def tabela(nome, consulta):
    return json.loads(baixar(f"{URL}/rest/v1/{nome}?{consulta}"))


def main():
    dados = {
        "configuracoes": tabela("configuracoes", "select=*&id=eq.1")[0],
        "categorias": tabela("categorias", "select=id,nome,icone,tipo,ordem&order=ordem,id"),
        "produtos": tabela("produtos", "select=id,categoria_id,nome,descricao,imagem,ativo,ordem,preco&ativo=is.true&order=ordem,nome"),
        "inspiracoes": tabela("inspiracoes", "select=id,imagem,legenda,ordem&order=ordem,id"),
    }
    if not dados["categorias"] or not dados["produtos"]:
        sys.exit("O banco voltou vazio; a reserva não foi alterada.")

    usadas = set()
    for item in dados["produtos"] + dados["inspiracoes"]:
        caminho = item.get("imagem")
        if not caminho:
            continue
        local = FOTOS / caminho
        if not local.exists():
            url = f"{URL}/storage/v1/object/public/{BUCKET}/" + urllib.parse.quote(caminho)
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(baixar(url))
        usadas.add(local.resolve())
        item["imagem"] = "reserva/fotos/" + caminho

    # Apaga fotos que não são mais usadas.
    for arq in FOTOS.rglob("*"):
        if arq.is_file() and arq.resolve() not in usadas:
            arq.unlink()

    arquivo = DESTINO / "catalogo.json"
    novo = json.dumps(dados, ensure_ascii=False, indent=1, sort_keys=True)
    antigo = arquivo.read_text(encoding="utf-8") if arquivo.exists() else ""
    if novo != antigo:
        arquivo.write_text(novo, encoding="utf-8")
        print("Reserva atualizada.")
    else:
        print("Reserva já estava em dia.")
    print(f"{len(dados['categorias'])} categorias, {len(dados['produtos'])} produtos, "
          f"{len(dados['inspiracoes'])} inspirações, {len(usadas)} fotos.")


if __name__ == "__main__":
    main()
