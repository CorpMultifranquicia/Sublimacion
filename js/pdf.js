/**
 * pdf.js — Recibos de venta y cotizaciones en PDF (jsPDF, incluido en vendor/).
 *
 * Los datos del negocio (nombre, RIF, contacto, logo, condiciones, pie) se toman
 * de Configuración. Diseño A4 vertical, medidas en milímetros.
 */

import { Store } from './store.js';
import { fmt, fmtNum, fmtFecha, hoyISO, sumarDias, folioVenta, folioCotizacion, configurarMoneda } from './util.js';

// Colores de marca (RGB)
const AZUL_MARINO = [27, 42, 128];
const AZUL = [37, 99, 235];
const VIOLETA = [139, 47, 201];
const GRIS = [100, 116, 139];
const GRIS_CLARO = [241, 245, 249];
const TEXTO = [30, 41, 59];
const VERDE = [5, 150, 105];
const ROJO = [220, 38, 38];

const PAGINA = { ancho: 210, alto: 297, margen: 15 };
const DERECHA = PAGINA.ancho - PAGINA.margen;
const LIMITE_INFERIOR = PAGINA.alto - 28; // espacio reservado al pie de página

function nuevoDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setLineHeightFactor(1.25);
    return doc;
}

const color = (doc, rgb) => doc.setTextColor(...rgb);
function fuente(doc, tamano, estilo = 'normal', rgb = TEXTO) {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(tamano);
    color(doc, rgb);
}

/** Nombre de archivo seguro: Recibo_VEN-0001_Ana_Perez.pdf */
function nombreArchivo(...partes) {
    return partes.filter(Boolean).join('_')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') + '.pdf';
}

// ---------------- Bloques ----------------

/** Encabezado: logo + datos del negocio a la izquierda, título y datos del documento a la derecha. */
function encabezado(doc, cfg, titulo, filasDerecha) {
    let y = PAGINA.margen;
    let yIzq = y;

    if (cfg.logo) {
        try {
            const props = doc.getImageProperties(cfg.logo);
            const escala = Math.min(58 / props.width, 26 / props.height);
            const w = props.width * escala;
            const h = props.height * escala;
            doc.addImage(cfg.logo, 'PNG', PAGINA.margen, y, w, h, undefined, 'FAST');
            yIzq = y + h + 6;
        } catch (e) {
            console.warn('No se pudo dibujar el logo', e);
        }
    }
    fuente(doc, cfg.logo ? 11 : 16, 'bold', AZUL_MARINO);
    yIzq += cfg.logo ? 0 : 4;
    doc.text(cfg.negocio_nombre || 'Mi negocio', PAGINA.margen, yIzq);
    yIzq += cfg.logo ? 4.5 : 5;
    if (!cfg.logo && cfg.negocio_eslogan) {
        fuente(doc, 9, 'italic', VIOLETA);
        doc.text(cfg.negocio_eslogan, PAGINA.margen, yIzq);
        yIzq += 5;
    }

    fuente(doc, 8.5, 'normal', GRIS);
    const datos = [
        cfg.negocio_rif && `RIF: ${cfg.negocio_rif}`,
        [cfg.negocio_telefono && `Tel: ${cfg.negocio_telefono}`, cfg.negocio_email].filter(Boolean).join('  ·  '),
        cfg.negocio_direccion,
        cfg.negocio_redes,
    ].filter(Boolean);
    datos.forEach(linea => {
        doc.splitTextToSize(linea, 95).forEach(l => { doc.text(l, PAGINA.margen, yIzq); yIzq += 4; });
    });

    // Derecha: título y datos del documento
    fuente(doc, 20, 'bold', AZUL_MARINO);
    doc.text(titulo, DERECHA, y + 7, { align: 'right' });
    let yDer = y + 14;
    filasDerecha.forEach(([etiqueta, valor, destacado]) => {
        fuente(doc, 9, 'normal', GRIS);
        const anchoValor = (() => { fuente(doc, destacado ? 11 : 9.5, 'bold', destacado ? AZUL_MARINO : TEXTO); return doc.getTextWidth(valor); })();
        doc.text(valor, DERECHA, yDer, { align: 'right' });
        fuente(doc, 9, 'normal', GRIS);
        doc.text(etiqueta, DERECHA - anchoValor - 2, yDer, { align: 'right' });
        yDer += destacado ? 6 : 5;
    });

    y = Math.max(yIzq, yDer) + 2;
    // Franja de marca: azul -> violeta
    doc.setFillColor(...AZUL);
    doc.rect(PAGINA.margen, y, (DERECHA - PAGINA.margen) * 0.62, 1.2, 'F');
    doc.setFillColor(...VIOLETA);
    doc.rect(PAGINA.margen + (DERECHA - PAGINA.margen) * 0.62, y, (DERECHA - PAGINA.margen) * 0.38, 1.2, 'F');
    return y + 7;
}

