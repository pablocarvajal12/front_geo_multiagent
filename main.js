/**
 * main.js - GeoMultiAgent 3D Frontend
 * Solo ASCII en comentarios y strings para evitar problemas de encoding.
 */

import {
  Ion,
  Viewer,
  Cartesian3,
  Rectangle,
  Color,
  SingleTileImageryProvider,
  GeoJsonDataSource,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  BoundingSphere,
  HeadingPitchRange,
} from "cesium";

// ---------------------------------------------------------------------------
// 1. Viewer - sin Ion token, sin Bing Maps, sin baseLayerPicker
// ---------------------------------------------------------------------------
Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsFInR5cCI6IkpXVCJ9.eyJqdGkiOiIyN2M3MmJhYy00ZmNiLTQ0MmEtOTljZC05YWIyMjU2YTJjYTEiLCJpZCI6NDQ2MjI4LCJzdWIiOiJwYWJsb2NydjEyIiwiaXNzIjoiaHR0cHM6Ly9hcGkuY2VzaXVtLmNvbSIsImF1ZCI6InRkbSIsImlhdCI6MTc4MTc4ODYxNX0.iFW45Ta2JR6nNJlH8qK-wxq_2IiZQaT9D_oEmgn6jpg";
const viewer = new Viewer("cesiumContainer", {
  // Quita el imageryProvider personalizado — Ion lo gestiona automaticamente
  baseLayerPicker: false,
  animation: false,
  timeline: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: true,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: true,
  selectionIndicator: true,
  creditContainer: document.createElement("div"),
});

// Eliminar capa Ion por defecto y usar OSM como capa base (indice 0)
viewer.imageryLayers.removeAll();
viewer.imageryLayers.addImageryProvider(
  new UrlTemplateImageryProvider({
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maximumLevel: 19,
    credit: "OpenStreetMap contributors",
  })
);

// Fondo negro espacio
viewer.scene.backgroundColor = Color.fromCssColorString("#0a0e1a");
viewer.scene.skyBox.show = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.targetFrameRate = 60;
viewer.resolutionScale = window.devicePixelRatio || 1;

// ---------------------------------------------------------------------------
// 2. Camara inicial - Espana con pitch inclinado para efecto 3D
// ---------------------------------------------------------------------------

viewer.camera.setView({
  destination: Cartesian3.fromDegrees(-3.7, 40.4, 2500000),
  orientation: {
    heading: CesiumMath.toRadians(0),
    pitch:   CesiumMath.toRadians(-35),
    roll: 0,
  },
});

// ---------------------------------------------------------------------------
// 3. Gestion de capas
// ---------------------------------------------------------------------------

/** Elimina capas de analisis previas. Mantiene solo la capa base OSM (indice 0). */
function clearAnalysisLayers() {
  while (viewer.imageryLayers.length > 1) {
    viewer.imageryLayers.remove(viewer.imageryLayers.get(1));
  }
  viewer.entities.removeAll();
  viewer.dataSources.removeAll();
  clearLegend();
}

/** Vacia y oculta la leyenda del mapa. */
function clearLegend() {
  var el = document.getElementById("map-legend");
  if (!el) return;
  el.innerHTML = "";
  el.classList.add("hidden");
}

/**
 * Anade una entrada a la leyenda del mapa: checkbox para mostrar/ocultar la
 * capa y, si la capa lleva leyenda de colores (overlays), sus swatches.
 * @param {object} layerInfo     Metadatos de la capa recibidos del backend
 * @param {object} imageryLayer  ImageryLayer de Cesium ya anadido al viewer
 */
function addLegendEntry(layerInfo, imageryLayer) {
  var el = document.getElementById("map-legend");
  if (!el) return;
  el.classList.remove("hidden");

  if (!el.querySelector(".legend-title")) {
    var title = document.createElement("div");
    title.className = "legend-title";
    title.innerText = "Capas del analisis";
    el.appendChild(title);
  }

  var row = document.createElement("label");
  row.className = "legend-row";
  var cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = imageryLayer.show;
  cb.addEventListener("change", function() {
    imageryLayer.show = cb.checked;
    viewer.scene.requestRender();
  });
  row.appendChild(cb);
  var name = document.createElement("span");
  name.className = "legend-name";
  name.innerText = layerInfo.name || layerInfo.id || "Capa";
  row.appendChild(name);
  el.appendChild(row);

  (layerInfo.legend || []).forEach(function(item) {
    var li = document.createElement("div");
    li.className = "legend-item";
    var sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = item.color;
    li.appendChild(sw);
    var lb = document.createElement("span");
    lb.innerText = item.label;
    li.appendChild(lb);
    el.appendChild(li);
  });
}

