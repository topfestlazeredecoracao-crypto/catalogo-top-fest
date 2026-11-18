/* Relatório de produtos (código, categoria, nome e valor) para imprimir ou salvar em PDF.
   Só abre para a administradora logada. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var folha = document.getElementById("folha");
  var fCat = document.getElementById("f-cat");
  var fOrdem = document.getElementById("f-ordem");
  var fSit = document.getElementById("f-situacao");
  var fConf = document.getElementById("f-conferir");
  var dados = { cats: [], prods: [], conf: {} };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cod(n) { return n == null ? "" : String(n).padStart(3, "0"); }
  function brl(n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  function erro(texto) { folha.innerHTML = '<p class="msg">' + esc(texto) + "</p>"; }

  function montar() {
    var catId = Number(fCat.value) || null;
    var ordem = fOrdem.value, sit = fSit.value, conferir = fConf.checked;
    var catPorId = {}, posCat = {};
    dados.cats.forEach(function (c, i) { catPorId[c.id] = c; posCat[c.id] = i; });

    var lista = dados.prods.filter(function (p) {
      if (!catPorId[p.categoria_id]) return false;            // galeria de inspirações fica de fora
      if (catId && p.categoria_id !== catId) return false;
      if (sit === "ativos" && !p.ativo) return false;
      if (sit === "ocultos" && p.ativo) return false;
      return true;
    }).sort(function (a, b) {
      if (ordem === "codigo") return a.codigo - b.codigo;
      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      return posCat[a.categoria_id] - posCat[b.categoria_id] || a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR");
    });

    var semValor = lista.filter(function (p) { return p.preco == null; }).length;
    var ocultos = lista.filter(function (p) { return !p.ativo; }).length;
    var filtros = [
      catId ? "Categoria: " + catPorId[catId].nome : "Todas as categorias",
      fSit.options[fSit.selectedIndex].text,
      "Ordem: " + fOrdem.options[fOrdem.selectedIndex].text
    ];

    var linhas = lista.map(function (p) {
      return "<tr" + (p.ativo ? "" : ' class="oculto"') + ">" +
        '<td class="c">' + esc(cod(p.codigo)) + "</td>" +
        "<td>" + esc(catPorId[p.categoria_id].nome) + "</td>" +
        "<td>" + esc(p.nome) + (p.ativo ? "" : ' <span class="selo">oculto</span>') + "</td>" +
        '<td class="n">' + (p.preco == null ? '<span class="sem">—</span>' : brl(p.preco)) + "</td>" +
        (conferir ? '<td class="conf"><span class="caixinha"></span></td>' : "") +
        "</tr>";
    }).join("");

    document.title = "Relatório de produtos – " + new Date().toLocaleDateString("pt-BR");
    folha.innerHTML =
      '<header class="cab"><img src="../img/logo.png" alt="Chácara Top Fest"><div>' +
      "<h1>TOP FEST DECORAÇÕES</h1><p>" + esc(dados.conf.slogan || "") + "</p></div></header>" +
      '<div class="tit"><h2>Relatório de produtos</h2><span>Emitido em ' +
      new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + "</span></div>" +
      '<p class="filtros-rel">' + esc(filtros.join(" · ")) + "</p>" +
      (lista.length
        ? "<table><thead><tr>" +
          '<th class="c">Cód.</th><th>Categoria</th><th>Nome</th><th class="n">Valor</th>' +
          (conferir ? '<th class="conf">Conf.</th>' : "") +
          "</tr></thead><tbody>" + linhas + "</tbody></table>"
        : '<p class="msg">Nenhum produto com esses filtros.</p>') +
      '<div class="resumo"><span><b>' + lista.length + "</b> produto(s)</span>" +
      (ocultos ? "<span><b>" + ocultos + "</b> oculto(s) no site</span>" : "") +
      (semValor ? "<span><b>" + semValor + "</b> sem valor cadastrado</span>" : "") + "</div>" +
      (conferir ? '<div class="assinaturas"><div><span></span>Conferido por</div><div><span></span>Data</div></div>' : "");
    document.getElementById("imprimir").disabled = false;
  }

  document.getElementById("imprimir").addEventListener("click", function () { window.print(); });
  [fCat, fOrdem, fSit, fConf].forEach(function (el) { el.addEventListener("change", montar); });

  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { erro("Entre na área da administradora primeiro e depois abra o relatório de novo."); return; }
    return Promise.all([
      sb.from("categorias").select("*").order("ordem").order("id"),
      sb.from("produtos").select("id, codigo, categoria_id, nome, preco, ativo, ordem"),
      sb.from("configuracoes").select("*").eq("id", 1).single()
    ]).then(function (res) {
      res.forEach(function (x) { if (x.error) throw x.error; });
      dados.cats = res[0].data.filter(function (c) { return c.tipo !== "galeria"; });
      dados.prods = res[1].data;
      dados.conf = res[2].data || {};
      fCat.innerHTML += dados.cats.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.nome) + "</option>";
      }).join("");
      // Começa com o mesmo filtro de categoria que estava na tela de produtos.
      var q = new URLSearchParams(location.search).get("cat");
      if (q && dados.cats.some(function (c) { return String(c.id) === q; })) fCat.value = q;
      montar();
    });
  }).catch(function (e) {
    console.error(e);
    erro("Não foi possível carregar os produtos. Verifique a internet e tente de novo.");
  });
})();
