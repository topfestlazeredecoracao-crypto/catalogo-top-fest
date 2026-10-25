# Projeto: site do catálogo de locação da Chácara Top Fest

> Cole este arquivo inteiro no Claude Code, dentro da pasta deste pacote (a que contém `dados/`, `imagens/` e `referencia/`).

## 1. Quem sou eu e como quero ser atendida

Sou a dona da **Chácara Top Fest – Lazer, eventos e decorações**, uma empresa que **aluga itens de decoração para festas** (arcos, painéis, mobiliário, boleiras, capas temáticas, flores artificiais etc.). **Não sou programadora.**

Por favor:

- Explique tudo em **português do Brasil, em linguagem simples**, e em **passos curtos**.
- **Pergunte antes** de criar contas, instalar programas ou qualquer coisa que possa custar dinheiro. Eu quero usar **somente serviços gratuitos**.
- **Nunca peça para eu colar senhas ou chaves secretas no chat.** Quando precisar de uma chave, me diga em qual tela do site do serviço copiá-la e onde guardá-la (arquivo `.env`, que nunca vai para o repositório).
- Quando algo for ambíguo, **pergunte em vez de inventar**. Não invente produtos, medidas, preços nem textos.
- Faça commits pequenos e com mensagens claras. Teste antes de dizer que terminou.

## 2. O que eu quero

Transformar o catálogo digital que já existe (um arquivo HTML único, em `referencia/catalogo-top-fest.html`) em um **site de verdade**, com:

1. **Área pública** (sem login): o visitante vê o catálogo por categorias, escolhe itens, monta um carrinho e **pede orçamento pelo meu WhatsApp**.
2. **Área de administradora** (com login, **somente eu**): eu consigo **incluir, editar, ocultar e excluir produtos**, trocar fotos, mudar categorias e gerenciar a galeria de inspirações, **sem mexer em código**.
3. Tudo hospedado em **serviços gratuitos**, com o código em um **repositório gratuito** na internet.

## 3. Arquivos fornecidos

```
dados/catalogo.json              <- fonte dos dados (negócio, categorias, produtos, inspirações)
imagens/produtos/pNNN.jpg        <- foto de cada produto (o campo "imagem" do JSON aponta para ela)
imagens/inspiracoes/iNN.jpg      <- fotos da galeria de inspirações
imagens/logo.png                 <- logo da empresa (PNG com fundo transparente, em círculo)
referencia/catalogo-top-fest.html <- versão atual, para copiar o visual e o comportamento
```

Abra `referencia/catalogo-top-fest.html` no navegador **antes de começar**: o site novo deve ficar **visualmente e funcionalmente igual a ele** (ou melhor), mas com as fotos em arquivos separados, e não embutidas no HTML.

Detalhes do `dados/catalogo.json`:

- `negocio`: nome, slogan, número de WhatsApp para orçamentos (`5519991616329`, formato internacional, sem símbolos) e telefone secundário.
- `categorias`: **na ordem em que devem aparecer** nos botões de filtro. A categoria "Inspirações de decoração" é uma **galeria de fotos**, não tem produtos nem botão de orçamento.
- `produtos`: `id`, `categoria`, `nome`, `descricao`, `imagem`, `ativo`, `ordem`. A `ordem` é a ordem de exibição (já vem organizada, por exemplo, kits antes das capas simples).
- `inspiracoes`: `imagem`, `legenda` (pode ser vazia ou "Montado pela cliente (pegue e monte)") e `ordem`.

## 4. Decisão de arquitetura (apresente as opções e me deixe escolher)

Antes de construir, me explique **em poucas linhas, sem jargão**, estas duas opções, com vantagens, desvantagens e custo (deve ser R$ 0), e **me pergunte qual eu prefiro**. **Confira os limites e regras atuais dos planos gratuitos** antes de recomendar (por exemplo, se projetos gratuitos são pausados por inatividade, limites de armazenamento de fotos e de tráfego).

**Opção A – com tela de administração (a que eu quero):**
- Site público **estático**, hospedado em **GitHub Pages** ou **Cloudflare Pages**.
- Dados e fotos em um serviço gratuito de banco de dados e arquivos com login, como **Supabase** (Auth + Postgres + Storage). Se você conhecer uma alternativa gratuita mais simples e estável para uma pessoa não técnica, proponha.
- A tela `/admin` só funciona com login. As regras de segurança do banco (RLS) permitem que **qualquer pessoa leia** o catálogo, mas **somente a minha conta escreva**.

