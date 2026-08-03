import { Store } from './store.js';
import { openModal, closeModal, confirmDialog } from './modal.js';
import { supabase } from './supabaseClient.js';
import { generarReciboPDF, generarCotizacionPDF } from './pdf.js';

const fmt = (n) => `$${(n || 0).toFixed(2)}`;
const panel = () => document.getElementById('modal-panel');
const handleError = (e) => { console.error(e); alert('Ocurrió un error: ' + (e?.message || e)); };
const folioTxt = (n) => String(n).padStart(4, '0');
const waLink = (telefono, mensaje) => `https://wa.me/${telefono.replace(/\D/g, '')}${mensaje ? `?text=${encodeURIComponent(mensaje)}` : ''}`;

const tabData = {
    inicio: { title: 'Resumen del Mes', subtitle: 'Vista general de tu negocio', actions: [] },
    ventas: {
        title: 'Gestión de Ventas', subtitle: 'Historial de pedidos',
        actions: [
            { text: 'Nueva Cotización', icon: 'fa-file-invoice', fn: 'openCotizacionModal', variant: 'secondary' },
            { text: 'Nueva Venta', icon: 'fa-cart-plus', fn: 'openVentaModal' },
        ],
    },
    produccion: { title: 'Tablero de Producción', subtitle: 'Kanban de pedidos', actions: [] },
    productos: { title: 'Catálogo y Precios', subtitle: 'Precios y recetas', actions: [{ text: 'Nuevo Producto', icon: 'fa-tag', fn: 'openProductoModal' }] },
    inventario: { title: 'Inventario', subtitle: 'Control de stock', actions: [{ text: 'Nuevo Insumo', icon: 'fa-plus', fn: 'openInsumoModal' }] },
    compras: { title: 'Compras', subtitle: 'Ingreso de mercancía', actions: [] },
    clientes: { title: 'Directorio CRM', subtitle: 'Gestión de clientes', actions: [{ text: 'Nuevo Cliente', icon: 'fa-user-plus', fn: 'openClienteModal' }] },
    reportes: { title: 'Reportes y Gráficos', subtitle: 'Análisis de negocio', actions: [] },
};

const ESTADO_BADGE = {
    'Por Diseñar': 'bg-blue-100 text-blue-700',
    'Imprimiendo': 'bg-amber-100 text-amber-700',
    'Listo/Entregado': 'bg-emerald-100 text-emerald-700',
};

const ESTADO_STOCK_BADGE = {
    'Óptimo': 'bg-emerald-100 text-emerald-700',
    'Alerta': 'bg-amber-100 text-amber-700',
    'Crítico': 'bg-rose-100 text-rose-700',
};

let inventarioFiltro = 'Todos';
let clientesQuery = '';

// ---------------- Navegación ----------------

function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => { el.classList.add('hidden'); el.classList.remove('block'); });
    document.getElementById('tab-' + tabId).classList.remove('hidden');
    document.getElementById('tab-' + tabId).classList.add('block');

    document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('bg-indigo-50', 'text-indigo-700', 'font-medium');
        el.classList.add('text-slate-500');
    });
    document.getElementById('link-' + tabId).classList.remove('text-slate-500');
    document.getElementById('link-' + tabId).classList.add('bg-indigo-50', 'text-indigo-700', 'font-medium');

    const data = tabData[tabId];
    document.getElementById('header-title').innerText = data.title;
    document.getElementById('header-subtitle').innerText = data.subtitle;
    const actionsEl = document.getElementById('header-actions');
    actionsEl.innerHTML = data.actions.map(a => {
        const cls = a.variant === 'secondary'
            ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 px-5 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium shadow-md shadow-indigo-200 transition-all flex items-center gap-2';
        return `<button onclick="App.${a.fn}()" class="${cls}"><i class="fa-solid ${a.icon}"></i> ${a.text}</button>`;
    }).join('');

    renderAll();
}

function toggleProdView(view) {
    const btnLista = document.getElementById('btn-view-lista');
    const btnRecetas = document.getElementById('btn-view-recetas');
    const viewLista = document.getElementById('view-lista');
    const viewRecetas = document.getElementById('view-recetas');
    if (view === 'lista') {
        btnLista.className = 'px-4 py-2 text-sm font-bold bg-white text-indigo-600 shadow-sm rounded-md transition-all';
        btnRecetas.className = 'px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-md transition-all';
        viewLista.classList.remove('hidden');
        viewRecetas.classList.add('hidden');
    } else {
        btnRecetas.className = 'px-4 py-2 text-sm font-bold bg-white text-indigo-600 shadow-sm rounded-md transition-all';
        btnLista.className = 'px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 rounded-md transition-all';
        viewRecetas.classList.remove('hidden');
        viewRecetas.classList.add('grid');
        viewLista.classList.add('hidden');
    }
}

// ---------------- Render maestro ----------------

function renderAll() {
    renderInicio();
    renderVentas();
    renderProduccion();
    renderProductos();
    renderInventario();
    renderCompras();
    renderClientes();
    renderReportes();
}

// ---------------- Inicio ----------------

