"""Envia as fotos e o texto da pasta chacara/ para a página da chácara.

Uso (na pasta do projeto):  python scripts/importar_chacara.py
  --forcar   substitui o que já estiver na página (sem ele, só preenche se estiver vazia)

Usa a SUPABASE_SECRET_KEY do arquivo .env (só roda neste computador).
Precisa do Pillow (pip install pillow) para reduzir as fotos.
"""
import io
import sys
import urllib.parse
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importar import BUCKET, RAIZ, chamar  # noqa: E402

PASTA = RAIZ / "chacara"
LADO = 1600

# Ordem e legendas das fotos (pelo nome do arquivo). Fotos novas na pasta entram no fim, sem legenda.
ORDEM = [
    ("WhatsApp Image 2026-11-18 at 23.34.58.jpeg", "Piscina com ducha"),
    ("WhatsApp Image 2026-11-18 at 23.35.04.jpeg", "Piscina e área externa"),
    ("WhatsApp Image 2026-11-18 at 23.34.59 (1).jpeg", "Casa, gramado e piscina"),
    ("WhatsApp Image 2026-11-18 at 23.35.00.jpeg", "Salão de festas coberto"),
    ("WhatsApp Image 2026-11-18 at 23.35.01.jpeg", "Área gourmet com churrasqueira"),
    ("WhatsApp Image 2026-11-18 at 23.35.02 (1).jpeg", "Área gourmet: churrasqueira, pia e bebedouro"),
    ("WhatsApp Image 2026-11-18 at 23.35.02.jpeg", "Mesas e cadeiras"),
    ("WhatsApp Image 2026-11-18 at 23.34.59.jpeg", "Casa de apoio e gramado"),
    ("WhatsApp Image 2026-11-18 at 23.35.03 (1).jpeg", "Quarto com beliches"),
    ("WhatsApp Image 2026-11-18 at 23.35.03.jpeg", "Sala com sofá-cama e balcão"),
]
ENDERECO = "Antônio Gilberto Lúcio, 69 – Jardim Lago dos Ipês – Mococa/SP"


def reduzir(arq):
    img = ImageOps.exif_transpose(Image.open(arq)).convert("RGB")
    img.thumbnail((LADO, LADO))
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=80, method=6)
    return buf.getvalue()


def main():
    forcar = "--forcar" in sys.argv
    atual = chamar("GET", "/rest/v1/chacara_pagina?select=*&id=eq.1")
    if not atual:
        sys.exit("A tabela chacara_pagina não existe ou está vazia. Rode o supabase/schema.sql primeiro.")
    atual = atual[0]
    if atual.get("fotos") and not forcar:
        sys.exit("A página já tem fotos. Para substituir tudo, rode com --forcar.")

    txt = (PASTA / "texto chacara.txt").read_text(encoding="utf-8-sig").strip().splitlines()
    primeira = txt[0].strip()
    titulo, _, chamada = primeira.partition("–")
    descricao = "\n".join(txt[1:]).strip()

    legendas = dict(ORDEM)
    nomes = [n for n, _ in ORDEM if (PASTA / n).exists()]
    nomes += sorted(p.name for p in PASTA.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp") and p.name not in legendas)

    fotos = []
    for i, nome in enumerate(nomes, 1):
        dados = reduzir(PASTA / nome)
        caminho = f"chacara/foto-{i:02d}.webp"
        chamar("POST", f"/storage/v1/object/{BUCKET}/" + urllib.parse.quote(caminho), dados,
               {"Content-Type": "image/webp", "x-upsert": "true", "Cache-Control": "max-age=3600"})
        fotos.append({"imagem": caminho, "legenda": legendas.get(nome, "")})
        print(f"  {caminho}  {len(dados) // 1024} KB  {legendas.get(nome, '')}")

    chamar("PATCH", "/rest/v1/chacara_pagina?id=eq.1", {
        "titulo": titulo.strip(), "chamada": chamada.strip(), "descricao": descricao,
        "endereco": ENDERECO, "mostrar_endereco": True, "fotos": fotos,
    }, {"Prefer": "return=minimal"})
    print(f"Página da chácara preenchida: {len(fotos)} fotos.")


if __name__ == "__main__":
    main()
