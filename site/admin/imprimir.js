/* Folha de orçamento para imprimir ou salvar em PDF.
   Só abre para a administradora logada (as regras do banco não deixam outras pessoas lerem). */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var folha = document.getElementById("folha");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function cod(n) { return n == null ? "" : String(n).padStart(3, "0"); }
  function brl(n) { return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function dataBR(iso) { return iso ? iso.slice(0, 10).split("-").reverse().join("/") : ""; }
  function telBR(d) {
    d = String(d || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return d;
  }
  function docBR(d) {
    if (!d) return "";
    if (d.length === 11) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
    if (d.length === 14) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
    return d;
  }

  function erro(texto) {
    folha.innerHTML = '<p class="msg">' + esc(texto) + "</p>";
  }

  function tabela(titulo, itens) {
    if (!itens.length) return "";
    return "<table><caption>" + titulo + "</caption><thead><tr>" +
      (titulo === "Itens" ? '<th class="c">Cód.</th>' : "") +
      '<th>Descrição</th><th class="n">Qtd</th><th class="n">Valor unit.</th><th class="n">Total</th></tr></thead><tbody>' +
      itens.map(function (it) {
        return "<tr>" + (titulo === "Itens" ? '<td class="c">' + esc(cod(it.codigo)) + "</td>" : "") +
          "<td>" + esc(it.nome) + '</td><td class="n">' + esc(it.quantidade) + '</td><td class="n">' + brl(it.preco) +
          '</td><td class="n">' + brl(it.quantidade * it.preco) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function montar(o, conf) {
    var c = o.clientes;
    var itens = o.itens.filter(function (it) { return it.tipo !== "servico"; });
    var servs = o.itens.filter(function (it) { return it.tipo === "servico"; });
    var soma = function (l) { return l.reduce(function (s, it) { return s + it.quantidade * it.preco; }, 0); };
    var sub = soma(itens) + soma(servs);
    var desconto = Number(o.desconto) || 0, taxa = Number(o.taxa_entrega) || 0;
    var total = Math.max(0, sub - desconto + taxa);
    var linha = function (r, v, cls) { return "<div" + (cls ? ' class="' + cls + '"' : "") + "><span>" + r + "</span><span>" + v + "</span></div>"; };
    var contato = [conf.whatsapp_exibicao ? "WhatsApp " + conf.whatsapp_exibicao : "", conf.telefone_secundario].filter(Boolean).join(" · ");
    var endereco = c ? [c.endereco, c.bairro, c.cidade, c.cep ? "CEP " + c.cep : ""].filter(Boolean).join(" – ") : "";

    document.title = "Orçamento " + o.numero + " – " + (c ? c.nome : o.cliente_nome || "Chácara Top Fest");
    folha.innerHTML =
      '<header class="cab"><img src="../img/logo.png" alt="Chácara Top Fest"><div>' +
      "<h1>TOP FEST DECORAÇÕES</h1><p>" + esc(conf.slogan) + "</p>" + (contato ? "<p>" + esc(contato) + "</p>" : "") + "</div></header>" +
      '<div class="tit"><h2>Orçamento nº ' + esc(o.numero) + "</h2><span>Emitido em " + new Date(o.criado_em).toLocaleDateString("pt-BR") + "</span></div>" +
      '<section class="bloco"><h3>Cliente</h3>' +
      "<p><b>" + esc(c ? c.nome : o.cliente_nome || "—") + "</b></p>" +
      (c && c.documento ? "<p>" + (c.documento.length === 11 ? "CPF: " : "CNPJ: ") + esc(docBR(c.documento)) + "</p>" : "") +
      (c && (c.whatsapp || c.email) ? "<p>" + esc([telBR(c.whatsapp), c.email].filter(Boolean).join(" · ")) + "</p>" : "") +
      (endereco ? "<p>" + esc(endereco) + "</p>" : "") +
      (o.data_evento ? "<p><b>Data do evento:</b> " + dataBR(o.data_evento) + "</p>" : "") +
      "</section>" +
      tabela("Itens", itens) + tabela("Serviços", servs) +
      '<div class="totais">' +
      ((desconto || taxa) ? linha("Subtotal", brl(sub)) : "") +
      (desconto ? linha("Desconto", "- " + brl(desconto)) : "") +
      (taxa ? linha("Taxa de entrega", brl(taxa)) : "") +
      linha("Total", brl(total), "total") + "</div>" +
      (o.observacoes ? '<section class="bloco"><h3>Observações</h3><p class="obs">' + esc(o.observacoes) + "</p></section>" : "") +
      '<p class="rodape">' + esc(conf.nome) + " · " + esc(conf.slogan) + "</p>";
    document.getElementById("imprimir").disabled = false;
  }

  document.getElementById("imprimir").addEventListener("click", function () { window.print(); });

  var id = new URLSearchParams(location.search).get("id");
  if (!id) { erro("Orçamento não informado."); return; }

  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { erro("Entre na área da administradora primeiro e depois abra o orçamento de novo."); return; }
    return Promise.all([
      sb.from("orcamentos").select("*, clientes(*)").eq("id", id).maybeSingle(),
      sb.from("configuracoes").select("*").eq("id", 1).single()
    ]).then(function (res) {
      if (res[0].error || res[1].error) throw res[0].error || res[1].error;
      if (!res[0].data) { erro("Orçamento não encontrado (ele pode ter sido excluído)."); return; }
      montar(res[0].data, res[1].data);
    });
  }).catch(function (e) {
    console.error(e);
    erro("Não foi possível abrir o orçamento. Verifique a internet e tente de novo.");
  });
})();
