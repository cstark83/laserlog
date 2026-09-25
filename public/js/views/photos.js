/* Photo strip — used by entries, projects, materials and tests. */
import * as api from '../api.js';
import { el, esc, icons, toast, openSheet, confirmSheet } from '../ui.js';

export function photoStrip(host, entityType, entityId, initial = []) {
  if (!host) return;
  let photos = [...initial];

  const draw = () => {
    host.innerHTML = `
      <div class="field__label" style="margin-bottom:8px">Photos</div>
      <div class="photos">
        ${photos.map((p) => `
          <div class="photo" data-id="${esc(p.id)}">
            <img src="/uploads/${esc(p.filename)}" alt="${esc(p.caption || '')}" loading="lazy">
            <button class="photo__del" data-del="${esc(p.id)}" aria-label="Remove">${icons.close}</button>
          </div>`).join('')}
        <button type="button" class="photo-add" data-add>
          ${icons.camera}<span>Add</span>
        </button>
      </div>`;
  };

  draw();

  host.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.preventDefault();
      if (!(await confirmSheet('Remove photo?', 'This deletes the file from the server.', 'Remove'))) return;
      await api.del(`/api/photos/${del.dataset.del}`);
      photos = photos.filter((p) => p.id !== del.dataset.del);
      draw();
      return;
    }

    if (e.target.closest('[data-add]')) {
      e.preventDefault();
      const input = el('<input type="file" accept="image/*" multiple hidden>');
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const files = [...input.files];
        input.remove();
        if (!files.length) return;
        if (!api.state.online) { toast('Photos need a connection', 'bad'); return; }
        toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
        for (const f of files) {
          try {
            const p = await api.uploadPhoto(entityType, entityId, f);
            photos.push(p);
          } catch (err) {
            toast('Upload failed: ' + err.message, 'bad');
          }
        }
        draw();
      });
      input.click();
      return;
    }

    const img = e.target.closest('.photo img');
    if (img) {
      openSheet({
        title: 'Photo',
        wide: true,
        body: `<img src="${img.src}" style="width:100%;border-radius:12px;display:block">`,
      });
    }
  });
}