/** Recuadro con los datos del cliente y, a la derecha, datos extra (estado, validez...). */
function bloqueCliente(doc, y, cliente, extras = []) {
    const lineas = [cliente.telefono && `Tel: ${cliente.telefono}`, cliente.email].filter(Boolean);
    fuente(doc, 11, 'bold', TEXTO);
    const nombre = doc.splitTextToSize(cliente.nombre || 'Cliente de mostrador', 115).slice(0, 2);
    const extraNombre = (nombre.length - 1) * 5;
    // Nombre en +10.5 mm y cada línea extra 4.5 mm más abajo, con 4 mm de margen inferior.
    const alto = Math.max(16, 14.5 + extraNombre + lineas.length * 4.5, 7 + extras.length * 5);
    doc.setFillColor(...GRIS_CLARO);
    doc.roundedRect(PAGINA.margen, y, DERECHA - PAGINA.margen, alto, 2, 2, 'F');
    fuente(doc, 7.5, 'bold', GRIS);
    doc.text('CLIENTE', PAGINA.margen + 4, y + 5);
    fuente(doc, 11, 'bold', TEXTO);
    doc.text(nombre, PAGINA.margen + 4, y + 10.5);
    fuente(doc, 9, 'normal', GRIS);
    lineas.forEach((l, i) => doc.text(l, PAGINA.margen + 4, y + 15 + extraNombre + i * 4.5));

    extras.forEach(([etiqueta, valor, rgb], i) => {
        const yy = y + 6 + i * 5;
        fuente(doc, 9, 'bold', rgb || TEXTO);
        const w = doc.getTextWidth(valor);
        doc.text(valor, DERECHA - 4, yy, { align: 'right' });
        fuente(doc, 9, 'normal', GRIS);
        doc.text(etiqueta, DERECHA - 4 - w - 2, yy, { align: 'right' });
    });
    return y + alto + 7;
}

const COLUMNAS = { num: PAGINA.margen + 2, desc: PAGINA.margen + 10, anchoDesc: 92, cant: 133, precio: 163, subtotal: DERECHA - 2 };

function encabezadoTabla(doc, y) {
    doc.setFillColor(...AZUL_MARINO);
    doc.rect(PAGINA.margen, y, DERECHA - PAGINA.margen, 8, 'F');
    fuente(doc, 8.5, 'bold', [255, 255, 255]);
    doc.text('#', COLUMNAS.num, y + 5.3);
    doc.text('DESCRIPCIÓN', COLUMNAS.desc, y + 5.3);
    doc.text('CANT.', COLUMNAS.cant, y + 5.3, { align: 'right' });
    doc.text('PRECIO UNIT.', COLUMNAS.precio, y + 5.3, { align: 'right' });
    doc.text('SUBTOTAL', COLUMNAS.subtotal, y + 5.3, { align: 'right' });
    return y + 8;
}

/** Tabla de productos con descripciones que se ajustan en varias líneas y saltos de página. */
function tablaItems(doc, y, items) {
    y = encabezadoTabla(doc, y);
    items.forEach((it, i) => {
        fuente(doc, 9.5, 'normal', TEXTO);
        const lineas = doc.splitTextToSize(it.nombre, COLUMNAS.anchoDesc);
        const alto = Math.max(8, lineas.length * 4.6 + 3.4);
        if (y + alto > LIMITE_INFERIOR) {
            doc.addPage();
            y = encabezadoTabla(doc, PAGINA.margen);
        }
        if (i % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(PAGINA.margen, y, DERECHA - PAGINA.margen, alto, 'F');
        }
        const base = y + 5.4;
        fuente(doc, 8.5, 'normal', GRIS);
        doc.text(String(i + 1), COLUMNAS.num, base);
        fuente(doc, 9.5, 'normal', TEXTO);
        doc.text(lineas, COLUMNAS.desc, base);
        doc.text(fmtNum(it.cantidad), COLUMNAS.cant, base, { align: 'right' });
        doc.text(fmt(it.precio_unitario), COLUMNAS.precio, base, { align: 'right' });
        fuente(doc, 9.5, 'bold', TEXTO);
        doc.text(fmt(it.cantidad * it.precio_unitario), COLUMNAS.subtotal, base, { align: 'right' });
        y += alto;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(PAGINA.margen, y, DERECHA, y);
    });
    return y;
}

/** Asegura `alto` mm libres antes del pie; si no hay, pasa a una página nueva. */
function espacio(doc, y, alto) {
    if (y + alto > LIMITE_INFERIOR) {
        doc.addPage();
        return PAGINA.margen + 5;
    }
    return y;
}