**Opção B – sem banco de dados (plano reserva):**
- O catálogo fica no próprio repositório (`catalogo.json` + pasta de imagens). Eu me torno a "administradora" por ser a única dona do repositório. Para alterar, peço a você (Claude Code) ou edito pelo site do GitHub, e o site se atualiza sozinho a cada alteração.
- Mais simples e sem risco de pausa, mas **sem tela de login própria**.

**Recomendação inicial:** Opção A. Se os limites gratuitos atuais tornarem a A arriscada, me diga com clareza e sugira a B.

## 5. Área pública – comportamento exigido

- **Cabeçalho:** fundo dourado escuro (`#8f6d14`), **logo redonda à esquerda** (92 px) e, ao lado, **texto em branco**: título "Catálogo de decoração para locação" e subtítulo "Chácara Top Fest · Lazer, eventos e decorações".
- **Busca** por nome/descrição e **botões de categoria** em linha rolável (primeiro "Todos", depois as categorias na ordem do JSON). "Todos" mostra os produtos seguindo a ordem das categorias; a galeria de inspirações **não** aparece em "Todos".
- **Cartão de produto:** foto (`object-fit: contain`, fundo branco), categoria, nome, descrição e botão **"Adicionar ao orçamento"**. Depois de adicionado, o botão vira um seletor de quantidade (− / número / +).
- Produto com `ativo = false` **não aparece** no site público. Produto sem foto mostra o ícone da categoria.
- **Botão flutuante** "🛒 Ver orçamento (n)" (verde, canto inferior direito, respeitando a área segura do celular). Abre um painel com: lista de itens com quantidade, campos **"Seu nome"** e **"Data do evento"**, botões "Continuar escolhendo" e "Limpar", e o botão verde **"Enviar orçamento pelo WhatsApp"**.
- **Mensagem do WhatsApp** (link `https://wa.me/<número>?text=<mensagem codificada>`), exatamente neste formato; as linhas de nome e data só aparecem se forem preenchidas (data como dd/mm/aaaa):

```
Olá! Gostaria de um orçamento de locação dos itens abaixo:

- 2x Nome do item
- 1x Outro item

Nome: Maria
Data do evento: 20/12/2026

Obrigado!
```

- **Galeria "Inspirações de decoração":** grade de fotos; ao tocar, abre ampliada (lightbox) e fecha ao tocar de novo. Mostra a **legenda** abaixo da foto quando existir (ex.: "Montado pela cliente (pegue e monte)"). Fotos sem legenda foram montadas pela equipe da Top Fest.
- **Visual:** mobile primeiro; também ótimo no computador; **modo escuro automático** (veja as cores em `referencia/`); fonte dos títulos Georgia e texto com fonte do sistema.
  - Claro: fundo `#f6f4ef`, cartões `#fff`, texto `#1d2733`, azul `#0f5f85`, dourado `#b8902f`, WhatsApp `#1a9d4b`.
  - Escuro: fundo `#10181f`, cartões `#1a2530`, texto `#eef2f5`, azul `#5db6e3`, dourado `#e0bb63`, WhatsApp `#2fbf68`.
- **Desempenho:** imagens em arquivos separados com `loading="lazy"`, tamanho adequado (miniaturas leves) e página rápida em internet móvel. O arquivo de referência pesa vários MB justamente porque embute as fotos; o site novo **não deve** ser assim.
- **Detalhes:** favicon (a logo), título e descrição da página, imagem de compartilhamento (a logo), textos acessíveis (`alt`) e bom contraste.

## 6. Área de administradora – o que preciso poder fazer

Acesso em um endereço como `/admin`, com **e-mail e senha** (e opção "esqueci minha senha"). **Só a minha conta** pode entrar e alterar: **desative o cadastro público de novos usuários**.

Funções:

1. **Produtos:** listar com busca e filtro por categoria; **incluir**, **editar** (nome, descrição, categoria, foto), **ocultar** (para itens que acabaram, sem apagar) e **excluir** (com confirmação).
2. **Categorias:** escolher entre as existentes ou **criar nova**; **mudar a ordem** das categorias e a ordem dos produtos dentro de cada uma.
3. **Fotos:** enviar ou trocar a foto de um produto pelo celular ou computador; o sistema deve **redimensionar e comprimir** automaticamente (por exemplo, lado maior de ~800 px, JPEG/WebP leve) e aceitar só imagens (JPG, PNG, WebP).
4. **Inspirações:** adicionar e remover fotos, escolher a legenda ("Montado pela equipe Top Fest" = sem legenda, ou "Montado pela cliente (pegue e monte)"), reordenar.
5. **Configurações:** alterar o número de WhatsApp dos orçamentos e o telefone secundário.
6. **Cópia de segurança:** botão para **exportar tudo** (um `.json`) e, se possível, importar de volta.
7. As alterações devem aparecer no site público **na hora** (ou em poucos segundos), sem eu precisar publicar nada.
8. A tela deve ser **simples e grande o bastante para usar no celular**, em português, com mensagens de erro claras.

