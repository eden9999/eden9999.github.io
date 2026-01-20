let table = null;
let selectedKeys = new Set();

let filterEnabled = false; // checkbox selection filter
let padjFilterEnabled = false; // padj < 0.05
let pseudoFilterEnabled = false; // remove pseudo-like entries
const geneSetFilters = {
  TF: { enabled: false, genes: null, csv: "/uploads/TF.csv", btn: "btn-tf-intersect" },
  Hedgehog: { enabled: false, genes: null, csv: "/uploads/hedgehog.csv", btn: "btn-hedgehog" }
};

let padjColumnIndex = null;
let symbolColumnIndex = null;
let descriptionColumnIndex = null;

let selectionFilterRegistered = false;

// add loading indicator to fetch calls
function showLoading(show) {
    let el = document.getElementById("loading-indicator");
    if (!el) return;
    el.style.display = show ? "inline-block" : "none";
}

// 正确解析CSV
function parseDelimited(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length === 0) return [];

    // Detect delimiter from the first non-empty line
    let first = "";
    for (const l of lines) {
        if (l.trim()) {
            first = l;
            break;
        }
    }
    const delimiter = first.includes("\t") ? "\t" : ",";

    const rows = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const row = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (ch === '"') {
                // Escaped quote inside quoted field: "" -> "
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch === delimiter && !inQuotes) {
                row.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
        row.push(current);
        rows.push(row);
    }

    return rows;
}

// 标准化基因符号
function normalizeGene(x) {
    if (x === null || x === undefined) return "";
    return String(x)
        .replace(/^\uFEFF/, "")
        .trim();
}

function loadGeneSetOnce(key) {
  const obj = geneSetFilters[key];
  if (obj.genes) return Promise.resolve(obj.genes);

  return fetch(obj.csv)
    .then(r => r.text())
    .then(text => {
      const rows = parseDelimited(text);
      obj.genes = new Set();
      rows.forEach(r => {
        if (r && r[0]) obj.genes.add(normalizeGene(r[0]));
      });
      return obj.genes;
    });
}

function applyGeneSetFilter(key) {
  registerSelectionFilterOnce();
  loadGeneSetOnce(key).then(() => {
    const obj = geneSetFilters[key];
    obj.enabled = !obj.enabled;
    setBtnActive(obj.btn, obj.enabled);
    if (table) table.draw();
  });
}

// 设置按钮激活状态
function setBtnActive(id, active) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.backgroundColor = active ? "#800020" : "";
}

// 重置所有按钮状态
function resetAllBtnStates() {
    setBtnActive("btn-show-selected", false);
    setBtnActive("btn-deg-filter", false);
    setBtnActive("btn-pseudo-filter", false);
    setBtnActive("btn-tf-intersect", false);
}

// 注册过滤器（仅一次）
function registerSelectionFilterOnce() {
    if (selectionFilterRegistered) return;

    $.fn.dataTable.ext.search.push(function (settings, data, dataIndex) {
        if (!table) return true;
        if (settings.nTable !== table.table().node()) return true;

        // checkbox selection filter
        if (filterEnabled) {
            const key = data[1];
            if (!selectedKeys.has(key)) return false;
        }

        // padj < 0.05 filter
        if (
            padjFilterEnabled &&
            padjColumnIndex !== null &&
            padjColumnIndex !== -1
        ) {
            const v = parseFloat(String(data[padjColumnIndex + 1]).trim());
            if (!Number.isFinite(v)) return false;
            if (v >= 0.05) return false;
        }

        // pseudo filter
        if (pseudoFilterEnabled) {
            const symbol =
                symbolColumnIndex !== null && symbolColumnIndex !== -1
                    ? String(data[symbolColumnIndex + 1]).toLowerCase()
                    : "";
            const desc =
                descriptionColumnIndex !== null && descriptionColumnIndex !== -1
                    ? String(data[descriptionColumnIndex + 1]).toLowerCase()
                    : "";

            if (symbol.includes("-ps")) return false;
            if (desc.includes("riken cdna")) return false;
            if (desc.includes("predicted")) return false;
            if (desc.includes("cdna sequence")) return false;
        }
        // Unified gene set filters
        for (const key in geneSetFilters) {
          const obj = geneSetFilters[key];
          if (
            obj.enabled &&
            obj.genes &&
            symbolColumnIndex !== null &&
            symbolColumnIndex !== -1
          ) {
            const raw = String(data[symbolColumnIndex + 1] ?? "")
              .replace(/^\uFEFF/, "")
              .trim();
            if (!raw) return false;

            const tokens = raw
              .split(/[;,\s/|]+/)
              .map(t => t.trim())
              .filter(Boolean);

            if (!tokens.some(t => obj.genes.has(t))) return false;
          }
        }

        return true;
    });

    selectionFilterRegistered = true;
}

