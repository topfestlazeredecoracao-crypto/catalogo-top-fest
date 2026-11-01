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

  var st = { cats: [], prods: [], insp: [], conf: null, clientes: [], orcs: [] };
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

  // Código com 3 dígitos: 7 -> "007".
  function cod(n) { return n == null ? "" : String(n).padStart(3, "0"); }

  function brl(n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  // "2026-12-20" -> "20/12/2026"
  function dataBR(iso) { return iso ? iso.split("-").reverse().join("/") : ""; }

  // Lê valores como "35", "35,50", "1.500,00", "R$ 35.50". Vazio = 0. Inválido = NaN.
  function lerNumero(txt) {
    txt = String(txt == null ? "" : txt).replace(/R\$|\s/g, "");
    if (!txt) return 0;
    if (txt.indexOf(",") >= 0) txt = txt.replace(/\./g, "").replace(",", ".");
    else if (/\.\d{3}$/.test(txt)) txt = txt.replace(/\./g, "");
    var n = Number(txt);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  }

  function lerValor(txt, campo) {
    var n = lerNumero(txt);
    if (isNaN(n)) throw new Error(campo + " inválido. Use só números, ex.: 35,00");
    return n;
  }

  // Número para o campo de digitação: 35 -> "35,00"; 0 -> "".
  function numCampo(n) { return n ? Number(n).toFixed(2).replace(".", ",") : ""; }

  // "5519991616329" -> "(19) 99161-6329"
  function telBR(d) {
    d = String(d || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return d;
  }

  function linkWhats(numero, texto) {
    return "https://wa.me/" + numero + (texto ? "?text=" + encodeURIComponent(texto) : "");
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
    if (code === "23505" && /codigo/.test(m)) return "Já existe um produto com esse código. Escolha outro ou deixe vazio.";
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
      sb.from("configuracoes").select("*").eq("id", 1).single(),
      sb.from("clientes").select("*").order("nome"),
      sb.from("orcamentos").select("*").order("numero", { ascending: false })
    ]).then(function (r) {
      st.cats = ok(r[0]);
      st.prods = ok(r[1]);
      st.insp = ok(r[2]);
      st.conf = ok(r[3]);
      st.clientes = ok(r[4]);
      st.orcs = ok(r[5]);
      desenharTudo();
    }).catch(falhou);
  }

  function desenharTudo() {
    preencherFiltroCategorias();
    desenharProdutos();
    desenharCategorias();
    desenharInspiracoes();
    preencherConfig();
    desenharClientes();
    desenharOrcamentos();
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
      return !t || (cod(p.codigo) + " " + p.nome + " " + p.descricao).toLowerCase().indexOf(t) >= 0;
    }).sort(function (a, b) {
      return posCat[a.categoria_id] - posCat[b.categoria_id] || a.ordem - b.ordem || a.nome.localeCompare(b.nome);
    });
    $("#lista-produtos").innerHTML = lista.map(function (p, i) {
      var c = cat(p.categoria_id) || { nome: "?", icone: "❔" };
      return '<li class="item' + (p.ativo ? "" : " oculto") + '" data-id="' + esc(p.id) + '">' +
        '<div class="mini">' + (p.imagem ? '<img src="' + esc(fotoUrl(p.imagem)) + '" alt="" loading="lazy">' : esc(c.icone)) + "</div>" +
        '<div class="item-info"><b><span class="cod">Cód. ' + cod(p.codigo) + "</span> " + esc(p.nome) +
        (p.ativo ? "" : ' <span class="selo">OCULTO</span>') + "</b>" +
        "<span>" + esc(c.nome) + (p.preco != null ? " · " + brl(p.preco) + (p.mostrar_preco ? "" : " (preço escondido no site)") : "") +
        "</span></div>" +
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
    formP.mostrar_preco.checked = p ? p.mostrar_preco !== false : true;
    if (p) {
      formP.codigo.value = p.codigo == null ? "" : p.codigo;
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
    if (!txt.trim()) return null;
    return lerValor(txt, "Preço");
  }

  // Vazio = o banco escolhe o próximo número.
  function lerCodigo(txt) {
    txt = txt.trim();
    if (!txt) return null;
    var n = Number(txt);
    if (!Number.isInteger(n) || n < 1 || n > 99999) throw new Error("Código inválido. Use só números, ex.: 216");
    return n;
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
      preco: lerPreco(formP.preco.value),
      mostrar_preco: formP.mostrar_preco.checked
    };
    if (!dados.nome) throw new Error("Preencha o nome do produto.");
    var p = produtoEditando;
    var codigo = lerCodigo(formP.codigo.value);
    if (codigo != null) dados.codigo = codigo;
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
        versao: 2,
        exportado_em: new Date().toISOString(),
        endereco_fotos: fotoUrl("x").replace(/x$/, ""),
        configuracoes: st.conf,
        categorias: st.cats,
        produtos: st.prods,
        inspiracoes: st.insp,
        clientes: st.clientes,
        orcamentos: st.orcs
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
        c.produtos.length + " produtos, " + c.inspiracoes.length + " fotos de inspiração" +
        (c.clientes ? ", " + c.clientes.length + " clientes, " + (c.orcamentos || []).length + " orçamentos" : "") + ")", "Restaurar").then(function (sim) {
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
      // Cópias antigas (versão 1) não têm código: o banco numera sozinho (defaultToNull: false).
      return sb.from("produtos").upsert(c.produtos.map(function (p) {
        var linha = {
          id: p.id, categoria_id: idNovo[p.categoria_id], nome: p.nome, descricao: p.descricao || "",
          imagem: p.imagem, ativo: p.ativo !== false, ordem: p.ordem, preco: p.preco == null ? null : p.preco,
          mostrar_preco: p.mostrar_preco !== false
        };
        if (p.codigo != null) linha.codigo = p.codigo;
        return linha;
      }), { onConflict: "id", defaultToNull: false }).then(ok);
    }).then(function () {
      return sb.from("inspiracoes").upsert(c.inspiracoes.map(function (x) {
        return { id: x.id, imagem: x.imagem, legenda: x.legenda || "", ordem: x.ordem };
      }), { onConflict: "id" }).then(ok);
    }).then(function () {
      if (!c.clientes || !c.clientes.length) return;
      return sb.from("clientes").upsert(c.clientes.map(function (x) {
        return {
          id: x.id, nome: x.nome, whatsapp: x.whatsapp || "", documento: x.documento || "", email: x.email || "",
          cep: x.cep || "", endereco: x.endereco || "", bairro: x.bairro || "", cidade: x.cidade || "",
          observacoes: x.observacoes || ""
        };
      }), { onConflict: "id" }).then(ok);
    }).then(function () {
      if (!c.orcamentos || !c.orcamentos.length) return;
      return sb.from("orcamentos").upsert(c.orcamentos.map(function (x) {
        return {
          id: x.id, numero: x.numero, cliente_id: x.cliente_id || null, cliente_nome: x.cliente_nome || "",
          data_evento: x.data_evento || null, itens: x.itens || [], desconto: x.desconto || 0,
          taxa_entrega: x.taxa_entrega || 0, observacoes: x.observacoes || "", criado_em: x.criado_em
        };
      }), { onConflict: "id" }).then(ok);
    }).then(carregarTudo).then(function () { avisar("Cópia restaurada com sucesso!"); });
  }

  // ---------- Clientes ----------
  function cliente(id) {
    for (var i = 0; i < st.clientes.length; i++) if (st.clientes[i].id === id) return st.clientes[i];
    return null;
  }

  function ordenarClientes() {
    st.clientes.sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
  }

  // CPF: 11 números. CNPJ: 14 caracteres (desde 2026 pode ter letras nas 12 primeiras posições).
  function cpfOk(d) {
    if (/^(\d)\1+$/.test(d)) return false;
    for (var j = 9; j < 11; j++) {
      var s = 0;
      for (var i = 0; i < j; i++) s += Number(d[i]) * (j + 1 - i);
      if ((s * 10) % 11 % 10 !== Number(d[j])) return false;
    }
    return true;
  }

  function cnpjOk(d) {
    if (/^(\d)\1+$/.test(d)) return false;
    var pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (var j = 12; j < 14; j++) {
      var s = 0;
      for (var i = 0; i < j; i++) s += (d.charCodeAt(i) - 48) * pesos[i + 13 - j];
      var r = s % 11;
      if ((r < 2 ? 0 : 11 - r) !== Number(d[j])) return false;
    }
    return true;
  }

  function lerDocumento(txt) {
    var d = txt.toUpperCase().replace(/[\s.\-\/]/g, "");
    if (!d) return "";
    if (/^\d{11}$/.test(d)) {
      if (!cpfOk(d)) throw new Error("Esse CPF não é válido. Confira os números.");
      return d;
    }
    if (/^[0-9A-Z]{12}\d{2}$/.test(d)) {
      if (!cnpjOk(d)) throw new Error("Esse CNPJ não é válido. Confira os números.");
      return d;
    }
    throw new Error("O CPF tem 11 números e o CNPJ tem 14. Confira o que foi digitado.");
  }

  function docBR(d) {
    if (!d) return "";
    if (d.length === 11) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
    return d;
  }

  function lerWhatsCliente(txt) {
    if (!txt.replace(/\D/g, "")) return "";
    try { return normalizarWhats(txt); } catch (e) {
      throw new Error("WhatsApp do cliente inválido. Digite com DDD, ex.: (19) 99999-9999");
    }
  }

  function lerCep(txt) {
    var d = txt.replace(/\D/g, "");
    if (!d) return "";
    if (d.length !== 8) throw new Error("O CEP tem 8 números. Ex.: 13000-000");
    return d.slice(0, 5) + "-" + d.slice(5);
  }

  function desenharClientes() {
    var t = $("#busca-cliente").value.trim().toLowerCase();
    var td = t.replace(/\D/g, "");
    var lista = st.clientes.filter(function (c) {
      if (!t) return true;
      if ((c.nome + " " + c.cidade + " " + c.bairro + " " + c.email).toLowerCase().indexOf(t) >= 0) return true;
      return td.length >= 3 && (c.whatsapp + " " + c.documento).indexOf(td) >= 0;
    });
    $("#lista-clientes").innerHTML = lista.map(function (c) {
      var info = [telBR(c.whatsapp), c.cidade, docBR(c.documento)].filter(Boolean).join(" · ");
      return '<li class="item" data-id="' + esc(c.id) + '">' +
        '<div class="mini">👤</div>' +
        '<div class="item-info"><b>' + esc(c.nome) + "</b><span>" + esc(info || "Sem telefone") + "</span></div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="editar">✏️ Editar</button>' +
        '<button class="btn" data-acao="orcamento">🧾 Novo orçamento</button>' +
        (c.whatsapp ? '<a class="btn" href="' + esc(linkWhats(c.whatsapp)) + '" target="_blank" rel="noopener">💬 WhatsApp</a>' : "") +
        '<button class="btn" data-acao="excluir">🗑️ Excluir</button>' +
        "</div></li>";
    }).join("") || '<li class="dica">' + (st.clientes.length ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda.") + "</li>";
  }

  $("#busca-cliente").addEventListener("input", desenharClientes);
  $("#novo-cliente").addEventListener("click", function () { abrirCliente(null); });

  $("#lista-clientes").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]");
    if (!b) return;
    var c = cliente(b.closest("[data-id]").dataset.id);
    var acao = b.dataset.acao;
    if (acao === "editar") abrirCliente(c);
    else if (acao === "orcamento") abrirOrcamento(null, { cliente_id: c.id });
    else if (acao === "excluir") excluirCliente(c);
  });

  var formCli = $("#form-cliente");
  var clienteEditando = null;
  var aoSalvarCliente = null;

  // preenchido: valores iniciais (ex.: nome vindo do pedido); aoSalvar: chamado com o cliente salvo.
  function abrirCliente(c, preenchido, aoSalvar) {
    clienteEditando = c || null;
    aoSalvarCliente = aoSalvar || null;
    formCli.reset();
    $("#dlg-cliente-tit").textContent = c ? "Editar cliente" : "Novo cliente";
    var v = c || preenchido || {};
    ["nome", "email", "cep", "endereco", "bairro", "cidade", "observacoes"].forEach(function (k) { formCli[k].value = v[k] || ""; });
    formCli.whatsapp.value = telBR(v.whatsapp);
    formCli.documento.value = docBR(v.documento);
    $("#dlg-cliente").showModal();
  }

  formCli.addEventListener("submit", function (e) {
    e.preventDefault();
    var acao = Promise.resolve().then(function () {
      var dados = {
        nome: formCli.nome.value.trim(),
        whatsapp: lerWhatsCliente(formCli.whatsapp.value),
        documento: lerDocumento(formCli.documento.value),
        email: formCli.email.value.trim(),
        cep: lerCep(formCli.cep.value),
        endereco: formCli.endereco.value.trim(),
        bairro: formCli.bairro.value.trim(),
        cidade: formCli.cidade.value.trim(),
        observacoes: formCli.observacoes.value.trim()
      };
      if (!dados.nome) throw new Error("Preencha o nome do cliente.");
      var c = clienteEditando;
      var req = c ? sb.from("clientes").update(dados).eq("id", c.id) : sb.from("clientes").insert(dados);
      return req.select().single().then(ok).then(function (novo) {
        if (c) Object.assign(c, novo); else st.clientes.push(novo);
        ordenarClientes();
        $("#dlg-cliente").close();
        desenharClientes();
        desenharOrcamentos();
        avisar(c ? "Cliente salvo." : "Cliente cadastrado.");
        if (aoSalvarCliente) aoSalvarCliente(c || novo);
      });
    });
    ocupado($('button[type="submit"]', formCli), acao.catch(falhou));
  });

  function excluirCliente(c) {
    var n = st.orcs.filter(function (o) { return o.cliente_id === c.id; }).length;
    confirmar('Excluir o cliente "' + c.nome + '"?' + (n ? " Os " + n + " orçamento(s) dele continuam salvos, só com o nome." : ""), "Excluir").then(function (sim) {
      if (!sim) return;
      return sb.from("clientes").delete().eq("id", c.id).then(ok).then(function () {
        st.clientes = st.clientes.filter(function (x) { return x !== c; });
        st.orcs.forEach(function (o) { if (o.cliente_id === c.id) o.cliente_id = null; });
        desenharClientes();
        desenharOrcamentos();
        avisar("Cliente excluído.");
      });
    }).catch(falhou);
  }

  // ---------- Orçamentos ----------
  function orcPorId(id) { return st.orcs.filter(function (o) { return o.id === id; })[0]; }
  function produtoPorId(id) { return st.prods.filter(function (p) { return p.id === id; })[0]; }
  function produtoPorCodigo(n) { return st.prods.filter(function (p) { return p.codigo === n; })[0]; }

  function contas(o) {
    var itens = 0, servicos = 0;
    (o.itens || []).forEach(function (it) {
      var v = (Number(it.quantidade) || 0) * (Number(it.preco) || 0);
      if (it.tipo === "servico") servicos += v; else itens += v;
    });
    var desconto = Number(o.desconto) || 0, taxa = Number(o.taxa_entrega) || 0;
    return { itens: itens, servicos: servicos, desconto: desconto, taxa: taxa, total: Math.max(0, itens + servicos - desconto + taxa) };
  }

  function nomeCliente(o) {
    var c = cliente(o.cliente_id);
    return c ? c.nome : o.cliente_nome;
  }

  function linhaItem(it) {
    var q = Number(it.quantidade) || 0, p = Number(it.preco) || 0;
    return "- " + q + "x " + (it.codigo != null ? "(Cód. " + cod(it.codigo) + ") " : "") + it.nome + " – " +
      (q > 1 ? brl(p) + " cada = " + brl(q * p) : brl(p));
  }

  function msgOrcamento(o) {
    var primeiro = (nomeCliente(o) || "").trim().split(/\s+/)[0];
    var v = contas(o);
    var prods = o.itens.filter(function (it) { return it.tipo !== "servico"; });
    var servs = o.itens.filter(function (it) { return it.tipo === "servico"; });
    var m = "Olá" + (primeiro ? ", " + primeiro : "") + "! Segue o orçamento nº " + o.numero + " da " + st.conf.nome + ":\n";
    if (o.data_evento) m += "\nData do evento: " + dataBR(o.data_evento) + "\n";
    if (prods.length) m += "\nItens:\n" + prods.map(linhaItem).join("\n") + "\n";
    if (servs.length) m += "\nServiços:\n" + servs.map(linhaItem).join("\n") + "\n";
    if (v.desconto || v.taxa) m += "\nSubtotal: " + brl(v.itens + v.servicos);
    if (v.desconto) m += "\nDesconto: - " + brl(v.desconto);
    if (v.taxa) m += "\nTaxa de entrega: " + brl(v.taxa);
    m += "\nTotal: " + brl(v.total) + "\n";
    if (o.observacoes) m += "\nObservações: " + o.observacoes + "\n";
    return m + "\nObrigado!";
  }

  function desenharOrcamentos() {
    var t = $("#busca-orc").value.trim().toLowerCase();
    var lista = st.orcs.filter(function (o) {
      return !t || String(o.numero) === t.replace(/^n[º°o]?\s*/, "") || (nomeCliente(o) || "").toLowerCase().indexOf(t) >= 0;
    });
    $("#lista-orcamentos").innerHTML = lista.map(function (o) {
      var c = cliente(o.cliente_id);
      var n = o.itens.length;
      var info = [o.data_evento ? "Evento: " + dataBR(o.data_evento) : "", n + (n === 1 ? " item" : " itens"), "Total: " + brl(contas(o).total)]
        .filter(Boolean).join(" · ");
      return '<li class="item" data-id="' + esc(o.id) + '">' +
        '<div class="mini">🧾</div>' +
        '<div class="item-info"><b>Nº ' + o.numero + " · " + esc(nomeCliente(o) || "Sem cliente") + "</b><span>" + esc(info) + "</span></div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="abrir">✏️ Abrir</button>' +
        '<a class="btn" href="imprimir.html?id=' + encodeURIComponent(o.id) + '" target="_blank" rel="noopener">🖨️ Imprimir / PDF</a>' +
        (c && c.whatsapp
          ? '<a class="btn" href="' + esc(linkWhats(c.whatsapp, msgOrcamento(o))) + '" target="_blank" rel="noopener">💬 Enviar no WhatsApp</a>'
          : '<button class="btn" data-acao="sem-whats">💬 Enviar no WhatsApp</button>') +
        '<button class="btn" data-acao="copiar">📄 Copiar</button>' +
        '<button class="btn" data-acao="excluir">🗑️ Excluir</button>' +
        "</div></li>";
    }).join("") || '<li class="dica">' + (st.orcs.length ? "Nenhum orçamento encontrado." : "Nenhum orçamento ainda.") + "</li>";
  }

  $("#busca-orc").addEventListener("input", desenharOrcamentos);
  $("#novo-orcamento").addEventListener("click", function () { abrirOrcamento(null); });

  $("#lista-orcamentos").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]");
    if (!b) return;
    var o = orcPorId(b.closest("[data-id]").dataset.id);
    var acao = b.dataset.acao;
    if (acao === "abrir") abrirOrcamento(o);
    else if (acao === "copiar") {
      // Novo orçamento com os mesmos itens (ex.: para outro cliente ou outra data).
      abrirOrcamento(null, { cliente_id: o.cliente_id, itens: o.itens, desconto: o.desconto, taxa_entrega: o.taxa_entrega, observacoes: o.observacoes });
    } else if (acao === "sem-whats") {
      avisar("Este cliente não tem WhatsApp cadastrado. Abra o orçamento e cadastre ou escolha o cliente.", true);
    } else if (acao === "excluir") {
      confirmar("Excluir o orçamento nº " + o.numero + "?", "Excluir").then(function (sim) {
        if (!sim) return;
        return sb.from("orcamentos").delete().eq("id", o.id).then(ok).then(function () {
          st.orcs = st.orcs.filter(function (x) { return x !== o; });
          desenharOrcamentos();
          avisar("Orçamento excluído.");
        });
      }).catch(falhou);
    }
  });

  // ----- Formulário do orçamento -----
  var formO = $("#form-orcamento");
  var orc = null;           // orçamento em edição (cópia de trabalho)
  var orcOriginal = null;

  function avisoOrc(texto) {
    var p = $("#orc-aviso-cliente");
    p.textContent = texto || "";
    p.hidden = !texto;
  }

  function opcoesCliente() {
    formO.cliente_id.innerHTML = '<option value="">— Escolha o cliente —</option>' + st.clientes.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.nome + (c.whatsapp ? " – " + telBR(c.whatsapp) : "")) + "</option>";
    }).join("");
    formO.cliente_id.value = orc.cliente_id || "";
  }

  // base: orçamento salvo (editar) ou null (novo); inicial: valores para um novo orçamento.
  function abrirOrcamento(base, inicial) {
    orcOriginal = base || null;
    nomePedido = "";
    var v = base || inicial || {};
    orc = {
      cliente_id: v.cliente_id || null,
      data_evento: v.data_evento || "",
      itens: JSON.parse(JSON.stringify(v.itens || [])),
      desconto: Number(v.desconto) || 0,
      taxa_entrega: Number(v.taxa_entrega) || 0,
      observacoes: v.observacoes || ""
    };
    formO.reset();
    $("#dlg-orcamento-tit").textContent = base ? "Orçamento nº " + base.numero : "Novo orçamento";
    opcoesCliente();
    formO.data_evento.value = orc.data_evento;
    formO.desconto.value = numCampo(orc.desconto);
    formO.taxa_entrega.value = numCampo(orc.taxa_entrega);
    formO.observacoes.value = orc.observacoes;
    $("#orc-sugestoes").innerHTML = "";
    avisoOrc("");
    listaServicos();
    desenharItensOrc();
    $("#dlg-orcamento").showModal();
  }

  // Sugere nomes de serviços já usados em outros orçamentos.
  function listaServicos() {
    var nomes = {};
    st.orcs.forEach(function (o) {
      o.itens.forEach(function (it) { if (it.tipo === "servico" && it.nome) nomes[it.nome] = true; });
    });
    var dl = $("#lista-servicos");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "lista-servicos";
      formO.appendChild(dl);
    }
    dl.innerHTML = Object.keys(nomes).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  }

  function desenharItensOrc() {
    $("#orc-itens").innerHTML = orc.itens.map(function (it, i) {
      var serv = it.tipo === "servico";
      return '<li class="orc-item' + (serv ? " servico" : "") + '" data-i="' + i + '">' +
        (serv
          ? '<label class="orc-nome">Serviço<input data-campo="nome" maxlength="150" list="lista-servicos" placeholder="Ex.: Montagem" value="' + esc(it.nome) + '"></label>'
          : '<div class="orc-nome">' + (it.codigo != null ? '<span class="cod">Cód. ' + cod(it.codigo) + "</span> " : "") + esc(it.nome) + "</div>") +
        '<label>Qtd<input data-campo="quantidade" type="number" min="1" max="9999" inputmode="numeric" value="' + esc(it.quantidade) + '"></label>' +
        '<label>Valor unit. (R$)<input data-campo="preco" inputmode="decimal" placeholder="0,00" value="' + esc(numCampo(it.preco)) + '"></label>' +
        '<span class="orc-sub" data-sub>' + brl((Number(it.quantidade) || 0) * (Number(it.preco) || 0)) + "</span>" +
        '<button class="btn" type="button" data-acao="remover" aria-label="Remover ' + esc(it.nome || "serviço") + '">✖ Remover</button></li>';
    }).join("") || '<li class="dica">Nenhum item ainda. Procure um produto acima ou adicione um serviço.</li>';
    desenharTotais();
  }

  function desenharTotais() {
    var v = contas(orc);
    var linha = function (rotulo, valor, cls) {
      return "<div" + (cls ? ' class="' + cls + '"' : "") + "><span>" + rotulo + "</span><span>" + valor + "</span></div>";
    };
    $("#orc-totais").innerHTML = linha("Itens", brl(v.itens)) +
      (v.servicos ? linha("Serviços", brl(v.servicos)) : "") +
      (v.desconto ? linha("Desconto", "- " + brl(v.desconto)) : "") +
      (v.taxa ? linha("Taxa de entrega", brl(v.taxa)) : "") +
      linha("Total", brl(v.total), "total");
  }

  function adicionarProduto(p, quantidade) {
    var q = quantidade || 1;
    var ja = orc.itens.filter(function (it) { return it.produto_id === p.id; })[0];
    if (ja) ja.quantidade = (Number(ja.quantidade) || 0) + q;
    else orc.itens.push({ tipo: "produto", produto_id: p.id, codigo: p.codigo, nome: p.nome, quantidade: q, preco: Number(p.preco) || 0 });
  }

  function sugestoes() {
    var t = $("#orc-busca").value.trim().toLowerCase();
    if (!t) return [];
    var num = /^\d+$/.test(t) ? Number(t) : null;
    var exato = num != null ? produtoPorCodigo(num) : null;
    var lista = st.prods.filter(function (p) {
      return p !== exato && (cod(p.codigo).indexOf(t) === 0 || p.nome.toLowerCase().indexOf(t) >= 0);
    }).slice(0, 8);
    return exato ? [exato].concat(lista.slice(0, 7)) : lista;
  }

  function desenharSugestoes() {
    $("#orc-sugestoes").innerHTML = sugestoes().map(function (p) {
      return '<li><button type="button" data-id="' + esc(p.id) + '"><span class="cod">Cód. ' + cod(p.codigo) + "</span><span>" +
        esc(p.nome) + (p.ativo ? "" : " (oculto)") + (p.preco != null ? " · " + brl(p.preco) : "") + "</span></button></li>";
    }).join("");
  }

  function escolherSugestao(p) {
    adicionarProduto(p);
    $("#orc-busca").value = "";
    $("#orc-sugestoes").innerHTML = "";
    desenharItensOrc();
    $("#orc-busca").focus();
  }

  $("#orc-busca").addEventListener("input", desenharSugestoes);
  $("#orc-sugestoes").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]");
    if (b) escolherSugestao(produtoPorId(b.dataset.id));
  });

  // Enter não salva o formulário sem querer; na busca, adiciona a primeira sugestão.
  formO.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    e.preventDefault();
    if (e.target.id === "orc-busca") {
      var s = sugestoes()[0];
      if (s) escolherSugestao(s);
    }
  });

  $("#orc-servico").addEventListener("click", function () {
    orc.itens.push({ tipo: "servico", produto_id: null, codigo: null, nome: "", quantidade: 1, preco: 0 });
    desenharItensOrc();
    var campos = $$('#orc-itens [data-campo="nome"]');
    if (campos.length) campos[campos.length - 1].focus();
  });

  $("#orc-itens").addEventListener("input", function (e) {
    var li = e.target.closest("[data-i]");
    if (!li) return;
    var it = orc.itens[Number(li.dataset.i)];
    var campo = e.target.dataset.campo;
    if (campo === "nome") it.nome = e.target.value;
    else if (campo === "quantidade") it.quantidade = parseInt(e.target.value, 10) || 0;
    else if (campo === "preco") it.preco = lerNumero(e.target.value);
    $("[data-sub]", li).textContent = isNaN(it.preco) ? "valor inválido" : brl((Number(it.quantidade) || 0) * it.preco);
    desenharTotais();
  });

  $("#orc-itens").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao=remover]");
    if (!b) return;
    orc.itens.splice(Number(b.closest("[data-i]").dataset.i), 1);
    desenharItensOrc();
  });

  ["desconto", "taxa_entrega"].forEach(function (k) {
    formO[k].addEventListener("input", function () {
      orc[k] = lerNumero(formO[k].value);
      desenharTotais();
    });
  });

  formO.cliente_id.addEventListener("change", function () {
    orc.cliente_id = formO.cliente_id.value || null;
    if (orc.cliente_id) avisoOrc("");
  });

  var nomePedido = "";   // nome que veio no pedido colado, para sugerir no cadastro

  $("#orc-novo-cliente").addEventListener("click", function () {
    abrirCliente(null, { nome: nomePedido }, function (c) {
      orc.cliente_id = c.id;
      opcoesCliente();
      avisoOrc("");
    });
  });

  formO.addEventListener("submit", function (e) {
    e.preventDefault();
    var botao = $('button[type="submit"]', formO);
    ocupado(botao, Promise.resolve().then(salvarOrcamento)).catch(falhou);
  });

  function salvarOrcamento() {
    if (!orc.itens.length) throw new Error("Adicione pelo menos um produto ou serviço.");
    var itens = orc.itens.map(function (it) {
      var nome = String(it.nome || "").trim();
      if (!nome) throw new Error("Escreva o nome de cada serviço.");
      var q = Number(it.quantidade);
      if (!Number.isInteger(q) || q < 1) throw new Error('Quantidade inválida em "' + nome + '".');
      if (isNaN(it.preco)) throw new Error('Valor inválido em "' + nome + '". Use só números, ex.: 35,00');
      return { tipo: it.tipo, produto_id: it.produto_id || null, codigo: it.codigo == null ? null : it.codigo, nome: nome, quantidade: q, preco: Number(it.preco) || 0 };
    });
    var c = cliente(orc.cliente_id);
    var dados = {
      cliente_id: c ? c.id : null,
      cliente_nome: c ? c.nome : (orcOriginal ? orcOriginal.cliente_nome : nomePedido),
      data_evento: formO.data_evento.value || null,
      itens: itens,
      desconto: lerValor(formO.desconto.value, "Desconto"),
      taxa_entrega: lerValor(formO.taxa_entrega.value, "Taxa de entrega"),
      observacoes: formO.observacoes.value.trim()
    };
    var o = orcOriginal;
    var req = o ? sb.from("orcamentos").update(dados).eq("id", o.id) : sb.from("orcamentos").insert(dados);
    return req.select().single().then(ok).then(function (novo) {
      if (o) Object.assign(o, novo); else st.orcs.unshift(novo);
      st.orcs.sort(function (a, b) { return b.numero - a.numero; });
      nomePedido = "";
      $("#dlg-orcamento").close();
      $("#busca-orc").value = "";
      desenharOrcamentos();
      avisar("Orçamento nº " + novo.numero + " salvo. Agora você pode imprimir ou enviar no WhatsApp.");
    });
  }

  // ----- Colar pedido do WhatsApp -----
  var formCol = $("#form-colar");

  $("#colar-pedido").addEventListener("click", function () {
    formCol.reset();
    $("#dlg-colar").showModal();
  });

  // Entende a mensagem que o site manda: "- 2x (Cód. 080) Nome", "Nome: …", "Data do evento: dd/mm/aaaa".
  function lerPedido(txt) {
    var r = { itens: [], nome: "", data: "", faltou: [] };
    var guarda = orc;
    orc = { itens: r.itens };
    txt.split(/\r?\n/).forEach(function (l) {
      l = l.trim();
      var mn = l.match(/^nome:\s*(.+)$/i);
      var md = l.match(/^data do evento:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      var mi = l.match(/^[-•*]?\s*(\d+)\s*x\s+(.+)$/i);
      if (mn) r.nome = mn[1].trim();
      else if (md) r.data = md[3] + "-" + md[2].padStart(2, "0") + "-" + md[1].padStart(2, "0");
      else if (mi) {
        var resto = mi[2].trim();
        var mc = resto.match(/^\(?\s*c[óo]d\.?\s*(\d+)\s*\)?\s*(.*)$/i);
        var nome = (mc ? mc[2] : resto).trim().toLowerCase();
        var p = mc ? produtoPorCodigo(Number(mc[1])) : null;
        if (!p) p = st.prods.filter(function (x) { return x.nome.toLowerCase() === nome; })[0];
        if (p) adicionarProduto(p, Number(mi[1]) || 1);
        else r.faltou.push(l);
      }
    });
    orc = guarda;
    return r;
  }

  formCol.addEventListener("submit", function (e) {
    e.preventDefault();
    var r = lerPedido(formCol.texto.value);
    if (!r.itens.length) {
      avisar("Não encontrei itens nessa mensagem. Confira se colou o pedido inteiro.", true);
      return;
    }
    var nome = r.nome.toLowerCase();
    var c = nome ? st.clientes.filter(function (x) { return x.nome.toLowerCase() === nome; })[0] : null;
    $("#dlg-colar").close();
    abrirOrcamento(null, { cliente_id: c ? c.id : null, data_evento: r.data, itens: r.itens });
    nomePedido = r.nome;
    var avisos = [];
    if (r.nome && !c) avisos.push('O pedido veio com o nome "' + r.nome + '", que não está cadastrado. Escolha o cliente ou toque em "Cadastrar cliente".');
    if (r.faltou.length) avisos.push("Não encontrei no catálogo: " + r.faltou.join(" | ") + ". Adicione manualmente.");
    avisoOrc(avisos.join(" "));
  });

  iniciar();
})();
