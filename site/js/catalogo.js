/* Catálogo público da Chácara Top Fest.
   Lê os dados do Supabase (somente leitura, chave pública). Se o Supabase
   estiver fora do ar, usa a cópia de reserva em reserva/catalogo.json. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var GALERIA = "galeria";
  var CARRINHO = "topfest-orcamento";

  var cats = [];        // categorias em ordem
  var prods = [];       // produtos ativos em ordem (categoria, ordem)
  var porId = {};
  var insp = [];
  var conf = { whatsapp_orcamentos: "5519991616329", mostrar_precos: false };
  var reserva = false;

  var cart = lerCarrinho();
  var cat = "Todos";
  var q = "";
  var nome = "";
  var data = "";

  function $(s) { return document.querySelector(s); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fotoUrl(caminho) {
    if (!caminho) return "";
    if (/^(https?:)?\/\//.test(caminho) || reserva) return caminho;
    return CFG.supabaseUrl + "/storage/v1/object/public/" + CFG.bucket + "/" +
      caminho.split("/").map(encodeURIComponent).join("/");
  }

  function lerCarrinho() {
    try { return JSON.parse(localStorage.getItem(CARRINHO)) || {}; } catch (e) { return {}; }
  }
  function salvarCarrinho() {
    try { localStorage.setItem(CARRINHO, JSON.stringify(cart)); } catch (e) { /* sem armazenamento */ }
  }

  function api(tabela, consulta) {
    return fetch(CFG.supabaseUrl + "/rest/v1/" + tabela + "?" + consulta, {
      headers: { apikey: CFG.supabaseKey }
    }).then(function (r) {
      if (!r.ok) throw new Error(tabela + ": " + r.status);
      return r.json();
    });
  }

  function carregarSupabase() {
    return Promise.all([
      api("configuracoes", "select=*&id=eq.1"),
      api("categorias", "select=id,nome,icone,tipo,ordem&order=ordem,id"),
      api("produtos", "select=id,categoria_id,nome,descricao,imagem,ordem,preco&ativo=is.true&order=ordem,nome"),
      api("inspiracoes", "select=id,imagem,legenda,ordem&order=ordem,id")
    ]).then(function (r) {
      return { configuracoes: r[0][0], categorias: r[1], produtos: r[2], inspiracoes: r[3] };
    });
  }

  function carregarReserva() {
    return fetch("reserva/catalogo.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("reserva: " + r.status);
      reserva = true;
      return r.json();
    });
  }

  function montar(d) {
    if (d.configuracoes) conf = d.configuracoes;
    cats = d.categorias.slice().sort(function (a, b) { return a.ordem - b.ordem || a.id - b.id; });
    var posCat = {};
    cats.forEach(function (c, i) { posCat[c.id] = i; c.chave = String(c.id); });
    prods = d.produtos.filter(function (p) { return p.ativo !== false && p.categoria_id in posCat; })
      .sort(function (a, b) { return posCat[a.categoria_id] - posCat[b.categoria_id] || a.ordem - b.ordem; });
    porId = {};
    prods.forEach(function (p) { porId[p.id] = p; });
    insp = d.inspiracoes.slice().sort(function (a, b) { return a.ordem - b.ordem; });
    // Remove do orçamento itens que saíram do catálogo.
    Object.keys(cart).forEach(function (k) { if (!porId[k]) delete cart[k]; });
    salvarCarrinho();
  }

  function catPorId(id) {
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return null;
  }

  function chips() {
    var h = '<button class="chip' + (cat === "Todos" ? " on" : "") + '" data-c="Todos" aria-pressed="' + (cat === "Todos") + '">✨ Todos</button>';
    cats.forEach(function (c) {
      var on = cat === c.chave;
      h += '<button class="chip' + (on ? " on" : "") + '" data-c="' + esc(c.chave) + '" aria-pressed="' + on + '">' +
        esc(c.icone) + " " + esc(c.nome) + "</button>";
    });
    $("#chips").innerHTML = h;
  }

  function ctl(id, nomeItem) {
    var n = cart[id] || 0;
    if (!n) return '<button class="add" data-a="+" data-i="' + esc(id) + '">Adicionar ao orçamento</button>';
    return '<div class="qty"><button data-a="-" data-i="' + esc(id) + '" aria-label="Diminuir quantidade de ' + esc(nomeItem) + '">−</button>' +
      '<b aria-live="polite">' + n + '</b><button data-a="+" data-i="' + esc(id) + '" aria-label="Aumentar quantidade de ' + esc(nomeItem) + '">+</button></div>';
  }

  function preco(p) {
    if (!conf.mostrar_precos || p.preco == null) return "";
    return '<span class="preco">' + Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) + "</span>";
  }

  function grid() {
    var c = cat === "Todos" ? null : catPorId(Number(cat));
    var aviso = reserva ? '<div class="aviso">Mostrando a última cópia salva do catálogo.</div>' : "";
    if (c && c.tipo === GALERIA) {
      $("#grid").innerHTML = aviso + (insp.map(function (x, i) {
        return '<div class="card"><button class="ins" data-z="' + i + '" aria-label="Ampliar foto de inspiração' + (x.legenda ? ": " + esc(x.legenda) : "") + '">' +
          '<img src="' + esc(fotoUrl(x.imagem)) + '" alt="Inspiração de decoração' + (x.legenda ? " – " + esc(x.legenda) : "") + '" loading="lazy" decoding="async"></button>' +
          (x.legenda ? '<p class="cap">' + esc(x.legenda) + "</p>" : "") + "</div>";
      }).join("") || '<div class="empty">Nenhuma foto ainda.</div>');
      return;
    }
    var t = q.trim().toLowerCase();
    var h = "";
    prods.forEach(function (p) {
      var pc = catPorId(p.categoria_id);
      if (!pc || pc.tipo === GALERIA) return;
      if (c && p.categoria_id !== c.id) return;
      if (t && (p.nome + " " + p.descricao).toLowerCase().indexOf(t) < 0) return;
      var foto = fotoUrl(p.imagem);
      h += '<div class="card"><div class="tile">' +
        (foto ? '<img src="' + esc(foto) + '" alt="' + esc(p.nome) + '" loading="lazy" decoding="async" width="230" height="170">'
              : '<span role="img" aria-label="' + esc(pc.nome) + '">' + esc(pc.icone) + "</span>") +
        '</div><div class="body"><span class="cat">' + esc(pc.nome) + "</span><h3>" + esc(p.nome) + "</h3><p>" +
        esc(p.descricao) + "</p>" + preco(p) + ctl(p.id, p.nome) + "</div></div>";
    });
    $("#grid").innerHTML = aviso + (h || '<div class="empty">Nenhum item encontrado.</div>');
  }

  function total() {
    var s = 0;
    for (var k in cart) s += cart[k];
    return s;
  }

  function fab() {
    var n = total();
    var b = $("#fab");
    b.hidden = !n;
    b.textContent = "🛒 Ver orçamento (" + n + ")";
  }

  function chg(id, d) {
    if (!porId[id]) return;
    cart[id] = (cart[id] || 0) + d;
    if (cart[id] <= 0) delete cart[id];
    salvarCarrinho();
    fab();
    grid();
    if (!$("#ov").hidden) panel();
  }

  function msg() {
    var m = "Olá! Gostaria de um orçamento de locação dos itens abaixo:\n\n";
    Object.keys(cart).forEach(function (id) { m += "- " + cart[id] + "x " + porId[id].nome + "\n"; });
    var n = nome.trim();
    if (n) m += "\nNome: " + n;
    if (data) m += "\nData do evento: " + data.split("-").reverse().join("/");
    return m + "\n\nObrigado!";
  }

  function panel() {
    var ids = Object.keys(cart);
    var h = '<h2 id="ptitle">Seu orçamento</h2>';
    if (!ids.length) h += '<p class="empty">Nenhum item ainda.</p>';
    ids.forEach(function (id) {
      var p = porId[id];
      h += '<div class="row"><span>' + esc(p.nome) + '</span><div class="qty">' +
        '<button data-a="-" data-i="' + esc(id) + '" aria-label="Diminuir quantidade de ' + esc(p.nome) + '">−</button><b>' + cart[id] + "</b>" +
        '<button data-a="+" data-i="' + esc(id) + '" aria-label="Aumentar quantidade de ' + esc(p.nome) + '">+</button></div></div>';
    });
    h += '<label class="f">Seu nome<input id="nm" autocomplete="name" value="' + esc(nome) + '"></label>' +
      '<label class="f">Data do evento<input id="dt" type="date" value="' + esc(data) + '"></label>' +
      '<a id="send" class="' + (ids.length ? "" : "off") + '" target="_blank" rel="noopener" href="#">Enviar orçamento pelo WhatsApp</a>' +
      '<div class="sec"><button data-a="x">Continuar escolhendo</button><button data-a="clr">Limpar</button></div>';
    $("#panel").innerHTML = h;
    upd();
  }

  function upd() {
    var s = $("#send");
    if (s) s.href = "https://wa.me/" + conf.whatsapp_orcamentos + "?text=" + encodeURIComponent(msg());
  }

  function abrirPainel() {
    panel();
    $("#ov").hidden = false;
    document.body.style.overflow = "hidden";
    var b = $("#panel button, #panel input");
    if (b) b.focus();
  }

  function fecharPainel() {
    $("#ov").hidden = true;
    document.body.style.overflow = "";
    $("#fab").focus();
  }

  function fecharFoto() {
    $("#lb").hidden = true;
    $("#lb").innerHTML = "";
  }

  document.addEventListener("click", function (e) {
    var z = e.target.closest("[data-z]");
    if (z) {
      var x = insp[Number(z.dataset.z)];
      $("#lb").innerHTML = '<img src="' + esc(fotoUrl(x.imagem)) + '" alt="Inspiração de decoração ampliada">';
      $("#lb").hidden = false;
      return;
    }
    if (e.target.closest("#lb")) { fecharFoto(); return; }
    var t = e.target.closest("[data-a],[data-c]");
    if (!t) { if (e.target.id === "ov") fecharPainel(); return; }
    if (t.dataset.c) { cat = t.dataset.c; chips(); grid(); return; }
    var a = t.dataset.a;
    if (a === "+") chg(t.dataset.i, 1);
    else if (a === "-") chg(t.dataset.i, -1);
    else if (a === "x") fecharPainel();
    else if (a === "clr") { cart = {}; salvarCarrinho(); fab(); grid(); panel(); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("#lb").hidden) fecharFoto();
    else if (!$("#ov").hidden) fecharPainel();
  });

  $("#fab").addEventListener("click", abrirPainel);
  $("#q").addEventListener("input", function () {
    q = this.value;
    // A busca procura em todos os produtos.
    if (q && cat !== "Todos") { var c = catPorId(Number(cat)); if (c && c.tipo === GALERIA) { cat = "Todos"; chips(); } }
    grid();
  });
  $("#panel").addEventListener("input", function (e) {
    if (e.target.id === "nm") nome = e.target.value;
    if (e.target.id === "dt") data = e.target.value;
    upd();
  });

  carregarSupabase()
    .catch(carregarReserva)
    .then(function (d) { montar(d); chips(); grid(); fab(); })
    .catch(function () {
      $("#grid").innerHTML = '<div class="empty">Não foi possível carregar o catálogo agora. Tente novamente em alguns minutos.</div>';
    });
})();