/** Bloque de totales a la derecha. filas: [[etiqueta, valor, {negrita, rgb}]] */
function totales(doc, y, total, filasExtra = []) {
    const x = 118;
    y = espacio(doc, y + 4, 14 + filasExtra.length * 6.5);
    doc.setFillColor(...AZUL_MARINO);
    doc.roundedRect(x, y, DERECHA - x, 10, 1.5, 1.5, 'F');
    fuente(doc, 10, 'bold', [255, 255, 255]);
    doc.text('TOTAL', x + 4, y + 6.7);
    fuente(doc, 13, 'bold', [255, 255, 255]);
    doc.text(fmt(total), DERECHA - 4, y + 6.9, { align: 'right' });
    y += 10;
    filasExtra.forEach(([etiqueta, valor, opc = {}]) => {
        y += 6.5;
        fuente(doc, 10, opc.negrita ? 'bold' : 'normal', opc.rgb || GRIS);
        doc.text(etiqueta, x + 4, y);
        doc.text(valor, DERECHA - 4, y, { align: 'right' });
    });
    return y + 4;
}

/** Sección de texto con título (notas, condiciones). */
function seccionTexto(doc, y, titulo, texto, ancho = DERECHA - PAGINA.margen) {
    if (!texto?.trim()) return y;
    fuente(doc, 9, 'normal', TEXTO);
    const lineas = doc.splitTextToSize(texto.trim(), ancho);
    y = espacio(doc, y + 2, 8 + lineas.length * 4.3);
    fuente(doc, 7.5, 'bold', GRIS);
    doc.text(titulo.toUpperCase(), PAGINA.margen, y);
    fuente(doc, 9, 'normal', TEXTO);
    doc.text(lineas, PAGINA.margen, y + 5);
    return y + 5 + lineas.length * 4.3 + 3;
}

/** Pie en todas las páginas: mensaje, aviso de documento no fiscal y numeración. */
function pieDePagina(doc, texto) {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        const y = PAGINA.alto - 14;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(PAGINA.margen, y - 4, DERECHA, y - 4);
        fuente(doc, 9, 'bold', AZUL_MARINO);
        if (texto) doc.text(doc.splitTextToSize(texto, 120)[0], PAGINA.margen, y);
        fuente(doc, 7.5, 'normal', GRIS);
        doc.text('Documento no fiscal', PAGINA.margen, y + 4.5);
        doc.text(`Página ${p} de ${total}`, DERECHA, y + 4.5, { align: 'right' });
    }
}

// ---------------- Documentos ----------------

function construirRecibo(venta, cliente, cfg) {
    const doc = nuevoDoc();
    const total = Store.montoVenta(venta);
    const pagado = Store.pagadoVenta(venta);
    const saldo = Math.max(0, Math.round((total - pagado) * 100) / 100);

    let y = encabezado(doc, cfg, 'RECIBO', [
        ['N°', folioVenta(venta), true],
        ['Fecha:', fmtFecha(venta.fecha)],
        ...(venta.fecha_entrega ? [['Entrega:', fmtFecha(venta.fecha_entrega)]] : []),
    ]);
    y = bloqueCliente(doc, y, cliente || {}, [['Estado del pedido:', venta.estado]]);
    y = tablaItems(doc, y, venta.detalle.map(d => ({ nombre: d.producto_nombre, cantidad: d.cantidad, precio_unitario: d.precio_unitario })));

    const yTabla = y;
    y = totales(doc, y, total, [
        ['Abonado', fmt(pagado), { rgb: VERDE }],
        ['Saldo pendiente', fmt(saldo), { negrita: true, rgb: saldo > 0 ? ROJO : VERDE }],
    ]);

    // A la izquierda de los totales: detalle de abonos o sello de pagado.
    let yIzq = yTabla + 8;
    if (yIzq < y && venta.pagos.length) {
        fuente(doc, 7.5, 'bold', GRIS);
        doc.text('ABONOS RECIBIDOS', PAGINA.margen, yIzq);
        yIzq += 4.5;
        venta.pagos.slice(0, 6).forEach(p => {
            fuente(doc, 8.5, 'normal', TEXTO);
            doc.text(`${fmtFecha(p.fecha)}  ·  ${p.metodo}`, PAGINA.margen, yIzq);
            doc.text(fmt(p.monto), 100, yIzq, { align: 'right' });
            yIzq += 4.2;
        });
        if (venta.pagos.length > 6) { fuente(doc, 8, 'italic', GRIS); doc.text(`y ${venta.pagos.length - 6} abono(s) más`, PAGINA.margen, yIzq); yIzq += 4.2; }
    }
    if (saldo <= 0 && total > 0) {
        const ySello = Math.max(yIzq, yTabla + 8) + 2;
        doc.setDrawColor(...VERDE);
        doc.setLineWidth(0.8);
        doc.roundedRect(PAGINA.margen + 2, ySello, 34, 11, 2, 2, 'S');
        fuente(doc, 13, 'bold', VERDE);
        doc.text('PAGADO', PAGINA.margen + 19, ySello + 7.6, { align: 'center' });
        yIzq = ySello + 13;
    }
    y = Math.max(y, yIzq) + 4;
    y = seccionTexto(doc, y, 'Notas del pedido', venta.notas);
    pieDePagina(doc, cfg.recibo_pie);
    return { doc, nombre: nombreArchivo('Recibo', folioVenta(venta), cliente?.nombre) };
}

