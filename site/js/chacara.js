/* Página da Chácara Top Fest (aluguel do espaço).
   Lê do Supabase (somente leitura, chave pública) o texto, as fotos e os pacotes,
   e monta o pedido de orçamento para o WhatsApp. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var INDICACAO = "topfest-indicacao";
  var DIAS_INDICACAO = 90;

  var conf = { whatsapp_orcamentos: "5519991616329", mostrar_precos: false };
  var pagina = { titulo: "Espaço Top Fest", chamada: "", descricao: "", endereco: "", mostrar_endereco: false, fotos: [] };
  var pacotes = [];
  var fotos = [];
  var indicacao = lerIndicacao();

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fotoUrl(caminho) {
    if (!caminho) return "";
    if (/^(https?:)?\/\//.test(caminho)) return caminho;
    return CFG.supabaseUrl + "/storage/v1/object/public/" + CFG.bucket + "/" + caminho.split("/").map(encodeURIComponent).join("/");
  }
  function cod(p) { return p.codigo == null ? "" : String(p.codigo).padStart(3, "0"); }
  function brl(n) { return Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  // Mesmo código de indicação guardado pelo catálogo (link ?ind=...).
  function lerIndicacao() {
    var g = null;
    try { g = JSON.parse(localStorage.getItem(INDICACAO)); } catch (e) { /* sem armazenamento */ }
    var params = new URLSearchParams(location.search);
    var novo = (params.get("ind") || "").trim().toUpperCase();
    if (params.has("ind")) {
      params.delete("ind");
      var resto = params.toString();
      try { history.replaceState(null, "", location.pathname + (resto ? "?" + resto : "") + location.hash); } catch (e) { /* ignora */ }
    }
    if (/^[A-Z0-9]{3,10}$/.test(novo)) {
      g = { c: novo, t: Date.now() };
      try { localStorage.setItem(INDICACAO, JSON.stringify(g)); } catch (e) { /* sem armazenamento */ }
    }
    if (!g || !/^[A-Z0-9]{3,10}$/.test(g.c) || !(Date.now() - g.t < DIAS_INDICACAO * 864e5)) return "";
    return g.c;
  }
  function programaIndicacao() { return conf.indicacao_ativa === true; }

  function api(tabela, consulta) {
    return fetch(CFG.supabaseUrl + "/rest/v1/" + tabela + "?" + consulta, { headers: { apikey: CFG.supabaseKey } })
      .then(function (r) { if (!r.ok) throw new Error(tabela + ": " + r.status); return r.json(); });
  }

  function carregar() {
    return Promise.all([
      api("configuracoes", "select=*&id=eq.1"),
      api("chacara_pagina", "select=*&id=eq.1"),
      api("categorias", "select=id&tipo=eq.chacara"),
      api("precos_publicos", "select=id,preco")
    ]).then(function (r) {
      if (r[0][0]) conf = r[0][0];
      if (r[1][0]) pagina = r[1][0];
      var precos = {};
      r[3].forEach(function (x) { precos[x.id] = x.preco; });
      var ids = r[2].map(function (c) { return c.id; });
      if (!ids.length) return [];
      return api("produtos", "select=id,codigo,nome,descricao,imagem,ordem&ativo=is.true&categoria_id=in.(" + ids.join(",") + ")&order=ordem,nome")
        .then(function (ps) {
          ps.forEach(function (p) { p.preco = p.id in precos ? precos[p.id] : null; });
          return ps;
        });
    }).then(function (ps) { pacotes = ps; });
  }

  // ---------- Texto: "* item" vira lista; uma linha antes de uma lista vira título de cartão ----------
  var ICONES = [
    [/lazer|piscina/i, "🏊"], [/gourmet|churras|cozinha/i, "🍖"], [/mobili|mesa|cadeira/i, "🪑"],
    [/casa|quarto|dormit/i, "🛏️"], [/conforto|seguran/i, "🛡️"], [/regra/i, "📋"], [/estrutura|comodidade/i, "🏡"]
  ];
  function comIcone(t) {
    if (/^[^\p{L}\p{N}]/u.test(t)) return t;  // já começa com emoji
    for (var i = 0; i < ICONES.length; i++) if (ICONES[i][0].test(t)) return ICONES[i][1] + " " + t;
    return t;
  }
  function eItem(l) { return /^[*•\-]\s+/.test(l); }

  function lerTexto(txt) {
    var linhas = String(txt || "").split(/\r?\n/).map(function (l) { return l.trim(); });
    var intro = [], blocos = [], atual = null;
    linhas.forEach(function (l, i) {
      if (!l) return;
      if (eItem(l)) {
        if (!atual) { atual = { titulo: "", itens: [], notas: [] }; blocos.push(atual); }
        atual.itens.push(l.replace(/^[*•\-]\s+/, ""));
        return;
      }
      var prox = "";
      for (var j = i + 1; j < linhas.length; j++) if (linhas[j]) { prox = linhas[j]; break; }
      if (eItem(prox)) {
        atual = { titulo: l.replace(/:\s*$/, ""), itens: [], notas: [] };
        blocos.push(atual);
      } else if (atual) atual.notas.push(l);
      else intro.push(l);
    });
    return { intro: intro, blocos: blocos };
  }

  function desenharTexto() {
    $("#titulo").textContent = pagina.titulo || "Espaço Top Fest";
    $("#chamada").textContent = pagina.chamada || "";
    if (pagina.titulo) document.title = pagina.titulo + (pagina.chamada ? " – " + pagina.chamada : "");
    var t = lerTexto(pagina.descricao);
    $("#intro").innerHTML = t.intro.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    $("#intro").hidden = !t.intro.length;
    $("#estrutura").innerHTML = t.blocos.map(function (b) {
      var regra = /regra|n[ãa]o permitido/i.test(b.titulo);
      return '<article class="cartao' + (regra ? " regra" : "") + '">' +
        (b.titulo ? "<h3>" + esc(comIcone(b.titulo)) + "</h3>" : "") +
        (b.itens.length ? "<ul>" + b.itens.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
        b.notas.map(function (n) { return '<p class="nota">' + esc(n) + "</p>"; }).join("") + "</article>";
    }).join("");
    $("#estrutura-sec").hidden = !t.blocos.length;

    if (pagina.endereco && pagina.mostrar_endereco) {
      $("#endereco").textContent = pagina.endereco;
      $("#mapa").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(pagina.endereco);
      $("#local-sec").hidden = false;
    }
  }

  // ---------- Fotos: carrossel no topo e galeria ----------
  function desenharFotos() {
    fotos = (pagina.fotos || []).filter(function (f) { return f && f.imagem; });
    var hero = $("#hero");
    hero.classList.toggle("sem-foto", !fotos.length);
    $("#slides").innerHTML = fotos.map(function (f, i) {
      return '<figure class="slide"><img src="' + esc(fotoUrl(f.imagem)) + '" alt="' + esc(f.legenda || "Foto da chácara " + (i + 1)) + '"' +
        (i ? ' loading="lazy"' : ' fetchpriority="high"') + ' decoding="async"></figure>';
    }).join("");
    var varias = fotos.length > 1;
    hero.querySelectorAll(".seta").forEach(function (b) { b.hidden = !varias; });
    $("#pontos").innerHTML = varias ? fotos.map(function (f, i) {
      return '<button type="button" data-p="' + i + '" aria-label="Foto ' + (i + 1) + '"' + (i ? "" : ' aria-current="true"') + "></button>";
    }).join("") : "";
    $("#galeria").innerHTML = fotos.map(function (f, i) {
      return '<button type="button" class="mini" data-z="' + i + '" aria-label="Ampliar: ' + esc(f.legenda || "foto " + (i + 1)) + '">' +
        '<img src="' + esc(fotoUrl(f.imagem)) + '" alt="" loading="lazy" decoding="async">' +
        (f.legenda ? "<span>" + esc(f.legenda) + "</span>" : "") + "</button>";
    }).join("");
    $("#galeria-sec").hidden = !fotos.length;
  }

  function slideAtual() {
    var s = $("#slides");
    return s.clientWidth ? Math.round(s.scrollLeft / s.clientWidth) : 0;
  }
  function irSlide(i) {
    var s = $("#slides");
    var n = fotos.length;
    if (!n) return;
    i = (i + n) % n;
    s.scrollTo({ left: i * s.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  $("#slides").addEventListener("scroll", function () {
    var i = slideAtual();
    document.querySelectorAll("#pontos button").forEach(function (b, k) {
      if (k === i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }, { passive: true });

  // ---------- Pacotes ----------
  function desenharPacotes() {
    $("#pacotes").innerHTML = pacotes.map(function (p) {
      var pr = conf.mostrar_precos && p.preco != null ? '<p class="preco">' + brl(p.preco) + "</p>" : "";
      return '<article class="pacote">' + (p.imagem ? '<img src="' + esc(fotoUrl(p.imagem)) + '" alt="" loading="lazy">' : "") +
        "<div><h3>" + esc(p.nome) + "</h3>" + (p.descricao ? "<p>" + esc(p.descricao) + "</p>" : "") + pr +
        '<a class="botao" href="#orcamento" data-pacote="' + esc(p.id) + '">Quero este pacote</a></div></article>';
    }).join("");
    $("#pacotes-sec").hidden = !pacotes.length;

    var campo = $("#campo-pacote");
    if (pacotes.length > 1) {
      campo.innerHTML = '<label>Pacote<select id="pacote">' + pacotes.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.nome) + "</option>";
      }).join("") + "</select></label>";
    } else if (pacotes.length === 1) {
      campo.innerHTML = '<p class="pacote-unico">Pacote: <b>' + esc(pacotes[0].nome) + "</b></p>";
    } else campo.innerHTML = "";
  }

  function pacoteEscolhido() {
    var sel = $("#pacote");
    var id = sel ? sel.value : pacotes[0] && pacotes[0].id;
    return pacotes.filter(function (p) { return p.id === id; })[0] || null;
  }

  // ---------- Datas e mensagem ----------
  function hoje() { return new Date().toLocaleDateString("sv-SE"); }
  function dataLonga(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { weekday: "long" }) + ", " + iso.split("-").reverse().join("/");
  }
  function dias(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5) + 1; }

  function blocoIndicacao() {
    if (!programaIndicacao()) return "";
    if (indicacao) {
      var pct = Number(conf.indicacao_desconto_pct) || 0;
      return '<p class="indic">🎁 Você chegou pela indicação de um cliente nosso' +
        (pct ? " e ganha <b>" + pct + "% de desconto</b> na sua primeira locação" : "") + ".</p>";
    }
    return '<label>Quem te indicou? (opcional)<input id="ind" autocomplete="off" maxlength="80"></label>';
  }

  function validar() {
    var e = $("#entrada").value, s = $("#saida").value;
    if (!e || !s) return { ok: false, msg: "Preencha a data de entrada e a de saída." };
    if (e < hoje()) return { ok: false, msg: "A data de entrada já passou." };
    if (s < e) return { ok: false, msg: "A data de saída é antes da entrada." };
    return { ok: true };
  }

  function mensagem() {
    var p = pacoteEscolhido();
    var e = $("#entrada").value, s = $("#saida").value;
    var m = "Olá! Gostaria de um orçamento para alugar a chácara (" + (pagina.titulo || "Espaço Top Fest") + "):\n\n";
    if (p) m += "- 1x " + (cod(p) ? "(Cód. " + cod(p) + ") " : "") + p.nome + "\n\n";
    m += "Entrada: " + dataLonga(e) + "\nSaída: " + dataLonga(s);
    var tipo = $("#tipo").value, conv = $("#convidados").value.trim();
    if (tipo) m += "\nTipo de evento: " + tipo;
    if (conv) m += "\nConvidados: " + conv;
    var nome = $("#nome").value.trim(), obs = $("#obs").value.trim();
    if (nome) m += "\n\nNome: " + nome;
    if (obs) m += (nome ? "" : "\n") + "\nObservações: " + obs.replace(/\s*\n\s*/g, " ");
    if (programaIndicacao()) {
      var ind = $("#ind");
      if (indicacao) m += "\nIndicação: código " + indicacao;
      else if (ind && ind.value.trim()) m += "\nIndicado por: " + ind.value.trim();
    }
    return m + "\n\nObrigado!";
  }

  function atualizar() {
    var e = $("#entrada").value, s = $("#saida").value;
    if (e) $("#saida").min = e;
    var v = validar();
    var per = $("#periodo");
    if (e && s && s >= e) {
      var n = dias(e, s);
      per.textContent = "📅 " + dataLonga(e) + " até " + dataLonga(s) + " · " + n + (n === 1 ? " dia" : " dias");
      per.className = "periodo ok";
    } else {
      per.textContent = e && s ? v.msg : "";
      per.className = "periodo" + (e && s ? " erro" : "");
    }
    var a = $("#enviar");
    a.classList.toggle("off", !v.ok);
    a.setAttribute("aria-disabled", String(!v.ok));
    a.href = v.ok ? "https://wa.me/" + conf.whatsapp_orcamentos + "?text=" + encodeURIComponent(mensagem()) : "#";
    $("#dica-enviar").textContent = v.ok ? "" : v.msg;
  }

  $("#form").addEventListener("input", atualizar);
  $("#form").addEventListener("change", atualizar);
  $("#enviar").addEventListener("click", function (ev) {
    if (this.classList.contains("off")) { ev.preventDefault(); ($("#entrada").value ? $("#saida") : $("#entrada")).focus(); }
  });

  function linksDuvida() {
    var href = "https://wa.me/" + conf.whatsapp_orcamentos + "?text=" + encodeURIComponent(
      "Olá! Vi a página da chácara (" + (pagina.titulo || "Espaço Top Fest") + ") e gostaria de tirar uma dúvida." +
      (indicacao && programaIndicacao() ? "\n\nIndicação: código " + indicacao : ""));
    document.querySelectorAll("[data-duvida]").forEach(function (a) { a.href = href; });
  }

  // ---------- Foto ampliada ----------
  var atualFoto = -1, origem = null;
  function mostrarFoto(i) {
    var n = fotos.length;
    atualFoto = (i + n) % n;
    var f = fotos[atualFoto];
    $("#lb").innerHTML = '<div class="lb-topo"><button class="lb-voltar" data-lb="fechar">‹ Voltar</button><span>' + (atualFoto + 1) + " de " + n + "</span></div>" +
      '<div class="lb-foto"><img src="' + esc(fotoUrl(f.imagem)) + '" alt="' + esc(f.legenda || "") + '"></div>' +
      (f.legenda ? '<p class="lb-leg">' + esc(f.legenda) + "</p>" : "") +
      (n > 1 ? '<div class="lb-nav"><button data-lb="ant" aria-label="Foto anterior">‹</button><button data-lb="prox" aria-label="Próxima foto">›</button></div>' : "");
  }
  function abrirFoto(i, el) {
    origem = el;
    mostrarFoto(i);
    $("#lb").hidden = false;
    document.body.style.overflow = "hidden";
    $("#lb .lb-voltar").focus();
  }
  function fecharFoto() {
    $("#lb").hidden = true;
    $("#lb").innerHTML = "";
    document.body.style.overflow = "";
    if (origem) origem.focus();
  }
  var tx = null, ty = null;
  $("#lb").addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  $("#lb").addEventListener("touchend", function (e) {
    if (tx === null) return;
    var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    tx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) mostrarFoto(atualFoto + (dx < 0 ? 1 : -1));
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-s],[data-p],[data-z],[data-lb],[data-pacote]");
    if (!b) { if (e.target.id === "lb") fecharFoto(); return; }
    if (b.dataset.s) irSlide(slideAtual() + Number(b.dataset.s));
    else if (b.dataset.p) irSlide(Number(b.dataset.p));
    else if (b.dataset.z) abrirFoto(Number(b.dataset.z), b);
    else if (b.dataset.pacote) { var sel = $("#pacote"); if (sel) { sel.value = b.dataset.pacote; atualizar(); } }
    else if (b.dataset.lb === "ant") mostrarFoto(atualFoto - 1);
    else if (b.dataset.lb === "prox") mostrarFoto(atualFoto + 1);
    else if (b.dataset.lb === "fechar") fecharFoto();
  });
  document.addEventListener("keydown", function (e) {
    if ($("#lb").hidden) return;
    if (e.key === "ArrowLeft") mostrarFoto(atualFoto - 1);
    else if (e.key === "ArrowRight") mostrarFoto(atualFoto + 1);
    else if (e.key === "Escape") fecharFoto();
  });

  // Botão flutuante "Pedir orçamento": some quando o formulário está na tela.
  if ("IntersectionObserver" in window) {
    var visiveis = {};
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (x) { visiveis[x.target.id] = x.isIntersecting; });
      $("#flutua").classList.toggle("some", !!(visiveis.orcamento || visiveis.hero));
    });
    obs.observe($("#orcamento"));
    obs.observe($("#hero"));
  }

  $("#entrada").min = hoje();
  $("#saida").min = hoje();

  var falhou = false;
  carregar().catch(function (e) {
    console.error(e);
    falhou = true;
  }).then(function () {
    desenharTexto();
    if (falhou) {
      $("#intro").innerHTML = '<p class="falha">Não foi possível carregar todas as informações agora. Tente de novo em alguns minutos ou fale com a gente pelo WhatsApp.</p>';
      $("#intro").hidden = false;
    }
    desenharFotos();
    desenharPacotes();
    $("#indicacao").innerHTML = blocoIndicacao();
    linksDuvida();
    atualizar();
  });
})();