/**
 * Dibuja el poligono del area de estudio.
 * @param {number[]} bbox  [W, S, E, N]
 */
function drawStudyArea(bbox) {
  const [w, s, e, n] = bbox;
  viewer.entities.add({
    name: "Area de analisis",
    rectangle: {
      coordinates: Rectangle.fromDegrees(w, s, e, n),
      material: Color.fromCssColorString("#00d4ff").withAlpha(0.12),
      outline: true,
      outlineColor: Color.fromCssColorString("#00d4ff"),
      outlineWidth: 2,
      height: 0,
    },
    description:
      "<b>Area de analisis</b><br>Bbox: " +
      bbox.map((v) => v.toFixed(3)).join(", "),
  });
}

/**
 * Proyecta un PNG de indice sobre el bbox en el globo.
 * @param {string}   url
 * @param {number[]} bbox     [W, S, E, N]
 * @param {number}   opacity  0-1
 */
function addIndexLayer(url, bbox, opacity) {
  const [w, s, e, n] = bbox;
  const provider = new SingleTileImageryProvider({
    url,
    rectangle: Rectangle.fromDegrees(w, s, e, n),
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = opacity != null ? opacity : 0.75;
  return layer;
}

/**
 * Anima la camara hasta el area analizada.
 * @param {number[]} bbox  [W, S, E, N]
 */
function flyToBbox(bbox) {
  const [w, s, e, n] = bbox;
  // flyToBoundingSphere orbita alrededor del centro del area, de modo que el
  // punto de mira de la camara es siempre el centro del bbox aunque la vista
  // este inclinada (con flyTo + Rectangle + pitch, el area quedaba descentrada).
  const sphere = BoundingSphere.fromRectangle3D(Rectangle.fromDegrees(w, s, e, n));
  sphere.radius *= 1.2; // margen alrededor del area
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new HeadingPitchRange(
      CesiumMath.toRadians(0),
      CesiumMath.toRadians(-40),
      0 // 0 → Cesium calcula la distancia justa para encuadrar todo el area
    ),
    duration: 2.5,
  });
}

// ---------------------------------------------------------------------------
// 4. Renderer de Markdown minimo (sin dependencias externas)
// ---------------------------------------------------------------------------

function convertTables(md) {
  // Convierte bloques de tabla GFM (| a | b |\n|---|---|\n| c | d |) en <table>,
  // ANTES del resto de transformaciones linea a linea que romperian el bloque.
  const lines = md.split("\n");
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const splitCells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitCells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) {
        rows.push(splitCells(lines[i]));
        i++;
      }
      const thead = "<thead><tr>" + header.map((c) => `<th>${c}</th>`).join("") + "</tr></thead>";
      const tbody = "<tbody>" + rows.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
      out.push(`<div class="md-table-wrap"><table>${thead}${tbody}</table></div>`);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

