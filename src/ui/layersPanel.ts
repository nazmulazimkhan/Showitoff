export interface LayerRowData {
  id: string;
  name: string;
  spec: string;
  color: string;
  visible: boolean;
}

export interface LayersPanelEvents {
  select(id: string): void;
  toggle(id: string): void;
  reorder(ids: string[]): void;
}

const EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M9.9 6A9.9 9.9 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3 3.7M6.3 7.6A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4.2-.9M9.9 10a2.8 2.8 0 0 0 4 4"/></svg>`;
const GRIP = `<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Layer list with select, visibility toggle and drag-to-reorder (HTML5 DnD + keyboard Alt+↑/↓). */
export class LayersPanel {
  private rows: LayerRowData[] = [];
  private selected: string | null = null;
  private dragId: string | null = null;

  constructor(private readonly list: HTMLUListElement, events: LayersPanelEvents) {
    list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('.layer-row');
      if (!row) return;
      const id = row.dataset.id!;
      if ((e.target as HTMLElement).closest('.icon-btn')) events.toggle(id);
      else events.select(id);
    });
    list.addEventListener('keydown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('.layer-row');
      if (!row || e.target !== row) return;
      const id = row.dataset.id!;
      const i = this.rows.findIndex((r) => r.id === id);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        events.select(id);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (j < 0 || j >= this.rows.length) return;
        const ids = this.rows.map((r) => r.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        events.reorder(ids);
        (this.list.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = row[e.key === 'ArrowUp' ? 'previousElementSibling' : 'nextElementSibling'] as HTMLElement | null;
        next?.focus();
      }
    });

    list.addEventListener('dragstart', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('.layer-row');
      if (!row) return;
      this.dragId = row.dataset.id!;
      row.classList.add('is-dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/x-layer', this.dragId);
    });
    list.addEventListener('dragend', () => {
      this.dragId = null;
      this.clearDropMarks();
      list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
    });
    list.addEventListener('dragover', (e) => {
      if (!this.dragId) return;
      e.preventDefault();
      e.stopPropagation();
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('.layer-row');
      this.clearDropMarks();
      if (!row || row.dataset.id === this.dragId) return;
      const r = row.getBoundingClientRect();
      row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', (e) => {
      if (!this.dragId) return;
      e.preventDefault();
      e.stopPropagation();
      const row = (e.target as HTMLElement).closest<HTMLLIElement>('.layer-row');
      const from = this.dragId;
      this.clearDropMarks();
      if (!row || row.dataset.id === from) return;
      const r = row.getBoundingClientRect();
      const after = e.clientY >= r.top + r.height / 2;
      const ids = this.rows.map((x) => x.id).filter((id) => id !== from);
      const at = ids.indexOf(row.dataset.id!) + (after ? 1 : 0);
      ids.splice(at, 0, from);
      events.reorder(ids);
    });
  }

  private clearDropMarks() {
    this.list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  render(rows: LayerRowData[], selected: string | null) {
    this.rows = rows;
    this.selected = selected;
    this.list.innerHTML = rows
      .map(
        (r) => `
      <li class="layer-row${r.id === selected ? ' is-selected' : ''}${r.visible ? '' : ' is-hidden'}" data-id="${esc(r.id)}"
          draggable="true" tabindex="0" aria-selected="${r.id === selected}" title="Alt+↑/↓ to reorder">
        <span class="handle" aria-hidden="true">${GRIP}</span>
        <i class="swatch" style="background:${esc(r.color)}"></i>
        <span class="layer-text"><b>${esc(r.name)}</b><small>${esc(r.spec)}</small></span>
        <button type="button" class="icon-btn${r.visible ? '' : ' is-off'}" aria-label="${r.visible ? 'Hide' : 'Show'} ${esc(r.name)}" aria-pressed="${!r.visible}">${r.visible ? EYE : EYE_OFF}</button>
      </li>`,
      )
      .join('');
  }

  get selectedId() {
    return this.selected;
  }
}
