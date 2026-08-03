/**
 * modal.js — Modal genérico reutilizable para formularios de alta/edición.
 */

const overlay = document.getElementById('modal-overlay');
const panel = document.getElementById('modal-panel');

export function closeModal() {
    overlay.classList.add('hidden');
    panel.innerHTML = '';
}

export function openModal(title, bodyHtml, onSubmit) {
    panel.innerHTML = `
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h3 class="text-lg font-bold text-slate-800">${title}</h3>
            <button type="button" data-close class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <form id="modal-form" class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">${bodyHtml}</form>
        <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
            <button type="button" data-close class="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancelar</button>
            <button type="submit" form="modal-form" class="px-5 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white shadow-md shadow-indigo-200 hover:bg-indigo-700">Guardar</button>
        </div>
    `;
    overlay.classList.remove('hidden');
    panel.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
    const form = panel.querySelector('#modal-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(form);
        onSubmit(data, form);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }, { once: true });
}

export function confirmDialog(message, onConfirm) {
    openModal('Confirmar', `<p class="text-sm text-slate-600">${message}</p>`, async () => { await onConfirm(); closeModal(); });
    const btn = panel.querySelector('button[type="submit"]');
    btn.textContent = 'Confirmar';
    btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'shadow-indigo-200');
    btn.classList.add('bg-rose-600', 'hover:bg-rose-700', 'shadow-rose-200');
}