function renderInicio() {
    const k = Store.kpisDelMes();
    document.getElementById('kpi-ingresos').textContent = fmt(k.ingresos);
    document.getElementById('kpi-gastos').textContent = fmt(k.gastos);
    document.getElementById('kpi-ordenes').textContent = k.ordenesActivas;
    document.getElementById('kpi-alertas').textContent = k.alertasStock;

    const recientes = [...Store.state.ventas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 3);
    document.getElementById('tbl-ventas-recientes').innerHTML = recientes.map(v => {
        const cliente = Store.state.clientes.find(c => c.id === v.cliente_id);
        const detalleTxt = detalleTexto(v);
        return `<tr class="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
            <td class="py-4 font-medium text-slate-700">${cliente ? cliente.nombre : '—'}</td>
            <td class="py-4 text-slate-500">${detalleTxt}</td>
            <td class="py-4"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${ESTADO_BADGE[v.estado]}">${v.estado}</span></td>
            <td class="py-4 text-right font-bold text-slate-700">${fmt(Store.montoVenta(v))}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="py-6 text-center text-slate-400">Sin ventas aún</td></tr>`;

    const criticos = Store.state.insumos.filter(i => Store.estadoStock(i) !== 'Óptimo');
    document.getElementById('list-atencion').innerHTML = criticos.map(i => {
        const est = Store.estadoStock(i);
        const color = est === 'Crítico' ? 'rose' : 'amber';
        return `<li class="flex items-center gap-4 p-3 rounded-xl border border-${color}-100 bg-${color}-50/30">
            <div class="w-10 h-10 rounded-full bg-${color}-100 flex items-center justify-center text-${color}-500 shrink-0"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div class="flex-1 min-w-0">
                <p class="font-bold text-slate-700 text-sm truncate">${i.nombre}</p>
                <p class="text-xs text-${color}-500 font-medium">Stock: ${i.stock_actual.toFixed(1)} ${i.unidad_medida} (${est})</p>
            </div>
        </li>`;
    }).join('') || `<li class="text-sm text-slate-400 text-center py-4">Todo en orden ✅</li>`;
}

function detalleTexto(venta) {
    return venta.detalle.map(d => {
        const p = Store.state.productos.find(p => p.id === d.producto_id);
        return `${d.cantidad}x ${p ? p.nombre : '—'}`;
    }).join(', ');
}

// ---------------- Ventas ----------------

function renderVentas() {
    const rows = [...Store.state.ventas].sort((a, b) => b.folio - a.folio).map(v => {
        const cliente = Store.state.clientes.find(c => c.id === v.cliente_id);
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-mono font-medium text-indigo-600">#VEN-${folioTxt(v.folio)}</td>
            <td class="px-6 py-4 text-slate-500">${v.fecha}</td>
            <td class="px-6 py-4 font-medium text-slate-700">${cliente ? cliente.nombre : '—'}</td>
            <td class="px-6 py-4 text-slate-600">${detalleTexto(v)}</td>
            <td class="px-6 py-4">
                <select onchange="App.cambiarEstadoVenta('${v.id}', this.value)" class="text-xs font-medium rounded-full px-2.5 py-1 border-0 ${ESTADO_BADGE[v.estado]}">
                    ${Store.ESTADOS_PRODUCCION.map(e => `<option value="${e}" ${e === v.estado ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
            </td>
            <td class="px-6 py-4 text-right font-bold text-slate-700">${fmt(Store.montoVenta(v))}</td>
            <td class="px-6 py-4 text-right whitespace-nowrap">
                <button onclick="App.descargarRecibo('${v.id}')" title="Descargar recibo PDF" class="text-slate-400 hover:text-indigo-600 mr-3"><i class="fa-solid fa-file-pdf"></i></button>
                ${cliente?.telefono ? `<button onclick="App.enviarEstadoWhatsApp('${v.id}')" title="Enviar estado por WhatsApp" class="text-slate-400 hover:text-emerald-600 mr-3"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
                <button onclick="App.eliminarVenta('${v.id}', ${v.folio})" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('');
    document.getElementById('tbl-ventas').innerHTML = rows || `<tr><td colspan="7" class="py-8 text-center text-slate-400">Sin ventas registradas</td></tr>`;
}

function descargarRecibo(ventaId) {
    const venta = Store.state.ventas.find(v => v.id === ventaId);
    if (!venta) return;
    const cliente = Store.state.clientes.find(c => c.id === venta.cliente_id);
    generarReciboPDF(venta, cliente, Store.state.productos);
}

function enviarEstadoWhatsApp(ventaId) {
    const venta = Store.state.ventas.find(v => v.id === ventaId);
    const cliente = Store.state.clientes.find(c => c.id === venta?.cliente_id);
    if (!venta || !cliente?.telefono) return;
    const mensaje = `Hola ${cliente.nombre}, tu pedido #VEN-${folioTxt(venta.folio)} (${detalleTexto(venta)}) está en estado: *${venta.estado}*. Total: ${fmt(Store.montoVenta(venta))}. ¡Gracias por tu compra!`;
    window.open(waLink(cliente.telefono, mensaje), '_blank');
}

async function cambiarEstadoVenta(id, estado) {
    try { await Store.updateEstadoVenta(id, estado); renderAll(); } catch (e) { handleError(e); }
}

function eliminarVenta(id, folio) {
    confirmDialog(`¿Eliminar la venta #VEN-${folioTxt(folio)}? Esta acción no se puede deshacer.`, async () => {
        try { await Store.deleteVenta(id); renderAll(); } catch (e) { handleError(e); }
    });
}

// ---------------- Producción (Kanban) ----------------

function renderProduccion() {
    const board = document.getElementById('kanban-board');
    board.innerHTML = Store.ESTADOS_PRODUCCION.map((estado, idx) => {
        const ventas = Store.state.ventas.filter(v => v.estado === estado);
        return `<div class="kanban-col min-w-[300px] flex flex-col bg-slate-100/50 rounded-xl p-4 border border-slate-200/50" data-estado="${estado}">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-slate-700">${idx + 1}. ${estado} <span class="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs ml-2">${ventas.length}</span></h3>
            </div>
            <div class="space-y-3 flex-1 overflow-y-auto min-h-[80px]">
                ${ventas.map(v => {
                    const cliente = Store.state.clientes.find(c => c.id === v.cliente_id);
                    return `<div class="kanban-card bg-white p-4 rounded-lg shadow-sm border border-slate-100 hover:border-indigo-300 transition-colors" draggable="true" data-venta-id="${v.id}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-mono text-indigo-600 font-bold">#VEN-${folioTxt(v.folio)}</span>
                        </div>
                        <p class="font-bold text-slate-800 text-sm mb-1">${detalleTexto(v)}</p>
                        <div class="flex justify-between items-center text-xs mb-2">
                            <span class="text-slate-400"><i class="fa-regular fa-user mr-1"></i> ${cliente ? cliente.nombre : '—'}</span>
                            <span class="font-bold text-slate-600">${fmt(Store.montoVenta(v))}</span>
                        </div>
                        <button onclick="App.openAdjuntosModal('${v.id}')" class="text-xs text-slate-400 hover:text-indigo-600 flex items-center gap-1">
                            <i class="fa-solid fa-paperclip"></i> ${v.adjuntos.length ? `${v.adjuntos.length} adjunto${v.adjuntos.length > 1 ? 's' : ''}` : 'Adjuntar diseño'}
                        </button>
                    </div>`;
                }).join('') || `<p class="text-xs text-slate-400 text-center py-6">Vacío</p>`}
            </div>
        </div>`;
    }).join('');

    board.querySelectorAll('.kanban-card').forEach(card => {
        card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', card.dataset.ventaId));
    });
    board.querySelectorAll('.kanban-col').forEach(col => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const ventaId = e.dataTransfer.getData('text/plain');
            try { await Store.updateEstadoVenta(ventaId, col.dataset.estado); renderAll(); } catch (err) { handleError(err); }
        });
    });
}

function openAdjuntosModal(ventaId) {
    const venta = Store.state.ventas.find(v => v.id === ventaId);
    if (!venta) return;

    const body = `
        <div>
            <h4 class="text-xs font-bold text-slate-500 uppercase mb-2">Adjuntos de #VEN-${folioTxt(venta.folio)}</h4>
            <ul id="lista-adjuntos" class="space-y-2 mb-4"></ul>
        </div>
        <div class="pt-4 border-t border-slate-100 space-y-3">
            <div>
                <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Subir imagen</label>
                <input id="input-adjunto-imagen" type="file" accept="image/*" class="w-full text-sm">
            </div>
            <div class="flex gap-2 items-end">
                <div class="flex-1">
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1">O pegar enlace (Drive, etc.)</label>
                    <input id="input-adjunto-url" type="url" placeholder="https://drive.google.com/..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                </div>
                <button type="button" id="btn-add-enlace" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">Añadir</button>
            </div>
        </div>
    `;

    openModal('Adjuntos de Diseño', body, () => closeModal());
    // El botón "Guardar" por defecto del modal no aplica aquí; se oculta y se maneja todo con botones propios.
    panel().querySelector('button[type="submit"]').classList.add('hidden');

    function renderLista() {
        const ul = panel().querySelector('#lista-adjuntos');
        if (!ul) return;
        ul.innerHTML = venta.adjuntos.map(a => `
            <li class="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100">
                <a href="${a.url}" target="_blank" rel="noopener" class="flex items-center gap-2 text-sm text-indigo-600 hover:underline truncate">
                    <i class="fa-solid ${a.tipo === 'imagen' ? 'fa-image' : 'fa-link'}"></i>
                    <span class="truncate">${a.nombre || a.url}</span>
                </a>
                <button type="button" data-del-adjunto="${a.id}" class="text-slate-300 hover:text-rose-500 shrink-0"><i class="fa-solid fa-xmark"></i></button>
            </li>`).join('') || '<li class="text-xs text-slate-400">Sin adjuntos aún</li>';
        ul.querySelectorAll('[data-del-adjunto]').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await Store.deleteAdjunto(btn.dataset.delAdjunto);
                    venta.adjuntos = Store.state.ventas.find(v => v.id === ventaId)?.adjuntos || [];
                    renderLista();
                    renderAll();
                } catch (e) { handleError(e); }
            });
        });
    }

    panel().querySelector('#btn-add-enlace').addEventListener('click', async () => {
        const input = panel().querySelector('#input-adjunto-url');
        if (!input.value) return;
        try {
            await Store.addAdjuntoEnlace(ventaId, input.value, input.value.split('/').pop());
            venta.adjuntos = Store.state.ventas.find(v => v.id === ventaId)?.adjuntos || [];
            input.value = '';
            renderLista();
            renderAll();
        } catch (e) { handleError(e); }
    });

    panel().querySelector('#input-adjunto-imagen').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            await Store.addAdjuntoImagen(ventaId, file);
            venta.adjuntos = Store.state.ventas.find(v => v.id === ventaId)?.adjuntos || [];
            e.target.value = '';
            renderLista();
            renderAll();
        } catch (err) { handleError(err); }
    });

    renderLista();
}

