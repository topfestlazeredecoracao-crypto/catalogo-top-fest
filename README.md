# Catálogo Top Fest

Site do catálogo de locação de decoração da **Chácara Top Fest – Lazer, eventos e decorações**.

- **Site público:** https://catalogo-top-fest.pages.dev. O visitante navega por categorias, monta um pedido e envia pelo WhatsApp.
- **Área da administradora:** https://catalogo-top-fest.pages.dev/admin/. Tem login e permite cuidar de produtos, categorias, fotos, inspirações, configurações, **clientes** e **orçamentos**.

Este arquivo é para quem for mexer no código. A dona do catálogo usa o [MANUAL_DA_ADMINISTRADORA.md](MANUAL_DA_ADMINISTRADORA.md).

---

## Como funciona

```
Navegador ──► Cloudflare Pages (arquivos estáticos da pasta site/)
    │
    └──────► Supabase (Postgres + Auth + Storage), com a chave pública
                 └─ as regras de segurança (RLS e permissões) decidem quem lê e quem grava
```

- **Não tem etapa de build.** É HTML, CSS e JavaScript puro (ES5, sem framework). O `supabase-js` fica copiado em `site/admin/vendor/`.
- **Hospedagem:** Cloudflare Pages ligado ao repositório. A pasta de saída é `site` e não há comando de build. Cada `git push` na `main` publica. Outros branches viram uma prévia em `https://<branch>.catalogo-top-fest.pages.dev`.
- **Dados:** Supabase, projeto `catalogo-top-fest` (região São Paulo, plano gratuito).
- **Cópia de reserva:** `site/reserva/` guarda um JSON do catálogo e as fotos. O site público usa essa cópia se o Supabase estiver fora do ar ou pausado. Ela é atualizada a cada 3 dias por uma tarefa automática do GitHub (`.github/workflows/manter-ativo.yml`), que também evita que o plano gratuito pause por inatividade.

## Pastas e arquivos

| Caminho | O que é |
|---|---|
| `site/index.html`, `site/js/catalogo.js`, `site/css/estilo.css` | Site público |
| `site/js/config.js` | URL do Supabase e chave **pública** (publishable) |
| `site/admin/` | Área da administradora (`index.html`, `admin.js`, `admin.css`) |
| `site/admin/imprimir.*` | Folha do orçamento para imprimir ou salvar em PDF |
| `site/admin/contrato.*` | Contrato do orçamento aprovado: folha para imprimir/PDF e geração do Word (.docx) no próprio navegador, sem biblioteca |
| `site/_headers` | Cabeçalhos de segurança (CSP etc.) do Cloudflare Pages |
| `site/reserva/` | Cópia de reserva (gerada, não editar à mão) |
| `supabase/schema.sql` | Estrutura do banco, regras de segurança e bucket de fotos. **Pode rodar de novo** sem apagar dados |
| `scripts/importar.py` | Importa `dados/catalogo.json` e `imagens/` para o Supabase (carga inicial, não duplica) |
| `scripts/gerar_reserva.py` | Gera `site/reserva/` usando só a chave pública |
| `dados/`, `imagens/` | Dados e fotos originais do catálogo antigo |
| `.env` (fora do git) | URL e chaves do Supabase, **incluindo a secreta**. Modelo em `.env.exemplo` |

## Banco de dados

Tabelas em `public`:

| Tabela | Conteúdo | Quem lê | Quem grava |
|---|---|---|---|
| `configuracoes` (1 linha) | Nome, WhatsApp dos orçamentos, telefones, `mostrar_precos` | todos | admin |
| `categorias` | Nome, ícone, `tipo` (`produtos` ou `galeria`), `ordem` | todos | admin |
| `produtos` | `codigo`, nome, descrição, foto, `ativo`, `ordem`, `preco`, `mostrar_preco`. As fotos de inspiração também ficam aqui (categoria do tipo `galeria`) | todos (só ativos; **sem a coluna `preco`**) | admin |
| `inspiracoes` | **Não é mais usada** (01/11/2026: as fotos viraram produtos da categoria galeria) | todos | admin |
| `clientes` | Cadastro de clientes (dados pessoais) | **só admin** | admin |
| `orcamentos` | `numero`, cliente, data do evento, `itens` (jsonb), desconto, taxa de entrega, `situacao` (aberto/aprovado/cancelado), datas de retirada e devolução | **só admin** | admin |
| `contrato_modelo` (1 linha) | Título, cláusulas e % do sinal do contrato. **As cláusulas não ficam no `schema.sql`** (o repositório é público e elas têm o endereço) | **só admin** | admin |
| `admins` | `user_id` de quem pode administrar | a própria pessoa | ninguém pelo site |

