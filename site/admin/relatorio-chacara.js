/* Relatórios do aluguel da chácara (imprimir ou salvar em PDF). Só abre para a administradora logada. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var A = window.TF_AGENDA, U = A.util;
  var esc = U.esc, dataBR = U.dataBR, brl = U.brl;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var folha = document.getElementById("folha");
  var f = {
    tipo: document.getElementById("f-tipo"), de: document.getElementById("f-de"),
    ate: document.getElementById("f-ate"), sit: document.getElementById("f-sit"),
    pag: document.getElementById("f-pag")
  };
  var dados = null, conf = {};

  var TITULOS = {
    entradas: "Entradas e saídas da chácara",
    reservas: "Reservas da chácara",
    faturamento: "Faturamento da chácara por mês",
    clientes: "Clientes da chácara",
    lucro: "Lucro da chácara por mês",
    despesas: "Despesas da chácara",
    recebimentos: "Recebimentos da chácara por mês",
    receber: "Chácara: valores a receber"
  };
  // Faturamento e clientes contam só o que foi fechado (Aprovado).
  function soAprovados() { return ["faturamento", "clientes", "lucro", "despesas", "recebimentos", "receber"].indexOf(f.tipo.value) >= 0; }

  function hoje() { return new Date().toLocaleDateString("sv-SE"); }
  function periodoPadrao(tipo) {
    var h = hoje(), ano = h.slice(0, 4);
    if (tipo === "receber") return { de: (Number(ano) - 1) + "-01-01", ate: A.somaDias(h, 365) };
    if (tipo === "faturamento" || tipo === "clientes" || tipo === "lucro" || tipo === "recebimentos") return { de: ano + "-01-01", ate: ano + "-12-31" };
    if (tipo === "despesas") return { de: h.slice(0, 7) + "-01", ate: A.somaDias(somaMesISO(h.slice(0, 7), 1) + "-01", -1) };
    return { de: h, ate: A.somaDias(h, tipo === "entradas" ? 30 : 90) };
  }

  function somaMesISO(ym, n) {
    var a = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + n;
    while (m > 12) { m -= 12; a++; }
    while (m < 1) { m += 12; a--; }
    return a + "-" + String(m).padStart(2, "0");
  }
  function mesesDoPeriodo() {
    var meses = [], m = f.de.value.slice(0, 7), fim = f.ate.value.slice(0, 7);
    while (m <= fim && meses.length < 60) { meses.push(m); m = somaMesISO(m, 1); }
    return meses;
  }
  function nomeMes(mes) { var n = U.MESES[Number(mes.slice(5, 7)) - 1]; return n.charAt(0).toUpperCase() + n.slice(1) + "/" + mes.slice(0, 4); }
  function despesasDoPeriodo() {
    return (dados.despesas || []).filter(function (x) { return x.data >= f.de.value && x.data <= f.ate.value; });
  }
  function semDespesas() {
    return dados.despesas == null ? '<p class="ag-alerta">⚠️ As despesas ainda não foram ativadas no banco de dados (falta rodar o supabase/schema.sql).</p>' : "";
  }

  function erro(texto) { folha.innerHTML = '<p class="msg">' + esc(texto) + "</p>"; }
  function msg(texto) { return '<p class="msg">' + esc(texto) + "</p>"; }

  // Orçamentos da chácara (não cancelados) que encostam no período.
  function lista(sit) {
    return U.filtrar(dados, { de: f.de.value, ate: f.ate.value, sit: sit, tipo: "chacara" });
  }
  // Para faturamento e clientes: aprovados com ENTRADA dentro do período (cada reserva conta uma vez, no mês da entrada).
  function aprovadosPorEntrada(incluirAbertos) {
    return dados.orcs.filter(function (o) {
      var p = A.periodo(o);
      if (!p || p.ini < f.de.value || p.ini > f.ate.value) return false;
      if (!A.tipoOrc(o, dados).chacara) return false;
      return o.situacao === "aprovado" || (incluirAbertos && o.situacao === "aberto");
    });
  }

  // ---------- 1. Entradas e saídas ----------
  function entradas() {
    var l = lista(f.sit.value), h = U.ajudantes(dados), de = f.de.value, ate = f.ate.value;
    var porDia = {};
    function por(dia, ordem, oque, classe, o) {
      if (dia < de || dia > ate) return;
      (porDia[dia] = porDia[dia] || []).push({ ordem: ordem, oque: oque, classe: classe, o: o });
    }
    l.forEach(function (o) {
      var p = A.periodo(o);
      if (p.ini === p.fim) por(p.ini, 1, "🔑 Entrada e saída no mesmo dia", "ret", o);
      else {
        por(p.ini, 1, "🔑 Entrada", "ret", o);
        por(p.fim, 0, "🚪 Saída", "dev", o);
      }
      if (o.data_evento && o.data_evento !== p.ini && o.data_evento !== p.fim) por(o.data_evento, 2, "🎉 Evento", "evt", o);
    });
    var diasL = Object.keys(porDia).sort();
    if (!diasL.length) return { html: msg("Nenhuma entrada ou saída da chácara nesse período."), n: 0 };
    var n = 0;
    var html = diasL.map(function (dia) {
      // No mesmo dia: primeiro quem sai, depois quem entra.
      var linhas = porDia[dia].sort(function (a, b) { return a.ordem - b.ordem; }).map(function (x) {
        n++;
        var o = x.o, p = A.periodo(o);
        return '<tr class="ag-' + x.classe + '"><td class="ag-tipo">' + x.oque + "</td>" +
          "<td>" + U.clienteHtml(o, h, false) + "</td>" +
          "<td>" + esc(U.pacotes(o, dados)) +
          '<br><span class="ag-end">' + (p.ini === p.fim ? dataBR(p.ini) : "Entrada " + dataBR(p.ini) + " · Saída " + dataBR(p.fim)) +
          " · " + U.numDias(p) + (U.numDias(p) === 1 ? " dia" : " dias") + "</span>" +
          (o.observacoes ? '<br><span class="ag-end">Obs.: ' + esc(o.observacoes) + "</span>" : "") + "</td>" +
          '<td class="c">nº ' + esc(o.numero) + "<br>" + U.selo(o) + "</td>" +
          '<td class="conf"><span class="caixinha"></span></td></tr>';
      }).join("");
      return '<section class="ag-dia"><h3>' + esc(U.semana(dia)) + ", " + dataBR(dia) + "</h3>" +
        '<div class="ag-tab"><table class="rel-es"><thead><tr><th>O quê</th><th>Cliente</th><th>Pacote e período</th><th>Orçamento</th><th class="conf">Visto</th></tr></thead><tbody>' +
        linhas + "</tbody></table></div></section>";
    }).join("");
    return { html: html, n: n, rotulo: "movimento(s)" };
  }

  // ---------- 2. Reservas do período ----------
  function reservas() {
    var l = lista(f.sit.value);
    if (!l.length) return { html: msg("Nenhuma reserva da chácara nesse período."), n: 0 };
    return { html: U.listaChacara(l, dados, U.ajudantes(dados)), n: l.length, rotulo: "reserva(s)" };
  }

  // ---------- 3. Faturamento por mês ----------
  function faturamento() {
    var l = aprovadosPorEntrada(true);
    var meses = [], m = f.de.value.slice(0, 7), fim = f.ate.value.slice(0, 7);
    while (m <= fim && meses.length < 60) {
      meses.push(m);
      var a = Number(m.slice(0, 4)), mm = Number(m.slice(5, 7)) + 1;
      if (mm > 12) { mm = 1; a++; }
      m = a + "-" + String(mm).padStart(2, "0");
    }
    var tot = { n: 0, dias: 0, ch: 0, total: 0, abN: 0, abCh: 0 };
    var linhas = meses.map(function (mes) {
      var r = { n: 0, dias: 0, ch: 0, total: 0, abN: 0, abCh: 0 };
      l.forEach(function (o) {
        var p = A.periodo(o);
        if (p.ini.slice(0, 7) !== mes) return;
        if (o.situacao === "aprovado") {
          r.n++; r.dias += U.numDias(p); r.ch += U.valorChacara(o, dados); r.total += U.totalOrc(o, dados);
        } else { r.abN++; r.abCh += U.valorChacara(o, dados); }
      });
      Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
      var nome = U.MESES[Number(mes.slice(5, 7)) - 1];
      return "<tr" + (r.n ? "" : ' class="sem"') + "><td><b>" + esc(nome.charAt(0).toUpperCase() + nome.slice(1)) + "/" + mes.slice(0, 4) + "</b></td>" +
        '<td class="n">' + r.n + '</td><td class="n">' + r.dias + '</td><td class="n">' + esc(brl(r.ch)) + "</td>" +
        '<td class="n">' + (r.n ? esc(brl(r.ch / r.n)) : "—") + '</td><td class="n">' + esc(brl(r.total)) + "</td>" +
        '<td class="n">' + (r.abN ? r.abN + " · " + esc(brl(r.abCh)) : "—") + "</td></tr>";
    }).join("");
    var html = '<div class="ag-tab"><table><thead><tr><th>Mês da entrada</th><th class="n">Reservas aprovadas</th><th class="n">Dias ocupados</th>' +
      '<th class="n">Valor da chácara</th><th class="n">Média por reserva</th><th class="n">Total dos orçamentos</th><th class="n">Em aberto (qtd · valor)</th></tr></thead><tbody>' +
      linhas + '</tbody><tfoot><tr class="soma"><td><b>Total</b></td><td class="n"><b>' + tot.n + '</b></td><td class="n"><b>' + tot.dias + "</b></td>" +
      '<td class="n"><b>' + esc(brl(tot.ch)) + '</b></td><td class="n"><b>' + (tot.n ? esc(brl(tot.ch / tot.n)) : "—") + "</b></td>" +
      '<td class="n"><b>' + esc(brl(tot.total)) + '</b></td><td class="n"><b>' + (tot.abN ? tot.abN + " · " + esc(brl(tot.abCh)) : "—") + "</b></td></tr></tfoot></table></div>" +
      '<p class="ag-resumo"><b>Valor da chácara:</b> só os pacotes da chácara, já tirando o desconto de indicação e a parte do desconto que cabe a ela (sem frete e sem decoração). ' +
      "<b>Total dos orçamentos:</b> o valor final do orçamento inteiro, com decoração e frete quando houver. " +
      "Cada reserva conta no mês da <b>entrada</b>. <b>Em aberto</b> é só previsão: ainda não foi confirmado.</p>";
    return { html: html, n: tot.n, rotulo: "reserva(s) aprovada(s)" };
  }

  // ---------- 4. Clientes da chácara ----------
  function clientes() {
    var l = aprovadosPorEntrada(false), h = U.ajudantes(dados);
    var grupos = {};
    l.forEach(function (o) {
      var chave = o.cliente_id || "nome:" + (h.nome(o) || "").toLowerCase();
      var g = grupos[chave] = grupos[chave] || { o: o, n: 0, dias: 0, ch: 0, ultima: "", nums: [] };
      var p = A.periodo(o);
      g.n++; g.dias += U.numDias(p); g.ch += U.valorChacara(o, dados); g.nums.push(o.numero);
      if (p.ini > g.ultima) { g.ultima = p.ini; g.o = o; }
    });
    var gs = Object.keys(grupos).map(function (k) { return grupos[k]; })
      .sort(function (a, b) { return b.ch - a.ch || b.n - a.n; });
    if (!gs.length) return { html: msg("Nenhum aluguel da chácara aprovado com entrada nesse período."), n: 0 };
    var soma = gs.reduce(function (s, g) { return s + g.ch; }, 0);
    var html = '<div class="ag-tab"><table><thead><tr><th>Cliente</th><th>Cidade</th><th class="n">Aluguéis</th><th class="n">Dias</th>' +
      '<th class="n">Valor da chácara</th><th>Última entrada</th><th>Orçamentos</th></tr></thead><tbody>' +
      gs.map(function (g) {
        var c = h.cliente(g.o);
        return "<tr><td>" + U.clienteHtml(g.o, h, false) + "</td><td>" + esc((c && c.cidade) || "—") + "</td>" +
          '<td class="n">' + g.n + '</td><td class="n">' + g.dias + '</td><td class="n">' + esc(brl(g.ch)) + "</td>" +
          '<td class="c">' + dataBR(g.ultima) + "</td><td>nº " + esc(g.nums.sort(function (a, b) { return a - b; }).join(", ")) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="ag-resumo"><b>' + gs.length + "</b> cliente(s) · <b>" + l.length + "</b> aluguel(éis) aprovado(s) · valor da chácara: <b>" + esc(brl(soma)) +
      "</b>. Conta os orçamentos aprovados com entrada no período.</p>";
    return { html: html, n: gs.length, rotulo: "cliente(s)" };
  }

  // ---------- 5. Lucro por mês ----------
  function lucro() {
    var l = aprovadosPorEntrada(false), ds = despesasDoPeriodo();
    var tot = { rec: 0, n: 0, desp: 0, apagar: 0 };
    var linhas = mesesDoPeriodo().map(function (mes) {
      var r = { rec: 0, n: 0, desp: 0, apagar: 0 };
      l.forEach(function (o) { if (A.periodo(o).ini.slice(0, 7) === mes) { r.n++; r.rec += U.valorChacara(o, dados); } });
      ds.forEach(function (x) { if (x.data.slice(0, 7) === mes) { r.desp += Number(x.valor); if (!x.pago) r.apagar += Number(x.valor); } });
      Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
      return linhaLucro(nomeMes(mes), r, !r.n && !r.desp);
    }).join("");
    function linhaLucro(rot, r, vazio, forte) {
      var lu = r.rec - r.desp, b = function (s) { return forte ? "<b>" + s + "</b>" : s; };
      return "<tr" + (vazio ? ' class="sem"' : forte ? ' class="soma"' : "") + "><td>" + b(rot) + "</td>" +
        '<td class="n">' + b(r.n) + '</td><td class="n">' + b(esc(brl(r.rec))) + "</td>" +
        '<td class="n">' + b(esc(brl(r.desp))) + (r.apagar ? '<br><span class="ag-end">a pagar ' + esc(brl(r.apagar)) + "</span>" : "") + "</td>" +
        '<td class="n ' + (lu < 0 ? "neg" : lu > 0 ? "pos" : "") + '">' + b(esc(brl(lu))) + "</td>" +
        '<td class="n">' + (r.rec > 0 ? b(Math.round(lu / r.rec * 100) + "%") : "—") + "</td></tr>";
    }
    // Despesas por tipo no período
    var tipos = {};
    ds.forEach(function (x) { tipos[x.categoria] = (tipos[x.categoria] || 0) + Number(x.valor); });
    var chaves = Object.keys(tipos).sort(function (a, b) { return tipos[b] - tipos[a]; });
    var html = semDespesas() +
      '<div class="ag-tab"><table><thead><tr><th>Mês</th><th class="n">Aluguéis aprovados</th><th class="n">Receita da chácara</th>' +
      '<th class="n">Despesas</th><th class="n">Lucro</th><th class="n">Margem</th></tr></thead><tbody>' + linhas + "</tbody>" +
      "<tfoot>" + linhaLucro("Total", tot, false, true) + "</tfoot></table></div>" +
      (chaves.length ? "<h3 class=\"sub\">Despesas por tipo no período</h3>" +
        '<div class="ag-tab"><table><thead><tr><th>Tipo de gasto</th><th class="n">Total</th><th class="n">% das despesas</th></tr></thead><tbody>' +
        chaves.map(function (k) {
          return "<tr><td>" + esc(k) + '</td><td class="n">' + esc(brl(tipos[k])) + '</td><td class="n">' + Math.round(tipos[k] / tot.desp * 100) + "%</td></tr>";
        }).join("") + "</tbody></table></div>" : "") +
      '<p class="ag-resumo"><b>Receita da chácara:</b> valor só dos pacotes da chácara nos orçamentos <b>aprovados</b>, no mês da <b>entrada</b> ' +
      "(sem decoração e sem frete). <b>Despesas:</b> todos os gastos lançados com data no mês, pagos ou a pagar. <b>Lucro</b> = receita − despesas.</p>";
    return { html: html, n: tot.n, rotulo: "aluguel(éis) aprovado(s)" };
  }

  // ---------- 6. Despesas do período ----------
  function despesas() {
    var ds = despesasDoPeriodo().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.categoria.localeCompare(b.categoria); });
    if (!ds.length) return { html: semDespesas() + msg("Nenhuma despesa nesse período."), n: 0 };
    var total = 0, apagar = 0;
    var html = semDespesas() + '<div class="ag-tab"><table><thead><tr><th>Data</th><th>Tipo de gasto</th><th>Descrição</th><th>Situação</th><th class="n">Valor</th></tr></thead><tbody>' +
      ds.map(function (x) {
        total += Number(x.valor); if (!x.pago) apagar += Number(x.valor);
        return '<tr><td class="c">' + dataBR(x.data) + "</td><td><b>" + esc(x.categoria) + "</b>" + (x.fixa ? ' <span class="ag-end">(fixa)</span>' : "") +
          "</td><td>" + esc(x.descricao || "—") + "</td><td>" + (x.pago ? "Pago" : "<b>A pagar</b>") + '</td><td class="n">' + esc(brl(x.valor)) + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr class="soma"><td colspan="4"><b>Total</b>' + (apagar ? " (a pagar: " + esc(brl(apagar)) + ")" : "") +
      '</td><td class="n"><b>' + esc(brl(total)) + "</b></td></tr></tfoot></table></div>";
    return { html: html, n: ds.length, rotulo: "despesa(s)" };
  }

  // ---------- Pagamentos ----------
  var FORMAS = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", transferencia: "Transferência" };
  function pags(o) { return Array.isArray(o.pagamentos) ? o.pagamentos : []; }
  function somaPags(o) { return Math.round(pags(o).reduce(function (s, x) { return s + (Number(x.valor) || 0); }, 0) * 100) / 100; }
  var NOTA_PAG = "Os pagamentos são do <b>orçamento inteiro</b> (não são divididos): um orçamento com chácara <b>e</b> decoração conta inteiro em <b>Chácara</b>, com o frete quando houver.";
  var NOMES_PAG = { chacara: "chácara", decoracao: "decoração", tudo: "chácara e decoração" };
  // Tipo escolhido no filtro: Chácara (orçamentos com chácara), Decoração (sem chácara) ou Tudo.
  function doTipo(o) {
    var t = f.pag.value, ch = A.tipoOrc(o, dados).chacara;
    return t === "tudo" || (t === "chacara" ? ch : !ch);
  }
  function usaTipoPag() { return f.tipo.value === "recebimentos" || f.tipo.value === "receber"; }

  // 7. Dinheiro que entrou, pela data de cada pagamento (orçamentos com chácara).
  function recebimentos() {
    var de = f.de.value, ate = f.ate.value, h = U.ajudantes(dados);
    var lanc = [];
    dados.orcs.forEach(function (o) {
      if (!doTipo(o)) return;
      pags(o).forEach(function (p) { if (p.data >= de && p.data <= ate) lanc.push({ o: o, p: p }); });
    });
    lanc.sort(function (a, b) { return a.p.data < b.p.data ? -1 : a.p.data > b.p.data ? 1 : a.o.numero - b.o.numero; });
    // As despesas são da chácara: só entram no relatório da chácara.
    var comDesp = f.pag.value === "chacara", tudo = f.pag.value === "tudo";
    var ds = comDesp ? despesasDoPeriodo() : [], formas = Object.keys(FORMAS);
    var tot = { rec: 0, desp: 0 };
    formas.forEach(function (k) { tot[k] = 0; });
    function linha(rot, r, vazio, forte) {
      var b = function (x) { return forte ? "<b>" + x + "</b>" : x; }, sobra = r.rec - r.desp;
      return "<tr" + (vazio ? ' class="sem"' : forte ? ' class="soma"' : "") + "><td>" + b(rot) + "</td>" +
        formas.map(function (k) { return '<td class="n">' + (r[k] ? b(esc(brl(r[k]))) : "—") + "</td>"; }).join("") +
        '<td class="n">' + b(esc(brl(r.rec))) + "</td>" +
        (comDesp ? '<td class="n">' + b(esc(brl(r.desp))) + "</td>" +
          '<td class="n ' + (sobra < 0 ? "neg" : sobra > 0 ? "pos" : "") + '">' + b(esc(brl(sobra))) + "</td>" : "") + "</tr>";
    }
    var linhas = mesesDoPeriodo().map(function (mes) {
      var r = { rec: 0, desp: 0 };
      formas.forEach(function (k) { r[k] = 0; });
      lanc.forEach(function (x) {
        if (x.p.data.slice(0, 7) !== mes) return;
        var v = Number(x.p.valor) || 0;
        r.rec += v; if (r[x.p.forma] != null) r[x.p.forma] += v;
      });
      ds.forEach(function (x) { if (x.data.slice(0, 7) === mes) r.desp += Number(x.valor); });
      Object.keys(tot).forEach(function (k) { tot[k] += r[k]; });
      return linha(nomeMes(mes), r, !r.rec && !r.desp);
    }).join("");
    var html = (comDesp ? semDespesas() : "") + '<div class="ag-tab"><table><thead><tr><th>Mês</th>' +
      formas.map(function (k) { return '<th class="n">' + FORMAS[k] + "</th>"; }).join("") +
      '<th class="n">Total recebido</th>' + (comDesp ? '<th class="n">Despesas</th><th class="n">Sobra no caixa</th>' : "") + "</tr></thead><tbody>" + linhas +
      "</tbody><tfoot>" + linha("Total", tot, false, true) + "</tfoot></table></div>" +
      (lanc.length ? '<h3 class="sub">Pagamentos recebidos no período</h3><div class="ag-tab"><table><thead><tr><th>Data</th><th>Cliente</th>' +
        '<th>Orçamento</th>' + (tudo ? "<th>Tipo</th>" : "") + '<th>Forma</th><th>Observação</th><th class="n">Valor</th></tr></thead><tbody>' +
        lanc.map(function (x) {
          return '<tr><td class="c">' + dataBR(x.p.data) + "</td><td>" + U.clienteHtml(x.o, h, false) + '</td><td class="c">nº ' + esc(x.o.numero) + "</td>" +
            (tudo ? "<td>" + (A.tipoOrc(x.o, dados).chacara ? "🏡 Chácara" : "🎈 Decoração") + "</td>" : "") +
            "<td>" + esc(FORMAS[x.p.forma] || x.p.forma) + "</td><td>" + esc(x.p.obs || "—") + '</td><td class="n">' + esc(brl(x.p.valor)) + "</td></tr>";
        }).join("") + "</tbody></table></div>" : msg("Nenhum pagamento lançado nesse período.")) +
      '<p class="ag-resumo"><b>Total recebido:</b> o dinheiro que entrou de verdade, pela <b>data de cada pagamento</b> (entradas, restantes e pagamentos adiantados). ' +
      NOTA_PAG + (comDesp ? " <b>Sobra no caixa</b> = recebido − despesas da chácara lançadas no mês." : "") + "</p>";
    return { html: html, n: lanc.length, rotulo: "pagamento(s)" };
  }

  // 8. Aluguéis aprovados com valor em aberto (pela data da entrada).
  function receber() {
    var h = U.ajudantes(dados);
    var de = f.de.value, ate = f.ate.value;
    var l = dados.orcs.filter(function (o) {
      if (o.situacao !== "aprovado" || !doTipo(o)) return false;
      var p = A.periodo(o);
      return !p || (p.ini >= de && p.ini <= ate);   // sem data: aparece sempre (não fica esquecido)
    }).map(function (o) {
      var total = U.totalOrc(o, dados), pago = somaPags(o);
      var ult = pags(o).reduce(function (m, p) { return p.data > m ? p.data : m; }, "");
      return { o: o, total: total, pago: pago, falta: Math.max(0, Math.round((total - pago) * 100) / 100), ult: ult };
    }).filter(function (x) { return x.falta > 0; })
      .sort(function (a, b) { var pa = ini(a.o), pb = ini(b.o); return pa < pb ? -1 : pa > pb ? 1 : a.o.numero - b.o.numero; });
    function ini(o) { var p = A.periodo(o); return p ? p.ini : "9999"; }
    if (!l.length) return { html: msg("Nenhum valor a receber nesse período. 🎉"), n: 0 };
    var t = { total: 0, pago: 0, falta: 0 };
    var hj = hoje();
    var html = '<div class="ag-tab"><table><thead><tr><th>' + (f.pag.value === "chacara" ? "Entrada" : "Data") + '</th><th>Cliente</th><th class="c">Orçamento</th>' +
      '<th class="n">Total</th><th class="n">Já pago</th><th class="n">Falta</th><th>Último pagamento</th></tr></thead><tbody>' +
      l.map(function (x) {
        var p = A.periodo(x.o) || { ini: "" };
        t.total += x.total; t.pago += x.pago; t.falta += x.falta;
        return "<tr><td class=\"c\">" + (p.ini ? dataBR(p.ini) : "Sem data") +
          (f.pag.value === "tudo" ? '<br><span class="ag-end">' + (A.tipoOrc(x.o, dados).chacara ? "🏡 Chácara" : "🎈 Decoração") + "</span>" : "") +
          (p.ini && p.ini < hj ? '<br><span class="ag-end">já passou</span>' : "") + "</td><td>" + U.clienteHtml(x.o, h, false) +
          '</td><td class="c">nº ' + esc(x.o.numero) + '</td><td class="n">' + esc(brl(x.total)) + '</td><td class="n">' + esc(brl(x.pago)) +
          '</td><td class="n"><b>' + esc(brl(x.falta)) + "</b></td><td>" + (x.ult ? dataBR(x.ult) : "Nada pago ainda") + "</td></tr>";
      }).join("") + '</tbody><tfoot><tr class="soma"><td colspan="3"><b>Total</b></td><td class="n"><b>' + esc(brl(t.total)) +
      '</b></td><td class="n"><b>' + esc(brl(t.pago)) + '</b></td><td class="n"><b>' + esc(brl(t.falta)) + "</b></td><td></td></tr></tfoot></table></div>" +
      '<p class="ag-resumo">Orçamentos <b>aprovados</b> (' + NOMES_PAG[f.pag.value] + "), com a data de entrada ou do evento no período, que ainda têm valor a pagar. " +
      "Orçamentos aprovados sem nenhuma data aparecem sempre. " + NOTA_PAG + "</p>";
    return { html: html, n: l.length, rotulo: "orçamento(s) com valor a receber" };
  }

  var MONTAR = { entradas: entradas, reservas: reservas, faturamento: faturamento, clientes: clientes, lucro: lucro, despesas: despesas,
    recebimentos: recebimentos, receber: receber };

  function montar() {
    var tipo = f.tipo.value;
    document.getElementById("rot-sit").hidden = soAprovados();
    document.getElementById("rot-pag").hidden = !usaTipoPag();
    var titulo = TITULOS[tipo];
    if (tipo === "recebimentos") titulo = "Recebimentos por mês – " + NOMES_PAG[f.pag.value];
    if (tipo === "receber") titulo = "Valores a receber – " + NOMES_PAG[f.pag.value];
    document.title = titulo + " – Top Fest";
    var corpo;
    if (!f.de.value || !f.ate.value || f.ate.value < f.de.value) corpo = { html: msg('Escolha as datas "De" e "Até" (a segunda depois da primeira).') };
    else corpo = MONTAR[tipo]();
    folha.innerHTML =
      '<header class="cab"><img src="../img/logo.png" alt="Chácara Top Fest"><div>' +
      "<h1>" + esc((conf.nome || "Chácara Top Fest").toUpperCase()) + "</h1><p>" + esc(conf.slogan || "") + "</p></div></header>" +
      '<div class="tit"><h2>' + esc(titulo) + "</h2><span>Emitido em " +
      new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + "</span></div>" +
      (f.de.value && f.ate.value ? '<p class="ag-resumo">' + dataBR(f.de.value) + " a " + dataBR(f.ate.value) + " · " +
        (tipo === "despesas" ? "despesas lançadas" : tipo === "recebimentos" ? "pagamentos recebidos" : soAprovados() ? "orçamentos aprovados" : f.sit.value === "aprovados" ? "só aprovados" : "aprovados e em aberto") +
        (corpo.rotulo ? " · <b>" + corpo.n + "</b> " + corpo.rotulo : "") + "</p>" : "") +
      corpo.html;
    document.getElementById("imprimir").disabled = false;
    history.replaceState(null, "", "?tipo=" + tipo + "&de=" + f.de.value + "&ate=" + f.ate.value + "&sit=" + f.sit.value + "&pt=" + f.pag.value);
  }

  var q = new URLSearchParams(location.search);
  if (q.get("tipo") && TITULOS[q.get("tipo")]) f.tipo.value = q.get("tipo");
  var pp = periodoPadrao(f.tipo.value);
  f.de.value = q.get("de") || pp.de;
  f.ate.value = q.get("ate") || pp.ate;
  if (q.get("sit")) f.sit.value = q.get("sit");
  if (NOMES_PAG[q.get("pt")]) f.pag.value = q.get("pt");

  document.getElementById("imprimir").addEventListener("click", function () { window.print(); });
  // Ao trocar de relatório, o período volta ao mais comum para ele.
  f.tipo.addEventListener("change", function () {
    var p = periodoPadrao(f.tipo.value);
    f.de.value = p.de; f.ate.value = p.ate;
    if (dados) montar();
  });
  ["de", "ate", "sit", "pag"].forEach(function (k) { f[k].addEventListener("change", function () { if (dados) montar(); }); });

  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { erro("Entre na área da administradora primeiro e depois abra o relatório de novo."); return; }
    return Promise.all([
      sb.from("orcamentos").select("*"),
      sb.from("clientes").select("*"),
      sb.from("produtos").select("id, codigo, nome, quantidade, kit_itens, categoria_id"),
      sb.from("categorias").select("id, tipo"),
      sb.from("configuracoes").select("*").eq("id", 1).single(),
      Promise.resolve(sb.from("despesas").select("*")).catch(function (e) { return { error: e }; })
    ]).then(function (res) {
      res.slice(0, 5).forEach(function (x) { if (x.error) throw x.error; });
      dados = { orcs: res[0].data, clientes: res[1].data, prods: res[2].data, cats: res[3].data,
        despesas: res[5].error ? null : res[5].data };
      conf = res[4].data || {};
      montar();
    });
  }).catch(function (e) {
    console.error(e);
    erro("Não foi possível carregar os relatórios. Verifique a internet e tente de novo.");
  });
})();
