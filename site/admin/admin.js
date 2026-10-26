/* Área da administradora – Catálogo Top Fest.
   Toda alteração passa pelas regras de segurança do banco (RLS):
   sem login de administradora, o servidor recusa a gravação. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var BUCKET = CFG.bucket;
  var TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  var MAX_ENVIO = 15 * 1024 * 1024;   // arquivo original escolhido
  var MAX_LADO = 800;                 // lado maior depois de reduzir
  var LEGENDA_CLIENTE = "Montado pela cliente (pegue e monte)";

  var st = { cats: [], prods: [], insp: [], conf: null };
  var produtoEditando = null;
  var fotoNova = null;      // Blob já reduzido
  var removerFoto = false;
  var categoriaEditando = null;

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fotoUrl(caminho) {
    return caminho ? sb.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl : "";
  }

  // ---------- Avisos e erros ----------
  var timerAviso;
  function avisar(texto, erro) {
    var a = $("#aviso");
    a.textContent = texto;
    a.className = erro ? "erro" : "";
    a.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () { a.hidden = true; }, erro ? 7000 : 3500);
  }

  function traduzErro(e) {
    var m = (e && (e.message || e.error_description || e.error)) || String(e);
    var code = e && e.code;
    // Erros criados por esta página (new Error("...")) já vêm escritos para a usuária.
    if (e instanceof Error && !code && e.name === "Error" && !/fetch|network|load failed/i.test(m)) return m;
    if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/Email not confirmed/i.test(m)) return "Este e-mail ainda não foi confirmado.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem conexão com a internet. Verifique e tente de novo.";
    if (/rate limit|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
    if (/should be different/i.test(m)) return "A senha nova precisa ser diferente da atual.";
    if (/Password should be at least/i.test(m)) return "A senha precisa ter pelo menos 8 caracteres.";
    if (/weak|pwned/i.test(m)) return "Essa senha é fácil de adivinhar. Escolha outra.";
    if (code === "23505") return "Já existe um item com esse nome.";
    if (code === "23503") return "Não dá para excluir: ainda há produtos nessa categoria.";
    if (code === "42501" || /row-level security|permission denied|Unauthorized|JWT/i.test(m)) return "Sem permissão. Saia e entre de novo.";
    if (/mime type|invalid_mime/i.test(m)) return "Formato de foto não aceito. Use JPG, PNG ou WebP.";
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return "A foto é grande demais.";
    return "Algo deu errado: " + m;
  }

  function falhou(e) {
    console.error(e);
    avisar(traduzErro(e), true);
  }

  function ok(r) {
    if (r.error) throw r.error;
    return r.data;
  }

  // Desativa o botão enquanto a ação roda, para evitar clique duplo.
  function ocupado(botao, promessa) {
    if (botao) botao.disabled = true;
    return Promise.resolve(promessa).finally(function () { if (botao) botao.disabled = false; });
  }

  function confirmar(texto, rotuloSim) {
    var d = $("#dlg-confirma");
    $("#dlg-confirma-txt").textContent = texto;
    $("#dlg-confirma-sim").textContent = rotuloSim || "Sim";
    d.returnValue = "";
    d.showModal();
    return new Promise(function (res) {
      d.addEventListener("close", function f() {
        d.removeEventListener("close", f);
        res(d.returnValue === "sim");
      });
    });
  }

  // ---------- Telas ----------
  function mostrar(id) {
    ["tela-login", "tela-esqueci", "tela-nova-senha", "tela-painel", "carregando"].forEach(function (t) {
      $("#" + t).hidden = t !== id;
    });
    $("#sair").hidden = id !== "tela-painel" && id !== "tela-nova-senha";
  }

  var recuperando = /type=recovery/.test(location.hash);

  sb.auth.onAuthStateChange(function (evento) {
    if (evento === "PASSWORD_RECOVERY") {
      recuperando = true;
      mostrar("tela-nova-senha");
    }
  });

  function iniciar() {
    return sb.auth.getSession().then(function (r) {
      var sessao = r.data.session;
      if (!sessao) { mostrar("tela-login"); return; }
      if (recuperando) { mostrar("tela-nova-senha"); return; }
      return verificarAdmin(sessao.user).then(function (eAdmin) {
        if (!eAdmin) {
          return sb.auth.signOut().then(function () {
            mostrar("tela-login");
            avisar("Esta conta não tem permissão de administradora.", true);
          });
        }
        mostrar("tela-painel");
        return carregarTudo();
      });
    }).catch(function (e) { mostrar("tela-login"); falhou(e); });
  }

  function verificarAdmin(user) {
    return sb.from("admins").select("user_id").eq("user_id", user.id).maybeSingle()
      .then(ok).then(function (linha) { return !!linha; });
  }

  $("#form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    ocupado($("button", f), sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value })
      .then(ok).then(function () { f.senha.value = ""; return iniciar(); }).catch(falhou));
  });

  $("#ir-esqueci").addEventListener("click", function () {
    $("#form-esqueci").email.value = $("#form-login").email.value;
    mostrar("tela-esqueci");
  });
  $("#voltar-login").addEventListener("click", function () { mostrar("tela-login"); });

  $("#form-esqueci").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target;
    var volta = location.origin + location.pathname;
    ocupado($("button", f), sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: volta })
      .then(ok).then(function () {
        avisar("Pronto! Se o e-mail estiver certo, chega um link em alguns minutos. Veja também o spam.");
        mostrar("tela-login");
      }).catch(falhou));
  });

  function trocarSenha(f) {
    if (f.senha.value !== f.senha2.value) { avisar("As duas senhas não são iguais.", true); return Promise.resolve(false); }
    return sb.auth.updateUser({ password: f.senha.value }).then(ok).then(function () {
      f.reset();
      avisar("Senha trocada com sucesso!");
      return true;
    });
  }

  $("#form-nova-senha").addEventListener("submit", function (e) {
    e.preventDefault();
    ocupado($("button", e.target), trocarSenha(e.target).then(function (feito) {
      if (!feito) return;
      recuperando = false;
      history.replaceState(null, "", location.pathname);
      return iniciar();
    }).catch(falhou));
  });

  $("#form-senha").addEventListener("submit", function (e) {
    e.preventDefault();
    ocupado($("button", e.target), trocarSenha(e.target).catch(falhou));
  });

  $("#sair").addEventListener("click", function () {
    sb.auth.signOut().finally(function () { location.replace(location.pathname); });
  });

  // ---------- Abas ----------
  $$(".abas button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".abas button").forEach(function (x) { x.classList.toggle("on", x === b); });
      $$(".aba").forEach(function (a) { a.hidden = a.id !== "aba-" + b.dataset.aba; });
    });
  });

  // ---------- Dados ----------
  function carregarTudo() {
    return Promise.all([
      sb.from("categorias").select("*").order("ordem").order("id"),
      sb.from("produtos").select("*").order("ordem").order("nome"),
      sb.from("inspiracoes").select("*").order("ordem").order("id"),
      sb.from("configuracoes").select("*").eq("id", 1).single()
    ]).then(function (r) {
      st.cats = ok(r[0]);
      st.prods = ok(r[1]);
      st.insp = ok(r[2]);
      st.conf = ok(r[3]);
      desenharTudo();
    }).catch(falhou);
  }

  function desenharTudo() {
    preencherFiltroCategorias();
    desenharProdutos();
    desenharCategorias();
    desenharInspiracoes();
    preencherConfig();
  }

  function cat(id) {
    for (var i = 0; i < st.cats.length; i++) if (st.cats[i].id === id) return st.cats[i];
    return null;
  }
  function catsDeProduto() { return st.cats.filter(function (c) { return c.tipo !== "galeria"; }); }
  function produtosDaCategoria(id) {
    return st.prods.filter(function (p) { return p.categoria_id === id; })
      .sort(function (a, b) { return a.ordem - b.ordem || a.nome.localeCompare(b.nome); });
  }

  // ---------- Produtos ----------
  function preencherFiltroCategorias() {
    var sel = $("#filtro-cat");
    var atual = sel.value;
    sel.innerHTML = '<option value="">Todas as categorias</option>' + catsDeProduto().map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.icone + " " + c.nome) + " (" + produtosDaCategoria(c.id).length + ")</option>";
    }).join("");
    sel.value = atual;
  }

  function desenharProdutos() {
    var t = $("#busca").value.trim().toLowerCase();
    var filtro = Number($("#filtro-cat").value) || null;
    var podeOrdenar = filtro && !t;
    $("#dica-ordem").textContent = podeOrdenar
      ? "Use ▲ e ▼ para mudar a ordem dos produtos nesta categoria."
      : "Para mudar a ordem dos produtos, escolha uma categoria acima.";
    var posCat = {};
    st.cats.forEach(function (c, i) { posCat[c.id] = i; });
    var lista = st.prods.filter(function (p) {
      if (filtro && p.categoria_id !== filtro) return false;
      return !t || (p.nome + " " + p.descricao).toLowerCase().indexOf(t) >= 0;
    }).sort(function (a, b) {
      return posCat[a.categoria_id] - posCat[b.categoria_id] || a.ordem - b.ordem || a.nome.localeCompare(b.nome);
    });
    $("#lista-produtos").innerHTML = lista.map(function (p, i) {
      var c = cat(p.categoria_id) || { nome: "?", icone: "❔" };
      return '<li class="item' + (p.ativo ? "" : " oculto") + '" data-id="' + esc(p.id) + '">' +
        '<div class="mini">' + (p.imagem ? '<img src="' + esc(fotoUrl(p.imagem)) + '" alt="" loading="lazy">' : esc(c.icone)) + "</div>" +
        '<div class="item-info"><b>' + esc(p.nome) + (p.ativo ? "" : ' <span class="selo">OCULTO</span>') + "</b>" +
        "<span>" + esc(c.nome) + "</span></div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="editar">✏️ Editar</button>' +
        '<button class="btn" data-acao="alternar">' + (p.ativo ? "🙈 Ocultar" : "👁️ Mostrar") + "</button>" +
        (podeOrdenar ? '<button class="btn" data-acao="subir" aria-label="Subir"' + (i === 0 ? " disabled" : "") + ">▲</button>" +
          '<button class="btn" data-acao="descer" aria-label="Descer"' + (i === lista.length - 1 ? " disabled" : "") + ">▼</button>" : "") +
        '<button class="btn" data-acao="excluir">🗑️ Excluir</button>' +
        "</div></li>";
    }).join("") || '<li class="dica">Nenhum produto encontrado.</li>';
  }

  $("#busca").addEventListener("input", desenharProdutos);
  $("#filtro-cat").addEventListener("change", desenharProdutos);

  $("#lista-produtos").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]");
    if (!b) return;
    var id = b.closest("[data-id]").dataset.id;
    var p = st.prods.filter(function (x) { return x.id === id; })[0];
    var acao = b.dataset.acao;
    if (acao === "editar") abrirProduto(p);
    else if (acao === "alternar") ocupado(b, alternarProduto(p));
    else if (acao === "subir" || acao === "descer") ocupado(b, moverProduto(p, acao === "subir" ? -1 : 1));
    else if (acao === "excluir") excluirProduto(p);
  });

  function alternarProduto(p) {
    return sb.from("produtos").update({ ativo: !p.ativo }).eq("id", p.id).select().single().then(ok).then(function (novo) {
      Object.assign(p, novo);
      desenharProdutos();
      avisar(p.ativo ? "Produto visível no site." : "Produto oculto do site.");
    }).catch(falhou);
  }

  // Reordena a lista inteira (1, 2, 3…) e grava só o que mudou.
  function gravarOrdem(tabela, itens) {
    var mudou = [];
    itens.forEach(function (x, i) { if (x.ordem !== i + 1) { x.ordem = i + 1; mudou.push(x); } });
    return Promise.all(mudou.map(function (x) {
      return sb.from(tabela).update({ ordem: x.ordem }).eq("id", x.id).then(ok);
    }));
  }

  function mover(lista, item, passo) {
    var i = lista.indexOf(item), j = i + passo;
    if (j < 0 || j >= lista.length) return false;
    lista[i] = lista[j];
    lista[j] = item;
    return true;
  }

  function moverProduto(p, passo) {
    var lista = produtosDaCategoria(p.categoria_id);
    if (!mover(lista, p, passo)) return Promise.resolve();
    return gravarOrdem("produtos", lista).then(desenharProdutos).catch(function (e) { falhou(e); return carregarTudo(); });
  }

  function excluirProduto(p) {
    confirmar('Excluir "' + p.nome + '" para sempre? Se o item só acabou por um tempo, prefira "Ocultar".', "Excluir").then(function (sim) {
      if (!sim) return;
      return sb.from("produtos").delete().eq("id", p.id).then(ok).then(function () {
        if (p.imagem) apagarFoto(p.imagem);
        st.prods = st.prods.filter(function (x) { return x !== p; });
        preencherFiltroCategorias();
        desenharProdutos();
        desenharCategorias();
        avisar("Produto excluído.");
      });
    }).catch(falhou);
  }

  function apagarFoto(caminho) {
    return sb.storage.from(BUCKET).remove([caminho]).catch(function (e) { console.warn("Foto não apagada", e); });
  }

  // ---------- Formulário de produto ----------
  var formP = $("#form-produto");

  function opcoesCategoria(selecionada) {
    formP.categoria_id.innerHTML = catsDeProduto().map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.icone + " " + c.nome) + "</option>";
    }).join("") + '<option value="nova">➕ Criar nova categoria…</option>';
    if (selecionada) formP.categoria_id.value = String(selecionada);
    $("#nova-cat-campos").hidden = formP.categoria_id.value !== "nova";
  }

  function previa(url, icone) {
    $("#prev-produto").innerHTML = url ? '<img src="' + esc(url) + '" alt="Prévia da foto">' : esc(icone || "📦");
    $("#tirar-foto").hidden = !url;
  }

  function abrirProduto(p) {
    produtoEditando = p || null;
    fotoNova = null;
    removerFoto = false;
    formP.reset();
    $("#dlg-produto-tit").textContent = p ? "Editar produto" : "Novo produto";
    opcoesCategoria(p ? p.categoria_id : Number($("#filtro-cat").value) || null);
    if (p) {
      formP.nome.value = p.nome;
      formP.descricao.value = p.descricao || "";
      formP.preco.value = p.preco == null ? "" : String(p.preco).replace(".", ",");
      formP.ativo.checked = p.ativo;
    }
    var c = cat(Number(formP.categoria_id.value));
    previa(p && p.imagem ? fotoUrl(p.imagem) : "", c && c.icone);
    $("#dlg-produto").showModal();
  }

  $("#novo-produto").addEventListener("click", function () { abrirProduto(null); });

  formP.categoria_id.addEventListener("change", function () {
    $("#nova-cat-campos").hidden = formP.categoria_id.value !== "nova";
    formP.nova_cat_nome.required = formP.categoria_id.value === "nova";
  });

  formP.foto.addEventListener("change", function () {
    var arq = formP.foto.files[0];
    if (!arq) return;
    reduzirFoto(arq).then(function (blob) {
      fotoNova = blob;
      removerFoto = false;
      previa(URL.createObjectURL(blob));
    }).catch(function (e) { formP.foto.value = ""; avisar(e.message, true); });
  });

  $("#tirar-foto").addEventListener("click", function () {
    fotoNova = null;
    removerFoto = true;
    formP.foto.value = "";
    var c = cat(Number(formP.categoria_id.value));
    previa("", c && c.icone);
  });

  $$("[data-fechar]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });

  function lerPreco(txt) {
    txt = txt.trim();
    if (!txt) return null;
    var n = Number(txt.replace(/[R$\s.]/g, "").replace(",", "."));
    if (!isFinite(n) || n < 0) throw new Error("Preço inválido. Use só números, ex.: 35,00");
    return Math.round(n * 100) / 100;
  }

  formP.addEventListener("submit", function (e) {
    e.preventDefault();
    var botao = $('button[type="submit"]', formP);
    ocupado(botao, Promise.resolve().then(salvarProduto)).catch(falhou);
  });

  function salvarProduto() {
    var dados = {
      nome: formP.nome.value.trim(),
      descricao: formP.descricao.value.trim(),
      ativo: formP.ativo.checked,
      preco: lerPreco(formP.preco.value)
    };
    if (!dados.nome) throw new Error("Preencha o nome do produto.");
    var p = produtoEditando;
    var fotoAntiga = p && p.imagem;

    return obterCategoria().then(function (catId) {
      dados.categoria_id = catId;
      if (!p || p.categoria_id !== catId) {
        dados.ordem = produtosDaCategoria(catId).reduce(function (m, x) { return Math.max(m, x.ordem); }, 0) + 1;
      }
      if (!fotoNova) return null;
      return enviarFoto("produtos", fotoNova);
    }).then(function (caminho) {
      if (caminho) dados.imagem = caminho;
      else if (removerFoto) dados.imagem = null;
      var req = p ? sb.from("produtos").update(dados).eq("id", p.id) : sb.from("produtos").insert(dados);
      return req.select().single().then(function (r) {
        if (r.error && caminho) apagarFoto(caminho);
        return ok(r);
      });
    }).then(function (novo) {
      if (fotoAntiga && fotoAntiga !== novo.imagem) apagarFoto(fotoAntiga);
      if (p) Object.assign(p, novo); else st.prods.push(novo);
      $("#dlg-produto").close();
      preencherFiltroCategorias();
      desenharProdutos();
      desenharCategorias();
      avisar(p ? "Produto salvo." : "Produto incluído.");
    });
  }

  function obterCategoria() {
    if (formP.categoria_id.value !== "nova") return Promise.resolve(Number(formP.categoria_id.value));
    var nome = formP.nova_cat_nome.value.trim();
    if (!nome) return Promise.reject(new Error("Digite o nome da nova categoria."));
    return criarCategoria(nome, formP.nova_cat_icone.value.trim() || "🎉").then(function (c) { return c.id; });
  }

  // ---------- Fotos ----------
  function carregarImagem(arq) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(arq);
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Não foi possível abrir essa foto. Tente outra.")); };
      img.src = url;
    });
  }

  function paraBlob(canvas, tipo, qualidade) {
    return new Promise(function (res) { canvas.toBlob(res, tipo, qualidade); });
  }

  // Reduz para no máximo 800 px no lado maior e comprime (WebP, ou JPEG se o aparelho não suportar).
  function reduzirFoto(arq) {
    if (TIPOS_FOTO.indexOf(arq.type) < 0) return Promise.reject(new Error("Escolha uma foto JPG, PNG ou WebP."));
    if (arq.size > MAX_ENVIO) return Promise.reject(new Error("Essa foto passa de 15 MB. Escolha uma menor."));
    return carregarImagem(arq).then(function (img) {
      var escala = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * escala);
      c.height = Math.round(img.naturalHeight * escala);
      var g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return paraBlob(c, "image/webp", 0.8).then(function (b) {
        return b && b.type === "image/webp" ? b : paraBlob(c, "image/jpeg", 0.82);
      });
    }).then(function (b) {
      if (!b) throw new Error("Não foi possível preparar a foto.");
      if (b.size > 2 * 1024 * 1024) throw new Error("A foto continua grande demais depois de reduzir.");
      return b;
    });
  }

  function enviarFoto(pasta, blob) {
    var ext = blob.type === "image/webp" ? "webp" : "jpg";
    var nome = pasta + "/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    return sb.storage.from(BUCKET).upload(nome, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false })
      .then(ok).then(function () { return nome; });
  }

  // ---------- Categorias ----------
  function desenharCategorias() {
    $("#lista-categorias").innerHTML = st.cats.map(function (c, i) {
      var n = produtosDaCategoria(c.id).length;
      var galeria = c.tipo === "galeria";
      return '<li class="item" data-id="' + c.id + '">' +
        '<div class="mini">' + esc(c.icone) + "</div>" +
        '<div class="item-info"><b>' + esc(c.nome) + "</b><span>" +
        (galeria ? "Galeria de fotos (" + st.insp.length + " fotos)" : n + (n === 1 ? " produto" : " produtos")) + "</span></div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="subir" aria-label="Subir"' + (i === 0 ? " disabled" : "") + ">▲</button>" +
        '<button class="btn" data-acao="descer" aria-label="Descer"' + (i === st.cats.length - 1 ? " disabled" : "") + ">▼</button>" +
        '<button class="btn" data-acao="editar">✏️ Editar</button>' +
        (galeria ? "" : '<button class="btn" data-acao="excluir">🗑️ Excluir</button>') +
        "</div></li>";
    }).join("");
  }

  $("#lista-categorias").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]");
    if (!b) return;
    var c = cat(Number(b.closest("[data-id]").dataset.id));
    var acao = b.dataset.acao;
    if (acao === "subir" || acao === "descer") {
      if (!mover(st.cats, c, acao === "subir" ? -1 : 1)) return;
      ocupado(b, gravarOrdem("categorias", st.cats).then(function () {
        desenharCategorias();
        preencherFiltroCategorias();
        desenharProdutos();
      }).catch(function (er) { falhou(er); return carregarTudo(); }));
    } else if (acao === "editar") abrirCategoria(c);
    else if (acao === "excluir") excluirCategoria(c);
  });

  function criarCategoria(nome, icone) {
    var ordem = st.cats.reduce(function (m, x) { return Math.max(m, x.ordem); }, 0) + 1;
    return sb.from("categorias").insert({ nome: nome, icone: icone, tipo: "produtos", ordem: ordem })
      .select().single().then(ok).then(function (c) {
        st.cats.push(c);
        desenharCategorias();
        preencherFiltroCategorias();
        return c;
      });
  }

  var formC = $("#form-categoria");

  function abrirCategoria(c) {
    categoriaEditando = c || null;
    formC.reset();
    $("#dlg-categoria-tit").textContent = c ? "Editar categoria" : "Nova categoria";
    formC.nome.value = c ? c.nome : "";
    formC.icone.value = c ? c.icone : "🎉";
    $("#dlg-categoria").showModal();
  }

  $("#nova-categoria").addEventListener("click", function () { abrirCategoria(null); });

  formC.addEventListener("submit", function (e) {
    e.preventDefault();
    var nome = formC.nome.value.trim(), icone = formC.icone.value.trim();
    var c = categoriaEditando;
    var acao = c
      ? sb.from("categorias").update({ nome: nome, icone: icone }).eq("id", c.id).select().single().then(ok)
          .then(function (novo) { Object.assign(c, novo); desenharTudo(); })
      : criarCategoria(nome, icone);
    ocupado($('button[type="submit"]', formC), acao.then(function () {
      $("#dlg-categoria").close();
      avisar("Categoria salva.");
    }).catch(falhou));
  });

  function excluirCategoria(c) {
    if (produtosDaCategoria(c.id).length) {
      avisar("Para excluir, primeiro mova ou exclua os produtos desta categoria.", true);
      return;
    }
    confirmar('Excluir a categoria "' + c.nome + '"?', "Excluir").then(function (sim) {
      if (!sim) return;
      return sb.from("categorias").delete().eq("id", c.id).then(ok).then(function () {
        st.cats = st.cats.filter(function (x) { return x !== c; });
        desenharTudo();
        avisar("Categoria excluída.");
      });
    }).catch(falhou);
  }

  // ---------- Inspirações ----------
  function desenharInspiracoes() {
    $("#lista-insp").innerHTML = st.insp.map(function (x, i) {
      return '<li data-id="' + esc(x.id) + '"><img src="' + esc(fotoUrl(x.imagem)) + '" alt="Inspiração ' + (i + 1) + '" loading="lazy">' +
        '<select data-acao="legenda" aria-label="Quem montou">' +
        '<option value="">Equipe Top Fest</option>' +
        '<option value="' + esc(LEGENDA_CLIENTE) + '"' + (x.legenda === LEGENDA_CLIENTE ? " selected" : "") + ">Cliente (pegue e monte)</option>" +
        (x.legenda && x.legenda !== LEGENDA_CLIENTE ? '<option selected value="' + esc(x.legenda) + '">' + esc(x.legenda) + "</option>" : "") +
        "</select>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="subir" aria-label="Para trás"' + (i === 0 ? " disabled" : "") + ">◀</button>" +
        '<button class="btn" data-acao="excluir" aria-label="Remover foto">🗑️</button>' +
        '<button class="btn" data-acao="descer" aria-label="Para frente"' + (i === st.insp.length - 1 ? " disabled" : "") + ">▶</button>" +
        "</div></li>";
    }).join("") || '<li class="dica">Nenhuma foto ainda.</li>';
  }

  function inspPorId(id) { return st.insp.filter(function (x) { return x.id === id; })[0]; }

  $("#lista-insp").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]");
    if (!b) return;
    var x = inspPorId(b.closest("[data-id]").dataset.id);
    var acao = b.dataset.acao;
    if (acao === "subir" || acao === "descer") {
      if (!mover(st.insp, x, acao === "subir" ? -1 : 1)) return;
      ocupado(b, gravarOrdem("inspiracoes", st.insp).then(desenharInspiracoes)
        .catch(function (er) { falhou(er); return carregarTudo(); }));
    } else if (acao === "excluir") {
      confirmar("Remover esta foto da galeria?", "Remover").then(function (sim) {
        if (!sim) return;
        return sb.from("inspiracoes").delete().eq("id", x.id).then(ok).then(function () {
          apagarFoto(x.imagem);
          st.insp = st.insp.filter(function (y) { return y !== x; });
          desenharInspiracoes();
          desenharCategorias();
          avisar("Foto removida.");
        });
      }).catch(falhou);
    }
  });

  $("#lista-insp").addEventListener("change", function (e) {
    if (e.target.dataset.acao !== "legenda") return;
    var x = inspPorId(e.target.closest("[data-id]").dataset.id);
    sb.from("inspiracoes").update({ legenda: e.target.value }).eq("id", x.id).then(ok).then(function () {
      x.legenda = e.target.value;
      avisar("Legenda salva.");
    }).catch(falhou);
  });

  $("#fotos-insp").addEventListener("change", function (e) {
    var arquivos = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    if (!arquivos.length) return;
    var legenda = $("#legenda-nova").value;
    var ordem = st.insp.reduce(function (m, x) { return Math.max(m, x.ordem); }, 0);
    var feitas = 0;
    avisar("Enviando " + arquivos.length + (arquivos.length === 1 ? " foto…" : " fotos…"));
    arquivos.reduce(function (cadeia, arq) {
      return cadeia.then(function () {
        return reduzirFoto(arq).then(function (b) { return enviarFoto("inspiracoes", b); }).then(function (caminho) {
          ordem += 1;
          return sb.from("inspiracoes").insert({ imagem: caminho, legenda: legenda, ordem: ordem }).select().single().then(ok);
        }).then(function (nova) {
          st.insp.push(nova);
          feitas += 1;
          desenharInspiracoes();
        }).catch(function (er) { falhou(er); });
      });
    }, Promise.resolve()).then(function () {
      desenharCategorias();
      if (feitas) avisar(feitas + (feitas === 1 ? " foto adicionada." : " fotos adicionadas."));
    });
  });

  // ---------- Configurações ----------
  var formCfg = $("#form-config");

  function preencherConfig() {
    var c = st.conf;
    formCfg.whatsapp_orcamentos.value = c.whatsapp_orcamentos;
    formCfg.whatsapp_exibicao.value = c.whatsapp_exibicao;
    formCfg.telefone_secundario.value = c.telefone_secundario;
    formCfg.mostrar_precos.checked = c.mostrar_precos;
  }

  function normalizarWhats(txt) {
    var d = txt.replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) d = "55" + d;
    if (!/^55\d{10,11}$/.test(d)) throw new Error("Número de WhatsApp inválido. Digite com DDD, ex.: (19) 99161-6329");
    return d;
  }

  formCfg.addEventListener("submit", function (e) {
    e.preventDefault();
    var acao = Promise.resolve().then(function () {
      var dados = {
        whatsapp_orcamentos: normalizarWhats(formCfg.whatsapp_orcamentos.value),
        whatsapp_exibicao: formCfg.whatsapp_exibicao.value.trim(),
        telefone_secundario: formCfg.telefone_secundario.value.trim(),
        mostrar_precos: formCfg.mostrar_precos.checked
      };
      return sb.from("configuracoes").update(dados).eq("id", 1).select().single().then(ok);
    }).then(function (c) {
      st.conf = c;
      preencherConfig();
      avisar("Configurações salvas.");
    });
    ocupado($('button[type="submit"]', formCfg), acao.catch(falhou));
  });

  // ---------- Cópia de segurança ----------
  $("#exportar").addEventListener("click", function (e) {
    var b = e.currentTarget;
    ocupado(b, carregarTudo().then(function () {
      var copia = {
        sistema: "catalogo-top-fest",
        versao: 1,
        exportado_em: new Date().toISOString(),
        endereco_fotos: fotoUrl("x").replace(/x$/, ""),
        configuracoes: st.conf,
        categorias: st.cats,
        produtos: st.prods,
        inspiracoes: st.insp
      };
      var blob = new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "copia-catalogo-topfest-" + new Date().toLocaleDateString("sv-SE") + ".json";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      avisar("Cópia baixada. Guarde o arquivo em lugar seguro.");
    }));
  });

  $("#importar").addEventListener("change", function (e) {
    var arq = e.target.files[0];
    e.target.value = "";
    if (!arq) return;
    arq.text().then(function (txt) {
      var c;
      try { c = JSON.parse(txt); } catch (er) { throw new Error("Esse arquivo não é uma cópia válida."); }
      if (!c || c.sistema !== "catalogo-top-fest" || !Array.isArray(c.categorias) || !Array.isArray(c.produtos) || !Array.isArray(c.inspiracoes)) {
        throw new Error("Esse arquivo não é uma cópia do catálogo Top Fest.");
      }
      var quando = c.exportado_em ? new Date(c.exportado_em).toLocaleString("pt-BR") : "data desconhecida";
      return confirmar("Restaurar a cópia de " + quando + "? (" + c.categorias.length + " categorias, " +
        c.produtos.length + " produtos, " + c.inspiracoes.length + " fotos de inspiração)", "Restaurar").then(function (sim) {
        if (sim) return restaurar(c);
      });
    }).catch(falhou);
  });

  function restaurar(c) {
    avisar("Restaurando… não feche a página.");
    var idNovo = {};
    var cfg = c.configuracoes || {};
    return sb.from("configuracoes").update({
      whatsapp_orcamentos: cfg.whatsapp_orcamentos,
      whatsapp_exibicao: cfg.whatsapp_exibicao || "",
      telefone_secundario: cfg.telefone_secundario || "",
      mostrar_precos: !!cfg.mostrar_precos
    }).eq("id", 1).then(ok).then(function () {
      // Categorias são casadas pelo nome (o número interno pode mudar).
      return sb.from("categorias").upsert(c.categorias.map(function (x) {
        return { nome: x.nome, icone: x.icone, tipo: x.tipo, ordem: x.ordem };
      }), { onConflict: "nome" }).select().then(ok);
    }).then(function (cats) {
      var porNome = {};
      cats.forEach(function (x) { porNome[x.nome] = x.id; });
      c.categorias.forEach(function (x) { idNovo[x.id] = porNome[x.nome]; });
      return sb.from("produtos").upsert(c.produtos.map(function (p) {
        return {
          id: p.id, categoria_id: idNovo[p.categoria_id], nome: p.nome, descricao: p.descricao || "",
          imagem: p.imagem, ativo: p.ativo !== false, ordem: p.ordem, preco: p.preco == null ? null : p.preco
        };
      }), { onConflict: "id" }).then(ok);
    }).then(function () {
      return sb.from("inspiracoes").upsert(c.inspiracoes.map(function (x) {
        return { id: x.id, imagem: x.imagem, legenda: x.legenda || "", ordem: x.ordem };
      }), { onConflict: "id" }).then(ok);
    }).then(carregarTudo).then(function () { avisar("Cópia restaurada com sucesso!"); });
  }

  iniciar();
})();