function stripEvidenceTable(md) {
  // La tabla de evidencia ahora vive en su propia pestana ("Tabla de Evidencia"),
  // rendereada directamente desde computed_indices. La quitamos del informe
  // narrativo para no duplicarla (el backend la sigue anadiendo al .md guardado
  // en disco, eso no se toca).
  return (md || "").split(/\n\n##\s*Tabla de Evidencia/)[0];
}

function renderIndicesTable(computedIndices) {
  if (!computedIndices || !Object.keys(computedIndices).length) {
    return "<p><em>Sin datos calculados disponibles.</em></p>";
  }
  const rows = [];
  Object.keys(computedIndices).forEach((source) => {
    const stats = computedIndices[source];
    if (!stats || typeof stats !== "object") return;
    Object.keys(stats).forEach((stat) => {
      const value = stats[stat];
      const valueStr = typeof value === "number" ? value.toFixed(Math.abs(value) < 10 ? 4 : 2) : String(value);
      rows.push(`<tr><td>${source}</td><td>${stat}</td><td>${valueStr}</td></tr>`);
    });
  });
  if (!rows.length) return "<p><em>Sin datos calculados disponibles.</em></p>";
  return (
    "<h2>Datos del Analisis</h2>" +
    "<p>Aqui puedes consultar todos los numeros exactos que se han calculado durante el analisis " +
    "(medias por zona, porcentajes de superficie afectada, etc.). El informe de la otra pestana " +
    "resume estos datos en lenguaje sencillo; esta tabla muestra el detalle completo en el que se " +
    "basan sus conclusiones, por si quieres revisarlo o citarlo con precision.</p>" +
    '<div class="md-table-wrap"><table><thead><tr><th>Fuente</th><th>Estadistica</th><th>Valor</th></tr></thead>' +
    "<tbody>" + rows.join("") + "</tbody></table></div>"
  );
}

function renderPythonCode(code) {
  if (!code) {
    return (
      "<h2>Codigo Python</h2>" +
      "<p><em>No se genero codigo Python para este analisis (se uso un calculo directo de " +
      "respaldo en su lugar, sin pasar por el modelo de lenguaje).</em></p>"
    );
  }
  return (
    "<h2>Codigo Python</h2>" +
    "<p>Este es el script que el Agente Analista genero y ejecuto realmente para calcular los " +
    "indices y las visualizaciones de este analisis. Se muestra tal cual para que puedas revisarlo " +
    "o verificarlo, con total transparencia sobre como se han obtenido los resultados.</p>" +
    '<pre><code id="python-code-block"></code></pre>'
  );
}

function renderMarkdown(md) {
  if (!md) return "<p><em>Sin informe disponible.</em></p>";
  return convertTables(md)
    .replace(/^### (.+)$/gm,  "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,   "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,    "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,    "<em>$1</em>")
    .replace(/`([^`]+)`/g,    "<code>$1</code>")
    .replace(/^- (.+)$/gm,    "<li>$1</li>")
    .replace(/((<li>[^<]+<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

// ---------------------------------------------------------------------------
// 5. Helpers de UI
// ---------------------------------------------------------------------------

const AGENTS = ["planner", "data_acquisition", "analyst", "reporter"];

function setAgentState(id, state, text) {
  const dot = document.getElementById("dot-" + id);
  const txt = document.getElementById("txt-" + id);
  if (dot) dot.className = "tl-dot " + state;
  if (txt && text) txt.innerText = text;
}

function resetTimeline() {
  AGENTS.forEach(function(id) { setAgentState(id, "", "En espera..."); });
}

function setBusy(busy) {
  const btn     = document.getElementById("btn-run");
  const spinner = document.getElementById("btn-spinner");
  const btnTxt  = document.getElementById("btn-text");
  btn.disabled = busy;
  spinner.classList.toggle("active", busy);
  btnTxt.innerText = busy ? "Procesando pipeline..." : "\u25B6 Ejecutar analisis";
}

// ---------------------------------------------------------------------------
// 6. Pestanas (tabs)
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    var target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
    document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
    tab.classList.add("active");
    document.getElementById("tab-" + target).classList.add("active");
    if (target === "map") {
      setTimeout(function() {
        viewer.resize();
        viewer.scene.requestRender();
      }, 50);
    }
  });
});
// ---------------------------------------------------------------------------
// 7. Chips de ejemplo
// ---------------------------------------------------------------------------

document.querySelectorAll(".example-chip").forEach(function(chip) {
  chip.addEventListener("click", function() {
    document.getElementById("query-input").value = chip.dataset.query;
  });
});

// ---------------------------------------------------------------------------
// 8. WebSocket + orquestacion del pipeline
// ---------------------------------------------------------------------------

var API_BASE = "http://localhost:8000";
var WS_BASE  = "ws://localhost:8000";

window.runQuery = async function() {
  var query = document.getElementById("query-input").value.trim();
  if (!query) { alert("Por favor, escribe una consulta."); return; }

  setBusy(true);
  resetTimeline();
  clearAnalysisLayers();

  var sessionId = Math.random().toString(36).substring(2, 10);
  var ws = new WebSocket(WS_BASE + "/ws/" + sessionId);

  ws.onopen = function() {
    ws.send(JSON.stringify({ query: query, session_id: sessionId }));
  };

  ws.onmessage = async function(event) {
    var msg = JSON.parse(event.data);

    // --- Agente iniciado ---
    if (msg.type === "agent_start") {
      AGENTS.forEach(function(id) {
        if (id === msg.agent) setAgentState(id, "active", "Ejecutando...");
      });
    }

    // --- Log de agente ---
    if (msg.type === "agent_log") {
      var txt = document.getElementById("txt-" + msg.agent);
      if (txt) txt.innerText = (msg.content || "Procesando...").slice(0, 120);
    }

    // --- Pipeline completado ---
    if (msg.type === "completed") {
      setBusy(false);
      AGENTS.forEach(function(id) { setAgentState(id, "done", "Completado"); });

      var d = msg.data || {};

      // Mostrar informe (sin la tabla de evidencia, que va en su propia pestana)
      var reportEl = document.getElementById("report-content");
      reportEl.innerHTML = "<div class=\"markdown\">" + renderMarkdown(stripEvidenceTable(d.report)) + "</div>";

      // Mostrar tabla de evidencia (directamente desde computed_indices, no del markdown)
      var dataEl = document.getElementById("data-content");
      dataEl.innerHTML = "<div class=\"markdown\">" + renderIndicesTable(d.computed_indices) + "</div>";

      // Mostrar el codigo Python generado por el Agente Analista. Se usa textContent
      // (no innerHTML) para el bloque de codigo en si, para no romper el HTML si el
      // codigo contiene caracteres como < > & y para evitar cualquier inyeccion.
      var codeEl = document.getElementById("code-content");
      codeEl.innerHTML = "<div class=\"markdown\">" + renderPythonCode(d.generated_code) + "</div>";
      var codeBlockEl = document.getElementById("python-code-block");
      if (codeBlockEl) codeBlockEl.textContent = d.generated_code || "";

      // Pedir datos Cesium al endpoint REST
      var cesiumUrl = d.cesium_data_url
        ? API_BASE + d.cesium_data_url
        : API_BASE + "/api/cesium-data/" + (d.session_id || sessionId);

      try {
        var res    = await fetch(cesiumUrl);
        var cesium = await res.json();

        console.log("[Cesium] Respuesta de cesium-data:", JSON.stringify(cesium));

        if (cesium.bbox) {
          flyToBbox(cesium.bbox);
          drawStudyArea(cesium.bbox);
          console.log("[Cesium] bbox OK:", cesium.bbox);
        } else {
          console.warn("[Cesium] Sin bbox en la respuesta. Datos recibidos:", cesium);
        }

        if (cesium.layers && cesium.layers.length && cesium.bbox) {
          console.log("[Cesium] Capas a renderizar:", cesium.layers.length);
          // Si hay overlays de zonas afectadas, los rasters de indices se
          // anaden ocultos por defecto (activables desde la leyenda) para no
          // tapar las zonas marcadas.
          var hasOverlays = cesium.layers.some(function(l) { return l.type === "overlay"; });
          cesium.layers.forEach(function(layer, i) {
            if (!layer.url) return;
            var isOverlay = layer.type === "overlay";
            if (!isOverlay && layer.type !== "imagery_url") return;
            // Bounds reales del raster si el backend los conoce; si no, bbox del plan
            var rect = (layer.bounds && layer.bounds.length === 4) ? layer.bounds : cesium.bbox;
            setTimeout(function() {
              // Los overlays llevan transparencia por pixel en el propio PNG.
              // El backend puede marcar una capa como oculta por defecto
              // (p.ej. "todas las zonas de agua" cuando ya hay capa de agua
              // nueva); se activa desde la leyenda.
              var imagery = addIndexLayer(API_BASE + layer.url, rect, isOverlay ? 1.0 : 0.75);
              imagery.show = isOverlay ? layer.visible !== false : !hasOverlays;
              addLegendEntry(layer, imagery);
              console.log("[Cesium] Capa añadida:", layer.url);
            }, i * 300);
          });
        } else {
          console.warn("[Cesium] Sin capas de imagenes. layers:", cesium.layers);
        }

        // Cambiar a la pestana del mapa automaticamente al recibir resultado
        document.querySelector("[data-tab='map']").click();

      } catch (err) {
        console.warn("[Cesium] Error cargando datos del mapa:", err);
      }

      ws.close();
    }

    // --- Error del pipeline ---
    if (msg.type === "error") {
      setBusy(false);
      AGENTS.forEach(function(id) { setAgentState(id, "error", "Error"); });
      document.getElementById("report-content").innerHTML =
        "<div class=\"markdown\"><h2>Error en el pipeline</h2><p>" +
        (msg.content || "Error desconocido") + "</p></div>";
      ws.close();
    }
  };

  ws.onerror = function() {
    setBusy(false);
    alert("No se pudo conectar con el servidor. Comprueba que corre en localhost:8000.");
  };
};

document.getElementById("btn-run").addEventListener("click", window.runQuery);