// ---------------- Productos ----------------

function renderProductos() {
    document.getElementById('tbl-productos-lista').innerHTML = Store.state.productos.map(p => {
        const costo = Store.costoProduccion(p);
        const ganancia = Store.gananciaNeta(p);
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-800">${p.nombre}</td>
            <td class="px-6 py-4 text-slate-500">${p.categoria}</td>
            <td class="px-6 py-4 text-right text-rose-600 font-medium">${fmt(costo)}</td>
            <td class="px-6 py-4 text-right font-black text-indigo-600 text-lg">${fmt(p.precio_venta)}</td>
            <td class="px-6 py-4 text-right text-emerald-600 font-bold">+${fmt(ganancia)}</td>
            <td class="px-6 py-4 text-right whitespace-nowrap">
                <button onclick="App.openProductoModal('${p.id}')" class="text-slate-400 hover:text-indigo-600 mr-3"><i class="fa-solid fa-pen"></i></button>
                <button onclick="App.eliminarProducto('${p.id}')" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="6" class="py-8 text-center text-slate-400">Sin productos aún</td></tr>`;

    document.getElementById('view-recetas').innerHTML = Store.state.productos.map(p => {
        const costo = Store.costoProduccion(p);
        const margen = Store.margenPct(p);
        const ganancia = Store.gananciaNeta(p);
        return `<div class="bg-white rounded-2xl shadow-sm border border-slate-100/50 overflow-hidden flex flex-col">
            <div class="p-6 border-b border-slate-100 flex justify-between items-start bg-indigo-50/30">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 bg-white rounded-xl shadow-sm border flex items-center justify-center text-2xl text-slate-400"><i class="fa-solid fa-box"></i></div>
                    <div><h3 class="text-lg font-bold text-slate-800">${p.nombre}</h3><p class="text-xs text-slate-500">${p.categoria}</p></div>
                </div>
                <button onclick="App.openProductoModal('${p.id}')" class="text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="p-6 flex-1">
                <h4 class="text-sm font-bold text-slate-700 mb-3 uppercase">Receta de Insumos</h4>
                <ul class="space-y-2 mb-6 text-sm text-slate-600">
                    ${p.receta.map(item => {
                        const insumo = Store.state.insumos.find(i => i.id === item.insumo_id);
                        return `<li class="flex justify-between"><span>${insumo ? insumo.nombre : '—'} (${item.cantidad} ${insumo ? insumo.unidad_medida : ''}${item.merma_pct ? `, +${item.merma_pct}% merma` : ''})</span><span>${fmt(Store.costoInsumoEnReceta(item))}</span></li>`;
                    }).join('') || '<li class="text-slate-400">Sin insumos definidos</li>'}
                </ul>
                <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div class="flex justify-between items-center mb-2"><span class="text-sm text-slate-500 font-medium">Costo Total Producción:</span><span class="font-bold text-rose-600">${fmt(costo)}</span></div>
                    <div class="flex justify-between items-center mb-3"><span class="text-sm text-slate-500 font-medium">Precio Venta Sugerido:</span><span class="text-xl font-black text-indigo-600">${fmt(p.precio_venta)}</span></div>
                    <div class="flex justify-between items-center text-xs pt-3 border-t border-slate-200">
                        <span class="text-emerald-700 font-bold bg-emerald-100 border border-emerald-200 px-2 py-1 rounded">Margen: ${margen.toFixed(0)}%</span>
                        <span class="text-slate-700 font-bold bg-white border border-slate-200 px-2 py-1 rounded shadow-sm">Ganancia Neta: <span class="text-emerald-600">+${fmt(ganancia)}</span></span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('') || `<p class="text-slate-400 col-span-2 text-center py-8">Sin productos aún</p>`;
}

function eliminarProducto(id) {
    confirmDialog('¿Eliminar este producto del catálogo?', async () => {
        try { await Store.deleteProducto(id); renderAll(); } catch (e) { handleError(e); }
    });
}

// ----- Modal Producto (con constructor de receta) -----

function openProductoModal(id) {
    const editing = id ? Store.state.productos.find(p => p.id === id) : null;
    let receta = editing ? editing.receta.map(r => ({ ...r })) : [];

    const body = `
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre del Producto</label>
            <input name="nombre" required value="${editing ? editing.nombre : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label>
            <input name="categoria" required value="${editing ? editing.categoria : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Precio de Venta</label>
            <input name="precio_venta" type="number" step="0.01" min="0" required value="${editing ? editing.precio_venta : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        <div class="pt-2 border-t border-slate-100">
            <div class="flex justify-between items-center mb-2">
                <label class="block text-xs font-bold text-slate-500 uppercase">Receta de Insumos</label>
                <button type="button" id="btn-add-receta" class="text-xs text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir insumo</button>
            </div>
            <div id="receta-rows" class="space-y-2"></div>
            <p class="text-xs text-slate-500 mt-3">Costo estimado: <span id="costo-preview" class="font-bold text-rose-600">$0.00</span></p>
        </div>
    `;

    openModal(editing ? 'Editar Producto' : 'Nuevo Producto', body, async (formData) => {
        const rows = [...panel().querySelectorAll('.receta-row')];
        const nuevaReceta = rows.map(row => ({
            insumo_id: row.querySelector('[name=insumo_id]').value,
            cantidad: Number(row.querySelector('[name=cantidad]').value),
            merma_pct: Number(row.querySelector('[name=merma_pct]').value) || 0,
        })).filter(r => r.insumo_id && r.cantidad > 0);

        const data = {
            nombre: formData.get('nombre'),
            categoria: formData.get('categoria'),
            precio_venta: Number(formData.get('precio_venta')),
            receta: nuevaReceta,
        };
        try {
            if (editing) await Store.updateProducto(editing.id, data); else await Store.addProducto(data);
            closeModal();
            renderAll();
        } catch (e) { handleError(e); }
    });

    function renderRecetaRows() {
        document.getElementById('receta-rows').innerHTML = receta.map((r, idx) => `
            <div class="receta-row flex gap-2 items-center">
                <select name="insumo_id" data-idx="${idx}" class="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                    ${Store.state.insumos.map(i => `<option value="${i.id}" ${i.id === r.insumo_id ? 'selected' : ''}>${i.nombre}</option>`).join('')}
                </select>
                <input name="cantidad" data-idx="${idx}" type="number" step="0.01" min="0" value="${r.cantidad}" placeholder="Cant." class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <input name="merma_pct" data-idx="${idx}" type="number" step="1" min="0" value="${r.merma_pct || 0}" placeholder="% Merma" class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <button type="button" data-remove="${idx}" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('') || '<p class="text-xs text-slate-400">Sin insumos añadidos</p>';

        panel().querySelectorAll('.receta-row select, .receta-row input').forEach(el => {
            el.addEventListener('input', () => {
                const idx = Number(el.dataset.idx);
                const field = el.name;
                receta[idx][field] = field === 'insumo_id' ? el.value : Number(el.value) || 0;
                updateCostoPreview();
            });
        });
        panel().querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => { receta.splice(Number(btn.dataset.remove), 1); renderRecetaRows(); updateCostoPreview(); });
        });
        updateCostoPreview();
    }

    function updateCostoPreview() {
        const costo = receta.reduce((sum, r) => sum + Store.costoInsumoEnReceta(r), 0);
        const el = document.getElementById('costo-preview');
        if (el) el.textContent = fmt(costo);
    }

    document.getElementById('btn-add-receta').addEventListener('click', () => {
        const first = Store.state.insumos[0];
        if (!first) return;
        receta.push({ insumo_id: first.id, cantidad: 1, merma_pct: 0 });
        renderRecetaRows();
    });

    renderRecetaRows();
}

// ---------------- Inventario ----------------

function renderInventario() {
    document.querySelectorAll('.filtro-cat').forEach(btn => {
        const active = btn.dataset.cat === inventarioFiltro;
        btn.className = active
            ? 'filtro-cat bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm'
            : 'filtro-cat bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-sm font-medium';
    });

    const insumos = Store.state.insumos.filter(i => inventarioFiltro === 'Todos' || i.categoria === inventarioFiltro);
    document.getElementById('tbl-inventario').innerHTML = insumos.map(i => {
        const est = Store.estadoStock(i);
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-medium text-slate-800">${i.nombre}</td>
            <td class="px-6 py-4 text-slate-500">${i.categoria}</td>
            <td class="px-6 py-4 font-bold text-slate-700">${i.stock_actual.toFixed(1)} ${i.unidad_medida}</td>
            <td class="px-6 py-4 text-slate-500">${i.stock_minimo} ${i.unidad_medida}</td>
            <td class="px-6 py-4 text-center"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${ESTADO_STOCK_BADGE[est]}">${est}</span></td>
            <td class="px-6 py-4 text-right text-slate-600">${fmt(i.costo_unitario)} / ${i.unidad_medida}</td>
            <td class="px-6 py-4 text-right whitespace-nowrap">
                <button onclick="App.openInsumoModal('${i.id}')" class="text-slate-400 hover:text-indigo-600 mr-3"><i class="fa-solid fa-pen"></i></button>
                <button onclick="App.eliminarInsumo('${i.id}')" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="7" class="py-8 text-center text-slate-400">Sin insumos en esta categoría</td></tr>`;
}

function eliminarInsumo(id) {
    confirmDialog('¿Eliminar este insumo? Los productos que lo usan en su receta quedarán con esa línea huérfana.', async () => {
        try { await Store.deleteInsumo(id); renderAll(); } catch (e) { handleError(e); }
    });
}

function filtrarInventario(cat) {
    inventarioFiltro = cat;
    renderInventario();
}

function openInsumoModal(id) {
    const editing = id ? Store.state.insumos.find(i => i.id === id) : null;
    const body = `
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre</label>
            <input name="nombre" required value="${editing ? editing.nombre : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label>
            <select name="categoria" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <option value="Consumible" ${editing?.categoria === 'Consumible' ? 'selected' : ''}>Consumible</option>
                <option value="Sustrato" ${editing?.categoria === 'Sustrato' ? 'selected' : ''}>Sustrato</option>
            </select></div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Unidad de Medida</label>
                <input name="unidad_medida" required value="${editing ? editing.unidad_medida : 'ud'}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="ud, ml, hoja"></div>
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Costo Unitario</label>
                <input name="costo_unitario" type="number" step="0.001" min="0" required value="${editing ? editing.costo_unitario : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Stock Actual</label>
                <input name="stock_actual" type="number" step="0.01" min="0" required value="${editing ? editing.stock_actual : 0}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Stock Mínimo</label>
                <input name="stock_minimo" type="number" step="0.01" min="0" required value="${editing ? editing.stock_minimo : 0}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        </div>
    `;
    openModal(editing ? 'Editar Insumo' : 'Nuevo Insumo', body, async (formData) => {
        const data = {
            nombre: formData.get('nombre'),
            categoria: formData.get('categoria'),
            unidad_medida: formData.get('unidad_medida'),
            costo_unitario: Number(formData.get('costo_unitario')),
            stock_actual: Number(formData.get('stock_actual')),
            stock_minimo: Number(formData.get('stock_minimo')),
        };
        try {
            if (editing) await Store.updateInsumo(editing.id, data); else await Store.addInsumo(data);
            closeModal();
            renderAll();
        } catch (e) { handleError(e); }
    });
}

// ---------------- Compras ----------------

let itemsCompra = [];

function renderCompras() {
    document.getElementById('tbl-compras').innerHTML = [...Store.state.compras].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => {
        const detalle = c.items.map(it => {
            const insumo = Store.state.insumos.find(i => i.id === it.insumo_id);
            return `${it.cantidad}x ${insumo ? insumo.nombre : '—'}`;
        }).join(', ');
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 text-slate-500">${c.fecha}</td>
            <td class="px-6 py-4 font-medium text-slate-700">${c.proveedor}</td>
            <td class="px-6 py-4 text-slate-600">${detalle}</td>
            <td class="px-6 py-4 text-right font-bold text-slate-700">${fmt(Store.montoCompra(c))}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="py-8 text-center text-slate-400">Sin compras registradas</td></tr>`;
    renderItemsCompra();
}

function renderItemsCompra() {
    const ul = document.getElementById('items-compra');
    ul.innerHTML = itemsCompra.map((it, idx) => {
        const insumo = Store.state.insumos.find(i => i.id === it.insumo_id);
        return `<li class="flex justify-between items-center"><span>${it.cantidad}x ${insumo ? insumo.nombre : '—'} @ ${fmt(it.costo_unitario)}</span>
            <button type="button" data-remove-item="${idx}" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button></li>`;
    }).join('') || '<li class="text-slate-400 text-center">Ningún insumo añadido</li>';
    ul.querySelectorAll('[data-remove-item]').forEach(btn => {
        btn.addEventListener('click', () => { itemsCompra.splice(Number(btn.dataset.removeItem), 1); renderItemsCompra(); updateTotalCompra(); });
    });
    updateTotalCompra();
}

function updateTotalCompra() {
    const total = itemsCompra.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);
    document.getElementById('total-compra').textContent = fmt(total);
}

function addItemCompra() {
    const first = Store.state.insumos[0];
    if (!first) { alert('Primero crea al menos un insumo en Inventario.'); return; }
    const body = `
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Insumo</label>
            <select name="insumo_id" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                ${Store.state.insumos.map(i => `<option value="${i.id}">${i.nombre}</option>`).join('')}
            </select></div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Cantidad</label>
                <input name="cantidad" type="number" step="0.01" min="0.01" required value="1" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Costo Unitario</label>
                <input name="costo_unitario" type="number" step="0.001" min="0" required value="${first.costo_unitario}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        </div>
    `;
    openModal('Añadir Insumo a la Compra', body, (formData) => {
        itemsCompra.push({
            insumo_id: formData.get('insumo_id'),
            cantidad: Number(formData.get('cantidad')),
            costo_unitario: Number(formData.get('costo_unitario')),
        });
        closeModal();
        renderItemsCompra();
    });
}

document.getElementById('form-compra').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (itemsCompra.length === 0) { alert('Añade al menos un insumo a la compra.'); return; }
    const formData = new FormData(e.target);
    try {
        await Store.addCompra({ proveedor: formData.get('proveedor'), fecha: formData.get('fecha'), items: itemsCompra });
        itemsCompra = [];
        e.target.reset();
        renderAll();
    } catch (err) { handleError(err); }
});

// ---------------- Clientes ----------------

function renderClientes() {
    const q = clientesQuery.toLowerCase();
    const clientes = Store.state.clientes.filter(c => c.nombre.toLowerCase().includes(q));
    document.getElementById('tbl-clientes').innerHTML = clientes.map(c => {
        const { total, ordenes } = Store.totalCompradoCliente(c.id);
        const fechaHtml = c.fecha_especial
            ? `<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded text-xs font-medium"><i class="fa-solid fa-cake-candles mr-1"></i> ${c.fecha_especial} (${c.tipo_fecha || 'Especial'})</span>
               ${c.telefono ? `<button onclick="App.enviarFelicitacion('${c.id}')" title="Enviar felicitación por WhatsApp" class="ml-1 text-emerald-500 hover:text-emerald-700"><i class="fa-brands fa-whatsapp"></i></button>` : ''}`
            : `<span class="text-slate-400 text-xs">Sin registrar</span>`;
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-700"><button onclick="App.openClienteDetalle('${c.id}')" class="hover:text-indigo-600 hover:underline text-left">${c.nombre}</button></td>
            <td class="px-6 py-4 text-slate-500">${c.telefono ? `<a href="${waLink(c.telefono)}" target="_blank" rel="noopener" class="hover:underline"><i class="fa-brands fa-whatsapp text-green-500 mr-1"></i> ${c.telefono}</a>` : '—'}</td>
            <td class="px-6 py-4">${fechaHtml}</td>
            <td class="px-6 py-4 text-center font-medium text-slate-700">${fmt(total)} (${ordenes} órdenes)</td>
            <td class="px-6 py-4 text-right whitespace-nowrap">
                <button onclick="App.openClienteModal('${c.id}')" class="text-slate-400 hover:text-indigo-600 mr-3"><i class="fa-solid fa-pen"></i></button>
                <button onclick="App.eliminarCliente('${c.id}')" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="5" class="py-8 text-center text-slate-400">Sin clientes</td></tr>`;
}

function eliminarCliente(id) {
    confirmDialog('¿Eliminar este cliente?', async () => {
        try { await Store.deleteCliente(id); renderAll(); } catch (e) { handleError(e); }
    });
}

function enviarFelicitacion(id) {
    const cliente = Store.state.clientes.find(c => c.id === id);
    if (!cliente?.telefono) return;
    const motivo = (cliente.tipo_fecha || 'Fecha Especial').toLowerCase();
    const mensaje = `¡Feliz ${motivo}, ${cliente.nombre}! 🎉 Te deseamos un excelente día de parte de todo el equipo.`;
    window.open(waLink(cliente.telefono, mensaje), '_blank');
}

function openClienteDetalle(id) {
    const cliente = Store.state.clientes.find(c => c.id === id);
    if (!cliente) return;
    const { total, ordenes } = Store.totalCompradoCliente(id);
    const historial = [...Store.state.ventas].filter(v => v.cliente_id === id).sort((a, b) => b.folio - a.folio);

    const body = `
        <div class="flex items-start justify-between mb-4">
            <div>
                <h4 class="text-lg font-bold text-slate-800">${cliente.nombre}</h4>
                ${cliente.telefono ? `<a href="${waLink(cliente.telefono)}" target="_blank" rel="noopener" class="text-sm text-emerald-600 hover:underline"><i class="fa-brands fa-whatsapp mr-1"></i>${cliente.telefono}</a>` : '<p class="text-sm text-slate-400">Sin teléfono registrado</p>'}
            </div>
            <div class="text-right">
                <p class="text-xs text-slate-500">Total comprado</p>
                <p class="text-lg font-black text-indigo-600">${fmt(total)}</p>
                <p class="text-xs text-slate-400">${ordenes} órdenes</p>
            </div>
        </div>
        ${cliente.fecha_especial ? `<p class="text-xs mb-4"><span class="bg-amber-100 text-amber-700 px-2 py-1 rounded font-medium"><i class="fa-solid fa-cake-candles mr-1"></i>${cliente.fecha_especial} (${cliente.tipo_fecha || 'Especial'})</span></p>` : ''}
        <h5 class="text-xs font-bold text-slate-500 uppercase mb-2 pt-2 border-t border-slate-100">Historial de Compras</h5>
        <ul class="space-y-2 max-h-64 overflow-y-auto">
            ${historial.map(v => `
                <li class="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100 text-sm">
                    <div>
                        <p class="font-mono text-xs text-indigo-600 font-bold">#VEN-${folioTxt(v.folio)}</p>
                        <p class="text-slate-600">${detalleTexto(v)}</p>
                        <p class="text-xs text-slate-400">${v.fecha} · ${v.estado}</p>
                    </div>
                    <span class="font-bold text-slate-700">${fmt(Store.montoVenta(v))}</span>
                </li>`).join('') || '<li class="text-sm text-slate-400 text-center py-4">Sin compras registradas</li>'}
        </ul>
    `;
    openModal('Detalle de Cliente', body, () => closeModal());
    panel().querySelector('button[type="submit"]').classList.add('hidden');
}

function openClienteModal(id) {
    const editing = id ? Store.state.clientes.find(c => c.id === id) : null;
    const body = `
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre / Empresa</label>
            <input name="nombre" required value="${editing ? editing.nombre : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">WhatsApp / Teléfono</label>
            <input name="telefono" value="${editing ? editing.telefono : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="+58 414-1234567"></div>
        <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha Especial</label>
                <input name="fecha_especial" type="date" value="${editing ? editing.fecha_especial : ''}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                <input name="tipo_fecha" value="${editing ? (editing.tipo_fecha || '') : ''}" placeholder="Cumpleaños, Aniversario..." class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        </div>
    `;
    openModal(editing ? 'Editar Cliente' : 'Nuevo Cliente', body, async (formData) => {
        const data = {
            nombre: formData.get('nombre'),
            telefono: formData.get('telefono'),
            fecha_especial: formData.get('fecha_especial') || null,
            tipo_fecha: formData.get('tipo_fecha'),
        };
        try {
            if (editing) await Store.updateCliente(editing.id, data); else await Store.addCliente(data);
            closeModal();
            renderAll();
        } catch (e) { handleError(e); }
    });
}

document.getElementById('buscar-cliente').addEventListener('input', (e) => { clientesQuery = e.target.value; renderClientes(); });

// ---------------- Venta (modal con detalle) ----------------

let detalleVenta = [];

function openVentaModal() {
    if (Store.state.clientes.length === 0) { alert('Primero crea al menos un cliente.'); return; }
    if (Store.state.productos.length === 0) { alert('Primero crea al menos un producto.'); return; }
    detalleVenta = [];
    const body = `
        <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Cliente</label>
                <select name="cliente_id" required class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                    ${Store.state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
                </select></div>
            <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha</label>
                <input name="fecha" type="date" required value="${new Date().toISOString().slice(0, 10)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>
        </div>
        <div class="pt-2 border-t border-slate-100">
            <div class="flex justify-between items-center mb-2">
                <label class="block text-xs font-bold text-slate-500 uppercase">Productos</label>
                <button type="button" id="btn-add-detalle" class="text-xs text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir producto</button>
            </div>
            <div id="detalle-rows" class="space-y-2"></div>
            <p class="text-sm mt-3 text-right">Total: <span id="total-venta-preview" class="font-black text-indigo-600 text-lg">$0.00</span></p>
        </div>
    `;
    openModal('Nueva Venta', body, async (formData) => {
        const rows = [...panel().querySelectorAll('.detalle-row')];
        const detalle = rows.map(row => ({
            producto_id: row.querySelector('[name=producto_id]').value,
            cantidad: Number(row.querySelector('[name=cantidad]').value),
            precio_unitario: Number(row.querySelector('[name=precio_unitario]').value),
        })).filter(d => d.producto_id && d.cantidad > 0);
        if (detalle.length === 0) { alert('Añade al menos un producto a la venta.'); return; }
        try {
            await Store.addVenta({ cliente_id: formData.get('cliente_id'), fecha: formData.get('fecha'), detalle });
            closeModal();
            renderAll();
        } catch (e) { handleError(e); }
    });

    function renderDetalleRows() {
        document.getElementById('detalle-rows').innerHTML = detalleVenta.map((d, idx) => `
            <div class="detalle-row flex gap-2 items-center">
                <select name="producto_id" data-idx="${idx}" class="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                    ${Store.state.productos.map(p => `<option value="${p.id}" ${p.id === d.producto_id ? 'selected' : ''}>${p.nombre}</option>`).join('')}
                </select>
                <input name="cantidad" data-idx="${idx}" type="number" min="1" value="${d.cantidad}" class="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <input name="precio_unitario" data-idx="${idx}" type="number" step="0.01" min="0" value="${d.precio_unitario}" class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <button type="button" data-remove="${idx}" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('') || '<p class="text-xs text-slate-400">Sin productos añadidos</p>';

        panel().querySelectorAll('.detalle-row select, .detalle-row input').forEach(el => {
            el.addEventListener('input', () => {
                const idx = Number(el.dataset.idx);
                if (el.name === 'producto_id') {
                    detalleVenta[idx].producto_id = el.value;
                    const prod = Store.state.productos.find(p => p.id === el.value);
                    if (prod) detalleVenta[idx].precio_unitario = prod.precio_venta;
                    renderDetalleRows();
                } else {
                    detalleVenta[idx][el.name] = Number(el.value) || 0;
                    updateTotalVentaPreview();
                }
            });
        });
        panel().querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => { detalleVenta.splice(Number(btn.dataset.remove), 1); renderDetalleRows(); });
        });
        updateTotalVentaPreview();
    }

    function updateTotalVentaPreview() {
        const total = detalleVenta.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0);
        const el = document.getElementById('total-venta-preview');
        if (el) el.textContent = fmt(total);
    }

    document.getElementById('btn-add-detalle').addEventListener('click', () => {
        const first = Store.state.productos[0];
        detalleVenta.push({ producto_id: first.id, cantidad: 1, precio_unitario: first.precio_venta });
        renderDetalleRows();
    });

    renderDetalleRows();
}

// ---------------- Cotización (PDF, no persiste en la base de datos) ----------------

let itemsCotizacion = [];

function openCotizacionModal() {
    if (Store.state.productos.length === 0) { alert('Primero crea al menos un producto.'); return; }
    itemsCotizacion = [];
    const body = `
        <div><label class="block text-xs font-bold text-slate-500 uppercase mb-1">Cliente (opcional)</label>
            <select name="cliente_id" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <option value="">Sin especificar</option>
                ${Store.state.clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
            </select></div>
        <div class="pt-2 border-t border-slate-100">
            <div class="flex justify-between items-center mb-2">
                <label class="block text-xs font-bold text-slate-500 uppercase">Productos</label>
                <button type="button" id="btn-add-cotizacion-item" class="text-xs text-indigo-600 font-medium hover:underline"><i class="fa-solid fa-plus mr-1"></i>Añadir producto</button>
            </div>
            <div id="cotizacion-rows" class="space-y-2"></div>
            <p class="text-sm mt-3 text-right">Total: <span id="total-cotizacion-preview" class="font-black text-indigo-600 text-lg">$0.00</span></p>
        </div>
    `;
    openModal('Nueva Cotización', body, (formData) => {
        if (itemsCotizacion.length === 0) { alert('Añade al menos un producto.'); return; }
        const clienteId = formData.get('cliente_id');
        const cliente = clienteId ? Store.state.clientes.find(c => c.id === clienteId) : null;
        const items = itemsCotizacion.map(it => {
            const p = Store.state.productos.find(p => p.id === it.producto_id);
            return { nombre: p ? p.nombre : 'Producto', cantidad: it.cantidad, precio_unitario: it.precio_unitario };
        });
        generarCotizacionPDF({ cliente, items });
        closeModal();
    });
    const submitBtn = panel().querySelector('button[type="submit"]');
    submitBtn.innerHTML = '<i class="fa-solid fa-file-pdf mr-1"></i>Generar PDF';

    function renderRows() {
        document.getElementById('cotizacion-rows').innerHTML = itemsCotizacion.map((d, idx) => `
            <div class="cotizacion-row flex gap-2 items-center">
                <select name="producto_id" data-idx="${idx}" class="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                    ${Store.state.productos.map(p => `<option value="${p.id}" ${p.id === d.producto_id ? 'selected' : ''}>${p.nombre}</option>`).join('')}
                </select>
                <input name="cantidad" data-idx="${idx}" type="number" min="1" value="${d.cantidad}" class="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <input name="precio_unitario" data-idx="${idx}" type="number" step="0.01" min="0" value="${d.precio_unitario}" class="w-20 px-2 py-1.5 border border-slate-200 rounded-lg text-xs">
                <button type="button" data-remove="${idx}" class="text-slate-300 hover:text-rose-500"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('') || '<p class="text-xs text-slate-400">Sin productos añadidos</p>';

        panel().querySelectorAll('.cotizacion-row select, .cotizacion-row input').forEach(el => {
            el.addEventListener('input', () => {
                const idx = Number(el.dataset.idx);
                if (el.name === 'producto_id') {
                    itemsCotizacion[idx].producto_id = el.value;
                    const prod = Store.state.productos.find(p => p.id === el.value);
                    if (prod) itemsCotizacion[idx].precio_unitario = prod.precio_venta;
                    renderRows();
                } else {
                    itemsCotizacion[idx][el.name] = Number(el.value) || 0;
                    updateTotal();
                }
            });
        });
        panel().querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => { itemsCotizacion.splice(Number(btn.dataset.remove), 1); renderRows(); });
        });
        updateTotal();
    }

    function updateTotal() {
        const total = itemsCotizacion.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0);
        const el = document.getElementById('total-cotizacion-preview');
        if (el) el.textContent = fmt(total);
    }

    document.getElementById('btn-add-cotizacion-item').addEventListener('click', () => {
        const first = Store.state.productos[0];
        itemsCotizacion.push({ producto_id: first.id, cantidad: 1, precio_unitario: first.precio_venta });
        renderRows();
    });

    renderRows();
}

// ---------------- Reportes ----------------

function renderReportes() {
    const meses = [];
    const ref = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
        meses.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('es-ES', { month: 'short' }) });
    }
    const datos = meses.map(({ y, m, label }) => {
        const ingresos = Store.state.ventas.filter(v => { const d = new Date(v.fecha); return d.getFullYear() === y && d.getMonth() === m; }).reduce((s, v) => s + Store.montoVenta(v), 0);
        const gastos = Store.state.compras.filter(c => { const d = new Date(c.fecha); return d.getFullYear() === y && d.getMonth() === m; }).reduce((s, c) => s + Store.montoCompra(c), 0);
        return { label, ingresos, gastos };
    });
    const max = Math.max(1, ...datos.flatMap(d => [d.ingresos, d.gastos]));
    document.getElementById('chart-ingresos-gastos').innerHTML = `
        <div class="absolute w-full border-t border-slate-100 top-0"></div>
        <div class="absolute w-full border-t border-slate-100 top-1/2"></div>
        ${datos.map(d => `
            <div class="flex-1 flex flex-col justify-end items-center group relative z-10">
                <div class="flex gap-1 items-end w-full justify-center h-full">
                    <div class="bg-indigo-500 w-1/4 rounded-t-sm group-hover:opacity-80 transition-opacity" style="height: ${(d.ingresos / max * 100).toFixed(0)}%" title="Ingresos: ${fmt(d.ingresos)}"></div>
                    <div class="bg-rose-400 w-1/4 rounded-t-sm group-hover:opacity-80 transition-opacity" style="height: ${(d.gastos / max * 100).toFixed(0)}%" title="Gastos: ${fmt(d.gastos)}"></div>
                </div>
                <span class="text-xs text-slate-500 mt-2 font-medium capitalize">${d.label}</span>
            </div>`).join('')}
    `;

    // Ranking de productos más vendidos (mes actual)
    const ahora = new Date();
    const ventasMes = Store.state.ventas.filter(v => { const d = new Date(v.fecha); return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth(); });
    const unidadesPorProducto = {};
    let totalUnidades = 0;
    ventasMes.forEach(v => v.detalle.forEach(d => {
        unidadesPorProducto[d.producto_id] = (unidadesPorProducto[d.producto_id] || 0) + d.cantidad;
        totalUnidades += d.cantidad;
    }));
    const ranking = Object.entries(unidadesPorProducto)
        .map(([pid, uds]) => ({ producto: Store.state.productos.find(p => p.id === pid), uds }))
        .filter(r => r.producto)
        .sort((a, b) => b.uds - a.uds)
        .slice(0, 3);
    const colores = ['indigo', 'emerald', 'amber'];
    document.getElementById('ranking-productos').innerHTML = ranking.map((r, idx) => {
        const pct = totalUnidades ? (r.uds / totalUnidades * 100) : 0;
        return `<div>
            <div class="flex justify-between text-sm mb-1"><span class="font-bold text-slate-700">${r.producto.nombre}</span><span class="text-${colores[idx]}-600 font-bold">${pct.toFixed(0)}% (${r.uds} uds)</span></div>
            <div class="w-full bg-slate-100 rounded-full h-2.5"><div class="bg-${colores[idx]}-500 h-2.5 rounded-full" style="width: ${pct}%"></div></div>
        </div>`;
    }).join('') || `<p class="text-sm text-slate-400 text-center py-4">Sin ventas este mes</p>`;

    // Top clientes
    const topClientes = Store.state.clientes
        .map(c => ({ cliente: c, ...Store.totalCompradoCliente(c.id) }))
        .filter(c => c.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    document.getElementById('ranking-clientes').innerHTML = topClientes.map((c, idx) => `
        <li class="flex justify-between items-center text-sm">
            <div class="flex items-center gap-2"><div class="w-6 h-6 rounded-full ${idx === 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'} flex items-center justify-center font-bold text-xs">${c.cliente.nombre[0]}</div> <span>${c.cliente.nombre}</span></div>
            <span class="font-bold text-slate-800">${fmt(c.total)}</span>
        </li>`).join('') || `<li class="text-sm text-slate-400 text-center py-2">Sin datos aún</li>`;
}

// ---------------- Filtros de inventario (listener global) ----------------

document.getElementById('filtro-inventario').addEventListener('click', (e) => {
    const btn = e.target.closest('.filtro-cat');
    if (btn) filtrarInventario(btn.dataset.cat);
});

// ---------------- Autenticación ----------------

async function logout() {
    await supabase.auth.signOut();
}

function showScreen(id) {
    ['loading-screen', 'auth-screen', 'app-shell'].forEach(s => {
        document.getElementById(s).classList.toggle('hidden', s !== id);
    });
}

async function onAuthenticated(session) {
    document.getElementById('user-email').textContent = session.user.email;
    try {
        await Store.load();
        showScreen('app-shell');
        showTab('inicio');
    } catch (e) {
        showScreen('auth-screen');
        document.getElementById('login-error').textContent = 'No se pudo cargar la información: ' + (e?.message || e);
        document.getElementById('login-error').classList.remove('hidden');
    }
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    const { error } = await supabase.auth.signInWithPassword({
        email: formData.get('email'),
        password: formData.get('password'),
    });
    if (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
    }
});

supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        showScreen('loading-screen');
        onAuthenticated(session);
    } else {
        showScreen('auth-screen');
    }
});

// ---------------- Bootstrap ----------------

window.App = {
    showTab, toggleProdView,
    openInsumoModal, eliminarInsumo,
    openProductoModal, eliminarProducto,
    openClienteModal, eliminarCliente, openClienteDetalle, enviarFelicitacion,
    openVentaModal, cambiarEstadoVenta, eliminarVenta, openAdjuntosModal,
    descargarRecibo, enviarEstadoWhatsApp, openCotizacionModal,
    addItemCompra, logout,
};
