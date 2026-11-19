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

  // ---------- Chácara ----------
  // Um item é da chácara se foi marcado ao salvar (it.chacara) ou se o produto é de categoria do tipo "chacara".
  // d precisa de cats (id, tipo) e prods (id, categoria_id) para os orçamentos antigos, sem a marca.
  function idsChacara(d) {
    if (d._ch) return d._ch;
    var cats = {}, ids = {};
    (d.cats || []).forEach(function (c) { if (c.tipo === "chacara") cats[c.id] = true; });
    (d.prods || []).forEach(function (p) { if (cats[p.categoria_id]) ids[p.id] = true; });
    d._ch = ids;
    return ids;
  }
  function itemChacara(it, d) {
    return it.tipo !== "servico" && !!(it.chacara || (it.produto_id && idsChacara(d)[it.produto_id]));
  }
  function tipoOrc(o, d) {
    var ch = false, dec = false;
    (o.itens || []).forEach(function (it) {
      if (it.tipo === "servico" || !it.produto_id) return;
      if (itemChacara(it, d)) ch = true; else dec = true;
    });
    return { chacara: ch, decoracao: dec };
  }

  // Total do orçamento (a mesma conta do painel).
  function totalOrc(o, d) {
    var itens = 0, servicos = 0, chacara = 0;
    (o.itens || []).forEach(function (it) {
      var v = (Number(it.quantidade) || 0) * (Number(it.preco) || 0);
      if (it.tipo === "servico") servicos += v; else itens += v;
      if (itemChacara(it, d)) chacara += v;
    });
    var dec = itens + servicos - chacara;
    var descInd = Math.round(dec * (Number(o.desconto_indicacao_pct) || 0)) / 100 +
      Math.round(chacara * (Number(o.desconto_indicacao_chacara_pct) || 0)) / 100;
    return Math.max(0, itens + servicos - (Number(o.desconto) || 0) - descInd - (Number(o.credito_usado) || 0) + (Number(o.taxa_entrega) || 0));
  }
  function brl(n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

  // Parte da chácara no orçamento: pacotes - desconto de indicação da chácara - parte proporcional do desconto manual
  // (a mesma divisão usada no crédito de indicação). Frete e crédito usado não entram.
  function valorChacara(o, d) {
    var sc = 0, sd = 0;
    (o.itens || []).forEach(function (it) {
      var v = (Number(it.quantidade) || 0) * (Number(it.preco) || 0);
      if (itemChacara(it, d)) sc += v; else sd += v;
    });
    var desc = Number(o.desconto) || 0;
    var dc = sd + sc > 0 ? Math.round(desc * sc / (sd + sc) * 100) / 100 : 0;
    return Math.max(0, sc - Math.round(sc * (Number(o.desconto_indicacao_chacara_pct) || 0)) / 100 - dc);
  }
  function numDias(p) { return p ? Math.round((new Date(p.fim + "T12:00:00") - new Date(p.ini + "T12:00:00")) / 864e5) + 1 : 0; }

  // Orçamentos da chácara que valem para a agenda (Em aberto e Aprovados, com data).
  function reservasChacara(d) {
    return d.orcs.filter(function (o) {
      return o.situacao !== "cancelado" && periodo(o) && tipoOrc(o, d).chacara;
    }).sort(function (a, b) {
      var pa = periodo(a), pb = periodo(b);
      return pa.ini < pb.ini ? -1 : pa.ini > pb.ini ? 1 : a.numero - b.numero;
    });
  }
  // Quem está na chácara num dia: aprovados (ocupam) e em aberto (interessados, não bloqueiam).
  function diaChacara(lista, dia) {
    var r = { aprovados: [], abertos: [] };
    lista.forEach(function (o) {
      var p = periodo(o);
      if (p.ini <= dia && dia <= p.fim) (o.situacao === "aprovado" ? r.aprovados : r.abertos).push(o);
    });
    r.estado = r.aprovados.length > 1 ? "conflito" : r.aprovados.length ? "ocupado" : r.abertos.length ? "aberto" : "livre";
    return r;
  }

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  function primeiroNome(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }

  // Calendário do mês (mes de 1 a 12). Cada dia é um botão com data-dia.
  function calendarioChacara(d, ano, mes) {
    var lista = reservasChacara(d), h = ajudantes(d);
    var ini = ano + "-" + String(mes).padStart(2, "0") + "-01";
    var vazios = new Date(ini + "T12:00:00").getDay();
    var hoje = new Date().toLocaleDateString("sv-SE");
    var html = '<div class="ch-cal">' + ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(function (s) {
      return '<span class="ch-sem">' + s + "</span>";
    }).join("");
    for (var i = 0; i < vazios; i++) html += '<span class="ch-vazio"></span>';
    var conta = { livre: 0, aberto: 0, ocupado: 0, conflito: 0 };
    for (var dia = ini; dia.slice(0, 7) === ini.slice(0, 7); dia = somaDias(dia, 1)) {
      var r = diaChacara(lista, dia);
      conta[r.estado]++;
      var quem = (r.aprovados.length ? r.aprovados : r.abertos).map(function (o) { return primeiroNome(h.nome(o)); }).join(", ");
      var rotulo = dataBR(dia) + ": " + { livre: "livre", aberto: "em aberto (" + quem + ")", ocupado: "reservado (" + quem + ")", conflito: "conflito (" + quem + ")" }[r.estado];
      html += '<button type="button" class="ch-d ch-' + r.estado + (dia === hoje ? " ch-hoje" : "") + (dia < hoje ? " ch-passado" : "") +
        '" data-dia="' + dia + '" aria-label="' + esc(rotulo) + '" title="' + esc(rotulo) + '"><b>' + Number(dia.slice(8)) + "</b>" +
        (quem ? '<span class="ch-quem">' + esc(quem) + "</span>" : "") + "</button>";
    }
    html += "</div>";
    return {
      titulo: MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1) + " de " + ano,
      html: html,
      resumo: (conta.ocupado + conta.conflito) + " dia(s) reservado(s) · " + conta.aberto + " em aberto · " + conta.livre + " livre(s)" +
        (conta.conflito ? " · ⛔ " + conta.conflito + " dia(s) com duas reservas aprovadas" : "")
    };
  }

  function pacotes(o, d) {
    return (o.itens || []).filter(function (it) { return itemChacara(it, d); }).map(function (it) {
      return (Number(it.quantidade) > 1 ? it.quantidade + "x " : "") + it.nome;
    }).join(", ") || "—";
  }
  function textoEntradaSaida(o) {
    if (o.data_retirada && o.data_devolucao) return "Entrada " + dataBR(o.data_retirada) + " · Saída " + dataBR(o.data_devolucao);
    return textoPeriodo(periodo(o));
  }

  // Cartão de uma reserva (usado na consulta de data). acoes = HTML extra (botões do painel).
  function cartaoReserva(o, d, h, acoes) {
    var c = h.cliente(o);
    var zap = c && c.whatsapp ? String(c.whatsapp).replace(/\D/g, "") : "";
    if (zap && zap.length <= 11) zap = "55" + zap;
    return '<div class="ch-res ch-res-' + esc(o.situacao) + '"><p><b>' + esc(h.nome(o)) + "</b> " + selo(o) + "</p>" +
      "<p>📅 " + esc(textoEntradaSaida(o)) + (o.data_evento ? " · 🎉 Evento " + dataBR(o.data_evento) : "") + "</p>" +
      "<p>🏡 " + esc(pacotes(o, d)) + (tipoOrc(o, d).decoracao ? " + decoração" : "") + "</p>" +
      "<p>🧾 Orçamento nº " + esc(o.numero) + " · Total " + esc(brl(totalOrc(o, d))) +
      (zap ? ' · <a href="https://wa.me/' + zap + '" target="_blank" rel="noopener">💬 ' + esc(telBR(c.whatsapp)) + "</a>" : "") + "</p>" +
      (acoes || "") + "</div>";
  }

  // Resposta da consulta de um dia. acoes(o) devolve botões extras para cada reserva.
  function consultaChacara(d, dia, acoes) {
    if (!dia) return { estado: "", html: '<p class="msg">Escolha uma data.</p>' };
    var r = diaChacara(reservasChacara(d), dia), h = ajudantes(d);
    var cab = {
      livre: "✅ " + dataBR(dia) + " está LIVRE.",
      aberto: "🟡 " + dataBR(dia) + " está livre, mas tem orçamento em aberto (ainda não confirmado):",
      ocupado: "⛔ " + dataBR(dia) + " está RESERVADO:",
      conflito: "⛔ Atenção: " + dataBR(dia) + " tem mais de uma reserva aprovada!"
    }[r.estado];
    var html = '<p class="ch-cab">' + esc(semana(dia)) + " · " + esc(cab) + "</p>";
    r.aprovados.concat(r.abertos).forEach(function (o) { html += cartaoReserva(o, d, h, acoes ? acoes(o) : ""); });
    return { estado: r.estado, html: html };
  }

  // Lista das reservas da chácara num período (tela e impressão).
  function listaChacara(lista, d, h) {
    var aprov = lista.filter(function (o) { return o.situacao === "aprovado"; });
    var conflitos = {};
    aprov.forEach(function (a) {
      aprov.forEach(function (b) { if (a !== b && sobrepoe(periodo(a), periodo(b))) conflitos[a.id] = true; });
    });
    var nConf = Object.keys(conflitos).length;
    var soma = aprov.reduce(function (s, o) { return s + totalOrc(o, d); }, 0);
    return (nConf ? '<p class="ag-alerta">⛔ ' + nConf + " reserva(s) aprovada(s) com datas que se cruzam. Confira as linhas em vermelho.</p>" : "") +
      '<div class="ag-tab"><table><thead><tr><th>Entrada</th><th>Saída</th><th class="n">Dias</th><th>Cliente</th><th>Orçamento</th><th>Pacote</th><th class="n">Total</th></tr></thead><tbody>' +
      lista.map(function (o) {
        var p = periodo(o);
        return "<tr" + (conflitos[o.id] ? ' class="ag-falta"' : "") + '><td class="c"><b>' + esc(semana(p.ini).slice(0, 3)) + " " + dataBR(p.ini) + "</b></td>" +
          '<td class="c">' + esc(semana(p.fim).slice(0, 3)) + " " + dataBR(p.fim) + "</td>" +
          '<td class="n">' + numDias(p) + "</td>" +
          "<td>" + clienteHtml(o, h, false) + '</td><td class="c">nº ' + esc(o.numero) + "<br>" + selo(o) + "</td>" +
          "<td>" + esc(pacotes(o, d)) + (tipoOrc(o, d).decoracao ? '<br><span class="ag-end">+ decoração</span>' : "") +
          (o.observacoes ? '<br><span class="ag-end">' + esc(o.observacoes) + "</span>" : "") + "</td>" +
          '<td class="n">' + esc(brl(totalOrc(o, d))) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="ag-resumo">' + aprov.length + " reserva(s) aprovada(s) no período · soma dos aprovados: <b>" + esc(brl(soma)) + "</b></p>";
  }

  // ---------- Relatórios ----------
  // d = { orcs, clientes, prods }; f = { de, ate, sit: "ativos" | "aprovados", ver: "dia" | "clientes" | "produtos" }
  function filtrar(d, f) {
    var janela = { ini: f.de, fim: f.ate };
    return d.orcs.filter(function (o) {
      if (o.situacao === "cancelado") return false;
      if (f.sit === "aprovados" && o.situacao !== "aprovado") return false;
      if (f.tipo && !tipoOrc(o, d)[f.tipo]) return false;
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
    var prods = d.prods.filter(function (p) { return ids[p.id] && !(p.kit_itens && p.kit_itens.length); }).sort(function (a, b) { return (a.codigo || 0) - (b.codigo || 0); });
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

  var TITULOS = { dia: "Programação por dia", clientes: "Clientes agendados", produtos: "Produtos agendados", chacara: "Reservas da chácara" };

  function montar(d, f) {
    if (!f.de || !f.ate || f.ate < f.de) return { titulo: TITULOS[f.ver], html: '<p class="msg">Escolha as datas "De" e "Até" (a segunda depois da primeira).</p>', total: 0 };
    if (f.ver === "chacara") f = { de: f.de, ate: f.ate, sit: f.sit, ver: f.ver, tipo: "chacara" };
    var lista = filtrar(d, f), h = ajudantes(d);
    var corpo;
    if (!lista.length) corpo = '<p class="msg">Nenhum orçamento agendado nesse período.</p>';
    else if (f.ver === "chacara") corpo = listaChacara(lista, d, h);
    else if (f.ver === "clientes") corpo = clientes(lista, h);
    else if (f.ver === "produtos") corpo = produtos(lista, d, f, h);
    else corpo = porDia(lista, f, h);
    var resumo = '<p class="ag-resumo">' + dataBR(f.de) + " a " + dataBR(f.ate) + " · " +
      (f.sit === "aprovados" ? "só aprovados" : "aprovados e em aberto") +
      (f.tipo === "chacara" ? " · só chácara" : f.tipo === "decoracao" ? " · só decoração" : "") + " · <b>" + lista.length + "</b> orçamento(s)</p>";
    return { titulo: TITULOS[f.ver] || TITULOS.dia, html: resumo + corpo, total: lista.length };
  }

  window.TF_AGENDA = {
    periodo: periodo, sobrepoe: sobrepoe, reservas: reservas, estoque: estoque,
    textoPeriodo: textoPeriodo, somaDias: somaDias, montar: montar,
    tipoOrc: tipoOrc, calendarioChacara: calendarioChacara, consultaChacara: consultaChacara,
    // Usados pelos relatórios da chácara (relatorio-chacara.js).
    util: {
      esc: esc, cod: cod, dataBR: dataBR, semana: semana, telBR: telBR, brl: brl, selo: selo, SIT: SIT,
      ajudantes: ajudantes, clienteHtml: clienteHtml, pacotes: pacotes, filtrar: filtrar, listaChacara: listaChacara,
      totalOrc: totalOrc, valorChacara: valorChacara, numDias: numDias, MESES: MESES
    }
  };
})();