function construirCotizacion(cot, cfg) {
    const doc = nuevoDoc();
    const total = Store.montoCotizacion(cot);
    const vence = sumarDias(cot.fecha, cot.validez_dias);
    const cliente = Store.state.clientes.find(c => c.id === cot.cliente_id) || { nombre: cot.cliente_nombre };

    let y = encabezado(doc, cfg, 'COTIZACIÓN', [
        ['N°', folioCotizacion(cot), true],
        ['Fecha:', fmtFecha(cot.fecha)],
        ['Válida hasta:', fmtFecha(vence)],
    ]);
    y = bloqueCliente(doc, y, cliente, [['Validez:', `${cot.validez_dias} días`]]);
    y = tablaItems(doc, y, cot.items.map(i => ({ nombre: i.producto_nombre, cantidad: i.cantidad, precio_unitario: i.precio_unitario })));
    y = totales(doc, y, total) + 4;
    y = seccionTexto(doc, y, 'Notas', cot.notas);
    y = seccionTexto(doc, y, 'Condiciones', cfg.cotizacion_condiciones);
    pieDePagina(doc, cfg.negocio_telefono ? `Para confirmar tu pedido escríbenos al ${cfg.negocio_telefono}` : 'Gracias por tu interés');
    return { doc, nombre: nombreArchivo('Cotizacion', folioCotizacion(cot), cliente?.nombre) };
}

// ---------------- API pública ----------------

export async function generarReciboPDF(venta) {
    const cliente = Store.state.clientes.find(c => c.id === venta.cliente_id);
    const { doc, nombre } = construirRecibo(venta, cliente, Store.state.config);
    doc.save(nombre);
}

export async function generarCotizacionPDF(cot) {
    const { doc, nombre } = construirCotizacion(cot, Store.state.config);
    doc.save(nombre);
}

// Datos de ejemplo para las vistas previas de Configuración.
const EJEMPLO_ITEMS = [
    { producto_nombre: 'Taza mágica 11oz personalizada con foto y nombre', cantidad: 12, precio_unitario: 8.5, costo_unitario: 3.2 },
    { producto_nombre: 'Franela blanca sublimada talla M (frente y espalda)', cantidad: 6, precio_unitario: 14, costo_unitario: 5.1 },
    { producto_nombre: 'Gorra trucker con logo', cantidad: 3, precio_unitario: 10, costo_unitario: 4 },
];

function abrirVistaPrevia(doc, cfgOriginal) {
    window.open(doc.output('bloburl'), '_blank');
    configurarMoneda(cfgOriginal.moneda);
}

export async function vistaPreviaRecibo(cfg) {
    configurarMoneda(cfg.moneda);
    const venta = {
        folio: 1, fecha: hoyISO(), fecha_entrega: sumarDias(hoyISO(), 3), estado: 'Imprimiendo', notas: 'Ejemplo: tazas con la foto que envió por WhatsApp. Franelas: 3 con logo dorado y 3 plateado.',
        detalle: EJEMPLO_ITEMS.map(i => ({ ...i })), pagos: [{ fecha: hoyISO(), metodo: 'Pago móvil', monto: 100 }],
    };
    const { doc } = construirRecibo(venta, { nombre: 'Cliente de ejemplo', telefono: '0414-1234567', email: 'cliente@ejemplo.com' }, cfg);
    abrirVistaPrevia(doc, Store.state.config);
}

export async function vistaPreviaCotizacion(cfg) {
    configurarMoneda(cfg.moneda);
    const cot = { folio: 1, fecha: hoyISO(), validez_dias: Number(cfg.cotizacion_validez_dias) || 15, cliente_nombre: 'Cliente de ejemplo', notas: 'Ejemplo: tiempo de entrega 5 días hábiles desde la aprobación del diseño.', items: EJEMPLO_ITEMS };
    const { doc } = construirCotizacion(cot, cfg);
    abrirVistaPrevia(doc, Store.state.config);
}
