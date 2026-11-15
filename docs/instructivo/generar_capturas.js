/**
 * generar_capturas.js — Regenera las imágenes del instructivo y su versión PDF.
 *
 * Úsalo cuando cambie la interfaz:
 *   1. Arranca SubliApp con una carpeta de datos VACÍA (no uses la del negocio):
 *        Windows:  set SUBLIAPP_DATOS=C:\temp\subliapp_demo && python SubliApp.py --sin-navegador
 *        Linux/Mac: SUBLIAPP_DATOS=/tmp/subliapp_demo python SubliApp.py --sin-navegador
 *   2. En otra terminal, desde la carpeta del proyecto:
 *        npm install playwright   (solo la primera vez)
 *        node docs/instructivo/generar_capturas.js
 *
 * Carga datos de ejemplo de "Zafiro Lab", toma capturas reales de cada pantalla
 * con marcas numeradas y genera docs/Instructivo_SubliApp.pdf.
 * Las imágenes de los PDF de ejemplo necesitan `pdftoppm` (poppler); si no está
 * instalado, se conservan las que ya existan.
 */

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const B = 'http://127.0.0.1:8765';
const CARPETA = __dirname;
const IMG = path.join(CARPETA, 'img');
const TEMP = path.join(CARPETA, '.temp');
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(TEMP, { recursive: true });

// ---------------- Datos de ejemplo ----------------

const hoy = new Date();
const dia = (n) => { const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function api(metodo, ruta, datos) {
    const r = await fetch(B + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: datos ? JSON.stringify(datos) : undefined });
    const json = await r.json();
    if (!r.ok) throw new Error(`${ruta}: ${json.error}`);
    return json;
}

