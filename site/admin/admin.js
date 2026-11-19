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

  var st = { cats: [], prods: [], conf: null, clientes: [], orcs: [], contrato: null };
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
      sb.from("configuracoes").select("*").eq("id", 1).single(),
      sb.from("clientes").select("*").order("nome"),
      sb.from("orcamentos").select("*").order("numero", { ascending: false }),
      sb.from("contrato_modelo").select("*").eq("id", 1).maybeSingle(),
      sb.from("chacara_pagina").select("*").eq("id", 1).maybeSingle()
    ]).then(function (r) {
      st.cats = ok(r[0]);
      st.prods = ok(r[1]);
      st.conf = ok(r[2]);
      st.clientes = ok(r[3]);
      st.orcs = ok(r[4]);
      st.contrato = ok(r[5]);
      st.chacara = ok(r[6]) || { id: 1, titulo: "", chamada: "", descricao: "", endereco: "", mostrar_endereco: true, fotos: [] };
      preencherChacara();
      desenharTudo();
    }).catch(falhou);
  }

  // ---------- Aba Chácara (página de aluguel) ----------
  var formCh = $("#form-chacara");

  function preencherChacara() {
    var c = st.chacara;
    ["titulo", "chamada", "descricao", "endereco"].forEach(function (k) { formCh[k].value = c[k] || ""; });
    formCh.mostrar_endereco.checked = c.mostrar_endereco !== false;
    desenharFotosChacara();
  }

  function desenharFotosChacara() {
    var fotos = st.chacara.fotos || [];
    $("#ch-fotos").innerHTML = fotos.map(function (f, i) {
      return '<li data-f="' + i + '"><img src="' + esc(fotoUrl(f.imagem)) + '" alt="Foto ' + (i + 1) + ' da chácara" loading="lazy">' +
        (i === 0 ? '<span class="dica" style="margin:6px 8px 0">⭐ Capa</span>' : "") +
        '<input data-legenda maxlength="120" placeholder="Legenda (ex.: Piscina)" value="' + esc(f.legenda || "") + '" aria-label="Legenda da foto ' + (i + 1) + '">' +
        '<div class="item-acoes">' +
        '<button class="btn" type="button" data-acao="subir" aria-label="Para trás"' + (i === 0 ? " disabled" : "") + ">◀</button>" +
        '<button class="btn" type="button" data-acao="excluir" aria-label="Remover foto">🗑️</button>' +
        '<button class="btn" type="button" data-acao="descer" aria-label="Para frente"' + (i === fotos.length - 1 ? " disabled" : "") + ">▶</button>" +
        "</div></li>";
    }).join("") || '<li class="dica">Nenhuma foto ainda.</li>';
  }

  function gravarChacara(dados) {
    return sb.from("chacara_pagina").update(dados).eq("id", 1).select().single().then(ok).then(function (novo) {
      st.chacara = novo;
      return novo;
    });
  }

  formCh.addEventListener("submit", function (e) {
    e.preventDefault();
    var dados = {
      titulo: formCh.titulo.value.trim(), chamada: formCh.chamada.value.trim(),
      descricao: formCh.descricao.value.trim(), endereco: formCh.endereco.value.trim(),
      mostrar_endereco: formCh.mostrar_endereco.checked
    };
    if (!dados.titulo) { avisar("Preencha o título.", true); return; }
    ocupado($('button[type="submit"]', formCh), gravarChacara(dados).then(function () { avisar("Página da chácara salva!"); })).catch(falhou);
  });

  $("#ch-fotos").addEventListener("change", function (e) {
    if (!e.target.matches("[data-legenda]")) return;
    var i = Number(e.target.closest("[data-f]").dataset.f);
    var fotos = JSON.parse(JSON.stringify(st.chacara.fotos));
    fotos[i].legenda = e.target.value.trim();
    gravarChacara({ fotos: fotos }).then(function () { avisar("Legenda salva."); }).catch(falhou);
  });

  $("#ch-fotos").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]");
    if (!b) return;
    var i = Number(b.closest("[data-f]").dataset.f);
    var fotos = JSON.parse(JSON.stringify(st.chacara.fotos));
    if (b.dataset.acao === "excluir") {
      confirmar("Remover esta foto da página da chácara?", "Remover").then(function (sim) {
        if (!sim) return;
        var tirada = fotos.splice(i, 1)[0];
        return gravarChacara({ fotos: fotos }).then(function () {
          apagarFoto(tirada.imagem);
          desenharFotosChacara();
          avisar("Foto removida.");
        });
      }).catch(falhou);
      return;
    }
    var j = i + (b.dataset.acao === "subir" ? -1 : 1);
    if (j < 0 || j >= fotos.length) return;
    var x = fotos[i]; fotos[i] = fotos[j]; fotos[j] = x;
    ocupado(b, gravarChacara({ fotos: fotos }).then(desenharFotosChacara)).catch(falhou);
  });

  $("#ch-fotos-add").addEventListener("change", function (e) {
    var arquivos = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    if (!arquivos.length) return;
    var novas = [];
    avisar("Enviando " + arquivos.length + " foto(s)… não feche a página.");
    arquivos.reduce(function (cadeia, arq) {
      return cadeia.then(function () {
        return reduzirFoto(arq, 1600).then(function (b) { return enviarFoto("chacara", b); })
          .then(function (caminho) { novas.push({ imagem: caminho, legenda: "" }); })
          .catch(function (er) { falhou(er); });
      });
    }, Promise.resolve()).then(function () {
      if (!novas.length) return;
      return gravarChacara({ fotos: (st.chacara.fotos || []).concat(novas) }).then(function () {
        desenharFotosChacara();
        avisar(novas.length + " foto(s) adicionada(s).");
      });
    }).catch(falhou);
  });

  $("#ch-pacotes").addEventListener("click", function () {
    var c = st.cats.filter(function (x) { return x.tipo === "chacara"; })[0];
    $('.abas [data-aba="produtos"]').click();
    if (c) { $("#filtro-cat").value = String(c.id); desenharProdutos(); }
  });

  // ---------- Aba Agenda ----------
  (function () {
    var hoje = hojeISO();
    $("#ag-de").value = hoje;
    $("#ag-ate").value = window.TF_AGENDA.somaDias(hoje, 30);
  })();

  function desenharAgenda() {
    if (!st.orcs) return;
    var f = { de: $("#ag-de").value, ate: $("#ag-ate").value, ver: $("#ag-ver").value, sit: $("#ag-sit").value };
    var r = window.TF_AGENDA.montar({ orcs: st.orcs, clientes: st.clientes, prods: st.prods }, f);
    $("#agenda-res").innerHTML = r.html;
    $("#ag-imprimir").href = "agenda.html?de=" + f.de + "&ate=" + f.ate + "&ver=" + f.ver + "&sit=" + f.sit;
  }

  ["#ag-de", "#ag-ate", "#ag-ver", "#ag-sit"].forEach(function (id) { $(id).addEventListener("change", desenharAgenda); });
  $('.abas [data-aba="agenda"]').addEventListener("click", desenharAgenda);

  function desenharTudo() {
    preencherFiltroCategorias();
    desenharProdutos();
    desenharCategorias();
    desenharInspiracoes();
    preencherConfig();
    preencherContrato();
    desenharClientes();
    desenharOrcamentos();
  }

  function cat(id) {
    for (var i = 0; i < st.cats.length; i++) if (st.cats[i].id === id) return st.cats[i];
    return null;
  }
  // Todas as categorias, inclusive a galeria (as inspirações também são produtos).
  function catsDeProduto() { return st.cats; }
  function categoriaGaleria() { return st.cats.filter(function (c) { return c.tipo === "galeria"; })[0] || null; }
  // Fotos de inspiração = produtos da categoria do tipo "galeria", na ordem.
  function inspiracoes() {
    var g = categoriaGaleria();
    return g ? produtosDaCategoria(g.id) : [];
  }
  function produtosDaCategoria(id) {
    return st.prods.filter(function (p) { return p.categoria_id === id; })
      .sort(function (a, b) { return a.ordem - b.ordem || a.nome.localeCompare(b.nome); });
  }

  // ---------- Produtos ----------
  function preencherFiltroCategorias() {
    var sel = $("#filtro-cat");
    var atual = sel.value;
    sel.innerHTML = '<option value="">Todas as categorias</option>' + catsDeProduto().map(function (c) {
      return '<option value="' + c.id + '">' + esc(c.nome) + " (" + produtosDaCategoria(c.id).length + ")</option>";
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
      var c = cat(p.categoria_id) || { nome: "?" };
      return '<li class="item' + (p.ativo ? "" : " oculto") + '" data-id="' + esc(p.id) + '">' +
        '<div class="mini">' + (p.imagem ? '<img src="' + esc(fotoUrl(p.imagem)) + '" alt="" loading="lazy">' : "📷") + "</div>" +
        '<div class="item-info"><b><span class="cod">Cód. ' + cod(p.codigo) + "</span> " + esc(p.nome) +
        (p.ativo ? "" : ' <span class="selo">OCULTO</span>') + "</b>" +
        (p.kit_itens && p.kit_itens.length ? '<span class="selo-kit">📦 Kit com ' + p.kit_itens.length + " itens</span>" : "") +
        "<span>" + esc(c.nome) + " · Quant: " + esc(p.quantidade == null ? 1 : p.quantidade) + (p.preco != null ? " · " + brl(p.preco) + (p.mostrar_preco ? "" : " (preço escondido no site)") : "") +
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
  $("#filtro-cat").addEventListener("change", function () {
    desenharProdutos();
    // O relatório já abre com a mesma categoria escolhida aqui.
    var c = $("#filtro-cat").value;
    $("#relatorio-produtos").href = "relatorio.html" + (c ? "?cat=" + encodeURIComponent(c) : "");
  });

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
      desenharInspiracoes();
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
        desenharInspiracoes();
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
      return '<option value="' + c.id + '">' + esc(c.nome) + "</option>";
    }).join("") + '<option value="nova">➕ Criar nova categoria…</option>';
    if (selecionada) formP.categoria_id.value = String(selecionada);
    $("#nova-cat-campos").hidden = formP.categoria_id.value !== "nova";
  }

  function previa(url) {
    $("#prev-produto").innerHTML = url ? '<img src="' + esc(url) + '" alt="Prévia da foto">' : "📷";
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
      formP.quantidade.value = p.quantidade == null ? 1 : p.quantidade;
    }
    previa(p && p.imagem ? fotoUrl(p.imagem) : "");
    kitEdit = JSON.parse(JSON.stringify((p && p.kit_itens) || []));
    $("#kit-busca").value = "";
    $("#kit-sugestoes").innerHTML = "";
    var g = categoriaGaleria();
    $("#kit-box").open = kitEdit.length > 0 || !!(g && formP.categoria_id.value === String(g.id));
    desenharKit();
    $("#dlg-produto").showModal();
  }

  $("#novo-produto").addEventListener("click", function () { abrirProduto(null); });

  // ---------- Itens do kit ----------
  var kitEdit = [];

  function desenharKit() {
    $("#kit-lista").innerHTML = kitEdit.map(function (k, i) {
      return '<li data-k="' + i + '"><span>' + (k.codigo != null ? '<span class="cod">Cód. ' + cod(k.codigo) + "</span> " : "") + esc(k.nome) + "</span>" +
        '<input type="number" min="1" max="999" inputmode="numeric" value="' + esc(k.quantidade) + '" aria-label="Quantidade de ' + esc(k.nome) + '">' +
        '<button class="btn" type="button" data-k-tirar aria-label="Tirar ' + esc(k.nome) + ' do kit">✖</button></li>';
    }).join("") || '<li class="dica" style="display:block;border:0">Nenhum item no kit.</li>';
  }

  function sugestoesKit() {
    var t = $("#kit-busca").value.trim().toLowerCase();
    if (!t) return [];
    var este = produtoEditando && produtoEditando.id;
    return st.prods.filter(function (p) {
      if (p.id === este || (p.kit_itens && p.kit_itens.length)) return false;
      var c = cat(p.categoria_id);
      if (c && c.tipo !== "produtos") return false;
      return cod(p.codigo).indexOf(t) === 0 || p.nome.toLowerCase().indexOf(t) >= 0;
    }).slice(0, 8);
  }

  function adicionarAoKit(p) {
    var ja = kitEdit.filter(function (k) { return k.produto_id === p.id; })[0];
    if (ja) ja.quantidade = (Number(ja.quantidade) || 0) + 1;
    else kitEdit.push({ produto_id: p.id, codigo: p.codigo, nome: p.nome, quantidade: 1 });
    $("#kit-busca").value = "";
    $("#kit-sugestoes").innerHTML = "";
    desenharKit();
    $("#kit-busca").focus();
  }

  $("#kit-busca").addEventListener("input", function () {
    $("#kit-sugestoes").innerHTML = sugestoesKit().map(function (p) {
      return '<li><button type="button" data-id="' + esc(p.id) + '"><span class="cod">Cód. ' + cod(p.codigo) + "</span><span>" + esc(p.nome) + "</span></button></li>";
    }).join("");
  });
  $("#kit-busca").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var p = sugestoesKit()[0];
    if (p) adicionarAoKit(p);
  });
  $("#kit-sugestoes").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]");
    if (b) adicionarAoKit(produtoPorId(b.dataset.id));
  });
  $("#kit-lista").addEventListener("input", function (e) {
    var li = e.target.closest("[data-k]");
    if (li) kitEdit[Number(li.dataset.k)].quantidade = parseInt(e.target.value, 10) || 0;
  });
  $("#kit-lista").addEventListener("click", function (e) {
    var b = e.target.closest("[data-k-tirar]");
    if (!b) return;
    kitEdit.splice(Number(b.closest("[data-k]").dataset.k), 1);
    desenharKit();
  });

  function lerKit() {
    return kitEdit.map(function (k) {
      var q = Number(k.quantidade);
      if (!Number.isInteger(q) || q < 1 || q > 999) throw new Error('Quantidade inválida no kit: "' + k.nome + '".');
      var p = produtoPorId(k.produto_id);
      return { produto_id: k.produto_id, codigo: p ? p.codigo : k.codigo, nome: p ? p.nome : k.nome, quantidade: q };
    });
  }

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
    previa("");
  });

  $$("[data-fechar]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });

  function lerPreco(txt) {
    if (!txt.trim()) return null;
    return lerValor(txt, "Preço");
  }

  function lerQuantidade(txt) {
    var n = Number(String(txt).trim());
    if (String(txt).trim() === "" || !Number.isInteger(n) || n < 0 || n > 99999) {
      throw new Error("Quant inválida. Use só números inteiros, ex.: 1, 2, 10");
    }
    return n;
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
      mostrar_preco: formP.mostrar_preco.checked,
      quantidade: lerQuantidade(formP.quantidade.value),
      kit_itens: lerKit()
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
      desenharInspiracoes();
      avisar(p ? "Produto salvo." : "Produto incluído.");
    });
  }

  function obterCategoria() {
    if (formP.categoria_id.value !== "nova") return Promise.resolve(Number(formP.categoria_id.value));
    var nome = formP.nova_cat_nome.value.trim();
    if (!nome) return Promise.reject(new Error("Digite o nome da nova categoria."));
    return criarCategoria(nome).then(function (c) { return c.id; });
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
  function reduzirFoto(arq, lado) {
    if (TIPOS_FOTO.indexOf(arq.type) < 0) return Promise.reject(new Error("Escolha uma foto JPG, PNG ou WebP."));
    if (arq.size > MAX_ENVIO) return Promise.reject(new Error("Essa foto passa de 15 MB. Escolha uma menor."));
    return carregarImagem(arq).then(function (img) {
      var escala = Math.min(1, (lado || MAX_LADO) / Math.max(img.naturalWidth, img.naturalHeight));
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
        '<div class="mini">' + (galeria ? "📸" : "🗂️") + "</div>" +
        '<div class="item-info"><b>' + esc(c.nome) + "</b><span>" +
        (galeria ? "Galeria de fotos (" + n + " fotos)" : n + (n === 1 ? " produto" : " produtos")) + "</span></div>" +
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

  function criarCategoria(nome) {
    var ordem = st.cats.reduce(function (m, x) { return Math.max(m, x.ordem); }, 0) + 1;
    return sb.from("categorias").insert({ nome: nome, tipo: "produtos", ordem: ordem })
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
    $("#dlg-categoria").showModal();
  }

  $("#nova-categoria").addEventListener("click", function () { abrirCategoria(null); });

  formC.addEventListener("submit", function (e) {
    e.preventDefault();
    var nome = formC.nome.value.trim();
    var c = categoriaEditando;
    var acao = c
      ? sb.from("categorias").update({ nome: nome }).eq("id", c.id).select().single().then(ok)
          .then(function (novo) { Object.assign(c, novo); desenharTudo(); })
      : criarCategoria(nome);
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
  // Cada foto é um produto da categoria-galeria: tem código, nome, descrição (legenda) e preço.
  function desenharInspiracoes() {
    var lista = inspiracoes();
    $("#lista-insp").innerHTML = lista.map(function (x, i) {
      return '<li data-id="' + esc(x.id) + '"' + (x.ativo ? "" : ' class="oculto"') + '><img src="' + esc(fotoUrl(x.imagem)) + '" alt="Inspiração ' + (i + 1) + '" loading="lazy">' +
        '<div class="insp-info"><b><span class="cod">Cód. ' + cod(x.codigo) + "</span> " + esc(x.nome) + "</b>" +
        (x.ativo ? "" : ' <span class="selo">OCULTO</span>') +
        (x.descricao ? "<span>" + esc(x.descricao) + "</span>" : "") +
        (x.preco != null ? "<span>" + brl(x.preco) + (x.mostrar_preco ? "" : " (escondido)") + "</span>" : "") + "</div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="editar">✏️ Editar</button>' +
        '<button class="btn" data-acao="subir" aria-label="Para trás"' + (i === 0 ? " disabled" : "") + ">◀</button>" +
        '<button class="btn" data-acao="excluir" aria-label="Remover foto">🗑️</button>' +
        '<button class="btn" data-acao="descer" aria-label="Para frente"' + (i === lista.length - 1 ? " disabled" : "") + ">▶</button>" +
        "</div></li>";
    }).join("") || '<li class="dica">Nenhuma foto ainda.</li>';
  }

  $("#lista-insp").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-acao]");
    if (!b) return;
    var x = produtoPorId(b.closest("[data-id]").dataset.id);
    var acao = b.dataset.acao;
    if (acao === "editar") abrirProduto(x);
    else if (acao === "subir" || acao === "descer") {
      var lista = inspiracoes();
      if (!mover(lista, x, acao === "subir" ? -1 : 1)) return;
      ocupado(b, gravarOrdem("produtos", lista).then(desenharInspiracoes)
        .catch(function (er) { falhou(er); return carregarTudo(); }));
    } else if (acao === "excluir") excluirProduto(x);
  });

  $("#fotos-insp").addEventListener("change", function (e) {
    var arquivos = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    if (!arquivos.length) return;
    var g = categoriaGaleria();
    if (!g) { avisar("A categoria de inspirações não foi encontrada.", true); return; }
    var legenda = $("#legenda-nova").value;
    var ordem = inspiracoes().reduce(function (m, x) { return Math.max(m, x.ordem); }, 0);
    var feitas = 0;
    avisar("Enviando " + arquivos.length + (arquivos.length === 1 ? " foto…" : " fotos…"));
    arquivos.reduce(function (cadeia, arq) {
      return cadeia.then(function () {
        return reduzirFoto(arq).then(function (b) { return enviarFoto("inspiracoes", b); }).then(function (caminho) {
          ordem += 1;
          return sb.from("produtos").insert({ categoria_id: g.id, nome: "Decoração completa", descricao: legenda, imagem: caminho, ordem: ordem })
            .select().single().then(function (r) {
              if (r.error) apagarFoto(caminho);
              return ok(r);
            });
        }).then(function (nova) {
          st.prods.push(nova);
          feitas += 1;
          desenharInspiracoes();
        }).catch(function (er) { falhou(er); });
      });
    }, Promise.resolve()).then(function () {
      desenharCategorias();
      preencherFiltroCategorias();
      desenharProdutos();
      if (feitas) avisar(feitas + (feitas === 1 ? " foto adicionada." : " fotos adicionadas.") + ' Toque em "Editar" para colocar nome e preço.');
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
    formCfg.indicacao_ativa.checked = c.indicacao_ativa !== false;
    formCfg.indicacao_credito_pct.value = c.indicacao_credito_pct == null ? 10 : c.indicacao_credito_pct;
    formCfg.indicacao_desconto_pct.value = c.indicacao_desconto_pct == null ? 5 : c.indicacao_desconto_pct;
    formCfg.indicacao_validade_meses.value = c.indicacao_validade_meses == null ? 6 : c.indicacao_validade_meses;
  }

  function lerInteiro(txt, campo, min, max) {
    var n = Number(String(txt).trim());
    if (String(txt).trim() === "" || !Number.isInteger(n) || n < min || n > max) {
      throw new Error(campo + ": use um número inteiro de " + min + " a " + max + ".");
    }
    return n;
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
        mostrar_precos: formCfg.mostrar_precos.checked,
        indicacao_ativa: formCfg.indicacao_ativa.checked,
        indicacao_credito_pct: lerInteiro(formCfg.indicacao_credito_pct.value, "Crédito para quem indica", 0, 100),
        indicacao_desconto_pct: lerInteiro(formCfg.indicacao_desconto_pct.value, "Desconto para quem foi indicado", 0, 100),
        indicacao_validade_meses: lerInteiro(formCfg.indicacao_validade_meses.value, "Validade do crédito", 1, 60)
      };
      return sb.from("configuracoes").update(dados).eq("id", 1).select().single().then(ok);
    }).then(function (c) {
      st.conf = c;
      preencherConfig();
      avisar("Configurações salvas.");
    });
    ocupado($('button[type="submit"]', formCfg), acao.catch(falhou));
  });

  // ---------- Modelo do contrato ----------
  var formCt = $("#form-contrato");

  var formCtCh = $("#form-contrato-chacara");

  function preencherContrato() {
    var c = st.contrato || { titulo: "", clausulas: "", percentual_sinal: 50 };
    formCt.titulo.value = c.titulo;
    formCt.clausulas.value = c.clausulas;
    formCt.percentual_sinal.value = c.percentual_sinal;
    formCtCh.chacara_titulo.value = c.chacara_titulo || "CONTRATO DE LOCAÇÃO – ESPAÇO PARA EVENTOS";
    formCtCh.chacara_clausulas.value = c.chacara_clausulas || "";
    formCtCh.chacara_percentual_sinal.value = c.chacara_percentual_sinal == null ? 50 : c.chacara_percentual_sinal;
  }

  formCtCh.addEventListener("submit", function (e) {
    e.preventDefault();
    var acao = Promise.resolve().then(function () {
      var pct = Number(formCtCh.chacara_percentual_sinal.value);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error("O sinal deve ser um número de 0 a 100.");
      var dados = { chacara_titulo: formCtCh.chacara_titulo.value.trim(), chacara_clausulas: formCtCh.chacara_clausulas.value.trim(), chacara_percentual_sinal: pct };
      if (!dados.chacara_titulo) throw new Error("Preencha o título do contrato da chácara.");
      return sb.from("contrato_modelo").update(dados).eq("id", 1).select().single().then(ok);
    }).then(function (c) {
      st.contrato = c;
      preencherContrato();
      avisar("Contrato da chácara salvo.");
    });
    ocupado($('button[type="submit"]', formCtCh), acao.catch(falhou));
  });

  formCt.addEventListener("submit", function (e) {
    e.preventDefault();
    var acao = Promise.resolve().then(function () {
      var pct = Number(formCt.percentual_sinal.value);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new Error("O sinal deve ser um número de 0 a 100.");
      var dados = { id: 1, titulo: formCt.titulo.value.trim(), clausulas: formCt.clausulas.value.trim(), percentual_sinal: pct };
      if (!dados.titulo) throw new Error("Preencha o título do contrato.");
      return sb.from("contrato_modelo").upsert(dados, { onConflict: "id" }).select().single().then(ok);
    }).then(function (c) {
      st.contrato = c;
      preencherContrato();
      avisar("Contrato salvo.");
    });
    ocupado($('button[type="submit"]', formCt), acao.catch(falhou));
  });

  // ---------- Cópia de segurança ----------
  $("#exportar").addEventListener("click", function (e) {
    var b = e.currentTarget;
    ocupado(b, carregarTudo().then(function () {
      var copia = {
        sistema: "catalogo-top-fest",
        versao: 5,
        exportado_em: new Date().toISOString(),
        endereco_fotos: fotoUrl("x").replace(/x$/, ""),
        configuracoes: st.conf,
        categorias: st.cats,
        produtos: st.prods,
        clientes: st.clientes,
        orcamentos: st.orcs,
        contrato_modelo: st.contrato,
        chacara_pagina: st.chacara
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
      if (!c || c.sistema !== "catalogo-top-fest" || !Array.isArray(c.categorias) || !Array.isArray(c.produtos)) {
        throw new Error("Esse arquivo não é uma cópia do catálogo Top Fest.");
      }
      var quando = c.exportado_em ? new Date(c.exportado_em).toLocaleString("pt-BR") : "data desconhecida";
      return confirmar("Restaurar a cópia de " + quando + "? (" + c.categorias.length + " categorias, " +
        c.produtos.length + " produtos" + (c.inspiracoes && c.inspiracoes.length ? ", " + c.inspiracoes.length + " fotos de inspiração" : "") +
        (c.clientes ? ", " + c.clientes.length + " clientes, " + (c.orcamentos || []).length + " orçamentos" : "") + ")", "Restaurar").then(function (sim) {
        if (sim) return restaurar(c);
      });
    }).catch(falhou);
  });

  function restaurar(c) {
    avisar("Restaurando… não feche a página.");
    var idNovo = {};
    var cfg = c.configuracoes || {};
    var cfgNova = {
      whatsapp_orcamentos: cfg.whatsapp_orcamentos,
      whatsapp_exibicao: cfg.whatsapp_exibicao || "",
      telefone_secundario: cfg.telefone_secundario || "",
      mostrar_precos: !!cfg.mostrar_precos
    };
    // Cópias antigas não têm o programa de indicação: fica como está.
    ["indicacao_ativa", "indicacao_credito_pct", "indicacao_desconto_pct", "indicacao_validade_meses"].forEach(function (k) {
      if (cfg[k] != null) cfgNova[k] = cfg[k];
    });
    return sb.from("configuracoes").update(cfgNova).eq("id", 1).then(ok).then(function () {
      // Página da chácara (cópias a partir da versão 5).
      var ch = c.chacara_pagina;
      if (!ch) return;
      return sb.from("chacara_pagina").upsert({
        id: 1, titulo: ch.titulo || "", chamada: ch.chamada || "", descricao: ch.descricao || "",
        endereco: ch.endereco || "", mostrar_endereco: ch.mostrar_endereco !== false, fotos: ch.fotos || []
      }).then(ok);
    }).then(function () {
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
        if (p.quantidade != null) linha.quantidade = p.quantidade;
        if (Array.isArray(p.kit_itens)) linha.kit_itens = p.kit_itens;
        if (p.codigo != null) linha.codigo = p.codigo;
        return linha;
      }), { onConflict: "id", defaultToNull: false }).then(ok);
    }).then(function () {
      // Cópias antigas (até a versão 2): as inspirações vinham separadas; viram produtos da galeria.
      if (!c.inspiracoes || !c.inspiracoes.length) return;
      return carregarTudo().then(function () {
        var g = categoriaGaleria();
        if (!g) return;
        return sb.from("produtos").upsert(c.inspiracoes.map(function (x) {
          return { id: x.id, categoria_id: g.id, nome: "Decoração completa", descricao: x.legenda || "", imagem: x.imagem, ordem: x.ordem };
        }), { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }).then(ok);
      });
    }).then(function () {
      if (!c.clientes || !c.clientes.length) return;
      return sb.from("clientes").upsert(c.clientes.map(function (x) {
        var linha = {
          id: x.id, nome: x.nome, whatsapp: x.whatsapp || "", documento: x.documento || "", email: x.email || "",
          cep: x.cep || "", endereco: x.endereco || "", bairro: x.bairro || "", cidade: x.cidade || "",
          observacoes: x.observacoes || "", rg: x.rg || ""
        };
        // Mantém o código do link de indicação que o cliente já recebeu.
        if (x.codigo_indicacao) linha.codigo_indicacao = x.codigo_indicacao;
        return linha;
      }), { onConflict: "id", defaultToNull: false }).then(ok);
    }).then(function () {
      if (!c.orcamentos || !c.orcamentos.length) return;
      return sb.from("orcamentos").upsert(c.orcamentos.map(function (x) {
        return {
          id: x.id, numero: x.numero, cliente_id: x.cliente_id || null, cliente_nome: x.cliente_nome || "",
          data_evento: x.data_evento || null, itens: x.itens || [], desconto: x.desconto || 0,
          taxa_entrega: x.taxa_entrega || 0, observacoes: x.observacoes || "", criado_em: x.criado_em,
          situacao: x.situacao || "aberto", data_retirada: x.data_retirada || null, data_devolucao: x.data_devolucao || null,
          indicado_por: x.indicado_por || null, desconto_indicacao_pct: x.desconto_indicacao_pct || 0,
          credito_usado: x.credito_usado || 0, credito_pct: x.credito_pct == null ? null : x.credito_pct,
          credito_em: x.credito_em || null, credito_validade: x.credito_validade || null
        };
      }), { onConflict: "id" }).then(ok);
    }).then(function () {
      var ct = c.contrato_modelo;
      if (!ct) return;
      var linhaCt = { id: 1, titulo: ct.titulo, clausulas: ct.clausulas || "", percentual_sinal: ct.percentual_sinal };
      if (ct.chacara_titulo != null) {
        linhaCt.chacara_titulo = ct.chacara_titulo;
        linhaCt.chacara_clausulas = ct.chacara_clausulas || "";
        linhaCt.chacara_percentual_sinal = ct.chacara_percentual_sinal;
      }
      return sb.from("contrato_modelo").upsert(linhaCt, { onConflict: "id" }).then(ok);
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

  // ---------- Indicação e crédito ----------
  function primeiroNome(n) { return String(n || "").trim().split(/\s+/)[0]; }
  function centavos(v) { return Math.round((Number(v) || 0) * 100); }
  function hojeISO() { return new Date().toLocaleDateString("sv-SE"); }
  function porData(campo) { return function (a, b) { return a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0; }; }

  function linkIndicacao(c) { return location.origin + "/?ind=" + encodeURIComponent(c.codigo_indicacao || ""); }

  function msgLinkIndicacao(c) {
    var cf = st.conf;
    var m = "Oi, " + primeiroNome(c.nome) + "! Obrigada por escolher a " + cf.nome + " 💛\n\n" +
      "Este é o seu link pessoal do nosso catálogo de decoração:\n" + linkIndicacao(c) + "\n\n" +
      "Compartilhe com amigos e familiares! Quando alguém alugar com a gente por este link, você ganha " +
      cf.indicacao_credito_pct + "% do valor da locação em crédito para a sua próxima festa (válido por " +
      cf.indicacao_validade_meses + (cf.indicacao_validade_meses === 1 ? " mês)" : " meses)");
    if (cf.indicacao_desconto_pct) m += ", e quem você indicou ganha " + cf.indicacao_desconto_pct + "% de desconto na primeira locação";
    return m + ".";
  }

  // Créditos de um cliente. Ganhos: orçamentos aprovados de quem ele indicou.
  // Usos: orçamentos dele (não cancelados) com crédito usado. Cada uso gasta primeiro
  // o crédito que vence antes. Valores em centavos para não errar nas contas.
  function creditos(clienteId, excetoOrcId) {
    var hoje = hojeISO();
    var ganhos = st.orcs.filter(function (o) {
      return o.indicado_por === clienteId && o.situacao === "aprovado" && centavos(o.credito_gerado) > 0;
    }).map(function (o) {
      return { orc: o, valor: centavos(o.credito_gerado), resta: centavos(o.credito_gerado), em: o.credito_em || "", validade: o.credito_validade || "" };
    }).sort(porData("validade"));
    var usos = st.orcs.filter(function (o) {
      return o.cliente_id === clienteId && o.id !== excetoOrcId && o.situacao !== "cancelado" && centavos(o.credito_usado) > 0;
    }).map(function (o) {
      return { orc: o, valor: centavos(o.credito_usado), data: String(o.criado_em || "").slice(0, 10) };
    }).sort(porData("data"));
    var semCobertura = 0;
    usos.forEach(function (u) {
      var falta = u.valor;
      ganhos.forEach(function (g) {
        if (!falta || !g.resta || g.validade < u.data) return;
        var x = Math.min(falta, g.resta);
        g.resta -= x;
        falta -= x;
      });
      semCobertura += falta;
    });
    var disponivel = 0, vencido = 0;
    ganhos.forEach(function (g) { if (g.validade >= hoje) disponivel += g.resta; else vencido += g.resta; });
    return { saldo: (disponivel - semCobertura) / 100, vencido: vencido / 100, ganhos: ganhos, usos: usos };
  }

  function extratoHtml(c) {
    var s = creditos(c.id);
    var hoje = hojeISO();
    var linhas = s.ganhos.map(function (g) {
      return { data: g.em, html: dataBR(g.em) + " – Indicou " + esc(nomeCliente(g.orc) || "um cliente") + " (orçamento nº " + g.orc.numero + "): " +
        '<span class="' + (g.validade < hoje ? "vencido" : "mais") + '">+ ' + brl(g.valor / 100) + "</span> · " +
        (g.validade < hoje ? "venceu em " : "válido até ") + dataBR(g.validade) };
    }).concat(s.usos.map(function (u) {
      return { data: u.data, html: dataBR(u.data) + " – Usou no orçamento nº " + u.orc.numero + ': <span class="menos">− ' + brl(u.valor / 100) + "</span>" };
    })).sort(porData("data"));
    if (!linhas.length) return '<p class="dica">Ainda não tem créditos. Envie o link para este cliente começar a indicar.</p>';
    return "<p><b>Saldo de crédito: " + '<span class="' + (s.saldo < 0 ? "saldo-neg" : "") + '">' + brl(s.saldo) + "</span></b>" +
      (s.saldo < 0 ? " (usou crédito de uma indicação que depois foi cancelada)" : "") + "</p>" +
      '<ul class="extrato">' + linhas.map(function (l) { return "<li>" + l.html + "</li>"; }).join("") + "</ul>";
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
      var saldo = creditos(c.id).saldo;
      var info = [telBR(c.whatsapp), c.cidade, docBR(c.documento), saldo ? "💛 Crédito: " + brl(saldo) : ""].filter(Boolean).join(" · ");
      return '<li class="item" data-id="' + esc(c.id) + '">' +
        '<div class="mini">👤</div>' +
        '<div class="item-info"><b>' + esc(c.nome) + "</b><span>" + esc(info || "Sem telefone") + "</span></div>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="editar">✏️ Editar</button>' +
        '<button class="btn" data-acao="orcamento">🧾 Novo orçamento</button>' +
        (c.whatsapp ? '<a class="btn" href="' + esc(linkWhats(c.whatsapp)) + '" target="_blank" rel="noopener">💬 WhatsApp</a>' : "") +
        (c.whatsapp
          ? '<a class="btn" href="' + esc(linkWhats(c.whatsapp, msgLinkIndicacao(c))) + '" target="_blank" rel="noopener">🔗 Enviar link de indicação</a>'
          : '<button class="btn" data-acao="copiar-link">🔗 Copiar link de indicação</button>') +
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
    else if (acao === "copiar-link") copiarLink(c);
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
    ["nome", "rg", "email", "cep", "endereco", "bairro", "cidade", "observacoes"].forEach(function (k) { formCli[k].value = v[k] || ""; });
    formCli.whatsapp.value = telBR(v.whatsapp);
    formCli.documento.value = docBR(v.documento);
    // Link de indicação e extrato (só para cliente já cadastrado).
    $("#cli-ind").hidden = !c;
    if (c) {
      $("#cli-link").value = linkIndicacao(c);
      var envia = $("#cli-enviar-link");
      envia.hidden = !c.whatsapp;
      if (c.whatsapp) envia.href = linkWhats(c.whatsapp, msgLinkIndicacao(c));
      $("#cli-extrato").innerHTML = extratoHtml(c);
    }
    $("#dlg-cliente").showModal();
  }

  function copiarLink(c) {
    var link = linkIndicacao(c);
    var feito = navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject(new Error("sem área de transferência"));
    feito.then(function () { avisar("Link copiado: " + link); })
      .catch(function () { avisar("Não deu para copiar sozinho. O link é: " + link, true); });
  }

  $("#cli-copiar").addEventListener("click", function () { if (clienteEditando) copiarLink(clienteEditando); });

  formCli.addEventListener("submit", function (e) {
    e.preventDefault();
    var acao = Promise.resolve().then(function () {
      var dados = {
        nome: formCli.nome.value.trim(),
        whatsapp: lerWhatsCliente(formCli.whatsapp.value),
        documento: lerDocumento(formCli.documento.value),
        rg: formCli.rg.value.trim(),
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
    // Desconto de indicação (%) sobre itens + serviços; crédito de indicação usado (R$).
    var pctInd = Number(o.desconto_indicacao_pct) || 0;
    var descInd = Math.round((itens + servicos) * pctInd) / 100;
    var credito = Number(o.credito_usado) || 0;
    return {
      itens: itens, servicos: servicos, desconto: desconto, taxa: taxa, pctInd: pctInd, descInd: descInd, credito: credito,
      total: Math.max(0, itens + servicos - desconto - descInd - credito + taxa)
    };
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
    if (v.desconto || v.taxa || v.descInd || v.credito) m += "\nSubtotal: " + brl(v.itens + v.servicos);
    if (v.desconto) m += "\nDesconto: - " + brl(v.desconto);
    if (v.descInd) m += "\nDesconto por indicação (" + v.pctInd + "%): - " + brl(v.descInd);
    if (v.credito) m += "\nCrédito de indicação: - " + brl(v.credito);
    if (v.taxa) m += "\nTaxa de entrega: " + brl(v.taxa);
    m += "\nTotal: " + brl(v.total) + "\n";
    if (o.observacoes) m += "\nObservações: " + o.observacoes + "\n";
    return m + "\nObrigado!";
  }

  // Orçamento com pacote da chácara e/ou itens de decoração.
  function eProdutoChacara(id) {
    var p = produtoPorId(id), c = p && cat(p.categoria_id);
    return !!(c && c.tipo === "chacara");
  }
  function tipoOrc(o) {
    var ch = false, dec = false;
    (o.itens || []).forEach(function (it) {
      if (it.tipo === "servico" || !it.produto_id) return;
      if (eProdutoChacara(it.produto_id)) ch = true; else dec = true;
    });
    return { chacara: ch, decoracao: dec };
  }

  function desenharOrcamentos() {
    var t = $("#busca-orc").value.trim().toLowerCase();
    var sit = $("#filtro-situacao").value;
    var tipo = $("#filtro-tipo").value;
    var lista = st.orcs.filter(function (o) {
      if (sit && o.situacao !== sit) return false;
      if (tipo && !tipoOrc(o)[tipo]) return false;
      return !t || String(o.numero) === t.replace(/^n[º°o]?\s*/, "") || (nomeCliente(o) || "").toLowerCase().indexOf(t) >= 0;
    });
    $("#lista-orcamentos").innerHTML = lista.map(function (o) {
      var c = cliente(o.cliente_id);
      var n = o.itens.length;
      var quem = cliente(o.indicado_por);
      var info = [o.data_evento ? "Evento: " + dataBR(o.data_evento) : "",
        tipoOrc(o).chacara && o.data_retirada && o.data_devolucao ? "Chácara: " + dataBR(o.data_retirada) + " a " + dataBR(o.data_devolucao) : "", n + (n === 1 ? " item" : " itens"), "Total: " + brl(contas(o).total),
        quem ? "Indicado por " + quem.nome + (Number(o.credito_gerado) > 0 ? " (crédito de " + brl(o.credito_gerado) + ")" : "") : ""]
        .filter(Boolean).join(" · ");
      return '<li class="item" data-id="' + esc(o.id) + '">' +
        '<div class="mini">' + (tipoOrc(o).chacara ? "🏡" : "🧾") + "</div>" +
        '<div class="item-info"><b>Nº ' + o.numero + " · " + esc(nomeCliente(o) || "Sem cliente") +
        (tipoOrc(o).chacara ? ' <span class="selo-chacara">🏡 Chácara' + (tipoOrc(o).decoracao ? " + decoração" : "") + "</span>" : "") +
        "</b><span>" + esc(info) + "</span></div>" +
        // A situação muda direto na lista (salva na hora).
        '<label class="sit-troca">Situação:<select data-acao="situacao" class="sit-' + esc(o.situacao) + '">' +
        Object.keys(SITUACOES).map(function (k) {
          return '<option value="' + k + '"' + (o.situacao === k ? " selected" : "") + ">" + SITUACOES[k] + "</option>";
        }).join("") + "</select></label>" +
        '<div class="item-acoes">' +
        '<button class="btn" data-acao="abrir">✏️ Abrir</button>' +
        '<a class="btn" href="imprimir.html?id=' + encodeURIComponent(o.id) + '" target="_blank" rel="noopener">🖨️ Imprimir / PDF</a>' +
        (o.situacao === "aprovado"
          ? '<a class="btn pri" href="contrato.html?id=' + encodeURIComponent(o.id) + '" target="_blank" rel="noopener">📄 Contrato</a>'
          : "") +
        (c && c.whatsapp
          ? '<a class="btn" href="' + esc(linkWhats(c.whatsapp, msgOrcamento(o))) + '" target="_blank" rel="noopener">💬 Enviar no WhatsApp</a>'
          : '<button class="btn" data-acao="sem-whats">💬 Enviar no WhatsApp</button>') +
        // Avisar quem indicou que ganhou crédito (só com o orçamento aprovado).
        (quem && Number(o.credito_gerado) > 0
          ? (quem.whatsapp
            ? '<a class="btn" href="' + esc(linkWhats(quem.whatsapp, msgCredito(o))) + '" target="_blank" rel="noopener">💛 Avisar ' + esc(primeiroNome(quem.nome)) + " do crédito</a>"
            : '<button class="btn" data-acao="sem-whats-ind">💛 Avisar ' + esc(primeiroNome(quem.nome)) + " do crédito</button>")
          : "") +
        '<button class="btn" data-acao="copiar">📄 Copiar</button>' +
        '<button class="btn" data-acao="excluir">🗑️ Excluir</button>' +
        "</div></li>";
    }).join("") || '<li class="dica">' + (st.orcs.length ? "Nenhum orçamento encontrado." : "Nenhum orçamento ainda.") + "</li>";
  }

  var SITUACOES = { aberto: "Em aberto", aprovado: "Aprovado", cancelado: "Cancelado" };

  function msgCredito(o) {
    var quem = cliente(o.indicado_por);
    var amigo = primeiroNome(nomeCliente(o));
    var saldo = creditos(quem.id).saldo;
    return "Oi, " + primeiroNome(quem.nome) + "! " +
      (amigo ? amigo + " alugou com a gente por indicação sua 🎉" : "Uma pessoa que você indicou alugou com a gente 🎉") + "\n\n" +
      "Você ganhou " + brl(o.credito_gerado) + " de crédito para a sua próxima festa, válido até " + dataBR(o.credito_validade) + "." +
      (saldo > Number(o.credito_gerado) ? "\nSeu saldo total de crédito é " + brl(saldo) + "." : "") +
      "\n\nMuito obrigada! 💛\n" + st.conf.nome;
  }

  $("#busca-orc").addEventListener("input", desenharOrcamentos);
  $("#filtro-situacao").addEventListener("change", desenharOrcamentos);
  $("#filtro-tipo").addEventListener("change", desenharOrcamentos);
  $("#novo-orcamento").addEventListener("click", function () { abrirOrcamento(null); });

  $("#lista-orcamentos").addEventListener("change", function (e) {
    var sel = e.target.closest('select[data-acao="situacao"]');
    if (!sel) return;
    var o = orcPorId(sel.closest("[data-id]").dataset.id);
    var nova = sel.value;
    sel.disabled = true;
    var tinhaCredito = Number(o.credito_gerado) > 0;
    sb.from("orcamentos").update({ situacao: nova }).eq("id", o.id).select().single().then(ok).then(function (novo) {
      Object.assign(o, novo);
      desenharOrcamentos();
      desenharClientes();
      var quem = cliente(o.indicado_por);
      var texto = nova === "aprovado" ? "Orçamento nº " + o.numero + ' aprovado. O botão "📄 Contrato" já está disponível.'
        : "Situação do orçamento nº " + o.numero + ": " + SITUACOES[nova] + ".";
      if (quem && Number(o.credito_gerado) > 0) {
        texto += " " + primeiroNome(quem.nome) + " ganhou " + brl(o.credito_gerado) + ' de crédito: toque em "💛 Avisar".';
      } else if (quem && tinhaCredito) {
        texto += " O crédito de " + primeiroNome(quem.nome) + " por esta indicação foi retirado.";
        if (creditos(quem.id).saldo < 0) texto += " Atenção: ela já tinha usado esse crédito.";
      }
      avisar(texto);
    }).catch(function (er) { falhou(er); desenharOrcamentos(); });
  });

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
    } else if (acao === "sem-whats-ind") {
      avisar("Quem indicou não tem WhatsApp cadastrado. Cadastre o número na aba Clientes.", true);
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
      observacoes: v.observacoes || "",
      indicado_por: v.indicado_por || null,
      desconto_indicacao_pct: Number(v.desconto_indicacao_pct) || 0,
      credito_usado: Number(v.credito_usado) || 0
    };
    formO.reset();
    $("#dlg-orcamento-tit").textContent = base ? "Orçamento nº " + base.numero : "Novo orçamento";
    opcoesCliente();
    formO.data_evento.value = orc.data_evento;
    // Situação e datas da locação vêm só do orçamento salvo (uma cópia começa "Em aberto").
    formO.situacao.value = (base && base.situacao) || "aberto";
    formO.data_retirada.value = v.data_retirada || "";
    formO.data_devolucao.value = v.data_devolucao || "";
    formO.desconto.value = numCampo(orc.desconto);
    formO.taxa_entrega.value = numCampo(orc.taxa_entrega);
    formO.observacoes.value = orc.observacoes;
    formO.credito_usado.value = numCampo(orc.credito_usado);
    opcoesIndicado();
    atualizarCredito();
    $("#orc-sugestoes").innerHTML = "";
    avisoOrc("");
    listaServicos();
    desenharAgendaDia();
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

  // ---------- Agenda: quem já está com itens fora no mesmo período ----------
  // O período vai da retirada até a devolução (sem elas, vale a data do evento).
  // Contam os orçamentos Em aberto e Aprovados (menos o que está aberto na tela).
  var AG = window.TF_AGENDA;

  function periodoForm() {
    return AG.periodo({ data_retirada: formO.data_retirada.value, data_evento: formO.data_evento.value, data_devolucao: formO.data_devolucao.value });
  }

  function orcsNoPeriodo(p) {
    if (!p) return [];
    var este = orcOriginal && orcOriginal.id;
    return st.orcs.filter(function (o) {
      return o.id !== este && o.situacao !== "cancelado" && AG.sobrepoe(AG.periodo(o), p);
    }).sort(function (a, b) { return a.numero - b.numero; });
  }

  // Unidades do produto já reservadas no dia mais cheio do período, e para quem.
  function ocupacao(produtoId, p) { return AG.reservas(orcsNoPeriodo(p), produtoId, p); }

  function estoque(p) { return AG.estoque(p); }

  function textoOcupacao(it) {
    var p = periodoForm();
    if (!p || it.tipo === "servico" || !it.produto_id || eKit(it.produto_id)) return "";
    var oc = ocupacao(it.produto_id, p);
    if (!oc.max) return "";
    var tem = estoque(produtoPorId(it.produto_id));
    var livres = Math.max(0, tem - oc.max);
    var falta = (Number(it.quantidade) || 0) > livres;
    var quem = oc.quem.map(function (x) {
      return x.q + " para " + nomeCliente(x.o) + " (nº " + x.o.numero + ", " + SITUACOES[x.o.situacao] + ", " + AG.textoPeriodo(x.p) + ")";
    }).join("; ");
    return '<div class="ocup' + (falta ? " falta" : "") + '" data-ocup>' + (falta ? "⛔ " : "⚠️ ") +
      "Já reservado neste período: " + esc(quem) + ". Vocês têm " + tem + ", livres: " + livres + "." +
      (falta ? " Não dá para atender esta quantidade." : "") + "</div>";
  }

  function desenharAgendaDia() {
    var caixa = $("#orc-agenda");
    var p = periodoForm();
    if (!p) { caixa.hidden = true; return; }
    var lista = orcsNoPeriodo(p);
    caixa.hidden = false;
    caixa.classList.toggle("livre", !lista.length);
    caixa.innerHTML = lista.length
      ? "<p>📅 <b>Já agendado em " + esc(AG.textoPeriodo(p)) + ":</b></p><ul>" + lista.map(function (o) {
          return "<li>" + esc(nomeCliente(o)) + " – nº " + o.numero + " (" + SITUACOES[o.situacao] + ") · itens fora " + esc(AG.textoPeriodo(AG.periodo(o))) + "</li>";
        }).join("") + "</ul>"
      : "<p>✅ Nenhum outro cliente com itens fora em " + esc(AG.textoPeriodo(p)) + ".</p>";
  }

  // Produtos sem unidades livres para a quantidade pedida, no período.
  function itensEmFalta() {
    var p = periodoForm();
    if (!p) return [];
    return orc.itens.filter(function (it) {
      if (it.tipo === "servico" || !it.produto_id || eKit(it.produto_id)) return false;
      var livres = estoque(produtoPorId(it.produto_id)) - ocupacao(it.produto_id, p).max;
      return (Number(it.quantidade) || 0) > livres;
    });
  }

  ["data_evento", "data_retirada", "data_devolucao"].forEach(function (k) {
    formO[k].addEventListener("change", function () {
      desenharAgendaDia();
      desenharItensOrc();
      desenharSugestoes();
    });
  });

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
        '<button class="btn" type="button" data-acao="remover" aria-label="Remover ' + esc(it.nome || "serviço") + '">✖ Remover</button>' +
        textoOcupacao(it) + "</li>";
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
      (v.descInd ? linha("Desconto por indicação (" + v.pctInd + "%)", "- " + brl(v.descInd)) : "") +
      (v.credito ? linha("Crédito de indicação usado", "- " + brl(v.credito)) : "") +
      (v.taxa ? linha("Taxa de entrega", brl(v.taxa)) : "") +
      linha("Total", brl(v.total), "total");
  }

  function adicionarProduto(p, quantidade) {
    var q = quantidade || 1;
    var ja = orc.itens.filter(function (it) { return it.produto_id === p.id; })[0];
    if (ja) ja.quantidade = (Number(ja.quantidade) || 0) + q;
    else orc.itens.push({ tipo: "produto", produto_id: p.id, codigo: p.codigo, nome: p.nome, quantidade: q, preco: Number(p.preco) || 0 });
    // Kit: os itens dele entram separados, com valor 0 (o valor fica no kit), para a agenda saber o que sai.
    (p.kit_itens || []).forEach(function (k) {
      var comp = produtoPorId(k.produto_id) || { id: k.produto_id, codigo: k.codigo, nome: k.nome };
      var n = (Number(k.quantidade) || 1) * q;
      var j = orc.itens.filter(function (it) { return it.produto_id === comp.id; })[0];
      if (j) j.quantidade = (Number(j.quantidade) || 0) + n;
      else orc.itens.push({ tipo: "produto", produto_id: comp.id, codigo: comp.codigo, nome: comp.nome, quantidade: n, preco: 0 });
    });
  }

  // Kit não conta como peça na agenda: contam os itens dele.
  function eKit(id) {
    var p = produtoPorId(id);
    return !!(p && p.kit_itens && p.kit_itens.length);
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

  function etiquetaOcupacao(p) {
    var per = periodoForm();
    if (!per || (p.kit_itens && p.kit_itens.length)) return "";
    var oc = ocupacao(p.id, per).max;
    if (!oc) return "";
    var livres = Math.max(0, estoque(p) - oc);
    return '<span class="ocup-tag">' + (livres ? "⚠️ " + livres + " livre(s) no período" : "⛔ ocupado no período") + "</span>";
  }

  function desenharSugestoes() {
    $("#orc-sugestoes").innerHTML = sugestoes().map(function (p) {
      return '<li><button type="button" data-id="' + esc(p.id) + '"><span class="cod">Cód. ' + cod(p.codigo) + "</span><span>" +
        esc(p.nome) + (p.ativo ? "" : " (oculto)") + (p.preco != null ? " · " + brl(p.preco) : "") + "</span>" + etiquetaOcupacao(p) + "</button></li>";
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
    if (campo === "quantidade") {
      var velho = $("[data-ocup]", li);
      if (velho) velho.remove();
      var novo = textoOcupacao(it);
      if (novo) li.insertAdjacentHTML("beforeend", novo);
    }
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
    // O crédito é de cada cliente: trocou o cliente, zera o crédito usado.
    orc.credito_usado = 0;
    formO.credito_usado.value = "";
    opcoesIndicado();
    atualizarCredito();
    desenharTotais();
  });

  // Primeira locação = o cliente ainda não tem outro orçamento aprovado.
  function primeiraLocacao(clienteId) {
    if (!clienteId) return true;
    return !st.orcs.some(function (o) {
      return o.cliente_id === clienteId && o.situacao === "aprovado" && (!orcOriginal || o.id !== orcOriginal.id);
    });
  }

  function pctDescontoIndicacao() {
    return st.conf.indicacao_ativa !== false ? Number(st.conf.indicacao_desconto_pct) || 0 : 0;
  }

  // "Indicado por": todos os clientes, menos o próprio cliente do orçamento.
  function opcoesIndicado() {
    if (orc.indicado_por && orc.indicado_por === orc.cliente_id) {
      orc.indicado_por = null;
      orc.desconto_indicacao_pct = 0;
    }
    formO.indicado_por.innerHTML = '<option value="">— Ninguém —</option>' + st.clientes.filter(function (c) {
      return c.id !== orc.cliente_id;
    }).map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.nome) + "</option>";
    }).join("");
    formO.indicado_por.value = orc.indicado_por || "";
    atualizarDescontoIndicacao();
  }

  function atualizarDescontoIndicacao() {
    var pct = orc.desconto_indicacao_pct || pctDescontoIndicacao();
    formO.desc_ind.checked = orc.desconto_indicacao_pct > 0;
    formO.desc_ind.disabled = !orc.indicado_por || (!pct && !orc.desconto_indicacao_pct);
    $("#orc-desc-ind-txt").textContent = pct
      ? "Dar " + pct.toLocaleString("pt-BR") + "% de desconto por indicação"
      : "Desconto por indicação (desligado em Configurações)";
  }

  formO.indicado_por.addEventListener("change", function () {
    orc.indicado_por = formO.indicado_por.value || null;
    // Escolheu quem indicou: já marca o desconto, se for a primeira locação do cliente.
    orc.desconto_indicacao_pct = orc.indicado_por && primeiraLocacao(orc.cliente_id) ? pctDescontoIndicacao() : 0;
    atualizarDescontoIndicacao();
    desenharTotais();
  });

  formO.desc_ind.addEventListener("change", function () {
    orc.desconto_indicacao_pct = formO.desc_ind.checked ? pctDescontoIndicacao() : 0;
    atualizarDescontoIndicacao();
    desenharTotais();
  });

  // Crédito disponível do cliente (sem contar o que este orçamento já usa).
  function creditoDisponivel() {
    if (!orc.cliente_id) return 0;
    return Math.max(0, creditos(orc.cliente_id, orcOriginal && orcOriginal.id).saldo);
  }

  function atualizarCredito() {
    var c = cliente(orc.cliente_id);
    var disp = creditoDisponivel();
    var usado = Number(orc.credito_usado) || 0;
    $("#orc-credito").hidden = !c || (!disp && !usado);
    if (!c) return;
    $("#orc-credito-txt").innerHTML = disp
      ? "💛 <b>" + esc(primeiroNome(c.nome)) + " tem " + brl(disp) + "</b> de crédito de indicação para usar."
      : "💛 " + esc(primeiroNome(c.nome)) + " não tem crédito disponível agora.";
    $("#orc-usar-credito").hidden = !disp;
  }

  formO.credito_usado.addEventListener("input", function () {
    orc.credito_usado = lerNumero(formO.credito_usado.value);
    desenharTotais();
  });

  $("#orc-usar-credito").addEventListener("click", function () {
    var v = contas({ itens: orc.itens, desconto: orc.desconto, taxa_entrega: 0, desconto_indicacao_pct: orc.desconto_indicacao_pct, credito_usado: 0 });
    orc.credito_usado = Math.min(creditoDisponivel(), v.total);
    formO.credito_usado.value = numCampo(orc.credito_usado);
    desenharTotais();
  });

  var nomePedido = "";   // nome que veio no pedido colado, para sugerir no cadastro

  $("#orc-novo-cliente").addEventListener("click", function () {
    abrirCliente(null, { nome: nomePedido }, function (c) {
      orc.cliente_id = c.id;
      opcoesCliente();
      opcoesIndicado();
      atualizarCredito();
      avisoOrc("");
    });
  });

  formO.addEventListener("submit", function (e) {
    e.preventDefault();
    var botao = $('button[type="submit"]', formO);
    var falta = formO.situacao.value === "cancelado" ? [] : itensEmFalta();
    var seguir = falta.length
      ? confirmar("Atenção: em " + AG.textoPeriodo(periodoForm()) + " não há unidades livres suficientes de: " +
          falta.map(function (it) { return it.nome; }).join(", ") + ". Salvar mesmo assim?", "Salvar mesmo assim")
      : Promise.resolve(true);
    seguir.then(function (sim) {
      if (sim) ocupado(botao, Promise.resolve().then(salvarOrcamento)).catch(falhou);
    });
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
    var retirada = formO.data_retirada.value || null, devolucao = formO.data_devolucao.value || null;
    if (retirada && devolucao && devolucao < retirada) throw new Error("A data da devolução é antes da data da retirada.");
    var c = cliente(orc.cliente_id);
    var creditoUsado = lerValor(formO.credito_usado.value, "Crédito usado");
    var usadoAntes = orcOriginal ? Number(orcOriginal.credito_usado) || 0 : 0;
    if (creditoUsado && !c) throw new Error("Escolha o cliente para usar o crédito de indicação.");
    if (creditoUsado > creditoDisponivel() + 0.004 && creditoUsado !== usadoAntes) {
      throw new Error("O crédito usado passa do disponível (" + brl(creditoDisponivel()) + ").");
    }
    var indicadoPor = orc.indicado_por && orc.indicado_por !== (c && c.id) ? orc.indicado_por : null;
    var dados = {
      indicado_por: indicadoPor,
      desconto_indicacao_pct: indicadoPor ? orc.desconto_indicacao_pct || 0 : 0,
      credito_usado: creditoUsado,
      situacao: formO.situacao.value,
      data_retirada: retirada,
      data_devolucao: devolucao,
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
      desenharClientes();
      var quem = cliente(novo.indicado_por);
      avisar("Orçamento nº " + novo.numero + " salvo. Agora você pode imprimir ou enviar no WhatsApp." +
        (quem && Number(novo.credito_gerado) > 0 ? " " + primeiroNome(quem.nome) + " tem " + brl(novo.credito_gerado) + " de crédito por esta indicação." : ""));
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
    var r = { itens: [], nome: "", data: "", entrada: "", saida: "", obs: [], faltou: [], indCodigo: "", indNome: "" };
    var dataDe = function (m) { return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"); };
    var guarda = orc;
    orc = { itens: r.itens };
    txt.split(/\r?\n/).forEach(function (l) {
      l = l.trim();
      var mic = l.match(/^indica[çc][ãa]o:\s*(?:c[óo]digo\s*)?([A-Za-z0-9]{3,10})\s*$/i);
      var mip = l.match(/^indicad[oa] por:\s*(.+)$/i);
      if (mic) { r.indCodigo = mic[1].toUpperCase(); return; }
      if (mip) { r.indNome = mip[1].trim(); return; }
      // Itens de um kit ("    • 2x Arco"): o kit já traz os itens dele.
      if (/^[•↳]/.test(l)) return;
      var me = l.match(/^entrada:\D*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      var ms = l.match(/^sa[ií]da:\D*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (me) { r.entrada = dataDe(me); return; }
      if (ms) { r.saida = dataDe(ms); return; }
      if (/^(tipo de evento|convidados):/i.test(l)) { r.obs.push(l); return; }
      var mo = l.match(/^observa[çc][õo]es:\s*(.+)$/i);
      if (mo) { r.obs.push(mo[1].trim()); return; }
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
    // Quem indicou: pelo código do link ou pelo nome que a pessoa escreveu.
    var quem = null;
    if (r.indCodigo) quem = st.clientes.filter(function (x) { return x.codigo_indicacao === r.indCodigo; })[0] || null;
    else if (r.indNome) quem = st.clientes.filter(function (x) { return x.nome.toLowerCase() === r.indNome.toLowerCase(); })[0] || null;
    if (quem && c && quem.id === c.id) quem = null;
    $("#dlg-colar").close();
    orcOriginal = null;
    abrirOrcamento(null, {
      cliente_id: c ? c.id : null, data_evento: r.data || r.entrada, itens: r.itens,
      data_retirada: r.entrada, data_devolucao: r.saida, observacoes: r.obs.join("\n"),
      indicado_por: quem ? quem.id : null,
      desconto_indicacao_pct: quem && primeiraLocacao(c ? c.id : null) ? pctDescontoIndicacao() : 0
    });
    nomePedido = r.nome;
    var avisos = [];
    if (quem) avisos.push("Indicação de " + quem.nome + " já preenchida.");
    else if (r.indCodigo) avisos.push("O pedido veio com o código de indicação " + r.indCodigo + ", mas nenhum cliente tem esse código. Se souber quem indicou, escolha em \"Indicado por\".");
    else if (r.indNome) avisos.push('O pedido diz "Indicado por: ' + r.indNome + '", mas não encontrei esse nome nos clientes. Se for um cliente, escolha em "Indicado por".');
    if (r.nome && !c) avisos.push('O pedido veio com o nome "' + r.nome + '", que não está cadastrado. Escolha o cliente ou toque em "Cadastrar cliente".');
    if (r.faltou.length) avisos.push("Não encontrei no catálogo: " + r.faltou.join(" | ") + ". Adicione manualmente.");
    avisoOrc(avisos.join(" "));
  });

  iniciar();
})();