// 绑定复选框处理程序 selected rows!
function bindCheckboxHandler() {
    $("#table")
        .off("change", ".row-check")
        .on("change", ".row-check", function () {
            if (!table) return;
            const tr = $(this).closest("tr");
            const row = table.row(tr);
            const rowData = row.data();
            if (!rowData) return;

            const key = rowData[1];
            if (this.checked) {
                selectedKeys.add(key);
            } else {
                selectedKeys.delete(key);
            }
        });
}

// 计算重要列索引
function computeHeaderIndices(headers) {
    const lower = headers.map((h) =>
        String(h ?? "")
            .trim()
            .toLowerCase()
    );

    padjColumnIndex = lower.findIndex((h) => h === "padj");

    // Symbol/Description column names vary across exports
    symbolColumnIndex = lower.findIndex(
        (h) => h === "symbol" || h === "gene" || h === "gene_symbol"
    );
    descriptionColumnIndex = lower.findIndex(
        (h) => h === "description" || h === "gene_name" || h === "annotation"
    );
}

// 加载文件
function loadFile(filename) {
    showLoading(true);
    // Reset selection + filters when loading a new file
    selectedKeys = new Set();
    filterEnabled = false;
    padjFilterEnabled = false;
    pseudoFilterEnabled = false;
    tfFilterEnabled = false;
    resetAllBtnStates();

    // Support both legacy uploads (bare filenames) and project-scoped paths (projects/<project>/files/<file>)
    let url;
    if (String(filename).includes("/")) {
        const safePath = String(filename)
            .replace(/^\/+/, "")
            .split("/")
            .map(encodeURIComponent)
            .join("/");
        url = "/" + safePath;
    } else {
        url = "/uploads/" + encodeURIComponent(filename);
    }

    fetch(url)
        .then((resp) => {
            if (!resp.ok)
                throw new Error("Fetch failed: " + resp.status + " " + resp.statusText);
            return resp.text();
        })
        .then((text) => {
            const rows = parseDelimited(text);
            if (!rows || rows.length === 0) return;

            const headers = rows.shift().map((h) => String(h ?? "").trim());
            computeHeaderIndices(headers);

            // Prepend checkbox column
            const columns = [
                {
                    title: "Select",
                    data: null,
                    orderable: false,
                    searchable: false,
                    render: () => '<input type="checkbox" class="row-check">',
                },
                ...headers.map((h, i) => ({
                    title: h,
                    data: i + 1,
                })),
            ];

            const data = rows.map((r) => [
                null,
                ...r.map((x) => String(x ?? "").trim()),
            ]);

            if ($.fn.dataTable.isDataTable("#table")) {
                $("#table").DataTable().clear().destroy();
            }

            table = $("#table").DataTable({
                serverSide: true,
                processing: true,
                data: data,
                columns: columns,
                // keep prior numeric sorting preference
                columnDefs: [
                    { targets: 0, orderable: false, searchable: false },
                    { targets: "_all", type: "num" },
                ],
                dom: 'l<"dt-select-buttons">frtip',
                scrollX: true,
                pageLength: 25,
                order: [],
                createdRow: function (row, rowData) {
                    const key = rowData[1];
                    const cb = row.querySelector(".row-check");
                    if (cb) cb.checked = selectedKeys.has(key);
                },
            });

            if ($('.dt-select-buttons').length) {
                $('.dt-select-buttons').html(`
    <button id="btn-select-toggle" style="margin-left:12px;">Select all</button>
`);

                let allSelected = false;

                $('#btn-select-toggle').off('click').on('click', () => {
                    if (!table) return;

                    if (!allSelected) {
                        // 全选
                        table.rows({ filter: 'applied' }).every(function () {
                            const rowData = this.data();
                            if (!rowData) return;
                            const key = rowData[1];
                            selectedKeys.add(key);
                            const cb = this.node().querySelector('.row-check');
                            if (cb) cb.checked = true;
                        });
                    $('#btn-select-toggle').css('background-color', '#800020');
                        allSelected = true;
                    } else {
                        // 全取消
                        selectedKeys.clear();
                        table.rows({ filter: 'applied' }).every(function () {
                            const cb = this.node().querySelector('.row-check');
                            if (cb) cb.checked = false;
                        });
                        $('#btn-select-toggle').css('background-color', '');
                        allSelected = false;
                    }
                });
            }

            registerSelectionFilterOnce();
            bindCheckboxHandler();
            showLoading(false);
        })
        .catch((err) => {
            console.error(err);
            showLoading(false);
        });
}

