/* Contrato de locação gerado a partir de um orçamento aprovado.
   Mostra a folha para imprimir/PDF e gera o mesmo conteúdo em Word (.docx).
   Só abre para a administradora logada (o banco não deixa outras pessoas lerem). */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var folha = document.getElementById("folha");
  var dados = null;   // { o, c, conf, modelo, contas }
  var LINHA = "______________________";

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

  function erro(texto) { folha.innerHTML = '<p class="msg">' + esc(texto) + "</p>"; }

  // ---------- Conteúdo (o mesmo para a folha e para o Word) ----------
  function calcular(o, pct) {
    var soma = function (l) { return l.reduce(function (s, it) { return s + it.quantidade * it.preco; }, 0); };
    var itens = o.itens.filter(function (it) { return it.tipo !== "servico"; });
    var servs = o.itens.filter(function (it) { return it.tipo === "servico"; });
    var sub = soma(itens) + soma(servs);
    var desconto = Number(o.desconto) || 0, taxa = Number(o.taxa_entrega) || 0;
    var total = Math.max(0, sub - desconto + taxa);
    var sinal = Math.round(total * pct) / 100;
    return { itens: itens, servs: servs, sub: sub, desconto: desconto, taxa: taxa, total: total, pct: pct, sinal: sinal, restante: total - sinal };
  }

  // Linhas de dados do cliente: [rótulo, valor] (valor vazio = linha para escrever à mão).
  function campos(o, c) {
    var doc = c && c.documento;
    var endereco = c ? [c.endereco, c.cidade, c.cep ? "CEP " + c.cep : ""].filter(Boolean).join(" – ") : "";
    return [
      [["LOCATÁRIO / CLIENTE", c ? c.nome : o.cliente_nome]],
      [["ENDEREÇO", endereco]],
      [["BAIRRO", c && c.bairro], ["TELEFONE", c && telBR(c.whatsapp)]],
      [[doc && doc.length === 14 ? "CNPJ" : "CPF", docBR(doc)], ["RG", c && c.rg]],
      [["DATA DA RETIRADA", dataBR(o.data_retirada)], ["DATA DA DEVOLUÇÃO", dataBR(o.data_devolucao)]]
    ];
  }

  function linhasTotais(v) {
    var l = [];
    if (v.desconto || v.taxa) l.push(["Subtotal", brl(v.sub)]);
    if (v.desconto) l.push(["Desconto", "- " + brl(v.desconto)]);
    if (v.taxa) l.push(["Taxa de entrega", brl(v.taxa)]);
    l.push(["VALOR TOTAL DA LOCAÇÃO", brl(v.total), true]);
    if (v.pct > 0) {
      l.push(["Sinal para reserva (" + v.pct + "%)", brl(v.sinal)]);
      l.push(["Restante, a pagar na retirada", brl(v.restante)]);
    }
    return l;
  }

  function paragrafos(txt) {
    return String(txt || "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  // ---------- Folha (imprimir / PDF) ----------
  function tabelaHtml(titulo, itens, comCodigo) {
    if (!itens.length) return "";
    return "<table><caption>" + titulo + "</caption><thead><tr>" + (comCodigo ? '<th class="c">Cód.</th>' : "") +
      '<th>Descrição</th><th class="n">Qtd</th><th class="n">Valor unit.</th><th class="n">Total</th></tr></thead><tbody>' +
      itens.map(function (it) {
        return "<tr>" + (comCodigo ? '<td class="c">' + esc(cod(it.codigo)) + "</td>" : "") + "<td>" + esc(it.nome) +
          '</td><td class="n">' + esc(it.quantidade) + '</td><td class="n">' + brl(it.preco) + '</td><td class="n">' + brl(it.quantidade * it.preco) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function montarFolha() {
    var o = dados.o, c = dados.c, conf = dados.conf, m = dados.modelo, v = dados.contas;
    document.title = "Contrato " + o.numero + " – " + (c ? c.nome : o.cliente_nome || "Chácara Top Fest");
    folha.innerHTML =
      '<header class="cab"><img src="../img/logo.png" alt="Chácara Top Fest"><div>' +
      "<h1>" + esc(m.titulo) + "</h1><p>" + esc(conf.nome) + " · " + esc(conf.slogan) + "</p>" +
      "<p>Referente ao orçamento nº " + esc(o.numero) + "</p></div></header>" +
      '<section class="campos">' + campos(o, c).map(function (linha) {
        return '<div class="linha">' + linha.map(function (f) {
          return '<p><b>' + esc(f[0]) + ":</b> " + (f[1] ? esc(f[1]) : '<span class="branco">' + LINHA + "</span>") + "</p>";
        }).join("") + "</div>";
      }).join("") + "</section>" +
      tabelaHtml("Itens de decoração locados", v.itens, true) + tabelaHtml("Serviços", v.servs, false) +
      '<div class="totais">' + linhasTotais(v).map(function (l) {
        return "<div" + (l[2] ? ' class="total"' : "") + "><span>" + esc(l[0]) + "</span><span>" + l[1] + "</span></div>";
      }).join("") + "</div>" +
      (o.observacoes ? '<section class="bloco"><h3>Observações</h3><p class="obs">' + esc(o.observacoes) + "</p></section>" : "") +
      '<section class="clausulas"><h3>Cláusulas</h3>' +
      (paragrafos(m.clausulas).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") ||
        '<p class="msg">Nenhuma cláusula cadastrada. Cadastre em ⚙️ Configurações → Contrato.</p>') + "</section>" +
      '<section class="assinaturas"><div><span></span>ASSINATURA DO LOCADOR</div><div><span></span>ASSINATURA DO CLIENTE</div></section>';
    document.getElementById("imprimir").disabled = false;
    document.getElementById("word").disabled = false;
  }

  // ---------- Word (.docx) ----------
  function x(s) { return esc(s); }
  function run(txt, op) {
    op = op || {};
    return "<w:r><w:rPr>" + (op.b ? "<w:b/>" : "") + '<w:sz w:val="' + (op.sz || 22) + '"/></w:rPr><w:t xml:space="preserve">' + x(txt) + "</w:t></w:r>";
  }
  function par(runs, op) {
    op = op || {};
    return "<w:p><w:pPr>" + (op.centro ? '<w:jc w:val="center"/>' : op.direita ? '<w:jc w:val="right"/>' : '<w:jc w:val="both"/>') +
      '<w:spacing w:before="' + (op.antes || 0) + '" w:after="' + (op.depois == null ? 120 : op.depois) + '"/></w:pPr>' + runs + "</w:p>";
  }
  function celula(txt, op) {
    op = op || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + op.w + '" w:type="dxa"/>' + (op.cab ? '<w:shd w:val="clear" w:color="auto" w:fill="F3EEE0"/>' : "") +
      "</w:tcPr>" + par(run(txt, { b: op.cab, sz: 20 }), { direita: op.n, depois: 40 }) + "</w:tc>";
  }
  function tabelaDocx(titulo, itens, comCodigo) {
    if (!itens.length) return "";
    var larg = comCodigo ? [800, 4900, 700, 1500, 1500] : [5700, 700, 1500, 1500];
    var borda = '<w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:left w:val="single" w:sz="4" w:color="BBBBBB"/><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:right w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideH w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideV w:val="single" w:sz="4" w:color="BBBBBB"/>';
    var linha = function (cels, cab) {
      return "<w:tr>" + cels.map(function (t, i) { return celula(t, { w: larg[i], cab: cab, n: i >= cels.length - 3 && i > 0 }); }).join("") + "</w:tr>";
    };
    var cab = (comCodigo ? ["Cód."] : []).concat(["Descrição", "Qtd", "Valor unit.", "Total"]);
    return par(run(titulo.toUpperCase() + ":", { b: true }), { antes: 200 }) +
      '<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:tblBorders>' + borda + "</w:tblBorders></w:tblPr><w:tblGrid>" +
      larg.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>" + linha(cab, true) +
      itens.map(function (it) {
        return linha((comCodigo ? [cod(it.codigo)] : []).concat([it.nome, String(it.quantidade), brl(it.preco), brl(it.quantidade * it.preco)]));
      }).join("") + "</w:tbl>";
  }

  function documentoXml() {
    var o = dados.o, c = dados.c, m = dados.modelo, v = dados.contas;
    var logo = '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="900000" cy="900000"/><wp:docPr id="1" name="Logo"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="900000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
    var corpo = par(logo, { centro: true }) +
      par(run(m.titulo, { b: true, sz: 28 }), { centro: true, depois: 60 }) +
      par(run("Referente ao orçamento nº " + o.numero, { sz: 20 }), { centro: true, depois: 240 }) +
      campos(o, c).map(function (linha) {
        return par(linha.map(function (f, i) {
          return (i ? run("     ") : "") + run(f[0] + ": ", { b: true }) + run(f[1] || LINHA);
        }).join(""), { depois: 100 });
      }).join("") +
      tabelaDocx("Itens de decoração locados", v.itens, true) + tabelaDocx("Serviços", v.servs, false) +
      linhasTotais(v).map(function (l, i) {
        return par(run(l[0] + ": ", { b: true }) + run(l[1], { b: l[2] }), { direita: true, antes: i ? 0 : 200, depois: 40 });
      }).join("") +
      (o.observacoes ? par(run("OBSERVAÇÕES: ", { b: true }) + run(o.observacoes), { antes: 200 }) : "") +
      par(run("CLÁUSULAS:", { b: true }), { antes: 300 }) +
      paragrafos(m.clausulas).map(function (p) { return par(run(p, { sz: 20 })); }).join("") +
      par(run("________________________________________________"), { centro: true, antes: 600, depois: 0 }) +
      par(run("ASSINATURA DO LOCADOR", { b: true, sz: 20 }), { centro: true }) +
      par(run("________________________________________________"), { centro: true, antes: 600, depois: 0 }) +
      par(run("ASSINATURA DO CLIENTE", { b: true, sz: 20 }), { centro: true });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      "<w:body>" + corpo + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1000" w:left="1100" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }

  var ARQUIVOS_FIXOS = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>',
    "word/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>'
  };

  // ZIP simples (sem compressão), suficiente para o Word abrir.
  var TABELA_CRC = (function () {
    var t = [], c;
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(arquivos) {
    var enc = new TextEncoder(), partes = [], central = [], pos = 0;
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; };
    var u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    arquivos.forEach(function (a) {
      var nome = enc.encode(a.nome), dadosA = a.dados, crc = crc32(dadosA);
      var comum = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(dadosA.length), u32(dadosA.length), u16(nome.length), u16(0));
      var local = new Uint8Array([].concat(u32(0x04034b50), comum));
      partes.push(local, nome, dadosA);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), comum, u16(0), u16(0), u16(0), u32(0), u32(pos))), nome);
      pos += local.length + nome.length + dadosA.length;
    });
    var tamCentral = central.reduce(function (s, p) { return s + p.length; }, 0);
    var fim = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(arquivos.length), u16(arquivos.length), u32(tamCentral), u32(pos), u16(0)));
    return new Blob(partes.concat(central, [fim]), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  function baixarWord() {
    var b = document.getElementById("word");
    b.disabled = true;
    fetch("../img/logo.png").then(function (r) { return r.arrayBuffer(); }).then(function (logo) {
      var enc = new TextEncoder();
      var arquivos = Object.keys(ARQUIVOS_FIXOS).map(function (n) { return { nome: n, dados: enc.encode(ARQUIVOS_FIXOS[n]) }; });
      arquivos.push({ nome: "word/document.xml", dados: enc.encode(documentoXml()) });
      arquivos.push({ nome: "word/media/logo.png", dados: new Uint8Array(logo) });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(zip(arquivos));
      var nome = (dados.c ? dados.c.nome : dados.o.cliente_nome) || "";
      a.download = "Contrato " + dados.o.numero + (nome ? " - " + nome.replace(/[\\/:*?"<>|]/g, "") : "") + ".docx";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(function (e) {
      console.error(e);
      alert("Não foi possível gerar o arquivo Word. Tente de novo.");
    }).finally(function () { b.disabled = false; });
  }

  document.getElementById("imprimir").addEventListener("click", function () { window.print(); });
  document.getElementById("word").addEventListener("click", baixarWord);

  var id = new URLSearchParams(location.search).get("id");
  if (!id) { erro("Orçamento não informado."); return; }

  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { erro("Entre na área da administradora primeiro e depois abra o contrato de novo."); return; }
    return Promise.all([
      sb.from("orcamentos").select("*, clientes(*)").eq("id", id).maybeSingle(),
      sb.from("configuracoes").select("*").eq("id", 1).single(),
      sb.from("contrato_modelo").select("*").eq("id", 1).maybeSingle()
    ]).then(function (res) {
      res.forEach(function (x) { if (x.error) throw x.error; });
      var o = res[0].data;
      if (!o) { erro("Orçamento não encontrado (ele pode ter sido excluído)."); return; }
      if (o.situacao !== "aprovado") { erro("Este orçamento ainda não está aprovado. Marque como \"Aprovado\" para gerar o contrato."); return; }
      var modelo = res[2].data || { titulo: "CONTRATO DE LOCAÇÃO", clausulas: "", percentual_sinal: 0 };
      dados = { o: o, c: o.clientes, conf: res[1].data, modelo: modelo, contas: calcular(o, modelo.percentual_sinal) };
      montarFolha();
    });
  }).catch(function (e) {
    console.error(e);
    erro("Não foi possível abrir o contrato. Verifique a internet e tente de novo.");
  });
})();