async function cargarDatos() {
    const estado = await api('GET', '/api/estado');
    if (estado.ventas.length || estado.insumos.length) {
        throw new Error('La carpeta de datos no está vacía. Arranca SubliApp con una carpeta de datos nueva (ver instrucciones arriba).');
    }
    await api('PUT', '/api/config', {
        negocio_rif: 'J-50123456-7', negocio_telefono: '0414-555-1234', negocio_email: 'zafirolab@gmail.com',
        negocio_redes: '@zafirolab', negocio_direccion: 'Av. Bolívar, Local 12, Valencia',
    });
    await api('POST', '/api/tasas', { fecha: dia(-1), tasa: 36.2 });
    await api('POST', '/api/tasas', { fecha: dia(0), tasa: 36.5 });

    const I = {};
    for (const [nombre, categoria, unidad, costo, stock, minimo] of [
        ['Taza blanca 11oz', 'Sustrato', 'und', 1.8, 48, 12], ['Taza mágica 11oz', 'Sustrato', 'und', 3.1, 4, 6],
        ['Franela poliéster blanca M', 'Sustrato', 'und', 4.2, 60, 15], ['Gorra trucker blanca', 'Sustrato', 'und', 3.5, 7, 6],
        ['Papel sublimación A4', 'Consumible', 'hoja', 0.08, 500, 100], ['Tinta sublimación (set CMYK)', 'Consumible', 'ml', 0.004, 2000, 400],
        ['Cinta térmica', 'Consumible', 'm', 0.05, 30, 10],
    ]) {
        I[nombre] = (await api('POST', '/api/insumos', { nombre, categoria, unidad_medida: unidad, costo_unitario: costo, stock_actual: stock, stock_minimo: minimo })).id;
    }
    const P = {};
    for (const [nombre, categoria, precio, receta] of [
        ['Taza 11oz personalizada', 'Tazas', 8.5, [['Taza blanca 11oz', 1, 5], ['Papel sublimación A4', 1, 10], ['Tinta sublimación (set CMYK)', 4, 0], ['Cinta térmica', 0.3, 0]]],
        ['Taza mágica personalizada', 'Tazas', 12, [['Taza mágica 11oz', 1, 8], ['Papel sublimación A4', 1, 10], ['Tinta sublimación (set CMYK)', 4, 0]]],
        ['Franela sublimada full color', 'Textil', 14, [['Franela poliéster blanca M', 1, 3], ['Papel sublimación A4', 4, 10], ['Tinta sublimación (set CMYK)', 15, 0]]],
        ['Gorra trucker con logo', 'Gorras', 7, [['Gorra trucker blanca', 1, 5], ['Papel sublimación A4', 1, 0], ['Tinta sublimación (set CMYK)', 2, 0]]],
    ]) {
        P[nombre] = (await api('POST', '/api/productos', { nombre, categoria, precio_venta: precio, receta: receta.map(([i, c, m]) => ({ insumo_id: I[i], cantidad: c, merma_pct: m })) })).id;
    }
    const C = {};
    for (const [nombre, telefono, email, fecha, tipo] of [
        ['María González', '0414-1234567', 'maria@gmail.com', dia(2), 'Cumpleaños'],
        ['Colegio San José', '0241-8765432', 'compras@csj.edu.ve', null, null],
        ['Pedro Pérez', '0412-5550000', '', null, null],
        ['Gimnasio Fuerza Total', '0424-7778899', '', null, null],
    ]) {
        C[nombre] = (await api('POST', '/api/clientes', { nombre, telefono, email, fecha_especial: fecha, tipo_fecha: tipo })).id;
    }
    const venta = (d) => api('POST', '/api/ventas', d);
    const estado2 = (id, e) => api('PUT', `/api/ventas/${id}/estado`, { estado: e });
    const v1 = (await venta({ cliente_id: C['Colegio San José'], fecha: dia(-30), fecha_entrega: dia(-24), tasa: 35.8, detalle: [{ producto_id: P['Franela sublimada full color'], cantidad: 20, precio_unitario: 13 }], abono: { monto: 260, metodo: 'Transferencia' } })).id;
    await estado2(v1, 'Entregado');
    const v2 = (await venta({ cliente_id: C['Colegio San José'], fecha: dia(-5), fecha_entrega: dia(-1), notas: 'Logo del colegio en el pecho y nombre del alumno en la espalda.', detalle: [{ producto_id: P['Franela sublimada full color'], cantidad: 15, precio_unitario: 13 }, { producto_id: P['Gorra trucker con logo'], cantidad: 15, precio_unitario: 6.5 }], abono: { monto: 150, metodo: 'Pago móvil' } })).id;
    await estado2(v2, 'Imprimiendo');
    const v3 = (await venta({ cliente_id: C['María González'], fecha: dia(-1), fecha_entrega: dia(1), notas: 'Foto familiar; texto: "Feliz día mamá".', detalle: [{ producto_id: P['Taza mágica personalizada'], cantidad: 2, precio_unitario: 12 }, { producto_id: P['Taza 11oz personalizada'], cantidad: 3, precio_unitario: 8.5 }], abono: { moneda: 'VES', monto_original: 1806.75, metodo: 'Pago móvil' } })).id;
    await estado2(v3, 'Listo');
    await venta({ cliente_id: null, fecha: dia(0), detalle: [{ producto_id: P['Taza 11oz personalizada'], cantidad: 1, precio_unitario: 8.5 }], abono: { monto: 8.5, metodo: 'Efectivo' } });
    await venta({ cliente_id: C['Pedro Pérez'], fecha: dia(0), fecha_entrega: dia(4), detalle: [{ producto_id: P['Gorra trucker con logo'], cantidad: 4, precio_unitario: 7 }] });
    await api('POST', '/api/compras', { proveedor: 'ColorMake', fecha: dia(-12), items: [{ insumo_id: I['Franela poliéster blanca M'], cantidad: 30, costo_unitario: 4 }, { insumo_id: I['Papel sublimación A4'], cantidad: 500, costo_unitario: 0.07 }] });
    await api('POST', '/api/compras', { proveedor: 'Distribuidora Valencia', fecha: dia(-3), items: [{ insumo_id: I['Taza blanca 11oz'], cantidad: 36, costo_unitario: 1.75 }] });
    await api('POST', '/api/gastos', { fecha: dia(-8), categoria: 'Alquiler', descripcion: 'Local del mes', monto: 120 });
    await api('POST', '/api/gastos', { fecha: dia(-6), categoria: 'Electricidad', monto: 18.4 });
    await api('POST', '/api/gastos', { fecha: dia(-2), categoria: 'Internet y teléfono', monto: 25 });
    await api('POST', '/api/insumos/' + I['Taza blanca 11oz'] + '/ajuste', { tipo: 'Merma', cantidad: -1, nota: 'Se rompió en la prensa' });
    await api('POST', '/api/cotizaciones', { cliente_id: C['Gimnasio Fuerza Total'], fecha: dia(0), validez_dias: 15, notas: 'Entrega en 7 días hábiles tras aprobar el diseño.', items: [{ producto_id: P['Franela sublimada full color'], producto_nombre: '', cantidad: 40, precio_unitario: 13 }, { producto_id: null, producto_nombre: 'Diseño del logo vectorizado y adaptación a tres tamaños', cantidad: 1, precio_unitario: 25 }] });
    await api('POST', '/api/cotizaciones', { cliente_nombre: 'Academia de Baile Ritmo', fecha: dia(-3), validez_dias: 15, items: [{ producto_id: P['Taza 11oz personalizada'], producto_nombre: '', cantidad: 25, precio_unitario: 7.5 }] });
    return { I, P, C };
}