## 7. Segurança (obrigatório)

- Leitura pública apenas do que é público; **escrita somente para o meu usuário**, garantida por regras no banco (RLS) e não apenas escondendo botões na tela.
- **Nenhuma chave secreta** (como `service_role`) no código do navegador nem no repositório. A chave pública/anônima pode ficar no site se as regras de segurança estiverem corretas. Use `.env` e `.gitignore`.
- Validar tipo e tamanho dos arquivos enviados; escapar todo texto exibido na página (sem inserir HTML vindo do banco sem tratamento).
- HTTPS; cabeçalhos de segurança básicos quando a hospedagem permitir.
- Me explique como **recuperar o acesso** se eu esquecer a senha, e como **trocar a senha**.

## 8. Migração dos dados atuais

- Crie um script de **importação (seed)** que leia `dados/catalogo.json` e `imagens/`, envie as fotos e crie categorias, produtos e inspirações **preservando nomes, descrições, ordem e categorias**. Ele deve poder ser executado de novo sem duplicar nada.
- No fim, confira: **215 produtos**, **17 categorias** (uma delas é a galeria) e **33 fotos de inspiração**, e me mostre um resumo.

## 9. Plano de trabalho sugerido

1. Ler `referencia/catalogo-top-fest.html` e `dados/catalogo.json`; me resumir o que entendeu.
2. Me apresentar as opções do item 4 e esperar minha escolha.
3. Criar o repositório e a estrutura do projeto; me guiar, passo a passo, nas contas gratuitas que eu precisar criar (GitHub, hospedagem, banco de dados).
4. Montar o site público idêntico à referência e conectar aos dados.
5. Montar a área de administradora e as regras de segurança.
6. Importar os dados; testar tudo (celular e computador, claro e escuro, carrinho, WhatsApp, galeria, login, incluir/editar/ocultar/excluir, troca de foto).
7. Publicar e me entregar o endereço do site.
8. Escrever o `README.md` (para quem for mexer no código) e o **`MANUAL_DA_ADMINISTRADORA.md`** (para mim, com passo a passo ilustrado em texto: como entrar, incluir produto, trocar foto, ocultar item, mudar ordem, exportar cópia de segurança e o que fazer se algo der errado).

## 10. Critérios de aceite

- Qualquer pessoa, **sem cadastro**, abre o link no celular e vê o catálogo.
- O pedido de orçamento abre o WhatsApp **(19) 99161-6329** com a lista dos itens, o nome e a data.
- Somente eu consigo entrar em `/admin` e alterar dados; tentativas sem login **falham no servidor**.
- Incluir, ocultar e excluir um produto funciona pelo celular, e o site público reflete a mudança.
- Página inicial carrega rápido em 4G, com fotos em arquivos leves.
- Tudo funciona em serviços gratuitos, e eu entendo o que fazer se um limite gratuito for atingido.

## 11. Observações sobre os dados (para eu revisar depois)

- A foto de **"Trio de mesas treliça pretas"** veio de uma foto de kit com arcos ao fundo; ficou com resíduos das linhas dos arcos. Trocar por uma foto limpa quando eu enviar.
- A foto do **"Kit pink e laranja"** foi retocada para tirar objetos de cima; trocar por uma foto limpa se houver.
- O **"Bolo fake de acrílico"** usa um recorte de foto de fornecedor; trocar por foto própria.
- **"Palavras decorativas douradas"** está na categoria "Temas – capas para festa de mesa (arco redondo 0,5 m)" por pedido meu; posso querer movê-la para "Placas".
- Algumas fotos de produtos vieram de imagens de fornecedores/internet; vou substituir por fotos próprias com o tempo.
- Os **valores de locação não estão no catálogo**; os preços são passados no WhatsApp. Deixe o código preparado para um campo opcional de preço, **desativado por padrão**, caso eu queira mostrar depois.
