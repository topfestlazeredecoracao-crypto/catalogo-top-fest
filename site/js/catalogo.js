/* Catálogo público da Chácara Top Fest.
   Lê os dados do Supabase (somente leitura, chave pública). Se o Supabase
   estiver fora do ar, usa a cópia de reserva em reserva/catalogo.json. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var GALERIA = "galeria";
  var CHACARA = "chacara";
  var CARRINHO = "topfest-orcamento";
  var INDICACAO = "topfest-indicacao";
  var DIAS_INDICACAO = 90;   // por quanto tempo o site lembra o link de indicação

  var cats = [];        // categorias em ordem
  var prods = [];       // produtos ativos em ordem (categoria, ordem)
  var porId = {};
  var insp = [];
  var chacara = null;   // { cat, pagina } da página de aluguel da chácara
  var conf = { whatsapp_orcamentos: "5519991616329", mostrar_precos: false };
  var reserva = false;

  var cart = lerCarrinho();
  var cat = "Todos";
  var q = "";
  var nome = "";
  var data = "";
  var obs = "";
  var indicadoPor = "";   // nome digitado em "Quem te indicou?"
  var indicacao = lerIndicacao();   // código do link pessoal (?ind=K7M2P)

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

  // Link de indicação: guarda o código por alguns dias neste aparelho e tira do endereço,
  // para que, se esta pessoa compartilhar o site, o link dela vá limpo.
  function lerIndicacao() {
    var guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(INDICACAO)); } catch (e) { /* sem armazenamento */ }
    var params = new URLSearchParams(location.search);
    var novo = (params.get("ind") || "").trim().toUpperCase();
    if (params.has("ind")) {
      params.delete("ind");
      var resto = params.toString();
      try { history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash); } catch (e) { /* ignora */ }
    }
    if (/^[A-Z0-9]{3,10}$/.test(novo)) {
      guardado = { c: novo, t: Date.now() };
      try { localStorage.setItem(INDICACAO, JSON.stringify(guardado)); } catch (e) { /* sem armazenamento */ }
    }
    if (!guardado || !/^[A-Z0-9]{3,10}$/.test(guardado.c) || !(Date.now() - guardado.t < DIAS_INDICACAO * 864e5)) return "";
    return guardado.c;
  }

  function programaIndicacao() { return conf.indicacao_ativa === true; }

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
      api("categorias", "select=id,nome,tipo,ordem&order=ordem,id"),
      api("produtos", "select=id,codigo,categoria_id,nome,descricao,imagem,ordem,quantidade,kit_itens&ativo=is.true&order=ordem,nome"),
      // Só os preços que a administradora deixou aparecer.
      api("precos_publicos", "select=id,preco"),
      // Página da chácara: se falhar, o catálogo abre do mesmo jeito.
      api("chacara_pagina", "select=titulo,chamada,fotos&id=eq.1").catch(function () { return []; })
    ]).then(function (r) {
      var precos = {};
      r[3].forEach(function (x) { precos[x.id] = x.preco; });
      r[2].forEach(function (p) { p.preco = p.id in precos ? precos[p.id] : null; });
      return { configuracoes: r[0][0], categorias: r[1], produtos: r[2], chacara: r[4][0] || null };
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
    // A categoria da chácara tem página própria: sai da lista e vira um botão.
    var catChacara = cats.filter(function (c) { return c.tipo === CHACARA; })[0];
    chacara = catChacara ? { cat: catChacara, pagina: d.chacara || {} } : null;
    cats = cats.filter(function (c) { return c.tipo !== CHACARA; });
    var posCat = {};
    cats.forEach(function (c, i) { posCat[c.id] = i; c.chave = String(c.id); });
    var gal = cats.filter(function (c) { return c.tipo === GALERIA; })[0];
    // Cópia de reserva antiga: as fotos de inspiração ainda vinham numa lista separada.
    if (gal && d.inspiracoes && d.inspiracoes.length) {
      d.produtos = d.produtos.concat(d.inspiracoes.map(function (x) {
        return { id: x.id, categoria_id: gal.id, nome: "Decoração completa", descricao: x.legenda || "", imagem: x.imagem, ordem: x.ordem, codigo: null, preco: null };
      }));
    }
    prods = d.produtos.filter(function (p) { return p.ativo !== false && p.categoria_id in posCat; })
      .sort(function (a, b) { return posCat[a.categoria_id] - posCat[b.categoria_id] || a.ordem - b.ordem; });
    porId = {};
    prods.forEach(function (p) { porId[p.id] = p; });
    // As inspirações são os produtos da categoria do tipo "galeria".
    insp = prods.filter(function (p) { return gal && p.categoria_id === gal.id; });
    // Remove do orçamento itens que saíram do catálogo.
    Object.keys(cart).forEach(function (k) { if (!porId[k]) delete cart[k]; });
    salvarCarrinho();
  }

  // Código com 3 dígitos: 7 -> "007".
  function cod(p) {
    return p.codigo == null ? "" : String(p.codigo).padStart(3, "0");
  }

  function catPorId(id) {
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return null;
  }

  function chips() {
    var botao = function (chave, nome, extra) {
      var on = cat === chave;
      return '<button class="chip' + (on ? " on" : "") + (extra || "") + '" data-c="' + esc(chave) + '" aria-pressed="' + on + '">' +
        "<span>" + esc(nome) + "</span></button>";
    };
    // "Todos" primeiro; logo abaixo, a galeria de inspirações (mesma cor das outras).
    var h = botao("Todos", "Todos");
    cats.forEach(function (c) { if (c.tipo === GALERIA) h += botao(c.chave, c.nome); });
    cats.forEach(function (c) { if (c.tipo !== GALERIA) h += botao(c.chave, c.nome); });
    $("#chips").innerHTML = h;
  }

  function ctlInterno(id, nomeItem) {
    var n = cart[id] || 0;
    if (!n) return '<button class="add" data-a="+" data-i="' + esc(id) + '">Adicionar ao orçamento</button>';
    return '<div class="qty"><button data-a="-" data-i="' + esc(id) + '" aria-label="Diminuir quantidade de ' + esc(nomeItem) + '">−</button>' +
      '<b aria-live="polite">' + n + '</b><button data-a="+" data-i="' + esc(id) + '" aria-label="Aumentar quantidade de ' + esc(nomeItem) + '">+</button></div>';
  }

  function ctl(id, nomeItem) {
    return '<div data-ctl="' + esc(id) + '">' + ctlInterno(id, nomeItem) + "</div>";
  }

  // Atualiza só o botão do produto (sem redesenhar a lista toda e sem pular a tela).
  function atualizarCartao(id) {
    var el = document.querySelector('[data-ctl="' + CSS.escape(id) + '"]');
    if (!el) return;
    var foco = el.contains(document.activeElement) ? document.activeElement.dataset.a : null;
    el.innerHTML = ctlInterno(id, porId[id].nome);
    var alvo = foco && (el.querySelector('[data-a="' + foco + '"]') || el.querySelector("button"));
    if (alvo) alvo.focus();
  }

  // "Cód. 001 · Quant: 2" (a quantidade só aparece se existir no dado).
  function codQuant(p) {
    var partes = [];
    if (cod(p)) partes.push("Cód. " + cod(p));
    if (p.quantidade != null) partes.push("Quant: " + esc(p.quantidade));
    return partes.length ? '<span class="cod">' + partes.join(" · ") + "</span>" : "";
  }

  function kit(p) { return p.kit_itens && p.kit_itens.length ? p.kit_itens : null; }

  // Lista "Vem neste kit" (o cliente escolhe o kit inteiro e escreve o que quer mudar).
  function kitHtml(p) {
    var k = kit(p);
    if (!k) return "";
    return '<div class="kit"><b>📦 Vem neste kit:</b><ul>' + k.map(function (x) {
      return "<li>" + esc(x.quantidade) + "x " + esc(x.nome) + "</li>";
    }).join("") + "</ul></div>";
  }

  function preco(p) {
    if (!conf.mostrar_precos || p.preco == null) return "";
    return '<span class="preco">' + Number(p.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) + "</span>";
  }

  function grid() {
    var c = cat === "Todos" ? null : catPorId(Number(cat));
    var aviso = reserva ? '<div class="aviso">Mostrando a última cópia salva do catálogo.</div>' : "";
    if (c && c.tipo === GALERIA) {
      // Foto grande (amplia ao tocar) + código, nome, legenda, preço e botão de orçamento.
      $("#grid").innerHTML = aviso + (insp.map(function (x, i) {
        var nome = x.nome + (cod(x) ? " (Cód. " + cod(x) + ")" : "");
        return '<div class="card"><button class="ins" data-z="' + i + '" aria-label="Ampliar foto: ' + esc(nome) + '">' +
          '<img src="' + esc(fotoUrl(x.imagem)) + '" alt="' + esc(nome + (x.descricao ? " – " + x.descricao : "")) + '" loading="lazy" decoding="async"></button>' +
          '<div class="body">' + (cod(x) ? '<span class="cod">Cód. ' + cod(x) + "</span>" : "") + "<h3>" + esc(x.nome) + "</h3>" +
          (x.descricao ? "<p>" + esc(x.descricao) + "</p>" : "") + kitHtml(x) + preco(x) + ctl(x.id, x.nome) + "</div></div>";
      }).join("") || '<div class="empty">Nenhuma foto ainda.</div>');
      return;
    }
    var t = q.trim().toLowerCase();
    var h = !c && !t ? bannerChacara() + destaqueInspiracoes() : "";
    var ultimaCat = null;
    prods.forEach(function (p) {
      var pc = catPorId(p.categoria_id);
      // Inspirações não entram em "Todos" (têm a faixa própria), só na busca.
      if (!pc || (pc.tipo === GALERIA && !t)) return;
      if (c && p.categoria_id !== c.id) return;
      if (t && (cod(p) + " " + p.nome + " " + p.descricao).toLowerCase().indexOf(t) < 0) return;
      // Em "Todos", um título antes de cada categoria.
      if (!c && pc !== ultimaCat) {
        ultimaCat = pc;
        h += '<h2 class="sec-tit">' + esc(pc.nome) + "</h2>";
      }
      var foto = fotoUrl(p.imagem);
      h += '<div class="card"><div class="tile">' +
        (foto ? '<img src="' + esc(foto) + '" alt="' + esc(p.nome) + '" loading="lazy" decoding="async" width="230" height="170">'
              : '<span role="img" aria-label="Produto sem foto">📷</span>') +
        // O nome da categoria só aparece na busca (fora dela, o título da seção já mostra).
        '</div><div class="body">' + (t ? '<span class="cat">' + esc(pc.nome) + "</span>" : "") +
        codQuant(p) + "<h3>" + esc(p.nome) + "</h3><p>" +
        esc(p.descricao) + "</p>" + kitHtml(p) + preco(p) + ctl(p.id, p.nome) + "</div></div>";
    });
    $("#grid").innerHTML = aviso + (h || '<div class="empty">Nenhum item encontrado.</div>');
  }

  // Faixa com a chácara, no começo de "Todos": leva para a página do aluguel.
  function bannerChacara() {
    if (!chacara) return "";
    var pg = chacara.pagina || {};
    var foto = pg.fotos && pg.fotos[0] && pg.fotos[0].imagem;
    return '<a class="banner-chacara" href="/chacara/">' +
      (foto ? '<img src="' + esc(fotoUrl(foto)) + '" alt="" loading="lazy" decoding="async">' : "") +
      '<span class="bc-texto"><small>🏡 ' + esc(chacara.cat.nome) + "</small><b>" + esc(pg.titulo || "Espaço Top Fest") + "</b>" +
      (pg.chamada ? "<span>" + esc(pg.chamada) + "</span>" : "") + '<em>Conhecer a chácara ›</em></span></a>';
  }

  // Faixa com fotos de festas montadas, no começo de "Todos".
  function destaqueInspiracoes() {
    var g = cats.filter(function (c) { return c.tipo === GALERIA; })[0];
    if (!g || !insp.length) return "";
    return '<section class="destaque" aria-labelledby="dest-tit">' +
      '<h2 id="dest-tit">' + esc(g.nome) + "</h2>" +
      "<p>Festas montadas com os nossos itens. Toque na foto para ampliar.</p>" +
      '<div class="fila">' + insp.slice(0, 10).map(function (x, i) {
        return '<button class="ins" data-z="' + i + '" aria-label="Ampliar foto de inspiração ' + (i + 1) + '">' +
          '<img src="' + esc(fotoUrl(x.imagem)) + '" alt="Inspiração de decoração ' + (i + 1) + '" loading="lazy" decoding="async" width="132" height="132"></button>';
      }).join("") + "</div>" +
      '<button class="ver-todas" data-c="' + esc(g.chave) + '">Ver todas as ' + insp.length + " fotos ›</button></section>";
  }

  // Botões "Tirar dúvidas": abrem o WhatsApp sem lista de itens.
  function linksDuvida() {
    var href = "https://wa.me/" + conf.whatsapp_orcamentos + "?text=" +
      encodeURIComponent("Olá! Vim pelo catálogo da Chácara Top Fest e gostaria de tirar uma dúvida." +
        (indicacao && programaIndicacao() ? "\n\nIndicação: código " + indicacao : ""));
    Array.prototype.forEach.call(document.querySelectorAll("[data-duvida]"), function (a) { a.href = href; });
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
    document.body.classList.toggle("com-carrinho", !!n);
    b.innerHTML = "<span>🛒 " + n + (n === 1 ? " item" : " itens") + ' no orçamento</span><span class="ver">Ver e enviar ›</span>';
  }

  function chg(id, d) {
    if (!porId[id]) return;
    cart[id] = (cart[id] || 0) + d;
    if (cart[id] <= 0) delete cart[id];
    salvarCarrinho();
    fab();
    atualizarCartao(id);
    if (!$("#ov").hidden) panel();
  }

  function msg() {
    var m = "Olá! Gostaria de um orçamento de locação dos itens abaixo:\n\n";
    Object.keys(cart).forEach(function (id) {
      var p = porId[id];
      m += "- " + cart[id] + "x " + (cod(p) ? "(Cód. " + cod(p) + ") " : "") + p.nome + "\n";
      (kit(p) || []).forEach(function (x) {
        m += "    • " + (Number(x.quantidade) || 1) * cart[id] + "x " + (x.codigo != null ? "(Cód. " + String(x.codigo).padStart(3, "0") + ") " : "") + x.nome + "\n";
      });
    });
    var n = nome.trim();
    if (n) m += "\nNome: " + n;
    if (data) m += "\nData do evento: " + data.split("-").reverse().join("/");
    if (obs.trim()) m += "\nObservações: " + obs.trim().replace(/\s*\n\s*/g, " ");
    if (programaIndicacao()) {
      if (indicacao) m += "\nIndicação: código " + indicacao;
      else if (indicadoPor.trim()) m += "\nIndicado por: " + indicadoPor.trim();
    }
    return m + "\n\nObrigado!";
  }

  function panel() {
    var ids = Object.keys(cart);
    var h = '<h2 id="ptitle">Seu orçamento</h2>';
    if (!ids.length) h += '<p class="empty">Nenhum item ainda.</p>';
    ids.forEach(function (id) {
      var p = porId[id];
      h += '<div class="row"><span>' + (cod(p) ? '<small class="cod">Cód. ' + cod(p) + "</small> " : "") + esc(p.nome) +
        (kit(p) ? '<small class="kit-n">📦 kit com ' + kit(p).length + (kit(p).length === 1 ? " item" : " itens") + "</small>" : "") + '</span><div class="qty">' +
        '<button data-a="-" data-i="' + esc(id) + '" aria-label="Diminuir quantidade de ' + esc(p.nome) + '">−</button><b>' + cart[id] + "</b>" +
        '<button data-a="+" data-i="' + esc(id) + '" aria-label="Aumentar quantidade de ' + esc(p.nome) + '">+</button></div></div>';
    });
    h += '<label class="f">Seu nome<input id="nm" autocomplete="name" value="' + esc(nome) + '"></label>' +
      '<label class="f">Data do evento<input id="dt" type="date" value="' + esc(data) + '"></label>' +
      '<label class="f">' + (ids.some(function (id) { return kit(porId[id]); }) ? "Quer mudar algo no kit? Escreva aqui (opcional)" : "Observações (opcional)") +
      '<textarea id="obs" rows="2" maxlength="500">' + esc(obs) + "</textarea></label>" +
      blocoIndicacao() +
      '<a id="send" class="' + (ids.length ? "" : "off") + '" target="_blank" rel="noopener" href="#">Enviar orçamento pelo WhatsApp</a>' +
      '<div class="sec"><button data-a="x">Continuar escolhendo</button><button data-a="clr">Limpar</button></div>';
    $("#panel").innerHTML = h;
    upd();
  }

  // Quem chegou pelo link de um cliente vê o aviso do desconto; os outros podem dizer quem indicou.
  function blocoIndicacao() {
    if (!programaIndicacao()) return "";
    var pct = Number(conf.indicacao_desconto_pct) || 0;
    if (indicacao) {
      return '<p class="indic">🎁 Você chegou pela indicação de um cliente nosso' +
        (pct ? " e ganha <b>" + pct + "% de desconto</b> na sua primeira locação" : "") + ".</p>";
    }
    return '<label class="f">Quem te indicou? (opcional)<input id="ind" autocomplete="off" maxlength="80" value="' + esc(indicadoPor) + '"></label>';
  }

  // Botão "Compartilhar catálogo": usa o compartilhar do celular; sem ele, abre o WhatsApp.
  function compartilhar() {
    var url = location.origin + "/";
    var texto = "Olha o catálogo de decoração para locação da Chácara Top Fest:";
    if (navigator.share) {
      navigator.share({ title: document.title, text: texto, url: url }).catch(function () { /* cancelado */ });
    } else {
      window.open("https://wa.me/?text=" + encodeURIComponent(texto + " " + url), "_blank", "noopener");
    }
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

  // Foto ampliada das inspirações: setas para passar, botão "Voltar" para sair.
  var fotoAtual = -1;
  var origemFoto = null;

  function mostrarFoto(i) {
    if (!insp.length) return;
    fotoAtual = (i + insp.length) % insp.length;
    var x = insp[fotoAtual];
    var nome = x.nome + (cod(x) ? " (Cód. " + cod(x) + ")" : "");
    var varias = insp.length > 1;
    $("#lb").innerHTML =
      '<div class="lb-topo"><button class="lb-voltar" data-lb="fechar" aria-label="Voltar ao catálogo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg> Voltar</button></div>' +
      '<div class="lb-foto"><img src="' + esc(fotoUrl(x.imagem)) + '" alt="' + esc(nome) + '"></div>' +
      '<p class="lb-nome">' + esc(nome) + (x.descricao ? "<small>" + esc(x.descricao) + "</small>" : "") +
      (kit(x) ? '<small class="lb-kit">📦 ' + kit(x).map(function (k) { return esc(k.quantidade) + "x " + esc(k.nome); }).join(" · ") + "</small>" : "") + "</p>" +
      // Setas numa barra abaixo da foto, para não cobrir a imagem.
      '<div class="lb-nav">' +
      (varias ? '<button class="lb-seta" data-lb="ant" aria-label="Foto anterior">‹</button>' : "<span></span>") +
      '<span class="lb-cont">' + (fotoAtual + 1) + " de " + insp.length + "</span>" +
      (varias ? '<button class="lb-seta" data-lb="prox" aria-label="Próxima foto">›</button>' : "<span></span>") +
      "</div>";
    // Já carrega a próxima foto para a troca ser rápida.
    if (varias) new Image().src = fotoUrl(insp[(fotoAtual + 1) % insp.length].imagem);
  }

  function abrirFoto(i, origem) {
    origemFoto = origem;
    mostrarFoto(i);
    $("#lb").hidden = false;
    document.body.style.overflow = "hidden";
    var v = $("#lb .lb-voltar");
    if (v) v.focus();
  }

  function fecharFoto() {
    $("#lb").hidden = true;
    $("#lb").innerHTML = "";
    fotoAtual = -1;
    document.body.style.overflow = "";
    if (origemFoto && document.contains(origemFoto)) origemFoto.focus();
  }

  // No celular: arrastar o dedo para o lado troca a foto.
  var toqueX = null, toqueY = null;
  $("#lb").addEventListener("touchstart", function (e) {
    toqueX = e.touches[0].clientX;
    toqueY = e.touches[0].clientY;
  }, { passive: true });
  $("#lb").addEventListener("touchend", function (e) {
    if (toqueX === null) return;
    var dx = e.changedTouches[0].clientX - toqueX;
    var dy = e.changedTouches[0].clientY - toqueY;
    toqueX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) mostrarFoto(fotoAtual + (dx < 0 ? 1 : -1));
  });

  document.addEventListener("click", function (e) {
    var z = e.target.closest("[data-z]");
    if (z) { abrirFoto(Number(z.dataset.z), z); return; }
    if (e.target.closest("#lb")) {
      var b = e.target.closest("[data-lb]");
      if (b && b.dataset.lb === "ant") mostrarFoto(fotoAtual - 1);
      else if (b && b.dataset.lb === "prox") mostrarFoto(fotoAtual + 1);
      else if ((b && b.dataset.lb === "fechar") || e.target.id === "lb") fecharFoto();
      return;
    }
    var t = e.target.closest("[data-a],[data-c]");
    if (!t) { if (e.target.id === "ov") fecharPainel(); return; }
    if (t.dataset.c) {
      cat = t.dataset.c;
      chips();
      grid();
      // Volta para o começo da lista da categoria escolhida.
      var topo = $(".layout").getBoundingClientRect().top + window.pageYOffset - $(".busca").offsetHeight;
      if (window.pageYOffset > topo) window.scrollTo(0, topo);
      return;
    }
    var a = t.dataset.a;
    if (a === "+") chg(t.dataset.i, 1);
    else if (a === "-") chg(t.dataset.i, -1);
    else if (a === "x") fecharPainel();
    else if (a === "clr") {
      var ids = Object.keys(cart);
      cart = {};
      salvarCarrinho();
      fab();
      ids.forEach(atualizarCartao);
      panel();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!$("#lb").hidden) {
      if (e.key === "ArrowLeft") mostrarFoto(fotoAtual - 1);
      else if (e.key === "ArrowRight") mostrarFoto(fotoAtual + 1);
      else if (e.key === "Escape") fecharFoto();
      return;
    }
    if (e.key === "Escape" && !$("#ov").hidden) fecharPainel();
  });

  $("#fab").addEventListener("click", abrirPainel);
  $("#compartilhar").addEventListener("click", compartilhar);

  // Botão ☰: esconde ou mostra a coluna de categorias.
  // Ao entrar no site a coluna sempre aparece, para o cliente saber que ela existe.
  function mostrarCategorias(mostrar) {
    document.body.classList.toggle("sem-categorias", !mostrar);
    var b = $("#ver-cats");
    b.setAttribute("aria-expanded", String(mostrar));
    b.setAttribute("aria-label", mostrar ? "Esconder categorias" : "Mostrar categorias");
  }
  try { localStorage.removeItem("topfest-sem-categorias"); } catch (e) { /* sem armazenamento */ }
  mostrarCategorias(true);

  // A coluna de categorias ocupa só o espaço visível da tela (abaixo do cabeçalho
  // e acima do botão do orçamento), para dar para rolar até a última categoria.
  var ajustePendente = false;
  function ajustarAlturaCategorias() {
    ajustePendente = false;
    var ch = $("#chips");
    var topo = Math.max(ch.getBoundingClientRect().top, 0);
    var fabEl = $("#fab");
    var baixo = fabEl.hidden ? 0 : fabEl.offsetHeight;
    var alt = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - topo - baixo;
    ch.style.maxHeight = Math.max(alt, 160) + "px";
  }
  function pedirAjuste() {
    if (ajustePendente) return;
    ajustePendente = true;
    requestAnimationFrame(ajustarAlturaCategorias);
  }
  window.addEventListener("scroll", pedirAjuste, { passive: true });
  window.addEventListener("resize", pedirAjuste);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", pedirAjuste);
  new MutationObserver(pedirAjuste).observe($("#fab"), { attributes: true, attributeFilter: ["hidden"] });
  pedirAjuste();
  $("#ver-cats").addEventListener("click", function () {
    mostrarCategorias(document.body.classList.contains("sem-categorias"));
  });
  $("#q").addEventListener("input", function () {
    q = this.value;
    // A busca procura em todos os produtos.
    if (q && cat !== "Todos") { var c = catPorId(Number(cat)); if (c && c.tipo === GALERIA) { cat = "Todos"; chips(); } }
    grid();
  });
  $("#panel").addEventListener("input", function (e) {
    if (e.target.id === "nm") nome = e.target.value;
    if (e.target.id === "dt") data = e.target.value;
    if (e.target.id === "obs") obs = e.target.value;
    if (e.target.id === "ind") indicadoPor = e.target.value;
    upd();
  });

  carregarSupabase()
    .catch(carregarReserva)
    .then(function (d) {
      montar(d);
      linksDuvida(); chips(); grid(); fab(); pedirAjuste();
    })
    .catch(function () {
      $("#grid").innerHTML = '<div class="empty">Não foi possível carregar o catálogo agora. Tente novamente em alguns minutos.</div>';
    });
})();