// ---------------- Marcas numeradas ----------------

/** Dibuja un recuadro y un número sobre cada elemento indicado. */
async function anotar(page, marcas) {
    await page.evaluate((marcas) => {
        document.querySelectorAll('.marca-instructivo').forEach(e => e.remove());
        marcas.forEach(({ sel, n, lado = 'izq', margen = 4 }) => {
            const el = typeof sel === 'string' ? document.querySelector(sel) : null;
            if (!el) { console.warn('Sin elemento para la marca', n, sel); return; }
            const r = el.getBoundingClientRect();
            const caja = document.createElement('div');
            caja.className = 'marca-instructivo';
            Object.assign(caja.style, {
                position: 'fixed', left: `${r.left - margen}px`, top: `${r.top - margen}px`, width: `${r.width + margen * 2}px`, height: `${r.height + margen * 2}px`,
                border: '3px solid #e11d48', borderRadius: '10px', zIndex: 9998, pointerEvents: 'none', boxShadow: '0 0 0 3px rgba(225,29,72,.15)',
            });
            const num = document.createElement('div');
            num.className = 'marca-instructivo';
            num.textContent = n;
            const x = lado === 'der' ? r.right + margen - 14 : r.left - margen - 14;
            Object.assign(num.style, {
                position: 'fixed', left: `${Math.max(2, x)}px`, top: `${Math.max(2, r.top - margen - 14)}px`, width: '28px', height: '28px', borderRadius: '50%',
                background: '#e11d48', color: '#fff', font: 'bold 15px Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, pointerEvents: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.3)',
            });
            document.body.append(caja, num);
        });
    }, marcas);
}

/** Cierra la ventana abierta con su botón X. */
const cerrar = (page) => page.click('#modal-panel [data-close]');

const quitarMarcas = (page) => page.evaluate(() => document.querySelectorAll('.marca-instructivo').forEach(e => e.remove()));

async function captura(page, nombre, marcas = [], opciones = {}) {
    await page.waitForTimeout(350);
    await page.evaluate(() => document.getElementById('toasts')?.remove()); // sin avisos en la foto
    if (marcas.length) await anotar(page, marcas);
    await page.screenshot({ path: path.join(IMG, `${nombre}.png`), ...opciones });
    await quitarMarcas(page);
    console.log('  imagen', nombre);
}

async function ir(page, seccion) {
    await page.click(`#link-${seccion}`);
    await page.waitForTimeout(400);
}

async function pdfAImagen(page, accion, nombre) {
    const [descarga] = await Promise.all([page.waitForEvent('download'), accion()]);
    const archivo = path.join(TEMP, `${nombre}.pdf`);
    await descarga.saveAs(archivo);
    try {
        execFileSync('pdftoppm', ['-r', '90', '-png', '-f', '1', '-l', '1', '-singlefile', archivo, path.join(IMG, nombre)]);
        console.log('  imagen', nombre, '(PDF)');
    } catch {
        console.warn('  pdftoppm no disponible: se conserva la imagen anterior de', nombre);
    }
}

