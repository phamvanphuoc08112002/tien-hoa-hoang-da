export type NameTagKind = 'self' | 'ally' | 'enemy';

export interface NameTagInfo {
  name: string;
  /** Evolution form index (0-based). */
  form: number;
  hp: number;
  maxHp: number;
  kind?: NameTagKind;
}

/** Crisp HTML labels that float above creatures (Phaser Text is unreadable with pixelArt). */
export class NameTags {
  private root: HTMLElement;
  private tags = new Map<string, HTMLElement>();
  private last = new Map<string, string>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'name-tags';
    parent.append(this.root);
  }

  set(id: string, info: NameTagInfo, x: number, y: number): void {
    let el = this.tags.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'name-tag';
      el.innerHTML =
        `<div class="nt-row"><span class="nt-name"></span><span class="nt-form"></span></div>` +
        `<div class="nt-hp"><div class="nt-hp-fill"></div></div>`;
      this.root.append(el);
      this.tags.set(id, el);
    }

    const kind = info.kind ?? 'self';
    const formLabel = `Dạng ${info.form + 1}`;
    const hpPct = info.maxHp > 0 ? Math.max(0, Math.min(100, (info.hp / info.maxHp) * 100)) : 0;
    const hpTone = hpPct > 55 ? 'ok' : hpPct > 25 ? 'mid' : 'low';
    const sig = `${info.name}|${formLabel}|${hpPct.toFixed(1)}|${hpTone}|${kind}`;

    if (this.last.get(id) !== sig) {
      this.last.set(id, sig);
      const nameEl = el.querySelector('.nt-name') as HTMLElement;
      const formEl = el.querySelector('.nt-form') as HTMLElement;
      const fill = el.querySelector('.nt-hp-fill') as HTMLElement;
      if (nameEl.textContent !== info.name) nameEl.textContent = info.name;
      if (formEl.textContent !== formLabel) formEl.textContent = formLabel;
      fill.style.width = `${hpPct}%`;
      fill.dataset.tone = hpTone;
      el.classList.toggle('ally', kind === 'ally');
      el.classList.toggle('enemy', kind === 'enemy');
      el.classList.toggle('self', kind === 'self');
    }

    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    el.style.display = 'block';
  }

  hide(id: string): void {
    const el = this.tags.get(id);
    if (el) el.style.display = 'none';
  }

  /** Removes any tags whose ids are not in `keep`. */
  prune(keep: Set<string>): void {
    for (const [id, el] of this.tags) {
      if (keep.has(id)) continue;
      el.remove();
      this.tags.delete(id);
      this.last.delete(id);
    }
  }

  clear(): void {
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
    this.last.clear();
  }
}
