// Gera a versão para imprimir (.html) e a versão Word (.docx) a partir de um .md.
// Não precisa do Microsoft Word. Na primeira vez, na pasta do projeto:
//   npm install --no-save marked@14.1.4 docx@9.0.3
// Uso:
//   node scripts/gerar_documentos.mjs MANUAL_DA_ADMINISTRADORA.md MANUAL_DA_ADMINISTRADORA_IMPRIMIR.html "Manual da Administradora - Catalogo Top Fest.docx"
//   node scripts/gerar_documentos.mjs CONTAS_E_SERVICOS.md CONTAS_E_SERVICOS_IMPRIMIR.html "CONTAS_E_SERVICOS - Manutencao Catalogo Top Fest.docx"
import fs from "fs";
import { marked } from "marked";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
  ShadingType, BorderStyle, LevelFormat, AlignmentType, ExternalHyperlink
} from "docx";

const [, , MD, HTML, DOCX] = process.argv;
const md = fs.readFileSync(MD, "utf8");
const titulo = (md.match(/^# (.+)$/m) || [, "Documento"])[1];

// ---------- HTML para imprimir ----------
const CSS = `body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:#1d2733;max-width:860px;margin:24px auto;padding:0 18px}
h1{font-family:Georgia,serif;color:#8f6d14;border-bottom:3px solid #8f6d14;padding-bottom:6px}h2{font-family:Georgia,serif;color:#0f5f85;margin-top:28px}
h3{margin-top:20px}table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f3eee0}code{background:#f1f1f1;padding:1px 4px;border-radius:4px;font-size:13px;word-break:break-all}pre{background:#f6f4ef;border:1px solid #e3ddd0;padding:10px;border-radius:8px;white-space:pre-wrap;font-size:13px}
pre code{background:none;padding:0}blockquote{border-left:4px solid #b8902f;background:#fbf8f0;margin:12px 0;padding:8px 12px}a{color:#0f5f85;word-break:break-all}hr{border:0;border-top:1px solid #ddd;margin:22px 0}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}table,pre,blockquote{break-inside:avoid}a{color:inherit;text-decoration:none}}`;
fs.writeFileSync(HTML, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style></head><body>${marked.parse(md, { gfm: true })}</body></html>`);

// ---------- Word ----------
const AZUL = "0F5F85", DOURADO = "8F6D14";
const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function runs(tokens, est = {}) {
  const out = [];
  for (const t of tokens || []) {
    if (t.type === "strong") out.push(...runs(t.tokens, { ...est, bold: true }));
    else if (t.type === "em") out.push(...runs(t.tokens, { ...est, italics: true }));
    else if (t.type === "codespan") out.push(new TextRun({ ...est, text: decode(t.text), font: "Consolas", shading: { type: ShadingType.CLEAR, fill: "F1F1F1" } }));
    else if (t.type === "link") out.push(new ExternalHyperlink({ link: t.href, children: runs(t.tokens, { ...est, color: AZUL, underline: {} }) }));
    else if (t.type === "br") out.push(new TextRun({ break: 1 }));
    else if (t.tokens) out.push(...runs(t.tokens, est));
    else out.push(new TextRun({ ...est, text: decode(t.text ?? t.raw ?? "") }));
  }
  return out;
}

let listas = 0;
function blocos(tokens, ctx = {}) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const nivel = [null, HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][t.depth] || HeadingLevel.HEADING_3;
        out.push(new Paragraph({ heading: nivel, children: runs(t.tokens), keepNext: true }));
        break;
      }
      case "paragraph":
      case "text":
        out.push(new Paragraph({ children: runs(t.tokens || [t]), ...(ctx.citacao ? citacao : {}), spacing: { after: 120 } }));
        break;
      case "list": {
        const inst = ++listas;
        const nivel = ctx.nivel || 0;
        for (const item of t.items) {
          const [primeiro, ...resto] = item.tokens;
          const filhos = primeiro && (primeiro.type === "text" || primeiro.type === "paragraph") ? runs(primeiro.tokens || [primeiro]) : [];
          out.push(new Paragraph({
            children: filhos,
            numbering: t.ordered ? { reference: "numeros", level: nivel, instance: inst } : { reference: "bolinhas", level: nivel },
            spacing: { after: 60 }
          }));
          const outros = primeiro && filhos.length ? resto : item.tokens;
          out.push(...blocos(outros.filter(x => x.type !== "space"), { ...ctx, nivel: nivel + 1 }));
        }
        break;
      }
      case "table": {
        const cel = (c, cab) => new TableCell({
          children: [new Paragraph({ children: runs(c.tokens, cab ? { bold: true } : {}) })],
          shading: cab ? { type: ShadingType.CLEAR, fill: "F3EEE0" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 }
        });
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ tableHeader: true, children: t.header.map(c => cel(c, true)) }),
            ...t.rows.map(r => new TableRow({ children: r.map(c => cel(c, false)) }))]
        }));
        out.push(new Paragraph({ text: "" }));
        break;
      }
      case "blockquote":
        out.push(...blocos(t.tokens, { ...ctx, citacao: true }));
        break;
      case "code":
        out.push(new Paragraph({
          children: t.text.split("\n").flatMap((l, i) => [...(i ? [new TextRun({ break: 1 })] : []), new TextRun({ text: l, font: "Consolas", size: 20 })]),
          shading: { type: ShadingType.CLEAR, fill: "F6F4EF" },
          border: { top: borda, bottom: borda, left: borda, right: borda },
          spacing: { before: 120, after: 160 }
        }));
        break;
      case "hr":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD", space: 1 } }, spacing: { after: 200 } }));
        break;
      case "space":
        break;
      default:
        if (t.text) out.push(new Paragraph({ children: [new TextRun(decode(t.text))] }));
    }
  }
  return out;
}
const borda = { style: BorderStyle.SINGLE, size: 4, color: "E3DDD0", space: 4 };
const citacao = {
  shading: { type: ShadingType.CLEAR, fill: "FBF8F0" },
  border: { left: { style: BorderStyle.SINGLE, size: 24, color: "B8902F", space: 8 } },
  indent: { left: 240 }
};

const niveis = (fmt, txt) => [0, 1, 2].map(n => ({
  level: n, format: fmt, text: txt(n), alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 400 + n * 360, hanging: 300 } } }
}));

const doc = new Document({
  creator: "Chácara Top Fest",
  title: titulo,
  styles: {
    default: { document: { run: { font: "Segoe UI", size: 22, color: "1D2733" } } },
    paragraphStyles: [
      { id: "Title", name: "Title", run: { font: "Georgia", size: 40, bold: true, color: DOURADO }, paragraph: { spacing: { after: 200 } } },
      { id: "Heading1", name: "Heading 1", run: { font: "Georgia", size: 32, bold: true, color: AZUL }, paragraph: { spacing: { before: 360, after: 160 } } },
      { id: "Heading2", name: "Heading 2", run: { font: "Segoe UI", size: 26, bold: true, color: "1D2733" }, paragraph: { spacing: { before: 240, after: 120 } } },
      { id: "Heading3", name: "Heading 3", run: { font: "Segoe UI", size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 100 } } }
    ]
  },
  numbering: {
    config: [
      { reference: "numeros", levels: niveis(LevelFormat.DECIMAL, n => `%${n + 1}.`) },
      { reference: "bolinhas", levels: niveis(LevelFormat.BULLET, n => ["•", "◦", "▪"][n]) }
    ]
  },
  sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: blocos(marked.lexer(md, { gfm: true })) }]
});
fs.writeFileSync(DOCX, await Packer.toBuffer(doc));
console.log("ok:", HTML, "|", DOCX);