// ---------------- Recorrido ----------------

(async () => {
    console.log('Cargando datos de ejemplo...');
    const { I, P, C } = await cargarDatos();
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 1.5, acceptDownloads: true, locale: 'es-VE', timezoneId: 'America/Caracas' });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(B);
    await page.waitForSelector('#app-shell:not(.hidden)');
    const estado = await api('GET', '/api/estado');
    const venta = (folio) => estado.ventas.find(v => v.folio === folio);

    // Logo del negocio: se sube con el mismo botón de Configuración que usa el usuario.
    await ir(page, 'configuracion');
    await page.setInputFiles('#cfg-logo', path.join(IMG, 'logo_zafiro.png'));
    await page.waitForSelector('#marca img');
    await ir(page, 'inicio');

    // 1. Pantalla general
    await captura(page, '01_pantalla_general', [
        { sel: '#sidebar nav', n: 1 }, { sel: '#header-title', n: 2, lado: 'der' }, { sel: '#header-actions > button:first-child', n: 3 },
        { sel: '#header-actions > button:last-child', n: 4, lado: 'der' }, { sel: '#tab-inicio .grid', n: 5 },
    ]);
    await page.evaluate(() => { document.getElementById('contenido').scrollTop = 420; });
    await captura(page, '02_inicio_paneles');
    await page.evaluate(() => { document.getElementById('contenido').scrollTop = 0; });

    // 2. Configuración
    await ir(page, 'configuracion');
    await captura(page, '03_configuracion', [
        { sel: '#cfg-negocio_nombre', n: 1 }, { sel: '#cfg-logo', n: 2 }, { sel: '#cfg-respaldo', n: 3, lado: 'der' },
    ].map(m => m.sel === '#cfg-logo' ? { ...m, sel: 'label:has(#cfg-logo)' } : m));
    await page.evaluate(() => { document.getElementById('contenido').scrollTop = 560; });
    await captura(page, '04_configuracion_preferencias', [{ sel: '#cfg-margen_objetivo', n: 1 }, { sel: '#cfg-docmon', n: 2 }, { sel: '#cfg-prev-recibo', n: 3 }]);
    await page.evaluate(() => { document.getElementById('contenido').scrollTop = 0; });

    // 3. Tasa del día
    await page.click('#header-actions > button:first-child');
    await captura(page, '05_tasa_del_dia', [{ sel: '#modal-panel [name=tasa]', n: 1 }, { sel: '#tasa-ejemplo', n: 2 }]);
    await cerrar(page);

    // 4. Inventario
    await ir(page, 'inventario');
    await captura(page, '06_inventario', [
        { sel: '#inventario-kpis', n: 1 }, { sel: '#chips-inventario', n: 2 }, { sel: '#buscar-insumo', n: 3, lado: 'der' },
        { sel: '#tbl-inventario tr:nth-child(6) td:nth-child(5)', n: 4 }, { sel: '#tbl-inventario tr:first-child td:last-child', n: 5, lado: 'der' },
    ]);
    await page.click('text=Nuevo Insumo');
    await page.fill('#modal-panel [name=nombre]', 'Mouse pad para sublimar');
    await page.selectOption('#modal-panel [name=categoria]', 'Sustrato');
    await page.fill('#modal-panel [name=costo_unitario]', '1.2');
    await page.fill('#modal-panel [name=stock_actual]', '30');
    await page.fill('#modal-panel [name=stock_minimo]', '10');
    await captura(page, '07_insumo_nuevo', [
        { sel: '#modal-panel [name=categoria]', n: 1 }, { sel: '#modal-panel [name=unidad_medida]', n: 2 },
        { sel: '#modal-panel [name=costo_unitario]', n: 3 }, { sel: '#modal-panel [name=stock_minimo]', n: 4, lado: 'der' },
    ]);
    await cerrar(page);
    await page.click(`[onclick="App.openKardex('${I['Taza blanca 11oz']}')"]`);
    await page.waitForSelector('#modal-panel [name=cantidad]');
    await captura(page, '08_kardex', [{ sel: '#modal-panel .bg-amber-50\\/50', n: 1 }, { sel: '#modal-panel table', n: 2 }]);
    await cerrar(page);

    // 5. Productos
    await ir(page, 'productos');
    await captura(page, '09_productos', [
        { sel: '#productos-cuerpo > div:first-child', n: 1 }, { sel: '#productos-cuerpo table th:nth-child(5)', n: 2 }, { sel: '#productos-cuerpo table th:nth-child(6)', n: 3 },
    ]);
    await page.click(`[onclick="App.openProductoModal('${P['Taza 11oz personalizada']}')"]`);
    await captura(page, '10_producto_receta', [
        { sel: '#receta-rows', n: 1 }, { sel: '#btn-add-receta', n: 2, lado: 'der' }, { sel: '#modal-panel [name=precio_venta]', n: 3 }, { sel: '#usar-sugerido', n: 4, lado: 'der' },
    ]);
    await cerrar(page);

    // 6. Clientes
    await ir(page, 'clientes');
    await captura(page, '11_clientes', [{ sel: '#tbl-clientes tr:nth-child(3) td:nth-child(3)', n: 1 }, { sel: '#tbl-clientes tr:first-child td:nth-child(5)', n: 2 }, { sel: '#tbl-clientes tr:first-child td:last-child', n: 3, lado: 'der' }]);
    await page.click(`[onclick="App.openClienteModal('${C['María González']}')"]`);
    await captura(page, '12_cliente_formulario');
    await cerrar(page);

    // 7. Ventas
    await ir(page, 'ventas');
    await captura(page, '13_ventas', [
        { sel: '#buscar-venta', n: 1 }, { sel: '#chips-ventas', n: 2, lado: 'der' }, { sel: '#tbl-ventas tr:nth-child(3) td:nth-child(4)', n: 3 },
        { sel: '#tbl-ventas tr:nth-child(3) td:nth-child(5)', n: 4 }, { sel: '#tbl-ventas tr:nth-child(3) td:nth-child(7)', n: 5 }, { sel: '#tbl-ventas tr:nth-child(3) td:last-child', n: 6, lado: 'der' },
    ]);
    await page.click('#header-actions >> text=Nueva Venta');
    await page.fill('#venta-cliente', 'Pedro'); await page.keyboard.press('Enter');
    await page.fill('[data-producto="0"]', 'taza 11'); await page.keyboard.press('Enter');
    await page.fill('[data-campo="cantidad"][data-i="0"]', '6');
    await page.click('#btn-add-linea'); await page.fill('[data-producto="1"]', 'magica'); await page.keyboard.press('Enter');
    await page.fill('#modal-panel [name=fecha_entrega]', dia(3));
    await page.fill('#modal-panel [name=notas]', 'Tazas con el logo de su empresa.');
    await page.selectOption('#modal-panel [name=abono_moneda]', 'VES'); await page.click('[data-abono="0.5"]');
    await page.selectOption('#modal-panel [name=abono_metodo]', 'Pago móvil');
    await page.click('#modal-panel [name=notas]');
    await captura(page, '14_venta_nueva', [
        { sel: '#venta-cliente', n: 1 }, { sel: '#venta-lineas', n: 2 }, { sel: '#modal-panel [name=fecha_entrega]', n: 3, lado: 'der' },
        { sel: '#modal-panel .bg-emerald-50\\/50', n: 4 }, { sel: '#venta-total', n: 5, lado: 'der' },
    ]);
    await cerrar(page);
    await page.click(`#tbl-ventas [onclick="App.openPagosModal('${venta(2).id}')"]`);
    await page.selectOption('#modal-panel [name=moneda]', 'VES');
    await captura(page, '15_abonos', [{ sel: '#modal-panel .grid-cols-3', n: 1 }, { sel: '#modal-panel ul', n: 2 }, { sel: '#modal-panel .bg-slate-50.rounded-xl.border', n: 3 }]);
    await cerrar(page);
    await page.click(`[onclick="App.descargarRecibo('${venta(2).id}')"]`);
    await page.check('#modal-panel [name=moneda][value=ambas]');
    await captura(page, '16_elegir_moneda', [{ sel: '#modal-panel .grid', n: 1 }, { sel: '#doc-tasa', n: 2 }]);
    await pdfAImagen(page, () => page.click('#modal-panel button[type=submit]'), '17_recibo_pdf');

    // 8. Cotizaciones
    await ir(page, 'cotizaciones');
    await captura(page, '18_cotizaciones', [{ sel: '#tbl-cotizaciones tr:first-child td:nth-child(6)', n: 1 }, { sel: '#tbl-cotizaciones tr:first-child td:last-child', n: 2, lado: 'der' }]);
    const cot = estado.cotizaciones.find(c => c.folio === 1);
    await page.click(`[onclick="App.openCotizacionModal('${cot.id}')"]`);
    await captura(page, '19_cotizacion_formulario', [{ sel: '#cot-cliente', n: 1 }, { sel: '#cot-lineas > div:nth-child(2)', n: 2 }, { sel: '#modal-panel [name=validez_dias]', n: 3, lado: 'der' }]);
    await cerrar(page);
    await page.click(`[onclick="App.descargarCotizacion('${cot.id}')"]`);
    await page.check('#modal-panel [name=moneda][value=local]');
    await pdfAImagen(page, () => page.click('#modal-panel button[type=submit]'), '20_cotizacion_pdf');

    // 9. Producción
    await ir(page, 'produccion');
    await captura(page, '21_produccion', [
        { sel: '.kanban-col:nth-child(2) .kanban-card .bg-rose-100', n: 1, lado: 'der' }, { sel: '.kanban-col:nth-child(2) .kanban-card button[onclick^="App.avanzarEstado"]', n: 2, lado: 'der' },
        { sel: '.kanban-col:nth-child(2) .kanban-card button[onclick^="App.openAdjuntosModal"]', n: 3 }, { sel: '.kanban-col:nth-child(3) button[onclick^="App.avisarCliente"]', n: 4 },
    ]);

    // 10. Compras y gastos
    await ir(page, 'compras');
    await page.click('#header-actions >> text=Nueva Compra');
    await page.fill('#modal-panel [name=proveedor]', 'ColorMake');
    await page.fill('[data-insumo="0"]', 'tinta'); await page.keyboard.press('Enter');
    await page.fill('[data-campo="cantidad"][data-i="0"]', '1000'); await page.fill('[data-campo="costo_unitario"][data-i="0"]', '0.0045');
    await page.click('#modal-panel [name=proveedor]');
    await captura(page, '22_compra_nueva', [{ sel: '#modal-panel [name=proveedor]', n: 1 }, { sel: '#compra-lineas', n: 2 }]);
    await cerrar(page);
    await captura(page, '23_compras');
    await ir(page, 'gastos');
    await captura(page, '24_gastos', [{ sel: '#gastos-mes', n: 1 }, { sel: '#gastos-resumen', n: 2 }]);

    // 11. Reportes
    await ir(page, 'reportes');
    await captura(page, '25_reportes', [{ sel: '#rep-periodo', n: 1 }, { sel: '#rep-cuerpo > div:first-child', n: 2 }, { sel: '#rep-excel', n: 3, lado: 'der' }]);

    // 12. PDF del instructivo
    console.log('Generando PDF del instructivo...');
    const doc = await ctx.newPage();
    await doc.goto(`${B}/docs/instructivo/index.html`);
    await doc.waitForLoadState('networkidle');
    await doc.pdf({
        path: path.join(CARPETA, '..', 'Instructivo_SubliApp.pdf'), format: 'A4', printBackground: true,
        margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
        displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: '<div style="font-size:8px;color:#64748b;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:Helvetica"><span>Instructivo SubliApp · Zafiro Lab</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
    });
    console.log('Listo: docs/Instructivo_SubliApp.pdf');
    await navegador.close();
    fs.rmSync(TEMP, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
