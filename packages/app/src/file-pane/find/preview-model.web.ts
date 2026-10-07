/**
 * Find for rendered file previews. Source views get Find from FileFindModel,
 * which drives CodeMirror's search state field; a rendered preview is plain
 * text DOM with no such state, so this model wraps matches in <mark> elements
 * and re-marks when the preview's DOM changes under it (live file updates,
 * mode switches that keep the same host).
 */

const HIT = "paseo-file-find-hit";
const CURRENT_HIT = "paseo-file-find-hit-current";
const WIDGET_ATTR = "data-paseo-file-find";
const STYLE_ID = "paseo-file-find-style";
const SKIPPED = `script,style,iframe,textarea,select,noscript,input,mark,[${WIDGET_ATTR}]`;
const MATCH_LIMIT = 5000;
const REHIGHLIGHT_DELAY_MS = 150;

export interface PreviewFindSnapshot {
  open: boolean;
  query: string;
  /** 1-based position of the active hit; 0 when no hit is selected. */
  current: number;
  total: number;
  /** True once the hit cap cut the list; total reads "N+" in the widget. */
  limited: boolean;
}

const CLOSED: PreviewFindSnapshot = {
  open: false,
  query: "",
  current: 0,
  total: 0,
  limited: false,
};

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Theme-neutral: a translucent amber reads on light and dark surfaces, and the
  // current hit goes opaque so it stays visible over syntax-colored text.
  style.textContent =
    `mark.${HIT}{background:rgba(255,193,7,.45);color:inherit;border-radius:2px}` +
    `mark.${CURRENT_HIT}{background:rgba(255,152,0,.9);color:#000}`;
  document.head.appendChild(style);
}

export class PreviewFindModel {
  private marks: HTMLElement[] = [];
  private observer: MutationObserver | null = null;
  private rehighlightTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PreviewFindSnapshot = CLOSED;

  constructor(
    private host: HTMLElement,
    private options: { matchLimit?: number; rehighlightDelayMs?: number } = {},
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.snapshot;

  private publish() {
    for (const listener of this.listeners) listener();
  }

  readonly open = () => {
    ensureStyle();
    if (!this.snapshot.open) {
      this.snapshot = { ...this.snapshot, open: true };
      this.publish();
      this.observe();
      this.rehighlight();
    }
  };

  readonly close = () => {
    if (!this.snapshot.open) return;
    this.observer?.disconnect();
    this.clearMarks();
    this.snapshot = { ...this.snapshot, open: false, current: 0, total: 0, limited: false };
    this.publish();
  };

  readonly setSearch = (query: string) => {
    if (query === this.snapshot.query) return;
    this.snapshot = { ...this.snapshot, query };
    this.rehighlight();
  };

  readonly next = () => this.step(1);
  readonly previous = () => this.step(-1);

  readonly dispose = () => {
    this.observer?.disconnect();
    this.observer = null;
    if (this.rehighlightTimer) clearTimeout(this.rehighlightTimer);
    this.rehighlightTimer = null;
    this.clearMarks();
    this.listeners.clear();
  };

  private step(direction: 1 | -1) {
    const total = this.marks.length;
    if (!total) return;
    let index: number;
    if (this.snapshot.current === 0) {
      index = direction > 0 ? 0 : total - 1;
    } else {
      index = (this.snapshot.current - 1 + direction + total) % total;
    }
    this.select(index);
  }

  private select(index: number) {
    this.marks[this.snapshot.current - 1]?.classList.remove(CURRENT_HIT);
    const mark = this.marks[index];
    if (!mark) return;
    mark.classList.add(CURRENT_HIT);
    mark.scrollIntoView?.({ block: "nearest" });
    this.snapshot = { ...this.snapshot, current: index + 1 };
    this.publish();
  }

  private observe() {
    if (!this.observer) {
      this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
    }
    this.observer.observe(this.host, { childList: true, characterData: true, subtree: true });
  }

  private onMutations(mutations: MutationRecord[]) {
    if (!this.snapshot.open || !this.snapshot.query) return;
    // Widget status text and mark churn live in our own subtree; real edits are
    // the rest. Own DOM writes are already invisible — the observer is
    // disconnected while they run — so only the widget needs filtering here.
    if (mutations.every((m) => this.inWidget(m.target))) return;
    if (this.rehighlightTimer) clearTimeout(this.rehighlightTimer);
    const delay = this.options.rehighlightDelayMs ?? REHIGHLIGHT_DELAY_MS;
    this.rehighlightTimer = setTimeout(() => {
      this.rehighlightTimer = null;
      this.rehighlight();
    }, delay);
  }

  private inWidget(node: Node): boolean {
    // characterData records carry a Text target, so walk to the element first.
    const element = node instanceof Element ? node : node.parentElement;
    if (!element) return true;
    return element.closest(`[${WIDGET_ATTR}]`) !== null;
  }

  private rehighlight() {
    this.observer?.disconnect();
    try {
      this.clearMarks();
      const query = this.snapshot.query;
      if (!query) {
        this.snapshot = { ...this.snapshot, current: 0, total: 0, limited: false };
        this.publish();
        return;
      }
      let limited = false;
      const limit = this.options.matchLimit ?? MATCH_LIMIT;
      const needle = query.toLowerCase();
      for (const node of this.textNodes()) {
        if (this.marks.length >= limit) {
          limited = true;
          break;
        }
        limited = this.markNode(node, needle, query.length, limit) || limited;
      }
      this.snapshot = {
        ...this.snapshot,
        current: this.marks.length ? 1 : 0,
        total: this.marks.length,
        limited,
      };
      this.publish();
      if (this.marks.length) {
        this.marks[0].classList.add(CURRENT_HIT);
        this.marks[0].scrollIntoView?.({ block: "nearest" });
      }
    } finally {
      if (this.snapshot.open) this.observe();
    }
  }

  /** Returns true when the limit stopped this node partway. */
  private markNode(node: Text, needle: string, needleLength: number, limit: number): boolean {
    const data = node.data;
    const haystack = data.toLowerCase();
    let hit = haystack.indexOf(needle);
    if (hit < 0) return false;
    const fragment = document.createDocumentFragment();
    let last = 0;
    while (hit >= 0 && this.marks.length < limit) {
      fragment.appendChild(document.createTextNode(data.slice(last, hit)));
      const mark = document.createElement("mark");
      mark.className = HIT;
      mark.textContent = data.slice(hit, hit + needleLength);
      fragment.appendChild(mark);
      this.marks.push(mark);
      last = hit + needleLength;
      hit = haystack.indexOf(needle, last);
    }
    fragment.appendChild(document.createTextNode(data.slice(last)));
    node.parentNode?.replaceChild(fragment, node);
    return hit >= 0;
  }

  private clearMarks() {
    const parents = new Set<Node>();
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      parents.add(parent);
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    }
    for (const parent of parents) parent.normalize();
    this.marks = [];
  }

  private textNodes(): Text[] {
    const walker = document.createTreeWalker(this.host, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || !(node as Text).data.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest(SKIPPED)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) nodes.push(current as Text);
    return nodes;
  }
}