// 应用selected过滤器
function applySelectionFilter() {
    registerSelectionFilterOnce();
    filterEnabled = !filterEnabled;
    setBtnActive("btn-show-selected", filterEnabled);
    if (table) table.draw();
}

// 应用 padj < 0.05 过滤器
function applyPadjFilter() {
    registerSelectionFilterOnce();
    padjFilterEnabled = !padjFilterEnabled;
    setBtnActive("btn-deg-filter", padjFilterEnabled);
    if (table) table.draw();
}

// 应用 pseudo 过滤器
function applyPseudoFilter() {
    registerSelectionFilterOnce();
    pseudoFilterEnabled = !pseudoFilterEnabled;
    setBtnActive("btn-pseudo-filter", pseudoFilterEnabled);
    if (table) table.draw();
}


// 清除所有过滤器
function clearSelectionFilter() {
    filterEnabled = false;
    padjFilterEnabled = false;
    pseudoFilterEnabled = false;
    Object.values(geneSetFilters).forEach(o => {
      o.enabled = false;
      setBtnActive(o.btn, false);
    });
    resetAllBtnStates();
    if (table) table.draw();
}

// 打开火山图
function openVolcano() {
    if (!table) {
        alert("No data loaded");
        return;
    }

    const data = table.rows({ filter: "applied" }).data().toArray();
    if (!data || data.length === 0) {
        alert("No rows to plot");
        return;
    }

    if (padjColumnIndex === null || padjColumnIndex === -1) {
        alert("padj column not found");
        return;
    }

    // find log2FC column
    let lfcIdx = null;
    const headers = table
        .columns()
        .header()
        .toArray()
        .map((h) => h.innerText.toLowerCase());
    headers.forEach((h, i) => {
        if (h.includes("log2fc") || h === "logfc" || h.includes("log2 fold")) {
            lfcIdx = i - 1; // minus checkbox column
        }
    });

    if (lfcIdx === null) {
        alert("log2FC column not found");
        return;
    }

    const xSig = [];
    const ySig = [];
    const textSig = [];

    const xBg = [];
    const yBg = [];
    const textBg = [];

    const padjCut = 0.05;

    data.forEach((row) => {
        const lfc = parseFloat(row[lfcIdx + 1]);
        const padj = parseFloat(row[padjColumnIndex + 1]);
        const symbol =
            symbolColumnIndex !== null && symbolColumnIndex !== -1
                ? row[symbolColumnIndex + 1]
                : "";

        if (!Number.isFinite(lfc) || !Number.isFinite(padj) || padj <= 0) return;

        const yval = -Math.log10(padj);

        if (padj < padjCut) {
            xSig.push(lfc);
            ySig.push(yval);
            textSig.push(symbol);
        } else {
            xBg.push(lfc);
            yBg.push(yval);
            textBg.push(symbol);
        }
    });

    const win = window.open("", "_blank");
    if (!win) return;

    win.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Volcano Plot</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
</head>
<body>
  <div id="plot" style="width:100%; height:100vh;"></div>
  <script>
    const traceBg = {
      x: ${JSON.stringify(xBg)},
      y: ${JSON.stringify(yBg)},
      text: ${JSON.stringify(textBg)},
      mode: 'markers',
      type: 'scatter',
      name: 'padj ≥ 0.05',
      marker: { size: 5, color: 'lightgrey' },
      hovertemplate: 'Gene: %{text}<br>log2FC: %{x}<br>-log10(padj): %{y}<extra></extra>'
    };

    const traceSig = {
      x: ${JSON.stringify(xSig)},
      y: ${JSON.stringify(ySig)},
      text: ${JSON.stringify(textSig)},
      mode: 'markers',
      type: 'scatter',
      name: 'padj < 0.05',
      marker: { size: 5, color: 'red' },
      hovertemplate: 'Gene: %{text}<br>log2FC: %{x}<br>-log10(padj): %{y}<extra></extra>'
    };

    const layout = {
      title: {
        text: 'Volcano plot',
        font: { size: 24 }
      },
      xaxis: {
        title: {
          text: 'log2FC',
          font: { size: 24 }
        },
        tickfont: { size: 24 }
      },
      yaxis: {
        title: {
          text: '-log10(padj)',
          font: { size: 24 }
        },
        tickfont: { size: 24 }
      },
      legend: {
        font: { size: 24 }
      },
      shapes: [
        {
          type: 'line',
          xref: 'paper',
          x0: 0,
          x1: 1,
          y0: ${-Math.log10(0.05)},
          y1: ${-Math.log10(0.05)},
          line: { color: 'grey', width: 1, dash: 'dash' }
        }
      ]
    };

    Plotly.newPlot('plot', [traceBg, traceSig], layout);
  </script>
</body>
</html>
`);
}

// 打开热图
function openHeatmap() {
    if (!table) {
        alert("No data loaded");
        return;
    }

    if (selectedKeys.size === 0) {
        alert("No rows selected");
        return;
    }

    const headers = table
        .columns()
        .header()
        .toArray()
        .map((h) => h.innerText);
    const headersLower = headers.map((h) => h.toLowerCase());

    // 找 WT / KO 列
    const wtCols = [];
    const koCols = [];

    headersLower.forEach((h, i) => {
        if (h.includes("wt")) wtCols.push(i - 1);
        if (h.includes("ko")) koCols.push(i - 1);
    });

    const valueCols = [...wtCols, ...koCols];
    const colNames = [
        ...wtCols.map((i) => headers[i + 1]),
        ...koCols.map((i) => headers[i + 1]),
    ];

    if (valueCols.length === 0) {
        alert("No WT / KO columns found");
        return;
    }

    const rows = table.rows().data().toArray();

    const genes = [];
    const matrix = [];

    rows.forEach((row) => {
        const key = row[1];
        if (!selectedKeys.has(key)) return;

        const gene =
            symbolColumnIndex !== null && symbolColumnIndex !== -1
                ? row[symbolColumnIndex + 1]
                : key;

        const raw = valueCols.map((ci) => {
            const v = parseFloat(row[ci + 1]);
            return Number.isFinite(v) ? v : null;
        });

        // z-score per gene (row-wise)
        const valid = raw.filter((v) => v !== null);
        const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
        const sd = Math.sqrt(
            valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length
        );

        const zvals = raw.map((v) =>
            v === null || sd === 0 ? 0 : (v - mean) / sd
        );

        genes.push(gene);
        matrix.push(zvals);
    });

    const win = window.open("", "_blank");
    if (!win) return;

    win.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Heatmap</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
</head>
<body>
  <div style="margin: 10px;">
    <label for="paletteSelect" style="font-size:18px; margin-right:8px;">Color palette:</label>
    <select id="paletteSelect" style="font-size:18px;">
      <option value="RdBu">RdBu</option>
      <option value="PuOr">PuOr</option>
      <option value="BrBG">BrBG</option>
      <option value="Spectral">Spectral</option>
      <option value="Paquin">Paquin</option>
      <option value="Hiroshige">Hiroshige</option>
      <option value="Cassatt2">Cassatt2</option>
      <option value="Benedictus">Benedictus</option>
    </select>
    <button id="refreshHeatmap" style="margin-left:12px; font-size:18px;">Refresh</button>
  </div>
  <div id="plot" style="width:100%; height:100vh;"></div>
  <script>
    function toScale(colors) {
      const n = colors.length;
      return colors.map((c, i) => [i / (n - 1), c]);
    }

    const palettes = {
      RdBu: {
        colorscale: toScale(['#053061','#2166ac','#4393c3','#92c5de','#d1e5f0','#f7f7f7','#fddbc7','#f4a582','#d6604d','#b2182b','#67001f']),
        reversescale: false
      },
      PuOr: {
        colorscale: toScale(['#2d004b','#542788','#8073ac','#b2abd2','#d8daeb','#f7f7f7','#fee0b6','#fdb863','#e08214','#b35806','#7f3b08']),
        reversescale: false
      },
      BrBG: {
        colorscale: toScale(['#003c30','#01665e','#35978f','#80cdc1','#c7eae5','#f5f5f5','#f6e8c3','#dfc27d','#bf812d','#8c510a','#543005']),
        reversescale: false
      },
      Spectral: {
        colorscale: toScale(['#5e4fa2','#3288bd','#66c2a5','#abdda4','#e6f598','#ffffbf','#fee08b','#fdae61','#f46d43','#d53e4f','#9e0142']),
        reversescale: false
      },
      Paquin: {
        colorscale: toScale([
          '#8f1d14',
          '#b3241a',
          '#d94a3a',
          '#f26b4f',
          '#f89a6a',
          '#f4d27a',
          '#d8ddb2',
          '#a8bf7a',
          '#6f8f3f',
          '#3f5f2a',
          '#254d1f'
        ]),
        reversescale: true
      },
      Hiroshige: {
        colorscale: toScale([
          '#e45c4f',
          '#f08a4b',
          '#f6b25e',
          '#f9d77e',
          '#fde9b5',
          '#bfe3e0',
          '#7ec6d4',
          '#5a9ec9',
          '#3c6fa6',
          '#2b4a7f'
        ]),
        reversescale: true
      },
      Cassatt2: {
        colorscale: toScale([
          '#2b1d3a',
          '#4a3a66',
          '#7a5f9a',
          '#b08bc4',
          '#e6d8ef',
          '#c9dcb3',
          '#8fb07a',
          '#5f8a4f',
          '#355f2f',
          '#0f2f14'
        ]),
        reversescale: false
      },
      Benedictus: {
        colorscale: toScale([
          '#b4506f',
          '#c03e67',
          '#e46b92',
          '#f7a8c0',
          '#fae5eb',
          '#f5f9ff',
          '#d1e2f9',
          '#a1bfec',
          '#5f83d9',
          '#3043a6'
        ]),
        reversescale: true
      }
    };

    function makeTrace(paletteKey) {
      const p = palettes[paletteKey];
      return {
        z: ${JSON.stringify(matrix)},
        x: ${JSON.stringify(colNames)},
        y: ${JSON.stringify(genes)},
        type: 'heatmap',
        colorscale: p.colorscale,
        reversescale: p.reversescale
      };
    }

    const layout = {
      title: {
        text: 'Heatmap (selected genes)',
        font: { size: 24 }
      },
      margin: {
        l: 100,
        r: 50,
        t: 80,
        b: 80
      },
      xaxis: {
        side: 'bottom',
        tickfont: { size: 24 },
        titlefont: { size: 24 },
        automargin: true
      },
      yaxis: {
        autorange: 'reversed',
        tickfont: { size: 24 },
        titlefont: { size: 24 },
        automargin: true
      },
      legend: {
        font: { size: 24 }
      }
    };

    let currentPalette = 'RdBu';
    Plotly.newPlot('plot', [makeTrace(currentPalette)], layout);

    document.getElementById('paletteSelect').addEventListener('change', (e) => {
      const p = palettes[e.target.value];

      const newTrace = {
        z: ${JSON.stringify(matrix)},
        x: ${JSON.stringify(colNames)},
        y: ${JSON.stringify(genes)},
        type: 'heatmap',
        colorscale: p.colorscale,
        reversescale: p.reversescale
      };

      Plotly.react('plot', [newTrace], layout);
    });

    document.getElementById('refreshHeatmap').addEventListener('click', () => {
      const paletteKey = document.getElementById('paletteSelect').value;
      const p = palettes[paletteKey];

      const newTrace = {
        z: ${JSON.stringify(matrix)},
        x: ${JSON.stringify(colNames)},
        y: ${JSON.stringify(genes)},
        type: 'heatmap',
        colorscale: p.colorscale,
        reversescale: p.reversescale
      };

      Plotly.newPlot('plot', [newTrace], layout);
    });
  </script>
</body>
</html>
`);
}

