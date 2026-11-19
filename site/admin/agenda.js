/* Agenda para imprimir ou salvar em PDF. Só abre para a administradora logada. */
(function () {
  "use strict";

  var CFG = window.TOPFEST;
  var A = window.TF_AGENDA;
  var sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  var folha = document.getElementById("folha");
  var f = { de: document.getElementById("f-de"), ate: document.getElementById("f-ate"), ver: document.getElementById("f-ver"), sit: document.getElementById("f-sit") };
  var dados = null, conf = {};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function erro(texto) { folha.innerHTML = '<p class="msg">' + esc(texto) + "</p>"; }

  function montar() {
    var r = A.montar(dados, { de: f.de.value, ate: f.ate.value, ver: f.ver.value, sit: f.sit.value });
    document.title = r.titulo + " – Top Fest";
    folha.innerHTML =
      '<header class="cab"><img src="../img/logo.png" alt="Chácara Top Fest"><div>' +
      "<h1>TOP FEST DECORAÇÕES</h1><p>" + esc(conf.slogan || "") + "</p></div></header>" +
      '<div class="tit"><h2>' + esc(r.titulo) + "</h2><span>Emitido em " +
      new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + "</span></div>" + r.html;
    document.getElementById("imprimir").disabled = false;
    history.replaceState(null, "", "?de=" + f.de.value + "&ate=" + f.ate.value + "&ver=" + f.ver.value + "&sit=" + f.sit.value);
  }

  var q = new URLSearchParams(location.search);
  var hoje = new Date().toLocaleDateString("sv-SE");
  f.de.value = q.get("de") || hoje;
  f.ate.value = q.get("ate") || A.somaDias(hoje, 30);
  if (q.get("ver")) f.ver.value = q.get("ver");
  if (q.get("sit")) f.sit.value = q.get("sit");

  document.getElementById("imprimir").addEventListener("click", function () { window.print(); });
  ["de", "ate", "ver", "sit"].forEach(function (k) { f[k].addEventListener("change", function () { if (dados) montar(); }); });

  sb.auth.getSession().then(function (r) {
    if (!r.data.session) { erro("Entre na área da administradora primeiro e depois abra a agenda de novo."); return; }
    return Promise.all([
      sb.from("orcamentos").select("*"),
      sb.from("clientes").select("*"),
      sb.from("produtos").select("id, codigo, nome, quantidade"),
      sb.from("configuracoes").select("*").eq("id", 1).single()
    ]).then(function (res) {
      res.forEach(function (x) { if (x.error) throw x.error; });
      dados = { orcs: res[0].data, clientes: res[1].data, prods: res[2].data };
      conf = res[3].data || {};
      montar();
    });
  }).catch(function (e) {
    console.error(e);
    erro("Não foi possível carregar a agenda. Verifique a internet e tente de novo.");
  });
})();
