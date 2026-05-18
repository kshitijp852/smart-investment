/**
 * export-report.js
 * Generates PDF and DOCX from project-synopsis.html.
 * Usage:  node export-report.js
 * Output: project-synopsis.pdf  +  project-synopsis.docx
 */

const puppeteer = require('puppeteer-core');
const htmlDocx  = require('html-docx-js');
const path      = require('path');
const fs        = require('fs');

const DIR      = __dirname;
const HTML     = path.join(DIR, 'project-synopsis.html');
const PDF_OUT  = path.join(DIR, 'project-synopsis.pdf');
const DOCX_OUT = path.join(DIR, 'project-synopsis.docx');
const EDGE     = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// ── PDF ─────────────────────────────────────────────────────────────────────
async function generatePDF() {
  console.log('Launching Edge...');
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const url  = `file:///${HTML.replace(/\\/g, '/')}`;

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for all <img> (SVG diagrams) to finish loading
  await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    return Promise.all(imgs.map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ));
  });

  await page.pdf({
    path: PDF_OUT,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '22mm', left: '25mm', right: '20mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="width:100%;font-size:8pt;color:#888;text-align:center;padding:0 25mm;">
        SmartInvest: AI-Powered Investment Recommendation System &nbsp;|&nbsp;
        Amity University Mumbai 2025–26 &nbsp;|&nbsp;
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>`
  });

  await browser.close();
  const size = (fs.statSync(PDF_OUT).size / 1024).toFixed(0);
  console.log(`✅ PDF saved: ${PDF_OUT}  (${size} KB)`);
}

// ── DOCX ─────────────────────────────────────────────────────────────────────
async function generateDOCX() {
  console.log('Building DOCX...');

  let html = fs.readFileSync(HTML, 'utf8');

  // Embed SVG diagrams as base64 data URIs so Word can display them
  html = html.replace(/src="diagrams\/(fig[\w-]+\.svg)"/g, (match, filename) => {
    const svgPath = path.join(DIR, 'diagrams', filename);
    if (!fs.existsSync(svgPath)) return match;
    const b64 = Buffer.from(fs.readFileSync(svgPath, 'utf8')).toString('base64');
    return `src="data:image/svg+xml;base64,${b64}"`;
  });

  // Extract body content
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/i);
  const body      = bodyMatch ? bodyMatch[1] : html;

  const wordHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body  { font-family:"Times New Roman",serif; font-size:12pt; line-height:1.6; margin:0; }
  h1    { font-size:16pt; text-align:center; }
  h2    { font-size:14pt; margin-top:14pt; }
  h3    { font-size:12pt; font-weight:bold; margin-top:10pt; }
  table { width:100%; border-collapse:collapse; font-size:10pt; margin:8pt 0; }
  th    { background:#2c5f8a; color:white; padding:5pt 6pt; text-align:left; }
  td    { padding:4pt 6pt; border:1px solid #ccc; }
  tr:nth-child(even) td { background:#f5f5f5; }
  pre, .formula-box { background:#f0f4f8; padding:6pt; font-family:Courier,monospace; font-size:10pt; margin:6pt 0; }
  .callout { border:1px solid #2c5f8a; padding:8pt; margin:8pt 0; background:#f0f6ff; }
  .page-break { page-break-before:always; }
  img { max-width:100%; height:auto; }
  .cover { text-align:center; }
</style>
</head>
<body>${body}</body>
</html>`;

  const blob = htmlDocx.asBlob(wordHtml, {
    orientation: 'portrait',
    margins: { top: 720, right: 720, bottom: 720, left: 1080 }
  });

  // html-docx-js returns a Blob in Node 18+ — convert via arrayBuffer()
  let buffer;
  if (Buffer.isBuffer(blob)) {
    buffer = blob;
  } else if (blob instanceof ArrayBuffer) {
    buffer = Buffer.from(blob);
  } else if (typeof blob.arrayBuffer === 'function') {
    buffer = Buffer.from(await blob.arrayBuffer());
  } else {
    throw new Error('Unexpected blob type: ' + typeof blob);
  }
  fs.writeFileSync(DOCX_OUT, buffer);

  const size = (fs.statSync(DOCX_OUT).size / 1024).toFixed(0);
  console.log(`✅ DOCX saved: ${DOCX_OUT}  (${size} KB)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n📄 SmartInvest Report Exporter\n');

  if (!fs.existsSync(HTML))  { console.error('❌ HTML not found:', HTML);  process.exit(1); }
  if (!fs.existsSync(EDGE))  { console.error('❌ Edge not found:', EDGE);   process.exit(1); }

  try { await generatePDF();   } catch (e) { console.error('❌ PDF failed:',  e.message); }
  try { await generateDOCX();  } catch (e) { console.error('❌ DOCX failed:', e.message); }

  console.log('\nDone.\n  PDF  →', PDF_OUT, '\n  DOCX →', DOCX_OUT);
})();