// 打开箱线图
function openBoxPlot() {
    if (!table) {
        alert("No data loaded");
        return;
    }

    const headers = table
        .columns()
        .header()
        .toArray()
        .map((h) => h.innerText);
    const headersLower = headers.map((h) => h.toLowerCase());

    // identify WT / KO columns
    const wtCols = [];
    const koCols = [];

    headersLower.forEach((h, i) => {
        if (h.includes("wt")) wtCols.push(i - 1);
        if (h.includes("ko")) koCols.push(i - 1);
    });

    if (wtCols.length === 0 || koCols.length === 0) {
        alert("WT or KO columns not found");
        return;
    }

    const rows = table.rows().data().toArray();

    const win = window.open("", "_blank");
    if (!win) return;

    win.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Box Plot</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { font-family: sans-serif; margin: 20px; }
    input { padding: 6px; font-size: 14px; width: 200px; }
  </style>
</head>
<body>
  <h3>Gene box plot (WT vs KO)</h3>
  <input id="geneInput" placeholder="Enter gene symbol" />
  <button id="goBtn">Go</button>
  <div id="plot" style="width:800px; height:800px; margin: 0 auto;"></div>

  <script>
    const rows = ${JSON.stringify(rows)};
    const wtCols = ${JSON.stringify(wtCols)};
    const koCols = ${JSON.stringify(koCols)};
    const symbolCol = ${symbolColumnIndex};

    function drawBox(gene) {
        if (!gene) return;

        const row = rows.find(r => {
            if (symbolCol === null || symbolCol === -1) return false;
            return String(r[symbolCol + 1]).toLowerCase() === gene.toLowerCase();
        });

        if (!row) {
            Plotly.purge('plot');
            document.getElementById('plot').innerHTML = '<p>Gene not found</p>';
            return;
        }

        const wtVals = wtCols
            .map(ci => parseFloat(row[ci + 1]))
            .filter(v => Number.isFinite(v));

        const koVals = koCols
            .map(ci => parseFloat(row[ci + 1]))
            .filter(v => Number.isFinite(v));

        const traceWT = {
            y: wtVals,
            type: 'box',
            name: 'WT',
            boxpoints: 'all',
            jitter: 0.4,
            pointpos: 0,
            marker: { color: '#000000' },
            line: { color: '#006600' }
        };

        const traceKO = {
            y: koVals,
            type: 'box',
            name: 'KO',
            boxpoints: 'all',
            jitter: 0.4,
            pointpos: 0,
            marker: { color: '#000000' },
            line: { color: '#880099' }
        };

        const layout = {
            title: {
                text: gene,
                font: { size: 30 }
            },
            width: 800,
            height: 800,
            legend: {
                font: { size: 20 }
            },
            xaxis: {
                tickfont: { size: 24 },
                titlefont: { size: 24 }
            },
            yaxis: {
                title: {
                    text: 'mRNA quantification',
                    font: { size: 30 }
                },
                tickfont: { size: 24 }
            }
        };

        Plotly.newPlot('plot', [traceWT, traceKO], layout);
    }

    const input = document.getElementById('geneInput');
    const goBtn = document.getElementById('goBtn');

    goBtn.addEventListener('click', () => {
        const gene = input.value.trim();
        if (!gene) return;
        drawBox(gene);
    });
  </script>
</body>
</html>
`);
}

// 删除CSV文件
document.getElementById("btn-delete-csv")?.addEventListener("click", () => {
  const sel = document.getElementById("csv-select");
  if (!sel || !sel.value) return;

  const filePath = sel.value;

  if (!confirm("Delete this CSV file?")) return;

  fetch("/delete_csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath })
  })
  .then(resp => {
    if (!resp.ok) throw new Error("delete failed");
    return resp.json();
  })
  .then(() => {
    location.reload();
  })
  .catch(err => {
    console.error(err);
    alert("Failed to delete CSV");
  });
});