/**
 * pdf.js — Generación de recibos y cotizaciones en PDF (jsPDF, cargado por CDN).
 * Cambia NEGOCIO_NOMBRE / NEGOCIO_CONTACTO por los datos reales del negocio.
 */

const NEGOCIO_NOMBRE = 'SubliApp — Sublimación';
const NEGOCIO_CONTACTO = '';

const fmt = (n) => `$${(n || 0).toFixed(2)}`;

function documentoBase(titulo) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(NEGOCIO_NOMBRE, 14, 20);
    if (NEGOCIO_CONTACTO) {
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(NEGOCIO_CONTACTO, 14, 26);
    }
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(titulo, 196, 20, { align: 'right' });
    doc.setDrawColor(220);
    doc.line(14, 32, 196, 32);
    return doc;
}

function tablaItems(doc, y, items) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('Producto', 14, y);
    doc.text('Cant.', 130, y, { align: 'right' });
    doc.text('P. Unit.', 160, y, { align: 'right' });
    doc.text('Subtotal', 196, y, { align: 'right' });
    y += 4;
    doc.setDrawColor(230);
    doc.line(14, y, 196, y);
    y += 6;

    doc.setFont(undefined, 'normal');
    let total = 0;
    items.forEach(it => {
        const subtotal = it.cantidad * it.precio_unitario;
        total += subtotal;
        doc.text(it.nombre, 14, y);
        doc.text(String(it.cantidad), 130, y, { align: 'right' });
        doc.text(fmt(it.precio_unitario), 160, y, { align: 'right' });
        doc.text(fmt(subtotal), 196, y, { align: 'right' });
        y += 7;
    });

    y += 4;
    doc.setDrawColor(220);
    doc.line(120, y, 196, y);
    y += 8;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Total:', 160, y, { align: 'right' });
    doc.text(fmt(total), 196, y, { align: 'right' });
    return y;
}

export function generarReciboPDF(venta, cliente, productos) {
    const doc = documentoBase('RECIBO');
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    let y = 42;
    doc.text(`Recibo #VEN-${String(venta.folio).padStart(4, '0')}`, 14, y);
    doc.text(`Fecha: ${venta.fecha}`, 196, y, { align: 'right' });
    y += 6;
    doc.text(`Cliente: ${cliente ? cliente.nombre : '—'}`, 14, y);
    if (cliente?.telefono) doc.text(`Tel: ${cliente.telefono}`, 196, y, { align: 'right' });
    y += 6;
    doc.text(`Estado: ${venta.estado}`, 14, y);
    y += 10;

    const items = venta.detalle.map(d => {
        const p = productos.find(p => p.id === d.producto_id);
        return { nombre: p ? p.nombre : 'Producto', cantidad: d.cantidad, precio_unitario: d.precio_unitario };
    });
    tablaItems(doc, y, items);

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text('¡Gracias por tu compra!', 14, 285);

    doc.save(`recibo-VEN-${String(venta.folio).padStart(4, '0')}.pdf`);
}

export function generarCotizacionPDF({ cliente, items }) {
    const doc = documentoBase('COTIZACIÓN');
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    let y = 42;
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, 196, y, { align: 'right' });
    if (cliente) {
        doc.text(`Cliente: ${cliente.nombre}`, 14, y);
        y += 6;
        if (cliente.telefono) { doc.text(`Tel: ${cliente.telefono}`, 14, y); y += 6; }
    }
    y += 6;

    tablaItems(doc, y, items);

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text('Cotización válida por 15 días. Precios sujetos a cambio sin previo aviso.', 14, 285);

    doc.save(`cotizacion-${Date.now()}.pdf`);
}
