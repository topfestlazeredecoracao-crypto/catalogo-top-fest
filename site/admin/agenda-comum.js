/* Agenda: regras de período e montagem dos relatórios.
   Usado no painel (aba Agenda e aviso no orçamento) e na página agenda.html (impressão). */
(function () {
  "use strict";

  var SIT = { aberto: "Em aberto", aprovado: "Aprovado", cancelado: "Cancelado" };
  var MAX_DIAS = 400;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cod(n) { return n == null ? "" : String(n).padStart(3, "0"); }
  function dataBR(iso) { return iso ? iso.split("-").reverse().join("/") : ""; }
  function curta(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : ""; }
  function semana(iso) {
    return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long" });
  }
  function somaDias(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("sv-SE");
  }
  function telBR(d) {
    d = String(d || "").replace(/\D/g, "");
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return d;
  }

  // Período em que os itens ficam fora: da retirada até a devolução.
  // Sem essas datas, usa a data do evento.
  function periodo(o) {
    var ds = [o.data_retirada, o.data_evento, o.data_devolucao].filter(Boolean).sort();
    return ds.length ? { ini: ds[0], fim: ds[ds.length - 1] } : null;
  }
  function sobrepoe(a, b) { return !!(a && b && a.ini <= b.fim && b.ini <= a.fim); }
  function dias(p) {
    var r = [], d = p.ini;
    while (d <= p.fim && r.length < MAX_DIAS) { r.push(d); d = somaDias(d, 1); }
    return r;
  }
  function textoPeriodo(p) {
    if (!p) return "sem data";
    return p.ini === p.fim ? dataBR(p.ini) : dataBR(p.ini) + " a " + dataBR(p.fim);
  }

  function qtdProduto(o, produtoId) {
    return (o.itens || []).reduce(function (s, it) {
      return s + (it.produto_id === produtoId ? Number(it.quantidade) || 0 : 0);
    }, 0);
  }

  // Reservas de um produto que encostam no período p, e o dia de maior uso.
  function reservas(orcs, produtoId, p) {
    var quem = [];
    orcs.forEach(function (o) {
      var q = qtdProduto(o, produtoId), po = periodo(o);
      if (q && sobrepoe(po, p)) quem.push({ o: o, q: q, p: po });
    });
    var max = 0, dia = null;
    if (quem.length) dias(p).forEach(function (d) {
      var s = 0;
      quem.forEach(function (x) { if (x.p.ini <= d && d <= x.p.fim) s += x.q; });
      if (s > max) { max = s; dia = d; }
    });
    return { quem: quem, max: max, dia: dia };
  }

  function estoque(p) { return p && p.quantidade != null ? Number(p.quantidade) : 1; }

  // ---------- Relatórios ----------
  // d = { orcs, clientes, prods }; f = { de, ate, sit: "ativos" | "aprovados", ver: "dia" | "clientes" | "produtos" }
  function filtrar(d, f) {
    var janela = { ini: f.de, fim: f.ate };
    return d.orcs.filter(function (o) {
      if (o.situacao === "cancelado") return false;
      if (f.sit === "aprovados" && o.situacao !== "aprovado") return false;
      return sobrepoe(periodo(o), janela);
    }).sort(function (a, b) {
      var pa = periodo(a), pb = periodo(b);
      return pa.ini < pb.ini ? -1 : pa.ini > pb.ini ? 1 : a.numero - b.numero;
    });
  }

  function ajudantes(d) {
    var cli = {};
    d.clientes.forEach(function (c) { cli[c.id] = c; });
    return {
      cliente: function (o) { return cli[o.cliente_id] || null; },
      nome: function (o) { var c = cli[o.cliente_id]; return c ? c.nome : o.cliente_nome || "Cliente sem nome"; }
    };
  }

  function itensHtml(o) {
    var l = (o.itens || []).map(function (it) {
      return "<li>" + esc(it.quantidade) + "x " + (it.codigo != null ? '<span class="cod">' + cod(it.codigo) + "</span> " : "") +
        esc(it.nome) + (it.tipo === "servico" ? " <i>(serviço)</i>" : "") + "</li>";
    });
    return l.length ? '<ul class="ag-itens">' + l.join("") + "</ul>" : "—";
  }

  function selo(o) { return '<span class="ag-sit ag-' + esc(o.situacao) + '">' + esc(SIT[o.situacao] || o.situacao) + "</span>"; }

  function clienteHtml(o, h, comEndereco) {
    var c = h.cliente(o);
    var linhas = ["<b>" + esc(h.nome(o)) + "</b>"];
    if (c && c.whatsapp) linhas.push(esc(telBR(c.whatsapp)));
    if (comEndereco && c) {
      var end = [c.endereco, c.bairro, c.cidade].filter(Boolean).join(", ");
      if (end) linhas.push('<span class="ag-end">' + esc(end) + "</span>");
    }
    return linhas.join("<br>");
  }

  function porDia(lista, f, h) {
    var html = "", d = f.de, n = 0;
    var TIPOS = [
      ["data_retirada", "🚚 Retirada / entrega", "ret"],
      ["data_evento", "🎉 Evento", "evt"],
      ["data_devolucao", "↩️ Devolução", "dev"]
    ];
    while (d <= f.ate && n++ < MAX_DIAS) {
      var linhas = [];
      TIPOS.forEach(function (t) {
        lista.forEach(function (o) {
          if (o[t[0]] !== d) return;
          linhas.push('<tr class="ag-' + t[2] + '"><td class="ag-tipo">' + t[1] + "</td><td>" + clienteHtml(o, h, t[2] !== "evt") + "</td>" +
            '<td class="c">nº ' + esc(o.numero) + "<br>" + selo(o) + "</td><td>" + itensHtml(o) + "</td></tr>");
        });
      });
      if (linhas.length) {
        html += '<section class="ag-dia"><h3>' + esc(semana(d)) + ", " + dataBR(d) + "</h3>" +
          '<div class="ag-tab"><table><thead><tr><th>O quê</th><th>Cliente</th><th>Orçamento</th><th>Itens</th></tr></thead><tbody>' +
          linhas.join("") + "</tbody></table></div></section>";
      }
      d = somaDias(d, 1);
    }
    return html;
  }

  function clientes(lista, h) {
    return '<div class="ag-tab"><table><thead><tr><th>Cliente</th><th>Orçamento</th><th>Retirada</th><th>Evento</th><th>Devolução</th><th>Itens</th></tr></thead><tbody>' +
      lista.map(function (o) {
        return "<tr><td>" + clienteHtml(o, h, true) + '</td><td class="c">nº ' + esc(o.numero) + "<br>" + selo(o) + "</td>" +
          '<td class="c">' + (dataBR(o.data_retirada) || "—") + '</td><td class="c">' + (dataBR(o.data_evento) || "—") +
          '</td><td class="c">' + (dataBR(o.data_devolucao) || "—") + "</td><td>" + itensHtml(o) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function produtos(lista, d, f, h) {
    var janela = { ini: f.de, fim: f.ate };
    var ids = {};
    lista.forEach(function (o) { (o.itens || []).forEach(function (it) { if (it.produto_id) ids[it.produto_id] = true; }); });
    var prods = d.prods.filter(function (p) { return ids[p.id]; }).sort(function (a, b) { return (a.codigo || 0) - (b.codigo || 0); });
    var faltas = 0;
    var linhas = prods.map(function (p) {
      var r = reservas(lista, p.id, janela);
      var tem = estoque(p), falta = r.max > tem;
      if (falta) faltas++;
      return "<tr" + (falta ? ' class="ag-falta"' : "") + '><td class="c">' + esc(cod(p.codigo)) + "</td><td><b>" + esc(p.nome) + "</b></td>" +
        '<td class="n">' + tem + "</td>" +
        '<td><ul class="ag-itens">' + r.quem.map(function (x) {
          return "<li>" + x.q + " un. · " + esc(textoPeriodo(x.p)) + " · " + esc(h.nome(x.o)) + " (nº " + esc(x.o.numero) + ", " + esc(SIT[x.o.situacao]) + ")</li>";
        }).join("") + "</ul></td>" +
        '<td class="n">' + r.max + (r.dia ? '<br><span class="ag-end">em ' + curta(r.dia) + "</span>" : "") +
        (falta ? '<br><b class="ag-alerta">⛔ faltam ' + (r.max - tem) + "</b>" : "") + "</td></tr>";
    });
    return (faltas ? '<p class="ag-alerta">⛔ ' + faltas + " produto(s) com mais reservas do que unidades em algum dia.</p>" : "") +
      '<div class="ag-tab"><table><thead><tr><th class="c">Cód.</th><th>Produto</th><th class="n">Quant</th><th>Reservas no período</th><th class="n">Máx. no mesmo dia</th></tr></thead><tbody>' +
      linhas.join("") + "</tbody></table></div>";
  }

  var TITULOS = { dia: "Programação por dia", clientes: "Clientes agendados", produtos: "Produtos agendados" };

  function montar(d, f) {
    if (!f.de || !f.ate || f.ate < f.de) return { titulo: TITULOS[f.ver], html: '<p class="msg">Escolha as datas "De" e "Até" (a segunda depois da primeira).</p>', total: 0 };
    var lista = filtrar(d, f), h = ajudantes(d);
    var corpo;
    if (!lista.length) corpo = '<p class="msg">Nenhum orçamento agendado nesse período.</p>';
    else if (f.ver === "clientes") corpo = clientes(lista, h);
    else if (f.ver === "produtos") corpo = produtos(lista, d, f, h);
    else corpo = porDia(lista, f, h);
    var resumo = '<p class="ag-resumo">' + dataBR(f.de) + " a " + dataBR(f.ate) + " · " +
      (f.sit === "aprovados" ? "só aprovados" : "aprovados e em aberto") + " · <b>" + lista.length + "</b> orçamento(s)</p>";
    return { titulo: TITULOS[f.ver] || TITULOS.dia, html: resumo + corpo, total: lista.length };
  }

  window.TF_AGENDA = {
    periodo: periodo, sobrepoe: sobrepoe, reservas: reservas, estoque: estoque,
    textoPeriodo: textoPeriodo, somaDias: somaDias, montar: montar
  };
})();
