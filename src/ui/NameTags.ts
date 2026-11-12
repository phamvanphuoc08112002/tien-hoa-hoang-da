/** Crisp HTML labels that float above creatures (Phaser Text is unreadable with pixelArt). */
export class NameTags {
  private root: HTMLElement;
  private tags = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'name-tags';
    parent.append(this.root);
  }

  set(id: string, text: string, x: number, y: number, kind: 'self' | 'ally' | 'enemy' = 'self'): void {
    let el = this.tags.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'name-tag';
      this.root.append(el);
      this.tags.set(id, el);
    }
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('ally', kind === 'ally');
    el.classList.toggle('enemy', kind === 'enemy');
    el.classList.toggle('self', kind === 'self');
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
    }
  }

  clear(): void {
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
  }
}