Detalhes importantes:

- **Admin** é quem está na tabela `admins`. A função `is_admin()` é usada em todas as regras de escrita. O cadastro público de usuários fica **desligado** no Supabase (Auth › Providers › Email › "Allow new users to sign up").
- **Preços:** o papel `anon` não tem permissão na coluna `produtos.preco`. O site público lê os preços pela view `precos_publicos`, que só devolve os produtos ativos, com preço, com `mostrar_preco = true` e com `configuracoes.mostrar_precos = true`. Ao criar uma coluna nova em `produtos` que o público deva ver, inclua essa coluna no `grant select (...) ... to anon` do `schema.sql`.
- **Numeração:** `produtos.codigo` e `orcamentos.numero` são preenchidos por gatilhos com "maior número + 1". Por isso continuam corretos depois de restaurar uma cópia. O site mostra o código com 3 dígitos (`007`).
- **`orcamentos.itens`** guarda uma "foto" de cada item no momento do orçamento: `{ tipo: "produto" | "servico", produto_id, codigo, nome, quantidade, preco }`. Mudar ou excluir o produto depois não altera orçamentos antigos.
- **Fotos:** bucket público `catalogo` (pastas `produtos/` e `inspiracoes/`), aceita só JPEG, PNG e WebP de até 2 MB. O admin reduz a foto no navegador antes de enviar (lado maior com 800 px, WebP).

### Mudar o banco

1. Edite `supabase/schema.sql`, mantendo o arquivo **idempotente**: `if not exists`, `create or replace`, `drop ... if exists` antes de `create policy`.
2. Rode o arquivo **inteiro** em Supabase › SQL Editor › **New query**.
3. Só depois publique o código que depende da mudança. Enquanto o banco e o site estiverem fora de sincronia, o site público cai para a cópia de reserva.

Dica: dá para testar o `schema.sql` antes num Postgres local (por exemplo, PGlite), criando antes os papéis `anon` e `authenticated` e os schemas `auth` (com `auth.uid()`) e `storage`.

## Rodar no computador

```bash
# Site (público e admin) usando o Supabase de verdade
cd site
python -m http.server 8080
# abra http://localhost:8080 e http://localhost:8080/admin/
```

Atenção: o admin local grava no banco **de verdade**. Para testar sem risco, use um usuário de teste e apague o que criar.

## Scripts

```bash
# Carga inicial ou reimportação do catálogo original (precisa do .env com a chave secreta)
python scripts/importar.py

# Atualizar a cópia de reserva na hora (só usa a chave pública)
python scripts/gerar_reserva.py
```

Os dois usam só a biblioteca padrão do Python 3.

## Segurança

- A chave **secreta** do Supabase (`sb_secret_...`) **nunca** vai para o navegador nem para o git. Ela fica só no `.env`.
- Toda a proteção está no banco (RLS e permissões). Esconder botões na tela não é proteção.
- Todo texto vindo do banco é escapado (`esc()`) antes de entrar no HTML.
- A CSP do `site/_headers` só permite scripts do próprio site e conexões com o Supabase. Ao adicionar um serviço externo, ajuste a CSP.
- A cópia de segurança exportada pelo admin inclui **dados pessoais de clientes** (LGPD). Trate o arquivo como confidencial.

## Limites do plano gratuito (conferidos em 23/10/2026)

- **Supabase:** 500 MB de banco, 1 GB de fotos, 5 GB de tráfego por mês. **Pausa após 7 dias sem uso**, o que é evitado pela tarefa automática. Se pausar, clique em "Restore project" no painel. Enquanto isso, o site usa a cópia de reserva.
- **Cloudflare Pages:** tráfego ilimitado e 500 publicações por mês.

## Convenções

- Textos da interface, nomes de variáveis e mensagens de commit em **português**.
- Commits pequenos, com mensagem clara.
- Teste no celular (cerca de 360 px de largura), no computador e nos modos claro e escuro antes de publicar.
- Mudanças visuais grandes: publique primeiro num branch (prévia do Cloudflare) para a dona aprovar, depois junte na `main`.
